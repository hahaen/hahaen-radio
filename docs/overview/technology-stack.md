# 技术选型

状态：Web/Server 技术基线与现有实现按对应专题记录；Android 技术路线于 2026-10-23 确定，目前只建立开发目录与文档，依赖组合及原生工程待初始化验证。

## 前端与浏览器

| 范畴 | 选型 | 约定 |
| --- | --- | --- |
| 语言 | TypeScript | 启用 strict |
| UI | React 19 | 组件与界面交互 |
| 构建 | Vite 8 | 开发服务器和静态资源构建 |
| 路由 | React Router | 浏览器端路由 |
| 客户端状态 | Zustand 5 | 跨组件共享状态 |
| 服务端数据 | TanStack Query 5 | 请求缓存、失效和更新 |
| HTTP | Fetch API | 封装超时、取消和错误处理 |
| 样式 | CSS Modules、CSS Variables | 样式隔离和设计变量 |
| 交互基础 | Radix UI Primitives | 使用无预设视觉的基础组件 |
| 图标 | Lucide React | SVG 图标 |
| 国际化 | i18next、react-i18next | 语言资源和文案 |
| 校验 | Zod 4 | 运行时数据校验 |
| 图形 | Three.js、WebGL 2、GLSL | 直接使用 Three.js API |
| 动画与计算 | requestAnimationFrame、Web Worker | 统一帧循环与可转移的计算任务 |
| 音频播放 | HTMLAudioElement、hls.js | 原生播放与 HLS 能力检测 |
| 音频处理 | Web Audio API | 按跨域和浏览器能力启用 |
| 系统媒体控制 | Media Session API | 能力检测后启用 |
| 浏览器存储 | localStorage、IndexedDB、idb | 少量偏好与较大缓存分开处理 |

## Android 客户端

开发入口为 [apps/android](../../apps/android/README.md)，遵循[专用协作规范](../../apps/android/AGENTS.md)。详细职责、实施顺序与验证边界集中在 [Android 技术方案](../android/technical-design.md)，架构决定见 [ADR-0007](../architecture/decisions/0007-android-native-client.md)。

| 范畴 | 选型 | 约定 |
| --- | --- | --- |
| 语言与界面 | Kotlin、Jetpack Compose、Material 3 | 原生页面与定制夜航主题 |
| 架构与状态 | ViewModel、单向数据流、Repository、Coroutines/Flow/StateFlow | 生命周期感知收集，界面与数据层分离 |
| 注入与导航 | Hilt、KSP、Navigation 3 | 依赖装配、单 Activity 与返回栈 |
| 网络与 JSON | OkHttp、Retrofit、kotlinx.serialization | 复用现有 REST 和 Cookie 会话，DTO 映射 |
| 图片 | Coil | 图片加载与有界缓存 |
| 播放与系统媒体 | Media3 ExoPlayer、HLS、MediaSessionService、MediaController | 原生后台收听、媒体控制及有限播放策略 |
| 本地数据 | Room、DataStore | 集合、同步操作与轻量设置分别保存 |
| 会话保护 | Android Keystore、AES-GCM | 第一方 CookieJar 隔离，会话加密持久化 |
| 图形 | WebView、AndroidX WebKit、Three.js / WebGL 2 / GLSL | 局部复用优先验证，资源随 App 打包，消息桥受限 |
| 国际化 | Android 字符串资源、AppCompat 语言 API | 中文、英文与系统恢复 |
| 构建 | Android Studio、Gradle Kotlin DSL、Wrapper、Version Catalog | 独立于 pnpm 的 Android 工具链 |
| 测试 | JUnit、协程测试、MockWebServer、Room 迁移测试、Compose UI Test、Espresso/UIAutomator | 业务、数据、页面及必要系统交互，后台音频须实机验证 |

具体版本与 SDK 范围在工程初始化时核对并冻结，当前没有 Gradle、原生播放、图形设备或 APK/AAB 构建验收结果。既有网页 Android 浏览器验收不等于原生客户端验收。

