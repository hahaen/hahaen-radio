# hahaen-radio

声屿 HAEN · 嗯，听听世界。

本项目采用 React、TypeScript 和 Three.js 构建浏览器应用，使用 Node.js、Fastify 和 MySQL 提供数据服务，通过 Jenkins 与 Docker Compose 完成构建和部署。

工程初始化已完成，已有工作区、前后端入口、共享契约和检查脚本。目录数据、真实播放、完整探索界面和部署配置仍待逐阶段完成；实际状态见[实施进度](docs/product/progress.md)。

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

服务端可选配置复制 `.env.example` 为被本地排除的 `.env.local`，权限设为 `600`；`dev` 与 `start` 命令显式使用 Node.js `--env-file-if-exists=../../.env.local` 加载。现有进程环境优先于环境文件；修改环境文件后重启进程。当前默认只监听本机，生产环境的公开监听地址应显式配置。

```bash
pnpm check
pnpm docs:check
pnpm exec playwright install chromium firefox webkit
pnpm test:e2e
```

`pnpm build` 生成各包 `dist/`；后端生产入口为 `pnpm --filter @haen/server start`。此阶段只有基础入口，不代表电台目录与播放已完成。Docker 实测按用户要求延后到实际部署环境执行。
