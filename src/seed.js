const SEED_PARAM = 'seed';

export function hashSeedText(seedText) {
    const text = String(seedText || '').trim();
    let hash = 2166136261;

    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }

    return hash >>> 0;
}

export function createRandomSeedText() {
    if (globalThis.crypto?.getRandomValues) {
        const values = new Uint32Array(2);
        globalThis.crypto.getRandomValues(values);
        return `${values[0].toString(36)}${values[1].toString(36)}`;
    }

    return `${Date.now().toString(36)}${Math.floor(Math.random() * 0xffffffff).toString(36)}`;
}

export function resolveWorldSeed() {
    const url = new URL(window.location.href);
    let text = url.searchParams.get(SEED_PARAM)?.trim();

    if (!text) {
        text = createRandomSeedText();
        url.searchParams.set(SEED_PARAM, text);
        window.history.replaceState(null, '', url);
    }

    return {
        text,
        numeric: hashSeedText(text)
    };
}

export function buildSeedUrl(seedText) {
    const url = new URL(window.location.href);
    url.searchParams.set(SEED_PARAM, String(seedText).trim());
    return url;
}
