# 仓库目录与职责

代码、配置、测试和生成物按所属应用归类。根目录保留工作区入口、共享包、跨应用工具、部署配置和分类文档。

```text
hahaen-radio/
├── apps/
│   ├── web/
│   │   ├── src/                         前端页面、状态、图形与音频
│   │   ├── public/                      公开静态资源
│   │   ├── scripts/                     字体、地理、测试音源及资源预算工具
│   │   ├── tests/
│   │   │   ├── e2e/                     浏览器功能测试
│   │   │   ├── performance/             生产资源与持续运行检查
│   │   │   └── fixtures/                可控测试素材
│   │   ├── playwright.config.ts         功能测试配置
│   │   ├── playwright.performance.config.ts
│   │   ├── tsconfig.tools.json          测试与工具类型检查
│   │   ├── playwright-report/           本地 HTML 报告，Git 忽略
│   │   └── test-results/                本地测试运行产物，Git 忽略
│   ├── server/
│   │   ├── src/
│   │   │   ├── entrypoints/             API、任务及受控运维入口
│   │   │   ├── modules/                 业务服务、路由与仓储
│   │   │   ├── integrations/            外部服务适配
│   │   │   ├── jobs/                    后台调度与任务
│   │   │   ├── db/                      表结构定义与数据库连接
│   │   │   ├── config/                  环境校验
│   │   │   ├── operations/              迁移预检、备份与维护
│   │   │   └── testing/                 隔离数据库测试工具
│   │   ├── migrations/                  版本化 SQL、快照与迁移日志
│   │   └── drizzle.config.ts            后端迁移生成配置
│   └── android/
│       ├── AGENTS.md                    Android 专用协作规范
│       ├── README.md                    开发入口和完整目录树
│       ├── gradle/wrapper/              固定 Gradle Wrapper 与分发校验
│       ├── graphics/                    共享 Three.js 的独立打包入口
│       └── app/                         Compose / Media3 单应用模块
│           ├── schemas/                 Room Schema
│           └── src/
│               ├── main/
│               │   ├── kotlin/xyz/hahaen/radio/ app、feature、data、domain、playback、graphics
│               │   ├── res/             图像、字体、默认/英文资源与 XML
│               │   └── assets/graphics/ 图形打包资源
│               ├── test/                JVM 测试与素材
│               └── androidTest/         设备测试与素材
├── packages/
│   ├── contracts/                       前后端共享 DTO、Zod Schema、错误码
│   └── config/                          共享工程配置
├── deploy/
│   ├── docker/                          Dockerfile
│   ├── compose/                         服务编排
│   ├── caddy/                           Web 入口
│   ├── jenkins/                         流水线辅助配置
│   ├── maintenance/                     维护页面
│   ├── systemd/                         运维定时任务
│   ├── scripts/                         镜像、交接、目标更新及日志探测
│   └── tests/                           跨应用部署工具测试
├── scripts/                             跨应用文档检查与构建清理工具
├── docs/                                产品、技术、运维和任务记录
├── Jenkinsfile                          手动发布流水线
├── package.json                         统一命令入口
├── pnpm-workspace.yaml
└── pnpm-lock.yaml
```

## 应用与共享包边界

- 前端当前业务入口主要位于 `src/graphics`、`src/audio`、`src/catalog`、`src/library`、`src/tracks`、`src/platform` 与 `src/information`。部分预留目录仍仅含 `.gitkeep`，不能视为已有业务实现。
- 单元和组件测试靠近源码；浏览器测试、性能测试和音源归属于前端。部署工具测试归属于 `deploy/tests`，由根 Vitest 配置统一发现。
- 数据库结构定义位于 `apps/server/src/db/schema.ts`；迁移及元数据位于 `apps/server/migrations`。迁移、预检、备份核对与发布清单均使用该目录，既有 SQL 和元数据内容不变。
- Web 和 Server 可依赖 `contracts`，共享包不反向依赖应用；公开契约不导入数据库驱动、服务器私有配置或 Node.js 专用模块。`config` 不承载业务代码。
- Android 复用公开契约语义与 API，Kotlin DTO 单独映射，不直接导入 TypeScript/Zod；构建由 Gradle 管理，不创建无用途的 pnpm 包。当前为单一 `:app` Gradle 模块，namespace/applicationId 为 `xyz.hahaen.radio`；职责目录已归入统一包前缀。
- Android 专题文档位于 `docs/android`；`graphics/` 直接导入共享图形源码并由 Gradle 调用 Vite 打包，不复制另一份场景源码或让原生播放依赖网页生命周期。
- 根目录 `pnpm test:e2e`、`pnpm test:performance` 转发到 Web；数据库命令继续转发到 Server。根目录统一检查和 Jenkins 入口保持可用。
- 本地凭据、私有归档、依赖、编译产物和测试报告不纳入 Git。数据库实际数据不放在源码或迁移目录中。

各应用说明见[前端](../../apps/web/README.md)、[后端](../../apps/server/README.md)、[Android](../../apps/android/README.md)。返回[架构导航](README.md)或[文档总导航](../README.md)。
