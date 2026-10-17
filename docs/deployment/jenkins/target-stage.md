# Jenkins 目标发布

三个手动任务分别发布前端、API 和任务，入口与检查见[流水线](pipeline.md)。目标节点只接受由同任务固定提交生成、内容摘要匹配且目标上下文一致的交接材料。

## 配置与保护

| 配置 | 作用 |
| --- | --- |
| `HAEN_TARGET_NAME` | 稳定目标名 |
| `HAEN_TARGET_SITE` | HTTPS 站点及 `/radio` 子路径，与目标 JSON 一致 |
| `HAEN_TARGET_DATABASE_FINGERPRINT` | 覆盖 host、port、库名、TLS 和 CA 的连接指纹 |
| `HAEN_RELEASE_APPROVERS` / `HAEN_DEPLOY_APPROVERS` | 人工发布用户清单；数据库确认使用部署清单 |
| `HAEN_DEPLOY_ENV_FILE` | 仓库外的 `/home/hahaen/radio-prod.env`，发布身份所有、600，由 Node 显式加载 |
| `haen-image-registry-pull-config` | 只读镜像拉取 Secret file，与分发身份分离 |

外部目录下载总时限可用 `RADIO_JOBS_CATALOG_SYNC_TIMEOUT_MS` 配置为 1000–900000 毫秒，默认 300000；每页 20 秒、大小及来源限制不变。首次全量拉取较慢时可显式使用 900000，普通发布已有健康目录时不会重复全量同步。

主环境文件的 `RADIO_ENV_FORMAT=1` 标识当前结构。未加角色前缀的 `DB_*` 供外层发布锁使用；`RADIO_API_*`、`RADIO_JOBS_*`、`RADIO_MIGRATION_*` 映射为对应角色变量，写入总目录 `config/` 内的 600 原始 env 文件。只更新所选应用角色和迁移工具配置，首次 API 引导才同时准备任务身份。前端资源和镜像层不包含这些变量。变量名模板见[生产环境模板](../../../deploy/radio-prod.env.example)。

预检不改写运行配置。真正发布时，所选角色的原始配置以 validationRun 为键保存在 `state/environments/`，回退或恢复从相应快照读取，不能使用后来修改的主环境冒充旧配置。

实际更新通过受保护文件锁和数据库发布锁串行化。严格校验生产库名、可信 CA、主机名、目标指纹、共享 Nginx 只读挂载及项目容器归属。无迁移只更新所选部分；需要迁移时停止 API 和任务，备份校验后单次执行 Drizzle Kit，再恢复所选新版本和未选中原版本。兼容性检查失败时在维护前拒绝。

用户已授权首次空库上线。尚无独立备份存储，后续非空库结构升级继续受备份副本校验阻止；普通无迁移发布无需手动 SQL。

## 失败处理

发生失败后保留持久 attempt，维持维护和必要停写。新的 apply 会被拒绝，不能直接重新点击构建重试 SQL。操作者先核对实际结构、迁移历史、已激活版本、配置快照及失败阶段，再执行明确的 recover 或组件回退；这不是日常任务参数。

目标状态、真实环境文件、备份和临时认证目录不得归档到 Jenkins 产物。首次结果及清理清单见[正式部署记录](../../iterations/2026-10-17-production-deployment/README.md)。
