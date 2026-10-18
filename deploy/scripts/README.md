# 部署与发布脚本

本目录按运行职责集中管理发布工具；所有入口从仓库根执行，真实凭据及运行材料继续存放在受控配置与被 Git 排除的私有目录。

| 路径 | 用途 |
| --- | --- |
| `component-release.mjs`、`component-plan.mjs` | 三个日常任务的独立本机构建、交接和目标只读预检 |
| `release/source-selection.mjs`、`release/target-plan.mjs` | 固定所选分支的实际提交、只读判断数据库变更确认 |
| `release/handoff.mjs` | 同任务跨节点交接、目标准备及材料验收 |
| `release/common.mjs`、`release/images.mjs`、`release/smoke.mjs`、`release/seed.mjs` | 公共校验、迁移清单、镜像检查及隔离样例工具 |
| `target.mjs`、`component-target.mjs`、`component-state.mjs` | 配置校验、组件发布执行器与独立版本状态管理，由后端受控运维入口调用 |
| `local-images.mjs` | 绑定本地引擎与镜像 ID，成功后仅保留当前版本和结构工具，清理本次明确淘汰的旧产物 |
| `static-web.mjs` | 验证并提取不可变前端产物、校验保留版本、原子发布静态目录 |
| `runtime-logs.mjs` | 发布与恢复时的运行日志探测 |
| `public-check.mjs` | 经公网入口核对当前页面、静态资源、就绪和目录接口 |
| `workspace-cleanup.mjs` | 只读预检通过后清理同一串行任务更早构建的目标工作区，跳过当前/未来构建、其他任务及符号链接 |

根目录命令继续使用 `pnpm deploy:target`；历史隔离验收工具仍保留，直接镜像入口为 `node deploy/scripts/release/pipeline.mjs build|test-images|publish`。这些入口可能操作实际运行环境，只按已授权目标和发布流程执行。

部署回归测试位于 [tests](../tests/README.md)。流程与边界见[流水线](../../docs/deployment/jenkins/pipeline.md)、[目标执行器](../../docs/deployment/releases/target-executor.md)和[部署导航](../README.md)。
