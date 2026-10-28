#!/bin/bash
# Open the extension's preferences window inside the headless shell and record its
# pid in $RUN_DIR/prefs.pid (stop.sh kills it). Run from a clean shell.
# Usage: bash tools/headless/prefs.sh
. "$(dirname "$0")/env.sh" || exit 1
gnome-extensions prefs better-media-controller@idogr
# The prefs process belongs to this run's process group; the real session's has another.
for _ in $(seq 50); do
    pid=$(ps -eo pid=,pgid=,args= | awk -v g="$(cat "$RUN_DIR/shell.pid")" '$2 == g && /org.gnome.Shell.Extensions/ {print $1; exit}')
    [ -n "$pid" ] && break
    sleep 0.2
done
[ -n "$pid" ] && echo "$pid" > "$RUN_DIR/prefs.pid"
