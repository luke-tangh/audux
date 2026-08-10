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
- 智能 Playlist：复用保存视图规则动态计算成员，并支持分页、播放、队列和导出
- 显式多选与批量整理：批量添加 / 移除标签、加入 Playlist、收藏 / 取消收藏
- 保存视图：将关键词、标签、媒体库目录、状态筛选和排序持久化到数据库，并支持应用、
  更新、复制、排序和删除
- 媒体库目录可安全移除：保留磁盘文件和已有音频、标签、Playlist、Transcript 数据
- 资料库健康中心：按目录汇总缺失文件、扫描失败、不支持格式和重复候选；移动文件可在
  预览 Transcript、标签、Playlist、封面与播放记录后安全重新关联，不删除文件或记录
- Transcript：
  - 可选 Whisper companion 本地转写或外部 ASR 服务
  - transcript 时间轴
  - 逐段修订并保留时间轴，自动同步全文和搜索索引
  - 以版本冲突保护的全文替换高级操作
  - TXT / JSON / SRT 导出
- AI 整理：
  - OpenAI-compatible 本地或内网 LLM endpoint
  - 生成描述、标签和语言建议
  - 支持批量 AI 分析
- 搜索：
  - SQLite FTS5
  - 标题、作者、描述、标签、transcript 全文搜索
  - Transcript 命中展示相邻分段上下文并支持时间点跳转
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

“设置 → 维护 → 数据库备份与恢复”支持创建、命名、校验和删除受管数据库快照。恢复前
会检查完整性、schema、磁盘空间和活动任务，并自动创建当前数据库的安全快照。Tauri
提交后会重启执行切换；browser-lite 需要按提示手动重启。目标数据库初始化失败时会
自动换回安全快照。数据库快照不包含原始音频、模型缓存或导出文件。

## 后端开发环境

