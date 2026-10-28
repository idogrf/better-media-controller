#!/bin/bash
# Print the real session's extension state: enabled-extensions, and whether
# the real extension directory entry exists (with its target if a symlink).
# start.sh and stop.sh compare two runs of this.
gsettings get org.gnome.shell enabled-extensions
EXT="$HOME/.local/share/gnome-shell/extensions/better-media-controller@idogr"
if [ -L "$EXT" ]; then
    echo "symlink -> $(readlink "$EXT")"
elif [ -e "$EXT" ]; then
    echo "present"
else
    echo "absent"
fi
