# Local Audio Library PRD

| 项目 | 内容 |
|---|---|
| 产品名称 | Local Audio Library |
| 产品类型 | 本地桌面音频播放器 / 音频知识库 |
| 文档版本 | v0.4 |
| 目标版本 | MVP+ |
| 当前实现阶段 | P0 + P1 + P2 |
| 运行形态 | Tauri 桌面应用 + 本地 FastAPI 后端 |
| 核心原则 | 本地优先、隐私优先、离线可用、AI 可控、数据可迁移 |

---

# 1. 文档信息

## 1.1 版本修订记录

| 版本 | 说明 |
|---|---|
| v0.1 | 初始 MVP PRD，定义本地音频知识库播放器核心范围 |
| v0.2 | 增加批量转写、批量 AI 分析、任务队列增强、封面管理 |
| v0.3 | 增加导出能力、文件重新定位、扫描任务、日志与维护能力 |
| v0.4 | 增强隐私与稳定性；补齐 playlist 排序 / 移除；优化搜索命中、标签管理、播放队列与 UI 体验 |

---

# 2. 产品概述

## 2.1 产品定位

Local Audio Library 是一个 **纯本地运行的桌面音频播放器与个人音频知识库管理工具**。

它不仅提供基础播放器能力，还帮助用户将散落在文件夹中的本地音频整理成一个：

- 可播放
- 可编辑 metadata
- 可打标签
- 可建 playlist
- 可全文搜索
- 可本地转写
- 可本地 AI 辅助生成描述和标签
- 可导出和备份

的个人音频资料库。

---

## 2.2 产品目标

MVP+ 阶段目标：

1. 支持添加一个或多个本地音频目录。
2. 扫描并导入本地音频文件。
3. 读取并展示音频 metadata 和内嵌封面。
4. 支持本地音频播放、倍速、音量、进度条、播放位置记忆。
5. 支持用户编辑应用内 metadata，不修改原始音频文件。
6. 支持标签系统，包括添加、删除、筛选、重命名、清理未使用标签。
7. 支持 playlist 创建、添加音频、移除音频、排序、拖拽排序、连续播放和导出。
8. 支持 SQLite FTS5 + LIKE fallback 的全文搜索。
9. 支持搜索命中高亮和 transcript 命中片段展示。
10. 支持本地 faster-whisper 转写，保存 full transcript 和 segments。
11. 支持 transcript 查看、片段跳转播放、TXT/JSON/SRT 导出。
12. 支持 OpenAI-compatible 本地 LLM，根据 metadata 和 transcript 生成 description 和 tags。
13. AI 结果默认作为建议，不直接覆盖用户手动数据。
14. 支持 AI / ASR 任务队列、失败重试、取消、状态刷新和通知。
15. 支持日志查看、日志下载、metadata 导出、搜索索引重建。
16. 默认只绑定本机端口并收紧 CORS，保护本地数据安全。
17. 在无互联网环境下，核心播放器、管理、搜索能力可正常使用。

---

## 2.3 非目标

MVP+ 阶段暂不包含：

- 用户账户系统
- 云同步
- 多设备同步
- 在线音乐 / 播客订阅
- 默认在线模型调用
- 社交分享
- 移动端 App
- 自动说话人分离
- 自动章节切分
- 语义向量搜索
- 基于 transcript 的本地问答
- 自动写回音频文件内嵌 metadata
- 插件系统
- 完整备份 / 迁移向导
- playlist 删除 / 重命名高级管理
- transcript 富文本编辑器

---

# 3. 用户与使用场景

## 3.1 目标用户

### 1. 播客 / 访谈收藏者

拥有大量本地播客、访谈、讲座音频，希望通过标签、playlist 和搜索快速定位内容。

### 2. 学习型用户

收藏课程录音、语言材料、有声书，希望记录播放进度、转写内容并建立知识库。

### 3. 内容创作者

需要管理采访、录音素材，对音频进行转写、摘要和归类。

### 4. 隐私敏感用户

希望音频、metadata、transcript 均保留在本地，不上传到互联网或第三方服务。

---

## 3.2 典型使用场景

### 场景 1：导入本地音频库

用户选择一个本地音频目录，系统扫描该目录下的 `.mp3`、`.m4a`、`.flac`、`.wav`、`.ogg` 文件，并建立本地数据库索引。

---

### 场景 2：整理音频信息

用户点击音频，在详情面板查看：

- 原始 metadata
- 用户自定义 metadata
- AI 建议描述
- 标签
- transcript
- 文件信息
- 播放信息

用户可以编辑标题、作者、专辑、描述、语言、收藏状态。

---

### 场景 3：标签归类

用户可以：

- 输入新标签
- 从已有标签下拉选择
- 接受 AI 推荐标签
- 移除音频标签
- 重命名标签
- 清理未使用标签

---

### 场景 4：创建学习 playlist

用户创建一个名为“英语听力训练”的 playlist，将多个音频加入，拖拽排序，然后按 playlist 顺序连续播放。

---

### 场景 5：转写会议录音

用户点击“转写”，系统创建 ASR 任务，后台调用本地 faster-whisper，完成后保存全文和分段 transcript。

用户可点击 transcript segment 时间戳直接跳转播放。

---

### 场景 6：AI 生成描述和标签

用户配置本地 LLM endpoint 后，点击“AI 分析”。系统将音频 metadata 和 transcript 发送到用户配置的 endpoint，要求模型返回 JSON。

AI 输出保存为建议。用户可接受 description 或 tags。

---

### 场景 7：搜索音频内容

用户搜索“线性代数”，系统在以下字段中检索：

- title
- author
- description
- tags
- transcript

搜索结果展示命中字段，高亮关键词。如果命中 transcript segment，可点击时间跳转播放。

---

# 4. 产品原则

## 4.1 本地优先

所有核心数据均保存在用户本地：

- 音频文件路径
- metadata
- 标签
- playlist
- transcript
- AI 任务结果
- 封面缓存
- 日志
- 设置

默认数据目录：

```text
~/.local_audio_library/
├── database.sqlite
├── covers/
├── logs/
└── exports/
```

---

## 4.2 隐私优先

应用不得默认上传用户音频、transcript 或 metadata。

默认后端监听：

```text
127.0.0.1:8765
```

默认 CORS 仅允许本机 / Tauri 本地来源。

允许开发环境通过环境变量放开：

```text
LOCAL_AUDIO_LIBRARY_ALLOW_ALL_CORS=1
```

---

## 4.3 AI 请求必须用户主动配置

应用不提供默认在线模型。

只有用户主动配置 LLM endpoint 后，才允许发起 AI 分析。

若 endpoint 不是：

- `localhost`
- `127.0.0.1`
- `::1`
- `.localhost`

系统必须提示隐私风险：

> AI 分析会把音频 metadata 和 transcript 发送到该地址，请确认这是你信任的本地或内网模型服务。

---

## 4.4 AI 结果不直接覆盖用户数据

AI 生成内容默认作为建议保存：

- `description_ai`
- AI task output 中的 tags 建议

用户可以：

