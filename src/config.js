import * as THREE from 'three';

export const CONFIG = {
    terreno: {
        tamanhoGrade: 500,
        alturaOlhos: 2
    },
    movimento: {
        velocidade: 15,
        gravidade: 30,
        pulo: 12
    },
    ciclo: {
        duracao: 1200,
        tempoInicial: 300,
        velocidadeTeste: 100,
        raioOrbita: 200
    }
};

export const COLORS = {
    dia: new THREE.Color(0x6bb8ff),
    noite: new THREE.Color(0x050510),
    crepusculo: new THREE.Color(0x4f5d8a),
    luzDia: new THREE.Color(0xfff5e6),
    luzNoite: new THREE.Color(0xb9c8ff),
    hemiCeuDia: new THREE.Color(0xffffff),
    hemiCeuNoite: new THREE.Color(0x0b1020),
    hemiChaoDia: new THREE.Color(0x2b3e2b),
    hemiChaoNoite: new THREE.Color(0x080814)
};