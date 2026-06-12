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
import { createSuperChunkTerrainMaterial, createTerrainMaterial } from './materials.js';
import { createChunkTerrainGeometry } from './terrainMesh.js';
import { createChunkSampleGrid, createChunkSampleGridBuilder } from './chunkSampleGrid.js';
import { canPlaceGrassOnSample } from './vegetationRules.js';

const CHUNK_SIZE = CONFIG.terreno.tamanhoChunk;
const VIEW_DISTANCE = CONFIG.terreno.distanciaChunks;
const PREFETCH_DISTANCE = VIEW_DISTANCE + CONFIG.terreno.distanciaPreloadChunks;
const CHUNK_GENERATION_BUDGET_MS = CONFIG.terreno.tempoGeracaoChunksMs ?? 3;
const CHUNK_MOVING_GENERATION_BUDGET_MS = CONFIG.terreno.tempoGeracaoChunksMovendoMs ?? 1;
const CHUNK_MOVING_SLOW_FRAME_BUDGET_MS = CONFIG.terreno.tempoGeracaoChunksMovendoFrameLentoMs ?? 0.35;
const MOVING_CHUNK_CHANGE_GENERATION_CREDITS = CONFIG.terreno.chunksGeracaoPorTrocaMovendo ?? 3;
const MOVING_URGENT_CHUNK_DISTANCE = CONFIG.terreno.distanciaChunksUrgentesMovendo ?? 8;
const INITIAL_CHUNK_BURST = 9;
const SLOW_FRAME_GENERATION_PAUSE_MS = 40;
const QUEUE_BUILD_BUDGET_MS = CONFIG.terreno.tempoMontagemFilaChunksMs ?? 1.2;
const QUEUE_BUILD_MOVING_BUDGET_MS = CONFIG.terreno.tempoMontagemFilaChunksMovendoMs ?? 0.35;
const MAX_CHUNK_QUEUE_LENGTH = 512;
const SIMPLE_SAMPLE_TERRAIN_STEP = 8;
const SUPER_CHUNK_SIZE_IN_CHUNKS = 8;
const SUPER_CHUNK_TERRAIN_STEP = 16;
const SUPER_CHUNK_VERTICAL_OFFSET = 0;
const LOD_UPGRADE_MARGIN_CHUNKS = 1;
const SUPER_CHUNK_MOVING_TRANSITION_BUFFER_CHUNKS = CONFIG.terreno.bufferTransicaoChunksMovendo
    ?? CONFIG.terreno.distanciaTransicaoSuperChunkMovendoChunks
    ?? 2;
const SUPER_CHUNK_MASK_FOCUSES = 2;
const SUPER_CHUNK_PRIORITY_OFFSET = 4;
const TERRAIN_SAMPLE_CACHE_LIMIT = 65536;
const RETIRED_CHUNK_CACHE_LIMIT = 160;
const GRASS_CHUNK_PROBE_STEPS = 4;
const MACRO_CHUNK_CONFIG = CONFIG.terreno.macroSuperChunks ?? {};
const MACRO_CHUNKS_ENABLED = MACRO_CHUNK_CONFIG.ativo !== false;
const MACRO_CHUNK_SIZE_IN_CHUNKS = Math.max(1, MACRO_CHUNK_CONFIG.tamanhoEmChunks ?? 128);
const MACRO_CHUNK_WORLD_SIZE = MACRO_CHUNK_SIZE_IN_CHUNKS * CHUNK_SIZE;
const MACRO_CHUNK_TERRAIN_STEP = Math.max(CHUNK_SIZE, MACRO_CHUNK_CONFIG.passoTerreno ?? CHUNK_SIZE * 16);
const MACRO_CHUNK_HIDE_DISTANCE = MACRO_CHUNK_CONFIG.esconderAteDistanciaChunks ?? VIEW_DISTANCE;
const MACRO_CHUNK_VERTICAL_OFFSET = MACRO_CHUNK_CONFIG.deslocamentoVertical ?? 0;
const MACRO_CHUNK_GENERATION_BUDGET_MS = MACRO_CHUNK_CONFIG.tempoGeracaoMs ?? 8;

const WORLD_MIN = -CONFIG.terreno.tamanhoGrade / 2;
const WORLD_MAX = CONFIG.terreno.tamanhoGrade / 2;
const MACRO_CHUNK_COLUMNS = Math.ceil((WORLD_MAX - WORLD_MIN) / MACRO_CHUNK_WORLD_SIZE);
const MACRO_CHUNK_ROWS = MACRO_CHUNK_COLUMNS;
const MACRO_CHUNK_TOTAL = MACRO_CHUNKS_ENABLED ? MACRO_CHUNK_COLUMNS * MACRO_CHUNK_ROWS : 0;

function getIndividualChunkDistance() {
    const finiteLods = CONFIG.terreno.lodChunks
        ?.map((lod) => lod.distancia)
        .filter((distance) => Number.isFinite(distance) && distance < 9999);
    const baseDistance = Math.max(...finiteLods, 0);
    return Math.ceil((baseDistance + 1) / SUPER_CHUNK_SIZE_IN_CHUNKS) * SUPER_CHUNK_SIZE_IN_CHUNKS - 1;
}

const INDIVIDUAL_CHUNK_DISTANCE = getIndividualChunkDistance();
const INDIVIDUAL_PREFETCH_DISTANCE = INDIVIDUAL_CHUNK_DISTANCE + CONFIG.terreno.distanciaPreloadChunks;
const SUPER_CHUNK_MASK_DISTANCE = INDIVIDUAL_PREFETCH_DISTANCE + SUPER_CHUNK_MOVING_TRANSITION_BUFFER_CHUNKS;

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

