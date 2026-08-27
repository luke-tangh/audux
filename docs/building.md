# 构建与发布验证

Audux 的 native sidecar 必须在目标操作系统构建。不要把一个平台的 PyInstaller 产物复制
进另一个平台的 Tauri bundle，也不要在 release 中包含 debug placeholder。

## Backend sidecar

默认主 sidecar 是 lite 构建，不包含 faster-whisper，但包含 Silero VAD、ONNX Runtime CPU
runtime 和固定版本 VAD 模型：

```bash
uv run --locked --group build python backend/build_backend.py
```

产物名称为：

```text
frontend/src-tauri/binaries/audux-backend-<target-triple>[.exe]
```

也可以从 `frontend/` 调用当前平台构建包装器：

```bash
cd frontend
npm run build:backend
```

轻量构建可显式设置 `AUDUX_BUILD_WITH_ASR=0`。Tauri `externalBin` 最终文件名必须继续匹配
`audux-backend-<target-triple>[.exe]`。

## Whisper companion

单独构建当前平台的可选 companion：

```bash
uv sync --locked --extra asr --group build
uv run --locked --extra asr --group build python backend/build_whisper_companion.py
```

产物位于 `backend/dist/whisper-components/`，包括平台 ZIP 和 descriptor。内部构建流程会
汇总生成 `whisper-components.json`。默认下载地址指向与应用版本一致的 GitHub Release；
开发或镜像测试可通过 `AUDUX_WHISPER_MANIFEST_URL` 指定 HTTPS manifest。客户端只接受由
内置 Ed25519 公钥验证通过的 `whisper-components.json` 和同路径
`whisper-components.json.sig`；ZIP 和其中的可执行文件还会分别校验大小与 SHA-256。

首次公开发布前生成独立的 Whisper 清单签名密钥：

```bash
openssl genpkey -algorithm Ed25519 -out audux-whisper-manifest-private.pem
openssl pkey -in audux-whisper-manifest-private.pem \
  -pubout -out audux-whisper-manifest-public.pem
```

将两个 PEM 文件的完整内容分别配置为 `release` Environment secrets：

- `AUDUX_WHISPER_MANIFEST_PRIVATE_KEY`
- `AUDUX_WHISPER_MANIFEST_PUBLIC_KEY`

公开标签构建缺少公钥会直接失败，发布任务缺少私钥或签名失败也不会创建 Release。私钥不得
提交到仓库；公钥会在构建时嵌入 backend sidecar 和 browser-lite。轮换密钥需要先发布同时
信任新旧公钥的兼容版本，不能直接替换现有密钥。

## browser-lite

browser-lite 将生产前端与 lite backend 打包为单个可执行文件：

```bash
cd frontend
npm run build:browser-lite

cd ..
uv run --locked --group build python backend/build_browser_lite.py
```

产物位于 `backend/dist/browser-lite/`：

```text
audux-lite-<target-triple>[.exe]
audux-lite-<target-triple>.zip
```

启动时它选择可用的 `127.0.0.1` 端口并打开默认浏览器。可用 `AUDUX_BROWSER_PORT` 指定
端口，或设置 `AUDUX_BROWSER_OPEN=0` 禁止自动打开。终端中的 `Ctrl+C` 停止 backend。

browser-lite 仍在本机运行 backend，不是可部署到公网的静态 Web 应用。Tauri 原生选择器
不可用，媒体库路径需要手工输入；Whisper 使用同一 companion 安装机制。

## Tauri

Ubuntu / Debian 需要：

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

安装依赖后从 `frontend/` 构建：

```bash
npm ci
npm run tauri:build
```

`tauri:build` 先生成当前 target triple 的 backend sidecar，再构建前端和安装包。Python
查找顺序为 `AUDUX_PYTHON`、激活的 `VIRTUAL_ENV`、仓库 `.venv`，最后是平台 Python
命令；构建包装器在 Windows 还会尝试 `py -3`。

## v1.0 构建与发布门槛

GitHub Actions 的 `Internal Builds and v1 Release` 可手动触发，在 Linux x64、Windows
x64 和 macOS 14+ Apple Silicon 上构建 Tauri、browser-lite、backend sidecar 和 Whisper
companion。macOS Intel 不在 v1.0 支持范围内。
手动运行默认使用无密钥的 `internal-build` Environment，只保留三个目标的已校验 artifacts，
不读取签名 secrets，也不创建 GitHub Release。将 `signed_preflight` 设为 `true` 时，workflow
会从 `main` 进入 `release` Environment，走与正式 tag 相同的签名、汇总、校验和与
provenance attestation 路径，生成完整 release candidate，但仍不会发布，也不需要人工审批。

