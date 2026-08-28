# Rust 安全公告例外

[参考与稳定契约](README.md) · [中文文档首页](../README.md) · [English](../../en/reference/security-advisories.md) · 简体中文

依赖安全公告默认必须修复或阻断发布。只有没有兼容上游修复、受影响代码路径不可达，并且有
补偿验证、公开跟踪项和明确到期时间时，才可加入临时例外。`cargo-deny` 会让未列入本页的
vulnerability、unsound 和直接依赖 unmaintained 公告失败；间接依赖的维护状态由上游跟踪项
管理。例外不再出现在依赖图中时也必须删除，不能把 allowlist 当作永久基线。

## RUSTSEC-2024-0429 / GHSA-wrw7-89jp-8q8g

| 字段 | 决定 |
| --- | --- |
| 状态 | 临时接受（`tolerable_risk`） |
| 影响范围 | Linux Tauri 桌面包；Windows、macOS 和 Python sidecar 不编译该依赖链 |
| 锁定版本 | `tauri 2.11.5 -> gtk 0.18.2 -> glib 0.18.5` |
| 公告类型 | `glib::VariantStrIter` 迭代器中的 Rust 未定义行为，优化构建调用时可能空指针崩溃 |
| 复核期限 | `2026-10-31` 或下一次 v1.x 发布，以先到者为准 |
| 跟踪项 | [#26](https://github.com/luke-tangh/audux/issues/26) |

### 可达性判断

- Audux 的 `Cargo.toml` 没有直接依赖 `glib`、`gio` 或 `gtk`，应用 Rust 源码没有使用
  `VariantStrIter` 或 `Variant::array_iter_str()`。
- 对 `Cargo.lock` 当前解析出的 Rust 依赖源码搜索 `array_iter_str()`，生产依赖没有调用；
  命中仅来自 `glib` 自身的 API 定义、文档和测试。`VariantStrIter` 不能由外部代码直接构造，
  公告中的实现只有调用该 API 并迭代时才会执行。
- `tauri`、`tauri-runtime-wry`、`wry`、`tao`、`webkit2gtk` 和 `gtk` 当前均约束 GTK 3 / glib
  `0.18`。把单个 crate 强制提升到公告修复版本 `glib >= 0.20.0` 不满足这些约束，也不构成
  可验证的兼容升级。

判断证据对应提交 `56cabcc3dd3d47d4271df698e6501b28302daa02`；依赖变化时必须重新执行
源码搜索和 Linux release 验证，不能沿用该结论。上游修复与迁移状态见：

- [RustSec RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html)
- [gtk-rs 修复](https://github.com/gtk-rs/gtk-rs-core/pull/1343)
- [Tauri GTK4 / WebKitGTK 6 迁移](https://github.com/tauri-apps/tauri/pull/14684)
- [Wry WebKitGTK 6 迁移](https://github.com/tauri-apps/wry/pull/1530)

### 补偿控制与发布要求

- `deny.toml` 只忽略这一条公告，并将其他 vulnerability、unsound 和直接依赖 unmaintained
  公告作为 CI 失败；`unused-ignored-advisory = "deny"` 确保上游依赖不再命中后必须删除例外。
- CI 在期限之后主动失败，维护者必须重新评估，而不是静默延长例外。
- 推送稳定 tag 前，Linux release 包必须完成启动、窗口与原生对话框、休眠恢复、正常退出、
  端口冲突和长期运行验收；异常崩溃会撤销本例外。
- GitHub Dependabot 告警只能在本记录进入 `main` 后以 `tolerable_risk` 关闭，并在说明中链接
  本页与跟踪项。不得标记为 `inaccurate` 或声称整个 `glib` 依赖未使用。

### 退出条件

优先采用包含 GTK4 / WebKitGTK 6 的稳定 Tauri 版本，并重新运行三平台 Rust、signed build、
Linux clean-install、生命周期与长期运行检查。升级通过后删除本节对应的 `deny.toml` 例外，
确认依赖审计无忽略项并关闭 [#26](https://github.com/luke-tangh/audux/issues/26)。

若期限到达时仍没有稳定上游路径，必须重新评估实际依赖源码和运行证据。只有继续接受风险或
维护基于上游修复的审计 backport 两种明确决定；不得直接把 `glib 0.20` 塞入 GTK 3 依赖图。
