import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const frontendDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(frontendDir, "src-tauri", "tauri.release.conf.json");
const publicKey = process.env.TAURI_UPDATER_PUBLIC_KEY?.trim();

if (!publicKey) {
  console.error("TAURI_UPDATER_PUBLIC_KEY is required for a signed release build.");
  process.exit(1);
}

const config = {
  bundle: {
    createUpdaterArtifacts: true
  },
  plugins: {
    updater: {
      pubkey: publicKey,
      endpoints: [
        "https://github.com/luke-tangh/audux/releases/latest/download/latest.json"
      ],
      windows: {
        installMode: "passive"
      }
    }
  }
};

writeFileSync(outputPath, `${JSON.stringify(config, null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o600
});
console.log(`Prepared updater release configuration: ${outputPath}`);
