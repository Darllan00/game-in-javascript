import { CONFIG } from './config.js';

const WATER_PHYSICS = CONFIG.agua?.fisica ?? {};
const EYE_HEIGHT = CONFIG.terreno.alturaOlhos ?? 2;
const WATER_MOVE_MULTIPLIER = WATER_PHYSICS.multiplicadorMovimento ?? 0.55;
const WATER_GRAVITY = WATER_PHYSICS.gravidade ?? 5.5;
const WATER_VERTICAL_DRAG = WATER_PHYSICS.arrastoVertical ?? 3.6;
const WATER_SWIM_UP_SPEED = WATER_PHYSICS.velocidadeSubida ?? 5.8;
const WATER_MAX_FALL_SPEED = WATER_PHYSICS.velocidadeQuedaMaxima ?? 4.8;
const WATER_ENTRY_MARGIN = WATER_PHYSICS.margemEntrada ?? 0.18;
const CROUCH_CONFIG = CONFIG.mecanicas?.agachar ?? {};
const CROUCH_MOVE_MULTIPLIER = CROUCH_CONFIG.multiplicadorVelocidade ?? 0.42;
const CROUCH_EYE_HEIGHT = CROUCH_CONFIG.alturaOlhos ?? 1.18;
const CROUCH_WATER_SINK_SPEED = CROUCH_CONFIG.velocidadeAfundarAgua ?? 2.8;

function getWaterState(position, sample, eyeHeight = EYE_HEIGHT) {
    const water = sample?.water;
    if (!water || water.coverage <= 0.08 || water.depth <= 0.08) return null;

    const feetY = position.y - eyeHeight;
    if (feetY > water.surfaceY + WATER_ENTRY_MARGIN) return null;

    return {
        surfaceY: water.surfaceY,
        depth: water.depth,
        isHeadUnderwater: position.y < water.surfaceY
    };
}

export function updatePlayerPhysics({
    delta,
    position,
    state,
    getHeight,
    getSample,
    jump,
    crouching = false,
    movementSpeedMultiplier = 1,
    resolveHorizontalCollision,
    applyHorizontalMovement
}) {
    const wasOnGround = state.noChao;
    const eyeHeight = crouching ? CROUCH_EYE_HEIGHT : EYE_HEIGHT;
    const groundEyeHeight = crouching
        ? Math.min(CROUCH_EYE_HEIGHT, EYE_HEIGHT)
        : EYE_HEIGHT;

    const oldX = position.x;
    const oldZ = position.z;
    const oldGround = getHeight(oldX, oldZ);
    const oldSample = getSample?.(oldX, oldZ);
    const oldWaterState = getWaterState(position, oldSample, eyeHeight);
    const waterMoveMultiplier = oldWaterState ? WATER_MOVE_MULTIPLIER : 1;
    const crouchMoveMultiplier = crouching ? CROUCH_MOVE_MULTIPLIER : 1;
    const gravity = oldWaterState ? WATER_GRAVITY : CONFIG.movimento.gravidade;

    state.velocidadeY -= gravity * delta;
    if (oldWaterState) {
        state.velocidadeY *= Math.max(0, 1 - WATER_VERTICAL_DRAG * delta);
        state.velocidadeY = Math.max(state.velocidadeY, -WATER_MAX_FALL_SPEED);
        if (crouching && !jump) {
            state.velocidadeY = Math.min(state.velocidadeY, -CROUCH_WATER_SINK_SPEED);
        } else if (jump) {
            state.velocidadeY = Math.max(state.velocidadeY, WATER_SWIM_UP_SPEED);
            state.noChao = false;
        }
        state.fallPeakY = null;
    }

    applyHorizontalMovement?.(
        CONFIG.movimento.velocidade
        * movementSpeedMultiplier
        * waterMoveMultiplier
        * crouchMoveMultiplier
        * delta
    );
    if (position.x !== oldX || position.z !== oldZ) {
        resolveHorizontalCollision?.(position);
    }

    const movedHorizontally = position.x !== oldX || position.z !== oldZ;
    let currentGround = movedHorizontally
        ? getHeight(position.x, position.z)
        : oldGround;
    const currentSample = movedHorizontally ? getSample?.(position.x, position.z) : oldSample;
    const currentWaterState = getWaterState(position, currentSample, eyeHeight);
    const canStandAfterJump = position.y >= currentGround + groundEyeHeight;

    if (currentGround > oldGround + CONFIG.movimento.alturaMaximaPasso && !canStandAfterJump) {
        position.x = oldX;
        position.z = oldZ;
        currentGround = oldGround;
    }

    if (jump && state.noChao) {
        state.velocidadeY = CONFIG.movimento.pulo;
        state.noChao = false;
        state.fallPeakY = position.y;
    }

    position.y += state.velocidadeY * delta;

    const alturaDoChao = currentGround;
    const alturaOlhos = alturaDoChao + groundEyeHeight;
    let landing = null;

    if (!state.noChao) {
        state.fallPeakY = Math.max(state.fallPeakY ?? position.y, position.y);
    }

    if (currentWaterState) {
        state.fallPeakY = null;
    }

    if (position.y <= alturaOlhos) {
        if (!wasOnGround && state.fallPeakY !== null) {
            landing = {
                fallDistance: Math.max(0, state.fallPeakY - alturaOlhos),
                groundHeight: alturaDoChao
            };
        }
        position.y = alturaOlhos;
        state.velocidadeY = 0;
        state.noChao = true;
        state.fallPeakY = null;
    } else {
        state.noChao = false;
    }

    return { landing };
}

export function updatePhysics(
    delta,
    controls,
    player,
    keys,
    state,
    getHeight,
    movementSpeedMultiplier = 1,
    options = {}
) {
    return updatePlayerPhysics({
        delta,
        position: player.position,
        state,
        getHeight,
        getSample: options.getSample,
        jump: keys.space,
        crouching: keys.crouch,
        movementSpeedMultiplier,
        resolveHorizontalCollision: options.resolveHorizontalCollision,
        applyHorizontalMovement(distance) {
            if (keys.w) controls.moveForward(distance);
            if (keys.s) controls.moveForward(-distance);
            if (keys.a) controls.moveRight(-distance);
            if (keys.d) controls.moveRight(distance);
        }
    });
}
