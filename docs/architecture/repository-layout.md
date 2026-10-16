# 仓库目录规划

状态：前后端、共享包、迁移、脚本、部署和端到端测试目录骨架已建立。应用入口、工作区配置、依赖、流水线和运行配置尚未初始化。

## 顶层结构

```text
hahaen-radio/
├── apps/
│   ├── web/
│   │   ├── src/
│   │   │   ├── app/          应用入口、路由、全局 Provider
│   │   │   ├── components/   共用界面组件
│   │   │   ├── features/     按业务模块归属的代码
│   │   │   ├── engines/
│   │   │   │   ├── graphics/ Three.js 场景和资源管理
│   │   │   │   └── audio/    音频引擎和播放适配
│   │   │   ├── services/     HTTP 客户端和数据查询
│   │   │   ├── stores/       客户端状态
│   │   │   ├── workers/      浏览器计算任务
│   │   │   ├── locales/      国际化文案
│   │   │   └── styles/       设计变量和全局样式
│   │   └── public/           不经打包转换的公开资源
│   └── server/
│       └── src/
│           ├── entrypoints/  API、任务、迁移等进程入口
│           ├── plugins/      Fastify 基础设施插件
│           ├── modules/      路由、业务服务和数据仓储
│           ├── integrations/ 外部服务适配器
│           ├── jobs/         任务实现、调度和互斥
│           ├── db/           Schema、连接与数据库配置
│           └── config/       环境变量校验
├── packages/
│   ├── contracts/
│   │   └── src/              共享 DTO、Schema 和错误码
│   └── config/               TypeScript、Lint 等共享配置
├── migrations/               版本化 SQL 和迁移元数据
├── scripts/                  工程和运维脚本
├── deploy/
│   ├── docker/               Dockerfile 和构建辅助文件
│   ├── compose/              Compose 配置
│   └── caddy/                Web 入口配置
├── tests/e2e/                浏览器验收测试
├── docs/                     技术文档
├── Jenkinsfile               发布流水线入口
├── package.json
├── pnpm-workspace.yaml
└── pnpm-lock.yaml
```

上述目录已通过说明文件或 `.gitkeep` 纳入版本管理。树中的 `Jenkinsfile`、`package.json`、`pnpm-workspace.yaml` 和 `pnpm-lock.yaml` 为后续初始化目标，当前尚未创建。说明文件和占位文件未在树中逐项展开。

`packages/contracts/src` 已预留共享契约源码目录；`packages/config` 的具体配置文件在工具链初始化时创建。具体业务模块名称待需求确定后建立。

## 包边界

- `web` 和 `server` 可以依赖 `contracts`；`contracts` 不反向依赖应用。
- `contracts` 不导入数据库驱动、后端环境变量、Node.js 专用模块或私密配置。
- 数据库实体不直接作为对外 API 返回类型，返回值通过契约映射。
- `config` 提供工程配置，不承载业务代码。
- 共用源码以工作区包显式导出；生产前编译后端及其依赖包，检查 ESM 导入路径和扩展名解析。

## 文件归属

单元测试优先靠近被测模块；端到端测试集中管理。生产数据库、备份、日志和真实环境变量位于服务器运行目录，独立于仓库与构建产物。

文档目录以[总导航](../README.md)为准。返回[架构导航](README.md)。
