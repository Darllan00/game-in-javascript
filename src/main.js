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
import { CONFIG } from './config.js';
import { GAME_MODE, buildModeUrl, getGameMode } from './gameModes.js';
import { createSinglePlayerMode } from './singlePlayerMode.js';
import { createLocalCoopMode } from './localCoopMode.js';
import { hideLoadingScreen, showLoadingScreen, updateLoadingScreen } from './loadingScreen.js';

const worldSeed = resolveWorldSeed();
setTerrainSeed(worldSeed.numeric);

const diagnostics = createPerformanceDiagnostics(renderer);
const dayNightCycle = createDayNightCycle(scene, camera);
const terrainDataMap = createTerrainDataMap(diagnostics);
const terrain = createTerrain(scene, diagnostics, { terrainDataMap });
const {
    getHeight,
    getSample,
    getChunkGroup,
    getChunkVegetationMetadata,
    getMacroWorldProgress,
    isMacroWorldReady,
    preloadMacroWorldStep,
    setChunkLifecycle,
    updateChunksForPlayers,
    dispose
} = terrain;
const trees = createTrees(scene, getSample, diagnostics, { getChunkGroup, getChunkVegetationMetadata });
const water = createWater(scene, getSample, diagnostics, { getChunkGroup });
const grass = createGrass(scene, getHeight, getSample, diagnostics, {
    getChunkGroup,
    getChunkVegetationMetadata,
    isPositionBlocked: trees.isPositionBlocked,
    getBlockersForChunk: trees.getBlockersForChunk
});
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

function warmUpWorldBeforeStart(focusPosition) {
    if (didInitialWarmup) return null;
    if (startWarmupPromise) return startWarmupPromise;

    startWarmupPromise = (async () => {
        const loadingConfig = CONFIG.carregamentoInicial;
        const minDurationMs = loadingConfig.duracaoMinimaMs ?? 1200;
        const maxDurationMs = loadingConfig.duracaoMaximaMs ?? 10000;
        const minFrames = loadingConfig.framesMinimos ?? 45;
        const updatesPerFrame = Math.max(1, loadingConfig.atualizacoesPorFrame ?? 1);
        const macroBudgetMs = CONFIG.terreno.macroSuperChunks?.tempoGeracaoMs ?? 8;
        const dataMapBudgetMs = CONFIG.terreno.mapaDados?.tempoGeracaoMs ?? 6;
        const focus = focusPosition ?? mode.player?.position ?? { x: 0, z: 0 };
        const focuses = [focus];
        const startedAt = performance.now();
        let frame = 0;

        showLoadingScreen('Preparando terreno...');

        while (true) {
            const elapsedMs = performance.now() - startedAt;
            const shouldKeepLoading = frame < minFrames
                || elapsedMs < minDurationMs
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

const mode = gameMode === GAME_MODE.LOCAL_COOP
    ? createLocalCoopMode({ scene, camera, renderer, getHeight, requestStart: warmUpWorldBeforeStart })
    : createSinglePlayerMode({ scene, camera, renderer, getHeight, requestStart: warmUpWorldBeforeStart });

if (mode.player) {
    mode.player.position.set(0, getHeight(0, 0) + CONFIG.terreno.alturaOlhos + 2, 0);
}

function loop() {
    requestAnimationFrame(loop);
    diagnostics.frame();

    const delta = clock.getDelta();
    updateFpsCounter(delta);
    dayNightCycle.update(delta);

    const modeState = mode.update(delta);
    if (modeState.isActive) {
        updateChunksForPlayers(modeState.focuses, modeState.isMoving);
    }
    water.updateForPlayers(delta, modeState.focuses);
    trees.updateForPlayers(delta, modeState.focuses, modeState.isActive && modeState.isMoving);
    grass.updateForPlayers(delta, modeState.focuses, modeState.isActive && modeState.isMoving);

    mode.render(grass, trees);
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
    mode.dispose();
    dispose();
});
