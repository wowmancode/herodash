#!/usr/bin/env python3
"""Stage the verified native payload as resources for Morphe's raw resource patch."""
import argparse
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FILES = ("libmain.so", "libherodashmod.so", "libherodashmod.config.so", "libherodashmod.script.so")
SPLITS = {
    "arm64-v8a": "split_config.arm64_v8a-patched.apk",
    "armeabi-v7a": "split_config.armeabi_v7a-patched.apk",
}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path, help="Directory containing patched APK splits")
    args = parser.parse_args()
    resources = ROOT / "morphe/patches/src/main/resources/herodash"
    for abi, split in SPLITS.items():
        destination = resources / abi
        destination.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(args.output / split) as apk:
            for name in FILES:
                (destination / name).write_bytes(apk.read(f"lib/{abi}/{name}"))
    print("Staged Morphe resources:", resources)

if __name__ == "__main__":
    main()
