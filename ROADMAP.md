# Roadmap: Sketch-to-Route Exploration App (iPhone, as a web app)

> Draw a line on the map with your finger. The app turns it into a real, walkable or rideable
> route that follows your line as faithfully as the path network allows. Never the fastest
> route. Always the route that looks most like what you drew.

Target: iPhone, installed to the home screen from a URL.
Development machine: Linux.
Last updated: 2026-09-22

---

## 1. Vision and principles

**The drawn line is the intent.** Fidelity to the line beats speed, distance, and every
conventional notion of "optimal".

**Exploration over efficiency.** Prefer trails, footpaths, small roads, parks, waterfronts.
Penalize big roads and anything that feels like a commute.

**Honest about compromises.** When the route cannot follow the line, show the gap. Do not
silently reroute around it.

**Built for the field.** Offline-capable. Battery-conscious from day one.

**Non-goals:** car navigation, competing with Google Maps on speed, social features, live traffic.

App Store release is no longer a non-goal; it is simply not the distribution mechanism. The app is
a URL. Anyone who opens it has it.

---

## 2. Target and constraints

This project began as a native iOS app and was rewritten as a web app. The reason was the free
Apple Developer account, whose constraints shaped the whole of the original plan:

| Constraint | Value | Now |
| --- | --- | --- |
| Signed app lifetime | 7 days | Gone |
| Simultaneous sideloaded apps | 3 | Gone |
| New App IDs | 10 per 7 days | Gone |
| TestFlight | Not available | Irrelevant; the app is a link |
| App Store | Not available | Irrelevant |
| Building for iOS | Requires macOS and Xcode | Gone; it builds on Linux |

The seven-day expiry was the dangerous one, and it is worth being clear about what removing it
changed. The entire mitigation strategy around it disappeared with it: SideStore setup, on-device
re-signing, expiry warnings at day five, a bundle identifier that could not churn. That is roughly
a phase of work that no longer needs doing.

### What replaces them

The web platform has its own limits. These are design inputs now, and unlike the Apple ones they
cannot be paid away with a yearly fee.

| Constraint | Consequence |
| --- | --- |
| **No background location** | Navigation runs with the screen on. In a pocket it stops. Phase 4 is written around this. |
| **A backgrounded tab can be discarded** | Nothing lives only in memory. State is written to IndexedDB on every change. |
| **No memory-mapped graph** | The graph loads into WebAssembly linear memory. Region size is bounded by what Safari tolerates. |
| **WebAssembly is slower than native** | Roughly half speed on a pointer-chasing graph search. Single-threaded without COOP/COEP headers. |
| **Safari's edge-swipe eats strokes** | Standalone mode removes it. The app asks to be installed. |
| **Storage is granted, not guaranteed** | `navigator.storage.persist()` is requested. A refusal is survivable, not an error. |

**Background location is the real loss.** It is not restricted on the web, it is absent: service
workers cannot reach geolocation, and no API anywhere provides position while the page is
suspended. A phone in a pocket records nothing. This was an unverified assumption in the native
plan and is now a known no, which is at least a better thing to plan against.

---

## 3. The core idea: sketch-to-route

Unchanged by the platform. This section is about the algorithm, which does not care where it runs.

### Problem statement

- **Input:** a freehand polyline `P` drawn with a finger, a profile (walk / hike / bike), and a
  strictness value.
- **Output:** a route `R` on the path network that is contiguous, traversable under the profile,
  and minimizes deviation from `P`.

Two approaches. B gets a demo fast. C is the long-term core.

### B. Map-matching (Hidden Markov Model), the fast start

Treat the sketch as a noisy GPS trace. Hidden state = road segment. Emission probability = how
close the sketch point is to the segment. Transition probability = how well the network distance
between candidate segments matches the straight-line distance between sketch points. Viterbi finds
the most probable path.

This is Newson & Krumm (2009), already implemented in Valhalla `trace_route`, GraphHopper, and
OSRM `match`.

**This step has been overtaken.** The Rust matcher in section C was built first and works. Standing
Valhalla up now would be erecting the scaffolding after the building. See section 8.

### C. Corridor-constrained routing, the real engine

Build a corridor of width `W` (75 m) around `P`. Run A* on the path graph with a cost function that
charges for leaving the line:

```
cost(edge) = length(edge) * profile_multiplier(edge) * (1 + alpha * dist(edge, P) / W)
```

