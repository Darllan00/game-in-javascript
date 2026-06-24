import * as THREE from 'three';
import { scene, camera, renderer } from './world.js';
import { createTerrain, setTerrainSeed } from './terrain.js';
import { buildSeedUrl, createRandomSeedText, resolveWorldSeed } from './seed.js';
import { createPerformanceDiagnostics } from './performanceDiagnostics.js';
import { createDayNightCycle } from './dayNightCycle.js';
import { createTerrainDataMap } from './terrainDataMap.js';
import { createWater } from './water.js';
import { createGrass } from './grass.js';
import { createTrees } from './trees.js';
import { createArrowSystem } from './arrowSystem.js';
import { createCombatHud } from './combatHud.js';
import { createMinimapHud } from './minimapHud.js';
import { createUnderwaterEffect } from './underwaterEffect.js';
import { CONFIG } from './config.js';
import { createConfigPanel } from './configPanel.js';
import {
    GAME_MODE,
    buildModeUrl,
    getGameMode,
    getOnlineParams,
    buildOnlineHostUrl,
    buildOnlineJoinUrl
} from './gameModes.js';
import { createSinglePlayerMode } from './singlePlayerMode.js';
import { createLocalCoopMode } from './localCoopMode.js';
import { createOnlineMode } from './onlineMode.js';
import { generateRoomCode, fetchRoomSeed } from './net.js';
import { hideLoadingScreen, showLoadingScreen, updateLoadingScreen } from './loadingScreen.js';

const worldSeed = resolveWorldSeed();
setTerrainSeed(worldSeed.numeric);

const diagnostics = createPerformanceDiagnostics(renderer);
const dayNightCycle = createDayNightCycle(scene, camera, renderer);
const terrainDataMap = createTerrainDataMap(diagnostics);
const terrain = createTerrain(scene, diagnostics, {
    terrainDataMap,
    requestShadowUpdate: dayNightCycle.requestShadowUpdate
});
const {
    getHeight,
    getSample,
    getChunkGroup,
    getChunkVegetationMetadata,
    getMacroWorldProgress,
    isMacroWorldReady,
    preloadMacroWorldStep,
    preloadChunksForPlayers,
    setChunkLifecycle,
    updateChunksForPlayers,
    dispose
} = terrain;
const trees = createTrees(scene, getSample, diagnostics, {
    getChunkGroup,
    getChunkVegetationMetadata,
    requestShadowUpdate: dayNightCycle.requestShadowUpdate
});
const water = createWater(scene, getSample, diagnostics, {
    getChunkGroup,
    getLightingState: dayNightCycle.getLightingState
});
const grass = createGrass(scene, getHeight, getSample, diagnostics, {
    getChunkGroup,
    getChunkVegetationMetadata,
    isPositionBlocked: trees.isPositionBlocked,
    getBlockersForChunk: trees.getBlockersForChunk,
    getLightingState: dayNightCycle.getLightingState
});
const arrows = createArrowSystem(scene, getHeight, diagnostics, {
    findTrunkImpact: trees.findTrunkImpact
});
const combatHud = createCombatHud();
const minimapHud = createMinimapHud(getSample);
const underwaterEffect = createUnderwaterEffect(getSample);
const configPanel = createConfigPanel({ renderer });
setChunkLifecycle({
    onChunkDisposed(chunk) {
        water.disposeChunk(chunk);
        grass.disposeChunk(chunk);
        trees.disposeChunk(chunk);
    }
});
const gameMode = getGameMode();
const seedValue = document.getElementById('seed-value');
const copySeedButton = document.getElementById('copy-seed');
const newWorldButton = document.getElementById('new-world');
const singleModeButton = document.getElementById('single-mode');
const coopModeButton = document.getElementById('coop-mode');
const fpsCounter = document.getElementById('fps-counter');

if (seedValue) {
    seedValue.textContent = worldSeed.text;
}

