#!/usr/bin/env python3
"""Check that the Morphe bundle contains the exact verified APK payload."""
import argparse
import zipfile
from pathlib import Path

FILES = ("libmain.so", "libherodashmod.so", "libherodashmod.config.so", "libherodashmod.script.so")
SPLITS = {
    "arm64-v8a": "split_config.arm64_v8a-patched.apk",
    "armeabi-v7a": "split_config.armeabi_v7a-patched.apk",
}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--bundle", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    with zipfile.ZipFile(args.bundle) as bundle:
        assert bundle.testzip() is None
        dex_header = bundle.read("classes.dex")[:8]
        assert dex_header[:4] == b"dex\n" and dex_header[4:7].isdigit() and dex_header[7] == 0
        assert bundle.read("com/herodash/patches/HeroDashLocalPatchKt.class")[:4] == b"\xca\xfe\xba\xbe"
        for abi, split in SPLITS.items():
            with zipfile.ZipFile(args.output / split) as apk:
                for name in FILES:
                    assert bundle.read(f"herodash/{abi}/{name}") == apk.read(f"lib/{abi}/{name}"), (abi, name)
    print("Morphe bundle contains both exact ABI payloads and compiled patch code")

if __name__ == "__main__":
    main()
