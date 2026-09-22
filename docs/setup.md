# Setup

## What this machine can and cannot do

Everything. That is the change.

The previous version of this document explained which half of the project had to
happen somewhere else: Linux could build and test the Rust engine and run the
Flutter app on Android, but iOS needed macOS, and the only route onto the phone
was a macOS CI runner, a downloaded artefact and SideStore. None of that is true
any more. A web app builds here, runs here, and reaches the phone over WiFi.

So the loop is one loop:

- Write Rust and TypeScript, run `make test`, `make check` and `make eval`.
- Run `make host` and open the printed URL on the phone.

## Toolchain

| Tool | Version | Managed by |
| --- | --- | --- |
| Node | 26.8.1 | `mise.toml` |
| Rust | system toolchain | rustup |
| wasm32 target | `wasm32-unknown-unknown` | rustup |

Entering the directory is enough to get Node on the path. The one thing rustup
needs, once:

```sh
rustup target add wasm32-unknown-unknown
```

Then:

```sh
make install     # the web client's dependencies
make test        # should be green
```

There is no Android SDK, no Java, no Flutter and no Xcode. Nothing needs root.

## Running the app

Three ways to see it, in increasing order of trust.

**Tests.** No browser, runs in seconds.

```sh
make test
```

**A desktop browser.** Good enough for layout and logic.

```sh
make dev
```

Vite hot-reloads TypeScript on save. Changing the Rust engine needs `make wasm`
and a page reload, because the compiled module is fetched rather than bundled.

**A real phone.** The only way to judge whether drawing actually feels right.

```sh
make host
```

Open the Network URL it prints on the phone, on the same WiFi. A desktop browser
drawn on with a mouse tells you nothing about a thumb on glass. Use it for
logic, not for feel.

## Installing on the phone

Open the URL in Safari, tap Share, tap Add to Home Screen.

That is the whole of it. No signature, no seven-day expiry, no App ID spent, no
pairing file, no SideStore, no cable. The app updates when you reload it.

**Install it rather than using a tab**, and not for tidiness. In a tab:

- Safari's edge-swipe back gesture swallows strokes that start near the left
  edge, which is exactly where a right-handed thumb begins.
- The address bar collapses and expands under a finger that is mid-line,
  resizing the viewport while you draw.
- The origin gets a smaller storage allowance and is likelier to be evicted.

The app says so itself, once, on iOS outside standalone mode.

For the deployed copy rather than a laptop on the same WiFi, pushing to `main`
publishes to GitHub Pages through `.github/workflows/web.yml`.

## What is still unverified

**The app has never been opened on a phone.** The engine's guarantees are
checked through WebAssembly in `web/test/engine.test.ts`, and the drawing
geometry has unit tests, but no thumb has touched the drawing surface. Finger
drawing is the risky part of this app and a desktop pointer proves nothing about
it.

Three numbers worth measuring the first time it runs on the phone, because later
phases are sized against guesses until then:

1. **How long a match takes.** WebAssembly runs a pointer-chasing graph search
   at roughly half native speed, single-threaded unless the app is served with
   COOP and COEP headers for `SharedArrayBuffer`. The Phase 2 targets were
   written for native and need re-measuring.
2. **How large a graph Safari tolerates** before it discards the tab. This sets
   the region size in Phase 5 and cannot be guessed from a desktop.
3. **How much storage the origin is actually granted**, installed versus in a
   tab, and whether `navigator.storage.persist()` is granted.

Phase 4 needs no such investigation. Background location is not restricted on
the web, it is absent, and the phase is written around that.
