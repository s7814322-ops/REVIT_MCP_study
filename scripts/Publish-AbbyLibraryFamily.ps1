[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$SourceFile,
    [Parameter(Mandatory)][string]$LibraryFolder,
    [switch]$Replace
)

. (Join-Path $PSScriptRoot 'abby/LibraryUpdate.ps1')
Publish-AbbyLibraryFamily @PSBoundParameters
