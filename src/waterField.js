import * as THREE from 'three';
import { CONFIG } from './config.js';
import {
    biomeWeights,
    calculateTerrainHeight,
    continentalness
} from './biomes.js';
import { fbm, hash2D, smoothstep } from './noise.js';

const WATER_CONFIG = CONFIG.agua ?? {};
const SEA_LEVEL = CONFIG.terreno.nivelDoMar;
const RIVER_CONFIG = WATER_CONFIG.rios ?? {};
const LAKE_CONFIG = WATER_CONFIG.lagos ?? {};
const SEA_CONFIG = WATER_CONFIG.mares ?? {};
const FAMILY_ANGLES = [0.18, 1.34, 2.42, 0.78];
const lakeCandidateCache = new Map();
const WATER_SURFACE_Y = SEA_LEVEL + (WATER_CONFIG.nivelSuperficie ?? 0);
const DEFAULT_MAX_WATER_SURFACE = Math.min(
    WATER_SURFACE_Y,
    SEA_LEVEL + (WATER_CONFIG.nivelMaximoSuperficie ?? WATER_CONFIG.nivelSuperficie ?? 0)
);
const MAX_WATER_CARVE_DEPTH = Math.max(0.1, WATER_CONFIG.profundidadeMaximaDeformacao ?? 28);
const MIN_WATER_BED_Y = WATER_SURFACE_Y - MAX_WATER_CARVE_DEPTH;
const TERRAIN_CLEARANCE_ABOVE_WATER = WATER_CONFIG.folgaTerrenoAcimaAgua ?? 0.16;
const MIN_EDGE_WATER_DEPTH = Math.max(
    WATER_CONFIG.profundidadeMinimaBorda ?? 0.18,
    Math.abs(WATER_CONFIG.elevacaoSuperficie ?? 0) + 0.06
);
const DEFAULT_TERRAIN_FIT_MARGIN = WATER_CONFIG.margemTerrenoAcimaSuperficie ?? 0.24;

function clamp01(value) {
    return THREE.MathUtils.clamp(value, 0, 1);
}

function mix(a, b, t) {
    return a + (b - a) * t;
}

function getRawTerrainHeight(x, z) {
    const c = continentalness(x, z);
    return calculateTerrainHeight(x, z, biomeWeights(c));
}

function getSurfaceLimit(config) {
    const localLimit = SEA_LEVEL + (config?.alturaMaxima ?? WATER_CONFIG.nivelMaximoSuperficie ?? 0.65);
    return Math.min(DEFAULT_MAX_WATER_SURFACE, localLimit);
}

function getTerrainFit(terrainHeight, surfaceY, margin) {
    return 1 - smoothstep(surfaceY + margin, surfaceY + margin * 2.5, terrainHeight);
}

function getCutFit(terrainHeight, surfaceY, maxCutHeight) {
    const safeCutHeight = Math.max(0.4, maxCutHeight);
    return 1 - smoothstep(surfaceY + safeCutHeight * 0.7, surfaceY + safeCutHeight, terrainHeight);
}

function clampWaterBottom(targetHeight, surfaceY) {
    return targetHeight < surfaceY
        ? Math.max(MIN_WATER_BED_Y, targetHeight)
        : targetHeight;
}

function getLowGroundWaterCoverage(terrainHeight, surfaceY, influence) {
    const lowGround = 1 - smoothstep(
        surfaceY + TERRAIN_CLEARANCE_ABOVE_WATER * 0.35,
        surfaceY + TERRAIN_CLEARANCE_ABOVE_WATER * 2.25,
        terrainHeight
    );
    return lowGround * influence;
}

function createBankData(coverage, steepness) {
    const safeCoverage = clamp01(coverage);
    if (safeCoverage <= 0.001) return null;

    const safeSteepness = clamp01(steepness);
    return {
        coverage: safeCoverage,
        steepness: safeSteepness,
        material: 'sand',
        materialBlend: 0
    };
}

