#!/bin/bash
# Queue driver commands and wait for each to be logged as done.
# Exits 1 if the driver logs an error for a command or it times out (10 s).
# Usage: tools/headless/send.sh 'key ff56 ffeb' 'shot /abs/a.png'
RUN_DIR="$(cd "$(dirname "$0")" && pwd)/runs/current"
count() { grep -c " $1 " "$RUN_DIR/driver.log" 2>/dev/null || true; }
for cmd in "$@"; do
    done_before=$(count done); done_before=${done_before:-0}
    err_before=$(count error); err_before=${err_before:-0}
    echo "$cmd" >> "$RUN_DIR/cmds"
    finished=
    for _ in $(seq 500); do
        d=$(count done); e=$(count error)
        if [ "${d:-0}" -gt "$done_before" ] || [ "${e:-0}" -gt "$err_before" ]; then
            finished=1
            break
        fi
        sleep 0.02
    done
    [ -n "$finished" ] || { echo "send.sh: timed out waiting for: $cmd" >&2; exit 1; }
    [ "${e:-0}" -gt "$err_before" ] && { echo "send.sh: driver reported an error for: $cmd" >&2; exit 1; }
done
exit 0
