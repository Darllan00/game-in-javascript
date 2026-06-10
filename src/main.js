import * as THREE from 'three';
import { scene, camera, renderer } from './world.js';
import { createTerrain, setTerrainSeed } from './terrain.js';
import { buildSeedUrl, createRandomSeedText, resolveWorldSeed } from './seed.js';
import { createPerformanceDiagnostics } from './performanceDiagnostics.js';
import { createDayNightCycle } from './dayNightCycle.js';
import { createGrass } from './grass.js';
import { CONFIG } from './config.js';
import { GAME_MODE, buildModeUrl, getGameMode } from './gameModes.js';
import { createSinglePlayerMode } from './singlePlayerMode.js';
import { createLocalCoopMode } from './localCoopMode.js';

const worldSeed = resolveWorldSeed();
setTerrainSeed(worldSeed.numeric);

const diagnostics = createPerformanceDiagnostics(renderer);
const dayNightCycle = createDayNightCycle(scene, camera);
const terrain = createTerrain(scene, diagnostics);
const { getHeight, getSample, getChunkGroup, setChunkLifecycle, updateChunksForPlayers, dispose } = terrain;
const grass = createGrass(scene, getHeight, getSample, diagnostics, { getChunkGroup });
setChunkLifecycle({
    onChunkDisposed: grass.disposeChunk
});
const gameMode = getGameMode();
const mode = gameMode === GAME_MODE.LOCAL_COOP
    ? createLocalCoopMode({ scene, camera, renderer, getHeight })
    : createSinglePlayerMode({ scene, camera, renderer, getHeight });

if (mode.player) {
    mode.player.position.set(0, getHeight(0, 0) + CONFIG.terreno.alturaOlhos + 2, 0);
}

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
    grass.updateForPlayers(delta, modeState.focuses, modeState.isActive && modeState.isMoving);

    mode.render(grass);
}

loop();

window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    mode.resize(window.innerWidth, window.innerHeight);
});

window.addEventListener('beforeunload', () => {
    dayNightCycle.dispose();
    grass.dispose();
    mode.dispose();
    dispose();
});