function getRiverSurfaceY() {
    return WATER_SURFACE_Y;
}

function getWorldPositionFromRiverSpace(along, across, cos, sin) {
    return {
        x: along * cos - across * sin,
        z: along * sin + across * cos
    };
}

function isRiverLaneActive(lane, familyIndex) {
    const laneChance = hash2D(lane, familyIndex * 101, 730 + familyIndex);
    return laneChance <= (RIVER_CONFIG.densidade ?? 0.4);
}

function getRiverCenter(along, lane, familyIndex) {
    const meander = RIVER_CONFIG.meandro ?? 220;
    return lane * (RIVER_CONFIG.espacamento ?? 820)
        + (fbm(along * 0.0012 + lane * 0.37, familyIndex * 9.13, 4, 760 + familyIndex * 19) - 0.5) * meander
        + (fbm(along * 0.0031 - lane * 0.11, familyIndex * 5.7, 2, 790 + familyIndex * 23) - 0.5) * meander * 0.28;
}

function getRiverCorridorData(x, z, familyIndex, extraDistance = 0) {
    if (RIVER_CONFIG.ativo === false) return null;

    const angle = FAMILY_ANGLES[familyIndex % FAMILY_ANGLES.length];
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const along = x * cos + z * sin;
    const across = -x * sin + z * cos;
    const spacing = RIVER_CONFIG.espacamento ?? 820;
    const lane = Math.round(across / spacing);
    if (!isRiverLaneActive(lane, familyIndex)) return null;

    const widthSeed = hash2D(lane, familyIndex * 17, 751);
    const width = mix(RIVER_CONFIG.larguraMin ?? 18, RIVER_CONFIG.larguraMax ?? 42, widthSeed);
    const bankWidth = RIVER_CONFIG.larguraBarranco ?? RIVER_CONFIG.margemSuave ?? 24;
    const center = getRiverCenter(along, lane, familyIndex);
    const distance = Math.abs(across - center);
    if (distance > width + bankWidth + extraDistance) return null;

    return {
        familyIndex,
        angle,
        cos,
        sin,
        along,
        across,
        spacing,
        lane,
        width,
        bankWidth,
        center,
        distance,
        surfaceY: getRiverSurfaceY()
    };
}

function getClosestRiverCorridor(x, z, extraDistance = 0) {
    const familyCount = Math.max(0, RIVER_CONFIG.familias ?? 3);
    let best = null;

    for (let family = 0; family < familyCount; family++) {
        const corridor = getRiverCorridorData(x, z, family, extraDistance);
        if (!corridor) continue;

        const score = Math.max(0, corridor.distance - corridor.width);
        if (!best || score < best.score) {
            best = { ...corridor, score };
        }
    }

    return best;
}

function getRiverBedHeight(along, center, cos, sin, width) {
    const sampleCount = Math.max(1, RIVER_CONFIG.amostrasLeito ?? 3);
    const alongSpan = Math.max(width * 1.5, 28);
    let bedHeight = Infinity;

    for (let i = 0; i < sampleCount; i++) {
        const t = sampleCount === 1 ? 0 : (i / (sampleCount - 1)) * 2 - 1;
        const position = getWorldPositionFromRiverSpace(along + t * alongSpan, center, cos, sin);
        bedHeight = Math.min(bedHeight, getRawTerrainHeight(position.x, position.z));
    }

    return bedHeight;
}

