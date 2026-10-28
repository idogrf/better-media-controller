// SPDX-License-Identifier: GPL-2.0-or-later
// The popup stack: one slim card per player under the pill. Each card draws its
// own background (blurred cover, cover bleed or glass) in Cairo so the rounded
// corners clip everything, with an outline wave behind the content.
import Cairo from 'gi://cairo';
import Clutter from 'gi://Clutter';
import GdkPixbuf from 'gi://GdkPixbuf';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {BLUE} from './colors.js';
import {coverPixbuf, waveColors} from './covers.js';
import {activePlayer, popupOrder, visiblePlayers} from './players.js';
import {Tracker, debugLog} from './track.js';
import {WaveArea} from './wave.js';

const CARD_H = 132;
const GAP = 10;
const COVER = 96;

function roundedRect(cr, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    cr.newPath();
    cr.moveTo(x + r, y);
    cr.lineTo(x + w - r, y);
    cr.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
    cr.lineTo(x + w, y + h - r);
    cr.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
    cr.lineTo(x + r, y + h);
    cr.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
    cr.lineTo(x, y + r);
    cr.arc(x + r, y + r, r, Math.PI, 3 * Math.PI / 2);
    cr.closePath();
}

// Blur by shrinking the cover to a tiny image (applying saturation and brightness
// on it) and drawing that tiny image back up with Cairo's smooth filter. The tiny
// image becomes an ARGB32 surface, so no GDK/GTK is involved.
const MAX_TINY = 48;

function tinyCover(pb, tw, th, radius, sat, bright) {
    const f = radius > 0 ? radius * 0.8 + 1 : 1;
    const sw = Math.max(2, Math.min(MAX_TINY, Math.round(tw / f)));
    const sh = Math.max(2, Math.min(MAX_TINY, Math.round(th / f)));
    const small = pb.scale_simple(sw, sh, GdkPixbuf.InterpType.HYPER);
    const n = small.get_n_channels();
    const stride = small.get_rowstride();
    const px = small.get_pixels();
    const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, sw, sh);
    const c = new Cairo.Context(surface);
    const adjust = sat !== 1 || bright !== 1;
    for (let y = 0; y < sh; y++) {
        for (let x = 0; x < sw; x++) {
            const i = y * stride + x * n;
            if (adjust) {
                const gray = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
                const ch = k => Math.max(0, Math.min(255, (gray + (px[i + k] - gray) * sat) * bright)) / 255;
                c.setSourceRGB(ch(0), ch(1), ch(2));
            } else {
                c.setSourceRGB(px[i] / 255, px[i + 1] / 255, px[i + 2] / 255);
            }
            c.rectangle(x, y, 1, 1);
            c.fill();
        }
    }
    c.$dispose();
    return {surface, sw, sh, tw, th};
}

// Paints the tiny image scaled to tw x th with its top-left at (x, y).
function paintTiny(cr, img, x, y) {
    cr.save();
    cr.translate(x, y);
    cr.scale(img.tw / img.sw, img.th / img.sh);
    cr.setSourceSurface(img.surface, 0, 0);
    cr.getSource().setExtend(Cairo.Extend.PAD);
    cr.paint();
    cr.restore();
}

