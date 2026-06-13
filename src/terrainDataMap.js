import { CONFIG } from './config.js';
import {
    biomeWeights,
    calculateTerrainHeight,
    continentalness,
    moisture,
    temperature
} from './biomes.js';
import { canPlaceGrassOnSample, canPlaceTreeOnSample } from './vegetationRules.js';
import { applyWaterToTerrainSample } from './waterField.js';

const CHUNK_SIZE = CONFIG.terreno.tamanhoChunk;
const WORLD_MIN = -CONFIG.terreno.tamanhoGrade / 2;
const WORLD_MAX = CONFIG.terreno.tamanhoGrade / 2;
const DATA_MAP_CONFIG = CONFIG.terreno.mapaDados ?? {};
const DATA_MAP_ENABLED = DATA_MAP_CONFIG.ativo !== false;
const TILE_SIZE_CHUNKS = Math.max(1, DATA_MAP_CONFIG.tamanhoTileChunks ?? 16);
const TILE_WORLD_SIZE = TILE_SIZE_CHUNKS * CHUNK_SIZE;
const SAMPLE_COUNT = Math.max(2, DATA_MAP_CONFIG.amostrasPorEixo ?? 7);
const DEFAULT_BUDGET_MS = DATA_MAP_CONFIG.tempoGeracaoMs ?? 6;
const COLUMNS = Math.ceil((WORLD_MAX - WORLD_MIN) / TILE_WORLD_SIZE);
const ROWS = COLUMNS;
const TOTAL_TILES = DATA_MAP_ENABLED ? COLUMNS * ROWS : 0;

function createTerrainSample(x, z) {
    const c = continentalness(x, z);
    const weights = biomeWeights(c);
    const height = calculateTerrainHeight(x, z, weights);

    return applyWaterToTerrainSample({
        x,
        z,
        height,
        weights,
        moisture: moisture(x, z),
        temperature: temperature(x, z)
    });
}

function getTileKey(tx, tz) {
    return `${tx},${tz}`;
}

function clampTileCoord(value, max) {
    return Math.max(0, Math.min(max - 1, value));
}

