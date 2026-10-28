// SPDX-License-Identifier: GPL-2.0-or-later
// Animated wave strip (pill and popup). Draws three mirrored bands, or a simulated
// equalizer, with Cairo; animates only while mapped and playing (or while easing
// back to flat).
import Cairo from 'gi://cairo';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {BLUE} from './colors.js';
import {Tracker, debugLog} from './track.js';
import {LAYERS, beat, bandOffset, eqTarget} from './wavemath.js';

const FRAME_MS = 33;
const EQ_MODES = new Set(['bars', 'peaks', 'led']);
// Simulated bands; each repaint resamples them to however many bars fit.
const EQ_BANDS = 48;
const EQ_BAR = 3;
const EQ_GAP = 2;
const EQ_PAD = 3;
const EQ_EDGE = 10;

const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);

// Default to BLUE and pad to three entries by repeating.
function normColors(colors) {
    const list = colors?.length ? [...colors] : [...BLUE];
    while (list.length < 3)
        list.push(list[list.length - 1]);
    return list.slice(0, 3).map(rgb);
}

export const WaveArea = GObject.registerClass(class WaveArea extends St.DrawingArea {
    // params: {mode: 'pulse'|'outline'|'bars'|'peaks'|'led', colors: [hex x3], intensity, speed, fade, name, settings,
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
        this._eqT = 0;
        this._bands = new Float64Array(EQ_BANDS);
        this._peaks = new Float64Array(EQ_BANDS);
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

    setMode(mode) {
        if (mode === this._mode)
            return;
        this._mode = mode;
        this._bands.fill(0);
        this._peaks.fill(0);
        this.queue_repaint();
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
        if (EQ_MODES.has(this._mode))
            this._stepEq(FRAME_MS / 1000 * this._speed / 100);
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

    // Bands jump up fast and fall slowly; peak caps fall slower still. The pause
    // ease (_level) scales the targets, so the bars sink with it.
    _stepEq(dt) {
        this._eqT += dt;
        for (let i = 0; i < EQ_BANDS; i++) {
            const target = eqTarget(i / (EQ_BANDS - 1), this._eqT, i * 2.4) * this._level;
            const rate = target > this._bands[i] ? 22 : 6;
            this._bands[i] += (target - this._bands[i]) * Math.min(1, dt * rate);
            this._peaks[i] = Math.max(this._bands[i], this._peaks[i] - dt * 0.35);
        }
    }

    vfunc_repaint() {
        const cr = this.get_context();
        try {
            const [w, h] = this.get_surface_size();
            if (this._level > 0 && w > 0 && h > 0) {
                const op = Math.min(1, 0.5 + this._intensity / 200);
                if (EQ_MODES.has(this._mode))
                    this._drawEq(cr, w, h, op);
                else
                    this._drawWave(cr, w, h, op);
            }
        } finally {
            cr.$dispose();
        }
    }

    _drawWave(cr, w, h, op) {
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

    // Bars rise from the bottom, colored dark to light upwards, and fade out over
    // the last EQ_EDGE pixels at both ends.
    _drawEq(cr, w, h, op) {
        const bottom = h - EQ_PAD;
        const span = h - 2 * EQ_PAD;
        const n = Math.max(1, Math.floor((w + EQ_GAP) / (EQ_BAR + EQ_GAP)));
        const x0 = Math.floor((w - (n * (EQ_BAR + EQ_GAP) - EQ_GAP)) / 2);
        const scale = this._intensity / 100;
        const at = (arr, i) => {
            const p = n === 1 ? 0 : i / (n - 1) * (EQ_BANDS - 1);
            const j = Math.floor(p);
            const k = p - j;
            return Math.min(1, (arr[j] * (1 - k) + arr[Math.min(EQ_BANDS - 1, j + 1)] * k) * scale);
        };
        const alpha = 0.6 * op;
        const grad = new Cairo.LinearGradient(0, bottom, 0, EQ_PAD);
        [0, 0.6, 1].forEach((stop, i) => grad.addColorStopRGBA(stop, ...this._rgb[i], alpha));

        cr.pushGroup();
        cr.setSource(grad);
        for (let i = 0; i < n; i++) {
            const x = x0 + i * (EQ_BAR + EQ_GAP);
            const v = Math.max(1.5, at(this._bands, i) * span);
            if (this._mode === 'led') {
                // Blocks 2px tall with 1px gaps; at least one is always lit.
                const blocks = Math.max(1, Math.round(v / 3));
                for (let b = 0; b < blocks; b++)
                    cr.rectangle(x, bottom - b * 3 - 2, EQ_BAR, 2);
            } else {
                cr.rectangle(x, bottom - v, EQ_BAR, v);
            }
        }
        cr.fill();
        if (this._mode === 'peaks') {
            const [r, g, b] = this._rgb[2];
            cr.setSourceRGBA(r, g, b, Math.min(1, alpha + 0.2));
            for (let i = 0; i < n; i++) {
                const p = Math.max(1.5, at(this._peaks, i) * span);
                cr.rectangle(x0 + i * (EQ_BAR + EQ_GAP), Math.round(bottom - p - 2), EQ_BAR, 1);
            }
            cr.fill();
        }
        cr.popGroupToSource();
        const edge = Math.min(0.5, EQ_EDGE / w);
        const mask = new Cairo.LinearGradient(0, 0, w, 0);
        mask.addColorStopRGBA(0, 0, 0, 0, 0);
        mask.addColorStopRGBA(edge, 0, 0, 0, 1);
        mask.addColorStopRGBA(1 - edge, 0, 0, 0, 1);
        mask.addColorStopRGBA(1, 0, 0, 0, 0);
        cr.mask(mask);
    }

    _onDestroy() {
        this._stop();
        this._tracker.destroy();
    }
});
