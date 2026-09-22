/**
 * Roadmapped.
 *
 * Draw a line on the map with your finger and the app finds the real route that
 * follows that line most closely. Not the fastest route, not the shortest. The
 * one shaped like what you drew.
 *
 * This module owns the drawing interaction and the map. The matching engine is
 * `crates/sketch-route`, compiled to WebAssembly and called through a Worker.
 */

// maplibre-gl v6 has no default export; everything is named.
import { MapLibreMap, type LngLatLike } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

// Must come before any map is constructed. See the file for what breaks without
// it, and how quietly.
import './maplibre-worker';

import { Matcher } from './matcher';
import { isDeliberateStroke, simplify, toPathData, type Point } from './sketch';
import { shareGpx, toGpx } from './gpx';
import { clearSession, loadSession, requestPersistence, saveSession } from './store';
import { ControlPanel, type PanelState, type RouteSummary } from './ui/controls';
import { createInstallHint } from './ui/install-hint';
import { clearBanner, hasWebgl, showBanner } from './ui/banner';
import type { LatLng, ProfileName } from './wasm';
import './style.css';

/**
 * A dark basemap, so the drawn line and the route are the brightest things on
 * screen. Free and keyless, which matters because this app has no backend and
 * is not going to grow one just to serve tiles. PMTiles replaces it when
 * offline arrives.
 */
const STYLE_URL = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

const SKETCH_SOURCE = 'sketch-source';
const ROUTE_SOURCE = 'route-source';

const DEFAULT_CAMERA = { centre: { lat: 59.3293, lng: 18.0686 }, zoom: 14 };

/** Pixels a finger must move before another point is captured. */
const MIN_POINT_SPACING_PX = 2;

/** Douglas-Peucker tolerance in pixels, for the live path only. */
const LIVE_SIMPLIFY_PX = 2;

/** Douglas-Peucker tolerance in metres, applied inside the engine. */
const ENGINE_SIMPLIFY_M = 8;

const CORRIDOR_WIDTH_M = 75;

