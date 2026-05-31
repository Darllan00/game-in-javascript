import * as THREE from 'three';
import { CONFIG } from './config.js';

const TERRAIN_STEP = 1;
const TREE_SCAN_STEP = 3;
const GRASS_SCAN_STEP = 2;

const CHUNK_SIZE = 32;
const VIEW_DISTANCE = 6; // 2 => carrega 5x5 chunks ao redor do jogador

const OAK_CHANCE = 0.0045;
const PINE_CHANCE = 0.016;
const SUPER_OAK_CHANCE = 0.003; // Chance

const GRASS_SMALL_CHANCE = 0.055;
const GRASS_LARGE_CHANCE = 0.18;

const OAK_MIN_HEIGHT = -2;
const OAK_MAX_HEIGHT = 18;

const PINE_MIN_HEIGHT = 4;
const PINE_MAX_HEIGHT = 32;

const WORLD_MIN = -CONFIG.terreno.tamanhoGrade / 2;
const WORLD_MAX = CONFIG.terreno.tamanhoGrade / 2 - 1;

function hash2D(x, z, seed = 0) {
    const s = Math.sin(x * 127.1 + z * 311.7 + seed * 74.7) * 43758.5453123;
    return s - Math.floor(s);
}

function getTerrainHeightFormula(x, z) {
    const ondaGigante = Math.sin(x / 45) * 12 + Math.cos(z / 45) * 12;
    const ondaMedia = Math.sin(x / 13 + z / 17) * 5;
    const ondaDetalhes = Math.sin(x / 5) * 1.5 + Math.cos(z / 7) * 1.5;
    return Math.round(ondaGigante + ondaMedia + ondaDetalhes);
}

function getSlopeFromHeightMap(heightMap, x, z) {
    const center = heightMap.get(`${x},${z}`);
    if (center === undefined) return Infinity;

    const neighbors = [
        heightMap.get(`${x + 1},${z}`),
        heightMap.get(`${x - 1},${z}`),
        heightMap.get(`${x},${z + 1}`),
        heightMap.get(`${x},${z - 1}`)
    ].filter(v => v !== undefined);

    let maxDiff = 0;
    for (const h of neighbors) {
        maxDiff = Math.max(maxDiff, Math.abs(center - h));
    }
    return maxDiff;
}

function addMatrix(list, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    const matrix = new THREE.Matrix4();
    const pos = new THREE.Vector3(x, y, z);
    const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
    const scale = new THREE.Vector3(sx, sy, sz);
    matrix.compose(pos, quat, scale);
    list.push(matrix);
}

function criarCarvalho(x, y, z, trunkList, leafList) {
    const trunkHeight = 4 + Math.floor(hash2D(x, z, 1) * 2);

    for (let i = 1; i <= trunkHeight; i++) {
        addMatrix(trunkList, x, y + i, z);
    }

    const topY = y + trunkHeight;

    for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
            for (let dy = 0; dy <= 3; dy++) {
                const dist = Math.abs(dx) + Math.abs(dz) + dy;
                const isCenterTop = dy === 3 && Math.abs(dx) <= 1 && Math.abs(dz) <= 1;

                if (dist <= 4 || isCenterTop) {
                    addMatrix(leafList, x + dx, topY + dy, z + dz);
                }
            }
        }
    }

    addMatrix(leafList, x, topY + 4, z);
}

function criarPinheiroGigante(x, y, z, trunkList, leafList) {
    const baseX = x;
    const baseZ = z;
    const trunkHeight = 14 + Math.floor(hash2D(x, z, 2) * 10);

    // Tronco 2x2
    for (let i = 0; i <= trunkHeight; i++) {
        addMatrix(trunkList, baseX, y + i, baseZ);
        addMatrix(trunkList, baseX + 1, y + i, baseZ);
        addMatrix(trunkList, baseX, y + i, baseZ + 1);
        addMatrix(trunkList, baseX + 1, y + i, baseZ + 1);
    }

    const crownStart = y + Math.floor(trunkHeight * 0.35);
    const crownTop = y + trunkHeight + 1;

    // Copa correta: larga embaixo, estreita em cima
    for (let yy = crownStart; yy <= crownTop; yy++) {
        const t = (yy - crownStart) / Math.max(1, crownTop - crownStart);
        const radius = Math.max(1, Math.round(5 * (1 - t)));

        for (let dx = -radius; dx <= radius; dx++) {
            for (let dz = -radius; dz <= radius; dz++) {
                const dist = Math.abs(dx) + Math.abs(dz);
                const noise = hash2D(baseX + dx, baseZ + dz, yy) * 0.7;

                if (dist <= radius + 1 + noise) {
                    addMatrix(leafList, baseX + 0.5 + dx, yy, baseZ + 0.5 + dz);
                }
            }
        }
    }

    addMatrix(leafList, baseX + 0.5, crownTop + 1, baseZ + 0.5);
}

