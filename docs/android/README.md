# Android 客户端文档

Android 当前源码版本为 0.1.2 / versionCode 8，首次选台单次请求及安装包验证见[起播优化记录](../iterations/2026-10-25-initial-playback-latency/README.md)。此前图钉即时反馈修复与原机回归见[任务记录](../iterations/2026-10-25-account-pin-sync/README.md#android-图钉状态即时刷新修复2026-10-25)。

Android 客户端采用 Kotlin 原生路线，目标是延续声屿手机网页的夜航设计与收听体验，并由原生服务承载后台音频。

共享地球的连续旋转修复与 versionCode 5 产物验证见[任务记录](../iterations/2026-10-24-globe-free-rotation/README.md)。

搜索、用户名和密码输入框的软键盘处理见[键盘修复与检查记录](../iterations/2026-10-24-android-keyboard/README.md)。

## 当前状态

| 内容 | 状态 |
| --- | --- |
| 原生工程、工具链与依赖 | 已实现并固定版本，Gradle 独立构建 |
| 原生页面、播放服务、存储和账号 | 已实现并完成 Review、本轮核心真机验收；耳机按用户要求暂缓 |
| 局部 WebView / Three.js | 已打包接入；build19 复用地球与单一沉浸缓存，返回停顿、隐藏/后台停绘、恢复、降级及横竖屏已复验；手势与点选证据按轮次记录，完整销毁释放有回归覆盖 |
| Debug APK、安装与实际听音 | build19 Debug 已构建并覆盖安装；1 → 2 升级与数据保留、已执行核心功能和视觉验收通过；真实耳机专项暂缓 |
| 正式签名、AAB 与商店发布 | 独立正式签名 Release APK 已构建并验证；未安装真机，AAB 与商店发布未执行 |

逐项证据、设备与未完成事项见 [验证与交付状态](verification.md)。

## App 更新版本规则

2026-10-25 起，每次更新 Android App 并交付新安装包时，递增 `apps/android/app/build.gradle.kts` 中 `versionName` 的补丁版本号，例如 `0.1.0 → 0.1.1 → 0.1.2`，并将 `versionCode` 至少加 1。小 bug 修复始终只加最后一段，例如 `0.1.9 → 0.1.10 → 0.1.11`，不向中间或第一段进位。同一次更新的重复构建、验证及 Debug / Release 构建复用同一组版本号。交付前核对 APK 内的两个版本值，并同步当前版本说明和本轮交付记录；继续使用原应用 ID 与正式签名。

- 需求与变更：将每次 App 更新递增显示版本号的规则写入 [Android 协作规范](../../apps/android/AGENTS.md#7-review验证与交付)，避免仅递增 `versionCode`。
- Review 与验证：本次仅修改规则与说明，核对版本字段位置、示例递增语义、文档链接及差异格式；不涉及 App 代码、构建或设备验证。
- 未完成事项与服务影响：无；该次规范更新未改动当时的 `0.1.0` / versionCode 6，后续 App 更新从 `0.1.1` 开始。本次无需更新服务，也无需重建 APK。

## 本地安装包归集

2026-10-24：按需建立仓库根目录 `android-packages/`，每次 Android 打包后自动更新最新安装包，并排除 Git。初次交付时仅保留本地；后续经用户授权，将归集配置与说明纳入版本管理。

- 实现：应用 Gradle 为各变体注册 `export<Variant>Apk`，读取 AGP 的 APK 产物并通过 `Sync` 同步到 `android-packages/<variant>/`，绑定对应 `assemble<Variant>`。APK 打包任务成功后才归集，失败时保留上次副本；重复构建也会按需恢复缺失或被修改的副本。
- 使用：在 `apps/android` 执行 `./gradlew :app:assembleDebug`，从 `android-packages/debug/app-debug.apk` 获取最新 Debug 包；其他变体分别存放；Release 主包命名为 `声屿HAEN.apk`，其余文件名不变。也可直接执行 `:app:exportDebugApk`，它会先构建所需 APK。`clean` 不删除归集目录；同一变体只保留当前产物，不积累历史包或测试包。
- Git：本机 `.git/info/exclude` 添加 `/android-packages/`，不修改共享忽略规则；归集目录及 APK 不跟踪。
- Review：限定为归集任务和说明，核对产物依赖、失败保留、变体隔离、增量恢复与忽略范围，未发现未解决问题。
- 验证：`:app:testDebugUnitTest :app:lintDebug :app:assembleDebug` 通过，43 项 JVM 测试无失败，Lint 为 0 error、47 warning。归集包与构建包 SHA-256 一致；删除副本并放入过期 APK 后再次打包，成功补回副本并清除过期文件。`git check-ignore` 确认目录被排除，`git ls-files android-packages` 为空；文档链接及差异格式检查通过。Release 仅配置了同样的归集规则，本轮未构建或验证 Release。
- 未完成事项：当时未接入正式 Release 签名，后续接入状态见下节；商店分发未执行，本次不涉及设备安装或功能变更。本次无需更新服务。

## 正式 Release 交付

2026-10-24：按用户要求生成可安装的正式签名 Release APK；包名保持 `xyz.hahaen.radio`，版本沿用当前源码 `0.1.0` / versionCode 3。本次只打包，不进行手机安装、卸载或商店上传，初次交付时仅保留本地；后续经用户授权，将签名构建配置与说明纳入版本管理，实际密钥、密码和安装包不进入 Git。

- 实际变更：创建独立 RSA 4096 位签名密钥，有效期 30 年；应用 Gradle 显式加载 `.local/signing/release.properties`，校验四个必填配置键及密钥文件，Release 关闭调试并绑定该签名。缺失配置时阻止 Release 构建，Debug 签名不变。密钥与配置由 `.local/` 忽略规则排除，目录权限 `700`、文件 `600`；配置名和加载方式见[构建说明](../../apps/android/README.md#正式签名与-release-apk)。
- 产物：`android-packages/release/声屿HAEN.apk`，由 `assembleRelease` 自动归集。后续 Release 更新复用同一密钥并递增 versionCode；密钥与密码应另行安全备份，不进入普通文档、APK 或公开仓库。
- Review：范围仅包括本次签名配置、密钥生成步骤和相关说明，核对隐私、配置缺失、升级身份与归集路径，无未解决问题。构建使用当前本地工作区，保留其他任务已有改动，不将其归入本次 Review。
- 构建验证：`:app:testDebugUnitTest :app:lintDebug :app:lintRelease :app:assembleDebug :app:assembleRelease` 成功（3 分 15 秒）。Debug JVM 任务复用现有通过结果：45 项，0 失败、0 错误、0 跳过；Debug 与 Release Lint 均无 Error/Fatal，分别为 47 和 48 条 warning。Release 未运行独立单元套件或设备测试。
- 文件名：按用户要求，归集后的正式包固定命名为 `声屿HAEN.apk`，AGP 原始输出文件名保持不变；每次 Release 打包自动更新该中文文件名。文件名作为归集任务输入，确保改名后即使原始 APK 未变化也会重新同步。已通过重新打包验证中文文件名及旧文件清理，签名验证仍通过；重命名不改变 APK 内容或签名。
- 初次交付产物验证：Release 包 18,783,588 字节，SHA-256 `82ec36ebf8e61bc81c86a5f4ab37845b2e782b651f3226010a976c54dd503c0e`。`apksigner verify` 通过（v2 签名、RSA 4096）；公开证书摘要与本地密钥一致，且不同于 Debug。`aapt` 核对应用 ID、版本、minSdk 26 / targetSdk 36，确认不可调试；`zipalign -c -P 16 4` 通过。归集包与原始产物逐字节一致；包内未包含签名私钥文件、私有配置或实际签名密码。签名文件权限及 Git 排除/未跟踪状态均已核对，文档链接和差异格式检查通过。
- 未完成：Release 真机安装与功能验收、Debug 向不同签名 Release 的数据迁移、AAB 与商店发布均未执行；既有 Debug 验收不直接视为 Release 验收。
- 服务影响：本次无需更新服务；交付产物为 Android Release APK。

## 2026-10-24 提交前复核

用户授权将本地 APK 归集、Release 签名构建配置及相关说明提交并同步两个代码远端；实际密钥、密码、私有配置和 APK 继续被 Git 排除。Review 范围为 Gradle 变更及本专题相关说明，核对签名配置加载与缺失校验、产物依赖、变体隔离及隐私边界，无未解决问题。

执行 `:app:testDebugUnitTest :app:lintDebug :app:lintRelease :app:assembleDebug :app:assembleRelease` 成功；Gradle 复用有效增量结果，Debug JVM 报告为 45 项通过。Debug / Release Lint 无 Error/Fatal，分别为 52 / 53 条 warning。两种归集 APK 均与原始产物 SHA-256 一致，Release 签名验证通过。当前 Release 为 18,817,892 字节，SHA-256 `714a6ceaae79e2826f7e5232c5d3282b7fdf34b908ba5f56ee4794069b727a23`；此前交付摘要仅对应当时产物。私有文件权限及 Git 排除状态已复核。

未新增真机安装、功能验收、AAB 或商店发布；原有未验证事项继续保留。本次无需更新服务，Android 后续交付使用对应构建的 APK。

## 2026-10-30 项目入口状态同步

- 需求与实际变更：修正根 README 遗留的 Android 待初始化描述，同步文档入口、技术摘要及工程目录，说明原生工程、独立 Gradle 构建、共享图形接入和 Debug / 正式签名 Release APK 已实现。
- Review 与验证：核对 Gradle 模块、版本配置、Manifest 和既有交付记录；核心真机验收按原轮次引用，其余专项及商店发布保留原有边界。仅修改文档，检查本地链接与差异格式，不重跑应用构建或设备测试。
- 未完成事项与服务影响：本次文档修正无剩余事项，既有未验证专项不变。本次无需更新服务，也无需重建或分发 Android APK。

## 阅读顺序

1. [应用入口](../../apps/android/README.md)与[Android 协作规范](../../apps/android/AGENTS.md)。
2. [集中技术基线](../overview/technology-stack.md)与[完整技术方案](technical-design.md)。
3. [ADR-0007：原生 Android 客户端](../architecture/decisions/0007-android-native-client.md)。
4. [夜航设计规范](../frontend/design/night-voyage.md)、[目录 API](../backend/api/catalog.md)和[账号契约与同步行为](../iterations/2026-10-23-account-sync/README.md)。
5. [入口与文档建立记录](../iterations/2026-10-23-android-development-foundation/README.md)及[目录骨架记录](../iterations/2026-10-23-android-directory-layout/README.md)。

既有 Android 真机记录验证的是手机浏览器中的 Web 应用，不代表原生客户端已有验收结果。原生工程的实现与验证已在上述验证记录中单独维护。

返回[文档总导航](../README.md)。
