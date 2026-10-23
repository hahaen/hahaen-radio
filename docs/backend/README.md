# 后端技术文档

可选账号登录与收藏、历史自动同步见[任务记录](../iterations/2026-10-23-account-sync/README.md)，未登录保持本机使用方式。

状态：已实现基础 API、数据库与目录管线、版本分片、电台搜索详情及后台调度。曲目与歌词只读接口已接入；默认关闭的手动识曲已接入，真实服务仍待凭据和额度；有限播放诊断与定期清理已接入，新迁移与权限需随目标环境更新。

| 子目录 | 文档 | 内容 |
| --- | --- | --- |
| `api/` | [接口约定](api/conventions.md) | REST、校验、错误、版本与文档 |
| `api/` | [目录与电台](api/catalog.md) | 清单、分片、搜索、详情、线路和就绪 |
| `api/` | [曲目与歌词](api/tracks.md) | 按线路元数据、歌词匹配、限流和降级 |
| `api/` | [手动识曲](api/recognition.md) | 站点绑定调用、短片段、状态与预算保护 |
| `api/` | [播放诊断](api/diagnostics.md) | 手动精简报告、去重、持久额度与保留边界 |
| `services/` | [服务与外部接入](services/layers-and-integrations.md) | 业务、仓储、配置和适配器边界 |
| `jobs/` | [任务调度](jobs/scheduling.md) | 调度、并发、互斥和失败恢复 |

数据库访问约定见[数据文档](../data/README.md)。返回[文档导航](../README.md)。
