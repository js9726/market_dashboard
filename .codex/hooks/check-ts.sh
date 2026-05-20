#!/usr/bin/env bash
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APP_DIR="$REPO_ROOT/apps/market_dashboard"
cd "$APP_DIR" || { echo "ERROR: Could not cd to $APP_DIR"; exit 1; }
echo "--- tsc --noEmit ---"
npx tsc --noEmit
