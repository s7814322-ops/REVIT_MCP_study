#Requires -Version 7.0
param([string]$Package='')
$ErrorActionPreference='Stop'
$repo=Split-Path -Parent $PSScriptRoot
$fixture=Join-Path $repo ('tmp\family-library-release-'+[guid]::NewGuid().ToString('N'))
$program=Join-Path $fixture 'program'
& node (Join-Path $repo 'family-library\package-program.mjs') $program
if($LASTEXITCODE -ne 0){throw 'Program package failed'}
$manifest=Get-Content -LiteralPath (Join-Path $program 'program-manifest.json') -Raw | ConvertFrom-Json
if($manifest.files.Count -ne 21){throw 'Unexpected program inventory'}
foreach($entry in $manifest.files){if($entry.path -match '(?i)((^|/)catalog\.(json|js)$|sources\.local|models-index|type-models|\.rfa$|\.rvt$)'){throw 'Private data included in program package'}}
Add-Type -AssemblyName Newtonsoft.Json
$references=@((Get-ChildItem -LiteralPath (Join-Path $PSHOME 'ref') -Filter '*.dll').FullName)+[Newtonsoft.Json.JsonConvert].Assembly.Location
Add-Type -Path (Join-Path $repo 'MCP\FamilyLibrary\LibraryDeployment.cs') -ReferencedAssemblies $references -CompilerOptions '/nowarn:1701'
$destination=Join-Path $fixture 'user\door-library'
$privateFiles=@{'sources.local.json'='private root';'type-models-index.json'='private index';'dist\catalog.json'='private catalog';'dist\models\private.json'='private model'}
foreach($name in $privateFiles.Keys){$file=Join-Path $destination $name;$null=New-Item -ItemType Directory -Path (Split-Path -Parent $file) -Force;[IO.File]::WriteAllText($file,$privateFiles[$name])}
if(![RevitMCP.FamilyLibrary.LibraryDeployment]::Install($program,$destination)){throw 'First program install was not performed'}
if([RevitMCP.FamilyLibrary.LibraryDeployment]::Install($program,$destination)){throw 'Unchanged program was recopied'}
foreach($name in $privateFiles.Keys){if([IO.File]::ReadAllText((Join-Path $destination $name)) -ne $privateFiles[$name]){throw "Private data changed: $name"}}
Remove-Item -LiteralPath (Join-Path $destination 'server.mjs')
if(![RevitMCP.FamilyLibrary.LibraryDeployment]::Install($program,$destination)){throw 'Missing program file was not repaired'}
$first=Join-Path $program $manifest.files[0].path;$original=[IO.File]::ReadAllBytes($first);[IO.File]::WriteAllText($first,'tampered')
$rejected=$false;try{[RevitMCP.FamilyLibrary.LibraryDeployment]::Install($program,$destination)|Out-Null}catch{$rejected=$true};if(!$rejected){throw 'Modified program was accepted'};[IO.File]::WriteAllBytes($first,$original)
$descriptor=Join-Path $program 'program-manifest.json';$originalDescriptor=[IO.File]::ReadAllText($descriptor)
$manifest.files+=@([pscustomobject]@{path='sources.local.json';sha256=('a'*64)});[IO.File]::WriteAllText($descriptor,($manifest|ConvertTo-Json -Depth 8))
$rejected=$false;try{[RevitMCP.FamilyLibrary.LibraryDeployment]::Install($program,$destination)|Out-Null}catch{$rejected=$true};if(!$rejected){throw 'Private-data write was accepted'};[IO.File]::WriteAllText($descriptor,$originalDescriptor)
# Simulate the first update being applied by a pre-feature updater. Only the
# release directory/current.json exist; the Revit startup bootstrap does the rest.
$firstRoot=Join-Path $fixture 'first-update';$release=Join-Path $firstRoot 'releases\abby-test\family-library'
$null=New-Item -ItemType Directory -Path (Split-Path -Parent $release) -Force
Copy-Item -LiteralPath $program -Destination $release -Recurse
[IO.File]::WriteAllText((Join-Path $firstRoot 'current.json'),' {"Version":"abby-test"}')
[RevitMCP.FamilyLibrary.LibraryDeployment]::InstallCurrent((Join-Path $firstRoot 'door-library'))
if(!(Test-Path -LiteralPath (Join-Path $firstRoot 'door-library\dist\vendor\three\three.module.js'))){throw 'First-update web deployment missing'}
if(Test-Path -LiteralPath (Join-Path $firstRoot 'door-library\sources.local.json')){throw 'First-update bootstrap invented a private root'}
if($Package){
 Add-Type -AssemblyName System.IO.Compression.FileSystem
 $archive=[IO.Compression.ZipFile]::OpenRead((Resolve-Path $Package))
 try{
  $names=@($archive.Entries|ForEach-Object FullName)
  foreach($name in @('family-library/program-manifest.json','family-library/dist/index.html','family-library/dist/vendor/three/three.module.js','addin/2024/WebView2Loader.dll','addin/2025/WebView2Loader.dll','addin/2026/WebView2Loader.dll')){if($name -notin $names){throw "Release asset missing: $name"}}
  if(@($names|Where-Object {$_ -match '(?i)(sources\.local\.json|/catalog\.(json|js)|\.(rfa|rvt)$|preview-pack\.json)$'}).Count){throw 'Private library data was released'}
 }finally{$archive.Dispose()}
}
Write-Host 'PASS family-library release: checksum validation, private-data preservation, repair, unsafe-entry rejection, and first-update bootstrap.'
