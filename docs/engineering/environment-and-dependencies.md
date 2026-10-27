# 工程环境与依赖

## 环境基线

| 环境 | 约定 |
| --- | --- |
| 本地开发 | Node.js 24 LTS、固定 pnpm 版本 |
| Jenkins 构建 | 与项目一致的 Node.js 和 pnpm，优先在 Linux 构建镜像内执行 |
| 生产 | Node.js 24、Debian slim 容器 |
| 浏览器 | 主流桌面和移动浏览器，实际最低版本待验收冻结 |

## 版本冻结

初始化时固定 Node.js 补丁版本、pnpm 版本和直接依赖的具体版本，提交单一锁文件，通过 `packageManager` 和运行环境声明保持一致。

先验证主版本兼容，再冻结版本。尤其检查 TypeScript 与 ESLint 工具链、React 与组件库、Vite 与插件、Fastify 与 Zod/OpenAPI 插件、Drizzle 与驱动、Three.js 与类型声明。

依赖升级单独进行，记录必要的兼容调整；不在发布时临时安装浮动的最新版本。

## 工作区和构建

使用 pnpm Workspace。共享契约包明确导出路径，后端及其共享依赖在构建阶段编译，生产镜像不依赖 TypeScript 源码的临时解释运行。

ES Modules 的包类型、模块解析方式和输出扩展名保持一致。前端公开配置在构建时写入，变更这类配置需要重建前端。

依赖在匹配生产目标架构的容器内安装，不从开发机复制 `node_modules`。后端使用 mysql2 连接 MySQL；迁移工具镜像单独保留固定版本的 Drizzle Kit 及配置、SQL 和元数据。数据库凭据运行时注入，API 生产镜像无需为了迁移而保留全部开发依赖。

## 本地 IDE 配置

IntelliJ IDEA 会在项目根目录生成 `.idea/`，保存模块映射、版本控制关联和工作区等本地配置。该目录由根 `.gitignore` 的 `/.idea/` 规则统一忽略，保留本地文件供 IDE 使用，不纳入提交。

2026-10-16 处理记录：IDEA 提交面板出现 5 个“未进行版本管理”的配置文件，原因是 `.idea/` 尚未被项目忽略。新增上述规则后，使用 `git check-ignore -v` 检查这 5 个文件均命中规则，使用 `git status --short --untracked-files=all` 确认它们不再列为未跟踪文件，并确认没有已跟踪的 `.idea/` 文件。此次仅调整 Git 忽略规则和文档，无需应用构建或数据库操作；IDEA 界面实际刷新结果待确认，若仍显示旧列表，可点击提交面板的刷新按钮。

## 命令约定

以下命令已建立，具体执行结果见产品验收矩阵。代码与配置由 Prettier 检查，文档通过 `pnpm docs:check` 核对本地链接与目录。

| 命令 | 职责 |
| --- | --- |
| `pnpm dev` | 启动本地开发入口 |
| `pnpm lint` | 静态检查 |
| `pnpm format:check` | 格式检查 |
| `pnpm typecheck` | 工作区类型检查 |
| `pnpm test` | 必要单元、组件和集成测试 |
| `pnpm test:e2e` | 浏览器端到端测试 |
| `pnpm build` | 按依赖顺序构建所有产物 |
| `pnpm db:generate` / `pnpm db:migrate` | 生成和执行受控迁移 |
| `pnpm catalog sync` / `pnpm catalog status` | 手动同步及目录状态 |
| `pnpm jobs` | 独立 UTC 调度进程 |
| `pnpm test:mysql` | 建立独立 MySQL 测试库、迁移升级与仓储验收并清理 |

CI 安装使用 `pnpm install --frozen-lockfile`。数据库命令的配置和权限前提见[迁移流程](../data/migrations/workflow.md)，备份与恢复入口已实现，使用范围和身份见[备份文档](../data/backup/backup-and-restore.md)。从空工作目录到真实目录的完整顺序见[干净检出](clean-checkout.md)。

## 初始化完成条件

全新环境能够从锁文件安装，通过检查与生产构建；生产容器能启动并连接隔离 MySQL 8.0.46，迁移工具入口可执行已审核迁移；React 开发生命周期和共享包导入正常。结果需要实际记录后才能标记已验证。

返回[工程导航](README.md)。

## 当前固定组合

当前工程固定 Node.js 24.22.1、pnpm 12.5.1、TypeScript 6.0.3、ESLint 10.12.0 与 typescript-eslint 8.71.2；前端使用 React 19.3.1、Vite 8.3.4，后端使用 Fastify 5.12.7、Zod 4.6.7 和 fastify-type-provider-zod 7.0.0。所有实际直接依赖以各包清单和锁文件为准。

pnpm 配置集中在 `pnpm-workspace.yaml`，启用严格引擎与 Peer 检查，保留至少一天的发布冷却时间，当前仅允许 esbuild 执行依赖构建脚本。没有降低检查或批量放行未知脚本。

2026-10-27 将传递依赖 `fast-uri` 的 3.x、4.x 分支分别锁定到 3.1.9、4.2.3，修复 URI 解析与规范化安全问题；保留各上游依赖要求的主版本，不新增直接依赖或覆盖规则。修复内容见上游 [3.1.9](https://github.com/fastify/fast-uri/releases/tag/v3.1.9)、[4.2.3](https://github.com/fastify/fast-uri/releases/tag/v4.2.3) 发布说明。

本机尚无 Docker。2026-10-17 用户明确允许本机跳过镜像构建及容器实测，待真正部署时验证；部署配置仍须实现，未执行检查必须作为待验收事项保留。

## 播放器依赖

阶段 3 固定 hls.js 1.7.3、Zustand 5.0.15 和 lucide-react 1.57.0，使用已发布超过冷却期的正式版本。HLS 在原生支持时不加载 JavaScript 实现，其他浏览器按需动态加载；测试媒体已随仓库提供，不把 FFmpeg 二进制作为产品依赖。

## 探索界面依赖

阶段 4 固定 three 0.186.1、@types/three 0.186.0 和 idb 8.0.4。Three.js 仅在图形场景初始化时加载，HLS 保持独立按需加载；较大的图形与 HLS 分块仍有 Vite 500kB 原始大小提示，保留提示并继续在性能阶段测量。字体随静态资源本地分发，日常安装与构建不下载字体；更新步骤见[字体说明](../frontend/design/fonts.md)。
