# 发布与回退

## 发布单位

前端、API、任务分别从确定提交构建和手动发布。常驻应用容器只有 `radio-api`、`radio-jobs`；前端从不可变产物镜像提取到静态版本目录，经文件摘要验证后原子切换 `web/current`，共享 Nginx 只读服务。

组件记录使用 format 2，`components.frontend/api/jobs` 分别记录实际提交和镜像，`previous` 分别保留前一版本。`schema` 单独记录实际数据库结构和对应迁移工具。备份 helper 的版本文件跟随主 API（无 API 时为任务），不能将其解释为三个组件都已更新。

## 普通发布与迁移

无迁移时只停止/替换所选后端，前端只切换静态目录。验证所选部分后再次检查其他组件版本和健康，完成公网探针再清除 attempt。发布期间使用维护响应；单机方案不承诺无中断。

存在待迁移项时，须在隔离 MySQL 8.0.46 完成相应迁移验收，并审核混合版本兼容声明。锁内停止 API 和任务；非空库先完成一致性备份及独立存储副本校验，再使用同提交工具单次执行 Drizzle Kit。未选中的写入组件按原不可变镜像和配置快照恢复。首次空库可经明确授权初始化及同步真实目录，不能将此例外用于非空库升级。

默认契约和结构摘要必须一致。`deploy/compatibility/policy.json` 只允许经过代码/SQL Review 确认的旧契约或结构摘要，不自动推测兼容，也不使用数据库回退掩盖版本不兼容。

## 组件回退与恢复

在完整受控源码树中显式加载主环境，以 `HAEN_DEPLOY_SCOPE=frontend|api|jobs` 指定组件，`HAEN_DEPLOY_ACTION=rollback` 并设置 `HAEN_CONTRACT_COMPATIBILITY_CONFIRMED=true` 调用 `apps/server/src/entrypoints/deploy.ts`。入口仍持有两层发布锁、核对实际结构并执行健康检查；只恢复所选组件的 previous 镜像/静态目录及其环境快照，不运行待执行 SQL。

失败现场使用 `HAEN_DEPLOY_ACTION=recover`、`HAEN_RECOVERY_CONFIRMED=true`，明确选择 `HAEN_RECOVERY_VERSION=current|previous|attempt`。首次失败没有 current 时必须明确选择 attempt。先核对结构与记录；恢复入口要求零待迁移项。部分 DDL 失败且记录不一致时保持维护，按[正式恢复手册](../../data/backup/formal-recovery-runbook.md)处理，不能删除 attempt 或自动重跑迁移。

镜像回退不等于数据库回退。MySQL DDL 可能隐式提交；恢复旧数据库需明确恢复点和后续数据影响，禁止未经验证的逆向 SQL 或删除生产库。

## 发布报告

每次修改完成后的交付说明都要明确列出需要更新的服务或产物：前端静态资源（`radio-frontend` 发布任务）、API（`radio-api`）、后台任务（`radio-jobs`）及其他实际受影响的服务，同时说明涉及的数据库迁移、配置调整和更新顺序。无需服务更新时明确写出“本次无需更新服务”；需要更新和已经更新分别说明，实际发布按既有授权执行。

记录各组件实际提交/镜像、配置变化、SQL 执行状态、验证结果和未完成事项。已上传镜像不代表目标部署成功；以持久记录、实际容器和公网探针为准。备份见[数据文档](../../data/backup/backup-and-restore.md)，入口见[Jenkins](../jenkins/pipeline.md)。

## 协作规则更新记录（2026-10-18）

- 需求：每次修改完成后告诉用户需要更新哪些服务。
- 实际变更：在项目协作规范和本页固化交付要求，覆盖前端、API、后台任务、迁移、配置、更新顺序及无需更新的情形。
- 验证：本次仅修改文档，执行内容 Review、本地链接与目录一致性检查及差异空白检查；结果以本次交付说明为准。
- 未完成事项：无功能或部署待办。本次无需更新服务，无数据库迁移或运行配置调整。
