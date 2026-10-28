// SPDX-License-Identifier: GPL-2.0-or-later
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {GnomePlayerHider} from './gnomeplayer.js';
import {Pill} from './indicator.js';
import {MprisWatcher} from './mpris.js';
import {PopupStack} from './popup.js';
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

        this._tracker = new Tracker();
        this._hider = new GnomePlayerHider(this._tracker);
        this._hider.setHidden(this._settings.get_boolean('hide-gnome-player'));
        for (const key of ['panel-side', 'panel-index'])
            this._tracker.connect(this._settings, `changed::${key}`, () => this._addPill());
        this._tracker.connect(this._settings, 'changed::hide-gnome-player',
            () => this._hider.setHidden(this._settings.get_boolean('hide-gnome-player')));
        this._popup = new PopupStack(this._settings, this._watcher);
        this._addPill();

        const {sources, signals} = totals();
        debugLog(this._settings, `stats enable sources=${sources} signals=${signals}`);
    }

    disable() {
        this._popup.destroy();
        this._popup = null;
        this._pill?.destroy();
        this._pill = null;
        this._hider.destroy();
        this._hider = null;
        this._tracker.destroy();
        this._tracker = null;
        this._watcher.stop();
        this._watcher = null;
        const {sources, signals} = totals();
        debugLog(this._settings, `stats disable sources=${sources} signals=${signals}`);
        this._settings = null;
    }

    // Destroys any existing pill first so a side/index change never leaks one.
    _addPill() {
        this._popup.close();
        this._pill?.destroy();
        const pill = new Pill(this, this._settings, this._watcher);
        pill.connect('toggle-popup', () => {
            debugLog(this._settings, 'toggle-popup');
            if (this._popup.isOpen)
                this._popup.close();
            else
                this._popup.open(pill);
        });
        this._pill = pill;
        Main.panel.addToStatusArea(this.uuid, pill, this._settings.get_int('panel-index'),
            this._settings.get_string('panel-side'));
    }
}
