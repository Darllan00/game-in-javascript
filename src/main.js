import * as THREE from 'three';
import { scene, camera, renderer } from './world.js';
import { state } from './state.js';
import { setupControls, keys } from './input.js';
import { createTerrain, setTerrainSeed } from './terrain.js';
import { updatePhysics } from './physics.js';
import { CONFIG } from './config.js';
import { buildSeedUrl, createRandomSeedText, resolveWorldSeed } from './seed.js';
import { createPerformanceDiagnostics } from './performanceDiagnostics.js';

const worldSeed = resolveWorldSeed();
setTerrainSeed(worldSeed.numeric);

const { controls, player } = setupControls(camera);
scene.add(player);

const diagnostics = createPerformanceDiagnostics(renderer);
const { getHeight, updateChunks, dispose } = createTerrain(scene, diagnostics);

player.position.set(0, getHeight(0, 0) + CONFIG.terreno.alturaOlhos + 2, 0);

const seedValue = document.getElementById('seed-value');
const copySeedButton = document.getElementById('copy-seed');
const newWorldButton = document.getElementById('new-world');
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
    window.location.href = buildSeedUrl(createRandomSeedText()).toString();
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

    if (controls.isLocked) {
        updatePhysics(delta, controls, player, keys, state, getHeight);
        updateChunks(player.position.x, player.position.z);
    }

    renderer.render(scene, camera);
}

loop();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

window.addEventListener('beforeunload', dispose);
