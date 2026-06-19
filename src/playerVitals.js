import { CONFIG } from './config.js';

const PLAYER_CONFIG = CONFIG.mecanicas?.jogador ?? {};
const DROWNING_CONFIG = CONFIG.mecanicas?.afogamento ?? {};
const FALL_CONFIG = CONFIG.mecanicas?.queda ?? {};

const MAX_HEALTH = PLAYER_CONFIG.vidaMaxima ?? 100;
const DROWNING_SAFE_TIME = DROWNING_CONFIG.tempoSeguro ?? 10;
const DROWNING_DAMAGE_PER_SECOND = DROWNING_CONFIG.danoPorSegundo ?? 12.5;
const DROWNING_HEAD_MARGIN = DROWNING_CONFIG.margemCabeca ?? 0.08;
const SAFE_FALL_HEIGHT = FALL_CONFIG.alturaSegura ?? 42;
const FALL_DAMAGE_PER_METER = FALL_CONFIG.danoPorMetro ?? 4.5;
const FALL_DAMAGE_MAX = FALL_CONFIG.danoMaximo ?? 100;

function clampHealth(value) {
    return Math.max(0, Math.min(MAX_HEALTH, value));
}

export function createPlayerVitals({ id, label } = {}) {
    const vitals = {
        id: id ?? 'player',
        label: label ?? 'Player',
        health: MAX_HEALTH,
        maxHealth: MAX_HEALTH,
        underwaterTime: 0,
        lastDamageType: null,
        isUnderwater: false,
        waterSurfaceY: null,
        underwaterDepth: 0,

        get isDead() {
            return this.health <= 0;
        },

        damage(amount, type = 'generic') {
            if (this.isDead || amount <= 0) return 0;
            const previousHealth = this.health;
            this.health = clampHealth(this.health - amount);
            this.lastDamageType = type;
            return previousHealth - this.health;
        },

        reset() {
            this.health = MAX_HEALTH;
            this.underwaterTime = 0;
            this.lastDamageType = null;
            this.isUnderwater = false;
            this.waterSurfaceY = null;
            this.underwaterDepth = 0;
        },

        update(delta, position, getSample, landing = null) {
            if (this.isDead) return;

            if (landing) {
                applyFallDamage(this, landing);
            }

            updateDrowning(this, delta, position, getSample);
        }
    };

    return vitals;
}

function applyFallDamage(vitals, landing) {
    const fallDistance = landing.fallDistance ?? 0;
    if (fallDistance <= SAFE_FALL_HEIGHT) return;

    const damage = Math.min(
        FALL_DAMAGE_MAX,
        (fallDistance - SAFE_FALL_HEIGHT) * FALL_DAMAGE_PER_METER
    );
    vitals.damage(damage, 'fall');
}

function updateDrowning(vitals, delta, position, getSample) {
    const sample = getSample?.(position.x, position.z);
    const waterSurfaceY = sample?.water?.surfaceY;
    const depthBelowSurface = Number.isFinite(waterSurfaceY)
        ? waterSurfaceY - position.y
        : 0;
    const isUnderwater = Number.isFinite(waterSurfaceY)
        && depthBelowSurface > DROWNING_HEAD_MARGIN;

    vitals.isUnderwater = isUnderwater;
    vitals.waterSurfaceY = Number.isFinite(waterSurfaceY) ? waterSurfaceY : null;
    vitals.underwaterDepth = Math.max(0, depthBelowSurface);

    if (!isUnderwater) {
        vitals.underwaterTime = 0;
        return;
    }

    vitals.underwaterTime += delta;
    if (vitals.underwaterTime <= DROWNING_SAFE_TIME) return;

    vitals.damage(DROWNING_DAMAGE_PER_SECOND * delta, 'drowning');
}
