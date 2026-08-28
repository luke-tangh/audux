# 开发环境与测试

[开发与贡献](README.md) · [中文文档首页](../README.md) · [English](../../en/contributing/development.md) · 简体中文

Audux 包含 React 前端、FastAPI backend 和 Tauri host 三层。行为应由所属层实现；跨层功能
需要同步更新 API schema、共享 TypeScript 类型、实现和测试。

## 仓库分层

| 路径 | 职责 |
| --- | --- |
| `frontend/src/` | React UI、hooks、共享类型和经 `api.ts` 集中的 HTTP 客户端 |
| `frontend/tests/visual/` | Playwright 工作流、可访问性与截图测试 |
| `backend/app/routes/` | 薄 HTTP request / response 层 |
| `backend/app/services/` | 可复用业务逻辑与安全边界 |
| `backend/app/tasks.py` | 后台任务生命周期、取消与中断恢复 |
| `backend/tests/` | pytest 单元与 API 集成测试 |
| `frontend/src-tauri/` | Tauri 命令、backend 进程生命周期与打包 |

更细的文件职责与编码约束见仓库根目录的 [`AGENTS.md`](../../../AGENTS.md)。

## 安装依赖

```bash
# 仓库根目录：基础 backend 与测试依赖
uv sync --locked --group test

# 只有测试 faster-whisper 时才需要
uv sync --locked --extra asr --group test

# Frontend
cd frontend
npm ci
```

受限环境中对 uv 命令设置 `UV_CACHE_DIR=/tmp/audux-uv-cache`。ASR 和 PyInstaller 完整环境
较大，不应为无关修改安装。

## 开发服务器

```bash
# Backend；默认 127.0.0.1:8765
AUDUX_ALLOWED_ORIGINS=http://127.0.0.1:5173 \
  uv run --locked python backend/run.py

# Frontend；默认 127.0.0.1:5173
cd frontend
npm run dev

# Tauri（需要原生依赖）
cd frontend
npm run tauri:dev
```

可用 `AUDUX_API_PORT` 改变独立 backend 端口。`AUDUX_ALLOWED_ORIGINS` 是逗号分隔的精确
浏览器开发白名单，不能替换为所有 localhost 端口。新的前端行为必须继续通过 `src/api.ts`
和 Tauri 的动态 backend URL 获取地址，不能硬编码 `8765`。

## Backend 验证

从 `backend/` 执行：

```bash
uv run --locked --group test python -m pytest tests

uv run --locked --group test python -m pytest tests \
  --cov=app --cov-branch \
  --cov-report=term-missing:skip-covered --cov-report=xml \
  --cov-fail-under=70
```

测试基础设施在收集前建立进程级临时 home。API 测试应复用 `tests.api_test_support`，不得
绕过临时数据库、媒体根、封面、日志和 Token 文件隔离。

## Frontend 验证

从 `frontend/` 执行：

```bash
npm test
npm run test:coverage
npm run typecheck
npm run build
```

逻辑测试使用 colocated `*.test.ts(x)` Vitest 测试。显著 UI、响应式布局、键盘焦点或
可访问性变更还需运行：

```bash
npm run test:visual
```

视觉测试默认 mock 本地 API；失败产物不得包含真实 Token、API Key、用户媒体或数据库。

## Rust / Tauri 验证

从 `frontend/src-tauri/` 执行：

```bash
cargo test --locked
cargo check --locked

# 需要 cargo-deny；CI 使用固定版本执行同一门禁
cd ../..
cargo deny --manifest-path frontend/src-tauri/Cargo.toml --locked check advisories
```

这些命令不等同于完整 Tauri 打包。若缺少 WebKitGTK 等平台依赖，应准确报告跳过的构建，
并继续完成仍有意义的前端和 Rust 检查。`deny.toml` 中的公告例外必须同时有
[风险记录](../reference/security-advisories.md)、复核期限和跟踪项；不得为了通过门禁加入
无期限忽略。

## 按改动选择检查

| 改动 | 最低验证 |
| --- | --- |
| Backend | 聚焦 pytest，再运行完整 backend coverage |
| Frontend 逻辑 | 聚焦 Vitest、`npm test`、typecheck、build |
| Frontend 样式 | typecheck、build；显著布局再跑 Playwright |
| API 契约 | Backend tests + Frontend Vitest、typecheck、build |
| 数据库、任务、安全、路径、Token | 聚焦回归测试 + 完整 backend coverage |
| Rust / Tauri | 聚焦 Rust tests + `cargo check --locked` |
| 发布 / sidecar | 在目标 OS 构建 sidecar 和 Tauri bundle |

提交前运行 `git diff --check`。不要提交 `frontend/dist/`、`frontend/node_modules/`、
`frontend/src-tauri/binaries/`、`frontend/src-tauri/target/` 或 PyInstaller `build/`、`dist/`。
