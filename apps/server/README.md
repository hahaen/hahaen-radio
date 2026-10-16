# 后端应用

状态：目录骨架已建立，Fastify、依赖配置、进程入口和数据库连接尚未初始化。

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

API 和后台任务共用工程，使用不同入口。生产数据库放在服务器持久卷，不能保存在源码目录或镜像层。

占位目录由 `.gitkeep` 保留；增加实际文件后可删除相应占位文件。

技术约定见[后端文档](../../docs/backend/README.md)和[数据文档](../../docs/data/README.md)。
