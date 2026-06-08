import * as THREE from 'three';
import { smoothstep, valueNoise2D } from './noise.js';

const BIOME_COLORS = {
    plains: new THREE.Color(0x6fb86a),
    slopes: new THREE.Color(0x9b9154),
    mountains: new THREE.Color(0x777d82)
};

const SNOW_TINT = new THREE.Color(0xeef2f5);
const COOL_TINT = new THREE.Color(0xa8b8c0);
const WARM_TINT = new THREE.Color(0xd9c890);
const DRY_TINT = new THREE.Color(0xb09a55);
const colorBuffer = new THREE.Color();
const tempColor = new THREE.Color();

export function sampleHeight(heightMap, x, z, sampleTerrain) {
    if (heightMap.getHeight) {
        return heightMap.getHeight(x, z) ?? sampleTerrain(x, z).height;
    }
    const key = `${x},${z}`;
    return heightMap.get(key) ?? sampleTerrain(x, z).height;
}

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

    return target;
}

export function createChunkTerrainGeometry(startX, startZ, endX, endZ, heightMap, sampleTerrain, terrainStep) {
    const width = endX - startX;
    const depth = endZ - startZ;
    const widthSegments = Math.max(1, Math.round(width / terrainStep));
    const depthSegments = Math.max(1, Math.round(depth / terrainStep));
    const geometry = new THREE.PlaneGeometry(width, depth, widthSegments, depthSegments);
    geometry.rotateX(-Math.PI / 2);

    const positions = geometry.attributes.position;
    const colors = new Float32Array(positions.count * 3);
    const gridStartX = startX - terrainStep;
    const gridStartZ = startZ - terrainStep;
    const gridColumnCount = Math.floor((endX - startX) / terrainStep) + 3;
    const gridRowCount = Math.floor((endZ - startZ) / terrainStep) + 3;
    const heightGrid = new Float32Array(gridColumnCount * gridRowCount);

    for (let row = 0; row < gridRowCount; row++) {
        const z = gridStartZ + row * terrainStep;
        for (let column = 0; column < gridColumnCount; column++) {
            const x = gridStartX + column * terrainStep;
            heightGrid[row * gridColumnCount + column] = sampleHeight(heightMap, x, z, sampleTerrain);
        }
    }

    function getGridHeight(x, z) {
        const column = Math.round((x - gridStartX) / terrainStep);
        const row = Math.round((z - gridStartZ) / terrainStep);
        return heightGrid[row * gridColumnCount + column];
    }

    let vertexIndex = 0;
    for (let z = startZ; z <= endZ; z += terrainStep) {
        for (let x = startX; x <= endX; x += terrainStep) {
            const sample = sampleTerrain(x, z);
            const y = getGridHeight(x, z);

            positions.setY(vertexIndex, y);

            getTerrainColor(sample, y, colorBuffer);
            colors[vertexIndex * 3] = colorBuffer.r;
            colors[vertexIndex * 3 + 1] = colorBuffer.g;
            colors[vertexIndex * 3 + 2] = colorBuffer.b;

            vertexIndex++;
        }
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeBoundingSphere();

    return { geometry, width, depth };
}
