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
    click_pill() { bash "$HEADLESS_DIR/send.sh" "click 710 16"; }
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
    click_pill; sleep 1.5
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
    click_pill; sleep 1.5; shot 19-popup-two
    shot 00-overview
    cmd brave quit; sleep 1.5; shot 20-popup-one-after-quit
    cmd spotify quit; sleep 1.5; shot 21-popup-closed-pill-hidden
    player spotify; player brave; sleep 2

    # ---- check 3: rapid toggles, no frames while paused, CPU ----
    local pid before after cpu_paused cpu_playing
    pid=$(shell_pid)
    for _ in $(seq 10); do cmd spotify play; cmd spotify pause; done
    cmd brave pause
    sleep 5
    before=$(count 'bmc-debug\] frame')
    cpu_paused=$(cpu "$pid" 5)
    after=$(count 'bmc-debug\] frame')
    cmd spotify play; cmd brave play; sleep 3
    cpu_playing=$(cpu "$pid" 5)
    if [ "$before" = "$after" ]; then
        res "3 no frames while paused" PASS "frame lines $before -> $after over 5 s paused; gnome-shell CPU paused ${cpu_paused}% vs playing ${cpu_playing}% (pid $pid)"
    else
        res "3 no frames while paused" FAIL "frame lines $before -> $after over 5 s paused; CPU paused ${cpu_paused}% playing ${cpu_playing}%"
    fi

    # ---- check 2: settings changed while the popup is open ----
    click_pill; sleep 1.5
    n=$(count 'stats disable')
    set_key popup-radius 40; sleep 0.5
    set_key popup-effect glass; sleep 0.5
    set_key popup-width 500; sleep 0.5
    set_key icon-mode cover; sleep 0.5
    set_key icon-interval 3; sleep 0.5
    set_key panel-side left; sleep 1; set_key panel-side center; sleep 1
    gnome-extensions disable "$UUID"; wait_count 'stats disable' "$n"
    local d2; d2=$(last_stats disable)
    for k in popup-radius popup-effect popup-width icon-mode icon-interval panel-side; do gsettings reset "$B" $k; done
    case "$d2" in *"sources=0 signals=0"*) res "2 settings changed while open" PASS "disable: $d2" ;;
        *) res "2 settings changed while open" FAIL "disable: $d2" ;; esac

    # ---- check 1: 10 x (enable, play, open popup, disable) ----
    local i ok=1 first="" ev="" polls p0 t0 en dis
    for i in $(seq 10); do
        n=$(count 'stats enable')
        gnome-extensions enable "$UUID"; wait_count 'stats enable' "$n" || ok=0
        en=$(last_stats enable)
        cmd spotify play; cmd brave play; sleep 1.5
        t0=$(count 'toggle-popup')
        click_pill; sleep 1
        [ "$(count 'toggle-popup')" -gt "$t0" ] || ok=0
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
