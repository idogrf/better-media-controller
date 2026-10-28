// SPDX-License-Identifier: GPL-2.0-or-later
// Hides GNOME's built-in media notifications (GNOME 50: MediaMessage entries in
// dateMenu._messageList._messageView) and restores their visibility on demand.
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class GnomePlayerHider {
    constructor(tracker) {
        this._tracker = tracker;
        this._original = new Map();
        this._hiding = false;
        this._source = null;
        this._sourceId = 0;
    }

    _view() {
        return Main.panel.statusArea.dateMenu?._messageList?._messageView ?? null;
    }

    setHidden(hidden) {
        const view = this._view();
        if (!view)
            return;
        this._hiding = hidden;
        if (hidden) {
            if (!this._sourceId) {
                this._source = view._mediaSource;
                // Runs after the view's own handler, so the new message exists.
                this._sourceId = this._tracker.connect(this._source, 'player-added', () => this._hideAll());
            }
            this._hideAll();
        } else {
            this._release();
            // Only messages still owned by the view; removed ones are gone.
            for (const message of view._playerToMessage.values()) {
                if (this._original.has(message))
                    message.visible = this._original.get(message);
            }
            this._original.clear();
        }
    }

    _hideAll() {
        const view = this._view();
        if (!view || !this._hiding)
            return;
        const live = new Set(view._playerToMessage.values());
        for (const m of this._original.keys()) {
            if (!live.has(m))
                this._original.delete(m);
        }
        for (const message of live) {
            if (!this._original.has(message))
                this._original.set(message, message.visible);
            message.visible = false;
        }
    }

    _release() {
        if (this._sourceId)
            this._tracker.disconnect(this._source, this._sourceId);
        this._sourceId = 0;
        this._source = null;
    }

    destroy() {
        this.setHidden(false);
        this._release();
    }
}
