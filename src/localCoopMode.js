import * as THREE from 'three';
import { CONFIG } from './config.js';
import { updatePlayerPhysics } from './physics.js';
import { createPlayerVitals } from './playerVitals.js';
import { createBowState, getBowHudState, setBowHeld, updateBowState } from './bow.js';
import { createBowView, createCarriedBow } from './bowView.js';
import { createDashState, getDashHudState, updateDashInput, updateDashState } from './dash.js';

const GAMEPAD_DEADZONE = 0.18;
const MOUSE_SENSITIVITY = 0.0022;
const GAMEPAD_LOOK_SPEED = 2.7;
const MAX_PITCH = Math.PI / 2 - 0.08;
const MIN_PITCH = -MAX_PITCH;
const PLAYER_ONE_BODY_LAYER = 1;
const PLAYER_TWO_BODY_LAYER = 2;
const PLAYER_ONE_BOW_LAYER = 3;
const PLAYER_TWO_BOW_LAYER = 4;
const PLAYER_HITBOX_RADIUS = 0.55;
const PLAYER_HITBOX_HEIGHT = 2.0;
const BOW_CONFIG = CONFIG.mecanicas?.arco ?? {};

const forwardVector = new THREE.Vector3();
const rightVector = new THREE.Vector3();
const movementVector = new THREE.Vector3();
const cameraEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const hitboxDelta = new THREE.Vector2();
const shotDirection = new THREE.Vector3();
const shotOrigin = new THREE.Vector3();

function createKeyState() {
    return {
        KeyW: false,
        KeyA: false,
        KeyS: false,
        KeyD: false,
        Space: false,
        KeyF: false,
        ShiftLeft: false,
        ShiftRight: false,
        Enter: false
    };
}

function clampPitch(value) {
    return THREE.MathUtils.clamp(value, MIN_PITCH, MAX_PITCH);
}

function readAxis(value) {
    return Math.abs(value) >= GAMEPAD_DEADZONE ? value : 0;
}

function isGamepadJumping(gamepad) {
    return Boolean(gamepad?.buttons?.some((button, index) => index <= 1 && button.pressed));
}

function isGamepadShooting(gamepad) {
    const buttons = gamepad?.buttons;
    if (!buttons) return false;

    return Boolean(
        buttons[7]?.pressed
        || (buttons[7]?.value ?? 0) > 0.22
        || buttons[5]?.pressed
    );
}

function isGamepadDashing(gamepad) {
    const buttons = gamepad?.buttons;
    if (!buttons) return false;

    return Boolean(
        buttons[4]?.pressed
        || buttons[6]?.pressed
        || (buttons[6]?.value ?? 0) > 0.22
    );
}

function getConnectedGamepads() {
    return navigator.getGamepads
        ? Array.from(navigator.getGamepads()).filter(Boolean)
        : [];
}

function getAssignedGamepads() {
    const gamepads = getConnectedGamepads();
    return {
        playerOne: gamepads.length >= 2 ? gamepads[0] : null,
        playerTwo: gamepads.length >= 2 ? gamepads[1] : gamepads[0] ?? null
    };
}

function createPlayerBlock(color, label) {
    const group = new THREE.Object3D();
    group.name = label;

    const geometry = new THREE.BoxGeometry(1.1, 2, 1.1);
    const material = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.85,
        metalness: 0
    });
    const body = new THREE.Mesh(geometry, material);
    body.position.y = -CONFIG.terreno.alturaOlhos / 2;
    body.castShadow = false;
    body.receiveShadow = false;
    group.add(body);

    return { group, body, geometry, material };
}

function createCoopPlayer({ id, color, label, camera, startX, startZ, yaw, getHeight }) {
    const block = createPlayerBlock(color, label);
    block.group.position.set(
        startX,
        getHeight(startX, startZ) + CONFIG.terreno.alturaOlhos + 2,
        startZ
    );

    return {
        id,
        label,
        ...block,
        camera,
        yaw,
        pitch: 0,
        vitals: createPlayerVitals({ id, label }),
        bow: createBowState(),
        dash: createDashState(),
        state: {
            velocidadeY: 0,
            noChao: false,
            fallPeakY: null
        },
        hitbox: {
            radius: PLAYER_HITBOX_RADIUS,
            height: PLAYER_HITBOX_HEIGHT
        },
        input: {
            x: 0,
            z: 0,
            lookX: 0,
            lookY: 0,
            jump: false,
            dash: false
        }
    };
}

