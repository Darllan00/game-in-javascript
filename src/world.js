import * as THREE from 'three';
import { COLORS, CONFIG, getRenderQualityProfile } from './config.js';

const renderQuality = getRenderQualityProfile();

export const scene = new THREE.Scene();
scene.background = COLORS.dia.clone();
scene.fog = new THREE.FogExp2(COLORS.dia.clone(), 0.0016);

export const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1500
);

export const renderer = new THREE.WebGLRenderer({ antialias: renderQuality.antialias });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, renderQuality.pixelRatioMax));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = CONFIG.iluminacao?.toneMapping === 'aces'
    ? THREE.ACESFilmicToneMapping
    : THREE.NoToneMapping;
renderer.toneMappingExposure = CONFIG.iluminacao?.exposicao ?? 1;
renderer.shadowMap.enabled = CONFIG.iluminacao?.sombras?.ativa === true;
renderer.shadowMap.type = CONFIG.iluminacao?.sombras?.tipo === 'hard'
    ? THREE.BasicShadowMap
    : THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = CONFIG.iluminacao?.sombras?.atualizacaoManual === true
    ? false
    : renderer.shadowMap.enabled;
renderer.shadowMap.needsUpdate = renderer.shadowMap.enabled;

document.body.appendChild(renderer.domElement);
