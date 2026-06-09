import * as THREE from 'three';

export const CONFIG = {
    terreno: {
        tamanhoGrade: 50000,
        alturaOlhos: 2,
        tamanhoChunk: 32,
        distanciaChunks: 40,
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
        velocidade: 12,
        gravidade: 30,
        pulo: 150,
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
    },
    cicloDiaNoite: {
        duracaoMinutos: 1,
        atualizacoesPorSegundo: 12,
        raioAstros: 900,
        quantidadeEstrelas: 300
    },
    vento: {
        direcaoX: 0.85,
        direcaoZ: 0.35,
        velocidade: 1.2,
        forca: 0.42,
        frequencia: 0.085
    },
    grama: {
        ativa: true,
        ventoApenasParado: true,
        atualizarEnquantoMovendo: true,
        intervaloAtualizacaoMovendoMs: 8000,
        distanciaMovendoChunks: 2,
        recuperacaoAposMovimentoMs: 120,
        intervaloAtualizacaoParadoMs: 100,
        tilesRecuperacaoParadoPorAtualizacao: 2,
        chunksPorAtualizacaoParado: 3,
        tilesMovendoPorAtualizacao: 1,
        tilesRemovidosPorFrame: 24,
        distanciaChunks: 2,
        tufosPorChunk: 1000,
        tilesPorFrame: 1,
        segmentos: 3,
        alturaMin: 0.95,
        alturaMax: 1.75,
        larguraMin: 0.075,
        larguraMax: 0.75,
        alturaMaximaTerreno: 36,
        intermediaria: {
            ativa: true,
            distanciaChunks: 4,
            tufosPorChunk: 360,
            tilesPorFrame: 2,
            segmentos: 1,
            alturaMin: 0.8,
            alturaMax: 1.35,
            larguraMin: 0.12,
            larguraMax: 0.95
        },
        distante: {
            ativa: true,
            modo: 'points',
            distanciaChunks: 20,
            tufosPorChunk: 100,
            tilesPorFrame: 4,
            segmentos: 1, 
            alturaMin: 1.5,
            alturaMax: 1.5,
            larguraMin: 0.8,
            larguraMax: 6.0
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
