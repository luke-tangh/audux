# AI、ASR 与 MCP 配置

Audux 的核心播放、手工编辑、关键词搜索和导出不依赖 ASR、LLM 或网络。Provider 配置
保存在本地设置中；API Key 不进入任务 payload、归档或诊断包，也不应出现在日志中。

## 本地 Whisper

默认 ASR 配置为：

```text
asr.provider = faster_whisper
asr.model_name = small
asr.device = cpu
asr.compute_type = int8
asr.beam_size = 5
```

桌面主程序不内置 faster-whisper、CTranslate2 或 PyAV。请在“设置 → ASR”下载当前平台的
Whisper companion；ZIP 会校验版本、平台、大小和 SHA-256。`small`、`medium`、
`large-v3` 等模型权重在首次转写时下载到
`~/.audux/models/faster-whisper/`，移除 companion 不会删除模型缓存。

源码开发时也可以安装 ASR extra：

```bash
uv sync --locked --extra asr
```

完全离线使用前，需要预先安装 companion 并缓存模型，或将 `asr.model_name` 指向可访问的
本地模型目录。

## 外部 ASR

外部 Provider 将已经通过媒体库路径校验的音频发送到你管理的 HTTP 服务：

```text
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
asr.external.chunk_concurrency = 1
asr.external.prefer_silence = true
asr.external.vad_threshold = 0.5
asr.external.minimum_silence_ms = 400
asr.external.formatting_enabled = true
asr.external.case_glossary =
```

`endpoint` 是 API base URL，不能包含凭据、query 或 fragment。Audux 请求：

```text
POST {endpoint}/audio/transcriptions
Content-Type: multipart/form-data
```

表单包含 `file`、`model`、`response_format=verbose_json`，并按设置发送 `language` 和
`timestamp_granularities[]=segment`。服务应返回：

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

`language`、`model` 和 `segments` 可以省略。时间戳策略含义如下：

- `off`：不请求时间戳，允许没有 Segment。
- `preferred`：请求 Segment，但 text-only 响应仍可写入。
- `required`：未启用应用切片时，缺少 Segment 会令任务失败；启用切片时可用切片边界
  生成粗粒度时间轴。

Qwen3-ASR 和 MiMo-V2.5-ASR 的 Chat Completions 音频示例不能直接作为这个 endpoint；
需要由服务端适配为上述 `/audio/transcriptions` 契约。Qwen3-ASR 可在服务端配合
Forced Aligner 返回时间戳；MiMo-V2.5-ASR 可用 `preferred` 或 `off` 接受 text-only 响应。

### 长音频切片与格式化

外部 ASR 切片默认关闭。启用后，系统必须能从 `PATH` 找到 `ffmpeg` 和 `ffprobe`。
Silero VAD 模型与 ONNX Runtime CPU runtime 已包含在 backend sidecar 中，无需另装 Torch、
CUDA 或 VAD 模型。

- FFmpeg 流式输出 16 kHz 单声道 PCM，VAD 不把整段音频一次性载入内存。
- Audux 优先在单片最长时限之前的非语音区间切分，找不到时执行硬切。
- 相邻切片可保留重叠，并保守去除完全重复的边界文本。
- 并发范围为 1–4，且不应超过模型服务的 `MAX_NUM_SEQS`；显存不足时降为 2 或 1。
- Segment 时间会加上切片起点后合并，结果始终按原切片顺序写入。

启用 `formatting_enabled` 后，Audux 恢复句首大写，并只使用设置页可见的
`case_glossary` 规范大小写。词典每行可写 `识别文本=标准写法`，或只写标准写法；支持
`#` 注释，最多 500 项。硬切边界或小于 0.7 秒的重叠 VAD 静音会按连续语句处理，避免
保留模型在切片末尾误加的单个句号。

### 外部 ASR 隐私边界

- 默认只允许 localhost、`127.0.0.0/8`、`::1` 和 `.localhost`。
- 非本机地址必须显式启用 `asr.external.allow_remote_endpoint`。
- 外部服务会收到完整音频或启用切片后的 WAV 片段，只连接可信服务。
- 任务会保存 Provider、endpoint、模型、语言和时间戳策略快照；重试沿用该快照。

## LLM

Audux 使用 OpenAI-compatible Chat Completions API。常见本地 endpoint 为 Ollama 的
`http://127.0.0.1:11434/v1` 或 LM Studio 的 `http://127.0.0.1:1234/v1`。

```text
llm.endpoint
llm.model_name
llm.api_key
llm.timeout
llm.max_tokens
llm.temperature
llm.allow_remote_endpoint
```

连接测试会探测结构化输出和 tool calling。Provider 不支持 tool calling 时仍可进行普通
生成，但不会进入 Agent 工具执行路径。非 loopback endpoint 必须显式允许，并会收到相关
音频 metadata 与 Transcript；请只连接可信的本地、内网或私有服务。

## 只读 MCP Server

v0.9 的 backend 可作为 stdio MCP Server 启动，复用应用内 Tool Registry，只暴露受限的
list、search、get 和 statistics 类只读工具：

```bash
cd backend
uv run --locked python run.py --mcp
```

发布 sidecar 使用同一入口：

```bash
audux-backend-<target-triple> --mcp
```

可通过环境变量进一步限定该进程能看到的音频 ID：

```bash
AUDUX_MCP_AUDIO_IDS=1,2 audux-backend-<target-triple> --mcp
```

stdio 专用于 JSON-RPC，MCP 不暴露写工具、API Key、本地 API Token、日志、绝对路径或
范围外音频。EOF 会触发进程退出。
