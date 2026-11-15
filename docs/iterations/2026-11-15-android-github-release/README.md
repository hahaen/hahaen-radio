# Android GitHub 正式包发布

## 需求与变更

根据分发要求撤除 Android GitHub Actions 工作流，使用现有本机正式签名 APK 作为 GitHub Release 附件。签名私钥与签名配置保存在本机私有目录。

## 发布产物与验证

- Release 标签为 `v0.1.2`，附件名为 `haen-radio-0.1.2.apk`，使用现有 `声屿HAEN.apk` 的原始内容。
- 已通过 `apksigner verify`，签名证书与已有正式包的记录一致。包名为 `xyz.hahaen.radio`，版本 `0.1.2`，versionCode 8，支持 Android 8 及以上。
- APK SHA-256 为 `67ba2e6cbde363d0d54d252c432cf5c55247b6e3e7c863d8d6fa502c3428161a`。
- 后续发布步骤见 [Android 工程说明](../../../apps/android/README.md#在-github-发布本机正式包)。本次无需更新服务。
