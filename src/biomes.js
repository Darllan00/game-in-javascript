import * as THREE from 'three';
import { CONFIG } from './config.js';
import { fbm, ridgedFbm, smoothstep } from './noise.js';

const SEA_LEVEL = CONFIG.terreno.nivelDoMar;

export function continentalness(x, z) {
    const warpX = (fbm(x * 0.00055, z * 0.00055, 3, 810) - 0.5) * 360;
    const warpZ = (fbm(x * 0.00055, z * 0.00055, 3, 811) - 0.5) * 360;
    const broad = fbm((x + warpX) * 0.00085, (z + warpZ) * 0.00085, 4, 100);
    const ranges = ridgedFbm((x - 650) * 0.00115, (z + 420) * 0.00115, 4, 130);
    const basins = fbm((x + 950) * 0.00135, (z - 700) * 0.00135, 3, 160);
    const mixed = broad * 0.48 + ranges * 0.34 + basins * 0.18;
    return THREE.MathUtils.clamp((mixed - 0.28) / 0.48, 0, 1);
}

export function moisture(x, z) {
    return fbm(x * 0.003, z * 0.003, 3, 200);
}

export function temperature(x, z) {
    return fbm(x * 0.0015, z * 0.0015, 3, 400);
}

export function biomeWeights(c) {
    const wPlains = 1 - smoothstep(0.34, 0.52, c);
    const wSlopes = smoothstep(0.30, 0.50, c) * (1 - smoothstep(0.62, 0.78, c));
    const wMountains = smoothstep(0.58, 0.76, c);
    const total = wPlains + wSlopes + wMountains || 1;
    return {
        plains: wPlains / total,
        slopes: wSlopes / total,
        mountains: wMountains / total
    };
}

function softTerrace(value, step, strength) {
    const lower = Math.floor(value / step) * step;
    const upper = lower + step;
    const t = smoothstep(0.18, 0.82, (value - lower) / step);
    const terraced = THREE.MathUtils.lerp(lower, upper, t);
    return THREE.MathUtils.lerp(value, terraced, strength);
}

function plainsHeight(x, z) {
    const broad = (fbm(x * 0.0018, z * 0.0018, 3, 1) - 0.5) * 3.2;
    const hills = Math.pow(fbm(x * 0.0052, z * 0.0052, 3, 11), 2.05) * 4.8;
    const local = (fbm(x * 0.018, z * 0.018, 2, 12) - 0.5) * 0.55;
    const ripple = Math.sin(x / 34) * 0.16 + Math.cos(z / 39) * 0.16;
    return SEA_LEVEL - 1.8 + broad + hills + local + ripple;
}

function slopesHeight(x, z) {
    const rise = 8 + fbm(x * 0.0035, z * 0.0035, 4, 2) * 18;
    const shelfMask = smoothstep(0.38, 0.70, fbm(x * 0.0025, z * 0.0025, 3, 22));
    const plateau = softTerrace(rise + shelfMask * 6.0, 4.6, 0.58);
    const shoulder = (fbm(x * 0.008, z * 0.008, 2, 23) - 0.5) * 1.2;
    const detail = (fbm(x * 0.022, z * 0.022, 2, 5) - 0.5) * 0.55;
    return SEA_LEVEL + plateau + shoulder + detail;
}

function mountainsHeight(x, z) {
    const mass = smoothstep(0.34, 0.82, fbm(x * 0.0020, z * 0.0020, 4, 6)) * 22;
    const ridge = Math.pow(ridgedFbm(x * 0.0030, z * 0.0030, 5, 3), 1.72);
    const valleys = Math.pow(1 - ridgedFbm(x * 0.0021, z * 0.0021, 4, 9), 2.0);
    const peaks = ridge * 50;
    const detail = (fbm(x * 0.014, z * 0.014, 2, 7) - 0.5) * 0.9;
    return SEA_LEVEL + 24 + mass + peaks + detail - valleys * 9;
}

export function calculateTerrainHeight(x, z, weights) {
    let height = 0;
    if (weights.plains > 0) height += plainsHeight(x, z) * weights.plains;
    if (weights.slopes > 0) height += slopesHeight(x, z) * weights.slopes;
    if (weights.mountains > 0) height += mountainsHeight(x, z) * weights.mountains;
    return height;
}
