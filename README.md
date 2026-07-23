# Local Audio Library

Local Audio Library 是一个本地优先的私人音频知识库应用，支持扫描本地音频目录、读取 metadata 和封面、播放、标签整理、播放列表、ASR 转写、LLM 生成描述与标签、全文搜索、任务队列和 Tauri 桌面封装。

## 功能特性

- 本地媒体库扫描：支持 MP3 / M4A / FLAC / WAV / OGG
- metadata 读取：标题、作者、专辑、描述、时长、码率、采样率等
- 内嵌封面提取与自定义封面上传
- 播放器：播放队列、倍速、音量、播放位置记忆
- 标签与播放列表管理
- Transcript：
  - faster-whisper 本地转写
  - transcript 时间轴
  - TXT / JSON / SRT 导出
- AI 整理：
  - OpenAI-compatible 本地或内网 LLM endpoint
  - 生成描述、标签和语言建议
  - 支持批量 AI 分析
- 搜索：
  - SQLite FTS5
  - 标题、作者、描述、标签、transcript 全文搜索
- 任务队列：
  - ASR / AI 任务
  - 取消、重试
  - 后端重启后自动恢复中断任务状态
- Tauri 桌面封装：
  - 开发环境自动启动 Python backend
  - Release 可使用 PyInstaller 构建 backend sidecar

## 项目结构

```txt
.
├── backend
│   ├── app
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
│   ├── tests
│   ├── build_backend.py
│   ├── requirements.txt
│   └── run.py
├── frontend
│   ├── src
│   ├── src-tauri
│   ├── package.json
│   └── vite.config.ts
└── README.md
```

## 数据目录

应用数据默认存放在：

```txt
~/.local_audio_library
```

其中包括：

```txt
~/.local_audio_library/database.sqlite
~/.local_audio_library/covers
~/.local_audio_library/logs
~/.local_audio_library/exports
```

## 后端开发环境

建议使用 Python 3.11+。

```bash
cd backend

python -m venv .venv

# macOS / Linux
source .venv/bin/activate

# Windows PowerShell
# .venv\Scripts\Activate.ps1

python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

如果你已经有当前环境，并且 `pip list` 中已包含所需依赖，可以直接启动后端：

```bash
python run.py
```

默认监听：

```txt
http://127.0.0.1:8765
```

健康检查：

```bash
curl http://127.0.0.1:8765/health
```

Windows PowerShell 可使用：

```powershell
Invoke-RestMethod http://127.0.0.1:8765/health
```

## 前端开发环境

建议使用 Node.js 20.19+ 或 22.12+。

```bash
cd frontend
npm install
npm run dev
```

前端默认监听：

```txt
http://127.0.0.1:5173
```

## Tauri 开发模式

Tauri dev 会自动启动 Vite 和 Python backend。

```bash
cd frontend
npm run tauri:dev
```

开发模式下，Rust 侧会尝试使用：

1. `LOCAL_AUDIO_LIBRARY_PYTHON` 环境变量指定的 Python
2. 当前 `VIRTUAL_ENV`
3. Windows 使用 `python`
4. macOS / Linux 使用 `python3`

如果依赖缺失，请先进入 `backend` 安装依赖。

## ASR 设置

ASR 使用 `faster-whisper`。

默认设置：

```txt
asr.model_name = small
asr.device = cpu
asr.compute_type = int8
asr.beam_size = 5
```

可以在设置中心修改。

如果希望完全离线，建议把 `asr.model_name` 配置为本地模型路径，而不是 `small` / `medium` / `large-v3` 这类模型名称。否则首次运行可能会尝试下载模型。

## LLM 设置

LLM 使用 OpenAI-compatible Chat Completions API。

典型本地 endpoint：

```txt
http://127.0.0.1:1234/v1
```

需要配置：

```txt
llm.endpoint
llm.model_name
llm.api_key       可为空
llm.timeout
llm.max_tokens
llm.temperature
```

隐私提醒：

- 如果 endpoint 不是 localhost / 127.0.0.1 / loopback 地址，应用会弹出隐私提示。
- AI 分析会把音频 metadata 和 transcript 发送到配置的 endpoint。
- 请只配置你信任的本地、内网或私有模型服务。

## 本地 API 安全说明

后端默认只监听：

```txt
127.0.0.1:8765
```

并启用以下保护：

- CORS 默认只允许 localhost / tauri origin
- POST / PUT / PATCH / DELETE 需要自定义 header：

```txt
X-Local-Audio-Client: local-audio-library
```

开发环境可以通过环境变量允许所有 CORS：

```bash
LOCAL_AUDIO_LIBRARY_ALLOW_ALL_CORS=1
```

不建议在日常使用或打包版本中启用该选项。

## 后端测试

本项目的基础测试使用 Python 标准库 `unittest`，不需要额外安装 `pytest`。

```bash
cd backend
python -m unittest discover -s tests
```

## 构建前端

```bash
cd frontend
npm run build
```

## 构建后端 sidecar

Release 打包前需要先构建 Python backend sidecar。

`build_backend.py` 需要 PyInstaller。如果你当前环境没有安装 PyInstaller，可以单独安装：

```bash
cd backend
python -m pip install pyinstaller
```

然后构建 backend sidecar：

```bash
python build_backend.py
```

该命令会生成：

```txt
frontend/src-tauri/binaries/local-audio-backend-<target-triple>
```

## 构建 Tauri 应用

```bash
cd frontend
npm run tauri:build
```

Release 构建前请确认：

1. 已安装 backend 依赖
2. 如需打包 sidecar，已安装 PyInstaller
3. 已运行 `python backend/build_backend.py`
4. `frontend/src-tauri/binaries` 中不是 dev placeholder
5. ASR 模型策略已确认：本地路径或用户自行下载
6. LLM endpoint 不会意外指向不可信服务

## 常见问题

### 后端未启动

检查：

```bash
curl http://127.0.0.1:8765/health
```

如果失败，手动启动：

```bash
cd backend
python run.py
```

### faster-whisper 未安装

安装依赖：

```bash
cd backend
python -m pip install -r requirements.txt
```

### LLM 测试失败

检查：

- endpoint 是否包含 `/v1`
- model_name 是否正确
- 本地模型服务是否已启动
- API key 是否需要填写
- 防火墙或代理是否拦截

### 扫描后没有搜索结果

可以在设置中心执行：

```txt
维护 -> 重建搜索索引
```

### 任务一直 running

后端启动时会自动把上次异常中断的 running 任务标记为 failed，把 cancel_requested 任务标记为 canceled。然后可以在任务面板重试。

## 开发建议

推荐常用命令：

```bash
# backend
cd backend
python -m unittest discover -s tests
python run.py

# frontend
cd frontend
npm run typecheck
npm run build
npm run tauri:dev
```

## License

Private / Internal project by default.
```

---

执行验证：

```bash
cd backend
python -m unittest discover -s tests
python run.py
```

另开一个终端：

```bash
cd frontend
npm run typecheck
npm run build
```