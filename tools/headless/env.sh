# Source this to act on the headless shell instead of the real session:
# private bus, private dconf, private extension directory.
HEADLESS_DIR="$(cd "$(dirname "${BASH_SOURCE:-$0}")" && pwd)"
RUN_DIR="$HEADLESS_DIR/runs/current"
# Refuse when no run is active: otherwise the caller's real bus and Wayland socket
# stay in place and a following `gsettings set` would hit the real session.
# start.sh and inner.sh run before the bus is recorded, so they opt out.
if [ -z "$HEADLESS_ALLOW_NO_BUS" ] && { [ ! -f "$RUN_DIR/bus" ] || [ ! -e "$RUN_DIR/shell.pid" ]; }; then
    echo "env.sh: no active headless run (start tools/headless/start.sh first)" >&2
    # Fail closed: callers chain with `;`, so make any following gsettings or
    # gnome-extensions command error out instead of reaching the real session.
    # A bogus bus address (not unset) stops the fallback to $XDG_RUNTIME_DIR/bus,
    # and the non-existent runtime dir hides the real dconf.
    export DBUS_SESSION_BUS_ADDRESS="unix:path=$RUN_DIR/no-active-run"
    export XDG_RUNTIME_DIR="$RUN_DIR/no-active-run"
    export XDG_CONFIG_HOME="$RUN_DIR/no-active-run" XDG_DATA_HOME="$RUN_DIR/no-active-run"
    unset WAYLAND_DISPLAY DISPLAY
    return 1
fi
export RUN_DIR
export XDG_CONFIG_HOME="$RUN_DIR/config"
export XDG_DATA_HOME="$RUN_DIR/data"
export XDG_CACHE_HOME="$RUN_DIR/cache"
export XDG_STATE_HOME="$RUN_DIR/state"
if [ -f "$RUN_DIR/bus" ]; then
    DBUS_SESSION_BUS_ADDRESS="$(cat "$RUN_DIR/bus")"
    export DBUS_SESSION_BUS_ADDRESS
fi
# The headless shell's own Wayland socket, recorded by start.sh, so apps
# started from here open inside it rather than on the real desktop.
if [ -f "$RUN_DIR/wayland" ]; then
    WAYLAND_DISPLAY="$(cat "$RUN_DIR/wayland")"
    export WAYLAND_DISPLAY
    unset DISPLAY
fi
