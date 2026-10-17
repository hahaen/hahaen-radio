# 部署配置目录

状态：已实现同提交产物链、共享 Nginx 静态发布、API/jobs Compose、目标迁移与恢复入口；原生节点与隔离镜像已验证，首次正式上线状态见[记录](../docs/iterations/2026-10-17-production-deployment/README.md)。每日独立副本仍需实际存储配置，未启用定时器。

| 目录 | 用途 |
| --- | --- |
| `docker/` | 多阶段 Dockerfile 和必要构建辅助文件 |
| `compose/` | 服务拓扑、网络和持久卷配置 |
| `caddy/` | Web 产物镜像的隔离验收配置 |
| `nginx/` | 共享正式网关的静态路由、API 代理、维护与内部探针 |
| `systemd/` | 受控运维主机的每日备份 service/timer，实际安装按[说明](../docs/operations/daily-backups.md)执行 |

根 `Jenkinsfile` 已接入前端、API、任务三个独立手动入口及各自检查、构建、验收和分发；[节点配置及范围](../docs/deployment/jenkins/pipeline.md)与目标发布编排分别验收。真实凭据、运行环境文件和数据库不放入此目录。

构建与命令见[运行说明](../docs/deployment/containers/local-and-image-build.md)。完整流程见[部署文档](../docs/deployment/README.md)。

部署工具回归测试位于 [tests](tests/README.md)，覆盖镜像、交接、目标更新及日志约束，由根目录 `pnpm test` 执行。

发布脚本统一位于 [scripts](scripts/README.md)，包含镜像构建、节点交接、目标更新及日志探测。根 Jenkinsfile 和后端受控部署入口已同步调用路径。
