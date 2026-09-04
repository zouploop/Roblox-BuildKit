$ErrorActionPreference = 'Stop'
try {
    $port = 44760
    if ($env:BUILDKIT_PORT) {
        if (-not [int]::TryParse($env:BUILDKIT_PORT, [ref]$port) -or $port -lt 1 -or $port -gt 65535) {
            throw 'BUILDKIT_PORT must be an integer between 1 and 65535.'
        }
    }
    function Get-PortOwners {
        @(Get-NetTCPConnection -State Listen | Where-Object LocalPort -eq $port |
            Select-Object -ExpandProperty OwningProcess -Unique)
    }
    foreach ($ownerPid in (Get-PortOwners)) {
        # Recheck ownership immediately before termination; never kill all node processes.
        if ((Get-PortOwners) -contains $ownerPid) {
            Write-Host "Stopping PID $ownerPid on port $port (in-memory state will be lost)..."
            Stop-Process -Id $ownerPid -Force
        }
    }
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        if ((Get-PortOwners).Count -eq 0) {
            Write-Host "Port $port is free."
            exit 0
        }
        Start-Sleep -Milliseconds 100
    }
    throw "Port $port is still occupied. Its owner may be restarting automatically."
} catch {
    Write-Error $_ -ErrorAction Continue
    exit 1
}
