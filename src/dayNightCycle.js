import * as THREE from 'three';
import { COLORS, CONFIG } from './config.js';

const FULL_TURN = Math.PI * 2;
const SUN_SIZE = 340;
const MOON_SIZE = 240;

const tempColor = new THREE.Color();
const tempColorB = new THREE.Color();
const sunDirection = new THREE.Vector3();
const moonDirection = new THREE.Vector3();
const cameraWorldPosition = new THREE.Vector3();
const focusCenterPosition = new THREE.Vector3();
const shadowFocusPosition = new THREE.Vector3();
const sunDayColor = new THREE.Color(0xfff2d2);
const sunHorizonColor = new THREE.Color(0xffa25f);
const skyDayColor = new THREE.Color(0x91c7ff);
const skyHorizonColor = new THREE.Color(0xffc38a);
const skyNightGroundColor = new THREE.Color(0x1c2230);
const skyDayGroundColor = new THREE.Color(0x5a5138);
const moonColor = new THREE.Color(0xb7c9ff);
const sharedFocusScratch = new THREE.Vector3();

const SKY_STOPS = [
    { t: 0.00, color: new THREE.Color(0x07101f) },
    { t: 0.18, color: new THREE.Color(0x122543) },
    { t: 0.25, color: new THREE.Color(0xf09a58) },
    { t: 0.34, color: new THREE.Color(0x76bfff) },
    { t: 0.50, color: new THREE.Color(0x6bb8ff) },
    { t: 0.66, color: new THREE.Color(0x79bfff) },
    { t: 0.75, color: new THREE.Color(0xd77b49) },
    { t: 0.84, color: new THREE.Color(0x142746) },
    { t: 1.00, color: new THREE.Color(0x07101f) }
];

function clamp01(value) {
    return THREE.MathUtils.clamp(value, 0, 1);
}

function smooth01(value) {
    const t = clamp01(value);
    return t * t * (3 - 2 * t);
}

function sampleColorStops(stops, timeOfDay, target) {
    for (let i = 0; i < stops.length - 1; i++) {
        const current = stops[i];
        const next = stops[i + 1];
        if (timeOfDay >= current.t && timeOfDay <= next.t) {
            const localT = (timeOfDay - current.t) / (next.t - current.t);
            return target.copy(current.color).lerp(next.color, smooth01(localT));
        }
    }

    return target.copy(stops[stops.length - 1].color);
}

function createRadialSpriteTexture(innerColor, outerColor, size = 128) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const center = size / 2;
    const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);
    gradient.addColorStop(0, innerColor);
    gradient.addColorStop(0.42, innerColor);
    gradient.addColorStop(1, outerColor);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

function createStarField(count, radius) {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const starColor = new THREE.Color();

    for (let i = 0; i < count; i++) {
        const theta = Math.random() * FULL_TURN;
        const y = THREE.MathUtils.randFloat(0.06, 1);
        const horizontalRadius = Math.sqrt(1 - y * y);
        const index = i * 3;

        positions[index] = Math.cos(theta) * horizontalRadius * radius;
        positions[index + 1] = y * radius;
        positions[index + 2] = Math.sin(theta) * horizontalRadius * radius;

        const brightness = THREE.MathUtils.randFloat(0.55, 1);
        starColor.setRGB(brightness, brightness, THREE.MathUtils.lerp(brightness, 1, 0.2));
        colors[index] = starColor.r;
        colors[index + 1] = starColor.g;
        colors[index + 2] = starColor.b;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
        size: 2.2,
        sizeAttenuation: true,
        vertexColors: true,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        fog: false,
        toneMapped: false
    });

    return new THREE.Points(geometry, material);
}

function getFocusCenter(focusPositions, fallback, target) {
    target.set(0, 0, 0);
    let count = 0;

    for (const position of focusPositions ?? []) {
        if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.z)) continue;
        target.x += position.x;
        target.y += Number.isFinite(position.y) ? position.y : fallback.y;
        target.z += position.z;
        count++;
    }

    if (!count) return target.copy(fallback);
    return target.multiplyScalar(1 / count);
}

function getFocusRadius(focusPositions, center) {
    let radius = 0;
    for (const position of focusPositions ?? []) {
        if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.z)) continue;
        radius = Math.max(radius, Math.hypot(position.x - center.x, position.z - center.z));
    }
    return radius;
}

