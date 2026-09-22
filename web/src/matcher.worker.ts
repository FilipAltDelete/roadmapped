/**
 * The matcher, off the main thread.
 *
 * A* over a corridor is the one genuinely expensive thing this app does, and on
 * the main thread it would freeze the map and the drawn line while it ran. The
 * roadmap's performance targets are measured in seconds, which is far past the
 * point where a browser reports the page as unresponsive, so the search lives
 * in a Worker from the start rather than being moved into one later.
 *
 * The worker owns the WebAssembly instance and the graph. Neither ever crosses
 * back to the main thread: only sketches go in and routes come out.
 */

import { Graph, MatchFailure, SketchRoute, type LatLng, type MatchParams } from './wasm';

export interface MatchRequest {
  type: 'match';
  id: number;
  wasmUrl: string;
  sketch: LatLng[];
  params: MatchParams;
}

export type WorkerRequest = MatchRequest;

export type WorkerResponse =
  | { type: 'ok'; id: number; route: import('./wasm').MatchedRoute; graph: { nodes: number; edges: number }; elapsedMs: number }
  | { type: 'error'; id: number; code: number; message: string };

let engine: SketchRoute | null = null;
let graph: Graph | null = null;
let graphKey = '';

/**
 * Roughly a city block, and the spacing the matcher was tuned against.
 *
 * Only honoured while the resulting grid stays under {@link MAX_SIDE}. A long
 * sketch gets a coarser network rather than a hundred thousand nodes.
 */
const TARGET_SPACING_M = 100;
const MIN_SIDE = 8;
const MAX_SIDE = 120;

/** Room around the sketch, so the corridor is never clipped by the grid edge. */
const MARGIN_M = 600;

const EARTH_RADIUS_M = 6371008.8;

/**
 * The synthetic network to match against, sized to the sketch.
 *
 * Scaffolding, and the shape of the scaffolding matters: a fixed-size grid
 * centred on the viewport meant that drawing while zoomed out put the whole
 * sketch outside the network, and the matcher correctly but uselessly reported
 * that there was no path near where the line started. Deriving the grid from
 * the sketch means a drawn line always has something to match against, at
 * whatever zoom it was drawn.
 *
 * This all goes away with the OSM importer, which replaces the generated grid
 * with a real path network. The sizing logic goes with it.
 */
function gridFor(sketch: LatLng[]): { centre: LatLng; spacingM: number; side: number } {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const p of sketch) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  }

  const centre: LatLng = { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };
  const degToM = (Math.PI / 180) * EARTH_RADIUS_M;
  const heightM = (maxLat - minLat) * degToM;
  const widthM = (maxLng - minLng) * degToM * Math.cos((centre.lat * Math.PI) / 180);

  // Square, because the grid is square. The longer side sets the extent.
  const extentM = Math.max(widthM, heightM) + MARGIN_M * 2;
  const side = Math.min(MAX_SIDE, Math.max(MIN_SIDE, Math.round(extentM / TARGET_SPACING_M) + 1));
  return { centre, spacingM: extentM / (side - 1), side };
}

async function ensureGraph(wasmUrl: string, sketch: LatLng[]): Promise<Graph> {
  engine ??= await SketchRoute.load(wasmUrl);

  const { centre, spacingM, side } = gridFor(sketch);
  // Rebuilding costs milliseconds, but not rebuilding costs nothing at all, and
  // adjusting the strictness slider re-runs the same sketch repeatedly.
  const key = `${centre.lat.toFixed(4)}|${centre.lng.toFixed(4)}|${spacingM.toFixed(0)}|${side}`;
  if (graph && key === graphKey) return graph;

  graph?.free();
  graph = engine.demoGrid(centre, spacingM, side);
  graphKey = key;
  return graph;
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type !== 'match') return;

  try {
    const g = await ensureGraph(request.wasmUrl, request.sketch);
    const startedAt = performance.now();
    const route = g.match(request.sketch, request.params);
    const response: WorkerResponse = {
      type: 'ok',
      id: request.id,
      route,
      graph: { nodes: g.nodeCount, edges: g.edgeCount },
      elapsedMs: performance.now() - startedAt,
    };
    self.postMessage(response);
  } catch (error) {
    const failure: WorkerResponse = {
      type: 'error',
      id: request.id,
      code: error instanceof MatchFailure ? error.code : -1,
      message: error instanceof Error ? error.message : 'The matcher failed unexpectedly.',
    };
    self.postMessage(failure);
  }
};
