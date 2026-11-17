param([Parameter(Mandatory=$true)][string]$FamilyRoot,[string]$PreviewPack,[string]$Destination=(Join-Path $env:LOCALAPPDATA 'AbbyMCP\door-library'),[switch]$SkipDependencies)
$ErrorActionPreference='Stop'
if(!(Test-Path -LiteralPath $FamilyRoot -PathType Container)){throw 'FamilyRoot folder does not exist.'}
$dest=[IO.Path]::GetFullPath($Destination)
$null=New-Item -ItemType Directory -Path $dest -Force
if($dest -ne $PSScriptRoot){
 foreach($name in @('sources.mjs','source-files.mjs','cfb.mjs','version-policy.mjs','server.mjs','settings.mjs','build-catalog.mjs','prepare-web.mjs','portable-previews.mjs','import-previews.mjs','package.json','package-lock.json','Start-Library.ps1','Start-Library.cmd','sources.example.json')){Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination $dest -Force}
 Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'web') -Destination $dest -Recurse -Force
}
$configPath=Join-Path $dest 'sources.local.json'
$config=if(Test-Path -LiteralPath $configPath){Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json}else{[pscustomobject]@{familyRoot=$FamilyRoot}}
$config.familyRoot=[IO.Path]::GetFullPath($FamilyRoot)
[IO.File]::WriteAllText($configPath,($config|ConvertTo-Json -Depth 10),[Text.UTF8Encoding]::new($false))
Push-Location $dest
try{
 if(!$SkipDependencies){& npm.cmd ci --ignore-scripts;if($LASTEXITCODE -ne 0){throw 'npm ci failed'}}
 & node.exe prepare-web.mjs;if($LASTEXITCODE -ne 0){throw 'Web preparation failed'}
 if($PreviewPack){
  $pack=[IO.Path]::GetFullPath($PreviewPack)
  if(!(Test-Path -LiteralPath (Join-Path $pack 'preview-pack.json'))){throw 'Not a preview pack'}
  & node.exe import-previews.mjs $pack;if($LASTEXITCODE -ne 0){throw 'Preview import failed'}
 }
 & node.exe build-catalog.mjs;if($LASTEXITCODE -ne 0){throw 'Catalog build failed'}
}finally{Pop-Location}
Write-Output "Local library configured at $dest. Restart its running server after changing paths."
