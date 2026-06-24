import { StablePointerLockControls } from './pointerLockLook.js';

export const keys = {
    w: false,
    a: false,
    s: false,
    d: false,
    space: false,
    shift: false,
    crouch: false
};

export function setupControls(camera, options = {}) {
    const controls = new StablePointerLockControls(camera, document.body);
    const player = controls.getObject();

    const menu = document.getElementById('menu');
    let isStarting = false;

    async function requestStart() {
        if (isStarting || controls.isLocked) return;
        isStarting = true;
        try {
            controls.lock();
            const startResult = options.requestStart?.(player);
            if (startResult) await startResult;
        } finally {
            isStarting = false;
        }
    }

    menu.addEventListener('click', (event) => {
        if (event.target instanceof Element && event.target.closest('[data-menu-control], button, input, textarea, select')) return;
        requestStart();
    });

    controls.addEventListener('lock', () => {
        menu.style.display = 'none';
    });

    controls.addEventListener('unlock', () => {
        menu.style.display = 'flex';
    });

    window.addEventListener('keydown', (e) => {
        const k = e.code === 'Space'
            ? 'space'
            : e.code === 'ShiftLeft' || e.code === 'ShiftRight'
                ? 'shift'
                : e.code === 'ControlLeft' || e.code === 'ControlRight' || e.code === 'KeyC'
                    ? 'crouch'
                : e.key.toLowerCase();
        if (k in keys) keys[k] = true;
    });

    window.addEventListener('keyup', (e) => {
        const k = e.code === 'Space'
            ? 'space'
            : e.code === 'ShiftLeft' || e.code === 'ShiftRight'
                ? 'shift'
                : e.code === 'ControlLeft' || e.code === 'ControlRight' || e.code === 'KeyC'
                    ? 'crouch'
                : e.key.toLowerCase();
        if (k in keys) keys[k] = false;
    });

    return { controls, player };
}
