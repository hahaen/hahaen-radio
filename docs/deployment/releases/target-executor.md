# 目标主机发布执行器

已实现目标主机手动入口 `pnpm deploy:target`，消费受控分发的 release.json。完整发布、前端/服务端单独更新、同结构镜像回退与明确确认后的故障恢复共用本机文件锁和数据库发布锁。根 Jenkinsfile 已在人工分发后接入默认关闭、单独审批的[目标阶段](../jenkins/target-stage.md)；入口存在不代表已在 Linux、Docker、Jenkins 或正式库执行。

## 固定运行条件

- Ubuntu 24.04、Node.js 24.9.0、pnpm 12.5.1、本机 Linux Docker socket、Compose ≥2.30；只支持同一主机固定 `haen` Compose 项目和现有 MySQL 8.0.46 正式库，正式库必须已经由操作者建好。
- 在与 release.json 相同提交的完整干净检出中冻结安装并构建；操作工具需要仓库 scripts、Compose、编译入口和对应依赖。不能从裁剪后的 API 镜像或仅含服务端的日备份包调用。恢复/回退沿用经过审核的工具检出，不生成或重写迁移。
- release.json 来源必须是已成功、受控分发的任务；通过受控渠道放在本机私有文件，当前用户所有、600。它不是签名文件，来源真实性由传输/审批权限保证，不能把任意同形 JSON 当作已验收产物。
- 镜像固定平台子 manifest 摘要，实际拉取后核对 revision label 与本机原生架构。运行中的服务必须属于当前状态记录；首次接管不允许已有无记录的容器。不同机器共享同库也须通过此入口，禁止绕开数据库发布锁。
- 公网 DNS、HTTPS、CA、数据库权限和真实目录必须满足目标条件；未就绪则保留维护。前端不需要单独 Node 服务。

## 私有配置

复制 `deploy/compose/target.example.json` 到仓库外的私有配置，所有空值均由操作者填写。target 文件及 API/jobs/migration env 文件由发布用户所有且为 600；目录/文件路径限绝对规范路径，当前不接受空白、引号、美元符号或路径跳转。站点为无凭据的 HTTPS 域名。三种容器 env 使用 raw 格式：一行一个 `KEY=value`，不加 export、引号或内联注释，不能重复键；真实值不得写回模板。

| 字段 | 约束 |
| --- | --- |
| apiEnvFile / jobsEnvFile / migrationEnvFile | 各自最小权限身份；数据库 host/port 与外层发布连接一致；不得携带前端公开变量 |
| databaseCaFile | 可信 CA 普通文件，不可被组/其他用户写入；字节须与外层 DB_TLS_CA_PATH 读取结果相同；容器内挂载路径固定 |
| maintenanceDirectory | 发布用户所有、755、独立持久目录，只存无敏感内容的 enabled 标记；Web 只读挂载，不能放配置、备份或状态 |
| stateDirectory | 发布用户所有、700，保存600状态与历史记录；不与维护目录相同或互相嵌套，不放在会清理的 Jenkins 工作区 |

根私有 `.env.deploy.local` 显式由 `pnpm deploy:target` 加载；编译入口使用 `node --env-file=/etc/haen/deploy.env apps/server/dist/entrypoints/deploy.js`。需先核对本地文件被 Git 排除、未跟踪、权限600。变量名已加入空值模板：

