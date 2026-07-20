# Local Audio Library

Local Audio Library 是一个本地优先的音频知识库应用。它可以扫描本地音频目录，管理音频 metadata、封面、标签、播放列表，支持本地播放、播放进度记录、全文搜索、音频转写，以及通过 OpenAI-compatible LLM 生成描述和标签建议。

项目由三部分组成：

- **Backend**：FastAPI + SQLite + SQLModel
- **Frontend**：React + TypeScript + Vite
- **Desktop**：Tauri 2，将前端和 Python 后端 sidecar 打包为桌面应用

---

## 功能特性

### 媒体库管理

- 添加本地音频目录
- 启用 / 禁用媒体库目录
- 扫描目录并导入音频
- 异步扫描任务
- 查看扫描进度
- 取消扫描任务
- 自动标记丢失文件
- 支持重新定位已移动的音频文件

### 音频格式

当前支持：

- `.mp3`
- `.m4a`
- `.flac`
- `.wav`
- `.ogg`

### Metadata 管理

自动读取：

- 标题
- 作者
- 专辑
- 描述 / 评论
- 时长
- 比特率
- 采样率
- 声道数
- 文件路径
- 文件大小
- 文件修改时间

用户可编辑：

- 标题
- 作者
- 专辑
- 描述
- 语言
- 收藏状态

### 封面管理

- 自动提取音频内嵌封面
- 支持 MP3 / M4A / FLAC / OGG 常见封面格式
- 支持上传自定义封面
- 支持删除封面

支持的图片格式：

- `.jpg`
- `.jpeg`
- `.png`
- `.webp`

### 播放器

- 本地音频播放
- 播放 / 暂停
- 停止并重置进度
- 上一首 / 下一首
- 播放队列
- 自动播放下一首
- 播放速度调节
- 音量调节
- 播放进度拖动
- 自动保存播放进度
- 记录播放次数和上次播放时间

### 标签系统

- 添加标签
- 移除标签
- 按标签筛选
- AI 标签建议
- 一键接受 AI 标签

### 播放列表

- 创建播放列表
- 将音频加入播放列表
- 查看播放列表
- 导出播放列表

支持导出格式：

- JSON
- M3U

### 全文搜索

基于 SQLite FTS5，搜索范围包括：

- 标题
- 作者
- 描述
- 标签
- 转写文本

支持搜索索引重建。

### 音频转写

使用 `faster-whisper` 进行本地 ASR 转写。

支持：

- 单个音频转写
- 批量转写
- 后台任务队列
- 转写片段
- 点击片段跳转播放
- 导出转写结果

转写导出格式：

- TXT
- JSON
- SRT

### AI 分析

支持 OpenAI-compatible Chat Completions API，用于生成：

- 音频描述
- 标签建议
- 语言建议

可配置：

- Endpoint
- Model Name
- API Key
- Timeout
- Max Tokens
- Temperature

适合配合以下服务使用：

- LM Studio
- Ollama OpenAI-compatible endpoint
- vLLM
- LocalAI
- 其他兼容 `/chat/completions` 的服务

### 任务队列

支持管理：

- ASR 转写任务
- AI 分析任务

任务状态：

- `pending`
- `running`
- `done`
- `failed`
- `canceled`

支持：

- 查看任务
- 取消任务
- 重试失败任务
- 重试已取消任务

### 数据导出

支持导出：

- Metadata JSON
- Metadata CSV
- Transcript TXT
- Transcript JSON
- Transcript SRT
- Playlist JSON
- Playlist M3U

### 日志与维护

- 查看后端运行日志
- 下载日志文件
- 重建搜索索引
- 健康检查

---

## 技术栈

### Backend

- Python
- FastAPI
- Uvicorn
- SQLModel
- SQLite
- SQLite FTS5
- Mutagen
- httpx
- faster-whisper，可选
- PyInstaller，用于打包后端 sidecar

### Frontend

- React
- TypeScript
- Vite
- CSS

### Desktop

- Tauri 2
- Rust
- Tauri shell plugin
- Tauri dialog plugin
- Tauri process plugin

---

## 项目结构

```text
.
├── backend/
│   ├── app/
│   │   ├── ai_client.py
│   │   ├── db.py
│   │   ├── logger.py
│   │   ├── main.py
│   │   ├── models.py
│   │   ├── scanner.py
│   │   ├── schemas.py
│   │   ├── search.py
│   │   ├── tasks.py
│   │   └── transcriber.py
│   ├── build_backend.py
│   └── run.py
│
├── frontend/
│   ├── src/
│   │   ├── api.ts
│   │   ├── App.tsx
│   │   ├── components/
│   │   ├── styles.css
│   │   ├── tauri.ts
│   │   └── types.ts
│   ├── src-tauri/
│   │   ├── binaries/
│   │   ├── capabilities/
│   │   ├── src/
│   │   ├── Cargo.toml
│   │   └── tauri.conf.json
│   ├── package.json
│   └── vite.config.ts
│
└── README.md
```