后端使用 uv 管理 Python 3.12、项目虚拟环境和锁定依赖。先安装
[uv](https://docs.astral.sh/uv/getting-started/installation/)，然后在仓库根目录执行：

```bash
# 基础后端依赖
uv sync --locked

# 如需在开发环境直接运行 Whisper companion
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

- `faster_whisper`：由按需安装的 Whisper companion 独立进程加载模型。
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

桌面发布包默认不包含 faster-whisper、CTranslate2、PyAV 等运行时。先在“设置 →
ASR”下载当前平台的 Whisper 组件；组件 ZIP 会校验版本、平台、大小和 SHA-256 后再
安装。`small` / `medium` / `large-v3` 等模型权重仍在首次转写时下载到
`~/.local_audio_library/models/faster-whisper/`。移除组件不会删除模型缓存。

如果希望完全离线，先完成组件和模型下载，或把 `asr.model_name` 配置为本地模型路径。

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
asr.external.chunking_enabled = false
asr.external.chunk_seconds = 28
asr.external.chunk_overlap_seconds = 1
asr.external.prefer_silence = true
asr.external.silence_threshold_db = -35
asr.external.minimum_silence_ms = 400
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
- `required`：未启用应用切片时，响应没有 segments 会使任务失败；启用切片时可用每片
  起止时间生成粗粒度时间轴。

外部 ASR 长音频切片默认关闭。若模型服务只能处理几十秒音频，可在“设置 → ASR”
启用它。此功能要求运行后端的系统能从 `PATH` 找到 `ffmpeg` 和 `ffprobe`；应用不会
自行下载 FFmpeg，缺少时设置页会提示安装并阻止启用。WSL 中开发运行后端时应安装
Linux 版 FFmpeg；Windows 桌面发布包由 Windows 后端运行，因此需要 Windows 版
FFmpeg。两个环境的可执行文件不能互相替代。

启用后，后端会先用 ffprobe 读取时长，再按以下规则顺序上传 WAV 切片：

- 在每片最长时限的后半段查找合适的静音中点，优先在那里切分。
- 没找到静音时按最长时限硬切，避免任何单片超过外部服务上限。
- 相邻切片保留可配置重叠，并对完全重复的边界文本做保守去重。
- 外部服务的 segment 时间会加上切片起点后合并；若只返回文本且时间戳策略不是
  `off`，应用会使用切片起止时间生成粗粒度时间轴。
- 切片逐个请求，显存压力可控且容易取消，但总耗时和 HTTP 请求次数会增加。静音
  检测也会额外完整读取一次长音频。

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

后端测试使用 `pytest`：

```bash
cd backend
uv run --locked --group test python -m pytest tests
```

生成包含分支覆盖率的报告：

```bash
cd backend
uv run --locked --group test python -m pytest tests \
  --cov=app --cov-report=term-missing:skip-covered --cov-report=xml
```

## 构建前端

前端逻辑测试使用 Vitest：

```bash
cd frontend
npm test
npm run test:coverage
```

类型检查和生产构建：

```bash
cd frontend
npm run build
```

## 构建后端 sidecar

主程序 sidecar 默认构建为 lite 版本，不包含 Whisper 运行时：

```bash
uv run --locked --group build python backend/build_backend.py
```

该命令会生成：

```txt
frontend/src-tauri/binaries/local-audio-backend-<target-triple>
```

如需单独构建当前平台的可选 Whisper companion：

```bash
uv sync --locked --extra asr --group build
uv run --locked --extra asr --group build python backend/build_whisper_companion.py
```

产物位于 `backend/dist/whisper-components/`，包含平台 ZIP 和 manifest descriptor。
Release workflow 会为三个目标平台构建 lite 安装包和 companion，并汇总生成
`whisper-components.json`。下载地址默认指向与应用版本相同的 GitHub Release；开发
或镜像测试可用 `LOCAL_AUDIO_LIBRARY_WHISPER_MANIFEST_URL` 指定 HTTPS manifest。

不同平台的 native 依赖仍建议在目标平台上实际测试。

## 构建 browser-lite 单文件版本

browser-lite 不使用 Tauri。它把生产前端和 lite backend 打包进同一个可执行文件，
启动后选择可用的 `127.0.0.1` 端口，并自动打开默认浏览器：

```bash
cd frontend
npm run build:browser-lite

cd ..
uv run --locked --group build python backend/build_browser_lite.py
```

产物位于 `backend/dist/browser-lite/`：

```txt
local-audio-library-lite-<target-triple>[.exe]
local-audio-library-lite-<target-triple>.zip
```

Windows 双击可执行文件会显示控制台；Linux 和 macOS 建议从终端运行。保持终端开启，
按 `Ctrl+C` 即可停止服务。浏览器前端和 API 使用同一回环 origin，不需要放宽 CORS，
也不依赖固定端口。可用 `LOCAL_AUDIO_LIBRARY_BROWSER_PORT` 指定端口，或设置
`LOCAL_AUDIO_LIBRARY_BROWSER_OPEN=0` 禁止自动打开浏览器。

browser-lite 仍然需要本机 backend 才能访问文件系统，因此它不是可部署到公共静态
网站的纯网页。Tauri 原生文件/目录选择器不可用，媒体库路径需要手动输入；Whisper
继续通过相同的可选 companion 安装机制提供。

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

1. 已执行 lite sidecar 和当前平台 Whisper companion 构建
2. `uv.lock` 与 `pyproject.toml` 保持同步
3. companion manifest/ZIP 校验通过，ASR 模型下载与缓存策略已确认
4. LLM endpoint 不会意外指向不可信服务

## 开发路线与 Release dry-run

显式多选与批量整理、Transcript 保真修订与搜索上下文、播放队列与会话连续性、
手动数据库备份与安全恢复、保存视图、智能 Playlist 以及资料库健康中心与安全重新关联
已经完成；下一项是 Transcript 章节。v0.5 已冻结功能范围并进入 Beta 发布验证，不再追加 F5。
详细范围见 [`docs/roadmap.md`](docs/roadmap.md)。仓库中的 `0.5.0-beta.1` 仍是内部候选
标识，不代表已经发布；v1.0 前所有版本均保留为内部 Beta，首次公开 Release 统一为
v1.0。

GitHub Actions 的 `Internal Builds and v1 Release` workflow 支持手动触发。手动运行会
在 Linux、Windows 和 macOS 同时构建 Tauri 安装包、browser-lite 单文件包与对应
Whisper companion，
并保留 artifacts，但不会创建 GitHub Release。workflow 只允许 `v1.0.*` 标签发布这些
产物和组件 manifest，v0.x 不创建公开 Release。

按照 [`docs/release-checklist.md`](docs/release-checklist.md) 完成三平台安装、升级、
端口冲突、后端退出、数据库恢复和 ASR smoke test；这些结果在 v1.0 前只作为内部验证
证据。

Beta 发布说明草案见
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
uv run --locked --group test python -m pytest tests
uv run --locked python run.py

# frontend
cd frontend
npm run typecheck
npm run build
npm run tauri:dev
```
