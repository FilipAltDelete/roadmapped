# Roadmapped

Draw a line on the map with your finger. Get back a real route that follows that
line as closely as the path network allows.

Not the fastest route. Not the shortest. The one that looks most like what you
drew. See `ROADMAP.md` for the full plan and `CLAUDE.md` for the decisions
already settled.

## Layout

| Path | What it is |
| --- | --- |
| `crates/sketch-route/` | The matching engine. Rust, no dependencies. |
| `crates/sketch-route-wasm/` | The WebAssembly seam over it. Raw C ABI, no bindgen. |
| `web/` | The client. TypeScript, MapLibre GL JS, installed from a URL. |
| `eval/` | Canonical sketches the matcher is scored against. |
| `docs/` | Setup notes. |

## Running what exists

```sh
make install   # once, fetches the web client's dependencies
make dev       # the app, on http://localhost:5173
make host      # the same, reachable from your phone on the same WiFi
make test      # Rust and web tests
make eval      # score the matcher against the canonical sketches
make check     # formatting, lints and types, exactly as CI runs them
```

`make eval` prints the table that decides whether a change to the algorithm was
an improvement. Run it before and after, and keep both outputs.

## Why a web app

It is an iPhone app that Apple has no say in. A free Apple Developer account
signs a build for seven days, allows ten App IDs a week, has no TestFlight, and
needs a macOS runner to build at all. None of that applies to a URL. Added to the
home screen it runs full screen with its own icon, and it never expires.

The engine did not change to make this possible. `crates/sketch-route` has no
dependencies precisely so it can be compiled somewhere unusual, and WebAssembly
is the third target it has been pointed at without edits.

What it costs is background location: the web has no equivalent, so navigation
works with the screen on and stops when the phone goes in a pocket. See Phase 4
of `ROADMAP.md`, which is written around that limit rather than against it.

## Naming

The app is **Roadmapped**. `ROADMAP.md` is the planning document and is
unrelated.

The Rust crate keeps the name `sketch-route` because it describes what it does
rather than what it ships inside. The product is Roadmapped, the engine within it
is sketch-route.

## Status

The engine is real and tested, against a synthetic grid. The client draws, calls
the engine through WebAssembly in a Worker, and draws the route that comes back.
There is no OSM importer yet, so the network it routes on is generated rather
than real. Nothing has been tried on a phone.
