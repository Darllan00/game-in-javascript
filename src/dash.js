import { CONFIG } from './config.js';

const DASH_CONFIG = CONFIG.mecanicas?.dash ?? {};
const DASH_DURATION = DASH_CONFIG.duracao ?? 0.24;
const DASH_COOLDOWN = DASH_CONFIG.cooldown ?? 2.4;
const DASH_SPEED_MULTIPLIER = DASH_CONFIG.multiplicadorVelocidade ?? 3;

export function createDashState() {
    return {
        activeTime: 0,
        cooldownRemaining: 0,
        wasInputHeld: false
    };
}

export function tryStartDash(dashState) {
    if (!dashState || dashState.activeTime > 0 || dashState.cooldownRemaining > 0) return false;

    dashState.activeTime = DASH_DURATION;
    dashState.cooldownRemaining = DASH_COOLDOWN;
    return true;
}

export function updateDashState(dashState, delta) {
    if (!dashState) return 1;

    if (dashState.activeTime > 0) {
        dashState.activeTime = Math.max(0, dashState.activeTime - delta);
        return DASH_SPEED_MULTIPLIER;
    }

    if (dashState.cooldownRemaining > 0) {
        dashState.cooldownRemaining = Math.max(0, dashState.cooldownRemaining - delta);
    }

    return 1;
}

export function updateDashInput(dashState, isPressed, canDash = true) {
    if (!dashState) return;

    const justPressed = Boolean(isPressed) && !dashState.wasInputHeld;
    dashState.wasInputHeld = Boolean(isPressed);

    if (justPressed && canDash) {
        tryStartDash(dashState);
    }
}

export function getDashHudState(dashState) {
    if (!dashState) {
        return {
            isActive: false,
            ready: true,
            progress: 1
        };
    }

    const progress = dashState.activeTime > 0
        ? 0
        : 1 - Math.min(1, dashState.cooldownRemaining / DASH_COOLDOWN);

    return {
        isActive: dashState.activeTime > 0,
        ready: dashState.activeTime <= 0 && dashState.cooldownRemaining <= 0,
        progress
    };
}
