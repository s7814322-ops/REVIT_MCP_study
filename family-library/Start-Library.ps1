param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$url = 'http://127.0.0.1:4318'
try {
    $health = Invoke-RestMethod ($url + '/api/health') -TimeoutSec 2
    if ($health.application -eq 'abby-door-library' -and $health.sync) { if (!$NoBrowser) { Start-Process $url }; exit }
} catch {}
$candidates = @(
    (Join-Path $env:LOCALAPPDATA 'AbbyMCP\tools\node\node.exe'),
    (Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe')
)
$node = $candidates | Where-Object {Test-Path -LiteralPath $_} | Select-Object -First 1
if (!$node) { $node = (Get-Command node.exe -ErrorAction Stop).Source }
if (!(Test-Path -LiteralPath (Join-Path $PSScriptRoot 'dist\catalog.json'))) {
    & $node (Join-Path $PSScriptRoot 'build-catalog.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Catalog refresh failed.' }
}
Start-Process -FilePath $node -ArgumentList ('"' + (Join-Path $PSScriptRoot 'server.mjs') + '"') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $PSScriptRoot 'server.log') -RedirectStandardError (Join-Path $PSScriptRoot 'server-error.log')
for ($attempt = 0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Milliseconds 500
    try {
        $health = Invoke-RestMethod ($url + '/api/health') -TimeoutSec 1
        if ($health.application -eq 'abby-door-library') { if (!$NoBrowser) { Start-Process $url }; exit }
    } catch {}
}
throw 'The local server did not start. Check server-error.log.'
