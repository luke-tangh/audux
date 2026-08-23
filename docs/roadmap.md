# Audux 功能路线图

> 更新于 2026-08-23。当前内部候选为 `0.9.0-beta.1`（schema v6）。v0.x 版本号只表示
> 内部 Beta 规划顺序，不是公开发布日期承诺；
> 每个阶段只有达到退出条件后才进入下一阶段。

## 当前判断

项目在 v1.0 前始终保留为内部 Beta，不创建公开 GitHub Release。`v0.5.0-beta.1` 等
版本字符串只用于内部候选和构建产物识别；GitHub Actions 手动构建产物用于三平台
验证，不对外发布。首次公开 Release 统一为 v1.0。

v0.5 的核心工作流基线、v0.6 的可信内容基础，以及 v0.7 的统一 Segment 检索、范围受限
只读 Agent 和可播放引用已经完成。后续不再把“章节”“语义检索”
“问答”和“AI 整理”建设成互相独立的功能岛，而是围绕一个领域受限的本地 Agent，
形成可检查、可暂停、可回退的音频知识整理闭环。

这里的 Agent 不是可以任意联网、执行 Shell 或修改文件的通用自动化代理，而是：

> 在用户明确限定的资料库范围内，调用受控工具完成检索、转写编排、质量验证、
> 内容建议和勘误协作，并为每个结论和修改保留来源、证据与审批记录。

## 产品主线

未来版本围绕两条相互连接的 Agent 流程推进。

### 检索与回答流

```text
用户问题 / 当前音频 / Playlist / 保存视图 / 显式选择集
  -> 后端强制解析检索范围
  -> metadata + FTS + 可选 embedding 召回
  -> 返回带 audio / Transcript revision / segment / 时间戳的证据
  -> Agent 组织答案
  -> 后端验证引用仍存在且属于当前范围
  -> 前端展示答案、证据和跳转播放入口
```

检索结果是 Agent 回答的证据，不是一次性塞入 Prompt 的无结构全文。证据不足、来源
互相冲突或 Transcript 尚未通过最低质量门槛时，Agent 必须明确停止推断或建议先完成
转写与勘误。

### 转写与整理流

```text
用户选择音频与处理范围
  -> 转写预检和隐私说明
  -> ASR 生成原始 Transcript
  -> 确定性结构验证
  -> 可选疑点片段复核
  -> 形成 Transcript issue 与勘误建议
  -> 用户逐项确认 / 编辑 / 拒绝
  -> 形成新的已接受 Transcript revision
  -> Agent 基于已接受 revision 生成 Tag / 描述 / 章节建议
  -> 用户确认写入
  -> 重建 FTS / embedding / 章节等衍生数据
  -> 再次验证并关闭或保留待处理 issue
```

“同一模型再问一遍”不算独立验证。验证至少区分以下层次：

1. 确定性验证：时间戳单调、越界、重叠、异常空段、全文与分段一致性、编码和版本绑定。
2. 来源质量：保留 Provider、模型、语言、可用置信度、术语表和任务配置快照。
3. 可选交叉复核：只对疑点片段执行第二次解码、不同配置比较或用户试听，不默认重跑
   整条音频。
4. 人工确认：所有勘误和正式 Tag 写入都能查看原文、建议、理由与音频时间点。
5. 输出验证：描述、Tag、章节和回答必须引用产生它们的 Transcript revision 与证据片段。

## 不可破坏的原则

1. 数据可恢复性高于 Agent 能力；任何正式写入必须先定义预检、事务、失败恢复、版本
   冲突和删除语义。
2. 本地能力是默认路径；远程 Provider 必须显式启用，每次运行都说明将发送的音频范围、
   Transcript 字符量和数据类型。
3. Agent 的范围由后端强制执行，不由 Prompt 约束。模型不能自行扩大到其他目录、
   Playlist、保存视图或未选择音频。
4. Transcript、metadata、文件名和模型输出都是不可信内容，不能改变系统策略、工具权限
   或审批要求。
5. 原始 ASR、用户已接受内容、Agent 建议和可重建索引必须分层保存；建议不能静默成为
   可信内容。