function getRiverFamilySample(x, z, familyIndex, terrainHeight) {
    const corridor = getRiverCorridorData(x, z, familyIndex);
    if (!corridor) return null;

    const {
        along,
        lane,
        center,
        cos,
        sin,
        width,
        bankWidth,
        distance,
        surfaceY
    } = corridor;
    const bedHeight = getRiverBedHeight(along, center, cos, sin, width);
    const surfaceLimit = getSurfaceLimit(RIVER_CONFIG);
    const maxCutHeight = RIVER_CONFIG.alturaMaximaCorte ?? 7.5;
    if (surfaceY > surfaceLimit || bedHeight > surfaceLimit + maxCutHeight * 0.45) return null;

    const altitudeFadeStart = SEA_LEVEL + (RIVER_CONFIG.inicioFadeAltitude ?? -0.8);
    const lowlandFit = 1 - smoothstep(
        altitudeFadeStart,
        surfaceLimit + maxCutHeight * 0.42,
        Math.min(bedHeight, terrainHeight)
    );
    if (lowlandFit <= 0.001) return null;

    const cutFit = getCutFit(terrainHeight, surfaceY, maxCutHeight);
    if (cutFit <= 0.001) return null;

    const channelCoverage = 1 - smoothstep(width * 0.72, width, distance);
    const valleyCoverage = 1 - smoothstep(width, width + bankWidth, distance);
    if (channelCoverage <= 0 && valleyCoverage <= 0.001) return null;

    const depthNoise = fbm(along * 0.004, lane * 0.11, 2, 820 + familyIndex);
    const centerDepth = mix(RIVER_CONFIG.profundidadeMin ?? 0.85, RIVER_CONFIG.profundidadeMax ?? 5.2, depthNoise);
    const edgeT = smoothstep(width * 0.45, width, distance);
    const bankT = smoothstep(width, width + bankWidth, distance);
    const bedTarget = clampWaterBottom(mix(surfaceY - centerDepth, surfaceY - MIN_EDGE_WATER_DEPTH, edgeT), surfaceY);
    const bankTarget = mix(
        surfaceY + TERRAIN_CLEARANCE_ABOVE_WATER,
        surfaceY + (RIVER_CONFIG.alturaBarranco ?? 2.2),
        bankT
    );
    const targetHeight = distance <= width ? bedTarget : bankTarget;
    const terrainInfluence = Math.max(
        channelCoverage,
        valleyCoverage * (RIVER_CONFIG.forcaBarranco ?? 0.92)
    ) * cutFit * lowlandFit;
    const lowGroundCoverage = getLowGroundWaterCoverage(terrainHeight, surfaceY, valleyCoverage);
    const coverage = Math.max(channelCoverage, lowGroundCoverage) * cutFit * lowlandFit;
    const depth = Math.max(0, surfaceY - targetHeight);
    const shore = 1 - smoothstep(width * 0.58, width + bankWidth, distance);
    const bankCoverage = valleyCoverage * cutFit * lowlandFit;
    const bankSteepness = distance <= width
        ? smoothstep(width * 0.45, width, distance) * 0.38
        : 1 - smoothstep(width + bankWidth * 0.12, width + bankWidth * 0.92, distance);

    return {
        kind: 'river',
        coverage,
        terrainInfluence,
        targetHeight,
        depth,
        surfaceY,
        shore,
        bank: createBankData(bankCoverage, bankSteepness),
        flowX: cos,
        flowZ: sin
    };
}

function getRiverSample(x, z, terrainHeight) {
    const familyCount = Math.max(0, RIVER_CONFIG.familias ?? 3);
    let best = null;
    for (let family = 0; family < familyCount; family++) {
        const sample = getRiverFamilySample(x, z, family, terrainHeight);
        if (!sample) continue;
        const score = sample.coverage + (sample.terrainInfluence ?? 0) * 0.35;
        const bestScore = best ? best.coverage + (best.terrainInfluence ?? 0) * 0.35 : -Infinity;
        if (score > bestScore) best = sample;
    }
    return best;
}

