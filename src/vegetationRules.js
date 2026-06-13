import { CONFIG } from './config.js';

const SNOW_GRASS_CUTOFF = 33.5;
const ROCK_GRASS_CUTOFF = 0.48;
const WATER_CLEARANCE = CONFIG.agua?.folgaTerrenoAcimaAgua ?? 0.12;

export function canPlaceGrassOnSample(sample, terrainHeight = sample?.height) {
    if (!sample || terrainHeight === undefined) return false;
    if (sample.water?.depth > 0.04 && sample.water?.coverage > 0.12) return false;
    if (terrainHeight < CONFIG.terreno.nivelDoMar + WATER_CLEARANCE * 0.5) return false;
    if (terrainHeight > Math.min(CONFIG.grama.alturaMaximaTerreno, SNOW_GRASS_CUTOFF)) return false;
    return sample.weights.mountains < ROCK_GRASS_CUTOFF;
}

export function canPlaceTreeOnSample(sample) {
    const treeConfig = CONFIG.arvores ?? {};
    if (!sample) return false;
    if (sample.water?.depth > 0.08 && sample.water?.coverage > 0.1) return false;
    if (sample.height < CONFIG.terreno.nivelDoMar + WATER_CLEARANCE * 0.75) return false;
    if (sample.height > (treeConfig.alturaMaximaTerreno ?? 34)) return false;
    return sample.weights.mountains < (treeConfig.pesoMaximoMontanha ?? 0.36);
}
