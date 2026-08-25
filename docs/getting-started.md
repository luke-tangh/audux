# 快速上手

Audux 当前提供浏览器开发模式、Tauri 桌面开发模式和打包后的 browser-lite 三种运行形态。
公开安装包将在 v1.0 才提供；当前 v0.x 需要从源码运行或使用内部构建产物。

v1.0 发布后，普通用户可在 GitHub Releases 直接下载 Linux、Windows 或 macOS 安装包，
无需安装 Python、Node.js 或 Rust。桌面版可在“设置 → 更新”检查经 Tauri updater 签名
验证的更新；browser-lite 需要从发布页下载并替换可执行文件。当前安装包暂不做 Windows
Authenticode 或 Apple Developer ID / notarization，系统可能显示未知发布者警告。

## 环境要求

- Python 3.12（项目声明范围为 `>=3.12,<3.13`）
- [uv](https://docs.astral.sh/uv/)
- Node.js 22.22.2+ 的 22.x、24.15.0+ 的 24.x，或 26+
- Tauri 模式还需要 Rust stable 和对应平台的原生依赖

不要在 WSL / Linux 中调用 Windows 的 `node.exe`、`npm`、`cargo.exe`，也不要复用
Windows 生成的 `node_modules`。

## 安装依赖

在仓库根目录安装后端与测试依赖：

```bash
uv sync --locked --group test
```

如果需要直接在开发环境运行 faster-whisper：

```bash
uv sync --locked --extra asr
```

安装前端依赖：

```bash
cd frontend
npm ci
```

受限环境中若 uv 默认缓存不可写，使用：

```bash
UV_CACHE_DIR=/tmp/audux-uv-cache uv sync --locked --group test
```

## 浏览器开发模式

先在仓库根目录启动 FastAPI：

```bash
uv run --locked python backend/run.py
```

默认健康检查地址是 `http://127.0.0.1:8765/health`。另开终端启动 Vite：

```bash
cd frontend
npm run dev
```

然后打开 `http://127.0.0.1:5173`。此处的 `8765` 只是独立开发服务器默认值；Tauri 会
选择可用端口，并通过原生命令把实际地址交给前端。

## Tauri 开发模式

安装平台原生依赖后执行：

```bash
cd frontend
npm run tauri:dev
```

Tauri 会启动 Vite 和 Python backend。开发模式查找 Python 的顺序为：

1. `AUDUX_PYTHON` 指定的解释器；
2. 当前 `VIRTUAL_ENV`；
3. 仓库根目录 `.venv`；
4. Windows 的 `python`，或 Linux / macOS 的 `python3`。

Linux 原生依赖和完整构建方式见[构建与发布验证](building.md)。

## 首次使用

1. 在首次使用向导中选择本地音频目录。
2. Audux 创建媒体库并在后台扫描；首批结果出现后即可浏览和播放。
3. 在设置中按需安装 Whisper companion 或配置外部 ASR / LLM。
4. 使用 Tag、Playlist、保存视图和批量操作整理资料库。
5. 在维护设置中创建数据库快照；快照不包含原始音频。

Audux 只读取媒体库中的原始音频。移除媒体库目录、Playlist 或应用本身，不应删除或修改
原始文件。

## 下一步

- Provider 和 MCP：[AI、ASR 与 MCP 配置](configuration.md)
- 数据位置、备份和隐私：[数据与安全](data-and-security.md)
- 常见启动问题：[故障排查](troubleshooting.md)
