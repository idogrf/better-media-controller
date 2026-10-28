// SPDX-License-Identifier: GPL-2.0-or-later
// Pure helpers for cover art URLs: classification, cache file names and the
// larger-image candidates. No I/O, so they are unit-tested with plain gjs.
import GLib from 'gi://GLib';

// 'local' (file:// URL or absolute path), 'remote' (http/https) or 'unsupported'.
export function classifyArt(artUrl) {
    if (typeof artUrl !== 'string' || artUrl === '')
        return 'unsupported';
    if (artUrl.startsWith('file://') || artUrl.startsWith('/'))
        return 'local';
    if (/^https?:\/\/[^/\s]+/i.test(artUrl))
        return 'remote';
    return 'unsupported';
}

// The cache file name for a URL: the hex MD5 of the URL.
export function cacheName(url) {
    return GLib.compute_checksum_for_string(GLib.ChecksumType.MD5, url, -1);
}

// URLs to try, best first. Spotify covers come in size codes; ab67616d0000b273 is 640x640.
export function coverCandidates(url) {
    const m = /^(https?:\/\/i\.scdn\.co\/image\/)ab67616d0000[0-9a-f]{4}([0-9a-f]+)$/i.exec(url);
    if (!m)
        return [url];
    const large = `${m[1]}ab67616d0000b273${m[2]}`;
    return large === url ? [url] : [large, url];
}
