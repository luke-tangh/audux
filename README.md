# Local Audio Library

Local Audio Library 是一个本地优先的私人音频知识库应用，支持扫描本地音频目录、读取 metadata 和封面、播放、标签整理、播放列表、ASR 转写、LLM 生成描述与标签、全文搜索、任务队列和 Tauri 桌面封装。

## 功能特性

- 本地媒体库扫描：支持 MP3 / M4A / FLAC / WAV / OGG
- 增量扫描：文件大小和修改时间未变化时跳过 metadata 重读和索引重建
- 大资料库分页加载：前端按页加载音频，不再一次性拉取全库
- metadata 读取：标题、作者、专辑、描述、时长、码率、采样率等
- 内嵌封面提取与自定义封面上传
- 播放器：播放队列拖拽 / 键盘排序、倍速、音量、播放位置记忆
- 标签与播放列表管理：标签合并、Playlist 创建 / 重命名 / 删除
- 显式多选与批量整理：批量添加 / 移除标签、加入 Playlist、收藏 / 取消收藏
- 媒体库目录可安全移除：保留磁盘文件和已有音频、标签、Playlist、Transcript 数据
- Transcript：
  - faster-whisper 内置转写或外部本地 ASR 服务
  - transcript 时间轴
  - 手动修订全文并同步更新搜索索引
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
- 本地 API 加固：
  - Origin 限制
  - unsafe method 客户端 header
  - 本地随机 API token
  - 媒体、导出、日志接口也需要 token
- Tauri 桌面封装：
  - 开发环境自动启动 Python backend
  - Release 可使用 PyInstaller 构建 backend sidecar

## 项目结构

```txt
.
├── .python-version
├── pyproject.toml
├── uv.lock
├── backend
│   ├── app
│   ├── tests
│   ├── build_backend.py
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
~/.local_audio_library/backups
~/.local_audio_library/local_api_token
```

`local_api_token` 是后端自动生成的本地随机 API token，用于防止外部网页直接访问敏感接口。

应用检测到数据库需要升级时，会先通过 SQLite backup API 创建经过
`PRAGMA quick_check` 验证的完整备份。备份位于 `backups/`，文件名会注明升级前后
schema 版本。备份失败时应用会停止升级，不会继续修改原数据库。较新版本数据库也
不会被旧版本应用降级修改。

## 后端开发环境

