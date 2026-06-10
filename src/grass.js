import * as THREE from 'three';
import { CONFIG } from './config.js';
import { getChunkKey } from './chunks.js';

const CHUNK_SIZE = CONFIG.terreno.tamanhoChunk;
const WORLD_MIN = -CONFIG.terreno.tamanhoGrade / 2;
const WORLD_MAX = CONFIG.terreno.tamanhoGrade / 2;
const lightColor = new THREE.Color();
const windDirection = new THREE.Vector2(CONFIG.vento.direcaoX, CONFIG.vento.direcaoZ).normalize();
const SNOW_GRASS_CUTOFF = 33.5;
const ROCK_GRASS_CUTOFF = 0.48;

function clamp01(value) {
    return THREE.MathUtils.clamp(value, 0, 1);
}

function smoothstep(edge0, edge1, value) {
    const t = clamp01((value - edge0) / (edge1 - edge0));
    return t * t * (3 - 2 * t);
}

function hash01(x, z, salt = 0) {
    const value = Math.sin(x * 127.1 + z * 311.7 + salt * 74.7) * 43758.5453123;
    return value - Math.floor(value);
}

function isInsideWorld(cx, cz) {
    const startX = cx * CHUNK_SIZE;
    const startZ = cz * CHUNK_SIZE;
    return startX < WORLD_MAX
        && startZ < WORLD_MAX
        && startX + CHUNK_SIZE > WORLD_MIN
        && startZ + CHUNK_SIZE > WORLD_MIN;
}

function canPlaceGrass(sample, terrainHeight) {
    if (terrainHeight < CONFIG.terreno.nivelDoMar + 0.04) return false;
    if (terrainHeight > Math.min(CONFIG.grama.alturaMaximaTerreno, SNOW_GRASS_CUTOFF)) return false;
    return sample.weights.mountains < ROCK_GRASS_CUTOFF;
}

function getGrassDryness(sample, seed) {
    const slopeYellow = smoothstep(0.24, 0.72, sample.weights.slopes);
    const moistureYellow = smoothstep(0.52, 0.22, sample.moisture);
    const warmYellow = smoothstep(0.58, 0.86, sample.temperature) * 0.35;
    return clamp01(Math.max(slopeYellow, moistureYellow) + warmYellow + seed * 0.08);
}

function createGrassMaterial({ animated }) {
    return new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.merge([
            THREE.UniformsLib.fog,
            {
                uTime: { value: 0 },
                uWindDirection: { value: windDirection },
                uWindStrength: { value: animated ? CONFIG.vento.forca : 0 },
                uWindSpeed: { value: CONFIG.vento.velocidade },
                uWindFrequency: { value: CONFIG.vento.frequencia },
                uLightLevel: { value: 1 },
                uBaseColor: { value: new THREE.Color(0x143f12) },
                uTipColor: { value: new THREE.Color(0x87a63c) },
                uDryBaseColor: { value: new THREE.Color(0x4d4a19) },
                uDryTipColor: { value: new THREE.Color(0x9b8f3a) }
            }
        ]),
        vertexShader: `
            uniform float uTime;
            uniform vec2 uWindDirection;
            uniform float uWindStrength;
            uniform float uWindSpeed;
            uniform float uWindFrequency;

            attribute vec3 aOffset;
            attribute vec3 aBlade;
            attribute float aAngle;
            attribute float aDryness;

            varying float vHeight;
            varying float vDryness;

            #include <fog_pars_vertex>

            void main() {
                float heightPercent = position.y;
                float bladeHeight = aBlade.x;
                float bladeWidth = aBlade.y;
                float restingLean = aBlade.z;
                vec2 bladeRight = vec2(cos(aAngle), sin(aAngle));
                vec2 windDir = normalize(uWindDirection);
                vec2 worldBaseXZ = (modelMatrix * vec4(aOffset, 1.0)).xz;

                float taperedWidth = bladeWidth * (1.0 - heightPercent * 0.82);
                vec3 bladePosition = vec3(
                    bladeRight.x * position.x * taperedWidth,
                    heightPercent * bladeHeight,
                    bladeRight.y * position.x * taperedWidth
                );

                float wave = sin(dot(worldBaseXZ, windDir) * uWindFrequency + uTime * uWindSpeed);
                float crossWave = sin(dot(worldBaseXZ, vec2(-windDir.y, windDir.x)) * uWindFrequency * 0.55 + uTime * uWindSpeed * 0.48);
                float gust = 0.72 + 0.18 * crossWave;
                float bend = (wave * uWindStrength * gust + restingLean * 0.08) * heightPercent * heightPercent;

                bladePosition.xz += windDir * bend * bladeHeight;

                vec4 worldPosition = modelMatrix * vec4(aOffset + bladePosition, 1.0);
                vec4 mvPosition = viewMatrix * worldPosition;
                gl_Position = projectionMatrix * mvPosition;

                vHeight = heightPercent;
                vDryness = aDryness;

                #include <fog_vertex>
            }
        `,
        fragmentShader: `
            uniform vec3 uBaseColor;
            uniform vec3 uTipColor;
            uniform vec3 uDryBaseColor;
            uniform vec3 uDryTipColor;
            uniform float uLightLevel;

            varying float vHeight;
            varying float vDryness;

            #include <fog_pars_fragment>

            void main() {
                float shapedHeight = pow(vHeight, 1.55);
                vec3 greenColor = mix(uBaseColor, uTipColor, shapedHeight);
                vec3 dryColor = mix(uDryBaseColor, uDryTipColor, shapedHeight);
                vec3 color = mix(greenColor, dryColor, vDryness);
                float ambientOcclusion = mix(0.58, 1.0, smoothstep(0.0, 0.9, vHeight));

                gl_FragColor = vec4(color * ambientOcclusion * uLightLevel, 1.0);

                #include <fog_fragment>
            }
        `,
        side: THREE.DoubleSide,
        fog: true
    });
}

