import { access, copyFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const androidRoot = resolve(root, "android");
const wrapper = resolve(androidRoot, process.platform === "win32" ? "gradlew.bat" : "gradlew");
const localAndroidSdk = resolve(root, ".android-tools", "sdk");
const localGradleHome = resolve(root, ".android-tools", "gradle-home");
const sourceApk = resolve(androidRoot, "app", "build", "outputs", "apk", "debug", "app-debug.apk");
const artifactDirectory = resolve(root, "artifacts");
const artifactApk = resolve(artifactDirectory, "WhereToI-debug.apk");

await access(wrapper).catch(() => {
  throw new Error("Android Gradle wrapper is missing. Generate it before running npm run android:apk.");
});

await new Promise((resolveBuild, rejectBuild) => {
  const child = spawn(wrapper, ["--no-daemon", "assembleDebug"], {
    cwd: androidRoot,
    env: {
      ...process.env,
      ANDROID_HOME: process.env.ANDROID_HOME ?? localAndroidSdk,
      GRADLE_USER_HOME: process.env.GRADLE_USER_HOME ?? localGradleHome
    },
    stdio: "inherit"
  });

  child.once("error", rejectBuild);
  child.once("exit", (code) => {
    if (code === 0) {
      resolveBuild();
      return;
    }
    rejectBuild(new Error(`Android build exited with status ${code ?? "unknown"}.`));
  });
});

await mkdir(artifactDirectory, { recursive: true });
await copyFile(sourceApk, artifactApk);
console.log(`Android APK built at ${artifactApk}`);