class App {
  #map: MapLibreMap;
  // Resolved against the page before it is handed to the Worker. A relative
  // URL sent as a string would be resolved against the worker script instead,
  // which lives under /assets/, and the engine would 404 in a built bundle
  // while working perfectly in dev.
  #matcher = new Matcher(
    new URL(`${import.meta.env.BASE_URL}sketch-route.wasm`, location.href).href,
  );
  #panel: ControlPanel;

  #overlay: SVGSVGElement;
  #livePath: SVGPathElement;

  /**
   * Draw mode is an explicit toggle, not an inferred gesture.
   *
   * A drag over a map has to mean either pan or draw, never both. Guessing from
   * pressure or timing feels clever and fails constantly, so the user says
   * which they mean and the map's own handlers are switched off while drawing.
   */
  #drawing = false;

  /** The stroke in progress, in CSS pixels relative to the map container. */
  #stroke: Point[] = [];
  #activePointer: number | null = null;

  #sketch: LatLng[] = [];
  #route: LatLng[] = [];
  #profile: ProfileName = 'walk';
  #strictness = 4;
  #busy = false;
  #error: string | null = null;
  #summary: RouteSummary | null = null;
  #restrictTimer: number | undefined;

  #root: HTMLElement;

  constructor(root: HTMLElement) {
    this.#root = root;

    // Recorded on the root element so `document.getElementById('app').dataset`
    // answers "how far did the map get?" without a debugger.
    root.dataset.map = 'starting';

    if (!hasWebgl()) {
      showBanner(root, {
        title: 'This browser cannot draw the map.',
        detail:
          'MapLibre needs WebGL and no context could be created. In Chrome, check ' +
          'chrome://gpu and that hardware acceleration is on; on a headless or ' +
          'software-rendered desktop, WebGL is often disabled outright.',
      });
      root.dataset.map = 'no-webgl';
    }

    const mapContainer = document.createElement('div');
    mapContainer.className = 'map';
    root.append(mapContainer);

    this.#map = new MapLibreMap({
      container: mapContainer,
      style: STYLE_URL,
      center: [DEFAULT_CAMERA.centre.lng, DEFAULT_CAMERA.centre.lat],
      zoom: DEFAULT_CAMERA.zoom,
      attributionControl: { compact: true },
      // A finger that has started drawing must not also rotate the map, and
      // pitch has no meaning for a line drawn flat on the ground.
      pitchWithRotate: false,
      dragRotate: false,
    });

    this.#overlay = createOverlay();
    this.#livePath = this.#overlay.querySelector('.live-stroke')!;
    root.append(this.#overlay);

    this.#panel = new ControlPanel(this.#panelState(), {
      onStrictnessChange: (value) => this.#setStrictness(value),
      onProfileChange: (value) => this.#setProfile(value),
      onExport: () => void this.#exportGpx(),
    });

    root.append(buildToolbar({
      onToggleDraw: () => this.#setDrawing(!this.#drawing),
      onClear: () => this.#clearAll(),
    }), this.#panel.element);

    // Only appears on iOS, outside standalone mode, and only until dismissed.
    const installHint = createInstallHint();
    if (installHint) root.append(installHint);

    this.#bindPointer();

    this.#map.on('load', () => {
      this.#root.dataset.map = 'loaded';
      void this.#onMapLoad();
    });

    // The first painted frame. If the state stays at 'loaded' and never reaches
    // 'idle', the style parsed but nothing was rendered.
    this.#map.once('idle', () => {
      this.#root.dataset.map = 'idle';
      clearBanner(this.#root);
    });

    // Without this, a failed style, a blocked tile host or a lost WebGL context
    // all look the same from the outside: black.
    this.#map.on('error', (event) => {
      const detail = event.error?.message ?? String(event.error ?? 'unknown');
      console.error('[roadmapped] map error:', event.error);
      this.#root.dataset.map = 'error';
      showBanner(this.#root, { title: 'The map failed to load.', detail });
    });
  }

  async #onMapLoad(): Promise<void> {
    // A soft line for what was drawn, a bold one for the route that followed
    // it. Seeing both is how a user judges whether the app did its job.
    this.#map.addSource(SKETCH_SOURCE, { type: 'geojson', data: emptyLine() });
    this.#map.addLayer({
      id: 'sketch-line',
      type: 'line',
      source: SKETCH_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#9BA3AE',
        'line-width': 5,
        'line-opacity': 0.55,
        'line-dasharray': [1.5, 1.5],
      },
    });

    this.#map.addSource(ROUTE_SOURCE, { type: 'geojson', data: emptyLine() });
    this.#map.addLayer({
      id: 'route-halo',
      type: 'line',
      source: ROUTE_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#FF4B4B', 'line-width': 16, 'line-opacity': 0.22 },
    });
    this.#map.addLayer({
      id: 'route-line',
      type: 'line',
      source: ROUTE_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#FF4B4B', 'line-width': 4.5 },
    });

    await this.#restore();
    void requestPersistence();
  }

  // -------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------

  #bindPointer(): void {
    this.#overlay.addEventListener('pointerdown', (event) => {
      if (!this.#drawing || this.#activePointer !== null) return;
      event.preventDefault();
      this.#activePointer = event.pointerId;
      this.#overlay.setPointerCapture(event.pointerId);
      this.#startStroke(this.#toLocal(event));
    });

    this.#overlay.addEventListener('pointermove', (event) => {
      if (event.pointerId !== this.#activePointer) return;
      event.preventDefault();
      this.#appendPoint(this.#toLocal(event));
    });

    const finish = (event: PointerEvent) => {
      if (event.pointerId !== this.#activePointer) return;
      this.#activePointer = null;
      void this.#endStroke();
    };
    this.#overlay.addEventListener('pointerup', finish);
    this.#overlay.addEventListener('pointercancel', finish);
  }

  #toLocal(event: PointerEvent): Point {
    const rect = this.#overlay.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  #startStroke(p: Point): void {
    // A new stroke replaces the old route rather than extending it. Appending
    // would join the two with a straight segment the user never drew, which is
    // both wrong and invisible until the route comes back looking absurd.
    this.#matcher.cancelPending();
    this.#stroke = [p];
    this.#sketch = [];
    this.#route = [];
    this.#summary = null;
    this.#error = null;
    this.#setLine(SKETCH_SOURCE, []);
    this.#setLine(ROUTE_SOURCE, []);
    this.#render();
  }

  #appendPoint(p: Point): void {
    // Thin as we capture. A finger emits far more points than the shape needs.
    const last = this.#stroke[this.#stroke.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < MIN_POINT_SPACING_PX) return;
    this.#stroke.push(p);
    this.#livePath.setAttribute('d', toPathData(this.#stroke));
    this.#panel.update(this.#panelState());
  }

  async #endStroke(): Promise<void> {
    const raw = this.#stroke;
    this.#stroke = [];
    this.#livePath.setAttribute('d', '');

    if (!isDeliberateStroke(raw)) {
      this.#render();
      return;
    }

    // Unproject works in CSS pixels against the map canvas, so unlike the
    // Flutter plugin there is no device-pixel-ratio correction to get wrong.
    this.#sketch = simplify(raw, LIVE_SIMPLIFY_PX).map((p) => {
      const ll = this.#map.unproject([p.x, p.y]);
      return { lat: ll.lat, lng: ll.lng };
    });
    this.#setLine(SKETCH_SOURCE, this.#sketch);

    await this.#runMatch();
  }

  async #runMatch(): Promise<void> {
    if (this.#sketch.length < 2) return;

    this.#busy = true;
    this.#error = null;
    this.#render();

    try {
      const { route } = await this.#matcher.match(
        this.#sketch,
        {
          profile: this.#profile,
          strictness: this.#strictness,
          corridorWidthM: CORRIDOR_WIDTH_M,
          simplifyToleranceM: ENGINE_SIMPLIFY_M,
        },
      );
      this.#route = route.geometry;
      this.#summary = {
        lengthM: route.lengthM,
        meanDeviationM: route.metrics.meanDeviationM,
        corridorShare: route.metrics.corridorShare,
        checkpointsSkipped: route.checkpointsSkipped,
        snapM: Math.max(route.startSnapM, route.goalSnapM),
      };
      this.#setLine(ROUTE_SOURCE, this.#route);
    } catch (error) {
      // A failed match must not strand the interface with a spinner that never
      // stops and a route that never appears. The drawn line stays on screen,
      // because it is still what the user asked for.
      this.#route = [];
      this.#summary = null;
      this.#setLine(ROUTE_SOURCE, []);
      this.#error = error instanceof Error ? error.message : 'Could not follow that line.';
    } finally {
      this.#busy = false;
      this.#render();
      void this.#persist();
    }
  }

  // -------------------------------------------------------------------------
  // Controls
  // -------------------------------------------------------------------------

  #setDrawing(drawing: boolean): void {
    this.#drawing = drawing;
    this.#overlay.classList.toggle('active', drawing);

    // The map must not pan, zoom or rotate while a line is being drawn.
    const handlers = [
      this.#map.dragPan,
      this.#map.scrollZoom,
      this.#map.boxZoom,
      this.#map.doubleClickZoom,
      this.#map.touchZoomRotate,
      this.#map.keyboard,
    ];
    for (const handler of handlers) drawing ? handler.disable() : handler.enable();

    document.querySelector('.tool-draw')?.classList.toggle('active', drawing);
    this.#render();
  }

  #setStrictness(value: number): void {
    this.#strictness = value;
    this.#render();
    // Re-running on every slider step would queue a search per pixel of travel.
    // Waiting for the thumb to settle keeps the slider responsive and still
    // reshapes the route while the user is watching it.
    clearTimeout(this.#restrictTimer);
    this.#restrictTimer = setTimeout(() => void this.#runMatch(), 180) as unknown as number;
  }

  #setProfile(value: ProfileName): void {
    this.#profile = value;
    this.#render();
    void this.#runMatch();
  }

  #clearAll(): void {
    this.#matcher.cancelPending();
    this.#stroke = [];
    this.#sketch = [];
    this.#route = [];
    this.#summary = null;
    this.#error = null;
    this.#livePath.setAttribute('d', '');
    this.#setLine(SKETCH_SOURCE, []);
    this.#setLine(ROUTE_SOURCE, []);
    this.#render();
    void clearSession();
  }

  async #exportGpx(): Promise<void> {
    if (this.#route.length < 2) return;
    const name = `Roadmapped ${new Date().toISOString().slice(0, 10)}`;
    try {
      await shareGpx(toGpx(this.#route, { name }), name);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      this.#error = 'Could not export that route.';
      this.#render();
    }
  }

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------

  #panelState(): PanelState {
    return {
      drawing: this.#drawing,
      strictness: this.#strictness,
      profile: this.#profile,
      pointCount: this.#stroke.length > 0 ? this.#stroke.length : this.#sketch.length,
      busy: this.#busy,
      route: this.#summary,
      error: this.#error,
    };
  }

  #render(): void {
    this.#panel.update(this.#panelState());
  }

  #setLine(source: string, points: readonly LatLng[]): void {
    const src = this.#map.getSource(source) as { setData?(data: unknown): void } | undefined;
    src?.setData?.(points.length > 1 ? lineString(points) : emptyLine());
  }

  async #persist(): Promise<void> {
    const centre = this.#map.getCenter();
    await saveSession({
      sketch: this.#sketch,
      route: this.#route,
      profile: this.#profile,
      strictness: this.#strictness,
      camera: { centre: { lat: centre.lat, lng: centre.lng }, zoom: this.#map.getZoom() },
    });
  }

  async #restore(): Promise<void> {
    const session = await loadSession();
    if (!session) return;

    this.#profile = session.profile;
    this.#strictness = session.strictness;
    this.#sketch = session.sketch;
    this.#route = session.route;
    this.#map.jumpTo({
      center: [session.camera.centre.lng, session.camera.centre.lat] as LngLatLike,
      zoom: session.camera.zoom,
    });
    this.#setLine(SKETCH_SOURCE, this.#sketch);
    this.#setLine(ROUTE_SOURCE, this.#route);

    // The stored route has no metrics with it, so rather than show stale
    // numbers the sketch is matched again. It is the same search the user
    // already waited for once, and it costs milliseconds.
    if (this.#sketch.length > 1) await this.#runMatch();
    else this.#render();
  }
}

