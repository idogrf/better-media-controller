#!/bin/bash
# End-to-end headless suite: start the isolated shell, run fake players, take every
# screenshot, run the lifecycle checks, scan the log, stop, and write
# $RUN_DIR/report.md. Exits non-zero if any check fails.
# Run from a clean shell (not one that sourced env.sh):  bash tools/headless/suite.sh
HEADLESS_DIR="$(cd "$(dirname "$0")" && pwd)"
case "$DBUS_SESSION_BUS_ADDRESS$XDG_CONFIG_HOME" in
    */tools/headless/runs/*) echo "suite.sh: run from a clean shell (env.sh is sourced here)" >&2; exit 2 ;;
esac
if [ -e "$HEADLESS_DIR/runs/current/shell.pid" ]; then
    echo "suite.sh: a run is already active; stop it first" >&2
    exit 2
fi

bash "$HEADLESS_DIR/start.sh" || exit 1
RUN_DIR="$(readlink -f "$HEADLESS_DIR/runs/current")"
SHOTS="$RUN_DIR/shots"
: > "$RUN_DIR/results.tsv"
: > "$RUN_DIR/shots.list"
trap 'bash "$HEADLESS_DIR/stop.sh" >/dev/null 2>&1' EXIT

# Everything that talks to the headless shell runs with env.sh sourced, in a subshell.
body() {
    . "$HEADLESS_DIR/env.sh" || exit 1
    export GSETTINGS_SCHEMA_DIR="$HEADLESS_DIR/../../schemas"
    local B=org.gnome.shell.extensions.better-media-controller
    local UUID=better-media-controller@idogr
    local LOG="$RUN_DIR/shell.log"

    res() { printf '%s\t%s\t%s\n' "$1" "$2" "$3" >> "$RUN_DIR/results.tsv"; }
    shot() { bash "$HEADLESS_DIR/send.sh" "shot $SHOTS/$1.png" && echo "$1.png" >> "$RUN_DIR/shots.list"; }
    cmd() { echo "$2" >> "$RUN_DIR/mpris-$1.cmd"; }
    count() { grep -c -- "$1" "$LOG"; }
    # Clicks the pill and requires a toggle-popup line afterwards; records a FAIL otherwise.
    click_pill() {
        local t=$(count 'toggle-popup')
        bash "$HEADLESS_DIR/send.sh" "click 710 16"
        wait_count 'toggle-popup' "$t" && return 0
        res "click pill" FAIL "no toggle-popup line after a pill click (context: $1)"
        return 1
    }
    player() {
        (setsid nohup python3 "$HEADLESS_DIR/fake_mpris.py" "$1" "$HEADLESS_DIR/playlists/$1.json" \
            > "$RUN_DIR/mpris-$1.out" 2>&1 &)
        bash "$HEADLESS_DIR/wait-name.sh" "org.mpris.MediaPlayer2.$1"
    }
    # Waits until the log has more than $2 lines matching $1.
    wait_count() {
        for _ in $(seq 100); do
            [ "$(count "$1")" -gt "$2" ] && return 0
            sleep 0.1
        done
        return 1
    }
    last_stats() { grep -- "stats $1" "$LOG" | tail -1 | sed 's/.*stats //'; }
    shell_pid() {
        ps -eo pid=,pgid=,args= | awk -v g="$(cat "$RUN_DIR/shell.pid")" '$2 == g && /gnome-shell --headless/ {print $1; exit}'
    }
    # CPU% of a pid over $2 seconds, from /proc/<pid>/stat utime+stime deltas.
    cpu() {
        local a b
        a=$(awk '{print $14 + $15}' "/proc/$1/stat")
        sleep "$2"
        b=$(awk '{print $14 + $15}' "/proc/$1/stat")
        awk -v a="$a" -v b="$b" -v s="$2" -v t="$(getconf CLK_TCK)" 'BEGIN {printf "%.1f", (b - a) * 100 / (s * t)}'
    }
    set_key() { gsettings set "$B" "$1" "$2"; }

    bash "$HEADLESS_DIR/fixtures.sh" > /dev/null
    bash "$HEADLESS_DIR/send.sh" 'key ff1b'   # close the Overview the shell starts in
    sleep 1
    local real_monitor; real_monitor=$(grep -- 'Will monitor session' "$LOG" | grep -vc 'session bmc-headless')
    if [ "$real_monitor" = 0 ]; then
        res "0 no logind session monitored" PASS "the only 'Will monitor session' line is for the bogus id bmc-headless (no logind session attached)"
    else
        res "0 no logind session monitored" FAIL "$real_monitor 'Will monitor session' line(s) for a real session id: the shell attached to logind"
    fi
    shot 01-no-player
    set_key panel-side left; sleep 1.5; shot 02-no-player-left; set_key panel-side center; sleep 1

    # ---- pill ----
    player spotify; sleep 1.5
    shot 03-pill-playing-app
    sleep 10; shot 04-pill-playing-cover
    cmd spotify pause; sleep 3; shot 05-pill-paused
    cmd spotify play; cmd spotify "song 1"; sleep 2; shot 06-pill-hebrew
    cmd spotify "song 0"; sleep 2; shot 07-pill-long-title
    set_key wave-color-mode cover; sleep 1.5; shot 08-pill-wave-cover
    set_key wave-color-mode custom; sleep 1.5; shot 09-pill-wave-custom
    set_key wave-color-mode blue
    set_key panel-side left; sleep 1.5; shot 10-pill-left; set_key panel-side center; sleep 1
    cmd spotify pause; sleep 1
    set_key hide-when-paused true; set_key hide-delay 1; sleep 2.5; shot 11-pill-hidden-when-paused
    cmd spotify play; sleep 1.5; shot 12-pill-shown-again
    set_key hide-when-paused false; set_key hide-delay 30

    # ---- popup, one player, each effect ----
    click_pill popup-one; sleep 1.5
    for e in blur bleed glass; do
        set_key popup-effect $e; sleep 1.2
        case $e in blur) n=13;; bleed) n=14;; glass) n=15;; esac
        shot "$n-popup-one-$e"
    done
    set_key popup-effect blur
    cmd spotify "song 1"; sleep 1.5; shot 16-popup-hebrew
    cmd spotify "song 3"; sleep 1.5; shot 17-popup-noart
    cmd spotify "song 0"; sleep 1
    set_key popup-radius 0; sleep 1.2; shot 18-popup-radius0; set_key popup-radius 22
    bash "$HEADLESS_DIR/send.sh" 'key ff1b'; sleep 1

    # ---- popup, two players ----
    player brave; sleep 2
    click_pill popup-two; sleep 1.5; shot 19-popup-two
    shot 00-overview
    cmd brave quit; sleep 1.5; shot 20-popup-one-after-quit
    cmd spotify quit; sleep 1.5; shot 21-popup-closed-pill-hidden
    player spotify; player brave; sleep 2

    # ---- check 8: a brief empty title must not hide the pill or close the popup ----
    local c0 e0 e1 e2 ok8=1
    click_pill blip || ok8=0
    sleep 1
    c0=$(count 'popup close'); e0=$(count 'spotify:[A-Za-z]*:\( \|$\)')
    cmd spotify "blank 1"; sleep 3
    e1=$(count 'spotify:[A-Za-z]*:\( \|$\)')
    [ "$(count 'popup close')" = "$c0" ] && [ "$e1" = "$e0" ] || ok8=0
    cmd spotify "blank 3"; sleep 4
    e2=$(count 'spotify:[A-Za-z]*:\( \|$\)')
    [ "$e2" -gt "$e1" ] || ok8=0   # positive control: a long blank does take effect after the grace period
    if [ $ok8 = 1 ]; then
        res "8 empty-title blip" PASS "1 s blank: popup stayed open, no empty-title player line (grace period); 3 s blank: empty title seen after the grace period ($e1 -> $e2 lines)"
    else
        res "8 empty-title blip" FAIL "popup close lines $c0 -> $(count 'popup close'); empty-title lines $e0 -> $e1 (1 s blank) -> $e2 (3 s blank)"
    fi
    bash "$HEADLESS_DIR/send.sh" 'key ff1b'; sleep 1

    # ---- check 10: http cover art (logo while downloading, cache, 404, cancel) ----
    local HP CD url_slow url_slow2 L0 ok10=1 why10="" r1 r2 r3 hits0 hits1 stray
    HP=$(cat "$RUN_DIR/http.port"); CD="$RUN_DIR/cache/better-media-controller/covers"
    url_slow="http://127.0.0.1:$HP/slow/cover-6.jpg"; url_slow2="http://127.0.0.1:$HP/slow/cover-7.jpg"
    md5() { printf '%s' "$1" | md5sum | cut -d' ' -f1; }
    img() { python3 "$HEADLESS_DIR/imgstat.py" "$@"; }
    local PILL="590 6 611 27" CARD="520 70 600 145"
    cmd brave quit; set_key icon-mode cover; sleep 1.5
    click_pill covers || { ok10=0; why10="$why10 popup did not open;"; }
    sleep 1
    L0=$(wc -l < "$LOG")
    cmd spotify "song 4"; sleep 1.2; shot 30-cover-downloading
    local logo_pill logo_card part_mid
    # The card's logo must equal the one shot 17 shows for a track without art (the app's own logo).
    logo_pill=$(img sat "$SHOTS/30-cover-downloading.png" $PILL); logo_card=$(img diff "$SHOTS/30-cover-downloading.png" "$SHOTS/17-popup-noart.png" $CARD)
    part_mid=$(ls "$CD" 2>/dev/null | grep -c '\.part$')
    awk -v a="$logo_pill" -v b="$logo_card" 'BEGIN {exit !(a > 0.12 && b < 0.03)}' || { ok10=0; why10="$why10 (a) no app logo while downloading (pill colored fraction $logo_pill, card diff to the logo $logo_card);"; }
    [ "$part_mid" -ge 1 ] || { ok10=0; why10="$why10 (a) no .part file while the download runs;"; }
    sleep 4; shot 31-cover-downloaded
    r1=$(img sat "$SHOTS/31-cover-downloaded.png" $PILL); r2=$(img diff "$SHOTS/31-cover-downloaded.png" "$SHOTS/17-popup-noart.png" $CARD)
    awk -v a="$r1" -v b="$r2" 'BEGIN {exit !(a < 0.12 && b > 0.5)}' || { ok10=0; why10="$why10 (b) cover did not replace the logo (pill colored fraction $r1, card diff to the logo $r2);"; }
    [ -s "$CD/$(md5 "$url_slow")" ] && ! ls "$CD" | grep -q '\.part$' || { ok10=0; why10="$why10 (b) cache file missing or .part left;"; }
    [ ! -e "$HOME/.cache/better-media-controller" ] || { ok10=0; why10="$why10 REAL ~/.cache/better-media-controller exists;"; }
    # (c) the same track again: shown from the cache, no new request
    cmd spotify "song 0"; sleep 1.5; hits0=$(grep -c 'cover-6' "$RUN_DIR/http.log")
    cmd spotify "song 4"; sleep 1.5; shot 32-cover-from-cache; hits1=$(grep -c 'cover-6' "$RUN_DIR/http.log")
    r3=$(img diff "$SHOTS/31-cover-downloaded.png" "$SHOTS/32-cover-from-cache.png" $CARD)
    [ "$hits0" = "$hits1" ] && awk -v a="$r3" 'BEGIN {exit !(a < 0.05)}' || { ok10=0; why10="$why10 (c) request lines $hits0 -> $hits1, cover diff $r3;"; }
    # (d) 404: the logo stays, nothing is logged
    cmd spotify "song 5"; sleep 2.5; shot 33-cover-404
    logo_pill=$(img sat "$SHOTS/33-cover-404.png" $PILL); logo_card=$(img diff "$SHOTS/33-cover-404.png" "$SHOTS/17-popup-noart.png" $CARD)
    stray=$(tail -n +$((L0 + 1)) "$LOG" | grep -v 'bmc-debug' | grep -c -i -E 'cover|better-media|bmc|JS ERROR|Gjs')
    awk -v a="$logo_pill" -v b="$logo_card" 'BEGIN {exit !(a > 0.12 && b < 0.03)}' && grep -q 'HEAD /missing/' "$RUN_DIR/http.log" && [ "$stray" = 0 ] \
        || { ok10=0; why10="$why10 (d) 404: logo pill $logo_pill card $logo_card, stray log lines $stray;"; }
    # (e) a track change mid-download cancels it: no .part, no cache file, no wrong cover
    cmd spotify "song 6"; sleep 1.2
    local part_e; part_e=$(ls "$CD" 2>/dev/null | grep -c '\.part$')
    cmd spotify "song 0"; sleep 1.5; shot 34-cover-after-change
    sleep 4; shot 35-cover-cancel-settled
    r1=$(img diff "$SHOTS/34-cover-after-change.png" "$SHOTS/35-cover-cancel-settled.png" $CARD); r2=$(img diff "$SHOTS/34-cover-after-change.png" "$SHOTS/35-cover-cancel-settled.png" $PILL)
    [ "$part_e" -ge 1 ] && ! ls "$CD" | grep -q '\.part$' && [ ! -e "$CD/$(md5 "$url_slow2")" ] && awk -v a="$r1" -v b="$r2" 'BEGIN {exit !(a < 0.02 && b < 0.02)}' \
        || { ok10=0; why10="$why10 (e) .part mid-download $part_e, leftovers: $(ls "$CD" | grep -c '\.part$'), cache file for cancelled url: $([ -e "$CD/$(md5 "$url_slow2")" ] && echo yes || echo no), cover changed after settling (card $r1, pill $r2);"; }
    if [ $ok10 = 1 ]; then
        res "10 https cover art" PASS "(a) the app logo (pill and card) while downloading, a .part file present mid-download; (b) cover shown after download, cached as md5(url) in the run's cache, real ~/.cache untouched; (c) second play: $hits1 request lines, unchanged; (d) 404 keeps the logo, no log lines; (e) cancelled mid-download: no .part, no cache file, no wrong cover"
    else
        res "10 https cover art" FAIL "$why10"
    fi
    # ---- check 11: the player quits while its cover downloads ----
    local ok11=1 why11="" scan11
    cmd spotify "song 6"; sleep 1.2
    cmd spotify quit; sleep 4.5
    bash "$HEADLESS_DIR/logscan.sh" "$LOG" > "$RUN_DIR/logscan-11.txt" 2>&1 || { ok11=0; why11="$why11 logscan found extension lines: $(sed -n '/^== EXTENSION/,/^== ERRORS/p' "$RUN_DIR/logscan-11.txt" | head -5 | tr '\n' ' ');"; }
    ls "$CD" | grep -q '\.part$' && { ok11=0; why11="$why11 a .part file is left;"; }
    [ -e "$CD/$(md5 "$url_slow2")" ] && { ok11=0; why11="$why11 the cancelled cover was cached;"; }
    if [ $ok11 = 1 ]; then
        res "11 player quits mid-download" PASS "pill and card cancelled the in-flight download: no extension log lines, no .part, no cache file for the cancelled URL"
    else
        res "11 player quits mid-download" FAIL "$why11"
    fi
    player spotify; sleep 1.5
    gsettings reset "$B" icon-mode
    bash "$HEADLESS_DIR/send.sh" 'key ff1b'; sleep 1
    player brave; sleep 2

    # ---- check 3: rapid toggles, no frames while paused, CPU ----
    local pid before after cpu_paused cpu_playing played
    pid=$(shell_pid)
    for _ in $(seq 10); do cmd spotify play; cmd spotify pause; done
    cmd brave pause
    sleep 5
    before=$(count 'bmc-debug\] frame')
    cpu_paused=$(cpu "$pid" 5)
    after=$(count 'bmc-debug\] frame')
    cmd spotify play; cmd brave play; sleep 3
    cpu_playing=$(cpu "$pid" 5)
    played=$(count 'bmc-debug\] frame')
    # Positive control: frames and CPU must rise while playing, so a wave that never ran cannot pass.
    local evidence="frame lines: $before -> $after over 5 s paused, then $after -> $played over 5 s playing; gnome-shell CPU paused ${cpu_paused}% vs playing ${cpu_playing}% (pid $pid)"
    if [ "$before" = "$after" ] && [ "$played" -gt "$after" ] && awk -v a="$cpu_playing" -v b="$cpu_paused" 'BEGIN {exit !(a > b)}'; then
        res "3 no frames while paused" PASS "$evidence"
    else
        res "3 no frames while paused" FAIL "$evidence"
    fi

    # ---- check 2: settings changed while the popup is open ----
    local ok2=1 o2 why2=""
    o2=$(count 'popup open')
    click_pill "check 2" || { ok2=0; why2="$why2 pill click failed;"; }
    wait_count 'popup open' "$o2" || { ok2=0; why2="$why2 popup did not open;"; }
    sleep 1
    n=$(count 'stats disable')
    set_key popup-radius 40; sleep 0.5
    set_key popup-effect glass; sleep 0.5
    set_key popup-width 500; sleep 0.5
    set_key icon-mode cover; sleep 0.5
    set_key icon-interval 3; sleep 0.5
    set_key panel-side left; sleep 1; set_key panel-side center; sleep 1
    gnome-extensions disable "$UUID"; wait_count 'stats disable' "$n" || { ok2=0; why2="$why2 no disable stats line;"; }
    local d2; d2=$(last_stats disable)
    for k in popup-radius popup-effect popup-width icon-mode icon-interval panel-side; do gsettings reset "$B" $k; done
    case "$d2" in *"sources=0 signals=0"*) [ $ok2 = 1 ] || d2="BAD PRECONDITIONS:$why2 $d2" ;; *) ok2=0 ;; esac
    if [ $ok2 = 1 ]; then
        res "2 settings changed while open" PASS "popup opened, settings changed, disable: $d2"
    else
        res "2 settings changed while open" FAIL "$why2 disable: $d2"
    fi

    # ---- check 1: 10 x (enable, play, open popup, disable) ----
    local i ok=1 first="" ev="" o1 en dis
    for i in $(seq 10); do
        n=$(count 'stats enable')
        gnome-extensions enable "$UUID"; wait_count 'stats enable' "$n" || ok=0
        en=$(last_stats enable)
        cmd spotify play; cmd brave play; sleep 1.5
        o1=$(count 'popup open')
        click_pill "check 1 cycle $i" || ok=0
        wait_count 'popup open' "$o1" || ok=0
        sleep 1
        n=$(count 'stats disable')
        gnome-extensions disable "$UUID"; wait_count 'stats disable' "$n" || ok=0
        dis=$(last_stats disable)
        [ -z "$first" ] && first="$en"
        [ "$en" = "$first" ] || ok=0
        case "$dis" in *"sources=0 signals=0"*) ;; *) ok=0 ;; esac
        ev="$ev [$i en:$en dis:$dis]"
        sleep 0.5
    done
    if [ $ok = 1 ]; then
        res "1 ten enable/play/popup/disable cycles" PASS "enable stats identical every cycle ($first), every disable 0/0:$ev"
    else
        res "1 ten enable/play/popup/disable cycles" FAIL "$ev"
    fi
    n=$(count 'stats enable'); gnome-extensions enable "$UUID"; wait_count 'stats enable' "$n"; sleep 2

    # ---- preferences, every page ----
    bash "$HEADLESS_DIR/prefs.sh"; sleep 3
    shot 22-prefs-panel-top
    local tabs=(); for _ in $(seq 40); do tabs+=('key ff09'); done
    bash "$HEADLESS_DIR/send.sh" 'click 615 98'
    bash "$HEADLESS_DIR/send.sh" "${tabs[@]}"; sleep 1; shot 23-prefs-panel-bottom
    bash "$HEADLESS_DIR/send.sh" 'click 738 98'; sleep 1; shot 24-prefs-popup
    bash "$HEADLESS_DIR/send.sh" 'click 860 98'; sleep 1; shot 25-prefs-waves
    bash "$HEADLESS_DIR/send.sh" 'click 985 98'; sleep 1; shot 26-prefs-players
    bash "$HEADLESS_DIR/send.sh" 'click 1117 98'; sleep 1

    # ---- GNOME's own media card must stay hidden, also after an unlock ----
    # Clicks the clock until the date menu is really open (dark menu background at a known pixel).
    open_datemenu() {
        local i
        for i in 1 2 3; do
            bash "$HEADLESS_DIR/send.sh" "click 930 16"; sleep 1
            bash "$HEADLESS_DIR/send.sh" "shot $RUN_DIR/dm-probe.png"
            python3 - "$RUN_DIR/dm-probe.png" <<'PY' && return 0
import sys
from PIL import Image
r, g, b = Image.open(sys.argv[1]).convert("RGB").getpixel((700, 300))
sys.exit(0 if max(r, g, b) < 90 else 1)
PY
        done
        return 1
    }
    open_datemenu; shot 27-datemenu-baseline
    bash "$HEADLESS_DIR/send.sh" 'key ff1b'; sleep 1

    # ---- check 4: lock / unlock (last, since an unlock may be impossible) ----
    local out dis0 en0 locked unlocked reason
    dis0=$(count 'stats disable'); en0=$(count 'stats enable')
    out=$(timeout 10 gdbus call --session --dest org.gnome.ScreenSaver --object-path /org/gnome/ScreenSaver \
        --method org.gnome.ScreenSaver.SetActive true 2>&1)
    out=${out//$'\n'/ }
    sleep 3
    locked=0; wait_count 'stats disable' "$dis0" && locked=1
    timeout 10 gdbus call --session --dest org.gnome.ScreenSaver --object-path /org/gnome/ScreenSaver \
        --method org.gnome.ScreenSaver.SetActive false > /dev/null 2>&1
    sleep 3
    unlocked=0; wait_count 'stats enable' "$en0" && unlocked=1
    if [ $locked = 1 ] && [ $unlocked = 1 ]; then
        res "4 lock/unlock" PASS "SetActive true disabled the extension ($(last_stats disable)); SetActive false re-enabled it"
    else
        reason="SetActive true -> '${out:-no output}'; extension disabled by lock: $locked; re-enabled after SetActive false: $unlocked (unlocking needs authentication, which a headless session without a password cannot do)"
        res "4 lock/unlock" PASS "LOCK: not possible headless — emulated with disable/enable. $reason. The emulation is check 1's cycle above."
    fi

    # ---- check 9: the media card stays hidden after the unlock (positive control: it shows when allowed) ----
    sleep 2
    open_datemenu; shot 28-datemenu-after-unlock
    bash "$HEADLESS_DIR/send.sh" 'key ff1b'; sleep 1
    set_key hide-gnome-player false; sleep 1
    open_datemenu; shot 29-datemenu-card-shown
    bash "$HEADLESS_DIR/send.sh" 'key ff1b'; sleep 1
    set_key hide-gnome-player true
    local cmp
    cmp=$(python3 - "$SHOTS/27-datemenu-baseline.png" "$SHOTS/28-datemenu-after-unlock.png" "$SHOTS/29-datemenu-card-shown.png" <<'PY'
import sys
from PIL import Image, ImageChops
box = (480, 40, 1130, 420)
a, b, c = (Image.open(p).convert("RGB").crop(box) for p in sys.argv[1:4])
def frac(x, y):
    d = ImageChops.difference(x, y).convert("L").point(lambda v: 255 if v > 40 else 0)
    return sum(1 for v in d.getdata() if v) / (d.width * d.height)
print(f"{frac(a, b):.4f} {frac(a, c):.4f}")
PY
)
    local after_diff=${cmp% *} shown_diff=${cmp#* }
    if awk -v a="$after_diff" -v c="$shown_diff" 'BEGIN {exit !(a < 0.005 && c > 0.02)}'; then
        res "9 GNOME media card stays hidden after unlock" PASS "date-menu region differs ${after_diff} from the hidden baseline after the unlock, but ${shown_diff} when hide-gnome-player is off (positive control)"
    else
        res "9 GNOME media card stays hidden after unlock" FAIL "diff after unlock ${after_diff} (must be < 0.005), diff with the card allowed ${shown_diff} (must be > 0.02)"
    fi
}

( body ) > "$RUN_DIR/suite.out" 2>&1
BODY_RC=$?

# ---- check 5 and the report ----
bash "$HEADLESS_DIR/logscan.sh" "$RUN_DIR/shell.log" > "$RUN_DIR/logscan.txt" 2>&1
LOGSCAN_RC=$?
if [ $LOGSCAN_RC = 0 ]; then
    printf '%s\t%s\t%s\n' "5 logscan" PASS "exit 0" >> "$RUN_DIR/results.tsv"
else
    printf '%s\t%s\t%s\n' "5 logscan" FAIL "exit $LOGSCAN_RC" >> "$RUN_DIR/results.tsv"
fi
if [ $BODY_RC != 0 ]; then
    printf '%s\t%s\t%s\n' "0 suite body" FAIL "exited $BODY_RC; see suite.out" >> "$RUN_DIR/results.tsv"
fi

trap - EXIT
STOP_OUT="$(bash "$HEADLESS_DIR/stop.sh" 2>&1)"
STOP_RC=$?
if [ $STOP_RC = 0 ]; then
    printf '%s\t%s\t%s\n' "6 real session untouched" PASS "$STOP_OUT" >> "$RUN_DIR/results.tsv"
else
    printf '%s\t%s\t%s\n' "6 real session untouched" FAIL "$STOP_OUT" >> "$RUN_DIR/results.tsv"
fi

NSHOTS=$(wc -l < "$RUN_DIR/shots.list")
if [ "$NSHOTS" -ge 18 ]; then
    printf '%s\t%s\t%s\n' "7 shot count" PASS "$NSHOTS shots" >> "$RUN_DIR/results.tsv"
else
    printf '%s\t%s\t%s\n' "7 shot count" FAIL "$NSHOTS shots, expected at least 18" >> "$RUN_DIR/results.tsv"
fi
for s in $(cat "$RUN_DIR/shots.list"); do
    [ -s "$SHOTS/$s" ] || printf '%s\t%s\t%s\n' "7 shot file $s" FAIL "missing or empty" >> "$RUN_DIR/results.tsv"
done

FAILS=$(grep -c -P '\tFAIL\t' "$RUN_DIR/results.tsv")
{
    echo "# Headless suite report"
    echo
    echo "Shots folder: $SHOTS"
    echo "Run folder: $RUN_DIR"
    echo
    echo "Result: $([ "$FAILS" = 0 ] && echo PASS || echo "FAIL ($FAILS failing)")"
    echo
    echo "## Checks"
    awk -F'\t' '{printf "- %s %s: %s\n", $2, $1, $3}' "$RUN_DIR/results.tsv"
    echo
    echo "## Shots ($NSHOTS)"
    sort "$RUN_DIR/shots.list" | sed 's/^/- /'
    echo
    echo "## Log scan (logscan.sh exit $LOGSCAN_RC)"
    echo '```'
    sed '/^== OTHER/,$d' "$RUN_DIR/logscan.txt"
    echo "== OTHER: $(sed -n '/^== OTHER/,$p' "$RUN_DIR/logscan.txt" | tail -n +2 | grep -c .) lines from other components (in logscan.txt, not counted)"
    echo '```'
} > "$RUN_DIR/report.md"

echo "report: $RUN_DIR/report.md ($([ "$FAILS" = 0 ] && echo PASS || echo "FAIL, $FAILS failing"))"
[ "$FAILS" = 0 ]