- `dist(edge, P)`: mean distance from the edge to the sketch.
- `alpha`: strictness. The user-facing slider, 0 to 12.
- Prune edges beyond roughly `3W` from `P`. This is what keeps the search fast.
- **Checkpoints, carried in the search state.** Drop one every `W` metres along `P`. The route must
  pass within radius `R` of each, in order. Cost alone cannot stop a route cutting the corner off a
  U-bend, because the shortcut is genuinely cheaper; carrying checkpoint progress in the A* state
  removes the shortcut from the search space instead of trying to out-price it. Skipping one is
  allowed at a heavy penalty, so a single unreachable waypoint does not make a sketch unroutable.
- `profile_multiplier`: the exploration preferences. Always at least 1.0, so cost never falls below
  geometric length and the A* heuristic stays admissible.

### Measuring "follows the line"

Every algorithm change is scored against a fixed set of sketches.

| Metric | What it catches |
| --- | --- |
| Mean and max distance route to sketch | General drift |
| Mean and max distance sketch to route | Parts of the sketch that were skipped |
| Discrete Frechet distance | Worst-case ordered deviation |
| Share of route length inside the corridor | How much of the route is on the line |
| Route length over sketch length | Detour detector, should sit near 1.0 |
| Number of gap segments | Places where no path could follow the line |

---

## 4. Architecture

| Layer | Choice | Why |
| --- | --- | --- |
| Map data | OpenStreetMap | Has the trails and footpaths exploration needs |
| Map rendering | MapLibre GL JS | Vector tiles, WebGL, the reference PMTiles integration |
| Tiles | PMTiles, fetched by range request | No tile server bill, works offline |
| Matching engine | **Rust**, compiled to WebAssembly | Performance, on-device, no server |
| Seam | Raw C ABI, hand-written glue | Every value crossing is an `f64`; a code generator would earn nothing |
| Threading | Web Worker | The search must never block the drawing surface |
| Client | **TypeScript** | Develops and runs anywhere, including the target |
| Storage | IndexedDB | No backend needed, and the platform may discard the page |

### Why a web app rather than native

Not because the web is the better platform for this. Native iOS would give background location, a
memory-mapped graph, and faster search. It would also require, on a free account, a seven-day
re-signing ritual, a macOS runner for every build, a bundle identifier that cannot change, and an
App ID budget. The daily loop would leave Linux.

The trade is real and was made with the loss understood: Phase 4 gets worse, everything else gets
better, and the project stops having a deployment problem.

### Why the matcher is Rust and on-device

A graph search over millions of edges is the wrong job for TypeScript. Rust gives predictable speed
with no garbage collection pauses, compiles to WebAssembly, and needs no server, which means it
works in airplane mode in a forest.

**`crates/sketch-route` has no dependencies.** That rule was written when the targets were iOS and
Android, and it is the reason this pivot cost nothing: the engine compiled to `wasm32` without a
single edit. Keep it.

### Why the seam has no bindgen

`crates/sketch-route-wasm` exposes `alloc_f64`, a graph handle, and one match function that returns
a flat `f64` buffer. `wasm-bindgen` would require a CLI pinned to the crate version, which is a
standing CI failure, to generate glue for a boundary that carries only numbers. The eighty lines in
`web/src/wasm.ts` are the other half of one ABI and change with it.

### Data model

```
Sketch   { id, points[(lat, lng, t_ms)], simplified_points[], created_at }
Route    { id, sketch_id, profile, strictness, geometry, edge_ids[],
           stats { length_m, mean_dev_m, max_dev_m, frechet_m, corridor_share, gaps[] },
           elevation[], surface_breakdown{} }
Gap      { from_idx, to_idx, reason: no_path | water | private | off_path_allowed }
```

Self-contained by design. No server IDs required to render a route.

---

## 5. Build and deploy

This used to be the hardest section. It is now four lines.

**Daily loop, entirely on Linux:**
Write Rust and TypeScript, `make dev`, iterate in seconds.

**On the phone:**
`make host`, open the printed URL over WiFi. Or push to `main`, which publishes to GitHub Pages.

**Installing:**
Share, then Add to Home Screen. No signature, no expiry, no cable, no Mac.

A Mac Mini was previously "the single purchase that most improves this project". It now buys
nothing this project needs.

---

## 6. Phases

Durations assume one developer working most of the week. Checkboxes reflect what is actually built.

### Phase 0: Prove the toolchain (done, except the phone)