6. AI 产出默认可检查、可拒绝、可编辑、可重新生成；拒绝某项建议不能阻塞其他建议。
7. Agent 工具只能调用现有 service 边界，不直接执行 SQL，不接受任意本地路径，不访问
   API Key、日志或本地 API token。
8. 核心播放、手工编辑、关键词搜索和导出在没有 LLM、embedding 或网络时仍可使用。
9. 每个里程碑同时交付数据模型、API、前端、当前 schema、回归测试和用户文档，不积累
   跨层欠账。
10. 不保存或展示模型的隐藏推理过程；只记录用户输入、可见回答、工具调用、工具结果、
    引用、审批和错误等可审计事实。

## 可信内容与衍生数据模型

后续 schema 应围绕以下语义设计，具体表名在实现 ADR 中确定。

| 数据层 | 示例 | 信任语义 | 修改方式 |
| --- | --- | --- | --- |
| 原始来源 | 音频文件、扫描 metadata、原始 ASR 输出 | 不可变来源，内容准确性仍需验证 | 重新扫描或重新转写产生新版本 |
| 已接受内容 | 当前 Transcript revision、用户 metadata、正式 Tag | 当前可信内容 | 用户编辑或明确批准 Agent 提案 |
| Agent 提案 | 勘误、Tag、描述、章节、批量整理计划 | 不可信建议 | 可接受、编辑、拒绝或重新生成 |
| 质量记录 | Transcript issue、验证结果、置信度、复核结果 | 辅助证据，不等于内容真值 | 验证器或用户操作追加 |
| 可重建衍生数据 | FTS、embedding、检索 chunk、缓存摘要 | 非可信来源 | 来源 revision 变化后失效并重建 |
| Agent 运行记录 | session、run、step、tool call、citation、approval | 可审计事实 | 追加、取消、导出或按会话删除 |

Transcript 必须获得稳定 revision 标识。所有 Segment、章节、检索 Chunk、引用、勘误和
AI 建议都绑定到明确 revision；重新转写或接受勘误后，旧引用保留历史可读性，但不能
继续被当作当前答案证据。

## Agent 工具权限模型

| 权限等级 | 行为 | 默认策略 |
| --- | --- | --- |
| `read` | 搜索、读取详情、读取 Transcript 片段、统计 | 在当前后端范围内自动执行 |
| `propose` | 生成勘误、Tag、描述、章节或整理计划 | 自动生成，只写入建议区 |
| `execute` | 接受 Tag、更新 metadata、加入 Playlist、提交勘误 | 展示精确 diff 后逐次审批 |
| `restricted` | 删除文件、恢复数据库、修改目录或 Provider、任意路径/网络/Shell | v1.0 前不向 Agent 暴露 |

审批必须绑定 `run + step + 工具名 + 参数摘要`。审批后参数变化、来源 revision 变化或
作用范围变化时，旧审批自动失效。

## 推荐技术实施方案

核心选择是“确定性工作流 + 薄 Agent 层”，不把整个整理过程交给模型自由规划。

| 层次 | 推荐实现 |
| --- | --- |
| Agent runtime | 在 FastAPI backend 内实现小型持久化状态机；检索问答允许模型在只读工具中选择，整理 Run 按固定阶段执行 |
| 状态与恢复 | 使用 SQLModel / SQLite 保存 run、step、tool call、proposal、approval 和 citation，复用现有任务的取消与 interrupted 语义 |
| 模型接入 | 扩展现有 OpenAI-compatible client，增加原生 tool calling、结构化输出和能力探测；不支持时退回普通生成 |
| 工具契约 | Pydantic 定义参数与结果，Tool Registry 调用 `services/`，scope 和权限由后端上下文注入 |
| 检索 | SQLite FTS5 是必选基线；embedding 与向量索引是可选、可重建组件，经过中文质量、体积和三平台 PyInstaller 验证后再选型 |
| 执行资源 | ASR、索引和 Agent 使用独立队列与并发上限；第一版使用数据库状态轮询，不先引入 Redis、Celery 或常驻外部编排服务 |
| 前端 | React 提供 Agent 面板、citation 播放入口、整理 Run 活动视图和勘误 diff 工作台；API 与 payload 仍集中在现有客户端和共享类型 |
| 外部接入 | 先由同一 Tool Registry 增加只读 MCP stdio adapter，不让 MCP Server 绕过 service、scope、审计或结果上限 |

