# Setup

## What this machine can and cannot do

Linux builds and tests the Rust engine, and builds and runs the Flutter app on
Android. It cannot build for iOS. Nothing changes that except macOS.

So the loop is:

- **Every day:** write Rust and Dart, run on Android, run `make test`,
  `make check` and `make eval`. All local, all fast.
- **Every week or so:** trigger the `ios` workflow, download the artefact,
  install it on the iPhone.

## Toolchain

Everything is installed and pinned. None of it needed root, and all of it lives
in the home directory.

| Tool | Version | Managed by |
| --- | --- | --- |
| Rust | system toolchain | rustup |
| Flutter | 3.47.5 | `mise.toml` |
| Java | Temurin 21 | `mise.toml` |
| Android SDK | platform 36, build-tools 36.1.0 | `~/Android/Sdk` |

`mise.toml` also exports `ANDROID_HOME`, so entering the directory is enough to
get a working environment. Verify with:

```sh
mise exec -- flutter doctor
```

Chrome and the Linux desktop toolchain show as missing. That is expected and
irrelevant, because the targets are iOS and Android.

### Reinstalling from scratch

```sh
mise install                                   # Flutter and Java
curl -O https://dl.google.com/android/repository/commandlinetools-linux-16111833_latest.zip
# unzip to ~/Android/Sdk/cmdline-tools/latest, then:
sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.1.0"
mise exec -- flutter config --android-sdk ~/Android/Sdk
```

## Running the app

Three ways to see it, in increasing order of trust.

**Widget tests.** No device, no emulator, runs in seconds.

```sh
make app-test
```

**Emulator.** Good enough for layout and logic. Creates the virtual device on
first use, which takes a minute, then boots in about twenty seconds.

```sh
make emulator     # start it
make run          # install and launch the app
```

Hot reload works once `flutter run` is attached: press `r` to reload, `R` to
restart, `q` to quit.

**A real phone.** The only way to judge whether drawing actually feels right.
Enable Developer Options and USB debugging on the device, plug it in, accept the
prompt, then:

```sh
make devices      # confirm it is seen
make run
```

An emulator drawn on with a mouse tells you nothing about a thumb on glass. Use
it for logic, not for feel.

The first Gradle build downloads an NDK and takes several minutes. Later builds
take about ten seconds.

## Getting a build onto the iPhone

A free Apple Developer account signs an app for seven days at a time. After that
it stops launching until it is re-signed.

1. Trigger the `ios` workflow in GitHub Actions by hand.
2. Download the `roadmapped-ipa` artefact.
3. Install with [SideStore](https://sidestore.io), which re-signs on the phone
   over WiFi with no computer involved.

Set SideStore up once, early. Standing at a trailhead with an expired app is the
wrong time to learn it.

Free-tier limits worth remembering:

| Limit | Value |
| --- | --- |
| Signature lifetime | 7 days |
| Sideloaded apps at once | 3 |
| New App IDs | 10 per 7 days |

The App ID limit is why the bundle identifier is settled at `app.roadmapped` rather
than left to drift. An App ID is consumed when the app is *signed*, not when it
is built: CI produces an unsigned .ipa, so nothing has been spent yet and the
identifier is still free to change. That stops being true the first time
SideStore signs a build.

## Still unverified

The `ios` workflow now runs and passes. It built an unsigned arm64 .ipa on the
first attempt, and the Rust core cross-compiled to `aarch64-apple-ios` cleanly,
which is the no-dependency rule in `crates/sketch-route` earning its keep. CI is
free and unmetered because the repository is public; making it private again
reintroduces the 10x macOS billing.

What that still does not prove is that the app runs. The .ipa has never been
signed, installed, or launched, because SideStore has not been set up. That
setup is the fiddly part, not the build: it needs a pairing file generated from
a computer and a tunnel for on-device refresh. Do it before the work depends on
it, not at a trailhead.

One Phase 0 task decides whether Phase 4 is possible at all: whether background
location works under free provisioning. Test it with a throwaway app before
committing to the navigation work.
