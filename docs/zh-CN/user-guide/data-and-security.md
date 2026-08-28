# 数据、备份与安全

[用户指南](README.md) · [中文文档首页](../README.md) · [English](../../en/user-guide/data-and-security.md) · 简体中文

Audux 将数据库和应用生成内容视为用户数据。自动化测试必须使用临时目录，不能指向真实的
`~/.audux/`。

## 数据目录

默认数据目录结构：

```text
~/.audux/
├── database.sqlite
├── covers/
├── logs/
├── exports/
├── backups/
├── components/
├── models/
└── local_api_token
```

- `database.sqlite` 保存资料库记录、设置、Transcript、任务与审计状态。
- `covers/`、`logs/`、`exports/` 和 `backups/` 分别存放应用生成的封面、日志、导出和快照。
- `components/` 保存按版本和平台安装的可选 Whisper companion。

Whisper companion 的远程清单必须通过随应用内置的 Ed25519 公钥验证；清单签名、压缩包
SHA-256/大小、可执行文件 SHA-256/大小任一不匹配都会在原子替换前终止安装。启动已安装的
companion 前也会重新计算可执行文件哈希，避免本地组件被替换后继续运行。
- `models/` 保存按需下载的本地模型权重。
- `local_api_token` 是后端自动生成的随机 Token，不得记录、提交或复制到测试夹具。

原始音频仍位于用户选择的媒体库目录，不会复制进 `~/.audux/`，也不会被 Audux 修改。

## 稳定 schema 策略

`1.0.0` 冻结数据库 schema v6。`0.9.0-beta.1` 已使用相同 schema，因此升级到稳定版不需要
转换数据。检测到较旧、较新、无有效 marker 或损坏的数据库时，应用会在建表或写入前拒绝
启动，原文件保持不变。

未来稳定版若改变 schema，必须随发布物提供显式向前迁移、经校验的更新前快照、失败回滚和
回归测试；没有迁移路径时继续安全拒绝。验证新构建前，请保留匹配旧构建的可恢复副本，并
使用独立测试数据目录。不要把“无法打开旧 schema”误认为可以删除或重建用户数据库。

## 数据库快照与恢复

“设置 → 维护 → 数据库备份与恢复”支持创建、命名、校验和删除受管快照。恢复前会检查：

- SQLite 完整性和当前 schema；
- 可用磁盘空间；
- 是否存在会被切断的活动任务或待审批整理 Run。

提交恢复时会先创建当前数据库的安全快照。Tauri 会重启并切换数据库；browser-lite 会
保留恢复请求并提示手动重启。目标数据库初始化失败时会自动换回安全快照。

数据库快照不包含原始音频、模型缓存或导出文件。做完整灾难恢复备份时，应另外备份整个
`~/.audux/` 和原始媒体目录。

桌面版安装更新前会先完成 updater artifact 下载和 Tauri updater 签名验证，再检查扫描、
ASR、AI、Agent、资料库健康和整理 Run
均已停止，并创建经过 `PRAGMA quick_check` 与 SHA-256 校验的“升级前自动安全快照”。任何
检查或快照失败都会中止安装。快照保留在 `backups/`，可在匹配 schema 的应用版本中恢复。
schema 不兼容且没有显式迁移路径时仍拒绝启动且不修改数据库，不会为了完成更新而绕过
schema 检查。

## 可移植归档与诊断包

v1.0 归档格式 v1 带版本 manifest 和 SHA-256，覆盖 metadata、Tag、Playlist、保存视图、
Transcript revision、章节、质量 issue 与必要的 Agent 审计。导入必须先 dry-run，只接受
当前 schema，并且只向空资料库执行事务导入；音频记录导入后标为缺失，等待安全重新关联。

归档不包含音频文件、凭据、本地 API Token 或绝对媒体根路径。诊断包采用字段白名单，只含
版本、平台、白名单配置、任务状态摘要和完整性结果，不包含完整 Transcript、日志、凭据、
Token 或用户绝对路径。

## 本地 API

独立开发后端默认只监听 `127.0.0.1:8765`；Tauri 与 browser-lite 使用动态回环端口。
安全机制包括：

1. CORS 默认只允许 Tauri origin；browser-lite 与 API 严格同源，浏览器开发 origin 必须通过
   `AUDUX_ALLOWED_ORIGINS` 明确列出。
2. `POST`、`PUT`、`PATCH`、`DELETE` 要求 `X-Audux-Client: audux`。
3. 除 `/health`、`/auth/token` 和 API docs 外，请求需要 `X-Audux-Token`。
4. `<audio>`、`<img>` 和下载等无法附加 Header 的请求使用 `?access_token=<token>`。
5. 请求体上限为 70 MiB，封面上传使用更严格的 10 MiB 有界读取；公开请求字段也有按领域设置的
   长度限制。

前端在 [`frontend/src/api.ts`](../../../frontend/src/api.ts) 中统一获取和附加 Token。手动调试：

```bash
curl http://127.0.0.1:8765/auth/token \
  -H "X-Audux-Client: audux"

curl http://127.0.0.1:8765/library-roots \
  -H "X-Audux-Token: <token>"
```

修改数据的请求还必须带 `X-Audux-Client: audux`。浏览器开发应设置精确的逗号分隔白名单，
例如 `AUDUX_ALLOWED_ORIGINS=http://127.0.0.1:5173`；任意 localhost 端口不再受信任。
开发环境可临时设置 `AUDUX_ALLOW_ALL_CORS=1`，但不得用于日常运行或发布构建，也不能通过
削弱 Token、Origin、CSP 或客户端 Header 来解决开发问题。

Token 文件无法读取、创建或收紧为私有权限时，后端会拒绝启动；它不会退回到无法稳定认证的
临时随机 Token。应修复 `~/.audux/` 的所有权、权限或磁盘问题后再启动。

## Provider 与 Agent 边界

- Audux 会在加载内置本地 VAD 前禁用 ONNX Runtime 遥测，不初始化上传器、遥测事件或持久化
  设备标识。
- 远程 ASR 会收到完整音频或切片，远程 LLM 会收到相关 metadata 与 Transcript。
- 非回环 endpoint 默认拒绝，必须在设置中明确允许。
- Agent scope 由后端解析并冻结，不由 Prompt 自律；Transcript 与模型输出都视为不可信输入。
- MCP 只读，内置写操作仅限低风险服务边界，并要求精确计划、一次性批准和事务执行。
- Agent 不可删除文件、恢复数据库、修改 Provider，也不可访问任意路径、网络、Shell、日志
  或凭据。
