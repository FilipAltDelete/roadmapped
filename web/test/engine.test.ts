// @vitest-environment node
//
// Node rather than jsdom: this file touches no DOM, and it needs
// `import.meta.url` to be a real file URL so it can find the built engine.

/**
 * The WebAssembly seam, and the product promise behind it.
 *
 * `crates/sketch-route/tests/follows_the_line.rs` holds these guarantees in
 * Rust. This file holds them across the boundary, because a matcher that is
 * correct in a `cargo test` and wrong in a browser is wrong.
 *
 * Needs the engine built:
 *
 *   make wasm
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { Graph, MatchFailure, SketchRoute, type LatLng, type MatchParams } from '../src/wasm';

const WASM_PATH = fileURLToPath(
  new URL('../../target/wasm32-unknown-unknown/release/sketch_route_wasm.wasm', import.meta.url),
);

const BASE: LatLng = { lat: 59.3293, lng: 18.0686 };
const EARTH_RADIUS_M = 6371008.8;

/** The Rust `LatLng::from_local`, so tests can think in metres. */
function at(east: number, north: number): LatLng {
  return {
    lat: BASE.lat + (north / EARTH_RADIUS_M) * (180 / Math.PI),
    lng:
      BASE.lng +
      (east / (EARTH_RADIUS_M * Math.cos((BASE.lat * Math.PI) / 180))) * (180 / Math.PI),
  };
}

function metresBetween(a: LatLng, b: LatLng): number {
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const dLat = la2 - la1;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

const PARAMS: MatchParams = {
  profile: 'walk',
  strictness: 4,
  corridorWidthM: 75,
  simplifyToleranceM: 8,
};

let engine: SketchRoute;
let graph: Graph;

beforeAll(async () => {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    // Copied into a plain ArrayBuffer rather than passed straight through: a
    // Node Buffer is typed as possibly backed by a SharedArrayBuffer, which
    // `WebAssembly.instantiate` does not take.
    const file = readFileSync(WASM_PATH);
    bytes = new Uint8Array(file.byteLength);
    bytes.set(file);
  } catch {
    throw new Error(`The engine is not built. Run \`make wasm\`. Looked in ${WASM_PATH}`);
  }
  engine = await SketchRoute.fromBytes(bytes);
  graph = engine.demoGrid(BASE, 100, 24);
});

describe('the graph', () => {
  it('builds the street grid the sketches are matched against', () => {
    expect(graph.nodeCount).toBe(24 * 24);
    expect(graph.edgeCount).toBeGreaterThan(2000);
  });
});

describe('following the line', () => {
  it('goes round a U-bend instead of across it', () => {
    // The headline case. The endpoints are close together and the drawn line is
    // not, so every shortest-path router gets this wrong and looks reasonable
    // doing it. If this test starts passing for the wrong reason, or gets
    // relaxed, the app no longer does the one thing it exists for.
    const sketch = [at(-650, 650), at(-650, -650), at(650, -650), at(650, 650)];
    const endpointGap = metresBetween(sketch[0], sketch[sketch.length - 1]);
    expect(endpointGap).toBeCloseTo(1300, -2);

    const route = graph.match(sketch, PARAMS);

    expect(route.lengthM).toBeGreaterThan(3500);
    expect(route.metrics.corridorShare).toBeGreaterThan(0.95);
    expect(route.metrics.maxDeviationM).toBeLessThan(75);
    expect(route.checkpointsSkipped).toBe(0);
  });

  it('staircases a diagonal rather than taking two straight legs', () => {
    // A shortest-path router picks an L, which is the same length on a grid and
    // nothing like the drawn line.
    const route = graph.match([at(-600, -600), at(600, 600)], PARAMS);
    expect(route.metrics.meanDeviationM).toBeLessThan(80);
    expect(route.metrics.corridorShare).toBeGreaterThan(0.9);
  });

  it('does not quietly skip a section of the sketch', () => {
    // Deviation alone cannot catch this: a route covering half the line scores
    // a perfect deviation. Only the reverse measure notices.
    const route = graph.match([at(-600, 0), at(0, 0), at(0, 600)], PARAMS);
    expect(route.metrics.maxMissM).toBeLessThan(120);
  });
});

