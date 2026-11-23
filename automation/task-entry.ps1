param([Parameter(Mandatory=$true)][string]$NodePath,[Parameter(Mandatory=$true)][string]$CollectorHome)
$ErrorActionPreference = 'Stop'
# Hidden task, same signed-in Windows user: Credential Manager never needs a CLI PIN.
& $NodePath (Join-Path $PSScriptRoot 'cli.mjs') run --home $CollectorHome
exit $LASTEXITCODE
