# Beta Release Checklist

> F4 已决定进入 Beta 发布验证。执行本清单不代表已经批准发布；所有 publish gate
> 项目通过后，才确定并创建实际版本标签。评估记录见
> [`v0.5-f4-evaluation.md`](v0.5-f4-evaluation.md)。

这份清单用于后续 Beta 候选版本。测试必须使用临时媒体库和测试数据目录，不要直接
拿唯一一份真实用户数据做升级或卸载测试。

## 1. Automated preflight

从仓库根目录执行：

```bash
cd backend
uv run --locked --group test python -m pytest tests

cd ../frontend
npm run build
npm run test:visual

cd src-tauri
cargo test --locked
cargo check --locked
```

确认 `git diff --check` 无输出，并确认 `VERSION`、Python、npm、Cargo 和 Tauri 的
版本一致。

## 2. Build dry-run

在 GitHub Actions 中手动运行 `Release` workflow。确认三个构建任务成功并下载：

- Linux x64 bundle
- Windows x64 NSIS (`.exe`) bundle
- macOS x64 bundle
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

## 4. Upgrade and backup smoke test

复制一份旧版本测试数据目录，在副本上执行升级：

- 启动后 `backups/` 中新增 `database.pre-migration-*.sqlite`。
- 备份执行 `PRAGMA quick_check` 返回 `ok`。
- 音频、标签、playlist、transcript、任务历史和设置仍可读取。
- 搜索可用；必要时在设置中重建 FTS 索引。
- 第二次启动不会为同一 schema 重复创建升级备份。
- 用旧版本打开较新 schema 时应拒绝修改数据库。

## 5. Backend lifecycle and providers

- 先占用默认端口 `8765` 再启动应用，确认 Tauri 自动选择其他回环端口。
- 关闭窗口并确认备用端口释放。
- lite 安装包在未安装组件时明确提示，不创建本地转写任务。
- 从 Release manifest 下载、校验并安装 Whisper companion，完成一次本地转写。
- 首次模型下载写入 `models/faster-whisper/`；移除/重装组件后模型缓存仍保留。
- 取消运行中的本地转写后 companion 子进程退出，任务最终为 canceled。
- External ASR 使用 mock/测试服务完成一次 multipart 上传并写入 transcript。
- 非 loopback ASR 和 LLM endpoint 仍显示隐私警告并需要显式允许。

## 6. Publish gate

只有重新确定发布版本，且三个平台的 clean-install、升级和生命周期检查全部通过后，
才创建并推送对应标签。例如：

```bash
git tag vX.Y.Z-beta.N
git push origin vX.Y.Z-beta.N
```

发布后下载 GitHub Release 中的文件，再做一次安装包哈希和启动抽查。
