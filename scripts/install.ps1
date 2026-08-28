# Installs Blab from the latest release. The Windows half of install.sh, and it
# does the same thing in the same order:
#
#   irm https://raw.githubusercontent.com/jurecerkez-code/Blab/main/scripts/install.ps1 | iex
#
# This script is the only part of Blab that ever uses the network, and it uses
# it once. What it installs never touches the network again.
$ErrorActionPreference = 'Stop'

$repo = 'jurecerkez-code/Blab'

Write-Host 'Looking up the latest release...'
$release = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest"
$asset = $release.assets | Where-Object { $_.name -like '*.exe' } | Select-Object -First 1
if (-not $asset) { throw 'The latest release has no Windows installer yet.' }

# The temp folder rather than Downloads: this file is scaffolding, and leaving
# it behind in a folder someone actually looks at is litter.
$file = Join-Path $env:TEMP $asset.name
try {
  Write-Host "Downloading $($asset.name)..."
  # Without this the progress bar makes Invoke-WebRequest an order of magnitude
  # slower on a large file, which this is.
  $previous = $ProgressPreference
  $ProgressPreference = 'SilentlyContinue'
  try {
    Invoke-WebRequest $asset.browser_download_url -OutFile $file
  } finally {
    $ProgressPreference = $previous
  }

  Write-Host 'Running the installer...'
  # Blab installs for one user and asks for no administrator rights, so this
  # neither elevates nor prompts.
  Start-Process -FilePath $file -Wait

  Write-Host ''
  Write-Host 'Blab is installed. It is in your Start menu.'
} finally {
  Remove-Item $file -Force -ErrorAction SilentlyContinue
}
