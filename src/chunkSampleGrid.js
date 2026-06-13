import { CONFIG } from './config.js';

const WATER_SURFACE_Y = CONFIG.terreno.nivelDoMar + (CONFIG.agua?.nivelSuperficie ?? 0);

function createSampleGridApi(gridStartX, gridStartZ, terrainStep, columnCount, rowCount, samples, heights) {
    function getIndex(x, z) {
        const column = Math.round((x - gridStartX) / terrainStep);
        const row = Math.round((z - gridStartZ) / terrainStep);
        if (column < 0 || column >= columnCount || row < 0 || row >= rowCount) return -1;

        const expectedX = gridStartX + column * terrainStep;
        const expectedZ = gridStartZ + row * terrainStep;
        if (Math.abs(expectedX - x) > 0.0001 || Math.abs(expectedZ - z) > 0.0001) return -1;
        return row * columnCount + column;
    }

    return {
        getHeight(x, z) {
            const index = getIndex(x, z);
            return index >= 0 ? heights[index] : undefined;
        },
        sampleHeightBilinear(x, z) {
            const x0 = Math.floor((x - gridStartX) / terrainStep) * terrainStep + gridStartX;
            const z0 = Math.floor((z - gridStartZ) / terrainStep) * terrainStep + gridStartZ;
            const x1 = x0 + terrainStep;
            const z1 = z0 + terrainStep;
            const h00 = this.getHeight(x0, z0);
            const h10 = this.getHeight(x1, z0);
            const h01 = this.getHeight(x0, z1);
            const h11 = this.getHeight(x1, z1);
            if (h00 === undefined || h10 === undefined || h01 === undefined || h11 === undefined) return undefined;

            const tx = (x - x0) / terrainStep;
            const tz = (z - z0) / terrainStep;
            const h0 = h00 + (h10 - h00) * tx;
            const h1 = h01 + (h11 - h01) * tx;
            return h0 + (h1 - h0) * tz;
        },
        sampleTerrainBilinear(x, z) {
            const x0 = Math.floor((x - gridStartX) / terrainStep) * terrainStep + gridStartX;
            const z0 = Math.floor((z - gridStartZ) / terrainStep) * terrainStep + gridStartZ;
            const x1 = x0 + terrainStep;
            const z1 = z0 + terrainStep;
            const s00 = this.getGridSampleExact(x0, z0);
            const s10 = this.getGridSampleExact(x1, z0);
            const s01 = this.getGridSampleExact(x0, z1);
            const s11 = this.getGridSampleExact(x1, z1);
            if (!s00 || !s10 || !s01 || !s11) return null;

            const tx = (x - x0) / terrainStep;
            const tz = (z - z0) / terrainStep;
            const mix = (a, b, t) => a + (b - a) * t;
            const mix2 = (a00, a10, a01, a11) => mix(mix(a00, a10, tx), mix(a01, a11, tx), tz);
            const waterCoverage = mix2(
                s00.water?.coverage ?? 0,
                s10.water?.coverage ?? 0,
                s01.water?.coverage ?? 0,
                s11.water?.coverage ?? 0
            );
            const sample = {
                x,
                z,
                height: mix2(s00.height, s10.height, s01.height, s11.height),
                weights: {
                    plains: mix2(s00.weights.plains, s10.weights.plains, s01.weights.plains, s11.weights.plains),
                    slopes: mix2(s00.weights.slopes, s10.weights.slopes, s01.weights.slopes, s11.weights.slopes),
                    mountains: mix2(s00.weights.mountains, s10.weights.mountains, s01.weights.mountains, s11.weights.mountains)
                },
                moisture: mix2(s00.moisture, s10.moisture, s01.moisture, s11.moisture),
                temperature: mix2(s00.temperature, s10.temperature, s01.temperature, s11.temperature)
            };

            const actualWaterDepth = Math.max(0, WATER_SURFACE_Y - sample.height);

            if (waterCoverage > 0.001 && actualWaterDepth > 0.001) {
                sample.water = {
                    kind: s00.water?.kind ?? s10.water?.kind ?? s01.water?.kind ?? s11.water?.kind ?? 'water',
                    coverage: waterCoverage,
                    depth: actualWaterDepth,
                    surfaceY: WATER_SURFACE_Y,
                    shore: mix2(
                        s00.water?.shore ?? 0,
                        s10.water?.shore ?? 0,
                        s01.water?.shore ?? 0,
                        s11.water?.shore ?? 0
                    ),
                    flowX: mix2(
                        s00.water?.flowX ?? 0,
                        s10.water?.flowX ?? 0,
                        s01.water?.flowX ?? 0,
                        s11.water?.flowX ?? 0
                    ),
                    flowZ: mix2(
                        s00.water?.flowZ ?? 0,
                        s10.water?.flowZ ?? 0,
                        s01.water?.flowZ ?? 0,
                        s11.water?.flowZ ?? 0
                    )
                };
            } else {
                sample.water = null;
            }

            return sample;
        },
        getGridSampleExact(x, z) {
            const index = getIndex(x, z);
            return index >= 0 ? samples[index] : null;
        },
        getSample(x, z) {
            return this.getGridSampleExact(x, z);
        }
    };
}

export function createChunkSampleGrid(startX, startZ, endX, endZ, terrainStep, sampleTerrain) {
    return createChunkSampleGridBuilder(startX, startZ, endX, endZ, terrainStep, sampleTerrain).finishNow();
}

export function createChunkSampleGridBuilder(startX, startZ, endX, endZ, terrainStep, sampleTerrain) {
    const gridStartX = startX - terrainStep;
    const gridStartZ = startZ - terrainStep;
    const columnCount = Math.floor((endX - startX) / terrainStep) + 3;
    const rowCount = Math.floor((endZ - startZ) / terrainStep) + 3;
    const samples = new Array(columnCount * rowCount);
    const heights = new Float32Array(columnCount * rowCount);
    const totalSamples = columnCount * rowCount;
    let nextIndex = 0;

    function stepNext() {
        if (nextIndex >= totalSamples) return true;

        const row = Math.floor(nextIndex / columnCount);
        const column = nextIndex - row * columnCount;
        const x = gridStartX + column * terrainStep;
        const z = gridStartZ + row * terrainStep;
        const sample = sampleTerrain(x, z);
        samples[nextIndex] = sample;
        heights[nextIndex] = sample.height;
        nextIndex++;
        return nextIndex >= totalSamples;
    }

    return {
        stepUntil(deadlineMs) {
            do {
                stepNext();
            } while (nextIndex < totalSamples && performance.now() < deadlineMs);

            return nextIndex >= totalSamples;
        },
        finishNow() {
            while (nextIndex < totalSamples) {
                stepNext();
            }
            return this.finish();
        },
        finish() {
            return createSampleGridApi(gridStartX, gridStartZ, terrainStep, columnCount, rowCount, samples, heights);
        }
    };
}
