#!/usr/bin/env bash
# Start the DeepSeek Harness Web UI (http://127.0.0.1:3080).
# Installs dependencies if missing, rebuilds artifacts, then starts the app.
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "error: pnpm is required. Install it with: corepack enable" >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "[start.sh] Installing dependencies..."
  pnpm install
fi

echo "[start.sh] Building artifacts..."
pnpm run build

exec pnpm dsh web "$@"