| 变量 | 行为 |
| --- | --- |
| NODE_ENV / DB_* | production / ha_radio，独立发布锁身份，验证 TLS/主机名；不能以关闭 TLS 连接正式库 |
| HAEN_TARGET_CONFIG_FILE / HAEN_RELEASE_FILE | 本机私有 target 配置与已验收 release.json 绝对路径 |
| HAEN_REGISTRY_CONFIG_FILE | 仅含对应 registry auth 的私有 Docker配置；临时复制后使用，退出清理 |
| HAEN_DEPLOY_ACTION | apply（默认）、rollback、recover |
| HAEN_DEPLOY_SCOPE | full（默认）、web、server；后两者需已有当前记录及兼容确认 |
| HAEN_CONTRACT_COMPATIBILITY_CONFIRMED | 分端发布或镜像回退需 true，声明已审核保留一端与新接口/结构兼容；工具不能证明语义兼容 |
| HAEN_OTHER_WRITERS_STOPPED | 存在待迁移或需首次目录同步时必须 true，声明其他程序、人工操作、旧连接/长事务已核对；执行器另实际停止自身 API/jobs |
| MIGRATION_INITIALIZE_EMPTY | 首次真正空库时需 true；不允许绕过不匹配历史或半完成结构 |
| HAEN_BOOTSTRAP_CATALOG | 空库初始化或恢复后无就绪目录时，明确 true 才执行已有受控真实目录 sync；不注入测试数据、不在每次发布重拉目录 |
| HAEN_BASELINE_REVISION | 没有既有发布记录但库非空且需升级时，由操作者提供实际旧应用完整提交，避免把新版本冒记为备份源版本 |
| HAEN_RECOVERY_CONFIRMED / HAEN_RECOVERY_VERSION | recover 专用；明确确认后选择 current（默认）或 attempt；必须先完成人工结构/数据核对，不自动判断部分 DDL 安全 |

## 两层互斥与备份身份

入口先用 `/usr/bin/flock --no-fork` 对 `/var/lib/haen-maintenance/deploy.lock` 非阻塞独占，再核对继承 fd3 的设备/inode 与 `/proc/locks` 当前 PID 记录。该文件须预先为 root:haen-maintenance、0660，父目录 root:haen-maintenance、0750，运行时不得替换。日备份服务使用同一个 inode。Linux fd/proc 行为仍需目标实际验收。

之后持有按目标库名派生的 `haen:release:` MySQL 会话锁，覆盖预检、停写、备份、迁移及启动验收；它与现有 `haen:maintenance:` 不同，内部备份和迁移可取得自己的短锁而不自锁。锁丢失会取消流程，不重新连接或自动重试。仍是协作式机制，不阻止管理员绕过工具执行 SQL。

日备份身份不授予 Docker 管理权限。目标管理员将 `deploy/systemd/haen-pre-migration` 审核后安装为 `/usr/local/libexec/haen-pre-migration`，root 所有且发布用户不可写，父目录也不可写；只在 sudoers 授予发布用户免交互执行这一个固定 helper。helper 校验 `pre-migration|record-revision` 、40位应用摘要及64位目标指纹，通过固定 runuser、空环境和固定 Node/运维包/backup.env 路径，以 haen-backup 执行。不得授予任意 shell、runuser、systemctl 或 Node 的 sudo 权限。角色、目录和组就绪后，管理员可按以下步骤安装；不是本轮已经执行的服务器操作：

```sh
sudo install -o root -g haen-maintenance -m 750 deploy/systemd/haen-pre-migration /usr/local/libexec/haen-pre-migration
sudo visudo -f /etc/sudoers.d/haen-deploy
```

sudoers 中仅允许对应发布角色运行该固定 helper（参数仍由 root 所有脚本严格限制）：

```sudoers
haen-deploy ALL=(root) NOPASSWD: /usr/local/libexec/haen-pre-migration *
```

先用 `sudo visudo -cf /etc/sudoers.d/haen-deploy` 核对语法，再以发布角色完成隔离演练；私有配置准备好、人工核对目标后运行 `pnpm deploy:target`。不要为方便增加其它 sudo 命令。


backup.env 必须配置正式库、独立主/副存储及已验证原生客户端。`pre-migration` 在停写条件下生成备份并复制、完整复验；生产副本要求不同设备，真实物理故障域仍需操作者确认。失败保留主备份，不进入迁移。发布连接与备份私有配置还需匹配 host/port/库名/TLS/CA 的指纹，允许不同角色账号；错配会在创建备份前拒绝，避免备份另一数据库后误迁移。helper 不再次持有外层 flock，避免与发布自身死锁。更详配置见[每日备份](../../operations/daily-backups.md)。

