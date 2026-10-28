#!/bin/sh
# Run every unit test with plain gjs; non-zero exit if any fails.
set -e
cd "$(dirname "$0")"
for t in *.test.js; do
    echo "== $t"
    gjs -m "$t"
done
