param([string]$InstallDirectory)
$ErrorActionPreference = 'Stop'

function Test-LumeHelperCommand([string]$CommandLine) {
  if (-not $CommandLine) { return $false }
  if ($CommandLine -match 'HKCU\\Software\\Classes\\(lnkfile|InternetShortcut)\\shell\\LumeDock') { return $true }
  if ($CommandLine -match 'Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue' -or $CommandLine -match 'Clear-RecycleBin -Force -ErrorAction Stop') { return $true }
  if ($CommandLine -notmatch '(?i)-EncodedCommand\s+"?([a-z0-9+/=]+)') { return $false }
  try { $sourceText = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($Matches[1])) }
  catch { return $false }
  return ($sourceText -match 'Lume(ShellIcon|Foreground|IconResources)' -or
    $sourceText.Contains('Get-CimInstance Win32_Process -Property ExecutablePath -ErrorAction Stop') -or
    ($sourceText.Contains('WScript.Shell') -and $sourceText.Contains('$shortcut.TargetPath') -and $sourceText.Contains('ConvertTo-Json -InputObject')))
}

function Stop-LumeInstalledApp {
  param([Parameter(Mandatory=$true)][string]$Directory, [int]$GraceMs = 3000)
  $directoryPath = [IO.Path]::GetFullPath($Directory).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
  if (-not [IO.Directory]::GetParent($directoryPath)) { throw 'Refusing a drive-root installation path' }
  if (-not [IO.Directory]::Exists($directoryPath)) { return }
  $appPath = Join-Path $directoryPath 'Lume Dock.exe'
  $snapshot = @(Get-CimInstance Win32_Process -ErrorAction Stop)
  $roots = @($snapshot | Where-Object { $_.ExecutablePath -and [string]::Equals($_.ExecutablePath, $appPath, [StringComparison]::OrdinalIgnoreCase) })
  if (-not $roots.Count) { return }
  $owned = @{}
  foreach ($item in $roots) { $owned[[int]$item.ProcessId] = $item }
  $helperPaths = @(
    (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'),
    (Join-Path $env:SystemRoot 'SysWOW64\WindowsPowerShell\v1.0\powershell.exe'),
    (Join-Path $env:SystemRoot 'System32\reg.exe'),
    (Join-Path $env:SystemRoot 'SysWOW64\reg.exe')
  )
  # Only app processes and their verified helper descendants, never launched user apps.
  do {
    $changed = $false
    foreach ($item in $snapshot) {
      if ($owned.ContainsKey([int]$item.ProcessId) -or -not $owned.ContainsKey([int]$item.ParentProcessId)) { continue }
      if (-not $item.CreationDate -or $item.CreationDate -lt $owned[[int]$item.ParentProcessId].CreationDate) { continue }
      if ($item.ExecutablePath -and ($helperPaths -contains $item.ExecutablePath) -and (Test-LumeHelperCommand $item.CommandLine)) {
        $owned[[int]$item.ProcessId] = $item; $changed = $true
      }
    }
  } while ($changed)
  # New versions respond to --quit via the existing single instance, without a new Dock.
  $request = New-Object System.Diagnostics.ProcessStartInfo
  $request.FileName = $appPath; $request.Arguments = '--quit'
  $request.UseShellExecute = $false; $request.CreateNoWindow = $true
  try {
    $child = [Diagnostics.Process]::Start($request)
    if ($child) {
      try { if (-not $child.WaitForExit(1500)) { $child.Kill(); [void]$child.WaitForExit(1000) } }
      finally { $child.Dispose() }
    }
  } catch { } # Older releases may only support the bounded fallback below.
  $deadline = [DateTime]::UtcNow.AddMilliseconds([Math]::Max(0, $GraceMs))
  do {
    $remaining = @()
    foreach ($old in @($owned.Values)) {
      $current = Get-CimInstance Win32_Process -Filter ('ProcessId=' + [int]$old.ProcessId) -ErrorAction Stop
      if ($current -and $current.CreationDate -eq $old.CreationDate -and $current.ExecutablePath -eq $old.ExecutablePath) { $remaining += $current }
    }
    if (-not $remaining.Count) { return }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $deadline)
  foreach ($old in $remaining) {
    # Recheck identity immediately before termination to guard against PID reuse.
    $current = Get-CimInstance Win32_Process -Filter ('ProcessId=' + [int]$old.ProcessId) -ErrorAction Stop
    if ($current -and $current.CreationDate -eq $old.CreationDate -and $current.ExecutablePath -eq $old.ExecutablePath) {
      try { Stop-Process -Id ([int]$current.ProcessId) -Force -ErrorAction Stop }
      catch { if (Get-Process -Id ([int]$current.ProcessId) -ErrorAction SilentlyContinue) { throw } }
    }
  }
  $deadline = [DateTime]::UtcNow.AddSeconds(2)
  do {
    $alive = $false
    foreach ($old in $remaining) {
      $current = Get-CimInstance Win32_Process -Filter ('ProcessId=' + [int]$old.ProcessId) -ErrorAction Stop
      if ($current -and $current.CreationDate -eq $old.CreationDate -and $current.ExecutablePath -eq $old.ExecutablePath) { $alive = $true }
    }
    if (-not $alive) { return }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $deadline)
  throw 'Lume Dock still running; close this installation and retry'
}

if ($MyInvocation.InvocationName -ne '.') {
  try { Stop-LumeInstalledApp -Directory $InstallDirectory; exit 0 }
  catch { [Console]::Error.WriteLine($_.Exception.Message); exit 22 }
}
