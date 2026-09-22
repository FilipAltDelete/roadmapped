# Roadmapped

Draw a line on the map with your finger. Get back a real route that follows that
line as closely as the path network allows.

Not the fastest route. Not the shortest. The one that looks most like what you
drew. See `ROADMAP.md` for the full plan and `CLAUDE.md` for the decisions
already settled.

## Layout

| Path | What it is |
| --- | --- |
| `crates/sketch-route/` | The matching engine. Rust, no dependencies, runs on-device. |
| `app/` | The Flutter client, bundle id `app.roadmapped`. |
| `eval/` | Canonical sketches the matcher is scored against. |
| `docs/` | Setup notes. |

## Running what exists

```sh
make test     # unit and integration tests
make eval     # score the matcher against the canonical sketches
make check    # formatting and lints
```

`make eval` prints the table that decides whether a change to the algorithm was
an improvement. Run it before and after, and keep both outputs.

## Naming

The app is **Roadmapped**, bundle identifier `app.roadmapped`. `ROADMAP.md` is
the planning document and is unrelated.

The Rust crate keeps the name `sketch-route` because it describes what it does
rather than what it ships inside. The product is Roadmapped, the engine within it
is sketch-route.

## Status

The engine is real and tested. The client is scaffolded with the drawing surface
working. There is no map under it yet, and iOS has never been built.
