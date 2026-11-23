$ErrorActionPreference = 'Stop'
try {
    $repoPath = Split-Path -Parent $PSScriptRoot
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    $nodePath = if ($nodeCommand) { $nodeCommand.Source } else { Join-Path $env:ProgramFiles 'nodejs\node.exe' }
    if (-not (Test-Path -LiteralPath $nodePath)) { throw 'Install Node.js 22 or newer, then open Collector Admin again.' }
    if (-not (Test-Path -LiteralPath (Join-Path $repoPath 'node_modules\playwright'))) {
        throw 'The collector needs its dependencies installed once. Run npm ci in the market-view folder, then reopen Collector Admin.'
    }
    $adminProcess = Start-Process -FilePath $nodePath -ArgumentList @(('"' + (Join-Path $PSScriptRoot 'admin.mjs') + '"')) -WorkingDirectory $repoPath -WindowStyle Hidden -PassThru
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        try {
            $response = Invoke-WebRequest -Uri 'http://127.0.0.1:5186/' -UseBasicParsing -TimeoutSec 1
            if ($response.Content -like '*Collector Admin*') { exit 0 }
        } catch { }
        if ($adminProcess.HasExited -and $adminProcess.ExitCode -ne 0) { throw 'Collector Admin could not start. Another application may be using local port 5186.' }
        Start-Sleep -Milliseconds 300
    }
    throw 'Collector Admin is taking longer than expected to start. Try opening it again.'
} catch {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show($_.Exception.Message, 'Collector Admin') | Out-Null
}
