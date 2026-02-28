#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
export BRIDGE_ADMIN_SECRET="${BRIDGE_ADMIN_SECRET:-$(cat admin_secret.txt 2>/dev/null || echo 'changeme')}"
pip install -q -r requirements.txt
nohup uvicorn main:app --host 0.0.0.0 --port 8765 > bridge.log 2>&1 &
echo $! > bridge.pid
echo "Agent Bridge started on port 8765 (PID $(cat bridge.pid))"
