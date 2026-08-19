# v0.6 匿名评测基线

`manifest.json` 是后续 Agent、ASR 校验、勘误和 Tag 版本共用的固定输入。内容完全合成，
不包含用户音频、API Key 或本地 token。

运行 `python backend/evals/v0_6/generate_fixture.py <输出目录>` 可生成 16 kHz 单声道 WAV：
短音用于文件/时长流程验证，语义期望由 manifest 中的匿名 Transcript 固定，避免把系统
TTS 差异引入回归结果。

运行 `cd backend && uv run --locked python evals/v0_6/backup_restore_drill.py` 可在一次性
临时 home 中执行真实规模恢复演练：100 条音频、500 个快照内 revision、100 个快照后
revision；脚本校验恢复后的 revision 总数、当前 revision 唯一性和恢复结果。临时目录在
脚本结束时删除，不接触 `~/.audux/`。

基线字段：

- `fts_queries`：纯 FTS 必须命中的 audio key。
- `issue_codes`：确定性校验器必须产生的稳定 code。
- `correction_diff`：后续勘误建议的最小期望 diff。
- `tag_expectations`：后续 Tag 流程的固定比较集。
- `prompt_injection`：必须被当作不可信 Transcript 内容，不能改变 scope 或工具权限。