function createFarGrassMaterial() {
    return new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.merge([
            THREE.UniformsLib.fog,
            {
                uLightLevel: { value: 1 },
                uBaseColor: { value: new THREE.Color(0x143f12) },
                uTipColor: { value: new THREE.Color(0x87a63c) },
                uDryBaseColor: { value: new THREE.Color(0x4d4a19) },
                uDryTipColor: { value: new THREE.Color(0x9b8f3a) }
            }
        ]),
        vertexShader: `
            attribute float aDryness;
            attribute float aSize;

            varying float vDryness;

            #include <fog_pars_vertex>

            void main() {
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                gl_Position = projectionMatrix * mvPosition;
                gl_PointSize = clamp(aSize * (260.0 / max(40.0, -mvPosition.z)), 1.0, aSize);

                vDryness = aDryness;

                #include <fog_vertex>
            }
        `,
        fragmentShader: `
            uniform vec3 uBaseColor;
            uniform vec3 uTipColor;
            uniform vec3 uDryBaseColor;
            uniform vec3 uDryTipColor;
            uniform float uLightLevel;

            varying float vDryness;

            #include <fog_pars_fragment>

            void main() {
                vec2 centeredUv = gl_PointCoord - vec2(0.5);
                float mask = 1.0 - smoothstep(0.18, 0.5, length(centeredUv));
                if (mask <= 0.02) discard;

                float heightTint = smoothstep(0.1, 0.9, gl_PointCoord.y);
                vec3 greenColor = mix(uBaseColor, uTipColor, heightTint);
                vec3 dryColor = mix(uDryBaseColor, uDryTipColor, heightTint);
                vec3 color = mix(greenColor, dryColor, vDryness);

                gl_FragColor = vec4(color * uLightLevel, mask);

                #include <fog_fragment>
            }
        `,
        transparent: true,
        depthWrite: true,
        fog: true
    });
}

function createBladeShape(segmentCount) {
    const vertices = [];
    const indices = [];

    for (let segment = 0; segment <= segmentCount; segment++) {
        const t = segment / segmentCount;
        vertices.push(-0.5, t, 0, 0.5, t, 0);
    }

    for (let segment = 0; segment < segmentCount; segment++) {
        const base = segment * 2;
        indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }

    return {
        vertices: new Float32Array(vertices),
        indices
    };
}

