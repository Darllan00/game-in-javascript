import { CONFIG } from './config.js';

const SNOW_GRASS_CUTOFF = 33.5;
const ROCK_GRASS_CUTOFF = 0.48;

export function canPlaceGrassOnSample(sample, terrainHeight = sample?.height) {
    if (!sample || terrainHeight === undefined) return false;
    if (terrainHeight < CONFIG.terreno.nivelDoMar + 0.04) return false;
    if (terrainHeight > Math.min(CONFIG.grama.alturaMaximaTerreno, SNOW_GRASS_CUTOFF)) return false;
    return sample.weights.mountains < ROCK_GRASS_CUTOFF;
}
