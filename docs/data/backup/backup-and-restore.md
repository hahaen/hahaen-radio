# 数据库备份与恢复

已实现受控命令、校验、隔离恢复与保留清理。本机 MySQL 8.0.46 的实际演练见[任务归档](../../iterations/2026-10-17-backup-recovery/README.md)；每日执行、复制与定时材料见[每日备份](../../operations/daily-backups.md)；真实异盘或远端挂载及目标 Linux 定时运行仍待部署验收。

## 工具与身份

工具运行于具备固定 Node.js 24.9.0 与 MySQL 8.0.46 `mysqldump`、`mysql` 客户端的受控运维节点，不在 API 镜像中安装客户端。根命令通过 tsx 运行源码；已构建的独立服务端包可直接运行 `node dist/entrypoints/backup.js ...`，不重建正在运行的共享包。

私有配置分别为 `.env.backup.local` 与 `.env.restore.local`，均应先确认已被 Git 排除、未跟踪，权限 600。以根 `.env.example` 的空值模板填写所需变量；命令显式加载对应文件，创建文件本身不会生效。生产运维节点可直接注入环境或显式使用 Node 的 `--env-file`。

| 变量 | 用途 |
| --- | --- |
| DB_*、NODE_ENV | 沿用服务端目标、字符集及 TLS 约束，备份和恢复使用不同身份 |
| MYSQLDUMP_PATH / MYSQL_PATH | 两个可信客户端的绝对路径，运行前校验版本为 8.0.46 |
| BACKUP_REPLICA_DIRECTORY / BACKUP_APPLICATION_REVISION | 每日副本目录与实际应用提交，见[每日备份](../../operations/daily-backups.md) |
| BACKUP_DIRECTORY | 已存在、当前用户拥有且权限 700 的绝对目录 |
| BACKUP_MAX_BYTES | 单个压缩与原始 SQL 的字节上限，默认 1GiB，显式配置范围 1MiB–100GiB |
| BACKUP_SCHEMA_STABLE | 只有排除并发 DDL 后才设置 true |
| BACKUP_WRITES_STOPPED | 迁移前备份还要求写入方已停止；日备份不要求停普通 InnoDB 写入 |

本地保留的敏感资料放在已排除的 `.local/archive/`；生产备份使用数据库卷之外的专用私有存储，不放在 Jenkins 临时工作区、Web 静态目录或镜像内。

备份身份需要源库的直接 SELECT、SHOW VIEW、TRIGGER、EVENT 权限，以及完整例程元数据可见性（全局 SHOW_ROUTINE，或已具备的全局 SELECT/ALL）。工具只读取所选项目库，不读取其他业务数据；不自动授予权限。依赖角色或逐表授权的复杂身份需先单独审计，当前检查不将不可证明的可见性当作完整备份。恢复身份需要专用新隔离库的 CREATE、导入与验收权限，不能用普通 API 身份替代。

客户端连接参数写入临时 700 目录下的 600 option file，密码不进入 argv；子进程不继承 DB/令牌变量，独立 login-file 路径避免读取个人 MySQL 登录配置。生产使用 VERIFY_IDENTITY 与可信 CA；仅已核对安全传输的 loopback 开发/测试允许禁用数据库层 TLS。客户端原始错误可能包含连接或 SQL，不直接输出到普通日志。

## 创建与校验

先确认目标库、部署互斥和结构变更窗口。迁移前必须停止 API、任务及其他写入方，并完成连接关闭；确认后设置私有环境中的前置条件变量。

```sh
pnpm db:backup create pre-migration "$APPLICATION_COMMIT"
pnpm db:backup copy "$BACKUP_ID"
pnpm db:backup create daily "$APPLICATION_COMMIT"
pnpm db:backup verify "$BACKUP_ID"
pnpm db:backup prune
```

创建后从成功事件取得 BACKUP_ID；迁移前完成 copy 并确认 backup_copy_verified 后再进入迁移。create 的第二个参数是备份对应应用的完整 40 位提交号。成功仅输出固定事件、生成的备份 ID 与类型；配置值、SQL 和数据不进入普通输出。

使用 mysqldump 的单事务、quick、utf8mb4、hex-blob、关闭 GTID_PURGED 与 tablespace 导出等明确选项；不导出 CREATE DATABASE，不产生普通表 DROP 语句。当前项目只支持 InnoDB 基表和库内外键；遇到视图、例程、事件、触发器、跨库引用或无法证明元数据可见性时拒绝，避免漏备份或将源库限定语句导入另一库。以后迁移增加这些对象时需同步扩展工具与恢复验收，不能静默跳过。

