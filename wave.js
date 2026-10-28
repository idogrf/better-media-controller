// SPDX-License-Identifier: GPL-2.0-or-later
// Animated wave strip (pill and popup). Draws three mirrored bands with Cairo;
// animates only while mapped and playing (or while easing back to flat).
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {BLUE} from './colors.js';
import {Tracker, debugLog} from './track.js';
import {LAYERS, beat, bandOffset} from './wavemath.js';

const FRAME_MS = 33;

const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);

// Default to BLUE and pad to three entries by repeating.
function normColors(colors) {
    const list = colors?.length ? [...colors] : [...BLUE];
    while (list.length < 3)
        list.push(list[list.length - 1]);
    return list.slice(0, 3).map(rgb);
}

export const WaveArea = GObject.registerClass(class WaveArea extends St.DrawingArea {
    // params: {mode: 'pulse'|'outline', colors: [hex x3], intensity, speed, fade, name, settings,
    // clipRadius (corner radius of the clip; default half the height)}
    // Any other params are forwarded to St.DrawingArea (actor props).
    constructor({mode = 'pulse', colors, intensity = 100, speed = 100, fade = 1,
        name = mode, settings = null, clipRadius = null, ...actorProps} = {}) {
        super(actorProps);
        this._mode = mode;
        this._rgb = normColors(colors);
        this._intensity = intensity;
        this._speed = speed;
        this._fade = fade;
        this._clipRadius = clipRadius;
        this._label = name;
        this._settings = settings;
        this._tracker = new Tracker();
        this._id = null;
        this._playing = false;
        this._level = 0;
        this._target = 0;
        this._t = 0;
        this._frames = 0;
        this._tracker.connect(this, 'notify::mapped', () => {
            if (this.mapped)
                this._maybeStart();
            else
                this._stop();
        });
        this.connect('destroy', () => this._onDestroy());
    }

    get running() {
        return this._id !== null;
    }

    setPlaying(playing) {
        this._playing = playing;
        this._target = playing ? 1 : 0;
        this._maybeStart();
    }

    setColors(colors) {
        this._rgb = normColors(colors);
        this.queue_repaint();
    }

    setClipRadius(r) {
        this._clipRadius = r;
        this.queue_repaint();
    }

    setIntensity(n) {
        this._intensity = n;
        this.queue_repaint();
    }

    setSpeed(n) {
        this._speed = n;
        this.queue_repaint();
    }

    _maybeStart() {
        if (this._id !== null || !this.mapped)
            return;
        if (!this._playing && this._level < 0.02)
            return;
        this._id = this._tracker.addTimeout(FRAME_MS, () => this._tick());
        debugLog(this._settings, `wave start ${this._label}`);
    }

    _stop() {
        if (this._id === null)
            return;
        this._tracker.remove(this._id);
        this._id = null;
        debugLog(this._settings, `wave stop ${this._label}`);
    }

    _tick() {
        this._t += 0.022 * this._speed / 100;
        this._level += (this._target - this._level) * 0.06;
        if (++this._frames % 30 === 0)
            debugLog(this._settings, `frame ${this._label}`);
        if (!this._playing && this._level < 0.02) {
            this._level = 0;
            this.queue_repaint();
            // Returning false drops the source; the tracker forgets it too.
            this._id = null;
            debugLog(this._settings, `wave stop ${this._label}`);
            return GLib.SOURCE_REMOVE;
        }
        this.queue_repaint();
        return GLib.SOURCE_CONTINUE;
    }

    vfunc_repaint() {
        const cr = this.get_context();
        try {
            const [w, h] = this.get_surface_size();
            if (this._level > 0 && w > 0 && h > 0) {
                // Nothing may draw outside the pill's rounded ends.
                const r = Math.min(this._clipRadius ?? h / 2, h / 2, w / 2);
                cr.newPath();
                cr.moveTo(r, 0);
                cr.lineTo(w - r, 0);
                cr.arc(w - r, r, r, -Math.PI / 2, Math.PI / 2);
                cr.lineTo(r, h);
                cr.arc(r, r, r, Math.PI / 2, 3 * Math.PI / 2);
                cr.closePath();
                cr.clip();
                const op = Math.min(1, 0.5 + this._intensity / 200);
                const k = this._mode === 'pulse' ? beat(this._t) : 1;
                cr.setLineWidth(1.2);
                LAYERS.forEach(([a, f, ph, al], i) => {
                    const off = x => bandOffset(x, w, h, f, 0.9 + i * 0.35, ph, a * k,
                        this._t, this._intensity, this._level);
                    cr.newPath();
                    for (let x = 0; x <= w; x += 2)
                        cr.lineTo(x, h / 2 - off(x));
                    for (let x = w; x >= 0; x -= 2)
                        cr.lineTo(x, h / 2 + off(x));
                    cr.closePath();
                    const [r, g, b] = this._rgb[i];
                    if (this._mode === 'pulse') {
                        cr.setSourceRGBA(r, g, b, al * op);
                        cr.fill();
                    } else {
                        cr.setSourceRGBA(r, g, b, 0.75 * this._fade * op);
                        cr.stroke();
                    }
                });
            }
        } finally {
            cr.$dispose();
        }
    }

    _onDestroy() {
        this._stop();
        this._tracker.destroy();
    }
});
