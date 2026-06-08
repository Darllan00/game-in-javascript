export function createPerformanceDiagnostics(renderer) {
    const timings = new Map();
    const counters = new Map();
    const frameTimes = [];
    let lastFrameTime = performance.now();

    function recordTiming(name, duration) {
        let entry = timings.get(name);
        if (!entry) {
            entry = { count: 0, total: 0, max: 0 };
            timings.set(name, entry);
        }
        entry.count++;
        entry.total += duration;
        entry.max = Math.max(entry.max, duration);
    }

    function measure(name, fn) {
        const start = performance.now();
        const result = fn();
        recordTiming(name, performance.now() - start);
        return result;
    }

    function increment(name, amount = 1) {
        counters.set(name, (counters.get(name) ?? 0) + amount);
    }

    function setCounter(name, value) {
        counters.set(name, value);
    }

    function frame() {
        const now = performance.now();
        frameTimes.push(now - lastFrameTime);
        lastFrameTime = now;
        if (frameTimes.length > 600) frameTimes.shift();
    }

    function percentile(values, ratio) {
        if (!values.length) return 0;
        const sorted = [...values].sort((a, b) => a - b);
        return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
    }

    function snapshot() {
        const timingSnapshot = {};
        for (const [name, entry] of timings) {
            timingSnapshot[name] = {
                count: entry.count,
                averageMs: entry.total / entry.count,
                maxMs: entry.max
            };
        }

        return {
            frameTimeMs: {
                average: frameTimes.length ? frameTimes.reduce((sum, value) => sum + value, 0) / frameTimes.length : 0,
                p95: percentile(frameTimes, 0.95),
                p99: percentile(frameTimes, 0.99)
            },
            renderer: {
                calls: renderer.info.render.calls,
                triangles: renderer.info.render.triangles,
                points: renderer.info.render.points,
                lines: renderer.info.render.lines,
                geometries: renderer.info.memory.geometries,
                textures: renderer.info.memory.textures
            },
            counters: Object.fromEntries(counters),
            timings: timingSnapshot
        };
    }

    const api = { frame, increment, measure, recordTiming, setCounter, snapshot };
    globalThis.__gamePerformance = api;
    return api;
}
