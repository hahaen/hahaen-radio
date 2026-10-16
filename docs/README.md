# 技术文档导航

本目录保存「声屿 HAEN」的技术方案、工程约定与部署运维流程。当前已完成文档整理和工程目录骨架，应用依赖、可运行入口、数据库和发布流水线均待初始化与验证。

## 阅读顺序

1. 阅读[项目协作规范](../AGENTS.md)，明确开发、验证和自动提交顺序。
2. 阅读[项目总览](overview/README.md)和[技术选型](overview/technology-stack.md)，了解技术基线。
3. 阅读[系统架构](architecture/system-design.md)和[代码目录规划](architecture/repository-layout.md)，了解模块关系。
4. 按工作范围查阅前端、后端、数据与工程文档。
5. 部署前依次阅读容器、Jenkins、发布与回退文档。

## 分目录索引

| 一级目录 | 二级主题 | 文档 |
| --- | --- | --- |
| `overview/` | 项目状态、技术组合 | [总览](overview/README.md)、[技术选型](overview/technology-stack.md) |
| `architecture/` | 系统、仓库、架构决策 | [架构导航](architecture/README.md)、[系统设计](architecture/system-design.md)、[仓库规划](architecture/repository-layout.md)、[决策记录](architecture/decisions/README.md) |
| `frontend/` | 应用、渲染、音频、浏览器 | [前端导航](frontend/README.md)、[应用结构与状态](frontend/application/structure-and-state.md)、[Three.js](frontend/rendering/threejs.md)、[音频引擎](frontend/audio/audio-engine.md)、[平台与本地存储](frontend/platform/browser-and-storage.md) |
| `backend/` | API、服务分层、任务 | [后端导航](backend/README.md)、[API 约定](backend/api/conventions.md)、[服务与外部接入](backend/services/layers-and-integrations.md)、[任务调度](backend/jobs/scheduling.md) |
| `data/` | 数据库、建表选项、迁移、备份 | [数据导航](data/README.md)、[MySQL 与 Drizzle](data/database/mysql-and-drizzle.md)、[表选项与排序规则](data/database/table-options-and-collations.md)、[迁移流程](data/migrations/workflow.md)、[备份与恢复](data/backup/backup-and-restore.md) |
| `engineering/` | 环境、依赖、质量、测试 | [工程导航](engineering/README.md)、[环境与依赖](engineering/environment-and-dependencies.md)、[质量与测试](engineering/quality-and-testing.md) |
| `deployment/` | 容器、Jenkins、发布 | [部署导航](deployment/README.md)、[容器与存储](deployment/containers/topology-and-storage.md)、[Jenkins 流水线](deployment/jenkins/pipeline.md)、[环境与凭据](deployment/jenkins/environment-and-credentials.md)、[发布与回退](deployment/releases/release-and-rollback.md) |
| `operations/` | 配置、日志、健康检查 | [运维导航](operations/README.md)、[配置与日志](operations/configuration-and-logging.md)、[健康与排障](operations/health-and-troubleshooting.md) |
| `iterations/` | 按日期和主题的任务记录 | [归档导航](iterations/README.md)、[MySQL 与 Drizzle Kit](iterations/2026-10-16-mysql-drizzle-kit/README.md)、[技术方案评估](iterations/2026-10-16-technical-assessment/README.md)、[建表选项核对](iterations/2026-10-16-table-options/README.md) |

## 文档目录树

```text
docs/
├── README.md
├── overview/
│   ├── README.md
│   └── technology-stack.md
├── architecture/
│   ├── README.md
│   ├── system-design.md
│   ├── repository-layout.md
│   └── decisions/
│       ├── README.md
│       ├── 0001-stack-and-deployment.md
│       ├── 0002-mysql-and-drizzle-kit.md
│       └── 0003-table-options-and-target-environment.md
├── frontend/
│   ├── README.md
│   ├── application/structure-and-state.md
│   ├── rendering/threejs.md
│   ├── audio/audio-engine.md
│   └── platform/browser-and-storage.md
├── backend/
│   ├── README.md
│   ├── api/conventions.md
│   ├── services/layers-and-integrations.md
│   └── jobs/scheduling.md
├── data/
│   ├── README.md
│   ├── database/
│   │   ├── mysql-and-drizzle.md
│   │   └── table-options-and-collations.md
│   ├── migrations/workflow.md
│   └── backup/backup-and-restore.md
├── engineering/
│   ├── README.md
│   ├── environment-and-dependencies.md
│   └── quality-and-testing.md
├── deployment/
│   ├── README.md
│   ├── containers/topology-and-storage.md
│   ├── jenkins/
│   │   ├── pipeline.md
│   │   └── environment-and-credentials.md
│   └── releases/release-and-rollback.md
├── operations/
│   ├── README.md
│   ├── configuration-and-logging.md
│   └── health-and-troubleshooting.md
└── iterations/
    ├── README.md
    ├── 2026-10-16-mysql-drizzle-kit/
    │   └── README.md
    ├── 2026-10-16-technical-assessment/
    │   └── README.md
    └── 2026-10-16-table-options/
        └── README.md
```

## 状态与维护规则

- **已确定**：已选定的技术和架构约定。
- **待实施**：已有方案，但代码、脚本或配置尚未创建。
- **待验证**：需要安装、构建、浏览器或目标服务器实测才能确认。
- **已验证**：只有附带实际检查范围和结果时使用，不以方案文字替代证据。

技术基线集中维护在[技术选型](overview/technology-stack.md)。其他文档负责展开使用约定；如有技术变更，应先更新架构决策，再同步基线和相关章节。

新文档按主题放入现有子目录，并更新本索引。文件和目录使用小写英文、连字符命名；正文以中文为主，代码标识保持原名。
