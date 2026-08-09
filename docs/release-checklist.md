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
- macOS x64 bundle
- 三个平台的 `local-audio-library-lite-<target>.zip`
- 三个平台的 `local-audio-whisper-<target>.zip` 和 descriptor

手动触发不得创建 GitHub Release。检查每个平台 artifact 中确实包含安装包，而不是
debug sidecar placeholder。

## 3. Clean-install smoke test

每个平台至少验证：

- 安装和首次启动成功，60 秒内后端进入 ready。
- 添加临时媒体库、扫描、播放、metadata 编辑和搜索正常。
- 创建 ASR / AI 任务后 UI 保持可操作，取消和重试正常。
- 关闭最后一个应用窗口后，`local-audio-backend` / Python backend 进程退出。
- 再次启动后媒体库、播放位置、标签、playlist 和设置仍存在。
- 卸载应用不会静默删除 `~/.local_audio_library` 用户数据。

browser-lite 每个平台至少验证：

- 单个可执行文件启动后显示回环 URL，并自动打开生产前端。
- 默认端口被占用时仍能选择其他端口，页面、媒体和 API 均使用同一 origin。
- 浏览器中可以手动输入媒体库路径；不可用的 Tauri 原生选择器有明确提示。
- `Ctrl+C` 或关闭终端后 backend 退出且端口释放。
- 未安装/已安装 Whisper companion 两种状态与 Tauri 版本保持一致。

## 4. Upgrade and backup smoke test

复制一份旧版本测试数据目录，在副本上执行升级：

- 启动后 `backups/` 中新增 `database.pre-migration-*.sqlite`。
- 备份执行 `PRAGMA quick_check` 返回 `ok`。
- 音频、标签、playlist、transcript、任务历史和设置仍可读取。
- 搜索可用；必要时在设置中重建 FTS 索引。
- 第二次启动不会为同一 schema 重复创建升级备份。
- 用旧版本打开较新 schema 时应拒绝修改数据库。
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
- 非 loopback ASR 和 LLM endpoint 仍显示隐私警告并需要显式允许。

## 6. No-public-release gate

v0.x 阶段只允许手动运行 workflow 并下载内部 artifacts，不推送会触发公开 Release 的
版本标签。workflow 只接受 `v1.0.*` 标签进入首次公开发布任务。

只有 v1.0 的兼容、迁移、隐私和三平台门槛全部通过后，才创建首次公开版本标签并发布；
发布后仍需下载 GitHub Release 文件做安装包哈希和启动抽查。
