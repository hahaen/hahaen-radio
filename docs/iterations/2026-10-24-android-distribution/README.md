# Android 分发页介绍与图标

日期：2026-10-24。

## 需求与实际变更

完善声屿 HAEN 的蒲公英应用介绍与应用图标，下载入口保持原地址。

- 中文应用介绍围绕全球电台探索、后台播放、收藏与历史、账号同步、沉浸场景及睡眠定时编写，已在后台保存。
- 原 APK 只有自适应 XML 图标，分发平台解析为默认占位图。为安装包增加 48、72、96、144、192px 的兼容 PNG，沿用现有深色耳机图案与不透明墨绿底。
- Application 的 `android:icon` 指向兼容 PNG；MainActivity 的 `android:icon` 以及 Application 的 `android:roundIcon` 继续指向现有自适应图标，保留启动入口的图层与单色配置。
- 包名、版本号和正式签名沿用现有配置；本轮只改图标元信息和资源，不修改播放或账号逻辑。重新生成的 Release APK 自动归集到本机 `android-packages/release/声屿HAEN.apk`。

## Review 与验证

Review 限定为本次 Manifest 图标声明、五档 PNG、分发文案及必要文档；工作区已有签名、归集和音频改动不纳入本次提交。已核对图标来源、分辨率、应用与 Activity 图标继承、签名连续性及公开文案功能边界，无未解决问题。

- `:app:lintRelease :app:assembleRelease` 通过。
- `:app:testDebugUnitTest :app:lintDebug :app:assembleDebug` 通过，45 项 JVM 测试无失败、错误或跳过。Debug / Release Lint 无 Error，分别有 52 / 53 条 warning；其中新增的五条 `IconLauncherShape` 提示对应刻意保持不透明方形底的兼容图标，启动入口仍使用自适应图标，未添加规则屏蔽。
- `aapt dump badging` 中 Application 图标由 XML 改为 PNG，160–640dpi 均解析到 PNG；启动 Activity 仍解析到自适应 XML。
- Release 包名为 `xyz.hahaen.radio`，版本 `0.1.0` / versionCode 3。
- `apksigner verify` 与 `zipalign -c -P 16 4` 通过；归集包 SHA-256 为 `714a6ceaae79e2826f7e5232c5d3282b7fdf34b908ba5f56ee4794069b727a23`。
- 已重新上传并发布兼容图标包；蒲公英 Build 从 1 自增为 2，旧版本保留。公开[下载页](https://www.pgyer.com/shengyuhaen)已显示墨绿耳机图标、完整中文介绍、更新说明及 Build 2。
- 桌面 Chrome 默认 1496×682 视口及手机 390×844 模拟视口核对完成，图标与简介正确显示；手机页面内容宽度为 390px，无横向溢出。截图仅保留在本机，不进入仓库；未执行下载安装或验证码操作。
- GitHub upstream 与 Gitee 均已同步且没有新增提交；同步后仅复审本次资源、Manifest 与文档差异，文档链接和差异格式复验通过。既有其他任务改动单独保留。

## 未完成事项与服务影响

本次无需更新服务；前端、API、后台任务、数据库均无需发布或迁移。本轮未进行真机安装与完整功能复验，既有设备验收不视为本轮新包验收。

返回[归档导航](../README.md)与[文档导航](../../README.md)。
