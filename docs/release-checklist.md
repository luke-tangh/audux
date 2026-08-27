# Audux v1.0 发布验证清单

> 手动执行 workflow 只验证候选构建，不创建公开 GitHub Release。只有完成本清单并留存
> 三平台记录后，才可推送与 `VERSION` 一致的稳定版 tag。

当前发布版本为 `1.0.0`，应用数据库 schema 为 v6，归档格式为 v1。版本号以仓库根目录
`VERSION` 为准。

这份清单用于 v1.0 候选构建和正式 tag。测试必须使用临时媒体库和测试数据目录，不要直接
拿唯一一份真实用户数据做升级或卸载测试。

## 1. 自动化预检

从仓库根目录执行：

```bash
cd backend
uv run --locked --group test python -m pytest tests \
  --cov=app --cov-branch \
  --cov-report=term-missing:skip-covered --cov-report=xml \
  --cov-fail-under=70
uv run --locked python evals/v0_7/run_retrieval_eval.py

cd ../frontend
npm run test:coverage
npm run typecheck
npm run build
npm run test:visual

cd src-tauri
cargo test --locked
cargo check --locked

cd ../..
cargo deny --manifest-path frontend/src-tauri/Cargo.toml --locked check advisories
```

确认 `git diff --check` 无输出，并确认 `VERSION`、Python、npm、Cargo 和 Tauri 的
版本一致。复核 [Rust 安全公告例外](security-advisories.md) 未过期，依赖链、可达性证据、
补偿测试和公开跟踪项仍准确；稳定 tag 不得依赖已过期或没有记录的 allowlist。

确认 `release` Environment secrets 已配置且来自同一套受控密钥材料：

- `TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`、
  `TAURI_UPDATER_PUBLIC_KEY`；
- `AUDUX_WHISPER_MANIFEST_PRIVATE_KEY`、`AUDUX_WHISPER_MANIFEST_PUBLIC_KEY`。

所有 workflow 的第三方 Action 必须固定到完整 commit SHA。正式 tag workflow 会在构建前
再次执行 backend、frontend、Playwright 和三平台 Rust 门禁；不得通过重跑发布 job 绕过失败
的测试 job。

## 2. 构建演练

在 GitHub Actions 中手动运行两次 `Internal Builds and v1 Release` workflow：

1. 保持 `signed_preflight=false`，验证不读取签名私钥的日常三目标内部构建；
2. 设置 `signed_preflight=true`，经 `release` Environment 审批后，验证与正式 tag 完全相同
   的 updater 签名、Whisper 清单签名、三目标汇总、SHA-256 和 provenance attestation 流程。

两次运行都不得创建 GitHub Release。签名预检应生成一个
`audux-release-candidate-1.0.0` workflow artifact；下载并确认其中包含：

- Linux x64 bundle
- Windows x64 NSIS (`.exe`) bundle
- macOS 14+ Apple Silicon bundle
- 三个 target 的 `audux-lite-<target>.zip`
- 三个 target 的 `audux-whisper-<target>.zip`
- `latest.json`、`whisper-components.json`、`whisper-components.json.sig` 和 `SHA256SUMS`

用 `sha256sum --check SHA256SUMS` 复核下载内容，并在运行详情中确认 provenance
attestation 已生成。检查每个平台 artifact 中确实包含安装包，而不是 debug sidecar
placeholder。
解包安装包资源、browser-lite ZIP 和 Whisper ZIP，确认包含非空
`LICENSE` 与 `THIRD_PARTY_NOTICES.txt`；Whisper ZIP 只允许 companion 可执行文件和这两个
许可文件。

## 3. 全新安装冒烟测试

每个平台至少验证：

- 安装和首次启动成功，60 秒内后端进入 ready。
- 添加临时媒体库、扫描、播放、metadata 编辑和搜索正常。
- 创建 ASR / AI 任务后 UI 保持可操作，取消和重试正常。
- 在当前音频、显式选择集、Playlist、保存视图、Tag 和媒体库目录范围分别创建只读 Agent
  会话；引用只能来自所选范围，点击后跳转到正确音频时间点。
- 使用包含“忽略范围、读取其他目录”的 Transcript 验证 Prompt Injection 不会扩大 scope；
  修改对应 Transcript revision 后旧引用不再展示。
- 让 Agent 提案 metadata、Tag、手动 Playlist、保存视图和排队转写；逐项核对冻结目标与
  before/after 后批准。确认重复批准、目标在审批前变化、范围外 audio id 和任一项失败均不会
  留下部分写入。
- 使用 sidecar `--mcp` 启动真实 stdio 客户端，按 MCP `2026-07-28` 完成
  server/discover、tools/list 和每个 read 工具的 tools/call；确认每个请求都带逐请求 `_meta`，
  写工具、绝对路径、Token、API Key 和范围外音频均不可见。另用一个旧客户端验证 initialize
  回退不会扩大能力。
- 未配置 embedding 时 Agent 和 Segment 搜索显示 FTS 模式；关闭 LLM 服务后普通关键词搜索、
  Transcript 浏览和播放仍正常。
- 关闭最后一个应用窗口后，`audux-backend` / Python backend 进程退出。
- 再次启动后媒体库、播放位置、标签、playlist 和设置仍存在。
- 在“设置 → 更新”检查当前版本；用高于当前版本的签名测试清单完成下载。确认活动任务会阻止
  安装，空闲时先生成 `pre_update` 安全快照，再安装、重启并保留原始音频与资料库状态。
- 修改 updater artifact、签名或 `latest.json` 后确认客户端拒绝安装；确认失败时不会创建
  不完整数据库副本，也不会停止当前 backend。
