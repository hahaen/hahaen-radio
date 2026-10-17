# 部署与发布脚本

本目录按运行职责集中管理发布工具；所有入口从仓库根执行，真实凭据及运行材料继续存放在受控配置与被 Git 排除的私有目录。

| 路径 | 用途 |
| --- | --- |
| `release/pipeline.mjs` | 固定提交镜像构建、隔离镜像验收与人工分发入口，由根 Jenkinsfile 调用 |
| `release/handoff.mjs` | 同任务跨节点交接、目标准备及材料验收 |
| `release/common.mjs`、`release/images.mjs`、`release/smoke.mjs`、`release/seed.mjs` | 公共校验、迁移清单、镜像检查及隔离样例工具 |
| `target.mjs`、`flow.mjs` | 目标发布执行器与步骤状态管理，由后端受控运维入口调用 |
| `runtime-logs.mjs` | 发布与恢复时的运行日志探测 |

根目录命令继续使用 `pnpm deploy:target`；直接镜像入口为 `node deploy/scripts/release/pipeline.mjs build|test-images|publish`。这些入口可能操作实际运行环境，只按已授权目标和发布流程执行。

部署回归测试位于 [tests](../tests/README.md)。流程与边界见[流水线](../../docs/deployment/jenkins/pipeline.md)、[目标执行器](../../docs/deployment/releases/target-executor.md)和[部署导航](../README.md)。
