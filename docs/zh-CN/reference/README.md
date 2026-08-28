# 参考与稳定契约

[返回中文文档首页](../README.md)

本分区记录公开兼容边界和需要持续复核的安全决定：

- [v1 稳定性与兼容性契约](compatibility.md)：支持平台、schema、归档格式、Provider、MCP、
  弃用与回滚策略。
- [Rust 安全公告例外](security-advisories.md)：有期限的依赖风险决定、补偿控制和退出条件。

schema v6、归档格式 v1 以及文档化的 Provider/MCP 契约是 Audux v1.0 的公共边界。修改这些
内容时必须同时更新实现、测试、兼容性计划和相关语言版本。
