// SPDX-License-Identifier: GPL-2.0-or-later
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {debugLog, totals} from './track.js';

export default class BetterMediaController extends Extension {
    enable() {
        this._settings = this.getSettings();
        const {sources, signals} = totals();
        debugLog(this._settings, `stats enable sources=${sources} signals=${signals}`);
    }

    disable() {
        const {sources, signals} = totals();
        debugLog(this._settings, `stats disable sources=${sources} signals=${signals}`);
        this._settings = null;
    }
}
