# 架构决策记录

记录会影响多个模块或部署方式的长期决定。已确定的技术调整应新增决策记录，并注明取代了哪条记录。

| 编号 | 决策 | 状态 |
| --- | --- | --- |
| ADR-0001 | [技术栈、单仓库与单机部署](0001-stack-and-deployment.md) | 数据库部分由 ADR-0002 取代，Web 入口由 ADR-0006 修订，其余继续适用 |
| ADR-0002 | [MySQL 与 Drizzle Kit](0002-mysql-and-drizzle-kit.md) | 版本及字符配置由 ADR-0003 修订，其余适用 |
| ADR-0003 | [建表选项与实际目标环境](0003-table-options-and-target-environment.md) | 元数据已核对，规范已确定，应用待实施 |
| ADR-0004 | [识曲采用显式预算与持久化预扣](0004-recognition-allowance.md) | 单实例运维状态与可控验证已接入，真实服务待授权条件 |
| ADR-0005 | [匿名诊断采用事务额度与固定容量](0005-bounded-playback-diagnostics.md) | 实现已接入，适用验收见任务记录 |

| ADR-0006 | [复用共享 Nginx 发布静态前端](0006-shared-nginx-static-release.md) | 已按用户调整实现，验收见正式部署记录 |

## 记录格式

每条记录包含背景、决定、约束、影响、验证状态和调整触发条件。区分设计决定与运行证据，不将未验证的兼容性写成已通过。

返回[架构导航](../README.md)或[文档导航](../../README.md)。