export function createDayNightCycle(scene, camera, renderer = null) {
    const cycleConfig = CONFIG.cicloDiaNoite;
    const shadowConfig = CONFIG.iluminacao?.sombras ?? {};
    const shadowsEnabled = shadowConfig.ativa === true;
    const manualShadowUpdates = shadowsEnabled && shadowConfig.atualizacaoManual === true && renderer?.shadowMap;
    const shadowUpdateInterval = (shadowConfig.atualizacaoMs ?? 140) / 1000;
    const shadowFocusGrid = Math.max(1, shadowConfig.focoGrade ?? 8);
    const baseShadowDistance = shadowConfig.distancia ?? 110;
    const maxShadowDistance = Math.max(baseShadowDistance, shadowConfig.distanciaMaxima ?? baseShadowDistance * 4);
    const shadowFocusPadding = Math.max(0, shadowConfig.margemFoco ?? 0);
    const shadowLightDistance = shadowConfig.distanciaLuz ?? 320;
    const shadowCameraFar = Math.max(
        shadowConfig.profundidade ?? shadowLightDistance + maxShadowDistance * 2.5,
        shadowLightDistance + maxShadowDistance + 20
    );
    const cycleDurationSeconds = cycleConfig.duracaoMinutos * 60;
    const updateInterval = 1 / cycleConfig.atualizacoesPorSegundo;
    const radius = cycleConfig.raioAstros;
    let elapsedSeconds = cycleDurationSeconds * 0.34;
    let accumulatedLightUpdate = updateInterval;
    let accumulatedShadowUpdate = shadowUpdateInterval;
    let shadowFocusChanged = true;
    let lastShadowFocusX = Infinity;
    let lastShadowFocusZ = Infinity;
    let currentShadowDistance = 0;
    let currentShadowSignature = '';
    let renderedShadowSignature = '';
    const lightingState = {
        version: 0,
        timeOfDay: 0,
        dayAmount: 1,
        nightAmount: 0,
        horizonWarmth: 0,
        lightLevel: 1,
        sunDirection: new THREE.Vector3(0, 1, 0),
        moonDirection: new THREE.Vector3(0, -1, 0),
        sunColor: sunDayColor.clone(),
        moonColor: moonColor.clone(),
        skyColor: skyDayColor.clone(),
        groundColor: skyDayGroundColor.clone(),
        fogColor: COLORS.dia.clone(),
        sunIntensity: 1,
        moonIntensity: 0,
        skyIntensity: 0.7
    };

    const sunLight = new THREE.DirectionalLight(0xfff0cf, 1.25);
    sunLight.castShadow = shadowsEnabled;

    function setShadowCameraDistance(distance) {
        if (!shadowsEnabled) return;
        const nextDistance = THREE.MathUtils.clamp(distance, baseShadowDistance, maxShadowDistance);
        if (Math.abs(nextDistance - currentShadowDistance) < 2) return;

        currentShadowDistance = nextDistance;
        sunLight.shadow.camera.left = -nextDistance;
        sunLight.shadow.camera.right = nextDistance;
        sunLight.shadow.camera.top = nextDistance;
        sunLight.shadow.camera.bottom = -nextDistance;
        sunLight.shadow.camera.updateProjectionMatrix();
        shadowFocusChanged = true;
    }

    if (shadowsEnabled) {
        const shadowMapSize = shadowConfig.tamanhoMapa ?? 1536;
        sunLight.shadow.mapSize.set(shadowMapSize, shadowMapSize);
        sunLight.shadow.camera.near = 1;
        sunLight.shadow.camera.far = shadowCameraFar;
        sunLight.shadow.bias = shadowConfig.bias ?? -0.00018;
        sunLight.shadow.normalBias = shadowConfig.normalBias ?? 0.045;
        setShadowCameraDistance(baseShadowDistance);
    }

    const moonLight = new THREE.DirectionalLight(0x9db7ff, 0.08);
    moonLight.castShadow = false;

    const skyLight = new THREE.HemisphereLight(0x9fd0ff, 0x4a422f, 0.62);

    const sunTexture = createRadialSpriteTexture('rgba(255, 247, 205, 1)', 'rgba(255, 175, 70, 0)');
    const moonTexture = createRadialSpriteTexture('rgba(225, 232, 245, 1)', 'rgba(160, 180, 220, 0)');

    const sun = new THREE.Sprite(new THREE.SpriteMaterial({
        map: sunTexture,
        color: 0xffffff,
        transparent: true,
        depthWrite: false,
        fog: false,
        toneMapped: false
    }));
    sun.scale.set(SUN_SIZE, SUN_SIZE, 1);

    const moon = new THREE.Sprite(new THREE.SpriteMaterial({
        map: moonTexture,
        color: 0xdde7ff,
        transparent: true,
        depthWrite: false,
        fog: false,
        toneMapped: false
    }));
    moon.scale.set(MOON_SIZE, MOON_SIZE, 1);

    const stars = createStarField(cycleConfig.quantidadeEstrelas, radius * 0.94);

    scene.add(sunLight, sunLight.target, moonLight, moonLight.target, skyLight, sun, moon, stars);

    function requestShadowUpdate() {
        if (manualShadowUpdates) {
            renderer.shadowMap.needsUpdate = true;
            accumulatedShadowUpdate = 0;
        }
    }

    function setShadowFocusPosition(focusPosition, shadowDistance = baseShadowDistance) {
        if (!shadowsEnabled || !focusPosition) return false;

        setShadowCameraDistance(shadowDistance);
        const focusX = Math.round(focusPosition.x / shadowFocusGrid) * shadowFocusGrid;
        const focusZ = Math.round(focusPosition.z / shadowFocusGrid) * shadowFocusGrid;
        const focusY = Number.isFinite(focusPosition.y) ? focusPosition.y : cameraWorldPosition.y;
        const distance = Math.round(currentShadowDistance);

        shadowFocusPosition.set(focusX, focusY, focusZ);
        sunLight.position.copy(shadowFocusPosition).addScaledVector(sunDirection, shadowLightDistance);
        sunLight.target.position.copy(shadowFocusPosition);
        lastShadowFocusX = focusX;
        lastShadowFocusZ = focusZ;
        currentShadowSignature = `${focusX},${focusZ},${distance}`;
        return true;
    }

    function prepareRenderForFocus(focusPosition) {
        if (!setShadowFocusPosition(focusPosition, baseShadowDistance)) return;
        if (currentShadowSignature === renderedShadowSignature) return;
        requestShadowUpdate();
        renderedShadowSignature = currentShadowSignature;
    }

    function prepareSharedRenderForFocuses(focusPositions) {
        if (!focusPositions?.length) return false;

        camera.getWorldPosition(cameraWorldPosition);
        getFocusCenter(focusPositions, cameraWorldPosition, sharedFocusScratch);
        const focusRadius = getFocusRadius(focusPositions, sharedFocusScratch);
        const shadowDistance = baseShadowDistance + focusRadius + shadowFocusPadding;
        if (!setShadowFocusPosition(sharedFocusScratch, shadowDistance)) return false;
        if (currentShadowSignature !== renderedShadowSignature) {
            requestShadowUpdate();
            renderedShadowSignature = currentShadowSignature;
        }
        return true;
    }

    function updateCelestialPositions(timeOfDay, focusPositions = null, updateShadowFocus = true) {
        const sunAngle = timeOfDay * FULL_TURN - Math.PI / 2;
        const moonAngle = sunAngle + Math.PI;

        sunDirection.set(Math.cos(sunAngle) * 0.55, Math.sin(sunAngle), -0.58).normalize();
        moonDirection.set(Math.cos(moonAngle) * 0.55, Math.sin(moonAngle), 0.58).normalize();

        camera.getWorldPosition(cameraWorldPosition);
        getFocusCenter(focusPositions, cameraWorldPosition, focusCenterPosition);
        sun.position.copy(focusCenterPosition).addScaledVector(sunDirection, radius);
        moon.position.copy(focusCenterPosition).addScaledVector(moonDirection, radius);
        stars.position.copy(focusCenterPosition);

        if (shadowsEnabled && updateShadowFocus) {
            const focusRadius = getFocusRadius(focusPositions, focusCenterPosition);
            const shadowDistance = baseShadowDistance + focusRadius + shadowFocusPadding;
            const focusX = Math.round(focusCenterPosition.x / shadowFocusGrid) * shadowFocusGrid;
            const focusZ = Math.round(focusCenterPosition.z / shadowFocusGrid) * shadowFocusGrid;
            shadowFocusChanged = shadowFocusChanged
                || Math.abs(focusX - lastShadowFocusX) >= shadowFocusGrid
                || Math.abs(focusZ - lastShadowFocusZ) >= shadowFocusGrid;
            setShadowFocusPosition(focusCenterPosition, shadowDistance);
            if (shadowFocusChanged) renderedShadowSignature = '';
        } else if (!shadowsEnabled) {
            shadowFocusPosition.copy(focusCenterPosition);
        } else {
            shadowFocusChanged = false;
        }

        if (updateShadowFocus || !shadowsEnabled) {
            sunLight.position.copy(shadowFocusPosition).addScaledVector(sunDirection, shadowLightDistance);
            sunLight.target.position.copy(shadowFocusPosition);
        }
        moonLight.position.copy(focusCenterPosition).addScaledVector(moonDirection, 120);
        moonLight.target.position.copy(focusCenterPosition);

        lightingState.sunDirection.copy(sunDirection);
        lightingState.moonDirection.copy(moonDirection);
    }

    function updateLighting(timeOfDay) {
        const sunHeight = sunDirection.y;
        const moonHeight = moonDirection.y;
        const dayAmount = smooth01((sunHeight + 0.08) / 0.38);
        const nightAmount = smooth01((moonHeight + 0.02) / 0.42) * (1 - dayAmount * 0.55);
        const horizonWarmth = Math.max(
            smooth01(1 - Math.abs(timeOfDay - 0.25) / 0.09),
            smooth01(1 - Math.abs(timeOfDay - 0.75) / 0.09)
        );

        sampleColorStops(SKY_STOPS, timeOfDay, tempColor);
        scene.background.copy(tempColor);

        tempColorB.copy(tempColor).multiplyScalar(0.82);
        scene.fog.color.copy(tempColorB);
        scene.fog.density = THREE.MathUtils.lerp(0.0023, 0.00125, dayAmount);

        sunLight.intensity = THREE.MathUtils.lerp(0, 1.38, dayAmount);
        sunLight.color.copy(sunDayColor).lerp(sunHorizonColor, horizonWarmth * 0.45);
        const wasCastingShadow = sunLight.castShadow;
        sunLight.castShadow = shadowsEnabled && dayAmount > 0.04;
        if (sunLight.castShadow !== wasCastingShadow) {
            renderedShadowSignature = '';
            requestShadowUpdate();
        }

        moonLight.intensity = THREE.MathUtils.lerp(0.01, 0.18, nightAmount);
        skyLight.intensity = THREE.MathUtils.lerp(0.18, 0.76, dayAmount) + nightAmount * 0.08;
        skyLight.color.copy(skyDayColor).lerp(skyHorizonColor, horizonWarmth * 0.22);
        skyLight.groundColor.copy(skyNightGroundColor).lerp(skyDayGroundColor, dayAmount);

        sun.material.opacity = smooth01((sunHeight + 0.03) / 0.12);
        moon.material.opacity = smooth01((moonHeight + 0.03) / 0.12) * (1 - dayAmount * 0.72);
        stars.material.opacity = clamp01(nightAmount * 0.82);

        lightingState.version++;
        lightingState.timeOfDay = timeOfDay;
        lightingState.dayAmount = dayAmount;
        lightingState.nightAmount = nightAmount;
        lightingState.horizonWarmth = horizonWarmth;
        lightingState.lightLevel = THREE.MathUtils.clamp(0.16 + dayAmount * 0.86 + nightAmount * 0.18, 0.16, 1.08);
        lightingState.sunColor.copy(sunLight.color);
        lightingState.moonColor.copy(moonColor);
        lightingState.skyColor.copy(skyLight.color);
        lightingState.groundColor.copy(skyLight.groundColor);
        lightingState.fogColor.copy(scene.fog.color);
        lightingState.sunIntensity = sunLight.intensity;
        lightingState.moonIntensity = moonLight.intensity;
        lightingState.skyIntensity = skyLight.intensity;
    }

    function update(deltaSeconds, focusPositions = null, options = {}) {
        const updateShadowFocus = options.updateShadowFocus !== false;
        elapsedSeconds = (elapsedSeconds + deltaSeconds) % cycleDurationSeconds;
        const timeOfDay = elapsedSeconds / cycleDurationSeconds;

        updateCelestialPositions(timeOfDay, focusPositions, updateShadowFocus);

        accumulatedLightUpdate += deltaSeconds;
        if (accumulatedLightUpdate >= updateInterval) {
            accumulatedLightUpdate = 0;
            updateLighting(timeOfDay);
        }

        if (manualShadowUpdates && sunLight.castShadow) {
            accumulatedShadowUpdate += deltaSeconds;
            if (updateShadowFocus && (shadowFocusChanged || accumulatedShadowUpdate >= shadowUpdateInterval)) {
                renderedShadowSignature = '';
                requestShadowUpdate();
                accumulatedShadowUpdate = 0;
                shadowFocusChanged = false;
            } else if (!updateShadowFocus && accumulatedShadowUpdate >= shadowUpdateInterval) {
                renderedShadowSignature = '';
                accumulatedShadowUpdate = 0;
            }
        }
    }

    function dispose() {
        scene.remove(sunLight, sunLight.target, moonLight, moonLight.target, skyLight, sun, moon, stars);
        sunTexture.dispose();
        moonTexture.dispose();
        sun.material.dispose();
        moon.material.dispose();
        stars.geometry.dispose();
        stars.material.dispose();
    }

    update(0);
    requestShadowUpdate();

    function getLightingState() {
        return lightingState;
    }

    return { update, dispose, getLightingState, requestShadowUpdate, prepareRenderForFocus, prepareSharedRenderForFocuses };
}
