# 播放诊断与受控维护

诊断不建立账号、访客标识、原始 IP 或任意日志库。仅用户主动提交当前线路的固定故障，资料仍属未核实报告，不影响目录同步和电台状态。

## 运行与迁移

新增 `0002_playback_diagnostics.sql` 建立 diagnostic_limits 与 playback_reports、索引、CHECK 约束、显式表选项及单例初始行。Drizzle Schema、生成 SQL 和元数据同步版本化；不在启动时自动建表或补写丢失的额度行。

当前新迁移已在隔离 MySQL 8.0.46 临时库验证，并在开发库执行；开发库三条迁移、11 表及 API/任务所需新增表权限已具备，正式库未执行，见[收尾记录](../iterations/2026-10-17-goal-completion/README.md)。目标环境应先按[迁移流程](../data/migrations/workflow.md)审核 SQL、停写、完成一致性备份并执行迁移，再配置最小权限，随后更新 API/任务和 Web。旧 API 缺少报告入口时，新 Web 保留本地说明与基础收听；原有识曲能力契约未改变。

| 身份 | 新表权限 |
| --- | --- |
| API | playback_reports 的 SELECT、INSERT、UPDATE、DELETE；diagnostic_limits 的 SELECT、UPDATE |
| 任务与诊断工具 | playback_reports 的 SELECT、DELETE |
| 迁移 | 目标库的受控 DDL、初始化写入及工具所需权限，不能复用普通运行身份 |

不授予运行身份建库、改表或重置额度能力。库名仍由服务端配置显式校验，开发不回退正式库。

## 查看与清理

仓库根命令均显式加载服务端 `.env.jobs.local`，凭据文件先确认排除且权限 600：

```sh
pnpm diagnostics summary
pnpm diagnostics cleanup
```

summary 只读输出尚未到期的电台/线路/故障分组，最多 20 组，包含数量与最近时间；没有公开读取报告的 HTTP 接口。cleanup 只删到期记录，重复执行安全，不清零额度。编译入口为服务端工作目录的 `node dist/entrypoints/diagnostics.js summary` 或 cleanup，生产变量通过运行环境显式注入。

任务进程启动时清理一次，另按 UTC `0 * * * *` 独立调度；不会等待每日目录同步成功才清理。当前进程不重叠运行同类清理，关闭会等待进行中的清理。普通输出只有固定事件与移除数，异常不打印 SQL、凭据或报告正文。

## 数据边界与恢复

日报额度使用数据库 UTC 日与锁定单例行；同一事务更新回执与次数，失败回滚。有效回执重试不新增记录，不重复扣次。每天最多 1000 条，存储最多 10000 槽，即使清理任务停止也不会无限增长；容量满时可按槽位顺序提前替换旧记录。报告有效期 7 天，摘要立即过滤到期记录，物理清理由提交和独立任务完成，停机时会延后。

短时全局 20 次/分钟、单一在途与同线路/故障冷却属于进程保护；免登录站点的用户共享这些容量。重启不恢复已使用的当日持久额度，不通过删除单例行或重复迁移刷新计数。单例缺失、结构未迁移或权限不足时报告不可用；数据库时钟回退到已记录日期之前时失败关闭，核对时钟而非清零计数。

架构理由见[额度与容量决策](../architecture/decisions/0005-bounded-playback-diagnostics.md)，接口见[诊断 API](../backend/api/diagnostics.md)。返回[运维导航](README.md)。
