# 部署文档

确定使用自有 Jenkins 与 Docker Compose，发布由手动触发。目标主机入口已实现，见[发布执行器](releases/target-executor.md)；容器基础配置已实现，见[构建与运行](containers/local-and-image-build.md)；Jenkins 文件夹和任务已创建，服务器目录已统一，前端、API、任务三个独立入口已成功完成首次上线。具体状态见[正式部署记录](../iterations/2026-10-17-production-deployment/README.md)与[服务器项目目录](containers/server-layout.md)。

## 部署阅读顺序

首次部署先阅读[服务器准备清单](releases/first-deployment-checklist.md)，确定服务器、域名、数据库、Jenkins 与备份条件，再按以下顺序落实。

1. [容器拓扑与持久存储](containers/topology-and-storage.md)。
2. [Jenkins 环境与凭据](jenkins/environment-and-credentials.md)。
3. [Jenkins 流水线](jenkins/pipeline.md)与[人工目标阶段](jenkins/target-stage.md)。
4. [发布与回退](releases/release-and-rollback.md)。

## 基线

前后端同仓库、分别构建和运行，在同一台 Linux 服务器通过一个域名访问。共享 Nginx 直接提供 `/radio/` 静态文件，代理 `/radio/api/*` 到后端；常驻应用容器仅 `radio-api`、`radio-jobs`。前端版本由不可变产物提取与原子目录切换发布。

Jenkins 的三个独立任务在服务器本地构建和发布，单独更新前需确认接口和数据库兼容；不再依赖项目私有镜像仓库，见[本地发布记录](../iterations/2026-10-18-local-image-deployment/README.md)。数据库迁移和恢复单独管理，不随应用镜像回退自动逆转。

## 本机验证与部署前补测

2026-10-17 用户明确要求：本机没有 Docker，可以先不做 Docker 实测，待真正部署时再测。镜像、Compose、Caddy、迁移工具和 Jenkins 配置仍属于实现范围；源码检查或本机 Node.js 构建通过不能记作容器通过。

实际部署环境需补测以下项目，并在[验收矩阵](../product/acceptance.md)记录环境、版本、命令和结果：

1. 冻结依赖与目标架构下的 Web、服务端、独立迁移镜像构建。
2. Compose 配置展开、服务启动、健康检查、同域页面与 `/api/v1` 路由。
3. 运行账户的 MySQL 8.0.46 连接、字符集、时区和连接池回收。
4. 隔离库中的初始化、升级、数据保留及单次 Drizzle Kit 迁移入口。
5. 本地私有资料与凭据不进入构建上下文、镜像层或前端产物。
6. 服务重启后的持久化、任务互斥、日志保留和停止写入流程。
7. 备份可用性、隔离恢复演练及应用回退流程。

在这些检查执行前，交付中保留“容器实测延后”状态；不自动发布到正式环境。

返回[文档导航](../README.md)。
