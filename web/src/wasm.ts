/**
 * The JavaScript half of the WebAssembly seam.
 *
 * Read this together with `crates/sketch-route-wasm/src/lib.rs`. The two files
 * share a hand-written ABI with no generated glue between them, so a change to
 * the slot layout on one side has to be made on the other in the same commit.
 *
 * Every value crossing the boundary is an f64 in a buffer allocated by
 * `alloc_f64`, which guarantees the eight-byte alignment a `Float64Array` view
 * over WebAssembly memory requires.
 *
 * **Views over `memory.buffer` detach whenever WebAssembly memory grows.** Any
 * call into the module can grow it, so this file never holds a typed array
 * across a call; it takes a fresh view immediately before reading or writing.
 * That is the single rule that keeps this module free of the intermittent
 * "detached ArrayBuffer" failure that hand-written glue usually collects.
 */

/** Mirrors the `SLOT_*` constants in the Rust wrapper. */
const RESULT = {
  TOTAL_F64: 0,
  STATUS: 1,
  LENGTH_M: 2,
  COST: 3,
  CHECKPOINTS_SKIPPED: 4,
  CHECKPOINTS_TOTAL: 5,
  MEAN_DEV_M: 6,
  MAX_DEV_M: 7,
  MEAN_MISS_M: 8,
  MAX_MISS_M: 9,
  FRECHET_M: 10,
  CORRIDOR_SHARE: 11,
  LENGTH_RATIO: 12,
  POINT_COUNT: 13,
  START_SNAP_M: 14,
  GOAL_SNAP_M: 15,
  HEADER_F64: 16,
} as const;

/** Mirrors the `STATUS_*` constants. Index is the code the engine returns. */
const STATUS_MESSAGE = [
  'ok',
  'That line is too short to follow.',
  'Nothing routable within reach of where the line starts.',
  'Nothing routable within reach of where the line ends.',
  'No paths anywhere near that line.',
  'Nothing connects along that line.',
  'The map data went away. Try drawing again.',
] as const;

export const PROFILE = {
  walk: 0,
  hike: 1,
  run: 2,
  gravel: 3,
  road: 4,
} as const;

export type ProfileName = keyof typeof PROFILE;

export interface LatLng {
  lat: number;
  lng: number;
}

export interface MatchParams {
  profile: ProfileName;
  /** The user-facing slider. 0 is a shortest-path router; higher hugs the line. */
  strictness: number;
  corridorWidthM: number;
  /** Douglas-Peucker tolerance in metres, applied inside the engine. */
  simplifyToleranceM: number;
}

export interface RouteMetrics {
  meanDeviationM: number;
  maxDeviationM: number;
  meanMissM: number;
  maxMissM: number;
  frechetM: number;
  corridorShare: number;
  lengthRatio: number;
}

export interface MatchedRoute {
  geometry: LatLng[];
  lengthM: number;
  cost: number;
  checkpointsSkipped: number;
  checkpointsTotal: number;
  /** How far the start of the line was moved to reach the network, in metres. */
  startSnapM: number;
  /** The same for the end of the line. */
  goalSnapM: number;
  metrics: RouteMetrics;
}

/** A refusal from the engine, carrying the code so callers can branch on it. */
export class MatchFailure extends Error {
  constructor(readonly code: number) {
    super(STATUS_MESSAGE[code] ?? 'The matcher could not follow that line.');
    this.name = 'MatchFailure';
  }
}

interface Exports {
  memory: WebAssembly.Memory;
  alloc_f64(count: number): number;
  dealloc_f64(ptr: number, count: number): void;
  result_free(ptr: number): void;
  graph_demo_grid(lat: number, lng: number, spacingM: number, side: number): number;
  graph_free(handle: number): void;
  graph_node_count(handle: number): number;
  graph_edge_count(handle: number): number;
  match_sketch_ffi(
    handle: number,
    sketchPtr: number,
    pointCount: number,
    profile: number,
    strictness: number,
    corridorWidthM: number,
    simplifyToleranceM: number,
  ): number;
}

export class SketchRoute {
  private constructor(private readonly ex: Exports) {}

