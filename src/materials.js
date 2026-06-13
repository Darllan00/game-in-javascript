import * as THREE from 'three';

export function createTerrainMaterial() {
    return new THREE.MeshLambertMaterial({
        color: 0xffffff,
        vertexColors: true,
        fog: true,
        toneMapped: true
    });
}

export function createSuperChunkTerrainMaterial({ chunkSize, maskDistance, maxFocuses = 2 }) {
    const material = createTerrainMaterial();
    const focusChunks = Array.from({ length: maxFocuses }, () => new THREE.Vector2(999999, 999999));
    const maskDistances = Array.from({ length: maxFocuses }, () => -1);
    const uniforms = {
        uChunkSize: { value: chunkSize },
        uMaskDistance: { value: maskDistance },
        uFocusCount: { value: 0 },
        uFocusChunks: { value: focusChunks },
        uMaskDistances: { value: maskDistances }
    };

    material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = shader.vertexShader
            .replace(
                '#include <common>',
                '#include <common>\nvarying vec2 vWorldXZ;'
            )
            .replace(
                '#include <project_vertex>',
                '#include <project_vertex>\nvWorldXZ = (modelMatrix * vec4(transformed, 1.0)).xz;'
            );
        shader.fragmentShader = shader.fragmentShader
            .replace(
                '#include <common>',
                `
                #include <common>
                uniform float uChunkSize;
                uniform float uMaskDistance;
                uniform int uFocusCount;
                uniform vec2 uFocusChunks[${maxFocuses}];
                uniform float uMaskDistances[${maxFocuses}];
                varying vec2 vWorldXZ;

                bool isInsideIndividualChunkArea(vec2 worldXZ) {
                    vec2 chunkCoord = floor(worldXZ / uChunkSize);
                    for (int i = 0; i < ${maxFocuses}; i++) {
                        if (i < uFocusCount) {
                            float safeMaskDistance = min(uMaskDistance, uMaskDistances[i]);
                            if (safeMaskDistance < 0.0) continue;
                            vec2 delta = abs(chunkCoord - uFocusChunks[i]);
                            if (max(delta.x, delta.y) <= safeMaskDistance) return true;
                        }
                    }
                    return false;
                }
                `
            )
            .replace(
                '#include <clipping_planes_fragment>',
                '#include <clipping_planes_fragment>\nif (isInsideIndividualChunkArea(vWorldXZ)) discard;'
            );
    };

    material.customProgramCacheKey = () => `super-chunk-mask-${maxFocuses}`;
    material.userData.setMaskFocuses = (focuses) => {
        uniforms.uFocusCount.value = Math.min(maxFocuses, focuses.length);
        for (let i = 0; i < maxFocuses; i++) {
            const focus = focuses[i];
            focusChunks[i].set(focus?.chunkX ?? 999999, focus?.chunkZ ?? 999999);
            maskDistances[i] = focus?.maskDistance ?? -1;
        }
    };

    return material;
}
