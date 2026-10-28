// SPDX-License-Identifier: GPL-2.0-or-later
// The panel pill: wave behind an icon (app/cover cross-fade), a marquee label
// and prev/play/next buttons. Every timer goes through the pill's own Tracker.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import {waveColors} from './covers.js';
import {BLUE} from './colors.js';
import {labelText} from './label.js';
import {activePlayer, visiblePlayers} from './players.js';
import {Tracker} from './track.js';
import {WaveArea} from './wave.js';

const HEIGHT = 26;
const FADE_MS = 800;
const COLLAPSE_MS = 300;
const GAP_MS = 1200;

// Keys that affect the pill; everything else (popup-*, known-players, ...) is ignored.
const KEY_PREFIXES = ['icon-', 'label-', 'element-order', 'hide-when-paused', 'hide-delay',
    'wave-', 'player-filter'];

export const Pill = GObject.registerClass({
    Signals: {'toggle-popup': {}},
}, class Pill extends PanelMenu.Button {
    _init(extension, settings, watcher) {
        super._init(0.5, 'Better Media Controller', true);
        this.add_style_class_name('bmc-button');
        this._extension = extension;
        this._settings = settings;
        this._watcher = watcher;
        this._tracker = new Tracker();
        this._destroyed = false;
        this._player = null;
        this._collapsed = false;
        this._hideTimer = null;
        this._iconTimer = null;
        this._iconTimerKey = '';
        this._altCover = false;
        this._marqueeGen = 0;
        this._marqueeKey = '';
        this._colorKey = '';
        this._colorToken = 0;
        this._iconKey = '';
        this._text = '';
        this._hasCover = false;

        this._pill = new St.Widget({
            style_class: 'bmc-pill',
            layout_manager: new Clutter.BinLayout(),
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._pill);

        this._wave = new WaveArea({
            mode: 'pulse', colors: BLUE, settings, name: 'pill',
            x_expand: true, y_expand: true,
        });
        this._pill.add_child(this._wave);

        this._row = new St.BoxLayout({
            style_class: 'bmc-row',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._pill.add_child(this._row);

        this._iconBox = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._appIcon = new St.Icon({x_expand: true, y_expand: true});
        this._cover = new St.Bin({x_expand: true, y_expand: true, opacity: 0});
        this._iconBox.add_child(this._appIcon);
        this._iconBox.add_child(this._cover);

        this._labelBox = new St.Widget({
            clip_to_allocation: true,
            y_align: Clutter.ActorAlign.CENTER,
            height: HEIGHT,
        });
        this._label = new St.Label({style_class: 'bmc-label'});
        this._labelBox.add_child(this._label);
        this._tracker.connect(this._label, 'notify::height', () => {
            this._label.y = Math.round((HEIGHT - this._label.height) / 2);
        });

        this._controls = new St.BoxLayout({
            style_class: 'bmc-controls',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._prev = this._button('media-skip-backward-symbolic', () => this._player?.previous());
        this._play = this._button('media-playback-start-symbolic', () => this._player?.playPause());
        this._next = this._button('media-skip-forward-symbolic', () => this._player?.next());
        this._controls.add_child(this._prev);
        this._controls.add_child(this._play);
        this._controls.add_child(this._next);

        // Clicks on the pill itself (not on its buttons) toggle the popup.
        const click = new Clutter.ClickGesture();
        click.connect('recognize', () => this.emit('toggle-popup'));
        this.add_action(click);

        this._tracker.connect(this._watcher, 'changed', () => this._refresh());
        this._tracker.connect(this._settings, 'changed', (_s, key) => {
            if (KEY_PREFIXES.some(p => key.startsWith(p)))
                this._refresh();
        });
        // The label maps after the pill, so key off the label itself.
        this._tracker.connect(this._label, 'notify::mapped', () => {
            this._syncMarquee();
        });
        this.connect('destroy', () => this._onPillDestroy());
        this._refresh();
    }

    get player() {
        return this._player;
    }

    _button(iconName, cb) {
        const b = new St.Button({
            style_class: 'bmc-btn',
            reactive: true,
            can_focus: true,
            track_hover: true,
            child: new St.Icon({icon_name: iconName, icon_size: 14}),
        });
        this._tracker.connect(b, 'clicked', cb);
        return b;
    }

    _shown() {
        return !this._destroyed && this._player !== null && !this._collapsed;
    }

    _refresh() {
        if (this._destroyed)
            return;
        const s = this._settings;
        this._player = activePlayer(visiblePlayers(this._watcher.players,
            s.get_string('player-filter-mode'), s.get_strv('player-filter-list')));

        if (!this._player) {
            this._cancelHide();
            this._collapsed = false;
            this.container.hide();
            this._wave.setPlaying(false);
            this._syncMarquee();
            this._syncIconTimer();
            return;
        }
        this._syncHide();
        if (!this._collapsed)
            this.container.show();

        this._applyLayout();
        this._applyText();
        this._applyIcon();
        this._applyWave();
        this._syncMarquee();
        this._syncIconTimer();
    }

    // --- layout, text and style -------------------------------------------------

    _applyLayout() {
        const s = this._settings;
        const size = s.get_int('icon-size');
        this._iconBox.set_size(size, size);
        this._appIcon.icon_size = size;
        this._labelBox.width = s.get_int('label-width');

        const order = s.get_string('element-order');
        const parts = {
            icon: this._iconBox,
            label: this._labelBox,
            controls: this._controls,
        };
        const names = order.split('-');
        const desired = names.map(n => parts[n]);
        const current = this._row.get_children();
        if (desired.some((a, i) => current[i] !== a)) {
            for (const c of current)
                this._row.remove_child(c);
            for (const a of desired)
                this._row.add_child(a);
        }

        const font = s.get_string('label-font');
        const color = s.get_boolean('label-color-enabled') ? s.get_string('label-color') : '#e8eef4';
        this._label.style = [
            font ? `font-family: "${font.replace(/"/g, '')}";` : '',
            `font-size: ${s.get_double('label-font-size')}px;`,
            `font-weight: ${s.get_boolean('label-bold') ? 'bold' : 'normal'};`,
            `color: ${color};`,
        ].join(' ');
        this._label.clutter_text.ellipsize = s.get_boolean('label-scroll')
            ? Pango.EllipsizeMode.NONE : Pango.EllipsizeMode.END;
    }

    _applyText() {
        const p = this._player;
        const s = this._settings;
        const text = labelText(p.title, p.artist, s.get_string('label-show'),
            s.get_string('label-separator'), s.get_int('label-max-length'));
        if (text !== this._text) {
            this._text = text;
            this._label.text = text;
        }
        this._play.child.icon_name = p.status === 'Playing'
            ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
    }

    // --- icon -------------------------------------------------------------------

    _coverAvailable() {
        const url = this._player?.artUrl;
        if (!url?.startsWith('file://'))
            return false;
        try {
            return Gio.File.new_for_uri(url).query_exists(null);
        } catch (_e) {
            return false;
        }
    }

    _applyIcon() {
        const p = this._player;
        const size = this._settings.get_int('icon-size');
        const key = `${p.appKey}|${p.desktopEntry}|${p.artUrl}|${size}`;
        if (key !== this._iconKey) {
            this._iconKey = key;
            const sys = Shell.AppSystem.get_default();
            const entry = p.desktopEntry;
            const app = entry ? (sys.lookup_app(`${entry}.desktop`) ?? sys.lookup_app(entry)) : null;
            const gicon = app?.get_icon();
            if (gicon)
                this._appIcon.gicon = gicon;
            else
                this._appIcon.icon_name = 'audio-x-generic-symbolic';
            this._hasCover = this._coverAvailable();
            this._cover.style = this._hasCover
                ? `background-image: url("${p.artUrl}"); background-size: ${size}px ${size}px; ` +
                  `border-radius: ${Math.round(size / 4)}px;`
                : '';
        }
        this._fadeIcon();
    }

    _wantCover() {
        const mode = this._settings.get_string('icon-mode');
        if (!this._hasCover || mode === 'app')
            return false;
        return mode === 'cover' || this._altCover;
    }

    _fadeIcon() {
        const cover = this._wantCover();
        const target = cover ? 255 : 0;
        if (this._cover.opacity === target && this._cover.get_transition('opacity') === null)
            return;
        this._cover.ease({opacity: target, duration: FADE_MS, mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD});
        this._appIcon.ease({opacity: cover ? 0 : 255, duration: FADE_MS, mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD});
    }

    // The interval timer exists only while shown, alternating and a cover exists;
    // changing the interval replaces it rather than adding another.
    _syncIconTimer() {
        const s = this._settings;
        const want = this._shown() && this._hasCover && s.get_string('icon-mode') === 'alternate'
            ? s.get_int('icon-interval') : 0;
        const key = String(want);
        if (key === this._iconTimerKey)
            return;
        if (this._iconTimer !== null)
            this._tracker.remove(this._iconTimer);
        this._iconTimer = null;
        this._iconTimerKey = key;
        if (!want)
            return;
        this._iconTimer = this._tracker.addTimeout(want * 1000, () => {
            this._altCover = !this._altCover;
            this._fadeIcon();
            return true;
        });
    }

    // --- wave -------------------------------------------------------------------

    _applyWave() {
        const s = this._settings;
        const p = this._player;
        this._wave.visible = s.get_boolean('wave-pill');
        this._wave.setIntensity(s.get_int('wave-intensity'));
        this._wave.setSpeed(s.get_int('wave-speed'));
        this._wave.setPlaying(p.status === 'Playing');
        const key = `${s.get_string('wave-color-mode')}|${s.get_string('wave-custom-color')}|${p.artUrl}`;
        if (key === this._colorKey)
            return;
        this._colorKey = key;
        const token = ++this._colorToken;
        waveColors(s, p.artUrl).then(colors => {
            if (!this._destroyed && token === this._colorToken)
                this._wave.setColors(colors);
        });
    }

    // --- marquee ----------------------------------------------------------------

    // Runs only while playing, shown and the text overflows; restarts only when
    // its inputs change.
    _syncMarquee() {
        const s = this._settings;
        // Measuring needs the widget in the stage; notify::mapped refreshes again.
        const playing = this._shown() && this._label.mapped && this._player.status === 'Playing';
        const width = s.get_int('label-width');
        const overflow = playing && s.get_boolean('label-scroll')
            ? Math.ceil(this._label.get_preferred_width(-1)[1]) - width : 0;
        const speed = s.get_int('label-scroll-speed');
        const key = overflow > 0 ? `${overflow}|${speed}|${this._text}` : '';
        if (key === this._marqueeKey)
            return;
        this._marqueeKey = key;
        this._marqueeGen++;
        this._label.remove_all_transitions();
        this._label.translation_x = 0;
        if (overflow > 0)
            this._marqueeRun(this._marqueeGen, overflow, (22 - 1.8 * speed) * 1000);
    }

    _marqueeRun(gen, overflow, duration) {
        // If the transition completes before ease() returns (unmapped actor,
        // animations off), do not loop: that would recurse forever.
        let sync = true;
        this._label.ease({
            translation_x: -overflow,
            duration,
            delay: GAP_MS,
            mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
            onComplete: () => {
                if (sync) {
                    this._label.translation_x = 0;
                    this._marqueeKey = '';
                    return;
                }
                if (this._destroyed || gen !== this._marqueeGen)
                    return;
                this._label.translation_x = 0;
                this._marqueeRun(gen, overflow, duration);
            },
        });
        sync = false;
    }

    // --- hide when paused -------------------------------------------------------

    _cancelHide() {
        if (this._hideTimer !== null)
            this._tracker.remove(this._hideTimer);
        this._hideTimer = null;
    }

    _syncHide() {
        const s = this._settings;
        const want = s.get_boolean('hide-when-paused') && this._player.status !== 'Playing';
        if (!want) {
            this._cancelHide();
            if (this._collapsed)
                this._expand();
            return;
        }
        if (this._collapsed || this._hideTimer !== null)
            return;
        this._hideTimer = this._tracker.addTimeout(s.get_int('hide-delay') * 1000, () => {
            this._hideTimer = null;
            this._collapse();
            return false;
        });
    }

    _collapse() {
        this._collapsed = true;
        this.set_width(this.width);
        this.ease({
            width: 0,
            opacity: 0,
            duration: COLLAPSE_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                if (!this._destroyed && this._collapsed)
                    this.container.hide();
            },
        });
        this._syncMarquee();
        this._syncIconTimer();
    }

    _expand() {
        this._collapsed = false;
        this.remove_all_transitions();
        this.set_width(-1);
        this.opacity = 0;
        this.container.show();
        this.ease({opacity: 255, duration: COLLAPSE_MS, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    }

    _onPillDestroy() {
        this._destroyed = true;
        this._marqueeGen++;
        this._tracker.destroy();
    }
});
