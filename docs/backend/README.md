# 后端技术文档

状态：后端技术和分层约定已确定，`apps/server` 目录骨架已建立，依赖和可运行服务入口待初始化。

| 子目录 | 文档 | 内容 |
| --- | --- | --- |
| `api/` | [接口约定](api/conventions.md) | REST、校验、错误、版本与文档 |
| `services/` | [服务与外部接入](services/layers-and-integrations.md) | 业务、仓储、配置和适配器边界 |
| `jobs/` | [任务调度](jobs/scheduling.md) | 调度、并发、互斥和失败恢复 |

数据库访问约定见[数据文档](../data/README.md)。返回[文档导航](../README.md)。
