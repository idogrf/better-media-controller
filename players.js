// SPDX-License-Identifier: GPL-2.0-or-later
// Player selection. A record is {id, appKey, status, title, playingSince, lastActive}.
export function appKey(desktopEntry, identity) {
    return (desktopEntry || identity || '').toLowerCase();
}

export function visiblePlayers(players, mode, list) {
    return players.filter(p => {
        if (!p.title)
            return false;
        if (mode === 'only')
            return list.includes(p.appKey);
        if (mode === 'except')
            return !list.includes(p.appKey);
        return true;
    });
}

export function activePlayer(players) {
    let best = null;
    for (const p of players) {
        if (p.status === 'Playing' && (!best || p.playingSince > best.playingSince))
            best = p;
    }
    if (best)
        return best;
    for (const p of players) {
        if (!best || p.lastActive > best.lastActive)
            best = p;
    }
    return best;
}

export function popupOrder(players, activeId, cap = 4) {
    const active = players.filter(p => p.id === activeId);
    const rest = players.filter(p => p.id !== activeId)
        .sort((a, b) => b.lastActive - a.lastActive);
    return [...active, ...rest].slice(0, cap);
}
