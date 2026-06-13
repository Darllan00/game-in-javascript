import * as THREE from 'three';
import { CONFIG } from './config.js';
import { getChunkBounds, getChunkKey } from './chunks.js';

const CHUNK_SIZE = CONFIG.terreno.tamanhoChunk;
const WORLD_MIN = -CONFIG.terreno.tamanhoGrade / 2;
const WORLD_MAX = CONFIG.terreno.tamanhoGrade / 2;
const WATER_CONFIG = CONFIG.agua ?? {};
const WATER_RENDER_OFFSET = Math.min(WATER_CONFIG.elevacaoSuperficie ?? -0.08, -0.01);
const MIN_RENDERABLE_WATER_DEPTH = Math.max(0.035, Math.abs(WATER_RENDER_OFFSET) + 0.03);
const EMPTY_WATER_CHUNK_CACHE_LIMIT = 4096;

function rememberLimitedSetValue(set, value, limit) {
    set.delete(value);
    set.add(value);
    if (set.size > limit) {
        set.delete(set.values().next().value);
    }
}

function createWaterMaterial() {
    const materialConfig = WATER_CONFIG.material ?? {};
    return new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.merge([
            THREE.UniformsLib.fog,
            {
                uTime: { value: 0 },
                uWaveSpeed: { value: materialConfig.velocidadeOnda ?? 0.72 },
                uWaveAmplitude: { value: materialConfig.amplitudeOnda ?? 0.055 },
                uShallowAlpha: { value: materialConfig.transparenciaRasa ?? 0.42 },
                uDeepAlpha: { value: materialConfig.transparenciaFunda ?? 0.78 },
                uShallowColor: { value: new THREE.Color(0x6fc7d8) },
                uDeepColor: { value: new THREE.Color(0x146286) },
                uFoamColor: { value: new THREE.Color(0xd8f4ed) }
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

            #include <fog_pars_vertex>

            void main() {
                vec3 transformedPosition = position;
                vec4 worldBase = modelMatrix * vec4(position, 1.0);
                vec2 flow = length(aFlow) > 0.001 ? normalize(aFlow) : vec2(0.78, 0.38);
                float waveA = sin(dot(worldBase.xz, flow) * 0.065 + uTime * uWaveSpeed);
                float waveB = sin(dot(worldBase.xz, vec2(-flow.y, flow.x)) * 0.041 + uTime * uWaveSpeed * 0.73);
                float wave = waveA * 0.65 + waveB * 0.35;
                float waveMask = smoothstep(0.0, 0.35, aCoverage);
                transformedPosition.y -= (wave * 0.5 + 0.5) * uWaveAmplitude * waveMask;

                vec4 worldPosition = modelMatrix * vec4(transformedPosition, 1.0);
                vec4 mvPosition = viewMatrix * worldPosition;
                gl_Position = projectionMatrix * mvPosition;

                vDepth = aDepth;
                vCoverage = aCoverage;
                vFoam = 1.0 - smoothstep(0.28, 0.78, aCoverage);
                vWorldXZ = worldPosition.xz;

                #include <fog_vertex>
            }
        `,
        fragmentShader: `
            uniform vec3 uShallowColor;
            uniform vec3 uDeepColor;
            uniform vec3 uFoamColor;
            uniform float uShallowAlpha;
            uniform float uDeepAlpha;

            varying float vDepth;
            varying float vCoverage;
            varying float vFoam;
            varying vec2 vWorldXZ;

            #include <fog_pars_fragment>

            void main() {
                float depthFactor = smoothstep(0.15, 3.8, vDepth);
                float ripple = sin(vWorldXZ.x * 0.18 + vWorldXZ.y * 0.11) * 0.025
                    + sin(vWorldXZ.x * -0.07 + vWorldXZ.y * 0.21) * 0.018;
                vec3 waterColor = mix(uShallowColor, uDeepColor, depthFactor);
                waterColor += ripple;
                waterColor = mix(waterColor, uFoamColor, vFoam * 0.42);
                float alpha = mix(uShallowAlpha, uDeepAlpha, depthFactor) * smoothstep(0.02, 0.38, vCoverage);

                gl_FragColor = vec4(waterColor, alpha);

                #include <fog_fragment>
            }
        `,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        fog: true,
        toneMapped: false
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
    const hasRenderableWater = [];
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
        const renderableWater = coverage > 0.02 && depthValue > MIN_RENDERABLE_WATER_DEPTH;
        const surfaceY = renderableWater
            ? water.surfaceY + WATER_RENDER_OFFSET
            : sample.height;
        const index = positions.length / 3;

        positions.push(x, surfaceY, z);
        waterDepths.push(depthValue);
        coverages.push(coverage);
        flows.push(water?.flowX ?? 0, water?.flowZ ?? 0);
        hasRenderableWater.push(renderableWater);
        if (renderableWater) waterVertexCount++;
        return index;
    }

    for (let row = 0; row <= depthSegments; row++) {
        vertexIndices[row] = [];
        for (let column = 0; column <= widthSegments; column++) {
            vertexIndices[row][column] = pushVertex(row, column);
        }
    }

    for (let row = 0; row < depthSegments; row++) {
        for (let column = 0; column < widthSegments; column++) {
            const a = vertexIndices[row][column];
            const b = vertexIndices[row][column + 1];
            const c = vertexIndices[row + 1][column];
            const d = vertexIndices[row + 1][column + 1];
            if (hasRenderableWater[a] && hasRenderableWater[c] && hasRenderableWater[b]) {
                indices.push(a, c, b);
            }
            if (hasRenderableWater[b] && hasRenderableWater[c] && hasRenderableWater[d]) {
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
    const material = createWaterMaterial();
    const activeChunks = new Map();
    const queuedChunkKeys = new Set();
    const emptyChunkKeys = new Set();
    let buildQueue = [];
    let elapsed = 0;
    let refreshTimer = 0;
    let lastFocusSignature = '';

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
        mesh.receiveShadow = false;
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

    function updateForPlayers(deltaSeconds, playerPositions) {
        elapsed += deltaSeconds;
        refreshTimer += deltaSeconds * 1000;
        material.uniforms.uTime.value = elapsed;

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

    return { updateForPlayers, disposeChunk, dispose };
}
