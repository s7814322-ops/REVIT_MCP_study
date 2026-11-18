#Requires -Version 5.1
# Dot-sourced by Update-Abby.ps1. Program allowlist deliberately excludes user data.
function Install-AbbyLibraryProgram([string]$Program,[string]$Destination,[string]$Node){
 $Program=[IO.Path]::GetFullPath($Program);$Destination=[IO.Path]::GetFullPath($Destination).TrimEnd('\')
 $descriptor=Join-Path $Program 'program-manifest.json'
 if(!(Test-Path -LiteralPath $descriptor)){return}
 $allowed=@('sources.mjs','source-files.mjs','cfb.mjs','version-policy.mjs','server.mjs','settings.mjs','preview-sync.mjs','maintenance.mjs','maintenance-cli.mjs','build-catalog.mjs','portable-previews.mjs','import-previews.mjs','Start-Library.ps1','Start-Library.cmd','dist/index.html','dist/app.js','dist/settings.js','dist/styles.css','dist/viewer3d.js','dist/vendor/three/three.module.js','dist/vendor/three/three.core.js','dist/vendor/three/OrbitControls.js','dist/vendor/three/LICENSE')
 $manifest=Read-AbbyJson $descriptor
 if($manifest.schema -ne 1 -or $manifest.revision -notmatch '^[a-f0-9]{64}$'){throw 'Invalid library manifest'}
 $seen=@{};$ops=@()
 foreach($file in $manifest.files){
  if($file.path -cnotin $allowed -or $seen.ContainsKey($file.path.ToLowerInvariant()) -or $file.sha256 -notmatch '^[a-f0-9]{64}$'){throw 'Unsafe library program entry'}
  $seen[$file.path.ToLowerInvariant()]=$true
  $source=Get-AbbyChild $Program $file.path;$target=Get-AbbyChild $Destination $file.path
  foreach($candidate in @($source,$target)){
   $cursor=$candidate
   while($cursor){$pathItem=Get-Item -LiteralPath $cursor -Force -ErrorAction SilentlyContinue;if($pathItem -and ($pathItem.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Library program paths cannot contain links/junctions'};$cursor=Split-Path -Parent $cursor}
  }
  if(!(Test-Path -LiteralPath $source -PathType Leaf) -or (Get-FileHash -LiteralPath $source).Hash -ne $file.sha256){throw 'Library program checksum mismatch'}
  $ops+=@{Source=$source;Target=$target;Hash=$file.sha256}
 }
 if($seen.Count -ne $allowed.Count){throw 'Library package is incomplete'}
 $valid=$true
 foreach($op in $ops){if(!(Test-Path -LiteralPath $op.Target) -or (Get-FileHash -LiteralPath $op.Target).Hash -ne $op.Hash){$valid=$false}}
 $marker=Join-Path $Destination '.program-version'
 $markerItem=Get-Item -LiteralPath $marker -Force -ErrorAction SilentlyContinue
 if($markerItem -and ($markerItem.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Library marker cannot be a link'}
 $managed=Join-Path $Destination '.program-managed'
 $managedItem=Get-Item -LiteralPath $managed -Force -ErrorAction SilentlyContinue
 if($managedItem -and ($managedItem.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Library management marker cannot be a link'}
 if($valid -and (Test-Path -LiteralPath $marker) -and [IO.File]::ReadAllText($marker).Trim() -eq $manifest.revision){if(!(Test-Path -LiteralPath $managed)){[IO.File]::WriteAllText($managed,$manifest.revision)};Write-Host 'Library program is current.';return}
 $serverPath=Join-Path $Destination 'server.mjs';$wasRunning=$false
 foreach($process in @(Get-CimInstance Win32_Process -Filter "Name='node.exe'")){
  if($process.CommandLine -and $process.CommandLine.IndexOf(('"'+$serverPath+'"'),[StringComparison]::OrdinalIgnoreCase) -ge 0){$wasRunning=$true;Stop-Process -Id $process.ProcessId -ErrorAction Stop}
 }
 $backup=Join-Path (Split-Path -Parent $Destination) ('backups\library-'+(Get-Date -Format yyyyMMdd-HHmmss)+'-'+[guid]::NewGuid().ToString('N').Substring(0,8))
 $null=New-Item -ItemType Directory -Path $backup -Force
 $ops+=@{Source=$descriptor;Target=(Join-Path $Destination 'program-manifest.json');Hash=(Get-FileHash -LiteralPath $descriptor).Hash}
 $done=@();$markerBytes=if(Test-Path -LiteralPath $marker){[IO.File]::ReadAllBytes($marker)}else{$null};$managedBytes=if(Test-Path -LiteralPath $managed){[IO.File]::ReadAllBytes($managed)}else{$null}
 try{
  foreach($op in $ops){
   $relative=$op.Target.Substring($Destination.TrimEnd('\').Length+1);$op.Backup=Get-AbbyChild $backup $relative;$op.Existed=Test-Path -LiteralPath $op.Target
   if($op.Existed){$null=New-Item -ItemType Directory -Path (Split-Path -Parent $op.Backup) -Force;Copy-Item -LiteralPath $op.Target -Destination $op.Backup}
   $done+=$op;$null=New-Item -ItemType Directory -Path (Split-Path -Parent $op.Target) -Force
   Copy-Item -LiteralPath $op.Source -Destination $op.Target -Force
   if((Get-FileHash -LiteralPath $op.Target).Hash -ne $op.Hash){throw 'Installed library checksum mismatch'}
  }
  [IO.File]::WriteAllText($marker,$manifest.revision)
  [IO.File]::WriteAllText($managed,$manifest.revision)
  if((Test-Path -LiteralPath (Join-Path $Destination 'sources.local.json')) -and (Test-Path -LiteralPath (Join-Path $Destination 'maintenance-cli.mjs'))){
   & $Node (Join-Path $Destination 'maintenance-cli.mjs') cleanup-temp --apply
   if($LASTEXITCODE -ne 0){Write-Warning 'Temporary cleanup skipped; library program remains installed.'}
  }
  if($wasRunning){& (Join-Path $Destination 'Start-Library.ps1') -NoBrowser}
  Write-Host ('Library updated: '+$manifest.revision)
 }catch{
  foreach($op in $done){if($op.Existed){Copy-Item -LiteralPath $op.Backup -Destination $op.Target -Force}else{Remove-Item -LiteralPath $op.Target -Force -ErrorAction SilentlyContinue}}
  if($null -ne $markerBytes){[IO.File]::WriteAllBytes($marker,$markerBytes)}elseif(Test-Path -LiteralPath $marker){Remove-Item -LiteralPath $marker -Force}
  if($null -ne $managedBytes){[IO.File]::WriteAllBytes($managed,$managedBytes)}elseif(Test-Path -LiteralPath $managed){Remove-Item -LiteralPath $managed -Force}
  if($wasRunning){& (Join-Path $Destination 'Start-Library.ps1') -NoBrowser}
  throw
 }
}
function Test-AbbyLocalRuntimeChanges([string]$Root){
 $statePath=Join-Path $Root 'current.json';if(!(Test-Path -LiteralPath $statePath)){return $false}
 $state=Read-AbbyJson $statePath;$runtime=Get-AbbyChild (Join-Path $Root 'releases') $state.Version
 $manifestPath=Join-Path $runtime 'manifest.json'
 if(!(Test-Path -LiteralPath $manifestPath)){return $true}
 $manifest=Read-AbbyJson $manifestPath
 foreach($file in $manifest.Files){
  $target=$null
  if($file.Path -match '^addin/(2024|2025|2026)/(.+)$'){$target=Join-Path $env:APPDATA ('Autodesk\Revit\Addins\'+$Matches[1]+'\RevitMCP\'+$Matches[2])}
  elseif($file.Path -like 'server/build/*'){$target=Get-AbbyChild $runtime $file.Path}
  if($target -and (Test-Path -LiteralPath $target) -and (Get-FileHash -LiteralPath $target).Hash -ne $file.Sha256){return $true}
 }
 return $false
}
