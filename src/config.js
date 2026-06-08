import * as THREE from 'three';

export const CONFIG = {
    terreno: {
        tamanhoGrade: 50000,
        alturaOlhos: 2,
        tamanhoChunk: 32,
        distanciaChunks: 400,
        distanciaPreloadChunks: 1,
        passoTerreno: 2,
        tempoGeracaoChunksMs: 3.5,
        lodChunks: [
            { distancia: 2, passoTerreno: 2 },
            { distancia: 6, passoTerreno: 4 },
            { distancia: 12, passoTerreno: 8 },
            { distancia: 9999, passoTerreno: 16 }
        ],
        nivelDoMar: 0
    },
    movimento: {
        velocidade: 300,
        gravidade: 30,
        pulo: 200,
        alturaMaximaPasso: 1.35
    },
    renderizacao: {
        qualidade: 'balanced',
        perfis: {
            low: {
                antialias: false,
                pixelRatioMax: 1
            },
            balanced: {
                antialias: true,
                pixelRatioMax: 1.25
            },
            high: {
                antialias: true,
                pixelRatioMax: 2
            }
        }
    }
};

export function getRenderQualityProfile() {
    return CONFIG.renderizacao.perfis[CONFIG.renderizacao.qualidade]
        ?? CONFIG.renderizacao.perfis.balanced;
}

export const COLORS = {
    dia: new THREE.Color(0x6bb8ff)
};
