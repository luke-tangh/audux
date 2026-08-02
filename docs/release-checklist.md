# v0.5.0 Beta Release Checklist

这份清单用于 `v0.5.0-beta.1` 及后续 Beta。测试必须使用临时媒体库和测试数据目录，
不要直接拿唯一一份真实用户数据做升级或卸载测试。

## 1. Automated preflight

从仓库根目录执行：

```bash
cd backend
uv run --locked python -m unittest discover -s tests

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
- Windows x64 bundle
- macOS x64 bundle

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
- 完整 sidecar 验证 `faster_whisper` Provider 可以加载。
- External ASR 使用 mock/测试服务完成一次 multipart 上传并写入 transcript。
- 非 loopback ASR 和 LLM endpoint 仍显示隐私警告并需要显式允许。

## 6. Publish gate

只有三个平台的 clean-install、升级和生命周期检查全部通过后，才推送：

```bash
git tag v0.5.0-beta.1
git push origin v0.5.0-beta.1
```

发布后下载 GitHub Release 中的文件，再做一次安装包哈希和启动抽查。
