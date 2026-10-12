#!/usr/bin/env python3
"""Extract version-specific IL2CPP addresses from Il2CppDumper's dump.cs.

This deliberately fails when a class or method is missing or ambiguous. The
result is pinned to SHA-256 hashes of the exact native libraries and metadata.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path

METHODS = {
    "HDCurrencyManager": ["get_HDCurrencyState()", "get_CoinBalance()", "get_GemsBalance()", "get_TokensBalance()"],
    "HDCurrencyState": ["GetHDAccount(string id)"],
    "CurrencyManager": ["WriteChanges(bool force", "CheckAndFireBalanceChangeEvent(CurrencyAccount account"],
    "CharacterManager": ["Init()", "UnlockEverySkin()", "FullyUnlockCharacterAndSkins(CharacterType characterType)"],
    "RunnerStateData": ["Reset(long multiplier"],
    "RunnerManager": ["PrepareDataForRun(bool restart", "EndRun()"],
    "BannerAdManager": ["set_BannerEnabled(bool value)"],
    "InterstitialAdManager": ["get_AdReady()"],
    "SaveMeState": ["OnEnter(BaseGameState previousState", "OnExit(BaseGameState nextState", "OnSaveMeHandled(bool saved", "TryToPurchaseSaveMe(string clickState)"],
    "HDAdManager": ["OnLateUpdate()"],
}

def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def extract(dump):
    text = Path(dump).read_text()
    methods = {}
    for class_name, signatures in METHODS.items():
        candidates = list(re.finditer(r"^.*\bclass " + re.escape(class_name) + r"(?:\s|:|//)", text, re.M))
        if len(candidates) != 1:
            raise ValueError(f"{class_name}: expected one class, found {len(candidates)}")
        body_end = text.find("\n}", candidates[0].end())
        body = text[candidates[0].start():body_end]
        for signature in signatures:
            if body.count(signature) != 1:
                raise ValueError(f"{class_name}.{signature}: expected one method, found {body.count(signature)}")
            pos = body.find(signature)
            rva_pos = body.rfind("// RVA:", 0, pos)
            between = body[rva_pos:pos]
            if between.count("// RVA:") != 1:
                raise ValueError(f"{class_name}.{signature}: ambiguous RVA")
            match = re.search(r"// RVA: (0x[0-9A-Fa-f]+)", between)
            if not match:
                raise ValueError(f"{class_name}.{signature}: no RVA")
            method_name = signature.split("(")[0]
            methods[f"{class_name}.{method_name}"] = int(match.group(1), 16)
    return methods

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--dump64", required=True)
    p.add_argument("--dump32", required=True)
    p.add_argument("--lib64", required=True)
    p.add_argument("--lib32", required=True)
    p.add_argument("--main64", required=True)
    p.add_argument("--main32", required=True)
    p.add_argument("--metadata", required=True)
    p.add_argument("--output", required=True)
    a = p.parse_args()
    meta = sha(a.metadata)
    targets = {
        "arm64": {"il2cppSha256": sha(a.lib64), "mainSha256": sha(a.main64),
                  "metadataSha256": meta, "methods": extract(a.dump64),
                  "fields": {"currencyBalance": 0x18, "runnerMultiplier": 0x130}},
        "arm": {"il2cppSha256": sha(a.lib32), "mainSha256": sha(a.main32),
                "metadataSha256": meta, "methods": extract(a.dump32),
                "fields": {"currencyBalance": 0xC, "runnerMultiplier": 0xB0}},
    }
    Path(a.output).write_text(json.dumps(targets, indent=2, sort_keys=True) + "\n")

if __name__ == "__main__":
    main()
