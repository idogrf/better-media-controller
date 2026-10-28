"""Fake MPRIS player on the private bus, for headless tests.

Usage: python3 fake_mpris.py <name> <playlist.json>   (inside env.sh)

Owns org.mpris.MediaPlayer2.<name>. Control by appending lines to
$RUN_DIR/mpris-<name>.cmd: play, pause, next, prev, quit, song <index>, seek <seconds>, blank <seconds>.
Playlist entries are {title, artist, length_s, art}; art is a file name under
$RUN_DIR/covers (or an absolute path) or null. Writes its pid to
$RUN_DIR/mpris-<name>.pid so stop.sh can kill it.
"""

import json
import os
import sys
import time

from gi.repository import Gio, GLib

OBJ = "/org/mpris/MediaPlayer2"
XML = """<node>
 <interface name="org.mpris.MediaPlayer2">
  <method name="Raise"/><method name="Quit"/>
  <property name="CanQuit" type="b" access="read"/>
  <property name="CanRaise" type="b" access="read"/>
  <property name="HasTrackList" type="b" access="read"/>
  <property name="Identity" type="s" access="read"/>
  <property name="DesktopEntry" type="s" access="read"/>
  <property name="SupportedUriSchemes" type="as" access="read"/>
  <property name="SupportedMimeTypes" type="as" access="read"/>
 </interface>
 <interface name="org.mpris.MediaPlayer2.Player">
  <method name="Next"/><method name="Previous"/><method name="Pause"/>
  <method name="PlayPause"/><method name="Stop"/><method name="Play"/>
  <method name="Seek"><arg type="x" direction="in"/></method>
  <method name="SetPosition"><arg type="o" direction="in"/><arg type="x" direction="in"/></method>
  <signal name="Seeked"><arg type="x"/></signal>
  <property name="PlaybackStatus" type="s" access="read"/>
  <property name="LoopStatus" type="s" access="readwrite"/>
  <property name="Rate" type="d" access="readwrite"/>
  <property name="Shuffle" type="b" access="readwrite"/>
  <property name="Metadata" type="a{sv}" access="read"/>
  <property name="Volume" type="d" access="readwrite"/>
  <property name="Position" type="x" access="read"/>
  <property name="MinimumRate" type="d" access="read"/>
  <property name="MaximumRate" type="d" access="read"/>
  <property name="CanGoNext" type="b" access="read"/>
  <property name="CanGoPrevious" type="b" access="read"/>
  <property name="CanPlay" type="b" access="read"/>
  <property name="CanPause" type="b" access="read"/>
  <property name="CanSeek" type="b" access="read"/>
  <property name="CanControl" type="b" access="read"/>
 </interface>
</node>"""

name = sys.argv[1]
playlist = json.load(open(sys.argv[2]))
run_dir = os.environ["RUN_DIR"]
cmd_path = os.path.join(run_dir, f"mpris-{name}.cmd")
with open(os.path.join(run_dir, f"mpris-{name}.pid"), "w") as f:
    f.write(str(os.getpid()))

state = {"index": 0, "status": "Playing", "base": 0.0, "since": time.monotonic()}
loop = GLib.MainLoop()
bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
info = Gio.DBusNodeInfo.new_for_xml(XML).interfaces


def position():
    extra = time.monotonic() - state["since"] if state["status"] == "Playing" else 0.0
    return state["base"] + extra


def http_port():
    with open(os.path.join(run_dir, "http.port")) as f:
        return f.read().strip()


# Installed apps (visible to the headless shell) whose logos stand in for the fakes' own.
DESKTOP_ENTRIES = {"spotify": "org.gnome.Nautilus", "brave": "org.gnome.TextEditor"}


def metadata():
    song = playlist[state["index"]]
    if state.get("blank"):
        song = {**song, "title": "", "artist": ""}
    md = {
        "mpris:trackid": GLib.Variant("o", f"/fake/{name}/{state['index']}"),
        "xesam:title": GLib.Variant("s", song["title"]),
        "xesam:artist": GLib.Variant("as", [song["artist"]] if song["artist"] else []),
        "mpris:length": GLib.Variant("x", int(song["length_s"] * 1_000_000)),
    }
    if song.get("art"):
        if song["art"].startswith("http"):
            md["mpris:artUrl"] = GLib.Variant("s", song["art"].replace("{port}", http_port()))
        else:
            art = song["art"] if os.path.isabs(song["art"]) else os.path.join(run_dir, "covers", song["art"])
            md["mpris:artUrl"] = GLib.Variant("s", "file://" + art)
    return md


