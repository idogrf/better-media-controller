// SPDX-License-Identifier: GPL-2.0-or-later
// The panel pill: wave behind an icon (app/cover cross-fade), a marquee label
// and prev/play/next buttons. Every timer goes through the pill's own Tracker.
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import {appIconFor} from './applogo.js';
import {resolveCover, waveColors} from './covers.js';
import {BLUE} from './colors.js';
import {labelText} from './label.js';
import {activePlayer, visiblePlayers} from './players.js';
import {Tracker} from './track.js';
import {WaveArea} from './wave.js';

const HEIGHT = 26;
const RTL_RANGES = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/u;

// True when the first letter of the text is from a right-to-left script.
function isRtl(text) {
    const m = text.match(/\p{L}/u);
    return m !== null && RTL_RANGES.test(m[0]);
}
const FADE_MS = 800;
const COLLAPSE_MS = 300;
const GAP_MS = 1200;
// Space between the end of the text and the start of its looping copy.
const LOOP_GAP_PX = 48;

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
        this._hideDelay = 0;
        this._iconTimer = null;
        this._iconTimerKey = '';
        this._altCover = false;
        this._marqueeGen = 0;
        this._marqueeKey = '';
        this._colorKey = '';
        this._colorToken = 0;
        this._iconKey = '';
        this._text = '';
        this._rtl = false;
        this._hasCover = false;
        this._artUrl = null;
        this._coverUri = null;
        this._coverCancel = null;
        this._placeIdle = null;

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
        this._appIcon = new St.Icon({
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER,
        });
        this._cover = new St.Bin({x_expand: true, y_expand: true, opacity: 0});
        this._iconBox.add_child(this._appIcon);
        this._iconBox.add_child(this._cover);

        this._labelBox = new St.Widget({
            clip_to_allocation: true,
            y_align: Clutter.ActorAlign.CENTER,
            height: HEIGHT,
        });
        this._label = new St.Label({style_class: 'bmc-label'});
        // A trailing copy of the label, so the marquee loops without a jump.
        this._labelCopy = new Clutter.Clone({source: this._label, opacity: 0});
        this._label.bind_property('translation-x', this._labelCopy, 'translation-x',
            GObject.BindingFlags.SYNC_CREATE);
        this._labelBox.add_child(this._label);
        this._labelBox.add_child(this._labelCopy);
        this._tracker.connect(this._label, 'notify::height', () => this._placeLabel());
        this._tracker.connect(this._label, 'notify::width', () => {
            this._placeLabel();
            this._syncMarquee();
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
            this._placeLabel();
            this._syncMarquee();
        });
        this.connect('destroy', () => this._onPillDestroy());
        this._refresh();
    }

    // Re-applies visibility; the panel shows the container when it adds the pill.
    refresh() {
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
            this._resetCollapse();
            this._tracker.cancel(this._coverCancel);
            this._coverCancel = null;
            this._artUrl = null;
            this._coverUri = null;
            this._hasCover = false;
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
        this._iconBox.style = `border-radius: ${Math.ceil(size / 2)}px; ` +
            'background-color: rgba(255, 255, 255, 0.1); box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.13);';
        this._appIcon.icon_size = Math.round(size * 0.7);
        this._labelBox.width = s.get_int('label-width');
        // Without scrolling the label is clamped to the box so it ellipsizes.
        this._label.set_width(s.get_boolean('label-scroll') ? -1 : s.get_int('label-width'));
        this._placeLabel();

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

    // Vertically centered; RTL text is right-aligned so its start stays visible.
    // Positions are set from an idle, not from the allocation callbacks that
    // trigger this: moving an actor mid-allocation makes Clutter warn.
    _placeLabel() {
        if (this._placeIdle !== null)
            return;
        this._placeIdle = this._tracker.addIdle(() => {
            this._placeIdle = null;
            if (this._destroyed || !this._label.has_allocation())
                return false;
            this._label.y = Math.round((HEIGHT - this._label.height) / 2);
            this._label.x = this._rtl ? this._labelBox.width - this._label.width : 0;
            this._labelCopy.y = this._label.y;
            this._labelCopy.x = this._label.x + (this._label.width + LOOP_GAP_PX) * (this._rtl ? -1 : 1);
            return false;
        });
    }

    _applyText() {
        const p = this._player;
        const s = this._settings;
        const text = labelText(p.title, p.artist, s.get_string('label-show'),
            s.get_string('label-separator'), s.get_int('label-max-length'));
        if (text !== this._text) {
            this._text = text;
            this._rtl = isRtl(text);
            this._label.text = text;
            this._placeLabel();
        }
        this._play.child.icon_name = p.status === 'Playing'
            ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
    }

    // --- icon -------------------------------------------------------------------

    _applyIcon() {
        const p = this._player;
        const key = `${p.appKey}|${p.desktopEntry}|${p.identity}`;
        if (key !== this._iconKey) {
            this._iconKey = key;
            const gicon = appIconFor(p.desktopEntry, p.identity);
            if (gicon)
                this._appIcon.gicon = gicon;
            else
                this._appIcon.icon_name = 'audio-x-generic-symbolic';
        }
        if (p.artUrl !== this._artUrl)
            this._resolveArt(p.artUrl);
        this._applyCoverStyle();
        this._fadeIcon();
    }

    // The app logo stays until the resolved cover (local file, cache or download) is ready.
    _resolveArt(url) {
        this._artUrl = url;
        this._coverUri = null;
        this._hasCover = false;
        this._tracker.cancel(this._coverCancel);
        const cancellable = this._tracker.newCancellable();
        this._coverCancel = cancellable;
        resolveCover(url, cancellable).then(uri => {
            if (this._destroyed || !this._player || cancellable !== this._coverCancel || !uri)
                return;
            this._coverUri = uri;
            this._hasCover = true;
            this._applyCoverStyle();
            this._applyWave();
            this._syncIconTimer();
            this._fadeIcon();
        });
    }

    _applyCoverStyle() {
        const size = this._settings.get_int('icon-size');
        this._cover.style = this._coverUri
            ? `background-image: url("${this._coverUri}"); background-size: ${size}px ${size}px; ` +
              `border-radius: ${Math.ceil(size / 2)}px;`
            : '';
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
        const want = this._shown() && this._player.status === 'Playing' && this._hasCover &&
            s.get_string('icon-mode') === 'alternate'
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
        const key = `${s.get_string('wave-color-mode')}|${s.get_string('wave-custom-color')}|${this._coverUri}`;
        if (key === this._colorKey)
            return;
        this._colorKey = key;
        const token = ++this._colorToken;
        waveColors(s, this._coverUri).then(colors => {
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
        const playing = this._shown() && this._label.mapped && this._label.has_allocation() &&
            this._player.status === 'Playing';
        const width = s.get_int('label-width');
        const textWidth = Math.ceil(this._label.get_preferred_width(-1)[1]);
        const overflow = playing && s.get_boolean('label-scroll') ? textWidth - width : 0;
        const speed = s.get_int('label-scroll-speed');
        const key = overflow > 0 ? `${overflow}|${speed}|${this._rtl}|${this._text}` : '';
        if (key === this._marqueeKey)
            return;
        this._marqueeKey = key;
        this._marqueeGen++;
        this._label.remove_all_transitions();
        this._label.translation_x = 0;
        // Opacity, not visible: this can run mid-allocation, where showing an actor warns.
        this._labelCopy.opacity = overflow > 0 ? 255 : 0;
        if (overflow > 0) {
            // One loop moves the copy to where the label started, then jumps back
            // to 0, which looks identical. Constant speed: 12 to 48 px/s.
            const period = textWidth + LOOP_GAP_PX;
            this._marqueeRun(this._marqueeGen, this._rtl ? period : -period,
                period / (8 + 4 * speed) * 1000, GAP_MS);
        }
    }

    // distance is negative for LTR text and positive for RTL text. Only the
    // first loop waits before it starts.
    _marqueeRun(gen, distance, duration, delay) {
        // If the transition completes before ease() returns (unmapped actor,
        // animations off), do not loop: that would recurse forever.
        let sync = true;
        this._label.ease({
            translation_x: distance,
            duration,
            delay,
            mode: Clutter.AnimationMode.LINEAR,
            onComplete: () => {
                if (sync) {
                    this._label.translation_x = 0;
                    this._marqueeKey = '';
                    return;
                }
                if (this._destroyed || gen !== this._marqueeGen)
                    return;
                this._label.translation_x = 0;
                this._marqueeRun(gen, distance, duration, 0);
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
        const delay = s.get_int('hide-delay');
        if (this._collapsed || (this._hideTimer !== null && delay === this._hideDelay))
            return;
        // A changed delay replaces the pending timer instead of keeping the old one.
        this._cancelHide();
        this._hideDelay = delay;
        this._hideTimer = this._tracker.addTimeout(delay * 1000, () => {
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

    // Undo any collapse (also one still easing) so the pill is never left 0-wide.
    _resetCollapse() {
        this._collapsed = false;
        this.remove_all_transitions();
        this.set_width(-1);
        this.opacity = 255;
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
