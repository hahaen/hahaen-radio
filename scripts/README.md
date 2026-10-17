# 共享工程脚本

本目录保留跨应用工具：

- `check-docs.mjs`：检查根说明、分类文档及各应用、共享包、部署和脚本目录中的 Markdown 本地链接，跳过依赖与生成物。
- `clean-dist.mjs`：在后端和共享契约构建前清理各自 `dist`，避免删除过的模块残留；仅允许这两个包目录，不接受任意删除路径。

前端专用资源工具位于 [apps/web/scripts](../apps/web/scripts/README.md)，镜像构建、节点交接和目标部署工具位于 [deploy/scripts](../deploy/scripts/README.md)。

工具使用环境变量或显式私有配置，不内嵌凭据。相关约定见[工程环境与依赖](../docs/engineering/environment-and-dependencies.md)。
