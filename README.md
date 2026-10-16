# hahaen-radio

声屿 HAEN · 嗯，听听世界。

本项目采用 React、TypeScript 和 Three.js 构建浏览器应用，使用 Node.js、Fastify 和 MySQL 提供数据服务，通过 Jenkins 与 Docker Compose 完成构建和部署。

已完成工程初始化、真实目录管线、基础播放与夜航探索，可搜索电台、旋转地球、按流派发现并播放 MP3/AAC/HLS。电台收藏、最近收听、多维筛选、分享与文件迁移也已接入，收听设置、睡眠、快捷键和沉浸基础已接入，曲目与部署配置继续推进；实际状态见[实施进度](docs/product/progress.md)。

## 文档入口

- [项目协作规范](AGENTS.md)：技术基线、开发验证与自动提交规则。
- [完整产品目标](docs/product/README.md)：功能范围、阶段顺序与验收边界。
- [验收矩阵](docs/product/acceptance.md)：实际通过项、未完成项及部署前检查。
- [完整文档导航](docs/README.md)：按主题查找全部技术文档。
- [技术选型](docs/overview/technology-stack.md)：已确定的技术组合与版本策略。
- [系统架构](docs/architecture/system-design.md)：前后端边界、访问路径与部署关系。
- [代码目录规划](docs/architecture/repository-layout.md)：后续应用工程的目录约定。
- [Jenkins 流水线](docs/deployment/jenkins/pipeline.md)：构建、迁移、发布与验收流程。

## 技术基线

| 领域 | 选型 |
| --- | --- |
| 前端 | React 19、TypeScript、Vite 8 |
| 图形与音频 | Three.js、WebGL 2、Web Audio、HTMLAudioElement、hls.js |
| 后端 | Node.js 24 LTS、Fastify 5、TypeScript |
| 数据 | MySQL 8.0.46、mysql2、Drizzle ORM、Drizzle Kit |
| 工程 | pnpm Workspace、ESLint、Prettier、Vitest、Playwright |
| 发布 | Jenkins、Docker、Docker Compose、Caddy 2 |

版本锁定和兼容性验收要求见[工程环境与依赖](docs/engineering/environment-and-dependencies.md)。

## 工程目录

| 目录 | 用途 |
| --- | --- |
| [apps/web](apps/web/README.md) | 前端应用、图形与音频引擎 |
| [apps/server](apps/server/README.md) | 后端 API、任务和数据库访问 |
| [packages/contracts](packages/contracts/README.md) | 前后端共享数据契约 |
| [packages/config](packages/config/README.md) | 共享工程配置 |
| [migrations](migrations/README.md) | 数据库迁移 |
| [scripts](scripts/README.md) | 开发与运维脚本 |
| [deploy](deploy/README.md) | Docker、Compose 与 Caddy 配置 |
| [tests/e2e](tests/e2e/README.md) | 浏览器端到端测试 |

应用入口与工程配置已建立，其余尚未实施的目录继续通过说明文件和 `.gitkeep` 保留。

## 本地开发

使用 `.nvmrc` 中的 Node.js 24.9.0 和 `packageManager` 指定的 pnpm 12.5.1。

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Web：`http://127.0.0.1:5173`；API：`http://127.0.0.1:3001/api/v1/health/live`。开发前端通过 `/api` 代理访问后端。单独开发前端和后端可分别执行 `pnpm dev:web`、`pnpm dev:server`。

基础开发入口可以不配置数据库，此时目录明确未就绪。完整目录需要准备 MySQL 8.0.46、正确环境库名和分离身份，再按[迁移流程](docs/data/migrations/workflow.md)及[配置文档](docs/operations/configuration-and-logging.md)设置私有环境文件。API、任务、迁移分别显式加载 `.env.local`、`.env.jobs.local`、`.env.migration.local`；文件须被 Git 排除且权限为 600，进程环境优先，修改后重启。

```bash
pnpm db:migrate
pnpm catalog sync
pnpm catalog status
pnpm jobs
```

迁移和同步会写入显式选择的目标库；开发固定 `ha_radio_dev`，不会回退到正式库。隔离数据库验收使用 `NODE_ENV=test`、专用 `ha_radio_test_<suffix>` 及 `pnpm test:mysql`，详见迁移文档。

```bash
pnpm check
pnpm docs:check
pnpm exec playwright install chromium firefox webkit
pnpm test:e2e
```

`pnpm build` 生成各包 `dist/`；后端编译入口为 `pnpm --filter @haen/server start`，任务为 `start:jobs`。前端已有真实列表、搜索、播放器、地球与流派探索；个人工具已接入，曲目和音频增强继续推进。Docker 实测按用户要求延后到实际部署环境执行。
