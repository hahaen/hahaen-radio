# Jenkins 流水线

根 [Jenkinsfile](../../../Jenkinsfile) 用于文件夹 `radio` 中的三个手动任务。每个任务只有 `BRANCH` 分支选择，关闭快速 Filter，不在构建历史增加分支/提交描述。代码推送不触发发布，也不另设完整发布入口。

| 任务 | 发布内容 |
| --- | --- |
| `radio-frontend` | 前端静态产物，由共享 Nginx 服务 `/radio/` |
| `radio-api` | 仅 `radio-api` 容器 |
| `radio-jobs` | 仅 `radio-jobs` 容器 |

## 执行流程

1. 人工发起者须同时列于分发和部署用户清单。校验所选分支，核对抓取引用与 HEAD，固定完整提交；后续不再追随分支移动。
2. 冻结安装；执行对应应用及共享契约的格式、lint、类型、单元回归和发布工具回归。日常任务不重复完整浏览器矩阵或 600 秒持续检查，相关专项按实际改动单独验收。
3. 目标节点以只读方式核对实际迁移历史、已安装组件与兼容声明。前端使用当前正式结构对应的迁移工具检查，不触发新结构变更。
4. 仅构建所选部分；后端存在待迁移项才构建迁移镜像。验证原生架构、revision、镜像 ID 和所需模块/静态文件。发布后核对 registry 平台 manifest 的 config digest，固定不可变摘要。
5. 交接材料绑定组件、完整提交、平台、目标站点、数据库指纹、迁移清单和内容摘要。目标节点新工作区重新检出确切提交，验证交接和私有环境文件。
6. 无迁移自动继续；有迁移或首次空库初始化才一次确认数据库变更。实际执行器持有本机文件锁及数据库发布锁，再次核对结构，执行维护、必要停写/备份、单次迁移、所选部分更新和健康检查。

两个专用节点各一个执行器，构建和目标职责分离。每任务禁并发和阶段重启，总上限 45 分钟；跨任务共享目标锁防止并发更新。没有给 SQL 或状态性阶段添加自动重试。旧工作区和失败现场由管理员核对后清理。

## 版本、配置与产物

`component-source.json`、`component-build.json`、`component-check.json`、`component-release.json`、`component-handoff.json` 和 `source.json` 只记录必要版本与验证元数据，按明确文件名归档。禁止扩大成整个私有目录。分发和拉取使用不同 Jenkins Secret file，复制到临时私有 `DOCKER_CONFIG`，退出清理。

目标配置显式加载 `/home/hahaen/radio-prod.env`。每个组件的实际 revision、不可变 image、validationRun 分别存入 `state.json` 的 `components`，前一版本分别存入 `previous`，不存在共用的 serverRevision。API 和任务即使来自同一源码，也保持独立记录和更新。

兼容策略位于 `deploy/compatibility/policy.json`：默认要求契约及结构摘要相同。确需混合版本时，须审核真实兼容窗口并声明允许的摘要；不能通过修改状态伪造兼容。有结构变更时停止两个写入服务，未选中的服务使用其原镜像和私有配置快照恢复。

部署、回退和恢复详见[目标阶段](target-stage.md)、[发布与回退](../releases/release-and-rollback.md)。实际上线结果见[正式部署记录](../../iterations/2026-10-17-production-deployment/README.md)。
