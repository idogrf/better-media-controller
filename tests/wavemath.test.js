// SPDX-License-Identifier: GPL-2.0-or-later
import {check, finish} from './assert.js';
import {LAYERS, envelope, beat, bandOffset} from '../wavemath.js';

check('3 layers', LAYERS.length === 3);
check('envelope ends', Math.abs(envelope(0, 100)) < 1e-9 && Math.abs(envelope(100, 100)) < 1e-9);
check('envelope mid is 1', Math.abs(envelope(50, 100) - 1) < 1e-9);

const w = 200;
const h = 30;
check('bandOffset 0.5 at x=0', bandOffset(0, w, h, 1.6, 0.9, 0, 0.9, 1.3, 100, 1) === 0.5);
check('bandOffset 0.5 at x=w', Math.abs(bandOffset(w, w, h, 1.6, 0.9, 0, 0.9, 1.3, 100, 1) - 0.5) < 1e-9);
let ok = true;
let flat = true;
for (let x = 0; x <= w; x += 3) {
    for (let t = 0; t < 10; t += 0.7) {
        if (bandOffset(x, w, h, 3.1, 1.6, 3.4, 0.45, t, 150, 1) > h / 2)
            ok = false;
        if (bandOffset(x, w, h, 3.1, 1.6, 3.4, 0.45, t, 150, 0) !== 0.5)
            flat = false;
    }
}
check('bandOffset <= h/2', ok);
check('bandOffset 0.5 at level 0', flat);
let lo = Infinity;
let hi = -Infinity;
for (let t = 0; t <= 20; t += 0.01) {
    lo = Math.min(lo, beat(t));
    hi = Math.max(hi, beat(t));
}
check('beat within [0.4, 1.15]', lo >= 0.4 && hi <= 1.15);
finish();
