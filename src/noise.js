import * as THREE from 'three';

let seedOffsetX = 0;
let seedOffsetZ = 0;
let seedValue = 0;

export function setNoiseSeed(numericSeed) {
    const seed = numericSeed >>> 0;
    seedValue = seed / 0xffffffff;
    seedOffsetX = ((Math.imul(seed ^ 0x9e3779b9, 1597334677) >>> 0) / 0xffffffff) * 20000 - 10000;
    seedOffsetZ = ((Math.imul(seed ^ 0x85ebca6b, 3812015801) >>> 0) / 0xffffffff) * 20000 - 10000;
}

export function hash2D(x, z, seed = 0) {
    const s = Math.sin(
        (x + seedOffsetX) * 127.1 +
        (z + seedOffsetZ) * 311.7 +
        (seed + seedValue * 10000) * 74.7
    ) * 43758.5453123;
    return s - Math.floor(s);
}

export function smoothstep(edge0, edge1, x) {
    const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
}

export function valueNoise2D(x, z, seed) {
    const x0 = Math.floor(x);
    const z0 = Math.floor(z);
    const tx = x - x0;
    const tz = z - z0;
    const sx = tx * tx * (3 - 2 * tx);
    const sz = tz * tz * (3 - 2 * tz);

    const a = hash2D(x0, z0, seed);
    const b = hash2D(x0 + 1, z0, seed);
    const c = hash2D(x0, z0 + 1, seed);
    const d = hash2D(x0 + 1, z0 + 1, seed);

    const ab = a + (b - a) * sx;
    const cd = c + (d - c) * sx;
    return ab + (cd - ab) * sz;
}

export function fbm(x, z, octaves, seed) {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
        sum += valueNoise2D(x * freq, z * freq, seed + i * 17) * amp;
        norm += amp;
        amp *= 0.5;
        freq *= 2;
    }
    return sum / norm;
}

export function ridgedFbm(x, z, octaves, seed) {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
        const n = valueNoise2D(x * freq, z * freq, seed + i * 23);
        sum += (1 - Math.abs(n * 2 - 1)) * amp;
        norm += amp;
        amp *= 0.5;
        freq *= 2;
    }
    return sum / norm;
}
