# 项目总览

项目名称：声屿 HAEN。项目标语：嗯，听听世界。

## 当前状态

| 项目 | 状态 |
| --- | --- |
| 技术组合和部署组织方式 | 已确定 |
| 数据库与迁移方案 | MySQL 8.0.46、mysql2、Drizzle ORM、Drizzle Kit 已确定 |
| 数据库建表选项 | 已只读核对，默认 utf8mb4_general_ci、InnoDB、DYNAMIC，应用与迁移待实施 |
| 技术文档目录与说明 | 已整理 |
| 前端、后端、共享包与工程辅助目录 | 目录骨架已建立 |
| 应用依赖、工作区配置与基础入口 | 已建立，基础检查和生产构建通过，详见产品验收矩阵 |
| 数据模型、迁移和初始化数据 | 待设计、待实施 |
| Docker、Compose、Caddy 配置 | 待实施 |
| Jenkins 任务、凭据和服务器连接 | 待配置、待验证 |
| 当前依赖组合的安装、类型检查和构建 | 冻结安装与基础构建通过，后续依赖增加时重新验证 |

## 本轮文档范围

确定开发语言、框架、图形与音频基础、数据存储、代码组织、工程质量、构建发布和运行维护约定。

具体页面、业务流程、API 字段和数据库表结构在后续需求设计时补充。本目录不以尚未确定的功能倒推已存在的实现。

## 部署基线

- 代码：一个 Git 仓库，通过 pnpm Workspace 管理。
- 应用：前后端独立构建，前端静态资源与后端服务分别运行。
- 服务器：一台具备持久磁盘的 Linux 服务器，API 单实例。
- 数据库：计划连接已提供的现有 MySQL 8.0.46 实例，地址与身份私有保存；开发 `ha_radio_dev`、正式 `ha_radio` 检查时均未创建。
- 域名：同一域名，Caddy 提供前端并将 `/api/*` 转发给后端。
- 发布：Jenkins 手动触发，Docker Compose 更新服务；默认一起发布，可单独更新。
- 音频：浏览器直连电台音频服务，项目后端主要承担数据接口。

这是目标部署方案，尚未确认实际服务器、域名、端口和 Jenkins 节点条件。

数据库分工和变更依据见[ADR-0002](../architecture/decisions/0002-mysql-and-drizzle-kit.md)，本轮归档见[MySQL 与迁移工具选型](../iterations/2026-10-16-mysql-drizzle-kit/README.md)。

现有版本和建表选项的最新约定见[ADR-0003](../architecture/decisions/0003-table-options-and-target-environment.md)与[建表选项核对归档](../iterations/2026-10-16-table-options/README.md)。

下一篇：[技术选型](technology-stack.md)。返回[文档导航](../README.md)。