后端使用 uv 管理 Python 3.12、项目虚拟环境和锁定依赖。先安装
[uv](https://docs.astral.sh/uv/getting-started/installation/)，然后在仓库根目录执行：

```bash
# 基础后端依赖
uv sync --locked

# 如需内置 faster-whisper
uv sync --locked --extra asr
```

uv 会在仓库根目录创建 `.venv`。不需要手动激活环境，直接启动后端：

```bash
uv run --locked python backend/run.py
```

默认监听：

```txt
http://127.0.0.1:8765
```

健康检查：

```bash
curl http://127.0.0.1:8765/health
```

Windows PowerShell：

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

```bash
cd frontend
npm run tauri:dev
```

开发模式下，Rust 侧会尝试使用：

1. `LOCAL_AUDIO_LIBRARY_PYTHON` 环境变量指定的 Python
2. 当前 `VIRTUAL_ENV`
3. Windows 使用 `python`
4. macOS / Linux 使用 `python3`

## ASR 设置

ASR 支持两种 Provider：

- `faster_whisper`：由后端进程直接加载本地 faster-whisper 模型。
- `external`：把媒体库中的音频上传到单独部署的 ASR HTTP 服务。模型、
  CUDA、PyTorch 和 vLLM 不进入桌面应用的安装包。

默认使用 faster-whisper：

```txt
asr.provider = faster_whisper
asr.model_name = small
asr.device = cpu
asr.compute_type = int8
asr.beam_size = 5
```

如果希望完全离线，建议把 `asr.model_name` 配置为本地模型路径，而不是 `small` / `medium` / `large-v3` 这类模型名称。否则首次运行可能会尝试下载模型。

### External ASR Provider

典型配置：

```txt
asr.provider = external
asr.external.endpoint = http://127.0.0.1:8000/v1
asr.external.model_name = qwen3-asr-1.7b
asr.external.api_key =
asr.external.language = auto
asr.external.timestamp_policy = preferred
asr.external.timeout = 3600
asr.external.allow_remote_endpoint = false
```

`endpoint` 是 API base URL。后端会向以下地址发送请求：

```txt
POST {endpoint}/audio/transcriptions
Content-Type: multipart/form-data
```

表单字段：

```txt
file                          原始音频文件
model                         asr.external.model_name
response_format               verbose_json
language                      非 auto 时发送
timestamp_granularities[]     时间戳策略不是 off 时发送 segment
```

服务必须返回 JSON：

```json
{
  "text": "完整转写文本",
  "language": "zh",
  "model": "qwen3-asr-1.7b",
  "segments": [
    {
      "id": 0,
      "start": 0.0,
      "end": 4.25,
      "text": "第一段文本"
    }
  ]
}
```

其中 `language`、`model` 和 `segments` 可省略。也兼容
`full_text`、`start_seconds`、`end_seconds` 字段名。时间戳策略：

- `off`：不请求时间戳，允许 `segments` 为空。
- `preferred`：请求 segment 时间戳，但 text-only 响应仍可落库。
- `required`：响应没有 segments 时任务失败。

Qwen3-ASR 建议由外部服务同时加载 `Qwen3-ForcedAligner-0.6B`，在服务端完成
长音频切片、对齐及时间偏移合并，再返回上述结构。MiMo-V2.5-ASR 当前可以返回
text-only 响应，并把时间戳策略设置为 `preferred` 或 `off`。

Qwen3-ASR 和 MiMo-V2.5-ASR 的官方服务示例使用 Chat Completions 音频消息，
不能直接作为这里的 endpoint；需要在模型服务侧增加一层轻量适配，把
`/audio/transcriptions` 请求转换成模型调用并返回上述统一结构。

任务入队时会保存 Provider、endpoint、模型、语言和时间戳策略的快照，重试继续
使用相同配置。API key 不会写入任务 payload 或日志，执行时从当前设置读取。

隐私与安全：

- 默认只允许 localhost、127.0.0.0/8、`::1` 和 `.localhost` endpoint。
- 使用非本机地址必须显式启用 `asr.external.allow_remote_endpoint`。
- 非本机服务会收到完整音频文件，请只连接可信的内网或私有服务。
- endpoint 不允许包含用户名、密码、查询参数或 fragment；凭据只能填写在 API Key。
- 应用只上传已经通过媒体库路径检查的文件，不把任意客户端路径传给 ASR 服务。

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

安全机制：

1. CORS 默认只允许 localhost / tauri origin。
2. POST / PUT / PATCH / DELETE 需要：

```txt
X-Local-Audio-Client: local-audio-library
```

3. 除 `/health`、`/auth/token`、API docs 外，所有 API 都需要本地随机 token：

```txt
X-Local-Audio-Token: <token>
```

4. `<audio>`、`<img>`、导出下载等无法添加 header 的场景使用 query token：

```txt
?access_token=<token>
```

前端会自动获取并添加 token。

开发环境可以通过环境变量允许所有 CORS：

```bash
LOCAL_AUDIO_LIBRARY_ALLOW_ALL_CORS=1
```

不建议在日常使用或打包版本中启用该选项。

## 后端测试

基础测试使用 Python 标准库 `unittest`：

```bash
cd backend
uv run --locked python -m unittest discover -s tests
```

## 构建前端

```bash
cd frontend
npm run build
```

## 构建后端 sidecar

完整 sidecar 构建需要 PyInstaller 和内置 ASR 依赖。在仓库根目录执行：

```bash
uv run --locked --extra asr --group build python backend/build_backend.py
```

该命令会生成：

```txt
frontend/src-tauri/binaries/local-audio-backend-<target-triple>
```

构建脚本会尝试收集：

- faster-whisper
- ctranslate2
- tokenizers
- av
- sqlite3

如果发布版本只使用 External ASR，可以构建不含 faster-whisper、CTranslate2
和相关模型运行依赖的轻量 sidecar：

```bash
LOCAL_AUDIO_LIBRARY_BUILD_WITH_ASR=0 \
  uv run --locked --group build python backend/build_backend.py
```

该模式仍可使用 `external` Provider；只有 `faster_whisper` Provider 不可用。

不同平台的 native 依赖仍建议在目标平台上实际测试。

## 构建 Tauri 应用

Linux（Ubuntu/Debian）需要先安装 Tauri 的系统依赖，以及 Linux 原生的
Node.js、Rust 和 Python：

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

在 Linux 上安装前端依赖：

```bash
cd frontend
npm ci
```

然后直接构建：

```bash
npm run tauri:build
```

`tauri:build` 会先调用当前平台的 Python，生成带正确 target triple 的
backend sidecar，再构建前端和 Tauri 安装包。Python 的查找顺序为：

1. `LOCAL_AUDIO_LIBRARY_PYTHON`
2. 已激活的 `VIRTUAL_ENV`
3. 仓库根目录的 `.venv`
4. Windows 上的 `python` / `py -3`
5. Linux 和 macOS 上的 `python3` / `python`

Release 构建前请确认：

1. 已执行 `uv sync --locked --extra asr --group build`
2. `uv.lock` 与 `pyproject.toml` 保持同步
3. ASR 模型策略已确认：本地路径或用户自行下载
4. LLM endpoint 不会意外指向不可信服务

## 开发路线与 Release dry-run

当前暂缓发布 `v0.5.0-beta.1`。显式多选与批量整理已经完成，下一步优先完善
Transcript 保真修订，再实现播放队列会话恢复。详细范围和验收门槛见
[`docs/roadmap.md`](docs/roadmap.md)。仓库中的 `0.5.0-beta.1` 版本字符串暂作为内部
开发候选标识，不代表已经发布。

GitHub Actions 的 `Release` workflow 支持手动触发。手动运行会在 Linux、Windows
和 macOS 构建完整安装包并保留 artifacts，但不会创建 GitHub Release。只有推送
`v*.*.*` tag 才会发布 Release。

重新决定进入 Beta 发布验证后，按照
[`docs/release-checklist.md`](docs/release-checklist.md) 完成安装、升级、端口冲突、
后端退出和 ASR smoke test。

暂停前整理的 Beta 发布草案见
[`docs/releases/v0.5.0-beta.1.md`](docs/releases/v0.5.0-beta.1.md)。

如果只想单独生成当前 Linux 平台的 sidecar，可以运行：

```bash
cd frontend
npm run build:backend
```

## 常见问题

### API 返回 Missing or invalid local API token

前端会自动请求 `/auth/token`。如果你手动 curl 调试，需要先获取 token：

```bash
curl http://127.0.0.1:8765/auth/token \
  -H "X-Local-Audio-Client: local-audio-library"
```

然后带 header：

```bash
curl http://127.0.0.1:8765/library-roots \
  -H "X-Local-Audio-Token: <token>"
```

POST / PUT / PATCH / DELETE 还需要本地客户端 header：

```bash
-H "X-Local-Audio-Client: local-audio-library"
```

### 后端未启动

```bash
uv run --locked python backend/run.py
```

### faster-whisper 未安装

```bash
uv sync --locked --extra asr
```

### External ASR 任务失败

检查：

- Provider 是否选择 `external`
- endpoint 是否是 API base URL（例如 `http://127.0.0.1:8000/v1`），不要填写
  完整的 `/audio/transcriptions` 路径
- model_name 是否与模型服务一致
- 模型服务是否接受 multipart `file` 和 `verbose_json`
- `required` 时间戳策略下是否返回非空 segments
- endpoint 不是 loopback 时是否已明确允许远程 ASR endpoint
- 超长音频的切片、Forced Aligner 和时间偏移是否由模型服务正确处理

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

```bash
# backend
cd backend
uv run --locked python -m unittest discover -s tests
uv run --locked python run.py

# frontend
cd frontend
npm run typecheck
npm run build
npm run tauri:dev
```
