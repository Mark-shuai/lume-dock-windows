param([int] $RootPid)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
# Record only the test application's descendants; never export paths/commands.
$all = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name)
$owned = New-Object 'System.Collections.Generic.HashSet[int]'
[void]$owned.Add($RootPid)
do {
    $changed = $false
    foreach ($item in $all) {
        if ($item.ProcessId -ne $PID -and $owned.Contains([int]$item.ParentProcessId)) {
            if ($owned.Add([int]$item.ProcessId)) { $changed = $true }
        }
    }
} while ($changed)
$results = @()
foreach ($item in $all) {
    if (-not $owned.Contains([int]$item.ProcessId)) { continue }
    $process = $null
    try {
        $process = [Diagnostics.Process]::GetProcessById([int]$item.ProcessId)
        $results += [PSCustomObject]@{ pid = [int]$item.ProcessId; name = $item.Name;
            workingSetBytes = $process.WorkingSet64; privateBytes = $process.PrivateMemorySize64;
            cpuTotalMs = $process.TotalProcessorTime.TotalMilliseconds }
    } catch { } finally { if ($process) { $process.Dispose() } }
}
ConvertTo-Json -InputObject @($results) -Depth 3 -Compress
