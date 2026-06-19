import * as THREE from 'three';
import { CONFIG } from './config.js';
import { getChunkBounds, getChunkKey } from './chunks.js';

const CHUNK_SIZE = CONFIG.terreno.tamanhoChunk;
const WORLD_MIN = -CONFIG.terreno.tamanhoGrade / 2;
const WORLD_MAX = CONFIG.terreno.tamanhoGrade / 2;
const WATER_CONFIG = CONFIG.agua ?? {};
const WATER_SURFACE_Y = CONFIG.terreno.nivelDoMar + (WATER_CONFIG.nivelSuperficie ?? 0);
const WATER_RENDER_OFFSET = Math.min(WATER_CONFIG.elevacaoSuperficie ?? -6.08, -0.01);
const EMPTY_WATER_CHUNK_CACHE_LIMIT = 4096;
const WATER_EDGE_EXPAND_STEPS = Math.max(0, WATER_CONFIG.expansaoBordaMalha ?? 1);
const WATER_EDGE_COVERAGE = Math.max(0.001, WATER_CONFIG.coberturaBordaMalha ?? 0.42);
const WATER_EDGE_DEPTH = Math.max(0.01, WATER_CONFIG.profundidadeVisualBorda ?? 0.22);

function rememberLimitedSetValue(set, value, limit) {
    set.delete(value);
    set.add(value);
    if (set.size > limit) {
        set.delete(set.values().next().value);
    }
}

