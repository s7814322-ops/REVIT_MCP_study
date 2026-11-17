param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
# Start this computer's local service at sign-in; no shared machine paths.
$startup=[Environment]::GetFolderPath('Startup')
if($startup){
 $shell=New-Object -ComObject WScript.Shell
 $shortcut=$shell.CreateShortcut((Join-Path $startup 'ABBY 元件庫同步.lnk'))
 $shortcut.TargetPath=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
 $shortcut.Arguments='-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+(Join-Path $PSScriptRoot 'Start-Library.ps1')+'" -NoBrowser'
 $shortcut.WorkingDirectory=$PSScriptRoot
 $shortcut.WindowStyle=7
 $shortcut.Description='ABBY 元件庫與 OneDrive 預覽自動同步'
 $shortcut.Save()
}
$url = 'http://127.0.0.1:4318'
$marker=Join-Path $PSScriptRoot '.program-version'
$programVersion=if(Test-Path -LiteralPath $marker){[IO.File]::ReadAllText($marker).Trim()}else{'development'}
try {
    $health = Invoke-RestMethod ($url + '/api/health') -TimeoutSec 2
    if ($health.application -eq 'abby-door-library' -and $health.sync -and $health.programVersion -eq $programVersion) { if (!$NoBrowser) { Start-Process $url }; exit }
} catch {}
$serverPath=Join-Path $PSScriptRoot 'server.mjs'
foreach($process in Get-CimInstance Win32_Process -Filter "Name='node.exe'"){
    if($process.CommandLine -and $process.CommandLine.Contains('"'+$serverPath+'"')){Stop-Process -Id $process.ProcessId -ErrorAction Stop}
}
$candidates = @(
    (Join-Path $PSScriptRoot 'runtime\node.exe'),
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
        if ($health.application -eq 'abby-door-library' -and $health.programVersion -eq $programVersion) { if (!$NoBrowser) { Start-Process $url }; exit }
    } catch {}
}
throw 'The local server did not start. Check server-error.log.'