- [x] Node and Rust on Linux, the app running in a browser.
- [x] Rust in the project through WebAssembly, called from TypeScript.
- [x] MapLibre rendering a map under the drawing surface.
- [x] The engine's guarantees verified across the WebAssembly boundary (`web/test/engine.test.ts`).
- [x] A working name. Bundle identifiers no longer exist to churn.
- [ ] **The app opened on the iPhone, added to the home screen, and drawn on with a thumb.**
- [ ] Measure, on the phone: match time, the graph size Safari tolerates, storage actually granted.
- [ ] Choose a development region and build a PMTiles extract for it.
- [ ] Write the evaluation set: 10 sketches over the region. Urban grid, river loop, forest trail,
  line crossing a lake, self-crossing loop, out-and-back, long straight road, dense city centre,
  coastal path, hilly park.

The background-location investigation that used to live here is deleted rather than done. The
answer is known and is no.

**Exit criteria:** the app runs from the home screen on the iPhone, drawing feels right under a
thumb, and the three numbers above are measured rather than assumed.

### Phase 1: Draw and match (largely done)

- [x] Draw mode toggle. Map gestures disabled while drawing, so a drag draws instead of panning.
- [x] Capture pointer events, thin with Douglas-Peucker.
- [x] Render the sketch as a soft line under a bold route line.
- [x] Send the sketch to the matcher and draw what comes back.
- [x] Strictness slider wired end to end.
- [x] Profiles wired end to end: walk, hike, run, gravel, road.
- [x] Stats panel: distance, deviation, share of the route on the line, gap count.
- [x] Clear and redraw.
- [x] Evaluation harness: run the canonical sketches, print the metrics table.
- [x] GPX export through the share sheet.
- [ ] **Test drawing on the actual phone, with an actual thumb, outdoors, in sunlight.** A finger
  covers the map and draws fat jittery lines. Whatever was tuned on a desktop will be wrong.
- [ ] A real path network under it. Everything above runs against a synthetic grid.

**Exit criteria:** a demo video shot on the iPhone. All 10 sketches scored over a real extract. A
written list of failure cases, which become the Phase 2 requirements.

### Phase 2: The Rust matcher (the engine is built; the data is not)

- [x] Corridor construction and edge pruning.
- [x] Cost function: deviation, profile, admissible by construction.
- [x] Checkpoint fallback, carried in the search state.
- [x] Self-crossing and out-and-back sketches handled correctly.
- [ ] **OSM importer.** Load a pedestrian and bicycle graph from an extract. This is the single
  largest piece of unbuilt work in the project and everything real depends on it.
- [ ] Gap handling. When no path exists in the corridor, either insert a flagged off-path straight
  segment for hiking, or take the nearest detour in the city. Return gaps so the UI can draw them
  differently.
- [ ] Graph packed into a compact format, fetched and held in WebAssembly memory.
- [ ] Performance targets, measured on the phone.

| Sketch length | Target (native, as originally written) | Web target |
| --- | --- | --- |
| 20 km | under 1 second | to be set from a phone measurement |
| 100 km | under 3 seconds | to be set from a phone measurement |

The native numbers are kept for reference. Setting the web ones before measuring would be
inventing them.

**Exit criteria:** the matcher runs over a real extract with no network, and the strictness slider
visibly reshapes the route.

### Phase 3: Exploration and export (4-8 weeks)

- [x] Profiles: walk, hike, run, gravel, road, each with its own preferences.
- [x] **GPX export via the iOS share sheet.** The bridge into OsmAnd, Organic Maps, Komoot, Gaia.
- [ ] Elevation profile from a DEM tile source.
- [ ] Surface and way-type breakdown: paved, gravel, trail, stairs, ferry.
- [ ] Route editing: redraw a section, drag to pull the route, adjust strictness locally.
- [ ] Points of interest inside the corridor. Viewpoints, water, shelters, cafes.
- [ ] Save and name routes, beyond the single current session already persisted.
- [ ] GPX import, so an existing track can be re-sketched.

**Exit criteria:** a saved route with elevation and surface data, exported as GPX, opening
correctly in OsmAnd on the same phone.

### Phase 4: Navigation that respects the line (4-8 weeks)

**Rewritten for the platform.** Foreground navigation, honestly labelled.

- [ ] GPS tracking with `watchPosition`, heading, follow-me camera.
- [ ] Screen wake lock while navigating, released on exit.
- [ ] Breadcrumb guidance first. Exploration users generally prefer it to turn-by-turn.
- [ ] Turn-by-turn second, with voice.
- [ ] **Off-route behaviour: never reroute to the destination.** Find the nearest sensible point on
  the planned route ahead of you, route back to it, and resume following the line.
