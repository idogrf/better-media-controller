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
