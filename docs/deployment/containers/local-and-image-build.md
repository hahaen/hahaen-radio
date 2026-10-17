# 容器构建与运行入口

状态：已实现同一 Dockerfile 的三个目标、生产 Compose 与 Caddy 配置；本机没有 Docker，镜像构建、Linux 容器启动与卷权限实测延后到实际部署环境。备份工具已另行实现，见[操作说明](../../data/backup/backup-and-restore.md)；Jenkins、目标环境恢复、副本与按时间保留日志仍在交付范围内。

## 构建与包边界

在仓库根使用 BuildKit，三个目标来自同一审核提交，并使用提交 SHA 命名，不覆盖已发布标签：

```sh
docker build --file deploy/docker/Dockerfile --target server --build-arg VCS_REF="$RELEASE_COMMIT" --tag "$SERVER_IMAGE" .
docker build --file deploy/docker/Dockerfile --target migration --build-arg VCS_REF="$RELEASE_COMMIT" --tag "$MIGRATION_IMAGE" .
docker build --file deploy/docker/Dockerfile --target web --build-arg VCS_REF="$RELEASE_COMMIT" --tag "$WEB_IMAGE" .
```

以上变量由发布环境提供，不包含数据库或服务凭据。Node 24.9.0 bookworm-slim 与 Caddy 2.10.2 alpine 使用已核对的多架构 manifest 摘要固定，支持 linux/amd64、linux/arm64；这不是镜像漏洞扫描或实际架构验收。pnpm 固定 12.5.1，以冻结锁文件安装。

`server` 使用 `pnpm --prod deploy` 生成独立生产包，包含服务端 dist、共享契约 dist 及生产依赖；不包含服务端源码、tsx 或 Drizzle Kit。镜像入口是 node，默认运行 API；任务使用同一镜像的 `dist/entrypoints/jobs.js`。维护命令也直接使用编译入口，不在运行容器内重建共享包。

`migration` 保留完整工具工作区、固定 Drizzle Kit、Schema、SQL 和元数据，以编译后的 migrate 入口调用唯一迁移器；只在 tools profile 中手动运行，不随 API 启动执行迁移。工具镜像含构建依赖，不对外提供服务。

`web` 只包含静态产物与 Caddy，使用 UID/GID 1000、内部 8080/8443 端口。`server` 使用 Node 镜像的 node 用户。Web 构建时移除基础二进制的低端口文件 capability，避免与 cap_drop=ALL 冲突。根文件系统只读，临时目录单独限额；实际卷所有权、TLS 与目标平台必须部署前实测。

`.dockerignore` 先拒绝全部，再允许必要工程路径，最后排除环境文件、本地资料、依赖、构建产物、测试及证书私钥。凭据不使用 ARG，不 COPY 私有配置。构建上下文检查不能只依赖 `.gitignore`；正式构建前核对本次检出和上下文材料。

## 私有运行配置

复制 [release.env.example](../../../deploy/compose/release.env.example) 到 Git 排除的 `.local/deploy/release.env` 或服务器专用私有目录。所有模板只有空值。目录权限 700，包含真实配置的文件权限 600。

release.env 指定三个不可变镜像、站点 DNS 名及 API/任务/迁移各自环境文件、可信 MySQL CA 的绝对路径。生产 Compose 强制 NODE_ENV=production、DB_NAME=ha_radio、DB_TLS=required，禁止借此连接开发库；生产库、TLS 和身份权限须由部署方先准备并验收。本轮不创建或修改正式数据库。

API、任务、迁移文件分别按根 `.env.example` 填写所需 DB_HOST、DB_PORT、DB_USER、DB_PASSWORD、连接池和可选功能变量，不能复用迁移身份运行应用。Compose 的 env_file 使用 raw 格式，要求 Compose ≥2.30；逐行 KEY=value，不额外包引号，美元符号保留，不能将 Node 环境文件的引号写法直接照搬。这里由 Compose 显式注入环境；创建文件本身不会生效。

