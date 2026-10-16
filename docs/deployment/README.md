# 部署文档

确定使用自有 Jenkins 与 Docker Compose，发布由手动触发。当前未创建 Jenkins 任务、容器配置或生产连接。

## 部署阅读顺序

1. [容器拓扑与持久存储](containers/topology-and-storage.md)。
2. [Jenkins 环境与凭据](jenkins/environment-and-credentials.md)。
3. [Jenkins 流水线](jenkins/pipeline.md)。
4. [发布与回退](releases/release-and-rollback.md)。

## 基线

前后端同仓库、分别构建和运行，在同一台 Linux 服务器通过一个域名访问。Caddy 提供前端静态资源，代理 `/api/*`；Fastify API 和后台任务使用独立进程。

Jenkins 默认协调发布前后端，单独更新前需确认接口和数据库兼容。数据库迁移和恢复单独管理，不随应用镜像回退自动逆转。

返回[文档导航](../README.md)。
