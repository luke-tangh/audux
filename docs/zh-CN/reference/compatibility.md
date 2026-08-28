# v1 稳定性与兼容性契约

[参考与稳定契约](README.md) · [中文文档首页](../README.md) · [English](../../en/reference/compatibility.md) · 简体中文

本文定义 Audux `1.0.0` 的公开兼容边界。版本号遵循 SemVer：补丁版本只修复缺陷并保持
下述契约兼容；新增兼容能力使用次版本；破坏公开契约的变更只进入新的主版本。

## 支持平台

正式安装包在目标操作系统原生构建，不跨平台复制 sidecar：

| 平台 | v1.0 支持范围 | 发布物 |
| --- | --- | --- |
| Linux | x86_64，具有 WebKitGTK 4.1 的现代发行版 | AppImage、DEB、RPM、browser-lite |
| Windows | Windows 10/11 x86_64，WebView2 Runtime | NSIS、browser-lite |
| macOS | macOS 14 或更高版本，Apple Silicon | DMG、browser-lite |

v1.0 不支持 Intel Mac，也不发布 macOS x86_64 安装包、browser-lite 或 Whisper component。

Windows 安装包暂未做 Authenticode 签名，macOS 安装包暂未做 Developer ID 签名或公证；
系统可能显示未知发布者提示。Tauri 应用内更新仍必须通过项目 updater 密钥签名验证。

## 数据与格式

- `1.0.x` 使用数据库 schema v6。`0.9.0-beta.1` 已使用同一 schema，因此数据可由
  `1.0.0` 原样打开；启动不会为了改版本号重写数据库。
- 数据库必须有唯一且有效的 `app_schema` marker。较旧、较新、无 marker 或损坏的数据库
  会在任何建表或写入前被拒绝，原文件保持不变。
- 可移植归档格式为 `audux-archive` v1，并绑定数据库 schema v6。v1.0 只导入当前格式，
  先 dry-run，再只向空资料库事务导入。
- 保存视图查询、Agent 会话导出、恢复请求和 Whisper component manifest 当前均为格式
  v1；各入口继续严格校验版本。

未来若稳定版需要改变数据库 schema，发布物必须同时包含显式向前迁移、经校验的更新前
快照、失败回滚和迁移回归测试。没有迁移路径的构建只能安全拒绝，不能猜测或原地修补用户
数据。归档格式升级必须使用新的格式版本；旧版本支持范围会在发布说明中列出。

## Provider 与 MCP

- 外部 ASR 稳定契约是 OpenAI-compatible `POST /audio/transcriptions` multipart 请求，
  响应至少包含 `text`，可选 `language`、`model` 和 Segment 时间戳。
- LLM 稳定契约是 OpenAI-compatible Chat Completions。Agent 工具执行只对通过原生 tool
  calling 能力探测的 Provider 开放；普通生成不获得工具权限。
- MCP 的首选协议版本为 `2026-07-28`。stdio Server 还保留 `2025-11-25`、
  `2025-06-18` 和 `2024-11-05` 的 initialize 回退；所有版本只暴露同一组只读工具。
- Provider 或 MCP 字段需要弃用时，先在文档和运行时结果中告知，至少保留到下一个次版本；
  安全问题可立即收紧，但必须在发布说明中标明行为变化。

不同 ASR/LLM 模型的准确率、语言覆盖、结构化输出和 tool calling 能力不属于应用兼容性
保证。确定性时间轴检查、scope、引用校验、审批和事务边界始终由 Audux 后端执行。

## 降级与不可用行为

- 未安装 Whisper companion 或 ASR 不可用时，只禁用对应本地转写任务。
- LLM 不可用或不支持 tool calling 时，Agent 运行会失败或降级为普通生成，不影响播放、
  手工 metadata/Tag/Playlist、Transcript 浏览、FTS 搜索、备份和导出。
- embedding 未配置或不可用时，检索明确报告 `fts` 与 fallback reason，并继续使用 FTS5。
- 远程 Provider 默认关闭；非回环 endpoint 只有在用户明确允许后才会收到数据。

## 弃用、备份与回滚

公开契约的弃用会写入发布说明和本页，不以静默字段删除完成。任何会改变 schema 的稳定更新
必须先创建并验证 `pre_update` 快照；活动任务或快照失败会阻止安装。

回滚步骤：

1. 正常退出 Audux，并保留整个 `~/.audux/` 与原始媒体目录的副本。
2. 安装目标旧版本，但不要先用它打开较新 schema 的数据库。
3. 使用目标版本兼容的 `pre_update`/手动快照恢复数据库；若 schema 未改变，可直接使用
   原数据库。
4. 启动后执行资料库健康检查和 FTS 重建，并抽查 Transcript revision、Tag 与 Playlist。

数据库快照不包含原始音频、模型缓存或普通导出文件。browser-lite 不自替换可执行文件，
回滚时需手工替换为目标版本。

## 已知限制

- 不提供云同步、多用户、移动端或通用联网/Shell Agent。
- Audux 不修改、移动或删除原始音频文件；删除资料库记录不等于删除源文件。
- 归档不包含原始音频，导入后需要在受信媒体库根目录中重新关联。
- embedding 尚未作为必装组件；v1.0 的可重复检索质量基线是 SQLite FTS5。
- ASR/LLM 质量取决于模型和硬件。没有证据的模型回答、Tag 或勘误不能绕过后端校验与用户
  审批成为正式内容。
