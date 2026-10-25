# 声屿 HAEN Android 协作规范

本文件适用于 `apps/android/` 及其子目录，并补充[根协作规范](../../AGENTS.md)。跨应用接口、数据、Git 同步与发布继续遵守根规范；本文件不改变现有 Web/Server 的技术基线。

## 1. 开始工作

- 先阅读根规范、本文件、[Android 技术方案](../../docs/android/technical-design.md)及任务涉及的专题文档。
- 检查分支、工作区、暂存区和现有实现，保留其他任务改动，只提交本次任务内容。
- 当前已有单应用 Gradle 工程、原生页面、播放、存储、账号与局部图形实现。实际构建和设备验证以 Android 专题记录为准；不得把技术选型、编译或网页 Android 浏览器验收等同于原生真机验收。
- Kotlin 职责目录统一位于 `app/src/main/kotlin/xyz/hahaen/radio`，namespace/applicationId 均为 `xyz.hahaen.radio`；保留应用身份与签名连续性。
- 技术调整同步[集中技术基线](../../docs/overview/technology-stack.md)、Android 专题文档和相关架构决策。

## 2. 技术与工具链

- Kotlin、Jetpack Compose、定制 Material 3 主题；单 Activity，采用 Navigation 3 管理页面与返回栈。
- ViewModel、单向数据流、Repository、Coroutines/Flow/StateFlow；依赖注入采用 Hilt，代码生成采用 KSP。
- 网络采用 OkHttp 与 Retrofit，JSON 采用 kotlinx.serialization；DTO、领域模型和本地实体明确分开。
- 音频采用 AndroidX Media3 ExoPlayer、MediaSessionService、MediaController；Media3 各模块保持相同版本。
- Room 保存收藏、历史与待同步操作；DataStore 保存轻量设置；Coil 处理图片加载与缓存。
- 使用 Gradle Kotlin DSL、Gradle Wrapper 和版本目录集中管理依赖。首次初始化按官方兼容表固定 JDK、AGP、Gradle、Kotlin、Compose、KSP、Hilt 等版本，禁止动态版本；不要直接套用未验证的历史版本组合。
- Android 由 Gradle 管理，不为接入 pnpm Workspace 创建无用途的 `package.json`；pnpm 检查不能替代 Android 构建。
- 不提前引入支付、第三方登录、自有图片管线、自有磁盘缓存或无业务职责的多模块工程。

## 3. 状态与生命周期

- Compose 展示状态并提交操作，不直接调用 Retrofit、Room 或 ExoPlayer；通过生命周期感知方式收集界面状态。
- ViewModel 不持有 Activity、WebView 或播放器实例；播放器由服务管理，页面通过 MediaController 操作。
- 原生层持有播放状态与本地数据的权威快照，避免网页与原生各自维护一份可写播放状态。
- 网络操作可取消，限制超时、并发、响应大小和重试。搜索、换台与账号切换使旧任务失效，旧响应不得覆盖新状态。
- 初始化与销毁成对处理，释放 Controller、监听器、协程、WebView、WebGL 资源与消息连接。

## 4. 音频

- 背景收听、通知栏、锁屏与耳机操作统一接入同一个 MediaSession；按目标 Android 版本配置前台服务、权限、音频焦点和耳机断开行为。
- 重试、备用线路、自动换台和睡眠计时由原生播放层执行，不依赖 Activity 或 WebView 存活。
- 区分用户暂停、系统中断、断网、超时、编码失败和线路不可用；采用有限重试，暂停或换台后停止旧尝试。
- 直播不虚构时长或歌曲进度；元数据时间不作为歌曲起点。视觉声浪为播放状态装饰，不标注为真实音频频谱。
- 原生默认直连电台，后端提供目录和播放信息；不得未经专项评估新增全量音频代理或转码。

## 5. 图形与界面

