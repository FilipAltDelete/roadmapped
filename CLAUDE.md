# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

The Rust matching engine in `crates/sketch-route/` is written and tested, against a synthetic
grid: there is no OSM importer yet, so it has never seen real data. The Flutter client in `app/`
has the drawing surface built and tested, with MapLibre rendering underneath it. The two halves
are not connected. There is no flutter_rust_bridge seam, so nothing calls the matcher and the
line the app draws back is the sketch itself, not a route. `ROADMAP.md` is the source of truth
for scope and phasing, but its checkboxes are stale and the code has overtaken them in places.

The full Android toolchain is installed and verified by an actual debug APK build. Flutter, Java
and the Android SDK paths are all pinned in `mise.toml`, so entering the directory sets up the
environment. Nothing needed root. See `docs/setup.md`.

iOS builds. The `ios` workflow produces an unsigned arm64 .ipa on a macOS runner, and all three
workflows pass. Nothing has been signed or installed on a phone yet: SideStore is not set up.

## Commands

```sh
make test      # Rust and Flutter tests
make eval      # score the matcher against the canonical sketches
make geojson   # same routes written to out/routes.geojson for viewing
make check     # rustfmt, clippy and flutter analyze, exactly as CI runs them
make run       # run on a device, needs the Android SDK
```

Run one Rust test with `cargo test --manifest-path crates/sketch-route/Cargo.toml <name>`, and one
Flutter test with `cd app && mise exec -- flutter test --plain-name <name>`.

Flutter is pinned in `mise.toml` and duplicated in two CI workflows. Change all three together.

**`make eval` is not optional when touching the algorithm.** Capture its output before a change
and after, and put both in the commit message or the pull request. The four overall numbers are
mean deviation, worst deviation, mean length ratio, and corridor share.

iOS cannot be built here. This machine is Linux, so the daily loop runs on Android, and iOS builds
go through the `ios` workflow on a macOS runner. See `docs/setup.md`.

## Naming

The application is **Roadmapped**, bundle identifier `app.roadmapped`. `ROADMAP.md` is
the planning document and is unrelated to it.

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

- **The matcher is Rust, compiled into the app, running on-device.** Not Dart, not a server. It is a
  graph search over millions of edges where predictable performance matters, and on-device is what
  makes offline work in the field.
- **`crates/sketch-route` has no dependencies, deliberately.** It cross-compiles to iOS and Android,
  where every dependency is a build risk. Adding one needs a reason worth stating in the commit.
- **The client is Flutter, not native Swift.** The developer works on Linux and has no Mac. Swift
  would force a cloud build for every iteration. Keep the Dart-to-Rust seam clean via
  flutter_rust_bridge so a later Swift client can reuse the crate unchanged.
- **Android is an iteration surface, not a target.** The product target is iPhone. Android exists so
  the daily loop runs locally on Linux.
- **Map rendering is MapLibre Native**, with PMTiles for offline-capable tiles.
- **Valhalla in Docker is scaffolding for Phase 1 only.** It proves the idea via its map-matching
  endpoint, then gets retired once the Rust matcher beats it.

## Constraints from the free Apple Developer account

The developer is on the free tier. These are design inputs, not future paperwork.

- Signed builds stop launching after 7 days. SideStore re-signs on-device over WiFi.
- **GPX export is not a nice-to-have.** It is the fallback when the app expires in the field, so the
  route stays openable in OsmAnd or Organic Maps. Do not deprioritize it.
- Only 10 new App IDs per 7 days, so the bundle identifier must not churn.
- No TestFlight and no App Store distribution until the yearly fee is paid.
- iOS builds require a macOS CI runner. The daily loop must not depend on one.

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

The integration tests in `crates/sketch-route/tests/follows_the_line.rs` encode the product promise.
The U-bend case is the headline: endpoints 900 m apart, correct answer 2700 m. If that test starts
passing for the wrong reason, or gets relaxed, the app no longer does the one thing it exists for.

## The client

`app/lib/main.dart` is the drawing surface, with MapLibre rendering under it. The gesture handling
and point capture were deliberately built against a blank canvas first, because finger drawing is
the risky part of this app and did not need a map to develop. The map arrived afterwards, leaving
only the problem that genuinely needs one: drawing competing with pan and zoom.

The basemap is a remote style over the network, so the app is online-only for now. PMTiles is what
makes it work offline, and that is still ahead.

**Draw mode is a deliberate toggle, not an inferred gesture.** With a map underneath, a drag means
either pan or draw and never both. Inferring it from pressure or timing feels clever and fails
constantly. The widget tests hold this in place, including the case that a drag with draw mode off
must capture nothing.

## Testing UI on real hardware

The widget tests pin down the logic, not the feel. Finger drawing cannot be validated on a desktop
or an emulator. A mouse draws thin precise lines. A thumb draws fat jittery ones and covers the map
while doing it. Any change to draw interaction needs testing on a real phone before it counts as
done.
