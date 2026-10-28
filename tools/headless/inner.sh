#!/bin/bash
# Runs inside dbus-run-session: record the private bus, seed the private dconf,
# then become the headless shell. Everything here sees only throwaway XDG dirs.
set -e
HEADLESS_ALLOW_NO_BUS=1 . "$(dirname "$0")/env.sh"
echo "$DBUS_SESSION_BUS_ADDRESS" > "$RUN_DIR/bus"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"

gsettings set org.gnome.shell disable-user-extensions false
gsettings set org.gnome.shell enabled-extensions "['better-media-controller@idogr']"
# Suppress the first-run "Welcome to Fedora" tour dialog: it is modal and swallows Escape.
gsettings set org.gnome.shell welcome-dialog-last-shown-version '999'
# Private dconf only; the extension's schemas dir is read, never written.
GSETTINGS_SCHEMA_DIR="$REPO/schemas" gsettings set org.gnome.shell.extensions.better-media-controller debug-stats true

exec gnome-shell --headless --wayland --virtual-monitor 1600x900
