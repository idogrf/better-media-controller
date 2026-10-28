#!/bin/bash
# Put 8 cover images in $RUN_DIR/covers/ (cover-1..8.jpg, the names the playlists use).
# Copies size-spread covers from ~/.cache/mpris-covers (override: FIXTURES_COVER_SRC)
# when it has 8+ files, else generates solid and gradient images. The generated ones
# are PNG data under .jpg names; loaders sniff content. Needs an active run.
# Usage: bash tools/headless/fixtures.sh
. "$(dirname "$0")/env.sh" || exit 1
mkdir -p "$RUN_DIR/covers"
SRC="${FIXTURES_COVER_SRC:-$HOME/.cache/mpris-covers}"
FILES="$(find "$SRC" -maxdepth 1 -type f -printf '%s %p\n' 2>/dev/null | sort -rn | cut -d' ' -f2-)"
total=$(printf '%s\n' "$FILES" | grep -c .)
if [ "$total" -ge 8 ]; then
    for n in $(seq 0 7); do
        i=$((n * (total - 1) / 7 + 1))
        cp "$(printf '%s\n' "$FILES" | sed -n "${i}p")" "$RUN_DIR/covers/cover-$((n + 1)).jpg"
    done
else
    /usr/bin/python3 - "$RUN_DIR/covers" <<'PY'
import struct, sys, zlib

def png(path, w, h, px):
    raw = b"".join(b"\0" + b"".join(bytes(px(x, y)) for x in range(w)) for y in range(h))
    def chunk(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
                + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))

solids = [(47, 143, 138), (200, 60, 60), (230, 180, 50), (90, 70, 160)]
grads = [(255, 122, 182), (79, 179, 245), (60, 200, 120), (240, 140, 60)]
for i, c in enumerate(solids):
    png(f"{sys.argv[1]}/cover-{i + 1}.jpg", 160, 160, lambda x, y, c=c: c)
for i, c in enumerate(grads):
    png(f"{sys.argv[1]}/cover-{i + 5}.jpg", 160, 160,
        lambda x, y, c=c: (c[0] * x // 160, c[1] * (160 - y) // 160, c[2]))
PY
fi
ls "$RUN_DIR/covers"
