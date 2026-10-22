$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
# Discovery returns metadata only. Native artwork is read on demand.
$apps = @(Get-StartApps | Where-Object { $_.Name -and $_.AppID } | ForEach-Object {
    [PSCustomObject]@{ name = $_.Name; appId = $_.AppID }
})
ConvertTo-Json -InputObject $apps -Depth 3 -Compress
