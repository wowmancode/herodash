#!/usr/bin/env python3
"""Static build validation for both installable ABI variants."""
import argparse
import hashlib
import io
import json
import re
import subprocess
import zipfile
from pathlib import Path

import lief

ROOT = Path(__file__).resolve().parents[1]

def sha(data):
    return hashlib.sha256(data).hexdigest()

def command(*args):
    return subprocess.check_output(list(map(str, args)), text=True)

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--original", required=True, type=Path)
    p.add_argument("--output", required=True, type=Path)
    p.add_argument("--build-tools", required=True, type=Path)
    a = p.parse_args()
    targets = json.loads((ROOT / "mod/targets.json").read_text())
    # Catch the precise error observed on Android 17: Frida cannot resolve
    # TextView.setText(int) versus TextView.setText(CharSequence) for JS strings.
    menu_source = (ROOT / "mod/mod.js").read_text(encoding="utf-8")
    assert "function setViewText(view, value)" in menu_source
    assert "setText.overload('java.lang.CharSequence')" in menu_source
    assert not re.search(r"\\.(?:setText|setHint)\\s*\\(", menu_source), (
        "Ambiguous Android text overload: route through setViewText/setViewHint"
    )
    certs = []
    with zipfile.ZipFile(a.original) as original:
        for arch, split in (("arm64", "split_config.arm64_v8a"), ("arm", "split_config.armeabi_v7a")):
            path = a.output / (split + "-patched.apk")
            assert path.is_file() and path.stat().st_size > 1_000_000, path
            libdir = {"arm64": "lib/arm64-v8a/", "arm": "lib/armeabi-v7a/"}[arch]
            with zipfile.ZipFile(io.BytesIO(original.read(split + ".apk"))) as before, zipfile.ZipFile(path) as after:
                assert sha(after.read(libdir + "libil2cpp.so")) == targets[arch]["il2cppSha256"]
                assert after.read(libdir + "libil2cpp.so") == before.read(libdir + "libil2cpp.so")
                assert after.read(libdir + "libherodashmod.so")[:4] == b"\x7fELF"
                cfg = json.loads(after.read(libdir + "libherodashmod.config.so"))
                assert cfg["interaction"]["path"] == "libherodashmod.script.so"
                script = after.read(libdir + "libherodashmod.script.so").decode()
                assert "__TARGETS__" not in script
                # Frida Gadget script mode calls rpc.exports.init(), and
                # frida-compile bundles the Java bridge into this file.
                assert "Gadget init stage=" in script, "Missing Gadget lifecycle entrypoint"
                # These markers belong to the current asynchronous menu implementation.
                # The old "About to build menu" message was removed when the UI
                # initialization gained delayed attachment and retry support.
                assert "Unity activity detected; menu attachment scheduled" in script, (
                    "Expected current menu scheduling code"
                )
                assert "Floating menu attached" in script, "Expected mod menu attachment code"
                assert "infiniteRevives" in script and "runnerMultiplier" in script
                assert "setCurrency" in script and "UnlockEverySkin" in script
                main_lib = lief.parse(list(after.read(libdir + "libmain.so")))
                assert "libherodashmod.so" in main_lib.libraries
                il2cpp = lief.parse(list(after.read(libdir + "libil2cpp.so")))
                executable = [seg for seg in il2cpp.segments if seg.has(lief.ELF.Segment.FLAGS.X)]
                for name, rva in targets[arch]["methods"].items():
                    assert any(seg.virtual_address <= rva < seg.virtual_address + seg.virtual_size for seg in executable), (arch, name, hex(rva))
                assert not any(("Purchas" in name and name != "SaveMeState.TryToPurchaseSaveMe")
                               or "Receipt" in name for name in targets[arch]["methods"])
            cert = command(a.build_tools / "apksigner", "verify", "--print-certs", path)
            certs.append(re.search(r"Signer #1 certificate SHA-256 digest: ([0-9a-f]+)", cert).group(1))
            print(f"Verified {arch}: {len(targets[arch]['methods'])} native targets; cert {certs[-1]}")
    base = a.output / "base-patched.apk"
    assert base.is_file()
    badging = command(a.build_tools / "aapt", "dump", "badging", base)
    assert "name='com.outfit7.herodash'" in badging
    assert "versionCode='202605010'" in badging
    cert = command(a.build_tools / "apksigner", "verify", "--print-certs", base)
    certs.append(re.search(r"Signer #1 certificate SHA-256 digest: ([0-9a-f]+)", cert).group(1))
    assert len(set(certs)) == 1, certs
    print("All three APKs share one valid signing certificate and the expected package/version")

if __name__ == "__main__":
    main()
