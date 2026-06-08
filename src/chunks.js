import * as THREE from 'three';

export function getChunkKey(cx, cz) {
    return `${cx},${cz}`;
}

export function getChunkBounds(cx, cz, chunkSize, worldMin, worldMax) {
    const rawStartX = cx * chunkSize;
    const rawStartZ = cz * chunkSize;
    const rawEndX = rawStartX + chunkSize;
    const rawEndZ = rawStartZ + chunkSize;
    const startX = Math.max(worldMin, rawStartX);
    const startZ = Math.max(worldMin, rawStartZ);
    const endX = Math.min(worldMax, rawEndX);
    const endZ = Math.min(worldMax, rawEndZ);
    return { startX, startZ, endX, endZ };
}

export function buildChunkGroup(terrainMesh) {
    const chunkGroup = new THREE.Group();
    chunkGroup.add(terrainMesh);
    return chunkGroup;
}
