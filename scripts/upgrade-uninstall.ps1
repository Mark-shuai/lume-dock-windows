param(
  [string]$Uninstaller,
  [string]$InstallDirectory,
  [string]$UninstallArguments = '/currentuser --updated'
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Write-UpgradeLog([string]$Message) {
  if ($script:UpgradeLog) {
    Add-Content -LiteralPath $script:UpgradeLog -Value ((Get-Date -Format o) + ' ' + $Message) -Encoding UTF8
  }
}

function New-LegacyProcessInfo([string]$Executable, [string]$Arguments, [string]$Stage) {
  $info = New-Object System.Diagnostics.ProcessStartInfo
  $info.FileName = $Executable
  $info.Arguments = $Arguments
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.WorkingDirectory = $Stage
  # Set only the child's environment. Parent installer and future app keep normal TEMP.
  $info.EnvironmentVariables['TEMP'] = $Stage
  $info.EnvironmentVariables['TMP'] = $Stage
  return $info
}

function Start-LegacyUninstaller([string]$Executable, [string]$Arguments, [string]$Stage) {
  $info = New-LegacyProcessInfo $Executable $Arguments $Stage
  $child = New-Object System.Diagnostics.Process
  $child.StartInfo = $info
  try {
    if (-not $child.Start()) { throw 'Could not start the legacy uninstaller' }
    Write-UpgradeLog ('Legacy uninstaller PID: ' + $child.Id)
    # Emit a heartbeat so nsExec's output-idle timeout cannot kill a slow upgrade.
    $deadline = [DateTime]::UtcNow.AddSeconds(90)
    while (-not $child.WaitForExit(1000)) {
      [Console]::WriteLine('Waiting for legacy uninstaller')
      if ([DateTime]::UtcNow -gt $deadline) {
        # Terminate this exact helper only; never kill unrelated applications.
        $child.Kill()
        [void]$child.WaitForExit(5000)
        throw 'Legacy uninstaller timed out; staging retained for recovery'
      }
    }
    return $child.ExitCode
  } finally { $child.Dispose() }
}

function Invoke-LumeLegacyUpgrade {
  param(
    [Parameter(Mandatory=$true)][string]$Source,
    [Parameter(Mandatory=$true)][string]$Directory,
    [string]$ExtraArguments = '/currentuser --updated',
    [scriptblock]$Run = { param($exe,$argsText,$stage) Start-LegacyUninstaller $exe $argsText $stage },
    [scriptblock]$StopApp = { param($directory) if ($env:OS -eq 'Windows_NT') { . (Join-Path $PSScriptRoot 'stop-installed-app.ps1'); Stop-LumeInstalledApp -Directory $directory } }
  )
  $stage = $null
  $success = $false
  try {
    $directoryPath = [IO.Path]::GetFullPath($Directory).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
    $parent = [IO.Directory]::GetParent($directoryPath)
    if ($null -eq $parent) { throw 'Invalid install directory' }
    $sourcePath = [IO.Path]::GetFullPath($Source)
    if (-not [string]::Equals([IO.Path]::GetDirectoryName($sourcePath), $directoryPath, [StringComparison]::OrdinalIgnoreCase)) {
      throw 'Uninstaller must belong to the registered installation directory'
    }
    if ([IO.Path]::GetFileName($sourcePath) -ne 'Uninstall Lume Dock.exe') { throw 'Unexpected uninstaller filename' }
    # Arguments come from electron-builder; use a strict allowlist and force data retention.
    $tokens = @($ExtraArguments.Split(' ', [StringSplitOptions]::RemoveEmptyEntries))
    foreach ($token in $tokens) {
      if ($token -notin @('/currentuser','/allusers','--updated','--keep-shortcuts')) { throw 'Unexpected uninstall argument' }
    }
    if ($tokens -contains '/currentuser' -and $tokens -contains '/allusers') { throw 'Conflicting uninstall modes' }
    $mode = if ($tokens -contains '/allusers') { '/allusers' } else { '/currentuser' }
    & $StopApp $directoryPath
    if (-not [IO.File]::Exists($sourcePath)) {
      # A stale uninstall record is not a running process. Let NSIS install the
      # current files and rewrite its own registration; do not delete keys/data.
      Write-UpgradeLog 'Old uninstaller missing: continuing as repair install; old files and user data retained'
      return 0
    }
    # A sibling is outside the tree being uninstalled and on its actual filesystem.
    # Prefer LOCALAPPDATA Temp when it is on the same volume and sibling ACLs forbid creation.
    $stageParent = $parent.FullName
    if ($env:LOCALAPPDATA) {
      $localTemp = Join-Path $env:LOCALAPPDATA 'Temp'
      if ([IO.Path]::GetPathRoot($directoryPath) -eq [IO.Path]::GetPathRoot($localTemp)) {
        $stageParent = $localTemp
      }
    }
    $stage = Join-Path $stageParent ('.lume-upgrade-' + [Guid]::NewGuid().ToString('N'))
    [void][IO.Directory]::CreateDirectory($stage)
    # Junctions/mount points can defeat drive-letter checks. Verify actual volumes on Windows.
    if ($env:OS -eq 'Windows_NT') {
      if (-not ('LumeUpgradeVolume' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class LumeUpgradeVolume {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool GetVolumePathName(string path, StringBuilder name, int size);
  public static string Root(string path) {
    var name = new StringBuilder(1024);
    if (!GetVolumePathName(path, name, name.Capacity)) throw new System.ComponentModel.Win32Exception();
    return name.ToString();
  }
}
'@
      }
      if ([LumeUpgradeVolume]::Root($directoryPath) -ne [LumeUpgradeVolume]::Root($stage)) { throw 'Staging must be on the installation volume; check folder junctions' }
    }
    $copy = Join-Path $stage 'old-uninstaller.exe'
    [IO.File]::Copy($sourcePath, $copy, $false)
    $before = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash
    if ($before -ne (Get-FileHash -LiteralPath $copy -Algorithm SHA256).Hash) { throw 'Uninstaller copy verification failed' }
    $arguments = '/S /KEEP_APP_DATA ' + $mode + ' --updated'
    if ($tokens -contains '--keep-shortcuts') { $arguments += ' --keep-shortcuts' }
    # NSIS _?= must be last and intentionally consumes the remaining path including spaces.
    $arguments += ' _?=' + $directoryPath
    Write-UpgradeLog ('Install directory: ' + $directoryPath)
    Write-UpgradeLog ('Same-volume staging: ' + $stage)
    if ($env:OS -eq 'Windows_NT') {
      try {
        $appPath = Join-Path $directoryPath 'Lume Dock.exe'
        $running = @(Get-CimInstance Win32_Process -Filter "Name='Lume Dock.exe'" | Where-Object { $_.ExecutablePath -eq $appPath })
        Write-UpgradeLog ('Matching application processes: ' + (($running | ForEach-Object { $_.ProcessId }) -join ','))
      } catch { Write-UpgradeLog 'Process diagnostics unavailable; legacy uninstaller will check locks' }
    }
    $code = & $Run $copy $arguments $stage
    if ($code -ne 0) { throw ('Legacy uninstaller exited with code ' + $code) }
    $success = $true
    Write-UpgradeLog 'Legacy uninstall completed'
    return 0
  } catch {
    Write-UpgradeLog ('ERROR: ' + $_.Exception.Message)
    if ($stage) { Write-UpgradeLog ('Staging retained for recovery: ' + $stage) }
    [Console]::Error.WriteLine($_.Exception.Message)
    return 20
  } finally {
    # A failed uninstaller may have moved files here before failing to roll back.
    # Preserve that stage; never erase files required for recovery.
    if ($success -and $stage) {
      try { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction Stop }
      catch { Write-UpgradeLog ('Staging cleanup deferred: ' + $stage) }
    }
  }
}

if ($MyInvocation.InvocationName -ne '.') {
  try {
    $logRoot = Join-Path $env:LOCALAPPDATA 'Lume Dock\InstallerLogs'
    [void][IO.Directory]::CreateDirectory($logRoot)
    $script:UpgradeLog = Join-Path $logRoot ('upgrade-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + $PID + '.log')
    Write-UpgradeLog 'Lume Dock same-volume upgrade started'
    exit (Invoke-LumeLegacyUpgrade -Source $Uninstaller -Directory $InstallDirectory -ExtraArguments $UninstallArguments)
  } catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 21
  }
}
