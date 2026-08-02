import { existsSync } from "node:fs";
import { platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const frontendDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = resolve(frontendDir, "..");
const backendScript = join(projectRoot, "backend", "build_backend.py");
const forwardedArgs = process.argv.slice(2);

if (!existsSync(backendScript)) {
  console.error(`Backend build script not found: ${backendScript}`);
  process.exit(1);
}

const candidates = [];
const configuredPython = process.env.LOCAL_AUDIO_LIBRARY_PYTHON?.trim();

if (configuredPython) {
  candidates.push({ command: configuredPython, args: [] });
}

const virtualEnv = process.env.VIRTUAL_ENV?.trim();
if (virtualEnv) {
  const virtualEnvPython =
    platform() === "win32"
      ? join(virtualEnv, "Scripts", "python.exe")
      : join(virtualEnv, "bin", "python");

  if (existsSync(virtualEnvPython)) {
    candidates.push({ command: virtualEnvPython, args: [] });
  }
}

const projectVenvPython =
  platform() === "win32"
    ? join(projectRoot, ".venv", "Scripts", "python.exe")
    : join(projectRoot, ".venv", "bin", "python");

if (existsSync(projectVenvPython)) {
  candidates.push({ command: projectVenvPython, args: [] });
}

if (platform() === "win32") {
  candidates.push(
    { command: "python", args: [] },
    { command: "py", args: ["-3"] },
  );
} else {
  candidates.push(
    { command: "python3", args: [] },
    { command: "python", args: [] },
  );
}

const seen = new Set();

for (const candidate of candidates) {
  const key = JSON.stringify(candidate);
  if (seen.has(key)) {
    continue;
  }
  seen.add(key);

  const args = [...candidate.args, backendScript, ...forwardedArgs];
  const result = spawnSync(candidate.command, args, {
    cwd: join(projectRoot, "backend"),
    env: process.env,
    stdio: "inherit",
  });

  if (result.error?.code === "ENOENT") {
    continue;
  }

  if (result.error) {
    console.error(
      `Failed to start Python (${candidate.command}): ${result.error.message}`,
    );
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}

console.error(
  [
    "No usable Python 3 executable was found.",
    "Set LOCAL_AUDIO_LIBRARY_PYTHON to a Python executable, or run `uv sync` at the project root.",
  ].join("\n"),
);
process.exit(1);
