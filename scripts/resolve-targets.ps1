$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$targets = @([Console]::In.ReadToEnd() | ConvertFrom-Json)
$shell = $null
$result = @()
try {
  foreach ($source in $targets) {
    $target = ''
    try {
      if ([IO.Path]::GetExtension($source) -ieq '.lnk') {
        if ($null -eq $shell) { $shell = New-Object -ComObject WScript.Shell }
        $shortcut = $null
        try { $shortcut = $shell.CreateShortcut($source); $target = [Environment]::ExpandEnvironmentVariables($shortcut.TargetPath) }
        finally { if ($null -ne $shortcut) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shortcut) } }
      } elseif ([IO.Path]::IsPathRooted($source)) { $target = $source }
      else { $command = Get-Command -Name $source -CommandType Application -ErrorAction Stop | Select-Object -First 1; $target = $command.Source }
      if (-not [IO.Path]::IsPathRooted($target) -or [IO.Path]::GetExtension($target) -ine '.exe') { $target = '' }
    } catch { $target = '' }
    $result += [PSCustomObject]@{ source = [string]$source; target = [string]$target }
  }
} finally { if ($null -ne $shell) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell) } }
ConvertTo-Json -InputObject @($result) -Compress
