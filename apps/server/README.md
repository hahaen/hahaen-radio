# 后端应用

状态：已实现 Fastify API、MySQL 连接池、目录同步与查询、独立任务和迁移入口。其他业务按产品阶段继续推进。

## 目录职责

| 目录 | 用途 |
| --- | --- |
| `src/entrypoints/` | API、后台任务和一次性迁移进程入口 |
| `src/plugins/` | Fastify 基础设施插件 |
| `src/modules/` | 按业务模块组织路由、服务和数据仓储 |
| `src/integrations/` | 外部服务适配器 |
| `src/jobs/` | 调度、任务、互斥和恢复逻辑 |
| `src/db/` | Drizzle Schema、连接和数据库配置 |
| `src/config/` | 环境变量与运行配置校验 |

API 和后台任务共用工程，使用不同入口。通过 mysql2 连接池和 Drizzle ORM 访问 MySQL 8.0.46，API 与任务不挂载数据库数据卷。迁移由独立 Drizzle Kit 工具入口执行。入口和权限见[配置文档](../../docs/operations/configuration-and-logging.md)。

根目录命令为 `pnpm db:generate`、`pnpm db:migrate`、`pnpm catalog sync`、`pnpm catalog status`、`pnpm jobs` 和 `pnpm test:mysql`。生产 API 与任务分别运行编译入口 `start` 和 `start:jobs`；迁移镜像仍须包含配置、Schema、SQL 及固定工具依赖。

占位目录由 `.gitkeep` 保留；增加实际文件后可删除相应占位文件。

技术约定见[后端文档](../../docs/backend/README.md)和[数据文档](../../docs/data/README.md)。
