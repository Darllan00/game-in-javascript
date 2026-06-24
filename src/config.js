import * as THREE from 'three';

export const CONFIG = {
    terreno: {
        tamanhoGrade: 50000,
        alturaOlhos: 2,
        tamanhoChunk: 32,
        distanciaChunks: 40,
        distanciaPreloadChunks: 1,
        bufferTransicaoChunksMovendo: 2,
        distanciaSuperChunksCobertura: 20,
        prioridadeSuperChunksCobertura: 10,
        passoTerreno: 2,
        tempoGeracaoChunksMs: 3.5,
        tempoGeracaoChunksMovendoMs: 5.0,
        tempoGeracaoChunksMovendoFrameLentoMs: 3.0,
        chunksGeracaoPorTrocaMovendo: 12,
        distanciaChunksUrgentesMovendo: 10,
        tempoMontagemFilaChunksMs: 1.2,
        tempoMontagemFilaChunksMovendoMs: 0.6,
        saiaBordas: {
            ativa: false,
            profundidade: 1.25,
            passoMaximo: 2
        },
        lodChunks: [
            { distancia: 9999, passoTerreno: 2 }
        ],
        macroSuperChunks: {
            ativo: true,
            renderizar: false,
            tamanhoEmChunks: 128,
            passoTerreno: 512,
            adaptativo: true,
            passoTerrenoMedio: 256,
            passoTerrenoMontanha: 128,
            amostrasRugosidade: 5,
            rugosidadeMedia: 28,
            rugosidadeMontanha: 7,
            esconderAteDistanciaChunks: 20,
            deslocamentoVertical: 0,
            tempoGeracaoMs: 8
        },
        mapaDados: {
            ativo: true,
            tamanhoTileChunks: 16,
            amostrasPorEixo: 7,
            tempoGeracaoMs: 70,
            prioridadeRugosidadeMedia: 28,
            prioridadeRugosidadeAlta: 70
        },
        nivelDoMar: 0
    },
    agua: {
        ativa: true,
        distanciaChunks: 20,
        chunksPorFrame: 2,
        intervaloAtualizacaoMs: 350,
        passoMalha: 2.0,
        expansaoBordaMalha: 1,
        coberturaBordaMalha: 0.42,
        profundidadeVisualBorda: 0.22,
        fisica: {
            multiplicadorMovimento: 0.55,
            gravidade: 5.5,
            arrastoVertical: 3.6,
            velocidadeSubida: 5.8,
            velocidadeQuedaMaxima: 4.8,
            margemEntrada: 0.18
        },
        passoTerrenoBordas: 2,
        distanciaRefinoBordasChunks: 8,
        amostrasRefinoBordas: 5,
        raioRefinoBordasChunks: 0,
        elevacaoSuperficie: -0.08,
        nivelSuperficie: -3.0,
        nivelMaximoSuperficie: 0,
        profundidadeMaximaDeformacao: 48,
        folgaTerrenoAcimaAgua: 0.16,
        profundidadeMinimaBorda: 0.18,
        margemTerrenoAcimaSuperficie: 0.24,
        barranco: {
            bloquearVegetacaoCobertura: 0.08,
            bloquearVegetacaoInclinacao: 0.028,
            areiaAteInclinacao: 0.62
        },
        rios: {
            ativo: true,
            familias: 3,
            espacamento: 820,
            larguraMin: 18,
            larguraMax: 56,
            margemSuave: 26,
            larguraBarranco: 34,
            alturaBarranco: 2.2,
            forcaBarranco: 0.92,
            alturaMaximaCorte: 7.5,
            meandro: 230,
            inicioFadeAltitude: -0.8,
            alturaMaxima: 0,
            encaixeMargemAltura: 0.28,
            amostrasLeito: 3,
            profundidadeMin: 2.8,
            profundidadeMax: 18,
            densidade: 0.42
        },
        lagos: {
            ativo: true,
            tamanhoCelula: 980,
            chance: 0.42,
            raioMin: 150,
            raioMax: 430,
            margemSuave: 48,
            alturaMaxima: 0,
            rugosidadeMaxima: 3.4,
            encaixeMargemAltura: 0.24,
            profundidadeMin: 4,
            profundidadeMax: 28,
            larguraBarranco: 42,
            alturaBarranco: 1.8,
            forcaBarranco: 0.88,
            alturaMaximaCorte: 6.2,
            conectarAosRios: true,
            chanceConectarRio: 0.82,
            distanciaConexaoRio: 320
        },
        mares: {
            ativo: true,
            comprimentoConexaoRios: 3600,
            raioMin: 520,
            raioMax: 920,
            proporcaoAlong: 1.28,
            proporcaoAcross: 0.82,
            margemSuave: 110,
            profundidadeMin: 10,
            profundidadeMax: 28,
            larguraBarranco: 72,
            alturaBarranco: 2.4,
            forcaBarranco: 0.96,
            alturaMaximaCorte: 9.5
        },
        material: {
            transparenciaRasa: 0.58,
            transparenciaFunda: 0.82,
            opacidadeMinimaSombra: 0,
            opacidadeSombraSuperficie: 0.18,
            opacidadeExtraSombraSuperficie: 0.18,
            afastamentoSombraSuperficie: 0.018,
            velocidadeOnda: 0.92,
            amplitudeOnda: 0.6,
            reflexoCeu: 0.42,
            brilhoSol: 1.65,
            brilhoLua: 0.75,
            espuma: 0.2,
            contrasteProfundidade: 1.08
        },
        efeitoSubmerso: {
            ativo: true,
            opacidade: 0.38,
            opacidadeProfunda: 0.82,
            profundidadeEscurecimento: 9,
            pulso: 0.035
        }
    },
    movimento: {
        velocidade: 15,
        gravidade: 30,
        pulo: 20,
        alturaMaximaPasso: 1.35
    },
    mecanicas: {
        jogador: {
            vidaMaxima: 100,
            raioColisao: 0.55,
            alturaColisao: 2.0
        },
        agachar: {
            multiplicadorVelocidade: 0.42,
            alturaOlhos: 1.18,
            multiplicadorAlturaHitbox: 0.62,
            velocidadeAfundarAgua: 2.8
        },
        afogamento: {
            tempoSeguro: 10,
            danoPorSegundo: 12.5,
            margemCabeca: 0.08
        },
        queda: {
            alturaSegura: 42,
            danoPorMetro: 4.5,
            danoMaximo: 100
        },
        arco: {
            niveis: 5,
            tempoPorNivel: 0.5,
            velocidades: [46, 64, 84, 108, 145],
            danos: [15, 25, 37.5, 50, 67.5],
            gravidade: 13,
            tempoVida: 11,
            maxFlechasAtivas: 32,
            raioColisao: 0.18,
            distanciaSpawn: 1.05,
            tempoCravadaNoTerreno: 10
        },
        dash: {
            multiplicadorVelocidade: 3,
            duracao: 0.24,
            cooldown: 2.4
        }
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
    iluminacao: {
        toneMapping: 'aces',
        exposicao: 1.05,
        sombras: {
            ativa: true,
            tipo: 'soft',
            tamanhoMapa: 1024,
            distancia: 110,
            distanciaLuz: 320,
            profundidade: 620,
            bias: -0.00018,
            normalBias: 0.045,
            atualizacaoManual: true,
            atualizacaoMs: 140,
            focoGrade: 8,
            terrenoRecebe: true,
            terrenoProjeta: true,
            arvoresRecebem: true,
            arvoresProjetam: true
        }
    },
    cicloDiaNoite: {
        duracaoMinutos: 10,
        atualizacoesPorSegundo: 12,
        raioAstros: 900,
        quantidadeEstrelas: 300
    },
    carregamentoInicial: {
        duracaoMinimaMs: 1800,
        duracaoMaximaMs: 10000,
        framesMinimos: 75,
        atualizacoesPorFrame: 2,
        tempoTerrenoProximoMs: 8,
        tempoVegetacaoMs: 6,
        distanciaGramaChunks: 2,
        distanciaArvoresChunks: 3
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
        distanciaMovendoChunks: 6,
        recuperacaoAposMovimentoMs: 120,
        intervaloAtualizacaoParadoMs: 100,
        tilesRecuperacaoParadoPorAtualizacao: 2,
        chunksPorAtualizacaoParado: 3,
        tilesMovendoPorAtualizacao: 2,
        tilesRemovidosPorFrame: 32,
        tempoGeracaoTilesMs: 3.0,
        distanciaChunks: 8,
        tufosPorChunk: 2800,
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
        raioColisaoTronco: 1.05,
        alturaColisaoTronco: 8.0,
        escalaMin: 1.25,
        escalaMax: 1.75,
        alturaMaximaTerreno: 34,
        pesoMaximoMontanha: 0.36,
        enterraNoTerreno: 5.0,
        lod: {
            ativo: false,
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

export const CONFIG_STORAGE_KEY = 'mundo3d-config-overrides';

export const CONFIG_CONTROLS = [
    {
        id: 'performance',
        label: 'Performance',
        controls: [
            { path: 'terreno.distanciaChunks', label: 'Distancia de terreno', type: 'number', min: 8, max: 120, step: 1, reload: true },
            { path: 'terreno.tempoGeracaoChunksMs', label: 'Terreno parado ms', type: 'number', min: 0.5, max: 20, step: 0.5, reload: true },
            { path: 'terreno.tempoGeracaoChunksMovendoMs', label: 'Terreno andando ms', type: 'number', min: 0.5, max: 20, step: 0.5, reload: true },
            { path: 'terreno.chunksGeracaoPorTrocaMovendo', label: 'Chunks urgentes andando', type: 'number', min: 1, max: 32, step: 1, reload: true },
            { path: 'renderizacao.qualidade', label: 'Qualidade render', type: 'select', options: ['low', 'balanced', 'high'], reload: true }
        ]
    },
    {
        id: 'world',
        label: 'Mundo',
        controls: [
            { path: 'agua.ativa', label: 'Agua', type: 'boolean', reload: true },
            { path: 'agua.distanciaChunks', label: 'Distancia agua', type: 'number', min: 0, max: 60, step: 1, reload: true },
            { path: 'grama.ativa', label: 'Grama', type: 'boolean', reload: true },
            { path: 'grama.distanciaChunks', label: 'Distancia grama', type: 'number', min: 0, max: 24, step: 1, reload: true },
            { path: 'grama.tufosPorChunk', label: 'Tufos por chunk', type: 'number', min: 0, max: 5000, step: 50, reload: true },
            { path: 'arvores.ativa', label: 'Arvores', type: 'boolean', reload: true },
            { path: 'arvores.distanciaChunks', label: 'Distancia arvores', type: 'number', min: 0, max: 32, step: 1, reload: true },
            { path: 'arvores.chunksPorFrameMovendo', label: 'Arvores andando/frame', type: 'number', min: 1, max: 24, step: 1, reload: true },
            { path: 'arvores.chunksPorFrameParado', label: 'Arvores parado/frame', type: 'number', min: 1, max: 24, step: 1, reload: true }
        ]
    },
    {
        id: 'lighting',
        label: 'Luz',
        controls: [
            { path: 'iluminacao.exposicao', label: 'Exposicao', type: 'number', min: 0.3, max: 2.2, step: 0.05, live: true },
            { path: 'iluminacao.sombras.ativa', label: 'Sombras', type: 'boolean', reload: true },
            { path: 'iluminacao.sombras.tamanhoMapa', label: 'Resolucao sombras', type: 'select-number', options: [512, 1024, 2048, 4096], reload: true },
            { path: 'iluminacao.sombras.distancia', label: 'Distancia sombras', type: 'number', min: 30, max: 260, step: 10, reload: true },
            { path: 'cicloDiaNoite.duracaoMinutos', label: 'Duracao dia/noite min', type: 'number', min: 1, max: 60, step: 1, reload: true }
        ]
    },
    {
        id: 'player',
        label: 'Jogador',
        controls: [
            { path: 'movimento.velocidade', label: 'Velocidade', type: 'number', min: 2, max: 40, step: 0.5, live: true },
            { path: 'movimento.pulo', label: 'Pulo', type: 'number', min: 4, max: 40, step: 0.5, live: true },
            { path: 'movimento.gravidade', label: 'Gravidade', type: 'number', min: 4, max: 80, step: 1, live: true },
            { path: 'mecanicas.dash.multiplicadorVelocidade', label: 'Forca dash', type: 'number', min: 1, max: 6, step: 0.25, live: true },
            { path: 'mecanicas.dash.cooldown', label: 'Cooldown dash', type: 'number', min: 0.2, max: 10, step: 0.1, live: true },
            { path: 'mecanicas.arco.tempoPorNivel', label: 'Tempo arco nivel', type: 'number', min: 0.1, max: 2, step: 0.05, live: true }
        ]
    }
];

export const CONFIG_DEFAULTS = JSON.parse(JSON.stringify(CONFIG));

export function getConfigValue(path, source = CONFIG) {
    return path.split('.').reduce((value, key) => value?.[key], source);
}

export function setConfigValue(path, value, target = CONFIG) {
    const parts = path.split('.');
    let cursor = target;
    for (let i = 0; i < parts.length - 1; i++) {
        cursor = cursor?.[parts[i]];
        if (!cursor) return false;
    }
    cursor[parts[parts.length - 1]] = value;
    return true;
}

function getControlByPath(path) {
    for (const section of CONFIG_CONTROLS) {
        const control = section.controls.find((item) => item.path === path);
        if (control) return control;
    }
    return null;
}

function normalizeConfigValue(control, value) {
    if (control.type === 'boolean') return Boolean(value);
    if (control.type === 'select') return control.options.includes(value) ? value : getConfigValue(control.path, CONFIG_DEFAULTS);
    if (control.type === 'select-number') {
        const numericValue = Number(value);
        return control.options.includes(numericValue) ? numericValue : getConfigValue(control.path, CONFIG_DEFAULTS);
    }
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return getConfigValue(control.path, CONFIG_DEFAULTS);
    return THREE.MathUtils.clamp(numericValue, control.min ?? -Infinity, control.max ?? Infinity);
}

export function readConfigOverrides() {
    if (typeof window === 'undefined') return {};
    try {
        const parsed = JSON.parse(window.localStorage.getItem(CONFIG_STORAGE_KEY) || '{}');
        return parsed && typeof parsed === 'object' && parsed.values ? parsed.values : {};
    } catch {
        return {};
    }
}

export function writeConfigOverrides(values) {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify({ values }));
    } catch {
        /* noop */
    }
}

export function setConfigOverride(path, value) {
    const control = getControlByPath(path);
    if (!control) return false;
    const values = readConfigOverrides();
    const normalized = normalizeConfigValue(control, value);
    const defaultValue = getConfigValue(path, CONFIG_DEFAULTS);
    if (normalized === defaultValue) {
        delete values[path];
    } else {
        values[path] = normalized;
    }
    writeConfigOverrides(values);
    return setConfigValue(path, normalized);
}

export function resetConfigOverrides() {
    if (typeof window !== 'undefined') {
        try {
            window.localStorage.removeItem(CONFIG_STORAGE_KEY);
        } catch {
            /* noop */
        }
    }
    for (const section of CONFIG_CONTROLS) {
        for (const control of section.controls) {
            setConfigValue(control.path, getConfigValue(control.path, CONFIG_DEFAULTS));
        }
    }
}

export function applyStoredConfigOverrides() {
    const overrides = readConfigOverrides();
    for (const [path, value] of Object.entries(overrides)) {
        const control = getControlByPath(path);
        if (!control) continue;
        setConfigValue(path, normalizeConfigValue(control, value));
    }
}

applyStoredConfigOverrides();
