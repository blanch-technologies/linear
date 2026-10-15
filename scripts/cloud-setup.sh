#!/usr/bin/env bash
# Setup for cloud agent sandboxes (Claude Code on the web, CI-like environments).
# Installs the pinned Node and pnpm and the dependencies. No secrets needed for
# typecheck, lint, and tests.
set -euo pipefail

want="$(cat .nvmrc)"
if ! node --version 2>/dev/null | grep -q "^v${want}\."; then
  if [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
    # shellcheck disable=SC1091
    . "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  else
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
    # shellcheck disable=SC1091
    . "$HOME/.nvm/nvm.sh"
  fi
  nvm install "$want"
  nvm use "$want"
fi

corepack enable
corepack prepare "$(node -p "require('./package.json').packageManager")" --activate
pnpm install --frozen-lockfile
echo "Ready: run pnpm typecheck, pnpm lint, pnpm test."
