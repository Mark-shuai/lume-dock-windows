$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../scripts/upgrade-uninstall.ps1')
function Check($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('lume-upgrade-fixture-' + [Guid]::NewGuid().ToString('N'))
$savedLocal = $env:LOCALAPPDATA
$savedTemp = $env:TEMP
$savedTmp = $env:TMP
try {
  [void][IO.Directory]::CreateDirectory($fixture)
  # Force staging beside the old installation, including spaces, Unicode and &.
  $env:LOCALAPPDATA = ''
  $unicode = [string][char]0x6D4B + [string][char]0x8BD5
  $installed = [IO.Path]::GetFullPath((Join-Path $fixture ('Software & ' + $unicode + '/Lume Dock')))
  [void][IO.Directory]::CreateDirectory($installed)
  $source = Join-Path $installed 'Uninstall Lume Dock.exe'
  [IO.File]::WriteAllText($source, 'fixture uninstaller bytes')
  $sentinel = Join-Path $fixture 'user-config-and-shortcuts.keep'
  [IO.File]::WriteAllText($sentinel, 'preserve user data')
  $script:captured = $null
  $code = Invoke-LumeLegacyUpgrade -Source $source -Directory $installed -ExtraArguments '/currentuser --updated --keep-shortcuts' -Run {
    param($exe,$argsText,$stage)
    Check ([IO.File]::ReadAllText($exe) -eq 'fixture uninstaller bytes') 'copy differs'
    Check ([IO.Path]::GetDirectoryName($stage) -eq [IO.Directory]::GetParent($installed).FullName) 'stage must be a sibling'
    Check (-not $stage.StartsWith($installed + [IO.Path]::DirectorySeparatorChar)) 'stage inside installation'
    Check ($argsText -eq ('/S /KEEP_APP_DATA /currentuser --updated --keep-shortcuts _?=' + $installed)) 'unsafe arguments'
    $script:captured = $stage
    return 0
  }
  Check ($code -eq 0) 'successful upgrade failed'
  Check (-not [IO.Directory]::Exists($script:captured)) 'successful stage was not cleaned'
  Check ([IO.File]::ReadAllText($sentinel) -eq 'preserve user data') 'configuration touched'
  Check ($env:TEMP -eq $savedTemp -and $env:TMP -eq $savedTmp) 'global TEMP was modified'

  $code = Invoke-LumeLegacyUpgrade -Source $source -Directory $installed -ExtraArguments '/allusers --updated' -Run {
    param($exe,$argsText,$stage)
    Check ($argsText.Contains('/allusers')) 'lost installation scope'
    $script:captured = $stage
    [IO.File]::WriteAllText((Join-Path $stage 'recover.keep'), 'partially moved old file')
    return 2
  }
  Check ($code -eq 20) 'failed uninstall should block upgrade'
  Check ([IO.File]::Exists((Join-Path $script:captured 'recover.keep'))) 'failure erased recovery files'
  Check ([IO.File]::Exists($source) -and [IO.File]::Exists($sentinel)) 'failure damaged original data'

  foreach ($bad in @('--delete-app-data','--updated --arbitrary','/allusers /currentuser')) {
    $code = Invoke-LumeLegacyUpgrade -Source $source -Directory $installed -ExtraArguments $bad -Run { throw 'MUST NOT RUN' }
    Check ($code -eq 20) 'invalid arguments accepted'
  }
  $code = Invoke-LumeLegacyUpgrade -Source $sentinel -Directory $installed -Run { throw 'MUST NOT RUN' }
  Check ($code -eq 20) 'foreign executable accepted'
  $code = Invoke-LumeLegacyUpgrade -Source (Join-Path $installed 'missing.exe') -Directory $installed -Run { throw 'MUST NOT RUN' }
  Check ($code -eq 20) 'missing executable accepted'

  $broken = Join-Path $fixture 'Missing uninstaller'
  [void][IO.Directory]::CreateDirectory($broken)
  [IO.File]::WriteAllText((Join-Path $broken 'app.keep'), 'old files retained')
  $code = Invoke-LumeLegacyUpgrade -Source (Join-Path $broken 'Uninstall Lume Dock.exe') -Directory $broken -StopApp { param($dir) } -Run { throw 'MUST NOT RUN' }
  Check ($code -eq 0) 'missing old uninstaller should allow repair installation'
  Check ([IO.File]::Exists((Join-Path $broken 'app.keep'))) 'repair erased old files'
  $missing = Join-Path $fixture 'Deleted old install'
  $code = Invoke-LumeLegacyUpgrade -Source (Join-Path $missing 'Uninstall Lume Dock.exe') -Directory $missing -StopApp { param($dir) } -Run { throw 'MUST NOT RUN' }
  Check ($code -eq 0) 'stale registration to deleted directory should permit installation'
  Check (-not [IO.Directory]::Exists($missing)) 'stale record repair modified the filesystem'

  $stage = Join-Path $fixture 'child environment & space'
  [void][IO.Directory]::CreateDirectory($stage)
  $shell = if ($env:OS -eq 'Windows_NT') { Join-Path $PSHOME 'powershell.exe' } else { Join-Path $PSHOME 'pwsh' }
  $childScript = '[IO.File]::WriteAllText([IO.Path]::Combine($env:TEMP,"child-env.json"), (ConvertTo-Json @{temp=$env:TEMP;tmp=$env:TMP;cwd=[Environment]::CurrentDirectory})); [IO.File]::WriteAllText("child-cwd.keep","cwd fixture"); exit 0'
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($childScript))
  Check ((Start-LegacyUninstaller $shell ('-NoProfile -NonInteractive -EncodedCommand ' + $encoded) $stage) -eq 0) 'child process failed'
  $observed = Get-Content -LiteralPath (Join-Path $stage 'child-env.json') -Raw | ConvertFrom-Json
  Check ($observed.temp -eq $stage -and $observed.tmp -eq $stage -and [IO.File]::Exists((Join-Path $stage 'child-cwd.keep'))) ('child environment or cwd differs: ' + (ConvertTo-Json $observed -Compress) + ' expected ' + $stage)
  Check ($env:TEMP -eq $savedTemp -and $env:TMP -eq $savedTmp) 'child environment leaked into parent'
  [Console]::WriteLine('Upgrade fixtures passed: sibling staging, byte verification, data retention, failure recovery, argument boundaries, isolated child TEMP/TMP/cwd')
} finally {
  $env:LOCALAPPDATA = $savedLocal
  $env:TEMP = $savedTemp
  $env:TMP = $savedTmp
  Remove-Item -LiteralPath $fixture -Recurse -Force -ErrorAction SilentlyContinue
}
