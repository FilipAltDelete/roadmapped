# Roadmap: Sketch-to-Route Exploration App (iPhone)

> Draw a line on the map with your finger. The app turns it into a real, walkable or rideable
> route that follows your line as faithfully as the path network allows. Never the fastest
> route. Always the route that looks most like what you drew.

Target: iPhone, installed via a free Apple Developer account.
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

**Non-goals:** car navigation, competing with Google Maps on speed, social features, live traffic,
App Store release (not possible on the free tier).

---

## 2. Target and constraints

The free Apple Developer account changes what is possible. These constraints are not obstacles to
work around later. They are design inputs now.

| Constraint | Value | Consequence |
| --- | --- | --- |
| Signed app lifetime | 7 days | The app must be re-signed weekly or it stops launching |
| Simultaneous sideloaded apps | 3 | Fine for one app, tight if you fork variants |
| New App IDs | 10 per 7 days | Do not churn the bundle identifier |
| TestFlight | Not available | No beta testers, no distribution to friends |
| App Store | Not available | Personal use only until you pay the yearly fee |
| Building for iOS | Requires macOS and Xcode | You are on Linux. See section 5. |

**The 7-day expiry is the dangerous one for this app specifically.** A navigation app that dies
mid-hike is worse than no app. Two mitigations, both in Phase 0:

- Use SideStore, which re-signs on-device over WiFi with no computer involved, so a refresh is a
  tap rather than a cable and a laptop.
- Always keep GPX export working. If the app expires in the field, the route is still openable in
  OsmAnd or Organic Maps. This is the reason GPX export stays a first-class feature and not a
  nice-to-have.

---

## 3. The core idea: sketch-to-route

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
OSRM `match`. Tune for sketch noise rather than GPS noise: large search radius, large GPS accuracy,
large breakage distance.

Good enough to validate the idea in days. Not good enough to ship, because it is built for tens of
metres of noise and a finger produces hundreds.

### C. Corridor-constrained routing, the real engine

Build a corridor of width `W` (start at 75 m) around `P`. Run A* on the path graph with a cost
function that charges for leaving the line:

```
cost(edge) = length(edge) * (1 + alpha * dist(edge, P) / W)
           + backtrack_penalty(edge)
           + profile_penalty(edge)
```

- `dist(edge, P)`: mean distance from the edge to the sketch.
- `alpha`: strictness. Becomes the user-facing slider.
- Prune edges beyond roughly `3W` from `P`. This is what keeps the search fast.
- `backtrack_penalty`: track progress `t` along `P` as the arc-length position of the closest
  point. Penalize edges where `t` decreases, and edges where `t` jumps far ahead and shortcuts a
  bend.
- **Checkpoints as the robustness fallback:** drop one every `W` metres along `P`. The route must
  pass within radius `R` of each, in order. This alone kills most shortcut failures.
- `profile_penalty`: the exploration preferences. Trail bonus, big-road penalty, surface, stairs.
- A* heuristic: straight-line distance to the end node. Admissible because cost is at least length.

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
| Map rendering | MapLibre Native, via the Flutter plugin | Metal-backed on iOS, vector tiles, offline-capable |
| Tiles | PMTiles bundled or downloaded per region | No tile server bill, works offline |
| Matching engine | **Rust**, compiled into the app | Performance, and it runs on-device with no server |
| Bridge | flutter_rust_bridge | Generated Dart bindings over the Rust core |
| Client | **Flutter** | Develops on Linux, iterates on Android, builds for iOS in CI |
| Prototype matcher | Valhalla in Docker, Phase 1 only | Proves the idea before the Rust core exists |
| Storage | SQLite on-device | No backend needed for personal use |

### Why Flutter rather than Swift

Native SwiftUI would be the better app if you owned a Mac. You do not. Every Swift iteration would
require a cloud build, turning a ten-second change into a ten-minute round trip. That workflow does
not survive contact with real development.

Flutter lets you write and test on Linux, iterate fast against an Android device or emulator, and
produce an iOS build in CI only when you actually want it on the phone. The Rust core, which is the
performance-critical half, is identical either way.

**If you acquire a Mac,** the correct move is SwiftUI plus MapLibre Native plus the same Rust core
through UniFFI. The Rust crate carries over untouched. Keep that seam clean.

### Why the matcher is Rust and on-device

Performance is the stated priority. A graph search over millions of edges is the wrong job for
Dart or JavaScript. Rust gives predictable speed with no garbage collection pauses, compiles to
both iOS and Android, and needs no server, which means it works in airplane mode in a forest.

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

## 5. Build and deploy pipeline

This is the part that has to work before anything else matters.

