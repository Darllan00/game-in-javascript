import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

export const keys = {
    w: false,
    a: false,
    s: false,
    d: false,
    space: false
};

export function setupControls(camera) {
    const controls = new PointerLockControls(camera, document.body);
    const player = controls.getObject();

    const menu = document.getElementById('menu');

    menu.addEventListener('click', () => controls.lock());

    controls.addEventListener('lock', () => {
        menu.style.display = 'none';
    });

    controls.addEventListener('unlock', () => {
        menu.style.display = 'flex';
    });

    window.addEventListener('keydown', (e) => {
        const k = e.code === 'Space' ? 'space' : e.key.toLowerCase();
        if (k in keys) keys[k] = true;
    });

    window.addEventListener('keyup', (e) => {
        const k = e.code === 'Space' ? 'space' : e.key.toLowerCase();
        if (k in keys) keys[k] = false;
    });

    return { controls, player };
}