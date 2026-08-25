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
开发或镜像测试可通过 `AUDUX_WHISPER_MANIFEST_URL` 指定 HTTPS manifest。

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

## 内部构建与 v1.0 发布门槛

GitHub Actions 的 `Internal Builds and v1 Release` 可手动触发，在 Linux x64、Windows
x64 和 macOS 13+ x64 上构建 Tauri、browser-lite、backend sidecar 和 Whisper companion。
手动运行只保留 artifacts，不创建 GitHub Release。

workflow 只允许 `v1.0.*` tag 进入公开发布任务。发布 tag 必须与根目录 `VERSION` 一致；
Python、npm、Cargo、Tauri 和 backend 版本也必须一致。v0.x 不创建公开 Release。

构建前至少确认：

1. `uv.lock` 与 `pyproject.toml` 同步；
2. 当前平台 lite sidecar 与 Whisper companion 可以构建、校验和启动；
3. 安装包没有 debug placeholder；
4. LLM / ASR 配置没有指向不可信服务，也没有凭据进入产物；
5. [`release-checklist.md`](release-checklist.md) 中对应平台的安装、恢复、Provider、MCP、
   归档和进程退出检查完成。

`cargo check`、前端 build 或单独 sidecar 成功都不能替代目标 OS 上的完整 Tauri bundle 验证。

## 可安装版本与签名更新

首次公开发布仍从 `v1.0.*` 标签开始。标签构建会发布以下可直接安装的文件：

- Linux x64：AppImage、DEB 和 RPM；
- Windows x64：NSIS 安装程序；
- macOS 13+：Intel x64 与 Apple Silicon arm64 的 DMG；
- 三个平台的 browser-lite 与可选 Whisper companion。

桌面端的“设置 → 更新”只读取 GitHub Release 中的 `latest.json`。正式构建使用 Tauri v2
更新签名：安装包签名验证失败时不会进入更新前备份或安装阶段。首次发布前生成并妥善保管
一对 updater 密钥：

```bash
cd frontend
npx tauri signer generate -w /安全位置/audux-updater.key
```

将私钥内容、私钥密码和公钥内容分别配置为 GitHub Actions secrets：

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- `TAURI_UPDATER_PUBLIC_KEY`

私钥不可提交到仓库或放入 `.env`。丢失私钥后，已安装版本将无法验证后续更新；发布前应将
它纳入加密离线备份。普通 `workflow_dispatch` 和本地 `npm run tauri:build` 不生成 updater
产物，也不需要这些密钥。只有匹配版本号的公开标签构建会：

1. 生成临时 release 配置并嵌入公钥与 HTTPS 更新地址；
2. 生成各平台 updater artifact 和 `.sig`；
3. 汇总成同时包含 Linux x64、Windows x64、macOS x64/arm64 的 `latest.json`；
4. 将普通安装包、updater artifact、签名和清单上传到同一个 GitHub Release。

Updater 签名只验证更新来源，不能替代 Windows Authenticode 或 Apple Developer ID / notarization。
公开发布前仍须按目标平台配置系统安装包签名，并在干净机器上验证下载、首次安装和升级。