- 接受
- 忽略
- 编辑后保存
- 重新生成

AI 不得直接覆盖：

- `description_user`
- 用户手动 tags

---

## 4.5 文件与数据库解耦

应用默认不修改原始音频文件。

用户自定义数据保存在 SQLite 中：

- 用户标题
- 用户作者
- 用户专辑
- 用户描述
- 标签
- transcript
- playlist
- 播放位置
- AI 分析结果

MVP+ 不写回音频文件内嵌 metadata。

---

## 4.6 可迁移性

用户可以通过导出能力备份：

- metadata JSON / CSV
- transcript TXT / JSON / SRT
- playlist JSON / M3U
- 日志文件

后续版本可增加完整备份 / 恢复向导。

---

# 5. 功能范围总览

| 模块 | 当前是否包含 | 状态 |
|---|---:|---|
| 本地音频库 | 是 | 已实现 |
| 多媒体库目录 | 是 | 已实现 |
| 启用 / 禁用目录 | 是 | 已实现 |
| 异步扫描任务 | 是 | 已实现 |
| 扫描进度 | 是 | 已实现 |
| 扫描取消 | 是 | 已实现 |
| missing 标记 | 是 | 已实现 |
| 文件重新定位 | 是 | 已实现 |
| 基础播放器 | 是 | 已实现 |
| 播放队列 | 是 | 已实现 |
| 紧凑底部播放器 | 是 | 已实现 |
| 队列弹出层 | 是 | 已实现 |
| 进度记忆 | 是 | 已实现 |
| 接近结尾从头播放提示 | 是 | 已实现 |
| metadata 编辑 | 是 | 已实现 |
| 原始 metadata 展示 | 是 | 已实现 |
| 封面提取 / 上传 / 删除 | 是 | 已实现 |
| 标签管理 | 是 | 已实现 |
| 标签重命名 | 是 | 已实现 |
| orphan tags 清理 | 是 | 已实现 |
| playlist 创建 | 是 | 已实现 |
| playlist 添加 / 移除音频 | 是 | 已实现 |
| playlist 上移 / 下移 | 是 | 已实现 |
| playlist 拖拽排序 | 是 | 已实现 |
| playlist 播放 | 是 | 已实现 |
| playlist 导出 | 是 | 已实现 |
| 全文搜索 | 是 | 已实现 |
| 中文 / 部分匹配 fallback | 是 | 已实现 |
| 搜索高亮 | 是 | 已实现 |
| transcript 命中片段 | 是 | 已实现 |
| 本地 ASR 转写 | 是 | 已实现 |
| transcript 展示 | 是 | 已实现 |
| transcript 导出 | 是 | 已实现 |
| 本地 LLM 配置 | 是 | 已实现 |
| LLM 隐私警告 | 是 | 已实现 |
| AI description | 是 | 已实现 |
| AI tags 建议 | 是 | 已实现 |
| AI / ASR 任务队列 | 是 | 已实现 |
| 任务重试 / 取消 | 是 | 已实现 |
| toast 通知 | 是 | 已实现 |
| metadata 导出 | 是 | 已实现 |
| 日志查看 / 下载 | 是 | 已实现 |
| 语义搜索 | 否 | 后续 |
| 本地问答 | 否 | 后续 |
| 说话人分离 | 否 | 后续 |
| 自动章节切分 | 否 | 后续 |

---

# 6. 功能需求

---

# 6.1 本地音频库模块

## 6.1.1 添加媒体库目录

### 描述

用户可以添加一个本地文件夹作为媒体库目录。

### 功能要求

- 支持添加多个目录。
- 每个目录路径唯一。
- 添加时校验路径存在且为目录。
- 支持启用 / 禁用目录。
- 禁用目录后，该目录下音频不显示在默认列表中。
- 默认不删除禁用目录的数据库数据。

### 验收标准

- 用户可以添加合法目录。
- 重复添加同一路径时提示已存在。
- 禁用目录后，默认音频列表隐藏该目录音频。
- 重新启用后，音频重新出现。

---

## 6.1.2 扫描音频文件

### 描述

系统扫描媒体库目录，将支持格式的音频导入 SQLite 数据库。

### 支持格式

MVP+ 支持：

- `.mp3`
- `.m4a`
- `.flac`
- `.wav`
- `.ogg`

### 扫描读取字段

- 文件路径
- 文件名
- 扩展名
- 文件大小
- 文件修改时间
- 时长
- bitrate
- sample rate
- channels
- 内嵌 title
- 内嵌 artist / author
- 内嵌 album
- 内嵌 description / comment
- 内嵌 cover

### 功能要求

- 支持手动触发扫描。
- 扫描以后台任务执行，不阻塞 UI。
- 扫描任务展示：
  - total files
  - processed files
  - imported
  - updated
  - missing
  - status
  - error message
- 支持取消 pending / running 扫描任务。
- 首次扫描导入新音频。
- 再次扫描更新技术 metadata。
- 已存在音频不重复导入。
- 文件不存在时标记 `is_missing = true`。
- file hash 字段保留，MVP+ 可暂不计算或后续后台计算。

### 验收标准

- 扫描目录后音频列表出现对应条目。
- 已存在音频不会重复。
- 删除原文件后重新扫描，条目标记 missing。
- 扫描任务状态能刷新。
- 用户可以取消扫描任务。

---

## 6.1.3 文件重新定位

### 描述

当音频文件移动后，用户可以重新绑定新的本地文件路径。

### 功能要求

- 用户在详情页输入或选择新的音频文件路径。
- 系统校验文件存在且格式支持。
- 新路径不能已被其他音频条目占用。
- 更新文件路径、文件名、格式、大小、修改时间和技术 metadata。
- 若当前封面不是用户上传封面，可重新尝试提取内嵌封面。
- 更新搜索索引。
- 清除 missing 状态。

### 验收标准

- missing 音频重新定位后可以正常播放。
- 重新定位不影响用户自定义 metadata。
- 新路径被其他条目占用时提示冲突。

---

# 6.2 基础播放器模块

## 6.2.1 播放控制

### 描述

用户可以播放本地音频文件，并控制播放行为。

### 功能要求

- 播放
- 暂停
- 继续播放
- 停止并重置进度
- 上一首
- 下一首
- 拖动进度条跳转
- 显示当前时间
- 显示总时长
- 调整音量
- 播放结束后自动进入下一首

### 验收标准

- 双击音频或点击播放按钮可以播放。
- 进度条与实际播放同步。
- 拖动进度条后跳转到对应位置。
- 播放结束后按当前队列播放下一条。

---

## 6.2.2 倍速播放

### 描述

用户可以调整音频播放速度。

### 支持速度

- 0.75x
- 1.0x
- 1.25x
- 1.5x
- 2.0x

### 功能要求

- 切换倍速后当前音频立即生效。
- 最近使用倍速保存到本地浏览器存储。
- 重启应用后恢复上一次倍速。

### 验收标准

- 用户切换到 1.5x 后音频立即变速。
- 重启后仍为上次选择的倍速。

---

## 6.2.3 播放位置记忆

