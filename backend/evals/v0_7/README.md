# v0.7 有据检索评测

`manifest.json` 在 v0.6 的匿名中英混合 Transcript fixture 上固定查询、期望 Segment 与
范围泄漏样例。它不包含用户音频、API Key 或本地 API token。

运行：

```bash
cd backend
uv run --locked python evals/v0_7/run_retrieval_eval.py
```

脚本在一次性临时 home 中创建当前 schema，记录 Recall@5、首个结果延迟、可验证引用覆盖率、
无证据回答率与范围泄漏数。当前基线选择 SQLite FTS5；embedding 尚未选型，调用方请求
hybrid 时必须明确收到 `embedding_not_configured` 并继续使用 FTS，不影响搜索和 Transcript
浏览。

LLM 输出质量与 Provider/模型相关，因此固定基线只评估后端可确定的召回、scope 和 citation
前置条件；工具调用、取消、revision 失效和 Prompt Injection 边界由自动化测试覆盖。

1 万条音频规模演练：

```bash
cd backend
uv run --locked python evals/v0_7/scale_drill.py
```

演练记录首个检索结果、Agent 取消和普通播放查询的 wall/CPU 时间，以及 Python 峰值分配和
SQLite 磁盘占用。所有数据都位于一次性临时目录，结束后自动清理。