// The card's background layer.
const CardBg = GObject.registerClass(class CardBg extends St.DrawingArea {
    _init() {
        super._init({x_expand: true, y_expand: true});
        this._cover = null;
        this._effect = 'blur';
        this._radius = 22;
        this._blur = 20;
        this._img = null;
        this._imgKey = '';
    }

    configure(effect, radius, blur) {
        // Re-blur only when something that affects the image changed.
        if (effect === this._effect && radius === this._radius && blur === this._blur)
            return;
        this._effect = effect;
        this._radius = radius;
        this._blur = blur;
        this._img = null;
        this._imgKey = '';
        this.queue_repaint();
    }

    setCover(pb) {
        this._cover = pb;
        this._img = null;
        this._imgKey = '';
        this.queue_repaint();
    }

    _prepare(w, h) {
        const key = `${this._effect}|${this._blur}|${w}|${h}`;
        if (key === this._imgKey)
            return;
        this._imgKey = key;
        this._img = null;
        const pb = this._cover;
        if (!pb || this._effect === 'none')
            return;
        const pw = pb.get_width();
        const ph = pb.get_height();
        if (this._effect === 'bleed') {
            const scale = 2.6 * h / ph;
            this._img = tinyCover(pb, Math.round(pw * scale), Math.round(ph * scale),
                this._blur * 0.35, 1, 1);
        } else {
            const glass = this._effect === 'glass';
            const scale = Math.max(w / pw, h / ph) * (glass ? 1.5 : 1.4);
            this._img = tinyCover(pb, Math.round(pw * scale), Math.round(ph * scale),
                this._blur, glass ? 1.4 : 1.2, glass ? 1.05 : 1);
        }
    }

    vfunc_repaint() {
        const cr = this.get_context();
        try {
            const [w, h] = this.get_surface_size();
            if (w <= 0 || h <= 0)
                return;
            this._prepare(w, h);
            const glass = this._effect === 'glass';
            roundedRect(cr, 0, 0, w, h, this._radius);
            cr.clip();

            if (!glass || !this._img) {
                // 160deg gradient, #222c37 to #151c24.
                const a = 160 * Math.PI / 180;
                const dx = Math.sin(a);
                const dy = -Math.cos(a);
                const len = Math.abs(w * dx) + Math.abs(h * dy);
                const g = new Cairo.LinearGradient(w / 2 - dx * len / 2, h / 2 - dy * len / 2,
                    w / 2 + dx * len / 2, h / 2 + dy * len / 2);
                g.addColorStopRGB(0, 0x22 / 255, 0x2c / 255, 0x37 / 255);
                g.addColorStopRGB(1, 0x15 / 255, 0x1c / 255, 0x24 / 255);
                cr.setSource(g);
                cr.paint();
            }

            if (this._effect === 'bleed') {
                if (this._img) {
                    cr.pushGroup();
                    paintTiny(cr, this._img, 0, (h - this._img.th) / 2);
                    cr.popGroupToSource();
                    const m = new Cairo.LinearGradient(0, 0, w, 0);
                    m.addColorStopRGBA(0.1, 0, 0, 0, 1);
                    m.addColorStopRGBA(0.75, 0, 0, 0, 0);
                    cr.mask(m);
                }
                const s = new Cairo.LinearGradient(0, 0, w, 0);
                s.addColorStopRGBA(0, 0, 0, 0, 0.33);
                s.addColorStopRGB(0.75, 0x15 / 255, 0x1c / 255, 0x24 / 255);
                s.addColorStopRGB(1, 0x15 / 255, 0x1c / 255, 0x24 / 255);
                cr.setSource(s);
                cr.paint();
            } else {
                if (this._img) {
                    paintTiny(cr, this._img, (w - this._img.tw) / 2, (h - this._img.th) / 2);
                }
                const s = glass
                    ? new Cairo.LinearGradient(0, 0, 0, h) : new Cairo.LinearGradient(0, 0, w, 0);
                if (glass) {
                    s.addColorStopRGBA(0, 1, 1, 1, 0.133);
                    s.addColorStopRGBA(1, 0, 0, 0, 0.333);
                } else {
                    s.addColorStopRGBA(0, 0, 0, 0, 0.6);
                    s.addColorStopRGBA(1, 0, 0, 0, 0.73);
                }
                cr.setSource(s);
                cr.paint();
            }

            // Inset light border (and a brighter top edge on glass).
            cr.resetClip();
            roundedRect(cr, 0.5, 0.5, w - 1, h - 1, this._radius - 0.5);
            cr.setLineWidth(1);
            cr.setSourceRGBA(1, 1, 1, glass ? 0.25 : 0.08);
            cr.stroke();
            if (glass) {
                cr.moveTo(this._radius, 1.5);
                cr.lineTo(w - this._radius, 1.5);
                cr.setSourceRGBA(1, 1, 1, 0.4);
                cr.stroke();
            }
        } finally {
            cr.$dispose();
        }
    }
});