function getSeaFamilySample(x, z, familyIndex, terrainHeight) {
    if (SEA_CONFIG.ativo === false || RIVER_CONFIG.ativo === false) return null;

    const angle = FAMILY_ANGLES[familyIndex % FAMILY_ANGLES.length];
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const along = x * cos + z * sin;
    const across = -x * sin + z * cos;
    const spacing = RIVER_CONFIG.espacamento ?? 820;
    const lane = Math.round(across / spacing);
    if (!isRiverLaneActive(lane, familyIndex)) return null;

    const segmentLength = Math.max(600, SEA_CONFIG.comprimentoConexaoRios ?? 3600);
    const nearestMouth = Math.round(along / segmentLength);
    let best = null;

    for (let offset = -1; offset <= 1; offset++) {
        const mouthIndex = nearestMouth + offset;
        const mouthAlong = mouthIndex * segmentLength;
        const mouthAcross = getRiverCenter(mouthAlong, lane, familyIndex);
        const localAlong = along - mouthAlong;
        const localAcross = across - mouthAcross;
        const radiusSeed = hash2D(lane, mouthIndex, 930 + familyIndex * 37);
        const radius = mix(SEA_CONFIG.raioMin ?? 520, SEA_CONFIG.raioMax ?? 920, radiusSeed);
        const radiusAlong = radius * (SEA_CONFIG.proporcaoAlong ?? 1.28) * mix(0.88, 1.16, hash2D(lane, mouthIndex, 931 + familyIndex));
        const radiusAcross = radius * (SEA_CONFIG.proporcaoAcross ?? 0.82) * mix(0.82, 1.18, hash2D(lane, mouthIndex, 932 + familyIndex));
        const normalizedDistance = Math.sqrt(
            (localAlong * localAlong) / (radiusAlong * radiusAlong)
            + (localAcross * localAcross) / (radiusAcross * radiusAcross)
        );
        const margin = (SEA_CONFIG.margemSuave ?? 110) / Math.max(radiusAlong, radiusAcross);
        const coverage = 1 - smoothstep(0.88, 1, normalizedDistance);
        const basinInfluence = 1 - smoothstep(1, 1 + margin, normalizedDistance);
        if (coverage <= 0 && basinInfluence <= 0.001) continue;

        const maxCutHeight = SEA_CONFIG.alturaMaximaCorte ?? 9.5;
        const basinFit = Math.max(
            getTerrainFit(terrainHeight, WATER_SURFACE_Y, DEFAULT_TERRAIN_FIT_MARGIN),
            getCutFit(terrainHeight, WATER_SURFACE_Y, maxCutHeight) * 0.96
        );
        const fittedCoverage = coverage * basinFit;
        const lowGroundCoverage = getLowGroundWaterCoverage(terrainHeight, WATER_SURFACE_Y, basinInfluence);
        const finalCoverage = Math.max(fittedCoverage, lowGroundCoverage * basinFit);
        const terrainInfluence = basinInfluence * basinFit * (SEA_CONFIG.forcaBarranco ?? 0.96);
        if (finalCoverage <= 0.001 && terrainInfluence <= 0.001) continue;

        const depthSeed = hash2D(lane, mouthIndex, 933 + familyIndex * 13);
        const maxDepth = mix(SEA_CONFIG.profundidadeMin ?? 10, SEA_CONFIG.profundidadeMax ?? 28, depthSeed);
        const centerProfile = 1 - smoothstep(0.05, 0.96, normalizedDistance);
        const targetDepth = mix(maxDepth * 0.36, maxDepth, centerProfile);
        const waterBedTarget = clampWaterBottom(WATER_SURFACE_Y - targetDepth, WATER_SURFACE_Y);
        const waterEdgeTarget = mix(
            waterBedTarget,
            WATER_SURFACE_Y - MIN_EDGE_WATER_DEPTH,
            smoothstep(0.70, 0.99, normalizedDistance)
        );
        const shoreTarget = mix(
            WATER_SURFACE_Y + TERRAIN_CLEARANCE_ABOVE_WATER,
            WATER_SURFACE_Y + (SEA_CONFIG.alturaBarranco ?? 2.4),
            smoothstep(1, 1 + margin, normalizedDistance)
        );
        const targetHeight = normalizedDistance < 1 ? waterEdgeTarget : shoreTarget;
        const bankCoverage = basinInfluence * basinFit;
        const bankSteepness = normalizedDistance < 1
            ? smoothstep(0.62, 1, normalizedDistance) * 0.35
            : 1 - smoothstep(1 + margin * 0.08, 1 + margin * 0.95, normalizedDistance);

        const sample = {
            kind: 'sea',
            coverage: finalCoverage,
            terrainInfluence,
            targetHeight,
            depth: Math.max(0, WATER_SURFACE_Y - targetHeight) * Math.max(0.2, finalCoverage),
            surfaceY: WATER_SURFACE_Y,
            shore: finalCoverage,
            bank: createBankData(bankCoverage, bankSteepness),
            flowX: cos,
            flowZ: sin
        };
        const score = getSampleScore(sample);
        if (!best || score > getSampleScore(best)) best = sample;
    }

    return best;
}

