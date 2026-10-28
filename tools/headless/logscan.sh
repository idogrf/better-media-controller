#!/bin/bash
# Scan a shell log: print EXTENSION, ERRORS and OTHER sections.
# Exit 1 iff an EXTENSION line, or an ERRORS line mentioning the extension path, exists.
# Usage: bash tools/headless/logscan.sh <shell.log>
LOG="$1"
[ -f "$LOG" ] || { echo "usage: logscan.sh <shell.log>" >&2; exit 2; }
EXT='better-media-controller@idogr|better_media_controller|better-media-controller_idogr'
PAT='JS ERROR|JS WARNING|Gjs-CRITICAL|Gjs-WARNING|already disposed|TypeError|Stack trace|Error'
ext=$(grep -E -- "$EXT" "$LOG" | grep -v '\[bmc-debug\] ')
err=$(grep -E -- "$PAT" "$LOG")
other=$(grep -v -E -- "$PAT" "$LOG" | grep -v -E -- "$EXT")
echo "== EXTENSION"; [ -n "$ext" ] && echo "$ext"
echo "== ERRORS"; [ -n "$err" ] && echo "$err"
echo "== OTHER"; [ -n "$other" ] && echo "$other"
[ -n "$ext" ] && exit 1
echo "$err" | grep -q -E -- "$EXT" && exit 1
exit 0
