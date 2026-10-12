package com.herodash.patches

import app.morphe.patcher.patch.ApkFileType
import app.morphe.patcher.patch.AppTarget
import app.morphe.patcher.patch.Compatibility
import app.morphe.patcher.patch.PatchException
import app.morphe.patcher.patch.rawResourcePatch
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest

private val compatibility = Compatibility(
    name = "Talking Tom Hero Dash",
    packageName = "com.outfit7.herodash",
    apkFileType = ApkFileType.APKM,
    appIconColor = 0x009FDB,
    targets = listOf(AppTarget(version = "26.5.1.12192"))
)

private val originalMainHashes = mapOf(
    "arm64-v8a" to "e6ee684092c38dd1f604c572506ada33238dd94fb0ac0220b06d4d82ead2cf31",
    "armeabi-v7a" to "ab65bef5c126f6e03face43d2785f6a324959c88a6f21df155d19c848ed8ed31"
)

private object Payload

@Suppress("unused")
val heroDashLocalPatch = rawResourcePatch(
    name = "Hero Dash local mod",
    description = "Local menu, score, currencies, hero unlocks, ads, and revives for the exact 26.5.1.12192 build.",
    default = true
) {
    compatibleWith(compatibility)
    execute {
        var patchedAbis = 0
        for ((abi, originalHash) in originalMainHashes) {
            val mainPath = get("lib/$abi/libmain.so", false).toPath()
            if (!Files.exists(mainPath)) continue
            val actualHash = MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(mainPath))
                .joinToString("") { "%02x".format(it.toInt() and 0xff) }
            if (actualHash != originalHash) {
                throw PatchException("Unsupported $abi libmain.so: SHA-256 $actualHash")
            }
            for (fileName in listOf("libmain.so", "libherodashmod.so", "libherodashmod.config.so", "libherodashmod.script.so")) {
                val payload = Payload::class.java.getResourceAsStream("/herodash/$abi/$fileName")
                    ?: throw PatchException("Missing bundled payload for $abi/$fileName")
                payload.use { input ->
                    Files.copy(input, get("lib/$abi/$fileName", false).toPath(), StandardCopyOption.REPLACE_EXISTING)
                }
            }
            patchedAbis++
        }
        if (patchedAbis == 0) throw PatchException("No supported ARM native library found in the APK")
    }
}
