import * as THREE from 'three';
import { CONFIG } from './config.js';
import {
    biomeWeights,
    calculateTerrainHeight,
    continentalness,
    moisture,
    temperature
} from './biomes.js';
import { setNoiseSeed } from './noise.js';
import { buildChunkGroup, getChunkBounds, getChunkKey } from './chunks.js';
import { createTerrainMaterial } from './materials.js';
import { createChunkTerrainGeometry } from './terrainMesh.js';
import { createChunkSampleGrid } from './chunkSampleGrid.js';

const TERRAIN_STEP = CONFIG.terreno.passoTerreno;

const CHUNK_SIZE = CONFIG.terreno.tamanhoChunk;
const VIEW_DISTANCE = CONFIG.terreno.distanciaChunks;
const PREFETCH_DISTANCE = VIEW_DISTANCE + CONFIG.terreno.distanciaPreloadChunks;
const CHUNKS_PER_FRAME = 1;
const INITIAL_CHUNK_BURST = 9;
const HEIGHT_CACHE_LIMIT = 64;
const TERRAIN_SAMPLE_CACHE_LIMIT = 65536;

const WORLD_MIN = -CONFIG.terreno.tamanhoGrade / 2;
const WORLD_MAX = CONFIG.terreno.tamanhoGrade / 2;

export function setTerrainSeed(numericSeed) {
    setNoiseSeed(numericSeed);
}

function createTerrainSample(x, z) {
    const c = continentalness(x, z);
    const weights = biomeWeights(c);
    const moistureValue = moisture(x, z);
    const temperatureValue = temperature(x, z);
    const rawHeight = calculateTerrainHeight(x, z, weights);

    return {
        x,
        z,
        height: rawHeight,
        weights,
        moisture: moistureValue,
        temperature: temperatureValue
    };
}

function createTerrainSampleCache(limit) {
    const samples = new Map();

    return {
        get(key) {
            const sample = samples.get(key);
            if (!sample) return null;

            samples.delete(key);
            samples.set(key, sample);
            return sample;
        },
        set(key, sample) {
            samples.set(key, sample);
            if (samples.size > limit) {
                const oldestKey = samples.keys().next().value;
                samples.delete(oldestKey);
            }
        },
        clear() {
            samples.clear();
        }
    };
}

function createChunkSampler(sharedSampleCache, sampleGrid = null) {
    const samples = new Map();

    return function sampleTerrain(x, z) {
        const gridSample = sampleGrid?.getSample(x, z);
        if (gridSample) return gridSample;

        const key = `${x},${z}`;
        let sample = samples.get(key);
        if (!sample) {
            sample = sharedSampleCache.get(key);
        }
        if (!sample) {
            sample = createTerrainSample(x, z);
            sharedSampleCache.set(key, sample);
        }
        if (!samples.has(key)) {
            samples.set(key, sample);
        }
        return sample;
    };
}

    // micro variação para o chão não parecer pintado de cor única
    // leve dessaturação acima de 22
function getTerrainHeightFormula(x, z) {
    return createTerrainSample(x, z).height;
}

function createHeightCache() {
    const heights = new Map();

    return function getCachedHeight(x, z) {
        const key = `${x},${z}`;
        const cachedHeight = heights.get(key);
        if (cachedHeight !== undefined) {
            heights.delete(key);
            heights.set(key, cachedHeight);
            return cachedHeight;
        }

        const height = getTerrainHeightFormula(x, z);
        heights.set(key, height);

        if (heights.size > HEIGHT_CACHE_LIMIT) {
            const oldestKey = heights.keys().next().value;
            heights.delete(oldestKey);
        }

        return height;
    };
}

