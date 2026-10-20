$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$targets = @(ConvertFrom-Json ([Console]::In.ReadToEnd()))
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class LumeIconResources {
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    public static extern uint ExtractIconEx(string file, int index, out IntPtr large, out IntPtr small, uint count);
    [DllImport("user32.dll")]
    public static extern bool DestroyIcon(IntPtr icon);
}
'@
function Read-ResourceIcon([string] $file, [int] $index) {
    if (-not [IO.Path]::IsPathRooted($file) -or -not [IO.File]::Exists($file)) { return $null }
    $large = [IntPtr]::Zero; $small = [IntPtr]::Zero
    $icon = $null; $bitmap = $null; $stream = $null
    try {
        [void][LumeIconResources]::ExtractIconEx($file, $index, [ref]$large, [ref]$small, 1)
        $handle = $large
        if ($handle -eq [IntPtr]::Zero) { $handle = $small }
        if ($handle -eq [IntPtr]::Zero) { return $null }
        $icon = [Drawing.Icon]::FromHandle($handle)
        $bitmap = $icon.ToBitmap()
        $stream = New-Object IO.MemoryStream
        $bitmap.Save($stream, [Drawing.Imaging.ImageFormat]::Png)
        return 'data:image/png;base64,' + [Convert]::ToBase64String($stream.ToArray())
    } catch { return $null }
    finally {
        if ($stream) { $stream.Dispose() }
        if ($bitmap) { $bitmap.Dispose() }
        if ($icon) { $icon.Dispose() }
        if ($large -ne [IntPtr]::Zero) { [void][LumeIconResources]::DestroyIcon($large) }
        if ($small -ne [IntPtr]::Zero) { [void][LumeIconResources]::DestroyIcon($small) }
    }
}
$shell = $null; $results = @()
try {
    $shell = New-Object -ComObject WScript.Shell
    foreach ($source in $targets) {
        $shortcut = $null
        $candidates = @(); $location = ''; $target = ''; $icon = $null; $index = 0
        try {
            if ([IO.Path]::GetExtension($source) -ieq '.lnk') {
                $shortcut = $shell.CreateShortcut($source)
                $target = $shortcut.TargetPath
                $location = $shortcut.IconLocation
                if ($location -match '^(.*),\s*(-?\d+)\s*$') {
                    $location = $Matches[1]; $index = [int]$Matches[2]
                }
            } else {
                $reader = New-Object IO.StreamReader($source, [Text.Encoding]::Default, $true)
                try { $text = $reader.ReadToEnd() } finally { $reader.Dispose() }
                if ($text -match '(?im)^IconFile\s*=\s*(.+?)\s*$') { $location = $Matches[1] }
                if ($text -match '(?im)^IconIndex\s*=\s*(-?\d+)\s*$') { $index = [int]$Matches[1] }
            }
            if ($location) {
                $location = [Environment]::ExpandEnvironmentVariables($location.Trim().Trim('"'))
                if (-not [IO.Path]::IsPathRooted($location)) { $location = [IO.Path]::Combine([IO.Path]::GetDirectoryName($source), $location) }
                $icon = Read-ResourceIcon $location $index
                if ($index -eq 0) { $candidates += $location }
            }
            if ($target) { $candidates += [Environment]::ExpandEnvironmentVariables($target) }
        } catch { }
        finally { if ($shortcut) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shortcut) } }
        $results += [pscustomobject]@{ source = $source; candidates = @($candidates); icon = $icon }
    }
} finally { if ($shell) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell) } }
ConvertTo-Json -InputObject @($results) -Compress -Depth 4