function createFarGrassTileGeometry(cx, cz, getHeight, getTerrainSample, profile) {
    const startX = cx * CHUNK_SIZE;
    const startZ = cz * CHUNK_SIZE;
    const positions = [];
    const dryness = [];
    const sizes = [];
    let minTileY = Infinity;
    let maxTileY = -Infinity;

    for (let i = 0; i < profile.tufosPorChunk; i++) {
        const rx = hash01(cx, cz, i);
        const rz = hash01(cz, cx, i + 19);
        const worldX = startX + rx * CHUNK_SIZE;
        const worldZ = startZ + rz * CHUNK_SIZE;
        const terrainHeight = getHeight(worldX, worldZ);
        const terrainSample = getTerrainSample(worldX, worldZ);
        if (!canPlaceGrass(terrainSample, terrainHeight)) continue;

        const sizeSeed = hash01(worldX, worldZ, i + 63);
        const drySeed = hash01(worldX, worldZ, i + 117);
        const size = THREE.MathUtils.lerp(profile.larguraMin, profile.larguraMax, sizeSeed);
        const height = THREE.MathUtils.lerp(profile.alturaMin, profile.alturaMax, sizeSeed);

        positions.push(worldX - startX, terrainHeight + height * 0.5, worldZ - startZ);
        dryness.push(getGrassDryness(terrainSample, drySeed));
        sizes.push(size);
        minTileY = Math.min(minTileY, terrainHeight);
        maxTileY = Math.max(maxTileY, terrainHeight + height);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('aDryness', new THREE.BufferAttribute(new Float32Array(dryness), 1));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(sizes), 1));

    const centerY = Number.isFinite(minTileY) ? (minTileY + maxTileY) * 0.5 : 0;
    const verticalRadius = Number.isFinite(minTileY) ? (maxTileY - minTileY) * 0.5 : 1;
    geometry.boundingSphere = new THREE.Sphere(
        new THREE.Vector3(CHUNK_SIZE * 0.5, centerY, CHUNK_SIZE * 0.5),
        Math.sqrt(CHUNK_SIZE * CHUNK_SIZE * 0.5 + verticalRadius * verticalRadius) + profile.larguraMax
    );

    return geometry;
}

function createGrassTileGeometry(cx, cz, getHeight, getTerrainSample, profile) {
    const shape = createBladeShape(profile.segmentos);
    const startX = cx * CHUNK_SIZE;
    const startZ = cz * CHUNK_SIZE;
    const offsets = [];
    const blades = [];
    const angles = [];
    const dryness = [];
    let minTileY = Infinity;
    let maxTileY = -Infinity;

    for (let i = 0; i < profile.tufosPorChunk; i++) {
        const rx = hash01(cx, cz, i);
        const rz = hash01(cz, cx, i + 19);
        const worldX = startX + rx * CHUNK_SIZE;
        const worldZ = startZ + rz * CHUNK_SIZE;
        const terrainHeight = getHeight(worldX, worldZ);
        const terrainSample = getTerrainSample(worldX, worldZ);
        if (!canPlaceGrass(terrainSample, terrainHeight)) continue;

        const scaleSeed = hash01(worldX, worldZ, i + 41);
        const widthSeed = hash01(worldZ, worldX, i + 63);
        const leanSeed = hash01(worldX, worldZ, i + 91) * 2 - 1;
        const drySeed = hash01(worldX, worldZ, i + 117);
        const bladeHeight = THREE.MathUtils.lerp(profile.alturaMin, profile.alturaMax, scaleSeed);
        const bladeWidth = THREE.MathUtils.lerp(profile.larguraMin, profile.larguraMax, widthSeed);

        offsets.push(worldX - startX, terrainHeight + 0.015, worldZ - startZ);
        blades.push(
            bladeHeight,
            bladeWidth,
            leanSeed
        );
        angles.push(hash01(worldX, worldZ, i + 151) * Math.PI * 2);
        dryness.push(getGrassDryness(terrainSample, drySeed));
        minTileY = Math.min(minTileY, terrainHeight);
        maxTileY = Math.max(maxTileY, terrainHeight + bladeHeight);
    }

    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(shape.vertices, 3));
    geometry.setIndex(shape.indices);
    geometry.setAttribute('aOffset', new THREE.InstancedBufferAttribute(new Float32Array(offsets), 3));
    geometry.setAttribute('aBlade', new THREE.InstancedBufferAttribute(new Float32Array(blades), 3));
    geometry.setAttribute('aAngle', new THREE.InstancedBufferAttribute(new Float32Array(angles), 1));
    geometry.setAttribute('aDryness', new THREE.InstancedBufferAttribute(new Float32Array(dryness), 1));
    geometry.instanceCount = offsets.length / 3;
    const centerY = Number.isFinite(minTileY) ? (minTileY + maxTileY) * 0.5 : 0;
    const verticalRadius = Number.isFinite(minTileY) ? (maxTileY - minTileY) * 0.5 : 1;
    geometry.boundingSphere = new THREE.Sphere(
        new THREE.Vector3(CHUNK_SIZE * 0.5, centerY, CHUNK_SIZE * 0.5),
        Math.sqrt(CHUNK_SIZE * CHUNK_SIZE * 0.5 + verticalRadius * verticalRadius) + profile.alturaMax
    );

    return geometry;
}

