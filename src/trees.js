import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from './config.js';
import { getChunkKey } from './chunks.js';

const CHUNK_SIZE = CONFIG.terreno.tamanhoChunk;
const WORLD_MIN = -CONFIG.terreno.tamanhoGrade / 2;
const WORLD_MAX = CONFIG.terreno.tamanhoGrade / 2;
const TREE_PLACEMENT_CACHE_LIMIT = 8192;
const EMPTY_TREE_CHUNK_CACHE_LIMIT = 8192;
const tempMatrix = new THREE.Matrix4();
const tempNormalizingMatrix = new THREE.Matrix4();
const tempPosition = new THREE.Vector3();
const tempScale = new THREE.Vector3();
const tempQuaternion = new THREE.Quaternion();
const tempEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const assetBounds = new THREE.Box3();
const treeWindDirection = new THREE.Vector2(CONFIG.vento.direcaoX, CONFIG.vento.direcaoZ).normalize();

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

function getChunkCoord(value) {
    return Math.floor(value / CHUNK_SIZE);
}

function getTreeConfig() {
    return CONFIG.arvores ?? {};
}

function getTreeDistance() {
    return Math.max(0, getTreeConfig().distanciaChunks ?? 0);
}

function rememberLimitedMapValue(map, key, value, limit) {
    map.delete(key);
    map.set(key, value);
    if (map.size > limit) {
        map.delete(map.keys().next().value);
    }
}

function rememberLimitedSetValue(set, value, limit) {
    set.delete(value);
    set.add(value);
    if (set.size > limit) {
        set.delete(set.values().next().value);
    }
}

function canPlaceTree(sample) {
    const treeConfig = getTreeConfig();
    if (!sample) return false;
    if (sample.height < CONFIG.terreno.nivelDoMar + 0.08) return false;
    if (sample.height > (treeConfig.alturaMaximaTerreno ?? 34)) return false;
    return sample.weights.mountains < (treeConfig.pesoMaximoMontanha ?? 0.36);
}

function isLeafMesh(mesh) {
    const name = `${mesh.name ?? ''} ${mesh.parent?.name ?? ''}`.toLowerCase();
    return name.includes('plane')
        || name.includes('leaf')
        || name.includes('leaves')
        || name.includes('folha')
        || name.includes('folhas');
}

function getMaterialKey(material) {
    if (!material) return 'default';
    return material.uuid ?? material.name ?? 'material';
}

function createRuntimeMaterial(sourceMaterial, role, animated = true) {
    const sourceColor = sourceMaterial?.color?.isColor
        ? sourceMaterial.color
        : new THREE.Color(0xffffff);
    const material = new THREE.MeshLambertMaterial({
        color: sourceColor.clone(),
        map: sourceMaterial?.map ?? null,
        alphaMap: sourceMaterial?.alphaMap ?? null,
        side: role === 'leaves' ? THREE.DoubleSide : THREE.FrontSide,
        alphaTest: role === 'leaves' ? Math.max(sourceMaterial?.alphaTest ?? 0, 0.35) : sourceMaterial?.alphaTest ?? 0,
        transparent: false,
        fog: true
    });

    material.name = `${sourceMaterial?.name ?? role}-${role}`;
    material.toneMapped = false;

    if (animated && role === 'leaves' && getTreeConfig().vento?.ativo !== false) {
        addTreeWindToMaterial(material);
    }

    return material;
}

function addTreeWindToMaterial(material) {
    const treeConfig = getTreeConfig();
    const windConfig = treeConfig.vento ?? {};
    const uniforms = {
        uTreeWindTime: { value: 0 },
        uTreeWindStrength: { value: windConfig.forca ?? 0.16 },
        uTreeWindSpeed: { value: windConfig.velocidade ?? 0.9 },
        uTreeWindFrequency: { value: windConfig.frequencia ?? 0.08 },
        uTreeWindDirection: { value: treeWindDirection },
        uTreeWindMinY: { value: 0 },
        uTreeWindMaxY: { value: 1 }
    };

    material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            `
            #include <common>
            uniform float uTreeWindTime;
            uniform float uTreeWindStrength;
            uniform float uTreeWindSpeed;
            uniform float uTreeWindFrequency;
            uniform vec2 uTreeWindDirection;
            uniform float uTreeWindMinY;
            uniform float uTreeWindMaxY;
            `
        );
        shader.vertexShader = shader.vertexShader.replace(
            '#include <begin_vertex>',
            `
            #include <begin_vertex>
            #ifdef USE_INSTANCING
                vec3 treeWorldPosition = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
            #else
                vec3 treeWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
            #endif
            float treeHeightSpan = max(0.001, uTreeWindMaxY - uTreeWindMinY);
            float treeBendFactor = clamp((position.y - uTreeWindMinY) / treeHeightSpan, 0.0, 1.0);
            float treeWave = sin(dot(treeWorldPosition.xz, uTreeWindDirection) * uTreeWindFrequency + uTreeWindTime * uTreeWindSpeed);
            transformed.xz += uTreeWindDirection * treeWave * uTreeWindStrength * treeBendFactor * treeBendFactor;
            `
        );
    };

    material.customProgramCacheKey = () => 'tree-leaf-wind-v1';
    material.userData.treeWindUniforms = uniforms;
}