**Daily loop, entirely on Linux:**
Write Dart and Rust, run on an Android device or emulator, iterate in seconds.

**iOS loop, roughly weekly:**
Push to a repo, a macOS runner builds and signs the app, you install the result on the iPhone.

Options for the macOS build step:

| Option | Cost | Notes |
| --- | --- | --- |
| GitHub Actions macOS runner | Free for public repos | Private repos burn minutes at a 10x multiplier |
| Codemagic | Free tier for personal use | Purpose-built for Flutter, least setup |
| Used Mac Mini with Apple Silicon | One-time hardware cost | Removes every constraint in this section |

**Installing on the phone:** SideStore refreshes the 7-day signature on-device over WiFi. Set it up
once in Phase 0 and weekly renewal becomes a tap instead of a chore.

A Mac Mini is the single purchase that most improves this project. Worth revisiting once the idea
is proven.

---

## 6. Phases

Durations assume one developer working most of the week.

### Phase 0: Prove the toolchain (1-2 weeks)

**Goal:** get a trivial app onto the iPhone and keep it there. Do this before writing any real
code. If this fails, everything after it is wasted work.

- [ ] Flutter installed on Linux, Android device or emulator running a hello-world.
- [ ] Rust in the project via flutter_rust_bridge, calling one function from Dart.
- [ ] MapLibre rendering a map in the app on Android.
- [ ] iOS build succeeding on a macOS CI runner.
- [ ] **The signed app installed and launching on your iPhone.**
- [ ] SideStore installed, one refresh cycle completed successfully.
- [ ] Verify background location permission works under free provisioning. This is the one
  capability that might be restricted, and Phase 4 depends on it. Find out now, not in six months.
- [ ] Choose a development region and build a PMTiles extract for it.
- [ ] Valhalla running in Docker on that region, for Phase 1 only.
- [ ] Write the evaluation set: 10 sketches over the region. Urban grid, river loop, forest trail,
  line crossing a lake, self-crossing loop, out-and-back, long straight road, dense city centre,
  coastal path, hilly park.
- [ ] Pick a working name and a bundle identifier. Do not change it later.

**Exit criteria:** a map renders on your iPhone, the app survives a SideStore refresh, and you know
whether background location is available.

### Phase 1: Draw and match (3-5 weeks)

**Goal:** draw a line on the phone, get a route that follows it.

- [ ] Draw mode toggle. Map gestures disabled while drawing, so a drag draws instead of panning.
- [ ] Capture touch points, smooth, simplify with Douglas-Peucker at 5-10 m tolerance.
- [ ] Render the sketch as a soft line under a bold route line.
- [ ] Send the sketch to Valhalla `trace_route` with `costing: pedestrian`,
  `shape_match: map_snap`, and raised `search_radius`, `gps_accuracy` and `breakage_distance`.
  Raise the maximum search radius in the meili block of `valhalla.json`.
- [ ] Stats panel: distance, estimated time, max deviation.
- [ ] Clear and redraw.
- [ ] Evaluation harness: run all 10 sketches, print the metrics table.
- [ ] **Test drawing on the actual phone, with an actual thumb, outdoors, in sunlight.** A finger
  covers the map and draws fat jittery lines. Whatever you tuned on an emulator will be wrong.

**Exit criteria:** a demo video shot on the iPhone. All 10 sketches scored. A written list of
failure cases, which become the Phase 2 requirements.

### Phase 2: The Rust matcher (6-10 weeks)

**Goal:** own the matching quality, on-device.

- [ ] Rust crate: load a pedestrian and bicycle graph from the OSM extract, spatial index over
  edges.
- [ ] Corridor construction and edge pruning.
- [ ] Cost function: deviation, backtrack, profile.
- [ ] Checkpoint fallback.
- [ ] Strictness slider wired end to end.
- [ ] Gap handling. When no path exists in the corridor, either insert a flagged off-path straight
  segment for hiking, or take the nearest detour in the city. Return gaps so the UI can draw them
  differently.
- [ ] Self-crossing and out-and-back sketches handled correctly.
- [ ] Graph packed into a compact on-device format, loaded memory-mapped.
- [ ] Performance targets on the phone, not a laptop.

| Sketch length | Target |
| --- | --- |
| 20 km | under 1 second |
| 100 km | under 3 seconds |

- [ ] Side-by-side comparison against Valhalla on the evaluation set. Retire Valhalla once the Rust
  matcher wins.

**Exit criteria:** the Rust matcher beats map-matching on mean deviation and gap count, runs
on-device with no network, and the strictness slider visibly reshapes the route.

### Phase 3: Exploration and export (4-8 weeks)

