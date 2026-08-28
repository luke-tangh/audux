# 故障排查

[用户指南](README.md) · [中文文档首页](../README.md) · [English](../../en/user-guide/troubleshooting.md) · 简体中文

先查看启动恢复页或全局活动中心中的错误详情。日志与诊断包可能帮助定位问题，但不要在
Issue、截图或聊天中暴露 API Key、本地 API Token、绝对媒体路径或用户 Transcript。

## API 提示 Token 无效

前端会自动请求 `/auth/token`。手动 curl 时先获取 Token：

```bash
curl http://127.0.0.1:8765/auth/token \
  -H "X-Audux-Client: audux"
```

随后附加：

```bash
curl http://127.0.0.1:8765/library-roots \
  -H "X-Audux-Token: <token>"
```

`POST`、`PUT`、`PATCH` 和 `DELETE` 还要求 `X-Audux-Client: audux`。Tauri 后端端口可能
不是 `8765`；不要用固定端口调试 Tauri 请求，应查看实际 backend base URL。

如果启动日志报告 `Failed to initialize local API token`，后端会安全地停止，而不是使用
一次性 Token 继续运行。检查 `~/.audux/` 是否可写、`local_api_token` 是否可读且能设置为
仅当前用户可访问；不要删除整个数据目录或重置数据库。

## 后端未启动

从仓库根目录运行：

```bash
uv run --locked python backend/run.py
```

检查 `http://127.0.0.1:8765/health`。若端口冲突，可设置 `AUDUX_API_PORT`；Tauri 后端会
原子绑定可用端口。

如果数据库 schema 与当前构建不兼容且没有迁移路径，后端会有意拒绝启动且不修改数据库。
请使用兼容版本或匹配快照恢复，不要删除原数据库。v1.0 的具体回滚步骤见
[兼容性契约](../reference/compatibility.md#弃用备份与回滚)。

## 本地 Whisper 不可用

桌面包应在“设置 → ASR”安装 Whisper companion。源码开发可执行：

```bash
uv sync --locked --extra asr
```

模型权重在首次使用时下载。离线环境需提前缓存模型或配置本地模型路径。

如果安装状态显示 manifest 公钥、签名、大小或校验和错误，不要关闭验证。确认 Release 同时
包含 `whisper-components.json` 与 `whisper-components.json.sig`，应用内置公钥与发布签名
私钥属于同一密钥对，并重新下载未被代理或镜像修改的组件文件。

## 外部 ASR 失败

依次检查：

- Provider 是否为 `external`；
- endpoint 是否为 API base URL，例如 `http://127.0.0.1:8000/v1`，而非完整的
  `/audio/transcriptions`；
- model name、API Key 和服务状态是否正确；
- 服务是否接受 multipart `file`、`response_format=verbose_json` 并返回 `text`；
- `required` 时间戳策略下是否返回 Segment，或是否已启用应用切片；
- 非 loopback endpoint 是否已经明确允许；
- 切片模式下 `ffmpeg` 与 `ffprobe` 是否都在 backend 进程的 `PATH`；
- 并发是否超过模型服务能力，CUDA OOM 时先降到 2 或 1。

详细请求契约见[配置指南](configuration.md#外部-asr)。

## LLM 连接测试失败

检查 endpoint 是否包含服务要求的 `/v1`、模型名称是否存在、服务是否启动、API Key 是否
必需，以及防火墙或代理是否拦截。非 loopback endpoint 还需明确允许。

连接成功但 Agent 不可用时，查看能力探测结果：不支持 tool calling 的 Provider 只用于
普通生成。

## 扫描后没有搜索结果

在“设置 → 维护”执行“重建搜索索引”。如果只有部分音频缺失，请先在资料库健康中心检查
目录状态并使用安全重新关联，不要直接改数据库路径。

## 任务一直处于 running

正常启动时，backend 会恢复持久化任务状态：异常中断的 running 任务会标为 failed，
`cancel_requested` 会标为 canceled；整理 Run 的执行中阶段会标为 interrupted。随后可在
活动中心查看错误并显式重试。

如果状态没有恢复，先确认是否存在第二个 backend 进程或数据库被其他实例占用，再正常
关闭多余实例；不要删除数据库、WAL 或任务记录。

## uv 缓存不可写

在 sandbox 或受管环境中执行：

```bash
cd backend
UV_CACHE_DIR=/tmp/audux-uv-cache uv run --locked --group test python -m pytest tests
```

`/tmp` 缓存可丢弃；缓存锁或只读错误不是跳过测试的理由。