function updateCoopPlayerPhysics(delta, player, getHeight, resolveTreeCollision) {
    return updatePlayerPhysics({
        delta,
        position: player.group.position,
        state: player.state,
        getHeight,
        jump: player.input.jump,
        movementSpeedMultiplier: player.movementSpeedMultiplier ?? 1,
        resolveHorizontalCollision(position) {
            resolveTreeCollision?.(position, player.hitbox.radius);
        },
        applyHorizontalMovement(distance) {
            forwardVector.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
            rightVector.set(Math.cos(player.yaw), 0, -Math.sin(player.yaw));

            movementVector.set(0, 0, 0)
                .addScaledVector(rightVector, player.input.x)
                .addScaledVector(forwardVector, -player.input.z);

            if (movementVector.lengthSq() > 1) movementVector.normalize();

            player.group.position.x += movementVector.x * distance;
            player.group.position.z += movementVector.z * distance;
        }
    });
}

function resolvePlayerHitboxes(players, getHeight) {
    for (let i = 0; i < players.length; i++) {
        for (let j = i + 1; j < players.length; j++) {
            const a = players[i];
            const b = players[j];
            if (a.vitals.isDead || b.vitals.isDead) continue;
            const aPosition = a.group.position;
            const bPosition = b.group.position;
            const verticalDistance = Math.abs(aPosition.y - bPosition.y);
            const maxVerticalDistance = (a.hitbox.height + b.hitbox.height) / 2;
            if (verticalDistance > maxVerticalDistance) continue;

            hitboxDelta.set(bPosition.x - aPosition.x, bPosition.z - aPosition.z);
            const distanceSq = hitboxDelta.lengthSq();
            const minDistance = a.hitbox.radius + b.hitbox.radius;
            if (distanceSq >= minDistance * minDistance) continue;

            if (distanceSq === 0) {
                hitboxDelta.set(1, 0);
            } else {
                hitboxDelta.multiplyScalar(1 / Math.sqrt(distanceSq));
            }

            const overlap = minDistance - Math.sqrt(Math.max(distanceSq, 0.0001));
            const push = overlap / 2;
            aPosition.x -= hitboxDelta.x * push;
            aPosition.z -= hitboxDelta.y * push;
            bPosition.x += hitboxDelta.x * push;
            bPosition.z += hitboxDelta.y * push;

            aPosition.y = Math.max(aPosition.y, getHeight(aPosition.x, aPosition.z) + CONFIG.terreno.alturaOlhos);
            bPosition.y = Math.max(bPosition.y, getHeight(bPosition.x, bPosition.z) + CONFIG.terreno.alturaOlhos);
        }
    }
}

function updateCoopCamera(player, delta) {
    player.yaw -= player.input.lookX * GAMEPAD_LOOK_SPEED * delta;
    player.pitch = clampPitch(player.pitch - player.input.lookY * GAMEPAD_LOOK_SPEED * delta);

    player.group.rotation.y = player.yaw;
    player.camera.position.copy(player.group.position);
    cameraEuler.set(player.pitch, player.yaw, 0);
    player.camera.quaternion.setFromEuler(cameraEuler);
}

function updateKeyboardMouseInput(player, keyboard) {
    player.input.x = (keyboard.KeyD ? 1 : 0) - (keyboard.KeyA ? 1 : 0);
    player.input.z = (keyboard.KeyS ? 1 : 0) - (keyboard.KeyW ? 1 : 0);
    player.input.jump = keyboard.Space;
    player.input.dash = keyboard.ShiftLeft || keyboard.ShiftRight;
}

function updateGamepadInput(player, gamepad) {
    if (!gamepad) {
        player.input.x = 0;
        player.input.z = 0;
        player.input.lookX = 0;
        player.input.lookY = 0;
        player.input.jump = false;
        player.input.dash = false;
        return;
    }

    player.input.x = readAxis(gamepad.axes?.[0] ?? 0);
    player.input.z = readAxis(gamepad.axes?.[1] ?? 0);
    player.input.lookX = readAxis(gamepad.axes?.[2] ?? 0);
    player.input.lookY = readAxis(gamepad.axes?.[3] ?? 0);
    player.input.jump = isGamepadJumping(gamepad);
    player.input.dash = isGamepadDashing(gamepad);
}

