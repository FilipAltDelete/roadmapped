/**
 * Tell MapLibre where its own worker lives.
 *
 * Imported for its side effect, and imported before any map is constructed,
 * because MapLibre reads this URL when it spins up its worker pool.
 *
 * # Why this file exists
 *
 * MapLibre v6 stopped inlining its worker. It now derives the worker's URL from
 * the `import.meta.url` of its own module and bails out to an empty string when
 * that is not an `http(s):` URL. Under a bundler it never is, so the worker is
 * never created.
 *
 * Nothing throws. The style JSON, the TileJSON and the sprite are all fetched on
 * the main thread and appear to succeed. Tiles and glyphs are fetched by the
 * worker, so they are simply never requested. The result is a black map on which
 * `load` never fires and no `error` event is ever emitted, which is
 * indistinguishable from a map centred on unmapped ocean.
 *
 * `?worker&url` makes Vite bundle the worker together with the shared chunk it
 * imports and hand back a URL. A plain `?url` would not: it would copy the one
 * file and leave its sibling import dangling.
 *
 * `test/maplibre-worker.test.ts` guards this, because the failure is silent.
 */

import { setWorkerUrl } from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

setWorkerUrl(maplibreWorkerUrl);
