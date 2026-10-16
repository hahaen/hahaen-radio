# hahaen-radio

声屿 HAEN · 嗯，听听世界。

本项目采用 React、TypeScript 和 Three.js 构建浏览器应用，使用 Node.js、Fastify 和 SQLite 提供数据服务，通过 Jenkins 与 Docker Compose 完成构建和部署。

目前处于技术方案确定阶段，仓库尚未初始化应用工程；以下文档描述拟实施的技术基线，不代表服务已经实现或部署。

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
| 数据 | SQLite、better-sqlite3、Drizzle ORM、Drizzle Kit |
| 工程 | pnpm Workspace、ESLint、Prettier、Vitest、Playwright |
| 发布 | Jenkins、Docker、Docker Compose、Caddy 2 |

版本锁定和兼容性验收要求见[工程环境与依赖](docs/engineering/environment-and-dependencies.md)。
