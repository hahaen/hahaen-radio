# 正式服务器配置与产物清单

公开入口为 `https://hahaen.xyz/radio/`，Jenkins 文件夹为 `radio`（声屿 HAEN）。主环境文件在仓库外 `/home/hahaen/radio-prod.env`，发布身份所有、600，按显式 Node env-file 加载。文件内容不进入 Git、镜像或构建产物。

2026-10-18 已切换服务器本地镜像发布，API #5、任务 #2、前端 #2 均成功；API/任务实际源码为 `85879c0`，前端为 `d35dbc1`，三个组件上一版本均为 `13b95a4`。两个仓库容器及仓库数据已删除；API 健康、任务就绪、静态目录及公网检查通过。

## 服务器目录

```text
/home/hahaen/
├── radio-prod.env                    # 主私有环境，600
└── hahaen-radio/
    ├── source/                       # 已发布源码副本
    ├── config/
    │   ├── target.json               # 目标路径与站点，600
    │   ├── api.env                   # API 派生 raw 环境，600
    │   ├── jobs.env                  # 任务派生 raw 环境，600
    │   ├── migration.env             # 迁移派生 raw 环境，600
    │   ├── backup.env                # 独立备份身份，600
    │   ├── deploy.env -> /home/hahaen/radio-prod.env
    │   └── mysql-ca.pem              # 数据库可信 CA
    ├── nginx/
    │   ├── radio-locations.conf      # /radio/ 静态、API、维护路由
    │   └── radio-probes.conf         # 容器回环发布探针
    ├── web/
    │   ├── current -> releases/<image-id>/site
    │   ├── releases/<image-id>/site/ # 公开静态文件
    │   ├── releases/<image-id>/receipt.json # 内容/镜像摘要，600
    │   └── maintenance.html
    ├── state/
    │   ├── state.json                # 各组件实际版本/上一版本/结构/attempt
    │   ├── environments/             # 各组件私有原始配置快照，600
    │   └── <attempt-id>.json          # 完成记录历史
    ├── maintenance/                  # enabled 文件控制维护状态
    ├── locks/deploy.lock             # 同一 inode 的受保护共享锁
    ├── data/
    │   ├── api_logs/                 # radio_api_logs 的实际目录
    │   ├── jobs_logs/                # radio_jobs_logs 的实际目录
    │   └── recognition_state/        # radio_recognition_state 的实际目录
    ├── runtime/
    │   ├── node/                     # Node.js 24.9.0
    │   ├── java/                     # agent 运行时
    │   └── operations/current        # 管理员保管的编译运维包
    ├── jenkins/build/                # 构建身份、agent、工作区和缓存
    ├── jenkins/target/               # 发布身份、agent、工作区和缓存
    ├── backups/                      # 本机备份位置
    ├── backup-version/current        # 主 API 的备份关联版本
    ├── backup-home/
    ├── ci/                           # 构建专用虚拟音频配置
    ├── systemd/                      # 项目服务定义
    ├── operations/                   # 固定 helper 与私有管理员工具
    ├── cache/
    └── archive/private/              # 管理员受限归档
```

共享 Nginx 的编排文件仍为 `/home/hahaen/nginx/docker-compose.yml`，原站点配置包含项目 nginx 片段，只读挂载 web、maintenance、nginx 三个目录。共享 Jenkins、MySQL 和其他站点继续由各自原目录管理。旧路径兼容链接及受保护锁挂载见[目录约束](server-layout.md)。

## Docker 与 Jenkins

| 类型 | 名称或路径 |
| --- | --- |
| 常驻应用容器 | `radio-api`、`radio-jobs` |
| 静态前端 | 共享 `nginx`，不保留 `radio-web` 容器 |
| 项目仓库容器 | 已退役，日常发布直接使用服务器本地镜像 |
| 项目网络 | `radio_application` |
| 项目持久卷 | `radio_api_logs`、`radio_jobs_logs`、`radio_recognition_state` |
| 构建定义 | `source/deploy/docker/Dockerfile` |
| 应用编排 | `source/deploy/compose/compose.yaml` |
| 手动任务 | `radio/radio-frontend`、`radio/radio-api`、`radio/radio-jobs` |
| 本地构建标签 | `radio-local/frontend`、`radio-local/api`、`radio-local/jobs`、按需 `radio-local/migration` |

旧 deploy.env 是兼容链接，实际修改以主环境为准；角色 raw 文件由发布工具按所选组件生成。`state/environments/` 保留对应发布的配置快照。

三个任务各自归档 `source.json`、`component-source.json`、`component-build.json`、`component-check.json`、`component-release.json`、`component-handoff.json`。后续本地发布以不可变镜像 ID 为准，不能把构建标签或任务成功推断为其他组件也已更新。私有环境快照和目标持久状态不作为 Jenkins 公开产物。

## 数据库与验证

正式库为 `ha_radio`，开发库为 `ha_radio_dev`，共用已有 MySQL 实例。常规发布无需人工执行 SQL；实际存在待迁移项时，Jenkins 在锁内执行已审核的迁移。非空库迁移必须具备一致性备份和独立副本；当前尚无独立备份位置，每日副本定时器未启用。

正式库最终为 3 条已应用迁移、0 条待迁移、11 张表；真实城市 34165 条、电台 69018 个，开发库未改动。旧任务、临时容器、失败本机镜像引用、旧工作区和诊断夹具已清理，必要的版本/配置与受限审计记录保留。

实际发布版本、SQL 执行结果、健康与清理结果见[正式部署记录](../../iterations/2026-10-17-production-deployment/README.md)。

2026-10-18 的仓库退役和本地构建调整见[本地发布记录](../../iterations/2026-10-18-local-image-deployment/README.md)。
