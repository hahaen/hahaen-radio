# MySQL 与 Drizzle Kit 选型归档

日期：2026-10-16。

## 需求

采用适合当前 TypeScript、Drizzle 和 Jenkins 技术栈的数据库与迁移工具，将长期约定同步到项目规则和技术资料。

## 实际变更

- 确定使用 MySQL 8.4 LTS、mysql2、Drizzle ORM 与 Drizzle Kit。
- 更新项目协作规范、技术基线、系统边界、连接池、隔离测试库和部署资料。
- 将数据库专题更名为 MySQL 与 Drizzle，更新链接和目录导航。
- 明确 Drizzle Kit 单一迁移执行、SQL Review、测试后发布、禁用生产 `push` 与独立迁移工具环境。
- 将备份恢复调整为 MySQL 逻辑或服务备份，补充 DDL 隐式提交与失败处理。
- 新增 ADR-0002，保留 ADR-0001 的历史记录并标明数据库决定已被取代。

## 验证记录

- Review 范围：本轮规则与技术文档，重点检查工具分工、方言、权限、迁移材料、备份和发布边界；已修正迁移与服务更新的串行表述，复审无未解决问题。
- 内容与一致性检查：通过；当前生效文档使用 MySQL 方案，旧选型仅保留在标明已被取代的历史决策中。
- 链接与导航：45 份 Markdown、157 个本地链接和完整文档目录树检查通过。
- 格式与范围：`git diff --check` 通过；本轮仅修改规则和文档，原有无关文件保持独立。
- 应用测试、构建与真实 MySQL 验证：不适用，本轮未初始化或修改应用实现，运行能力尚待后续实施。

## 未完成事项

依赖安装、MySQL 实例和账户、连接池、Schema、迁移配置、隔离测试库、备份脚本与 Jenkins 流水线均未创建或执行。

本轮未生成或执行业务 SQL，未连接实际数据库，未发布应用。代码提交和推送结果以本轮 Git 记录为准。

相关资料：[技术选型](../../overview/technology-stack.md)、[架构决策](../../architecture/decisions/0002-mysql-and-drizzle-kit.md)、[迁移流程](../../data/migrations/workflow.md)。
