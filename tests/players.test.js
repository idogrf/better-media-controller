// SPDX-License-Identifier: GPL-2.0-or-later
import {check, finish} from './assert.js';
import {appKey, visiblePlayers, activePlayer, popupOrder} from '../players.js';

const p = (id, key, status, since, last, title = 't') =>
    ({id, appKey: key, status, title, playingSince: since, lastActive: last});

check('appKey fallback to identity', appKey('', 'Mozilla Firefox') === 'mozilla firefox');
check('appKey prefers desktopEntry', appKey('Spotify', 'Other') === 'spotify');

const list = [p('a', 'spotify', 'Playing', 1, 1), p('b', 'vlc', 'Playing', 5, 5),
    p('c', 'x', 'Paused', 0, 9, '')];
check('empty title dropped', visiblePlayers(list, 'all', []).length === 2);
const only = visiblePlayers(list, 'only', ['spotify']);
check('only keeps spotify', only.length === 1 && only[0].appKey === 'spotify');
const exc = visiblePlayers(list, 'except', ['spotify']);
check('except drops spotify', exc.length === 1 && exc[0].appKey === 'vlc');

check('two playing -> larger playingSince', activePlayer(list).id === 'b');
const paused = [p('a', 'a', 'Paused', 0, 3), p('b', 'b', 'Stopped', 0, 7)];
check('none playing -> larger lastActive', activePlayer(paused).id === 'b');
check('empty -> null', activePlayer([]) === null);

const six = [];
for (let i = 0; i < 6; i++)
    six.push(p(`p${i}`, `k${i}`, 'Paused', 0, i));
const ord = popupOrder(six, 'p1');
check('popupOrder capped at 4', ord.length === 4);
check('popupOrder active first', ord[0].id === 'p1');
check('popupOrder rest by lastActive desc', ord[1].id === 'p5' && ord[2].id === 'p4' && ord[3].id === 'p3');
finish();
