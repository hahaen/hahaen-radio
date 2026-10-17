# 正式数据库恢复操作手册

本手册供获得正式恢复授权的发布负责人和数据库管理员在维护窗口执行。当前交付仅包含手册与隔离演练，未创建、恢复或修改正式库。现有restore-isolated入口继续拒绝正式库及已有库；不存在自动覆盖正式库的项目命令。镜像recover也不会恢复SQL或补执行迁移。

命令逐段执行并检查退出码和验收条件，失败即停在当前阶段，不连续粘贴后续步骤。示例中的路径和唯一标识必须来自本次私有执行单，不能把示例标识当作已批准目标。

## 1．确定恢复方案与责任

先区分仅镜像故障、可审核的前向修复和确需回到旧数据的灾难恢复；能够保持数据的已验证修复应单独评估。本流程适用于MySQL 8.0.46、项目库ha_radio、仅InnoDB基表、库内外键、无视图/触发器/例程/事件，且实例与存储仍可用的情况。管理员将当前表整体归档到同实例的全新私有库，再向空的ha_radio导入可信备份；不删除原库、不改写迁移历史、不直接操作数据目录。

实例或磁盘不可用时，先由数据库管理员恢复服务/可信存储，或者准备另一实例并完成独立演练、TLS/权限与切换方案。本手册不把修改DB_HOST当作已经完成异机切换，也不承诺跨实例锁或时间点恢复；binlog链路需另行部署和演练。

恢复前形成权限600的私有执行单，逐项填写并审核：

| 项目 | 必须明确 |
| --- | --- |
| 授权与人员 | 事件编号、恢复批准人、执行人、复核人、维护窗口；本手册本身不授予正式写入权限 |
| 实际目标 | 实例UUID、主实例角色、ha_radio、连接配置指纹、TLS身份；不能只凭域名/IP认定同一实例 |
| 恢复点 | 可信备份ID、独立副本位置、完整校验结果、来源库、应用提交、迁移摘要/时间、容量和表清单 |
| 数据影响 | 停写时刻、最后确认数据、会丢失或需补偿的写入、接受的RPO/RTO；清单createdAt不是精确事务快照时刻 |
| 恢复后版本 | state.current或已审查的state.attempt.candidate、实际三镜像摘要及imageRevisions、对应迁移源码；支持当前文件日志格式 |
| 可恢复证据 | 仅凭独立副本在唯一隔离库完成恢复、表/约束/业务验收；若需前向迁移，也在该副本上单次演练 |
| 留存与失败 | 当前故障状态和备份、归档库名、部分恢复库的处置责任、撤销条件及清理到期日 |

备份来源必须是本工具可验证的受控产物。SHA256/CRC只证明完整性，不能证明来源可信。日备份没有停写行数，不能编造行数相等证据。恢复数据库不能重置独立识曲预算文件；账号、授权、CA、发布状态和证书不在SQL备份内。

## 2．准备私有材料并先演练

在受控运维节点使用同版本Node.js、编译入口、MySQL 8.0.46的mysql/mysqldump及可信CA。以下变量均由操作者从私有执行单设置，不使用实际密码或带凭据URL作为命令参数，也不source环境文件：

进入维护前，确认选定的三镜像已在目标主机可用，实际摘要、revision及服务端日志能力与执行单相符；缺失时先完成既有受控只读拉取流程，不在停写后临时寻找凭据。镜像、编译工具、Compose和恢复后结构必须是已演练的组合。

| 变量 | 用途 |
| --- | --- |
| BACKUP_ENV_FILE / RESTORE_TEST_ENV_FILE | 外部600的备份校验配置、唯一隔离恢复配置；后者NODE_ENV=test且DB_NAME为全新的ha_radio_test_restore_后缀 |
| BACKUP_ENTRY | 已审核编译包中backup.js的绝对路径 |
| BACKUP_ID / APPLICATION_COMMIT | 选择的可信备份ID、故障现场备份对应的实际服务端完整提交 |
| RESTORE_COMPOSE_ENV | 私有raw Compose环境文件，三个不可变镜像及配置路径必须与选定恢复版本匹配 |
| TARGET_ENV_FILE | 发布身份的外部Node环境文件，目标、配置指纹及动作经独立复核；不复制Jenkins整套进程环境 |
| MYSQL_PATH / ADMIN_OPTIONS_FILE | 固定mysql二进制、管理员600 option file；VERIFY_IDENTITY、可信CA及utf8mb4，不在argv提供口令 |
| PRIVATE_WORK / VERIFIED_DUMP | 新建700私有工作目录、其中600的已验证原始SQL文件路径，不放工作区或公共归档 |
| MAINTENANCE_DIRECTORY / RESTORE_SITE | 从既有target配置核对的维护目录、无凭据HTTPS站点 |

