# Android 客户端技术方案

日期：2026-10-24。状态：单应用原生工程已实现并生成 Debug APK，正在进行 Review、修复与真机验收；逐项证据见 [验证状态](verification.md)。

## 1. 目标与路线

为声屿建立 Android 客户端，延续现有手机网页的电台探索、收听、搜索、收藏、历史、设置与沉浸体验。主要目标平台为 Android，采用 Kotlin 原生应用；现有 Fastify 后端和 REST 契约继续复用，数据库仅由服务端访问。

Compose 承载原生界面，Media3 承载音频。地球与沉浸效果已通过局部 WebView 复用 Three.js，提供原生静态降级；实际拖动、双指缩放、图形恢复和生命周期已取得当前真机证据，具体范围见验证状态。该结果不等于全部设备交互或性能已验证，达不到要求时仍需评估原生图形实现。

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
| 设置存储 | DataStore | 省电、减少动态效果、沉浸场景、图形开关及固定电台偏好；语言由 AppCompat 保存，当前无主题切换选项 |
| 会话保护 | Android Keystore、AES-GCM | 密钥保存在 Keystore，会话密文保存在应用私有存储 |
| 图形 | Android WebView、AndroidX WebKit、Three.js / WebGL 2 / GLSL | 已接入局部图形复用及原生静态降级 |
| 图形资源 | WebViewAssetLoader、现有 pnpm/Vite 工具链 | `apps/android/graphics` 独立 Vite 入口，Gradle preBuild 自动执行 |
| 国际化 | Android 字符串资源、AppCompat 语言 API | 与现有中文、英文界面保持一致，处理进程恢复与语言切换 |
| 单元与网络测试 | JUnit、kotlinx-coroutines-test、MockWebServer | 业务、状态流、超时、取消、重试与账号契约 |
| 数据与界面测试 | Room migration testing、Compose UI Test、Espresso / UIAutomator | 数据升级、页面和必要系统交互 |
| 构建 | Android Studio、Gradle Kotlin DSL、Gradle Wrapper、Version Catalog | 可复现的 Android 构建、统一依赖版本 |
| 检查与交付 | Android Lint、按需 Kotlin 格式检查、APK / AAB | 已配置 Lint 与 Debug APK 构建；正式发布签名、AAB 与渠道另行接入 |