### 描述

系统记录每个音频的上次播放位置。

### 功能要求

- 播放过程中定期保存播放位置。
- 重新播放音频时从上次位置继续。
- 若上次位置接近结尾，提示是否从头播放。
- 播放完毕后重置该音频播放位置为 0。

### 验收标准

- 播放一段后切换音频，再回来可继续。
- 接近结尾的音频再次播放时提示从头播放。
- 播放结束后再次播放从头开始。

---

## 6.2.4 播放队列

### 描述

系统根据当前列表或 playlist 生成播放队列。

### 功能要求

- 从当前音频列表开始播放时，当前列表成为播放队列。
- 上一首 / 下一首基于播放队列。
- 队列通过底部播放器的“队列”按钮打开弹出层。
- 队列弹出层支持：
  - 查看所有队列音频
  - 点击队列项播放
  - 移除队列项
  - 清空队列
- 队列弹出层不应增加底部播放器高度。

### 验收标准

- 播放 playlist 中音频后，下一首按 playlist 顺序继续。
- 可从队列弹窗切换到任意队列项。
- 可以移除当前音频或清空队列。
- 底部播放器保持紧凑，不遮挡主界面。

---

# 6.3 Metadata 与封面模块

## 6.3.1 查看音频详情

### 描述

用户可以查看单个音频的完整信息。

### 展示字段

#### 基本信息

- 封面
- 显示标题
- 作者
- 专辑
- 语言
- favorite 状态

#### 原始 metadata

- 原始标题
- 原始作者
- 原始专辑
- 原始描述

#### 用户 metadata

- 用户标题
- 用户作者
- 用户专辑
- 用户描述

#### AI metadata

- AI 描述
- AI tags 建议

#### 文件信息

- 文件名
- 文件路径
- 文件格式
- 文件大小
- 文件修改时间
- 时长
- bitrate
- sample rate
- channels
- missing 状态

#### 播放信息

- 播放次数
- 上次播放时间
- 上次播放位置

#### 状态

- transcript_status
- ai_status

### 验收标准

- 点击音频后详情面板展示完整信息。
- 用户字段为空时使用原始 metadata 或文件名作为显示值。
- 原始 metadata 和用户 metadata 分开展示。

---

## 6.3.2 编辑 metadata

### 可编辑字段

- `title_user`
- `author_user`
- `album_user`
- `description_user`
- `language`
- `is_favorite`

### 显示优先级

标题：

1. `title_user`
2. `title_original`
3. `file_name`

作者：

1. `author_user`
2. `author_original`
3. 空字符串

描述：

1. `description_user`
2. `description_ai`
3. `description_original`
4. 空字符串

### 功能要求

- 用户编辑 metadata 不修改音频文件本体。
- 保存后刷新搜索索引。
- 重启应用后编辑结果仍存在。

### 验收标准

- 修改标题后列表和详情立即显示新标题。
- 原始 metadata 不被覆盖。
- 搜索新描述能够命中对应音频。

---

## 6.3.3 封面管理

### 描述

系统展示音频封面，并允许用户自定义封面。

### 功能要求

- 优先展示用户上传封面。
- 若无用户封面，则展示内嵌封面。
- 若均无，则展示默认封面。
- 支持上传：
  - `.jpg`
  - `.jpeg`
  - `.png`
  - `.webp`
- 上传图片最大 10MB。
- 封面文件保存到本地 `covers/` 目录。
- 自定义封面不写回原音频文件。
- 支持删除用户封面。

### 验收标准

- 有内嵌封面的音频可自动显示封面。
- 上传封面后列表和详情页显示新封面。
- 删除封面后回到无封面或内嵌封面状态。

---

# 6.4 标签模块

## 6.4.1 添加标签

### 描述

用户可以为音频添加一个或多个 tags。

### 功能要求

- 支持输入新标签。
- 支持逗号分隔批量添加。
- 支持从已有标签下拉选择。
- tag 名称全局唯一。
- tag 与音频为多对多关系。
- tag 来源支持：
  - `user`
  - `ai`
  - `system`

### 验收标准

- 用户可以为音频添加多个标签。
- 重复标签不会重复创建。
- 已添加标签不会重复关联到同一音频。
- 标签在详情页和列表页显示。

---

## 6.4.2 移除音频标签

### 描述

用户可以从音频上移除标签。

### 功能要求

- 删除音频与标签的关联关系。
- 不默认删除 tag 本体。
- 移除后更新搜索索引。

### 验收标准

- 移除标签后该音频不再展示该标签。
- 其他音频的同名标签不受影响。
- 搜索该标签不再命中被移除音频。

---

## 6.4.3 按标签筛选

### 描述

用户可以通过左侧标签列表筛选音频。

### 功能要求

- 左侧展示所有标签。
- 点击标签后显示关联音频。
- 支持和搜索关键字组合筛选。

### 验收标准

- 点击标签后列表只显示关联音频。
- 搜索关键字和标签筛选可同时生效。

---

## 6.4.4 标签维护

### 描述

Settings 页面提供标签维护能力。

### 功能要求

- 展示所有标签。
- 支持标签重命名。
- 支持删除未使用标签。
- 支持清理 orphan tags。
- 重命名标签后更新所有关联音频的搜索索引。
- 删除仍被音频使用的标签时应阻止或要求 force。

### 验收标准

- 重命名标签后列表和详情展示新标签名。
- 搜索新标签名能命中关联音频。
- 清理未使用标签后 orphan tags 被删除。
- 被使用的标签默认不能误删。

---

# 6.5 Playlist 模块

## 6.5.1 创建 playlist

### 字段

- `name`
- `description`

### 功能要求

- 用户可以在 Settings 中创建 playlist。
- 创建后左侧导航展示新 playlist。

### 验收标准

- 创建 playlist 后可立即在左侧看到。
- 点击 playlist 后进入 playlist 视图。

---

## 6.5.2 添加音频到 playlist

### 功能要求

- 支持从详情页添加当前音频到指定 playlist。
- 同一音频可出现在多个 playlist 中。
- 当前版本允许同一音频多次加入同一 playlist，用于自定义播放序列。

### 验收标准

- 添加成功后 playlist 详情可看到该音频。
- 一个音频可加入不同 playlist。

---

## 6.5.3 从 playlist 移除音频

### 功能要求

- 在 playlist 视图中，每条音频提供“移除”操作。
- 移除的是 playlist item，不删除音频库中的 AudioItem。
- 移除后更新 playlist 列表。

### 验收标准

- 移除后音频不再出现在该 playlist。
- 音频仍保留在 Library 中。

---

## 6.5.4 playlist 排序

### 功能要求

- 支持上移 / 下移。
- 支持拖拽排序。
- 排序保存在 `playlist_items.order_index`。
- 播放顺序按照 playlist item 顺序执行。

### 验收标准

- 拖拽排序后刷新页面顺序仍保持。
- 上一首 / 下一首按照新顺序播放。
- 导出的 playlist 按当前顺序输出。

---

## 6.5.5 playlist 播放

### 功能要求

