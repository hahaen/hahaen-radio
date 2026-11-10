# hahaen-radio

声屿 HAEN · 嗯，听听世界。

本项目采用 React、TypeScript 和 Three.js 构建浏览器应用，使用 Node.js、Fastify 和 MySQL 提供数据服务，在本机编译，经 SSH 上传产物后由 Docker Compose 部署。

已完成工程初始化、真实目录管线、基础播放与夜航探索，可搜索电台、旋转地球、按流派发现并播放 MP3/AAC/HLS。电台收藏、最近收听、多维筛选、分享与文件迁移也已接入，收听设置、睡眠、快捷键和沉浸基础已接入，曲目与歌词、可选音量校准及调台音效已接入，默认关闭的识曲适配及部署材料已实现；本次按约定功能、构建运行、相关测试及无已知严重功能问题的标准完成，环境专项保留待办。证据见[目标收尾](docs/iterations/2026-10-17-goal-completion/README.md)；实际状态见[实施进度](docs/product/progress.md)。

## 文档入口

- [项目协作规范](AGENTS.md)：技术基线、开发验证与自动提交规则。
- [完整产品目标](docs/product/README.md)：功能范围、阶段顺序与验收边界。
- [从干净检出开始运行](docs/engineering/clean-checkout.md)：安装、私有配置、真实数据、编译运行与手动发布顺序。
- [验收矩阵](docs/product/acceptance.md)：实际通过项、未完成项及部署前检查。
- [完整文档导航](docs/README.md)：按主题查找全部技术文档。
- [技术选型](docs/overview/technology-stack.md)：已确定的技术组合与版本策略。
- [Android 客户端](apps/android/README.md)：原生工程已实现，提供 Debug 与正式签名 Release APK，已有核心真机验收记录；[完整技术方案](docs/android/technical-design.md)与[验证状态](docs/android/verification.md)见专题文档，其余专项及商店发布按对应记录确认。
- [系统架构](docs/architecture/system-design.md)：前后端边界、访问路径与部署关系。
- [代码目录规划](docs/architecture/repository-layout.md)：后续应用工程的目录约定。
- [本机上传部署](docs/deployment/local-upload.md)：本机编译、服务器 Docker 更新与最新产物保留。

## 技术基线

| 领域 | 选型 |
| --- | --- |
| 前端 | React 19、TypeScript、Vite 8 |
| Android | Kotlin、Compose、Media3、Room、DataStore；局部 WebView 已接入共享 Three.js 图形 |
| 图形与音频 | Three.js、WebGL 2、Web Audio、HTMLAudioElement、hls.js |
| 后端 | Node.js 24 LTS、Fastify 5、TypeScript |
| 数据 | MySQL 8.0.46、mysql2、Drizzle ORM、Drizzle Kit |
| 工程 | pnpm Workspace、ESLint、Prettier、Vitest、Playwright |
| 发布 | 本机编译上传、Docker、Docker Compose |

版本锁定和兼容性验收要求见[工程环境与依赖](docs/engineering/environment-and-dependencies.md)。

## 工程目录

| 目录 | 用途 |
| --- | --- |
| [apps/web](apps/web/README.md) | 前端应用、图形与音频引擎 |
| [apps/server](apps/server/README.md) | 后端 API、任务和数据库访问 |
| [apps/android](apps/android/README.md) | Android 原生客户端、播放服务与局部图形，使用独立 Gradle 工程构建 |
| [packages/contracts](packages/contracts/README.md) | 前后端共享数据契约 |
| [packages/config](packages/config/README.md) | 共享工程配置 |
| [apps/server/migrations](apps/server/migrations/README.md) | 数据库迁移 |
| [scripts](scripts/README.md) | 开发与运维脚本 |
| [deploy](deploy/README.md) | Docker、Compose 与 Caddy 配置 |
| [apps/web/tests/e2e](apps/web/tests/e2e/README.md) | 浏览器端到端测试 |

前后端、Android 客户端、共享契约、数据迁移和发布工具均已有实现，具体职责及完成范围见各目录说明。

## 本地开发

使用 `.nvmrc` 中的 Node.js 24.22.1 和 `packageManager` 指定的 pnpm 12.5.1。

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Web：`http://127.0.0.1:5173`；API：`http://127.0.0.1:3001/api/v1/health/live`。开发前端通过 `/api` 代理访问后端。单独开发前端前先执行 `pnpm --filter @haen/contracts build`，再运行 `pnpm dev:web`；后端使用 `pnpm dev:server`。

基础开发入口可以不配置数据库，此时目录明确未就绪。完整目录需要准备 MySQL 8.0.46、正确环境库名和分离身份，再按[迁移流程](docs/data/migrations/workflow.md)及[配置文档](docs/operations/configuration-and-logging.md)设置私有环境文件。API、任务、迁移分别显式加载 `.env.local`、`.env.jobs.local`、`.env.migration.local`；文件须被 Git 排除且权限为 600，进程环境优先，修改后重启。

```bash
pnpm db:migrate status
pnpm catalog status
```

先按[完整启动顺序](docs/engineering/clean-checkout.md)完成身份与TLS核对、停写、备份、迁移、地点导入和目录同步，再启动API与任务。迁移和同步会写入显式选择的目标库；开发固定 `ha_radio_dev`，不会回退到正式库。隔离数据库验收使用 `NODE_ENV=test`、专用 `ha_radio_test_<suffix>` 及 `pnpm test:mysql`，详见迁移文档。

```bash
pnpm check
pnpm docs:check
pnpm exec playwright install chromium firefox webkit
pnpm test:e2e
```

`pnpm build` 生成各包 `dist/`；后端编译入口为 `pnpm --filter @haen/server start`，任务为 `start:jobs`。前端已有真实列表、搜索、播放器、地球与流派探索；个人工具、曲目与可选音频增强已接入，本次功能交付完成。三个镜像目标、Compose 与 Caddy 配置已建立，见[构建与运行](docs/deployment/containers/local-and-image-build.md)；Docker 实测按用户要求延后到实际部署环境执行。
