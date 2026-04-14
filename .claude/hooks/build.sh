#!/usr/bin/env bash
APP_DIR="/c/Users/jiesh/AI codes hub/market_dashboard/apps/market_dashboard"
cd "$APP_DIR" || { echo "ERROR: Could not cd to $APP_DIR"; exit 1; }

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | grep -o '"file_path":"[^"]*"' | head -1 | sed 's/"file_path":"//;s/"//')

if [ -n "$FILE_PATH" ]; then
  if echo "$FILE_PATH" | grep -qE '(agents/|scripts/|\.md$|\.json$|\.sh$|tailwind\.config|postcss\.config)'; then
    echo "--- build: skipped (non-route file: $FILE_PATH) ---"
    exit 0
  fi
fi

echo "--- npm run build ---"
npm run build
