export const GAME_MODE = {
    SINGLE: 'single',
    LOCAL_COOP: 'coop'
};

export function getGameMode() {
    const params = new URLSearchParams(window.location.search);
    return params.get('mode') === GAME_MODE.LOCAL_COOP
        ? GAME_MODE.LOCAL_COOP
        : GAME_MODE.SINGLE;
}

export function buildModeUrl(mode) {
    const url = new URL(window.location.href);
    if (mode === GAME_MODE.LOCAL_COOP) {
        url.searchParams.set('mode', GAME_MODE.LOCAL_COOP);
    } else {
        url.searchParams.delete('mode');
    }
    return url;
}

