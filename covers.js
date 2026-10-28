// SPDX-License-Identifier: GPL-2.0-or-later
// Cover-art colors: dominant colors of a file:// cover, cached by URL.
// Anything that is not a readable file:// image resolves to BLUE; never throws or logs.
import Gio from 'gi://Gio';
import GdkPixbuf from 'gi://GdkPixbuf';

import {BLUE, customShades, dominantColors} from './colors.js';

const SIZE = 80;
const CACHE_MAX = 32;
const cache = new Map();

function load(artUrl) {
    return new Promise(resolve => {
        try {
            if (!artUrl?.startsWith('file://')) {
                resolve(BLUE);
                return;
            }
            const file = Gio.File.new_for_uri(artUrl);
            file.read_async(0, null, (f, res) => {
                try {
                    const stream = f.read_finish(res);
                    GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(stream, SIZE, SIZE, false, null,
                        (_o, r) => {
                            try {
                                const pb = GdkPixbuf.Pixbuf.new_from_stream_finish(r);
                                stream.close_async(0, null, null);
                                resolve(dominantColors(rgbPixels(pb)));
                            } catch (_e) {
                                resolve(BLUE);
                            }
                        });
                } catch (_e) {
                    resolve(BLUE);
                }
            });
        } catch (_e) {
            resolve(BLUE);
        }
    });
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
    const key = artUrl ?? '';
    if (!cache.has(key)) {
        if (cache.size >= CACHE_MAX)
            cache.delete(cache.keys().next().value);
        cache.set(key, load(key));
    }
    return cache.get(key);
}

export function waveColors(settings, artUrl) {
    const mode = settings.get_string('wave-color-mode');
    if (mode === 'custom')
        return Promise.resolve(customShades(settings.get_string('wave-custom-color')));
    if (mode === 'cover')
        return coverColors(artUrl);
    return Promise.resolve(BLUE);
}
