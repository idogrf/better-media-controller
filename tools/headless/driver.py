"""Headless driver for Better Media Controller: drive the isolated GNOME Shell via Mutter's D-Bus APIs.

Keeps one RemoteDesktop + ScreenCast session open and executes commands appended (one per line)
to `cmds` in the run directory ($RUN_DIR); results go to `driver.log`.

Commands:
  shot <path.png>        grab one frame of the monitor
  key <keysym-hex> [mods...]   press a key, e.g. `key ff1b` (Escape), `key ff56 ffeb` (Super+Page_Down)
  click <x> <y>          left-click at monitor coordinates
  quit
"""

import os
import sys
import time

import gi

gi.require_version("Gst", "1.0")
from gi.repository import Gio, GLib, Gst  # noqa: E402

HERE = os.environ["RUN_DIR"]
LOG = open(os.path.join(HERE, "driver.log"), "a", buffering=1)


def log(*parts):
    print(time.strftime("%H:%M:%S"), *parts, file=LOG)


with open(os.path.join(HERE, "bus")) as f:
    address = f.read().strip()
bus = Gio.DBusConnection.new_for_address_sync(
    address,
    Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT | Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION,
    None,
    None,
)


def call(dest, path, iface, method, params=None, reply="()"):
    return bus.call_sync(dest, path, iface, method, params, GLib.VariantType(reply), Gio.DBusCallFlags.NONE, -1, None).unpack()


def prop(dest, path, iface, name):
    return call(dest, path, "org.freedesktop.DBus.Properties", "Get", GLib.Variant("(ss)", (iface, name)), "(v)")[0]


# Monitor connector + size from DisplayConfig.
state = call(
    "org.gnome.Mutter.DisplayConfig",
    "/org/gnome/Mutter/DisplayConfig",
    "org.gnome.Mutter.DisplayConfig",
    "GetCurrentState",
    None,
    "(ua((ssss)a(siiddada{sv})a{sv})a(iiduba(ssss)a{sv})a{sv})",
)
connector = state[1][0][0][0]
mode = next(m for m in state[1][0][1] if m[6].get("is-current"))
width, height = mode[1], mode[2]
log("monitor", connector, width, height)

RD, SC = "org.gnome.Mutter.RemoteDesktop", "org.gnome.Mutter.ScreenCast"
rd_session = call(RD, "/org/gnome/Mutter/RemoteDesktop", RD, "CreateSession", None, "(o)")[0]
session_id = prop(RD, rd_session, RD + ".Session", "SessionId")
sc_session = call(
    SC,
    "/org/gnome/Mutter/ScreenCast",
    SC,
    "CreateSession",
    GLib.Variant("(a{sv})", ({"remote-desktop-session-id": GLib.Variant("s", session_id)},)),
    "(o)",
)[0]
stream = call(
    SC,
    sc_session,
    SC + ".Session",
    "RecordMonitor",
    GLib.Variant("(sa{sv})", (connector, {"cursor-mode": GLib.Variant("u", 1)})),
    "(o)",
)[0]

node = {}


def on_signal(_conn, _sender, _path, _iface, signal, params):
    if signal == "PipeWireStreamAdded":
        node["id"] = params.unpack()[0]
        log("pipewire node", node["id"])


bus.signal_subscribe(SC, SC + ".Stream", "PipeWireStreamAdded", stream, None, Gio.DBusSignalFlags.NONE, on_signal)
call(RD, rd_session, RD + ".Session", "Start")
ctx = GLib.MainContext.default()
deadline = time.time() + 10
while "id" not in node and time.time() < deadline:
    ctx.iteration(True)
if "id" not in node:
    log("no pipewire stream")
    sys.exit(1)

Gst.init(None)


def nudge():
    # Mutter streams only on damage; moving the (embedded) cursor forces a fresh frame.
    for dx in (1.0, -1.0):
        call(RD, rd_session, RD + ".Session", "NotifyPointerMotionRelative", GLib.Variant("(dd)", (dx, 0.0)))
        time.sleep(0.05)


def node_serial(node_id):
    import json, subprocess
    for obj in json.loads(subprocess.run(["pw-dump"], capture_output=True, text=True).stdout):
        if obj.get("id") == node_id:
            return obj["info"]["props"]["object.serial"]
    raise RuntimeError(f"node {node_id} not found")


# One long-lived capture: always holds the latest frame, PNG-encoded.
capture = Gst.parse_launch(
    f"pipewiresrc target-object={node_serial(node['id'])} always-copy=true ! videoconvert ! pngenc snapshot=false "
    "! appsink name=sink max-buffers=1 drop=true sync=false"
)
sink = capture.get_by_name("sink")
capture.set_state(Gst.State.PLAYING)


def shot(path):
    nudge()
    sample = sink.emit("try-pull-sample", 3 * Gst.SECOND)
    if sample is None:
        log("shot", path, "no frame")
        return
    buf = sample.get_buffer()
    ok, info = buf.map(Gst.MapFlags.READ)
    with open(path, "wb") as f:
        f.write(bytes(info.data))
    buf.unmap(info)
    log("shot", path, True)


def keysym(sym, pressed):
    call(RD, rd_session, RD + ".Session", "NotifyKeyboardKeysym", GLib.Variant("(ub)", (sym, pressed)))


def key(sym, mods=()):
    for m in mods:
        keysym(m, True)
    keysym(sym, True)
    keysym(sym, False)
    for m in reversed(mods):
        keysym(m, False)


def click(x, y):
    call(RD, rd_session, RD + ".Session", "NotifyPointerMotionAbsolute", GLib.Variant("(sdd)", (stream, x, y)))
    time.sleep(0.05)
    call(RD, rd_session, RD + ".Session", "NotifyPointerButton", GLib.Variant("(ib)", (0x110, True)))
    call(RD, rd_session, RD + ".Session", "NotifyPointerButton", GLib.Variant("(ib)", (0x110, False)))


cmds = os.path.join(HERE, "cmds")
open(cmds, "a").close()
offset = os.path.getsize(cmds)
log("ready")
while True:
    while ctx.pending():
        ctx.iteration(False)
    with open(cmds) as f:
        f.seek(offset)
        lines = f.readlines()
        offset = f.tell()
    for line in lines:
        parts = line.rstrip("\n").split(" ", 1)
        op, arg = parts[0], parts[1] if len(parts) > 1 else ""
        try:
            if op == "shot":
                shot(arg)
            elif op == "key":
                syms = [int(s, 16) for s in arg.split()]
                key(syms[0], syms[1:])
            elif op == "click":
                x, y = (float(v) for v in arg.split())
                click(x, y)
            elif op == "quit":
                log("quit")
                sys.exit(0)
            log("done", op, arg)
        except Exception as err:  # noqa: BLE001 - spike: report and keep going
            log("error", op, arg, repr(err))
    time.sleep(0.05)
