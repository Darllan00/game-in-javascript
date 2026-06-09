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
import { createChunkSampleGrid, createChunkSampleGridBuilder } from './chunkSampleGrid.js';

const CHUNK_SIZE = CONFIG.terreno.tamanhoChunk;
const VIEW_DISTANCE = CONFIG.terreno.distanciaChunks;
const PREFETCH_DISTANCE = VIEW_DISTANCE + CONFIG.terreno.distanciaPreloadChunks;
const CHUNK_GENERATION_BUDGET_MS = CONFIG.terreno.tempoGeracaoChunksMs ?? 3;
const INITIAL_CHUNK_BURST = 9;
const SLOW_FRAME_GENERATION_PAUSE_MS = 40;
const QUEUE_BUILD_BUDGET_MS = 1.2;
const MAX_CHUNK_QUEUE_LENGTH = 512;
const SIMPLE_SAMPLE_TERRAIN_STEP = 8;
const SUPER_CHUNK_SIZE_IN_CHUNKS = 4;
const SUPER_CHUNK_TERRAIN_STEP = 16;
const SUPER_CHUNK_VERTICAL_OFFSET = -0.035;
const HEIGHT_CACHE_LIMIT = 64;
const TERRAIN_SAMPLE_CACHE_LIMIT = 65536;
const RETIRED_CHUNK_CACHE_LIMIT = 160;

const WORLD_MIN = -CONFIG.terreno.tamanhoGrade / 2;
const WORLD_MAX = CONFIG.terreno.tamanhoGrade / 2;

function getIndividualChunkDistance() {
    const finiteLods = CONFIG.terreno.lodChunks
        ?.map((lod) => lod.distancia)
        .filter((distance) => Number.isFinite(distance) && distance < 9999);
    const baseDistance = Math.max(...finiteLods, 0);
    return Math.ceil((baseDistance + 1) / SUPER_CHUNK_SIZE_IN_CHUNKS) * SUPER_CHUNK_SIZE_IN_CHUNKS - 1;
}

const INDIVIDUAL_CHUNK_DISTANCE = getIndividualChunkDistance();
const INDIVIDUAL_PREFETCH_DISTANCE = INDIVIDUAL_CHUNK_DISTANCE + CONFIG.terreno.distanciaPreloadChunks;

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