- 点击 playlist 中音频后，以当前 playlist 作为播放队列。
- 支持上一首 / 下一首。
- 当前音频播放结束后自动播放下一条。

### 验收标准

- 在 playlist 视图播放第三条音频，下一首为第四条。
- 队列弹出层展示当前 playlist 顺序。

---

## 6.5.6 playlist 导出

### 支持格式

- JSON
- M3U

### 验收标准

- 导出的 JSON 包含 playlist 信息和音频信息。
- 导出的 M3U 可被常见播放器识别。
- 导出顺序与 playlist 顺序一致。

---

# 6.6 搜索模块

## 6.6.1 全局搜索

### 搜索范围

- title
- author
- description
- tags
- transcript

### 技术要求

- 使用 SQLite FTS5 建立全文索引。
- 同时使用 LIKE fallback 补全文本匹配。
- 即使 FTS5 有结果，也额外使用 LIKE 补全中文和部分匹配。
- metadata、tags、transcript 更新后更新搜索索引。

### 功能要求

- 输入关键字返回匹配音频。
- 支持中文搜索。
- 支持标题、描述、标签、transcript 部分命中。
- 搜索结果保留原列表展示结构。
- 搜索命中字段高亮。
- transcript 命中展示片段。
- transcript 命中可点击时间跳转播放。

### 验收标准

- 搜索 title 里的关键词能命中。
- 搜索 tag 名称能命中。
- 搜索 description 新增文字能命中。
- 搜索 transcript 中的词能命中。
- 搜索中文短语时，FTS5 不命中也能通过 LIKE fallback 命中。
- 点击 transcript 搜索命中时间可跳转播放。

---

## 6.6.2 基础筛选

### 支持条件

- 是否收藏
- 是否已有 transcript
- 是否缺 description
- 是否 missing
- tag

### 功能要求

- 筛选可与搜索关键字组合。
- playlist 视图中筛选在前端对当前 playlist 数据执行。
- Library / Favorites / Tags 视图中通过后端参数筛选。

### 验收标准

- 只看缺描述时，仅展示无 description 的音频。
- 仅 missing 时，仅展示丢失文件。
- 已有 transcript 时，仅展示 transcript_status = done 的音频。

---

# 6.7 Transcript 模块

## 6.7.1 发起转写

### 描述

用户可以对音频发起本地 ASR 转写任务。

### 功能要求

- 点击“转写”创建 `transcribe` 类型任务。
- 更新 `audio_items.transcript_status = pending`。
- 后台 worker 获取任务。
- 调用 faster-whisper 执行转写。
- 转写成功后写入 transcript 和 segments。
- 转写失败后保存错误信息。
- UI 不被任务阻塞。
- 任务状态定期刷新。
- 任务状态变化通过 toast 提示。

### 验收标准

- 发起转写后任务进入 pending / running。
- 完成后 transcript_status = done。
- 失败后 transcript_status = failed，并展示错误。
- 用户可重试失败任务。

---

## 6.7.2 保存 transcript

### Transcript 字段

- `audio_id`
- `language`
- `full_text`
- `model_name`
- `status`
- `generated_at`
- `updated_at`

### Segment 字段

- `transcript_id`
- `segment_index`
- `start_seconds`
- `end_seconds`
- `text`

### 验收标准

- 转写完成后可查看全文。
- 可查看分段文本。
- 每个 segment 包含开始和结束时间。

---

## 6.7.3 查看 transcript

### 功能要求

- 在详情页展示 transcript。
- 若有 segments，优先展示分段文本。
- 显示每段时间戳。
- 点击时间戳跳转播放。

### 验收标准

- 点击 segment 时间后播放器跳转到对应位置。
- transcript 与当前音频绑定正确。

---

## 6.7.4 导出 transcript

### 支持格式

- TXT
- JSON
- SRT

### 验收标准

- TXT 导出全文。
- JSON 导出音频、transcript、segments 结构。
- SRT 按 segment 时间生成字幕文件。

---

# 6.8 AI 分析模块

## 6.8.1 本地 LLM 配置

### 配置项

- endpoint
- model_name
- api_key，可为空
- timeout
- max_tokens
- temperature

### 功能要求

- 接口兼容 OpenAI Chat Completions 风格。
- 后端请求路径为：

```text
{endpoint}/chat/completions
```

- 软件不提供默认在线模型。
- 如果 endpoint 非本机地址，必须提示隐私风险。
- 支持测试连接。

### 验收标准

- 配置本地 endpoint 后测试连接成功。
- 未配置 endpoint 和 model_name 时，AI 分析提示需要配置。
- 非本机 endpoint 会显示隐私警告。

---

## 6.8.2 生成 description

### 输入

- title
- author
- album
- existing description
- duration
- language
- transcript full_text 截断文本

### 输出格式

AI 应只输出 JSON：

```json
{
  "description": "string",
  "tags": ["string"],
  "language": "string"
}
```

### 约束

- description 建议 80 到 200 字。
- tags 建议 5 到 8 个。
- tags 应具体、可检索。
- 避免低价值标签：
  - 音频
  - 内容
  - 对话
  - 讲话
- 不得编造 transcript 中不存在的具体事实。
- transcript 为空时，只能根据 metadata 保守描述。

### 功能要求

- AI description 写入 `description_ai`。
- 不覆盖 `description_user`。
- 用户点击接受后写入 `description_user`。
- 更新搜索索引。

### 验收标准

- AI 成功返回后详情页显示 AI 建议描述。
- 点击接受后，用户描述更新。
- 搜索 AI 描述或用户描述均可命中。

---

## 6.8.3 生成 tags

### 功能要求

- AI tags 默认保存在 AI task output 中作为建议。
- 不自动加入正式 tags。
- 用户可接受单个 tag。
- 用户可接受全部未添加 tags。
- 接受后以 `source = ai` 创建或关联标签。
- 重复标签不会重复创建。

### 验收标准

- AI 返回 tags 后详情页展示标签建议。
- 接受后标签出现在当前音频 tags 中。
- 已接受标签显示“已接受”。
- 重复接受不会重复创建。

---

## 6.8.4 AI 任务队列

### 任务类型

- `transcribe`
- `analyze`

### 任务状态

- pending
- running
- done
- failed
- canceled

### 功能要求

- Settings 展示任务队列。
- 支持失败任务重试。
- 支持取消 pending / running 任务。
- running 任务取消可采用“标记取消”方式，底层模型调用结束后再完成取消。
- 任务状态每 3 秒刷新。
- 任务终态变化通过 toast 提醒。

### 验收标准

- 发起任务后 UI 仍可操作。
- 任务完成 / 失败 / 取消时有提醒。
- 失败任务显示错误信息。
- 失败 / 取消任务可重试。

---

# 6.9 导出、维护与日志模块

## 6.9.1 Metadata 导出

### 支持格式

- JSON
- CSV

### 导出内容

- id
- title
- author
- album
- file_path
- duration_seconds
- language
- tags
- transcript_status
- ai_status
- is_favorite
- is_missing

### 验收标准