function getSeaSample(x, z, terrainHeight) {
    const familyCount = Math.max(0, RIVER_CONFIG.familias ?? 3);
    let best = null;

    for (let family = 0; family < familyCount; family++) {
        const sample = getSeaFamilySample(x, z, family, terrainHeight);
        if (!sample) continue;
        if (!best || getSampleScore(sample) > getSampleScore(best)) best = sample;
    }

    return best;
}

function createLakeCandidate(cx, cz) {
    const cellSize = LAKE_CONFIG.tamanhoCelula ?? 980;
    const chance = hash2D(cx, cz, 910);
    if (chance > (LAKE_CONFIG.chance ?? 0.34)) return null;

    let centerX = (cx + 0.5 + (hash2D(cx, cz, 911) - 0.5) * 0.55) * cellSize;
    let centerZ = (cz + 0.5 + (hash2D(cx, cz, 912) - 0.5) * 0.55) * cellSize;
    let connectedRiver = null;
    if (
        LAKE_CONFIG.conectarAosRios !== false
        && hash2D(cx, cz, 918) <= (LAKE_CONFIG.chanceConectarRio ?? 0.82)
    ) {
        connectedRiver = getClosestRiverCorridor(centerX, centerZ, LAKE_CONFIG.distanciaConexaoRio ?? 320);
        if (connectedRiver) {
            const riverPoint = getWorldPositionFromRiverSpace(
                connectedRiver.along,
                connectedRiver.center,
                connectedRiver.cos,
                connectedRiver.sin
            );
            centerX = mix(centerX, riverPoint.x, 0.82);
            centerZ = mix(centerZ, riverPoint.z, 0.82);
        }
    }

    const radiusSeed = hash2D(cx, cz, 913);
    const radiusX = mix(LAKE_CONFIG.raioMin ?? 130, LAKE_CONFIG.raioMax ?? 360, radiusSeed);
    const radiusZ = radiusX * mix(0.62, 1.38, hash2D(cx, cz, 914));
    const rotation = hash2D(cx, cz, 915) * Math.PI;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const probeRadius = Math.min(radiusX, radiusZ) * 0.55;
    const probes = [
        [0, 0],
        [probeRadius, 0],
        [-probeRadius, 0],
        [0, probeRadius],
        [0, -probeRadius],
        [probeRadius * 0.7, probeRadius * 0.7],
        [-probeRadius * 0.7, probeRadius * 0.7],
        [probeRadius * 0.7, -probeRadius * 0.7],
        [-probeRadius * 0.7, -probeRadius * 0.7]
    ];

    let minHeight = Infinity;
    let maxHeight = -Infinity;
    let heightSum = 0;
    for (const [px, pz] of probes) {
        const height = getRawTerrainHeight(centerX + px, centerZ + pz);
        minHeight = Math.min(minHeight, height);
        maxHeight = Math.max(maxHeight, height);
        heightSum += height;
    }

    const averageHeight = heightSum / probes.length;
    const roughness = maxHeight - minHeight;
    const surfaceLimit = getSurfaceLimit(LAKE_CONFIG);
    const maxCutHeight = LAKE_CONFIG.alturaMaximaCorte ?? 6.2;
    if (minHeight > surfaceLimit + 0.18) return null;
    if (averageHeight > surfaceLimit + maxCutHeight * 0.55) return null;
    if (roughness > (LAKE_CONFIG.rugosidadeMaxima ?? 6)) return null;

    const depthSeed = hash2D(cx, cz, 916);
    const configuredDepth = mix(LAKE_CONFIG.profundidadeMin ?? 1.4, LAKE_CONFIG.profundidadeMax ?? 5.2, depthSeed);
    const level = WATER_SURFACE_Y;
    const naturalDepth = level - minHeight;
    if (naturalDepth < 0.18 && averageHeight > level + maxCutHeight * 0.28) return null;

    return {
        centerX,
        centerZ,
        radiusX,
        radiusZ,
        rotation,
        cos,
        sin,
        level,
        depth: Math.min(LAKE_CONFIG.profundidadeMax ?? 5.2, configuredDepth + naturalDepth * 0.65),
        roughness,
        connectedRiver
    };
}

