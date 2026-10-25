#!/bin/sh
# Installs Zarvis: curl -fsSL https://raw.githubusercontent.com/rayAritra/zarvis/main/scripts/install.sh | sh
set -e
command -v node >/dev/null 2>&1 || { echo "Zarvis needs Node.js 22 or newer: https://nodejs.org"; exit 1; }
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ] || { echo "Node 22 or newer is required (you have $(node -v))."; exit 1; }
npm install -g github:rayAritra/zarvis
echo "Done. Run: zarvis"