function createWaterMaterial() {
    const materialConfig = WATER_CONFIG.material ?? {};
    const sunDirection = new THREE.Vector3(0, 1, 0);
    const moonDirection = new THREE.Vector3(0, -1, 0);
    return new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.merge([
            THREE.UniformsLib.fog,
            THREE.UniformsLib.lights,
            {
                uTime: { value: 0 },
                uWaveSpeed: { value: materialConfig.velocidadeOnda ?? 0.72 },
                uWaveAmplitude: { value: materialConfig.amplitudeOnda ?? 0.055 },
                uShallowAlpha: { value: materialConfig.transparenciaRasa ?? 0.42 },
                uDeepAlpha: { value: materialConfig.transparenciaFunda ?? 0.78 },
                uShallowColor: { value: new THREE.Color(0x347f95) },
                uDeepColor: { value: new THREE.Color(0x082f4d) },
                uFoamColor: { value: new THREE.Color(0xd8f4ed) },
                uSunDirection: { value: sunDirection },
                uMoonDirection: { value: moonDirection },
                uSunColor: { value: new THREE.Color(0xfff0cf) },
                uMoonColor: { value: new THREE.Color(0xb7c9ff) },
                uSkyColor: { value: new THREE.Color(0x8fc7ff) },
                uSunIntensity: { value: 1 },
                uMoonIntensity: { value: 0 },
                uAmbientIntensity: { value: 0.7 },
                uLightLevel: { value: 1 },
                uHorizonWarmth: { value: 0 },
                uSkyReflectionStrength: { value: materialConfig.reflexoCeu ?? 0.42 },
                uSunSpecularStrength: { value: materialConfig.brilhoSol ?? 1.65 },
                uMoonSpecularStrength: { value: materialConfig.brilhoLua ?? 0.75 },
                uFoamStrength: { value: materialConfig.espuma ?? 0.2 },
                uDepthContrast: { value: materialConfig.contrasteProfundidade ?? 1.08 },
                uSurfaceShadowStrength: { value: materialConfig.opacidadeSombraSuperficie ?? 0.36 },
                uSurfaceShadowAlphaBoost: { value: materialConfig.opacidadeExtraSombraSuperficie ?? 0.0 }
            }
        ]),
        vertexShader: `
            uniform float uTime;
            uniform float uWaveSpeed;
            uniform float uWaveAmplitude;

            attribute float aDepth;
            attribute float aCoverage;
            attribute vec2 aFlow;

            varying float vDepth;
            varying float vCoverage;
            varying float vFoam;
            varying vec2 vWorldXZ;
            varying vec3 vWorldPosition;
            varying vec3 vWaterNormal;
            varying float vRipple;
            varying float vEdgeNoise;

            #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
                uniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];
                varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
            #endif

            #include <fog_pars_vertex>

            void main() {
                vec3 transformedPosition = position;
                vec4 worldBase = modelMatrix * vec4(position, 1.0);
                vec2 flow = length(aFlow) > 0.001 ? normalize(aFlow) : vec2(0.78, 0.38);
                vec2 crossFlow = vec2(-flow.y, flow.x);
                float phaseA = dot(worldBase.xz, flow) * 0.065 + uTime * uWaveSpeed;
                float phaseB = dot(worldBase.xz, crossFlow) * 0.041 + uTime * uWaveSpeed * 0.73;
                float waveA = sin(phaseA);
                float waveB = sin(phaseB);
                float wave = waveA * 0.65 + waveB * 0.35;
                float waveMask = smoothstep(0.38, 0.82, aCoverage);
                transformedPosition.y -= (wave * 0.5 + 0.5) * uWaveAmplitude * waveMask;
                vec2 waveGradient = (
                    flow * cos(phaseA) * 0.065 * 0.65
                    + crossFlow * cos(phaseB) * 0.041 * 0.35
                ) * uWaveAmplitude * waveMask;

                vec4 worldPosition = modelMatrix * vec4(transformedPosition, 1.0);
                vec4 mvPosition = viewMatrix * worldPosition;
                gl_Position = projectionMatrix * mvPosition;

                #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
                    #pragma unroll_loop_start
                    for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
                        vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * worldPosition;
                    }
                    #pragma unroll_loop_end
                #endif

                vDepth = aDepth;
                vCoverage = aCoverage;
                vFoam = 1.0 - smoothstep(0.16, 0.78, aCoverage);
                vWorldXZ = worldPosition.xz;
                vWorldPosition = worldPosition.xyz;
                vWaterNormal = normalize(vec3(waveGradient.x, 1.0, waveGradient.y));
                vRipple = sin(worldPosition.x * 0.18 + worldPosition.z * 0.11) * 0.025
                    + sin(worldPosition.x * -0.07 + worldPosition.z * 0.21) * 0.018;
                vEdgeNoise = (
                    sin(worldPosition.x * 0.37 + worldPosition.z * 0.19 + uTime * 0.22)
                    + sin(worldPosition.x * -0.23 + worldPosition.z * 0.31 - uTime * 0.17)
                ) * 0.5;

                #include <fog_vertex>
            }
        `,
        fragmentShader: `
            uniform vec3 uShallowColor;
            uniform vec3 uDeepColor;
            uniform vec3 uFoamColor;
            uniform float uShallowAlpha;
            uniform float uDeepAlpha;
            uniform vec3 uSunDirection;
            uniform vec3 uMoonDirection;
            uniform vec3 uSunColor;
            uniform vec3 uMoonColor;
            uniform vec3 uSkyColor;
            uniform float uSunIntensity;
            uniform float uMoonIntensity;
            uniform float uAmbientIntensity;
            uniform float uLightLevel;
            uniform float uHorizonWarmth;
            uniform float uSkyReflectionStrength;
            uniform float uSunSpecularStrength;
            uniform float uMoonSpecularStrength;
            uniform float uFoamStrength;
            uniform float uDepthContrast;
            uniform float uSurfaceShadowStrength;
            uniform float uSurfaceShadowAlphaBoost;

            varying float vDepth;
            varying float vCoverage;
            varying float vFoam;
            varying vec2 vWorldXZ;
            varying vec3 vWorldPosition;
            varying vec3 vWaterNormal;
            varying float vRipple;
            varying float vEdgeNoise;

            #include <packing>
            #include <shadowmap_pars_fragment>
            #include <fog_pars_fragment>

            float getWaterSurfaceShadow() {
                float shadowMask = 1.0;

                #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
                    #pragma unroll_loop_start
                    for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
                        shadowMask *= getShadow(
                            directionalShadowMap[ i ],
                            directionalLightShadows[ i ].shadowMapSize,
                            directionalLightShadows[ i ].shadowBias,
                            directionalLightShadows[ i ].shadowRadius,
                            vDirectionalShadowCoord[ i ]
                        );
                    }
                    #pragma unroll_loop_end
                #endif

                return shadowMask;
            }

            void main() {
                float depthFactor = pow(smoothstep(0.15, 4.8, vDepth), uDepthContrast);
                float noisyCoverage = clamp(
                    vCoverage + vEdgeNoise * 0.075 * (1.0 - smoothstep(0.28, 0.95, vCoverage)),
                    0.0,
                    1.0
                );
                vec3 microNormal = vec3(
                    vEdgeNoise * 0.035,
                    0.0,
                    -vEdgeNoise * 0.028
                );
                vec3 normal = normalize(vWaterNormal + microNormal);
                vec3 viewDir = normalize(cameraPosition - vWorldPosition);
                vec3 sunDir = normalize(uSunDirection);
                vec3 moonDir = normalize(uMoonDirection);
                float sunFacing = max(dot(normal, sunDir), 0.0);
                float moonFacing = max(dot(normal, moonDir), 0.0);
                float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 3.0);
                float sunSpec = pow(max(dot(normal, normalize(sunDir + viewDir)), 0.0), 112.0)
                    * uSunIntensity * smoothstep(0.20, 0.85, noisyCoverage);
                float moonSpec = pow(max(dot(normal, normalize(moonDir + viewDir)), 0.0), 86.0)
                    * uMoonIntensity * smoothstep(0.25, 0.9, noisyCoverage);
                float broadSun = pow(max(dot(reflect(-sunDir, normal), viewDir), 0.0), 18.0)
                    * uSunIntensity * smoothstep(0.35, 1.0, noisyCoverage);
                vec3 baseColor = mix(uShallowColor, uDeepColor, depthFactor);
                baseColor += vRipple;
                vec3 ambientWater = baseColor * (0.42 + uLightLevel * 0.55);
                vec3 directWater = baseColor * (
                    sunFacing * uSunIntensity * 0.28
                    + moonFacing * uMoonIntensity * 0.18
                    + uAmbientIntensity * 0.12
                );
                vec3 skyReflection = mix(uSkyColor, uSunColor, clamp(sunSpec * 0.18 + uHorizonWarmth * 0.18, 0.0, 0.45));
                vec3 waterColor = ambientWater + directWater;
                waterColor = mix(waterColor, skyReflection, fresnel * uSkyReflectionStrength);
                waterColor += uSunColor * (sunSpec * uSunSpecularStrength + broadSun * 0.22);
                waterColor += uMoonColor * moonSpec * uMoonSpecularStrength;
                float surfaceShadow = getWaterSurfaceShadow();
                float shadowVisibility = smoothstep(0.04, 0.36, noisyCoverage) * smoothstep(0.025, 0.55, vDepth);
                float surfaceShadowAmount = (1.0 - surfaceShadow) * shadowVisibility;
                waterColor *= 1.0 - uSurfaceShadowStrength * surfaceShadowAmount;
                float foamMask = vFoam * (0.72 + vEdgeNoise * 0.16) * smoothstep(0.03, 0.44, noisyCoverage);
                waterColor = mix(waterColor, uFoamColor, foamMask * uFoamStrength);
                float edgeFade = smoothstep(0.001, 0.34, noisyCoverage) * smoothstep(0.001, 0.22, vDepth);
                float alpha = mix(uShallowAlpha, uDeepAlpha, depthFactor) * edgeFade;
                alpha = max(alpha, surfaceShadowAmount * uSurfaceShadowAlphaBoost);

                gl_FragColor = vec4(waterColor, alpha);

                #include <fog_fragment>
            }
        `,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        fog: true,
        lights: true,
        toneMapped: true
    });
}

