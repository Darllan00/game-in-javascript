import * as THREE from 'three';
import { COLORS, getRenderQualityProfile } from './config.js';

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

document.body.appendChild(renderer.domElement);
