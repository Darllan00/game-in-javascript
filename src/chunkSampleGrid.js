export function createChunkSampleGrid(startX, startZ, endX, endZ, terrainStep, sampleTerrain) {
    const gridStartX = startX - terrainStep;
    const gridStartZ = startZ - terrainStep;
    const columnCount = Math.floor((endX - startX) / terrainStep) + 3;
    const rowCount = Math.floor((endZ - startZ) / terrainStep) + 3;
    const samples = new Array(columnCount * rowCount);
    const heights = new Float32Array(columnCount * rowCount);

    for (let row = 0; row < rowCount; row++) {
        const z = gridStartZ + row * terrainStep;
        for (let column = 0; column < columnCount; column++) {
            const x = gridStartX + column * terrainStep;
            const index = row * columnCount + column;
            const sample = sampleTerrain(x, z);
            samples[index] = sample;
            heights[index] = sample.height;
        }
    }

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
            const x0 = Math.floor(x / terrainStep) * terrainStep;
            const z0 = Math.floor(z / terrainStep) * terrainStep;
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
        getSample(x, z) {
            const index = getIndex(x, z);
            return index >= 0 ? samples[index] : null;
        }
    };
}