发布流程还通过 helper 更新 haen-backup 所有、700目录下600的活动版本文件。backup.env 配置 `BACKUP_APPLICATION_REVISION_PATH` 后，daily 优先读取该文件，缺失/无效时失败，不能回退旧环境值。发布记录实际服务端 image revision，前端单独更新不会误改为前端提交；新启动、回退和恢复都更新此值。版本目录须在日备份服务沙箱内可读；daily 只读取此文件，不因此扩大 ReadWritePaths。初始化与权限、Linux沙箱实测后再启用定时。

## 执行顺序与失败

1. 检查私有配置、干净源码/迁移摘要、镜像/平台、Compose版本、当前容器归属与已有维护标记，不输出展开后的 Compose 或 Docker inspect 原文。
2. 状态预检，拒绝未确认空库、额外历史、摘要不符或未管理表。写入持久 attempt，原子发布状态并 fsync 文件和目录。
3. 创建持久维护标记、启动/检查 Web 维护探针，再停止 API/jobs 并确认容器停止，重新检查迁移状态没有改变。
4. 非空待升级库先完成迁移前备份与副本，记录 ID；空库仅在明确允许后初始化。Drizzle Kit 单次迁移并前后复核，不自动重跑。
5. 检查目录就绪；确无目录且获得首次同步确认时才同步真实数据。先 API 就绪，再 Web 同域代理、index与实际脚本资源，再启动并从日志卷确认当前容器StartedAt之后、对应服务端提交的scheduler_started和运行状态。候选服务端须声明文件日志能力，prepare在维护attempt和停写前拒绝旧镜像；仅Web更新及回退也须满足此兼容边界，见[普通日志与目标验收](../../operations/runtime-logs.md)。
6. 写入版本记录及当前/上一镜像组合，再清除维护；检查公网 HTTPS 首页和健康接口成功后才完成持久记录。

Web 单独更新要求迁移清单一致，保留 API/jobs，仍执行维护与资源/健康检查。server 更新保留旧 Web，要求操作者审核接口兼容。rollback 需明确兼容确认，只允许上一组合与当前迁移清单完全相同，不运行迁移，不把镜像回退当作数据库回退。正式SQL恢复与管理员接管见[操作手册](../../data/backup/formal-recovery-runbook.md)，不得把recover误用为导入或前向迁移。

发生失败会尽力恢复维护标记、停止自身写入方，并将失败阶段及 cleanupConfirmed 持久化。Docker、磁盘、节点强杀或锁连接故障时，不能保证清理一定执行，cleanupConfirmed=false 或中断 attempt 必须现场核对。普通 apply/rollback 遇到未完成 attempt 会拒绝；不自动删锁、历史、备份、卷或失败记录。

recover 也不执行迁移：操作者明确确认并选择 current 或完整 attempt 版本，状态必须证明所选序列已全部应用，结构和数据仍需人工核对；确认后重新经过维护、停写、目录和启动验收。库仍不匹配时停止，继续按[发布与回退](release-and-rollback.md)决定受控修复、前滚或恢复；禁止为了通过预检改写迁移历史。首次初始化在记录前/途中失败且尚无可运行版本时，需管理员先核对实际结构与写入方，保全现场并制定首次恢复/重新初始化方案，不擅自清空库或清理 attempt。

## 维护界面与验证范围

Web 通过只读标记目录动态识别维护，公共页面返回503、no-store和Retry-After，API返回固定503 JSON；内部8081端口只绑定容器回环，供维护、资源和代理检查，不对主机发布。维护页独立、无外部请求，沿用夜航色彩、衬线标题、暖白文字与可见焦点，支持窄屏与双语。

本机可执行原生 Caddy 2.10.2 的配置/HTTP/双端页面检查，但不等于 Docker、卷映射、Linux flock/proc、sudo边界、生产CA或Jenkins已通过。实际节点应演练全新初始化与目录、含数据升级、只更Web/服务端、备份/迁移/启动失败、父进程强杀、跨进程锁竞争、同结构回退及明确恢复，确认无错误开放、残留写入或版本误标。

机制语法依据：[Caddy 文件匹配](https://caddyserver.com/docs/caddyfile/matchers#file)、[Compose up 等待](https://docs.docker.com/reference/cli/docker/compose/up/)。任务证据见[目标执行器归档](../../iterations/2026-10-17-target-deployment/README.md)。返回[部署导航](../README.md)。
