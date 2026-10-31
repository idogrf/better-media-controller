// SPDX-License-Identifier: GPL-2.0-or-later
// MPRIS watcher: tracks org.mpris.MediaPlayer2.* names on the session bus and
// keeps one PlayerProxy per live player. All signals go through the Tracker.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {EventEmitter} from 'resource:///org/gnome/shell/misc/signals.js';

import {appKey} from './players.js';

const PREFIX = 'org.mpris.MediaPlayer2.';
const OBJ = '/org/mpris/MediaPlayer2';
const ROOT_IFACE = 'org.mpris.MediaPlayer2';
const PLAYER_IFACE = 'org.mpris.MediaPlayer2.Player';
// A title that goes empty (players blank it between tracks) is kept this long.
const TITLE_GRACE_MS = 1500;

const XML = `<node>
 <interface name="${ROOT_IFACE}">
  <property name="Identity" type="s" access="read"/>
  <property name="DesktopEntry" type="s" access="read"/>
 </interface>
 <interface name="${PLAYER_IFACE}">
  <method name="Next"/><method name="Previous"/><method name="PlayPause"/>
  <property name="PlaybackStatus" type="s" access="read"/>
  <property name="Metadata" type="a{sv}" access="read"/>
  <property name="Position" type="x" access="read"/>
 </interface>
</node>`;
const NODE = Gio.DBusNodeInfo.new_for_xml(XML);

// One live player. Fields are plain data; the watcher owns the proxies.
class PlayerProxy {
    constructor(id, root, player, tracker, onChange, getCancellable) {
        this.id = id;
        this._root = root;
        this._player = player;
        this._tracker = tracker;
        this._onChange = onChange;
        this._getCancellable = getCancellable;
        this.status = 'Stopped';
        this.title = '';
        this._graceId = null;
        this._graceOver = false;
        this.playingSince = 0;
        this.lastActive = 0;
        this._readRoot();
        this._readPlayer();
        if (this.status === 'Playing') {
            this.playingSince = Date.now();
            this.lastActive = this.playingSince;
        }
        this._handler = tracker.connect(player, 'g-properties-changed', () => {
            const before = this.status;
            this._readPlayer();
            if (this.status !== before) {
                const now = Date.now();
                this.lastActive = now;
                if (this.status === 'Playing')
                    this.playingSince = now;
            }
            this._onChange();
        });
    }

    _readRoot() {
        this.identity = this._root.get_cached_property('Identity')?.unpack() ?? '';
        this.desktopEntry = this._root.get_cached_property('DesktopEntry')?.unpack() ?? '';
        this.canRaise = this._root.get_cached_property('CanRaise')?.unpack() ?? false;
        this.appKey = appKey(this.desktopEntry, this.identity);
    }

    _readPlayer() {
        this.status = this._player.get_cached_property('PlaybackStatus')?.unpack() ?? 'Stopped';
        const md = this._player.get_cached_property('Metadata')?.recursiveUnpack() ?? {};
        const title = typeof md['xesam:title'] === 'string' ? md['xesam:title'] : '';
        if (title === '' && this.title) {
            // Chromium-style players send empty metadata between tracks: keep the old
            // metadata for a moment so the pill and popup do not flicker away.
            if (!this._graceOver) {
                if (this._graceId === null) {
                    this._graceId = this._tracker.addTimeout(TITLE_GRACE_MS, () => {
                        this._graceId = null;
                        this._graceOver = true;
                        this._readPlayer();
                        this._onChange();
                        return false;
                    });
                }
                return;
            }
        } else {
            this._cancelGrace();
        }
        this.title = title;
        const artist = md['xesam:artist'];
        this.artist = Array.isArray(artist) ? artist.join(', ') : (typeof artist === 'string' ? artist : '');
        this.artUrl = typeof md['mpris:artUrl'] === 'string' ? md['mpris:artUrl'] : '';
        this.lengthUs = Number(md['mpris:length']) || 0;
    }

    _cancelGrace() {
        if (this._graceId !== null)
            this._tracker.remove(this._graceId);
        this._graceId = null;
        this._graceOver = false;
    }

    // Position has no change signal, so read it when asked. Async so a busy
    // player cannot stall the shell; resolves to 0 on any error or after stop().
    positionUs() {
        const cancellable = this._getCancellable();
        if (!cancellable || !this._player)
            return Promise.resolve(0);
        return new Promise(resolve => {
            try {
                this._player.get_connection().call(
                    this.id, OBJ, 'org.freedesktop.DBus.Properties', 'Get',
                    new GLib.Variant('(ss)', [PLAYER_IFACE, 'Position']),
                    new GLib.VariantType('(v)'), Gio.DBusCallFlags.NONE, 200, cancellable,
                    (conn, res) => {
                        try {
                            resolve(Number(conn.call_finish(res).recursiveUnpack()[0]) || 0);
                        } catch (_e) {
                            resolve(0);
                        }
                    });
            } catch (_e) {
                resolve(0);
            }
        });
    }

