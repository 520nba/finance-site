#!/bin/bash
set -e

# 1. Install nvm if not exists
if [ ! -d "$HOME/.nvm" ]; then
    echo "Installing NVM from local script..."
    bash nvm_install.sh
fi

# Load nvm
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# 2. Install Node.js v20
echo "Setting up Node.js v20..."
nvm install 20
nvm use 20

# 3. Clean environment
echo "Cleaning old build artifacts..."
rm -rf .next .open-next node_modules

# 4. Install dependencies for Linux
echo "Installing dependencies (Linux architecture)..."
npm install --no-audit --no-fund

# 5. Start preview
echo "Starting preview..."
npm run preview
