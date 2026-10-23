# 配置与日志

## 配置归属

| 配置类型 | 生效时间与位置 |
| --- | --- |
| 前端公开配置 | 构建时写入静态资源，变更后重建 |
| 服务端运行配置 | 启动时读取并校验，变更后重启对应进程 |
| Compose 和 Caddy 配置 | 部署时加载，按组件要求重建或重载 |
| 运行私密配置 | 由 Jenkins 凭据或目标服务器注入 |

根目录 `.env.example` 仅提供变量名、说明和空值。真实环境变量文件不随构建分发，服务器密钥不使用前端公开变量前缀。

MySQL 连接、连接池上限、TLS、日志级别、代理信任范围、外部调用限制和任务时区统一进入配置定义，避免分散在代码中。

### MySQL 配置契约

以下变量已由服务端校验，必填缺失时失败，不输出变量值。仅基础开发页面允许完全省略数据库配置，此时目录接口明确返回未就绪；生产启动必须配置数据库。

| 变量名 | 用途 |
| --- | --- |
| `DB_HOST`、`DB_PORT` | 数据库服务连接位置 |
| `DB_NAME` | 目标数据库，启动与迁移前核对 |
| `DB_USER`、`DB_PASSWORD` | 当前进程所需的运行或迁移身份，由受控环境注入 |
| `DB_CONNECTION_LIMIT` | 当前 API 或任务进程的连接池上限 |
| `DB_TLS`、`DB_TLS_CA_PATH` | TLS 默认 required；私有 CA 的本机文件路径，校验证书链与主机名 |
| `MIGRATION_INITIALIZE_EMPTY` | 首次初始化专用确认，默认拒绝；只有完整可见性及真实空库状态可接受 |
| `MIGRATION_WRITES_STOPPED` | 迁移入口要求 true，声明所有写入方已停止；不是自动停写开关 |
| `REMOTE_DNS_MODE` | system 为默认系统解析；https 为可选的加密 DNS，详见目录管线 |

连接池默认 5、最大 10；建连与获取连接上限 8 秒，单次数据库操作上限 15 秒，排队最多 20 个。超时销毁占用连接，不自动重试写操作。字符配置固定为 utf8mb4_general_ci，每次操作设置 UTC，并在启动时实际核对版本、字符集、排序规则和时区，不提供随意覆盖基线的变量。

| 入口 | 显式加载的根目录私有文件 | 权限范围 |
| --- | --- | --- |
| API dev/start | `.env.local` | 目录所需表只读；诊断表按职责读写；三张账号表 SELECT/INSERT/UPDATE/DELETE，无 DDL |
| catalog/jobs/start:jobs | `.env.jobs.local` | 当前 8 张业务表的必要 DML，无 DDL、无迁移记录写入 |
| db:migrate/test:mysql | `.env.migration.local` | 当前目标库的 DDL 与必要 DML；测试流程另需隔离测试库建删权限 |

这些命令使用 Node.js `--env-file-if-exists`，实际进程环境优先。文件必须被 Git 排除且权限为 600，目录权限为 700；检查 `git check-ignore <file>` 和 `git ls-files <file>` 后再写入。部署通常由受控环境注入，仍按不同入口分别注入身份。

只在本机开发或隔离测试且连接目标为回环地址时允许 `DB_TLS=disabled`。2026-10-17 的本机验收通过已核对主机密钥的 SSH 隧道访问现有 MySQL，SSH 监听仅绑定本机；它不代表服务器自身的 TLS 证书已验收。直连跨主机及生产环境必须配置可信 TLS，不自动关闭证书校验。

使用隧道时先启动已保存、经过主机密钥验证的连接，例如 `ssh -N -o ExitOnForwardFailure=yes -o StrictHostKeyChecking=yes -L 127.0.0.1:<local-port>:127.0.0.1:<database-port> <saved-host>`，私有环境中的 DB_HOST/DB_PORT 对应本机监听地址。隧道未启动或退出后，数据库入口会失败，不回退到明文远程连接。

### 环境库名

| 环境 | 服务端 `DB_NAME` | 状态 |
| --- | --- | --- |
| 开发 | `ha_radio_dev` | 已创建、应用四条迁移；API/任务保持受限分离身份，迁移私有配置使用已有维护身份以满足元数据可见性 |
| 正式 | `ha_radio` | 已创建、应用四条迁移；现有 API/任务身份保持分离，API 已补齐三张账号表的必要 DML |

启动和运维入口应显式选择环境，核对库名；不能在开发配置缺失时自动回退到正式库。数据库地址和身份只保存在私有连接配置中，结构分析得到的适用约定单独归档。

应用连接池和隔离迁移已在 MySQL 8.0.46 通过验收。生产身份、服务器 TLS 和发布运行环境仍待部署时配置。库、表和连接的字符约定见[建表规范](../data/database/table-options-and-collations.md)。

本机 `.env.migration.local` 的 `DB_USER`、`DB_PASSWORD` 已调整为现有维护身份并显式加载，未创建账号或增加全局授权；API/任务凭据未改变。该配置是本机维护用途，目标环境须单独配置最小必要身份。详见[收尾记录](../iterations/2026-10-17-goal-completion/README.md)。

2026-10-23 开发库与正式库已分别补充各自现有 API 身份对 `account_users`、`account_sessions`、`account_libraries` 的 SELECT/INSERT/UPDATE/DELETE；未增加全局权限，任务身份保持原范围。详见[账号功能记录](../iterations/2026-10-23-account-sync/README.md)。

迁移身份还需具备完整元数据可见性；只读 status、历史/表集合核对和初始化条件见[目标预检](../data/migrations/target-preflight.md)。

备份创建与迁移共用的会话锁、额外连接预算和失锁处理见[数据库维护协调](database-maintenance.md)。

## 日志

API使用Pino，任务入口输出固定事件，统一投影为包含服务名与版本的JSON；目的地与字段边界见[普通进程日志](runtime-logs.md)。运维入口仍输出自身精简事件，任务状态保存在job_runs。

过滤授权头、Cookie、密钥、带访问凭据的 URL 和敏感请求内容。错误日志保留可定位原因，但不无差别打印配置对象或完整上游响应。

## 保存与轮转

生产API/任务分别使用持久日志卷，按七天、10MiB片段和每服务30MiB上限清理，不再另存Docker local副本。Jenkins构建日志与应用运行日志分别管理，发布记录关联版本。

默认诊断保留7天；任务清理过期job_runs，普通进程日志已实现启动及每分钟过期清理、体积和数量限制，停机时物理清理延后，具体见[策略与部署补测](runtime-logs.md)。诊断材料共享前脱敏，不将数据库备份或环境文件当作普通构建产物上传。

可选识曲的 `RECOGNITION_ENABLED`、`AUDD_API_TOKEN`、`RECOGNITION_REQUEST_LIMIT`、`RECOGNITION_BUDGET_ID` 与 `RECOGNITION_STATE_PATH` 均为服务端变量；完整启用与持久状态流程见[额度运维](recognition-quota.md)。关闭时不要求或创建额度文件。

精简播放报告采用独立固定字段与持久额度，不记录 IP、任意日志或音频。API 与任务需随新迁移配置最小表权限；有效期、定期清理和受控命令见[诊断运维](playback-diagnostics.md)。

返回[运维导航](README.md)。

目标发布变量、活动备份版本文件、维护标记与私有配置详见[发布执行器](../deployment/releases/target-executor.md)；真实值仅放在已排除文件或目标环境。