---

## 本地数据目录

应用数据默认保存在：

```text
~/.local_audio_library
```

目录结构：

```text
~/.local_audio_library/
├── database.sqlite
├── covers/
├── logs/
└── exports/
```

说明：

- 应用不会默认复制音频文件。
- 数据库只保存音频文件路径和相关 metadata。
- 如果原始音频被移动或删除，应用会标记为 missing。
- 可通过“重新定位”功能绑定新的文件路径。

---

## 环境要求

### Node.js

建议使用：

```text
Node.js 20.19+
```

或：

```text
Node.js 22.12+
```

检查版本：

```bash
node -v
npm -v
```

### Rust

Tauri 需要 Rust 环境。

安装地址：

```text
https://rustup.rs/
```

检查版本：

```bash
rustc --version
cargo --version
```

### Python

建议使用：

```text
Python 3.10+
```

检查版本：

```bash
python --version
```

macOS / Linux 如果没有 `python` 命令，使用：

```bash
python3 --version
```

---

## 安装后端依赖

项目目前没有单独的 `requirements.txt`，可以手动安装依赖。

### Windows PowerShell

```powershell
cd backend

python -m venv .venv
.\.venv\Scripts\Activate.ps1

python -m pip install -U pip

pip install fastapi uvicorn sqlmodel sqlalchemy httpx mutagen python-multipart pyinstaller
```

如果需要本地音频转写功能：

```powershell
pip install faster-whisper
```

### macOS / Linux

```bash
cd backend

python3 -m venv .venv
source .venv/bin/activate

python -m pip install -U pip

pip install fastapi uvicorn sqlmodel sqlalchemy httpx mutagen python-multipart pyinstaller
```

如果需要本地音频转写功能：

```bash
pip install faster-whisper
```

---

## 安装前端依赖

```bash
cd frontend
npm install
```

或者：

```bash
cd frontend
npm ci
```

---

## 开发模式运行

### 方式一：浏览器模式

打开两个终端。

#### 终端 1：启动后端

```bash
cd backend
python run.py
```

后端地址：

```text
http://127.0.0.1:8765
```

健康检查：

```text
http://127.0.0.1:8765/health
```

#### 终端 2：启动前端

```bash
cd frontend
npm run dev
```

前端地址：

```text
http://127.0.0.1:5173
```

---

### 方式二：Tauri 桌面开发模式

```bash
cd frontend
npm run tauri:dev
```

Tauri 开发模式会：

1. 启动 Vite 前端。
2. 打开桌面窗口。
3. 尝试自动启动 Python 后端。

当前开发模式下，Tauri 会执行：

```bash
python ../../backend/run.py
```

如果你的系统没有 `python` 命令，只有 `python3`，可以：

1. 手动启动后端：

```bash
cd backend
python3 run.py
```

然后再运行：

```bash
cd frontend
npm run tauri:dev
```

或者修改：

```text
frontend/src-tauri/src/lib.rs
```

将：

```rust
let result = shell.command("python").arg(backend_script).spawn();
```

改为：

```rust
let result = shell.command("python3").arg(backend_script).spawn();
```

---

## 使用流程

### 1. 启动应用

开发环境可以运行：

```bash
cd frontend
npm run tauri:dev
```

或者分别启动后端和前端。

### 2. 添加媒体库目录

进入 Settings 页面：

1. 点击“选择文件夹”
2. 选择包含音频文件的目录
3. 点击“添加目录”

### 3. 扫描媒体库

在 Settings 的媒体库目录中点击“扫描”。

扫描完成后，音频会出现在 Library 中。

### 4. 播放音频

在音频列表中：

- 单击选择音频
- 双击播放音频
- 或点击“播放”按钮

### 5. 配置 ASR

如果需要转写音频，在 Settings 中配置：

- Model Name / Path
- Device
- Compute Type
- Beam Size

示例：

```text
Model Name: small
Device: cpu
Compute Type: int8
Beam Size: 5
```

如果使用 NVIDIA GPU，可尝试：

```text
Device: cuda
Compute Type: float16
```

### 6. 创建转写任务

在音频详情中点击：

```text
转写
```

或者在音频列表中点击：

```text
批量转写
```

### 7. 配置 LLM

在 Settings 中配置本地或远程 LLM。

示例：

```text
Endpoint: http://127.0.0.1:1234/v1
Model Name: local-model
API Key: 可为空
Timeout: 60
Max Tokens: 800
Temperature: 0.2
```

