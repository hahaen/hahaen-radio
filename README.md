# hahaen-radio

声屿 HAEN · 嗯，听听世界。

本项目采用 React、TypeScript 和 Three.js 构建浏览器应用，使用 Node.js、Fastify 和 MySQL 提供数据服务，通过 Jenkins 与 Docker Compose 完成构建和部署。

目前已完成技术方案、分类文档与工程目录骨架，应用依赖、可运行入口、数据库和部署配置尚未初始化；以下文档描述技术基线，不代表服务已经实现或部署。

## 文档入口

- [项目协作规范](AGENTS.md)：技术基线、开发验证与自动提交规则。
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

当前目录通过说明文件和 `.gitkeep` 保留；后续初始化具体文件时可移除不再需要的占位文件。
