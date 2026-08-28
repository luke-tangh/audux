# Build and release validation

[Development and contribution](README.md) · [English documentation home](../README.md) ·
[简体中文](../../zh-CN/contributing/building.md)

Native Audux sidecars must be built on their target operating system. Never copy a PyInstaller
artifact between platforms or ship a debug placeholder in a release.

## Backend sidecar

The default main sidecar is the lite build. It excludes faster-whisper but includes Silero VAD,
ONNX Runtime CPU, and the pinned VAD model:

```bash
uv run --locked --group build python backend/build_backend.py
```

The output name is:

```text
frontend/src-tauri/binaries/audux-backend-<target-triple>[.exe]
```

The current-platform wrapper is also available from `frontend/`:

```bash
cd frontend
npm run build:backend
```

Set `AUDUX_BUILD_WITH_ASR=0` explicitly for a lightweight build. Tauri `externalBin` must continue
to match `audux-backend-<target-triple>[.exe]`.

## Whisper companion

Build the optional companion for the current platform separately:

```bash
uv sync --locked --extra asr --group build
uv run --locked --extra asr --group build python backend/build_whisper_companion.py
```

Outputs under `backend/dist/whisper-components/` include a platform ZIP and descriptor. The build
workflow aggregates them into `whisper-components.json`. The default download URL targets the
GitHub Release matching the application version; development mirrors may use
`AUDUX_WHISPER_MANIFEST_URL` with HTTPS.

The client accepts `whisper-components.json` and its same-path `.sig` only after embedded Ed25519
public-key validation, then checks the ZIP and executable sizes and SHA-256 values.

Generate a dedicated manifest signing key before the first public release:

```bash
openssl genpkey -algorithm Ed25519 -out audux-whisper-manifest-private.pem
openssl pkey -in audux-whisper-manifest-private.pem \
  -pubout -out audux-whisper-manifest-public.pem
```

Store the complete PEM contents as `release` Environment secrets:

- `AUDUX_WHISPER_MANIFEST_PRIVATE_KEY`
- `AUDUX_WHISPER_MANIFEST_PUBLIC_KEY`

A public tag build fails without the public key; publishing fails without the private key or a
valid signature. Never commit the private key. The public key is embedded in backend sidecars and
browser-lite. Rotation requires a compatibility release that trusts both old and new keys before
the old trust root is removed.

## browser-lite

browser-lite packages the production frontend and lite backend into one executable:

```bash
cd frontend
npm run build:browser-lite

cd ..
uv run --locked --group build python backend/build_browser_lite.py
```

Outputs under `backend/dist/browser-lite/` are:

```text
audux-lite-<target-triple>[.exe]
audux-lite-<target-triple>.zip
```

At startup it selects a free `127.0.0.1` port and opens the default browser. Set
`AUDUX_BROWSER_PORT` to request a port or `AUDUX_BROWSER_OPEN=0` to suppress browser launch.
`Ctrl+C` stops the backend.

browser-lite remains a local backend, not a public static web deployment. Native Tauri file pickers
are unavailable, so library paths are entered manually. Whisper uses the same companion installer.

## Tauri

Ubuntu/Debian requires:

```bash
sudo apt-get update
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  libappindicator3-dev \
  librsvg2-dev \
  fonts-noto-cjk \
  patchelf \
  rpm

rustup toolchain install stable
```

Build from `frontend/`:

```bash
npm ci
npm run tauri:build
```

`tauri:build` creates the backend sidecar for the current target, then the frontend and installer.
Python lookup uses `AUDUX_PYTHON`, active `VIRTUAL_ENV`, repository `.venv`, then the platform
Python command; on Windows the wrapper also tries `py -3`.

## v1.0 build and release gates

The `Internal Builds and v1 Release` workflow builds Tauri, browser-lite, backend sidecars, and
Whisper companions on Linux x64, Windows x64, and macOS 14+ Apple Silicon. Intel macOS is outside
the v1.0 target set.

A normal manual run uses the keyless `internal-build` Environment, retains validated artifacts for
all targets, and creates no GitHub Release. `signed_preflight=true` runs from `main` through the
`release` Environment using the same signing, aggregation, checksum, and provenance path as a tag,
but still does not publish.

Before packaging, tag builds require backend branch coverage, frontend unit coverage/typecheck/
production build/Playwright, and Rust tests plus `cargo check` on Linux, Windows, and macOS. Any
failure prevents all three build and publish jobs.

Only `v1.0.*` tags can publish. The tag must match `VERSION`, belong to remote `main`, and agree with
Python, npm, Cargo, Tauri, and backend versions. A matching
`docs/en/releases/<tag>.md` release body is required. v0.x tags never publish. Signing jobs use a
`release` Environment restricted to `main` and `v1.0.*`; draft assets are downloaded and verified
against `SHA256SUMS` before the release becomes latest.

CI and release reuse `.github/workflows/quality-gates.yml`, so backend coverage/retrieval eval,
frontend coverage/typecheck/build/Playwright, and three-platform Rust gates have one definition.
Node and Rust are pinned by `.node-version` and `rust-toolchain.toml`; runners, uv, and Actions are
also pinned and every job has a timeout.

Before building, confirm:

1. `uv.lock` matches `pyproject.toml`.
2. The platform lite sidecar and Whisper companion build, validate, and start.
3. No installer contains a debug placeholder.
4. Provider configuration points only to trusted services and no credentials enter artifacts.
5. Installer resources and browser-lite/Whisper ZIPs contain `THIRD_PARTY_NOTICES.txt`.
6. The platform steps in the [release checklist](release-checklist.md) are complete.

`cargo check`, a frontend build, or a sidecar build alone never substitutes for a complete Tauri
bundle on the target OS.

## Installers, updater validation, and platform signing

Stable `v1.0.*` tags publish:

- Linux x64 AppImage, DEB, and RPM;
- Windows x64 NSIS installer;
- macOS 14+ Apple Silicon DMG;
- browser-lite and optional Whisper companion for all three targets.

Settings > Updates reads `latest.json` from GitHub Releases. Official builds use Tauri v2 updater
signatures; a bad artifact signature stops before pre-update backup or installation. Generate and
secure an updater key pair before the first release:

```bash
cd frontend
npx tauri signer generate -w /secure/location/audux-updater.key
```

Store these as `release` Environment secrets:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- `TAURI_UPDATER_PUBLIC_KEY`

Never commit the private key or place it in `.env`. Losing it prevents installed versions from
validating future updates, so keep an encrypted offline backup. Normal `workflow_dispatch` and
local `npm run tauri:build` do not need updater keys. Signed preflight or a matching public tag:

1. generates temporary release configuration with the public key and HTTPS update URL;
2. creates platform updater artifacts and `.sig` files;
3. aggregates Linux x64, Windows x64, and macOS arm64 into `latest.json`;
4. validates artifact allowlists, ZIP contents, descriptor hashes, and the complete target set;
5. generates `SHA256SUMS` and GitHub artifact provenance attestation;
6. uploads installers, updater artifacts, signatures, and manifests as a draft and verifies them
   before publication.

Updater signing authenticates in-app updates; it does not replace Authenticode or Apple Developer
ID/notarization. Current Windows and macOS packages may show publisher warnings. Release notes must
state that limitation, and clean-machine testing must cover download, first install, and upgrade
through those warnings.