配置完成后点击：

```text
测试连接
```

### 8. AI 分析

在音频详情中点击：

```text
AI 分析
```

或者在音频列表中点击：

```text
批量 AI 分析
```

AI 分析完成后，可以接受 AI 描述和标签建议。

---

## 打包桌面应用

项目打包分两步：

1. 打包 Python 后端为 Tauri sidecar。
2. 打包 Tauri 桌面应用。

---

### 1. 打包后端 sidecar

确保已安装 PyInstaller：

```bash
pip install pyinstaller
```

然后执行：

```bash
cd backend
python build_backend.py
```

该脚本会：

1. 使用 PyInstaller 打包 `backend/run.py`
2. 生成 `local-audio-backend`
3. 复制到：

```text
frontend/src-tauri/binaries/
```

并按照 Tauri sidecar 规则自动重命名。

示例输出：

#### Windows

```text
frontend/src-tauri/binaries/local-audio-backend-x86_64-pc-windows-msvc.exe
```

#### macOS Apple Silicon

```text
frontend/src-tauri/binaries/local-audio-backend-aarch64-apple-darwin
```

#### macOS Intel

```text
frontend/src-tauri/binaries/local-audio-backend-x86_64-apple-darwin
```

#### Linux

```text
frontend/src-tauri/binaries/local-audio-backend-x86_64-unknown-linux-gnu
```

---

### 2. 打包 Tauri 应用

```bash
cd frontend
npm run tauri:build
```

构建产物位置：

```text
frontend/src-tauri/target/release/bundle/
```

常见产物：

#### Windows

```text
frontend/src-tauri/target/release/bundle/nsis/*.exe
frontend/src-tauri/target/release/bundle/msi/*.msi
```

#### macOS

```text
frontend/src-tauri/target/release/bundle/dmg/*.dmg
frontend/src-tauri/target/release/bundle/macos/*.app
```

#### Linux

```text
frontend/src-tauri/target/release/bundle/deb/*.deb
frontend/src-tauri/target/release/bundle/appimage/*.AppImage
```

---

## 完整打包命令

### Windows PowerShell

```powershell
cd backend

python -m venv .venv
.\.venv\Scripts\Activate.ps1

python -m pip install -U pip
pip install fastapi uvicorn sqlmodel sqlalchemy httpx mutagen python-multipart pyinstaller

# 可选：本地转写
pip install faster-whisper

python build_backend.py

cd ..\frontend
npm install
npm run tauri:build
```

### macOS / Linux

```bash
cd backend

python3 -m venv .venv
source .venv/bin/activate

python -m pip install -U pip
pip install fastapi uvicorn sqlmodel sqlalchemy httpx mutagen python-multipart pyinstaller

# 可选：本地转写
pip install faster-whisper

python build_backend.py

cd ../frontend
npm install
npm run tauri:build
```

---

## 一键打包脚本，可选

### macOS / Linux：`build_all.sh`

```bash
#!/usr/bin/env bash
set -e

cd backend
python build_backend.py

cd ../frontend
npm install
npm run tauri:build
```

使用：

```bash
chmod +x build_all.sh
./build_all.sh
```

### Windows：`build_all.ps1`

```powershell
$ErrorActionPreference = "Stop"

cd backend
python build_backend.py

cd ..\frontend
npm install
npm run tauri:build
```

使用：

```powershell
.\build_all.ps1
```

---

## 常用后端 API

后端默认地址：

```text
http://127.0.0.1:8765
```

### 健康检查

```http
GET /health
```

### 媒体库目录

```http
GET    /library-roots
POST   /library-roots
PATCH  /library-roots/{root_id}
POST   /library-roots/{root_id}/scan
```

### 扫描任务

```http
GET  /scan-tasks
GET  /scan-tasks/{task_id}
POST /scan-tasks/{task_id}/cancel
```

### 音频

```http
GET    /audio-items
GET    /audio-items/{audio_id}
PATCH  /audio-items/{audio_id}
DELETE /audio-items/{audio_id}
GET    /audio-items/{audio_id}/file
POST   /audio-items/{audio_id}/relocate
```

### 封面

```http
GET    /audio-items/{audio_id}/cover
POST   /audio-items/{audio_id}/cover
DELETE /audio-items/{audio_id}/cover
```

### 标签

```http
GET    /tags
POST   /audio-items/{audio_id}/tags
DELETE /audio-items/{audio_id}/tags/{tag_id}
```

### 播放列表

```http
GET  /playlists
POST /playlists
GET  /playlists/{playlist_id}
POST /playlists/{playlist_id}/items
GET  /playlists/{playlist_id}/export
```

### 转写

