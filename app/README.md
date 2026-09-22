# Roadmapped, the Flutter client

Bundle identifier `app.roadmapped`. Flutter version pinned in `mise.toml` at the
repository root.

```sh
make app-test     # widget tests, headless, no device needed
make app-check    # static analysis
make run          # needs a connected device or emulator
```

## Why Flutter and not Swift

The target is iPhone, but the development machine is Linux. A native Swift app
would need a cloud build for every change, turning a ten-second edit into a
ten-minute round trip. Flutter runs locally on Android for the daily loop and
builds for iOS in CI when a build is actually wanted.

Android is a development surface here, not a product target.

## What is built

| File | What it does |
| --- | --- |
| `lib/main.dart` | The map screen, drawing interaction, and coordinate conversion |
| `lib/sketch.dart` | Screen-space geometry, unit tested without a device |
| `lib/ui/glass.dart` | Frosted panels and buttons, and the palette |
| `lib/ui/control_panel.dart` | The bottom panel, widget tested in isolation |

A dark basemap from CARTO, free and keyless, so the drawn line is the brightest
thing on screen.

Two details are load bearing and easy to break:

**The stroke lives in screen space until the finger lifts.** Rendering it as a
Flutter overlay keeps drawing at sixty frames per second with no platform channel
traffic. Only on release is it thinned, converted, and handed to the map, after
which it pans and zooms with the terrain.

**The plugin's projection works in device pixels, Flutter in logical ones.**
The conversion multiplies by `devicePixelRatio`. Drop that and the line lands
somewhere the user never drew.

## Order of work

1. Wire in `crates/sketch-route` through flutter_rust_bridge, so a drawn line
   comes back as a matched route.
2. Bind the strictness slider to `CostParams::strictness`.
3. Render the matched route as a second layer, so the drawn line and the result
   are visible together.
4. GPX export through the iOS share sheet. This is the fallback when the
   seven-day signature expires, not a convenience feature.

## The thing that cannot be tested here

Whether drawing actually feels right. A mouse draws thin precise lines, a thumb
draws fat jittery ones and covers the map while doing it. The widget tests pin
down the logic, not the feel. Every change to draw interaction needs testing on a
real phone, outdoors, before it counts as done.
