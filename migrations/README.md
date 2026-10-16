# 数据库迁移目录

状态：已生成两条迁移及 Drizzle 元数据，隔离 MySQL 8.0.46 的初始化与升级保留验收通过，开发库已执行；正式库未执行。

本目录保存 Drizzle Kit 为 MySQL 8.0.46 生成并审核的版本化 SQL 和迁移元数据。结构定义位于 `apps/server/src/db/`，采用 MySQL 方言；SQL、元数据和 Schema 同步版本化，具体目录格式由固定版本工具生成。

开发使用 Drizzle Kit 生成 SQL，Review 后在隔离 MySQL 测试库验证，再由 Jenkins 手动发布中的独立阶段执行。生产不使用 `drizzle-kit push`，不临时生成 SQL，也不引入第二套迁移执行器。

已执行迁移不直接修改；MySQL DDL 可能隐式提交，失败时核对结构和迁移记录，不假定整批回滚。迁移准备、测试与实际执行状态应分别记录。

具体流程见[迁移文档](../docs/data/migrations/workflow.md)和[备份与恢复](../docs/data/backup/backup-and-restore.md)。
