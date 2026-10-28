// SPDX-License-Identifier: GPL-2.0-or-later
import {check, finish} from './assert.js';
import {cacheName, classifyArt, coverCandidates} from '../coverurl.js';

check('file URL is local', classifyArt('file:///tmp/a.jpg') === 'local');
check('absolute path is local', classifyArt('/tmp/a.jpg') === 'local');
check('https is remote', classifyArt('https://i.scdn.co/image/abc') === 'remote');
check('http is remote', classifyArt('http://127.0.0.1:8000/a.jpg') === 'remote');
check('data URI is unsupported', classifyArt('data:image/png;base64,AAAA') === 'unsupported');
check('empty is unsupported', classifyArt('') === 'unsupported');
check('undefined is unsupported', classifyArt(undefined) === 'unsupported');
check('relative path is unsupported', classifyArt('cover.jpg') === 'unsupported');
check('ftp is unsupported', classifyArt('ftp://host/a.jpg') === 'unsupported');
check('bare scheme is unsupported', classifyArt('https://') === 'unsupported');

check('md5 of "a"', cacheName('a') === '0cc175b9c0f1b6a831c399e269772661');
check('md5 of empty', cacheName('') === 'd41d8cd98f00b204e9800998ecf8427e');
check('md5 is 32 hex', /^[0-9a-f]{32}$/.test(cacheName('https://x/y?z=1')));
check('md5 differs per URL', cacheName('https://x/1') !== cacheName('https://x/2'));

const hash = '0123456789abcdef01234567';
const small = `https://i.scdn.co/image/ab67616d00001e02${hash}`;
const large = `https://i.scdn.co/image/ab67616d0000b273${hash}`;
const c = coverCandidates(small);
check('spotify small -> large first, original second', c.length === 2 && c[0] === large && c[1] === small);
check('spotify already large -> just itself', coverCandidates(large).length === 1 && coverCandidates(large)[0] === large);
check('spotify 4851 code rewritten', coverCandidates(`https://i.scdn.co/image/ab67616d00004851${hash}`)[0] === large);
check('other host -> just itself', coverCandidates('https://example.com/image/ab67616d00001e02abcdef')[0] === 'https://example.com/image/ab67616d00001e02abcdef'
    && coverCandidates('https://example.com/image/ab67616d00001e02abcdef').length === 1);
check('non-album spotify image untouched', coverCandidates('https://i.scdn.co/image/ab6761610000e5eb' + hash).length === 1);
finish();
