# Android 客户端技术方案

日期：2026-10-23。状态：技术路线已确定；本次仅建立目录、规范与文档，尚未初始化 Gradle 工程、安装 Android 依赖、实现客户端或生成安装包。

## 1. 目标与路线

为声屿建立 Android 客户端，延续现有手机网页的电台探索、收听、搜索、收藏、历史、设置与沉浸体验。主要目标平台为 Android，采用 Kotlin 原生应用；现有 Fastify 后端和 REST 契约继续复用，数据库仅由服务端访问。

Compose 承载原生界面，Media3 承载音频。地球与沉浸效果优先验证局部 WebView 复用 Three.js 的可行性；通过真机验证后接入，达不到交互或性能要求时保留静态降级并重新评估原生图形实现。图形方案的选型不等于性能已验证。

本次不引入 Capacitor、React Native、Flutter、腾讯 LiteAV、VK 登录或支付 SDK。未来明确双平台、发行渠道或付费需求时新增决策，不预先加入依赖。选型理由与调整条件见 [ADR-0007](../architecture/decisions/0007-android-native-client.md)。

## 2. 完整技术栈

| 方面 | 选型 | 用途与边界 |
| --- | --- | --- |
| 开发语言 | Kotlin | 页面、业务逻辑、服务和基础设施 |
| 界面 | Jetpack Compose、Material 3 | 原生页面、浮层和定制夜航主题 |
| 架构 | ViewModel、单向数据流、Repository | 界面消费状态、提交操作，数据访问在 Repository |
| 异步与状态 | Kotlin Coroutines、Flow / StateFlow | 请求、取消、并发与响应式状态；生命周期感知收集 |
| 依赖注入 | Hilt、KSP | 装配 Repository、网络、数据库、服务与 ViewModel |
| 导航 | Navigation 3、单 Activity | 返回栈、页面状态恢复与后续深链 |
| 网络 | OkHttp、Retrofit | 声明式 REST API、CookieJar、超时、取消与错误映射 |
| JSON | kotlinx.serialization | Kotlin DTO 解析，补充必要的领域约束校验 |
| 图片 | Coil | 电台图标与封面加载、解码和有界缓存 |
| 音频 | AndroidX Media3 ExoPlayer、HLS 模块 | MP3/AAC/HLS 等电台流；实际编码与设备能力分别验证 |
| 系统媒体 | MediaSessionService、MediaSession、MediaController | 后台播放、通知、锁屏与系统媒体操作 |
| 集合存储 | Room | 游客/账号隔离的收藏、历史、同步快照与待处理操作 |
| 设置存储 | DataStore | 语言、主题、播放与画面偏好，少量类型化数据 |
| 会话保护 | Android Keystore、AES-GCM | 密钥保存在 Keystore，会话密文保存在应用私有存储 |
| 图形 | Android WebView、AndroidX WebKit、Three.js / WebGL 2 / GLSL | 局部图形复用；通过独立真机验证后接入 |
| 图形资源 | WebViewAssetLoader、现有 pnpm/Vite 工具链 | 独立图形资源构建与应用内打包，尚未建立构建入口 |
| 国际化 | Android 字符串资源、AppCompat 语言 API | 与现有中文、英文界面保持一致，处理进程恢复与语言切换 |
| 单元与网络测试 | JUnit、kotlinx-coroutines-test、MockWebServer | 业务、状态流、超时、取消、重试与账号契约 |
| 数据与界面测试 | Room migration testing、Compose UI Test、Espresso / UIAutomator | 数据升级、页面和必要系统交互 |
| 构建 | Android Studio、Gradle Kotlin DSL、Gradle Wrapper、Version Catalog | 可复现的 Android 构建、统一依赖版本 |
| 检查与交付 | Android Lint、按需 Kotlin 格式检查、APK / AAB | 工程建立后配置；发布签名与渠道另行接入 |

