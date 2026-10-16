# 曲目与歌词 API

所有接口位于 `/api/v1`，使用共享 Zod 契约和 OpenAPI。新增能力不改变目录结构，不新增数据库表、迁移或凭据。API 发布后再发布 Web；旧服务缺少接口时，前端提示不可读取，基础播放继续。

## 正在收听的曲目

`GET /stations/:id/now-playing?streamId=<24位小写十六进制ID>`

只接受电台 UUID 与目录中属于该台的线路 ID，不接受远程 URL。每次查询先检查当前目录及屏蔽状态，再复用线路缓存；失效电台或线路为 404，目录未就绪为 503。

响应字段：`stationId`、`streamId`、`status`、`source=station-icy`、`observedAt`、`rawTitle`、可空的 `song`、`timing=unknown`、`retryAfter`。状态为 `available/unavailable/error/busy`。仅常规“歌手 - 曲名”文字可形成歌曲身份；无法可靠拆分时保留原文。元数据也可能描述节目或广告，不能表示为识曲结果。

服务端最多按需读取 6 秒、512KiB；ICY 间隔不超过 256KiB，元数据块不超过 4080 字节。取得标题后立即关闭，不存储音频。HLS 及没有兼容 ICY 元数据的线路返回不可读取，不猜测歌曲。浏览器音频仍直连源站。

相同线路请求合并；最多 4 个并行短读，令牌容量 8，每 2 秒补充 1 个。缓存最多 256 项：有文字 15 秒、无文字 60 秒、失败 30 秒。只在客户端实际 playing 时轮询，后台受浏览器节流约束；暂停、换台、换线路及卸载会取消客户端请求；已共享的服务端短读受自身截止时间约束。

远程访问继承 HTTPS、系统信任证书、全部 DNS 地址公有性校验、地址固定与每次重定向复核，最多 3 次重定向，不转发浏览器 Cookie 或授权头。

## 歌词

`GET /lyrics?artist=<歌手>&title=<曲名>`

两个字段均需去除首尾空白后为非空，最多 512 字符。固定访问 LRCLIB 搜索接口；返回 `source=lrclib`、`status`、最多 8 个 `items` 和可空 `retryAfter`。状态为 `found/not-found/unavailable/busy/rate-limited`。

仅保留歌手与曲名在大小写、Unicode 兼容规范化和空白处理后一致的版本。每项包含 ID、歌手、曲名、专辑、时长、纯音乐标记、纯文本及解析后的时间行；时间行最多 2000 条并共享 64KiB 文本预算，避免重复时间戳放大响应。不执行 HTML、YAML 或外部内容。多个版本交由用户选择，歌词时长不当作直播进度。

上游请求限制 7 秒、1MiB；同一歌曲合并。全局一次只发一个请求，完成后至少间隔 500ms，超量返回繁忙状态；429 根据 `Retry-After` 建立全局冷却，不依赖错误页格式。成功缓存 24 小时、未匹配 10 分钟、普通错误 30 秒；缓存最多 128 项、8MiB。前端只有用户点击查询或重试才访问，不扫描歌曲清单。

客户端标识为 `HAEN/0.1` 与本项目地址，不使用私密凭据。页面保留 LRCLIB 来源；服务条件在部署验收时再次核对。实现依据 [LRCLIB 官方 API 文档](https://lrclib.net/docs)及 [Icecast 协议实现](https://github.com/xiph/Icecast-Server/blob/master/src/format_mp3.c)，核对日期为 2026-10-17；不从未确认的服务能力推断歌曲位置。

返回[后端导航](../README.md)或[前端曲目交互](../../frontend/application/tracks-and-lyrics.md)。
