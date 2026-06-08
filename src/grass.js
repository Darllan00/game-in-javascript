import * as THREE from 'three';
import { CONFIG } from './config.js';
import { getChunkKey } from './chunks.js';

const CHUNK_SIZE = CONFIG.terreno.tamanhoChunk;
const WORLD_MIN = -CONFIG.terreno.tamanhoGrade / 2;
const WORLD_MAX = CONFIG.terreno.tamanhoGrade / 2;
const lightColor = new THREE.Color();
const windDirection = new THREE.Vector2(CONFIG.vento.direcaoX, CONFIG.vento.direcaoZ).normalize();

function clamp01(value) {
    return THREE.MathUtils.clamp(value, 0, 1);
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

function createGrassMaterial(scene) {
    return new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.merge([
            THREE.UniformsLib.fog,
            {
                uTime: { value: 0 },
                uWindDirection: { value: windDirection },
                uWindStrength: { value: CONFIG.vento.forca },
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

function createGrassTileGeometry(cx, cz, getHeight) {
    const grassConfig = CONFIG.grama;
    const shape = createBladeShape(grassConfig.segmentos);
    const startX = cx * CHUNK_SIZE;
    const startZ = cz * CHUNK_SIZE;
    const offsets = [];
    const blades = [];
    const angles = [];
    const dryness = [];
    let minTileY = Infinity;
    let maxTileY = -Infinity;

    for (let i = 0; i < grassConfig.tufosPorChunk; i++) {
        const rx = hash01(cx, cz, i);
        const rz = hash01(cz, cx, i + 19);
        const worldX = startX + rx * CHUNK_SIZE;
        const worldZ = startZ + rz * CHUNK_SIZE;
        const terrainHeight = getHeight(worldX, worldZ);

        if (terrainHeight < CONFIG.terreno.nivelDoMar + 0.04) continue;
        if (terrainHeight > grassConfig.alturaMaximaTerreno) continue;

        const scaleSeed = hash01(worldX, worldZ, i + 41);
        const widthSeed = hash01(worldZ, worldX, i + 63);
        const leanSeed = hash01(worldX, worldZ, i + 91) * 2 - 1;
        const drySeed = hash01(worldX, worldZ, i + 117);
        const heightDryness = clamp01((terrainHeight - 18) / 26);
        const bladeHeight = THREE.MathUtils.lerp(grassConfig.alturaMin, grassConfig.alturaMax, scaleSeed);
        const bladeWidth = THREE.MathUtils.lerp(grassConfig.larguraMin, grassConfig.larguraMax, widthSeed);

        offsets.push(worldX - startX, terrainHeight + 0.015, worldZ - startZ);
        blades.push(
            bladeHeight,
            bladeWidth,
            leanSeed
        );
        angles.push(hash01(worldX, worldZ, i + 151) * Math.PI * 2);
        dryness.push(clamp01(heightDryness * 0.38 + drySeed * 0.18));
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
        Math.sqrt(CHUNK_SIZE * CHUNK_SIZE * 0.5 + verticalRadius * verticalRadius) + grassConfig.alturaMax
    );

    return geometry;
}

function createGrassTile(cx, cz, material, getHeight) {
    const geometry = createGrassTileGeometry(cx, cz, getHeight);
    if (geometry.instanceCount === 0) {
        geometry.dispose();
        return null;
    }

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);
    mesh.frustumCulled = true;
    return mesh;
}

function disposeTile(mesh) {
    mesh.geometry.dispose();
}

export function createGrass(scene, getHeight, diagnostics) {
    const grassConfig = CONFIG.grama;
    const activeTiles = new Map();
    const queuedTileKeys = new Set();
    let tileBuildQueue = [];
    let lastPlayerChunkX = null;
    let lastPlayerChunkZ = null;
    let elapsed = 0;

    if (!grassConfig.ativa) {
        return {
            update() {},
            dispose() {}
        };
    }

    const material = createGrassMaterial(scene);

    function queueTile(cx, cz, playerChunkX, playerChunkZ) {
        if (!isInsideWorld(cx, cz)) return;

        const key = getChunkKey(cx, cz);
        if (activeTiles.has(key) || queuedTileKeys.has(key)) return;

        const distance = Math.max(Math.abs(cx - playerChunkX), Math.abs(cz - playerChunkZ));
        tileBuildQueue.push({ cx, cz, key, priority: distance });
        queuedTileKeys.add(key);
    }

    function refreshTiles(playerChunkX, playerChunkZ) {
        const desiredKeys = new Set();

        for (let dx = -grassConfig.distanciaChunks; dx <= grassConfig.distanciaChunks; dx++) {
            for (let dz = -grassConfig.distanciaChunks; dz <= grassConfig.distanciaChunks; dz++) {
                const cx = playerChunkX + dx;
                const cz = playerChunkZ + dz;
                const key = getChunkKey(cx, cz);
                desiredKeys.add(key);
                queueTile(cx, cz, playerChunkX, playerChunkZ);
            }
        }

        for (const [key, tile] of activeTiles) {
            if (desiredKeys.has(key)) continue;
            scene.remove(tile);
            disposeTile(tile);
            activeTiles.delete(key);
        }

        tileBuildQueue = tileBuildQueue
            .filter((item) => desiredKeys.has(item.key) && !activeTiles.has(item.key))
            .sort((a, b) => a.priority - b.priority);
        queuedTileKeys.clear();
        for (const item of tileBuildQueue) {
            queuedTileKeys.add(item.key);
        }

        diagnostics?.setCounter('grassTiles', activeTiles.size);
        diagnostics?.setCounter('grassQueue', tileBuildQueue.length);
    }

    function processTileQueue() {
        let built = 0;
        while (built < grassConfig.tilesPorFrame && tileBuildQueue.length > 0) {
            const item = tileBuildQueue.shift();
            queuedTileKeys.delete(item.key);
            if (activeTiles.has(item.key)) continue;

            const tile = createGrassTile(item.cx, item.cz, material, getHeight);
            if (!tile) continue;

            scene.add(tile);
            activeTiles.set(item.key, tile);
            built++;
        }

        diagnostics?.setCounter('grassTiles', activeTiles.size);
        diagnostics?.setCounter('grassQueue', tileBuildQueue.length);
    }

    function updateLightLevel() {
        if (scene.background?.isColor) {
            lightColor.copy(scene.background);
            const luminance = lightColor.r * 0.299 + lightColor.g * 0.587 + lightColor.b * 0.114;
            material.uniforms.uLightLevel.value = THREE.MathUtils.clamp(luminance * 1.25, 0.18, 1.0);
        }
    }

    function update(deltaSeconds, playerX, playerZ) {
        elapsed += deltaSeconds;
        const gust = 0.9 + Math.sin(elapsed * 0.21) * 0.08 + Math.sin(elapsed * 0.067) * 0.06;
        material.uniforms.uTime.value = elapsed;
        material.uniforms.uWindStrength.value = CONFIG.vento.forca * gust;
        updateLightLevel();

        const playerChunkX = Math.floor(playerX / CHUNK_SIZE);
        const playerChunkZ = Math.floor(playerZ / CHUNK_SIZE);
        if (playerChunkX !== lastPlayerChunkX || playerChunkZ !== lastPlayerChunkZ) {
            lastPlayerChunkX = playerChunkX;
            lastPlayerChunkZ = playerChunkZ;
            refreshTiles(playerChunkX, playerChunkZ);
        }

        processTileQueue();
    }

    function dispose() {
        for (const tile of activeTiles.values()) {
            scene.remove(tile);
            disposeTile(tile);
        }
        activeTiles.clear();
        tileBuildQueue = [];
        queuedTileKeys.clear();
        material.dispose();
    }

    return { update, dispose };
}