每个备份目录含 `dump.sql.gz` 和最后发布的 `manifest.json`，权限分别 700/600。清单记录源库、应用提交、表集合、迁移历史、时间、大小与压缩文件 SHA256；迁移前备份还记录停写时的表行数。日备份不将另一个时点的行数当作单事务快照行数。

压缩流与原始 SQL 默认限制为 1GiB，可在确认磁盘、耗时与恢复能力后显式配置上限，最高 100GiB；创建、verify、prune 和恢复节点应使用适配现有备份的同一容量设置。完整 gzip 解压、CRC、字节数与 SHA256 校验后才算成功，客户端最长运行 5 分钟。失败清理本轮未完成产物，取消会等待子进程退出并删除临时凭据；进程被强杀时可能留下私有锁和临时文件，应核对 PID、操作状态和现场后人工处理，不自动删除无法证明已失效的锁。

校验值防止意外损坏，不证明备份来源可信。仅恢复本工具生成、来源可确认且权限受控的备份。逻辑备份不包含数据库账号、权限、服务器配置或识曲文件预算；这些资料另行私有管理，恢复数据库不能重置识曲预算。

## 副本与保留

将完整备份目录复制到另一个已配置的独立存储位置，保持 700/600 权限；在那里设置 BACKUP_DIRECTORY 后再次 verify。必须实际演练仅凭副本恢复，不能把文件非空或复制命令返回成功当作可恢复证据。

prune 只处理符合本工具 ID 的完整备份；先校验所有候选，再保留最新 7 份 daily 和最新 3 份 pre-migration。遇到损坏、异常权限、软链接、硬链接或额外目录内容时拒绝清理；无关文件保留。目录内有互斥锁，多个本机维护命令不能同时改动该备份目录。备份创建另与迁移共用 MySQL 会话级维护锁，见[维护协调](../../operations/database-maintenance.md)；完整发布仍需覆盖整个维护窗口的外层互斥。

已提供 daily 与 copy 命令及 systemd service/timer，具体安装、独立设备检查、发布共享文件锁和部署验收见[每日备份](../../operations/daily-backups.md)。实际异盘/远端位置、加密、空间告警与容量上限由目标环境明确配置；当前未安装远端计划或上传真实备份。

## 隔离恢复

先保留原库和故障现场。`.env.restore.local` 显式使用 NODE_ENV=test、唯一的 `DB_NAME=ha_radio_test_restore_<suffix>` 与恢复身份；远程连接仍要求验证 TLS。test 表示隔离目标约束，不表示备份内容可以公开。

```sh
pnpm db:restore "$BACKUP_ID"
```

工具先完整校验备份，再检查目标不存在，创建 utf8mb4/utf8mb4_general_ci 空库并导入。拒绝开发库、正式库及任何已存在目标，不执行覆盖或自动 DROP。恢复完成后核对 InnoDB 基表集合、迁移历史及适用行数；仍须通过应用健康、目录与业务约束验收。导入失败保留部分隔离库供调查，固定错误事件会说明本次是否创建过隔离目标。

用兼容应用验证后，用户再决定修复、切换或恢复正式库；本项目工具不自动覆盖正式数据。管理员正式接管、归档原表、导入与应用恢复的步骤见[正式恢复手册](formal-recovery-runbook.md)，其Linux/Docker全流程仍待目标演练。恢复旧备份会丢失备份之后的写入，镜像回退不会自动回退数据库；需要时间点恢复时另行配置并演练 binlog 链路。

## 可重复验收

在私有环境中提供专用 `NODE_ENV=test`、全新 `DB_NAME=ha_radio_test_backup_<suffix>`、本地工具与受控数据库配置，然后执行：

```sh
pnpm test:backup
```

该命令会重建共享契约和服务端，应在相关进程停止后运行。入口拒绝已有源库，只创建本轮隔离库，执行既有 Drizzle Kit 迁移，验证 Unicode/转义、独立目录副本恢复、约束、持久额度、已有目标拒绝、损坏文件拒绝和编译 API 就绪，最后核对删除本轮数据库及退出子进程。它不操作开发或正式库，也不以另一数据库方言替代 MySQL。

参考 [MySQL mysqldump](https://dev.mysql.com/doc/refman/8.0/en/mysqldump.html) 与 [option files](https://dev.mysql.com/doc/refman/8.0/en/option-files.html)。返回[数据导航](../README.md)。
