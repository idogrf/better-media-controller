// SPDX-License-Identifier: GPL-2.0-or-later
import {check, finish, near} from './assert.js';
import {customShades, BLUE, dominantColors} from '../colors.js';

check('shades dark', customShades('#ff7ab6')[0] === '#cc6292');
check('shades light of black', customShades('#000000')[2] === '#8c8c8c');
check('shades base', customShades('#ff7ab6')[1] === '#ff7ab6');
check('BLUE', BLUE.join() === '#4fb3f5,#8fd0ff,#d6efff');

function lightness(hex) {
    const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
    return (Math.max(...c) + Math.min(...c)) / 2;
}
const px = new Uint8Array(80 * 80 * 3);
for (let i = 0; i < 80 * 80; i++) {
    px[i * 3] = 0x2f;
    px[i * 3 + 1] = 0x8f;
    px[i * 3 + 2] = 0x8a;
}
const dom = dominantColors(px);
check('3 entries', dom.length === 3);
check('all lifted to L>=0.62', dom.every(h => lightness(h) >= 0.62 - 0.01));
check('hex format', dom.every(h => /^#[0-9a-f]{6}$/.test(h)));

// two-tone image: saturated red half beats gray half
const two = new Uint8Array(80 * 80 * 3);
for (let i = 0; i < 80 * 80; i++) {
    const red = i % 80 < 40;
    two[i * 3] = red ? 200 : 128;
    two[i * 3 + 1] = red ? 30 : 128;
    two[i * 3 + 2] = red ? 30 : 128;
}
const d2 = dominantColors(two);
check('saturated color ranks first', parseInt(d2[0].slice(1, 3), 16) > parseInt(d2[0].slice(3, 5), 16) + 40);
check('near helper', near(1, 1));
finish();
