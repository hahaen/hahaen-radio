# MySQL 与 Drizzle

状态：MySQL 8.0.46 的应用连接池、Schema 和三条迁移已实现，隔离验收通过且开发库已应用；正式库未执行，实际部署验收另列后续专项。

## 数据库与连接

库和业务表默认显式使用 utf8mb4、utf8mb4_general_ci；表使用 InnoDB 和 DYNAMIC 行格式。大小写敏感机器标识按值域单独设置 ascii_bin 或其他合适类型，不能把所有列统一转换。连接字符配置保持一致，时间处理采用 UTC 约定，详见[表选项与排序规则](table-options-and-collations.md)。

后端通过 `mysql2/promise` 创建有限连接池，交给 `drizzle-orm/mysql2` 执行查询。API 与后台任务分别持有自己的池，容量合计不得超过数据库为本应用分配的连接预算。

设置连接获取、建连和查询的超时边界；连接异常有限重试，事务中出现不明执行结果时不盲目重试写操作。结束事务、异常退出和进程停止时正确释放连接。

## 服务与权限

当前连接已提供的现有 MySQL 8.0.46 实例，地址与身份私有保存。开发库 `ha_radio_dev` 已创建，正式库 `ha_radio` 未创建、未执行。API、任务、迁移采用分离身份；运行账户无 DDL 或迁移历史写权限，范围限制于本项目所需表，主机边界按实际隧道来源限制，不使用任意来源。

本机应用与测试通过已验证 SSH 加密隧道验收，生产服务器 TLS 证书链和主机名仍待配置。连接超时、环境加载与权限范围见[配置文档](../../operations/configuration-and-logging.md)。

API 与任务通过网络访问数据库，不挂载 MySQL 数据卷。仅数据库进程管理自身数据目录；数据库端口限制在应用需要的网络范围，跨主机连接配置经过验证的 TLS。

应用账户用于业务读写，迁移账户另行授予必要 DDL 权限。凭据通过环境或私密配置注入，不出现在示例值、日志、前端构建或命令输出中。

## Schema 与事务

结构定义位于 `apps/server/src/db/`，使用 Drizzle MySQL 方言。迁移与元数据集中输出到 `migrations/`，具体文件布局由锁定的 Drizzle Kit 版本产生。

按查询建立索引和约束，查询参数化，数据库行映射为对外 DTO。时间、数值精度和 mysql2 返回类型需要在字段设计时统一，不依赖隐式类型转换。

事务绑定同一数据库连接，保持短小，批量任务分批处理。针对死锁、锁等待、幂等和重试设置明确策略，测试使用独立 MySQL 8.0.46 数据库。

MySQL DDL 可能隐式提交。单条 DDL 的原子性不代表整批迁移可回滚，升级失败要核对结构、数据与迁移历史，不能直接认为重跑或镜像回退就能恢复。

## 工具分工

| 工具 | 唯一职责 |
| --- | --- |
| MySQL | 数据持久化和事务 |
| mysql2 | 连接池与数据库协议 |
| Drizzle ORM | 类型化查询和事务调用 |
| Drizzle Kit | 生成与执行版本化迁移 |
| Jenkins | 在手动发布中的独立迁移阶段调用固定工具版本 |

不对同一结构并行使用第二套迁移执行器。生产迁移、备份与权限配置均需实现和验收后才能声明可用。

相关资料：[Drizzle MySQL](https://orm.drizzle.team/docs/mysql/get-started-mysql)、[MySQL 隐式提交](https://dev.mysql.com/doc/refman/8.0/en/implicit-commit.html)。

备份见[备份与恢复](../backup/backup-and-restore.md)，执行顺序见[迁移流程](../migrations/workflow.md)。返回[数据导航](../README.md)。
