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
        tempoGeracaoChunksMovendoMs: 10.0,
        tempoGeracaoChunksMovendoFrameLentoMs: 0.35,
        chunksGeracaoPorTrocaMovendo: 20,
        distanciaChunksUrgentesMovendo: 8,
        tempoMontagemFilaChunksMs: 1.2,
        tempoMontagemFilaChunksMovendoMs: 0.35,
        lodChunks: [
            { distancia: 2, passoTerreno: 2 },
            { distancia: 6, passoTerreno: 4 },
            { distancia: 12, passoTerreno: 8 },
            { distancia: 9999, passoTerreno: 16 }
        ],
        nivelDoMar: 0
    },
    movimento: {
        velocidade: 25,
        gravidade: 30,
        pulo: 50,
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
        duracaoMinutos: 20,
        atualizacoesPorSegundo: 12,
        raioAstros: 900,
        quantidadeEstrelas: 300
    },
    vento: {
        direcaoX: 0.85,
        direcaoZ: 0.35,
        velocidade: 1.0,
        forca: 0.82,
        frequencia: 0.085
    },
    grama: {
        ativa: true,
        ventoApenasParado: true,
        atualizarEnquantoMovendo: true,
        intervaloAtualizacaoMovendoMs: 800,
        distanciaMovendoChunks: 10,
        recuperacaoAposMovimentoMs: 120,
        intervaloAtualizacaoParadoMs: 100,
        tilesRecuperacaoParadoPorAtualizacao: 2,
        chunksPorAtualizacaoParado: 4,
        tilesMovendoPorAtualizacao: 2,
        tilesRemovidosPorFrame: 24,
        tempoGeracaoTilesMs: 4.5,
        distanciaChunks: 16,
        tufosPorChunk: 7200,
        tilesPorFrame: 1,
        segmentos: 3,
        alturaMin: 0.55,
        alturaMax: 0.75,
        larguraMin: 0.00975,
        larguraMax: 0.25,
        alturaMaximaTerreno: 36,
        intermediaria: {
            ativa: false,
            distanciaChunks: 20,
            tufosPorChunk: 110,
            tilesPorFrame: 4,
            segmentos: 1,
            alturaMin: 0.8,
            alturaMax: 1.35,
            larguraMin: 0.12,
            larguraMax: 0.95
        },
        distante: {
            ativa: false,
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
    },
    arvores: {
        ativa: true,
        asset: 'assets/Untitled.glb',
        distanciaChunks: 12,
        chunksPorFrame: 2,
        chunksPorFrameMovendo: 8,
        chunksPorFrameParado: 8,
        tentativasFilaPorFrame: 24,
        tentativasPorChunk: 6,
        maxPorChunk: 1,
        chancePorTentativa: 1,
        distanciaMinima: 2,
        raioBloqueio: 1.3,
        escalaMin: 0.85,
        escalaMax: 1.55,
        alturaMaximaTerreno: 34,
        pesoMaximoMontanha: 0.36,
        enterraNoTerreno: 0.7,
        vento: {
            ativo: true,
            distanciaChunks: 1,
            forca: 0.48,
            velocidade: 0.9,
            frequencia: 0.08
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
