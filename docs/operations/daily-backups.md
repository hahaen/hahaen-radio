# 每日备份与副本

已实现每日执行入口、受控复制和 systemd 定时材料。本机验证使用同一文件系统中的两个私有目录；服务器定时、真实异盘/远端挂载及存储故障演练仍待部署验收。

## 命令与配置

根入口仍为 `pnpm db:backup`，显式加载被 Git 排除且权限 600 的 `.env.backup.local`；受控服务器使用编译包与明确的 `node --env-file=/etc/haen/backup.env`。除原有数据库/客户端变量外增加：

| 变量 | 用途 |
| --- | --- |
| BACKUP_REPLICA_DIRECTORY | 已存在、当前运维用户拥有、权限 700 的绝对目录；不能与主目录相同或互相嵌套 |
| BACKUP_APPLICATION_REVISION_PATH | 可选私有600文件，优先读取实际服务端版本；配置后缺失或无效直接失败，更新见[目标执行器](../deployment/releases/target-executor.md) |
| BACKUP_APPLICATION_REVISION | 当前实际部署应用的完整 40 位提交号，每次发布后更新；不默认为工具检出版本 |

```sh
pnpm db:backup copy "$BACKUP_ID"
pnpm db:backup daily
```

copy 不连接数据库：在主、副目录均取得文件互斥，完整校验源备份后流式复制，文件权限 600，清单最后发布；写入后再次完整解压、CRC、SHA256、字节数及清单比较。相同 ID 已存在且内容一致时安全复用，损坏或不一致时拒绝覆盖。失败仅清理本轮创建的不完整副本，不删除源备份或已有目标。

daily 在主目录持有独立 `.backup-cycle.lock`，手工 prune 也需取得该锁，以免删除正在处理的主备份。daily 执行：创建/校验 daily → copy/复验 → 副目录保留清理 → 主目录保留清理。每端分别保留最新 7 份 daily 和 3 份 pre-migration。复制失败保留本轮主备份和全部旧备份，不进入清理；两端清理不是跨文件系统事务，失败后按结果核对，不承诺同时回滚。成功输出固定事件、备份 ID 和两端清理数量，失败输出固定错误事件；副本创建失败时还返回 retainedBackupId，便于修复后执行 copy 重试，不输出路径、账号、SQL 或配置值。

正式库 daily 和 production 模式 copy 还要求主、副目录的文件系统设备号不同，防止直接把另一同盘目录作为生产副本。不同设备号不等于独立物理故障域：部署者仍须用 findmnt、磁盘或存储服务信息核对实际来源、加密、容量与故障边界。源码不创建挂载、不上传真实备份、不自动配置或支付存储。

## Ubuntu 24.04 定时材料

仓库提供 `deploy/systemd/haen-backup.service` 与 `haen-backup.timer`。这是受控运维主机服务，独立于 API/jobs 容器；不在 API 镜像中加入原生 MySQL 客户端。以下路径为该部署布局，调整时同步 unit、私有环境、写入白名单与挂载断言：

| 路径/身份 | 条件 |
| --- | --- |
| haen-backup | 专用无交互运维用户，拥有备份目录与私有配置，不授予 Docker 管理权限 |
| haen-maintenance | 备份用户与已授权发布用户共用的本机互斥组，不因此共享数据库凭据 |
| /opt/haen/node/bin/node | 已核对的 Node.js 24.9.0，可由运维用户执行 |
| /opt/haen/operations/current | 完整可运行的同版本服务端生产包，含 dist、node_modules 与共享契约；按不可变目录部署后切换 current，不覆盖正在使用的文件 |
| /etc/haen/backup.env | 运维用户可读、权限 600 的私有配置；Node 显式加载，服务强制 NODE_ENV=production |
| /var/backups/haen | 主备份目录，运维用户拥有，权限 700，与 MySQL 数据卷分离 |
| /mnt/haen-backup-replica | 已配置且确认来源的异盘/远端文件系统挂载点，权限 700，运维用户拥有；unit 断言它必须为挂载点 |
| /var/lib/haen-maintenance/deploy.lock | 预先存在的共享文件锁，root:haen-maintenance、0660；父目录 root:haen-maintenance、0750，组不能删除或替换锁文件 |

