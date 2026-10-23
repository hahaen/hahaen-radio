# Android 客户端文档

Android 客户端采用 Kotlin 原生路线，目标是延续声屿手机网页的夜航设计与收听体验，并由原生服务承载后台音频。

## 当前状态

| 内容 | 状态 |
| --- | --- |
| 开发目录和协作规范 | 已建立于 `apps/android` |
| 技术路线与职责边界 | 已确定，见技术方案与 ADR-0007 |
| Gradle 工程、固定依赖版本和 SDK 范围 | 待初始化与兼容性验证 |
| 原生页面、播放服务、存储和账号接入 | 待实现 |
| 局部 WebView / Three.js 图形复用 | 优先验证路线，尚未通过原生设备验证 |
| APK/AAB、签名、设备验收及发布 | 尚未执行 |

## 阅读顺序

1. [应用入口](../../apps/android/README.md)与[Android 协作规范](../../apps/android/AGENTS.md)。
2. [集中技术基线](../overview/technology-stack.md)与[完整技术方案](technical-design.md)。
3. [ADR-0007：原生 Android 客户端](../architecture/decisions/0007-android-native-client.md)。
4. [夜航设计规范](../frontend/design/night-voyage.md)、[目录 API](../backend/api/catalog.md)和[账号契约与同步行为](../iterations/2026-10-23-account-sync/README.md)。
5. [本次目录与文档建立记录](../iterations/2026-10-23-android-development-foundation/README.md)。

既有 Android 真机记录验证的是手机浏览器中的 Web 应用，不代表原生客户端已有验收结果。原生工程的实现与验证将在后续任务中单独记录。

返回[文档总导航](../README.md)。
