/**
 * Main-thread client for the matcher worker.
 *
 * Turns the worker's message passing into a promise, and drops stale results.
 * Dropping matters: redrawing while a match is still running is normal, and
 * without a request id the older search can land after the newer one and put
 * the wrong route on screen.
 */

import type { LatLng, MatchParams, MatchedRoute } from './wasm';
import type { WorkerResponse } from './matcher.worker';

export interface MatchOutcome {
  route: MatchedRoute;
  graph: { nodes: number; edges: number };
  elapsedMs: number;
}

export class Matcher {
  #worker: Worker;
  #nextId = 1;
  #pending = new Map<number, { resolve: (v: MatchOutcome) => void; reject: (e: Error) => void }>();

  constructor(private readonly wasmUrl: string) {
    this.#worker = new Worker(new URL('./matcher.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.#worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      const waiting = this.#pending.get(message.id);
      if (!waiting) return; // superseded by a newer sketch
      this.#pending.delete(message.id);
      if (message.type === 'ok') {
        waiting.resolve({ route: message.route, graph: message.graph, elapsedMs: message.elapsedMs });
      } else {
        waiting.reject(new Error(message.message));
      }
    };
  }

  /** Abandon every in-flight request. Called when a new stroke begins. */
  cancelPending(): void {
    this.#pending.clear();
  }

  match(sketch: LatLng[], params: MatchParams): Promise<MatchOutcome> {
    const id = this.#nextId++;
    return new Promise<MatchOutcome>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#worker.postMessage({
        type: 'match',
        id,
        wasmUrl: this.wasmUrl,
        sketch,
        params,
      });
    });
  }
}
