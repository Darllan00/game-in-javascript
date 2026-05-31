import * as THREE from 'three';
import { scene, camera, renderer } from './world.js';
import { state } from './state.js';
import { setupControls, keys } from './input.js';
import { createTerrain } from './terrain.js';
import { createLighting, updateLighting } from './lighting.js';
import { updatePhysics } from './physics.js';
import { CONFIG } from './config.js';

const { controls, player } = setupControls(camera);
scene.add(player);

const { getHeight, updateChunks } = createTerrain(scene);
const lights = createLighting(scene);

player.position.set(0, (state.mapaAlturas['0,0'] ?? 0) + 20, 0);

const clock = new THREE.Clock();

function loop() {

    requestAnimationFrame(loop);

    if (controls.isLocked) {
        const delta = clock.getDelta();

        state.tempoJogo += delta * 10; // teste rápido
        if (state.tempoJogo >= CONFIG.ciclo.duracao) {
            state.tempoJogo = 0;
        }

        
        updateLighting(scene, renderer, player, lights, state.tempoJogo);
        updatePhysics(delta, controls, player, keys, state, getHeight);
        updateChunks(player.position.x, player.position.z);

    } else {
        clock.getDelta();
    }

    renderer.render(scene, camera);
}

loop();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});