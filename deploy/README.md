# 部署配置目录

状态：已创建三个镜像目标、生产 Compose 与 Caddy 配置；本机不运行 Docker，实际容器验收延后。备份工具另在受控运维节点运行；每日备份/复制和定时材料已实现，实际服务器与异盘验收待执行；Jenkins 构建/镜像验收/分发已实现，目标发布执行器与独立审批已接入；API/任务七天日志清理已实现，实际节点验收继续推进。

| 目录 | 用途 |
| --- | --- |
| `docker/` | 多阶段 Dockerfile 和必要构建辅助文件 |
| `compose/` | 服务拓扑、网络和持久卷配置 |
| `caddy/` | HTTPS、前端静态资源与 API 代理配置 |
| `systemd/` | 受控运维主机的每日备份 service/timer，实际安装按[说明](../docs/operations/daily-backups.md)执行 |

根 `Jenkinsfile` 已接入构建、隔离镜像验收和人工分发；[节点配置及范围](../docs/deployment/jenkins/pipeline.md)与目标发布编排分别验收。真实凭据、运行环境文件和数据库不放入此目录。

构建与命令见[运行说明](../docs/deployment/containers/local-and-image-build.md)。完整流程见[部署文档](../docs/deployment/README.md)。

部署工具回归测试位于 [tests](tests/README.md)，覆盖镜像、交接、目标更新及日志约束，由根目录 `pnpm test` 执行。

发布脚本统一位于 [scripts](scripts/README.md)，包含镜像构建、节点交接、目标更新及日志探测。根 Jenkinsfile 和后端受控部署入口已同步调用路径。
