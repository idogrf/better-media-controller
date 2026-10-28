// SPDX-License-Identifier: GPL-2.0-or-later
// Color helpers: custom wave shades and dominant cover colors.
export const BLUE = ['#4fb3f5', '#8fd0ff', '#d6efff'];

const hex2 = n => Math.round(n).toString(16).padStart(2, '0');
const toHex = ([r, g, b]) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;
const fromHex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

export function customShades(hex) {
    const c = fromHex(hex);
    return [
        toHex(c.map(v => v * 0.8)),
        toHex(c),
        toHex(c.map(v => v + (255 - v) * 0.55)),
    ];
}

function rgbToHls([r, g, b]) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min)
        return [0, l, 0];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r)
        h = ((g - b) / d) % 6;
    else if (max === g)
        h = (b - r) / d + 2;
    else
        h = (r - g) / d + 4;
    return [(h * 60 + 360) % 360, l, s];
}

function hlsToRgb([h, l, s]) {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;
    let rgb;
    if (h < 60)
        rgb = [c, x, 0];
    else if (h < 120)
        rgb = [x, c, 0];
    else if (h < 180)
        rgb = [0, c, x];
    else if (h < 240)
        rgb = [0, x, c];
    else if (h < 300)
        rgb = [x, 0, c];
    else
        rgb = [c, 0, x];
    return rgb.map(v => (v + m) * 255);
}

// Median cut: repeatedly split the most populous splittable box at the median
// of its widest channel until there are 8 boxes.
function quantize(pixels, boxes = 8) {
    const all = [];
    for (let i = 0; i + 2 < pixels.length; i += 3)
        all.push([pixels[i], pixels[i + 1], pixels[i + 2]]);
    const range = box => {
        let best = {ch: 0, span: -1};
        for (let ch = 0; ch < 3; ch++) {
            let lo = 255;
            let hi = 0;
            for (const p of box) {
                lo = Math.min(lo, p[ch]);
                hi = Math.max(hi, p[ch]);
            }
            if (hi - lo > best.span)
                best = {ch, span: hi - lo};
        }
        return best;
    };
    const list = [all];
    while (list.length < boxes) {
        let idx = -1;
        let info = null;
        for (let i = 0; i < list.length; i++) {
            if (list[i].length < 2)
                continue;
            const r = range(list[i]);
            if (r.span > 0 && (idx < 0 || list[i].length > list[idx].length)) {
                idx = i;
                info = r;
            }
        }
        if (idx < 0)
            break;
        const box = list[idx].sort((a, b) => a[info.ch] - b[info.ch]);
        const mid = box.length >> 1;
        list.splice(idx, 1, box.slice(0, mid), box.slice(mid));
    }
    return list.filter(b => b.length > 0).map(b => {
        const sum = [0, 0, 0];
        for (const p of b)
            for (let k = 0; k < 3; k++)
                sum[k] += p[k];
        return {count: b.length, rgb: sum.map(v => v / b.length)};
    });
}

export function dominantColors(pixels, count = 3) {
    const scored = quantize(pixels).map(({count: n, rgb}) => {
        const [h, l, s] = rgbToHls(rgb);
        let score = n * (0.2 + s);
        if (l < 0.15 || l > 0.85)
            score *= 0.2;
        return {score, hls: [h, l, s]};
    }).sort((a, b) => b.score - a.score).slice(0, count);
    const out = scored.map(({hls: [h, l, s]}) =>
        toHex(hlsToRgb([h, Math.max(l, 0.62), Math.min(1, s * 1.15)])));
    while (out.length < count)
        out.push(out[out.length % Math.max(1, scored.length)] ?? BLUE[1]);
    return out;
}