function createGrassTile(cx, cz, material, getHeight, getTerrainSample, profile) {
    const usePoints = profile.modo === 'points';
    const geometry = usePoints
        ? createFarGrassTileGeometry(cx, cz, getHeight, getTerrainSample, profile)
        : createGrassTileGeometry(cx, cz, getHeight, getTerrainSample, profile);
    const instanceCount = usePoints ? geometry.attributes.position.count : geometry.instanceCount;
    if (instanceCount === 0) {
        geometry.dispose();
        return null;
    }

    const mesh = usePoints
        ? new THREE.Points(geometry, material)
        : new THREE.Mesh(geometry, material);
    mesh.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);
    mesh.frustumCulled = true;
    return mesh;
}

function disposeTile(mesh) {
    mesh.geometry.dispose();
}

function createGrassProfiles() {
    const grassConfig = CONFIG.grama;
    const midConfig = grassConfig.intermediaria;
    const farConfig = grassConfig.distante;
    return {
        near: {
            tufosPorChunk: grassConfig.tufosPorChunk,
            segmentos: grassConfig.segmentos,
            alturaMin: grassConfig.alturaMin,
            alturaMax: grassConfig.alturaMax,
            larguraMin: grassConfig.larguraMin,
            larguraMax: grassConfig.larguraMax
        },
        mid: {
            tufosPorChunk: midConfig.tufosPorChunk,
            segmentos: midConfig.segmentos,
            alturaMin: midConfig.alturaMin,
            alturaMax: midConfig.alturaMax,
            larguraMin: midConfig.larguraMin,
            larguraMax: midConfig.larguraMax
        },
        far: {
            modo: farConfig.modo,
            tufosPorChunk: farConfig.tufosPorChunk,
            segmentos: farConfig.segmentos,
            alturaMin: farConfig.alturaMin,
            alturaMax: farConfig.alturaMax,
            larguraMin: farConfig.larguraMin,
            larguraMax: farConfig.larguraMax
        }
    };
}

function getGrassTileKey(type, cx, cz) {
    return `${type}:${getChunkKey(cx, cz)}`;
}

function getGrassTileCoordKey(cx, cz) {
    return getChunkKey(cx, cz);
}

function getGrassTileCoords(key) {
    const coords = key.slice(key.indexOf(':') + 1).split(',');
    return {
        cx: Number(coords[0]),
        cz: Number(coords[1])
    };
}

function getGrassQueueOrder(type) {
    if (type === 'near') return 0;
    if (type === 'mid') return 1;
    return 2;
}

