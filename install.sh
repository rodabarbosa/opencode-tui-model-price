#!/usr/bin/env bash
# Installs the opencode-model-pricing plugin via the OpenCode CLI.
# Usage: ./install.sh [package]
#   package  npm registry or Git package specifier (default: rodabarbosa/opencode-tui-model-price)

set -euo pipefail

PACKAGE="${1:-rodabarbosa/opencode-tui-model-price}"

if [ -z "$PACKAGE" ]; then
  echo "Error: plugin package specifier is required." >&2
  exit 1
fi

echo "Installing OpenCode plugin: ${PACKAGE}"

opencode plugin add "${PACKAGE}"

echo "Plugin installed and registered successfully!"
echo "Restart the OpenCode server or run /reload inside OpenCode to activate it."