- [ ] **Resume on return.** On `visibilitychange`, take a fresh fix and re-enter guidance through
  the off-route path above. Coming back from a locked screen is the same problem as walking off
  course, and uses the same code.
- [ ] Record the actual track, with the holes shown as holes. A screen-off stretch produces no
  samples, and interpolating across it would mean comparing the plan against itself.
- [ ] Measure the battery cost of screen-on navigation, which is the real number here.

**What this phase cannot do:** track a phone in a pocket. If that turns out to matter more than
expected in the field, the options are a native shell around the same Rust engine, or exporting to
OsmAnd and letting it do the tracking. Both are live; neither is scheduled.

**Exit criteria:** complete a real walk using only the app, with the battery cost measured and the
pocket case honestly documented.

### Phase 5: Offline and durability (3-6 weeks)

- [ ] Service worker: app shell cached, so a reload with no signal still starts.
- [ ] Region downloads: PMTiles plus the packed graph, into Cache Storage or OPFS.
- [ ] Storage management, region deletion, and a quota the user can see.
- [ ] Airplane-mode test across draw, match, and navigate.
- [ ] Eviction test: background the app for a day, come back, confirm nothing was lost.
- [ ] Error reporting.

The seven-day expiry work that used to live here is deleted. Nothing expires.

**Exit criteria:** a full hike planned and navigated with no signal, and an app that survives being
discarded from memory mid-walk.

### Phase 6: Beyond personal use (ongoing)

Only worth doing if Phases 1 through 5 produced something worth using regularly.

- [ ] Share a route as a link.
- [ ] Onboarding that teaches drawing in twenty seconds.
- [ ] Public route pages.

The yearly Apple fee, TestFlight and App Store submission are all gone from this list. If a native
client is ever wanted, for background location, the Rust engine carries over unchanged and that is
a deliberate property to keep.

---

## 7. Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Finger drawing fights the map | Bad first impression | Explicit draw mode, `touch-action: none`, standalone install, tested on hardware |
| Drawing feels wrong on a real phone | The core interaction fails | Phase 0 is not done until a thumb has tried it |
| Matcher produces zigzags or shortcuts | Core value broken | Evaluation harness, checkpoints in the search state, strictness slider |
| WebAssembly too slow on the phone | Feature cut, or a native client after all | Measured in Phase 0, before anything depends on the number |
| Graph too large for Safari | Region size shrinks | Measured in Phase 0; packed format and per-region extracts |
| Tab discarded mid-walk | Lost sketch, lost track | Everything persisted to IndexedDB on change; `persist()` requested |
| Screen-off tracking impossible | Phase 4 weaker than planned | Known and designed around, not discovered late |
| Battery cost of screen-on navigation | Short useful range | Measured in Phase 4; breadcrumb mode over turn-by-turn |
| Sketch crosses no-path terrain | Confusing results | Gap segments surfaced in the UI, off-path option for hiking |
| OSM data gaps | Wrong routes | Link out to OSM for fixes, accept it |
| Scope creep into a generic map app | Never ships | The non-goals list. Every feature must serve "follow my line". |

---

## 8. Open decisions

1. **Is Valhalla still worth standing up?** It was scaffolding to prove the idea before the Rust
   matcher existed. The Rust matcher now exists and passes its tests. The remaining argument for
   Valhalla is as a scoring baseline once there is a real extract, which is a smaller claim than
   the one in `CLAUDE.md`. Decide when the importer lands, not before.
2. Development region for the first extract.
3. Where to host. GitHub Pages is wired up and free; it cannot set COOP/COEP headers, which
   `SharedArrayBuffer` and a multi-threaded search would need.
4. Whether to set COOP/COEP at all, which depends on whether the phone measurement says the search
   needs threads.
5. Realistic hours per week.

---

## 9. Prior art worth studying

- **Footpath Route Planner**, iOS. Draw with a finger and it snaps to paths. The closest existing
  product to this idea. Study its interaction model and its failure modes.
- **Komoot** and **Strava route builder**. Waypoint planners with good profile, surface and
  elevation interfaces.
- **OsmAnd**, specifically its Follow Track mode. This is both the GPX export target and a
  reference for navigating along a fixed line rather than rerouting. Also the fallback for the one
  thing this app cannot do.
- **Valhalla map-matching docs**: `trace_route`, `trace_attributes`, meili configuration.
- Newson & Krumm, 2009, *Hidden Markov Map Matching Through Noise and Sparseness*.
- **PMTiles** and the `pmtiles` protocol for MapLibre GL JS, for Phase 5.
