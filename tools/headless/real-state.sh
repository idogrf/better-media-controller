#!/bin/bash
# Print the real session's extension state: enabled-extensions, and whether
# the real extension directory entry exists (with its target if a symlink).
# start.sh and stop.sh compare two runs of this.
# With env.sh sourced, gsettings would read the private dconf and the guard would
# compare the wrong thing. Refuse instead of reporting a misleading state.
case "$DBUS_SESSION_BUS_ADDRESS$XDG_CONFIG_HOME" in
    */tools/headless/runs/*) echo "real-state.sh: env.sh is sourced in this shell; use a clean shell" >&2; exit 2 ;;
esac
gsettings get org.gnome.shell enabled-extensions
EXT="$HOME/.local/share/gnome-shell/extensions/better-media-controller@idogr"
if [ -L "$EXT" ]; then
    echo "symlink -> $(readlink "$EXT")"
elif [ -e "$EXT" ]; then
    echo "present"
else
    echo "absent"
fi
