# 部署配置目录

状态：目录骨架已建立，尚未创建镜像、Compose、Caddy 或 Jenkins 运行配置。

| 目录 | 用途 |
| --- | --- |
| `docker/` | 多阶段 Dockerfile 和必要构建辅助文件 |
| `compose/` | 服务拓扑、网络和持久卷配置 |
| `caddy/` | HTTPS、前端静态资源与 API 代理配置 |

Jenkins 流水线入口后续放在仓库根目录 `Jenkinsfile`。真实凭据、运行环境文件和数据库不放入此目录。

完整流程见[部署文档](../docs/deployment/README.md)。