const PlayerCard = GObject.registerClass(class PlayerCard extends St.Widget {
    _init(settings, player, isOpen) {
        super._init({layout_manager: new Clutter.BinLayout()});
        this._settings = settings;
        this._player = player;
        this._isOpen = isOpen;
        this._tracker = new Tracker();
        this._destroyed = false;
        this._artKey = null;
        this._colorKey = '';
        this._colorToken = 0;
        this._coverToken = 0;
        this._progress = 0;
        this._hasArt = false;
        this._lastStatus = null;

        this._bg = new CardBg();
        this.add_child(this._bg);
        this._wave = new WaveArea({
            mode: 'outline', fade: 0.35, colors: BLUE, settings, name: 'card',
            x_expand: true, y_expand: true,
        });
        this.add_child(this._wave);

        const row = new St.BoxLayout({style_class: 'bmc-card-row', y_align: Clutter.ActorAlign.CENTER,
            x_expand: true});
        this.add_child(row);

        this._art = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            y_align: Clutter.ActorAlign.CENTER, width: COVER, height: COVER,
        });
        this._artIcon = new St.Icon({
            icon_size: 40, x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER,
            x_expand: true, y_expand: true,
        });
        this._art.add_child(this._artIcon);
        row.add_child(this._art);

        const meta = new St.BoxLayout({vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        row.add_child(meta);
        this._title = new St.Label({style_class: 'bmc-card-title'});
        this._artist = new St.Label({style_class: 'bmc-card-artist'});
        for (const l of [this._title, this._artist])
            l.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        meta.add_child(this._title);
        meta.add_child(this._artist);

        const buttons = new St.BoxLayout({style_class: 'bmc-card-buttons', x_align: Clutter.ActorAlign.CENTER});
        this._prev = this._button('media-skip-backward-symbolic', 12, false, () => this._player.previous());
        this._play = this._button('media-playback-start-symbolic', 15, true, () => this._player.playPause());
        this._next = this._button('media-skip-forward-symbolic', 12, false, () => this._player.next());
        buttons.add_child(this._prev);
        buttons.add_child(this._play);
        buttons.add_child(this._next);
        meta.add_child(buttons);

        // No layout manager: the fill sits at x = 0 and only its width changes.
        this._track = new St.Widget({style_class: 'bmc-card-track', x_expand: true});
        this._fill = new St.Widget({style_class: 'bmc-card-fill', width: 0, height: 3, visible: false});
        this._track.add_child(this._fill);
        meta.add_child(this._track);

        this.connect('destroy', () => this._onCardDestroy());
        this.applySettings();
        this.update(player);
    }

    get id() {
        return this._player.id;
    }

    _button(iconName, size, main, cb) {
        const b = new St.Button({
            style_class: main ? 'bmc-cb bmc-cb-main' : 'bmc-cb',
            reactive: true, can_focus: true, track_hover: true,
            child: new St.Icon({icon_name: iconName, icon_size: size}),
        });
        this._tracker.connect(b, 'clicked', cb);
        return b;
    }

    applySettings() {
        const s = this._settings;
        const radius = s.get_int('popup-radius');
        const effect = s.get_string('popup-effect');
        this.set_size(s.get_int('popup-width'), CARD_H);
        this.style = `border-radius: ${radius}px; box-shadow: 0 14px 40px rgba(0, 0, 0, ${effect === 'glass' ? 0.44 : 0.5});`;
        this._bg.configure(effect, radius, s.get_int('popup-blur'));
        this._art.style = this._artStyle();
        const glass = effect === 'glass';
        const shadow = glass ? 'text-shadow: 0 1px 6px rgba(0, 0, 0, 0.6);' : '';
        this._title.style = shadow;
        this._artist.style = shadow;
        this._fill.style = glass ? 'background-color: #ffffff; box-shadow: 0 0 8px #ffffff;' : '';
        this._wave.visible = s.get_boolean('wave-popup');
        this._wave.setClipRadius(radius);
        this._wave.setIntensity(s.get_int('wave-intensity'));
        this._wave.setSpeed(s.get_int('wave-speed'));
        this._syncColors();
    }

    _artStyle() {
        const radius = Math.max(4, this._settings.get_int('popup-radius') * 0.55);
        const url = this._player.artUrl;
        const base = `border-radius: ${Math.round(radius)}px; box-shadow: 0 6px 18px rgba(0, 0, 0, 0.55);`;
        return this._hasArt
            ? `${base} background-image: url("${url}"); background-size: ${COVER}px ${COVER}px;`
            : `${base} background-color: rgba(255, 255, 255, 0.08);`;
    }

    update(player) {
        this._player = player;
        this._title.text = player.title;
        this._artist.text = player.artist;
        this._play.child.icon_name = player.status === 'Playing'
            ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
        this._wave.setPlaying(player.status === 'Playing' && this._isOpen());
        if (player.artUrl !== this._artKey)
            this._loadArt();
        this._syncColors();
        // A status change gets one poll so a paused card shows its frozen position.
        const changed = player.status !== this._lastStatus;
        this._lastStatus = player.status;
        return changed;
    }

    get playing() {
        return this._player.status === 'Playing';
    }

    _loadArt() {
        const url = this._player.artUrl;
        this._artKey = url;
        this._hasArt = false;
        if (url?.startsWith('file://')) {
            try {
                this._hasArt = fileExists(url);
            } catch (_e) {
                this._hasArt = false;
            }
        }
        if (!this._hasArt) {
            const app = appIconFor(this._player.desktopEntry);
            if (app)
                this._artIcon.gicon = app;
            else
                this._artIcon.icon_name = 'audio-x-generic-symbolic';
        }
        this._artIcon.visible = !this._hasArt;
        this._art.style = this._artStyle();
        const token = ++this._coverToken;
        this._bg.setCover(null);
        if (this._hasArt) {
            coverPixbuf(url).then(pb => {
                if (!this._destroyed && token === this._coverToken)
                    this._bg.setCover(pb);
            });
        }
    }

    _syncColors() {
        const s = this._settings;
        const key = `${s.get_string('wave-color-mode')}|${s.get_string('wave-custom-color')}|${this._player.artUrl}`;
        if (key === this._colorKey)
            return;
        this._colorKey = key;
        const token = ++this._colorToken;
        waveColors(s, this._player.artUrl).then(colors => {
            if (!this._destroyed && token === this._colorToken)
                this._wave.setColors(colors);
        });
    }

    // Reads the position asynchronously; ignores the answer if the card or
    // popup went away meanwhile. lengthUs 0 shows 0%.
    poll() {
        if (this._destroyed)
            return;
        const length = this._player.lengthUs;
        if (length <= 0) {
            this._setProgress(0);
            return;
        }
        this._player.positionUs().then(us => {
            if (this._destroyed || !this._isOpen())
                return;
            this._setProgress(Math.max(0, Math.min(1, us / length)));
        });
    }

    _setProgress(p) {
        this._progress = p;
        this._fill.visible = true;
        this._fill.width = Math.round(this._track.width * p);
    }

    _onCardDestroy() {
        this._destroyed = true;
        this._coverToken++;
        this._colorToken++;
        this._tracker.destroy();
    }
});

