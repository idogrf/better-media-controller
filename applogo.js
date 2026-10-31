// SPDX-License-Identifier: GPL-2.0-or-later
// Finds a player's own app: DesktopEntry.desktop, then heuristic basename, then the
// desktop wmclass, then the MPRIS Identity matched against app names. Null if none matches.
import Shell from 'gi://Shell';

export function appFor(desktopEntry, identity) {
    try {
        const sys = Shell.AppSystem.get_default();
        let app = null;
        if (desktopEntry) {
            app = sys.lookup_app(`${desktopEntry}.desktop`) ??
                sys.lookup_heuristic_basename(desktopEntry) ??
                sys.lookup_desktop_wmclass(desktopEntry);
        }
        if (!app && identity) {
            const want = identity.toLowerCase();
            const info = sys.get_installed().find(i => i.get_name()?.toLowerCase() === want);
            if (info)
                app = sys.lookup_app(info.get_id());
        }
        return app;
    } catch (_e) {
        return null;
    }
}

export function appIconFor(desktopEntry, identity) {
    return appFor(desktopEntry, identity)?.get_icon() ?? null;
}
