<#
.SYNOPSIS
    Install the Vox voice extension from a local checkout into Copilot CLI.

.DESCRIPTION
    Run from a cloned copy of the repo. Copies Vox's extension files to the
    Copilot CLI extensions directory (~/.copilot/extensions/vox) where the CLI
    auto-discovers it. Then run `/vox` in any session to talk hands-free.

    For a one-line install without a manual clone, use install.ps1 instead:
        irm https://raw.githubusercontent.com/aasis21/vox/main/install.ps1 | iex

.PARAMETER ExtensionsDir
    Copilot CLI extensions root. Default: ~/.copilot/extensions

.PARAMETER InstallChatterbox
    Create the local Chatterbox Nano Python environment and install its pinned
    package from Microsoft's internal Python package proxy.

.PARAMETER ChatterboxReferenceWav
    Path to a user-supplied WAV that the user is authorized to clone. The file
    is copied to ~/.copilot/vox-chatterbox/voices/authorized-reference.wav and
    is never copied into the extension or repository.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\setup.ps1
#>
[CmdletBinding()]
param(
    [string]$ExtensionsDir = (Join-Path $env:USERPROFILE '.copilot\extensions'),
    [switch]$InstallChatterbox,
    [Alias('ReferenceAudio')]
    [string]$ChatterboxReferenceWav
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "== Vox installer ==" -ForegroundColor Cyan

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Warning "node was not found on PATH. Vox needs Node.js to run; install it from https://nodejs.org."
}

$dest = Join-Path $ExtensionsDir 'vox'
New-Item -ItemType Directory -Force -Path $dest | Out-Null

# Wipe stale runtime registry so sessions re-register cleanly.
$staleReg = Join-Path $dest 'registry.json'
if (Test-Path $staleReg) { Remove-Item -Force $staleReg }

Copy-Item -Path (Join-Path $here '*.mjs') -Destination $dest -Force
Write-Host "Copied   : *.mjs -> $dest"
Copy-Item -Path (Join-Path $here 'chatterbox-sidecar.py') -Destination $dest -Force
Write-Host "Copied   : chatterbox-sidecar.py -> $dest"
Copy-Item -Path (Join-Path $here 'THIRD-PARTY-NOTICES.md') -Destination $dest -Force
Copy-Item -Path (Join-Path $here 'LICENSES') -Destination $dest -Recurse -Force
Write-Host "Copied   : third-party notices -> $dest"

if ($InstallChatterbox -or $ChatterboxReferenceWav) {
    if (-not $ChatterboxReferenceWav) {
        throw '-ChatterboxReferenceWav is required when -InstallChatterbox is used.'
    }

    $sourceReference = (Resolve-Path -LiteralPath $ChatterboxReferenceWav).Path
    if ([IO.Path]::GetExtension($sourceReference) -ne '.wav') {
        throw 'The Chatterbox reference must be a WAV file.'
    }

    $chatterboxRoot = Join-Path $env:USERPROFILE '.copilot\vox-chatterbox'
    $voicesDir = Join-Path $chatterboxRoot 'voices'
    $cacheDir = Join-Path $chatterboxRoot 'cache'
    $venvDir = Join-Path $chatterboxRoot '.venv'
    $referenceDest = Join-Path $voicesDir 'authorized-reference.wav'
    $pythonExe = Join-Path $venvDir 'Scripts\python.exe'
    New-Item -ItemType Directory -Force -Path $voicesDir, $cacheDir | Out-Null
    Copy-Item -LiteralPath $sourceReference -Destination $referenceDest -Force
    Write-Host "Copied   : authorized local reference -> $referenceDest"

    if ($InstallChatterbox) {
        $basePython = Get-Command python -ErrorAction SilentlyContinue
        if (-not $basePython) {
            throw 'Python was not found on PATH. Python 3.11 is recommended for Chatterbox Nano.'
        }
        if (-not (Test-Path -LiteralPath $pythonExe)) {
            & $basePython.Source -m venv $venvDir
            if ($LASTEXITCODE -ne 0) { throw 'Failed to create the Chatterbox virtual environment.' }
        }
        & $pythonExe -m pip install --disable-pip-version-check `
            --index-url 'https://packagefeedproxy.microsoft.io/pypi/simple/' `
            'chatterbox-tts==0.1.7'
        if ($LASTEXITCODE -ne 0) {
            throw 'Chatterbox dependency installation failed through the approved Microsoft package proxy.'
        }
    }

    $config = [ordered]@{
        version       = 1
        referencePath = $referenceDest
        cachePath     = $cacheDir
        pythonPath    = $pythonExe
        cpuThreads    = [Math]::Min([Math]::Max([Environment]::ProcessorCount / 2, 1), 8)
    }
    $config | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $chatterboxRoot 'config.json') -Encoding utf8
    Write-Host "Configured: Chatterbox Nano local CPU sidecar"
}

Write-Host "`n== Done ==" -ForegroundColor Green
Write-Host "Start a Copilot session and run:" -ForegroundColor Cyan
Write-Host "    /vox        # start voice mode (open http://localhost:4321)"
Write-Host "    /vox-stop   # stop for this session"
Write-Host "    /vox-who    # list live Vox sessions"
