// SPDX-License-Identifier: GPL-2.0-or-later
// Wave geometry shared by the pill and popup wave areas.

// [amplitude, frequency, phase, alpha]
export const LAYERS = [[0.9, 1.6, 0.0, 0.35], [0.65, 2.3, 1.7, 0.4], [0.45, 3.1, 3.4, 0.5]];

export function envelope(x, w) {
    return Math.sin(Math.PI * Math.min(1, Math.max(0, x / w)));
}

export function beat(t) {
    return 0.55 + 0.45 * Math.abs(Math.sin(2.6 * t)) ** 6 + 0.15 * Math.sin(7.3 * t);
}

// level is the 0..1 ease toward flat; layer i uses speed 0.9 + 0.35 * i.
export function bandOffset(x, w, h, freq, speed, phase, amp, t, intensity, level) {
    const v = Math.sin(x / w * Math.PI * freq + t * speed + phase) *
        h * 0.32 * amp * (intensity / 100) * level * envelope(x, w);
    return Math.min(h / 2, Math.abs(v) + 0.5);
}

// Simulated equalizer: the 0..1 target level of a band at time t (seconds), where
// f is its position from 0 (lowest) to 1 (highest) and seed varies the bands.
// A ~123 bpm kick drives the lows, a snare the mids, and a slow wobble the rest.
export function eqTarget(f, t, seed) {
    const kick = Math.max(0, Math.sin(t * 2 * Math.PI * 2.05)) ** 10;
    const snare = Math.max(0, Math.sin(t * Math.PI * 2.05 + 1.6)) ** 14;
    const tilt = 0.85 - 0.45 * f;
    const wobble = 0.5 + 0.5 * Math.sin(t * (1.3 + f * 5) + seed) * Math.sin(t * (0.7 + f * 2.1) + seed * 1.7);
    return Math.min(1, tilt * (0.25 + 0.55 * wobble) + kick * (1 - f) * 0.55 +
        snare * Math.exp(-((f - 0.55) ** 2) / 0.03) * 0.5);
}