function criarSuperCarvalho(x, y, z, trunkList, leafList) {
    const baseX = x;
    const baseZ = z;
    const trunkHeight = 10 + Math.floor(hash2D(x, z, 3) * 5); // Altura de 10 a 15

    // 1. Tronco 2x2 (Padronizado 1,1,1)
    for (let i = 0; i <= trunkHeight; i++) {
        addMatrix(trunkList, baseX, y + i, baseZ, 0, 0, 0, 1, 1, 1);
        addMatrix(trunkList, baseX + 1, y + i, baseZ, 0, 0, 0, 1, 1, 1);
        addMatrix(trunkList, baseX, y + i, baseZ + 1, 0, 0, 0, 1, 1, 1);
        addMatrix(trunkList, baseX + 1, y + i, baseZ + 1, 0, 0, 0, 1, 1, 1);
    }

    // 2. Raízes (Base larga para dar estabilidade visual)
    // Criamos blocos ao redor da base para parecer que a árvore "abraça" o solo
    for (let dx = -1; dx <= 2; dx++) {
        for (let dz = -1; dz <= 2; dz++) {
            // Adiciona blocos nos cantos da base 4x4, ignorando o centro 2x2
            if ((dx === -1 || dx === 2 || dz === -1 || dz === 2) && (dx + dz) % 2 === 0) {
                 addMatrix(trunkList, baseX + dx, y, baseZ + dz, 0, 0, 0, 1, 1, 1);
            }
        }
    }

    // 3. Copa Densa e Irregular (Efeito "Castanheira")
    const topY = y + trunkHeight;
    const layers = [
        { dy: 0, radius: 4 },
        { dy: 1, radius: 4 },
        { dy: 2, radius: 3 },
        { dy: 3, radius: 2 },
        { dy: 4, radius: 1 }
    ];

    layers.forEach(layer => {
        const currentY = topY + layer.dy;
        // Variação orgânica: o raio aumenta ou diminui levemente com base no ruído
        const noise = Math.floor(hash2D(baseX, currentY, baseZ) * 3) - 1; // Resultado: -1, 0 ou 1
        const r = layer.radius + noise; 

        // Preenche o círculo de folhas
        for (let dx = -r; dx <= r; dx++) {
            for (let dz = -r; dz <= r; dz++) {
                if (Math.sqrt(dx * dx + dz * dz) <= r + 0.5) {
                    addMatrix(leafList, baseX + 0.5 + dx, currentY, baseZ + 0.5 + dz, 0, 0, 0, 1, 1, 1);
                }
            }
        }
    });
}

function criarTufoGrama(x, y, z, smallList, largeList, isLarge) {
    const count = isLarge ? 4 : 3;
    const heightMin = isLarge ? 1.1 : 0.55;
    const heightMax = isLarge ? 2.0 : 1.15;
    const width = isLarge ? 0.12 : 0.08;
    const targetList = isLarge ? largeList : smallList;

    for (let i = 0; i < count; i++) {
        const r1 = hash2D(x, z, i + (isLarge ? 100 : 50));
        const r2 = hash2D(x, z, i + (isLarge ? 200 : 150));
        const r3 = hash2D(x, z, i + (isLarge ? 300 : 250));

        const h = THREE.MathUtils.lerp(heightMin, heightMax, r1);
        const rotY = r2 * Math.PI * 2;
        const tiltX = (r3 - 0.5) * 0.25;
        const tiltZ = (r1 - 0.5) * 0.25;

        const offsetX = (r2 - 0.5) * 0.18;
        const offsetZ = (r3 - 0.5) * 0.18;

        addMatrix(
            targetList,
            x + offsetX,
            y + h / 2,
            z + offsetZ,
            tiltX,
            rotY,
            tiltZ,
            width,
            h,
            width * 1.1
        );
    }
}

