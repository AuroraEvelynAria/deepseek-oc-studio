<div align="center">

# DeepSeek OC Studio

官方 DeepSeek App 的同款体验 + 为 OC（原创角色）创作者打造的角色设计工作室

[![Fork](https://img.shields.io/badge/Fork%20of-deepseek--app--replica-2563eb?style=flat-square)](https://github.com/LiJiaHua1024/deepseek-app-replica)
[![Platform](https://img.shields.io/badge/Platform-Android%209%2B-3DDC84?style=flat-square&logo=android&logoColor=white)](https://github.com/AuroraEvelynAria/deepseek-oc-studio)
[![License](https://img.shields.io/badge/License-GPL%20v3-blue?style=flat-square)](LICENSE)

</div>

---

本仓库是 [LiJiaHua1024/deepseek-app-replica](https://github.com/LiJiaHua1024/deepseek-app-replica) 的 fork 与增强版：保留其「尽可能复刻 DeepSeek 官方手机端交互与视觉体验 + 直接填 API Key 按量计费」的全部特性，在此之上为 **OC（原创角色）创作者** 新增角色设计与记忆管理能力。

## 本 fork 的新增功能

### 🎭 角色卡系统
- 多角色管理：名称、头像（本地图片上传，居中裁剪为 webp）、人设提示词（作为 system 注入所有请求）
- 会话绑定角色；官方 DeepSeek（默认角色）与自定义角色自由切换，中途切换即时生效
- 欢迎页与聊天页的角色徽章一键进入「角色与模型」面板

### 🧠 记忆库（按角色隔离）
- 8 维度记忆卡：偏好 / 日常 / 人际 / 经历 / 目标 / 沟通方式 / 特性 / 情绪支持
- **AI 自动提取**：每轮回答成功后自动提炼长期记忆（≤6 项，quote 逐字证据校验，同维度去重，来源可溯源到原话与会话）
- 回复前自动注入启用中的记忆（6000 字符预算，按更新时间新者优先）
- 手动管理：维度筛选、搜索、启用开关、编辑/删除、来源查看
- 独立 IndexedDB 存储，清除历史 / 导入 ZIP 互不影响

### 📤 单会话导出 Markdown
- 沿当前选中分支导出完整对话（深度思考折叠块 + 附件名 + 引用来源），Android 走系统保存文档、网页走浏览器下载

### 🤖 模型提供商适配器
- 模型预设多套保存：显示名 + 模型 ID + 端点 + 格式（Anthropic Messages / OpenAI Chat Completions / OpenAI Responses）+ Key + 能力标记，徽章面板一键切换
- **提供商模板**：Opencode Go / CommandCode / 硅基流动 三家一键套用（自动填端点、模型 ID、会话头等，附官方图标）
- 能力标记（视觉 / 思考 / 联网搜索）约束对应 UI：非视觉模型自动过滤图片上传（选择 / 拖拽 / 粘贴），不支持思考的模型隐藏深度思考开关
- **自定义请求头**：值支持 `{sessionId}` 占位符（自动替换为会话 UUID），满足 Opencode 等网关的会话头要求（`x-opencode-session`）；Android 原生请求通道支持自定义头
- 官方扩展兼容模式：端点透传 DeepSeek 官方扩展（联网搜索 / 自动标题 / 思考开关）时开启，第三方端点同样可用深度思考与智能搜索

### 🧠 三档思考强度
- 关 / 普通 / 深度 三档循环；标准 OpenAI 端点映射 `reasoning_effort: medium / high`，官方与透传网关映射 thinking 开关
- 旧布尔开关自动迁移

### 🖥️ 开发者控制台
- 设置 → 数据管理 → 开发者控制台：网络请求日志（含脱敏后的最终请求头与 body 摘要，环形缓冲 300 条本地持久化）、错误详情全文、应用状态一览、终端式 JS 表达式求值（`__debug.*`）、一键复制全部日志
- Android 端可直接查看原生通道的启动 / 响应 / 错误状态

### 🎬 官方风格动效补齐
- 弹窗进入过渡（淡入 + 缩放）、面板视图切换滑动淡入
- 朗读音色弹窗：音色切换画面交叉渐变 + 文字上滑淡入 + 指示点弹性回放；附 TTS 费用提示

---

## 底座与署名

本项目的存在依靠以下项目，按依赖与启发关系全部致谢：

| 项目 | 关系 | 作者 / 许可证 |
|---|---|---|
| [LiJiaHua1024/deepseek-app-replica](https://github.com/LiJiaHua1024/deepseek-app-replica) | **直接底座**：本仓库 fork 自它，Android 原生容器、Web 交互层与全部基础功能来自该项目 | LiJiaHua1024 · GPL-3.0 |
| [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo) | 上游之上游：底座项目的 Web 交互内核基础 | DeepSeek · MIT |
| [Zer0Qing/Muse](https://github.com/Zer0Qing/Muse) | **角色设计模块参考**：本 fork 的角色卡哲学（严格 schema、凭据不入卡）、SillyTavern PNG 角色卡互通方向、预设角色与记忆工具化思路均启发自该项目 | Zer0Qing · GPL-3.0 |
| [luomiluomi/Remember](https://github.com/luomiluomi/Remember) | 记忆系统设计参考：8 维度分类、按角色隔离、来源溯源与「记忆描述用户 / 角色人设描述助手」的区分 | 听岚工作室 · MIT |

> 感谢以上项目的创作者——本项目遵循各自许可证，在底座之上做的增强部分同样以 GPL-3.0 开源回馈社区。

## 下载与安装

请前往 [GitHub Releases](https://github.com/AuroraEvelynAria/deepseek-oc-studio/releases) 获取 APK（跟随上游发布流程，目前亦可自行从源码构建）。

> 当前源码构建的 APK 支持 Android 9（API 级别 28）及以上版本，前端兼容 WebView 66+。兼容测试覆盖 Android 10 的预装 WebView 74、升级后的 WebView 83，以及 Android 11 的预装 WebView 83。

## 使用步骤

1. 安装并打开应用，在设置中填入 DeepSeek 开放平台 API Key，或在「高级设置 / 模型模板」配置第三方提供商（Opencode Go、CommandCode、硅基流动等）。
2. 欢迎页角色徽章 → 新建角色（写人设、传头像、开自动记忆）。
3. 正常对话：记忆自动提取、深度思考、联网搜索、语音对讲、导出 Markdown 全部可用。

## 技术架构

继承上游：Android 原生容器（Java 17，API Key 经 Android Keystore 加密存储、原生录音、相册预取）承载 Web 交互内核（React 18 + TypeScript + Zustand + Rspack 2，KaTeX / Mermaid / Prism.js）。

<<<<<<< HEAD
- **Android 原生层**：基于 Java 17 与 Android SDK 37（最低兼容 Android 9 / API 28）。通过 WebView 加载本地构建产物，并封装系统级能力：API Key 经 Android Keystore 加密存储、原生麦克风录音采集（`AudioRecord`）、系统相册快速预取以及独立的网页浏览器（`SourceBrowserActivity`）。
- **Web 交互层**：React 18 + TypeScript + Zustand 状态管理，基于 CSS Modules 进行交互细节调优，引入 KaTeX、Mermaid 与 Prism.js 提供排版渲染。
- **构建系统**：Rspack 2 高速打包，与 Gradle `buildWeb` 构建任务无缝联动。
=======
本 fork 新增模块：
- `src/services/characters/` — 角色与记忆的数据层（独立 IndexedDB `replica`）、8 维度记忆、AI 自动提取、system 注入器
- `src/services/models/` — 模型预设库、提供商模板（`providers.ts` 数据驱动，新增提供商加一条记录即可）
- `src/services/debug/` — 开发者控制台的日志环形缓冲、脱敏与求值上下文
- `src/components/characters/` — 角色与模型面板（列表 / 编辑 / 记忆库 / 形象工作室预留）
- `src/components/debug/` — 控制台 UI
- `src/services/chat/exportMarkdown.ts` — 单会话 Markdown 导出
>>>>>>> 4b9ae6b (feat: OC studio enhancements — characters, memory, providers, console)

## 源码构建

```powershell
git clone https://github.com/AuroraEvelynAria/deepseek-oc-studio.git
cd deepseek-oc-studio
pnpm install
.\android\gradlew.bat -p android :app:assembleDebug
```

编译输出：`android/app/build/outputs/apk/debug/app-debug.apk`。环境要求 Node.js 22.12+ / pnpm / JDK 17+ / Android SDK（上游 README 的构建与回归脚本说明同样适用）。

## 路线图

参考 [Zer0Qing/Muse](https://github.com/Zer0Qing/Muse) 的角色设计模块，本 fork 计划按以下顺序继续增强：

- [ ] SillyTavern PNG 角色卡导入导出（tEXt chunk，与 OC 社区生态互通）
- [ ] `replica.persona` 完整角色卡导出（人设 + 记忆 + 开场白，凭据不入卡）
- [ ] 预设角色库（内置 OC 风格角色 + 开场白）
- [ ] 记忆工具化（`save_memory` 等，AI 主动记录）
- [ ] 形象工作室（接图像 API：四候选生成 → 定妆 → 表情包衍生）

## 免责声明

本项目仅供个人技术研究与学习交流使用，非 DeepSeek 官方发布版本。项目内所有商标、标识及版权均归其各自所有者所有；「DeepSeek」相关名称与标识的权利归深度求索公司。角色卡功能产生的角色设定与记忆数据仅保存在设备本地。

## 开源协议

本项目采用 [GPL-3.0 许可证](LICENSE)（继承上游 deepseek-app-replica）。部分基础代码源自 DeepSeek 官方开源的 [chat-demo](https://github.com/deepseek-ai/chat-demo)（基于 MIT 许可证），依其条款保留原作者版权声明。
