$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../scripts/stop-installed-app.ps1')
function Check($condition, $message) { if (-not $condition) { throw $message } }
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('lume-stop-fixture-' + [Guid]::NewGuid().ToString('N'))
$savedRoot = $env:SystemRoot
try {
  [void][IO.Directory]::CreateDirectory($fixture)
  $env:SystemRoot = Join-Path $fixture 'Windows'
  $appPath = Join-Path $fixture 'Lume Dock.exe'
  $psPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $otherPath = Join-Path $fixture 'Portable/Lume Dock.exe'
  $created = [DateTime]::UtcNow.AddDays(-1)
  $helperCommand = 'powershell.exe -EncodedCommand ' + [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes('# LumeForeground fixture'))
  $script:records = @(
    @{ProcessId=100;ParentProcessId=1;ExecutablePath=$appPath;CreationDate=$created},
    @{ProcessId=101;ParentProcessId=100;ExecutablePath=$appPath;CreationDate=$created.AddSeconds(1)},
    @{ProcessId=102;ParentProcessId=100;ExecutablePath=$psPath;CreationDate=$created.AddSeconds(2);CommandLine=$helperCommand},
    @{ProcessId=150;ParentProcessId=100;ExecutablePath='C:\Browser.exe';CreationDate=$created.AddSeconds(2)},
    @{ProcessId=151;ParentProcessId=100;ExecutablePath=$psPath;CreationDate=$created.AddSeconds(2);CommandLine='powershell.exe -NoProfile'},
    @{ProcessId=200;ParentProcessId=1;ExecutablePath=$psPath;CreationDate=$created},
    @{ProcessId=202;ParentProcessId=100;ExecutablePath=$psPath;CreationDate=$created.AddDays(-1)},
    @{ProcessId=300;ParentProcessId=1;ExecutablePath=$otherPath;CreationDate=$created}
  ) | ForEach-Object { [PSCustomObject]$_ }
  $script:live = @($script:records)
  $script:killed = @(); $script:reuse = $false
  function Get-CimInstance { param($ClassName,$Filter,$ErrorAction)
    if (-not $Filter) { return $script:records }
    $idValue = [int]($Filter -replace 'ProcessId=','')
    if ($script:reuse -and $idValue -eq 100) { return [PSCustomObject]@{ProcessId=100;ExecutablePath=$appPath;CreationDate=$created.AddHours(1)} }
    return @($script:live | Where-Object { $_.ProcessId -eq $idValue })
  }
  function Stop-Process { param($Id,[switch]$Force,$ErrorAction)
    $script:killed += $Id
    $script:live = @($script:live | Where-Object { $_.ProcessId -ne $Id })
  }
  Stop-LumeInstalledApp -Directory $fixture -GraceMs 0
  Check (($script:killed | Sort-Object) -join ',' -eq '100,101,102') 'termination escaped this installation/owned helpers'
  Check ($script:live.Count -eq 5) 'unrelated shell, portable Dock or launched browser was stopped'
  $script:live = @($script:records); $script:killed = @(); $script:reuse = $true
  Stop-LumeInstalledApp -Directory $fixture -GraceMs 0
  Check ($script:killed -notcontains 100) 'PID reuse was not checked'
  Check (($script:killed | Sort-Object) -join ',' -eq '101,102') 'PID reuse changed helper targeting'
  [Console]::WriteLine('Stop fixtures passed: exact install path, owned helpers, unrelated app/shell/portable retention and PID reuse')
} finally {
  $env:SystemRoot = $savedRoot
  Remove-Item -LiteralPath $fixture -Recurse -Force -ErrorAction SilentlyContinue
}
