# 声屿 HAEN Android

Android 客户端开发入口。当前已建立源码、资源、测试及构建工具的目录骨架、协作规范和技术方案，尚未初始化 Gradle 工程、编写客户端或生成 APK/AAB。

## 阅读入口

- [Android 协作规范](AGENTS.md)：本目录的实现、验证与交付要求，同时遵守[根协作规范](../../AGENTS.md)。
- [Android 文档导航](../../docs/android/README.md)。
- [完整技术方案](../../docs/android/technical-design.md)：技术栈、分层、播放、图形、接口、存储、安全与实施顺序。
- [ADR-0007](../../docs/architecture/decisions/0007-android-native-client.md)：原生客户端与局部 WebView 的选型边界。
- [目录与文档建立记录](../../docs/iterations/2026-10-23-android-development-foundation/README.md)。
- [开发目录骨架记录](../../docs/iterations/2026-10-23-android-directory-layout/README.md)。

## 开发基线

主体采用 Kotlin、Jetpack Compose、Material 3、ViewModel、Coroutines/StateFlow 和 Hilt/KSP；网络采用 OkHttp、Retrofit 与 kotlinx.serialization；播放采用 Media3 ExoPlayer、MediaSessionService 和 MediaController；本地集合采用 Room，设置采用 DataStore，图片采用 Coil。

地球与沉浸画面优先验证局部 WebView 复用现有 Three.js 的可行性。原生层管理播放、账号与本地数据，图形层通过受限消息协议接收快照和上报交互。后台重试、备用线路与睡眠定时不得依赖网页脚本持续运行。

## 当前目录

```text
apps/android/
├── AGENTS.md
├── README.md
├── gradle/
│   └── wrapper/                         后续保存 Gradle Wrapper 文件
└── app/
    ├── schemas/                         Room 版本化 Schema
    └── src/
        ├── main/
        │   ├── kotlin/
        │   │   ├── app/
        │   │   │   ├── di/              Hilt 装配
        │   │   │   ├── navigation/      页面与返回栈
        │   │   │   └── theme/           Compose 夜航主题
        │   │   ├── feature/
        │   │   │   ├── explore/         地球探索
        │   │   │   ├── search/          电台搜索与筛选
        │   │   │   ├── library/         收藏与收听历史
        │   │   │   ├── settings/        偏好设置
        │   │   │   ├── account/         登录与同步界面
        │   │   │   └── immersive/       沉浸收听
        │   │   ├── data/
        │   │   │   ├── remote/          Retrofit、OkHttp 与 DTO
        │   │   │   ├── local/           Room、DataStore 与会话存储
        │   │   │   ├── repository/      数据仓储实现
        │   │   │   └── mapper/          DTO、领域与本地实体映射
        │   │   ├── domain/
        │   │   │   ├── model/           业务模型
        │   │   │   └── repository/      仓储接口
        │   │   ├── playback/            原生播放服务与策略
        │   │   └── graphics/            WebView 宿主与消息协议
        │   ├── assets/
        │   │   └── graphics/            后续打包的图形产物
        │   └── res/
        │       ├── drawable/            图片与矢量资源
        │       ├── font/                Android 字体资源
        │       ├── mipmap/              应用图标
        │       ├── values/              默认字符串、颜色等资源
        │       ├── values-en/           英文资源
        │       └── xml/                 平台 XML 配置
        ├── test/
        │   ├── kotlin/                  JVM 单元与网络测试
        │   └── resources/               JVM 测试素材
        └── androidTest/
            ├── kotlin/                  设备界面、存储与迁移测试
            └── assets/                  设备测试素材
```

叶子目录使用空的 `.gitkeep` 纳入 Git，后续有实际文件时移除对应占位文件。这里的 `app/` 是待初始化的单应用模块目录，尚未注册 Gradle 模块；`gradle/wrapper/` 也不包含 Wrapper 脚本、JAR 或配置。

`kotlin/` 下先按职责分区，工程初始化确定 namespace 后再将这些目录归入统一包前缀，并让测试代码采用对应包路径。当前没有 Kotlin 包声明或 applicationId，不以目录骨架冻结包身份。详细职责见[技术方案](../../docs/android/technical-design.md)。

## 工程初始化前

1. 核对 Android Studio、JDK、AGP、Gradle、Kotlin、Compose、KSP 和 Hilt 的兼容组合，固定具体版本。
2. 确定 applicationId、namespace、SDK 范围、开发 API 地址及发布渠道；开发与正式环境明确分离。
3. 创建 Gradle Kotlin DSL 工程及 Wrapper，再按技术方案先实现原生播放纵向流程和独立图形验证页。
4. 添加实际可运行的构建、检查和测试命令，并更新本文。

当前没有 `gradlew`、Manifest 或 Android 构建任务。根目录 pnpm 命令仍负责现有 Web/Server 工程，不能据此宣称 Android 构建或设备验证通过。

本阶段只涉及目录与文档，无需更新 `radio-frontend`、`radio-api` 或 `radio-jobs`。
