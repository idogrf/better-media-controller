#!/bin/bash
# Wait up to 10 s for a name to appear on the private bus (e.g. a fake player's
# org.mpris.MediaPlayer2.spotify). Commands sent to a player before this returns
# are dropped. Exits 1 on timeout.
# Usage: bash tools/headless/wait-name.sh <bus-name>
. "$(dirname "$0")/env.sh" || exit 1
for _ in $(seq 100); do
    gdbus call --session --dest org.freedesktop.DBus --object-path /org/freedesktop/DBus \
        --method org.freedesktop.DBus.NameHasOwner "$1" 2>/dev/null | grep -q true && exit 0
    sleep 0.1
done
echo "wait-name.sh: $1 did not appear" >&2
exit 1