function createChunkWaterGeometry(cx, cz, getTerrainSample) {
    const step = Math.max(2, WATER_CONFIG.passoMalha ?? 4);
    const { startX, startZ, endX, endZ } = getChunkBounds(cx, cz, CHUNK_SIZE, WORLD_MIN, WORLD_MAX);
    if (startX >= endX || startZ >= endZ) return null;

    const width = endX - startX;
    const depth = endZ - startZ;
    const widthSegments = Math.max(1, Math.round(width / step));
    const depthSegments = Math.max(1, Math.round(depth / step));
    const stepX = width / widthSegments;
    const stepZ = depth / depthSegments;
    const positions = [];
    const waterDepths = [];
    const coverages = [];
    const flows = [];
    const hasWater = [];
    const indices = [];
    const vertexIndices = [];
    let waterVertexCount = 0;

    function pushVertex(row, column) {
        const x = startX + column * stepX;
        const z = startZ + row * stepZ;
        const sample = getTerrainSample(x, z);
        const water = sample.water;
        const coverage = water?.coverage ?? 0;
        const depthValue = water ? Math.max(0, water.surfaceY - sample.height) : 0;
        const edgeWater = coverage > 0.001 && depthValue > 0.001;
        const surfaceY = (water?.surfaceY ?? WATER_SURFACE_Y) + WATER_RENDER_OFFSET;
        const index = positions.length / 3;

        positions.push(x, surfaceY, z);
        waterDepths.push(depthValue);
        coverages.push(coverage);
        flows.push(water?.flowX ?? 0, water?.flowZ ?? 0);
        hasWater.push(edgeWater);
        return index;
    }

    for (let row = 0; row <= depthSegments; row++) {
        vertexIndices[row] = [];
        for (let column = 0; column <= widthSegments; column++) {
            vertexIndices[row][column] = pushVertex(row, column);
        }
    }

    function expandEdgeWater() {
        for (let pass = 0; pass < WATER_EDGE_EXPAND_STEPS; pass++) {
            const expanded = hasWater.slice();

            for (let row = 0; row <= depthSegments; row++) {
                for (let column = 0; column <= widthSegments; column++) {
                    const index = vertexIndices[row][column];
                    if (hasWater[index]) continue;

                    let touchesWater = false;
                    let flowX = 0;
                    let flowZ = 0;
                    let flowCount = 0;

                    for (let dz = -1; dz <= 1 && !touchesWater; dz++) {
                        const nr = row + dz;
                        if (nr < 0 || nr > depthSegments) continue;

                        for (let dx = -1; dx <= 1; dx++) {
                            if (dx === 0 && dz === 0) continue;
                            const nc = column + dx;
                            if (nc < 0 || nc > widthSegments) continue;
                            const neighbor = vertexIndices[nr][nc];
                            if (!hasWater[neighbor]) continue;

                            touchesWater = true;
                            flowX += flows[neighbor * 2];
                            flowZ += flows[neighbor * 2 + 1];
                            flowCount++;
                        }
                    }

                    if (!touchesWater) continue;

                    expanded[index] = true;
                    coverages[index] = Math.max(coverages[index], WATER_EDGE_COVERAGE);
                    waterDepths[index] = Math.max(waterDepths[index], WATER_EDGE_DEPTH);
                    if (flowCount > 0) {
                        flows[index * 2] = flowX / flowCount;
                        flows[index * 2 + 1] = flowZ / flowCount;
                    }
                }
            }

            for (let i = 0; i < expanded.length; i++) {
                hasWater[i] = expanded[i];
            }
        }

        waterVertexCount = hasWater.reduce((count, item) => count + (item ? 1 : 0), 0);
    }

    expandEdgeWater();

    for (let row = 0; row < depthSegments; row++) {
        for (let column = 0; column < widthSegments; column++) {
            const a = vertexIndices[row][column];
            const b = vertexIndices[row][column + 1];
            const c = vertexIndices[row + 1][column];
            const d = vertexIndices[row + 1][column + 1];

            if (hasWater[a] || hasWater[c] || hasWater[b]) {
                indices.push(a, c, b);
            }
            if (hasWater[b] || hasWater[c] || hasWater[d]) {
                indices.push(b, c, d);
            }
        }
    }

    if (waterVertexCount === 0 || indices.length === 0) return null;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('aDepth', new THREE.BufferAttribute(new Float32Array(waterDepths), 1));
    geometry.setAttribute('aCoverage', new THREE.BufferAttribute(new Float32Array(coverages), 1));
    geometry.setAttribute('aFlow', new THREE.BufferAttribute(new Float32Array(flows), 2));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    return geometry;
}

