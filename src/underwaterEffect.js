import { CONFIG } from './config.js';

const EFFECT_CONFIG = CONFIG.agua?.efeitoSubmerso ?? {};
const DEFAULT_OPACITY = EFFECT_CONFIG.opacidade ?? 0.62;
const DEEP_OPACITY = EFFECT_CONFIG.opacidadeProfunda ?? 0.82;
const DARKEN_DEPTH = Math.max(0.1, EFFECT_CONFIG.profundidadeEscurecimento ?? 9);
const DEFAULT_PULSE = EFFECT_CONFIG.pulso ?? 0.08;

function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}

function updateViewportLayout(viewport, index, count) {
    if (count <= 1) {
        viewport.style.left = '0%';
        viewport.style.right = '0%';
        viewport.style.width = 'auto';
        return;
    }

    const width = 100 / count;
    viewport.style.left = `${index * width}%`;
    viewport.style.right = `${100 - (index + 1) * width}%`;
    viewport.style.width = `${width}%`;
}

function getUnderwaterState(player, getSample) {
    const vitals = player?.vitals;
    if (vitals && Number.isFinite(vitals.underwaterDepth)) {
        if (!vitals.isUnderwater && vitals.underwaterDepth <= 0.05) {
            return { amount: 0, depthRatio: 0 };
        }
        return {
            amount: vitals.isUnderwater || vitals.underwaterDepth > 0.05 ? 1 : 0,
            depthRatio: clamp01(vitals.underwaterDepth / DARKEN_DEPTH)
        };
    }

    const position = player?.position;
    const sample = position ? getSample?.(position.x, position.z) : null;
    const surfaceY = sample?.water?.surfaceY;
    const depthBelowSurface = Number.isFinite(surfaceY) && position
        ? surfaceY - position.y
        : 0;
    const isUnderwater = player?.vitals?.isUnderwater || depthBelowSurface > 0.05;
    if (!isUnderwater) {
        return { amount: 0, depthRatio: 0 };
    }

    const depthRatio = clamp01(depthBelowSurface / DARKEN_DEPTH);
    return { amount: 1, depthRatio };
}

export function createUnderwaterEffect(getSample) {
    const root = document.createElement('div');
    root.id = 'underwater-effect';
    document.body.appendChild(root);

    const viewports = new Map();
    let elapsed = 0;

    function getOrCreateViewport(playerId) {
        let item = viewports.get(playerId);
        if (item) return item;

        const viewport = document.createElement('div');
        viewport.className = 'underwater-effect-viewport';

        const surface = document.createElement('div');
        surface.className = 'underwater-effect-surface';
        viewport.appendChild(surface);
        root.appendChild(viewport);

        item = { viewport, surface };
        viewports.set(playerId, item);
        return item;
    }

    function update(modeState = {}, delta = 0) {
        elapsed += delta;
        const players = modeState.players ?? [];
        const activeIds = new Set();

        players.forEach((player, index) => {
            const playerId = player?.id ?? `player-${index + 1}`;
            activeIds.add(playerId);
            const item = getOrCreateViewport(playerId);
            updateViewportLayout(item.viewport, index, players.length);

            const underwater = getUnderwaterState(player, getSample);
            const pulse = Math.sin(elapsed * 2.4 + index * 0.7) * DEFAULT_PULSE;
            const baseOpacity = DEFAULT_OPACITY + (DEEP_OPACITY - DEFAULT_OPACITY) * underwater.depthRatio;
            const opacity = underwater.amount * clamp01(baseOpacity + pulse);
            item.viewport.classList.toggle('is-underwater', underwater.amount > 0);
            item.surface.style.setProperty('--underwater-depth-dark', (underwater.depthRatio * 0.42).toFixed(3));
            item.surface.style.setProperty('--underwater-brightness', (1 - underwater.depthRatio * 0.42).toFixed(3));
            item.surface.style.opacity = opacity.toFixed(3);
        });

        for (const [id, item] of viewports) {
            if (activeIds.has(id)) continue;
            item.viewport.remove();
            viewports.delete(id);
        }
    }

    function dispose() {
        root.remove();
        viewports.clear();
    }

    if (EFFECT_CONFIG.ativo === false) {
        root.style.display = 'none';
    }

    return { update, dispose };
}