标签构建在任何打包任务之前强制执行 backend 分支覆盖率、frontend 单元覆盖率/类型检查/
生产构建/Playwright，以及 Linux、Windows、macOS 的 Rust 测试和 `cargo check`。任一门禁
失败，三个目标的构建和发布任务都不会开始。

workflow 只允许 `v1.0.*` tag 进入公开发布任务。发布 tag 必须与根目录 `VERSION` 一致，且
tag commit 必须属于远端 `main` 历史；Python、npm、Cargo、Tauri 和 backend 版本也必须
一致，并且必须存在与 tag 同名的 `docs/releases/<tag>.md` 发布说明。v0.x 不创建公开
Release。签名构建和发布 job 使用仅允许 `main` 与 `v1.0.*` tag 的 `release` Environment；该
Environment 负责隔离签名 secrets 和限制发布来源，不配置 required reviewers。正式发布先创建
draft，重新下载全部 assets 验证 `SHA256SUMS`，成功后才公开为 latest Release。

如果 tag workflow 已成功汇总并 attestation 完整 release candidate、但最终 GitHub Release
发布 job 失败，可从 `main` 手动运行 `Recover verified v1 Release`，传入失败 run ID 和对应
tag。恢复 workflow 会重新验证 source run 的 tag/SHA、候选 artifact 和 checksums，并继续执行
相同的 draft、回下载验证和 latest 发布流程；不能用于任意分支构建或已存在的 Release。

CI 与 release 共用 `.github/workflows/quality-gates.yml`，因此 backend 覆盖率、retrieval eval、
frontend 覆盖率/类型检查/生产构建/Playwright，以及三平台 Rust 检查只有一份定义。Node 和
Rust 分别固定在 `.node-version` 与 `rust-toolchain.toml`；runner、uv 和第三方 Actions 也都
固定版本或完整 commit SHA，所有 job 都有超时限制。

构建前至少确认：

1. `uv.lock` 与 `pyproject.toml` 同步；
2. 当前平台 lite sidecar 与 Whisper companion 可以构建、校验和启动；
3. 安装包没有 debug placeholder；
4. LLM / ASR 配置没有指向不可信服务，也没有凭据进入产物；
5. 安装包资源和 browser-lite / Whisper ZIP 包含 `THIRD_PARTY_NOTICES.txt`；
6. [`release-checklist.md`](release-checklist.md) 中对应平台的安装、恢复、Provider、MCP、
   归档和进程退出检查完成。

`cargo check`、前端 build 或单独 sidecar 成功都不能替代目标 OS 上的完整 Tauri bundle 验证。

## 可安装版本、updater 验证与平台签名状态

稳定版发布使用 `v1.0.*` 标签。标签构建会发布以下可直接安装的文件：

- Linux x64：AppImage、DEB 和 RPM；
- Windows x64：NSIS 安装程序；
- macOS 14+ Apple Silicon：arm64 DMG；
- 三个平台的 browser-lite 与可选 Whisper companion。

桌面端的“设置 → 更新”只读取 GitHub Release 中的 `latest.json`。正式构建使用 Tauri v2
updater 签名：updater artifact 签名验证失败时不会进入更新前备份或安装阶段。首次发布前
生成并妥善保管一对 updater 密钥：

```bash
cd frontend
npx tauri signer generate -w /安全位置/audux-updater.key
```

将私钥内容、私钥密码和公钥内容分别配置为 `release` Environment secrets：

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- `TAURI_UPDATER_PUBLIC_KEY`

私钥不可提交到仓库或放入 `.env`。丢失私钥后，已安装版本将无法验证后续更新；发布前应将
它纳入加密离线备份。普通 `workflow_dispatch` 和本地 `npm run tauri:build` 不生成 updater
产物，也不需要这些密钥。手动启用 `signed_preflight` 或推送匹配版本号的公开标签时才会：

1. 生成临时 release 配置并嵌入公钥与 HTTPS 更新地址；
2. 生成各平台 updater artifact 和 `.sig`；
3. 汇总成同时包含 Linux x64、Windows x64、macOS arm64 的 `latest.json`；
4. 严格校验各平台 artifact 白名单、ZIP 内容、descriptor 哈希和完整 target 集；
5. 生成 `SHA256SUMS` 和 GitHub artifact provenance attestation；
6. 正式 tag 流程将普通安装包、updater artifact、签名和清单作为 draft 上传，回读校验后
   再公开。

Updater 签名只验证应用内更新来源，不能替代 Windows Authenticode 或 Apple Developer ID /
notarization。当前阶段按项目决定暂不配置操作系统级代码签名，因此 Windows 和 macOS 可能
显示未知发布者或未公证警告；发布说明和下载页必须明确提示这一点。后续启用平台签名前，
仍需在干净机器上验证警告后的下载、首次安装和升级流程。
