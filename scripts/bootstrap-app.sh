#!/usr/bin/env bash
# Scaffold the Flutter client.
#
# Kept as a script rather than a committed Flutter project because `flutter
# create` generates a large amount of platform scaffolding that is better
# produced by the toolchain than hand-written and left to rot.
set -euo pipefail

cd "$(dirname "$0")/.."

# Flutter builds the bundle identifier as ORG plus the project name, so these
# two produce app.roadmapped. The `app.` prefix is a real convention for apps
# published without a domain behind them; Organic Maps ships as app.organicmaps.
#
# An App ID is registered with Apple at signing time, not at scaffolding time,
# so renaming costs nothing until the first signed build. After that, each
# rename burns one of the ten App IDs a free account gets per seven days.
ORG="${ORG:-app}"
PROJECT_NAME="${PROJECT_NAME:-roadmapped}"

flutter_cmd=(flutter)
if ! command -v flutter >/dev/null 2>&1; then
  if command -v mise >/dev/null 2>&1 && mise which flutter >/dev/null 2>&1; then
    flutter_cmd=(mise exec -- flutter)
  else
    cat <<'MSG'
Flutter is not installed.

  mise use flutter@3.47.5      # this repo pins it in mise.toml
  or https://docs.flutter.dev/get-started/install/linux

Android tooling matters more than it sounds: the daily development loop runs on
Android because iOS builds need macOS, which this machine does not have.
MSG
    exit 1
  fi
fi

if [ -d app/lib ]; then
  echo "app/ already scaffolded, nothing to do"
  exit 0
fi

# flutter create refuses to write into a directory that already has content,
# so the placeholder README is moved aside and restored afterwards.
readme_backup=""
if [ -f app/README.md ]; then
  readme_backup="$(mktemp)"
  cp app/README.md "$readme_backup"
fi

"${flutter_cmd[@]}" create \
  --org "$ORG" \
  --project-name "$PROJECT_NAME" \
  --platforms=ios,android \
  --template=app \
  app

if [ -n "$readme_backup" ]; then
  cp "$readme_backup" app/README.md
  rm -f "$readme_backup"
fi

actual_id="$(grep -m1 PRODUCT_BUNDLE_IDENTIFIER app/ios/Runner.xcodeproj/project.pbxproj \
  | sed 's/.*= *//; s/;.*//' || true)"

cat <<MSG

Scaffolded app/ with bundle identifier: ${actual_id:-unknown}

Next, in this order:
  1. Add maplibre_gl to app/pubspec.yaml and render a map on Android.
  2. Add flutter_rust_bridge and call into crates/sketch-route.
  3. Only then try an iOS build, through CI.

Do not skip step 1. If the map does not render, nothing after it matters.
MSG
