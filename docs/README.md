# 技术文档导航

沉浸场景与地球页的色调统一见[沉浸收听配色](iterations/2026-10-22-immersive-palette/README.md)。

当前页面调整：[播放状态动效与秒钟显示](iterations/2026-10-22-playback-status-and-clock/README.md)、[移除流派探索](iterations/2026-10-22-remove-genre-view/README.md)、[电影感夜航](iterations/2026-10-21-cinematic-night/README.md)，构图和组件基线见[夜航设计规范](frontend/design/night-voyage.md)。

正式环境部署进展见[正式部署记录](iterations/2026-10-17-production-deployment/README.md)，服务器路径见[项目目录](deployment/containers/server-layout.md)，具体配置见[服务器配置与产物清单](deployment/containers/server-inventory.md)。

本次目标已按调整后的功能可用标准收尾，证据、数据库状态及后续专项见[目标收尾](iterations/2026-10-17-goal-completion/README.md)。

本目录保存「声屿 HAEN」的产品目标、技术方案、工程约定与部署运维流程。工程初始化、数据库与真实目录已通过适用本机验证；真实播放与夜航探索已接入，曲目与可选音频增强已接入，约定功能与发布材料已实现，环境专项保留后续待办，实际状态见产品验收矩阵。

目录归属调整见[应用目录归类记录](iterations/2026-10-17-application-layout/README.md)及[当前仓库结构](architecture/repository-layout.md)。

中国搜索范围调整见[任务记录](iterations/2026-10-18-china-search/README.md)。

单屏布局调整见[任务记录](iterations/2026-10-18-fixed-screen-layout/README.md)。

国家级电台地图展示见[任务记录](iterations/2026-10-18-country-map/README.md)。

电台逐台地图展示见[任务记录](iterations/2026-10-18-station-map-density/README.md)。

全系统样式统一见[任务记录](iterations/2026-10-18-unified-visual-style/README.md)。

中国时间、公历与农历调整见[任务记录](iterations/2026-10-18-china-clock/README.md)。

地球、品牌、收听区与浮层整体精修见[任务记录](iterations/2026-10-21-listening-finish/README.md)。

## 阅读顺序

标签页图标的候选、尺寸对照及接入见[图标设计记录](iterations/2026-10-18-favicon-concepts/README.md)，当前 C「耳机海湾」已改为透明背景 v2 并接入前端源码，本次修正待发布。

1. 阅读[项目协作规范](../AGENTS.md)，明确开发、验证和自动提交顺序。
2. 阅读[项目总览](overview/README.md)和[技术选型](overview/technology-stack.md)，了解技术基线。
3. 阅读[系统架构](architecture/system-design.md)和[代码目录规划](architecture/repository-layout.md)，了解模块关系。
4. 按工作范围查阅前端、后端、数据与工程文档。
5. 首次上线先阅读[服务器部署准备清单](deployment/releases/first-deployment-checklist.md)，再依次阅读容器、Jenkins、发布与回退文档。

## 分目录索引

