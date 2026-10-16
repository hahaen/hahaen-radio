# 数据技术文档

数据库技术已确定，业务表结构和首个迁移尚未设计或执行。

| 子目录 | 文档 | 内容 |
| --- | --- | --- |
| `database/` | [SQLite 与 Drizzle](database/sqlite-and-drizzle.md) | 连接、WAL、约束、查询和并发 |
| `migrations/` | [迁移流程](migrations/workflow.md) | 生成、审核、验收与生产执行 |
| `backup/` | [备份与恢复](backup/backup-and-restore.md) | 一致性快照、保留、校验与恢复 |

运行目录与卷见[容器与存储](../deployment/containers/topology-and-storage.md)。返回[文档导航](../README.md)。
