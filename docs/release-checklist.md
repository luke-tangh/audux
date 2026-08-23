# Internal Beta Validation Checklist

> v1.0 前所有版本均保留为内部 Beta。执行本清单只验证候选构建，不创建公开 GitHub
> Release；首次公开发布统一为 v1.0。

这份清单用于后续 Beta 候选版本。测试必须使用临时媒体库和测试数据目录，不要直接
拿唯一一份真实用户数据做升级或卸载测试。

## 1. Automated preflight

从仓库根目录执行：

```bash
cd backend
uv run --locked --group test python -m pytest tests

cd ../frontend
npm test
npm run build
npm run test:visual

cd src-tauri
cargo test --locked
cargo check --locked
```

确认 `git diff --check` 无输出，并确认 `VERSION`、Python、npm、Cargo 和 Tauri 的
版本一致。

## 2. Build dry-run

在 GitHub Actions 中手动运行 `Internal Builds and v1 Release` workflow。确认三个构建
任务成功并下载：

- Linux x64 bundle
- Windows x64 NSIS (`.exe`) bundle
- macOS 13+ x64 bundle
- 三个平台的 `audux-lite-<target>.zip`
- 三个平台的 `audux-whisper-<target>.zip` 和 descriptor

手动触发不得创建 GitHub Release。检查每个平台 artifact 中确实包含安装包，而不是
debug sidecar placeholder。

## 3. Clean-install smoke test

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
- 使用 sidecar `--mcp` 启动真实 stdio 客户端，完成 initialize、tools/list 和每个 read 工具的
  tools/call；确认写工具、绝对路径、Token、API Key 和范围外音频均不可见。
- 未配置 embedding 时 Agent 和 Segment 搜索显示 FTS 模式；关闭 LLM 服务后普通关键词搜索、
  Transcript 浏览和播放仍正常。
- 关闭最后一个应用窗口后，`audux-backend` / Python backend 进程退出。
- 再次启动后媒体库、播放位置、标签、playlist 和设置仍存在。
- 卸载应用不会静默删除 `~/.audux` 用户数据。

browser-lite 每个平台至少验证：

- 单个可执行文件启动后显示回环 URL，并自动打开生产前端。
- 默认端口被占用时仍能选择其他端口，页面、媒体和 API 均使用同一 origin。
- 浏览器中可以手动输入媒体库路径；不可用的 Tauri 原生选择器有明确提示。
- `Ctrl+C` 或关闭终端后 backend 退出且端口释放。
- 未安装/已安装 Whisper companion 两种状态与 Tauri 版本保持一致。

## 4. Backup and restore smoke test

使用当前预发布 schema 的临时测试数据：

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

## 5. Backend lifecycle and providers

- 先占用默认端口 `8765` 再启动应用，确认 Tauri 自动选择其他回环端口。
- 关闭窗口并确认备用端口释放。
- lite 安装包在未安装组件时明确提示，不创建本地转写任务。
- 从 Release manifest 下载、校验并安装 Whisper companion，完成一次本地转写。
- 首次模型下载写入 `models/faster-whisper/`；移除/重装组件后模型缓存仍保留。
- 取消运行中的本地转写后 companion 子进程退出，任务最终为 canceled。
- External ASR 使用 mock/测试服务完成一次 multipart 上传并写入 transcript。
- 设置页确认 Silero VAD、ONNX Runtime CPU provider、FFmpeg 和 ffprobe 均可用；用包含
  明显停顿的长音频确认切片边界落在非语音区间，取消 VAD 中的任务后 FFmpeg 子进程退出。
- 解包或运行主 backend sidecar，确认包含 `silero_vad_16k_op15.onnx`，并且模型 SHA-256
  校验通过；离线环境不得尝试下载 VAD 模型或 runtime。
- 非 loopback ASR 和 LLM endpoint 仍显示隐私警告并需要显式允许。

## 6. v0.9 archive, diagnostics and sustained-run gate

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

## 7. No-public-release gate

v0.x 阶段只允许手动运行 workflow 并下载内部 artifacts，不推送会触发公开 Release 的
版本标签。workflow 只接受 `v1.0.*` 标签进入首次公开发布任务。

只有 v1.0 的 schema 策略、隐私和三平台门槛全部通过后，才创建首次公开版本标签并发布；
发布后仍需下载 GitHub Release 文件做安装包哈希和启动抽查。