function prepareGeometry(sourceGeometry, worldMatrix, normalizingMatrix) {
    const geometry = sourceGeometry.clone();
    geometry.applyMatrix4(worldMatrix);
    geometry.applyMatrix4(normalizingMatrix);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
}

function prepareTreeAsset(root) {
    root.updateMatrixWorld(true);
    assetBounds.setFromObject(root);
    const center = assetBounds.getCenter(new THREE.Vector3());
    tempNormalizingMatrix.makeTranslation(-center.x, -assetBounds.min.y, -center.z);

    const groups = new Map();
    root.traverse((object) => {
        if (!object.isMesh || !object.geometry) return;

        const role = isLeafMesh(object) ? 'leaves' : 'trunk';
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        const geometryGroups = object.geometry.groups?.length
            ? object.geometry.groups
            : [{ materialIndex: 0 }];

        for (const group of geometryGroups) {
            const sourceMaterial = materials[group.materialIndex] ?? materials[0] ?? null;
            const key = `${role}:${getMaterialKey(sourceMaterial)}`;
            if (!groups.has(key)) {
                groups.set(key, {
                    role,
                    sourceMaterial,
                    geometries: []
                });
            }
            groups.get(key).geometries.push(prepareGeometry(object.geometry, object.matrixWorld, tempNormalizingMatrix));
        }
    });

    const parts = [];
    for (const group of groups.values()) {
        const geometry = group.geometries.length === 1
            ? group.geometries[0]
            : mergeGeometries(group.geometries, false);

        if (!geometry) {
            for (const item of group.geometries) item.dispose();
            continue;
        }

        if (group.geometries.length > 1) {
            for (const item of group.geometries) item.dispose();
        }

        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        const material = createRuntimeMaterial(group.sourceMaterial, group.role, true);
        const staticMaterial = group.role === 'leaves' && material.userData.treeWindUniforms
            ? createRuntimeMaterial(group.sourceMaterial, group.role, false)
            : material;

        if (group.role === 'leaves' && material.userData.treeWindUniforms && geometry.boundingBox) {
            material.userData.treeWindUniforms.uTreeWindMinY.value = geometry.boundingBox.min.y;
            material.userData.treeWindUniforms.uTreeWindMaxY.value = geometry.boundingBox.max.y;
        }

        parts.push({
            role: group.role,
            geometry,
            material,
            staticMaterial,
            isWindAnimated: group.role === 'leaves' && Boolean(material.userData.treeWindUniforms)
        });
    }

    return parts;
}

