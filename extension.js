// SPDX-License-Identifier: GPL-2.0-or-later
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {MprisWatcher} from './mpris.js';
import {Tracker, debugLog, totals} from './track.js';

export default class BetterMediaController extends Extension {
    enable() {
        this._settings = this.getSettings();
        const tracker = new Tracker();
        this._watcher = new MprisWatcher(tracker, this._settings);
        tracker.connect(this._watcher, 'changed', () => {
            const list = this._watcher.players.map(p => `${p.id}:${p.status}:${p.title}`);
            debugLog(this._settings, `players ${list.join(' ')}`);
        });
        this._watcher.start();
        // TEMP: Task 7 replaces this position probe.
        tracker.addTimeout(2000, () => {
            for (const p of this._watcher.players)
                p.positionUs().then(us => debugLog(this._settings, `pos ${p.id} ${us}`));
            return true;
        });
        const {sources, signals} = totals();
        debugLog(this._settings, `stats enable sources=${sources} signals=${signals}`);
    }

    disable() {
        this._watcher.stop();
        this._watcher = null;
        const {sources, signals} = totals();
        debugLog(this._settings, `stats disable sources=${sources} signals=${signals}`);
        this._settings = null;
    }
}
