#!/bin/sh
# Build the installable zip in dist/: runtime files only, no tests or tools.
set -e
cd "$(dirname "$0")"
mkdir -p dist
gnome-extensions pack --force --out-dir=dist \
    --extra-source=track.js \
    --extra-source=label.js \
    --extra-source=players.js \
    --extra-source=colors.js \
    --extra-source=wavemath.js \
    --extra-source=mpris.js \
    --extra-source=wave.js \
    --extra-source=covers.js \
    --extra-source=indicator.js \
    --extra-source=popup.js \
    --extra-source=gnomeplayer.js \
    --extra-source=LICENSE \
    .
echo "dist/better-media-controller@idogr.shell-extension.zip"