function buildInstancedMesh(scene, geometry, material, matrices, castShadow, receiveShadow) {
    if (!matrices.length) return null;

    const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;

    const matrix = new THREE.Matrix4();
    for (let i = 0; i < matrices.length; i++) {
        matrix.copy(matrices[i]);
        mesh.setMatrixAt(i, matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
    return mesh;
}

export function createTerrain(scene) {
    const boxGeometry = new THREE.BoxGeometry(1, 1, 1);

    const bandMaterials = {
        low: new THREE.MeshStandardMaterial({ color: 0x3f7f4a, roughness: 0.95, metalness: 0.0 }),
        plain: new THREE.MeshStandardMaterial({ color: 0x4caf50, roughness: 0.9, metalness: 0.0 }),
        hill: new THREE.MeshStandardMaterial({ color: 0x3f8f45, roughness: 0.92, metalness: 0.0 }),
        rock: new THREE.MeshStandardMaterial({ color: 0x7b7b62, roughness: 1.0, metalness: 0.0 }),
        snow: new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 1.0, metalness: 0.0 })
    };

    const trunkMaterial = new THREE.MeshStandardMaterial({
        color: 0x8b5a2b,
        roughness: 1.0,
        metalness: 0.0
    });

    const leafMaterial = new THREE.MeshStandardMaterial({
        color: 0x2f7d32,
        roughness: 1.0,
        metalness: 0.0
    });

    const pineLeafMaterial = new THREE.MeshStandardMaterial({
        color: 0x245f2a,
        roughness: 1.0,
        metalness: 0.0
    });

    const grassSmallMaterial = new THREE.MeshStandardMaterial({
        color: 0x59b35a,
        roughness: 1.0,
        metalness: 0.0,
        emissive: 0x143014,
        emissiveIntensity: 0.12
    });

    const grassLargeMaterial = new THREE.MeshStandardMaterial({
        color: 0x3f9f49,
        roughness: 1.0,
        metalness: 0.0,
        emissive: 0x102510,
        emissiveIntensity: 0.14
    });

    const chunks = new Map();
    const loadedKeys = new Set();
    const heightMap = new Map();

    function chooseBand(y) {
        if (y <= -6) return 'low';
        if (y <= 4) return 'plain';
        if (y <= 14) return 'hill';
        if (y <= 30) return 'rock';
        return 'snow';
    }

    function getChunkKey(cx, cz) {
        return `${cx},${cz}`;
    }

    function getChunkBounds(cx, cz) {
        const startX = Math.max(WORLD_MIN, cx * CHUNK_SIZE);
        const startZ = Math.max(WORLD_MIN, cz * CHUNK_SIZE);
        const endX = Math.min(WORLD_MAX, startX + CHUNK_SIZE - 1);
        const endZ = Math.min(WORLD_MAX, startZ + CHUNK_SIZE - 1);
        return { startX, startZ, endX, endZ };
    }

    function createChunk(cx, cz) {
        const key = getChunkKey(cx, cz);
        if (chunks.has(key)) return chunks.get(key);

        const { startX, startZ, endX, endZ } = getChunkBounds(cx, cz);
        if (startX > endX || startZ > endZ) return null;

        const bands = {
            low: [],
            plain: [],
            hill: [],
            rock: [],
            snow: []
        };

        const oakTrunks = [];
        const oakLeaves = [];
        const pineTrunks = [];
        const pineLeaves = [];
        const grassSmall = [];
        const grassLarge = [];
        const superOakTrunks = []; // Adicione isso
        const superOakLeaves = []; // Adicione isso

        for (let x = startX; x <= endX; x += TERRAIN_STEP) {
            for (let z = startZ; z <= endZ; z += TERRAIN_STEP) {
                const y = getTerrainHeightFormula(x, z);
                heightMap.set(`${x},${z}`, y);

                const band = chooseBand(y);
                const matrix = new THREE.Matrix4();
                matrix.setPosition(x, y, z);
                bands[band].push(matrix);
            }
        }

        for (let x = startX; x <= endX; x += TREE_SCAN_STEP) {
            for (let z = startZ; z <= endZ; z += TREE_SCAN_STEP) {
                const y = heightMap.get(`${x},${z}`);
                if (y === undefined) continue;

                const slope = getSlopeFromHeightMap(heightMap, x, z);
                if (slope > 2) continue;

                const rOak = hash2D(x, z, 10);
                const rPine = hash2D(x, z, 20);
                const rSuperOak = hash2D(x, z, 30); // Nova semente

                const suitableForOak = y >= OAK_MIN_HEIGHT && y <= OAK_MAX_HEIGHT;
                const suitableForPine = y >= PINE_MIN_HEIGHT && y <= PINE_MAX_HEIGHT;

                if (suitableForOak && rSuperOak < SUPER_OAK_CHANCE) {
                    criarSuperCarvalho(x, y, z, superOakTrunks, superOakLeaves);
                } else if (suitableForOak && rOak < OAK_CHANCE) {
                    criarCarvalho(x, y, z, oakTrunks, oakLeaves);
                } else if (suitableForPine && rPine < PINE_CHANCE) {
                    criarPinheiroGigante(x, y, z, pineTrunks, pineLeaves);
}
            }
        }

        for (let x = startX; x <= endX; x += GRASS_SCAN_STEP) {
            for (let z = startZ; z <= endZ; z += GRASS_SCAN_STEP) {
                const y = heightMap.get(`${x},${z}`);
                if (y === undefined) continue;

                const slope = getSlopeFromHeightMap(heightMap, x, z);
                if (slope > 1.5) continue;

                const r = hash2D(x, z, 77);
                const r2 = hash2D(x, z, 88);

                if (y > -2 && y < 26) {
                    if (r < GRASS_SMALL_CHANCE) {
                        criarTufoGrama(x, y + 0.01, z, grassSmall, grassLarge, false);
                    } else if (r2 < GRASS_LARGE_CHANCE) {
                        criarTufoGrama(x, y + 0.01, z, grassSmall, grassLarge, true);
                    }
                }
            }
        }

        const chunkGroup = new THREE.Group();

        buildInstancedMesh(chunkGroup, boxGeometry, bandMaterials.low, bands.low, true, true);
        buildInstancedMesh(chunkGroup, boxGeometry, bandMaterials.plain, bands.plain, true, true);
        buildInstancedMesh(chunkGroup, boxGeometry, bandMaterials.hill, bands.hill, true, true);
        buildInstancedMesh(chunkGroup, boxGeometry, bandMaterials.rock, bands.rock, true, true);
        buildInstancedMesh(chunkGroup, boxGeometry, bandMaterials.snow, bands.snow, true, true);

        buildInstancedMesh(chunkGroup, boxGeometry, trunkMaterial, oakTrunks, true, true);
        buildInstancedMesh(chunkGroup, boxGeometry, leafMaterial, oakLeaves, true, true);
        buildInstancedMesh(chunkGroup, boxGeometry, trunkMaterial, pineTrunks, true, true);
        buildInstancedMesh(chunkGroup, boxGeometry, pineLeafMaterial, pineLeaves, true, true);
        buildInstancedMesh(chunkGroup, boxGeometry, grassSmallMaterial, grassSmall, false, false);
        buildInstancedMesh(chunkGroup, boxGeometry, grassLargeMaterial, grassLarge, false, false);

        buildInstancedMesh(chunkGroup, boxGeometry, trunkMaterial, superOakTrunks, true, true);
        buildInstancedMesh(chunkGroup, boxGeometry, leafMaterial, superOakLeaves, true, true);

        scene.add(chunkGroup);

        const chunk = { key, group: chunkGroup };
        chunks.set(key, chunk);
        return chunk;
    }

    function unloadChunk(key) {
        const chunk = chunks.get(key);
        if (!chunk) return;

        scene.remove(chunk.group);
        chunks.delete(key);
    }

    function updateChunks(playerX, playerZ) {
        const playerChunkX = Math.floor(playerX / CHUNK_SIZE);
        const playerChunkZ = Math.floor(playerZ / CHUNK_SIZE);

        const needed = new Set();

        for (let dx = -VIEW_DISTANCE; dx <= VIEW_DISTANCE; dx++) {
            for (let dz = -VIEW_DISTANCE; dz <= VIEW_DISTANCE; dz++) {
                const cx = playerChunkX + dx;
                const cz = playerChunkZ + dz;

                const { startX, startZ, endX, endZ } = getChunkBounds(cx, cz);
                if (startX > endX || startZ > endZ) continue;

                const key = getChunkKey(cx, cz);
                needed.add(key);

                if (!chunks.has(key)) {
                    createChunk(cx, cz);
                }
            }
        }

        for (const key of chunks.keys()) {
            if (!needed.has(key)) {
                unloadChunk(key);
            }
        }
    }

    function getHeight(posX, posZ) {
        const x = Math.round(posX);
        const z = Math.round(posZ);
        return getTerrainHeightFormula(x, z);
    }

    // carrega o pedaço inicial ao redor da origem
    updateChunks(0, 0);

    return { getHeight, updateChunks };
}