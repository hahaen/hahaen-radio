# 共享数据契约

状态：工作区包、Zod 健康响应与公开错误契约已建立。

`src/` 用于前后端共享的 DTO、Zod Schema、公开错误码及导出入口。

本包不依赖应用，不导入数据库驱动、服务器环境变量、Node.js 专用模块或私密配置。源码通过 TypeScript 编译到 `dist/`，包导出声明与 ESM 入口均指向编译产物；应用启动前先构建本包。

相关约定见[仓库目录与包边界](../../docs/architecture/repository-layout.md)和[API 约定](../../docs/backend/api/conventions.md)。
