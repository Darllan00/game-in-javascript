import * as THREE from 'three';
import { CONFIG } from './config.js';

const GAMEPAD_DEADZONE = 0.18;
const MOUSE_SENSITIVITY = 0.0022;
const GAMEPAD_LOOK_SPEED = 2.7;
const MAX_PITCH = Math.PI / 2 - 0.08;
const MIN_PITCH = -MAX_PITCH;
const PLAYER_ONE_BODY_LAYER = 1;
const PLAYER_TWO_BODY_LAYER = 2;
const PLAYER_HITBOX_RADIUS = 0.55;
const PLAYER_HITBOX_HEIGHT = 2.0;

const forwardVector = new THREE.Vector3();
const rightVector = new THREE.Vector3();
const movementVector = new THREE.Vector3();
const cameraEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const hitboxDelta = new THREE.Vector2();

function createKeyState() {
    return {
        KeyW: false,
        KeyA: false,
        KeyS: false,
        KeyD: false,
        Space: false,
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
    group.add(body);

    return { group, body, geometry, material };
}

function createCoopPlayer({ color, label, camera, startX, startZ, yaw, getHeight }) {
    const block = createPlayerBlock(color, label);
    block.group.position.set(
        startX,
        getHeight(startX, startZ) + CONFIG.terreno.alturaOlhos + 2,
        startZ
    );

    return {
        ...block,
        camera,
        yaw,
        pitch: 0,
        state: {
            velocidadeY: 0,
            noChao: false
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
            jump: false
        }
    };
}

function updateCoopPlayerPhysics(delta, player, getHeight) {
    const position = player.group.position;
    const oldX = position.x;
    const oldZ = position.z;
    const oldGround = getHeight(oldX, oldZ);

    player.state.velocidadeY -= CONFIG.movimento.gravidade * delta;

    forwardVector.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
    rightVector.set(Math.cos(player.yaw), 0, -Math.sin(player.yaw));

    movementVector.set(0, 0, 0)
        .addScaledVector(rightVector, player.input.x)
        .addScaledVector(forwardVector, -player.input.z);

    if (movementVector.lengthSq() > 1) movementVector.normalize();

    position.x += movementVector.x * CONFIG.movimento.velocidade * delta;
    position.z += movementVector.z * CONFIG.movimento.velocidade * delta;

    const newGround = getHeight(position.x, position.z);
    const canStandAfterJump = position.y >= newGround + CONFIG.terreno.alturaOlhos;
    if (newGround > oldGround + CONFIG.movimento.alturaMaximaPasso && !canStandAfterJump) {
        position.x = oldX;
        position.z = oldZ;
    }

    if (player.input.jump && player.state.noChao) {
        player.state.velocidadeY = CONFIG.movimento.pulo;
        player.state.noChao = false;
    }

    position.y += player.state.velocidadeY * delta;

    const groundHeight = getHeight(position.x, position.z);
    const eyeHeight = groundHeight + CONFIG.terreno.alturaOlhos;
    if (position.y <= eyeHeight) {
        position.y = eyeHeight;
        player.state.velocidadeY = 0;
        player.state.noChao = true;
    } else {
        player.state.noChao = false;
    }
}

function resolvePlayerHitboxes(players, getHeight) {
    for (let i = 0; i < players.length; i++) {
        for (let j = i + 1; j < players.length; j++) {
            const a = players[i];
            const b = players[j];
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
}

function updateGamepadInput(player, gamepad) {
    if (!gamepad) {
        player.input.x = 0;
        player.input.z = 0;
        player.input.lookX = 0;
        player.input.lookY = 0;
        player.input.jump = false;
        return;
    }

    player.input.x = readAxis(gamepad.axes?.[0] ?? 0);
    player.input.z = readAxis(gamepad.axes?.[1] ?? 0);
    player.input.lookX = readAxis(gamepad.axes?.[2] ?? 0);
    player.input.lookY = readAxis(gamepad.axes?.[3] ?? 0);
    player.input.jump = isGamepadJumping(gamepad);
}

export function createLocalCoopMode({ scene, camera, renderer, getHeight }) {
    const keyboard = createKeyState();
    const playerOne = createCoopPlayer({
        color: 0x2f7dff,
        label: 'Player 1',
        camera,
        startX: -2,
        startZ: 0,
        yaw: 0,
        getHeight
    });
    const playerTwo = createCoopPlayer({
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

    playerOne.body.layers.set(PLAYER_ONE_BODY_LAYER);
    playerTwo.body.layers.set(PLAYER_TWO_BODY_LAYER);
    playerOne.camera.layers.enable(PLAYER_TWO_BODY_LAYER);
    playerTwo.camera.layers.enable(PLAYER_ONE_BODY_LAYER);

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

    function start() {
        isStarted = true;
        if (menu) menu.style.display = 'none';
        document.body.requestPointerLock?.();
    }

    menu?.addEventListener('click', (event) => {
        if (event.target instanceof Element && event.target.closest('[data-menu-control], button, input, textarea, select')) return;
        start();
    });

    document.addEventListener('pointerlockchange', () => {
        if (!isStarted) return;
        if (document.pointerLockElement === document.body) return;
        isStarted = false;
        if (menu) menu.style.display = 'flex';
    });

    window.addEventListener('keydown', (event) => {
        if (event.code in keyboard) {
            keyboard[event.code] = true;
            event.preventDefault();
        }
        if (!isStarted && event.code === 'Enter') start();
    });

    window.addEventListener('keyup', (event) => {
        if (event.code in keyboard) {
            keyboard[event.code] = false;
            event.preventDefault();
        }
    });

    window.addEventListener('mousemove', (event) => {
        if (!isStarted || document.pointerLockElement !== document.body) return;
        playerOne.yaw -= event.movementX * MOUSE_SENSITIVITY;
        playerOne.pitch = clampPitch(playerOne.pitch - event.movementY * MOUSE_SENSITIVITY);
    });

    function update(delta) {
        const gamepads = getAssignedGamepads();

        updateKeyboardMouseInput(playerOne, keyboard);
        playerOne.input.lookX = 0;
        playerOne.input.lookY = 0;

        if (gamepads.playerOne) {
            const keyboardMoveX = playerOne.input.x;
            const keyboardMoveZ = playerOne.input.z;
            const keyboardJump = playerOne.input.jump;
            updateGamepadInput(playerOne, gamepads.playerOne);
            playerOne.input.x = playerOne.input.x || keyboardMoveX;
            playerOne.input.z = playerOne.input.z || keyboardMoveZ;
            playerOne.input.jump = playerOne.input.jump || keyboardJump;
        }

        updateGamepadInput(playerTwo, gamepads.playerTwo);

        if (isStarted) {
            for (const player of players) {
                updateCoopPlayerPhysics(delta, player, getHeight);
            }
            resolvePlayerHitboxes(players, getHeight);
            for (const player of players) {
                updateCoopCamera(player, delta);
            }
        }

        const isMoving = players.some((player) => player.input.x !== 0 || player.input.z !== 0);
        return {
            isActive: isStarted,
            isMoving,
            primary: playerOne.group.position,
            focuses: players.map((player) => player.group.position)
        };
    }

    function render() {
        const width = window.innerWidth;
        const height = window.innerHeight;
        const leftWidth = Math.floor(width / 2);
        const rightWidth = width - leftWidth;

        renderer.setScissorTest(true);

        renderer.setViewport(0, 0, leftWidth, height);
        renderer.setScissor(0, 0, leftWidth, height);
        renderer.render(scene, playerOne.camera);

        renderer.setViewport(leftWidth, 0, rightWidth, height);
        renderer.setScissor(leftWidth, 0, rightWidth, height);
        renderer.render(scene, playerTwo.camera);

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
        for (const item of splitCrosshairs) {
            item.remove();
        }
        for (const player of players) {
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