- JSON 可完整备份音频 metadata 和 tags。
- CSV 可用于表格工具查看。

---

## 6.9.2 Playlist 导出

详见 6.5.6。

---

## 6.9.3 Transcript 导出

详见 6.7.4。

---

## 6.9.4 搜索索引重建

### 功能要求

- Settings 中提供“重建搜索索引”按钮。
- 遍历所有 AudioItem，重建 FTS5 search_index。

### 验收标准

- 重建完成后返回重建数量。
- 搜索异常时可通过重建恢复。

---

## 6.9.5 标签清理

### 功能要求

- Settings 中提供“清理未使用标签”按钮。
- 删除没有任何 AudioTag 关联的 tags。

### 验收标准

- orphan tags 被删除。
- 已被音频使用的标签不被删除。

---

## 6.9.6 日志

### 功能要求

- 后端记录 app.log。
- 日志文件使用轮转机制。
- Settings 中可查看日志尾部。
- 支持下载日志文件。

### 验收标准

- 启动、扫描、异常等关键操作写入日志。
- UI 可查看日志内容。
- 可下载 `app.log`。

---

# 6.10 设置模块

## 6.10.1 媒体库设置

### 功能

- 添加目录
- 启用 / 禁用目录
- 扫描目录
- 查看扫描任务
- 取消扫描任务

---

## 6.10.2 ASR 设置

### 配置项

- model name / path
- device：cpu / cuda
- compute_type：int8 / float16 / float32 等
- beam_size

### 离线提示

如果用户填写 `small`、`medium`、`large-v3` 等模型名，faster-whisper 首次运行可能尝试下载模型。

若用户要求完全离线，应填写本地模型路径。

---

## 6.10.3 LLM 设置

### 配置项

- endpoint
- model_name
- api_key
- timeout
- max_tokens
- temperature

### 隐私提示

非本机 endpoint 需要提示风险。

---

## 6.10.4 标签维护

### 功能

- 查看所有标签
- 重命名标签
- 删除未使用标签
- 清理 orphan tags

---

## 6.10.5 导出与维护

### 功能

- 导出 metadata JSON
- 导出 metadata CSV
- 重建搜索索引
- 查看日志
- 下载日志

---

# 7. 数据需求

## 7.1 数据存储

MVP+ 使用：

- SQLite 数据库
- SQLite FTS5 虚拟表
- 本地文件系统保存封面缓存
- 本地文件系统保存日志
- 原音频文件保留在用户本地目录

---

## 7.2 核心实体

| 实体 | 说明 |
|---|---|
| LibraryRoot | 用户添加的媒体库目录 |
| AudioItem | 本地音频文件及应用内 metadata |
| Tag | 标签 |
| AudioTag | 音频和标签的多对多关系 |
| Playlist | 播放列表 |
| PlaylistItem | 播放列表中的音频项及排序 |
| Transcript | 完整转写文本 |
| TranscriptSegment | 带时间戳的转写片段 |
| AITask | ASR / AI 分析任务 |
| ScanTask | 扫描任务 |
| Setting | 应用配置 |
| search_index | FTS5 搜索索引 |

---

# 8. 数据库 Schema

## 8.1 library_roots

```sql
CREATE TABLE library_roots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL UNIQUE,
    is_enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```

---

## 8.2 audio_items

```sql
CREATE TABLE audio_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    file_path TEXT NOT NULL UNIQUE,
    file_name TEXT NOT NULL,
    file_ext TEXT,
    file_size INTEGER,
    file_mtime TEXT,
    file_hash TEXT,

    library_root_id INTEGER,

    title_original TEXT,
    title_user TEXT,

    author_original TEXT,
    author_user TEXT,

    album_original TEXT,
    album_user TEXT,

    description_original TEXT,
    description_user TEXT,
    description_ai TEXT,

    cover_path TEXT,
    cover_source TEXT,

    duration_seconds REAL,
    bitrate INTEGER,
    sample_rate INTEGER,
    channels INTEGER,

    language TEXT,

    transcript_status TEXT NOT NULL DEFAULT 'none',
    ai_status TEXT NOT NULL DEFAULT 'none',

    play_count INTEGER NOT NULL DEFAULT 0,
    last_played_at TEXT,
    last_position_seconds REAL NOT NULL DEFAULT 0,

    is_favorite INTEGER NOT NULL DEFAULT 0,
    is_missing INTEGER NOT NULL DEFAULT 0,

    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,

    FOREIGN KEY (library_root_id) REFERENCES library_roots(id)
);
```

---

## 8.3 tags

```sql
CREATE TABLE tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    source TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL
);
```

---

## 8.4 audio_tags

```sql
CREATE TABLE audio_tags (
    audio_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (audio_id, tag_id),
    FOREIGN KEY (audio_id) REFERENCES audio_items(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);
```

---

## 8.5 playlists

```sql
CREATE TABLE playlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```

---

## 8.6 playlist_items

```sql
CREATE TABLE playlist_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    playlist_id INTEGER NOT NULL,
    audio_id INTEGER NOT NULL,
    order_index INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
    FOREIGN KEY (audio_id) REFERENCES audio_items(id) ON DELETE CASCADE
);
```

---

## 8.7 transcripts

```sql
CREATE TABLE transcripts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    audio_id INTEGER NOT NULL UNIQUE,
    language TEXT,
    full_text TEXT NOT NULL,
    model_name TEXT,
    status TEXT NOT NULL DEFAULT 'done',
    generated_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (audio_id) REFERENCES audio_items(id) ON DELETE CASCADE
);
```

---

## 8.8 transcript_segments

```sql
CREATE TABLE transcript_segments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transcript_id INTEGER NOT NULL,
    segment_index INTEGER NOT NULL,
    start_seconds REAL NOT NULL,
    end_seconds REAL NOT NULL,
    text TEXT NOT NULL,
    FOREIGN KEY (transcript_id) REFERENCES transcripts(id) ON DELETE CASCADE
);
```

---

## 8.9 ai_tasks

```sql
CREATE TABLE ai_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    audio_id INTEGER NOT NULL,
    task_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    input_payload TEXT,
    output_payload TEXT,
    error_message TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (audio_id) REFERENCES audio_items(id) ON DELETE CASCADE
);
```

---

## 8.10 scan_tasks

```sql
CREATE TABLE scan_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    root_id INTEGER NOT NULL,

    status TEXT NOT NULL DEFAULT 'pending',

    total_files INTEGER NOT NULL DEFAULT 0,
    processed_files INTEGER NOT NULL DEFAULT 0,

    imported INTEGER NOT NULL DEFAULT 0,
    updated INTEGER NOT NULL DEFAULT 0,
    missing INTEGER NOT NULL DEFAULT 0,

    error_message TEXT,

    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    updated_at TEXT NOT NULL,

    FOREIGN KEY (root_id) REFERENCES library_roots(id)
);
```

---

## 8.11 settings

```sql
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```

---

## 8.12 search_index

```sql
CREATE VIRTUAL TABLE search_index USING fts5(
    audio_id UNINDEXED,
    title,
    author,
    description,
    tags,
    transcript
);
```

