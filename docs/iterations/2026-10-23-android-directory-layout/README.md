# Android 开发目录骨架

日期：2026-10-23。

## 需求

在已有 `apps/android` 入口与技术方案基础上，实际建立 Android 开发对应的目录。

## 实际变更

- 建立单应用模块的 `app/src/main/kotlin`，按 app、feature、data、domain、playback、graphics 分区；细分页面、注入、导航、主题、远端、本地、映射、仓储及模型目录。
- 建立 `res` 下的图像、字体、图标、默认/英文资源与 XML 目录，以及 `assets/graphics`。
- 建立 `src/test` 的 Kotlin 和资源目录、`src/androidTest` 的 Kotlin 和素材目录。
- 建立 `app/schemas` 与 `gradle/wrapper` 目录；全部 30 个叶子目录以空 `.gitkeep` 纳入 Git。
- 更新应用 README 与专用规范、Android 技术方案与导航、仓库结构、文档总导航和任务索引。

## Review 与验证

Review 范围仅为新增目录占位及本次关联文档；已检查目录职责、单模块边界、Kotlin 包身份待定、资源/测试源集路径、Git 可保留性与“目录已建、工程待初始化”的状态区分，无未解决问题。

- 已核对 30 个叶子目录的 `.gitkeep` 全部存在、为空且未被忽略，应用 README 中 45 个目录树条目均与实际路径一致。
- `pnpm docs:check` 通过，检查 184 份 Markdown 和 1337 个本地链接；本次差异的 `git diff --check` 通过。
- 同步前保存修改快照，fetch 两个目标远端并执行 `git pull --ff-only`，当前 `main` 与两端一致，无冲突；同步后快照内容未变，本次范围复审无未解决问题，并复验目录、文档与差异检查。
- 仅暂存本次目录占位与关联文档，其他任务的音频、部署改动和本地文件保留。

## 未完成事项

没有创建构建脚本、Manifest、Kotlin 代码、Wrapper 文件或资源内容，没有安装依赖或生成 APK/AAB。后续工程初始化需冻结 namespace/applicationId 和兼容工具链，将源码职责目录归入统一包前缀，配置实际构建及测试任务；出现实际文件后移除对应 `.gitkeep`。

本次只有目录骨架与文档，不适用 Android 编译、设备或网页回归测试。

## 服务与产物更新

本次无需更新服务。无需发布 `radio-frontend`、`radio-api`、`radio-jobs`，不涉及数据库、服务器配置或安装包分发。

返回[任务归档](../README.md)、[Android 导航](../../android/README.md)或[应用入口](../../../apps/android/README.md)。