## 后端与数据

| 范畴 | 选型 | 约定 |
| --- | --- | --- |
| 运行时 | Node.js 24 LTS | 开发、CI、生产统一版本 |
| 语言与模块 | TypeScript、ES Modules | 明确共享包与服务端边界 |
| HTTP 服务 | Fastify 5 | REST API |
| 契约校验 | Zod、兼容的 Fastify 类型适配器 | 统一请求与响应约束 |
| 接口文档 | OpenAPI、Swagger UI | 由接口 Schema 生成 |
| 日志 | Pino | JSON 结构化日志 |
| 定时任务 | node-cron | 独立任务进程中调度 |
| 开发运行 | tsx | 本地监听和 TypeScript 执行 |
| 生产编译 | tsc | 编译为 JavaScript 后运行 |
| 数据库 | 当前目标 MySQL 8.0.46 | InnoDB、utf8mb4、utf8mb4_general_ci，独立数据库服务 |
| 数据驱动 | mysql2 | API 与任务分别使用有限连接池 |
| 数据访问 | Drizzle ORM | 类型化查询 |
| 数据库迁移 | Drizzle Kit | 唯一迁移执行工具，开发生成、审核测试、发布执行 |

## 工程与部署

| 范畴 | 选型 |
| --- | --- |
| 仓库与依赖 | pnpm Workspace、单一 pnpm-lock.yaml |
| 静态检查与格式 | ESLint、typescript-eslint、Prettier |
| 单元与组件测试 | Vitest、React Testing Library |
| API 集成测试 | Fastify inject、独立 MySQL 8.0.46 测试库 |
| 浏览器测试 | Playwright |
| 覆盖率 | Vitest V8 Coverage |
| CI/CD | Jenkins Pipeline，手动触发发布 |
| 容器与编排 | Docker、Docker Compose |
| Web 入口 | 现有 Nginx，提供静态资源、HTTPS 和反向代理；Caddy 2 仅用于隔离产物验收 |
| 服务器基线 | Ubuntu 24.04 LTS |
| 后端镜像基线 | Node.js 24、Debian slim |

上表的 pnpm、JavaScript 检查与服务发布适用于 Web/Server；Android 使用上节独立 Gradle 工具链，后续签名与分发按渠道另行接入，不自动加入现有服务发布任务。

## 版本与依赖边界

上表指定的主版本作为基线。未指定版本的包在初始化时选择兼容的正式稳定版，固定具体版本并提交锁文件。候选版本的包元数据核对不等于完整集成验收。

初始化时需重点核对 React 与相关组件包、Vite 与插件及测试工具、TypeScript 与检查工具、Fastify 与校验和 OpenAPI 插件、Drizzle ORM 与 Drizzle Kit、Three.js 与类型声明之间的兼容性。

Android 初始化另行核对 JDK、AGP、Gradle、Kotlin/Compose 编译器、KSP、Hilt、Room、Navigation 3 和目标 SDK 的兼容组合；通过 Wrapper 与版本目录固定版本，Compose 使用 BOM，Media3 各模块统一版本。不将讨论中的历史版本表当作已通过构建的依赖组合。

按需加载图形和 HLS 模块。外部服务通过后端适配器接入，其供应商与授权配置待具体需求确定；数据库只由后端、后台任务及受控迁移入口访问；API 与任务不挂载数据库数据卷。生产禁止直接 Schema 推送，迁移工具和数据库连接仍待初始化。

选型依据与边界见[架构决策](../architecture/decisions/0001-stack-and-deployment.md)。版本冻结流程见[环境与依赖](../engineering/environment-and-dependencies.md)。

实际数据库版本与建表选项已由 [ADR-0003](../architecture/decisions/0003-table-options-and-target-environment.md) 更新，具体默认值及字符列例外见[表选项与排序规则](../data/database/table-options-and-collations.md)。版本元数据读取不代替应用兼容性验收。