---

# 9. API 需求

## 9.1 Health

```http
GET /health
```

---

## 9.2 Library Root API

### 添加媒体库目录

```http
POST /library-roots
```

```json
{
  "path": "/Users/me/Music/Podcasts"
}
```

---

### 获取媒体库目录

```http
GET /library-roots
```

---

### 更新媒体库目录

```http
PATCH /library-roots/{root_id}
```

```json
{
  "is_enabled": false
}
```

---

### 异步扫描媒体库

```http
POST /library-roots/{root_id}/scan
```

---

### 同步扫描媒体库

```http
POST /library-roots/{root_id}/scan-sync
```

---

## 9.3 Scan Task API

```http
GET /scan-tasks
GET /scan-tasks/{task_id}
POST /scan-tasks/{task_id}/cancel
```

---

## 9.4 Audio API

### 获取音频列表

```http
GET /audio-items
```

Query 参数：

| 参数 | 类型 | 说明 |
|---|---|---|
| q | string | 搜索关键字 |
| tag | string | 标签名 |
| has_transcript | boolean | 是否已有 transcript |
| favorite | boolean | 是否收藏 |
| missing | boolean | 是否 missing |
| missing_description | boolean | 是否缺 description |
| include_disabled_roots | boolean | 是否包含禁用目录 |
| limit | number | 分页大小 |
| offset | number | 分页偏移 |

返回中每个音频包含：

- AudioItem 字段
- `tags`
- `search_hits`

---

### 获取音频详情

```http
GET /audio-items/{audio_id}
```

---

### 更新音频 metadata

```http
PATCH /audio-items/{audio_id}
```

```json
{
  "title_user": "线性代数 第一讲",
  "author_user": "张老师",
  "album_user": "线性代数课程",
  "description_user": "课程导论",
  "language": "zh",
  "is_favorite": true
}
```

---

### 删除音频条目

```http
DELETE /audio-items/{audio_id}?delete_file=false
```

默认只删除数据库条目，不删除本地文件。

---

### 重新定位音频文件

```http
POST /audio-items/{audio_id}/relocate
```

```json
{
  "file_path": "/new/path/audio.mp3"
}
```

---

### 更新播放位置

```http
POST /audio-items/{audio_id}/playback-position
```

```json
{
  "last_position_seconds": 123.5
}
```

---

### 增加播放次数

```http
POST /audio-items/{audio_id}/play-count
```

---

### 获取音频文件

```http
GET /audio-items/{audio_id}/file
```

---

## 9.5 Cover API

```http
GET    /audio-items/{audio_id}/cover
POST   /audio-items/{audio_id}/cover
DELETE /audio-items/{audio_id}/cover
```

---

## 9.6 Tags API

### 获取所有标签

```http
GET /tags
```

---

### 重命名标签

```http
PATCH /tags/{tag_id}
```

```json
{
  "name": "线性代数"
}
```

---

### 删除标签

```http
DELETE /tags/{tag_id}?force=false
```

---

### 添加标签到音频

```http
POST /audio-items/{audio_id}/tags
```

```json
{
  "tags": ["数学", "线性代数"],
  "source": "user"
}
```

---

### 从音频移除标签

```http
DELETE /audio-items/{audio_id}/tags/{tag_id}
```

---

## 9.7 Playlist API

### 创建 playlist

```http
POST /playlists
```

```json
{
  "name": "英语听力训练",
  "description": "用于日常听力练习"
}
```

---

### 获取 playlists

```http
GET /playlists
```

---

### 获取 playlist 详情

```http
GET /playlists/{playlist_id}
```

---

### 添加音频到 playlist

```http
POST /playlists/{playlist_id}/items
```

```json
{
  "audio_id": 12
}
```

---

### 移除 playlist item

```http
DELETE /playlists/{playlist_id}/items/{item_id}
```

---

### playlist 排序

```http
PATCH /playlists/{playlist_id}/items/reorder
```

```json
{
  "item_ids": [3, 1, 2, 4]
}
```

---

### 导出 playlist

```http
GET /playlists/{playlist_id}/export?format=json
GET /playlists/{playlist_id}/export?format=m3u
```

---

## 9.8 Transcript API

### 发起转写

```http
POST /audio-items/{audio_id}/transcribe
```

---

### 获取 transcript

```http
GET /audio-items/{audio_id}/transcript
```

---

### 保存 transcript

```http
POST /audio-items/{audio_id}/transcript
```

---

### 导出 transcript

```http
GET /audio-items/{audio_id}/transcript/export?format=txt
GET /audio-items/{audio_id}/transcript/export?format=json
GET /audio-items/{audio_id}/transcript/export?format=srt
```

---

## 9.9 AI API

### 发起 AI 分析

```http
POST /audio-items/{audio_id}/analyze
```

---

### 获取 AI 建议

```http
GET /audio-items/{audio_id}/ai-suggestions
```

---

### 测试 LLM 配置

```http
POST /ai/test-llm
```

```json
{
  "endpoint": "http://127.0.0.1:1234/v1",
  "model_name": "local-model",
  "api_key": "",
  "timeout": 60,
  "max_tokens": 64,
  "temperature": 0
}
```

---

### 获取任务

```http
GET /ai-tasks
GET /ai-tasks/{task_id}
```

---

### 重试任务

```http
POST /ai-tasks/{task_id}/retry
```

---

### 取消任务

```http
POST /ai-tasks/{task_id}/cancel
```

---

## 9.10 Batch API

```http
POST /audio-items/batch/transcribe
POST /audio-items/batch/analyze
```

```json
{
  "audio_ids": [1, 2, 3]
}
```

---

## 9.11 Settings API

```http
GET /settings
PUT /settings
```

```json
{
  "key": "llm.endpoint",
  "value": "http://127.0.0.1:1234/v1"
}
```

---

## 9.12 Search API

```http
GET /search?q=keyword
```

---

## 9.13 Export / Maintenance / Logs API

```http
GET  /export/metadata?format=json
GET  /export/metadata?format=csv
POST /maintenance/rebuild-search-index
POST /maintenance/cleanup-tags
GET  /logs/app
GET  /logs/app/file
```

---

# 10. 用户界面需求

## 10.1 主界面布局

采用三栏 + 紧凑底部播放器：

```text
┌──────────────┬────────────────────────┬─────────────────────┐
│ 左侧导航      │ 中间音频列表             │ 右侧详情             │
│              │                        │                     │
│ Library      │ Cover Title Author     │ Metadata            │
│ Favorites    │ Tags Duration Status   │ Tags                │
│ Tags         │ Search Hits            │ Description         │
│ Playlists    │                        │ Transcript          │
│ Settings     │                        │ AI Suggestions      │
├──────────────┴────────────────────────┴─────────────────────┤
│ 紧凑底部播放器：当前播放 / 控制 / 进度 / 倍速 / 音量 / 队列   │
└──────────────────────────────────────────────────────────────┘
```

---

## 10.2 左侧导航

### 内容

- Library
- Favorites
- Settings
- Tags
- Playlists

### 交互