export function createTrees(scene, getTerrainSample, diagnostics, options = {}) {
    const treeConfig = getTreeConfig();
    const getChunkGroup = options.getChunkGroup ?? (() => null);
    const activeBatches = new Map();
    const queuedChunkKeys = new Set();
    const emptyChunkKeys = new Set();
    const rawCandidateCache = new Map();
    const placementCache = new Map();
    let buildQueue = [];
    let assetParts = [];
    let assetReady = false;
    let assetFailed = false;
    let elapsed = 0;

    if (!treeConfig.ativa) {
        return {
            updateForPlayers() {},
            isPositionBlocked() { return false; },
            getBlockersForChunk() { return []; },
            setVisibilityForFocus() {},
            restoreVisibility() {},
            disposeChunk() {},
            dispose() {}
        };
    }

    function getRawCandidates(cx, cz) {
        const key = getChunkKey(cx, cz);
        const cached = rawCandidateCache.get(key);
        if (cached) return cached;

        const candidates = [];
        const startX = cx * CHUNK_SIZE;
        const startZ = cz * CHUNK_SIZE;
        const attempts = treeConfig.tentativasPorChunk ?? 3;
        const chance = treeConfig.chancePorTentativa ?? 0.4;

        for (let i = 0; i < attempts; i++) {
            if (hash01(cx, cz, i + 7) > chance) continue;

            const x = startX + hash01(cx, cz, i + 17) * CHUNK_SIZE;
            const z = startZ + hash01(cz, cx, i + 31) * CHUNK_SIZE;
            if (x < WORLD_MIN || z < WORLD_MIN || x > WORLD_MAX || z > WORLD_MAX) continue;

            const sample = getTerrainSample(x, z);
            if (!canPlaceTree(sample)) continue;

            const scaleSeed = hash01(x, z, i + 43);
            const scale = THREE.MathUtils.lerp(treeConfig.escalaMin ?? 1, treeConfig.escalaMax ?? 1, scaleSeed);
            candidates.push({
                key: `${key}:${i}`,
                cx,
                cz,
                x,
                z,
                height: sample.height,
                rotation: hash01(x, z, i + 59) * Math.PI * 2,
                scale,
                radius: (treeConfig.raioBloqueio ?? 4.5) * scale,
                priority: hash01(x, z, i + 71)
            });
        }

        rememberLimitedMapValue(rawCandidateCache, key, candidates, TREE_PLACEMENT_CACHE_LIMIT);
        return candidates;
    }

    function getTreePlacements(cx, cz) {
        const key = getChunkKey(cx, cz);
        const cached = placementCache.get(key);
        if (cached) return cached;

        const centerCandidates = getRawCandidates(cx, cz);
        const neighborCandidates = [];
        for (let dz = -1; dz <= 1; dz++) {
            for (let dx = -1; dx <= 1; dx++) {
                neighborCandidates.push(...getRawCandidates(cx + dx, cz + dz));
            }
        }

        const minDistance = treeConfig.distanciaMinima ?? 9;
        const minDistanceSq = minDistance * minDistance;
        const kept = centerCandidates.filter((candidate) => {
            for (const other of neighborCandidates) {
                if (other === candidate) continue;
                const dx = other.x - candidate.x;
                const dz = other.z - candidate.z;
                if (dx * dx + dz * dz >= minDistanceSq) continue;
                if (other.priority > candidate.priority) return false;
                if (other.priority === candidate.priority && other.key < candidate.key) return false;
            }
            return true;
        });

        kept.sort((a, b) => b.priority - a.priority);
        const placements = kept.slice(0, treeConfig.maxPorChunk ?? 1);
        rememberLimitedMapValue(placementCache, key, placements, TREE_PLACEMENT_CACHE_LIMIT);
        return placements;
    }

    function getBlockersForChunk(cx, cz, radius = 0) {
        const blockers = [];
        const maxRadius = (treeConfig.raioBloqueio ?? 4.5) * (treeConfig.escalaMax ?? 1) + radius;
        const chunkRange = Math.max(1, Math.ceil(maxRadius / CHUNK_SIZE));

        for (let dz = -chunkRange; dz <= chunkRange; dz++) {
            for (let dx = -chunkRange; dx <= chunkRange; dx++) {
                blockers.push(...getTreePlacements(cx + dx, cz + dz));
            }
        }

        return blockers;
    }

    function isPositionBlocked(worldX, worldZ, radius = 0) {
        const blockers = getBlockersForChunk(getChunkCoord(worldX), getChunkCoord(worldZ), radius);
        for (const tree of blockers) {
            const checkRadius = tree.radius + radius;
            const tx = tree.x - worldX;
            const tz = tree.z - worldZ;
            if (tx * tx + tz * tz <= checkRadius * checkRadius) return true;
        }

        return false;
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

    function shouldAnimateBatch(cx, cz, focuses) {
        const windConfig = treeConfig.vento ?? {};
        if (windConfig.ativo === false) return false;
        return getClosestDistanceToFocus(cx, cz, focuses) <= (windConfig.distanciaChunks ?? getTreeDistance());
    }

    function setBatchAnimation(batch, shouldAnimate) {
        if (batch.isAnimated === shouldAnimate) return;

        for (const mesh of batch.meshes) {
            const part = mesh.userData.treePart;
            if (!part?.isWindAnimated) continue;
            mesh.material = shouldAnimate ? part.material : part.staticMaterial;
        }

        batch.isAnimated = shouldAnimate;
    }

    function queueChunk(cx, cz, priority) {
        if (!assetReady || assetFailed) return;
        if (!isInsideWorld(cx, cz)) return;
        const key = getChunkKey(cx, cz);
        if (activeBatches.has(key) || queuedChunkKeys.has(key)) return;
        if (emptyChunkKeys.has(key)) return;
        if (!getChunkGroup(cx, cz)) return;

        buildQueue.push({ cx, cz, key, priority });
        queuedChunkKeys.add(key);
    }

    function createChunkBatch(item, focuses) {
        const placements = getTreePlacements(item.cx, item.cz);
        if (!placements.length) {
            rememberLimitedSetValue(emptyChunkKeys, item.key, EMPTY_TREE_CHUNK_CACHE_LIMIT);
            return false;
        }

        const chunkGroup = getChunkGroup(item.cx, item.cz);
        if (!chunkGroup || chunkGroup.userData.disposed) return false;
        const buryAmount = treeConfig.enterraNoTerreno ?? 0.15;

        const meshes = [];
        const isAnimated = shouldAnimateBatch(item.cx, item.cz, focuses);
        for (const part of assetParts) {
            const material = isAnimated ? part.material : part.staticMaterial;
            const mesh = new THREE.InstancedMesh(part.geometry, material, placements.length);
            mesh.name = `trees-${part.role}-${item.key}`;
            mesh.position.set(item.cx * CHUNK_SIZE, 0, item.cz * CHUNK_SIZE);
            mesh.frustumCulled = true;
            mesh.castShadow = false;
            mesh.receiveShadow = false;
            mesh.userData.treePart = part;

            for (let i = 0; i < placements.length; i++) {
                const tree = placements[i];
                tempPosition.set(tree.x - item.cx * CHUNK_SIZE, tree.height - buryAmount, tree.z - item.cz * CHUNK_SIZE);
                tempEuler.set(0, tree.rotation, 0);
                tempQuaternion.setFromEuler(tempEuler);
                tempScale.set(tree.scale, tree.scale, tree.scale);
                tempMatrix.compose(tempPosition, tempQuaternion, tempScale);
                mesh.setMatrixAt(i, tempMatrix);
            }

            mesh.instanceMatrix.needsUpdate = true;
            mesh.computeBoundingSphere?.();
            chunkGroup.add(mesh);
            meshes.push(mesh);
        }

        activeBatches.set(item.key, {
            cx: item.cx,
            cz: item.cz,
            meshes,
            isAnimated
        });
        return true;
    }

    function pruneBatches(focuses) {
        const maxDistance = getTreeDistance();
        for (const [key, batch] of [...activeBatches]) {
            if (getClosestDistanceToFocus(batch.cx, batch.cz, focuses) <= maxDistance) continue;
            disposeBatch(key);
        }
    }

    function refreshQueue(focuses) {
        const maxDistance = getTreeDistance();
        for (const focus of focuses) {
            for (let dz = -maxDistance; dz <= maxDistance; dz++) {
                for (let dx = -maxDistance; dx <= maxDistance; dx++) {
                    const cx = focus.chunkX + dx;
                    const cz = focus.chunkZ + dz;
                    const distance = Math.max(Math.abs(dx), Math.abs(dz));
                    queueChunk(cx, cz, distance);
                }
            }
        }

        buildQueue = buildQueue.filter((item) => {
            const wanted = getClosestDistanceToFocus(item.cx, item.cz, focuses) <= maxDistance
                && getChunkGroup(item.cx, item.cz);
            if (!wanted) queuedChunkKeys.delete(item.key);
            return wanted;
        });

        buildQueue.sort((a, b) => a.priority - b.priority);
    }

    function getChunksPerFrame(isPlayerMoving) {
        if (isPlayerMoving) {
            return treeConfig.chunksPorFrameMovendo ?? treeConfig.chunksPorFrame ?? 1;
        }
        return treeConfig.chunksPorFrameParado ?? treeConfig.chunksPorFrame ?? 1;
    }

    function processQueue(focuses, isPlayerMoving) {
        if (!assetReady || assetFailed) return;

        let built = 0;
        let attempts = 0;
        const chunksPerFrame = getChunksPerFrame(isPlayerMoving);
        const maxAttempts = Math.max(chunksPerFrame, treeConfig.tentativasFilaPorFrame ?? chunksPerFrame * 4);
        while (buildQueue.length && built < chunksPerFrame && attempts < maxAttempts) {
            const item = buildQueue.shift();
            attempts++;
            queuedChunkKeys.delete(item.key);
            if (activeBatches.has(item.key)) continue;
            if (emptyChunkKeys.has(item.key)) continue;
            if (!getChunkGroup(item.cx, item.cz)) continue;
            if (createChunkBatch(item, focuses)) {
                built++;
            }
        }
    }

    function updateBatchAnimations(focuses) {
        for (const batch of activeBatches.values()) {
            setBatchAnimation(batch, shouldAnimateBatch(batch.cx, batch.cz, focuses));
        }
    }

    function updateWind(deltaSeconds) {
        const windConfig = treeConfig.vento ?? {};
        if (windConfig.ativo === false) return;

        elapsed += deltaSeconds;
        const gust = 0.85 + Math.sin(elapsed * 0.19) * 0.08 + Math.sin(elapsed * 0.057) * 0.05;
        for (const part of assetParts) {
            const uniforms = part.material.userData.treeWindUniforms;
            if (!uniforms) continue;
            uniforms.uTreeWindTime.value = elapsed;
            uniforms.uTreeWindStrength.value = (windConfig.forca ?? 0.16) * gust;
            uniforms.uTreeWindSpeed.value = windConfig.velocidade ?? 0.9;
            uniforms.uTreeWindFrequency.value = windConfig.frequencia ?? 0.08;
        }
    }

    function createTreeFocuses(playerPositions) {
        const seen = new Set();
        const focuses = [];
        for (const position of playerPositions) {
            const chunkX = getChunkCoord(position.x);
            const chunkZ = getChunkCoord(position.z);
            const key = getChunkKey(chunkX, chunkZ);
            if (seen.has(key)) continue;
            seen.add(key);
            focuses.push({ chunkX, chunkZ });
        }
        return focuses;
    }

    function updateForPlayers(deltaSeconds, playerPositions, isPlayerMoving = false) {
        updateWind(deltaSeconds);

        const focuses = createTreeFocuses(playerPositions);
        if (!focuses.length || assetFailed) return;

        pruneBatches(focuses);
        refreshQueue(focuses);
        processQueue(focuses, isPlayerMoving);
        updateBatchAnimations(focuses);

        diagnostics?.setCounter('treeBatches', activeBatches.size);
        diagnostics?.setCounter('treeQueue', buildQueue.length);
        diagnostics?.setCounter('treeEmptyChunks', emptyChunkKeys.size);
        diagnostics?.setCounter('treeAssetReady', assetReady ? 1 : 0);
    }

    function setVisibilityForFocus(position) {
        const focusChunkX = getChunkCoord(position.x);
        const focusChunkZ = getChunkCoord(position.z);
        const maxDistance = getTreeDistance();

        for (const batch of activeBatches.values()) {
            const visible = Math.max(
                Math.abs(batch.cx - focusChunkX),
                Math.abs(batch.cz - focusChunkZ)
            ) <= maxDistance;
            for (const mesh of batch.meshes) {
                mesh.visible = visible;
            }
        }
    }

    function restoreVisibility() {
        for (const batch of activeBatches.values()) {
            for (const mesh of batch.meshes) {
                mesh.visible = true;
            }
        }
    }

    function disposeBatch(key) {
        const batch = activeBatches.get(key);
        if (!batch) return;

        for (const mesh of batch.meshes) {
            mesh.parent?.remove(mesh);
        }
        activeBatches.delete(key);
    }

    function disposeChunk(chunk) {
        const key = getChunkKey(chunk.cx, chunk.cz);
        disposeBatch(key);
        buildQueue = buildQueue.filter((item) => item.key !== key);
        queuedChunkKeys.delete(key);
    }

    function dispose() {
        for (const key of [...activeBatches.keys()]) {
            disposeBatch(key);
        }
        buildQueue = [];
        queuedChunkKeys.clear();
        emptyChunkKeys.clear();
        rawCandidateCache.clear();
        placementCache.clear();

        const materials = new Set();
        for (const part of assetParts) {
            part.geometry.dispose();
            materials.add(part.material);
            materials.add(part.staticMaterial);
        }
        for (const material of materials) {
            material?.dispose();
        }
        assetParts = [];
    }

    const loader = new GLTFLoader();
    loader.load(
        treeConfig.asset,
        (gltf) => {
            assetParts = prepareTreeAsset(gltf.scene);
            assetReady = assetParts.length > 0;
            diagnostics?.setCounter('treeAssetReady', assetReady ? 1 : 0);
        },
        undefined,
        (error) => {
            assetFailed = true;
            diagnostics?.setCounter('treeAssetFailed', 1);
            console.warn('Nao foi possivel carregar a arvore:', error);
        }
    );

        return {
            updateForPlayers,
            isPositionBlocked,
            getBlockersForChunk,
            setVisibilityForFocus,
            restoreVisibility,
            disposeChunk,
        dispose
    };
}
