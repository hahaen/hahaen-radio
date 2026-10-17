# 数据库迁移流程

状态：三条迁移已在开发库 `ha_radio_dev` 执行，当前 11 表、无待执行迁移；新增诊断迁移的隔离 MySQL 8.0.46 验证沿用既有证据。本次先完成原生一致性备份与同盘副本校验，再经 Drizzle Kit 执行新增一条，详见[收尾记录](../../iterations/2026-10-17-goal-completion/README.md)。正式库未创建、未执行。

## 当前入口与清单

```bash
pnpm db:generate --name=<change-name>
pnpm db:generate --custom --name=<change-name>
pnpm db:migrate status
pnpm db:migrate
```

生成入口使用 `apps/server/drizzle.config.ts`，输出至后端目录 `apps/server/migrations/`。迁移入口要求 `MIGRATION_WRITES_STOPPED=true`，先校验环境库名、MySQL 版本、连接字符集和 UTC，取得数据库维护锁后再启动固定 Drizzle Kit；应用启动不会自动执行迁移。迁移错误可能带 SQL 或连接信息，普通输出只报告状态，失败后先检查目标结构与工具历史表。

| 迁移 | 职责 |
| --- | --- |
| `0000_catalog_foundation.sql` | 建立 8 张业务表、外键和索引，机器标识明确采用 ascii_bin |
| `0001_explicit_table_options.sql` | 自定义迁移，显式补齐 InnoDB、utf8mb4_general_ci、DYNAMIC 及普通文本列配置，保留 ASCII 字段例外 |
| `0002_playback_diagnostics.sql` | 两张诊断表、约束、固定容量、每日额度初始行及显式表选项 |

首条生成 SQL 与后续表选项迁移必须作为完整初始化序列执行，完成前不启动业务。迁移历史表由 Drizzle Kit 创建，本项目在自定义迁移中约束其表选项；不手工伪造迁移记录。JSON 字段使用 MySQL 原生 JSON 语义，不误当普通 varchar 列转换。

本地迁移专用 `.env.migration.local` 与 API `.env.local`、任务 `.env.jobs.local` 分开，全部须被 Git 排除且权限为 600。部署时由环境注入相同变量，不把本机私有文件打入镜像。变量与身份范围见[配置文档](../../operations/configuration-and-logging.md)。

目标历史前缀、表集合与首次初始化确认见[迁移预检](target-preflight.md)。完整目标发布执行器仍在推进，状态查询不代替维护、停写或备份。

维护锁、停写确认与取消边界见[维护协调](../../operations/database-maintenance.md)。锁不代替实际停写和外层完整发布互斥。

## 独立 MySQL 验收命令

设置 `NODE_ENV=test`、唯一 `DB_NAME=ha_radio_test_<suffix>` 和具备该测试流程权限的数据库配置后运行 `pnpm test:mysql`。既有进程变量优先于环境文件；测试库名不能使用开发或正式库名。

测试入口拒绝覆盖已存在的库，只创建本次专用库，先应用最新一条之前的已发布序列、写入 Unicode 保留样例，再升级完整序列、重复执行并运行仓储验收。最后仅删除本次创建的测试库。涉及实际建库和 DDL，执行前确认目标实例与身份；不在正式环境运行该命令。

检查覆盖表选项、字符例外、迁移记录、Unicode 保留、重复同步、源失败保留、未发布暂存、租约接管、过期令牌拒绝发布、人工屏蔽、事务回滚、操作超时和连接获取超时后的恢复。普通 `pnpm test` 会跳过真实数据库用例，不能以普通测试通过代替本命令。

## 单一迁移机制

TypeScript Drizzle Schema 是结构定义源，使用 MySQL 方言。Drizzle Kit 负责生成和执行迁移，SQL、元数据和 Schema 同步提交；不混用 Flyway、其他迁移器或应用启动自动建表。

开发时生成 SQL，发布时只执行已生成并验证的迁移。生产禁止 `drizzle-kit push`，也不在 Jenkins 发布阶段生成新迁移或临时修改 SQL。

## 开发阶段

1. 修改 Drizzle Schema。
2. 使用固定版本的 Drizzle Kit 生成迁移 SQL 与元数据。
3. Review SQL 的建表、字段转换、索引、约束、锁表与数据影响；检查 utf8mb4、utf8mb4_general_ci、InnoDB、DYNAMIC 以及字段级例外。工具不能表达的选项、特殊变更和数据修正使用 Drizzle Kit 自定义迁移。
4. 在独立 MySQL 8.0.46 空库验证完整初始化。
5. 在含代表性旧结构与数据的隔离 MySQL 8.0.46 测试库验证升级和数据保留。
6. 将 Schema、SQL、元数据和必要的数据转换脚本一起版本化。

迁移一旦在共享环境执行，就不直接修改已有文件；后续修正使用新迁移。生产不使用绕过版本记录的直接 Schema 推送。

## 生产执行

迁移由 Jenkins 手动发布中的独立阶段调用，对同一目标数据库加发布锁，只运行一个迁移进程。API 与任务不会在启动时执行迁移。

迁移使用同一提交构建的独立镜像或受控工具环境，包含固定版本的 Drizzle Kit、mysql2、配置、SQL 和元数据。不能假定裁剪了开发依赖的 API 生产镜像自带迁移工具；数据库连接信息仅运行时注入。

涉及结构变更时，先确认目标库与待执行清单，准备维护窗口，停止应用和后台任务写入，生成并校验备份，并用 copy 将迁移前备份复制至已配置副本位置、完成复验后，再运行迁移。评估大表变更的锁等待、额外磁盘空间与耗时。

执行完成后记录目标环境、发布标识、迁移清单和结果，再启动应用并验证。失败时停止后续发布，不假定所有迁移都自动回滚。

## MySQL 失败处理

DDL 可能隐式提交，后续语句失败时前面的变更可能已经生效。保持维护状态，核对实际结构、数据和迁移日志表，确定修复或恢复策略后再继续，禁止无条件重跑整批 SQL。

迁移日志表由固定版本的工具维护，不通过手工改记录伪造完成状态。已执行文件的不可变性由代码 Review 与版本记录共同保证，不能把迁移历史表视为完整的数据库漂移检测。

## 状态表述

发布记录必须区分：

- 已生成 SQL，尚未执行。
- 已在临时数据库验证。
- 已在指定目标环境执行。
- 已完成应用与数据验收。

工具命令的职责为 `drizzle-kit generate` 生成 SQL，`drizzle-kit migrate` 执行待应用迁移，自定义变更通过锁定版本支持的 `generate --custom` 流程管理。项目包装入口的职责为配置预检和脱敏输出，不引入第二套迁移器。

工具行为见[生成迁移](https://orm.drizzle.team/docs/drizzle-kit-generate)和[执行迁移](https://orm.drizzle.team/docs/drizzle-kit-migrate)。

字符集和排序规则的验收依据见[建库建表规范](../database/table-options-and-collations.md)，不因建库有默认值就省略表与列级检查。

恢复原则见[备份与恢复](../backup/backup-and-restore.md)，执行顺序见[发布与回退](../../deployment/releases/release-and-rollback.md)。
