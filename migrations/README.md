# 数据库迁移目录

状态：目录已建立，尚无业务迁移 SQL、迁移元数据或执行记录。

本目录保存 Drizzle Kit 生成并审核的版本化 SQL 和迁移元数据。数据库 Schema 位于 `apps/server/src/db/`；生产数据库和备份文件保存在运行环境的独立持久目录。

已执行迁移不直接修改；迁移验证与实际执行状态应分别记录。

具体流程见[迁移文档](../docs/data/migrations/workflow.md)和[备份与恢复](../docs/data/backup/backup-and-restore.md)。
