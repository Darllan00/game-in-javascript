import * as THREE from 'three';
import { smoothstep, valueNoise2D } from './noise.js';
import { CONFIG } from './config.js';

const BIOME_COLORS = {
    plains: new THREE.Color(0x6fb86a),
    slopes: new THREE.Color(0x9b9154),
    mountains: new THREE.Color(0x777d82)
};

const SNOW_TINT = new THREE.Color(0xeef2f5);
const COOL_TINT = new THREE.Color(0xa8b8c0);
const WARM_TINT = new THREE.Color(0xd9c890);
const DRY_TINT = new THREE.Color(0xb09a55);
const BANK_SAND_COLOR = new THREE.Color(0xc8b779);
const WATER_SURFACE_Y = CONFIG.terreno.nivelDoMar + (CONFIG.agua?.nivelSuperficie ?? 0);
const BANK_CONFIG = CONFIG.agua?.barranco ?? {};
const BANK_SAND_MAX_STEEPNESS = BANK_CONFIG.areiaAteInclinacao ?? 0.62;
const SHALLOW_BED_DEPTH = 2.4;
const colorBuffer = new THREE.Color();
const tempColor = new THREE.Color();
const TERRAIN_SKIRT_DEPTH = 32;

function getTerrainColor(sample, y, target) {
    const { weights: w } = sample;

    target.copy(BIOME_COLORS.plains).multiplyScalar(w.plains);
    tempColor.copy(BIOME_COLORS.slopes).multiplyScalar(w.slopes);
    target.add(tempColor);
    tempColor.copy(BIOME_COLORS.mountains).multiplyScalar(w.mountains);
    target.add(tempColor);

    const m = sample.moisture;
    if (m < 0.45) {
        target.lerp(DRY_TINT, (0.45 - m) * 0.4);
    }

    const temp = sample.temperature;
    if (temp < 0.4) {
        target.lerp(COOL_TINT, (0.4 - temp) * 0.25);
    } else if (temp > 0.6) {
        target.lerp(WARM_TINT, (temp - 0.6) * 0.18);
    }

    const variation = (valueNoise2D(sample.x * 0.18, sample.z * 0.18, 555) - 0.5) * 0.16;
    target.r = THREE.MathUtils.clamp(target.r * (1 + variation), 0, 1);
    target.g = THREE.MathUtils.clamp(target.g * (1 + variation), 0, 1);
    target.b = THREE.MathUtils.clamp(target.b * (1 + variation), 0, 1);

    const snowBlend = smoothstep(34, 46, y);
    target.lerp(SNOW_TINT, snowBlend);

    if (y > 22) {
        const t = THREE.MathUtils.clamp((y - 22) / 14, 0, 0.4);
        tempColor.copy(target).multiplyScalar(0.85);
        target.lerp(tempColor, t);
    }

    if (sample.water?.coverage > 0.02 && y < WATER_SURFACE_Y) {
        const bedSand = smoothstep(0.02, SHALLOW_BED_DEPTH, WATER_SURFACE_Y - y)
            * THREE.MathUtils.clamp(sample.water.coverage * 1.3, 0, 0.9);
        target.lerp(BANK_SAND_COLOR, bedSand);
    } else if (sample.bank?.coverage > 0.001) {
        const bankCoverage = THREE.MathUtils.clamp(sample.bank.coverage, 0, 1);
        const steepness = THREE.MathUtils.clamp(sample.bank.steepness ?? 0, 0, 1);
        const sandBlend = (1 - smoothstep(BANK_SAND_MAX_STEEPNESS, 1.0, steepness))
            * smoothstep(0.12, 0.58, bankCoverage)
            * smoothstep(WATER_SURFACE_Y + 2.4, WATER_SURFACE_Y + 0.12, y);

        target.lerp(BANK_SAND_COLOR, THREE.MathUtils.clamp(sandBlend * 0.65, 0, 0.55));
    }

    return target;
}