function createTerrainHeightSample(x, z) {
    const c = continentalness(x, z);
    const weights = biomeWeights(c);
    const rawHeight = calculateTerrainHeight(x, z, weights);

    return {
        x,
        z,
        height: rawHeight,
        weights,
        moisture: 0.5,
        temperature: 0.5
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

function createChunkSampler(sharedSampleCache, sampleGrid = null, sampleFactory = createTerrainSample, cacheNamespace = 'full') {
    const samples = new Map();

    return function sampleTerrain(x, z) {
        const gridSample = sampleGrid?.getSample(x, z);
        if (gridSample) return gridSample;

        const key = `${cacheNamespace}:${x},${z}`;
        let sample = samples.get(key);
        if (!sample) {
            sample = sharedSampleCache.get(key);
        }
        if (!sample) {
            sample = sampleFactory(x, z);
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
    const superChunks = new Map();
    const retiredChunks = new Map();
    const sharedSampleCache = createTerrainSampleCache(TERRAIN_SAMPLE_CACHE_LIMIT);
    const getCachedHeight = createHeightCache();
    let chunkLoadQueue = [];
    const queuedChunkKeys = new Set();
    const queuedSuperChunkKeys = new Set();
    let lastPlayerChunkX = null;
    let lastPlayerChunkZ = null;
    let didInitialChunkBurst = false;
    let activeChunkJob = null;
    let queueBuildJob = null;
    let lastChunkUpdateTime = performance.now();

    function getChunkDistance(cx, cz, playerChunkX = lastPlayerChunkX, playerChunkZ = lastPlayerChunkZ) {
        if (playerChunkX === null || playerChunkZ === null) return 0;
        return Math.max(Math.abs(cx - playerChunkX), Math.abs(cz - playerChunkZ));
    }

    function isChunkVisible(cx, cz, playerChunkX = lastPlayerChunkX, playerChunkZ = lastPlayerChunkZ) {
        return getChunkDistance(cx, cz, playerChunkX, playerChunkZ) <= INDIVIDUAL_PREFETCH_DISTANCE;
    }

    function isChunkNeeded(cx, cz, playerChunkX = lastPlayerChunkX, playerChunkZ = lastPlayerChunkZ) {
        if (playerChunkX === null || playerChunkZ === null) return false;
        return getChunkDistance(cx, cz, playerChunkX, playerChunkZ) <= INDIVIDUAL_PREFETCH_DISTANCE;
    }

    function hasChunkArea(cx, cz) {
        const rawStartX = cx * CHUNK_SIZE;
        const rawStartZ = cz * CHUNK_SIZE;
        return rawStartX < WORLD_MAX
            && rawStartZ < WORLD_MAX
            && rawStartX + CHUNK_SIZE > WORLD_MIN
            && rawStartZ + CHUNK_SIZE > WORLD_MIN;
    }

    function getSuperChunkKey(sx, sz) {
        return `s:${sx},${sz}`;
    }

    function getSuperChunkIndex(chunkCoord) {
        return Math.floor(chunkCoord / SUPER_CHUNK_SIZE_IN_CHUNKS);
    }

    function getSuperChunkChunkBounds(sx, sz) {
        const minCx = sx * SUPER_CHUNK_SIZE_IN_CHUNKS;
        const minCz = sz * SUPER_CHUNK_SIZE_IN_CHUNKS;
        return {
            minCx,
            minCz,
            maxCx: minCx + SUPER_CHUNK_SIZE_IN_CHUNKS - 1,
            maxCz: minCz + SUPER_CHUNK_SIZE_IN_CHUNKS - 1
        };
    }

    function getSuperChunkDistance(sx, sz, playerChunkX = lastPlayerChunkX, playerChunkZ = lastPlayerChunkZ) {
        if (playerChunkX === null || playerChunkZ === null) return 0;

        const { minCx, minCz, maxCx, maxCz } = getSuperChunkChunkBounds(sx, sz);
        const dx = playerChunkX < minCx ? minCx - playerChunkX : Math.max(0, playerChunkX - maxCx);
        const dz = playerChunkZ < minCz ? minCz - playerChunkZ : Math.max(0, playerChunkZ - maxCz);
        return Math.max(dx, dz);
    }

    function isSuperChunkVisible(sx, sz, playerChunkX = lastPlayerChunkX, playerChunkZ = lastPlayerChunkZ) {
        const distance = getSuperChunkDistance(sx, sz, playerChunkX, playerChunkZ);
        return distance <= VIEW_DISTANCE;
    }

    function isSuperChunkNeeded(sx, sz, playerChunkX = lastPlayerChunkX, playerChunkZ = lastPlayerChunkZ) {
        const distance = getSuperChunkDistance(sx, sz, playerChunkX, playerChunkZ);
        return distance <= PREFETCH_DISTANCE;
    }

    function hasSuperChunkArea(sx, sz) {
        const { minCx, minCz, maxCx, maxCz } = getSuperChunkChunkBounds(sx, sz);
        return hasChunkArea(minCx, minCz)
            || hasChunkArea(maxCx, minCz)
            || hasChunkArea(minCx, maxCz)
            || hasChunkArea(maxCx, maxCz);
    }

    function getTerrainStepForDistance(distance) {
        const profile = CONFIG.terreno.lodChunks?.find((lod) => distance <= lod.distancia);
        return profile?.passoTerreno ?? CONFIG.terreno.passoTerreno;
    }

    function getSampleFactoryForTerrainStep(terrainStep) {
        return terrainStep >= SIMPLE_SAMPLE_TERRAIN_STEP
            ? createTerrainHeightSample
            : createTerrainSample;
    }

    function getSampleCacheNamespaceForTerrainStep(terrainStep) {
        return terrainStep >= SIMPLE_SAMPLE_TERRAIN_STEP ? 'simple' : 'full';
    }

    function enqueueChunk(cx, cz, playerChunkX, playerChunkZ) {
        const key = getChunkKey(cx, cz);
        if (restoreRetiredChunk(key, playerChunkX, playerChunkZ)) return;
        if (activeChunkJob?.key === key) return;
        if (chunks.has(key) || queuedChunkKeys.has(key)) return;

        const visibleDistance = Math.max(Math.abs(cx - playerChunkX), Math.abs(cz - playerChunkZ));
        const terrainStep = getTerrainStepForDistance(visibleDistance);
        chunkLoadQueue.push({
            cx,
            cz,
            key,
            type: 'chunk',
            terrainStep,
            priority: visibleDistance > VIEW_DISTANCE
                ? visibleDistance + VIEW_DISTANCE
                : visibleDistance
        });
        queuedChunkKeys.add(key);
        diagnostics.setCounter('chunkQueue', chunkLoadQueue.length);
    }

    function enqueueSuperChunkForChunk(cx, cz, playerChunkX, playerChunkZ) {
        const sx = getSuperChunkIndex(cx);
        const sz = getSuperChunkIndex(cz);
        const key = getSuperChunkKey(sx, sz);

        if (!hasSuperChunkArea(sx, sz)) return;
        if (!isSuperChunkNeeded(sx, sz, playerChunkX, playerChunkZ)) return;
        if (activeChunkJob?.key === key) return;
        if (superChunks.has(key) || queuedSuperChunkKeys.has(key)) return;

        const visibleDistance = getSuperChunkDistance(sx, sz, playerChunkX, playerChunkZ);
        chunkLoadQueue.push({
            sx,
            sz,
            key,
            type: 'super',
            terrainStep: SUPER_CHUNK_TERRAIN_STEP,
            priority: visibleDistance
        });
        queuedSuperChunkKeys.add(key);
        diagnostics.setCounter('chunkQueue', chunkLoadQueue.length);
    }

    function refreshChunkQueue(playerChunkX, playerChunkZ) {
        for (const key of [...chunks.keys()]) {
            const chunk = chunks.get(key);
            if (!isChunkNeeded(chunk.cx, chunk.cz, playerChunkX, playerChunkZ)) {
                retireChunk(key);
            }
        }

        for (const key of [...superChunks.keys()]) {
            const superChunk = superChunks.get(key);
            if (!isSuperChunkNeeded(superChunk.sx, superChunk.sz, playerChunkX, playerChunkZ)) {
                unloadSuperChunk(key);
            }
        }

        chunkLoadQueue = [];
        queuedChunkKeys.clear();
        queuedSuperChunkKeys.clear();
        diagnostics.setCounter('chunkQueue', chunkLoadQueue.length);

        let visibleChunks = 0;
        for (const chunk of chunks.values()) {
            chunk.group.visible = isChunkVisible(chunk.cx, chunk.cz, playerChunkX, playerChunkZ);
            if (chunk.group.visible) visibleChunks++;
        }
        diagnostics.setCounter('visibleChunks', visibleChunks);

        let visibleSuperChunks = 0;
        for (const superChunk of superChunks.values()) {
            superChunk.group.visible = isSuperChunkVisible(superChunk.sx, superChunk.sz, playerChunkX, playerChunkZ);
            if (superChunk.group.visible) visibleSuperChunks++;
        }
        diagnostics.setCounter('visibleSuperChunks', visibleSuperChunks);

        if (activeChunkJob && !isQueueItemNeeded(activeChunkJob)) {
            activeChunkJob = null;
        }

        queueBuildJob = createQueueBuildJob(playerChunkX, playerChunkZ);
    }

    function processInitialChunkBurst() {
        processQueueBuild(performance.now() + QUEUE_BUILD_BUDGET_MS * 4);

        let created = 0;
        while (created < INITIAL_CHUNK_BURST && chunkLoadQueue.length > 0) {
            const next = chunkLoadQueue.shift();
            if (next.type === 'super') {
                queuedSuperChunkKeys.delete(next.key);
            } else {
                queuedChunkKeys.delete(next.key);
            }
            diagnostics.setCounter('chunkQueue', chunkLoadQueue.length);

            if (!isQueueItemNeeded(next) || isQueueItemLoaded(next)) continue;
            if (diagnostics.measure('createChunk', () => createQueueItemNow(next))) {
                created++;
            }
        }
    }

    function processChunkQueue() {
        const startedAt = performance.now();
        let deadline = startedAt + CHUNK_GENERATION_BUDGET_MS;
        processQueueBuild(startedAt + QUEUE_BUILD_BUDGET_MS);

        while (performance.now() < deadline) {
            if (!activeChunkJob) {
                activeChunkJob = startNextChunkJob();
                if (!activeChunkJob) return;
            }

            if (!isQueueItemNeeded(activeChunkJob) || isQueueItemLoaded(activeChunkJob)) {
                activeChunkJob = null;
                continue;
            }

            const isReady = diagnostics.measure(
                'chunkSampleGrid',
                () => activeChunkJob.sampleGridBuilder.stepUntil(deadline)
            );
            if (!isReady) return;

            diagnostics.measure(
                'createChunk',
                () => finishChunkJob(activeChunkJob)
            );
            activeChunkJob = null;

            deadline = startedAt + CHUNK_GENERATION_BUDGET_MS;
        }
    }

    function createQueueBuildJob(playerChunkX, playerChunkZ) {
        return {
            playerChunkX,
            playerChunkZ,
            ring: 0,
            index: 0
        };
    }

    function getRingLength(ring) {
        return ring === 0 ? 1 : ring * 8;
    }

    function getRingOffset(ring, index) {
        if (ring === 0) return { dx: 0, dz: 0 };

        const sideLength = ring * 2;
        if (index < sideLength) {
            return { dx: -ring + index, dz: -ring };
        }
        if (index < sideLength * 2) {
            return { dx: ring, dz: -ring + index - sideLength };
        }
        if (index < sideLength * 3) {
            return { dx: ring - (index - sideLength * 2), dz: ring };
        }
        return { dx: -ring, dz: ring - (index - sideLength * 3) };
    }

    function processQueueBuild(deadline) {
        while (queueBuildJob && chunkLoadQueue.length < MAX_CHUNK_QUEUE_LENGTH && performance.now() < deadline) {
            const ringLength = getRingLength(queueBuildJob.ring);
            const { dx, dz } = getRingOffset(queueBuildJob.ring, queueBuildJob.index);
            const cx = queueBuildJob.playerChunkX + dx;
            const cz = queueBuildJob.playerChunkZ + dz;

            if (hasChunkArea(cx, cz)) {
                enqueueSuperChunkForChunk(cx, cz, queueBuildJob.playerChunkX, queueBuildJob.playerChunkZ);
                if (queueBuildJob.ring <= INDIVIDUAL_PREFETCH_DISTANCE) {
                    enqueueChunk(cx, cz, queueBuildJob.playerChunkX, queueBuildJob.playerChunkZ);
                }
            }

            queueBuildJob.index++;
            if (queueBuildJob.index >= ringLength) {
                queueBuildJob.ring++;
                queueBuildJob.index = 0;
                if (queueBuildJob.ring > PREFETCH_DISTANCE) {
                    queueBuildJob = null;
                }
                diagnostics.setCounter('chunkQueueRing', queueBuildJob?.ring ?? 0);
            }
        }
    }

    function isQueueItemNeeded(item) {
        return item.type === 'super'
            ? isSuperChunkNeeded(item.sx, item.sz)
            : isChunkNeeded(item.cx, item.cz);
    }

    function isQueueItemLoaded(item) {
        return item.type === 'super'
            ? superChunks.has(item.key)
            : chunks.has(item.key);
    }

    function createQueueItemNow(item) {
        return item.type === 'super'
            ? createSuperChunk(item.sx, item.sz)
            : createChunk(item.cx, item.cz, item.terrainStep);
    }

    function startNextChunkJob() {
        while (chunkLoadQueue.length > 0) {
            const next = chunkLoadQueue.shift();
            if (next.type === 'super') {
                queuedSuperChunkKeys.delete(next.key);
            } else {
                queuedChunkKeys.delete(next.key);
            }
            diagnostics.setCounter('chunkQueue', chunkLoadQueue.length);

            if (!isQueueItemNeeded(next) || isQueueItemLoaded(next)) continue;

            if (next.type === 'super') {
                return startSuperChunkJob(next);
            }

            const { startX, startZ, endX, endZ } = getChunkBounds(next.cx, next.cz, CHUNK_SIZE, WORLD_MIN, WORLD_MAX);
            if (startX >= endX || startZ >= endZ) continue;

            const baseSampleTerrain = createChunkSampler(
                sharedSampleCache,
                null,
                getSampleFactoryForTerrainStep(next.terrainStep),
                getSampleCacheNamespaceForTerrainStep(next.terrainStep)
            );
            return {
                ...next,
                startX,
                startZ,
                endX,
                endZ,
                sampleGridBuilder: createChunkSampleGridBuilder(
                    startX,
                    startZ,
                    endX,
                    endZ,
                    next.terrainStep,
                    baseSampleTerrain
                )
            };
        }

        return null;
    }

    function startSuperChunkJob(next) {
        const { minCx, minCz, maxCx, maxCz } = getSuperChunkChunkBounds(next.sx, next.sz);
        const startX = Math.max(WORLD_MIN, minCx * CHUNK_SIZE);
        const startZ = Math.max(WORLD_MIN, minCz * CHUNK_SIZE);
        const endX = Math.min(WORLD_MAX, (maxCx + 1) * CHUNK_SIZE);
        const endZ = Math.min(WORLD_MAX, (maxCz + 1) * CHUNK_SIZE);
        if (startX >= endX || startZ >= endZ) return null;

        const baseSampleTerrain = createChunkSampler(
            sharedSampleCache,
            null,
            createTerrainHeightSample,
            'super'
        );
        return {
            ...next,
            startX,
            startZ,
            endX,
            endZ,
            sampleGridBuilder: createChunkSampleGridBuilder(
                startX,
                startZ,
                endX,
                endZ,
                SUPER_CHUNK_TERRAIN_STEP,
                baseSampleTerrain
            )
        };
    }

    function finishChunkJob(job) {
        const heightMap = job.sampleGridBuilder.finish();
        if (job.type === 'super') {
            return createSuperChunkFromHeightMap(
                job.sx,
                job.sz,
                job.startX,
                job.startZ,
                job.endX,
                job.endZ,
                heightMap
            );
        }

        return createChunkFromHeightMap(
            job.cx,
            job.cz,
            job.terrainStep,
            job.startX,
            job.startZ,
            job.endX,
            job.endZ,
            heightMap
        );
    }

    function createChunk(cx, cz, terrainStep) {
        const key = getChunkKey(cx, cz);
        if (chunks.has(key)) return chunks.get(key);

        const { startX, startZ, endX, endZ } = getChunkBounds(cx, cz, CHUNK_SIZE, WORLD_MIN, WORLD_MAX);
        if (startX >= endX || startZ >= endZ) return null;

        const baseSampleTerrain = createChunkSampler(
            sharedSampleCache,
            null,
            getSampleFactoryForTerrainStep(terrainStep),
            getSampleCacheNamespaceForTerrainStep(terrainStep)
        );
        const heightMap = diagnostics.measure(
            'chunkSampleGrid',
            () => createChunkSampleGrid(startX, startZ, endX, endZ, terrainStep, baseSampleTerrain)
        );
        return createChunkFromHeightMap(cx, cz, terrainStep, startX, startZ, endX, endZ, heightMap);
    }

    function createSuperChunk(sx, sz) {
        const key = getSuperChunkKey(sx, sz);
        if (superChunks.has(key)) return superChunks.get(key);

        const { minCx, minCz, maxCx, maxCz } = getSuperChunkChunkBounds(sx, sz);
        const startX = Math.max(WORLD_MIN, minCx * CHUNK_SIZE);
        const startZ = Math.max(WORLD_MIN, minCz * CHUNK_SIZE);
        const endX = Math.min(WORLD_MAX, (maxCx + 1) * CHUNK_SIZE);
        const endZ = Math.min(WORLD_MAX, (maxCz + 1) * CHUNK_SIZE);
        if (startX >= endX || startZ >= endZ) return null;

        const baseSampleTerrain = createChunkSampler(sharedSampleCache, null, createTerrainHeightSample, 'super');
        const heightMap = diagnostics.measure(
            'superChunkSampleGrid',
            () => createChunkSampleGrid(startX, startZ, endX, endZ, SUPER_CHUNK_TERRAIN_STEP, baseSampleTerrain)
        );
        return createSuperChunkFromHeightMap(sx, sz, startX, startZ, endX, endZ, heightMap);
    }

    function createChunkFromHeightMap(cx, cz, terrainStep, startX, startZ, endX, endZ, heightMap) {
        const key = getChunkKey(cx, cz);
        if (chunks.has(key)) return chunks.get(key);

        const sampleTerrain = createChunkSampler(sharedSampleCache, heightMap);

        const { geometry, width, depth } = diagnostics.measure(
            'terrainGeometry',
            () => createChunkTerrainGeometry(startX, startZ, endX, endZ, sampleTerrain, terrainStep)
        );
        const terrainMesh = new THREE.Mesh(geometry, terrainMaterial);
        terrainMesh.position.set(startX + width / 2, 0, startZ + depth / 2);

        const chunkGroup = buildChunkGroup(terrainMesh);
        chunkGroup.visible = isChunkVisible(cx, cz);

        const chunk = {
            key,
            cx,
            cz,
            terrainStep,
            group: chunkGroup,
            sampleGrid: heightMap
        };
        scene.add(chunkGroup);
        chunks.set(key, chunk);
        diagnostics.setCounter('loadedChunks', chunks.size);
        diagnostics.setCounter('visibleChunks', [...chunks.values()].filter((item) => item.group.visible).length);
        return chunk;
    }

    function createSuperChunkFromHeightMap(sx, sz, startX, startZ, endX, endZ, heightMap) {
        const key = getSuperChunkKey(sx, sz);
        if (superChunks.has(key)) return superChunks.get(key);

        const sampleTerrain = createChunkSampler(sharedSampleCache, heightMap);
        const { geometry, width, depth } = diagnostics.measure(
            'superChunkGeometry',
            () => createChunkTerrainGeometry(startX, startZ, endX, endZ, sampleTerrain, SUPER_CHUNK_TERRAIN_STEP)
        );
        const terrainMesh = new THREE.Mesh(geometry, terrainMaterial);
        terrainMesh.position.set(startX + width / 2, SUPER_CHUNK_VERTICAL_OFFSET, startZ + depth / 2);

        const group = buildChunkGroup(terrainMesh);
        group.visible = isSuperChunkVisible(sx, sz);

        const superChunk = {
            key,
            sx,
            sz,
            group
        };
        scene.add(group);
        superChunks.set(key, superChunk);
        diagnostics.setCounter('loadedSuperChunks', superChunks.size);
        diagnostics.setCounter('visibleSuperChunks', [...superChunks.values()].filter((item) => item.group.visible).length);
        return superChunk;
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

    function unloadSuperChunk(key) {
        const superChunk = superChunks.get(key);
        if (!superChunk) return;

        superChunk.group.userData.disposed = true;
        scene.remove(superChunk.group);
        superChunk.group.traverse((object) => {
            if (object.geometry) object.geometry.dispose();
        });
        superChunk.group.clear();
        superChunks.delete(key);
        diagnostics.setCounter('loadedSuperChunks', superChunks.size);
        diagnostics.setCounter('visibleSuperChunks', [...superChunks.values()].filter((item) => item.group.visible).length);
    }

    function restoreRetiredChunk(key, playerChunkX, playerChunkZ) {
        const chunk = retiredChunks.get(key);
        if (!chunk) return false;

        retiredChunks.delete(key);
        chunk.group.visible = isChunkVisible(chunk.cx, chunk.cz, playerChunkX, playerChunkZ);
        scene.add(chunk.group);
        chunks.set(key, chunk);
        diagnostics.setCounter('loadedChunks', chunks.size);
        diagnostics.setCounter('visibleChunks', [...chunks.values()].filter((item) => item.group.visible).length);
        diagnostics.setCounter('retiredChunks', retiredChunks.size);
        return true;
    }

    function retireChunk(key) {
        const chunk = chunks.get(key);
        if (!chunk) return;

        scene.remove(chunk.group);
        chunks.delete(key);
        retiredChunks.delete(key);
        retiredChunks.set(key, chunk);
        diagnostics.setCounter('loadedChunks', chunks.size);
        diagnostics.setCounter('retiredChunks', retiredChunks.size);

        while (retiredChunks.size > RETIRED_CHUNK_CACHE_LIMIT) {
            const oldestKey = retiredChunks.keys().next().value;
            disposeRetiredChunk(oldestKey);
        }
    }

    function disposeRetiredChunk(key) {
        const chunk = retiredChunks.get(key);
        if (!chunk) return;

        chunk.group.userData.disposed = true;
        chunk.group.traverse((object) => {
            if (object.geometry) object.geometry.dispose();
        });
        chunk.group.clear();
        retiredChunks.delete(key);
        diagnostics.setCounter('retiredChunks', retiredChunks.size);
    }

    function dispose() {
        for (const key of [...chunks.keys()]) {
            unloadChunk(key);
        }
        for (const key of [...superChunks.keys()]) {
            unloadSuperChunk(key);
        }
        for (const key of [...retiredChunks.keys()]) {
            disposeRetiredChunk(key);
        }
        sharedSampleCache.clear();
        terrainMaterial.dispose();
    }

    function updateChunks(playerX, playerZ) {
        const now = performance.now();
        const previousFrameMs = now - lastChunkUpdateTime;
        lastChunkUpdateTime = now;

        const playerChunkX = Math.floor(playerX / CHUNK_SIZE);
        const playerChunkZ = Math.floor(playerZ / CHUNK_SIZE);

        if (playerChunkX !== lastPlayerChunkX || playerChunkZ !== lastPlayerChunkZ) {
            lastPlayerChunkX = playerChunkX;
            lastPlayerChunkZ = playerChunkZ;
            refreshChunkQueue(playerChunkX, playerChunkZ);
        }

        if (didInitialChunkBurst) {
            if (previousFrameMs > SLOW_FRAME_GENERATION_PAUSE_MS) return;
            processChunkQueue();
        } else {
            processInitialChunkBurst();
            didInitialChunkBurst = true;
        }
    }

    function getHeight(posX, posZ) {
        const chunkX = Math.floor(posX / CHUNK_SIZE);
        const chunkZ = Math.floor(posZ / CHUNK_SIZE);
        const chunk = chunks.get(getChunkKey(chunkX, chunkZ));
        const loadedHeight = chunk?.sampleGrid.sampleHeightBilinear(posX, posZ);
        if (loadedHeight !== undefined) return loadedHeight;
        return getCachedHeight(posX, posZ);
    }

    function getSample(posX, posZ) {
        return createTerrainSample(posX, posZ);
    }

    updateChunks(0, 0);

    return { getHeight, getSample, updateChunks, dispose };
}
