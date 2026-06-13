import { CONFIG } from './config.js';

const BOW_CONFIG = CONFIG.mecanicas?.arco ?? {};
const MAX_LEVEL = Math.max(1, BOW_CONFIG.niveis ?? 4);
const TIME_PER_LEVEL = BOW_CONFIG.tempoPorNivel ?? 0.38;

export function createBowState() {
    return {
        isCharging: false,
        isHeld: false,
        chargeTime: 0,
        pendingRelease: false
    };
}

export function setBowHeld(bowState, isHeld) {
    if (!bowState) return;

    if (isHeld) {
        if (!bowState.isCharging) {
            bowState.isCharging = true;
            bowState.chargeTime = 0;
        }
        bowState.isHeld = true;
        return;
    }

    if (bowState.isCharging && bowState.isHeld) {
        bowState.pendingRelease = true;
    }
    bowState.isHeld = false;
}

export function updateBowState(bowState, delta, canUse = true) {
    if (!bowState) return null;

    if (!canUse) {
        resetBowState(bowState);
        return null;
    }

    if (bowState.isCharging && bowState.isHeld) {
        bowState.chargeTime += delta;
    }

    if (!bowState.pendingRelease || !bowState.isCharging) return null;

    const chargeTime = Math.max(0.001, bowState.chargeTime);
    const shot = {
        level: getBowChargeLevel(chargeTime),
        chargeTime
    };
    resetBowState(bowState);
    return shot;
}

export function getBowChargeLevel(chargeTime) {
    return Math.min(MAX_LEVEL, Math.floor(chargeTime / TIME_PER_LEVEL) + 1);
}

export function getBowHudState(bowState) {
    if (!bowState?.isCharging) {
        return {
            isCharging: false,
            level: 0,
            progress: 0
        };
    }

    const fullChargeTime = TIME_PER_LEVEL * MAX_LEVEL;
    return {
        isCharging: true,
        level: getBowChargeLevel(bowState.chargeTime),
        progress: Math.min(1, bowState.chargeTime / fullChargeTime)
    };
}

function resetBowState(bowState) {
    bowState.isCharging = false;
    bowState.isHeld = false;
    bowState.chargeTime = 0;
    bowState.pendingRelease = false;
}