describe('snapping to the network', () => {
  // The grid is 24 nodes at 100 m, so it spans -1150 m to +1150 m about BASE.
  it('pulls a line starting off the grid onto it rather than refusing', () => {
    const route = graph.match([at(-1600, 0), at(600, 0)], PARAMS);

    expect(route.startSnapM).toBeGreaterThan(300);
    expect(route.startSnapM).toBeLessThan(600);
    // The far end was already on a node, give or take half a cell.
    expect(route.goalSnapM).toBeLessThan(80);
    expect(route.geometry.length).toBeGreaterThan(1);
  });

  it('still refuses a line with no path within reach', () => {
    // Sydney, from a graph in Stockholm. There is no nearest path worth having.
    const faraway = [
      { lat: -33.8688, lng: 151.2093 },
      { lat: -33.87, lng: 151.21 },
    ];
    expect(() => graph.match(faraway, PARAMS)).toThrow(MatchFailure);
  });
});

describe('the strictness slider', () => {
  it('visibly reshapes the route', () => {
    const sketch = [at(-650, -650), at(0, 300), at(650, -650)];
    const loose = graph.match(sketch, { ...PARAMS, strictness: 0 });
    const exact = graph.match(sketch, { ...PARAMS, strictness: 12 });

    // At zero the matcher degenerates into a shortest-path router inside the
    // corridor, which is what this project exists not to be.
    expect(loose.metrics.meanDeviationM).toBeGreaterThan(exact.metrics.meanDeviationM);
    expect(exact.metrics.corridorShare).toBeGreaterThan(loose.metrics.corridorShare);
  });
});

describe('profiles', () => {
  it('road bikes refuse what walkers accept', () => {
    // Every street in the demo grid is paved and routable on a road bike, so
    // the profile must at least change the cost, not the reachability.
    const sketch = [at(-600, 0), at(600, 0)];
    const walk = graph.match(sketch, { ...PARAMS, profile: 'walk' });
    const road = graph.match(sketch, { ...PARAMS, profile: 'road' });
    expect(road.cost).not.toBeCloseTo(walk.cost, 0);
  });
});

describe('failures arrive as values, not traps', () => {
  it('refuses a sketch with nothing to follow', () => {
    expect(() => graph.match([at(0, 0)], PARAMS)).toThrow(MatchFailure);
    try {
      graph.match([at(0, 0)], PARAMS);
    } catch (error) {
      expect((error as MatchFailure).code).toBe(1);
    }
  });

  it('refuses a line drawn nowhere near the network', () => {
    const faraway = [
      { lat: -33.8688, lng: 151.2093 },
      { lat: -33.87, lng: 151.21 },
    ];
    expect(() => graph.match(faraway, PARAMS)).toThrow(MatchFailure);
  });

  it('reports a freed graph rather than reading freed memory', () => {
    const scratch = engine.demoGrid(BASE, 100, 6);
    scratch.free();
    try {
      scratch.match([at(-100, 0), at(100, 0)], PARAMS);
      expect.unreachable('a freed graph must not match');
    } catch (error) {
      expect((error as MatchFailure).code).toBe(6);
    }
  });
});

describe('memory', () => {
  // Generous timeout: this is thousands of real A* searches, and the point is
  // the memory figure, not the speed. A tight default made it flaky.
  it('does not leak across repeated matches', { timeout: 30_000 }, () => {
    // Every match allocates a sketch buffer and a result buffer on the Rust
    // side. If either is not freed, a user redrawing all afternoon runs the tab
    // out of memory, and on iOS that is a silent reload.
    const sketch = [at(-650, 650), at(-650, -650), at(650, -650), at(650, 650)];
    graph.match(sketch, PARAMS);

    // @ts-expect-error reaching past the public surface on purpose, to watch it
    const memory = graph.ex.memory as WebAssembly.Memory;
    const before = memory.buffer.byteLength;
    // WebAssembly memory grows in 64 KiB pages, so a leak of a few hundred
    // bytes per match shows up well inside this many iterations.
    for (let i = 0; i < 1500; i++) graph.match(sketch, PARAMS);
    expect(memory.buffer.byteLength).toBe(before);
  });
});
