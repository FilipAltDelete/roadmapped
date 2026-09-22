# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

The Rust matching engine in `crates/sketch-route/` is written and tested, against a synthetic
grid: there is no OSM importer yet, so it has never seen real data. The client in `web/` draws a
line, sends it through `crates/sketch-route-wasm/` to that engine in a Web Worker, and renders the
route that comes back under the drawn line. The two halves are connected, which is new: the line
the app draws back is now a route, not the sketch.

Nothing has been opened on a phone. The engine's guarantees are verified through WebAssembly in
`web/test/engine.test.ts`, but no thumb has touched the drawing surface.

`ROADMAP.md` is the source of truth for scope and phasing.

The toolchain is Node and Rust. Flutter, Java, the Android SDK, Xcode, SideStore and the macOS CI
runner are all gone. See `docs/setup.md`.

## Commands

```sh
make install   # once, fetch the web client's dependencies
make dev       # run the app locally with hot reload
make host      # the same, reachable from a phone on the same WiFi
make wasm      # compile the engine to WebAssembly and copy it where the app fetches it
make test      # Rust and web tests
make eval      # score the matcher against the canonical sketches
make geojson   # same routes written to out/routes.geojson for viewing
make check     # rustfmt, clippy, tsc and eslint, exactly as CI runs them
make build     # production bundle into web/dist
```

Run one Rust test with `cargo test --manifest-path crates/sketch-route/Cargo.toml <name>`, and one
web test with `npm --prefix web test -- -t <name>`.

Node is pinned in `mise.toml` and duplicated in `.github/workflows/web.yml`. Change both together.

**`make eval` is not optional when touching the algorithm.** Capture its output before a change
and after, and put both in the commit message or the pull request. The four overall numbers are
mean deviation, worst deviation, mean length ratio, and corridor share.

## Naming

The application is **Roadmapped**. `ROADMAP.md` is the planning document and is unrelated to it.

The Rust crate stays `sketch-route`, because it names what the engine does rather than
what it ships inside.

## What this app is

A map application for exploration. The user draws a freehand line on the map with a finger, and the
app returns a real route on the path network that follows the drawn line as closely as possible.

**The central invariant: fidelity to the drawn line beats speed and distance.** Any suggestion that
optimizes for fastest or shortest route is wrong by definition. This governs routing costs,
off-route recovery during navigation, and export targets. When a change could improve speed at the
cost of line fidelity, fidelity wins.

## Architectural decisions already made

These were reached through explicit trade-off discussions. Do not silently revisit them.

- **The app is a web app, installed to the home screen, not a native iOS app.** This was a
  deliberate reversal. A free Apple Developer account signs a build for seven days, allows ten App
  IDs a week, has no TestFlight, and cannot build without macOS. A URL has none of those
  properties. The cost is background location, which the web does not have and will not get; that
  cost is priced into Phase 4 rather than argued with.
- **The matcher is Rust, compiled to WebAssembly, running in the browser on the user's phone.** Not
  TypeScript, not a server. It is a graph search over millions of edges where predictable
  performance matters, and on-device is what makes offline work in the field.
- **The search runs in a Web Worker, never on the main thread.** The performance targets are
  measured in seconds, which is far past the point where a browser reports a page as unresponsive.
  This is not an optimisation to apply later.
- **`crates/sketch-route` has no dependencies, deliberately.** It cross-compiles to anywhere, which
  is what made the pivot to WebAssembly cost nothing. Adding one needs a reason worth stating in
  the commit.
- **`crates/sketch-route-wasm` has no dependencies either, and deliberately does not use
  wasm-bindgen.** Every value crossing the boundary is an `f64`. Hand-written glue costs about
  eighty lines in `web/src/wasm.ts` and avoids a code generator that must be version-matched to a
  CLI, which is a standing CI failure. The two files are one ABI and are changed together.
- **The client is TypeScript with MapLibre GL JS.** The Flutter client was rewritten rather than
  compiled to web: `flutter build web` would have kept about nine hundred lines of Dart at the cost
  of a JS-interop map shim, a heavy renderer payload, and poor control over mobile gestures.
- **Map rendering is MapLibre GL JS**, with PMTiles for offline-capable tiles. PMTiles is better
  supported here than on native, where the protocol handler is a port rather than the reference
  implementation.
- **Valhalla in Docker is scaffolding for Phase 1 only.** It proves the idea via its map-matching
  endpoint, then gets retired once the Rust matcher beats it.
- **Keep the WebAssembly seam clean.** A native client, Swift or otherwise, would reuse
  `crates/sketch-route` unchanged through UniFFI. That property is what made this pivot cheap and
  is worth preserving whether or not it is ever used.

## Constraints from the web platform

These replace the free-tier Apple constraints entirely. They are design inputs, not future
paperwork.

- **No background location.** `watchPosition` stops firing the moment the page is backgrounded or
  the screen locks, and there is no API anywhere on the web that changes this: service workers
  cannot reach geolocation, and Periodic Background Sync is Chromium-only and gives no position.
  Navigation works with the screen on, held or mounted. In a pocket it stops.
- **A backgrounded tab can be discarded, not merely paused.** iOS reclaims memory from Safari
  aggressively, and the user may return to a fresh page load. Nothing may live only in memory:
  `web/src/store.ts` writes the sketch, the route and the camera to IndexedDB on every change.
  Every call there degrades to a no-op rather than throwing, because IndexedDB is unavailable in
  some private-browsing configurations and losing persistence must not mean losing the app.
- **The graph cannot be memory-mapped.** It loads into WebAssembly linear memory, and Safari will
  kill a tab long before the 4 GB address space is reached. Region size is bounded by what the
  phone tolerates, which is a number to measure early rather than assume.