CA 文件绑定只读到 `/run/haen/mysql-ca.pem`；只提供公开 CA 链，不提供证书私钥。DB_HOST 必须匹配数据库证书身份。文件路径不存在时拒绝自动创建目录。API 的识曲状态位于持久卷 `/var/lib/haen/recognition`，启用前仍须按[额度运维](../../operations/recognition-quota.md)完成明确预算与初始化，不通过换镜像或删除卷重置。

## 启动与检查

以下命令由用户在实际部署环境执行；执行前按[迁移流程](../../data/migrations/workflow.md)审核目标、停写并完成一致性备份，不能当作当前已执行结果：

```sh
docker compose --env-file "$RELEASE_ENV_FILE" --file deploy/compose/compose.yaml config --quiet
docker compose --env-file "$RELEASE_ENV_FILE" --file deploy/compose/compose.yaml --profile tools run --rm migration
# 首次空目录：使用任务身份显式同步一次，完成后才启动 Web。
docker compose --env-file "$RELEASE_ENV_FILE" --file deploy/compose/compose.yaml run --rm --no-deps jobs dist/entrypoints/catalog.js sync
docker compose --env-file "$RELEASE_ENV_FILE" --file deploy/compose/compose.yaml up --detach api jobs web
```

不要将展开后的完整 `compose config` 或 `inspect` 输出归档，它可能包含真实环境值；配置检查使用 `--quiet`。完整发布仍需互斥、备份验证与分阶段验收，后续由手动 Jenkins 流程组织。

API 无公开端口，只有 Web 映射 HTTP/HTTPS；应用网络保留访问外部目录和电台元数据所需的出口。Web 等待 API 的数据库与目录 readiness，空目录需要先完成显式同步。jobs 单实例、独立连接池，不能将进程存活表示为每日同步成功。

Caddy 保留 `/api` 与 `/api/*` 前缀并禁止 API 响应缓存；命名静态目录及带扩展名的资源缺失时返回 404。只有接受 HTML 的 GET/HEAD 页面导航回退到 index.html。哈希 assets 长缓存，其余资源及 HTML 需重新校验。Caddy 管理接口关闭，内部 loopback 8081/health 仅用于容器健康；不启用访问记录，并丢弃可能包含请求地址的 Caddy 普通运行日志。

API/jobs 日志暂使用 local 驱动限制每容器最多 3×10MiB；大小上限不等于 7 天时间保留，后续日志方案与部署验收必须补齐。数据库及证书状态不随应用更新删除；不执行 `down --volumes`。

## 验证边界与资料

实际本机与部署前补测记录见[本轮归档](../../iterations/2026-10-17-container-foundation/README.md)。已核对 [pnpm deploy](https://pnpm.io/cli/deploy)、[Compose 服务配置](https://docs.docker.com/reference/compose-file/services/)、[Caddy 路由](https://caddyserver.com/docs/caddyfile/directives/handle)与[官方 Caddy 镜像](https://hub.docker.com/_/caddy)；实际镜像运行仍单独验收。

返回[容器拓扑](topology-and-storage.md)或[部署导航](../README.md)。

迁移镜像的私有运行配置还需在确认所有写入方停止后设置 `MIGRATION_WRITES_STOPPED=true`。入口与备份共用数据库维护锁，完整发布协调边界见[维护说明](../../operations/database-maintenance.md)。

首次空库迁移还需 `MIGRATION_INITIALIZE_EMPTY=true`；已有库先用同提交迁移镜像执行 status，核对前缀与表集合，具体权限及边界见[目标预检](../../data/migrations/target-preflight.md)。

Compose 现在还必须配置 HAEN_MAINTENANCE_DIRECTORY，指向发布用户所有、755的专用持久目录。Web 只读挂载该目录，enabled标记控制503维护；管理流程见[目标执行器](../releases/target-executor.md)。目录不得放敏感资料。
