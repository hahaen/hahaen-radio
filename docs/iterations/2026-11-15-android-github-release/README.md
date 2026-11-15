# Android GitHub 正式包发布

## 需求与实现

在 GitHub Actions 手动运行正式包构建，复用现有产品签名，成功后自动上传 APK 到 Releases。发布流程仅使用手动触发，签名环境限定为 `main`。首次分发当前版本沿用 `0.1.2`（versionCode 8）。

工作流使用仓库固定的 Node.js、pnpm、Gradle Wrapper 及 Android SDK 36，执行 Release Lint 和组装，核对签名证书、公有应用 ID 与 APK 版本。签名任务使用只读仓库权限，发布任务获得写权限并读取构建产物。版本标签绑定触发时的提交，已有 Release 或指向其他提交的同名标签会使发布停止。操作入口见 [Android 工程说明](../../../apps/android/README.md#在-github-手动发布)。

## 首次配置或恢复

1. 在仓库 Settings → Environments 中创建 `android-release`，部署分支选择 **Selected branches and tags**，仅添加 Branch 类型的 `main`。
2. 用已登录仓库管理员账户的 GitHub CLI，从项目根目录将原有正式签名材料写入该环境的 `ANDROID_RELEASE_SIGNING`。两个输入文件位于本机私有签名目录，配置的 `storeFile` 指向同目录的签名文件。

   ```sh
   set -o pipefail
   tar -C .local/signing -czf - release.properties haen-release.jks |
     base64 | tr -d '\n' |
     gh secret set ANDROID_RELEASE_SIGNING --repo hahaen/hahaen-radio --env android-release
   ```

3. 在 Actions 中取消发布勾选，试跑一次构建并核对签名步骤。正式发布时保留勾选。

## 验证与服务范围

- 工作流检查、文档链接检查和本机 Release 构建用于验证配置。
- GitHub Runner 试跑需要先配置签名环境 Secret。
- 本次无需更新服务。
