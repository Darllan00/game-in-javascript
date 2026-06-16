import { CONFIG } from './config.js';

const DROWNING_SAFE_TIME = CONFIG.mecanicas?.afogamento?.tempoSeguro ?? 10;

function createPlayerViewport(player) {
    const viewport = document.createElement('div');
    viewport.className = 'combat-hud-viewport';
    viewport.dataset.playerId = player.id;

    const cluster = document.createElement('div');
    cluster.className = 'combat-hud-cluster';

    const row = document.createElement('div');
    row.className = 'combat-hud-player';

    const label = document.createElement('div');
    label.className = 'combat-hud-label';

    const healthTrack = document.createElement('div');
    healthTrack.className = 'combat-hud-health-track';

    const healthFill = document.createElement('div');
    healthFill.className = 'combat-hud-health-fill';
    healthTrack.appendChild(healthFill);

    const breathTrack = document.createElement('div');
    breathTrack.className = 'combat-hud-breath-track';

    const breathFill = document.createElement('div');
    breathFill.className = 'combat-hud-breath-fill';
    breathTrack.appendChild(breathFill);

    const dashTrack = document.createElement('div');
    dashTrack.className = 'combat-hud-dash-track';

    const dashFill = document.createElement('div');
    dashFill.className = 'combat-hud-dash-fill';
    dashTrack.appendChild(dashFill);

    const status = document.createElement('div');
    status.className = 'combat-hud-status';

    row.append(label, healthTrack, dashTrack, breathTrack, status);
    cluster.appendChild(row);

    const deathScreen = document.createElement('div');
    deathScreen.className = 'combat-death-screen';

    const deathTitle = document.createElement('div');
    deathTitle.className = 'combat-death-title';
    deathTitle.textContent = 'Voce morreu';
    deathScreen.appendChild(deathTitle);

    viewport.append(cluster, deathScreen);

    return {
        viewport,
        row,
        label,
        healthFill,
        breathFill,
        dashFill,
        status,
        deathTitle
    };
}

function formatHealth(vitals) {
    const health = Number.isFinite(vitals?.health) ? vitals.health : 0;
    const maxHealth = Number.isFinite(vitals?.maxHealth) && vitals.maxHealth > 0
        ? vitals.maxHealth
        : 100;
    return `${Math.ceil(health)} / ${Math.ceil(maxHealth)}`;
}

function formatStatus(player) {
    if (player.vitals?.isDead) return 'Morto';
    if (player.dash?.isActive) return 'Dash';
    if (player.bow?.isCharging) return `Arco ${player.bow.level}`;
    return '';
}

function getBreathRatio(vitals) {
    if (!vitals?.isUnderwater) return 1;
    return Math.max(0, 1 - vitals.underwaterTime / DROWNING_SAFE_TIME);
}

function clampRatio(value, fallback = 0) {
    if (!Number.isFinite(value)) return fallback;
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

export function createCombatHud() {
    const root = document.createElement('div');
    root.id = 'combat-hud';
    document.body.appendChild(root);

    const viewports = new Map();

    function update(players = []) {
        root.classList.toggle('is-coop', players.length > 1);

        const activeIds = new Set();
        players.forEach((player, index) => {
            if (!player?.vitals) return;

            const playerId = player.id ?? `player-${index + 1}`;
            activeIds.add(playerId);
            let item = viewports.get(playerId);
            if (!item) {
                item = createPlayerViewport({ ...player, id: playerId });
                viewports.set(playerId, item);
                root.appendChild(item.viewport);
            }

            updateViewportLayout(item.viewport, index, players.length);

            const healthRatio = player.vitals.maxHealth > 0
                ? player.vitals.health / player.vitals.maxHealth
                : 0;
            const breathRatio = clampRatio(getBreathRatio(player.vitals), 1);
            const dashRatio = clampRatio(player.dash?.progress ?? 1, 1);

            item.viewport.classList.toggle('is-dead', player.vitals.isDead);
            item.row.classList.toggle('is-dead', player.vitals.isDead);
            item.row.classList.toggle('is-underwater', player.vitals.isUnderwater);
            item.row.classList.toggle('is-dashing', player.dash?.isActive === true);
            item.label.textContent = `${player.label || `Player ${index + 1}`}: ${formatHealth(player.vitals)}`;
            item.healthFill.style.width = `${clampRatio(healthRatio) * 100}%`;
            item.breathFill.style.width = `${breathRatio * 100}%`;
            item.dashFill.style.width = `${dashRatio * 100}%`;
            item.status.textContent = formatStatus(player);
            item.deathTitle.textContent = players.length > 1
                ? `${player.label || `Player ${index + 1}`} morreu`
                : 'Voce morreu';
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

    return {
        update,
        dispose
    };
}