- 开发界面前阅读[夜航设计规范](../../docs/frontend/design/night-voyage.md)，沿用墨绿、暖白、灰绿、珊瑚色及手机端的层级与构图，Material 3 使用定制主题。
- 地球和沉浸效果优先通过独立验证页评估局部 WebView 复用 Three.js，验证结果决定是否进入正式页面。
- 图形资源随客户端构建打包，用 WebViewAssetLoader 提供受控来源；消息桥检查来源、主框架、协议版本、消息类型及载荷边界。
- WebView 不接收账号会话、Cookie、私密配置或任意原生执行能力；页面外链交给系统浏览器，导航使用允许列表。
- 高频帧循环留在图形引擎，不逐帧跨桥或更新 Compose；后台、减少动态效果、省电和图形失败采用停帧或静态降级，播放仍可独立工作。
- 支持系统返回、手势导航、安全区、键盘、字体缩放、TalkBack、横屏和窄屏。Android 专属变更执行对应设备验证；修改共享 Web/图形资产时同时验证桌面和手机网页。

## 6. API、账号与本地数据

- 复用现有 REST/JSON 和 `packages/contracts` 的公开契约语义；Kotlin 不直接导入 TypeScript/Zod。契约变更考虑网页与不同客户端版本的兼容窗口。
- 当前账号使用服务端 Cookie 会话，不假定存在 Bearer Token、OAuth、刷新令牌或第三方登录接口。
- 原生 API CookieJar 仅供配置的第一方 HTTPS API 使用，不与图片、图形或电台音频请求共享；账号写请求遵循现有请求头、用户 ID 与版本校验。
- 持久会话采用 Android Keystore 管理的密钥与 AES-GCM 加密；不保存登录密码，不输出 Cookie、会话、认证头或个人集合内容。加密存储排除系统备份，密钥丢失时清理不可解密会话并要求重新登录。
- 游客与账号数据隔离，待同步操作绑定账号并持久化；处理冲突、删除、重试和切号，退出前明确处理未同步数据。
- Room Schema 版本化并提供迁移；不得用破坏性重建替代正式数据迁移。
- API 地址可作为公开环境配置，数据库凭据、外部服务密钥和签名密码不得进入客户端。实际签名文件、私有配置、SDK 本地路径与构建产物在创建时确认被 Git 排除；提交前核对完整暂存差异。

## 7. Review、验证与交付

- 每次更新 Android App 并交付新安装包时，必须在 `app/build.gradle.kts` 中递增 `versionName` 的补丁版本号，例如 `0.1.0 → 0.1.1 → 0.1.2`，同时将 `versionCode` 至少加 1；不能只增加 `versionCode` 而沿用显示版本号。小 bug 修复始终只加最后一段，例如 `0.1.9 → 0.1.10 → 0.1.11`，不向中间或第一段进位。同一次更新的重复构建、验证或 Debug / Release 构建复用同一组版本号，不因单次构建自动加号；仅修改文档且不更新 App 时无需递增。
- 交付前核对 APK 的 `versionName`、`versionCode` 与源码一致，同步当前版本说明与本轮交付记录；应用 ID 和正式签名保持连续。
- 遵循根规范：完成实现和必要文档后先 Review、修复并复审，再执行适用检查；同步远端后复审与复验，最后提交并分别推送两远端。
- 纯文档任务检查内容、链接、目录、状态一致性及 `git diff --check`；应用任务在工程初始化后执行实际存在的 Android lint、单元测试与 Debug 构建。
- 协程、播放策略与 Repository 用单元测试，网络边界用 MockWebServer，Room 用迁移测试，核心界面用 Compose UI Test；系统媒体交互按需使用 Espresso/UIAutomator。
- 真机验证前台/后台、锁屏、音频焦点、耳机、断网、换台和图形生命周期；模拟器、网页移动视口及媒体事件不能替代实际设备与听音验证。
- 归档需求、实际变更、Review、验证和未完成事项到 `docs` 对应主题，维护导航；纯排查按根规范只在对话反馈。
- 交付区分已选型、已实现、已编译、已实机验证及已发布；说明 APK/AAB 与服务更新范围。提交授权不代表签名发布、商店上传或生产部署授权。