// ---------------------------------------------------------------------------
// DOM scaffolding
// ---------------------------------------------------------------------------

function createOverlay(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'draw-overlay');

  // A wide translucent halo under a crisp stroke, so the line reads against
  // both pale streets and dark parks.
  for (const cls of ['live-halo', 'live-stroke']) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('class', cls);
    svg.append(path);
  }
  const halo = svg.querySelector('.live-halo')!;
  const stroke = svg.querySelector('.live-stroke')!;
  // Keep the halo following the stroke without a second path-data write.
  new MutationObserver(() => halo.setAttribute('d', stroke.getAttribute('d') ?? '')).observe(
    stroke,
    { attributes: true, attributeFilter: ['d'] },
  );
  return svg;
}

function buildToolbar(callbacks: { onToggleDraw(): void; onClear(): void }): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'toolbar';

  const draw = document.createElement('button');
  draw.type = 'button';
  draw.className = 'tool tool-draw';
  draw.title = 'Draw a route';
  draw.setAttribute('aria-label', 'Draw a route');
  draw.innerHTML = ICON_DRAW;
  draw.addEventListener('click', callbacks.onToggleDraw);

  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'tool tool-clear';
  clear.title = 'Clear';
  clear.setAttribute('aria-label', 'Clear the route');
  clear.innerHTML = ICON_CLEAR;
  clear.addEventListener('click', callbacks.onClear);

  bar.append(draw, clear);
  return bar;
}

const ICON_DRAW =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17c4 0 4-10 8-10s4 10 8 10"/></svg>';
const ICON_CLEAR =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>';

function lineString(points: readonly LatLng[]): GeoJSON.Feature<GeoJSON.LineString> {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: points.map((p) => [p.lng, p.lat]) },
  };
}

function emptyLine(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

const root = document.getElementById('app');
if (root) new App(root);
