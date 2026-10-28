// SPDX-License-Identifier: GPL-2.0-or-later
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

import {check, finish} from './assert.js';
import {Tracker, totals} from '../track.js';

const Emitter = GObject.registerClass({
    Signals: {ping: {}},
}, class Emitter extends GObject.Object {});

function spin(ms) {
    const loop = new GLib.MainLoop(null, false);
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        loop.quit();
        return GLib.SOURCE_REMOVE;
    });
    loop.run();
}

const t = new Tracker();
const c = t.counts;
check('counts starts at 0/0', c.sources === 0 && c.signals === 0);

t.addTimeout(100000, () => true);
t.addTimeout(100000, () => true);
check('2 addTimeout -> 2 sources', t.counts.sources === 2);

t.addTimeout(10, () => false);
check('one-shot counted while pending', t.counts.sources === 3);
spin(60);
check('one-shot dropped after it fires', t.counts.sources === 2);

let idleRan = false;
t.addIdle(() => {
    idleRan = true;
    return false;
});
spin(30);
check('idle ran and was dropped', idleRan && t.counts.sources === 2);

const id = t.addTimeout(100000, () => true);
t.remove(id);
check('remove drops a source', t.counts.sources === 2);

t.clear();
check('clear resets sources to 0', t.counts.sources === 0);

const e = new Emitter();
let calls = 0;
t.connect(e, 'ping', () => calls++);
check('connect counts 1 signal', t.counts.signals === 1);
e.emit('ping');
check('handler fires before clear', calls === 1);
t.clear();
check('clear resets signals to 0', t.counts.signals === 0);
e.emit('ping');
check('handler not called after clear', calls === 1);

const hid = t.connect(e, 'ping', () => calls++);
t.disconnect(e, hid);
check('disconnect drops a signal', t.counts.signals === 0);

const t2 = new Tracker();
t.addTimeout(100000, () => true);
t2.addTimeout(100000, () => true);
t2.connect(e, 'ping', () => {});
const tot = totals();
check('totals sums two trackers', tot.sources === 2 && tot.signals === 1);
t.clear();
t2.clear();
check('totals back to 0/0', totals().sources === 0 && totals().signals === 0);

// A throwing callback still drops its source from the count.
const t3 = new Tracker();
t3.addTimeout(10, () => {
    throw new Error('expected test error');
});
spin(60);
check('throwing source is dropped', t3.counts.sources === 0);

// destroy() clears and unregisters the tracker from totals().
t3.addTimeout(100000, () => true);
t3.connect(e, 'ping', () => {});
check('t3 counted in totals', totals().sources === 1 && totals().signals === 1);
t3.destroy();
check('destroy clears t3', t3.counts.sources === 0 && t3.counts.signals === 0);
check('destroy unregisters t3', totals().sources === 0 && totals().signals === 0);

finish();
