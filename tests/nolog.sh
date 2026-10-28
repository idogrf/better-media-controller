#!/bin/sh
# Static check: runtime .js files at the repo root must not log directly. All
# output goes through debugLog in track.js (the one console.log with the
# [bmc-debug] prefix), so a silent run stays silent.
cd "$(dirname "$0")/.."
bad=$(grep -nE 'console\.(log|warn|error|debug|info)|(^|[^A-Za-z0-9_.])(log|logError|print|printerr)\(' ./*.js \
    | grep -v 'console\.log(`\[bmc-debug\] ')
if [ -n "$bad" ]; then
    echo "FAIL nolog: direct logging in runtime files:"
    echo "$bad"
    exit 1
fi
echo "ok   nolog: no direct logging in runtime files"
