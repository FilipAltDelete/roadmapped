/**
 * A guard against the quietest bug this app has had.
 *
 * MapLibre v6 resolves its worker URL from its own `import.meta.url` and
 * silently yields an empty string under a bundler, which leaves the map black
 * with no error, no `load` event and no failed request to find. `src/
 * maplibre-worker.ts` sets the URL explicitly; this checks that it took.
 *
 * The assertion is deliberately about the URL being non-empty rather than about
 * its exact shape, because the shape differs between dev and a build. Empty is
 * the bug.
 */

import { describe, expect, it } from 'vitest';
import { getWorkerUrl } from 'maplibre-gl';

describe('the MapLibre worker URL', () => {
  it('is empty before anything sets it, which is the trap', () => {
    // Documents the upstream default. If this ever starts failing, MapLibre has
    // fixed the bailout and the workaround can be reconsidered.
    expect(getWorkerUrl()).toBe('');
  });

  it('is set once the app configures it', async () => {
    await import('../src/maplibre-worker');
    expect(getWorkerUrl()).not.toBe('');
    expect(getWorkerUrl()).toMatch(/maplibre-gl-worker/);
  });
});