export function createGrass(scene, getHeight, getTerrainSample, diagnostics, options = {}) {
    const grassConfig = CONFIG.grama;
    const profiles = createGrassProfiles();
    const activeTiles = new Map();
    const queuedTileKeys = new Set();
    const getChunkGroup = options.getChunkGroup ?? (() => null);
    let tileBuildQueue = [];
    let lastPlayerChunkX = null;
    let lastPlayerChunkZ = null;
    let lastFocusSignature = '';
    let lastRefreshSignature = '';
    let lastRefreshChunkX = null;
    let lastRefreshChunkZ = null;
    let currentRefreshDistance = 0;
    let movingRefreshTimer = 0;
    let stoppedTimer = 0;
    let stoppedRefreshTimer = 0;
    let stoppedQueueTimer = 0;
    let isUsingMovingRange = false;
    let elapsed = 0;

    if (!grassConfig.ativa) {
        return {
            update() {},
            updateForPlayers() {},
            setVisibilityForFocus() {},
            restoreVisibility() {},
            disposeChunk() {},
            dispose() {}
        };
    }

    const nearMaterial = createGrassMaterial({ animated: true });
    const midMaterial = createGrassMaterial({ animated: false });
    const farMaterial = CONFIG.grama.distante.modo === 'points'
        ? createFarGrassMaterial()
        : createGrassMaterial({ animated: false });

    function removeActiveTile(key) {
        const tile = activeTiles.get(key);
        if (!tile) return false;

        tile.parent?.remove(tile);
        scene.remove(tile);
        disposeTile(tile);
        activeTiles.delete(key);
        return true;
    }

    function attachTileToChunk(tile, cx, cz) {
        const chunkGroup = getChunkGroup(cx, cz);
        if (!chunkGroup) return false;

        chunkGroup.add(tile);
        return true;
    }

    function disposeChunk(chunk) {
        for (const [key] of [...activeTiles]) {
            const { cx, cz } = getGrassTileCoords(key);
            if (cx !== chunk.cx || cz !== chunk.cz) continue;
            removeActiveTile(key);
        }
    }

    function removeOtherActiveTileLods(type, cx, cz) {
        const desiredKey = getGrassTileKey(type, cx, cz);
        const coordKey = getGrassTileCoordKey(cx, cz);
        for (const [key] of [...activeTiles]) {
            if (key === desiredKey) continue;
            if (key.slice(key.indexOf(':') + 1) !== coordKey) continue;
            removeActiveTile(key);
        }
    }

    function queueTile(type, cx, cz, priority) {
        if (!isInsideWorld(cx, cz)) return;

        const key = getGrassTileKey(type, cx, cz);
        if (activeTiles.has(key) || queuedTileKeys.has(key)) return;

        tileBuildQueue.push({ cx, cz, key, type, priority });
        queuedTileKeys.add(key);
    }

    function getTileTypeForDistance(distance, nearDistance, midDistance, midConfig, farConfig) {
        if (distance <= nearDistance) return 'near';
        if (distance <= midDistance && midConfig.ativa) return 'mid';
        return farConfig.ativa ? 'far' : null;
    }

    function createGrassFocuses(playerPositions) {
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

    function getClosestDistanceToFocus(cx, cz, focuses) {
        let closestDistance = Infinity;
        for (const focus of focuses) {
            closestDistance = Math.min(
                closestDistance,
                Math.max(Math.abs(cx - focus.chunkX), Math.abs(cz - focus.chunkZ))
            );
        }
        return closestDistance;
    }

    function getGrassDistances() {
        const nearDistance = grassConfig.distanciaChunks;
        const midConfig = grassConfig.intermediaria;
        const midDistance = midConfig.ativa
            ? Math.max(midConfig.distanciaChunks, nearDistance)
            : nearDistance;
        const farConfig = grassConfig.distante;
        const farDistance = farConfig.ativa
            ? Math.max(farConfig.distanciaChunks, midDistance)
            : midDistance;
        return { nearDistance, midConfig, midDistance, farConfig, farDistance };
    }

    function getTileTypeForChunk(cx, cz, focuses) {
        const { nearDistance, midConfig, midDistance, farConfig } = getGrassDistances();
        const distance = getClosestDistanceToFocus(cx, cz, focuses);
        return {
            type: getTileTypeForDistance(distance, nearDistance, midDistance, midConfig, farConfig),
            distance
        };
    }

    function prioritizeTileQueueForFocuses(focuses, maxDistance) {
        const nextQueue = [];
        const nextQueuedKeys = new Set();

        for (const item of tileBuildQueue) {
            const { type, distance } = getTileTypeForChunk(item.cx, item.cz, focuses);
            if (distance > maxDistance) continue;
            if (!type) continue;

            const key = getGrassTileKey(type, item.cx, item.cz);
            if (activeTiles.has(key) || nextQueuedKeys.has(key)) continue;

            nextQueue.push({
                ...item,
                key,
                type,
                priority: distance
            });
            nextQueuedKeys.add(key);
        }

        tileBuildQueue = nextQueue.sort((a, b) => {
            const typeOrder = getGrassQueueOrder(a.type) - getGrassQueueOrder(b.type);
            return typeOrder || a.priority - b.priority;
        });

        queuedTileKeys.clear();
        for (const item of tileBuildQueue) {
            queuedTileKeys.add(item.key);
        }
    }

    function refreshTilesForFocuses(focuses, maxDistanceOverride = null, minDistanceOverride = 0) {
        const desiredKeys = new Set();
        const { farDistance } = getGrassDistances();
        const desiredDistance = maxDistanceOverride === null
            ? farDistance
            : Math.min(maxDistanceOverride, farDistance);
        isUsingMovingRange = maxDistanceOverride !== null;

        for (const focus of focuses) {
            for (let dx = -desiredDistance; dx <= desiredDistance; dx++) {
                for (let dz = -desiredDistance; dz <= desiredDistance; dz++) {
                    const cx = focus.chunkX + dx;
                    const cz = focus.chunkZ + dz;
                    const { type, distance } = getTileTypeForChunk(cx, cz, focuses);
                    if (distance < minDistanceOverride || distance > desiredDistance) continue;
                    if (!type) continue;

                    const key = getGrassTileKey(type, cx, cz);
                    desiredKeys.add(key);
                    queueTile(type, cx, cz, distance);
                }
            }
        }

        if (maxDistanceOverride === null) {
            for (const [key] of activeTiles) {
                if (desiredKeys.has(key)) continue;
                removeActiveTile(key);
            }
        }

        if (minDistanceOverride === 0) {
            tileBuildQueue = tileBuildQueue.filter((item) => desiredKeys.has(item.key));
        }
        prioritizeTileQueueForFocuses(focuses, desiredDistance);

        diagnostics?.setCounter('grassTiles', activeTiles.size);
        diagnostics?.setCounter('grassQueue', tileBuildQueue.length);
        diagnostics?.setCounter('grassRefreshDistance', desiredDistance);
    }

    function getFullRefreshDistance() {
        return Math.max(
            grassConfig.distanciaChunks,
            grassConfig.intermediaria?.ativa ? grassConfig.intermediaria.distanciaChunks : 0,
            grassConfig.distante?.ativa ? grassConfig.distante.distanciaChunks : 0
        );
    }

    function pruneTilesOutsideDistanceForFocuses(focuses, maxDistance) {
        let removed = 0;
        const maxRemovals = grassConfig.tilesRemovidosPorFrame ?? 16;
        for (const [key] of activeTiles) {
            if (removed >= maxRemovals) break;

            const { cx, cz } = getGrassTileCoords(key);
            const distance = getClosestDistanceToFocus(cx, cz, focuses);
            if (distance <= maxDistance) continue;

            removeActiveTile(key);
            removed++;
        }
    }

    function pruneTransitionTilesOutsideRangeForFocuses(focuses) {
        let removed = 0;
        const maxRemovals = grassConfig.tilesRemovidosPorFrame ?? 16;
        const { nearDistance, midDistance } = getGrassDistances();

        for (const [key] of activeTiles) {
            if (removed >= maxRemovals) break;
            const currentType = key.slice(0, key.indexOf(':'));
            if (currentType !== 'near' && currentType !== 'mid') continue;

            const { cx, cz } = getGrassTileCoords(key);
            const { type: replacementType, distance } = getTileTypeForChunk(cx, cz, focuses);
            const currentMaxDistance = currentType === 'near' ? nearDistance : midDistance;
            if (distance <= currentMaxDistance) continue;

            removeActiveTile(key);
            if (replacementType && replacementType !== currentType) {
                queueTile(replacementType, cx, cz, distance);
            }
            removed++;
        }
    }

    function processTileQueue(maxBuildsOverride = null) {
        const useMovingBudget = maxBuildsOverride !== null;
        let totalBuilt = 0;
        const midConfig = grassConfig.intermediaria;
        const farConfig = grassConfig.distante;

        function buildNextTileOfType(type) {
            const index = tileBuildQueue.findIndex((item) => item.type === type);
            if (index === -1) return false;
            return tileBuildQueue.splice(index, 1)[0];
        }

        function createQueuedTile(item) {
            queuedTileKeys.delete(item.key);
            if (activeTiles.has(item.key)) return false;
            if (!getChunkGroup(item.cx, item.cz)) return false;
            removeOtherActiveTileLods(item.type, item.cx, item.cz);

            const profile = profiles[item.type];
            const material = item.type === 'near'
                ? nearMaterial
                : item.type === 'mid'
                    ? midMaterial
                    : farMaterial;
            const tile = createGrassTile(item.cx, item.cz, material, getHeight, getTerrainSample, profile);
            if (!tile) return false;

            if (!attachTileToChunk(tile, item.cx, item.cz)) {
                disposeTile(tile);
                return false;
            }
            activeTiles.set(item.key, tile);
            return true;
        }

        function processType(type, budget) {
            let built = 0;
            let attempts = 0;
            const maxAttempts = Math.max(4, budget * 4);
            while (built < budget && attempts < maxAttempts) {
                if (maxBuildsOverride !== null && totalBuilt >= maxBuildsOverride) break;

                const item = buildNextTileOfType(type);
                if (!item) break;
                attempts++;
                if (!createQueuedTile(item)) continue;

                built++;
                totalBuilt++;
            }
        }

        processType('near', grassConfig.tilesPorFrame);
        processType('mid', midConfig.tilesPorFrame);
        if (!useMovingBudget) {
            processType('far', farConfig.tilesPorFrame);
        }

        diagnostics?.setCounter('grassTiles', activeTiles.size);
        diagnostics?.setCounter('grassQueue', tileBuildQueue.length);
    }

    function updateLightLevel() {
        if (scene.background?.isColor) {
            lightColor.copy(scene.background);
            const luminance = lightColor.r * 0.299 + lightColor.g * 0.587 + lightColor.b * 0.114;
            const lightLevel = THREE.MathUtils.clamp(luminance * 1.25, 0.18, 1.0);
            nearMaterial.uniforms.uLightLevel.value = lightLevel;
            midMaterial.uniforms.uLightLevel.value = lightLevel;
            farMaterial.uniforms.uLightLevel.value = lightLevel;
        }
    }

    function updateForPlayers(deltaSeconds, playerPositions, isPlayerMoving = false) {
        const shouldAnimateWind = !grassConfig.ventoApenasParado || !isPlayerMoving;
        if (shouldAnimateWind) {
            elapsed += deltaSeconds;
            const gust = 0.9 + Math.sin(elapsed * 0.21) * 0.08 + Math.sin(elapsed * 0.067) * 0.06;
            nearMaterial.uniforms.uTime.value = elapsed;
            nearMaterial.uniforms.uWindStrength.value = CONFIG.vento.forca * gust;
        }
        updateLightLevel();

        const focuses = createGrassFocuses(playerPositions);
        if (!focuses.length) return;

        const focusSignature = getFocusSignature(focuses);
        const primaryFocus = focuses[0];
        const canUpdateWhileMoving = grassConfig.atualizarEnquantoMovendo && grassConfig.tilesMovendoPorAtualizacao > 0;

        if (isPlayerMoving && !canUpdateWhileMoving) {
            diagnostics?.setCounter('grassPaused', 1);
            return;
        }

        if (isPlayerMoving) {
            stoppedTimer = 0;
            stoppedRefreshTimer = 0;
            stoppedQueueTimer = 0;
            movingRefreshTimer += deltaSeconds * 1000;
            const shouldRefreshMoving = focusSignature !== lastFocusSignature
                || movingRefreshTimer >= grassConfig.intervaloAtualizacaoMovendoMs;

            if (shouldRefreshMoving) {
                movingRefreshTimer = 0;
                lastFocusSignature = focusSignature;
                lastPlayerChunkX = primaryFocus.chunkX;
                lastPlayerChunkZ = primaryFocus.chunkZ;
                const movingDistance = Math.min(grassConfig.distanciaMovendoChunks, CONFIG.grama.intermediaria?.distanciaChunks ?? grassConfig.distanciaChunks);
                currentRefreshDistance = Math.max(currentRefreshDistance, movingDistance);
                refreshTilesForFocuses(focuses, movingDistance);
            }

            pruneTransitionTilesOutsideRangeForFocuses(focuses);
            prioritizeTileQueueForFocuses(focuses, Math.max(currentRefreshDistance, grassConfig.distanciaMovendoChunks));
            processTileQueue(grassConfig.tilesMovendoPorAtualizacao);
            diagnostics?.setCounter('grassPaused', 0);
            return;
        }

        stoppedTimer += deltaSeconds * 1000;
        stoppedRefreshTimer += deltaSeconds * 1000;
        stoppedQueueTimer += deltaSeconds * 1000;
        movingRefreshTimer = grassConfig.intervaloAtualizacaoMovendoMs;
        diagnostics?.setCounter('grassPaused', 0);

        if (
            focusSignature !== lastFocusSignature
            || isUsingMovingRange
            || focusSignature !== lastRefreshSignature
        ) {
            if (focusSignature !== lastRefreshSignature) {
                currentRefreshDistance = Math.min(currentRefreshDistance, grassConfig.distanciaMovendoChunks);
            }
            lastFocusSignature = focusSignature;
            lastRefreshSignature = focusSignature;
            lastPlayerChunkX = primaryFocus.chunkX;
            lastPlayerChunkZ = primaryFocus.chunkZ;
            lastRefreshChunkX = primaryFocus.chunkX;
            lastRefreshChunkZ = primaryFocus.chunkZ;
        }

        const fullRefreshDistance = getFullRefreshDistance();
        const canExpandStopped = stoppedTimer >= (grassConfig.recuperacaoAposMovimentoMs ?? 0)
            && stoppedRefreshTimer >= (grassConfig.intervaloAtualizacaoParadoMs ?? 0);
        if ((currentRefreshDistance < fullRefreshDistance || isUsingMovingRange) && canExpandStopped) {
            stoppedRefreshTimer = 0;
            const distanceStep = Math.max(1, grassConfig.chunksPorAtualizacaoParado ?? 1);
            const previousRefreshDistance = currentRefreshDistance;
            const minRefreshDistance = previousRefreshDistance > 0 ? previousRefreshDistance + 1 : 0;
            currentRefreshDistance = Math.min(fullRefreshDistance, currentRefreshDistance + distanceStep);
            refreshTilesForFocuses(focuses, currentRefreshDistance, minRefreshDistance);
            if (currentRefreshDistance >= fullRefreshDistance) {
                isUsingMovingRange = false;
            }
        }

        const stoppedUpdateInterval = grassConfig.intervaloAtualizacaoParadoMs ?? 0;
        const canProcessStoppedQueue = stoppedQueueTimer >= stoppedUpdateInterval;
        if (!canProcessStoppedQueue) return;

        stoppedQueueTimer = 0;
        pruneTransitionTilesOutsideRangeForFocuses(focuses);
        pruneTilesOutsideDistanceForFocuses(focuses, fullRefreshDistance);
        prioritizeTileQueueForFocuses(focuses, fullRefreshDistance);

        const isRecoveringAfterMovement = stoppedTimer < (grassConfig.recuperacaoAposMovimentoMs ?? 0);
        if (isRecoveringAfterMovement) {
            processTileQueue(grassConfig.tilesRecuperacaoParadoPorAtualizacao ?? grassConfig.tilesMovendoPorAtualizacao);
            return;
        }

        processTileQueue();
    }

    function update(deltaSeconds, playerX, playerZ, isPlayerMoving = false) {
        updateForPlayers(deltaSeconds, [{ x: playerX, z: playerZ }], isPlayerMoving);
    }

    function setVisibilityForFocus(position) {
        const focusChunkX = Math.floor(position.x / CHUNK_SIZE);
        const focusChunkZ = Math.floor(position.z / CHUNK_SIZE);
        const maxDistance = getFullRefreshDistance();

        for (const [key, tile] of activeTiles) {
            const { cx, cz } = getGrassTileCoords(key);
            const distance = Math.max(Math.abs(cx - focusChunkX), Math.abs(cz - focusChunkZ));
            tile.visible = distance <= maxDistance;
        }
    }

    function restoreVisibility() {
        for (const tile of activeTiles.values()) {
            tile.visible = true;
        }
    }

    function dispose() {
        for (const tile of activeTiles.values()) {
            tile.parent?.remove(tile);
            scene.remove(tile);
            disposeTile(tile);
        }
        activeTiles.clear();
        tileBuildQueue = [];
        queuedTileKeys.clear();
        nearMaterial.dispose();
        midMaterial.dispose();
        farMaterial.dispose();
    }

    return { update, updateForPlayers, setVisibilityForFocus, restoreVisibility, disposeChunk, dispose };
}
