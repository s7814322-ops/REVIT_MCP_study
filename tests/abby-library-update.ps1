#Requires -Version 5.1
$ErrorActionPreference='Stop'
$repo=Split-Path -Parent $PSScriptRoot
. (Join-Path $repo 'scripts\abby\Abby.Common.ps1')
. (Join-Path $repo 'scripts\abby\LibraryUpdate.ps1')
$fixture=Join-Path $repo ('tmp\library-update-'+[guid]::NewGuid().ToString('N'))
$program=Join-Path $fixture 'program';$node=(Get-Command node -ErrorAction Stop).Source
& $node (Join-Path $repo 'family-library\package-program.mjs') $program
if($LASTEXITCODE -ne 0){throw 'Package creation failed'}
function Get-CimInstance {return @()} # never inspect/stop the real library in fixture tests
foreach($machine in @('computer-a','computer-b')){
 $destination=Join-Path $fixture ($machine+'\door-library')
 $private=@{'sources.local.json'='{"familyRoot":"private-machine-root"}';'dist\catalog.json'='{"items":[]}';'type-models-index.json'='{"private":"index"}';'dist\models-types\private.json'='private geometry';'.preview-sync-state.json'='private state'}
 foreach($name in $private.Keys){$file=Join-Path $destination $name;$null=New-Item -ItemType Directory -Path (Split-Path -Parent $file) -Force;[IO.File]::WriteAllText($file,$private[$name])}
 Install-AbbyLibraryProgram $program $destination $node
 foreach($name in $private.Keys){if([IO.File]::ReadAllText((Join-Path $destination $name)) -ne $private[$name]){throw ('Private data changed: '+$name)}}
 $marker=Join-Path $destination '.program-version';$stamp=(Get-Item -LiteralPath $marker).LastWriteTimeUtc
 Install-AbbyLibraryProgram $program $destination $node
 if((Get-Item -LiteralPath $marker).LastWriteTimeUtc -ne $stamp){throw 'Unchanged version was reinstalled'}
 Remove-Item -LiteralPath (Join-Path $destination 'server.mjs')
 Install-AbbyLibraryProgram $program $destination $node
 if(!(Test-Path -LiteralPath (Join-Path $destination 'server.mjs'))){throw 'Missing program not repaired'}
}
$destination=Join-Path $fixture 'computer-a\door-library'
$before=[IO.File]::ReadAllText((Join-Path $destination 'server.mjs'))
$manifestPath=Join-Path $program 'program-manifest.json';$manifest=Read-AbbyJson $manifestPath;$original=[IO.File]::ReadAllText($manifestPath)
$manifest.files+=@{path='sources.local.json';sha256=('a'*64)};Write-AbbyJson $manifestPath $manifest
$rejected=$false;try{Install-AbbyLibraryProgram $program $destination $node}catch{$rejected=$true};if(!$rejected){throw 'Private path was accepted'}
[IO.File]::WriteAllText($manifestPath,$original)
[IO.File]::WriteAllText((Join-Path $program 'server.mjs'),'tampered')
$rejected=$false;try{Install-AbbyLibraryProgram $program $destination $node}catch{$rejected=$true};if(!$rejected){throw 'Tampered package was accepted'}
if([IO.File]::ReadAllText((Join-Path $destination 'server.mjs')) -ne $before){throw 'Validation failure changed installed program'}
[IO.File]::WriteAllText((Join-Path $program 'server.mjs'),$before)
# Force a reinstall, fail partway through copying, and check every prior byte.
[IO.File]::WriteAllText((Join-Path $destination 'server.mjs'),'old local server')
$snapshot=@{};foreach($file in Get-ChildItem -LiteralPath $destination -Recurse -File){$snapshot[$file.FullName]=(Get-FileHash -LiteralPath $file.FullName).Hash}
$script:failCopy=$true
function Copy-Item($LiteralPath,$Destination,[switch]$Force){
 if($script:failCopy -and $Destination -eq (Join-Path $script:destination 'settings.mjs')){$script:failCopy=$false;throw 'Simulated copy failure'}
 Microsoft.PowerShell.Management\Copy-Item -LiteralPath $LiteralPath -Destination $Destination -Force:$Force
}
$rejected=$false;try{Install-AbbyLibraryProgram $program $destination $node}catch{$rejected=$true};if(!$rejected){throw 'Copy failure not propagated'}
foreach($file in $snapshot.Keys){if((Get-FileHash -LiteralPath $file).Hash -ne $snapshot[$file]){throw ('Rollback changed '+$file)}}
Remove-Item Function:Copy-Item
# Simulate the old updater copying only its four known client files. The next
# midnight invocation must find the new helper in its verified release itself.
$legacy=Join-Path $fixture 'legacy-client';$version='abby-bootstrap-test';$runtime=Join-Path $legacy ('releases\'+$version)
$null=New-Item -ItemType Directory -Path (Join-Path $runtime 'client') -Force
foreach($name in @('Update-Abby.ps1','Abby.Common.ps1','channel.json')){Copy-Item -LiteralPath (Join-Path $repo ('scripts\abby\'+$name)) -Destination $legacy}
Copy-Item -LiteralPath (Join-Path $repo 'scripts\abby\LibraryUpdate.ps1') -Destination (Join-Path $runtime 'client\LibraryUpdate.ps1')
foreach($year in @('2024','2025','2026')){$folder=Join-Path $runtime ('addin\'+$year);$null=New-Item -ItemType Directory -Path $folder -Force;[IO.File]::WriteAllText((Join-Path $folder 'RevitMCP.dll'),'fixture')}
$files=@(Get-ChildItem -LiteralPath $runtime -Recurse -File|ForEach-Object {@{Path=$_.FullName.Substring($runtime.Length+1).Replace('\','/');Sha256=(Get-FileHash -LiteralPath $_.FullName).Hash}})
Write-AbbyJson (Join-Path $runtime 'manifest.json') @{Format=1;Version=$version;SourceRepository='s7814322-ops/REVIT_MCP_study';SourceBranch='my-revit-tool';Files=$files}
Write-AbbyJson (Join-Path $legacy 'current.json') @{Version=$version}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip=Join-Path $fixture 'legacy-fixture.zip';[IO.Compression.ZipFile]::CreateFromDirectory($runtime,$zip);[IO.File]::WriteAllText(($zip+'.sha256'),(Get-FileHash -LiteralPath $zip).Hash)
& (Join-Path $legacy 'Update-Abby.ps1') -Package $zip -InstallRoot $legacy -StagingRoot (Join-Path $fixture 'legacy-staging') -ValidateOnly
if($LASTEXITCODE -ne 0){throw 'Old updater helper bootstrap failed'}
Write-Host 'PASS two-PC library updates, idempotence, missing-file repair, checksum/path rejection, rollback and private data preservation.'
