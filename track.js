// SPDX-License-Identifier: GPL-2.0-or-later
// Lifecycle tracker: owns every GLib source and signal handler so disable()
// can tear everything down in one call.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const trackers = new Set();

export class Tracker {
    constructor() {
        this._sources = new Set();
        this._signals = [];
        this._cancellables = new Set();
        trackers.add(this);
    }

    // Repeats while fn returns true; a source that finishes is dropped.
    addTimeout(ms, fn) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            let again = false;
            try {
                again = fn() === true;
            } finally {
                if (!again)
                    this._sources.delete(id);
            }
            return again ? GLib.SOURCE_CONTINUE : GLib.SOURCE_REMOVE;
        });
        this._sources.add(id);
        return id;
    }

    addIdle(fn) {
        const id = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            let again = false;
            try {
                again = fn() === true;
            } finally {
                if (!again)
                    this._sources.delete(id);
            }
            return again ? GLib.SOURCE_CONTINUE : GLib.SOURCE_REMOVE;
        });
        this._sources.add(id);
        return id;
    }

    remove(id) {
        if (!this._sources.delete(id))
            return;
        GLib.source_remove(id);
    }

    connect(obj, signal, fn) {
        const handlerId = obj.connect(signal, fn);
        this._signals.push({obj, handlerId});
        return handlerId;
    }

    disconnect(obj, handlerId) {
        const i = this._signals.findIndex(
            s => s.obj === obj && s.handlerId === handlerId);
        if (i < 0)
            return;
        this._signals.splice(i, 1);
        obj.disconnect(handlerId);
    }

    // A Gio.Cancellable owned by this tracker: cancelled by cancel() or clear().
    newCancellable() {
        const c = new Gio.Cancellable();
        this._cancellables.add(c);
        return c;
    }

    cancel(c) {
        if (!c || !this._cancellables.delete(c))
            return;
        c.cancel();
    }

    clear() {
        for (const c of this._cancellables)
            c.cancel();
        this._cancellables.clear();
        for (const id of this._sources)
            GLib.source_remove(id);
        this._sources.clear();
        for (const {obj, handlerId} of this._signals) {
            try {
                obj.disconnect(handlerId);
            } catch (_e) {
                // Object already finalized; nothing left to disconnect.
            }
        }
        this._signals = [];
    }

    destroy() {
        this.clear();
        trackers.delete(this);
    }

    get counts() {
        return {sources: this._sources.size, signals: this._signals.length};
    }
}

export const totals = () => {
    let sources = 0;
    let signals = 0;
    for (const t of trackers) {
        const c = t.counts;
        sources += c.sources;
        signals += c.signals;
    }
    return {sources, signals};
};

export function debugLog(settings, msg) {
    if (settings?.get_boolean('debug-stats'))
        console.log(`[bmc-debug] ${msg}`);
}
