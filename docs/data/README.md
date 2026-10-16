# 数据技术文档

已确定使用 MySQL 8.4 LTS、mysql2、Drizzle ORM 和 Drizzle Kit；业务表结构、连接、迁移及备份能力尚未实现或执行。

| 子目录 | 文档 | 内容 |
| --- | --- | --- |
| `database/` | [MySQL 与 Drizzle](database/mysql-and-drizzle.md) | MySQL、连接池、权限、约束与事务 |
| `migrations/` | [迁移流程](migrations/workflow.md) | 生成、审核、验收与生产执行 |
| `backup/` | [备份与恢复](backup/backup-and-restore.md) | 一致性快照、保留、校验与恢复 |

运行目录与卷见[容器与存储](../deployment/containers/topology-and-storage.md)。返回[文档导航](../README.md)。