v0.6–v0.8 默认不依赖 LangGraph、Pydantic AI、Temporal 等运行时。先用当前技术栈把状态、
幂等、审批、失效和恢复语义做实；若自建 runtime 难以满足复杂分支或跨重启暂停，再用固定
评测 Run 对候选框架做替换验证，而不是让框架的数据模型反向定义产品数据。

## 可参考的项目与边界

| 项目 | 可参考内容 | 不直接照搬的部分 |
| --- | --- | --- |
| [Khoj](https://github.com/khoj-ai/khoj) | 本地 / 自托管个人知识检索、Agent 与多模型接入 | 联网研究、自治任务和通用文档范围超出本产品边界 |
| [AnythingLLM](https://github.com/Mintplex-Labs/anything-llm) | 本地桌面 Agent、workspace RAG、Provider 与 MCP 产品形态 | 宽工具面、多用户与任意文档摄取；其 [历史安全问题](https://github.com/Mintplex-Labs/anything-llm/security/advisories/GHSA-24qj-pw4h-3jmm) 也说明本地 API 和工具必须默认收紧 |
| [Audiobookshelf](https://github.com/advplyr/audiobookshelf) | 音频资料库扫描、章节编辑、播放进度与 metadata 备份体验 | 服务端、多用户和修改文件内嵌 metadata 不符合当前 local-first 桌面边界 |
| [WhisperX](https://github.com/m-bain/whisperX) | 词级对齐、VAD 和说话人分离，可用于疑点片段复核原型 | GPU / 模型体积、语言覆盖和对齐误差使其不适合作为默认必装验证器 |
| [LangGraph interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts) | checkpoint、暂停审批和恢复的状态机模式 | 不在只读 Agent 尚未验证前引入完整图运行时 |
| [Pydantic AI tools](https://pydantic.dev/docs/ai/tools-toolsets/tools/) | 类型化工具、动态 toolset 和审批模式 | 不让框架 Agent 直接拥有数据库或文件系统能力 |
| [MCP tools specification](https://modelcontextprotocol.io/specification/2025-06-18/server/tools) | 工具发现、结构化调用和结果协议 | MCP 是传输适配层，不是权限边界或内部业务实现 |

## 阶段总览

| 阶段 | 核心结果 | 状态 | 退出条件 |
| --- | --- | --- | --- |
| v0.5 | 核心工作流内部基线 | 已完成 | 三平台构建、首次启动和进程生命周期基线可重复验证 |
| v0.6 | Agent-ready 的可信内容基础 | 已完成 | Transcript revision、证据锚点、质量 issue 和 Provider/工具边界稳定 |
| v0.7 | 有据检索与只读 Agent | 已完成 | 限定范围问答可引用跳转，无范围泄漏，离线可退回 FTS |
| v0.8 | 转写、验证、Tag 与勘误闭环 | 已完成 | Agent run 可暂停审批、部分接受、恢复和一致地重建衍生数据 |
| v0.9 | 安全操作 Agent、MCP 与发布硬化 | 实现完成，验收待执行 | 受控写工具、外部只读接入、归档和三平台长期运行通过 |
| v1.0 | 稳定的 Agent-native 本地音频知识库 | 稳定版门槛 | 兼容、迁移、隐私、质量评测和回滚形成公开承诺 |

## v0.5：核心工作流内部 Beta 基线（已完成）

- F1：显式多选与批量整理。
- F2：Transcript 保真修订、搜索上下文和编辑冲突保护。
- F3：播放队列与会话连续性。
- F4：严格 schema、本地 API、browser-lite、可选 Whisper companion 和三平台构建基线。

持续验证要求：

- Linux、Windows、macOS 安装包和 browser-lite 完成 clean-install smoke test。
- 非当前 schema 在不修改原数据库的前提下被拒绝。
- 默认端口被占用、最后窗口关闭、任务取消时的后端 / companion 生命周期正确。
- v0.x 验证只保留 artifacts，不创建公开 Release。

## v0.6：Agent-ready 的可信内容基础（已完成）

### 已完成的恢复与组织能力

- R1：受管数据库快照、验证、恢复预检、安全快照、重启切换和失败回滚。
- R2：版本化保存视图，统一资料库筛选、分页和排序语义。
- R3：复用保存视图规则的智能 Playlist，不持久化易过期成员副本。
- R4：资料库健康检查、疑似重复确认和不删除文件的安全重新关联。

这些能力继续作为 Agent 的范围、预检、事务和恢复基础，不重新实现平行版本。

### A0.1：Transcript revision 与来源追踪

- 保存原始 ASR 结果和当前已接受 Transcript 的版本关系；重新转写产生新 revision，
  不在原记录上原地覆盖。
- revision 记录 Provider、模型、语言、任务配置摘要、术语表版本、生成时间和可用质量
  指标；API Key 不进入任务或 revision payload。
- 逐段手工编辑和 Agent 勘误使用同一版本冲突规则；提交后从 segments 重建全文。
- 定义旧 revision、当前 revision、删除 Transcript 和重新转写时的引用与衍生数据失效
  语义。

### A0.2：证据锚点、章节与质量 issue

- Segment 是最小可播放证据锚点，包含稳定 ID、时间范围、文本和 revision 归属。
- 章节绑定 revision，可手工创建、重命名、调整边界、合并和删除；自动章节先作为建议。
- 引入结构化 Transcript issue，至少覆盖时间戳越界/倒序、异常重叠、异常空段、全文
  不一致、疑似语言异常和需人工复核片段。
- issue 有类型、严重度、证据、状态和关闭原因；重新转写或接受勘误后可以重新验证，
  但不静默删除历史记录。

### A0.3：Provider 与 Agent 工具契约

- 定义最小 `ASRProvider`、`LLMProvider`、`EmbeddingProvider` 能力边界，不让业务服务依赖
  某个供应商响应结构。
- LLM 连接测试增加结构化输出、原生 tool calling、流式 tool calling 等能力探测；
  不支持工具调用的模型明确降级为普通生成。
- 建立内部 Tool Registry；工具参数和输出使用 Pydantic schema，内置 Agent 与未来 MCP
  复用同一业务实现。
- 工具上下文由后端注入 scope、session 和权限，模型参数中不允许出现可扩大范围的根路径。

### A0.4：评测与测试基线

- 建立不含用户隐私的中英混合音频/Transcript 固定样本。
- 覆盖专有名词、数字、同音词、长静音、重叠/断裂时间戳、无 Transcript、冲突 revision
  和 Prompt Injection 文本。
- 保存纯 FTS 检索基线、ASR issue 期望、勘误 diff 期望和 Tag 期望；后续 Agent 版本必须
  与同一数据集对比。

### v0.6 退出条件

- 任意当前引用都能追溯到 audio、Transcript revision、Segment 和时间范围。
- 重新转写、接受勘误、删除 Transcript 后，没有旧 Chunk 或章节继续冒充当前数据。
- 确定性验证器对构造的非法时间轴和全文/分段不一致 fixture 全部给出稳定 issue code。
- Provider 不支持 tool calling 时不会进入 Agent 执行路径。
- 完成真实规模“创建快照—修改 revision—恢复—校验”的人工演练。

## v0.7：有据检索与只读 Agent（已完成）

### A1.1：统一的 Segment 检索服务

- 建立 Segment 级 FTS 索引，保留标题、作者、描述、Tag 和 Transcript 的字段来源。
- 搜索结果统一返回 scope、audio、revision、Segment、时间戳、命中字段、上下文和分数。
- 资料库搜索、Agent、保存视图、Playlist 和未来 MCP 共用同一范围解析器与检索服务。
- embedding 尚未安装、索引未完成或损坏时自动退回 FTS，并显示当前检索模式。

### A1.2：可选混合检索

- 先建立纯 FTS 质量基线，再决定本地 embedding 的模型、安装体积和存储方案。
- 混合精确关键词、metadata 过滤、向量相似度和可解释的融合排序；精确标题与 Tag 命中
  不能被语义结果淹没。
- Chunk 以 Segment/时间范围为边界，记录模型、维度、分块策略和来源 revision。
- embedding 是可重建衍生数据，支持增量更新、取消、断点恢复和全量重建。

### A1.3：受限只读 Agent

- 新增本地会话、消息、run、step、tool call 和 citation 数据模型；与绑定单个 audio 的
  现有 AI/ASR task 分离。
- 第一批工具只包含范围搜索、音频详情、Transcript 片段、Tag/Playlist 清单和统计。
- 每次 run 设置最大步骤、最大候选数、最大 Transcript 字符、超时和 Token 预算。
- Agent 与 ASR 使用独立执行队列，长音频转写不能堵塞问答，问答也不能饿死转写任务。
- 第一版可以轮询持久化 run；流式事件在取消、断线恢复和错误语义稳定后再启用。

### A1.4：引用与回答 UI

- Agent 面板允许按当前音频、显式选择集、Playlist、保存视图、Tag、媒体库目录限定范围。
- 事实性回答必须携带后端可验证 citation；点击引用跳转到音频时间点并展示上下文。
- UI 区分来源原文、Agent 概括、不确定性和工具错误。
- 会话可重命名、删除和导出；删除会话清理运行记录，但不删除音频、Transcript 或 Tag。

### v0.7 退出条件

- 固定查询集记录 Recall@k、首个结果延迟、引用覆盖率和无证据回答率，并优于或不劣于
  对应纯 FTS 精确查询基线。
- 所有展示引用在响应时通过 revision、Segment、scope 和时间范围校验。
- 范围泄漏回归集为 0；Prompt 中要求“忽略范围”不能读取范围外数据。
- 1 万条音频规模下首屏检索、Agent 取消和普通播放保持可交互，并记录 CPU、内存和磁盘
  上限。
- 无 LLM、无 embedding 或 Provider 失败时，现有关键词搜索和 Transcript 浏览不受影响。

暂不包含：Agent 写操作、互联网访问、开放式无引用聊天和多 Agent 协作。

## v0.8：转写、验证、Tag 与勘误闭环（已完成）

### A2.1：可恢复的整理 Run

- 用户从当前音频、显式选择集、保存视图或 Playlist 创建整理 run；创建时冻结可审计的
  目标 ID 清单，不把后续动态新增成员静默纳入本次写操作。
- Run 按 `preflight -> transcribe -> validate -> review -> enrich -> apply -> reindex -> verify`
  持久化步骤推进，允许部分音频失败、取消和重试。
- 应用重启后，已完成的确定性步骤不重复执行；进行中的外部模型调用标记 interrupted，
  由用户决定重试。
- 活动中心展示每个阶段、处理数量、失败数量、待审批数量和下一步，不只显示笼统百分比。

### A2.2：转写验证与疑点复核

- ASR 完成后总是运行确定性验证；严重结构问题阻止进入正式 enrichment，但不删除原始结果。
- 使用 Provider 提供的可用置信度、词级信息、语言和音频时长辅助定位疑点；缺失指标时
  明确标记 unknown，不伪造统一置信度。
- 可选只对疑点时间窗进行第二次解码或不同配置比较，结果作为候选证据，不自动替换原文。
- 验证失败可导出诊断摘要；摘要不包含 API Key、本地 Token、绝对路径或无界完整 Transcript。

### A2.3：Agent 勘误工作台

- 勘误建议绑定 revision 和 Segment，展示原文、新文本、字符级/词级 diff、理由、证据、
  影响的全文与音频时间点。
- 用户可以接受、编辑后接受、拒绝、跳过或播放复核；单项决定不阻塞其他 Segment。
- 接受勘误创建新的已接受 revision，并使用 expected revision 防止覆盖并发手工修改。
- 专有名词、缩写和固定写法可另行建议加入本地术语表；更新术语表需要单独确认，不自动
  修改历史 Transcript。
- 批量应用只允许同一明确 diff 和显式目标清单；模糊“修正全部相似错误”必须先展开为
  可检查的逐项提案。

### A2.4：有证据的 Tag、描述与章节输出

- Agent 只基于当前已接受 revision 生成建议；存在严重未关闭 issue 时显示质量警告。
- 每个 Tag 建议包含规范化名称、与已有 Tag 的匹配/合并建议、支持 Segment、理由、置信
  状态和来源 run。
- 优先复用已有 Tag，避免大小写、单复数、同义词和宽泛标签制造重复；创建或合并正式
  Tag 仍需用户确认。
- 描述中的事实性句子和自动章节都绑定支持 Segment；无证据内容只能标为主观摘要或不生成。
- 用户可以分别接受 Tag、描述和章节，不能用“全部接受”绕过逐类影响预览。

### A2.5：回写、失效与再验证

- 接受勘误后在一次事务中更新当前 revision 指针、全文与 FTS；失败不产生半个 revision。
- 来源 revision 变化后，旧 embedding Chunk、章节建议、Tag/描述建议和回答引用按规则
  标记 stale；历史仍可审计，但不能再次直接接受。
- 正式 Tag/描述写入继续复用现有 service 和用户字段优先级，不修改原始音频内嵌 metadata。
- 重建完成后再次运行确定性验证，并向用户报告关闭、仍存在和新出现的 issue。

### v0.8 退出条件

- 每个正式勘误和 Agent 发起的写入都有用户审批、精确 diff、来源 revision 和审计记录。
- 崩溃、取消、Provider 超时、单项失败和版本冲突不会留下半写入 revision、Tag 或索引。
- 固定勘误集记录建议精确率、漏检率和用户拒绝原因；同一输入与同一版本重复运行不产生
  无界重复建议。
- Tag 基准集记录复用率、重复 Tag 率、证据覆盖率和低价值标签率，并为进入 v0.9 定义
  明确门槛。
- 接受勘误后，搜索、引用、章节、Tag 建议和导出都只使用新的当前 revision。
- 远程 Provider 每个 run 显示发送范围和字符量，取消后不再启动新的远程步骤。

## v0.9：安全操作 Agent、MCP 与发布硬化（实现完成；三平台长期运行待验收）

### A3.1：受控资料库操作

- 在只读和 propose 能力稳定后，开放更新应用内 metadata、接受 Tag、加入手动 Playlist、
  创建保存视图和排队转写等低风险工具。
- Agent 先生成包含目标、变更前值、变更后值和失败策略的计划，再等待用户审批。
- 批量操作使用冻结目标清单、逐项结果和明确事务边界；不能把“当前全部结果”作为隐藏范围。
- 删除音频/文件、恢复数据库、移除目录、修改 Provider、任意文件路径、任意网络和 Shell
  在 v1.0 前保持 restricted。

### A3.2：外部 Agent 接入

- 基于内部 Tool Registry 提供独立的只读 MCP Server，首选 stdio；应用内 Agent 与 MCP
  不复制业务查询逻辑。
- MCP 初版提供 list/search/get audio/get Transcript/get Playlist/get statistics，返回稳定
  structured output 和 citation 标识。
- MCP 不返回 API Key、本地 Token、日志、绝对路径或未授权范围；所有输入校验、结果上限、
  超时和审计策略与内置 Agent 一致。
- 写工具只有在桌面应用能展示同一审批内容并完成一次性确认后才进入候选，不作为 v0.9
  退出条件。

### A3.3：归档、诊断与可移植性

- 定义带版本 manifest 的归档，覆盖 metadata、正式 Tag、Playlist、Transcript revisions、
  chapters、保存视图、质量 issue 和必要 Agent 审计；凭据和本地 API token 永不导出。
- 会话导出只包含可见消息、引用、工具调用和审批结果，不包含隐藏推理或敏感工具输出。
- 导入先 dry-run，报告 schema、缺失音频、revision/ID 冲突和合并策略，再事务化执行。
- 诊断包只收集脱敏配置、版本、任务/Agent 状态摘要和完整性结果，不包含完整 Transcript、
  API Key、Token 或用户绝对路径。

### A3.4：发布硬化

- 分离 ASR、索引和 Agent 执行资源，定义并发、优先级、内存上限、暂停和退出语义。
- 对 Tauri、browser-lite 和 MCP 执行长期运行、休眠恢复、端口冲突、Provider 断连和大
  资料库测试。
- 在 Linux、Windows、macOS 目标系统验证 PyInstaller sidecar、可选模型组件和 MCP
  入口；不把调试 placeholder 打入发布包。
- 对工具 schema、权限矩阵、Prompt Injection、范围泄漏、审批重放、日志脱敏和路径边界
  完成独立安全复核。

### v0.9 退出条件

- 低风险 execute 工具没有绕过审批、扩大范围或部分写入的已知路径。
- MCP 只读工具与应用内同范围查询返回一致结果，并通过真实 stdio seam 的 smoke test。
- 当前格式归档可以 dry-run、导出和全量导入；导出物与诊断包不含凭据和禁止字段。
- 三平台完成至少一轮真实规模的持续运行、任务取消、Agent 恢复和应用退出验证。

## v1.0：稳定的 Agent-native 本地音频知识库

v1.0 是质量和兼容门槛，不再堆叠新的大型 Agent 能力。发布前必须满足：

- 明确支持的操作系统、数据库、归档、Provider 与 MCP 协议版本，以及 v1.0 后的迁移和
  弃用策略。
- 完整备份、恢复、导入、导出、Transcript revision 和 Agent 审计删除流程均有文档与
  回归测试。
- 检索、引用、勘误和 Tag 评测达到 v0.8/v0.9 定义的门槛，并公开已知模型差异和失败模式。
- Agent、ASR、embedding 和 LLM Provider 不可用时，核心播放、手工整理、关键词搜索和
  导出仍可正常使用。
- Provider 接口稳定；隐私提示、凭据存储、日志脱敏、数据删除、远程发送范围和审批语义
  经过安全复核。
- 建立稳定发布节奏、已知限制、回滚指引和三平台可重复构建证据。

## v1.0 前明确不做

- 可以访问互联网、Shell、任意本地文件或任意 HTTP endpoint 的通用 Agent。
- 多 Agent swarm、自动委派给不可见子 Agent 或无法审计的后台自治循环。
- 无审批批量修改 metadata、Tag、Playlist、Transcript 或文件系统。
- 自动修改、重命名、移动、覆盖或删除原始音频文件。
- 把模型自我反思当作事实验证，或生成没有 Transcript 证据的确定性回答。
- 云同步、多设备同步、多人共享会话、移动端和内置模型商店。

这些方向会改变本地单用户和可信资料库边界，必须在 v1.0 后通过独立提案评估。

## 候选增强项

- 说话人分离与说话人重命名，以及说话人作为检索和引用字段。
- 词级时间戳、手工时间轴修订和接受勘误后的自动重新对齐。
- 书签、片段和个人注释作为 Agent 可检索但默认不可修改的知识层。
- 文件夹监视与自动创建整理 run，仍要求明确范围和资源策略。
- 片段级音频复核缓存、波形预览和片段导出。
- 更丰富的本地 Tag taxonomy、同义词和用户可维护术语表。
- Agent 生成可导出的学习提纲、节目笔记和跨音频主题报告。

## 当前优先事项

1. 在 Linux、Windows 和 macOS 目标系统完成 v0.9 Tauri、browser-lite、MCP 与 Whisper
   companion 的 clean-install、长期运行、休眠恢复、端口冲突和正常退出验收。
2. 对归档 dry-run / 导入、数据库快照回滚、诊断包脱敏和受控 Agent 审批执行独立安全复核，
   固化可重复的验收记录。
3. 定义 v1.0 后的 schema 迁移与兼容策略、支持平台和 Provider / MCP 协议承诺；在这些公开
   承诺确定前继续保持 v0.x 不自动迁移。
4. 持续运行固定检索、引用、勘误和 Tag 评测，记录质量与资源回归；候选增强项不应抢占
   v1.0 稳定性门槛。
