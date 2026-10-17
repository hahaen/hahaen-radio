# 数据技术文档

已实现 MySQL 8.0.46、mysql2 连接池、Drizzle Schema 和三条迁移；前两条已在开发库应用，第三条仅在隔离库验收。备份与隔离恢复已通过本机验收，正式库未执行。

| 子目录 | 文档 | 内容 |
| --- | --- | --- |
| `database/` | [MySQL 与 Drizzle](database/mysql-and-drizzle.md) | MySQL、连接池、权限、约束与事务 |
| `database/` | [表选项与排序规则](database/table-options-and-collations.md) | 已核对的默认值、字段例外和环境库名 |
| `migrations/` | [迁移流程](migrations/workflow.md) | 生成、审核、验收与生产执行 |
| `migrations/` | [目标预检](migrations/target-preflight.md) | 历史前缀、表集合与首次空库保护 |
| 目录管线 | [同步与版本发布](catalog-pipeline.md) | 真实目录、租约、失败保留和运维命令 |
| 离线地理 | [地点与地形资源](offline-geography.md) | GeoNames 导入、证据边界与 Natural Earth 再生成 |
| `backup/` | [备份与恢复](backup/backup-and-restore.md) | 一致性快照、保留、校验与恢复 |

运行目录与卷见[容器与存储](../deployment/containers/topology-and-storage.md)。返回[文档导航](../README.md)。

[正式数据库恢复手册](backup/formal-recovery-runbook.md)：管理员接管、故障现场留存、原生导入、持久状态分支和目标演练。
