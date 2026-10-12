group = "com.herodash.localmod"

patches {
    about {
        name = "Hero Dash Local Mod"
        description = "Version-pinned local patches for Talking Tom Hero Dash"
        source = "https://github.com/wowmancode/herodash"
        author = "Hero Dash local mod contributors"
        contact = "https://github.com/wowmancode/herodash/issues"
        website = "https://github.com/wowmancode/herodash"
        license = "MIT"
    }
}

// Separate configuration so gson is available at runtime for the
// generatePatchesList task but never bundled into the APK.
val patchListGeneratorClasspath = configurations.create("patchListGeneratorClasspath")

dependencies {
    compileOnly(libs.gson)
    patchListGeneratorClasspath(libs.gson)
}

tasks {
    register<JavaExec>("generatePatchesList") {
        description = "Build patch with patch list"

        dependsOn(build)

        classpath = sourceSets["main"].runtimeClasspath + patchListGeneratorClasspath
        mainClass.set("util.PatchListGeneratorKt")
    }

    // Used by gradle-semantic-release-plugin.
    publish {
        dependsOn("generatePatchesList")
    }
}
