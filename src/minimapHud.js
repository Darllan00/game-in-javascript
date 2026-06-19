const MAP_SIZE = 156;
const MAP_PIXELS = 78;
const MAP_RADIUS_WORLD = 96;
const TERRAIN_UPDATE_INTERVAL = 0.28;
const TERRAIN_MOVE_THRESHOLD = 5;

const PLAYER_COLORS = [
    '#4fc3ff',
    '#ff9f38',
    '#50d66f',
    '#ff5a4f',
    '#ffd85a',
    '#b977ff'
];

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function createMapViewport(player) {
    const viewport = document.createElement('div');
    viewport.className = 'minimap-viewport';
    viewport.dataset.playerId = player.id;

    const frame = document.createElement('div');
    frame.className = 'minimap-frame';

    const canvas = document.createElement('canvas');
    canvas.className = 'minimap-canvas';
    canvas.width = MAP_SIZE;
    canvas.height = MAP_SIZE;

    frame.appendChild(canvas);
    viewport.appendChild(frame);

    const terrainCanvas = document.createElement('canvas');
    terrainCanvas.width = MAP_SIZE;
    terrainCanvas.height = MAP_SIZE;

    return {
        viewport,
        frame,
        canvas,
        ctx: canvas.getContext('2d'),
        terrainCanvas,
        terrainCtx: terrainCanvas.getContext('2d'),
        lastTerrainX: Infinity,
        lastTerrainZ: Infinity,
        terrainTimer: Infinity
    };
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

function colorForSample(sample) {
    if (!sample) return [36, 44, 38, 255];
    if (sample.water?.depth > 0.04 && sample.water?.coverage > 0.08) {
        const depth = clamp(sample.water.depth / 8, 0, 1);
        return [
            Math.round(72 - depth * 34),
            Math.round(144 - depth * 64),
            Math.round(166 - depth * 48),
            255
        ];
    }

    const weights = sample.weights ?? {};
    const moisture = sample.moisture ?? 0.5;
    const height = sample.height ?? 0;
    const mountain = weights.mountains ?? 0;
    const slopes = weights.slopes ?? 0;

    let r = 84 + slopes * 48 + mountain * 38;
    let g = 128 + moisture * 45 - mountain * 28;
    let b = 58 + moisture * 25 + mountain * 52;

    if (height > 34) {
        const snow = clamp((height - 34) / 16, 0, 1);
        r = r * (1 - snow) + 224 * snow;
        g = g * (1 - snow) + 228 * snow;
        b = b * (1 - snow) + 232 * snow;
    }

    return [
        clamp(Math.round(r), 0, 255),
        clamp(Math.round(g), 0, 255),
        clamp(Math.round(b), 0, 255),
        255
    ];
}

function drawTerrain(item, center, getSample) {
    const image = item.ctx.createImageData(MAP_PIXELS, MAP_PIXELS);
    const data = image.data;
    const half = MAP_PIXELS / 2;

    for (let y = 0; y < MAP_PIXELS; y++) {
        for (let x = 0; x < MAP_PIXELS; x++) {
            const nx = (x + 0.5 - half) / half;
            const nz = -(y + 0.5 - half) / half;
            const offset = (y * MAP_PIXELS + x) * 4;

            if (nx * nx + nz * nz > 1) {
                data[offset + 3] = 0;
                continue;
            }

            const worldX = center.x + nx * MAP_RADIUS_WORLD;
            const worldZ = center.z + nz * MAP_RADIUS_WORLD;
            const color = colorForSample(getSample(worldX, worldZ));
            data[offset] = color[0];
            data[offset + 1] = color[1];
            data[offset + 2] = color[2];
            data[offset + 3] = color[3];
        }
    }

    const lowResCanvas = document.createElement('canvas');
    lowResCanvas.width = MAP_PIXELS;
    lowResCanvas.height = MAP_PIXELS;
    lowResCanvas.getContext('2d').putImageData(image, 0, 0);

    item.terrainCtx.clearRect(0, 0, MAP_SIZE, MAP_SIZE);
    item.terrainCtx.save();
    item.terrainCtx.beginPath();
    item.terrainCtx.arc(MAP_SIZE / 2, MAP_SIZE / 2, MAP_SIZE / 2 - 3, 0, Math.PI * 2);
    item.terrainCtx.clip();
    item.terrainCtx.imageSmoothingEnabled = false;
    item.terrainCtx.drawImage(lowResCanvas, 0, 0, MAP_SIZE, MAP_SIZE);
    item.terrainCtx.restore();

    item.lastTerrainX = center.x;
    item.lastTerrainZ = center.z;
    item.terrainTimer = 0;
}

function drawPlayerArrow(ctx, x, y, yaw, color) {
    const dirX = -Math.sin(yaw);
    const dirZ = -Math.cos(yaw);
    const screenX = dirX;
    const screenY = -dirZ;
    const angle = Math.atan2(screenY, screenX) + Math.PI / 2;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.58)';
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(7, 7);
    ctx.lineTo(0, 3);
    ctx.lineTo(-7, 7);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 5);
    ctx.lineTo(0, 2);
    ctx.lineTo(-5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

function drawMarkers(item, player, allPlayers, playerIndex) {
    const ctx = item.ctx;
    const center = MAP_SIZE / 2;
    const radius = MAP_SIZE / 2 - 11;
    const playerYaw = Number.isFinite(player.yaw) ? player.yaw : 0;

    ctx.clearRect(0, 0, MAP_SIZE, MAP_SIZE);
    ctx.drawImage(item.terrainCanvas, 0, 0);
    ctx.save();
    ctx.beginPath();
    ctx.arc(center, center, MAP_SIZE / 2 - 3, 0, Math.PI * 2);
    ctx.clip();

    drawPlayerArrow(ctx, center, center, playerYaw, PLAYER_COLORS[playerIndex % PLAYER_COLORS.length]);

    for (let i = 0; i < allPlayers.length; i++) {
        const other = allPlayers[i];
        if (!other || other.id === player.id || other.vitals?.isDead || other.isCrouching) continue;
        const position = other.position;
        if (!position) continue;

        const dx = position.x - player.position.x;
        const dz = position.z - player.position.z;
        const distance = Math.hypot(dx, dz);
        if (distance < 0.001) continue;

        const clampedDistance = Math.min(distance, MAP_RADIUS_WORLD);
        const scale = (clampedDistance / MAP_RADIUS_WORLD) * radius;
        const screenX = dx / distance;
        const screenY = -dz / distance;
        const px = center + screenX * scale;
        const py = center + screenY * scale;
        const isOutside = distance > MAP_RADIUS_WORLD;
        const color = other.color ?? PLAYER_COLORS[(i + 1) % PLAYER_COLORS.length];

        ctx.fillStyle = color;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.62)';
        ctx.lineWidth = 2;

        if (isOutside) {
            const angle = Math.atan2(screenY, screenX);
            ctx.save();
            ctx.translate(px, py);
            ctx.rotate(angle + Math.PI / 2);
            ctx.beginPath();
            ctx.moveTo(0, -6);
            ctx.lineTo(5, 5);
            ctx.lineTo(-5, 5);
            ctx.closePath();
            ctx.stroke();
            ctx.fill();
            ctx.restore();
        } else {
            ctx.beginPath();
            ctx.arc(px, py, 4.2, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fill();
        }
    }

    ctx.restore();
}

function shouldRedrawTerrain(item, delta, position) {
    const movedDistance = Math.hypot(position.x - item.lastTerrainX, position.z - item.lastTerrainZ);
    if (movedDistance >= TERRAIN_MOVE_THRESHOLD) return true;

    item.terrainTimer += delta;
    if (item.terrainTimer < TERRAIN_UPDATE_INTERVAL) return false;
    return movedDistance >= TERRAIN_MOVE_THRESHOLD;
}

export function createMinimapHud(getSample) {
    const root = document.createElement('div');
    root.id = 'minimap-hud';
    document.body.appendChild(root);
    const viewports = new Map();

    function update(modeState = {}, delta = 0) {
        const players = modeState.players ?? [];
        const allPlayers = modeState.minimapPlayers ?? players;
        const activeIds = new Set();

        players.forEach((player, index) => {
            if (!player?.position) return;
            const playerId = player.id ?? `player-${index + 1}`;
            activeIds.add(playerId);

            let item = viewports.get(playerId);
            if (!item) {
                item = createMapViewport({ ...player, id: playerId });
                viewports.set(playerId, item);
                root.appendChild(item.viewport);
            }

            updateViewportLayout(item.viewport, index, players.length);
            if (shouldRedrawTerrain(item, delta, player.position)) {
                drawTerrain(item, player.position, getSample);
            }
            drawMarkers(item, { ...player, id: playerId }, allPlayers, index);
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

    return { update, dispose };
}
