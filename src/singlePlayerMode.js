import * as THREE from 'three';
import { CONFIG } from './config.js';
import { setupControls, keys } from './input.js';
import { state } from './state.js';
import { updatePhysics } from './physics.js';
import { createPlayerVitals } from './playerVitals.js';
import { createBowState, getBowHudState, setBowHeld, updateBowState } from './bow.js';
import { createBowView } from './bowView.js';
import { createDashState, getDashHudState, updateDashInput, updateDashState } from './dash.js';

const PLAYER_ID = 'player-1';
const PLAYER_LABEL = 'Player';
const PLAYER_CONFIG = CONFIG.mecanicas?.jogador ?? {};
const BOW_CONFIG = CONFIG.mecanicas?.arco ?? {};
const shotDirection = new THREE.Vector3();
const shotOrigin = new THREE.Vector3();

export function createSinglePlayerMode({
    scene,
    camera,
    renderer,
    getHeight,
    getSample,
    resolveTreeCollision,
    requestStart
}) {
    const { controls, player } = setupControls(camera, { requestStart });
    const vitals = createPlayerVitals({ id: PLAYER_ID, label: PLAYER_LABEL });
    const bow = createBowState();
    const dash = createDashState();
    const bowView = createBowView(scene, camera);
    let mouseShootHeld = false;

    scene.add(player);

    function onMouseDown(event) {
        if (event.button !== 0 || !controls.isLocked) return;
        mouseShootHeld = true;
        event.preventDefault();
    }

    function onMouseUp(event) {
        if (event.button !== 0) return;
        if (!controls.isLocked && !mouseShootHeld) return;
        mouseShootHeld = false;
        event.preventDefault();
    }

    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);

    function createShot(level) {
        camera.getWorldDirection(shotDirection).normalize();
        camera.getWorldPosition(shotOrigin);
        shotOrigin.addScaledVector(shotDirection, BOW_CONFIG.distanciaSpawn ?? 0.85);

        return {
            ownerId: PLAYER_ID,
            origin: shotOrigin.clone(),
            direction: shotDirection.clone(),
            level
        };
    }

    function getPlayerInfo(bowHudState = getBowHudState(bow), dashHudState = getDashHudState(dash)) {
        return {
            id: PLAYER_ID,
            label: PLAYER_LABEL,
            position: player.position,
            vitals,
            bow: bowHudState,
            dash: dashHudState,
            hitbox: {
                radius: PLAYER_CONFIG.raioColisao ?? 0.55,
                height: PLAYER_CONFIG.alturaColisao ?? 2.0
            }
        };
    }

    function update(delta) {
        const shots = [];
        const canAct = controls.isLocked && !vitals.isDead;
        const isMoving = canAct && (keys.w || keys.a || keys.s || keys.d);

        updateDashInput(dash, canAct && keys.shift && isMoving, canAct && isMoving);
        const movementSpeedMultiplier = updateDashState(dash, delta);

        let landing = null;
        if (canAct) {
            landing = updatePhysics(delta, controls, player, keys, state, getHeight, movementSpeedMultiplier, {
                resolveHorizontalCollision(position) {
                    resolveTreeCollision?.(position, PLAYER_CONFIG.raioColisao ?? 0.55);
                }
            })?.landing ?? null;
        }
        if (controls.isLocked) {
            vitals.update(delta, player.position, getSample, landing);
        }

        setBowHeld(bow, canAct && mouseShootHeld);
        const bowShot = updateBowState(bow, delta, canAct);
        if (bowShot) {
            shots.push(createShot(bowShot.level));
        }

        const bowHudState = getBowHudState(bow);
        const dashHudState = getDashHudState(dash);
        bowView.update(bowHudState, controls.isLocked && !vitals.isDead);

        const players = [getPlayerInfo(bowHudState, dashHudState)];

        return {
            isActive: controls.isLocked,
            isMoving,
            primary: player.position,
            focuses: [player.position],
            players,
            shots
        };
    }

    function render() {
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
        renderer.render(scene, camera);
    }

    function resize(width, height) {
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
    }

    function dispose() {
        window.removeEventListener('mousedown', onMouseDown);
        window.removeEventListener('mouseup', onMouseUp);
        bowView.dispose();
        scene.remove(player);
    }

    return {
        update,
        render,
        resize,
        dispose,
        get primaryCamera() {
            return camera;
        },
        get player() {
            return player;
        }
    };
}
