# Audux 中文文档

[返回仓库首页](../../README.md) · [English](../en/README.md) · 简体中文

Audux 是一款本地优先的私人音频知识库桌面应用。它把本地音频扫描、播放与整理、
Transcript、全文检索以及受控 AI 工作流放在同一个资料库中，并且不会修改原始音频文件。

本文档对应 `1.0.0`（数据库 schema v6、归档格式 v1）。公开兼容边界见
[v1 稳定性与兼容性契约](reference/compatibility.md)。

## 从这里开始

- **第一次使用 Audux**：[安装与快速上手](user-guide/getting-started.md)
- **配置转写或 AI**：[AI、ASR 与 MCP 配置](user-guide/configuration.md)
- **了解数据与隐私**：[数据、备份与安全](user-guide/data-and-security.md)
- **遇到启动或任务问题**：[故障排查](user-guide/troubleshooting.md)
- **参与开发**：[开发与贡献指南](contributing/README.md)
- **维护兼容性或发布**：[参考与稳定契约](reference/README.md)和
  [发布验证清单](contributing/release-checklist.md)

## 文档分区

| 分区 | 面向读者 | 内容 |
| --- | --- | --- |
| [用户指南](user-guide/README.md) | 用户与集成方 | 安装、首次使用、Provider、MCP、数据安全和故障处理 |
| [参考与稳定契约](reference/README.md) | 用户、集成方与维护者 | v1 兼容边界、安全公告和受支持行为 |
| [开发与贡献](contributing/README.md) | 开发者与发布维护者 | 环境搭建、测试、构建、打包和发布验证 |
| [项目规划](project/README.md) | 贡献者与产品维护者 | 当前路线图、已完成阶段和候选增强项 |
| [发布记录](releases/README.md) | 所有读者 | 稳定版本与历史内部候选说明 |
| [历史资料](history/README.md) | 需要追溯早期决策的维护者 | 已冻结且不代表当前契约的历史文档 |

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

详细能力与版本边界见[路线图](project/roadmap.md)、
[v1 兼容性契约](reference/compatibility.md)和[v1.0.0 发布说明](releases/v1.0.0.md)。

## 开发快速开始

开发环境需要 Python 3.12、[uv](https://docs.astral.sh/uv/) 和满足完整前端测试工具链要求的
Node.js（22.22.2+ 的 22.x、24.15.0+ 的 24.x，或 26+）。在仓库根目录安装依赖：

```bash
uv sync --locked --group test

cd frontend
npm ci
```

分别启动后端和前端：

```bash
# 终端 1：仓库根目录
AUDUX_ALLOWED_ORIGINS=http://127.0.0.1:5173 \
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

完整依赖与验证说明见[开发环境与测试](contributing/development.md)。

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
├── docs/
│   └── zh-CN/              # 中文用户、参考、开发、规划与发布文档
├── pyproject.toml
├── uv.lock
└── VERSION
```

## 数据与安全原则

- 运行数据默认位于 `~/.audux/`，自动化测试不得使用该目录。
- 后端只绑定 `127.0.0.1`，敏感 API 受本地随机 Token、Origin 和客户端 Header 保护。
- 远程 ASR 会发送音频，远程 LLM 会发送 metadata 与 Transcript；两者都必须显式允许。
- v1.0 冻结数据库 schema v6；没有显式迁移路径的版本不匹配会拒绝启动且不修改数据库。
- Agent 不拥有任意文件、网络或 Shell 权限，正式写入必须经过范围冻结、预览与审批。

具体备份、恢复和 API 调试方式见[数据、备份与安全](user-guide/data-and-security.md)。
