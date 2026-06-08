import * as THREE from 'three';
import { CONFIG } from './config.js';

const FULL_TURN = Math.PI * 2;
const SUN_SIZE = 340;
const MOON_SIZE = 240;

const tempColor = new THREE.Color();
const tempColorB = new THREE.Color();
const sunDirection = new THREE.Vector3();
const moonDirection = new THREE.Vector3();
const cameraWorldPosition = new THREE.Vector3();
const sunDayColor = new THREE.Color(0xfff2d2);
const sunHorizonColor = new THREE.Color(0xffa25f);
const skyDayColor = new THREE.Color(0x91c7ff);
const skyHorizonColor = new THREE.Color(0xffc38a);
const skyNightGroundColor = new THREE.Color(0x1c2230);
const skyDayGroundColor = new THREE.Color(0x5a5138);

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

export function createDayNightCycle(scene, camera) {
    const cycleConfig = CONFIG.cicloDiaNoite;
    const cycleDurationSeconds = cycleConfig.duracaoMinutos * 60;
    const updateInterval = 1 / cycleConfig.atualizacoesPorSegundo;
    const radius = cycleConfig.raioAstros;
    let elapsedSeconds = cycleDurationSeconds * 0.34;
    let accumulatedLightUpdate = updateInterval;

    const sunLight = new THREE.DirectionalLight(0xfff0cf, 1.25);
    sunLight.castShadow = false;

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

    function updateCelestialPositions(timeOfDay) {
        const sunAngle = timeOfDay * FULL_TURN - Math.PI / 2;
        const moonAngle = sunAngle + Math.PI;

        sunDirection.set(Math.cos(sunAngle) * 0.55, Math.sin(sunAngle), -0.58).normalize();
        moonDirection.set(Math.cos(moonAngle) * 0.55, Math.sin(moonAngle), 0.58).normalize();

        camera.getWorldPosition(cameraWorldPosition);
        sun.position.copy(cameraWorldPosition).addScaledVector(sunDirection, radius);
        moon.position.copy(cameraWorldPosition).addScaledVector(moonDirection, radius);
        stars.position.copy(cameraWorldPosition);

        sunLight.position.copy(cameraWorldPosition).addScaledVector(sunDirection, 120);
        sunLight.target.position.copy(cameraWorldPosition);
        moonLight.position.copy(cameraWorldPosition).addScaledVector(moonDirection, 120);
        moonLight.target.position.copy(cameraWorldPosition);
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

        moonLight.intensity = THREE.MathUtils.lerp(0.01, 0.18, nightAmount);
        skyLight.intensity = THREE.MathUtils.lerp(0.18, 0.76, dayAmount) + nightAmount * 0.08;
        skyLight.color.copy(skyDayColor).lerp(skyHorizonColor, horizonWarmth * 0.22);
        skyLight.groundColor.copy(skyNightGroundColor).lerp(skyDayGroundColor, dayAmount);

        sun.material.opacity = smooth01((sunHeight + 0.03) / 0.12);
        moon.material.opacity = smooth01((moonHeight + 0.03) / 0.12) * (1 - dayAmount * 0.72);
        stars.material.opacity = clamp01(nightAmount * 0.82);
    }

    function update(deltaSeconds) {
        elapsedSeconds = (elapsedSeconds + deltaSeconds) % cycleDurationSeconds;
        const timeOfDay = elapsedSeconds / cycleDurationSeconds;

        updateCelestialPositions(timeOfDay);

        accumulatedLightUpdate += deltaSeconds;
        if (accumulatedLightUpdate >= updateInterval) {
            accumulatedLightUpdate = 0;
            updateLighting(timeOfDay);
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

    return { update, dispose };
}