- [ ] Profiles: walk, hike, run, gravel, road bike. Each with its own preferences for trails,
  surface, big roads, lighting, stairs.
- [ ] Elevation profile from a DEM tile source.
- [ ] Surface and way-type breakdown: paved, gravel, trail, stairs, ferry.
- [ ] Route editing: redraw a section, drag to pull the route, adjust strictness locally.
- [ ] Points of interest inside the corridor. Viewpoints, water, shelters, cafes.
- [ ] Save and name routes in SQLite.
- [ ] **GPX export via the iOS share sheet.** Your insurance against the 7-day expiry and the
  bridge into OsmAnd, Organic Maps, Komoot and Gaia.
- [ ] GPX import, so an existing track can be re-sketched.

**Exit criteria:** a saved route with elevation and surface data, exported as GPX, opening
correctly in OsmAnd on the same phone.

### Phase 4: Navigation that respects the line (4-8 weeks)

Contingent on background location working under free provisioning, confirmed in Phase 0.

- [ ] GPS tracking, heading, follow-me camera.
- [ ] Breadcrumb guidance first. Exploration users generally prefer it to turn-by-turn.
- [ ] Turn-by-turn second, with voice.
- [ ] **Off-route behaviour: never reroute to the destination.** Find the nearest sensible point on
  the planned route ahead of you, route back to it, and resume following the line.
- [ ] Background location with a measured battery budget.
- [ ] Record the actual track, then show planned against walked.

**Exit criteria:** complete a real walk or ride using only the app, with the battery cost measured.

### Phase 5: Offline and durability (3-6 weeks)

Most of this comes free from the architecture, since the matcher is already on-device.

- [ ] Region downloads: PMTiles plus the packed graph, managed in-app.
- [ ] Storage management and region deletion.
- [ ] Airplane-mode test across draw, match, and navigate.
- [ ] Crash reporting.
- [ ] Graceful behaviour as the signature nears expiry. Warn at day five, prompt a refresh, make
  sure GPX export works even after expiry.

**Exit criteria:** a full hike planned and navigated with no signal.

### Phase 6: Decide whether to pay (ongoing)

Only worth doing if Phases 1 through 5 produced something you use regularly.

- [ ] Pay the yearly developer fee. This removes the 7-day expiry and unlocks TestFlight.
- [ ] Beta via TestFlight.
- [ ] Android release, which is nearly free given Flutter and the shared Rust core.
- [ ] Route sharing, public route pages.
- [ ] Onboarding that teaches drawing in twenty seconds.
- [ ] App Store submission.

---

## 7. Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| No Mac, CI loop too slow | Development stalls | Flutter plus Android for the daily loop. Revisit a used Mac Mini after Phase 1. |
| 7-day expiry kills the app in the field | Lost trust in your own tool | SideStore, expiry warnings, GPX export always available |
| Background location blocked on free tier | Phase 4 impossible | Verified in Phase 0, before it can cost you anything |
| Matcher produces zigzags or shortcuts | Core value broken | Evaluation harness from Phase 1, checkpoints, strictness slider |
| Finger drawing fights the map gestures | Bad first impression | Explicit draw mode, tested on real hardware in Phase 1 |
| On-device graph too large or slow | Feature cut to online-only | Region-sized extracts, compact packed format, memory-mapped loading |
| Sketch crosses no-path terrain | Confusing results | Gap segments surfaced in the UI, off-path option for hiking |
| OSM data gaps | Wrong routes | Link out to OSM for fixes, accept it |
| Scope creep into a generic map app | Never ships | The non-goals list. Every feature must serve "follow my line". |

---

## 8. Open decisions

1. Development region for the first extract.
2. CI provider: GitHub Actions or Codemagic.
3. Working name and bundle identifier, which cannot change cheaply.
4. Realistic hours per week.
5. Whether a used Mac Mini is worth it. Revisit after Phase 1.

---

## 9. Prior art worth studying

- **Footpath Route Planner**, iOS. Draw with a finger and it snaps to paths. The closest existing
  product to this idea. Study its interaction model and its failure modes before Phase 1.
- **Komoot** and **Strava route builder**. Waypoint planners with good profile, surface and
  elevation interfaces.
- **OsmAnd**, specifically its Follow Track mode. This is both your GPX export target and a
  reference for navigating along a fixed line rather than rerouting.
- **Valhalla map-matching docs**: `trace_route`, `trace_attributes`, meili configuration.
- Newson & Krumm, 2009, *Hidden Markov Map Matching Through Noise and Sparseness*.
- **flutter_rust_bridge** documentation, for the Dart to Rust seam.
