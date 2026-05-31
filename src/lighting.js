import * as THREE from 'three';
import { COLORS, CONFIG } from './config.js';

export function createLighting(scene) {
    const hemiLight = new THREE.HemisphereLight(
        COLORS.hemiCeuDia,
        COLORS.hemiChaoDia,
        0.25
    );
    scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight(COLORS.luzDia.clone(), 2.0);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 0.5;
    sunLight.shadow.camera.far = 400;
    sunLight.shadow.camera.left = -150;
    sunLight.shadow.camera.right = 150;
    sunLight.shadow.camera.top = 150;
    sunLight.shadow.camera.bottom = -150;
    sunLight.shadow.bias = -0.0005;
    sunLight.shadow.normalBias = 0.02;
    sunLight.shadow.autoUpdate = true;
    scene.add(sunLight);
    scene.add(sunLight.target);

    const moonLight = new THREE.DirectionalLight(COLORS.luzNoite.clone(), 0.9);
    moonLight.castShadow = false;
    scene.add(moonLight);
    scene.add(moonLight.target);

    const fillLight = new THREE.AmbientLight(0x8aa0d8, 0.12);
    scene.add(fillLight);

    const astroGeometry = new THREE.SphereGeometry(15, 32, 32);

    const sol = new THREE.Mesh(
        astroGeometry,
        new THREE.MeshBasicMaterial({ color: 0xffea00 })
    );
    scene.add(sol);

    const lua = new THREE.Mesh(
        astroGeometry,
        new THREE.MeshBasicMaterial({ color: 0xdde6ff })
    );
    scene.add(lua);

    return { hemiLight, sunLight, moonLight, fillLight, sol, lua };
}

export function updateLighting(scene, renderer, player, lights, tempoJogo) {
    const { hemiLight, sunLight, moonLight, fillLight, sol, lua } = lights;

    const angulo = (tempoJogo / CONFIG.ciclo.duracao) * Math.PI * 2;
    const sunHeight = Math.sin(angulo);
    const intensityDay = THREE.MathUtils.clamp(sunHeight * 3, 0, 1);

    const twilight = Math.pow(
        1 - Math.min(1, Math.abs(sunHeight) * 2),
        2
    );

    scene.background
        .copy(COLORS.noite)
        .lerp(COLORS.crepusculo, twilight * 0.55)
        .lerp(COLORS.dia, intensityDay);

    scene.fog.color
        .copy(COLORS.noite)
        .lerp(COLORS.crepusculo, twilight * 0.45)
        .lerp(COLORS.dia, intensityDay);

    const raioOrbita = CONFIG.ciclo.raioOrbita * 1.0;

    sol.position.set(
        player.position.x + Math.cos(angulo) * raioOrbita,
        player.position.y + Math.sin(angulo) * raioOrbita,
        player.position.z
    );

    lua.position.set(
        player.position.x + Math.cos(angulo + Math.PI) * raioOrbita,
        player.position.y + Math.sin(angulo + Math.PI) * raioOrbita,
        player.position.z
    );

    sunLight.position.copy(sol.position);
    sunLight.target.position.copy(player.position);

    moonLight.position.copy(lua.position);
    moonLight.target.position.copy(player.position);

    // O Sol só projeta sombra de verdade quando está acima do horizonte.
    sunLight.castShadow = true;

    sunLight.intensity =
        THREE.MathUtils.lerp(0.12, 2.0, intensityDay);

    moonLight.color.set(0xbfd6ff);
    moonLight.intensity =
        Math.max(
            0.45,
            THREE.MathUtils.lerp(
                1.25,
                0.25,
                intensityDay
            )
        ) + twilight * 0.25;

    fillLight.intensity =
        THREE.MathUtils.lerp(
            0.22,
            0.05,
            intensityDay
        ) + twilight * 0.25;

    hemiLight.color.copy(COLORS.hemiCeuNoite).lerp(COLORS.hemiCeuDia, intensityDay);
    hemiLight.groundColor.copy(COLORS.hemiChaoNoite).lerp(COLORS.hemiChaoDia, intensityDay);
    hemiLight.intensity = THREE.MathUtils.lerp(0.22, 0.48, intensityDay) + twilight * 0.12;

    renderer.toneMappingExposure = THREE.MathUtils.lerp(0.98, 1.12, intensityDay) + twilight * 0.03;

    sunLight.shadow.needsUpdate = true;
}