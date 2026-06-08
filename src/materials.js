import * as THREE from 'three';

export function createTerrainMaterial() {
    return new THREE.MeshBasicMaterial({
        color: 0xffffff,
        vertexColors: true,
        fog: true,
        toneMapped: false
    });
}