- 点击 Library 显示全部启用目录音频。
- 点击 Favorites 显示收藏音频。
- 点击 tag 筛选音频。
- 点击 playlist 显示 playlist 音频。

---

## 10.3 中间音频列表

### 展示字段

- 封面
- 收藏标识
- title
- author
- duration
- language
- tags
- transcript_status
- ai_status
- missing 标识
- 搜索命中片段

### 操作

- 单击选择音频。
- 双击播放音频。
- 点击播放按钮播放。
- playlist 视图中：
  - 上移
  - 下移
  - 移除
  - 拖拽排序
- 批量转写。
- 批量 AI 分析。
- 筛选：
  - 缺描述
  - transcript 状态
  - missing 状态

---

## 10.4 右侧详情面板

包含：

1. 封面区
2. 播放 / 转写 / AI 分析 / 删除数据库条目操作
3. metadata 编辑区
4. 原始 metadata 展示
5. 文件信息
6. 重新定位
7. tags 管理
8. playlist 加入
9. description 展示
10. AI 建议描述
11. AI 标签建议
12. transcript 展示和导出

---

## 10.5 底部播放器

### 设计原则

底部播放器必须保持紧凑，不应占据过多垂直空间。

### 内容

- 当前播放标题
- 上一首
- 播放 / 暂停
- 下一首
- 停止
- 当前时间
- 进度条
- 总时长
- 倍速
- 音量
- 队列按钮

### 队列

队列以弹出层显示，不常驻占用高度。

队列弹出层支持：

- 查看队列
- 点击播放队列项
- 移除队列项
- 清空队列

---

## 10.6 设置页

包含：

### 后端状态

- 检查 FastAPI 后端是否可用。

### 媒体库设置

- 添加目录
- 启用 / 禁用目录
- 扫描目录
- 查看扫描任务
- 取消扫描任务

### Playlist

- 创建 playlist

### 标签维护

- 查看标签
- 重命名标签
- 删除标签
- 清理未使用标签

### ASR 设置

- model name / path
- device
- compute_type
- beam_size
- 离线模型路径提示

### LLM 设置

- endpoint
- model_name
- api_key
- timeout
- max_tokens
- temperature
- 本地 endpoint 隐私提示
- 测试连接

### 导出与维护

- metadata JSON
- metadata CSV
- 搜索索引重建

### 任务队列

- AI / ASR 任务列表
- 状态
- 错误
- 重试
- 取消

### 日志

- 查看日志
- 下载日志文件

---

# 11. 核心工作流

## 11.1 扫描工作流

```text
用户点击扫描
  -> 创建 scan_tasks 记录
  -> 后台扫描目录
  -> 识别支持格式音频
  -> 读取文件信息和 metadata
  -> 提取内嵌封面
  -> 新音频写入 audio_items
  -> 已存在音频更新技术 metadata
  -> 不存在文件标记 missing
  -> 重建搜索索引
  -> 更新扫描任务进度
  -> 扫描任务 done / failed / canceled
```

---

## 11.2 播放工作流

```text
用户点击播放
  -> 当前列表成为播放队列
  -> 选中音频成为当前播放项
  -> 请求 /audio-items/{id}/file
  -> audio 元素播放
  -> 每 5 秒保存播放位置
  -> 播放结束后位置重置为 0
  -> 若队列存在下一首，自动播放下一首
```

---

## 11.3 转写工作流

```text
用户点击转写
  -> 创建 ai_tasks(task_type=transcribe)
  -> audio_items.transcript_status = pending
  -> worker 取任务
  -> task.status = running
  -> 调用 faster-whisper
  -> 写入 transcripts
  -> 写入 transcript_segments
  -> audio_items.transcript_status = done
  -> 重建搜索索引
  -> task.status = done
```

失败：

```text
task.status = failed
audio_items.transcript_status = failed
error_message = 错误信息
```

---

## 11.4 AI 分析工作流

```text
用户点击 AI 分析
  -> 校验 LLM endpoint / model_name
  -> 若 endpoint 非本机，显示隐私警告
  -> 创建 ai_tasks(task_type=analyze)
  -> audio_items.ai_status = pending
  -> worker 取任务
  -> 读取 audio metadata
  -> 读取 transcript
  -> 构造 prompt
  -> 调用 OpenAI-compatible chat completions
  -> 解析 JSON
  -> 写入 description_ai
  -> 保存 tags 建议到 task.output_payload
  -> audio_items.ai_status = done
  -> 重建搜索索引
  -> task.status = done
```

AI tags 接受流程：

```text
用户点击接受 tag
  -> POST /audio-items/{id}/tags source=ai
  -> 创建或复用 tag
  -> 创建 audio_tag 关联
  -> 重建搜索索引
```

---

## 11.5 搜索工作流

```text
用户输入搜索词
  -> 请求 /audio-items?q=keyword
  -> 后端执行 FTS5 查询
  -> 后端执行 LIKE fallback
  -> 合并去重 audio_ids
  -> 返回 AudioItem + tags + search_hits
  -> 前端高亮命中词
  -> 若 search_hits 包含 transcript 时间戳，可点击跳转播放
```

---

# 12. 安全与隐私要求

## 12.1 后端绑定

默认只监听：

```text
127.0.0.1:8765
```

不得默认监听公网地址。

---

## 12.2 CORS

生产默认只允许本机和 Tauri 本地来源。

开发可显式开启：

```text
LOCAL_AUDIO_LIBRARY_ALLOW_ALL_CORS=1
```

---

## 12.3 LLM endpoint 风险提示

非本机地址必须提示：

> 当前 LLM endpoint 不是 localhost / 127.0.0.1。AI 分析会把音频 metadata 和 transcript 发送到该地址。请确认这是你信任的本地或内网模型服务。

---

## 12.4 音频文件不上传

应用不得主动上传：

- 音频文件
- transcript
- metadata
- tags
- playlist

除非用户主动配置非本地 LLM endpoint 并确认风险。

---

## 12.5 删除数据

删除音频条目时必须区分：

- 从数据库移除
- 删除本地音频文件

默认只从数据库移除。

---

# 13. 错误处理

## 13.1 文件不存在

处理方式：

- 播放时如果文件不存在，标记 `is_missing = true`。
- UI 显示 missing。
- 允许用户重新定位。

---

## 13.2 Metadata 读取失败

处理方式：

- 仍导入文件。
- 使用文件名作为标题 fallback。
- 错误写入日志。
- 不影响其他文件扫描。

---

## 13.3 扫描失败

处理方式：

- scan_task.status = failed
- 保存 error_message
- UI 展示错误
- toast 提示失败

---

## 13.4 转写失败

处理方式：

- task.status = failed
- audio.transcript_status = failed
- 保存 error_message
- 用户可重试

---

## 13.5 LLM 返回格式错误

处理方式：

- 保存 raw_content 到 output_payload
- task.status = failed
- audio.ai_status = failed
- error_message 提示 JSON schema 错误
- 用户可重试

---

## 13.6 API 错误展示