| 一级目录 | 二级主题 | 文档 |
| --- | --- | --- |
| `product/` | 产品目标、阶段进度与验收 | [产品目标](product/README.md)、[实施进度](product/progress.md)、[验收矩阵](product/acceptance.md) |
| `overview/` | 项目状态、技术组合 | [总览](overview/README.md)、[技术选型](overview/technology-stack.md) |
| `architecture/` | 系统、仓库、架构决策 | [架构导航](architecture/README.md)、[系统设计](architecture/system-design.md)、[仓库规划](architecture/repository-layout.md)、[决策记录](architecture/decisions/README.md)、[共享 Nginx 决策](architecture/decisions/0006-shared-nginx-static-release.md)、[识曲额度决策](architecture/decisions/0004-recognition-allowance.md) |
| `frontend/` | 设计、应用、渲染、音频、浏览器 | [前端导航](frontend/README.md)、[夜航设计规范](frontend/design/night-voyage.md)、[本地字体](frontend/design/fonts.md)、[应用结构与状态](frontend/application/structure-and-state.md)、[收听入口](frontend/application/player-flow.md)、[探索界面](frontend/application/exploration.md)、[个人收听工具](frontend/application/listening-tools.md)、[收听设置](frontend/application/listening-controls.md)、[曲目与歌词](frontend/application/tracks-and-lyrics.md)、[手动识曲](frontend/application/recognition.md)、[产品说明与帮助](frontend/application/information-and-help.md)、[精简故障报告](frontend/application/playback-diagnostics.md)、[探索目录](frontend/rendering/exploration-data.md)、[Three.js](frontend/rendering/threejs.md)、[音频引擎](frontend/audio/audio-engine.md)、[可选音频增强](frontend/audio/enhancement.md)、[平台与本地存储](frontend/platform/browser-and-storage.md) |
| `backend/` | API、服务分层、任务 | [后端导航](backend/README.md)、[API 约定](backend/api/conventions.md)、[目录 API](backend/api/catalog.md)、[曲目 API](backend/api/tracks.md)、[识曲 API](backend/api/recognition.md)、[诊断 API](backend/api/diagnostics.md)、[服务与外部接入](backend/services/layers-and-integrations.md)、[任务调度](backend/jobs/scheduling.md) |
| `data/` | 数据库、目录、迁移、备份 | [数据导航](data/README.md)、[目录管线](data/catalog-pipeline.md)、[离线地理](data/offline-geography.md)、[MySQL 与 Drizzle](data/database/mysql-and-drizzle.md)、[表选项与排序规则](data/database/table-options-and-collations.md)、[迁移流程](data/migrations/workflow.md)、[目标迁移预检](data/migrations/target-preflight.md)、[备份与恢复](data/backup/backup-and-restore.md)、[正式恢复手册](data/backup/formal-recovery-runbook.md) |
| `engineering/` | 环境、依赖、质量、测试 | [工程导航](engineering/README.md)、[环境与依赖](engineering/environment-and-dependencies.md)、[干净检出](engineering/clean-checkout.md)、[质量与测试](engineering/quality-and-testing.md)、[规模与稳定性](engineering/scale-and-stability.md)、[可访问性](engineering/accessibility.md)、[资源预算](engineering/resource-budgets.md)、[真实手机验收](engineering/real-device-acceptance.md) |
| `deployment/` | 容器、Jenkins、发布 | [部署导航](deployment/README.md)、[容器与存储](deployment/containers/topology-and-storage.md)、[镜像构建与运行](deployment/containers/local-and-image-build.md)、[Jenkins 流水线](deployment/jenkins/pipeline.md)、[人工目标阶段](deployment/jenkins/target-stage.md)、[环境与凭据](deployment/jenkins/environment-and-credentials.md)、[发布与回退](deployment/releases/release-and-rollback.md)、[目标执行器](deployment/releases/target-executor.md) |
| `operations/` | 配置、日志、健康检查 | [运维导航](operations/README.md)、[配置与日志](operations/configuration-and-logging.md)、[普通日志保留](operations/runtime-logs.md)、[数据库维护协调](operations/database-maintenance.md)、[每日备份](operations/daily-backups.md)、[健康与排障](operations/health-and-troubleshooting.md)、[识曲额度](operations/recognition-quota.md)、[播放诊断](operations/playback-diagnostics.md) |
| `iterations/` | 按日期和主题的任务记录 | [归档导航](iterations/README.md)、[MySQL 与 Drizzle Kit](iterations/2026-10-16-mysql-drizzle-kit/README.md)、[技术方案评估](iterations/2026-10-16-technical-assessment/README.md)、[建表选项核对](iterations/2026-10-16-table-options/README.md)、[双端适配规范](iterations/2026-10-16-desktop-mobile-adaptation/README.md)、[夜航视觉规范](iterations/2026-10-16-night-voyage-design/README.md)、[工程初始化](iterations/2026-10-17-workspace-foundation/README.md)、[目录管线](iterations/2026-10-17-catalog-pipeline/README.md)、[真实播放](iterations/2026-10-17-real-playback/README.md)、[离线地理](iterations/2026-10-17-offline-geography/README.md)、[探索界面](iterations/2026-10-17-exploration-interface/README.md)、[本地收听清单](iterations/2026-10-17-personal-library/README.md)、[收听控制](iterations/2026-10-17-listening-controls/README.md)、[曲目与歌词](iterations/2026-10-17-track-and-lyrics/README.md)、[音频增强](iterations/2026-10-17-audio-enhancement/README.md)、[手动识曲](iterations/2026-10-17-manual-recognition/README.md)、[产品说明](iterations/2026-10-17-product-information/README.md)、[有限诊断](iterations/2026-10-17-playback-diagnostics/README.md)、[规模验证](iterations/2026-10-17-scale-stability/README.md)、[容器基础](iterations/2026-10-17-container-foundation/README.md)、[备份恢复](iterations/2026-10-17-backup-recovery/README.md)、[维护协调](iterations/2026-10-17-maintenance-coordination/README.md)、[每日备份](iterations/2026-10-17-backup-schedule/README.md)、[镜像产物链](iterations/2026-10-17-release-images/README.md)、[迁移预检](iterations/2026-10-17-migration-preflight/README.md)、[目标执行器](iterations/2026-10-17-target-deployment/README.md)、[Jenkins目标阶段](iterations/2026-10-17-jenkins-target/README.md)、[普通日志保留](iterations/2026-10-17-runtime-log/README.md)、[正式恢复手册](iterations/2026-10-17-formal-recovery/README.md)、[可访问性回归](iterations/2026-10-17-accessibility/README.md)、[资源持续运行](iterations/2026-10-17-resource-budgets/README.md)、[Android 真机](iterations/2026-10-17-android-device/README.md)、[干净检出](iterations/2026-10-17-clean-checkout/README.md) |