function fileExists(url) {
    return GLib.file_test(GLib.filename_from_uri(url)[0], GLib.FileTest.EXISTS);
}

function appIconFor(entry) {
    if (!entry)
        return null;
    const sys = Shell.AppSystem.get_default();
    const app = sys.lookup_app(`${entry}.desktop`) ?? sys.lookup_app(entry);
    return app?.get_icon() ?? null;
}

export class PopupStack {
    constructor(settings, watcher) {
        this._settings = settings;
        this._watcher = watcher;
        this._open = false;
        this._actor = null;
        this._grab = null;
        this._tracker = null;
        this._pollId = null;
        this._cards = [];
        this._source = null;
    }

    get isOpen() {
        return this._open;
    }

    open(sourceActor) {
        if (this._open)
            return;
        const list = this._list();
        if (list.length === 0)
            return;
        this._open = true;
        this._source = sourceActor;
        this._tracker = new Tracker();
        this._actor = new St.BoxLayout({vertical: true, reactive: true, style_class: 'bmc-stack'});
        this._actor.connect('destroy', () => {
            this._actor = null;
        });
        this._sync();
        this._position();
        Main.layoutManager.addTopChrome(this._actor);
        this._grab = Main.pushModal(this._actor, {actionMode: Shell.ActionMode.POPUP});
        if (!this._grab) {
            this.close();
            return;
        }

        debugLog(this._settings, 'popup open');
        this._tracker.connect(this._watcher, 'changed', () => this._sync());
        this._tracker.connect(this._settings, 'changed', (_s, key) => {
            if (key.startsWith('popup-') || key.startsWith('wave-') || key.startsWith('player-filter')) {
                for (const c of this._cards)
                    c.applySettings();
                this._position();
            }
        });
        this._tracker.connect(this._actor, 'captured-event', (_a, event) => this._onKey(event));
        const click = new Clutter.ClickGesture();
        this._tracker.connect(click, 'recognize', () => this._onClick(click));
        this._actor.add_action(click);
        // First poll after the cards have been allocated, so the track has a width.
        this._tracker.addTimeout(150, () => {
            for (const c of this._cards)
                c.poll();
            return false;
        });
        this._syncPoll();
    }