function getLakeCandidate(cx, cz) {
    const key = `${cx},${cz}`;
    if (!lakeCandidateCache.has(key)) {
        lakeCandidateCache.set(key, createLakeCandidate(cx, cz));
    }
    return lakeCandidateCache.get(key);
}

function getLakeSample(x, z, terrainHeight) {
    if (LAKE_CONFIG.ativo === false) return null;

    const cellSize = LAKE_CONFIG.tamanhoCelula ?? 980;
    const cellX = Math.floor(x / cellSize);
    const cellZ = Math.floor(z / cellSize);
    let best = null;

    for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
            const cx = cellX + dx;
            const cz = cellZ + dz;
            const lake = getLakeCandidate(cx, cz);
            if (!lake) continue;

            const localX = x - lake.centerX;
            const localZ = z - lake.centerZ;
            const rx = localX * lake.cos - localZ * lake.sin;
            const rz = localX * lake.sin + localZ * lake.cos;
            const normalizedDistance = Math.sqrt((rx * rx) / (lake.radiusX * lake.radiusX) + (rz * rz) / (lake.radiusZ * lake.radiusZ));
            const margin = (LAKE_CONFIG.margemSuave ?? 48) / Math.max(lake.radiusX, lake.radiusZ);
            const coverage = 1 - smoothstep(0.90, 1, normalizedDistance);
            const basinInfluence = 1 - smoothstep(1, 1 + margin, normalizedDistance);
            if (coverage <= 0 && basinInfluence <= 0.001) continue;

            const terrainFitMargin = Math.min(
                LAKE_CONFIG.encaixeMargemAltura ?? DEFAULT_TERRAIN_FIT_MARGIN,
                DEFAULT_TERRAIN_FIT_MARGIN
            );
            const maxCutHeight = LAKE_CONFIG.alturaMaximaCorte ?? 6.2;
            const basinFit = Math.max(
                getTerrainFit(terrainHeight, lake.level, terrainFitMargin),
                getCutFit(terrainHeight, lake.level, maxCutHeight) * 0.92
            );
            const fittedCoverage = coverage * basinFit;
            const fittedInfluence = basinInfluence * basinFit * (LAKE_CONFIG.forcaBarranco ?? 0.88);
            if (fittedCoverage <= 0.001 && fittedInfluence <= 0.001) continue;

            const centerProfile = 1 - smoothstep(0.08, 0.94, normalizedDistance);
            const targetDepth = lake.depth * mix(0.28, 1, centerProfile);
            const waterBedTarget = clampWaterBottom(lake.level - targetDepth, lake.level);
            const waterEdgeTarget = mix(
                waterBedTarget,
                lake.level - MIN_EDGE_WATER_DEPTH,
                smoothstep(0.70, 0.98, normalizedDistance)
            );
            const shoreTarget = mix(
                lake.level + TERRAIN_CLEARANCE_ABOVE_WATER,
                lake.level + (LAKE_CONFIG.alturaBarranco ?? 1.8),
                smoothstep(1, 1 + margin, normalizedDistance)
            );
            const targetHeight = normalizedDistance < 1 ? waterEdgeTarget : shoreTarget;
            const lowGroundCoverage = getLowGroundWaterCoverage(terrainHeight, lake.level, basinInfluence);
            const finalCoverage = Math.max(fittedCoverage, lowGroundCoverage * basinFit);
            const bankCoverage = basinInfluence * basinFit;
            const bankSteepness = normalizedDistance < 1
                ? smoothstep(0.64, 1, normalizedDistance) * 0.35
                : 1 - smoothstep(1 + margin * 0.08, 1 + margin * 0.95, normalizedDistance);

            const sample = {
                kind: 'lake',
                coverage: finalCoverage,
                terrainInfluence: fittedInfluence,
                targetHeight,
                depth: Math.max(0, lake.level - targetHeight) * Math.max(0.2, finalCoverage),
                surfaceY: lake.level,
                shore: finalCoverage,
                bank: createBankData(bankCoverage, bankSteepness),
                flowX: 0,
                flowZ: 0
            };

            if (!best || sample.coverage > best.coverage) best = sample;
        }
    }

    return best;
}

