#Requires -Version 5.1
[CmdletBinding()]
param([string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'AbbyMCP'), [string]$ReleaseVersion = '')
$ErrorActionPreference = 'Stop'
$report = [ordered]@{
    Computer = $env:COMPUTERNAME
    CheckedUtc = [DateTime]::UtcNow.ToString('o')
    Release = $ReleaseVersion
    Status = 'Failed'
    OfficialHashMatches = $false
    BackupBlocked = $false
    PublishedFiles = 0
}
$work = Join-Path ([IO.Path]::GetTempPath()) ('AbbyPublishTest-' + [guid]::NewGuid().ToString('N'))
$dest = Join-Path $work 'library'
$copy = Join-Path $work 'sample.0001.rfa'
$published = Join-Path $dest 'sample.rfa'
try {
    $helper = Join-Path $InstallRoot 'LibraryUpdate.ps1'
    . $helper
    $report.HelperSha256 = (Get-FileHash -LiteralPath $helper).Hash
    $catalogPath = Join-Path $InstallRoot 'door-library/dist/catalog.json'
    $catalog = Get-Content -LiteralPath $catalogPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $item = $catalog.items | Where-Object {
        !$_.backup -and $_.path -match '\.rfa$' -and $_.path -notmatch '\.\d{4}\.rfa$' -and
        (Test-Path -LiteralPath $_.path -PathType Leaf)
    } | Sort-Object @{Expression={if ($_.id -eq '328cfb326c64ecff') {0} else {1}}},bytes | Select-Object -First 1
    if (!$item) { throw 'No readable formal RFA in the local catalog.' }
    $null = New-Item -ItemType Directory -Path $dest -Force
    $sample = Join-Path $work 'sample.rfa'
    [IO.File]::Copy($item.path, $sample)
    Publish-AbbyLibraryFamily -SourceFile $sample -LibraryFolder $dest | Out-Null
    $report.OfficialHashMatches = (Get-FileHash -LiteralPath $sample).Hash -eq (Get-FileHash -LiteralPath $published).Hash
    [IO.File]::Copy($sample, $copy)
    try { Publish-AbbyLibraryFamily -SourceFile $copy -LibraryFolder $dest | Out-Null }
    catch { if ($_.Exception.Message -notlike '*backup sequence number*') { throw }; $report.BackupBlocked = $true }
    $report.PublishedFiles = @(Get-ChildItem -LiteralPath $dest -Force).Count
    if (!$report.OfficialHashMatches -or !$report.BackupBlocked -or $report.PublishedFiles -ne 1) { throw 'Unexpected family publish result.' }
    $report.Status = 'Passed'
} catch {
    $report.Error = $_.Exception.Message
} finally {
    foreach ($file in @($published, $copy, (Join-Path $dest 'sample.0001.rfa'), (Join-Path $work 'sample.rfa'))) {
        if ([IO.File]::Exists($file)) { [IO.File]::Delete($file) }
    }
    foreach ($folder in @($dest,$work)) { if ([IO.Directory]::Exists($folder)) { [IO.Directory]::Delete($folder) } }
    $reportFile = Join-Path $InstallRoot 'family-publish-verification.json'
    $tempReport = $reportFile + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
    [IO.File]::WriteAllText($tempReport, ($report | ConvertTo-Json))
    if ([IO.File]::Exists($reportFile)) { [IO.File]::Replace($tempReport, $reportFile, [System.Management.Automation.Language.NullString]::Value) }
    else { [IO.File]::Move($tempReport, $reportFile) }
}
if ($report.Status -ne 'Passed') { throw $report.Error }
[pscustomobject]$report