    // The 1 s poll exists only while an open card is playing.
    _syncPoll() {
        const want = this._open && this._cards.some(c => c.playing);
        if (want && this._pollId === null) {
            debugLog(this._settings, 'popup poll start');
            this._pollId = this._tracker.addTimeout(1000, () => {
                for (const c of this._cards) {
                    if (c.playing)
                        c.poll();
                }
                return true;
            });
        } else if (!want && this._pollId !== null) {
            this._tracker.remove(this._pollId);
            this._pollId = null;
            debugLog(this._settings, 'popup poll stop');
        }
    }

    close() {
        if (!this._open)
            return;
        this._open = false;
        debugLog(this._settings, 'popup close');
        this._tracker.destroy();
        this._tracker = null;
        this._pollId = null;
        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }
        if (this._actor) {
            Main.layoutManager.removeChrome(this._actor);
            this._actor.destroy();
        }
        this._cards = [];
        this._source = null;
    }

    destroy() {
        this.close();
    }

    _onKey(event) {
        if (event.type() === Clutter.EventType.KEY_PRESS && event.get_key_symbol() === Clutter.KEY_Escape) {
            this.close();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    // With the modal grab, clicks outside the stack are delivered to the stack actor.
    _onClick(gesture) {
        const target = global.stage.get_event_actor(gesture.get_point_event(0));
        if (!this._actor?.contains(target))
            this.close();
    }

    _list() {
        const s = this._settings;
        const visible = visiblePlayers(this._watcher.players, s.get_string('player-filter-mode'),
            s.get_strv('player-filter-list'));
        return popupOrder(visible, activePlayer(visible)?.id ?? null);
    }

    // Adds, removes and reorders cards to match the players; closes when none are left.
    _sync() {
        const list = this._list();
        if (list.length === 0) {
            this.close();
            return;
        }
        for (const card of [...this._cards]) {
            if (!list.some(p => p.id === card.id)) {
                this._cards.splice(this._cards.indexOf(card), 1);
                card.destroy();
            }
        }
        list.forEach((p, i) => {
            let card = this._cards.find(c => c.id === p.id);
            if (card) {
                if (card.update(p) && this._open)
                    card.poll();
            } else {
                card = new PlayerCard(this._settings, p, () => this._open);
                this._cards.push(card);
                this._actor.add_child(card);
                const added = card;
                this._tracker.addTimeout(150, () => {
                    added.poll();
                    return false;
                });
            }
            this._actor.set_child_at_index(card, i);
        });
        this._cards.sort((a, b) => list.findIndex(p => p.id === a.id) - list.findIndex(p => p.id === b.id));
        if (this._open && this._source)
            this._position();
        this._syncPoll();
    }

    // Centered under the pill, clamped to its monitor, GAP below it.
    _position() {
        if (!this._actor || !this._source)
            return;
        const width = this._settings.get_int('popup-width');
        const [px, py] = this._source.get_transformed_position();
        const [pw, ph] = this._source.get_transformed_size();
        const mon = Main.layoutManager.findMonitorForActor(this._source) ?? Main.layoutManager.primaryMonitor;
        const x = Math.round(Math.max(mon.x + 8, Math.min(px + pw / 2 - width / 2, mon.x + mon.width - width - 8)));
        this._actor.set_position(x, Math.round(py + ph + GAP));
    }
}