PROPS = {
    "org.mpris.MediaPlayer2": {
        "CanQuit": lambda: GLib.Variant("b", True),
        "CanRaise": lambda: GLib.Variant("b", False),
        "HasTrackList": lambda: GLib.Variant("b", False),
        "Identity": lambda: GLib.Variant("s", name.capitalize()),
        "DesktopEntry": lambda: GLib.Variant("s", DESKTOP_ENTRIES.get(name, name)),
        "SupportedUriSchemes": lambda: GLib.Variant("as", ["file"]),
        "SupportedMimeTypes": lambda: GLib.Variant("as", []),
    },
    "org.mpris.MediaPlayer2.Player": {
        "PlaybackStatus": lambda: GLib.Variant("s", state["status"]),
        "LoopStatus": lambda: GLib.Variant("s", "None"),
        "Rate": lambda: GLib.Variant("d", 1.0),
        "Shuffle": lambda: GLib.Variant("b", False),
        "Metadata": lambda: GLib.Variant("a{sv}", metadata()),
        "Volume": lambda: GLib.Variant("d", 1.0),
        "Position": lambda: GLib.Variant("x", int(position() * 1_000_000)),
        "MinimumRate": lambda: GLib.Variant("d", 1.0),
        "MaximumRate": lambda: GLib.Variant("d", 1.0),
        "CanGoNext": lambda: GLib.Variant("b", True),
        "CanGoPrevious": lambda: GLib.Variant("b", True),
        "CanPlay": lambda: GLib.Variant("b", True),
        "CanPause": lambda: GLib.Variant("b", True),
        "CanSeek": lambda: GLib.Variant("b", False),
        "CanControl": lambda: GLib.Variant("b", True),
    },
}


def changed(*props):
    body = {p: PROPS["org.mpris.MediaPlayer2.Player"][p]() for p in props}
    bus.emit_signal(
        None, OBJ, "org.freedesktop.DBus.Properties", "PropertiesChanged",
        GLib.Variant("(sa{sv}as)", ("org.mpris.MediaPlayer2.Player", body, [])),
    )


def set_status(status):
    if status == state["status"]:
        return
    state["base"] = position()
    state["status"] = status
    state["since"] = time.monotonic()
    changed("PlaybackStatus")


def song(index):
    state["index"] = index % len(playlist)
    state["base"] = 0.0
    state["since"] = time.monotonic()
    changed("Metadata")
    bus.emit_signal(None, OBJ, "org.mpris.MediaPlayer2.Player", "Seeked", GLib.Variant("(x)", (0,)))


def unblank():
    state["blank"] = False
    changed("Metadata")
    return False


def command(cmd):
    parts = cmd.split()
    op = parts[0] if parts else ""
    if op in ("play", "Play"):
        set_status("Playing")
    elif op in ("pause", "Pause"):
        set_status("Paused")
    elif op == "toggle":
        set_status("Paused" if state["status"] == "Playing" else "Playing")
    elif op == "stop":
        set_status("Stopped")
    elif op == "next":
        song(state["index"] + 1)
    elif op == "prev":
        song(state["index"] - 1)
    elif op == "blank" and len(parts) > 1:
        # Empty title for N seconds, as some players do between tracks.
        state["blank"] = True
        changed("Metadata")
        GLib.timeout_add(int(float(parts[1]) * 1000), unblank)
    elif op == "seek" and len(parts) > 1:
        state["base"] = float(parts[1])
        state["since"] = time.monotonic()
        bus.emit_signal(None, OBJ, "org.mpris.MediaPlayer2.Player", "Seeked",
                        GLib.Variant("(x)", (int(state["base"] * 1_000_000),)))
    elif op == "song" and len(parts) > 1:
        song(int(parts[1]))
    elif op == "quit":
        loop.quit()


def on_method(_conn, _sender, _path, iface, method, params, invocation):
    if iface.endswith(".Player"):
        {"Play": lambda: command("play"), "Pause": lambda: command("pause"),
         "PlayPause": lambda: command("toggle"), "Stop": lambda: command("stop"),
         "Next": lambda: command("next"), "Previous": lambda: command("prev")}.get(method, lambda: None)()
    elif method == "Quit":
        command("quit")
    invocation.return_value(None)


def on_get(_conn, _sender, _path, iface, prop):
    return PROPS[iface][prop]()


for node in info:
    bus.register_object(OBJ, node, on_method, on_get, None)

# Start after any old commands so a relaunch never replays history (e.g. a `quit`).
open(cmd_path, "a").close()
offset = os.path.getsize(cmd_path)


def poll():
    global offset
    with open(cmd_path) as f:
        f.seek(offset)
        lines = f.readlines()
        offset = f.tell()
    for line in lines:
        command(line.strip())
    # Auto-advance at the end of a song, like a real player.
    if state["status"] == "Playing" and position() >= playlist[state["index"]]["length_s"]:
        song(state["index"] + 1)
    return True


GLib.timeout_add(100, poll)
Gio.bus_own_name_on_connection(bus, f"org.mpris.MediaPlayer2.{name}", Gio.BusNameOwnerFlags.NONE, None, None)
try:
    loop.run()
finally:
    try:
        os.remove(os.path.join(run_dir, f"mpris-{name}.pid"))
    except OSError:
        pass