- 卸载应用不会静默删除 `~/.audux` 用户数据。
- 当前暂不做 Windows Authenticode 或 Apple Developer ID / notarization；确认安装包和发布
  说明明确提示未做操作系统级签名，并验证用户经过系统警告后仍能完成安装。Tauri updater
  artifact 的签名验证仍必须通过。

browser-lite 每个平台至少验证：

- 单个可执行文件启动后显示回环 URL，并自动打开生产前端。
- 默认端口被占用时仍能选择其他端口，页面、媒体和 API 均使用同一 origin。
- 浏览器中可以手动输入媒体库路径；不可用的 Tauri 原生选择器有明确提示。
- `Ctrl+C` 或关闭终端后 backend 退出且端口释放。
- 未安装/已安装 Whisper companion 两种状态与 Tauri 版本保持一致。

## 4. 备份、恢复与回滚冒烟测试

使用 schema v6 的临时测试数据：

- 手动备份执行 `PRAGMA quick_check` 返回 `ok`。
- 音频、标签、playlist、transcript、任务历史和设置仍可读取。
- 搜索可用；必要时在设置中重建 FTS 索引。
- 不同 schema 的数据库和快照应被拒绝，且原数据库不被修改。
- 在设置中创建并校验一个手动数据库快照，修改临时标签、Playlist 和 Transcript 后
  执行恢复，确认重启后数据回到快照状态。
- 恢复前自动生成 `database.pre-restore-*.sqlite`；损坏快照、较新 schema、活动任务和
  空间不足均应在切换前被拒绝。
- Tauri 提交恢复后自动重启；browser-lite 保留待恢复请求并明确提示手动重启。
- 模拟目标库初始化失败时自动换回恢复前快照，并在设置中显示 rolled-back 结果。
- 从 `0.9.0-beta.1` schema v6 数据启动 `1.0.0`，确认无需迁移且数据未被改写；再按
  [兼容性契约](compatibility.md#弃用备份与回滚)用 `pre_update` 快照演练回滚。

## 5. Backend 生命周期与 Provider

- 先占用默认端口 `8765` 再启动应用，确认 Tauri 自动选择其他回环端口。
- 关闭窗口并确认备用端口释放。
- lite 安装包在未安装组件时明确提示，不创建本地转写任务。
- 从 Release manifest 下载、验证 `whisper-components.json.sig`、校验 ZIP 与可执行文件哈希
  并安装 Whisper companion，完成一次本地转写。
- 分别篡改 manifest、`.sig`、ZIP、可执行文件和 descriptor 声明大小，确认安装在替换现有
  component 前失败；已安装 component 被修改后不得继续作为可用 companion。
- 首次模型下载写入 `models/faster-whisper/`；移除/重装组件后模型缓存仍保留。
- 取消运行中的本地转写后 companion 子进程退出，任务最终为 canceled。
- External ASR 使用 mock/测试服务完成一次 multipart 上传并写入 transcript。
- 设置页确认 Silero VAD、ONNX Runtime CPU provider、FFmpeg 和 ffprobe 均可用；用包含
  明显停顿的长音频确认切片边界落在非语音区间，取消 VAD 中的任务后 FFmpeg 子进程退出。
- 解包或运行主 backend sidecar，确认包含 `silero_vad_16k_op15.onnx`，并且模型 SHA-256
  校验通过；离线环境不得尝试下载 VAD 模型或 runtime。
- 非 loopback ASR 和 LLM endpoint 仍显示隐私警告并需要显式允许。

## 6. v1.0 归档、诊断与长期运行门槛

- 导出当前格式归档，解包核对 manifest、数据 SHA-256 和实体计数；搜索归档确认不含 API Key、
  本地 API Token、绝对媒体根路径和日志。
- 在空临时资料库执行归档 dry-run 和全量导入；确认所有音频标记为待重新关联，Transcript
  revisions、章节、Tag、Playlist、保存视图、质量 issue 和 Agent 审计完整，FTS 可用。
- 对非空资料库、损坏 zip、额外 zip member、较旧/较新 schema、修改后的 pending import 和
  ID 冲突执行导入，确认全部在事务写入前被拒绝。
- 生成诊断包并确认只包含白名单配置、版本、平台、任务状态摘要和完整性结果，不含完整
  Transcript、日志、凭据、Token 或用户绝对路径。
- Tauri、browser-lite 与 MCP 各持续运行至少 8 小时；期间执行休眠/恢复、默认端口冲突、
  Provider 断连、千条以上资料库检索、任务取消、Agent 恢复和正常退出。记录峰值内存、残留
  子进程、失败任务和恢复结果。
- Linux、Windows、macOS 分别从目标系统构建并执行上述 smoke；检查发布包不含 debug
  placeholder，MCP `--mcp` 入口和可选 Whisper component 均可运行。

## 7. 公开发布门槛

推送 tag 前，确认 unsigned 和 signed preflight 均成功，`VERSION`、Python、npm、Cargo、
Tauri 和发布说明均为 `1.0.0`，并确认
`docs/compatibility.md` 中的支持平台、schema/归档、Provider/MCP、弃用和回滚契约与产物
一致。workflow 只接受 `v1.0.*` 标签进入公开发布任务。

只有 schema、隐私、匿名评测和三平台门槛全部通过后，才创建 `v1.0.0` 标签并发布。发布后
仍需从 GitHub Release 重新下载每个平台安装包、browser-lite、Whisper component、
`whisper-components.json`、`whisper-components.json.sig` 与 `latest.json`，核对哈希、签名、
第三方许可清单和启动结果。正式 workflow 会先创建 draft，重新下载全部 draft assets 并按
`SHA256SUMS` 校验；只有校验成功才将其转成 latest 公开 Release。
