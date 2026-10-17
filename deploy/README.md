# 部署配置目录

状态：已创建三个镜像目标、生产 Compose 与 Caddy 配置；本机不运行 Docker，实际容器验收延后。Jenkins、备份恢复和日志时间保留继续推进。

| 目录 | 用途 |
| --- | --- |
| `docker/` | 多阶段 Dockerfile 和必要构建辅助文件 |
| `compose/` | 服务拓扑、网络和持久卷配置 |
| `caddy/` | HTTPS、前端静态资源与 API 代理配置 |

Jenkins 流水线入口后续放在仓库根目录 `Jenkinsfile`。真实凭据、运行环境文件和数据库不放入此目录。

构建与命令见[运行说明](../docs/deployment/containers/local-and-image-build.md)。完整流程见[部署文档](../docs/deployment/README.md)。