- **Safari's edge-swipe back gesture eats strokes that start near the left edge.** Standalone mode
  removes it, which is why `apple-mobile-web-app-capable` is set and why the app asks to be added
  to the home screen. `touch-action: none` on the drawing overlay is what stops iOS treating a
  stroke as a scroll.
- **GPX export is still first-class**, but for a different reason. It was insurance against the
  app expiring in the field; nothing expires now. It stays because a route that cannot leave the
  app only works where the app works, and OsmAnd, Organic Maps and a watch are all downstream of
  it. `navigator.share({files})` reaches the real iOS share sheet.

## How the matcher works

The pipeline is simplify the sketch, build a corridor, place ordered checkpoints, run A*, score the
result. Module docs in `crates/sketch-route/src/` carry the reasoning; two properties are load
bearing and easy to break by accident.

**Cost is never below true geometric length.** Every factor in `cost.rs` is at least 1.0, which is
what keeps the A* heuristic admissible and the search optimal. This is why profile preferences are
written as penalties on what you want to avoid, never bonuses on what you want. A multiplier below
1.0 silently breaks the guarantee.

**Checkpoint progress lives in the A* state, not in the cost.** Cost alone cannot stop a route
cutting the corner off a U-bend, because the shortcut is genuinely cheaper. Carrying "how many
checkpoints collected so far" in the search state removes the shortcut from the space instead of
trying to out-price it. Skipping a checkpoint is allowed at a heavy penalty, so one unreachable
waypoint does not make a whole sketch unroutable.

Corridor pruning does the rest. Edges far from the line are dropped before the search begins, which
is both the performance story and a second guard against shortcuts.

**The ends of the line snap to the network, and the distance is reported.** A finger does not land
on a path, so refusing to route because a stroke began in a field is not useful. `Graph::
nearest_node` widens its search until it finds something, the drawn line is extended to meet those
nodes before the corridor is built (so the connecting leg is inside the corridor rather than pruned
away), and `MatchResult` carries `start_snap_m` and `goal_snap_m` so the interface can say the line
was moved. `CostParams::max_snap_m` caps it at 2 km: past that there is no sensible nearest path and
the honest failure is the right answer, which `snapping_stops_at_the_limit_rather_than_reaching_
across_the_map` holds in place. Scoring still runs against what the user drew, never the extended
line, so a long snap stays visible in the metrics instead of being explained away by them.

The integration tests in `crates/sketch-route/tests/follows_the_line.rs` encode the product promise.
The U-bend case is the headline: endpoints 900 m apart, correct answer 2700 m. If that test starts
passing for the wrong reason, or gets relaxed, the app no longer does the one thing it exists for.
`web/test/engine.test.ts` holds the same promise across the WebAssembly boundary, because a matcher
that is correct under `cargo test` and wrong in a browser is wrong.

## The client

`web/src/main.ts` is the drawing surface, with MapLibre rendering under it. `web/src/sketch.ts` is
the screen-space geometry, kept free of the DOM and of the map so it can be tested without a
browser. `web/src/ui/controls.ts` is the bottom panel, kept free of both for the same reason: the
map screen needs a WebGL context and cannot run in a test.

The basemap is a remote style over the network, so the app is online-only for now. PMTiles is what
makes it work offline, and that is still ahead.

**The synthetic grid is sized to the sketch, not to the viewport.** A fixed grid centred on the map
centre meant that drawing while zoomed out put the whole line outside the network, and the matcher
correctly but uselessly reported that there was no path near where the line started. `gridFor` in
`web/src/matcher.worker.ts` derives the grid from the sketch's bounding box, capped at 120 nodes a
side so a long line gets a coarser network rather than a hundred thousand nodes. All of this goes
away with the OSM importer.

**Draw mode is a deliberate toggle, not an inferred gesture.** With a map underneath, a drag means
either pan or draw and never both. Inferring it from pressure or timing feels clever and fails
constantly. While draw mode is on, MapLibre's own handlers are disabled and the overlay takes
pointer events; the rest of the time the overlay is transparent to them. The tests hold this in
place.

Unlike the Flutter plugin it replaced, `map.unproject` works in CSS pixels, so there is no
device-pixel-ratio correction to get wrong.

**MapLibre must be told where its own worker is, and says nothing when it is not.** `src/
maplibre-worker.ts` calls `setWorkerUrl`. MapLibre v6 stopped inlining its worker and derives the
URL from its own `import.meta.url`, returning an empty string when that is not an `http(s):` URL,
which under a bundler it never is. The failure is silent and total: the style, the TileJSON and the
sprite are fetched on the main thread and succeed, tiles and glyphs are fetched by the worker and
are therefore never requested, `load` never fires, no `error` is emitted, and the map is black. It
looks exactly like a map centred on unmapped ocean. The import must stay above the first map
construction, must be `?worker&url` rather than `?url` so Vite bundles the shared chunk the worker
imports, and is guarded by `web/test/maplibre-worker.test.ts`. Check it first if the map ever goes
black again, and check it after every MapLibre upgrade.

Map failures are surfaced rather than swallowed. `web/src/ui/banner.ts` checks for WebGL up front
and `map.on('error')` puts the message on screen, because a black rectangle is otherwise
indistinguishable from a dark basemap over water.

## Testing UI on real hardware

The unit tests pin down the logic, not the feel. Finger drawing cannot be validated on a desktop.
A mouse draws thin precise lines. A thumb draws fat jittery ones and covers the map while doing it.
Any change to draw interaction needs testing on a real phone before it counts as done.

`make host` serves the app on the local network so the phone can open it. Test it added to the home
screen, not in a Safari tab: the tab has a different viewport, a different gesture set, and an
address bar that resizes under a stroke.