export function createTerrain(scene, diagnostics) {
    const terrainMaterial = createTerrainMaterial();

    const chunks = new Map();
    const sharedSampleCache = createTerrainSampleCache(TERRAIN_SAMPLE_CACHE_LIMIT);
    const getCachedHeight = createHeightCache();
    let neededChunkKeys = new Set();
    let chunkLoadQueue = [];
    const queuedChunkKeys = new Set();
    let lastPlayerChunkX = null;
    let lastPlayerChunkZ = null;
    let didInitialChunkBurst = false;

    function getChunkDistance(cx, cz, playerChunkX = lastPlayerChunkX, playerChunkZ = lastPlayerChunkZ) {
        if (playerChunkX === null || playerChunkZ === null) return 0;
        return Math.max(Math.abs(cx - playerChunkX), Math.abs(cz - playerChunkZ));
    }

    function isChunkVisible(cx, cz, playerChunkX = lastPlayerChunkX, playerChunkZ = lastPlayerChunkZ) {
        return getChunkDistance(cx, cz, playerChunkX, playerChunkZ) <= VIEW_DISTANCE;
    }

    function enqueueChunk(cx, cz, playerChunkX, playerChunkZ) {
        const key = getChunkKey(cx, cz);
        if (chunks.has(key) || queuedChunkKeys.has(key)) return;

        const visibleDistance = Math.max(Math.abs(cx - playerChunkX), Math.abs(cz - playerChunkZ));
        chunkLoadQueue.push({
            cx,
            cz,
            key,
            priority: visibleDistance > VIEW_DISTANCE
                ? visibleDistance + VIEW_DISTANCE
                : visibleDistance
        });
        queuedChunkKeys.add(key);
    }

    function refreshChunkQueue(playerChunkX, playerChunkZ) {
        neededChunkKeys = new Set();

        for (let dx = -PREFETCH_DISTANCE; dx <= PREFETCH_DISTANCE; dx++) {
            for (let dz = -PREFETCH_DISTANCE; dz <= PREFETCH_DISTANCE; dz++) {
                const cx = playerChunkX + dx;
                const cz = playerChunkZ + dz;

                const { startX, startZ, endX, endZ } = getChunkBounds(cx, cz, CHUNK_SIZE, WORLD_MIN, WORLD_MAX);
                if (startX >= endX || startZ >= endZ) continue;

                const key = getChunkKey(cx, cz);
                neededChunkKeys.add(key);
                enqueueChunk(cx, cz, playerChunkX, playerChunkZ);
            }
        }

        for (const key of [...chunks.keys()]) {
            if (!neededChunkKeys.has(key)) {
                unloadChunk(key);
            }
        }

        chunkLoadQueue = chunkLoadQueue.filter((item) => neededChunkKeys.has(item.key) && !chunks.has(item.key));
        queuedChunkKeys.clear();
        for (const item of chunkLoadQueue) {
            const visibleDistance = Math.max(Math.abs(item.cx - playerChunkX), Math.abs(item.cz - playerChunkZ));
            item.priority = visibleDistance > VIEW_DISTANCE
                ? visibleDistance + VIEW_DISTANCE
                : visibleDistance;
            queuedChunkKeys.add(item.key);
        }
        chunkLoadQueue.sort((a, b) => a.priority - b.priority);

        for (const chunk of chunks.values()) {
            chunk.group.visible = isChunkVisible(chunk.cx, chunk.cz, playerChunkX, playerChunkZ);
        }
    }

    function processChunkQueue(maxChunks) {
        let created = 0;
        while (created < maxChunks && chunkLoadQueue.length > 0) {
            const next = chunkLoadQueue.shift();
            queuedChunkKeys.delete(next.key);

            if (!neededChunkKeys.has(next.key) || chunks.has(next.key)) continue;
            if (diagnostics.measure('createChunk', () => createChunk(next.cx, next.cz))) {
                created++;
            }
        }
    }

    function createChunk(cx, cz) {
        const key = getChunkKey(cx, cz);
        if (chunks.has(key)) return chunks.get(key);

        const { startX, startZ, endX, endZ } = getChunkBounds(cx, cz, CHUNK_SIZE, WORLD_MIN, WORLD_MAX);
        if (startX >= endX || startZ >= endZ) return null;

        const baseSampleTerrain = createChunkSampler(sharedSampleCache);
        const heightMap = diagnostics.measure(
            'chunkSampleGrid',
            () => createChunkSampleGrid(startX, startZ, endX, endZ, TERRAIN_STEP, baseSampleTerrain)
        );
        const sampleTerrain = createChunkSampler(sharedSampleCache, heightMap);

        const { geometry, width, depth } = diagnostics.measure(
            'terrainGeometry',
            () => createChunkTerrainGeometry(startX, startZ, endX, endZ, heightMap, sampleTerrain, TERRAIN_STEP)
        );
        const terrainMesh = new THREE.Mesh(geometry, terrainMaterial);
        terrainMesh.position.set(startX + width / 2, 0, startZ + depth / 2);

        const chunkGroup = buildChunkGroup(terrainMesh);
        chunkGroup.visible = isChunkVisible(cx, cz);

        const chunk = {
            key,
            cx,
            cz,
            group: chunkGroup,
            sampleGrid: heightMap
        };
        scene.add(chunkGroup);
        chunks.set(key, chunk);
        diagnostics.setCounter('loadedChunks', chunks.size);
        return chunk;
    }

    function unloadChunk(key) {
        const chunk = chunks.get(key);
        if (!chunk) return;

        chunk.group.userData.disposed = true;
        scene.remove(chunk.group);
        chunk.group.traverse((object) => {
            if (object.geometry) object.geometry.dispose();
        });
        chunk.group.clear();
        chunks.delete(key);
        diagnostics.setCounter('loadedChunks', chunks.size);
    }

    function dispose() {
        for (const key of [...chunks.keys()]) {
            unloadChunk(key);
        }
        sharedSampleCache.clear();
        terrainMaterial.dispose();
    }

    function updateChunks(playerX, playerZ) {
        const playerChunkX = Math.floor(playerX / CHUNK_SIZE);
        const playerChunkZ = Math.floor(playerZ / CHUNK_SIZE);

        if (playerChunkX !== lastPlayerChunkX || playerChunkZ !== lastPlayerChunkZ) {
            lastPlayerChunkX = playerChunkX;
            lastPlayerChunkZ = playerChunkZ;
            refreshChunkQueue(playerChunkX, playerChunkZ);
        }

        processChunkQueue(didInitialChunkBurst ? CHUNKS_PER_FRAME : INITIAL_CHUNK_BURST);
        didInitialChunkBurst = true;
    }

    function getHeight(posX, posZ) {
        const chunkX = Math.floor(posX / CHUNK_SIZE);
        const chunkZ = Math.floor(posZ / CHUNK_SIZE);
        const chunk = chunks.get(getChunkKey(chunkX, chunkZ));
        const loadedHeight = chunk?.sampleGrid.sampleHeightBilinear(posX, posZ);
        if (loadedHeight !== undefined) return loadedHeight;
        return getCachedHeight(posX, posZ);
    }

    updateChunks(0, 0);

    return { getHeight, updateChunks, dispose };
}