    playPause() {
        this._call('PlayPause');
    }

    next() {
        this._call('Next');
    }

    previous() {
        this._call('Previous');
    }

    // Asks the player to show its own window; only meaningful when canRaise.
    raise() {
        this._root.call('Raise', null, Gio.DBusCallFlags.NONE, -1, null, null);
    }

    _call(method) {
        this._player.call(method, null, Gio.DBusCallFlags.NONE, -1, null, null);
    }

    destroy() {
        this._cancelGrace();
        this._tracker.disconnect(this._player, this._handler);
        this._root = null;
        this._player = null;
    }
}

// Single-use: stop() destroys the Tracker it was given, so create a new watcher to restart.
export class MprisWatcher extends EventEmitter {
    constructor(tracker, settings) {
        super();
        this._tracker = tracker;
        this._settings = settings;
        this._players = new Map();
        this._pending = new Set();
        this._cancellable = null;
        this._stopped = true;
    }

    get players() {
        return [...this._players.values()];
    }

    start() {
        this._stopped = false;
        this._cancellable = new Gio.Cancellable();
        Gio.DBusProxy.new_for_bus(
            Gio.BusType.SESSION, Gio.DBusProxyFlags.DO_NOT_LOAD_PROPERTIES, null,
            'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
            this._cancellable, (_o, res) => {
                try {
                    this._bus = Gio.DBusProxy.new_for_bus_finish(res);
                } catch (_e) {
                    // Cancelled by stop(), or the bus/name went away: nothing to track.
                    return;
                }
                if (this._stopped)
                    return;
                this._tracker.connect(this._bus, 'g-signal', (_p, _s, signal, params) => {
                    if (signal !== 'NameOwnerChanged')
                        return;
                    const [name, oldOwner, newOwner] = params.deepUnpack();
                    if (!name.startsWith(PREFIX))
                        return;
                    if (oldOwner)
                        this._remove(name);
                    if (newOwner)
                        this._add(name);
                });
                this._bus.call('ListNames', null, Gio.DBusCallFlags.NONE, -1,
                    this._cancellable, (p, r) => {
                        let names;
                        try {
                            names = p.call_finish(r).deepUnpack()[0];
                        } catch (_e) {
                            return;
                        }
                        if (this._stopped)
                            return;
                        for (const n of names.filter(x => x.startsWith(PREFIX)))
                            this._add(n);
                    });
            });
    }

    stop() {
        this._stopped = true;
        this._cancellable?.cancel();
        this._cancellable = null;
        for (const p of this._players.values())
            p.destroy();
        this._players.clear();
        this._pending.clear();
        this._bus = null;
        this._tracker.destroy();
    }

    _add(name) {
        if (this._players.has(name) || this._pending.has(name))
            return;
        this._pending.add(name);
        const make = (iface, cb) => Gio.DBusProxy.new_for_bus(
            Gio.BusType.SESSION, Gio.DBusProxyFlags.GET_INVALIDATED_PROPERTIES, NODE.lookup_interface(iface),
            name, OBJ, iface, this._cancellable, (_o, res) => {
                let proxy;
                try {
                    proxy = Gio.DBusProxy.new_for_bus_finish(res);
                } catch (_e) {
                    this._pending.delete(name);
                    // Cancelled by stop(), or the bus/name went away: nothing to track.
                    return;
                }
                if (this._stopped || !this._pending.has(name))
                    return;
                cb(proxy);
            });
        make(ROOT_IFACE, root => make(PLAYER_IFACE, player => {
            this._pending.delete(name);
            // The name may have vanished while the proxies were being built.
            if (!root.get_name_owner() || !player.get_name_owner())
                return;
            const p = new PlayerProxy(name, root, player, this._tracker, () => this.emit('changed'), () => this._cancellable);
            this._players.set(name, p);
            this._remember(p.appKey);
            this.emit('changed');
        }));
    }

    _remove(name) {
        this._pending.delete(name);
        const p = this._players.get(name);
        if (!p)
            return;
        p.destroy();
        this._players.delete(name);
        this.emit('changed');
    }

    _remember(key) {
        if (!key || !this._settings)
            return;
        const known = this._settings.get_strv('known-players');
        if (!known.includes(key))
            this._settings.set_strv('known-players', [...known, key]);
    }
}
