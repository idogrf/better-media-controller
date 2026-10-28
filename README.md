# Better Media Controller

A GNOME Shell 50 extension that puts a small media controller in the top panel:
a rounded pill with the current track, previous / play-pause / next buttons and a
soft animated wave behind them. Clicking the pill opens a stack of slim cards, one
per player, with the cover, title, artist, controls and a progress bar.

## Why this exists

It replaces Advanced Media Controller (AMC), whose popup is large and which
leaked. AMC cleaned up in a `destroy()` override. When its parent was destroyed,
Clutter tore the children down from C and never called the override, so a 33 ms
timer kept running on a dead widget. One timer leaked per screen lock, until about
600 log lines per second filled the journal.

Everything here is built around not repeating that:

- Cleanup is never in a `destroy()` override. Each widget connects to its own
  `destroy` signal and cleans up there.
- Every GLib source and signal handler goes through `track.js`. A `Tracker`
  owns them and `destroy()` removes them all; `totals()` sums every live tracker,
  so a disable can be checked for leftovers.
- Nothing animates or polls while paused, hidden or closed.
- With `debug-stats` off the extension logs nothing at all.

## How it works

**Which player.** The pill follows the player that is playing. If several are
playing, it is the one that started most recently; if none is, the one that
paused most recently. If there is no player with a title, the pill hides. Players
are keyed by app (`DesktopEntry`, or `Identity` as a fallback), so all tabs of a
browser share one entry in the allow/block list.

**Waves.** Three translucent sine layers, mirrored around the center line and
faded at both ends, pumped by a simulated beat. The pill's wave is filled; the
popup's is an outline. A wave runs only while it is on screen and its player is
playing. On pause it eases flat in about a second and then stops completely.

**Label.** A label wider than its box scrolls at a constant speed and loops: a
copy of the text follows the original after a small gap, so it never stops or
jumps back. It scrolls only while playing and returns to the start
while paused.

**Icon.** It alternates between the app icon and the song cover with a 0.8 s
cross-fade. The interval timer exists only while the pill is visible, playing,
has a cover, and `icon-mode` is `alternate`.

**Cover art.** `file://` art is used as is. `http`/`https` art (Spotify and others)
is downloaded asynchronously with `Gio.File.copy_async` (GVfs does the http) into
`~/.cache/better-media-controller/covers/`, named by the MD5 of the URL. It is
written to a `.part` file and renamed only on success, so a partial file is never
used, and a cached file means no network request. For Spotify (`i.scdn.co/image/`)
the 640x640 size is tried first, then the original URL. A track change or disable
cancels a download in flight; a failure is silent. While a cover downloads, or when
there is none, the player's own app logo is shown (`DesktopEntry`, then the shell's
heuristic and wmclass lookups, then the `Identity` matched against app names); the
generic audio icon is only the last resort. To clear the cache:

```bash
rm -r ~/.cache/better-media-controller
```