先从实际独立副本校验并演练；RESTORE_TEST_ENV_FILE必须指向隔离目标，不能因为设置test而放松远程TLS。命令会实际写入新的隔离库，须核对其唯一性和测试权限：

```sh
node --env-file="$BACKUP_ENV_FILE" "$BACKUP_ENTRY" verify "$BACKUP_ID"
node --env-file="$RESTORE_TEST_ENV_FILE" "$BACKUP_ENTRY" restore-isolated "$BACKUP_ID"
```

检查恢复表集合、完整SHOW CREATE TABLE、索引/外键、迁移历史、可靠的计数及业务不变量；编译API的数据库与目录readiness、真实选台/播放也要验收。迁移status的表集合与历史检查不等于完整结构漂移检查。若选择的恢复后版本含更多迁移，先在隔离副本上验证精确历史前缀、停写备份、Drizzle Kit单次迁移及数据保留，不到正式现场临时决定升级。

## 3．接管整个维护窗口

由操作者停止/禁用该目标的所有Jenkins发布入口及其他主机的手工发布，暂停每日备份timer和其他维护调度，确认已有run和进程已真正结束。不要中断仍在执行的DDL后立即重试。记下原调度状态，以便最后只恢复原来启用的项目。

在应用主机由有权发布的用户进入独占锁内的受控shell。锁文件及目录仍须符合[执行器](../../deployment/releases/target-executor.md)的root所有权、组与权限要求；锁忙退出75时停止，不删除或更换锁文件：

```sh
umask 077
export HISTFILE=/dev/null
/usr/bin/flock --no-fork --exclusive --nonblock --conflict-exit-code 75 /var/lib/haen-maintenance/deploy.lock /bin/bash --noprofile --norc
```

后续应用主机操作都在此shell内完成，关闭shell会释放文件锁。它不代替跨主机数据库release锁。管理员另开受控mysql会话，用明确的option file、禁用重连，并通过MYSQL_TEST_LOGIN_FILE指向私有工作目录中一个不存在的路径，避免读取个人login file；MYSQL_HISTFILE设为/dev/null：

```sh
MYSQL_HISTFILE=/dev/null MYSQL_TEST_LOGIN_FILE="$PRIVATE_WORK/no-login-file" "$MYSQL_PATH" --defaults-file="$ADMIN_OPTIONS_FILE" --skip-reconnect --skip-auto-rehash --skip-force --binary-mode --local-infile=0 ha_radio
```

在该管理员会话核对版本、实例UUID、TLS Cipher、当前库和字符设置，设UTC；原始结果只留私有记录。再取得与代码一致的release锁，只有结果为1才能继续，记录CONNECTION_ID：

```sql
SET time_zone = '+00:00';
SELECT VERSION(), @@server_uuid, DATABASE(), @@collation_connection;
SHOW SESSION STATUS LIKE 'Ssl_cipher';
SET @release_key = CONCAT('haen:release:', LEFT(SHA2('ha_radio', 256), 40));
SET @maintenance_key = CONCAT('haen:maintenance:', LEFT(SHA2('ha_radio', 256), 40));
SELECT GET_LOCK(@release_key, 0), CONNECTION_ID();
```

保持会话直到正式恢复和结构验收结束，每次进入写阶段前核对IS_USED_LOCK(@release_key)=CONNECTION_ID()。锁是协作式的；管理员会话掉线、实例变化或文件锁丢失时，操作者必须停止正在执行的手工命令、核对实际完成状态并重新接管，不允许自动重连继续。手工客户端不会获得项目执行器的自动失锁取消能力，恢复必须有人值守，其他发布入口在整个窗口保持停用。

保存原始state.json、当前attempt、镜像组合及维护状态的私有副本，保留600权限；不编辑/删除attempt。按已核对的维护目录创建enabled普通文件，模式644，不覆盖未知文件或链接。以既定Web检查/maintenance返回enabled，并确认外部站点返回503维护页。随后执行：