```http
POST /audio-items/{audio_id}/transcribe
GET  /audio-items/{audio_id}/transcript
GET  /audio-items/{audio_id}/transcript/export
```

### AI

```http
POST /audio-items/{audio_id}/analyze
POST /ai/test-llm
GET  /audio-items/{audio_id}/ai-suggestions
```

### 任务

```http
GET  /ai-tasks
GET  /ai-tasks/{task_id}
POST /ai-tasks/{task_id}/retry
POST /ai-tasks/{task_id}/cancel
```

### 设置

```http
GET /settings
PUT /settings
```

### 导出与维护

```http
GET  /export/metadata
POST /maintenance/rebuild-search-index
GET  /logs/app
GET  /logs/app/file
```

---

## 常见问题

### 1. Tauri 开发模式打开后显示后端未连接

先检查后端是否启动：

```text
http://127.0.0.1:8765/health
```

如果没有启动，可以手动运行：

```bash
cd backend
python run.py
```

然后重新运行：

```bash
cd frontend
npm run tauri:dev
```

---

### 2. macOS / Linux 上 `python` 命令不存在

可以使用：

```bash
python3 run.py
```

或者修改：

```text
frontend/src-tauri/src/lib.rs
```

将：

```rust
shell.command("python")
```

改为：

```rust
shell.command("python3")
```

---

### 3. 打包时报找不到 sidecar

请先执行：

```bash
cd backend
python build_backend.py
```

确认生成了：

```text
frontend/src-tauri/binaries/local-audio-backend-*
```

然后再执行：

```bash
cd frontend
npm run tauri:build
```

---

### 4. 转写任务失败，提示 faster-whisper 未安装

安装：

```bash
pip install faster-whisper
```

如果已经打包成桌面应用，需要在打包后端 sidecar 前安装该依赖，然后重新执行：

```bash
cd backend
python build_backend.py
```

---

### 5. AI 分析失败，提示 LLM 未配置

进入 Settings，配置：

```text
LLM Endpoint
Model Name
```

然后点击“测试连接”。

Endpoint 应该是 OpenAI-compatible API 的 base URL，例如：

```text
http://127.0.0.1:1234/v1
```

后端会自动请求：

```text
/chat/completions
```

---

### 6. 音频文件移动后无法播放

应用保存的是原始文件路径。如果文件移动了：

1. 选择该音频
2. 在详情中找到“重新定位”
3. 选择新的音频文件路径
4. 点击“重新定位”

---

### 7. 搜索不到新内容

可以在 Settings 中点击：

```text
重建搜索索引
```

---

### 8. 端口被占用

后端默认端口：

```text
8765
```

如果端口被其他程序占用，需要关闭占用程序，或者修改：

```text
backend/run.py
```

中的：

```python
port=8765
```

同时也需要修改前端：

```text
frontend/src/api.ts
```

中的：

```ts
export const API_BASE = "http://127.0.0.1:8765";
```

---

## 开发说明

### 后端入口

```text
backend/run.py
```

### FastAPI 应用

```text
backend/app/main.py
```

### 数据模型

```text
backend/app/models.py
```

### 扫描逻辑

```text
backend/app/scanner.py
```

### 转写逻辑

```text
backend/app/transcriber.py
```

### AI 任务逻辑

```text
backend/app/tasks.py
```

### 前端入口

```text
frontend/src/main.tsx
```

### 前端主应用

```text
frontend/src/App.tsx
```

### API 封装

```text
frontend/src/api.ts
```

### Tauri 入口

```text
frontend/src-tauri/src/main.rs
frontend/src-tauri/src/lib.rs
```

### Tauri 配置

```text
frontend/src-tauri/tauri.conf.json
```

---

## 开发建议

### 推荐开发启动方式

如果主要开发前端 UI：

```bash
cd backend
python run.py
```

另开终端：

```bash
cd frontend
npm run dev
```

如果需要测试桌面能力：

```bash
cd frontend
npm run tauri:dev
```

### 推荐打包方式

```bash
cd backend
python build_backend.py

cd ../frontend
npm run tauri:build
```

---

## 注意事项

1. 本项目是本地优先应用，但后端接口默认允许跨域，生产分发时应避免暴露到公网。
2. 应用默认监听 `127.0.0.1:8765`，只供本机访问。
3. 数据库位于用户目录下，卸载应用通常不会自动删除数据库。
4. 使用 `faster-whisper` 时，模型下载和运行可能占用较多磁盘、内存或显存。
5. Tauri sidecar 是平台相关的，建议在目标平台本机打包。
6. 不建议在 Windows 上直接打 macOS 包，也不建议在 macOS 上直接打 Windows 包。

---

## License

当前项目尚未声明 License。发布前建议补充开源协议，例如：

- MIT
- Apache-2.0
- GPL-3.0

---