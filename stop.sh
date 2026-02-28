#!/usr/bin/env bash
cd "$(dirname "$0")"
if [ -f bridge.pid ]; then
    kill $(cat bridge.pid) 2>/dev/null && echo "Stopped" || echo "Already stopped"
    rm -f bridge.pid
else
    echo "Not running"
fi