```sh
docker compose --project-name haen --env-file "$RESTORE_COMPOSE_ENV" --file deploy/compose/compose.yaml config --quiet
docker compose --project-name haen --env-file "$RESTORE_COMPOSE_ENV" --file deploy/compose/compose.yaml stop --timeout 30 jobs api
```

确认两个容器已停止、应用连接已关闭；管理员核对其余写入方、长事务及DDL均停止，必要时按独立授权隔离其他写入身份。不能用GET_LOCK成功代替停写证明，不在共享终端输出完整processlist或expanded Compose配置。

## 4．保存故障现场与准备导入

此时管理员release锁保持，暂不占用maintenance锁，让已有备份入口按其规则取得内部锁。确认BACKUP_SCHEMA_STABLE与BACKUP_WRITES_STOPPED确实成立，再从当前现场创建新的迁移前备份并完成独立副本验证，保留新ID；它与待恢复的旧BACKUP_ID不同：

```sh
node --env-file="$BACKUP_ENV_FILE" "$BACKUP_ENTRY" create pre-migration "$APPLICATION_COMMIT"
node --env-file="$BACKUP_ENV_FILE" "$BACKUP_ENTRY" copy "$FAULT_BACKUP_ID"
node --env-file="$BACKUP_ENV_FILE" "$BACKUP_ENTRY" verify "$BACKUP_ID"
```

第一条成功后由操作者将输出ID记为FAULT_BACKUP_ID。如果现场结构已不受工具支持，停止正常流程，由管理员先保存等价可验证的故障证据并重新批准方案；不能把备份失败当成没有现场需要保存。暂停prune，确保选定备份不会被清理。

从刚verify成功的同一受控备份目录解压到PRIVATE_WORK下全新文件，开启shell noclobber且umask077；gzip失败、空间不足或plainBytes不符时不导入。不把明文SQL放在普通日志中。BACKUP_DUMP_GZ与VERIFIED_DUMP均为私有执行单核对的完整文件路径：

```sh
set -o noclobber
gzip --test -- "$BACKUP_DUMP_GZ"
gzip --decompress --stdout -- "$BACKUP_DUMP_GZ" > "$VERIFIED_DUMP"
```

每条必须退出0，核对文件为600、非链接、原始字节数等于manifest.plainBytes；再复核压缩文件SHA与已验证清单一致。清单、dump和生成的SQL只供受控管理员使用，不上传Jenkins或Git。

## 5．归档原表后导入

管理员会话再次核对release锁，取得maintenance锁（结果必须1），排除其他维护命令。列出全部表，确认仅InnoDB基表、无特殊对象/跨库外键；管理员需有ha_radio原表ALTER/DROP，以及归档目标CREATE/INSERT等必要权限，不临时给API身份授予DDL。

```sql
SELECT IS_USED_LOCK(@release_key) = CONNECTION_ID();
SELECT GET_LOCK(@maintenance_key, 0);
SELECT TABLE_NAME, TABLE_TYPE, ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'ha_radio' ORDER BY TABLE_NAME;
SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
WHERE (CONSTRAINT_SCHEMA = 'ha_radio' OR UNIQUE_CONSTRAINT_SCHEMA = 'ha_radio')
  AND CONSTRAINT_SCHEMA <> UNIQUE_CONSTRAINT_SCHEMA;
```

跨库计数必须0。分别确认TRIGGERS、ROUTINES、EVENTS中项目对象为0；视图、临时表、非InnoDB、加密或文件系统限制、归档名已存在时暂停，不关闭外键检查来绕过失败。选择从未存在的归档库名并生成**供人工Review、不自动执行**的单条RENAME计划，归档库在同实例、相同存储和加密策略下；下面archive_name_must_be_replaced必须换成私有执行单批准的唯一标识：

```sql
SET @archive_schema = 'archive_name_must_be_replaced';
SET SESSION group_concat_max_len = 1048576;
SELECT CONCAT('CREATE DATABASE `', REPLACE(@archive_schema, '`', '``'),
              '` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;') AS reviewed_create_sql;
SELECT CONCAT('RENAME TABLE ', GROUP_CONCAT(
  CONCAT('`ha_radio`.`', REPLACE(TABLE_NAME, '`', '``'), '` TO `',
         REPLACE(@archive_schema, '`', '``'), '`.`', REPLACE(TABLE_NAME, '`', '``'), '`')
  ORDER BY TABLE_NAME SEPARATOR ', '), ';') AS reviewed_rename_sql
FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'ha_radio';
```

将计划存入600私有文件，逐表核对全部当前表（包括迁移历史表）与故障备份清单一致，没有遗漏或截断，生成结果不能为NULL。管理员执行审核的CREATE，创建该全新归档库，不用IF NOT EXISTS；再执行审核的**一条多表RENAME TABLE**，不要拆成循环。它在满足MySQL条件时是原子的，但不与后续导入构成事务；失败先核对状态，不重跑或删除目标。逐表授权不会随重命名迁移，归档访问权限须由管理员核对，不能把它当作应用可继续访问的在线库。依据为[MySQL RENAME TABLE规则](https://dev.mysql.com/doc/refman/8.0/en/rename-table.html)。

确认ha_radio基表数量为0、原表及外键均在归档库、没有跨回ha_radio的引用。正式库继续存在，连接配置不变。保持管理员两把锁及外层文件锁，由另一受控终端执行原生批处理导入；CLI默认值被显式覆盖，不读取历史登录配置，不使用force或SOURCE继续执行文件中的错误：

```sh
MYSQL_HISTFILE=/dev/null MYSQL_TEST_LOGIN_FILE="$PRIVATE_WORK/no-login-file" "$MYSQL_PATH" --defaults-file="$ADMIN_OPTIONS_FILE" --skip-reconnect --skip-force --binary-mode --local-infile=0 ha_radio < "$VERIFIED_DUMP" > "$PRIVATE_WORK/import.stdout" 2> "$PRIVATE_WORK/import.stderr"
```

该终端先设umask077，输出文件不得覆盖旧证据；[客户端选项](https://dev.mysql.com/doc/refman/8.0/en/mysql-command-options.html)需与已验证的8.0.46一致。退出非0、SQL错误、连接丢失或管理员锁会话失效时保持维护和停写，保留归档与部分导入表；不能再向半完成目标重复导入。默认不删归档，不用DROP DATABASE或修改迁移记录“修好”错误。需要撤销时另审查部分目标的保存、空目标重建或原表反向重命名，先在隔离副本证明，不盲目执行逆操作。

## 6．结构与应用恢复

先保持停写，验证表集合、引擎/排序规则/行格式、完整列/索引/约束、迁移哈希和时间。pre-migration清单中的逐表行数须一致；日备份只检查独立演练确认的业务约束和合理数量。确认归档表的外键只引用归档库，恢复表只引用ha_radio，不能把新表连到故障现场。

若备份历史就是选定镜像的完整历史，迁移status应pending=0。若批准的方案需要前向升级，先退出管理员maintenance锁、保留release锁与外层文件锁，对已恢复状态重新执行停写备份及copy，再以选定提交的迁移入口单次执行；随后重新取得maintenance锁并验收。先确认管理员会话已释放maintenance锁，再启动需要同锁的备份/迁移命令，否则它会按设计拒绝：

```sql
SELECT RELEASE_LOCK(@maintenance_key);
```

```sh
docker compose --project-name haen --env-file "$RESTORE_COMPOSE_ENV" --file deploy/compose/compose.yaml --profile tools run --rm --no-deps --no-TTY migration status
# 仅批准的升级方案才执行下一条；私有迁移配置中MIGRATION_WRITES_STOPPED=true。
docker compose --project-name haen --env-file "$RESTORE_COMPOSE_ENV" --file deploy/compose/compose.yaml --profile tools run --rm --no-deps --no-TTY migration
```

不能使用drizzle-kit push、补写/删除历史、自动重跑失败DDL。完成后必须pending=0且完整结构和业务验收通过。下面两条恢复分支按真实持久状态选择，不能伪造state/attempt来套入口：

- **存在attempt**：只选择真实state.current或已审查的attempt.candidate，其迁移与恢复后结构完整一致；按[明确恢复参数](../../deployment/releases/target-executor.md)设置recover/full、确认标志及current/attempt。管理员先释放maintenance/release锁并退出数据库会话，原应用主机flock shell继续持有同一文件锁，再以exec将同一进程交给编译入口的--locked分支。该分支实际核对fd3、inode和/proc/locks所有者，不支持时拒绝，禁止伪造锁或绕过校验：

```sh
exec node --env-file="$TARGET_ENV_FILE" apps/server/dist/entrypoints/deploy.js --locked
```

此处数据库release锁从管理员会话交给执行器时存在交接间隔，文件锁不释放；其他主机的发布入口必须持续停用且由同一维护负责人控制。若不能保证该条件，不执行交接，保持停写并安排专用协调方案。--locked是既有内部锁协议，仅限上述同进程exec交接，不能单独直接调用来跳过加锁；Linux实机验收未通过前不能认定该分支可用。

- **没有attempt**：保持原state.current，不改写版本记录；恢复后的结构必须与当前三镜像一致。仍在锁内按api→web→jobs顺序手工启动并验收。管理员在启动前释放maintenance锁，release锁保留到验收结束；按现有Compose逐服务up --detach --no-deps --force-recreate，API/Web使用--wait --wait-timeout 120。任务需实际文件日志探针确认本次容器StartedAt之后、正确服务端提交的scheduler_started，并确认没有重启。不能只看容器Running。

```sh
docker compose --project-name haen --env-file "$RESTORE_COMPOSE_ENV" --file deploy/compose/compose.yaml up --detach --no-deps --force-recreate --wait --wait-timeout 120 api
docker compose --project-name haen --env-file "$RESTORE_COMPOSE_ENV" --file deploy/compose/compose.yaml up --detach --no-deps --force-recreate --wait --wait-timeout 120 web
docker compose --project-name haen --env-file "$RESTORE_COMPOSE_ENV" --file deploy/compose/compose.yaml up --detach --no-deps --force-recreate jobs
```

读取jobs的单一容器ID与State.StartedAt（只读取这些字段），由操作者把日期及实际服务端提交设置为HAEN_RESTORE_STARTED_AT、HAEN_RESTORE_SERVER_REVISION。在同提交工作区生成现有共享探针，文件权限600，再从stdin交给容器Node执行：

```sh
node --input-type=module -e 'import {runtimeLogProbe} from "./scripts/deploy/runtime-logs.mjs"; console.info(runtimeLogProbe("jobs",process.env.HAEN_RESTORE_SERVER_REVISION,"scheduler_started",Date.parse(process.env.HAEN_RESTORE_STARTED_AT)))' > "$PRIVATE_WORK/jobs-probe.mjs"
docker compose --project-name haen --env-file "$RESTORE_COMPOSE_ENV" --file deploy/compose/compose.yaml exec --no-TTY jobs node --input-type=module < "$PRIVATE_WORK/jobs-probe.mjs"
```

两条分支均检查数据库/目录readiness、同域API、首页及实际哈希资源、正确后台版本、日志、选台/播放/收藏主流程，识曲预算不清零。人工分支在确认活动备份版本文件仍为正确服务端提交后才删除已核对目录中的enabled标记；外部HTTPS健康与首页通过后释放release锁、退出flock shell。执行器分支由其持久阶段和探针控制维护清除，不另外手动删除标记。

任何验收失败都保持/恢复维护并停止API/jobs，保留实际SQL和attempt阶段。不得仅凭“导入退出0”对外开放。完成后按原状态恢复调度，观察下一次真实同步、备份及独立副本；确认长期留存后再由管理员按私有执行单处置归档库、明文SQL和临时凭据，操作记录不能当作已清理证据。

## 7．记录和部署前验收

交付脱敏报告记录批准方案、备份ID/校验、恢复后版本、预期/实际数据影响、SQL实际执行阶段、应用和双端检查、调度恢复及遗留事项。敏感执行单、原始SQL、实例/身份详情和故障数据仅放已排除的私有归档；公开报告不包含真实凭据或原始数据。

本机只在随机创建的两个人工夹具库演练了MySQL 8.0.46的可信备份、原表跨库归档、原生批次导入、Unicode/外键保持、错误后停止与多表重命名失败不发生部分变更，随后删除本轮临时库。它不等同于正式恢复、完整产品数据验收、同主机flock交接或Docker运行。目标环境仍须演练值守锁会话失效、中断/磁盘满、完整Schema与业务对账、两种持久状态分支、恢复耗时和原调度恢复；本机无Docker的实测继续按用户要求延期。

MySQL行为依据：[RENAME TABLE](https://dev.mysql.com/doc/refman/8.0/en/rename-table.html)、[mysql客户端选项](https://dev.mysql.com/doc/refman/8.0/en/mysql-command-options.html)。项目命令依据当前[备份工具](backup-and-restore.md)、[维护锁](../../operations/database-maintenance.md)与[目标执行器](../../deployment/releases/target-executor.md)。
