import { CONFIG } from './config.js';

export function updatePhysics(delta, controls, player, keys, state, getHeight) {
    state.velocidadeY -= CONFIG.movimento.gravidade * delta;

    const oldX = player.position.x;
    const oldZ = player.position.z;

    if (keys.w) controls.moveForward(CONFIG.movimento.velocidade * delta);
    if (keys.s) controls.moveForward(-CONFIG.movimento.velocidade * delta);
    if (keys.a) controls.moveRight(-CONFIG.movimento.velocidade * delta);
    if (keys.d) controls.moveRight(CONFIG.movimento.velocidade * delta);

    const alturaDoChao = getHeight(player.position.x, player.position.z);
    const alturaOlhos = alturaDoChao + CONFIG.terreno.alturaOlhos;

    if (player.position.y <= alturaOlhos) {
        player.position.y = alturaOlhos;
        state.velocidadeY = 0;
        state.noChao = true;
    } else {
        state.noChao = false;
    }

    if (keys.space && state.noChao) {
        state.velocidadeY = CONFIG.movimento.pulo;
    }

    player.position.y += state.velocidadeY * delta;

    if (
        state.noChao &&
        getHeight(player.position.x, player.position.z) >
            getHeight(oldX, oldZ) + 1
    ) {
        player.position.x = oldX;
        player.position.z = oldZ;
    }
}