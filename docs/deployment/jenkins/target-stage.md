# Jenkins 目标发布

根 Jenkinsfile 的日常入口只保留 `BRANCH` 分支下拉框。用户手动发起一次完整发布，流水线自动锁定实际提交、检查、构建、分发并更新前后端；代码推送不触发发布。首次上线仍在执行，实际结果见[正式部署记录](../../iterations/2026-10-17-production-deployment/README.md)。

## 执行链与确认

1. 发起用户必须同时列于 `HAEN_RELEASE_APPROVERS` 和 `HAEN_DEPLOY_APPROVERS` 的逗号分隔用户 ID 中。不再以二次分发审批代替发起权限检查；未授权用户或非人工 Cause 被拒绝。
2. Git Parameter 插件列出任务 SCM 的远端分支，默认 `main`。校验分支名后由 Git 插件检出，核对本地 HEAD 与这次抓取的远端引用相同，记录完整提交到 `source.json`。后续所有镜像和目标检出使用此提交，不再解析移动中的分支。
3. 冻结安装、工程检查、浏览器回归、600 秒持续检查、三类同提交镜像与隔离容器验收全部通过后，绑定分发身份上传不可变镜像。不再填写镜像上传、目标更新或分端范围参数，日常范围固定为 `full`。
4. seal 核对同任务 build/image-check/release，冻结目标名、HTTPS站点、数据库指纹、平台、提交和交接摘要。stash 仅传递这份交接 JSON。
5. 独立目标 agent 使用本次新空工作区，检出确切提交、冻结安装并构建受控工具；accept 重新核对交接原始字节、上下文、迁移清单、私有环境文件和 release 文件摘要。
6. `target-plan.mjs` 使用已校验的配置和迁移身份，只读检查实际迁移历史。无待执行项时不再询问；有待执行项才由目标发布用户一次确认外部写入方与长事务已停止。空库确认同时明确首次初始化及真实目录同步；非空库仍先执行一致性备份与独立副本校验。
7. 绑定独立只读拉取身份，显式 env-file 调用已有发布执行器。本机文件锁、数据库发布锁、维护、停止自身写入方、迁移、API → Web → 任务和公网验收保持原流程。执行器在锁内重新预检，前置只读结果不能绕过实际保护。

只读预检失败、历史不匹配或迁移失败均阻止继续，不自动重跑状态性阶段。回退、恢复和特殊分端更新仍使用明确的运维流程，日常任务不暴露这些选项。选择的分支须包含当前受控发布工具；只有可信维护者可修改这些分支、Configure 或 Replay。

## 目标配置与角色

| 配置 | 位置与作用 |
| --- | --- |
| HAEN_TARGET_NAME | 稳定目标名，2–40 位小写字母、数字和连字符，首位为字母 |
| HAEN_TARGET_SITE | HTTPS 域名及可选子路径，无末尾斜杠，与 target JSON 的 site 相同 |
| HAEN_TARGET_DATABASE_FINGERPRINT | 64 位连接指纹，覆盖 host、port、库名、TLS 和 CA |
| HAEN_RELEASE_APPROVERS / HAEN_DEPLOY_APPROVERS | 获授权发起完整发布的用户 ID 清单；数据库变更确认使用目标清单 |
| HAEN_DEPLOY_ENV_FILE | 目标节点的仓库外绝对路径、发布用户所有、600；由 Node 显式加载 |
| haen-image-registry-pull-config | 仅项目镜像拉取权限的 Jenkins Secret file，与分发身份分离 |

任务自动传递 `HAEN_SOURCE_COMMIT`、完整目标上下文和交接摘要。源、构建、隔离验收、release 与交接元数据可以归档；配置、凭据、备份、目标状态和临时 Docker 认证目录不得扩大归档。

两个专用节点分别为 `haen-linux-build` 和 `haen-linux-target`，单执行器、标签不混用。目标运行环境、锁目录、持久状态、最小 sudo helper 与备份身份要求见[目标执行器](../releases/target-executor.md)。目标源码工作区完成后由管理员核对已结束 run 与持久状态再清理；失败现场不按目录名盲删。

首次初始化获用户单独授权；缺少独立备份位置的后续非空库迁移继续被阻止。镜像分发成功不代表目标成功，最终以持久记录、实际容器和公网探针为准。

返回[流水线](pipeline.md)、[环境与凭据](environment-and-credentials.md)或[正式部署记录](../../iterations/2026-10-17-production-deployment/README.md)。