export function createWater(scene, getTerrainSample, diagnostics, options = {}) {
    const getChunkGroup = options.getChunkGroup ?? (() => null);
    const getLightingState = options.getLightingState ?? (() => null);
    const material = createWaterMaterial();
    const activeChunks = new Map();
    const queuedChunkKeys = new Set();
    const emptyChunkKeys = new Set();
    let buildQueue = [];
    let elapsed = 0;
    let refreshTimer = 0;
    let lastFocusSignature = '';
    let lastLightingVersion = -1;

    if (WATER_CONFIG.ativa === false) {
        return {
            updateForPlayers() {},
            disposeChunk() {},
            dispose() {}
        };
    }

    function getFocuses(playerPositions) {
        const seen = new Set();
        const focuses = [];
        for (const position of playerPositions) {
            const chunkX = Math.floor(position.x / CHUNK_SIZE);
            const chunkZ = Math.floor(position.z / CHUNK_SIZE);
            const key = `${chunkX},${chunkZ}`;
            if (seen.has(key)) continue;
            seen.add(key);
            focuses.push({ chunkX, chunkZ });
        }
        return focuses;
    }

    function getFocusSignature(focuses) {
        return focuses.map((focus) => `${focus.chunkX},${focus.chunkZ}`).join('|');
    }

    function getClosestDistance(cx, cz, focuses) {
        let closest = Infinity;
        for (const focus of focuses) {
            closest = Math.min(closest, Math.max(Math.abs(cx - focus.chunkX), Math.abs(cz - focus.chunkZ)));
        }
        return closest;
    }

    function queueChunk(cx, cz, priority) {
        const key = getChunkKey(cx, cz);
        if (activeChunks.has(key) || queuedChunkKeys.has(key) || emptyChunkKeys.has(key)) return;
        if (!getChunkGroup(cx, cz)) return;
        buildQueue.push({ cx, cz, key, priority });
        queuedChunkKeys.add(key);
    }

    function refreshQueue(focuses) {
        const maxDistance = WATER_CONFIG.distanciaChunks ?? CONFIG.terreno.distanciaChunks;
        const desiredKeys = new Set();

        for (const focus of focuses) {
            for (let dz = -maxDistance; dz <= maxDistance; dz++) {
                for (let dx = -maxDistance; dx <= maxDistance; dx++) {
                    const cx = focus.chunkX + dx;
                    const cz = focus.chunkZ + dz;
                    const distance = Math.max(Math.abs(dx), Math.abs(dz));
                    const key = getChunkKey(cx, cz);
                    desiredKeys.add(key);
                    queueChunk(cx, cz, distance);
                }
            }
        }

        for (const [key, mesh] of [...activeChunks]) {
            const coords = key.split(',').map(Number);
            const distance = getClosestDistance(coords[0], coords[1], focuses);
            if (distance <= maxDistance) continue;
            mesh.parent?.remove(mesh);
            mesh.geometry.dispose();
            activeChunks.delete(key);
        }

        buildQueue = buildQueue.filter((item) => {
            const wanted = desiredKeys.has(item.key) && getChunkGroup(item.cx, item.cz);
            if (!wanted) queuedChunkKeys.delete(item.key);
            return wanted;
        });
        buildQueue.sort((a, b) => a.priority - b.priority);
        diagnostics?.setCounter('waterQueue', buildQueue.length);
        diagnostics?.setCounter('waterChunks', activeChunks.size);
    }

    function buildChunk(item) {
        const chunkGroup = getChunkGroup(item.cx, item.cz);
        if (!chunkGroup || chunkGroup.userData.disposed) return false;

        const geometry = createChunkWaterGeometry(item.cx, item.cz, getTerrainSample);
        if (!geometry) {
            rememberLimitedSetValue(emptyChunkKeys, item.key, EMPTY_WATER_CHUNK_CACHE_LIMIT);
            return false;
        }

        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = `water-${item.key}`;
        mesh.frustumCulled = true;
        mesh.renderOrder = 2;
        mesh.castShadow = false;
        mesh.receiveShadow = true;

        chunkGroup.add(mesh);
        activeChunks.set(item.key, mesh);
        return true;
    }

    function processQueue() {
        const chunksPerFrame = WATER_CONFIG.chunksPorFrame ?? 2;
        let built = 0;
        while (buildQueue.length > 0 && built < chunksPerFrame) {
            const item = buildQueue.shift();
            queuedChunkKeys.delete(item.key);
            if (activeChunks.has(item.key) || emptyChunkKeys.has(item.key)) continue;
            if (buildChunk(item)) built++;
        }
        diagnostics?.setCounter('waterQueue', buildQueue.length);
        diagnostics?.setCounter('waterChunks', activeChunks.size);
    }

    function updateLightingUniforms() {
        const lighting = getLightingState?.();
        if (!lighting) return;
        if (lighting.version === lastLightingVersion) return;
        lastLightingVersion = lighting.version;

        const uniforms = material.uniforms;
        uniforms.uSunDirection.value.copy(lighting.sunDirection);
        uniforms.uMoonDirection.value.copy(lighting.moonDirection);
        uniforms.uSunColor.value.copy(lighting.sunColor);
        uniforms.uMoonColor.value.copy(lighting.moonColor);
        uniforms.uSkyColor.value.copy(lighting.skyColor);
        uniforms.uSunIntensity.value = lighting.sunIntensity;
        uniforms.uMoonIntensity.value = lighting.moonIntensity;
        uniforms.uAmbientIntensity.value = lighting.skyIntensity;
        uniforms.uLightLevel.value = lighting.lightLevel;
        uniforms.uHorizonWarmth.value = lighting.horizonWarmth;
    }

    function updateForPlayers(deltaSeconds, playerPositions) {
        elapsed += deltaSeconds;
        refreshTimer += deltaSeconds * 1000;
        material.uniforms.uTime.value = elapsed;
        updateLightingUniforms();

        const focuses = getFocuses(playerPositions);
        if (!focuses.length) return;

        const signature = getFocusSignature(focuses);
        if (signature !== lastFocusSignature || refreshTimer >= (WATER_CONFIG.intervaloAtualizacaoMs ?? 350)) {
            lastFocusSignature = signature;
            refreshTimer = 0;
            refreshQueue(focuses);
        }
        processQueue();
    }

    function setVisibilityForFocus(position) {
        const maxDistance = WATER_CONFIG.distanciaChunks ?? CONFIG.terreno.distanciaChunks;
        const focusChunkX = Math.floor(position.x / CHUNK_SIZE);
        const focusChunkZ = Math.floor(position.z / CHUNK_SIZE);

        for (const [key, mesh] of activeChunks) {
            const [cx, cz] = key.split(',').map(Number);
            const distance = Math.max(Math.abs(cx - focusChunkX), Math.abs(cz - focusChunkZ));
            mesh.visible = distance <= maxDistance;
        }
    }

    function restoreVisibility() {
        for (const mesh of activeChunks.values()) {
            mesh.visible = true;
        }
    }

    function disposeChunk(chunk) {
        const key = getChunkKey(chunk.cx, chunk.cz);
        const mesh = activeChunks.get(key);
        if (mesh) {
            mesh.parent?.remove(mesh);
            mesh.geometry.dispose();
            activeChunks.delete(key);
        }
        queuedChunkKeys.delete(key);
        buildQueue = buildQueue.filter((item) => item.key !== key);
    }

    function dispose() {
        for (const mesh of activeChunks.values()) {
            mesh.parent?.remove(mesh);
            scene.remove(mesh);
            mesh.geometry.dispose();
        }
        activeChunks.clear();
        buildQueue = [];
        queuedChunkKeys.clear();
        material.dispose();
    }

    return { updateForPlayers, setVisibilityForFocus, restoreVisibility, disposeChunk, dispose };
}
