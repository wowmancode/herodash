#!/usr/bin/env python3
"""Build and sign the version-pinned non-root APK splits.

Requires Python 3.10+, LIEF 0.17, Android build-tools (zipalign/apksigner),
Java keytool, and the Frida 16.7.19 Android Gadget binaries for both ABIs.
"""
import argparse
import hashlib
import io
import json
import os
import subprocess
import tempfile
import zipfile
from pathlib import Path

import lief

ROOT = Path(__file__).resolve().parents[1]
APKM_SHA256 = "d26091eac51a94fe332322a753f796d80b26e2403a1be004401acaed5ff212f8"
CONFIG = {"interaction": {"type": "script", "path": "libherodashmod.script.so", "on_change": "ignore"}}

def run(*args):
    print("+", " ".join(map(str, args)), flush=True)
    subprocess.run(list(map(str, args)), check=True)

def digest(data):
    return hashlib.sha256(data).hexdigest()

def exact(data, expected, label):
    actual = digest(data)
    if actual != expected:
        raise ValueError(f"{label} SHA-256 mismatch: expected {expected}, got {actual}")

def patch_split(raw, arch, gadget, script, target, temp):
    libdir = {"arm": "lib/armeabi-v7a/", "arm64": "lib/arm64-v8a/"}[arch]
    path = libdir + "libmain.so"
    with zipfile.ZipFile(io.BytesIO(raw)) as src:
        exact(src.read(libdir + "libil2cpp.so"), target["il2cppSha256"], arch + " libil2cpp")
        original_main = src.read(path)
        exact(original_main, target["mainSha256"], arch + " libmain")
        main_path = temp / f"main-{arch}.so"
        patched_path = temp / f"main-{arch}-patched.so"
        main_path.write_bytes(original_main)
        elf = lief.parse(str(main_path))
        if elf is None or elf.header.machine_type not in (lief.ELF.ARCH.AARCH64, lief.ELF.ARCH.ARM):
            raise ValueError(f"{arch} libmain is not the expected ELF architecture")
        elf.add_library("libherodashmod.so")
        elf.write(str(patched_path))
        if "libherodashmod.so" not in lief.parse(str(patched_path)).libraries:
            raise ValueError(f"{arch}: dependency injection failed")
        out = temp / f"split-{arch}-unsigned.apk"
        with zipfile.ZipFile(out, "w") as dst:
            for entry in src.infolist():
                if entry.filename == path:
                    dst.writestr(entry, patched_path.read_bytes())
                elif entry.filename.startswith("META-INF/") or entry.filename == "stamp-cert-sha256":
                    continue
                else:
                    dst.writestr(entry, src.read(entry.filename))
            dst.writestr(libdir + "libherodashmod.so", Path(gadget).read_bytes(), compress_type=zipfile.ZIP_DEFLATED)
            dst.writestr(libdir + "libherodashmod.config.so", json.dumps(CONFIG, separators=(",", ":")), compress_type=zipfile.ZIP_DEFLATED)
            dst.writestr(libdir + "libherodashmod.script.so", script, compress_type=zipfile.ZIP_DEFLATED)
    return out

def sign(unsigned, output, tools, keystore, password):
    aligned = unsigned.with_name(unsigned.stem + "-aligned.apk")
    run(tools / "zipalign", "-f", "4", unsigned, aligned)
    run(tools / "apksigner", "sign", "--ks", keystore, "--ks-key-alias", "herodashmod",
        "--ks-pass", "pass:" + password, "--key-pass", "pass:" + password,
        "--v1-signing-enabled", "true", "--v2-signing-enabled", "true",
        "--out", output, aligned)
    run(tools / "zipalign", "-c", "4", output)
    run(tools / "apksigner", "verify", "--verbose", output)

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--apkm", required=True, type=Path)
    p.add_argument("--gadget-arm64", required=True, type=Path)
    p.add_argument("--gadget-arm", required=True, type=Path)
    p.add_argument("--build-tools", required=True, type=Path)
    p.add_argument("--output", required=True, type=Path)
    p.add_argument("--keystore", type=Path)
    p.add_argument("--password", default="android")
    a = p.parse_args()
    a.output.mkdir(parents=True, exist_ok=True)
    targets = json.loads((ROOT / "mod/targets.json").read_text())
    exact(a.apkm.read_bytes(), APKM_SHA256, "APKM")
    template = (ROOT / "mod/mod.js").read_text()
    if template.count("__TARGETS__") != 1:
        raise ValueError("mod.js must contain one target placeholder")
    script = template.replace("__TARGETS__", json.dumps(targets, separators=(",", ":")))
    with zipfile.ZipFile(a.apkm) as bundle, tempfile.TemporaryDirectory() as temp_name:
        temp = Path(temp_name)
        info = json.loads(bundle.read("info.json"))
        if info["pname"] != "com.outfit7.herodash" or info["versioncode"] != "202605010":
            raise ValueError("Unexpected package or version code")
        base = temp / "base-unsigned.apk"
        base.write_bytes(bundle.read("base.apk"))
        with zipfile.ZipFile(base) as apk:
            exact(apk.read("assets/bin/Data/Managed/Metadata/global-metadata.dat"),
                  targets["arm64"]["metadataSha256"], "IL2CPP metadata")
        split64 = patch_split(bundle.read("split_config.arm64_v8a.apk"), "arm64", a.gadget_arm64,
                              script, targets["arm64"], temp)
        split32 = patch_split(bundle.read("split_config.armeabi_v7a.apk"), "arm", a.gadget_arm,
                              script, targets["arm"], temp)
        keystore = a.keystore or (a.output / "herodashmod-debug.keystore")
        if not keystore.exists():
            run("keytool", "-genkeypair", "-keystore", keystore, "-alias", "herodashmod",
                "-storepass", a.password, "-keypass", a.password, "-dname", "CN=HeroDash Local Mod",
                "-keyalg", "RSA", "-keysize", "3072", "-validity", "10000", "-noprompt")
        sign(base, a.output / "base-patched.apk", a.build_tools, keystore, a.password)
        sign(split64, a.output / "split_config.arm64_v8a-patched.apk", a.build_tools, keystore, a.password)
        sign(split32, a.output / "split_config.armeabi_v7a-patched.apk", a.build_tools, keystore, a.password)
    print("Build complete:", a.output)

if __name__ == "__main__":
    main()