function getSampleScore(sample) {
    if (!sample) return -Infinity;
    const kindBoost = sample.kind === 'sea'
        ? 0.24
        : sample.kind === 'lake'
            ? 0.08
            : 0;
    return sample.coverage + (sample.terrainInfluence ?? 0) * 0.35 + kindBoost;
}

function getHydrologySample(x, z, terrainHeight = SEA_LEVEL) {
    if (WATER_CONFIG.ativa === false) return null;

    const sea = getSeaSample(x, z, terrainHeight);
    const lake = getLakeSample(x, z, terrainHeight);
    const river = getRiverSample(x, z, terrainHeight);
    let best = sea ?? lake ?? river;
    if (lake && getSampleScore(lake) > getSampleScore(best)) best = lake;
    if (river && getSampleScore(river) > getSampleScore(best)) best = river;
    return best;
}

export function getWaterSample(x, z, terrainHeight = SEA_LEVEL) {
    const sample = getHydrologySample(x, z, terrainHeight);
    if (!sample || sample.coverage <= 0.001) return null;
    return sample;
}

export function resetWaterFieldCache() {
    lakeCandidateCache.clear();
}

export function applyWaterToTerrainSample(sample) {
    if (!sample || WATER_CONFIG.ativa === false) return sample;

    const water = getHydrologySample(sample.x, sample.z, sample.height);
    if (!water || (water.coverage <= 0.001 && (water.terrainInfluence ?? 0) <= 0.001)) {
        sample.water = null;
        return sample;
    }

    if (water.surfaceY > DEFAULT_MAX_WATER_SURFACE) {
        sample.water = null;
        return sample;
    }

    const targetBedHeight = Number.isFinite(water.targetHeight)
        ? water.targetHeight
        : water.surfaceY - Math.max(0.08, water.depth);
    const clampedTargetHeight = clampWaterBottom(targetBedHeight, water.surfaceY);
    const terrainInfluence = Math.max(water.coverage, water.terrainInfluence ?? 0);
    const carvedHeight = Math.max(
        MIN_WATER_BED_Y,
        Math.min(sample.height, mix(sample.height, clampedTargetHeight, clamp01(terrainInfluence)))
    );
    const actualDepth = water.surfaceY - carvedHeight;
    sample.height = carvedHeight;
    sample.bank = water.bank ?? null;

    if (water.coverage <= 0.001 || actualDepth <= 0.035) {
        sample.water = null;
        return sample;
    }

    sample.water = {
        kind: water.kind,
        coverage: water.coverage,
        surfaceY: water.surfaceY,
        depth: actualDepth,
        shore: water.shore,
        flowX: water.flowX,
        flowZ: water.flowZ
    };

    return sample;
}
