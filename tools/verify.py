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
                assert "setImmediate(initializeMod)" in script, "Gadget script must auto-start"
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