export function createChunkTerrainGeometry(startX, startZ, endX, endZ, sampleTerrain, terrainStep) {
    const width = endX - startX;
    const depth = endZ - startZ;
    const widthSegments = Math.max(1, Math.round(width / terrainStep));
    const depthSegments = Math.max(1, Math.round(depth / terrainStep));
    const stepX = width / widthSegments;
    const stepZ = depth / depthSegments;
    const positions = [];
    const colors = [];
    const normals = [];
    const indices = [];
    const topVertexIndices = [];

    function pushVertex(localX, y, localZ, color) {
        const index = positions.length / 3;
        positions.push(localX, y, localZ);
        colors.push(color.r, color.g, color.b);
        normals.push(0, 1, 0);
        return index;
    }

    function pushTopVertex(row, column) {
        const x = startX + column * stepX;
        const z = startZ + row * stepZ;
        const sample = sampleTerrain(x, z);
        const y = sample.height;

        getTerrainColor(sample, y, colorBuffer);
        return pushVertex(
            -width / 2 + column * stepX,
            y,
            -depth / 2 + row * stepZ,
            colorBuffer
        );
    }

    for (let row = 0; row <= depthSegments; row++) {
        topVertexIndices[row] = [];
        for (let column = 0; column <= widthSegments; column++) {
            topVertexIndices[row][column] = pushTopVertex(row, column);
        }
    }

    function setTopNormal(row, column) {
        const left = topVertexIndices[row][Math.max(0, column - 1)];
        const right = topVertexIndices[row][Math.min(widthSegments, column + 1)];
        const up = topVertexIndices[Math.max(0, row - 1)][column];
        const down = topVertexIndices[Math.min(depthSegments, row + 1)][column];
        const leftOffset = left * 3;
        const rightOffset = right * 3;
        const upOffset = up * 3;
        const downOffset = down * 3;
        const tangentXX = positions[rightOffset] - positions[leftOffset];
        const tangentXY = positions[rightOffset + 1] - positions[leftOffset + 1];
        const tangentXZ = positions[rightOffset + 2] - positions[leftOffset + 2];
        const tangentZX = positions[downOffset] - positions[upOffset];
        const tangentZY = positions[downOffset + 1] - positions[upOffset + 1];
        const tangentZZ = positions[downOffset + 2] - positions[upOffset + 2];
        let nx = tangentZY * tangentXZ - tangentZZ * tangentXY;
        let ny = tangentZZ * tangentXX - tangentZX * tangentXZ;
        let nz = tangentZX * tangentXY - tangentZY * tangentXX;
        if (ny < 0) {
            nx = -nx;
            ny = -ny;
            nz = -nz;
        }
        const length = Math.hypot(nx, ny, nz) || 1;
        const normalOffset = topVertexIndices[row][column] * 3;
        normals[normalOffset] = nx / length;
        normals[normalOffset + 1] = ny / length;
        normals[normalOffset + 2] = nz / length;
    }

    for (let row = 0; row <= depthSegments; row++) {
        for (let column = 0; column <= widthSegments; column++) {
            setTopNormal(row, column);
        }
    }

    for (let row = 0; row < depthSegments; row++) {
        for (let column = 0; column < widthSegments; column++) {
            const a = topVertexIndices[row][column];
            const b = topVertexIndices[row][column + 1];
            const c = topVertexIndices[row + 1][column];
            const d = topVertexIndices[row + 1][column + 1];
            indices.push(a, c, b, b, c, d);
        }
    }

    function pushSkirtVertex(topIndex) {
        const positionOffset = topIndex * 3;
        const colorOffset = topIndex * 3;
        const index = pushVertex(
            positions[positionOffset],
            positions[positionOffset + 1] - TERRAIN_SKIRT_DEPTH,
            positions[positionOffset + 2],
            tempColor.setRGB(colors[colorOffset], colors[colorOffset + 1], colors[colorOffset + 2])
        );
        const normalOffset = index * 3;
        normals[normalOffset] = normals[positionOffset];
        normals[normalOffset + 1] = normals[positionOffset + 1];
        normals[normalOffset + 2] = normals[positionOffset + 2];
        return index;
    }

    function addSkirtSegment(topA, topB) {
        const bottomA = pushSkirtVertex(topA);
        const bottomB = pushSkirtVertex(topB);
        indices.push(
            topA, bottomA, topB,
            topB, bottomA, bottomB,
            topB, bottomA, topA,
            bottomB, bottomA, topB
        );
    }

    for (let column = 0; column < widthSegments; column++) {
        addSkirtSegment(topVertexIndices[0][column + 1], topVertexIndices[0][column]);
        addSkirtSegment(topVertexIndices[depthSegments][column], topVertexIndices[depthSegments][column + 1]);
    }

    for (let row = 0; row < depthSegments; row++) {
        addSkirtSegment(topVertexIndices[row][0], topVertexIndices[row + 1][0]);
        addSkirtSegment(topVertexIndices[row + 1][widthSegments], topVertexIndices[row][widthSegments]);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();

    return { geometry, width, depth };
}