copySeedButton?.addEventListener('click', async (event) => {
    event.stopPropagation();

    try {
        await navigator.clipboard.writeText(worldSeed.text);
        copySeedButton.textContent = 'Seed copiada';
        window.setTimeout(() => {
            copySeedButton.textContent = 'Copiar seed';
        }, 1200);
    } catch {
        copySeedButton.textContent = worldSeed.text;
    }
});

newWorldButton?.addEventListener('click', (event) => {
    event.stopPropagation();
    const url = buildSeedUrl(createRandomSeedText());
    if (gameMode === GAME_MODE.LOCAL_COOP) {
        url.searchParams.set('mode', GAME_MODE.LOCAL_COOP);
    }
    window.location.href = url.toString();
});

singleModeButton?.addEventListener('click', (event) => {
    event.stopPropagation();
    window.location.href = buildModeUrl(GAME_MODE.SINGLE).toString();
});

coopModeButton?.addEventListener('click', (event) => {
    event.stopPropagation();
    window.location.href = buildModeUrl(GAME_MODE.LOCAL_COOP).toString();
});

const onlineNameInput = document.getElementById('online-name');
const onlineHostButton = document.getElementById('online-host');
const onlineJoinToggle = document.getElementById('online-join-toggle');
const onlineJoinPanel = document.getElementById('online-join-panel');
const onlineJoinCode = document.getElementById('online-join-code');
const onlineJoinConfirm = document.getElementById('online-join-confirm');
const onlineJoinStatus = document.getElementById('online-join-status');

const STORED_NAME_KEY = 'mundo3d-online-name';

if (onlineNameInput) {
    try {
        const saved = localStorage.getItem(STORED_NAME_KEY);
        if (saved) onlineNameInput.value = saved;
    } catch {
        /* noop */
    }
}

function persistOnlineName() {
    const name = (onlineNameInput?.value || '').trim();
    if (name) {
        try {
            localStorage.setItem(STORED_NAME_KEY, name);
        } catch {
            /* noop */
        }
    }
    return name;
}

onlineHostButton?.addEventListener('click', (event) => {
    event.stopPropagation();
    persistOnlineName();
    const code = generateRoomCode();
    window.location.href = buildOnlineHostUrl(code, worldSeed.text).toString();
});

onlineJoinToggle?.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!onlineJoinPanel) return;
    onlineJoinPanel.style.display = onlineJoinPanel.style.display === 'flex' ? 'none' : 'flex';
});

onlineJoinConfirm?.addEventListener('click', async (event) => {
    event.stopPropagation();
    const code = (onlineJoinCode?.value || '').trim().toUpperCase();
    if (!code) {
        if (onlineJoinStatus) onlineJoinStatus.textContent = 'Digite o codigo da sala.';
        return;
    }
    persistOnlineName();
    if (onlineJoinStatus) onlineJoinStatus.textContent = 'Procurando sala...';
    onlineJoinConfirm.disabled = true;
    try {
        const seed = await fetchRoomSeed(code);
        window.location.href = buildOnlineJoinUrl(code, seed).toString();
    } catch {
        if (onlineJoinStatus) onlineJoinStatus.textContent = 'Sala nao encontrada ou indisponivel.';
        onlineJoinConfirm.disabled = false;
    }
});

const clock = new THREE.Clock();
let fpsFrames = 0;
let fpsElapsed = 0;
let startWarmupPromise = null;
let didInitialWarmup = false;
const macroWorldEnabled = CONFIG.terreno.macroSuperChunks?.ativo !== false
    && CONFIG.terreno.macroSuperChunks?.renderizar !== false;
const terrainDataMapEnabled = terrainDataMap.enabled;

function updateFpsCounter(delta) {
    if (!fpsCounter) return;

    fpsFrames++;
    fpsElapsed += delta;

    if (fpsElapsed >= 0.5) {
        fpsCounter.textContent = `${Math.round(fpsFrames / fpsElapsed)} FPS`;
        fpsFrames = 0;
        fpsElapsed = 0;
    }
}