ViewModel、分层和 Compose 的设计依据见 [Android 架构建议](https://developer.android.com/topic/architecture/recommendations)。导航采用面向 Compose 的 [Navigation 3](https://developer.android.com/guide/navigation/navigation-3)。

## 3. 工具链、SDK 与版本冻结

- 语言与库的技术选型已确定，具体版本未冻结；不把讨论中列出的 Kotlin、Hilt、Navigation Compose 等历史版本直接作为已验证组合。
- 工程初始化时依据 [AGP 官方兼容说明](https://developer.android.com/build/releases/gradle-plugin)选定 JDK、Gradle 与 AGP，再核对 Kotlin/Compose 编译器、KSP、Hilt、Room 与 Navigation 3 的兼容性。按选定 AGP 的 Kotlin 集成方式配置，避免重复应用不兼容插件。
- 使用 Gradle Wrapper 固定分发版本与校验摘要，通过 `gradle/libs.versions.toml` 集中固定库和插件版本；Compose 使用 BOM，Media3 模块统一版本，不使用 `+` 或随时间漂移的动态版本。
- `minSdk` 建议从 API 26 评估；实际目标设备、所选依赖最低要求及发行范围确认后冻结。`compileSdk`、`targetSdk` 按初始化时正式稳定 SDK、依赖要求与目标渠道政策共同确定。当前不宣称已配置 SDK 范围。
- applicationId、namespace、versionCode、versionName 和签名身份在工程初始化与发布接入时确定，不能以文档占位值生成正式包。
- Android 构建由 Gradle 管理；pnpm 只管理现有 Web/Server 和未来抽取的图形资源构建。根目录 pnpm 检查不代表 Android 已参与构建。

## 4. 工程与分层

当前应用目录仅有 [README](../../apps/android/README.md) 和 [AGENTS.md](../../apps/android/AGENTS.md)。下列为后续单应用模块内的包职责规划，尚未创建：

| 规划职责 | 内容 |
| --- | --- |
| `app` | Activity、依赖注入、导航、主题及入口装配 |
| `feature` | 探索、搜索、收听清单、设置、账号与沉浸页面及 ViewModel |
| `data` | API DTO、Retrofit、Room、DataStore、Repository 实现及映射 |
| `domain` | 页面无关的业务模型、播放/同步策略；仅在职责实际出现时增加用例 |
| `playback` | Service、MediaSession、ExoPlayer、线路选择、睡眠和系统中断 |
| `graphics` | WebView 宿主、消息协议、场景资源与生命周期 |

先用一个 Android 应用模块按包隔离职责，不创建空 Gradle 多模块。达到编译、复用或团队边界需要时再拆模块。

界面状态路径为 Compose → ViewModel → Repository；播放命令经 MediaController 进入 MediaSessionService。服务中的播放器状态是播放事实，ViewModel 与图形只消费快照，不另行推断或持有第二个播放器。Compose 使用生命周期感知收集，不持有网络请求与数据库操作。

依赖方向保持界面依赖业务接口、数据层实现接口，DTO 与 Room 实体不直接泄漏到页面。Activity、WebView 和 ExoPlayer 不由 ViewModel 持有，监听器、协程、Controller 和图形资源按所属生命周期释放。

## 5. 原生播放与后台行为

MediaSessionService 持有 ExoPlayer 与 MediaSession，界面使用 MediaController；通过前台媒体服务声明和适用权限接入通知栏、锁屏及耳机控制。实现方式依据 [Media3 后台播放](https://developer.android.com/media/media3/session/background-playback)，不能承诺进程被系统终止后仍无条件持续播放。

- 默认由原生播放器直连电台源，后端返回电台信息、候选线路和元数据；不新增全量音频代理或转码。
- 支持范围以 [Media3 格式说明](https://developer.android.com/media/media3/exoplayer/supported-formats)及实际设备解码结果为准，分别验证 MP3/AAC/HLS、重定向与必要请求头。
- 播放状态至少表达空闲、连接、播放、缓冲、暂停和失败，区分用户意图与播放器事实；快速换台使用请求代次或等效隔离，使旧回调失效。
- 重试、备用线路、自动换台及睡眠计时留在原生服务。参照现有[网页播放规则](../frontend/audio/audio-engine.md)保留有界尝试、固定电台和显式暂停语义；媒体恢复时重新核对播放意图，不因旧请求返回而擅自播放。
- 处理音频焦点、其他媒体抢占、来电中断、耳机断开和网络变化；规则与用户设置明确，不能把系统暂停当作坏线路无限重试。
- 睡眠计时在服务中保存截止信息，以适合持续计时的单调时钟核对；进程重建和设备重启有独立恢复策略，不依赖网页定时器，也不为此默认申请精确闹钟权限。
- 直播不注册虚构的 seek、总时长或歌曲进度；曲目与歌词按电台、线路和请求代次匹配。音频频谱、识曲和音量增强单独评估，装饰波纹不声称读取了真实声谱。
- 页面离开或图形失败不能重建播放器；服务停止、Controller 断开与进程恢复均需明确定义并验证。

## 6. 地球、沉浸与消息桥

现有[地球实现](../../apps/web/src/graphics/globe.ts)和[沉浸实现](../../apps/web/src/graphics/immersion-scene.ts)封装了 Three.js 场景，但仍依赖 DOM、主题变量及网页生命周期。复用需要独立适配，不能直接视为 Android 组件。

1. 抽取独立图形入口，复用图形源码与允许打包的资源，通过现有锁定的 JavaScript 工具链构建。避免复制一份难以同步的场景源码；包边界在抽取时建立并同步文档。
2. 图形产物随 APK/AAB 打包，由 [WebViewAssetLoader](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content)提供应用内受控 HTTPS 来源，不依赖在线网页首屏加载。
3. Compose 通过 AndroidView 宿主 WebView；图形只负责展示、相机和点选，原生负责数据、播放与账号。后端请求由原生层统一处理，WebView 不直接接收登录状态或会话。
4. 按 [Android 消息桥说明](https://developer.android.com/develop/ui/views/layout/webapps/native-api-access-jsbridge)优先使用 WebViewCompat.addWebMessageListener，先检测能力，限制允许来源和主框架；不支持时采用已验证的受限替代通道或静态降级，禁止通配来源暴露原生对象。

计划消息协议包含版本、类型、请求标识与有界载荷，所有外部输入校验后使用。下表是待实现的消息职责，不表示协议代码已存在：

| 方向 | 计划消息 | 约束 |
| --- | --- | --- |
| 图形 → 原生 | ready、选台、预览、手动交互、图形丢失 | 原生验证电台 ID 与当前目录；选台后由原生处理播放 |
| 原生 → 图形 | 目录批次、选择、播放快照、定位、主题、画面偏好 | 版本隔离、分批传输、界限检查；新场景就绪后发送完整快照 |

禁止传递 Cookie、账号凭据、任意脚本或可执行原生命令；电台元数据按文本处理，不拼接执行。导航限制在图形资源来源，外部页面交给系统浏览器。

帧循环和相机变化留在 Three.js 内，不逐帧经消息桥或触发 Compose 重组；按设备限制像素比与资源数量。后台隐藏时停止图形绘制，省电、减少动态效果、WebGL 丢失或 WebView 渲染进程失败时使用静态降级，返回前台重建图形并从原生重放快照。

独立验证页先检查拖动/缩放/点选、Compose 浮层触摸、窄屏与横屏、连续切页资源释放、内存、帧表现和后台返回。此项结果决定正式接入；当前尚无原生图形验收数据。

## 7. 网络与已有后端契约

复用当前 `/api/v1` REST/JSON 接口；正式网关可能含 `/radio/` 站点前缀，按环境配置完整 API 基址，避免 Retrofit 的前导斜杠或 URL 拼接丢失路径。API 基址是公开配置，数据库、外部服务与部署凭据只留服务端。

| 能力 | 现有接口或契约入口 |
| --- | --- |
| 目录与场景数据 | `/api/v1/catalog`、`/catalog/scene` 及版本分块，见[目录 API](../backend/api/catalog.md) |
| 搜索、详情与线路 | `/api/v1/stations`、`/stations/:id`、`/stations/:id/streams` |
| 曲目与歌词 | `/api/v1/stations/:id/now-playing`、`/api/v1/lyrics`，见[曲目 API](../backend/api/tracks.md) |
| 能力与可选识曲 | `/api/v1/capabilities`、`/stations/:id/recognition`；受服务端能力与额度控制，见[识曲 API](../backend/api/recognition.md) |
| 账号与集合 | `/api/v1/account/session`、`/login`、`/logout`、`/library`，见[账号路由](../../apps/server/src/modules/accounts/routes.ts)与[共享契约](../../packages/contracts/src/account.ts) |

表中缩写路径相对于对应能力的前缀；完整方法、字段与错误码以源码和专题接口文档为准。客户端 DTO 手动映射或在后续验证过的生成流程中产生，Kotlin 不直接执行 Zod/TypeScript。处理可空字段、未知字段、枚举扩展与业务约束，错误解析遵守[统一 API 约定](../backend/api/conventions.md)。

搜索采用分页接口追加、去重和请求隔离；输入变化取消旧请求，旧页不得混入新查询。网络配置限制超时、并发、响应大小和重试，写操作失败不盲目重复；图片与持续音频使用各自资源策略。

当前账号接口使用 `haen_session` Cookie，登录响应通过 Set-Cookie 建立会话，并没有客户端 Bearer Token/刷新令牌接口。原生采用受限 CookieJar；账号写请求使用 `x-haen-request: 1` 和 JSON，集合请求携带预期 `userId`，保存时携带 `revision`。不伪造浏览器 Fetch Metadata，不为原生接入放松服务器既有校验。

第一方 API、图片和电台音频采用隔离的客户端配置；API 会话不得转发给电台、封面来源、图形 WebView 或跨来源重定向。生产 API 必须 HTTPS；HTTP 电台流的可用性、重定向与明文网络例外在接入时单独验证，不能通过全局关闭 TLS 校验或无差别放宽 WebView 网络限制解决。

源码已有能力不代表目标服务器已发布，接入前读取目标环境能力并验收。Android 第一版不要求修改数据库结构或新增后端账号体系。

## 8. 本地数据、会话与同步

Room 保存收藏、历史、账号快照、待同步操作与必要的有界目录缓存；DataStore 保存语言和画面等小型偏好，不将大型集合序列化到设置。选择依据见 [DataStore 与 Room 的适用范围](https://developer.android.com/topic/libraries/architecture/datastore)。

- 游客库与账号库按身份隔离，切号取消旧请求，待同步操作绑定用户及版本。收藏删除、版本冲突与失败重试保持现有服务端语义，具体上限由共享契约读取并在 Kotlin 中对应。
- 账号同步由 Repository/原生协程协调，待处理操作持久化，前台进入、网络恢复和显式刷新触发同步；必要的可延迟后台同步再评估 WorkManager，不拿它执行持续播放或精准计时。
- 登出前完成同步，或明确让用户选择处理未同步数据；退出后恢复游客数据。浏览器 localStorage 不自动与 App Room 共享，迁移使用兼容的导入导出或登录后的服务端同步。
- 数据库 Schema 导出并版本化，升级提供 Room 迁移与数据保留测试；不采用生产破坏性回退重建。设置变更和数据库写入不得阻塞主线程。
- Cookie 会话按有效期、来源、路径及 Secure 语义处理。持久会话采用 [Android Keystore](https://developer.android.com/privacy-and-security/keystore)中的密钥执行 AES-GCM，唯一随机 nonce 与密文一起保存，登录密码不持久化。
- 会话密文排除系统备份与设备迁移；密钥丢失或解密失败清理会话并重新登录。游客与个人集合的备份范围另行明确，不把 DataStore/Room 的存在等同于数据已加密。
- 日志隐藏认证头、Cookie、签名配置、带敏感查询的 URL 和个人集合；错误记录状态与 requestId，避免输出完整网络响应。

## 9. 视觉、国际化与可访问性

遵循[夜航设计规范](../frontend/design/night-voyage.md)和手机页面的当前层级：墨绿底、暖白字、灰绿辅助色、珊瑚强调，保留透明收听区、衬线展示标题和地图定位精度。Material 3 使用定制颜色、形状与排版，默认不让系统动态取色覆盖品牌主题。

支持中文、英文，通过 Android 字符串资源和 AppCompat 语言 API 切换；请求语言按接口实际支持发送，不假设后端已经按 Accept-Language 翻译电台数据。外部电台名保留真实内容，覆盖长文字与其他语言。

字体复用角色和许可，原生字体使用 Android 支持的格式，不能将 Web WOFF2 直接作为 Compose 字体；资源转换或重新获取时保留版权许可和版本信息，缺字使用系统回退。详见[现有字体约定](../frontend/design/fonts.md)。

验证安全区、系统栏、手势返回、键盘、横屏、窄屏、字体放大、TalkBack 与至少 48dp 的原生触控目标；原生触控单位不照抄网页 CSS 像素。系统动效缩放、应用减少动态效果与省电设置共同影响装饰动画，图形失败不遮挡收听操作。

## 10. 验证与构建交付

工程建立后按实际变更执行 Review → 修复复审 → 检查/测试/构建，具体命令写入应用 README 后使用。本次没有 Gradle Wrapper，因此以下是计划验证范围，不是已运行命令或通过结果。

| 层级 | 验证范围 |
| --- | --- |
| 单元 | ViewModel、线路策略、有界重试、切台旧回调、睡眠截止、同步合并与切号 |
| 网络 | MockWebServer 验证解析、错误码、取消、Cookie 限域、超时、重定向与写入冲突 |
| 存储 | Room 升级、数据保留、游客/账号隔离、待同步恢复与失效会话 |
| 界面 | Compose 搜索、播放、收藏、设置、账号入口，文字放大与导航恢复 |
| 图形 | WebView 消息边界、交互、降级、生命周期和资源释放 |
| 实机系统 | 前台/后台、锁屏、耳机/蓝牙、焦点、中断、网络切换与实际听音 |
| 工程 | Android Lint、相关单元测试、Debug APK 构建；签名 Release/AAB 在发布接入时验证 |

先用可控 MP3/AAC/HLS 测试源区分引擎问题和外部线路问题，再验证真实电台。记录 Android 版本、设备、System WebView 版本、音源和测试范围；模拟器与网页手机视口不替代原生真机结果。

Android CI 与既有 Web/API/Jenkins 任务分开管理，后续按实际需要接入，不新增自动发布触发器。图形产物构建应绑定源码与锁文件版本；有依赖时先构建图形，再打包 Android，并在干净环境验证资源完整性。

APK 用于设备安装，AAB 用于需要该格式的分发渠道。正式签名私钥与密码由受限本地配置或 CI 凭据注入，不提交、不嵌入客户端、不打印；SDK 路径、签名文件、私有配置及 Gradle/Android 产物在创建时配置忽略规则并核对未被跟踪。当前没有签名、上传或商店发布结果。

## 11. 后续实施顺序与完成边界

1. 初始化工具链、Gradle Wrapper、版本目录和应用模块，冻结 SDK 与包身份，验证最小 Debug 构建。
2. 打通目录查询 → 原生播放 → 后台服务 → 系统媒体控制，验证取消与线路失败。
3. 建立独立图形验证页；通过后再接入探索与沉浸界面。
4. 实现搜索、Room 收藏历史、DataStore 设置和国际化，随后接入已有账号同步与安全会话。
5. 完成关键 UI 与设备验证，记录 Android 构建和图形结果，再按发行需求接入签名与分发。

以上均为后续工作，未在本次执行。本次建立结果与文档检查见[任务记录](../iterations/2026-10-23-android-development-foundation/README.md)；无需更新 Web 静态资源、API、后台任务、数据库或服务器配置。

返回[Android 导航](README.md)或[文档总导航](../README.md)。
