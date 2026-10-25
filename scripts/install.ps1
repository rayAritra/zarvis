# Installs Zarvis: irm https://raw.githubusercontent.com/rayAritra/zarvis/main/scripts/install.ps1 | iex
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Host "Zarvis needs Node.js 22 or newer: https://nodejs.org"; return }
if ([int](node -p "process.versions.node.split('.')[0]") -lt 22) { Write-Host "Node 22 or newer is required (you have $(node -v))."; return }
npm install -g github:rayAritra/zarvis
Write-Host "Done. Run: zarvis"