function getLoadingStatus(progress) {
    if (terrainDataMapEnabled && !terrainDataMap.isReady()) return 'Mapeando mundo...';
    if (macroWorldEnabled && !isMacroWorldReady()) return 'Preparando terreno distante...';
    if (progress < 0.55) return 'Preparando terreno proximo...';
    if (progress < 0.86) return 'Distribuindo vegetacao...';
    if (progress < 0.98) return 'Finalizando mundo...';
    return 'Pronto';
}

function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(resolve));
}

function getWarmupFocus(focusPosition) {
    if (focusPosition) return focusPosition;
    if (mode.player?.position) return mode.player.position;
    if (mode.players?.[0]?.group?.position) return mode.players[0].group.position;
    if (mode.players?.[0]?.position) return mode.players[0].position;
    return { x: 0, z: 0 };
}

function warmUpWorldBeforeStart(focusPosition) {
    if (didInitialWarmup) return null;
    if (startWarmupPromise) return startWarmupPromise;

    startWarmupPromise = (async () => {
        const loadingConfig = CONFIG.carregamentoInicial;
        const minDurationMs = loadingConfig.duracaoMinimaMs ?? 1200;
        const maxDurationMs = loadingConfig.duracaoMaximaMs ?? 10000;
        const minFrames = loadingConfig.framesMinimos ?? 45;
        const updatesPerFrame = Math.max(1, loadingConfig.atualizacoesPorFrame ?? 1);
        const terrainPreloadBudgetMs = Math.max(0, loadingConfig.tempoTerrenoProximoMs ?? 0);
        const vegetationBudgetMs = Math.max(0, loadingConfig.tempoVegetacaoMs ?? 0);
        const grassPreloadDistance = loadingConfig.distanciaGramaChunks ?? null;
        const treePreloadDistance = loadingConfig.distanciaArvoresChunks ?? null;
        const terrainPreloadDistance = Math.max(grassPreloadDistance ?? 0, treePreloadDistance ?? 0);
        const macroBudgetMs = CONFIG.terreno.macroSuperChunks?.tempoGeracaoMs ?? 8;
        const dataMapBudgetMs = CONFIG.terreno.mapaDados?.tempoGeracaoMs ?? 6;
        const focus = getWarmupFocus(focusPosition);
        const focuses = [focus];
        const startedAt = performance.now();
        let frame = 0;
        let initialTerrainReady = false;
        let initialGrassReady = false;
        let initialTreesReady = false;

        showLoadingScreen('Preparando terreno...');

        while (true) {
            const elapsedMs = performance.now() - startedAt;
            const canKeepLoadingInitialArea = elapsedMs < maxDurationMs;
            const shouldKeepLoading = frame < minFrames
                || elapsedMs < minDurationMs
                || ((!initialTerrainReady || !initialGrassReady || !initialTreesReady) && canKeepLoadingInitialArea)
                || (macroWorldEnabled && !isMacroWorldReady())
                || (terrainDataMapEnabled && !terrainDataMap.isReady() && elapsedMs < maxDurationMs);
            if (!shouldKeepLoading) break;

            const warmupProgress = Math.max(frame / minFrames, elapsedMs / minDurationMs);
            const macroProgress = getMacroWorldProgress();
            const dataMapProgress = terrainDataMap.getProgress();
            let progress = Math.min(1, warmupProgress);
            if (terrainDataMapEnabled) {
                progress = dataMapProgress * 0.68 + progress * 0.32;
            }
            if (macroWorldEnabled) {
                progress = macroProgress * 0.45 + progress * 0.55;
            }
            progress = Math.min(0.98, progress);
            updateLoadingScreen(progress, getLoadingStatus(progress));

            if (terrainDataMapEnabled) {
                terrainDataMap.preloadStep(performance.now() + dataMapBudgetMs, focuses);
            }
            if (macroWorldEnabled) {
                preloadMacroWorldStep(performance.now() + macroBudgetMs, focuses);
            }

            for (let i = 0; i < updatesPerFrame; i++) {
                updateChunksForPlayers(focuses, false);
                water.updateForPlayers(1 / 60, focuses);
                trees.updateForPlayers(1 / 60, focuses, false);
                grass.updateForPlayers(1 / 60, focuses, false);
            }
            if (terrainPreloadBudgetMs > 0 && terrainPreloadDistance > 0) {
                initialTerrainReady = preloadChunksForPlayers?.(
                    performance.now() + terrainPreloadBudgetMs,
                    focuses,
                    terrainPreloadDistance
                ) ?? initialTerrainReady;
            }
            if (vegetationBudgetMs > 0 && initialTerrainReady) {
                const treeDeadline = performance.now() + vegetationBudgetMs;
                initialTreesReady = trees.preloadForPlayers?.(treeDeadline, focuses, treePreloadDistance) ?? true;
                const grassDeadline = performance.now() + vegetationBudgetMs;
                initialGrassReady = grass.preloadForPlayers?.(grassDeadline, focuses, grassPreloadDistance) ?? true;
            }

            mode.render(grass, trees);
            frame++;
            await nextFrame();
        }

        updateLoadingScreen(1, 'Pronto');
        hideLoadingScreen();
        didInitialWarmup = true;
        startWarmupPromise = null;
    })();

    return startWarmupPromise;
}

