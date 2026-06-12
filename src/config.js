import * as THREE from 'three';

export const CONFIG = {
    terreno: {
        tamanhoGrade: 50000,
        alturaOlhos: 2,
        tamanhoChunk: 32,
        distanciaChunks: 20,
        distanciaPreloadChunks: 1,
        bufferTransicaoChunksMovendo: 2,
        passoTerreno: 2,
        tempoGeracaoChunksMs: 3.5,
        tempoGeracaoChunksMovendoMs: 5.0,
        tempoGeracaoChunksMovendoFrameLentoMs: 3.0,
        chunksGeracaoPorTrocaMovendo: 10,
        distanciaChunksUrgentesMovendo: 12,
        tempoMontagemFilaChunksMs: 1.2,
        tempoMontagemFilaChunksMovendoMs: 0.6,
        lodChunks: [
            { distancia: 6, passoTerreno: 16 },
            { distancia: 8, passoTerreno: 16 },
            { distancia: 12, passoTerreno: 16 },
            { distancia: 9999, passoTerreno: 16 }
        ],
        macroSuperChunks: {
            ativo: true,
            tamanhoEmChunks: 128,
            passoTerreno: 512,
            esconderAteDistanciaChunks: 20,
            deslocamentoVertical: 0,
            tempoGeracaoMs: 8
        },
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
    carregamentoInicial: {
        duracaoMinimaMs: 1800,
        framesMinimos: 75,
        atualizacoesPorFrame: 2
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
        intervaloAtualizacaoMovendoMs: 650,
        distanciaMovendoChunks: 8,
        recuperacaoAposMovimentoMs: 120,
        intervaloAtualizacaoParadoMs: 100,
        tilesRecuperacaoParadoPorAtualizacao: 2,
        chunksPorAtualizacaoParado: 3,
        tilesMovendoPorAtualizacao: 2,
        tilesRemovidosPorFrame: 32,
        tempoGeracaoTilesMs: 3.0,
        distanciaChunks: 8,
        tufosPorChunk: 4800,
        tilesPorFrame: 1,
        segmentos: 3,
        alturaMin: 0.55,
        alturaMax: 0.75,
        larguraMin: 0.0575,
        larguraMax: 0.25,
        alturaMaximaTerreno: 36,
        intermediaria: {
            ativa: false,
            distanciaChunks: 14,
            tufosPorChunk: 900,
            tilesPorFrame: 2,
            segmentos: 1,
            alturaMin: 0.55,
            alturaMax: 0.9,
            larguraMin: 0.035,
            larguraMax: 0.18
        },
        distante: {
            ativa: false,
            modo: 'points',
            distanciaChunks: 20,
            tufosPorChunk: 70,
            tilesPorFrame: 3,
            segmentos: 1, 
            alturaMin: 0.65,
            alturaMax: 0.95,
            larguraMin: 0.65,
            larguraMax: 2.0
        }
    },
    arvores: {
        ativa: true,
        asset: 'assets/arvore.glb',
        distanciaChunks: 6,
        chunksPorFrame: 2,
        chunksPorFrameMovendo: 8,
        chunksPorFrameParado: 8,
        tentativasFilaPorFrame: 32,
        tentativasPorChunk: 4,
        maxPorChunk: 1,
        chancePorTentativa: 0.75,
        distanciaMinima: 6,
        raioBloqueio: 2.6,
        escalaMin: 0.85,
        escalaMax: 1.55,
        alturaMaximaTerreno: 34,
        pesoMaximoMontanha: 0.36,
        enterraNoTerreno: 0.7,
        lod: {
            ativo: true,
            asset: 'assets/arvore leve.glb',
            distanciaChunks: 16,
            esconderAteDistanciaChunks: 6,
            chunksPorFrame: 2,
            tentativasFilaPorFrame: 16,
            tamanhoSuperChunk: 8,
            escala: 1,
            enterraNoTerreno: 0.7,
            castShadow: false,
            receiveShadow: false
        },
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
