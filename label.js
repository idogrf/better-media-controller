// SPDX-License-Identifier: GPL-2.0-or-later
// Pill label text: pick the fields, join them, and truncate with an ellipsis.
export function labelText(title, artist, show, separator, maxLen) {
    let text;
    if (show === 'title')
        text = title;
    else if (show === 'artist')
        text = artist;
    else
        text = artist ? `${title}${separator}${artist}` : title;
    if (text.length > maxLen)
        text = `${text.slice(0, maxLen - 1).trimEnd()}…`;
    return text;
}
