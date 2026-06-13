import { CONFIG } from './config.js';

export function updatePlayerPhysics({
    delta,
    position,
    state,
    getHeight,
    jump,
    movementSpeedMultiplier = 1,
    resolveHorizontalCollision,
    applyHorizontalMovement
}) {
    const wasOnGround = state.noChao;
    state.velocidadeY -= CONFIG.movimento.gravidade * delta;

    const oldX = position.x;
    const oldZ = position.z;
    const oldGround = getHeight(oldX, oldZ);

    applyHorizontalMovement?.(CONFIG.movimento.velocidade * movementSpeedMultiplier * delta);
    if (position.x !== oldX || position.z !== oldZ) {
        resolveHorizontalCollision?.(position);
    }

    const movedHorizontally = position.x !== oldX || position.z !== oldZ;
    let currentGround = movedHorizontally
        ? getHeight(position.x, position.z)
        : oldGround;
    const canStandAfterJump = position.y >= currentGround + CONFIG.terreno.alturaOlhos;

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
    const alturaOlhos = alturaDoChao + CONFIG.terreno.alturaOlhos;
    let landing = null;

    if (!state.noChao) {
        state.fallPeakY = Math.max(state.fallPeakY ?? position.y, position.y);
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
        jump: keys.space,
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
