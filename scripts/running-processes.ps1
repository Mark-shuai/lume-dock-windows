$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$paths = @(Get-CimInstance Win32_Process -Property ExecutablePath -ErrorAction Stop | ForEach-Object { if ($_.ExecutablePath) { [string]$_.ExecutablePath } } | Sort-Object -Unique)
ConvertTo-Json -InputObject $paths -Compress