function createActiveMode() {
    const sharedOptions = {
        scene,
        camera,
        renderer,
        getHeight,
        getSample,
        resolveTreeCollision: trees.resolveTrunkCollision,
        requestStart: warmUpWorldBeforeStart
    };

    if (gameMode === GAME_MODE.ONLINE) {
        const { room, isHost } = getOnlineParams();
        let storedName = '';
        try {
            storedName = (localStorage.getItem('mundo3d-online-name') || '').trim();
        } catch {
            storedName = '';
        }
        const playerName = storedName || (isHost ? 'Host' : 'Jogador');
        return createOnlineMode({
            ...sharedOptions,
            room,
            isHost,
            seedText: worldSeed.text,
            playerName
        });
    }

    if (gameMode === GAME_MODE.LOCAL_COOP) {
        return createLocalCoopMode(sharedOptions);
    }

    return createSinglePlayerMode(sharedOptions);
}

const mode = createActiveMode();

if (mode.player) {
    mode.player.position.set(0, getHeight(0, 0) + CONFIG.terreno.alturaOlhos + 2, 0);
}

function loop() {
    requestAnimationFrame(loop);
    diagnostics.frame();

    const delta = clock.getDelta();
    updateFpsCounter(delta);

    const modeState = mode.update(delta);
    dayNightCycle.update(delta, modeState.focuses, {
        updateShadowFocus: modeState.handlesShadowFocus !== true
    });
    for (const shot of modeState.shots ?? []) {
        arrows.shoot(shot);
    }
    arrows.update(delta, modeState.arrowTargets ?? modeState.players ?? [], modeState.onHit);
    combatHud.update(modeState.players ?? []);
    minimapHud.update(modeState, delta);
    underwaterEffect.update(modeState, delta);

    if (modeState.isActive) {
        updateChunksForPlayers(modeState.focuses, modeState.isMoving);
    }
    water.updateForPlayers(delta, modeState.focuses);
    trees.updateForPlayers(delta, modeState.focuses, modeState.isActive && modeState.isMoving);
    grass.updateForPlayers(delta, modeState.focuses, modeState.isActive && modeState.isMoving);

    mode.render(grass, trees, dayNightCycle, water);
}

loop();

window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    mode.resize(window.innerWidth, window.innerHeight);
});

window.addEventListener('beforeunload', () => {
    dayNightCycle.dispose();
    water.dispose();
    grass.dispose();
    trees.dispose();
    arrows.dispose();
    combatHud.dispose();
    minimapHud.dispose();
    underwaterEffect.dispose();
    configPanel.dispose();
    mode.dispose();
    dispose();
});