**Popup.** One card per player (at most four, the pill's player first). Each card
draws its own background in Cairo so rounded corners clip everything: blurred
cover, cover bleed, or glass. The cover is shrunk to a tiny image and drawn back
up smoothly, which stands in for a blur. Progress is read asynchronously once a
second, only while the popup is open and a card is playing. It closes on a click
outside, Escape, or another click on the pill, and always releases its modal grab
(also when the extension is disabled while it is open).

**GNOME's own player.** The built-in media card in the notification list is hidden
while the extension is enabled (`hide-gnome-player`) and restored on disable.

## Settings

Gear icon in Extensions Manager; four pages (Panel, Popup, Waves, Players). All
changes apply live.

| Setting | Key | Default |
|---|---|---|
| Panel side (`left`, `center`, `right`) | `panel-side` | `center` |
| Position within the side (0 puts it first) | `panel-index` | `0` |
| Element order (`icon-label-controls`, `label-icon-controls`, `controls-icon-label`) | `element-order` | `icon-label-controls` |
| Icon (`app`, `cover`, `alternate`) | `icon-mode` | `alternate` |
| Seconds between icon switches (2-120) | `icon-interval` | `10` |
| Icon size (px, 12-24) | `icon-size` | `18` |
| Label content (`both`, `title`, `artist`) | `label-show` | `both` |
| Separator between title and artist | `label-separator` | ` • ` |
| Label width (px, 60-320) | `label-width` | `140` |
| Maximum label length (characters, 10-100) | `label-max-length` | `40` |
| Scroll long labels | `label-scroll` | `true` |
| Scroll speed (1-10, from 12 to 48 px/s) | `label-scroll-speed` | `5` |
| Label font family; empty uses the system font | `label-font` | `''` |
| Label font size (px, 9-20) | `label-font-size` | `13.5` |
| Bold label | `label-bold` | `true` |
| Use a custom label color | `label-color-enabled` | `false` |
| Custom label color | `label-color` | `#8fd0ff` |
| Hide the pill when paused | `hide-when-paused` | `false` |
| Seconds paused before hiding (0-600) | `hide-delay` | `30` |
| Popup background (`blur`, `bleed`, `glass`) | `popup-effect` | `blur` |
| Popup blur strength (0-60) | `popup-blur` | `20` |
| Popup corner radius (px, 0-66) | `popup-radius` | `22` |
| Popup width (px, 360-560) | `popup-width` | `440` |
| Wave in the pill | `wave-pill` | `true` |
| Wave in the popup | `wave-popup` | `true` |
| Wave color (`blue`, `cover`, `custom`) | `wave-color-mode` | `blue` |
| Custom wave color (lighter and darker shades are derived) | `wave-custom-color` | `#ff7ab6` |
| Wave intensity (%, 20-150) | `wave-intensity` | `100` |
| Wave speed (%, 25-200) | `wave-speed` | `100` |
| Hide GNOME's built-in media player | `hide-gnome-player` | `true` |
| Which players show (`all`, `only`, `except`) | `player-filter-mode` | `all` |
| App keys the filter applies to | `player-filter-list` | `[]` |
| App keys seen so far (filled in automatically) | `known-players` | `[]` |
| Log `[bmc-debug]` statistics (hidden; not in the preferences window) | `debug-stats` | `false` |

## Install

Not on extensions.gnome.org. Requires GNOME Shell 50. If Advanced Media
Controller is installed, disable it first. Then:

```bash
git clone https://github.com/idogrf/better-media-controller.git
cd better-media-controller
glib-compile-schemas schemas/
ln -s "$PWD" ~/.local/share/gnome-shell/extensions/better-media-controller@idogr
```

`glib-compile-schemas` is needed because `schemas/gschemas.compiled` is not in git;
run it again after any change to `schemas/`. The install is a symlink to the
working tree. Log out and back in (Wayland), then:

```bash
gnome-extensions enable better-media-controller@idogr
```

To build a zip instead, run `sh pack.sh`. It writes
`dist/better-media-controller@idogr.shell-extension.zip` with only the runtime
files (no tests, tools or docs). To install the zip instead of the symlink:

```bash
gnome-extensions install --force dist/better-media-controller@idogr.shell-extension.zip
```

## Testing

`tests/run.sh` runs the pure logic under plain `gjs` (label, players, colors, wave
math, the lifecycle tracker) and a static check that no runtime file logs directly.

`tools/headless/` runs the real extension in an **isolated headless GNOME Shell**
with a D-Bus driver for clicks, keys and screenshots, and fake MPRIS players
(`fake_mpris.py`, playlists in `playlists/`). Isolation:

- a private D-Bus session and private dconf and XDG directories;
- a private `XDG_RUNTIME_DIR` (a short directory under `/tmp`; only the PipeWire
  sockets are linked in from the real one, which screenshots need), so the shell's
  own files, such as its extensions-disabled guard file, never land in the real
  runtime directory;
- a bogus `XDG_SESSION_ID` (`bmc-headless`), so the shell cannot attach to your real
  logind session (it would otherwise watch it and set its locked hint). As a result
  `shell.log` has a `Could not get proxy for session bmc-headless` CRITICAL and an
  unhandled-promise-rejection warning from the shell itself. Both are expected;
- `env.sh` fails closed: with no active run it points the bus and runtime
  directories at nothing, so a following `gsettings` errors instead of reaching the
  real session. Source it only in a subshell, and start and stop runs from a shell
  that has not sourced it;
- `stop.sh` checks that the real `enabled-extensions`, the real extension entry and
  the real guard file are unchanged and says `REAL SESSION TOUCHED` otherwise.

```bash
bash tools/headless/suite.sh
```

The suite starts the shell, runs the fake players, takes every screenshot, runs the
lifecycle checks (ten enable/play/popup/disable cycles with stats back to
`sources=0 signals=0`, settings changed while the popup is open, no frames while
paused with a playing positive control, a lock/unlock), then the preferences shots,
and scans the log. It exits non-zero on any failure. Output goes to
`tools/headless/runs/<timestamp>/` (gitignored): `report.md` lists the checks and
shots, and the screenshots are in its `shots/` folder. Covers are copied from
`~/.cache/mpris-covers/` into the run folder only, never committed. A tiny local
http server (`http_server.py`, 127.0.0.1, random port, killed by `stop.sh`) serves
them to the fake Spotify player, with a 3 s delayed, a 404 and a to-be-cancelled
URL; the cover cache of a run lives in its own `cache/` folder, never in `~/.cache`.

With `debug-stats` on, the extension prints `[bmc-debug]` lines (timer and signal
counts at enable and disable, popup and wave start/stop). `logscan.sh` fails on any
other line from the extension.

## Uninstall

```bash
gnome-extensions disable better-media-controller@idogr
rm ~/.local/share/gnome-shell/extensions/better-media-controller@idogr
dconf reset -f /org/gnome/shell/extensions/better-media-controller/
```

It changes no state outside itself.

## License

GPL-2.0-or-later. See [LICENSE](LICENSE).
