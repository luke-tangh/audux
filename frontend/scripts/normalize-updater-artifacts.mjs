import { existsSync, readdirSync, renameSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const frontendDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [platformName, version] = process.argv.slice(2);

if (!platformName || !version) {
  console.error("Usage: node scripts/normalize-updater-artifacts.mjs <platform> <version>");
  process.exit(1);
}

if (!platformName.startsWith("macos-")) process.exit(0);

const bundleDir = join(frontendDir, "src-tauri", "target", "release", "bundle", "macos");
const archives = existsSync(bundleDir)
  ? readdirSync(bundleDir).filter((name) => name.endsWith(".app.tar.gz"))
  : [];

if (archives.length !== 1) {
  console.error(`Expected one macOS updater archive, found ${archives.length}`);
  process.exit(1);
}

const architecture = platformName === "macos-arm64" ? "arm64" : "x64";
const sourceName = archives[0];
const targetName = `Audux_${version}_${architecture}.app.tar.gz`;
const sourcePath = join(bundleDir, sourceName);
const sourceSignature = `${sourcePath}.sig`;

if (!existsSync(sourceSignature)) {
  console.error(`Updater signature not found: ${sourceSignature}`);
  process.exit(1);
}

renameSync(sourcePath, join(bundleDir, targetName));
renameSync(sourceSignature, join(bundleDir, `${targetName}.sig`));
console.log(`Normalized macOS updater artifact: ${targetName}`);
