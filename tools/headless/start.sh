#!/bin/bash
# Start an isolated headless GNOME Shell with this extension and the driver.
# Each run gets runs/<timestamp>/; runs/current points at the active one.
# Usage: bash tools/headless/start.sh
set -e
HEADLESS_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HEADLESS_DIR/../.." && pwd)"
CURRENT="$HEADLESS_DIR/runs/current"

if [ -e "$CURRENT/shell.pid" ]; then
    echo "a run is already active — bash tools/headless/stop.sh first" >&2
    exit 1
fi
RUN_DIR="$HEADLESS_DIR/runs/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$RUN_DIR"/{config,data/gnome-shell/extensions,cache,state,shots}
ln -sfn "$RUN_DIR" "$CURRENT"

# Private runtime dir for the headless shell (mode 0700). Only the PipeWire sockets
# are linked in from the real one, which screenshots need; nothing else is shared.
REAL_RUNTIME="/run/user/$(id -u)"
RT="$(mktemp -d /tmp/bmc-rt-XXXXXX)"
echo "$RT" > "$RUN_DIR/runtime-dir"
ln -s "$RT" "$RUN_DIR/runtime"
for sock in pipewire-0 pipewire-0-manager; do
    [ -e "$REAL_RUNTIME/$sock" ] && ln -s "$REAL_RUNTIME/$sock" "$RT/$sock"
done

glib-compile-schemas "$REPO/schemas"
ln -s "$REPO" "$RUN_DIR/data/gnome-shell/extensions/better-media-controller@idogr"

# Local cover server (127.0.0.1, random port); stop.sh kills it by http.pid.
RUN_DIR="$RUN_DIR" setsid /usr/bin/python3 "$HEADLESS_DIR/http_server.py" > "$RUN_DIR/http.out" 2>&1 &
for _ in $(seq 50); do [ -s "$RUN_DIR/http.port" ] && break; sleep 0.1; done

# Real-session guard: record the real extension state now, compare in stop.sh.
bash "$HEADLESS_DIR/real-state.sh" > "$RUN_DIR/real-state.before"

(
    HEADLESS_ALLOW_NO_BUS=1 . "$HEADLESS_DIR/env.sh"
    unset DBUS_SESSION_BUS_ADDRESS
    setsid dbus-run-session -- bash "$HEADLESS_DIR/inner.sh" > "$RUN_DIR/shell.log" 2>&1 &
    echo $! > "$RUN_DIR/shell.pid"
)

# From here on, any failure tears down what was just started (via stop.sh).
trap 'rc=$?; if [ $rc -ne 0 ]; then echo "start failed; running stop.sh" >&2; bash "$HEADLESS_DIR/stop.sh" >&2; fi' EXIT

for _ in $(seq 100); do [ -s "$RUN_DIR/bus" ] && break; sleep 0.2; done
[ -s "$RUN_DIR/bus" ] || { echo "shell did not start; see $RUN_DIR/shell.log" >&2; exit 1; }
# Take the socket name from this run's own log: another headless shell may be
# running on the machine, so diffing the runtime dir could pick the wrong one.
for _ in $(seq 100); do
    sed -n "s/.*Using Wayland display name '\(wayland-[0-9]*\)'.*/\1/p" "$RUN_DIR/shell.log" | head -1 > "$RUN_DIR/wayland"
    [ -s "$RUN_DIR/wayland" ] && break
    sleep 0.2
done
[ -s "$RUN_DIR/wayland" ] || { echo "headless shell never reported its wayland socket; see $RUN_DIR/shell.log" >&2; exit 1; }

RUN_DIR="$RUN_DIR" setsid /usr/bin/python3 "$HEADLESS_DIR/driver.py" > "$RUN_DIR/driver.out" 2>&1 &
echo $! > "$RUN_DIR/driver.pid"

for _ in $(seq 100); do grep -q ' ready$' "$RUN_DIR/driver.log" 2>/dev/null && break; sleep 0.2; done
grep -q ' ready$' "$RUN_DIR/driver.log" || { echo "driver not ready; see $RUN_DIR/driver.{log,out}" >&2; exit 1; }
echo "headless shell ready: $RUN_DIR"
