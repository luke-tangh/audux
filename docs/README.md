# Audux 文档

本文档集对应当前内部候选版本 `0.9.0-beta.1`（数据库 schema v6）。v0.x 构建只用于
内部 Beta 验证，不代表公开发布或兼容性承诺。

## 使用与配置

- [快速上手](getting-started.md)：选择运行方式、启动应用并建立第一个资料库。
- [AI、ASR 与 MCP 配置](configuration.md)：本地 Whisper、外部 ASR、LLM、长音频切片
  以及只读 MCP Server。
- [数据与安全](data-and-security.md)：数据目录、备份恢复、可移植归档、本地 API 和隐私。
- [故障排查](troubleshooting.md)：处理启动、Token、Provider、搜索索引和任务状态问题。

## 开发与发布

- [开发环境与测试](development.md)：仓库分层、依赖、开发命令和验证矩阵。
- [构建与发布验证](building.md)：backend sidecar、Whisper companion、browser-lite、Tauri
  与内部构建工作流。
- [内部 Beta 验证清单](release-checklist.md)：三平台 smoke、恢复、Provider 和长期运行门槛。

## 规划与版本记录

- [功能路线图](roadmap.md)：v0.5–v0.9 已完成范围、v1.0 稳定门槛和后续候选项。
- [v0.6 历史 PRD](../PRD.md)：仅供追溯早期决策，不代表当前 schema 或 API 契约。
- [v0.9.0-beta.1](releases/v0.9.0-beta.1.md)：当前内部候选说明。
- [v0.8.0-beta.1](releases/v0.8.0-beta.1.md)
- [v0.7.0-beta.1](releases/v0.7.0-beta.1.md)
- [v0.6.0-beta.1](releases/v0.6.0-beta.1.md)
- [v0.5.0-beta.1](releases/v0.5.0-beta.1.md)

版本号的唯一简明来源是仓库根目录的 [`VERSION`](../VERSION)。Python、npm、Cargo、
Tauri 配置和 `backend/app/version.py` 应与它保持一致。
