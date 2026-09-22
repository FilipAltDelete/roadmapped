#!/usr/bin/env bash
# Start an Android emulator, creating it on first use.
#
# Android is the development surface for this project. The product target is
# iPhone, but iOS cannot be built on Linux, so day-to-day work happens here and
# iOS builds happen in CI roughly weekly.
set -euo pipefail

cd "$(dirname "$0")/.."

ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
AVD_NAME="${AVD_NAME:-roadmapped}"
# See mise.toml: avdmanager follows XDG_CONFIG_HOME, the emulator does not.
ANDROID_AVD_HOME="${ANDROID_AVD_HOME:-${XDG_CONFIG_HOME:-$HOME/.config}/.android/avd}"
export ANDROID_AVD_HOME
SYSTEM_IMAGE="${SYSTEM_IMAGE:-system-images;android-36;google_apis;x86_64}"

export ANDROID_HOME
export JAVA_HOME="${JAVA_HOME:-$(mise where java)}"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"

if [ ! -x "$ANDROID_HOME/emulator/emulator" ]; then
  echo "Emulator is not installed. Run:" >&2
  echo "  sdkmanager --sdk_root=\"$ANDROID_HOME\" emulator \"$SYSTEM_IMAGE\"" >&2
  exit 1
fi

if ! avdmanager list avd 2>/dev/null | grep -q "Name: $AVD_NAME"; then
  echo "Creating AVD '$AVD_NAME'..."
  echo "no" | avdmanager create avd \
    --name "$AVD_NAME" \
    --package "$SYSTEM_IMAGE" \
    --device "pixel_7" \
    --force >/dev/null
fi

if adb devices | grep -q emulator; then
  echo "An emulator is already running."
  exit 0
fi

# Without KVM the emulator is unusably slow, so fail loudly rather than let
# someone conclude the app is at fault.
if [ ! -r /dev/kvm ] || [ ! -w /dev/kvm ]; then
  echo "Warning: /dev/kvm is not accessible, the emulator will crawl." >&2
  echo "Add yourself to the kvm group and log back in." >&2
fi

echo "Starting '$AVD_NAME'..."
nohup "$ANDROID_HOME/emulator/emulator" -avd "$AVD_NAME" -gpu auto \
  >/tmp/emulator-"$AVD_NAME".log 2>&1 &

echo -n "Waiting for it to boot"
for _ in $(seq 1 90); do
  if [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; then
    echo " ready."
    adb devices | grep emulator
    echo
    echo "Now run:  make run"
    exit 0
  fi
  echo -n "."
  sleep 2
done

echo
echo "Timed out. Check /tmp/emulator-$AVD_NAME.log" >&2
exit 1
