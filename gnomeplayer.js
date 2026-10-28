// SPDX-License-Identifier: GPL-2.0-or-later
// Hides GNOME's built-in media notifications (GNOME 50: MediaMessage entries in
// dateMenu._messageList._messageView) and restores their visibility on demand.
// GNOME re-shows each card from its own session-mode and policy handlers (e.g. after
// an unlock), so while hiding we also force `visible` back to false on every change.
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class GnomePlayerHider {
    constructor(tracker) {
        this._tracker = tracker;
        this._original = new Map();
        this._hooks = new Map();
        this._forcing = false;
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
                this._unhook(message);
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
        for (const m of [...this._original.keys()]) {
            if (!live.has(m)) {
                this._unhook(m);
                this._original.delete(m);
            }
        }
        for (const message of live) {
            if (!this._original.has(message))
                this._original.set(message, message.visible);
            if (!this._hooks.has(message)) {
                const visible = this._tracker.connect(message, 'notify::visible', () => {
                    if (this._hiding && !this._forcing && message.visible) {
                        this._forcing = true;
                        message.visible = false;
                        this._forcing = false;
                    }
                });
                // Drop the hooks while the message is still alive; disconnecting from a
                // disposed object later would log a CRITICAL.
                const destroy = this._tracker.connect(message, 'destroy', () => {
                    this._unhook(message);
                    this._original.delete(message);
                });
                this._hooks.set(message, {visible, destroy});
            }
            message.visible = false;
        }
    }

    _unhook(message) {
        const ids = this._hooks.get(message);
        if (!ids)
            return;
        this._hooks.delete(message);
        this._tracker.disconnect(message, ids.visible);
        this._tracker.disconnect(message, ids.destroy);
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