先由管理员创建用户/组、目录、锁文件及挂载，在服务未启用且相关操作停止时完成首次配置。锁文件创建一次后保持同一 inode，运行期间不得替换、删除或再次用 install 覆盖它。配置中的 MYSQLDUMP_PATH/MYSQL_PATH 指向可信的 8.0.46 Linux 客户端；DB_TLS_CA_PATH 指向该用户可读的可信 CA。通过最小权限身份连接已准备的目标库，不把建库或授予权限作为定时任务职责。

运维包来自确定提交的独立构建输出，例如在匹配 Linux/架构的干净检出中冻结安装、通过检查和构建后执行 `pnpm --filter @haen/server --prod deploy <new-operations-directory>`。它只分发服务端包，不复制开发机依赖或私有配置。客户端可执行路径、其依赖库、Node 和 CA 必须在服务沙箱内可读；本机包结构验证不能替代 Linux 实际启动。

管理员在目标机检查并安装：

```sh
sudo systemd-analyze verify deploy/systemd/haen-backup.service deploy/systemd/haen-backup.timer
sudo install -m 644 deploy/systemd/haen-backup.service /etc/systemd/system/haen-backup.service
sudo install -m 644 deploy/systemd/haen-backup.timer /etc/systemd/system/haen-backup.timer
sudo systemctl daemon-reload
sudo systemctl start haen-backup.service
sudo systemctl status haen-backup.service
sudo journalctl -u haen-backup.service --since today
```

先确认 fixed event 为 backup_daily_completed，再从副本目录独立校验并在隔离库实际恢复。记录主、副目录真实文件系统来源和权限、恢复所用副本及应用就绪证据后，再启用：

```sh
sudo systemctl enable --now haen-backup.timer
sudo systemctl list-timers haen-backup.timer
```

timer 为每日 UTC 03:00 加最多 5 分钟随机延迟；Persistent 会在停机错过执行后补触发一次，不补齐每个历史日期。服务不自动无限重试，最长 20 分钟；停止时向控制组发送终止信号，15 秒后强杀。实际大备份的容量、带宽与耗时需要据演练调整，确认未超过工具的字节与 5 分钟客户端上限。

## 发布窗口、故障与验收

服务使用 `/usr/bin/flock` 对共享 deploy.lock 非阻塞加独占锁，占用时退出 75 并保留失败状态。完整发布必须在同一主机使用同一 inode 的锁覆盖停写、备份、迁移、更新及验收；不同主机的 Jenkins 还需共享目标数据库发布锁。手工 daily 可执行，但不会自动持有该外层文件锁，维护期间应通过服务运行或显式遵循同一外层锁。数据库备份/迁移自身的协作锁继续生效，见[维护协调](database-maintenance.md)。[目标执行器](../deployment/releases/target-executor.md)已实现相同主机锁和独立数据库发布锁覆盖完整窗口；Jenkins已接入同一执行器的单独审批阶段，实际节点仍待验收。

服务失败、锁忙、磁盘满或挂载不可用时核对 systemctl 的结果、最近成功时间、容量和副本；修复后手工 start 补做。进程强杀后可能保留 `.backup-cycle.lock`、`.backup.lock` 或不完整产物，先核对进程与现场再处理，不自动删除无法证明失效的锁。失败不能作为“今日备份成功”。部署时应接入已有运维告警，当前未创建通知渠道。

验收需要实际经过定时触发、持锁竞争、挂载丢失拒绝、权限/容量失败、重启补触发、独立存储副本恢复及停用/回收操作；不能以 unit 文件存在或本机模拟通过代替。停用使用 `systemctl disable --now haen-backup.timer`，已有活动服务需另外核对并按维护流程停止；保留备份和共享锁，不删除数据库卷。

参数依据见 [Ubuntu systemd.timer](https://manpages.ubuntu.com/manpages/noble/man5/systemd.timer.5.html)、[systemd.unit](https://manpages.ubuntu.com/manpages/noble/man5/systemd.unit.5.html) 与 [flock](https://manpages.ubuntu.com/manpages/noble/man1/flock.1.html)。返回[运维导航](README.md)或[备份操作](../data/backup/backup-and-restore.md)。
