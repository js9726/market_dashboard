#!/usr/bin/env bash
# Manual integration test — requires dev server on localhost:3000
# Run: bash ".claude/hooks/test-analysis.sh"
APP_DIR="/c/Users/jiesh/AI codes hub/market_dashboard/apps/market_dashboard"
cd "$APP_DIR" || { echo "ERROR: Could not cd to $APP_DIR"; exit 1; }
echo "--- node scripts/test-analysis.mjs ---"
echo "NOTE: Requires: npm run dev (in a separate terminal)"
node scripts/test-analysis.mjs