## 文档目录树

```text
docs/
├── README.md
├── product/
│   ├── README.md
│   ├── progress.md
│   └── acceptance.md
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
│       ├── 0003-table-options-and-target-environment.md
│       ├── 0004-recognition-allowance.md
│       ├── 0005-bounded-playback-diagnostics.md
│       └── 0006-shared-nginx-static-release.md
├── frontend/
│   ├── README.md
│   ├── design/
│   │   ├── night-voyage.md
│   │   ├── fonts.md
│   │   └── assets/night-voyage-concept.png
│   ├── application/
│   │   ├── structure-and-state.md
│   │   ├── player-flow.md
│   │   ├── exploration.md
│   │   ├── listening-tools.md
│   │   ├── listening-controls.md
│   │   ├── tracks-and-lyrics.md
│   │   ├── recognition.md
│   │   ├── information-and-help.md
│   │   └── playback-diagnostics.md
│   ├── rendering/
│   │   ├── threejs.md
│   │   └── exploration-data.md
│   ├── audio/
│   │   ├── audio-engine.md
│   │   └── enhancement.md
│   └── platform/browser-and-storage.md
├── backend/
│   ├── README.md
│   ├── api/
│   │   ├── conventions.md
│   │   ├── catalog.md
│   │   ├── tracks.md
│   │   ├── recognition.md
│   │   └── diagnostics.md
│   ├── services/layers-and-integrations.md
│   └── jobs/scheduling.md
├── data/
│   ├── README.md
│   ├── catalog-pipeline.md
│   ├── offline-geography.md
│   ├── database/
│   │   ├── mysql-and-drizzle.md
│   │   └── table-options-and-collations.md
│   ├── migrations/
│   │   ├── workflow.md
│   │   └── target-preflight.md
│   └── backup/
│       ├── backup-and-restore.md
│       └── formal-recovery-runbook.md
├── engineering/
│   ├── README.md
│   ├── environment-and-dependencies.md
│   ├── clean-checkout.md
│   ├── quality-and-testing.md
│   ├── scale-and-stability.md
│   ├── real-device-acceptance.md
│   ├── accessibility.md
│   └── resource-budgets.md
├── deployment/
│   ├── README.md
│   ├── containers/
│   │   ├── topology-and-storage.md
│   │   └── local-and-image-build.md
│   ├── jenkins/
│   │   ├── pipeline.md
│   │   ├── environment-and-credentials.md
│   │   └── target-stage.md
│   └── releases/
│       ├── first-deployment-checklist.md
│       ├── release-and-rollback.md
│       └── target-executor.md
├── operations/
│   ├── README.md
│   ├── runtime-logs.md
│   ├── configuration-and-logging.md
│   ├── database-maintenance.md
│   ├── daily-backups.md
│   ├── health-and-troubleshooting.md
│   ├── recognition-quota.md
│   └── playback-diagnostics.md
└── iterations/
    ├── README.md
    ├── 2026-10-18-china-search/
    │   └── README.md
    ├── 2026-10-18-favicon-concepts/
    │   ├── README.md
    │   ├── prompts.md
    │   ├── preview.html
    │   ├── favicon-validation.json
    │   ├── favicon-transparency-validation.json
    │   └── assets/
    │       ├── a-sound-island.png
    │       ├── b-world-radio.png
    │       ├── c-listening-bay.png
    │       ├── c-listening-bay-transparent.png
    │       ├── d-haen-monogram.png
    │       ├── comparison-desktop.png
    │       ├── comparison-mobile.png
    │       └── transparency-preview.png
    ├── 2026-10-16-mysql-drizzle-kit/
    │   └── README.md
    ├── 2026-10-16-technical-assessment/
    │   └── README.md
    ├── 2026-10-16-table-options/
    │   └── README.md
    ├── 2026-10-16-desktop-mobile-adaptation/
    │   └── README.md
    ├── 2026-10-16-night-voyage-design/
    │   └── README.md
    ├── 2026-10-17-workspace-foundation/
    │   └── README.md
    ├── 2026-10-17-catalog-pipeline/
    │   └── README.md
    ├── 2026-10-17-offline-geography/
    │   └── README.md
    ├── 2026-10-17-clean-checkout/
    │   ├── README.md
    │   └── results.json
    ├── 2026-10-17-android-device/
    │   ├── README.md
    │   ├── results.json
    │   └── assets/
    │       ├── initial.png
    │       └── playing.png
    ├── 2026-10-17-resource-budgets/
    │   ├── README.md
    │   └── results.json
    ├── 2026-10-17-accessibility/
    │   ├── README.md
    │   ├── results.json
    │   └── assets/
    │       ├── settings-desktop-zh.png
    │       ├── settings-mobile-zh.png
    │       └── settings-mobile-en-text200.png
    ├── 2026-10-17-formal-recovery/
    │   ├── README.md
    │   └── results.json
    ├── 2026-10-17-runtime-log/
    │   ├── README.md
    │   └── results.json
    ├── 2026-10-17-jenkins-target/
    │   ├── README.md
    │   └── results.json
    ├── 2026-10-17-target-deployment/
    │   ├── README.md
    │   └── results.json
    ├── 2026-10-17-migration-preflight/
    │   ├── README.md
    │   └── results.json
    ├── 2026-10-17-release-images/
    │   ├── README.md
    │   └── results.json
    ├── 2026-10-17-backup-schedule/
    │   ├── README.md
    │   └── results.json
    ├── 2026-10-17-maintenance-coordination/
    │   ├── README.md
    │   └── results.json
    ├── 2026-10-17-backup-recovery/
    │   ├── README.md
    │   └── results.json
    ├── 2026-10-17-container-foundation/
    │   ├── README.md
    │   └── results.json
    ├── 2026-10-17-scale-stability/
    │   ├── README.md
    │   └── results.json
    ├── 2026-10-17-playback-diagnostics/
    │   ├── README.md
    │   └── assets/
    │       ├── desktop-report.png
    │       └── mobile-report.png
    ├── 2026-10-17-product-information/
    │   ├── README.md
    │   └── assets/
    │       ├── desktop.png
    │       └── mobile.png
    ├── 2026-10-17-manual-recognition/
    │   ├── README.md
    │   └── assets/
    │       ├── desktop.png
    │       └── mobile.png
    ├── 2026-10-17-audio-enhancement/
    │   ├── README.md
    │   └── assets/
    │       ├── desktop.png
    │       └── mobile.png
    ├── 2026-10-17-track-and-lyrics/
    │   ├── README.md
    │   └── assets/
    │       ├── desktop.png
    │       ├── mobile.png
    │       ├── mobile-text200-en.png
    │       └── mobile-lyrics-text200-en.png
    ├── 2026-10-17-listening-controls/
    │   ├── README.md
    │   └── assets/
    │       ├── settings-desktop.png
    │       ├── settings-mobile.png
    │       ├── immersive-desktop.png
    │       ├── immersive-mobile.png
    │       ├── settings-text200-en.png
    │       └── immersive-landscape.png
    ├── 2026-10-17-personal-library/
    │   ├── README.md
    │   └── assets/
    │       ├── desktop.png
    │       ├── mobile.png
    │       ├── main-desktop.png
    │       └── mobile-text200-en.png
    ├── 2026-10-17-exploration-interface/
    │   ├── README.md
    │   └── assets/
    │       ├── desktop.png
    │       ├── mobile.png
    │       └── mobile-text200.png
    └── 2026-10-17-real-playback/
        ├── README.md
        ├── real-stations.md
        └── assets/
            ├── desktop.png
            └── mobile.png
```

