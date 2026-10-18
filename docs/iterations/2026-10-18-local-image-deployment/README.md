# 服务器本地构建与镜像仓库退役

## 需求与实际变更

用户要求改为 Jenkins 在同一台服务器拉取所选分支、检查、构建并更新，删除 `radio-registry-gateway`、`radio-registry`。保留三个独立任务、唯一分支参数、前端共享 Nginx、API/任务固定容器名。

发布工具改为记录不可变本地镜像 ID，交接同时绑定 Docker 引擎 ID；目标禁止拉取和隐式构建。当前和上一成功版本、相应私有配置快照及前端目录用于回退，结构工具镜像独立保护。成功发布只清理本轮淘汰的更早成功版本，不扫描其他活动构建或其他业务镜像。失败/中止构建和共享 Docker 构建缓存不属于自动清理范围。

## 验证与上线

本次变更完成两轮范围内 Review；本地 51 项部署工具回归全部通过，部署脚本格式/lint、文档与本地链接检查、目标 Jenkins Declarative Linter 通过。三次正式发布均在两个仓库容器停止后成功，只有分支选择参数，构建描述为空：

| 任务 | 成功构建 | 实际源码提交 |
| --- | --- | --- |
| `radio-api` | #5 | `85879c01b7b296da2d0fff9125a9e3392c296a98` |
| `radio-jobs` | #2 | `85879c01b7b296da2d0fff9125a9e3392c296a98` |
| `radio-frontend` | #2 | `d35dbc19b84d2dfb839f4591502f352f88618cab` |

顺序为 API、后台任务、前端；每次只更新所选部分。三个组件的上一成功版本均为 `13b95a4`，当前结构工具仍为 `8841a90`，六个不同的本地镜像 ID 受到保护。实际应用容器与所记录镜像 ID 一致、重启次数为 0，API 健康；前端静态文件、各组件配置快照和服务器源码副本已核对。

数据库仅执行只读状态核对：`ha_radio` 为 3 条已应用迁移、0 条待迁移、11 张表；此次没有执行初始化、DDL 或数据修正 SQL，没有访问或改动开发库数据。

`/radio/`、`/radio/api/v1/health/ready`、Jenkins 登录入口、现有博客和个人站点均返回 200，共享 Nginx 配置校验通过。其他既有服务容器 ID 保持不变。此次没有修改产品界面，复用已有电脑端/手机端验收，不追加完整浏览器或持续压力专项。

API #5 的过期镜像清理曾触发保护提示：Docker 29 的 `RepoTags` 同时包含旧仓库摘要引用。先用回归测试复现拒绝，再仅接受本项目且与实际镜像 ID 相同的摘要别名；其他项目和不同摘要继续拒绝。修正后在同一服务器、发布锁内实际清除了被淘汰 API 镜像及其配置快照，当前/上一成功版本和结构工具不变。

## 清理与配置产物

- 已删除 `radio-registry-gateway`、`radio-registry` 和 `radio-registry-net`。
- 已清理 `/home/hahaen/hahaen-radio/registry/`，其中仓库数据清理前约 319 MiB；未另存一份仓库数据。保留当前/上一版本的本地 Docker 镜像用于回退。
- 已删除仓库专用宿主证书及旧目录兼容链接，5043 不再监听；保留共享 Nginx 镜像。仅用于本项目的 `registry:3` 镜像已移除。
- 已移除两个 Jenkins 仓库 Secret file 和节点上的 `HAEN_IMAGE_REPOSITORY`、`HAEN_REGISTRY_CA_FILE`。主环境 `/home/hahaen/radio-prod.env`、角色 env、数据库证书、持久卷及现有应用网络保留。
- 受控运维包安装工具接受 `radio-local/api` 构建标签；日常源码位于 `/home/hahaen/hahaen-radio/source/`，构建定义为 `deploy/docker/Dockerfile`、运行编排为 `deploy/compose/compose.yaml`。
- 一次性切换/清理工具、原状态和验证收据仅保存在服务器受限归档，目标状态目录不遗留临时清理工具，公开文档不包含配置值或认证材料。

## 未完成事项

本次发布切换与仓库退役均已完成。仍无独立备份存储；非空库结构升级的备份副本保护继续生效。本地镜像丢失后需要重新构建或从独立备份恢复，不能再从退役仓库拉取。

目录及配置见[服务器清单](../../deployment/containers/server-inventory.md)，日常入口见[Jenkins 流水线](../../deployment/jenkins/pipeline.md)。