  /**
   * The module imports nothing, so it needs no import object and no runtime
   * shim. `instantiateStreaming` compiles as the bytes arrive.
   */
  static async load(url: string): Promise<SketchRoute> {
    const { instance } = await WebAssembly.instantiateStreaming(fetch(url), {});
    return new SketchRoute(instance.exports as unknown as Exports);
  }

  /** For tests and Node, where there is no `fetch` of a local file. */
  static async fromBytes(bytes: BufferSource): Promise<SketchRoute> {
    const { instance } = await WebAssembly.instantiate(bytes, {});
    return new SketchRoute(instance.exports as unknown as Exports);
  }

  /**
   * Build the synthetic street grid, centred on a point.
   *
   * Scaffolding until the OSM importer exists. See the Rust side for why it is
   * here rather than a real network.
   */
  demoGrid(centre: LatLng, spacingM = 100, side = 24): Graph {
    const handle = this.ex.graph_demo_grid(centre.lat, centre.lng, spacingM, side);
    return new Graph(this.ex, handle);
  }
}

export class Graph {
  #freed = false;

  constructor(
    private readonly ex: Exports,
    private readonly handle: number,
  ) {}

  get nodeCount(): number {
    return this.ex.graph_node_count(this.handle);
  }

  get edgeCount(): number {
    return this.ex.graph_edge_count(this.handle);
  }

  free(): void {
    if (this.#freed) return;
    this.#freed = true;
    this.ex.graph_free(this.handle);
  }

  /**
   * Find the route that follows `sketch` most closely.
   *
   * @throws {MatchFailure} when the engine cannot produce a route.
   */
  match(sketch: readonly LatLng[], params: MatchParams): MatchedRoute {
    if (sketch.length < 2) throw new MatchFailure(1);

    const count = sketch.length * 2;
    const ptr = this.ex.alloc_f64(count);
    try {
      // Fresh view: alloc_f64 may itself have grown memory.
      const input = new Float64Array(this.ex.memory.buffer, ptr, count);
      for (let i = 0; i < sketch.length; i++) {
        input[i * 2] = sketch[i].lat;
        input[i * 2 + 1] = sketch[i].lng;
      }

      const result = this.ex.match_sketch_ffi(
        this.handle,
        ptr,
        sketch.length,
        PROFILE[params.profile],
        params.strictness,
        params.corridorWidthM,
        params.simplifyToleranceM,
      );

      try {
        return this.#read(result);
      } finally {
        this.ex.result_free(result);
      }
    } finally {
      this.ex.dealloc_f64(ptr, count);
    }
  }

  #read(result: number): MatchedRoute {
    // Read the length first, then take one view of exactly that size. Two
    // separate views are needed because the total is not known until the first
    // slot has been read.
    const total = new Float64Array(this.ex.memory.buffer, result, 1)[RESULT.TOTAL_F64];
    const view = new Float64Array(this.ex.memory.buffer, result, total);

    const status = view[RESULT.STATUS];
    if (status !== 0) throw new MatchFailure(status);

    const pointCount = view[RESULT.POINT_COUNT];
    const geometry: LatLng[] = new Array(pointCount);
    for (let i = 0; i < pointCount; i++) {
      geometry[i] = {
        lat: view[RESULT.HEADER_F64 + i * 2],
        lng: view[RESULT.HEADER_F64 + i * 2 + 1],
      };
    }

    return {
      geometry,
      lengthM: view[RESULT.LENGTH_M],
      cost: view[RESULT.COST],
      checkpointsSkipped: view[RESULT.CHECKPOINTS_SKIPPED],
      checkpointsTotal: view[RESULT.CHECKPOINTS_TOTAL],
      startSnapM: view[RESULT.START_SNAP_M],
      goalSnapM: view[RESULT.GOAL_SNAP_M],
      metrics: {
        meanDeviationM: view[RESULT.MEAN_DEV_M],
        maxDeviationM: view[RESULT.MAX_DEV_M],
        meanMissM: view[RESULT.MEAN_MISS_M],
        maxMissM: view[RESULT.MAX_MISS_M],
        frechetM: view[RESULT.FRECHET_M],
        corridorShare: view[RESULT.CORRIDOR_SHARE],
        lengthRatio: view[RESULT.LENGTH_RATIO],
      },
    };
  }
}
