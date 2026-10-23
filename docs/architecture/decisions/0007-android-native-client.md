# ADR-0007：原生 Android 客户端与局部图形复用

日期：2026-10-23。状态：技术路线已确定；开发目录与文档已建立，原生工程及图形验证待实施。本记录扩展客户端平台，不替代既有 Web、后端或部署决策。

## 背景

声屿已有手机网页、电台目录、播放和 Three.js 地球/沉浸场景。Android 客户端需要延续视觉和业务体验，并在后台收听、系统媒体控制、设备本地数据和生命周期方面形成明确的原生实现。

## 决定

- 主体采用 Kotlin、Jetpack Compose、定制 Material 3、ViewModel、单向数据流、Coroutines/StateFlow 和 Hilt/KSP。
- 导航采用 Navigation 3；网络与序列化采用 OkHttp、Retrofit、kotlinx.serialization；图片采用 Coil；本地集合使用 Room，设置使用 DataStore。
- 原生播放使用 Media3 ExoPlayer、MediaSessionService、MediaController。播放事实、重试、备用线路、自动换台与睡眠计时由原生服务持有。
- 地球和沉浸场景优先验证局部 WebView 复用既有 Three.js；图形资源随客户端打包，原生以受限消息协议提供数据和状态，图形上报选台等交互。
- 继续使用现有 Fastify REST API、公开契约和 Cookie 会话，不创建另一套账号或数据库访问通道。
- Android 源码位于 `apps/android`，专题文档位于 `docs/android`；构建由 Gradle 管理，图形资源如需抽取则沿用锁定的 JavaScript 工具链。

## 方案权衡

| 路线 | 评估 |
| --- | --- |
| 原生主体与局部图形复用 | 直接接入 Android 媒体和数据能力，同时减少图形重写；需要维护消息桥及两种渲染生命周期，本项目选用 |
| Capacitor 复用整站 | 适合以共用网页页面和缩短首次交付为主要目标；仍需原生音频层，本次不作为客户端主体 |
| React Native 或 Flutter | 适合明确的双平台投入；现有 DOM/CSS 页面仍需改写，本次仅 Android 目标下不增加此技术栈 |
| 全部原生图形 | 系统集成一致，但需要重写场景、着色器、相机和点选；作为复用验证不通过时的调整选项 |

本表是项目工程判断，不表示已测得各路线的性能、成本或工期。

## 约束与影响

- 原生界面和客户端业务需实施，网页视觉与规则可沿用，TypeScript/Zod 不能直接作为 Kotlin 代码使用。
- 原生播放不得依赖网页 JavaScript 在后台持续执行；全客户端只保留一个权威播放状态。
- WebView 不持有账号会话或私密配置；来源、导航、消息类型、载荷大小及资源释放有明确边界。
- 第一方 API 的 CookieJar 与电台音频、图片、图形请求隔离；持久会话使用 Keystore 密钥与 AES-GCM。
- 不引入支付、第三方登录或额外媒体商业 SDK；既有生产音频流量继续由客户端直连电台。
- 工具链和依赖在实际初始化时核对并固定，当前不将任意历史版本表视为已验证基线。

## 验证状态

本次只完成目录、规范、技术文档及适用的文档检查。Android 构建、播放、图形性能、设备测试、签名和发布均未执行；既有手机浏览器测试不能替代这些结果。

后续先完成原生播放纵向流程和独立图形验证页，检查拖动缩放、点选、触摸叠层、帧表现、内存、后台恢复和图形失败降级，再决定局部 WebView 的正式接入范围。

## 调整触发条件

目标变为 Android/iOS 同步交付、要求网页与 App 共用页面、局部 WebView 的交互或性能验证不通过、需要 Android Auto/电视等新平台，或出现明确支付与渠道要求时，重新评估对应部分并追加决策。

详细实现约束见[Android 技术方案](../../android/technical-design.md)，实际建立结果见[任务记录](../../iterations/2026-10-23-android-development-foundation/README.md)。

返回[决策索引](README.md)。
