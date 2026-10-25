# 声屿 HAEN Android

Kotlin / Compose 原生客户端，应用 ID 与 namespace 为 `xyz.hahaen.radio`，版本 `0.1.0`（versionCode 6），最低 Android 8（API 26），compile/target API 36。当前提供 Debug 与独立正式签名的 Release 构建，既有 Debug 核心真机验收已通过，耳机专项按用户要求暂缓，见 [验证状态](../../docs/android/verification.md)。初始中国区电台预选保持暂停，见[选台记录](../../docs/iterations/2026-10-24-initial-china-station/README.md)；连续球面旋转见[本轮记录](../../docs/iterations/2026-10-24-globe-free-rotation/README.md)。

搜索、用户名与密码共用输入框的键盘恢复处理见[键盘修复记录](../../docs/iterations/2026-10-24-android-keyboard/README.md)。

## 可复现构建

使用 JDK 17、Android SDK 36 / Build Tools 36.0.0。Gradle 9.3.1、AGP 9.1.1、Kotlin 2.2.21 与依赖由 Wrapper、版本目录及 Gradle 锁文件固定；Wrapper 分发有 SHA-256 校验。图形直接引用共享 Three.js 源码，使用根仓库 Node.js 24.9.0、pnpm 12.5.1 和 JavaScript 锁文件。

```sh
# 仓库根目录；先让 JAVA_HOME 指向 JDK 17。
pnpm install --frozen-lockfile
# 创建被排除的 apps/android/local.properties，写入本机 sdk.dir，
# 或显式设置 ANDROID_HOME；不要提交 SDK 路径或真实签名配置。
cd apps/android
./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug :app:assembleDebugAndroidTest
```

Gradle `preBuild` 自动构建图形，不需要手工复制网页产物。公开 API 地址由 `app/build.gradle.kts` 的 `BuildConfig.API_BASE_URL` 注入，当前为第一方 HTTPS API；不加载根目录服务端 `.env.local`，不需要客户端服务账号或密码。

Debug APK：`app/build/outputs/apk/debug/app-debug.apk`，使用本机 Android debug key。Release 使用独立正式签名，构建与私有配置见下节。保留各自签名材料和应用 ID，后续递增 versionCode 后覆盖安装；不能靠卸载来完成升级测试。