前端应解析 FastAPI 返回的 `detail` 字段，显示可读错误，不直接展示完整 JSON 响应。

---

# 14. 性能与体验要求

## 14.1 扫描性能

- 扫描不阻塞 UI。
- 每处理一个文件更新扫描进度。
- 大文件 hash 可延迟计算。
- metadata 读取失败不影响扫描整体流程。

---

## 14.2 播放体验

- 点击播放后应尽快开始播放。
- 播放控制响应目标小于 200ms。
- 播放器底部栏保持紧凑，不遮挡主界面。
- 队列使用弹出层管理，不常驻占用高度。

---

## 14.3 搜索体验

- 输入搜索词后快速返回结果。
- 中文搜索应尽量可用。
- 搜索命中高亮。
- transcript 命中可展示片段和跳转时间。
- 修改 metadata、tags、transcript 后搜索索引同步更新。

---

## 14.4 AI 任务体验

- AI / ASR 任务不阻塞主界面。
- 任务状态定期刷新。
- 任务终态通过 toast 提示。
- 失败任务可重试。
- running 任务可请求取消。

---

## 14.5 UI 布局

- 桌面窗口最小宽度建议不低于 1000px。
- 页面主体区域应内部滚动。
- 底部播放器高度控制在约 96px～104px。
- 弹出层不得被窗口底部裁切。
- 三栏内容不得因播放器扩展被遮挡。

---

# 15. 验收标准总览

MVP+ 完成标准：

1. 用户可以添加本地音频目录。
2. 用户可以扫描目录并导入支持格式音频。
3. 扫描任务可查看进度并取消。
4. 删除本地文件后重新扫描，音频标记 missing。
5. 用户可以重新定位 missing 文件。
6. 音频可以播放、暂停、继续、停止、上一首、下一首。
7. 播放器支持进度条、倍速、音量。
8. 每个音频能记忆播放位置。
9. 接近结尾再次播放时可选择从头播放。
10. 播放队列可查看、选择、移除当前、清空。
11. 底部播放器保持紧凑，不遮挡主界面。
12. 用户可以编辑 title、author、album、description、language、favorite。
13. 原始 metadata 和用户 metadata 分开保存和展示。
14. 用户可以上传和删除封面。
15. 有内嵌封面的音频能显示封面。
16. 用户可以添加新标签。
17. 用户可以从已有标签中选择添加。
18. 用户可以移除音频标签。
19. 用户可以按标签筛选音频。
20. 用户可以重命名标签。
21. 用户可以清理未使用标签。
22. 用户可以创建 playlist。
23. 用户可以将音频加入 playlist。
24. 用户可以从 playlist 移除音频。
25. 用户可以上移 / 下移 playlist 音频。
26. 用户可以拖拽排序 playlist。
27. playlist 按当前顺序播放。
28. playlist 可导出 JSON / M3U。
29. 用户可以搜索 title、author、description、tags、transcript。
30. 中文和部分关键词搜索可通过 LIKE fallback 命中。
31. 搜索命中内容可高亮。
32. transcript 命中片段可展示并跳转播放。
33. 用户可以发起本地 ASR 转写。
34. 转写完成后可查看全文和分段。
35. 点击 transcript segment 可跳转播放。
36. transcript 可导出 TXT / JSON / SRT。
37. 用户可以配置本地 LLM endpoint。
38. 非本地 LLM endpoint 会显示隐私警告。
39. 用户可以测试 LLM 连接。
40. 用户可以发起 AI 分析。
41. AI 成功后生成 description_ai。
42. AI tags 作为建议显示，不自动覆盖用户 tags。
43. 用户可以接受 AI description。
44. 用户可以接受单个或全部 AI tags。
45. AI / ASR 任务状态可查看。
46. 任务失败显示错误。
47. 失败 / 取消任务可重试。
48. pending / running 任务可请求取消。
49. 批量转写可用。
50. 批量 AI 分析可用。
51. metadata 可导出 JSON / CSV。
52. 日志可查看和下载。
53. 搜索索引可重建。
54. 核心数据保存在本地 SQLite。
55. 无互联网环境下，基础播放、管理、搜索可正常使用。

---

# 16. 开发优先级

## P0：已完成

- 本地音频扫描入库
- 基础播放器
- metadata 编辑
- tags
- playlist
- SQLite 存储
- title / description / tags 搜索
- playlist 移除音频
- playlist 排序
- 列表展示 tags
- 原始 metadata 展示
- missing / transcript 筛选 UI

---

## P1：已完成

- transcript 转写
- transcript 展示
- transcript 搜索
- AI description / tags 生成
- AI 任务队列
- 隐私警告
- CORS 收紧
- API 错误 detail 解析
- 中文搜索 fallback
- ASR 离线模型路径提示

---

## P2：已完成

- 封面管理
- 任务进度
- 批量操作
- 搜索高亮
- transcript 命中片段
- 点击命中片段跳转
- 播放队列管理
- 紧凑播放器
- 队列弹出层
- tag rename
- orphan tag cleanup
- playlist 拖拽排序
- toast 通知
- 接近结尾从头播放提示

---

## P3：后续扩展

- playlist 重命名 / 删除
- LibraryRoot 删除
- tag merge
- transcript 编辑器
- transcript 命中更多上下文
- 智能 playlist
- 自动章节切分
- 语义搜索
- 本地向量数据库
- 基于 transcript 的本地问答
- 说话人分离
- 更完整的备份 / 恢复
- 插件式模型接口
- 更精细的 ASR 进度
- 更强 running 任务中断能力

---

# 17. 后续版本规划

## v0.5

- Beta 发布加固：版本统一、数据库升级备份、迁移回归、Tauri 生命周期 smoke test
- playlist rename / delete
- LibraryRoot delete
- tag merge
- transcript 编辑能力
- 更完整的播放队列拖拽排序

---

## v0.6

- transcript 命中上下文扩展
- 自动章节切分
- 音频章节导航
- AI 章节摘要

---

## v0.7

- 语义搜索
- 本地 embedding 模型
- 本地向量数据库
- metadata + transcript 混合检索

---

## v0.8

- 基于 transcript 的本地问答
- 按 playlist / tag / library root 限定问答范围
- 引用 transcript 时间戳

---

## v1.0

- 稳定跨平台桌面版本
- 完整导入 / 导出 / 备份恢复
- 插件式模型接口
- 完整隐私模式
- 更完善的错误恢复和升级迁移机制

---

# 18. 结论

Local Audio Library MVP+ 的核心定位是：

> 一个纯本地、隐私优先、可播放、可整理、可搜索、可转写、可 AI 辅助归类的个人音频知识库。

当前 v0.4 PRD 相比初始 MVP，已经从“基础播放器 + 音频库”扩展为较完整的本地音频知识管理工具。

当前阶段应继续坚持：

1. 本地数据优先。
2. 不默认上传任何用户内容。
3. AI 只作为建议，不覆盖用户手动数据。
4. 播放体验保持轻量可靠。
5. 搜索、转写、标签和 playlist 形成完整整理闭环。
6. 所有重要数据可导出、可备份、可迁移。