## 状态与维护规则

播放与切台自动转向电台标记见[播放电台居中](iterations/2026-10-22-globe-playback-centering/README.md)。

- **已确定**：已选定的技术和架构约定。
- **待实施**：已有方案，但代码、脚本或配置尚未创建。
- **待验证**：需要安装、构建、浏览器或目标服务器实测才能确认。
- **已验证**：只有附带实际检查范围和结果时使用，不以方案文字替代证据。

技术基线集中维护在[技术选型](overview/technology-stack.md)。其他文档负责展开使用约定；如有技术变更，应先更新架构决策，再同步基线和相关章节。

新文档按主题放入现有子目录，并更新本索引。文件和目录使用小写英文、连字符命名；正文以中文为主，代码标识保持原名。

- [服务器本地构建与镜像仓库退役](iterations/2026-10-18-local-image-deployment/README.md)

2026-10-18：[夜航收听体验与目录整理](iterations/2026-10-18-listening-refresh/README.md)。

画面与信息层级优化见[任务记录](iterations/2026-10-21-visual-refinement/README.md)。

地球亮度与清晰度优化见[任务记录](iterations/2026-10-21-globe-clarity/README.md)。

地球与流派美化见[任务记录](iterations/2026-10-21-globe-and-genre-polish/README.md)。

磨砂界面、夜航动效与沉浸收听调整见[任务记录](iterations/2026-10-21-search-surface/README.md)。

全屏沉浸环境与地图地点说明见[任务记录](iterations/2026-10-21-immersive-environments/README.md)。

沉浸环境声浪动效见[任务记录](iterations/2026-10-21-immersive-waves/README.md)。

沉浸收听默认潮汐见[任务记录](iterations/2026-10-22-immersive-default/README.md)。

电台地图地理位置修复见[任务记录](iterations/2026-10-21-geographic-position/README.md)。

地球质感与流派星图精修见[任务记录](iterations/2026-10-21-celestial-atlas/README.md)。