export function createLocalCoopMode({
    scene,
    camera,
    renderer,
    getHeight,
    getSample,
    resolveTreeCollision,
    requestStart
}) {
    const keyboard = createKeyState();
    const playerOne = createCoopPlayer({
        id: 'player-1',
        color: 0x2f7dff,
        label: 'Player 1',
        camera,
        startX: -2,
        startZ: 0,
        yaw: 0,
        getHeight
    });
    const playerTwo = createCoopPlayer({
        id: 'player-2',
        color: 0xff8a2f,
        label: 'Player 2',
        camera: new THREE.PerspectiveCamera(75, 1, 0.1, 1500),
        startX: 2,
        startZ: 0,
        yaw: 0,
        getHeight
    });
    const players = [playerOne, playerTwo];
    let isStarted = false;
    let isStarting = false;
    let mouseShootHeld = false;

    playerOne.bowView = createBowView(scene, playerOne.camera, { layer: PLAYER_ONE_BOW_LAYER });
    playerTwo.bowView = createBowView(scene, playerTwo.camera, { layer: PLAYER_TWO_BOW_LAYER });
    playerOne.carriedBow = createCarriedBow({ layer: PLAYER_ONE_BODY_LAYER });
    playerTwo.carriedBow = createCarriedBow({ layer: PLAYER_TWO_BODY_LAYER });
    playerOne.group.add(playerOne.carriedBow.object);
    playerTwo.group.add(playerTwo.carriedBow.object);

    playerOne.body.layers.set(PLAYER_ONE_BODY_LAYER);
    playerTwo.body.layers.set(PLAYER_TWO_BODY_LAYER);
    playerOne.camera.layers.enable(PLAYER_TWO_BODY_LAYER);
    playerOne.camera.layers.enable(PLAYER_ONE_BOW_LAYER);
    playerTwo.camera.layers.enable(PLAYER_ONE_BODY_LAYER);
    playerTwo.camera.layers.enable(PLAYER_TWO_BOW_LAYER);

    for (const player of players) {
        scene.add(player.group);
        updateCoopCamera(player, 0);
    }

    const menu = document.getElementById('menu');
    const crosshair = document.getElementById('crosshair');
    if (crosshair) crosshair.style.display = 'none';
    const splitCrosshairs = [
        document.createElement('div'),
        document.createElement('div')
    ];
    splitCrosshairs.forEach((item, index) => {
        item.className = `split-crosshair split-crosshair-${index + 1}`;
        item.textContent = '+';
        document.body.appendChild(item);
    });

    async function start() {
        if (isStarted || isStarting) return;
        isStarting = true;
        try {
            document.body.requestPointerLock?.();
            const startResult = requestStart?.(playerOne.group.position);
            if (startResult) await startResult;
            if (document.pointerLockElement !== document.body) {
                if (menu) menu.style.display = 'flex';
                return;
            }
            isStarted = true;
            if (menu) menu.style.display = 'none';
        } finally {
            isStarting = false;
        }
    }

    function onMenuClick(event) {
        if (event.target instanceof Element && event.target.closest('[data-menu-control], button, input, textarea, select')) return;
        start();
    }

    function onPointerLockChange() {
        if (!isStarted) return;
        if (document.pointerLockElement === document.body) return;
        isStarted = false;
        mouseShootHeld = false;
        if (menu) menu.style.display = 'flex';
    }

    function onKeyDown(event) {
        if (event.code in keyboard) {
            keyboard[event.code] = true;
            event.preventDefault();
        }
        if (!isStarted && event.code === 'Enter') start();
    }

    function onKeyUp(event) {
        if (event.code in keyboard) {
            keyboard[event.code] = false;
            event.preventDefault();
        }
    }

    function onMouseMove(event) {
        if (!isStarted || document.pointerLockElement !== document.body) return;
        playerOne.yaw -= event.movementX * MOUSE_SENSITIVITY;
        playerOne.pitch = clampPitch(playerOne.pitch - event.movementY * MOUSE_SENSITIVITY);
    }

    function onMouseDown(event) {
        if (event.button !== 0 || !isStarted || document.pointerLockElement !== document.body) return;
        mouseShootHeld = true;
        event.preventDefault();
    }

    function onMouseUp(event) {
        if (event.button !== 0) return;
        if (!isStarted && !mouseShootHeld) return;
        mouseShootHeld = false;
        event.preventDefault();
    }

    menu?.addEventListener('click', onMenuClick);
    document.addEventListener('pointerlockchange', onPointerLockChange);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);

    function createShot(player, level) {
        player.camera.getWorldDirection(shotDirection).normalize();
        player.camera.getWorldPosition(shotOrigin);
        shotOrigin.addScaledVector(shotDirection, BOW_CONFIG.distanciaSpawn ?? 0.85);

        return {
            ownerId: player.id,
            origin: shotOrigin.clone(),
            direction: shotDirection.clone(),
            level
        };
    }

    function getPlayerInfo(
        player,
        bowHudState = getBowHudState(player.bow),
        dashHudState = getDashHudState(player.dash)
    ) {
        return {
            id: player.id,
            label: player.label,
            position: player.group.position,
            vitals: player.vitals,
            bow: bowHudState,
            dash: dashHudState,
            hitbox: player.hitbox
        };
    }

    function update(delta) {
        const shots = [];
        const gamepads = getAssignedGamepads();

        updateKeyboardMouseInput(playerOne, keyboard);
        playerOne.input.lookX = 0;
        playerOne.input.lookY = 0;

        if (gamepads.playerOne) {
            const keyboardMoveX = playerOne.input.x;
            const keyboardMoveZ = playerOne.input.z;
            const keyboardJump = playerOne.input.jump;
            const keyboardDash = playerOne.input.dash;
            updateGamepadInput(playerOne, gamepads.playerOne);
            playerOne.input.x = playerOne.input.x || keyboardMoveX;
            playerOne.input.z = playerOne.input.z || keyboardMoveZ;
            playerOne.input.jump = playerOne.input.jump || keyboardJump;
            playerOne.input.dash = playerOne.input.dash || keyboardDash;
        }

        updateGamepadInput(playerTwo, gamepads.playerTwo);

        setBowHeld(playerOne.bow, isStarted && !playerOne.vitals.isDead && (
            mouseShootHeld
            || keyboard.KeyF
            || isGamepadShooting(gamepads.playerOne)
        ));
        setBowHeld(playerTwo.bow, isStarted && !playerTwo.vitals.isDead && isGamepadShooting(gamepads.playerTwo));

        if (isStarted) {
            for (const player of players) {
                let landing = null;
                const isMovingPlayer = player.input.x !== 0 || player.input.z !== 0;
                const canAct = !player.vitals.isDead;
                updateDashInput(player.dash, canAct && player.input.dash && isMovingPlayer, canAct && isMovingPlayer);
                player.movementSpeedMultiplier = updateDashState(player.dash, delta);
                if (!player.vitals.isDead) {
                    landing = updateCoopPlayerPhysics(delta, player, getHeight, resolveTreeCollision)?.landing ?? null;
                }
                player.vitals.update(delta, player.group.position, getSample, landing);
            }
            resolvePlayerHitboxes(players, getHeight);
            for (const player of players) {
                updateCoopCamera(player, delta);
            }
        }

        for (const player of players) {
            const bowShot = updateBowState(player.bow, delta, isStarted && !player.vitals.isDead);
            if (bowShot) {
                shots.push(createShot(player, bowShot.level));
            }
        }

        const playerInfos = players.map((player) => {
            const bowHudState = getBowHudState(player.bow);
            const dashHudState = getDashHudState(player.dash);
            player.body.visible = !player.vitals.isDead;
            player.bowView?.update(bowHudState, isStarted && !player.vitals.isDead);
            player.carriedBow?.update(bowHudState, isStarted && !player.vitals.isDead);
            return getPlayerInfo(player, bowHudState, dashHudState);
        });

        const isMoving = players.some((player) => !player.vitals.isDead && (player.input.x !== 0 || player.input.z !== 0));
        return {
            isActive: isStarted,
            isMoving,
            primary: playerOne.group.position,
            focuses: players.map((player) => player.group.position),
            players: playerInfos,
            shots
        };
    }

    function setVegetationVisibilityForFocus(position, grass, trees) {
        grass?.setVisibilityForFocus?.(position);
        trees?.setVisibilityForFocus?.(position);
    }

    function restoreVegetationVisibility(grass, trees) {
        grass?.restoreVisibility?.();
        trees?.restoreVisibility?.();
    }

    function render(grass, trees) {
        const width = window.innerWidth;
        const height = window.innerHeight;
        const leftWidth = Math.floor(width / 2);
        const rightWidth = width - leftWidth;

        renderer.setScissorTest(true);

        setVegetationVisibilityForFocus(playerOne.group.position, grass, trees);
        renderer.setViewport(0, 0, leftWidth, height);
        renderer.setScissor(0, 0, leftWidth, height);
        renderer.render(scene, playerOne.camera);

        setVegetationVisibilityForFocus(playerTwo.group.position, grass, trees);
        renderer.setViewport(leftWidth, 0, rightWidth, height);
        renderer.setScissor(leftWidth, 0, rightWidth, height);
        renderer.render(scene, playerTwo.camera);

        restoreVegetationVisibility(grass, trees);
        renderer.setScissorTest(false);
    }

    function resize(width, height) {
        const halfAspect = Math.max(1, width / 2) / height;
        for (const player of players) {
            player.camera.aspect = halfAspect;
            player.camera.updateProjectionMatrix();
        }
    }

    function dispose() {
        menu?.removeEventListener('click', onMenuClick);
        document.removeEventListener('pointerlockchange', onPointerLockChange);
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mousedown', onMouseDown);
        window.removeEventListener('mouseup', onMouseUp);

        for (const item of splitCrosshairs) {
            item.remove();
        }
        for (const player of players) {
            player.bowView?.dispose();
            player.carriedBow?.dispose();
            scene.remove(player.group);
            player.geometry.dispose();
            player.material.dispose();
        }
    }

    resize(window.innerWidth, window.innerHeight);

    return {
        update,
        render,
        resize,
        dispose,
        get primaryCamera() {
            return playerOne.camera;
        },
        get players() {
            return players;
        }
    };
}
