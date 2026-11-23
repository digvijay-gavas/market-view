param([Parameter(Mandatory=$true)][string]$NodePath,[Parameter(Mandatory=$true)][string]$CollectorHome)
$ErrorActionPreference = 'Stop'
# Hidden task, same signed-in Windows user: Credential Manager never needs a CLI PIN.
& $NodePath --input-type=module -e "import(process.argv[1]).then(m=>m.ensureBridge(process.argv[2]))" ([uri](Join-Path $PSScriptRoot 'bridge-start.mjs')).AbsoluteUri $CollectorHome
& $NodePath (Join-Path $PSScriptRoot 'cli.mjs') run --home $CollectorHome
exit $LASTEXITCODE
