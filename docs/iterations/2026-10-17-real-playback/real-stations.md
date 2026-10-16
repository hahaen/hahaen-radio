# 真实电台媒体观测

观测时间（UTC）：2026-10-16T18:01:11.164Z；Chromium 156.0.8078.4，macOS 本机网络，浏览器直接访问音源。

从真实开发目录选择 10 个独立电台 ID，通过正式页面搜索、选台并固定当前台，以免自动恢复替换被测对象。未拦截 API 或媒体请求，音量预先调低。

| 电台 | UUID | 声明编码 | 结果 | 耗时 |
| --- | --- | --- | --- | --- |
| SomaFM Groove Salad - EE. UU (Ambient/Downtempo) | `0596bdc5-77fc-48ba-8653-e5e34bb86568` | MP3 | 未播放；后续原生媒体诊断见下文 | 2.2s |
| Radio Paradise World/Etc Mix 320k AAC | `21a282be-44f4-4b8e-aae9-b4c2041af4a5` | AAC | 媒体进入 playing，进度持续推进，error 为空 | 3.3s |
| FIP Groove (hifi.aac) | `0bb104c7-ef0a-4082-9250-148eb4df3edc` | AAC | 媒体进入 playing，进度持续推进，error 为空 | 3.5s |
| Rire & Chansons Les Interdits | `03942869-374f-46bb-9c23-292000002368` | MP3 | 媒体进入 playing，进度持续推进，error 为空 | 5.2s |
| Jazz ／ Radio Swiss | `2037c9d4-8d99-48f1-b5f1-eb60dc015773` | MP3 | 媒体进入 playing，进度持续推进，error 为空 | 6s |
| KEXP 90.3 FM Seattle | `0e2a1095-d9a3-4453-ab97-f8c640d61349` | AAC | 媒体进入 playing，进度持续推进，error 为空 | 5s |
| Radio Feon'ny Filazantsara | `0060ae50-b810-4245-9a93-5365a03e0e0b` | MP3 | 媒体进入 playing，进度持续推进，error 为空 | 3.6s |
| BBC World Service | `598c4d0e-6b06-43fb-bff4-717c591213a9` | MP3 | 媒体进入 playing，进度持续推进，error 为空 | 4.1s |
| radio swiss classic | `0701c9cd-5dba-4101-b060-775f7889e33a` | AAC | 媒体进入 playing，进度持续推进，error 为空 | 4.5s |
| Jazz24 | `1d730b8a-49e2-403d-870c-07b1e27be7fd` | AAC | 媒体进入 playing，进度持续推进，error 为空 | 3.5s |

本轮 9 台进入真实媒体播放，1 台失败。每台都核对选中名称保持一致；playing 后继续观测约 0.8 秒，确认时间增加且媒体未暂停、无媒体错误。这些短时样本不代表长期稳定性或所有网络均可用。

失败台为 SomaFM Groove Salad 的一条 MP3 记录。进一步使用浏览器原生 audio 隔离验证，媒体请求返回 HTTP 403、Content-Type 为 text/html，play 拒绝为 NotSupportedError、MediaError.code 为 4；相同地址的服务端只读探测返回 200/audio/mpeg。因此不能把服务端可达视为浏览器可播，也不能将该结果简单归因于 MP3 编码能力。当前保留失败与重试入口，不增加全量音频代理。

切台期间观察到请求取消，未将这些取消事件算作新电台的网络故障。本文不保存原始流地址、请求头、Cookie 或访问参数。

验收范围是浏览器真实媒体处理与 UI 行为；未声称实际扬声器输出、Android/iOS 真机、锁屏或后台中断已验证。可控 MP3/AAC/HLS 结果另见[阶段归档](README.md)。
