# 容器构建与运行入口

正式运行复用已有 Nginx，常驻应用容器只有 `radio-api`、`radio-jobs`。首次上线进展见[正式部署记录](../../iterations/2026-10-17-production-deployment/README.md)，目录见[服务器项目目录](server-layout.md)。

## 构建与包边界

同一审核提交构建三个不可变目标：`server` 使用固定 Node.js 24.22.1 Debian slim 和 pnpm 12.5.1，携带生产依赖与编译文件；`migration` 携带固定 Drizzle Kit、Schema、SQL 和元数据；`web` 携带前端公开文件和仅用于隔离验收的 Caddy。基础镜像固定摘要，构建依赖冻结安装，凭据不使用 ARG，不 COPY 私有配置。

`server` 默认运行 API，任务使用同一镜像的 `dist/entrypoints/jobs.js`。迁移只在 tools profile 中单次执行，不随应用启动建表。前端产物镜像正式只提取文件，不作为常驻容器启动；目标执行器记录镜像与文件摘要，原子切换静态版本，详见[执行器](../releases/target-executor.md)。

`.dockerignore` 先拒绝全部，再允许工程材料并排除环境文件、本地资料、依赖、测试产物和私钥。正式构建前核对干净检出和上下文；本机构建通过不能代替目标平台验收。

## 私有配置与网络

[release.env.example](../../../deploy/compose/release.env.example) 只记录 Compose 所需的服务端/迁移镜像及三种私有身份文件路径和公开 CA 路径，模板没有真实值。运行配置仅在服务器注入，文件 600，私有目录受限；不打印展开的 Compose 或含环境值的 inspect。

Compose 强制 NODE_ENV=production、DB_NAME=ha_radio、DB_TLS=required。三种身份最小授权，env_file 使用 raw KEY=value；不额外包引号或加入内联注释，要求 Compose ≥2.30。CA 只读挂到 `/run/haen/mysql-ca.pem`，DB_HOST 必须匹配证书身份，文件不存在时拒绝自动建目录。

Radio 不新增宿主机端口。共享 Nginx、MySQL 连接 `radio_application`，编排网络声明持久保存；不重新部署共享数据库。Nginx 配置见[公开路由](../../../deploy/nginx/radio-locations.conf)与[回环探针](../../../deploy/nginx/radio-probes.conf)。公开请求的维护标记返回 503，缺失资源返回 404，仅 HTML 导航回退 index；API 代理保留 `/api/v1`，响应禁止缓存。

## 发布入口与持久化

日常通过 Jenkins 选择分支完成冻结安装、检查、构建、验收、分发与目标发布。迁移状态由只读预检决定，有待执行项时确认一次后执行；普通发版不要求手工复制 SQL。首次空库需明确初始化授权，非空库结构升级先停写并完成独立副本校验。不要绕开完整执行器拆成手工 Docker/SQL 步骤。

API/jobs 日志及识曲状态使用项目总目录中的持久卷；日志目录700、文件600，七天和容量上限见[日志说明](../../operations/runtime-logs.md)。前端公开文件为644、目录755，版本摘要为600；共享 Nginx 仅只读挂载前端发布根和独立维护标记目录，不读取状态、配置或备份。

数据库、网关证书、当前前端目录和业务卷不随普通发版删除；不执行 `down --volumes`。成功发布并完成健康检查后只清理本次淘汰的旧产物，各组件只保留当前版本。前端/服务端分端更新及重新构建旧版仍须审核兼容关系，具体步骤见[发布与回退](../releases/release-and-rollback.md)，数据库恢复另按[恢复文档](../../data/backup/backup-and-restore.md)处理。

返回[容器拓扑](topology-and-storage.md)或[部署导航](../README.md)。
