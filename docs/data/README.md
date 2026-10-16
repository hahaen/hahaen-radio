# 数据技术文档

已实现 MySQL 8.0.46、mysql2 连接池、Drizzle Schema 和两条迁移，隔离库验收通过且开发库已应用；正式库与备份恢复尚未执行。

| 子目录 | 文档 | 内容 |
| --- | --- | --- |
| `database/` | [MySQL 与 Drizzle](database/mysql-and-drizzle.md) | MySQL、连接池、权限、约束与事务 |
| `database/` | [表选项与排序规则](database/table-options-and-collations.md) | 已核对的默认值、字段例外和环境库名 |
| `migrations/` | [迁移流程](migrations/workflow.md) | 生成、审核、验收与生产执行 |
| 目录管线 | [同步与版本发布](catalog-pipeline.md) | 真实目录、租约、失败保留和运维命令 |
| `backup/` | [备份与恢复](backup/backup-and-restore.md) | 一致性快照、保留、校验与恢复 |

运行目录与卷见[容器与存储](../deployment/containers/topology-and-storage.md)。返回[文档导航](../README.md)。
