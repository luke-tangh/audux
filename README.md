# Audux

Audux 是一款本地优先的私人音频知识库桌面应用。它将本地音频扫描、播放与整理、
Transcript、全文检索以及受控 AI 工作流放在同一个资料库中，并且不会修改原始音频文件。

## 核心能力

- **本地资料库**：扫描 MP3、M4A、FLAC、WAV 和 OGG，读取 metadata 与封面，支持分页、
  增量扫描、缺失文件诊断和安全重新关联。
- **播放与整理**：播放队列、倍速、进度记忆、Tag、手动与智能 Playlist、保存视图、
  显式多选和批量整理。
- **可信 Transcript**：本地 Whisper companion 或外部 ASR、不可变 revision、Segment
  证据锚点、章节、质量 issue、逐段修订以及 TXT / JSON / SRT 导出。
- **检索与 Agent**：SQLite FTS5、可播放引用、后端强制 scope、只读问答，以及经
  before/after 预览和一次性批准的低风险写操作。
- **整理工作台**：用可恢复的八阶段 Run 完成转写、验证、有据提案、人工审批、事务回写
  和再验证。
- **本地优先集成**：OpenAI-compatible LLM、只读 MCP stdio Server、当前格式归档、
  脱敏诊断包和 Tauri / browser-lite 两种桌面形态。

详细能力与版本边界见[路线图](docs/roadmap.md)、[v1 兼容性契约](docs/compatibility.md)和
[v1.0.0 发布说明](docs/releases/v1.0.0.md)。

## 快速开始

开发环境需要 Python 3.12、[uv](https://docs.astral.sh/uv/) 和满足完整前端测试工具链要求的
Node.js（22.22.2+ 的 22.x、24.15.0+ 的 24.x，或 26+）。首次安装依赖：

```bash
uv sync --locked --group test

cd frontend
npm ci
```

分别启动后端和前端：

```bash
# 终端 1：仓库根目录
uv run --locked python backend/run.py

# 终端 2
cd frontend
npm run dev
```

打开 `http://127.0.0.1:5173`。后端开发服务器默认使用 `127.0.0.1:8765`；Tauri 和
browser-lite 会动态选择后端端口，前端业务代码不应依赖固定端口。

启动 Tauri 开发模式：

```bash
cd frontend
npm run tauri:dev
```

本地 Whisper、外部 ASR / LLM、MCP 和完整平台依赖见
[配置指南](docs/configuration.md)与[开发环境](docs/development.md)。

## 文档

| 文档 | 内容 |
| --- | --- |
| [文档导航](docs/README.md) | 按使用者、开发者和发布维护者查找文档 |
| [快速上手](docs/getting-started.md) | 运行模式、首次启动与基本使用流程 |
| [AI、ASR 与 MCP 配置](docs/configuration.md) | Whisper、外部 ASR、LLM、长音频切片和 MCP |
| [数据与安全](docs/data-and-security.md) | 数据目录、备份恢复、归档、API 与隐私边界 |
| [v1 兼容性契约](docs/compatibility.md) | 支持平台、稳定格式、Provider、弃用与回滚策略 |
| [开发环境与测试](docs/development.md) | 分层结构、依赖安装、测试和修改验证 |
| [构建与发布验证](docs/building.md) | sidecar、browser-lite、Tauri 和内部构建流程 |
| [故障排查](docs/troubleshooting.md) | Token、后端、Provider、索引和任务问题 |
| [功能路线图](docs/roadmap.md) | 已完成阶段、v1.0 门槛和候选增强项 |
| [v1.0 发布验证清单](docs/release-checklist.md) | 三平台发布前检查与长期运行门槛 |

## 项目结构

```text
.
├── backend/                 # FastAPI、SQLite、扫描、任务、ASR 与 Agent
│   ├── app/
│   ├── tests/
│   ├── run.py
│   └── build_backend.py
├── frontend/                # React 19、TypeScript、Vite 与 Tauri host
│   ├── src/
│   ├── src-tauri/
│   └── tests/visual/
├── docs/                    # 使用、开发、构建、路线图与内部版本文档
├── pyproject.toml
├── uv.lock
└── VERSION
```

## 开发验证

修改后先运行与改动层相关的最小检查，再扩大验证范围：

```bash
# Backend
cd backend
UV_CACHE_DIR=/tmp/audux-uv-cache uv run --locked --group test python -m pytest tests

# Frontend
cd ../frontend
npm test
npm run typecheck
npm run build

# Rust / Tauri
cd src-tauri
cargo test --locked
cargo check --locked
```

完整覆盖率、视觉测试和跨层验证要求见[开发环境与测试](docs/development.md)。提交前请确认
`git diff --check` 无输出。

## 数据与安全原则

- 运行数据默认位于 `~/.audux/`，自动化测试不得使用该目录。
- 后端只绑定 `127.0.0.1`，敏感 API 受本地随机 Token、Origin 和客户端 Header 保护。
- 远程 ASR 会发送音频，远程 LLM 会发送 metadata 与 Transcript；两者都必须显式允许。
- v1.0 冻结数据库 schema v6；没有显式迁移路径的版本不匹配会拒绝启动且不修改数据库。
- Agent 不拥有任意文件、网络或 Shell 权限，正式写入必须经过范围冻结、预览与审批。

具体备份、恢复和 API 调试方式见[数据与安全](docs/data-and-security.md)。
