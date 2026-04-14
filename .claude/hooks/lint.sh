#!/usr/bin/env bash
APP_DIR="/c/Users/jiesh/AI codes hub/market_dashboard/apps/market_dashboard"
cd "$APP_DIR" || { echo "ERROR: Could not cd to $APP_DIR"; exit 1; }
echo "--- npm run lint ---"
npm run lint
