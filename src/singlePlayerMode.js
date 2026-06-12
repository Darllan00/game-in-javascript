import { setupControls, keys } from './input.js';
import { state } from './state.js';
import { updatePhysics } from './physics.js';

export function createSinglePlayerMode({ scene, camera, renderer, getHeight, requestStart }) {
    const { controls, player } = setupControls(camera, { requestStart });
    scene.add(player);

    function update(delta) {
        const isMoving = keys.w || keys.a || keys.s || keys.d;
        if (controls.isLocked) {
            updatePhysics(delta, controls, player, keys, state, getHeight);
        }

        return {
            isActive: controls.isLocked,
            isMoving,
            primary: player.position,
            focuses: [player.position]
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
