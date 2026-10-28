// SPDX-License-Identifier: GPL-2.0-or-later
// Cover-art colors: dominant colors of a file:// cover, cached by URL.
// Anything that is not a readable file:// image resolves to BLUE; never throws or logs.
// Failed loads are not cached, so a later call for the same URL can succeed.
import Gio from 'gi://Gio';
import GdkPixbuf from 'gi://GdkPixbuf';

import {BLUE, customShades, dominantColors} from './colors.js';

const SIZE = 80;
const CACHE_MAX = 32;
const cache = new Map();

// Resolves to a Pixbuf scaled to size x size (aspect kept when `keep`), or null.
function loadPixbuf(artUrl, size, keep) {
    return new Promise(resolve => {
        try {
            if (!artUrl?.startsWith('file://')) {
                resolve(null);
                return;
            }
            const file = Gio.File.new_for_uri(artUrl);
            file.read_async(0, null, (f, res) => {
                try {
                    const stream = f.read_finish(res);
                    GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(stream, size, size, keep, null,
                        (_o, r) => {
                            try {
                                const pb = GdkPixbuf.Pixbuf.new_from_stream_finish(r);
                                stream.close_async(0, null, null);
                                resolve(pb);
                            } catch (_e) {
                                resolve(null);
                            }
                        });
                } catch (_e) {
                    resolve(null);
                }
            });
        } catch (_e) {
            resolve(null);
        }
    });
}

// Resolves to the colors, or null when the image could not be read.
function load(artUrl) {
    return loadPixbuf(artUrl, SIZE, false).then(pb => (pb ? dominantColors(rgbPixels(pb)) : null));
}

// A 256 px cover for the popup backgrounds; null when unreadable. Not cached.
export function coverPixbuf(artUrl) {
    return loadPixbuf(artUrl, 256, true);
}

// Pixbuf (any channel count, rowstride padding) to a packed RGB Uint8Array.
function rgbPixels(pb) {
    const w = pb.get_width();
    const h = pb.get_height();
    const n = pb.get_n_channels();
    const stride = pb.get_rowstride();
    const src = pb.get_pixels();
    const out = new Uint8Array(w * h * 3);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = y * stride + x * n;
            const o = (y * w + x) * 3;
            out[o] = src[i];
            out[o + 1] = src[i + 1];
            out[o + 2] = src[i + 2];
        }
    }
    return out;
}

export function coverColors(artUrl) {
    if (!artUrl?.startsWith('file://'))
        return Promise.resolve(BLUE);
    if (!cache.has(artUrl)) {
        if (cache.size >= CACHE_MAX)
            cache.delete(cache.keys().next().value);
        const p = load(artUrl).then(colors => {
            if (colors === null) {
                if (cache.get(artUrl) === p)
                    cache.delete(artUrl);
                return BLUE;
            }
            return colors;
        });
        cache.set(artUrl, p);
    }
    return cache.get(artUrl);
}

export function waveColors(settings, artUrl) {
    const mode = settings.get_string('wave-color-mode');
    if (mode === 'custom')
        return Promise.resolve(customShades(settings.get_string('wave-custom-color')));
    if (mode === 'cover')
        return coverColors(artUrl);
    return Promise.resolve(BLUE);
}
