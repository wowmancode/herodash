# Talking Tom Hero Dash local mod (26.5.1.12192)

This repository builds a non-root, locally signed set of APK splits from the exact
APKM attached to the `hero` release. The build checks its SHA-256 before editing.
It contains no automation or TAS code. The same version-pinned native payload is
also built as a Morphe `.mpp` patch bundle.

## Current scope

| Control | Implementation | Validation |
| --- | --- | --- |
| Score multiplier, 1×–1,000× | Writes the active `RunnerStateData.Multiplier` and applies it when a run starts | Native target and field checked; game runtime not yet tested |
| Coins, gems, tokens | Sets the corresponding local `HDCurrencyAccount.Balance`, fires the balance change event, and writes local state | Native paths checked; game runtime not yet tested |
| Local heroes and outfits | Calls the game's `FullyUnlockCharacterAndSkins` for Tom, Angela, Hank, Ginger, and Ben, then `UnlockEverySkin` | Native paths checked; game runtime not yet tested |
| Gadgets and head start | Sets local balances for jet bike, laser ship, supersonic board, and head start to 9,999 | Native paths checked; game runtime not yet tested |
| Infinite revives | On the Save Me screen, routes the local token purchase button to the game's `OnSaveMeHandled(true, 0, false)` and provides a Revive now menu button | Native paths checked; game runtime not yet tested |
| No ads | Hides banners and makes interstitials unavailable; optional rewarded videos remain available | Native paths checked; game runtime not yet tested |
| Floating menu | In-app draggable and collapsible overlay with Gameplay, Currency, Unlocks, and Settings tabs; settings persist in `SharedPreferences` | JavaScript syntax checked; Android runtime not yet tested |

**Unsupported in this build:** The IL2CPP metadata has no currency ID named
`credits`; it has `coins`, `gems`, `tokens`, and other specific IDs. No credits
input is shown because there is no matching account to set. The requested “max
all upgrades” operation is also not implemented: the game exposes builder
attraction progression, skin bonuses, and consumable gadgets, but no single
bounded upgrade state that can safely be maximized. Time-limited and backend
content is not unlocked.

The app also has `UserManager.SendUserStateToBackend` and restore paths. This
mod does not hook those paths or purchase verification, but the app may later
sync locally changed state through its ordinary behavior. Use it with a local
guest save if account separation matters. Leaderboards are not patched.

## Engine and patch method

This build is Unity IL2CPP (metadata version 31). `global-metadata.dat` is in
`base.apk`; `libil2cpp.so` and `libmain.so` are in ABI splits. The Android DEX
contains platform and SDK code. Morphe supports bytecode, decoded resource, and
raw resource patches; its raw resource API can replace native libraries, while
its bytecode patcher does not transform compiled IL2CPP methods. This project
adds a dependency to `libmain.so` and packages Frida Gadget 16.7.19 plus a
version-pinned script inside each ABI split. The source library and metadata
hashes are checked before building. The script runs inside the game process;
it needs neither root nor the Android draw-over-other-apps permission.

## Build and GitHub Actions

Pushes to `main` run [the build workflow](.github/workflows/build.yml). It
downloads release asset `634215535` using the workflow's repository token,
checks the pinned APKM digest, downloads both Frida Gadget ABIs, builds and
signs the splits, builds a Morphe `.mpp`, and validates the result. The artifact is named
`herodash-26.5.1.12192-local-mod`. The workflow uses a fresh debug key each
run; these artifacts are installable, but updates from different runs require
uninstalling the previous mod first.

To build locally, install Python 3.12, Java 17, Android build-tools 34.0.0,
and `lief==0.17.0`. Download Frida Gadget 16.7.19 for Android arm64 and arm,
decompress both `.so.xz` files, then run:

```sh
python tools/build.py \
  --apkm path/to/herodash.apkm \
  --gadget-arm64 path/to/frida-gadget-android-arm64.so \
  --gadget-arm path/to/frida-gadget-android-arm.so \
  --build-tools path/to/android-sdk/build-tools/34.0.0 \
  --output build
python tools/verify.py --original path/to/herodash.apkm \
  --output build --build-tools path/to/android-sdk/build-tools/34.0.0
```

Pass `--keystore path/to/your.keystore` to reuse a signing key. Otherwise a
new debug keystore is created in the output directory.

To build the Morphe bundle locally after building and verifying the APK splits,
clone the public Morphe source dependencies at their pinned tags, then run:

```sh
mkdir -p morphe/upstream
git clone --depth 1 --branch v1.3.4 https://github.com/MorpheApp/morphe-patches-gradle-plugin.git morphe/upstream/morphe-patches-gradle-plugin
git clone --depth 1 --branch v1.15.1 https://github.com/MorpheApp/morphe-patcher.git morphe/upstream/morphe-patcher
python tools/stage_morphe.py --output build
(cd morphe && ./gradlew buildAndroid)
python tools/verify_morphe.py --bundle morphe/patches/build/libs/patches-1.0.0.mpp --output build
```

The `.mpp` patch is declared only for package `com.outfit7.herodash` version
`26.5.1.12192`. Morphe Manager merges the APKM splits before applying its raw
resource patch; the patch checks the original `libmain.so` hashes before
replacing the native payload. A `.mpp` is a patch bundle for Morphe, not an
installable Android application.

## Install

The mod signature differs from Outfit7's signature. Back up any local data
you need, then uninstall the original app before installing the mod. Enable USB
debugging and select **one** split for the phone's ABI:

```sh
adb uninstall com.outfit7.herodash
adb install-multiple build/base-patched.apk build/split_config.arm64_v8a-patched.apk
# For a 32-bit ARM device, use split_config.armeabi_v7a-patched.apk instead.
```

Start the game. Tap the `HD` header to collapse or expand the menu; drag its
handle to move it. The Controls do not modify IAP receipt validation or
leaderboard code. “Reset mod settings” resets the multiplier and toggles; it
does not reverse balances or game progress already written to the local save.

For the `.mpp`, select this patch bundle in Morphe and provide the exact
`26.5.1.12192` APKM as input. Install Morphe's signed output according to its
instructions after removing the original app with the conflicting signature.

## Verification boundaries

The workflow checks source hashes, valid IL2CPP method addresses, the Gadget
dependency and script in each split, package/version, alignment, and shared
APK signing certificate. It also checks that the `.mpp` contains the same
payload and compiled patch code. It does **not** prove in-game behavior on a device.
An ARM Android device smoke test is still needed before calling individual
controls verified. Do not describe this experimental artifact as a fully tested
mod until that test has passed.