本机执行 `assembleDebug` 后，Gradle 自动将最新安装包同步到仓库根目录的 `android-packages/debug/app-debug.apk`；其他构建变体使用各自子目录（如 `android-packages/release/`），Debug 保留原始文件名，Release 的主包命名为 `声屿HAEN.apk`。目录只保留对应变体的当前 APK，不收集测试 APK，也不受 Gradle `clean` 影响。`android-packages/` 已通过本机 `.git/info/exclude` 排除，安装包不进入 Git；归集与签名构建配置纳入版本管理，安装包、私有密钥及签名配置继续仅保留在本地。说明与验证见 [本地安装包归集](../../docs/android/README.md#本地安装包归集)。

```sh
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -a android.intent.action.MAIN -c android.intent.category.LAUNCHER \
  -f 0x10008000 -n xyz.hahaen.radio/.app.MainActivity
```

首次 Schema 为 1，目前没有已发布旧 Schema 的迁移；升级仍验证数据保留，不使用破坏性重建。

仅在依赖变更经过 Review 后更新锁文件：

```sh
./gradlew :app:dependencies --write-locks
```

然后检查锁文件差异并重跑适用构建；普通构建不要添加 `--write-locks`。

## 正式签名与 Release APK

在 `apps/android` 执行（先让 `JAVA_HOME` 指向 JDK 17）：

```sh
./gradlew :app:lintRelease :app:assembleRelease
```

Gradle 显式读取仓库根目录 `.local/signing/release.properties`，必填键为 `storeFile`、`storePassword`、`keyAlias`、`keyPassword`；`storeFile` 相对该配置文件解析。密钥位于 `.local/signing/haen-release.jks`（PKCS12 格式），密码仅保存在私有配置，不写入源码、命令参数或安装包。签名目录权限 `700`，配置和密钥权限 `600`，均已被 Git 排除。缺少签名配置时 Release 构建明确失败，不输出未签名包；Debug 保持原签名。更换电脑时需安全迁移现有密钥和配置，不重新生成签名替代。

产物为 `app/build/outputs/apk/release/app-release.apk`，构建后自动同步到仓库根目录 `android-packages/release/声屿HAEN.apk`。Release 禁用调试，正式签名与 Debug 签名不同，不能直接覆盖已有 Debug 安装；本次不执行卸载、清除数据或手机安装。商店上传与 AAB 未执行。构建和验证记录见 [Android 本地 Release 交付](../../docs/android/README.md#正式-release-交付)。

## 保留用户数据的设备测试

在已有用户数据的验收设备上，直接用 `adb install -r` 覆盖安装主 APK 和测试 APK，再用 `am instrument` 运行；不要使用可能自动卸载应用的 Gradle managed/connected 测试流程，也不要清除应用数据。以下命令在 `apps/android` 下执行。

```sh
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb shell am instrument -w -r xyz.hahaen.radio.test/androidx.test.runner.AndroidJUnitRunner
```

默认套件的存储、缓存与会话测试使用隔离数据库或会话文件，同时运行播放器封装和导航回归。`LiveAccountReadOnlyTest` 与 `LivePlaybackDeviceTest` 是两组显式启用的真实环境测试；未传各自参数时，账号一个用例与播放两个用例均通过 `assume` 跳过，不代表专项验收通过。

`RadioNavigationTest` 需要先手动允许通知权限。MIUI 可能拦截 instrumentation 从后台启动 Activity，使测试停在等待 `MainActivity`。此时在另一个终端执行与测试相同的 MAIN / LAUNCHER Intent 和 flags，前台启动 App 后让测试继续；无需修改系统后台弹窗等权限。

```sh
# 可单独运行导航回归；若等待 Activity，使用下方另一终端命令。
adb shell am instrument -w -r -e class xyz.hahaen.radio.RadioNavigationTest \
  xyz.hahaen.radio.test/androidx.test.runner.AndroidJUnitRunner

# 另一个终端：也用于默认套件的导航等待或真实播放测试的准备阶段。
adb shell am start -a android.intent.action.MAIN -c android.intent.category.LAUNCHER \
  -f 0x10008000 -n xyz.hahaen.radio/.app.MainActivity
```

真实账号只读检查要求已经登录、同步完成且没有待同步操作。它从磁盘恢复会话，读取服务端会话与集合及本地 Room 数据，核对收藏、历史、歌曲收藏和 revision；不执行登录、集合写入或同步操作，不输出账号、Cookie 或集合内容。Debug 专用 Hilt entrypoint 位于 `app/src/debug/kotlin/xyz/hahaen/radio/testing/LiveAccountDependencies.kt`，不进入 Release。

```sh
adb shell am instrument -w -r -e class xyz.hahaen.radio.LiveAccountReadOnlyTest \
  -e haenLiveAccount true xyz.hahaen.radio.test/androidx.test.runner.AndroidJUnitRunner
```

真实播放检查分为独立的睡眠和焦点用例，分别运行，避免焦点失败阻断睡眠验收。先允许通知权限并取消已有睡眠定时。焦点用例需要系统实际分配音频焦点丢失；若设备开启“允许多声音同时发声”等共存选项，先记录并临时关闭，测试结束后恢复。该配置下系统可能保留多个焦点持有者，不能把未抑制直接归因于客户端。每次启动命令后，在 120 秒内用上面的前台启动命令打开 App，手动选一个稳定出声的电台，然后保持不操作。测试自身不启动 Activity、不选台、不修改账号或集合；手动选台仍遵循 App 正常记录历史的行为。

```sh
# 实际等待 60 秒，结束后保持暂停。
adb shell am instrument -w -r \
  -e class 'xyz.hahaen.radio.LivePlaybackDeviceTest#oneMinuteSleepActuallyPauses' \
  -e haenLivePlayback true xyz.hahaen.radio.test/androidx.test.runner.AndroidJUnitRunner

# 临时焦点持续 25 秒，释放后检查系统自动恢复。
adb shell am instrument -w -r \
  -e class 'xyz.hahaen.radio.LivePlaybackDeviceTest#transientAudioFocusRecovers' \
  -e haenLivePlayback true xyz.hahaen.radio.test/androidx.test.runner.AndroidJUnitRunner
```

睡眠用例向真实 `RadioService` 发送 `sleep(1)` 并等待完整 60 秒，确认倒计时结束后暂停。焦点用例在同一应用 UID 内使用另一个临时焦点请求持续 25 秒，检查播放抑制及释放后的自动恢复。未允许通知或已有睡眠定时会跳过；断流、其他焦点抢占、手动暂停或切台会使本次验证失败。失败信息仅包含服务与 Controller 的布尔状态、平台枚举及有限状态事件，不输出电台元数据、URL 或 Cookie。测试清理焦点、未到期的测试定时器及 Controller，不以自动播放覆盖用户暂停。此项验证服务状态和系统焦点机制，不能代替实际听音、耳机按键或插拔验收。

标准音频焦点已有独立 UID 临时真机探针与上述同 UID instrumentation 两种通过证据：临时关闭多声音共存后，HAEN 响应焦点中断并在释放后恢复播放；原同 UID 用例在 build16 复验用时 34.84 秒通过，包含 25 秒临时焦点请求。测试后均恢复并核对设备原设置，具体轮次与范围见验证状态。

构建成功与设备专项通过分别记录；新增测试及最新 APK 的未验证项仍以 [验证状态](../../docs/android/verification.md) 为准。

## 收听界面与音量

竖屏首页与沉浸页的主播放操作组居中，上一台、播放/暂停、下一台横向排列，收藏、分享、固定等次要操作位于下一行。可用高度低于 430dp 且宽度至少 600dp 时采用左右布局：信息在左，248dp 控制组在右，信息与极短高度下的控制区分别支持必要滚动。台名与详情在空间不足时局部滚动，主播放操作保持可用。搜索、收听清单、设置和账号页底部使用带安全区间距的悬浮迷你播放器，显示台名、状态、播放/暂停和下一台；点击台名区域返回首页，键盘展开时隐藏迷你播放器。

应用内不再显示独立音量滑杆。收听音量通过手机硬件音量键或系统媒体音量面板调整，Activity 已将音量控制目标设为媒体流；build18 已由用户实际操作手机实体音量键，确认声音正常且音量随按键变化。

通知栏与锁屏媒体卡片沿用同一个原生 MediaSession。应用提供电台名称、真实地点与连接/播放/暂停/失败状态，以及本地品牌封面和白色透明通知小图标；封面在墨绿底上保留品牌原图颜色，不依赖网络图片。直播向系统声明为 LIVE、不可拖动定位、总时长未知，不构造歌曲进度。Android 13 及以上由系统从 Session 读取媒体信息，卡片布局、圆角、字体、输出设备入口、取色和进度控件外观由系统与 ROM 决定；不使用自定义 RemoteViews，也不承诺各设备呈现相同样式或完全隐藏进度区域。本轮卡片更新的实际显示与操作效果仍按 [验证状态](../../docs/android/verification.md) 单独确认。

build18 在本次 MIUI 真机上已确认品牌封面、白色通知图标及 Playing/Paused 副标题显示正确，直播进度不可操作；系统仍显示 `00:00/00:00` 和浅灰绿色卡片。封面右下的小白耳机是系统使用通知 `smallIcon` 绘制的来源标识，不是额外播放按钮；目前未找到可单独隐藏该角标的公开接口，应用保留有效小图标。平台限制见[技术方案](../../docs/android/technical-design.md#系统媒体卡片)，build18 通知栏换台、离线错误与恢复已复验，锁屏通知层四个实际媒体按钮也已复验通过，范围按验证状态记录。

地球和单个沉浸渲染器采用最多两层缓存，切页时暂停隐藏层，返回复用地球与相机；仅一个画布可见，后台停止持续绘制，销毁时释放全部资源。目录更新与播放快照分离，减少返回首页时的重建停顿。图形入口的回归测试使用根仓库已有 Playwright：

```bash
pnpm exec playwright test --config apps/android/graphics/playwright.config.ts
```

该命令从仓库根目录运行，通过本地 Vite 实际入口检查往返复用、隐藏停绘、触摸与相机保留、context 失败隔离、异步切页和销毁；测试结果保存在被 Git 排除的 `.local/archive/android/graphics-tests*`。本地浏览器结果仍须由实际 APK 的真机往返与生命周期验证补充。

地球外围的固定星点由 Android 图形入口中的独立 SVG 层补齐，位于透明地球画布后方且不拦截触摸。仅在地球场景活跃、实际播放、页面可见且未启用省电或减少动态效果时，少量亮星缓慢明暗变化；切到沉浸页时隐藏，销毁时移除 SVG 和监听器。

首页与沉浸页“正在收听”旁的三条声波为播放状态装饰：实际播放时以错相节奏起伏，暂停或缓冲时显示静态短线；进入后台、离开收听页、启用省电或减少动态效果时停止持续动画。原生 Canvas 只在绘制阶段读取动画值，不逐帧重新布局页面；动画遵循系统动效缩放，不读取或声称展示真实音频频谱。

build19 主 APK 与测试 APK 已覆盖安装，三个 owner 库的集合摘要及待同步队列均保留。图形入口 5 项回归、类型、ESLint、格式与构建通过；43 项 JVM 测试实际执行并通过，Lint 为 0 error、47 warning，原生导航复验通过（6.241 秒）。真机三次沉浸返回首页，地球首 GL 从原约 0.7 秒降至 19–23 毫秒；新建/丢失 context 均为 0。隐藏停绘、两场景后台与恢复、原生单指触摸、缓存失效后的降级重载，以及横竖屏构图均已受影响复验。双指验证路径与本轮边界见 [验证状态](../../docs/android/verification.md)。

build18 的 6 项媒体包装语义设备测试、账号只读对账、通知栏四状态及真实按钮、锁屏通知层的暂停/继续/上下台继续有效；本轮未改播放与账号实现。此前睡眠到期、离线恢复、账号冲突与隔离、收藏即时刷新、真实双指及逐页视觉证据按执行轮次保留。用户已确认实际声音正常、实体音量键有效；真实耳机按键与断开仍未验证；用户于 2026-10-24 明确要求本轮先不测试该项，保留后续设备验收，本轮交付不将其记录为通过。

## 实现边界

- Compose 夜航界面、Navigation 3、真实搜索、多选筛选、收藏筛选、探索与沉浸。
- Media3 服务负责单一播放事实、媒体通知、焦点、耳机断开、最多三线路及两次自动换台恢复、固定电台和单调时钟睡眠。
- Room 收藏、历史、按账号绑定的待同步队列与紧凑目录缓存；DataStore 画面设置。
- 第一方 HTTPS 会话限域、请求代次拒绝迟到 Cookie、Keystore / AES-GCM 持久化；游客与账号隔离，revision 冲突重放操作，保留网页歌曲收藏字段。
- WebViewAssetLoader 提供随包 Three.js，受限来源消息桥，不传账号会话；图形失败、关闭或不支持时使用原生静态地理/场景。
- 进程终止后不自动恢复播放或睡眠计时，用户再次打开后主动播放。Debug 不代表正式发行签名。

## 目录

```text
apps/android/
├── app/
│   ├── build.gradle.kts
│   ├── gradle.lockfile
│   ├── schemas/
│   └── src/
│       ├── main/kotlin/xyz/hahaen/radio/
│       │   ├── app/          入口、依赖注入和主题
│       │   ├── feature/      页面、ViewModel 和筛选
│       │   ├── domain/       领域模型与集合操作
│       │   ├── data/         契约、会话、Room 和 Repository
│       │   ├── playback/     原生服务、Session、Controller 和策略
│       │   └── graphics/     受限 WebView 与原生降级
│       ├── main/res/         图标、字体、中英资源
│       ├── main/assets/      字体许可与生成图形（后者不提交）
│       ├── debug/kotlin/xyz/hahaen/radio/testing/
│       │                     真实账号只读测试的 Hilt entrypoint（仅 Debug）
│       ├── test/             JVM 业务和契约回归
│       └── androidTest/      隔离回归、导航及两组显式启用的真实环境测试
├── graphics/                 共享图形构建入口、独立 SVG 星空及字体来源
├── gradle/                   Wrapper 与版本目录
└── settings.gradle.kts
```

方案、验收和服务影响见 [Android 文档](../../docs/android/README.md)。本次无需更新服务；需要重建安装 Android APK。
