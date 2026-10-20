$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$sources = @([Console]::In.ReadToEnd() | ConvertFrom-Json)
$shell = $null; $explorer = $null; $apps = $null
$results = @()
try {
    foreach ($source in $sources) {
        $target = ''; $arguments = ''; $directory = ''; $appId = ''
        $shortcut = $null; $item = $null; $folder = $null; $linkPath = ''
        try {
            if ($source.StartsWith('apps-folder:')) {
                $id = $source.Substring(12)
                $appId = $id
                if ($id.Contains('!')) { $appId = $id }
                else {
                    if ($null -eq $explorer) { $explorer = New-Object -ComObject Shell.Application }
                    if ($null -eq $apps) { $apps = $explorer.Namespace('shell:AppsFolder') }
                    $item = $apps.ParseName($id)
                    if ($null -ne $item) {
                        $target = [string]$item.ExtendedProperty('System.Link.TargetParsingPath')
                        $arguments = [string]$item.ExtendedProperty('System.Link.Arguments')
                        $directory = [string]$item.ExtendedProperty('System.Link.WorkingDirectory')
                    }
                }
                if ([IO.Path]::GetExtension($target) -ieq '.lnk') { $linkPath = $target }
                elseif (-not $target -and [IO.Path]::IsPathRooted($id)) {
                    if ([IO.Path]::GetExtension($id) -ieq '.lnk') { $linkPath = $id }
                    elseif ([IO.Path]::GetExtension($id) -ieq '.exe') { $target = $id }
                }
            } elseif ([IO.Path]::GetExtension($source) -ieq '.lnk') { $linkPath = $source }
            else { $target = $source }
            if ($linkPath) {
                if (-not [IO.File]::Exists($linkPath)) { continue }
                if ($null -eq $shell) { $shell = New-Object -ComObject WScript.Shell }
                $shortcut = $shell.CreateShortcut($linkPath)
                $target = $shortcut.TargetPath
                $arguments = $shortcut.Arguments
                $directory = $shortcut.WorkingDirectory
                if (-not $appId -and -not $arguments) {
                    try {
                        if ($null -eq $explorer) { $explorer = New-Object -ComObject Shell.Application }
                        $folder = $explorer.Namespace([IO.Path]::GetDirectoryName($linkPath))
                        if ($folder) {
                            $item = $folder.ParseName([IO.Path]::GetFileName($linkPath))
                            if ($item) { $appId = [string]$item.ExtendedProperty('System.AppUserModel.ID') }
                        }
                    } catch { } # Optional AppID failure must not discard a resolved executable.
                }
            }
            $target = [Environment]::ExpandEnvironmentVariables($target)
            $directory = [Environment]::ExpandEnvironmentVariables($directory)
            if (-not [IO.Path]::IsPathRooted($target) -or [IO.Path]::GetExtension($target) -ine '.exe' -or -not [IO.File]::Exists($target)) { $target = '' }
            if (-not $appId -and -not $target) { continue }
            $results += [PSCustomObject]@{ source = [string]$source; target = [string]$target; arguments = [string]$arguments; workingDirectory = [string]$directory; appId = [string]$appId }
        } catch { }
        finally {
            if ($null -ne $shortcut) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shortcut) }
            if ($null -ne $item) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($item) }
            if ($null -ne $folder) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($folder) }
        }
    }
} finally {
    if ($null -ne $apps) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($apps) }
    if ($null -ne $explorer) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($explorer) }
    if ($null -ne $shell) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell) }
}
ConvertTo-Json -InputObject @($results) -Compress -Depth 3