ViewModel、分层和 Compose 的设计依据见 [Android 架构建议](https://developer.android.com/topic/architecture/recommendations)。导航采用面向 Compose 的 [Navigation 3](https://developer.android.com/guide/navigation/navigation-3)。

## 3. 工具链、SDK 与版本冻结

| 工具 | 固定值 |
| --- | --- |
| JDK | 17，实际构建使用 Temurin 17 |
| Gradle / Android Gradle Plugin | 9.3.1 / 9.1.1 |
| Kotlin / Compose 编译器 | 2.2.21；使用 AGP 内建 Kotlin，不重复应用 Android Kotlin 插件 |
| KSP / Hilt | 2.3.4 / 2.59.2 |
| Compose BOM / Navigation 3 | 2025.11.01 / 1.0.1 |
| Media3 / Room | 1.9.3 / 2.8.4 |
| compile / target / min SDK | 36 / 36 / 26 |
| Build Tools | 36.0.0 |
| namespace / applicationId | `xyz.hahaen.radio` |
| 版本 | `0.1.0`（versionCode 5） |

依据 [AGP 9.1 兼容说明](https://developer.android.com/build/releases/agp-9-1-0-release-notes)选择 Gradle 9.3.1、JDK 17 和 Build Tools 36.0.0。具体插件和依赖集中在 `gradle/libs.versions.toml`，Compose 使用 BOM，Media3 模块版本一致；不使用动态版本。Wrapper 固定分发 SHA-256，应用与构建设置的解析结果写入 Gradle 锁文件。

Android 构建由 Gradle 管理；图形使用根仓库固定的 Node.js 24.9.0、pnpm 12.5.1 和 `pnpm-lock.yaml`。SDK 从本机 `local.properties` 或显式 `ANDROID_HOME` 读取，文件被排除。公开 API 地址由模块 `BuildConfig.API_BASE_URL` 编译注入，当前指向第一方 HTTPS `/radio/api/v1/`；本应用不读取根目录服务端 `.env.local`，不携带数据库或部署凭据。

当前提供 Debug 与独立正式签名 Release 构建；Debug 使用本机 Android debug key，Release 显式读取私有签名配置。覆盖升级依赖相同应用 ID、相同签名和递增 versionCode；Debug 与 Release 签名不同，不能直接覆盖，不得通过卸载应用替代升级验收。商店分发未接入，Release 产物与验证见 [Android 导航](README.md#正式-release-交付)，构建、安装及升级命令见 [应用说明](../../apps/android/README.md)。

## 4. 工程与分层

当前为已注册的单一 `:app` 模块，源码位于 `app/src/main/kotlin/xyz/hahaen/radio/`：

| 目录职责 | 内容 |
| --- | --- |
| `app` | Activity、依赖注入、导航、主题及入口装配 |
| `feature` | 探索、搜索、收听清单、设置、账号与沉浸页面及 ViewModel |
| `data` | API DTO、Retrofit、Room、DataStore、Repository 实现及映射 |
| `domain` | 页面无关的业务模型、播放/同步策略；仅在职责实际出现时增加用例 |
| `playback` | Service、MediaSession、ExoPlayer、线路选择、睡眠和系统中断 |
| `graphics` | WebView 宿主、消息协议、场景资源与生命周期 |

先用一个 Android 应用模块按包隔离职责，不创建空 Gradle 多模块。达到编译、复用或团队边界需要时再拆模块。

`app/src/main` 另有 `res` 与 `assets/graphics`；`src/test`、`src/androidTest` 分别用于 JVM 和设备测试，`app/schemas` 版本化 Room Schema，`gradle/wrapper` 保存已校验 Wrapper。完整目录树见[应用说明](../../apps/android/README.md)。

实际目录已经包含构建脚本、Manifest、Wrapper、版本目录、Kotlin 源码、资源与测试；有实际文件的旧占位已移除。不要将未执行的设备项写为通过。

界面状态路径为 Compose → ViewModel → Repository；播放命令经 MediaController 进入 MediaSessionService。服务中的播放器状态是播放事实，ViewModel 与图形只消费快照，不另行推断或持有第二个播放器。Compose 使用生命周期感知收集，不持有网络请求与数据库操作。

依赖方向保持界面依赖业务接口、数据层实现接口，DTO 与 Room 实体不直接泄漏到页面。Activity、WebView 和 ExoPlayer 不由 ViewModel 持有，监听器、协程、Controller 和图形资源按所属生命周期释放。

## 5. 原生播放与后台行为

MediaSessionService 持有 ExoPlayer 与 MediaSession，界面使用 MediaController；通过前台媒体服务声明和适用权限接入通知栏、锁屏及耳机控制。实现方式依据 [Media3 后台播放](https://developer.android.com/media/media3/session/background-playback)，不能承诺进程被系统终止后仍无条件持续播放。

- 默认由原生播放器直连电台源，后端返回电台信息、候选线路和元数据；不新增全量音频代理或转码。
- 支持范围以 [Media3 格式说明](https://developer.android.com/media/media3/exoplayer/supported-formats)及实际设备解码结果为准，分别验证 MP3/AAC/HLS、重定向与必要请求头。
- 播放状态至少表达空闲、连接、播放、缓冲、暂停和失败，区分用户意图与播放器事实；快速换台使用请求代次或等效隔离，使旧回调失效。
- 重试、备用线路、自动换台及睡眠计时留在原生服务。参照现有[网页播放规则](../frontend/audio/audio-engine.md)保留有界尝试、固定电台和显式暂停语义；媒体恢复时重新核对播放意图，不因旧请求返回而擅自播放。
- build16 真机已验证离线选台解析期间系统暂停、恢复联网后继续保持暂停，只有再次主动选台才开播；该结果覆盖旧请求及网络恢复不得覆盖暂停意图的路径。
- 处理音频焦点、其他媒体抢占、来电中断、耳机断开和网络变化；规则与用户设置明确，不能把系统暂停当作坏线路无限重试。
- 睡眠计时在服务中保存截止信息，以适合持续计时的单调时钟核对；进程重建和设备重启有独立恢复策略，不依赖网页定时器，也不为此默认申请精确闹钟权限。
- 直播不注册虚构的 seek、总时长或歌曲进度；曲目与歌词按电台、线路和请求代次匹配。音频频谱、识曲和音量增强单独评估，装饰波纹不声称读取了真实声谱。
- 页面离开或图形失败不能重建播放器；服务停止、Controller 断开与进程恢复均需明确定义并验证。

应用界面不提供独立音量滑杆，用户通过硬件音量键或系统媒体音量面板调节。`MainActivity` 将 `volumeControlStream` 设为 `AudioManager.STREAM_MUSIC`，让前台音量键以媒体流为目标；build18 已由用户实际按手机实体音量键，确认实际声音正常且音量随按键变化。该证据限已执行设备与构建轮次，不推断真实耳机操作通过。

### 系统媒体卡片

通知栏、锁屏、耳机与应用界面继续共享同一个 MediaSession 和服务播放事实。`DefaultMediaNotificationProvider` 负责标准媒体通知，仅配置通知频道名称与 24dp 白色透明 `smallIcon`，不创建自定义 RemoteViews 或第二条媒体通知。封面在服务内按需生成一次：512×512 不透明墨绿底保留既有品牌 PNG 的颜色、比例和留白，辅以细珊瑚描边，作为 `MediaMetadata.artworkData` 提供，不引入封面网络请求或文件 URI 授权。

`RadioSessionPlayer` 仅装饰提供给 Session 的状态快照，不替换或重新准备底层 ExoPlayer 音源。标题取当前或待选 MediaItem 的电台名称；`artist` 与 `subtitle` 提供本地化连接/播放/暂停/失败状态及非空真实地点，`description` 标明品牌与直播电台。每次从原始站点元数据生成，避免状态文案重复拼接或待选电台沿用上一台信息。

Session 时间线统一标记为 LIVE、dynamic 且不可 seek，移除台内拖动、快进/快退等命令，保留上一台、播放/暂停和下一台。总时长为 `C.TIME_UNSET`，元数据 `durationMs` 不设置；会话位置供应器固定为零而不随时间递增，当前 Media3 的平台兼容层根据 LIVE 时间线输出未知位置和时长。此处表达广播直播语义，不以收听时间、元数据时间戳或虚构总时长充当歌曲进度。

Android 13（API 33）及以上的系统媒体卡片从 Session 读取元数据和按钮能力，不能靠通知 Provider 强制改写系统卡片，见 [Media3 通知定制说明](https://developer.android.com/media/media3/session/background-playback#notification-customization)。应用提供品牌素材与真实状态；整体布局、圆角、字体、输出设备入口、封面取色及进度控件的呈现由系统与 ROM 决定，不承诺固定配色或所有 ROM 都隐藏进度区域。实现与实际呈现分开验收，本轮通知栏、锁屏卡片的显示及操作结果以 [验证记录](verification.md) 为准。

build18 在本次 MIUI 真机上已确认品牌封面与白色通知图标实际显示，Playing/Paused 副标题与状态一致。平台 Session 的 `position`、`bufferedPosition` 均为 `-1`，不提供 `SEEK_TO` 动作，系统 UI 的 SeekBar 为 `enabled=false`；MIUI 仍显示 `00:00/00:00` 并采用浅灰绿色卡片。这是当前 ROM 对未知直播进度与封面的呈现，不表示应用提交了歌曲进度，也不作为其他 ROM 的显示结论。本轮换台、离线及锁屏真实操作仍分别记录，不由上述静态显示结果推定通过。

封面右下的小白耳机是系统媒体卡片使用通知 `smallIcon` 展示的应用来源标识，与大封面的用途不同，不承载额外操作。[Android 通知内容要求](https://developer.android.com/develop/ui/compose/notifications/create-notification#set-content)将小图标列为必需内容。本轮未找到仅隐藏该媒体卡片角标的公开 API；应用保留白色透明轮廓的有效图标，不使用全透明图标规避，也不将 `setBadgeIconType` 等桌面通知徽标配置当作此角标的开关。

## 6. 地球、沉浸与消息桥

现有[地球实现](../../apps/web/src/graphics/globe.ts)和[沉浸实现](../../apps/web/src/graphics/immersion-scene.ts)封装了 Three.js 场景，但仍依赖 DOM、主题变量及网页生命周期。复用需要独立适配，不能直接视为 Android 组件。

1. 抽取独立图形入口，复用图形源码与允许打包的资源，通过现有锁定的 JavaScript 工具链构建。避免复制一份难以同步的场景源码；包边界在抽取时建立并同步文档。
2. 图形产物随 APK/AAB 打包，由 [WebViewAssetLoader](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content)提供应用内受控 HTTPS 来源，不依赖在线网页首屏加载。
3. Compose 通过 AndroidView 宿主 WebView；图形只负责展示、相机和点选，原生负责数据、播放与账号。后端请求由原生层统一处理，WebView 不直接接收登录状态或会话。
4. 按 [Android 消息桥说明](https://developer.android.com/develop/ui/views/layout/webapps/native-api-access-jsbridge)优先使用 WebViewCompat.addWebMessageListener，先检测能力，限制允许来源和主框架；不支持时采用已验证的受限替代通道或静态降级，禁止通配来源暴露原生对象。

当前消息协议为 version 1，包含类型与有界载荷；跨桥不承担有副作用的账号请求。所有外部输入校验后使用：

| 方向 | 已实现消息 | 约束 |
| --- | --- | --- |
| 图形 → 原生 | ready、select、lost | 主框架、固定来源、最多 4096 字符；选台 ID 必须在当前目录或所选电台中 |
| 原生 → 图形 | reset、batch、complete、snapshot、active、destroy | 每批最多 250 站，总量最多 200000；快照含选择、播放、固定、前台、省电和场景；active 为显式布尔值，由原生生命周期直接发送；新页面重放完整快照 |

禁止传递 Cookie、账号凭据、任意脚本或可执行原生命令；电台元数据按文本处理，不拼接执行。导航限制在图形资源来源，外部页面交给系统浏览器。

帧循环和相机变化留在 Three.js 内，不逐帧经消息桥或触发 Compose 重组；按设备限制像素比与资源数量。后台隐藏时停止持续绘制，省电和减少动态效果关闭持续动画并降低图形开销；关闭图形、WebGL 丢失或 WebView 渲染进程失败时使用原生静态降级。前台恢复沿用现存场景，重新创建 WebView 时从原生重放完整快照。ON_STOP 在暂停 WebView 前直接发送 active=false，ON_START 恢复后直接发送 active=true，避免停止状态的 Compose 帧时钟延迟快照；释放标记拒绝已销毁实例的迟到回调。

消息桥的 WebView 调用必须在主线程执行，不依赖 `LaunchedEffect` 的运行环境隐含保证。目录批次序列化留在 `Dispatchers.Default`，各协程消息统一通过 `withContext(Dispatchers.Main.immediate)` 后再调用 `evaluateJavascript`。快照也在该主线程块内构造并读取最新 `active`，避免预先生成的活跃快照在排队后覆盖 ON_STOP 已发送的 inactive 状态；生命周期同步发送 active 的顺序保持不变。build15 导航回归暴露了工作线程发送消息的问题；修复复审后，build16 原导航测试用时 6.539 秒通过，地球与沉浸后台停绘、返回恢复也通过受影响真机复验。GL 检查采用主机时钟划分窗口，避免 WebView 后台 JavaScript 定时器节流改变测量区间；在途尾帧结束后两场景均连续四窗口无绘制，前台恢复持续绘制且画布始终为一个。

Android 图形入口在同一个 WebView 文档内最多保留地球与一个沉浸渲染器。进入沉浸页时暂停地球，返回时继续使用同一控制器、相机、几何与纹理；潮汐、远山和流光共用沉浸渲染器。隐藏图层使用 `visibility: hidden`、禁止命中与 `inert` 保留布局尺寸，避免切页触发零尺寸；隐藏沉浸层仍会降低像素比以减少开销；任意时刻只显示一层，后台两层均停止持续绘制。电台目录只在完整新批次后更新，不在每个播放快照或返回首页时重新分组与生成光图。竖屏 0.84、横屏 0.66 的地球舞台比例保持不变。

缓存不屏蔽图形失败：隐藏或后台图层丢失 context 时不影响当前健康画面，重新进入失效图层时仍交给原生降级；已恢复的地球 context 只重建该失效缓存。异步地形加载通过代次检查拒绝已切走或已销毁的创建请求，最终 `destroy` 释放两套控制器、context、图层与监听器。这取代普通切页时逐次销毁的方式；此前 build14/16 的单画布证据按历史轮次保留，当前验证应检查总画布不超过两个、仅一层可见、隐藏停绘及最终全部释放，实际结果见[验证记录](verification.md)。

外围星空由 `apps/android/graphics/starfield.ts` 创建独立 SVG，补齐未包含在 Three.js 地球渲染器中的装饰层。星点沿用固定分布、暖白与灰绿层次、少量柔光亮星和上下渐隐；窄屏减少密度及亮度。SVG 位于透明地球画布后方，设置 `pointer-events: none`、`aria-hidden` 和不可聚焦属性，不影响拖动、双指缩放或无障碍焦点。地球舞台比例保持竖屏 0.84、横屏 0.66，绘制画布仍覆盖完整可用视口。

星空仅在 `scene = globe` 且 `active` 时显示。亮星的缓慢明暗变化还要求实际播放、页面可见、未开启 `powerSave` 且不匹配 `prefers-reduced-motion`；原生减少动态效果与系统省电状态也合并到图形快照的省电字段。暂停、省电或减少动态效果保留静态星空，进入沉浸或非活跃状态隐藏。切页复用单一 SVG，`destroy` 移除 SVG、页面可见性与媒体查询监听器，并由场景入口清理窗口监听器和 Three.js 资源。

独立验证页先检查拖动/缩放/点选、Compose 浮层触摸、窄屏与横屏、连续切页资源释放、内存、帧表现和后台返回。实际地球显示已有原生设备证据，手势、生命周期和性能的完整通过范围见 [验证记录](verification.md)。

早前星空专项已通过 TypeScript、格式检查及 390×844、844×390 本地浏览器检查，覆盖静态/播放、省电、减少动态效果、场景隐藏、返回无重复图层、触摸命中画布和销毁。更新 APK 后，真机已观察到外围星点，并通过双指事件及缩放前、放大、还原截图确认缩放有效。build14 沉浸退后台后连续四个一秒窗口 GL 调用为零，回前台恢复绘制且音频持续播放；潮汐、远山、流光与返回地球的切换均释放旧 context，画布保持一个，地球星空恢复显示。build15 实际点击地球后原生目标切换并进入 PLAYING，完整点选播放通过。此证据限已执行的当前设备路径，不等同于长期内存或所有设备性能通过。

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

`StationDetailRequest.kt` 为电台详情 `GET /stations/:id` 增加一次有限重试：仅 SocketException、EOFException 及受限的响应头 EOF 包装可在 300 毫秒后再次请求，合计最多两次调用。等待及再次调用前检查协程取消，换台或暂停取消旧任务后不得继续发起请求；HTTP 错误、解析失败、证书、协议和响应大小超限不重试。该策略不扩展到账号或集合写操作。新增 9 项请求回归与 2 项契约测试已通过；build15 在两种原失败网络恢复脚本下均通过一次原生选台或播放操作恢复 PLAYING，无需用户第二次点击，完全断网仍会在有限尝试后进入可见错误。

当前账号接口使用 `haen_session` Cookie，登录响应通过 Set-Cookie 建立会话，并没有客户端 Bearer Token/刷新令牌接口。原生采用受限 CookieJar；账号写请求使用 `x-haen-request: 1` 和 JSON，集合请求携带预期 `userId`，保存时携带 `revision`。不伪造浏览器 Fetch Metadata，不为原生接入放松服务器既有校验。

第一方 API、图片和电台音频采用隔离的客户端配置；API 会话不得转发给电台、封面来源、图形 WebView 或跨来源重定向。生产 API 必须 HTTPS；HTTP 电台流的可用性、重定向与明文网络例外在接入时单独验证，不能通过全局关闭 TLS 校验或无差别放宽 WebView 网络限制解决。

源码已有能力不代表目标服务器已发布，接入前读取目标环境能力并验收。Android 第一版不要求修改数据库结构或新增后端账号体系。

## 8. 本地数据、会话与同步

Room 保存收藏、历史、账号快照、待同步操作与必要的有界目录缓存；DataStore 保存 `power_save`、`reduce_motion`、`scene`、`graphics` 和 `pinned` 五项偏好，不将大型集合序列化到设置。语言使用 AppCompat 的应用语言 API 与 `autoStoreLocales` 持久化；当前没有可选主题，界面统一使用夜航主题。选择依据见 [DataStore 与 Room 的适用范围](https://developer.android.com/topic/libraries/architecture/datastore)。

- 游客库与账号库按身份隔离，切号取消旧请求，待同步操作绑定用户及版本。收藏删除、版本冲突与失败重试保持现有服务端语义，具体上限由共享契约读取并在 Kotlin 中对应。
- 账号同步由 Repository/原生协程协调，待处理操作持久化；登录、本机变更、前台进入及网络恢复自动触发同步，前台每 30 秒拉取其他设备的变更，无需手动刷新。离开前台取消周期拉取，原待同步队列的有限重试继续保留；必要的可延迟后台同步再评估 WorkManager，不拿它执行持续播放或精准计时。
- 登出前完成同步，或明确让用户选择处理未同步数据；退出后恢复游客数据。浏览器 localStorage 不自动与 App Room 共享，迁移使用兼容的导入导出或登录后的服务端同步。
- 数据库 Schema 导出并版本化，升级提供 Room 迁移与数据保留测试；不采用生产破坏性回退重建。设置变更和数据库写入不得阻塞主线程。
- Cookie 会话为 30 天滑动有效期；服务端有效账号请求自动续期，客户端接收并加密保存新期限，连续 30 天无有效请求才过期；已过期或撤销的会话需重新登录。按来源、路径及 Secure 语义处理。持久会话采用 [Android Keystore](https://developer.android.com/privacy-and-security/keystore)中的密钥执行 AES-GCM，唯一随机 nonce 与密文一起保存，登录密码不持久化。
- 当前应用关闭系统备份，数据提取规则同时排除云备份和设备迁移中的 root、database、sharedpref、file 全部路径，覆盖会话、游客与账号集合及偏好。密钥丢失或解密失败时清理会话并重新登录；不把 DataStore/Room 的存在等同于数据已加密。
- 日志隐藏认证头、Cookie、签名配置、带敏感查询的 URL 和个人集合；错误记录状态与 requestId，避免输出完整网络响应。

## 9. 视觉、国际化与可访问性

遵循[夜航设计规范](../frontend/design/night-voyage.md)和手机页面的当前层级：墨绿底、暖白字、灰绿辅助色、珊瑚强调，保留透明收听区、衬线展示标题和地图定位精度。Material 3 使用定制颜色、形状与排版，默认不让系统动态取色覆盖品牌主题。

首页与沉浸页采用居中的主播放操作组，播放/暂停位于上一台和下一台之间，常规尺寸为 72dp、紧凑布局为 64dp；收藏、分享、固定等次要操作单独排列在下方。收听信息仅在超过可用高度时局部滚动，避免长台名或大字体将主按钮挤出屏幕。可用高度低于 430dp 且宽度至少 600dp 时改为左侧信息与右侧 248dp 控制组，避免宽屏纵向堆叠压缩详情；极短高度保留各自必要滚动。界面移除独立音量控件，音量交给系统媒体控制。

搜索、收听清单、设置和账号页使用悬浮迷你播放器，与系统导航安全区及页面边缘保留间距；台名和状态构成可返回首页的信息区域，播放/暂停与下一台为独立操作。窄屏或大字体时允许上下排列，键盘展开时隐藏，避免遮挡输入。迷你播放器的 1.5 倍字体竖屏布局，以及 build14 首页和沉浸页的 890×400 横屏大字体布局已通过真机截图检查；其余交互按验证记录保留实际通过范围。

收藏与清单展示在 `NavEntry` 内容内读取当前账号、带 owner 标记的集合和播放 State，再派生可见集合及当前电台收藏状态；owner 不匹配时显示空集合。避免 Navigation 3 在返回栈未变化时复用内容闭包，令外层已算好的普通值停留在旧快照。真机曾出现地球换台后台名及播放已更新、收藏心形仍显示上一台状态，往返设置后才刷新的问题；该修复同时覆盖 `LibraryScreen`。build15 已验证换台与收藏操作立即刷新心形、清单取消收藏后原地移除、返回首页及设置往返状态一致，原账号与临时账号数据未受游客操作影响。

支持中文、英文，通过 Android 字符串资源和 AppCompat 语言 API 切换；请求语言按接口实际支持发送，不假设后端已经按 Accept-Language 翻译电台数据。外部电台名保留真实内容，覆盖长文字与其他语言。

字体复用角色和许可，原生字体使用 Android 支持的格式，不能将 Web WOFF2 直接作为 Compose 字体；资源转换或重新获取时保留版权许可和版本信息，缺字使用系统回退。详见[现有字体约定](../frontend/design/fonts.md)。

验证安全区、系统栏、手势返回、键盘、横屏、窄屏、字体放大、TalkBack 与至少 48dp 的原生触控目标；原生触控单位不照抄网页 CSS 像素。系统动效缩放、应用减少动态效果与省电设置共同影响装饰动画，图形失败不遮挡收听操作。

首页与沉浸页的原生三条声波随真实播放状态起伏，属于状态装饰而非音频频谱。动画仅在页面 Lifecycle 为 RESUMED、实际播放且非连接状态、应用省电与减少动态效果均关闭、系统省电关闭时创建；监听系统省电广播并在组件销毁时注销。使用 Compose 无限过渡提供周期，Canvas 在绘制阶段读取相位、错开三条线的高度，不驱动页面逐帧重组或测量；条件不满足时移除过渡并保留静态图标，系统动效缩放由 Compose 管理。

## 10. 验证与构建交付

按实际变更执行 Review → 修复复审 → 检查/测试/构建，具体命令见应用 README。工程已具备 Wrapper；以下为所需验证范围，实际通过项与未验证项集中在 [验证记录](verification.md)。

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

APK 用于设备安装，AAB 用于需要该格式的分发渠道。正式签名私钥与密码由受限本地配置或 CI 凭据注入，不提交、不嵌入客户端、不打印；SDK 路径、签名文件、私有配置及 Gradle/Android 产物在创建时配置忽略规则并核对未被跟踪。Debug 使用 Android debug key 并已有真机安装证据；Release 已接入独立本地正式签名，产物验证单独记录。尚无 Release 真机安装、AAB 上传或商店发布结果。

## 11. 实现边界与验收状态

- 已实现探索、搜索、多选筛选、收藏筛选、播放、收藏、历史、设置、睡眠、账号和沉浸页面。Native Canvas 提供离线静态地理与场景降级。
- 目录使用 format 1 的紧凑 scene 元组，以版本与 `restrictionsRevision` 作为缓存身份；分块保存、分段读取，失败后复用已完成块，保持上一份完整目录。收藏/历史大集合也分段读取，避免 CursorWindow 单行限制。
- 账号库与待同步操作按 owner 隔离。同步网络不持有本地事务锁；revision 冲突最多重试三轮，并在提交响应时重放同步期间新操作。队列上限 10000，达到上限时拒绝新操作并明确反馈，不静默删除已有删除意图。
- 会话响应通过请求代次校验；退出或登录取消后，迟到 Set-Cookie 不得恢复旧会话。API、音频与 WebView 客户端隔离。
- 睡眠定时使用服务内单调时钟；进程终止后不自动恢复播放或睡眠，需用户重新选择。Room 首次 Schema 为版本 1，目前没有已发布旧 Schema 的迁移路径；不使用破坏性重建。
- 本地正式 Release 签名已接入，AAB 和商店发布未执行；Release 与 Debug 的验证记录分开。真实账号同步、临时第二账号退出与重登隔离、多端冲突、标准音频焦点和已检查布局已有真机通过证据。build15 的首次原生选台立即退后台交接、两个网络恢复原失败脚本、完整地球点选播放及收藏即时刷新均通过。build16 已覆盖安装且三个 owner 库及待同步队列保留，原导航、原同 UID 焦点、消息桥线程修复后后台停绘及解析期间暂停恢复均通过；build18 已获得用户实际听音与实体音量键确认，锁屏通知层四个媒体按钮已实际操作通过，用户已切回原账号并完成持久会话与服务端只读对账。build19 图形入口的地球缓存、往返停顿、隐藏停绘、后台恢复、图形降级、横竖屏与原生导航均已受影响复验；播放和账号实现本轮未改。真实耳机按键与断开仍未执行；用户于 2026-10-24 明确要求本轮暂缓耳机测试，因此本轮其他核心验收已完成，该项保留未验证并后续独立补验，实际范围以验证记录为准。

现有 API 契约可复用，本次没有数据库迁移、服务端或网页发布。本次无需更新服务；需要重建安装 Android APK。最初目录记录保留为历史材料，不代表当前工程状态。最新证据见 [验证记录](verification.md)。

返回 [Android 导航](README.md)或[文档总导航](../README.md)。