export function createTerrainDataMap(diagnostics) {
    const tiles = new Map();
    const queue = [];
    let isQueueReady = false;

    function getTileBounds(tx, tz) {
        const startX = WORLD_MIN + tx * TILE_WORLD_SIZE;
        const startZ = WORLD_MIN + tz * TILE_WORLD_SIZE;
        return {
            startX,
            startZ,
            endX: Math.min(WORLD_MAX, startX + TILE_WORLD_SIZE),
            endZ: Math.min(WORLD_MAX, startZ + TILE_WORLD_SIZE)
        };
    }

    function getFocusPriority(tx, tz, focuses) {
        if (!focuses?.length) return tz * COLUMNS + tx;

        const centerChunkX = Math.floor((WORLD_MIN + (tx + 0.5) * TILE_WORLD_SIZE) / CHUNK_SIZE);
        const centerChunkZ = Math.floor((WORLD_MIN + (tz + 0.5) * TILE_WORLD_SIZE) / CHUNK_SIZE);
        let closestDistance = Infinity;
        for (const focus of focuses) {
            closestDistance = Math.min(
                closestDistance,
                Math.max(Math.abs(centerChunkX - focus.chunkX), Math.abs(centerChunkZ - focus.chunkZ))
            );
        }
        return closestDistance;
    }

    function ensureQueue(focuses) {
        if (!DATA_MAP_ENABLED || isQueueReady) return;

        for (let tz = 0; tz < ROWS; tz++) {
            for (let tx = 0; tx < COLUMNS; tx++) {
                queue.push({ tx, tz, key: getTileKey(tx, tz), priority: getFocusPriority(tx, tz, focuses) });
            }
        }

        queue.sort((a, b) => a.priority - b.priority);
        isQueueReady = true;
        diagnostics?.setCounter('terrainDataTilesTotal', TOTAL_TILES);
        diagnostics?.setCounter('terrainDataQueue', queue.length);
    }

    function buildTile(tx, tz) {
        const bounds = getTileBounds(tx, tz);
        let minHeight = Infinity;
        let maxHeight = -Infinity;
        let heightSum = 0;
        let moistureSum = 0;
        let temperatureSum = 0;
        let plainsSum = 0;
        let slopesSum = 0;
        let mountainsSum = 0;
        let canContainGrass = false;
        let canContainTrees = false;
        let waterCoverageSum = 0;
        let waterDepthSum = 0;
        let canContainWater = false;
        let samples = 0;

        for (let row = 0; row < SAMPLE_COUNT; row++) {
            const zRatio = SAMPLE_COUNT === 1 ? 0.5 : row / (SAMPLE_COUNT - 1);
            const z = bounds.startZ + (bounds.endZ - bounds.startZ) * zRatio;

            for (let column = 0; column < SAMPLE_COUNT; column++) {
                const xRatio = SAMPLE_COUNT === 1 ? 0.5 : column / (SAMPLE_COUNT - 1);
                const x = bounds.startX + (bounds.endX - bounds.startX) * xRatio;
                const sample = createTerrainSample(x, z);

                minHeight = Math.min(minHeight, sample.height);
                maxHeight = Math.max(maxHeight, sample.height);
                heightSum += sample.height;
                moistureSum += sample.moisture;
                temperatureSum += sample.temperature;
                plainsSum += sample.weights.plains;
                slopesSum += sample.weights.slopes;
                mountainsSum += sample.weights.mountains;
                canContainGrass ||= canPlaceGrassOnSample(sample);
                canContainTrees ||= canPlaceTreeOnSample(sample);
                const waterCoverage = sample.water?.coverage ?? 0;
                const waterDepth = sample.water?.depth ?? 0;
                waterCoverageSum += waterCoverage;
                waterDepthSum += waterDepth;
                canContainWater ||= waterCoverage > 0.05 && waterDepth > 0.05;
                samples++;
            }
        }

        const invSamples = samples > 0 ? 1 / samples : 0;
        const weights = {
            plains: plainsSum * invSamples,
            slopes: slopesSum * invSamples,
            mountains: mountainsSum * invSamples
        };
        const dominantBiome = weights.mountains >= weights.plains && weights.mountains >= weights.slopes
            ? 'mountains'
            : weights.slopes >= weights.plains
                ? 'slopes'
                : 'plains';

        return {
            tx,
            tz,
            minHeight,
            maxHeight,
            averageHeight: heightSum * invSamples,
            roughness: maxHeight - minHeight,
            moisture: moistureSum * invSamples,
            temperature: temperatureSum * invSamples,
            weights,
            dominantBiome,
            canContainGrass,
            canContainTrees,
            canContainWater,
            waterCoverage: waterCoverageSum * invSamples,
            waterDepth: waterDepthSum * invSamples
        };
    }

    function preloadStep(deadlineMs = performance.now() + DEFAULT_BUDGET_MS, focuses = []) {
        if (!DATA_MAP_ENABLED) return true;

        ensureQueue(focuses);
        while (queue.length > 0 && performance.now() < deadlineMs) {
            const item = queue.shift();
            if (!item || tiles.has(item.key)) continue;
            tiles.set(item.key, buildTile(item.tx, item.tz));
        }

        diagnostics?.setCounter('terrainDataTilesLoaded', tiles.size);
        diagnostics?.setCounter('terrainDataQueue', queue.length);
        diagnostics?.setCounter('terrainDataProgress', getProgress());
        return isReady();
    }

    function getTileForChunk(cx, cz) {
        if (!DATA_MAP_ENABLED || !isQueueReady) return null;

        const tx = clampTileCoord(Math.floor((cx * CHUNK_SIZE - WORLD_MIN) / TILE_WORLD_SIZE), COLUMNS);
        const tz = clampTileCoord(Math.floor((cz * CHUNK_SIZE - WORLD_MIN) / TILE_WORLD_SIZE), ROWS);
        return tiles.get(getTileKey(tx, tz)) ?? null;
    }

    function getChunkMetadata(cx, cz) {
        const tile = getTileForChunk(cx, cz);
        if (!tile) return null;

        return {
            source: 'terrainDataMap',
            canContainGrass: tile.canContainGrass,
            canContainTrees: tile.canContainTrees,
            minHeight: tile.minHeight,
            maxHeight: tile.maxHeight,
            averageHeight: tile.averageHeight,
            roughness: tile.roughness,
            moisture: tile.moisture,
            temperature: tile.temperature,
            weights: tile.weights,
            dominantBiome: tile.dominantBiome,
            canContainWater: tile.canContainWater,
            waterCoverage: tile.waterCoverage,
            waterDepth: tile.waterDepth
        };
    }

    function getProgress() {
        if (!DATA_MAP_ENABLED || TOTAL_TILES <= 0) return 1;
        return Math.min(1, tiles.size / TOTAL_TILES);
    }

    function isReady() {
        if (!DATA_MAP_ENABLED) return true;
        return isQueueReady && tiles.size >= TOTAL_TILES && queue.length === 0;
    }

    return {
        enabled: DATA_MAP_ENABLED,
        preloadStep,
        getChunkMetadata,
        getProgress,
        isReady
    };
}
