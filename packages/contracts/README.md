# 共享数据契约

状态：目录骨架已建立，工作区包配置和具体契约待初始化。

`src/` 用于前后端共享的 DTO、Zod Schema、公开错误码及导出入口。

本包不依赖应用，不导入数据库驱动、服务器环境变量、Node.js 专用模块或私密配置。包导出和构建方式在 pnpm Workspace 初始化时确定。

相关约定见[仓库目录与包边界](../../docs/architecture/repository-layout.md)和[API 约定](../../docs/backend/api/conventions.md)。