function getSharedCachedSample(sharedSampleCache, x, z, sampleFactory = createTerrainSample, cacheNamespace = 'full') {
    const key = `${cacheNamespace}:${x},${z}`;
    let sample = sharedSampleCache.get(key);
    if (!sample) {
        sample = sampleFactory(x, z);
        sharedSampleCache.set(key, sample);
    }
    return sample;
}

function createChunkSampler(sharedSampleCache, sampleGrid = null, sampleFactory = createTerrainSample, cacheNamespace = 'full') {
    const samples = new Map();

    return function sampleTerrain(x, z) {
        const gridSample = sampleGrid?.getGridSampleExact?.(x, z)
            ?? sampleGrid?.getSample?.(x, z);
        if (gridSample) return gridSample;

        const key = `${cacheNamespace}:${x},${z}`;
        let sample = samples.get(key);
        if (!sample) {
            sample = getSharedCachedSample(sharedSampleCache, x, z, sampleFactory, cacheNamespace);
        }
        if (!samples.has(key)) {
            samples.set(key, sample);
        }
        return sample;
    };
}

export function createTerrain(scene, diagnostics) {
    const terrainMaterial = createTerrainMaterial();
    const superChunkTerrainMaterial = createSuperChunkTerrainMaterial({
        chunkSize: CHUNK_SIZE,
        maskDistance: SUPER_CHUNK_MASK_DISTANCE,
        maxFocuses: SUPER_CHUNK_MASK_FOCUSES
    });
    const macroChunkTerrainMaterial = createSuperChunkTerrainMaterial({
        chunkSize: CHUNK_SIZE,
        maskDistance: MACRO_CHUNK_HIDE_DISTANCE,
        maxFocuses: SUPER_CHUNK_MASK_FOCUSES
    });

    const chunks = new Map();
    const superChunks = new Map();
    const macroChunks = new Map();
    const retiredChunks = new Map();
    const sharedSampleCache = createTerrainSampleCache(TERRAIN_SAMPLE_CACHE_LIMIT);
    let chunkLifecycle = null;
    let chunkLoadQueue = [];
    const queuedChunkKeys = new Set();
    const queuedSuperChunkKeys = new Set();
    let lastPlayerChunkX = null;
    let lastPlayerChunkZ = null;
    let lastFocusSignature = '';
    let lastChunkFocuses = [];
    let didInitialChunkBurst = false;
    let activeChunkJob = null;
    let queueBuildJob = null;
    let lastChunkUpdateTime = performance.now();
    let movingChunkGenerationCredits = 0;
    let superChunkMaskDirty = true;
    let superChunkMaskFocusSignature = '';
    let macroChunkQueue = [];
    let macroChunkQueueReady = false;
    let activeMacroChunkJob = null;
    let chunkTransitionBufferChunks = 0;

    function getIndividualChunkDistanceLimit() {
        return INDIVIDUAL_PREFETCH_DISTANCE + chunkTransitionBufferChunks;
    }

    function getChunkDistance(cx, cz, playerChunkX = null, playerChunkZ = null) {
        if (playerChunkX !== null && playerChunkZ !== null) {
            return Math.max(Math.abs(cx - playerChunkX), Math.abs(cz - playerChunkZ));
        }

        if (!lastChunkFocuses.length) return 0;

        let closestDistance = Infinity;
        for (const focus of lastChunkFocuses) {
            closestDistance = Math.min(
                closestDistance,
                Math.max(Math.abs(cx - focus.chunkX), Math.abs(cz - focus.chunkZ))
            );
        }
        return closestDistance;
    }

    function isChunkVisible(cx, cz, playerChunkX = null, playerChunkZ = null) {
        return getChunkDistance(cx, cz, playerChunkX, playerChunkZ) <= getIndividualChunkDistanceLimit();
    }

    function isChunkNeeded(cx, cz, playerChunkX = null, playerChunkZ = null) {
        if ((playerChunkX === null || playerChunkZ === null) && !lastChunkFocuses.length) return false;
        return getChunkDistance(cx, cz, playerChunkX, playerChunkZ) <= getIndividualChunkDistanceLimit();
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

    function getChunkVariantKey(cx, cz, terrainStep) {
        return `${getChunkKey(cx, cz)}@${terrainStep}`;
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

    function getSuperChunkDistanceForFocus(sx, sz, focus) {
        const { minCx, minCz, maxCx, maxCz } = getSuperChunkChunkBounds(sx, sz);
        const dx = focus.chunkX < minCx ? minCx - focus.chunkX : Math.max(0, focus.chunkX - maxCx);
        const dz = focus.chunkZ < minCz ? minCz - focus.chunkZ : Math.max(0, focus.chunkZ - maxCz);
        return Math.max(dx, dz);
    }

    function getSuperChunkDistance(sx, sz, playerChunkX = null, playerChunkZ = null) {
        if (playerChunkX !== null && playerChunkZ !== null) {
            return getSuperChunkDistanceForFocus(sx, sz, { chunkX: playerChunkX, chunkZ: playerChunkZ });
        }

        if (!lastChunkFocuses.length) return 0;

        let closestDistance = Infinity;
        for (const focus of lastChunkFocuses) {
            closestDistance = Math.min(closestDistance, getSuperChunkDistanceForFocus(sx, sz, focus));
        }
        return closestDistance;
    }

    function isSuperChunkVisible(sx, sz, playerChunkX = null, playerChunkZ = null) {
        const distance = getSuperChunkDistance(sx, sz, playerChunkX, playerChunkZ);
        return distance <= VIEW_DISTANCE;
    }

    function isSuperChunkNeeded(sx, sz, playerChunkX = null, playerChunkZ = null) {
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

    function getMacroChunkKey(mx, mz) {
        return `m:${mx},${mz}`;
    }

    function getMacroChunkBounds(mx, mz) {
        const startX = WORLD_MIN + mx * MACRO_CHUNK_WORLD_SIZE;
        const startZ = WORLD_MIN + mz * MACRO_CHUNK_WORLD_SIZE;
        return {
            startX,
            startZ,
            endX: Math.min(WORLD_MAX, startX + MACRO_CHUNK_WORLD_SIZE),
            endZ: Math.min(WORLD_MAX, startZ + MACRO_CHUNK_WORLD_SIZE)
        };
    }

    function getMacroChunkPriority(item, focuses) {
        if (!focuses?.length) return item.mz * MACRO_CHUNK_COLUMNS + item.mx;

        const centerChunkX = Math.floor(((item.startX + item.endX) * 0.5) / CHUNK_SIZE);
        const centerChunkZ = Math.floor(((item.startZ + item.endZ) * 0.5) / CHUNK_SIZE);
        let closestDistance = Infinity;
        for (const focus of focuses) {
            closestDistance = Math.min(
                closestDistance,
                Math.max(Math.abs(centerChunkX - focus.chunkX), Math.abs(centerChunkZ - focus.chunkZ))
            );
        }
        return closestDistance;
    }

    function ensureMacroChunkQueue(focuses = lastChunkFocuses) {
        if (!MACRO_CHUNKS_ENABLED || macroChunkQueueReady) return;

        const queue = [];
        for (let mz = 0; mz < MACRO_CHUNK_ROWS; mz++) {
            for (let mx = 0; mx < MACRO_CHUNK_COLUMNS; mx++) {
                const key = getMacroChunkKey(mx, mz);
                if (macroChunks.has(key)) continue;
                const bounds = getMacroChunkBounds(mx, mz);
                if (bounds.startX >= bounds.endX || bounds.startZ >= bounds.endZ) continue;
                queue.push({ mx, mz, key, ...bounds });
            }
        }

        macroChunkQueue = queue.sort((a, b) => getMacroChunkPriority(a, focuses) - getMacroChunkPriority(b, focuses));
        macroChunkQueueReady = true;
        diagnostics.setCounter('macroChunkQueue', macroChunkQueue.length);
        diagnostics.setCounter('macroChunkTotal', MACRO_CHUNK_TOTAL);
    }

    function updateMacroChunkMaskFocuses(focuses) {
        if (!MACRO_CHUNKS_ENABLED) return;

        const maskedFocuses = focuses.slice(0, SUPER_CHUNK_MASK_FOCUSES).map((focus) => ({
            ...focus,
            maskDistance: MACRO_CHUNK_HIDE_DISTANCE
        }));
        macroChunkTerrainMaterial.userData.setMaskFocuses?.(maskedFocuses);
    }

    function getTerrainStepForDistance(distance) {
        const profile = CONFIG.terreno.lodChunks?.find((lod) => distance <= lod.distancia);
        return profile?.passoTerreno ?? CONFIG.terreno.passoTerreno;
    }

    function getDesiredTerrainStepForDistance(distance) {
        return getTerrainStepForDistance(Math.max(0, distance - LOD_UPGRADE_MARGIN_CHUNKS));
    }

    function getDesiredTerrainStepForChunk(cx, cz) {
        return getDesiredTerrainStepForDistance(getChunkDistance(cx, cz));
    }

    function getSampleFactoryForTerrainStep(terrainStep) {
        return terrainStep >= SIMPLE_SAMPLE_TERRAIN_STEP
            ? createTerrainHeightSample
            : createTerrainSample;
    }

    function getSampleCacheNamespaceForTerrainStep(terrainStep) {
        return terrainStep >= SIMPLE_SAMPLE_TERRAIN_STEP ? 'simple' : 'full';
    }

    function enqueueChunk(cx, cz) {
        const chunkKey = getChunkKey(cx, cz);
        restoreRetiredChunk(chunkKey);
        const visibleDistance = getChunkDistance(cx, cz);
        const terrainStep = getDesiredTerrainStepForDistance(visibleDistance);
        const variantKey = getChunkVariantKey(cx, cz, terrainStep);
        const chunk = chunks.get(chunkKey);

        if (chunk?.variants.has(terrainStep)) {
            setActiveChunkVariant(chunk, terrainStep);
            return;
        }
        if (activeChunkJob?.key === variantKey || queuedChunkKeys.has(variantKey)) return;

        chunkLoadQueue.push({
            cx,
            cz,
            key: variantKey,
            chunkKey,
            type: 'chunk',
            terrainStep,
            priority: visibleDistance > VIEW_DISTANCE
                ? visibleDistance + VIEW_DISTANCE
                : Math.max(0, visibleDistance - 0.5)
        });
        queuedChunkKeys.add(variantKey);
        diagnostics.setCounter('chunkQueue', chunkLoadQueue.length);
    }

    function enqueueSuperChunkForChunk(cx, cz) {
        const sx = getSuperChunkIndex(cx);
        const sz = getSuperChunkIndex(cz);
        const key = getSuperChunkKey(sx, sz);

        if (!hasSuperChunkArea(sx, sz)) return;
        if (!isSuperChunkNeeded(sx, sz)) return;
        if (activeChunkJob?.key === key) return;
        if (superChunks.has(key) || queuedSuperChunkKeys.has(key)) return;

        const visibleDistance = getSuperChunkDistance(sx, sz);
        chunkLoadQueue.push({
            sx,
            sz,
            key,
            type: 'super',
            terrainStep: SUPER_CHUNK_TERRAIN_STEP,
            priority: visibleDistance + SUPER_CHUNK_PRIORITY_OFFSET
        });
        queuedSuperChunkKeys.add(key);
        diagnostics.setCounter('chunkQueue', chunkLoadQueue.length);
    }

    function refreshChunkQueue() {
        for (const key of [...chunks.keys()]) {
            const chunk = chunks.get(key);
            if (!isChunkNeeded(chunk.cx, chunk.cz)) {
                retireChunk(key);
            }
        }

        for (const key of [...superChunks.keys()]) {
            const superChunk = superChunks.get(key);
            if (!isSuperChunkNeeded(superChunk.sx, superChunk.sz)) {
                unloadSuperChunk(key);
            }
        }

        chunkLoadQueue = [];
        queuedChunkKeys.clear();
        queuedSuperChunkKeys.clear();
        diagnostics.setCounter('chunkQueue', chunkLoadQueue.length);

        let visibleChunks = 0;
        for (const chunk of chunks.values()) {
            const wasVisible = chunk.group.visible;
            chunk.group.visible = isChunkVisible(chunk.cx, chunk.cz);
            if (wasVisible !== chunk.group.visible) markSuperChunkMaskDirty();
            if (chunk.group.visible) visibleChunks++;
            if (isChunkNeeded(chunk.cx, chunk.cz)) {
                enqueueChunk(chunk.cx, chunk.cz);
            }
        }
        diagnostics.setCounter('visibleChunks', visibleChunks);

        let visibleSuperChunks = 0;
        for (const superChunk of superChunks.values()) {
            superChunk.group.visible = isSuperChunkVisible(superChunk.sx, superChunk.sz);
            if (superChunk.group.visible) visibleSuperChunks++;
        }
        diagnostics.setCounter('visibleSuperChunks', visibleSuperChunks);

        if (activeChunkJob && !isQueueItemNeeded(activeChunkJob)) {
            activeChunkJob = null;
        }

        queueBuildJob = createQueueBuildJob(lastChunkFocuses);
    }

    function takeNextQueueItem() {
        if (!chunkLoadQueue.length) return null;

        let bestIndex = 0;
        for (let i = 1; i < chunkLoadQueue.length; i++) {
            if (chunkLoadQueue[i].priority < chunkLoadQueue[bestIndex].priority) {
                bestIndex = i;
            }
        }

        const [next] = chunkLoadQueue.splice(bestIndex, 1);
        if (next.type === 'super') {
            queuedSuperChunkKeys.delete(next.key);
        } else {
            queuedChunkKeys.delete(next.key);
        }
        diagnostics.setCounter('chunkQueue', chunkLoadQueue.length);
        return next;
    }

    function processInitialChunkBurst() {
        processQueueBuild(performance.now() + QUEUE_BUILD_BUDGET_MS * 4);

        let created = 0;
        while (created < INITIAL_CHUNK_BURST && chunkLoadQueue.length > 0) {
            const next = takeNextQueueItem();
            if (!next) break;

            if (!isQueueItemNeeded(next) || isQueueItemLoaded(next)) continue;
            if (diagnostics.measure('createChunk', () => createQueueItemNow(next))) {
                created++;
            }
        }
    }

    function processChunkQueue(
        generationBudgetMs = CHUNK_GENERATION_BUDGET_MS,
        queueBuildBudgetMs = QUEUE_BUILD_BUDGET_MS,
        options = {}
    ) {
        const allowStartingNewJob = options.allowStartingNewJob ?? true;
        const maxFinishedItems = options.maxFinishedItems ?? Infinity;
        if (generationBudgetMs <= 0 && queueBuildBudgetMs <= 0) return 0;

        const startedAt = performance.now();
        let deadline = startedAt + generationBudgetMs;
        let finishedItems = 0;
        processQueueBuild(startedAt + queueBuildBudgetMs);

        if (generationBudgetMs <= 0) return finishedItems;

        while (performance.now() < deadline && finishedItems < maxFinishedItems) {
            if (!activeChunkJob) {
                if (!allowStartingNewJob) return finishedItems;
                activeChunkJob = startNextChunkJob();
                if (!activeChunkJob) return finishedItems;
            }

            if (!isQueueItemNeeded(activeChunkJob) || isQueueItemLoaded(activeChunkJob)) {
                activeChunkJob = null;
                continue;
            }

            const isReady = diagnostics.measure(
                'chunkSampleGrid',
                () => activeChunkJob.sampleGridBuilder.stepUntil(deadline)
            );
            if (!isReady) return finishedItems;

            diagnostics.measure(
                'createChunk',
                () => finishChunkJob(activeChunkJob)
            );
            activeChunkJob = null;
            finishedItems++;

            deadline = startedAt + generationBudgetMs;
        }

        return finishedItems;
    }

    function createQueueBuildJob(focuses) {
        return {
            focuses: [...focuses],
            focusIndex: 0,
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
            if (!queueBuildJob.focuses.length) {
                queueBuildJob = null;
                return;
            }

            const ringLength = getRingLength(queueBuildJob.ring);
            const focus = queueBuildJob.focuses[queueBuildJob.focusIndex];
            const { dx, dz } = getRingOffset(queueBuildJob.ring, queueBuildJob.index);
            const cx = focus.chunkX + dx;
            const cz = focus.chunkZ + dz;

            if (hasChunkArea(cx, cz)) {
                enqueueSuperChunkForChunk(cx, cz);
                if (queueBuildJob.ring <= getIndividualChunkDistanceLimit()) {
                    enqueueChunk(cx, cz);
                }
            }

            queueBuildJob.focusIndex++;
            if (queueBuildJob.focusIndex >= queueBuildJob.focuses.length) {
                queueBuildJob.focusIndex = 0;
                queueBuildJob.index++;
            }
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

    function enqueueUrgentMovingChunks(focuses) {
        const maxDistance = Math.min(MOVING_URGENT_CHUNK_DISTANCE, getIndividualChunkDistanceLimit());
        for (const focus of focuses) {
            for (let dz = -maxDistance; dz <= maxDistance; dz++) {
                for (let dx = -maxDistance; dx <= maxDistance; dx++) {
                    const cx = focus.chunkX + dx;
                    const cz = focus.chunkZ + dz;
                    if (hasChunkArea(cx, cz)) {
                        enqueueChunk(cx, cz);
                    }
                }
            }
        }
    }

    function isQueueItemNeeded(item) {
        if (item.type === 'super') return isSuperChunkNeeded(item.sx, item.sz);
        return isChunkNeeded(item.cx, item.cz)
            && getDesiredTerrainStepForChunk(item.cx, item.cz) === item.terrainStep;
    }

    function isQueueItemLoaded(item) {
        if (item.type === 'super') return superChunks.has(item.key);
        return chunks.get(item.chunkKey)?.variants.has(item.terrainStep) ?? false;
    }

    function createQueueItemNow(item) {
        return item.type === 'super'
            ? createSuperChunk(item.sx, item.sz)
            : createChunk(item.cx, item.cz, item.terrainStep);
    }

    function startNextChunkJob() {
        while (chunkLoadQueue.length > 0) {
            const next = takeNextQueueItem();
            if (!next) return null;

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
        const chunk = chunks.get(key);
        if (chunk?.variants.has(terrainStep)) {
            setActiveChunkVariant(chunk, terrainStep);
            return chunk;
        }

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

    function startNextMacroChunkJob(focuses = lastChunkFocuses) {
        if (!MACRO_CHUNKS_ENABLED) return null;

        ensureMacroChunkQueue(focuses);
        while (macroChunkQueue.length > 0) {
            const next = macroChunkQueue.shift();
            if (!next || macroChunks.has(next.key)) continue;

            const baseSampleTerrain = createChunkSampler(
                sharedSampleCache,
                null,
                createTerrainHeightSample,
                'macro'
            );
            diagnostics.setCounter('macroChunkQueue', macroChunkQueue.length);
            return {
                ...next,
                sampleGridBuilder: createChunkSampleGridBuilder(
                    next.startX,
                    next.startZ,
                    next.endX,
                    next.endZ,
                    MACRO_CHUNK_TERRAIN_STEP,
                    baseSampleTerrain
                )
            };
        }

        diagnostics.setCounter('macroChunkQueue', macroChunkQueue.length);
        return null;
    }

    function createMacroChunkFromHeightMap(job, heightMap) {
        if (macroChunks.has(job.key)) return macroChunks.get(job.key);

        const sampleTerrain = createChunkSampler(sharedSampleCache, heightMap, createTerrainHeightSample, 'macro');
        const { geometry, width, depth } = diagnostics.measure(
            'macroChunkGeometry',
            () => createChunkTerrainGeometry(job.startX, job.startZ, job.endX, job.endZ, sampleTerrain, MACRO_CHUNK_TERRAIN_STEP)
        );
        const terrainMesh = new THREE.Mesh(geometry, macroChunkTerrainMaterial);
        terrainMesh.position.set(
            job.startX + width / 2,
            MACRO_CHUNK_VERTICAL_OFFSET,
            job.startZ + depth / 2
        );

        const group = buildChunkGroup(terrainMesh);
        group.name = `macro-terrain-${job.mx},${job.mz}`;
        scene.add(group);

        const macroChunk = {
            key: job.key,
            mx: job.mx,
            mz: job.mz,
            group
        };
        macroChunks.set(job.key, macroChunk);
        diagnostics.setCounter('loadedMacroChunks', macroChunks.size);
        diagnostics.setCounter('macroChunkProgress', getMacroWorldProgress());
        return macroChunk;
    }

    function processMacroWorld(deadlineMs, focuses = lastChunkFocuses) {
        if (!MACRO_CHUNKS_ENABLED) return true;

        ensureMacroChunkQueue(focuses);
        while (performance.now() < deadlineMs) {
            if (!activeMacroChunkJob) {
                activeMacroChunkJob = startNextMacroChunkJob(focuses);
                if (!activeMacroChunkJob) break;
            }

            const isReady = diagnostics.measure(
                'macroChunkSampleGrid',
                () => activeMacroChunkJob.sampleGridBuilder.stepUntil(deadlineMs)
            );
            if (!isReady) break;

            const finishedJob = activeMacroChunkJob;
            activeMacroChunkJob = null;
            const heightMap = finishedJob.sampleGridBuilder.finish();
            createMacroChunkFromHeightMap(finishedJob, heightMap);
        }

        diagnostics.setCounter('macroChunkQueue', macroChunkQueue.length);
        diagnostics.setCounter('loadedMacroChunks', macroChunks.size);
        diagnostics.setCounter('macroChunkProgress', getMacroWorldProgress());
        return isMacroWorldReady();
    }

    function createChunkGrassMetadata(cx, cz, heightMap) {
        const startX = cx * CHUNK_SIZE;
        const startZ = cz * CHUNK_SIZE;

        for (let ix = 0; ix < GRASS_CHUNK_PROBE_STEPS; ix++) {
            const rx = (ix + 0.5) / GRASS_CHUNK_PROBE_STEPS;
            for (let iz = 0; iz < GRASS_CHUNK_PROBE_STEPS; iz++) {
                const rz = (iz + 0.5) / GRASS_CHUNK_PROBE_STEPS;
                const x = startX + rx * CHUNK_SIZE;
                const z = startZ + rz * CHUNK_SIZE;
                const sample = heightMap.sampleTerrainBilinear?.(x, z) ?? createTerrainSample(x, z);
                if (canPlaceGrassOnSample(sample)) {
                    return { canContainGrass: true };
                }
            }
        }

        return { canContainGrass: false };
    }

    function markSuperChunkMaskDirty() {
        superChunkMaskDirty = true;
    }

    function createChunkTerrainVariant(cx, cz, terrainStep, startX, startZ, endX, endZ, heightMap) {
        const sampleTerrain = createChunkSampler(sharedSampleCache, heightMap);
        const { geometry, width, depth } = diagnostics.measure(
            'terrainGeometry',
            () => createChunkTerrainGeometry(startX, startZ, endX, endZ, sampleTerrain, terrainStep)
        );
        const terrainMesh = new THREE.Mesh(geometry, terrainMaterial);
        terrainMesh.position.set(startX + width / 2, 0, startZ + depth / 2);

        return {
            terrainStep,
            mesh: terrainMesh,
            sampleGrid: heightMap,
            grassMetadata: createChunkGrassMetadata(cx, cz, heightMap)
        };
    }

    function setActiveChunkVariant(chunk, terrainStep) {
        const variant = chunk.variants.get(terrainStep);
        if (!variant || chunk.activeVariant === variant) return false;

        if (chunk.activeVariant?.mesh.parent === chunk.group) {
            chunk.group.remove(chunk.activeVariant.mesh);
        }
        chunk.group.add(variant.mesh);
        chunk.activeVariant = variant;
        chunk.activeTerrainStep = terrainStep;
        chunk.terrainStep = terrainStep;
        chunk.sampleGrid = variant.sampleGrid;
        chunk.grassMetadata = variant.grassMetadata;
        markSuperChunkMaskDirty();
        return true;
    }

    function createChunkFromHeightMap(cx, cz, terrainStep, startX, startZ, endX, endZ, heightMap) {
        const key = getChunkKey(cx, cz);
        let chunk = chunks.get(key);
        const variant = createChunkTerrainVariant(cx, cz, terrainStep, startX, startZ, endX, endZ, heightMap);

        if (chunk) {
            if (!chunk.variants.has(terrainStep)) {
                chunk.variants.set(terrainStep, variant);
            } else {
                variant.mesh.geometry.dispose();
            }

            const desiredTerrainStep = getDesiredTerrainStepForChunk(cx, cz);
            if (
                !chunk.activeVariant
                || terrainStep === desiredTerrainStep
                || terrainStep < chunk.activeTerrainStep
            ) {
                setActiveChunkVariant(chunk, terrainStep);
            }
            chunk.group.visible = isChunkVisible(cx, cz);
            markSuperChunkMaskDirty();
            return chunk;
        }

        const chunkGroup = new THREE.Group();
        chunkGroup.visible = isChunkVisible(cx, cz);

        chunk = {
            key,
            cx,
            cz,
            terrainStep,
            group: chunkGroup,
            variants: new Map([[terrainStep, variant]]),
            activeVariant: null,
            activeTerrainStep: null,
            sampleGrid: null
        };
        setActiveChunkVariant(chunk, terrainStep);
        scene.add(chunkGroup);
        chunks.set(key, chunk);
        diagnostics.setCounter('loadedChunks', chunks.size);
        diagnostics.setCounter('visibleChunks', [...chunks.values()].filter((item) => item.group.visible).length);
        markSuperChunkMaskDirty();
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
        const terrainMesh = new THREE.Mesh(geometry, superChunkTerrainMaterial);
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

    function disposeChunkTerrainVariants(chunk) {
        for (const variant of chunk.variants?.values() ?? []) {
            variant.mesh.parent?.remove(variant.mesh);
            variant.mesh.geometry?.dispose();
        }
        chunk.variants?.clear();
        chunk.activeVariant = null;
        chunk.sampleGrid = null;
    }

    function unloadChunk(key) {
        const chunk = chunks.get(key);
        if (!chunk) return;

        chunkLifecycle?.onChunkDisposed?.(chunk);
        chunk.group.userData.disposed = true;
        disposeChunkTerrainVariants(chunk);
        scene.remove(chunk.group);
        chunk.group.traverse((object) => {
            if (object.geometry) object.geometry.dispose();
        });
        chunk.group.clear();
        chunks.delete(key);
        diagnostics.setCounter('loadedChunks', chunks.size);
        markSuperChunkMaskDirty();
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

    function unloadMacroChunk(key) {
        const macroChunk = macroChunks.get(key);
        if (!macroChunk) return;

        macroChunk.group.userData.disposed = true;
        scene.remove(macroChunk.group);
        macroChunk.group.traverse((object) => {
            if (object.geometry) object.geometry.dispose();
        });
        macroChunk.group.clear();
        macroChunks.delete(key);
        diagnostics.setCounter('loadedMacroChunks', macroChunks.size);
    }

    function restoreRetiredChunk(key) {
        const chunk = retiredChunks.get(key);
        if (!chunk) return false;

        retiredChunks.delete(key);
        chunk.group.visible = isChunkVisible(chunk.cx, chunk.cz);
        scene.add(chunk.group);
        chunks.set(key, chunk);
        diagnostics.setCounter('loadedChunks', chunks.size);
        diagnostics.setCounter('visibleChunks', [...chunks.values()].filter((item) => item.group.visible).length);
        diagnostics.setCounter('retiredChunks', retiredChunks.size);
        markSuperChunkMaskDirty();
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
        markSuperChunkMaskDirty();

        while (retiredChunks.size > RETIRED_CHUNK_CACHE_LIMIT) {
            const oldestKey = retiredChunks.keys().next().value;
            disposeRetiredChunk(oldestKey);
        }
    }

    function disposeRetiredChunk(key) {
        const chunk = retiredChunks.get(key);
        if (!chunk) return;

        chunkLifecycle?.onChunkDisposed?.(chunk);
        chunk.group.userData.disposed = true;
        disposeChunkTerrainVariants(chunk);
        chunk.group.traverse((object) => {
            if (object.geometry) object.geometry.dispose();
        });
        chunk.group.clear();
        retiredChunks.delete(key);
        diagnostics.setCounter('retiredChunks', retiredChunks.size);
        markSuperChunkMaskDirty();
    }

    function dispose() {
        for (const key of [...chunks.keys()]) {
            unloadChunk(key);
        }
        for (const key of [...superChunks.keys()]) {
            unloadSuperChunk(key);
        }
        for (const key of [...macroChunks.keys()]) {
            unloadMacroChunk(key);
        }
        for (const key of [...retiredChunks.keys()]) {
            disposeRetiredChunk(key);
        }
        sharedSampleCache.clear();
        terrainMaterial.dispose();
        superChunkTerrainMaterial.dispose();
        macroChunkTerrainMaterial.dispose();
    }

    function createChunkFocuses(positions) {
        const seen = new Set();
        const focuses = [];

        for (const position of positions) {
            const chunkX = Math.floor(position.x / CHUNK_SIZE);
            const chunkZ = Math.floor(position.z / CHUNK_SIZE);
            const key = `${chunkX},${chunkZ}`;
            if (seen.has(key)) continue;

            seen.add(key);
            focuses.push({ chunkX, chunkZ });
        }

        return focuses;
    }

    function getFocusSignature(focuses) {
        return focuses.map((focus) => `${focus.chunkX},${focus.chunkZ}`).join('|');
    }

    function isChunkLoadedForMask(cx, cz) {
        const chunk = chunks.get(getChunkKey(cx, cz));
        return Boolean(chunk?.group.visible && chunk.activeVariant);
    }

    function getSafeSuperChunkMaskDistanceForFocus(focus) {
        let safeDistance = -1;
        for (let distance = 0; distance <= getIndividualChunkDistanceLimit(); distance++) {
            let hasCompleteRing = true;
            for (let dx = -distance; dx <= distance && hasCompleteRing; dx++) {
                for (let dz = -distance; dz <= distance; dz++) {
                    if (!isChunkLoadedForMask(focus.chunkX + dx, focus.chunkZ + dz)) {
                        hasCompleteRing = false;
                        break;
                    }
                }
            }
            if (!hasCompleteRing) break;
            safeDistance = distance;
        }
        return safeDistance;
    }

    function updateSuperChunkMaskFocuses(focuses) {
        const maskedFocuses = focuses.slice(0, SUPER_CHUNK_MASK_FOCUSES).map((focus) => ({
            ...focus,
            maskDistance: getSafeSuperChunkMaskDistanceForFocus(focus)
        }));
        superChunkTerrainMaterial.userData.setMaskFocuses?.(maskedFocuses);
    }

    function maybeUpdateSuperChunkMaskFocuses(focuses, focusSignature) {
        if (!superChunkMaskDirty && superChunkMaskFocusSignature === focusSignature) return;

        updateSuperChunkMaskFocuses(focuses);
        superChunkMaskDirty = false;
        superChunkMaskFocusSignature = focusSignature;
        diagnostics.increment('superChunkMaskUpdates');
    }

    function updateChunksForPlayers(playerPositions, isPlayerMoving = false) {
        const now = performance.now();
        const previousFrameMs = now - lastChunkUpdateTime;
        lastChunkUpdateTime = now;
        chunkTransitionBufferChunks = isPlayerMoving ? SUPER_CHUNK_MOVING_TRANSITION_BUFFER_CHUNKS : 0;

        const focuses = createChunkFocuses(playerPositions);
        if (!focuses.length) return;
        updateMacroChunkMaskFocuses(focuses);

        const focusSignature = getFocusSignature(focuses);
        const didChangeChunk = focusSignature !== lastFocusSignature;

        if (didChangeChunk) {
            lastFocusSignature = focusSignature;
            lastChunkFocuses = focuses;
            lastPlayerChunkX = focuses[0].chunkX;
            lastPlayerChunkZ = focuses[0].chunkZ;
            refreshChunkQueue();
            markSuperChunkMaskDirty();
            if (isPlayerMoving) {
                enqueueUrgentMovingChunks(focuses);
                movingChunkGenerationCredits = MOVING_CHUNK_CHANGE_GENERATION_CREDITS;
            }
        }

        if (isPlayerMoving && !didChangeChunk) {
            if (!activeChunkJob && movingChunkGenerationCredits <= 0) {
                maybeUpdateSuperChunkMaskFocuses(focuses, focusSignature);
                return;
            }
            const movingBudget = previousFrameMs > SLOW_FRAME_GENERATION_PAUSE_MS
                ? CHUNK_MOVING_SLOW_FRAME_BUDGET_MS
                : CHUNK_MOVING_GENERATION_BUDGET_MS;
            if (movingBudget <= 0) {
                maybeUpdateSuperChunkMaskFocuses(focuses, focusSignature);
                return;
            }
            const finishedItems = processChunkQueue(movingBudget, 0, {
                allowStartingNewJob: movingChunkGenerationCredits > 0,
                maxFinishedItems: Math.max(1, movingChunkGenerationCredits)
            });
            movingChunkGenerationCredits = Math.max(0, movingChunkGenerationCredits - finishedItems);
            maybeUpdateSuperChunkMaskFocuses(focuses, focusSignature);
            return;
        }

        if (didInitialChunkBurst) {
            const useMovingBudget = isPlayerMoving && didChangeChunk;
            if (previousFrameMs > SLOW_FRAME_GENERATION_PAUSE_MS && !useMovingBudget) {
                maybeUpdateSuperChunkMaskFocuses(focuses, focusSignature);
                return;
            }
            const frameLimitedMovingBudget = previousFrameMs > SLOW_FRAME_GENERATION_PAUSE_MS
                ? CHUNK_MOVING_SLOW_FRAME_BUDGET_MS
                : CHUNK_MOVING_GENERATION_BUDGET_MS;
            const generationBudget = useMovingBudget
                ? frameLimitedMovingBudget
                : CHUNK_GENERATION_BUDGET_MS;
            const queueBuildBudget = useMovingBudget
                ? QUEUE_BUILD_MOVING_BUDGET_MS
                : QUEUE_BUILD_BUDGET_MS;
            const finishedItems = processChunkQueue(generationBudget, queueBuildBudget, {
                maxFinishedItems: useMovingBudget
                    ? Math.max(1, movingChunkGenerationCredits)
                    : Infinity
            });
            if (useMovingBudget) {
                movingChunkGenerationCredits = Math.max(0, movingChunkGenerationCredits - finishedItems);
            }
        } else {
            processInitialChunkBurst();
            didInitialChunkBurst = true;
        }

        maybeUpdateSuperChunkMaskFocuses(focuses, focusSignature);
    }

    function updateChunks(playerX, playerZ, isPlayerMoving = false) {
        updateChunksForPlayers([{ x: playerX, z: playerZ }], isPlayerMoving);
    }

    function getHeight(posX, posZ) {
        const chunkX = Math.floor(posX / CHUNK_SIZE);
        const chunkZ = Math.floor(posZ / CHUNK_SIZE);
        const chunk = chunks.get(getChunkKey(chunkX, chunkZ));
        const loadedHeight = chunk?.sampleGrid?.sampleHeightBilinear(posX, posZ);
        if (loadedHeight !== undefined) return loadedHeight;
        return getSharedCachedSample(sharedSampleCache, posX, posZ, createTerrainHeightSample, 'height').height;
    }

    function getWorldSample(posX, posZ) {
        const chunkX = Math.floor(posX / CHUNK_SIZE);
        const chunkZ = Math.floor(posZ / CHUNK_SIZE);
        const chunk = chunks.get(getChunkKey(chunkX, chunkZ));
        const loadedSample = chunk?.sampleGrid?.sampleTerrainBilinear?.(posX, posZ);
        if (loadedSample) return loadedSample;
        return getSharedCachedSample(sharedSampleCache, posX, posZ, createTerrainSample, 'full');
    }

    function getSample(posX, posZ) {
        return getWorldSample(posX, posZ);
    }

    function getChunkGroup(cx, cz) {
        return chunks.get(getChunkKey(cx, cz))?.group
            ?? retiredChunks.get(getChunkKey(cx, cz))?.group
            ?? null;
    }

    function getChunkVegetationMetadata(cx, cz) {
        return chunks.get(getChunkKey(cx, cz))?.grassMetadata
            ?? retiredChunks.get(getChunkKey(cx, cz))?.grassMetadata
            ?? null;
    }

    function getMacroWorldProgress() {
        if (!MACRO_CHUNKS_ENABLED || MACRO_CHUNK_TOTAL <= 0) return 1;
        const loaded = macroChunks.size + (activeMacroChunkJob ? 0.35 : 0);
        return Math.min(1, loaded / MACRO_CHUNK_TOTAL);
    }

    function isMacroWorldReady() {
        if (!MACRO_CHUNKS_ENABLED) return true;
        return macroChunks.size >= MACRO_CHUNK_TOTAL
            && macroChunkQueueReady
            && macroChunkQueue.length === 0
            && !activeMacroChunkJob;
    }

    function preloadMacroWorldStep(deadlineMs = performance.now() + MACRO_CHUNK_GENERATION_BUDGET_MS, playerPositions = []) {
        const focuses = playerPositions.length ? createChunkFocuses(playerPositions) : lastChunkFocuses;
        if (focuses.length) {
            updateMacroChunkMaskFocuses(focuses);
        }
        return processMacroWorld(deadlineMs, focuses);
    }

    function setChunkLifecycle(lifecycle) {
        chunkLifecycle = lifecycle;
    }

    updateChunks(0, 0);

    return {
        getHeight,
        getSample,
        getWorldSample,
        getChunkGroup,
        getChunkVegetationMetadata,
        getMacroWorldProgress,
        isMacroWorldReady,
        preloadMacroWorldStep,
        setChunkLifecycle,
        updateChunks,
        updateChunksForPlayers,
        dispose
    };
}
