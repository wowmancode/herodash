#!/usr/bin/env bash
set -euo pipefail

adb install-multiple -r artifact/build/base-patched.apk artifact/build/split_config.arm64_v8a-patched.apk
adb logcat -c
adb shell monkey -p com.outfit7.herodash 1

for attempt in $(seq 1 24); do
  sleep 5
  events="$(adb logcat -d -s HeroDashMod:I '*:S')"
  if [[ "$events" == *'Native hooks installed'* && "$events" == *'Floating menu attached'* ]]; then
    printf '%s\n' "$events"
    exit 0
  fi
done

adb logcat -d | grep -E 'HeroDashMod|FATAL EXCEPTION|Fatal signal|libherodashmod|libil2cpp|frida|AndroidRuntime|DEBUG' | tail -150 || true
adb shell pidof com.outfit7.herodash || true
exit 1
