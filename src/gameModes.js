export const GAME_MODE = {
    SINGLE: 'single',
    LOCAL_COOP: 'coop',
    ONLINE: 'online'
};

export function getGameMode() {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get('mode');
    if (mode === GAME_MODE.LOCAL_COOP) return GAME_MODE.LOCAL_COOP;
    if (mode === GAME_MODE.ONLINE) return GAME_MODE.ONLINE;
    return GAME_MODE.SINGLE;
}

export function getOnlineParams() {
    const params = new URLSearchParams(window.location.search);
    return {
        room: (params.get('room') || '').trim().toUpperCase(),
        isHost: params.get('host') === '1'
    };
}

export function buildModeUrl(mode) {
    const url = new URL(window.location.href);
    if (mode === GAME_MODE.LOCAL_COOP) {
        url.searchParams.set('mode', GAME_MODE.LOCAL_COOP);
    } else {
        url.searchParams.delete('mode');
    }
    url.searchParams.delete('room');
    url.searchParams.delete('host');
    return url;
}

export function buildOnlineHostUrl(code, seedText) {
    const url = new URL(window.location.href);
    url.searchParams.set('mode', GAME_MODE.ONLINE);
    url.searchParams.set('room', String(code).toUpperCase());
    url.searchParams.set('host', '1');
    if (seedText) {
        url.searchParams.set('seed', String(seedText).trim());
    }
    return url;
}

export function buildOnlineJoinUrl(code, seedText) {
    const url = new URL(window.location.href);
    url.searchParams.set('mode', GAME_MODE.ONLINE);
    url.searchParams.set('room', String(code).toUpperCase());
    url.searchParams.delete('host');
    if (seedText) {
        url.searchParams.set('seed', String(seedText).trim());
    }
    return url;
}
