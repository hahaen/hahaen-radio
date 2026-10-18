# 目标主机发布执行器

当前执行器消费 format 2 的组件发布记录，支持 `frontend`、`api`、`jobs` 独立更新、同结构回退和明确确认后的恢复。日常入口、角色环境及失败处理见[Jenkins 目标阶段](../jenkins/target-stage.md)，操作原则见[发布与回退](release-and-rollback.md)。

## 固定运行条件

Ubuntu 24.04、Node.js 24.9.0、pnpm 12.5.1、本机 Linux Docker socket、Compose ≥2.30、现有 MySQL 8.0.46。在审核通过的完整源码树冻结安装后，通过 `node --env-file=/home/hahaen/radio-prod.env --import tsx apps/server/src/entrypoints/deploy.ts` 进入；生产应用本身仍运行编译后的 JavaScript。不能从裁剪后的 API 镜像或仅含备份工具的目录运行发布入口。

`HAEN_RELEASE_FILE` 为本机私有组件发布 JSON，发布身份所有、600；CI 同时验证其批准摘要及目标上下文。来源权限由受控 Jenkins 交接保证，同形 JSON 不代表已验收产物。所有新发布镜像固定服务器本地不可变 image ID，交接须核对同一 Docker 引擎；运行后核对实际 image ID 和 revision。Compose 禁止拉取或隐式构建，缺失镜像在维护前拒绝。

## 两层互斥与迁移

入口通过受保护 `/var/lib/haen-maintenance/deploy.lock` 的 flock、fd/inode 和进程锁记录验证，再持有数据库发布锁。不能替换锁文件、通过新路径绕过锁或直接操作生产 SQL。备份/迁移复用现有数据库维护锁。目标锁内重新检查实际历史；前置只读计划不代表可跳过检查。

配置校验要求生产库 `ha_radio`、严格 TLS/主机名校验、同一 CA 字节与连接指纹。无迁移只替换所选组件；有迁移时停止两个写入方，非空库完成一致性备份及独立副本校验后单次执行 Drizzle Kit。恢复未选中服务时使用其原镜像和配置快照。迁移失败保持维护，不自动重试 SQL。

## 静态目录和共享网关

私有目标 JSON 的 `staticDirectory` 和 `maintenanceDirectory` 分别只读挂载到共享 Nginx 的 `/srv/radio`、`/srv/radio-maintenance`，网关连接 `radio_application`。模板见[公开路由](../../../deploy/nginx/radio-locations.conf)和[内部探针](../../../deploy/nginx/radio-probes.conf)，探针只监听容器回环，不发布宿主端口。

前端镜像记录 `/radio/` 基路径。未启动的临时容器只用于提取公开静态文件，拒绝符号链接及异常文件，规范读取权限并计算文件摘要；原子切换 `web/current`。保留产物在回退前重新校验。公开导航返回 index，缺失资源 404，维护时页面/API 返回 503。

## 私有配置和状态

目标配置字段以 [target.example.json](../../../deploy/compose/target.example.json) 为准。target JSON 及角色 env 文件发布身份所有、600，CA 不允许组或其他用户写入；角色 env 使用 raw 格式，不加 export、引号或内联注释。主环境为 Node env-file 格式，由显式加载后派生角色配置，不能混用两种解析方式。

`state.json` 独立保留实际组件、上一组件、结构版本和 attempt。`state/environments/<component>-<validationRun>.env` 保存该次组件配置，权限 600；全部状态不对外归档。失败后检查实际容器、结构与维护标记，再选择 recover。首次失败没有 current 时须明确选择 attempt；恢复要求实际结构无待迁移项。数据库部分失败按[正式恢复手册](../../data/backup/formal-recovery-runbook.md)处理。

实际服务器布局和验证边界见[服务器项目目录](../containers/server-layout.md)及[正式部署记录](../../iterations/2026-10-17-production-deployment/README.md)。
