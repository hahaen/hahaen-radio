# 工程脚本目录

已提供 `check-docs.mjs` 检查 Markdown 本地链接，以及 `clean-dist.mjs` 在服务端和共享契约构建前清理其各自 dist，避免已删除或测试辅助模块残留到产物。清理脚本只允许上述两个包目录，不接受任意删除路径。

已提供 `generate-audio-fixtures.mjs` 生成自制测试音，以及 `prepare-land.mjs` 从固定摘要的 Natural Earth 输入生成本地大陆资源。后者步骤见[离线地理](../docs/data/offline-geography.md)。

已提供 `prepare-fonts.mjs` 生成三种本地字体子集、许可、摘要与 CSS，手动执行 `node scripts/prepare-fonts.mjs`，具体前提见[字体说明](../docs/frontend/design/fonts.md)。常规构建不联网生成字体。

`release/` 已提供确定提交的三类镜像构建、隔离容器基础验收、人工分发与不可变产物校验。实际入口为 `node scripts/release/pipeline.mjs build`、`test-images`、`publish`，由根 Jenkinsfile 顺序调用；配置、凭据、归档和未完成的目标部署编排见[流水线](../docs/deployment/jenkins/pipeline.md)。本机编排测试通过模拟 Docker CLI 执行，不作为实际镜像验收证据。

按实际任务加入开发辅助、数据检查、备份和发布辅助脚本。脚本应具有明确输入、失败退出状态与环境边界，不内嵌凭据或默认访问生产数据。

只有脚本实现并验证后，才在文档和流水线中声明对应命令可用。

相关约定见[工程环境与依赖](../docs/engineering/environment-and-dependencies.md)。
