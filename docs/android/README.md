# Android 客户端文档

Android 客户端采用 Kotlin 原生路线，目标是延续声屿手机网页的夜航设计与收听体验，并由原生服务承载后台音频。

## 当前状态

| 内容 | 状态 |
| --- | --- |
| 原生工程、工具链与依赖 | 已实现并固定版本，Gradle 独立构建 |
| 原生页面、播放服务、存储和账号 | 已实现并完成 Review、本轮核心真机验收；耳机按用户要求暂缓 |
| 局部 WebView / Three.js | 已打包接入；build19 复用地球与单一沉浸缓存，返回停顿、隐藏/后台停绘、恢复、降级及横竖屏已复验；手势与点选证据按轮次记录，完整销毁释放有回归覆盖 |
| Debug APK、安装与实际听音 | build19 Debug 已构建并覆盖安装；1 → 2 升级与数据保留、已执行核心功能和视觉验收通过；真实耳机专项暂缓 |
| 正式签名、AAB 与商店发布 | 未接入、未发布 |

逐项证据、设备与未完成事项见 [验证与交付状态](verification.md)。

## 阅读顺序

1. [应用入口](../../apps/android/README.md)与[Android 协作规范](../../apps/android/AGENTS.md)。
2. [集中技术基线](../overview/technology-stack.md)与[完整技术方案](technical-design.md)。
3. [ADR-0007：原生 Android 客户端](../architecture/decisions/0007-android-native-client.md)。
4. [夜航设计规范](../frontend/design/night-voyage.md)、[目录 API](../backend/api/catalog.md)和[账号契约与同步行为](../iterations/2026-10-23-account-sync/README.md)。
5. [入口与文档建立记录](../iterations/2026-10-23-android-development-foundation/README.md)及[目录骨架记录](../iterations/2026-10-23-android-directory-layout/README.md)。

既有 Android 真机记录验证的是手机浏览器中的 Web 应用，不代表原生客户端已有验收结果。原生工程的实现与验证已在上述验证记录中单独维护。

返回[文档总导航](../README.md)。
