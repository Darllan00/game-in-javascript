import { CONFIG } from './config.js';

export function updatePlayerPhysics({ delta, position, state, getHeight, jump, applyHorizontalMovement }) {
    state.velocidadeY -= CONFIG.movimento.gravidade * delta;

    const oldX = position.x;
    const oldZ = position.z;
    const oldGround = getHeight(oldX, oldZ);

    applyHorizontalMovement?.(CONFIG.movimento.velocidade * delta);

    const newGround = getHeight(position.x, position.z);
    const canStandAfterJump = position.y >= newGround + CONFIG.terreno.alturaOlhos;

    if (newGround > oldGround + CONFIG.movimento.alturaMaximaPasso && !canStandAfterJump) {
        position.x = oldX;
        position.z = oldZ;
    }

    if (jump && state.noChao) {
        state.velocidadeY = CONFIG.movimento.pulo;
        state.noChao = false;
    }

    position.y += state.velocidadeY * delta;

    const alturaDoChao = getHeight(position.x, position.z);
    const alturaOlhos = alturaDoChao + CONFIG.terreno.alturaOlhos;

    if (position.y <= alturaOlhos) {
        position.y = alturaOlhos;
        state.velocidadeY = 0;
        state.noChao = true;
    } else {
        state.noChao = false;
    }
}

export function updatePhysics(delta, controls, player, keys, state, getHeight) {
    updatePlayerPhysics({
        delta,
        position: player.position,
        state,
        getHeight,
        jump: keys.space,
        applyHorizontalMovement(distance) {
            if (keys.w) controls.moveForward(distance);
            if (keys.s) controls.moveForward(-distance);
            if (keys.a) controls.moveRight(-distance);
            if (keys.d) controls.moveRight(distance);
        }
    });
}
