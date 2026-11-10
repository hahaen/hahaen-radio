# LINUX DO 纯前端微应用与公开目录快照

日期：2026-11-10。

## 首版需求与实现

- 首版采用独立的纯前端目录，现已迁入共享前端。按影响范围检查和更新产物，应用 ID 放在 Git 忽略的本地文件中，正式上架由用户操作。
- 应用页眉、浏览器标签、包清单和各语言的标题统一使用「声屿 HAEN」。平台名称用于开发和提审说明。
- 仓库根 README 末尾新增 LinuxDo 社区入口。[友情链接](../../../README.md#友情链接)
- 从当前已发布的公开场景目录只读导出 73 个分片，共 72,088 条电台。版本为 `0e6e045d-d9e2-42bd-9d5f-1ee29f76ef6c`，导出时间为 `2026-11-10T08:35:43.969Z`。包内目录和地图通过 SDK 读取，目录、详情、搜索、分类、语言、同城和随机选台在本机计算。收藏使用 SDK 浏览器存储。
- 站内直播使用 `sdk.http.stream()` 读取固定 MP3 端点，经 WebCodecs 解码、Web Audio 输出。沙箱候选和正式可播范围分开，发布包只纳入已经记录桌面和手机沙箱验收的电台。

## 首版验证与待办

- 本地验证包通过官方 SDK 打包检查。用 Chromium 桌面和 WebKit 手机视口在禁用音频的隔离 iframe 中检查打包产物的目录读取、搜索、收藏、可播筛选、分页和布局。应用 ID 尚未填写。已核对本地配置与构建 ZIP 的 Git 忽略状态。
- 当前直播名单为空，尚无同时具备第三方授权和 LINUX DO 沙箱出声证据的音源。按用户要求未执行声音测试。真实沙箱仍需填写应用 ID、准备授权音源、批准 SDK 权限并检查桌面及手机的播放、停止与切台。
- 本次范围是微应用代码、包内目录与协作规范。无需更新前端静态站点、`radio-api`、`radio-jobs`、Android 或数据库。

## 官网与微应用共用源码

- 官网和 LINUX DO 微应用在 `apps/web` 共用 React 界面、Three.js 地球、目录筛选、收藏和播放控制。微应用入口和 SDK 适配在 `apps/web/linuxdo`，旧独立应用目录已删除。原快照未重新导出，文件内容一致，仍为 72,088 条。该快照没有精确城市字段，微应用明确标示附近城市并支持按此筛选。
- 官网产物位于 `apps/web/dist`。微应用 ZIP 位于 `apps/web/linuxdo/dist`，不随官网发布。打包脚本从仓库根目录的 `.env.local.linuxdo` 读取应用 ID。配置文件和 ZIP 均由 Git 忽略。已核对缺少 ID 时的打包提示及本地核验 ZIP。
- 官网通过生产路径构建、资源预算和三个无声搜索回归检查。微应用 ZIP 通过官方 SDK 打包和隔离 iframe 检查，覆盖桌面 Chromium 和手机 WebKit 的目录、地图资源、搜索、筛选、附近城市、收藏迁移、随机选台及当前页面没有外部跳转。隔离检查屏蔽音频和外网请求。
- 应用 ID 未填写、已验证直播名单为空。本次没有测试声音，没有进入真实沙箱或正式上架。网站使用前端独立发布；API、后台任务、Android 和数据库无需更新。根 README 的 LinuxDo 友情链接保留。

## 改为在线复用官网目录

- 现有 `radio-api` 增加三个只读 SDK 端点，复用官网目录的清单、分片与电台详情查询。跨域权限限于 `https://linux.do`。微应用从 API 下载目录，继续使用共享前端筛选和搜索。ZIP 保留地图和试听配置，移除静态目录。
- 沙箱加入 Radio Paradise 主频道候选，实时核对官网目录中的同频道来源，再使用运营方提供的 MP3 端点。实测该端点返回 `audio/mpeg` 和允许论坛来源的跨域响应头。本地 Chromium 桌面与 WebKit 手机视口以现场短样本验证非静音音频的解码、调度和停止。真实 LINUX DO 沙箱中的权限与出声仍待验收。
- 这次交付需要更新 `radio-api` 并重新生成沙箱 ZIP。微应用正式上架仍由用户操作。

## 恢复包内目录，移除运行时后台依赖

- 用户要求 LINUX DO 微应用运行时不调用声屿的任何后台。维护者只在发布前从官网公开接口导出目录。2026-11-10T14:21:50.833Z 导出的目录版本为 `0e6e045d-d9e2-42bd-9d5f-1ee29f76ef6c`，包含 72,088 条电台及 542 条公开时区记录。
- ZIP 随附目录和地图，使用 SDK 本地读取。详情、搜索、筛选、同城、随机选台和收藏查询都基于快照。包内可播清单独立维护，网络清单只声明 Radio Paradise 的直播端点。微应用继续使用访客模式，收藏和设置留在 SDK 应用存储。
- Chromium 桌面与 WebKit 手机视口已用实际快照验证目录交互和收藏，在隔离测试中未产生 SDK 普通 HTTP 请求或浏览器外网请求。沙箱包保留 Radio Paradise 试听候选，实际出声仍待 LINUX DO 沙箱验收。仅更新微应用 ZIP，无需更新官网、API、后台任务、Android 或数据库。

## 缩小沙箱 ZIP

- 管理页的上传上限为 4096 KiB。打包时将目录按地区和名称归组，再按字段排列，让 ZIP 更容易压缩相近的内容。微应用读出后恢复原始记录与顺序。打包检查最终 ZIP 的大小，超限时保留上次输出。
- 沙箱 ZIP 从 5,023,343 字节降到 3,953,256 字节。检查包解码后与原始快照逐项一致，完整保留 72,088 条电台和 542 条时区记录。地图文件及试听源仍随包提供。桌面 Chromium、手机 WebKit 视口的无声隔离验证通过，ZIP 完整性检查通过。仅需更新微应用 ZIP。

## 生成 0.1.0 正式候选包

- 2026-11-10 用户确认 LINUX DO 沙箱测试通过。依据该反馈将 Radio Paradise 主频道纳入正式可播名单，正式包内显示「播放」。
- 正式候选 ZIP 为 3,953,257 字节，低于 4096 KiB，目录和地图与验收沙箱包一致。正式 ZIP 通过 Chromium 桌面和 WebKit 手机视口的无声隔离检查。正式发布由用户在 LINUX DO 管理页操作，无需更新声屿线上服务。

## 固定正式包交付规则

- 用户要求每次更新微应用产物时默认生成正式候选 ZIP。根规范记录交付要求和影响范围，微应用专用规范汇总运行边界、目录与音源验收规则及构建路径。待验收的音源通过单独的沙箱包验证。正式候选包只包含已经通过验收的音源。
- 本次更新协作规则和打包说明，使用文档链接与差异检查验证。

## 独立管理微应用版本

- 微应用使用自己的 `version.json`。实际发布内容变化并交付正式候选包时，补丁版本加 1。同一次交付的检查、沙箱和正式包复用版本。
- 本次只调整版本来源、交付规则和核验脚本。版本文件沿用现有正式包的 `0.1.0`，不重打 ZIP。核对现有 ZIP 的版本与配置一致。

## 批量筛选官网音源

2026-11-10 22:46（北京时间），核对线上目录版本 `0e6e045d-d9e2-42bd-9d5f-1ee29f76ef6c` 和限制版本后，按官网默认搜索的可播范围查询全部 **40,962** 条详情，共 410 批。线上场景元数据的 42,581 条包含官网搜索排除的宗教分类，72,088 条是完整目录。可播统计采用官网搜索的状态口径。

| 当前状态 | 官网目录条目数 |
| --- | ---: |
| 匹配已核对的运营方和频道，合并为 5 个实际频道 | 17 |
| 有直接 MP3 地址，待核对第三方使用依据及连通性 | 25,983 |
| 只有其他已知格式，待确认可用的 MP3 或适配格式，并核对使用依据 | 13,929 |
| 格式未知，待确认格式和使用依据 | 35 |
| 只有已知限制第三方嵌入的来源 | 882 |
| 官网标注 MP3，但地址含疑似临时参数或其他需审查的部分 | 116 |

官网数据标注的格式可以交叉计数。26,898 条标注 MP3，5,248 条标注 AAC、5,175 条标注 AAC+，3,221 条标注 HLS。按地址排除疑似带凭据的记录后，26,782 条有至少一个 MP3 地址，按 URL 去重为 22,607 个。SomaFM 和 laut.fm 分别有 143 和 739 条触及第三方嵌入限制。[SomaFM 使用条款](https://somafm.com/legal/tos.html) · [laut.fm 使用条款](https://laut.fm/pages/terms_and_conditions)

Radio Paradise 为外部播放器公开了频道和编码选项，Radio Sausalito 公布了外部播放器连接方式及 StreamGuys 供应关系。核对后，合并 12 条同频道重复记录，保留 5 个频道。旧 World/Etc 与现 Global 使用同一频道，运营方的直播响应标识一致。Radio Sausalito 的旧入口重定向到 HTTP，预检改用官网目录中已核对身份的 StreamGuys HTTPS 端点。[Radio Paradise 外部播放器连接](https://radioparadise.com/listen/stream-links) · [Radio Sausalito 直播说明](https://radiosausalito.org/listen/stream/)

5 个频道都通过了带 `Origin: https://linux.do` 的 HTTPS 连接预检。预检确认直接返回 `200`、`audio/mpeg`、允许该来源的 CORS 响应头及非空数据。只预检经过依据审核的地址，其余电台的连接和 CORS 状态仍待验证。Radio Paradise 主频道继续留在正式名单，Mellow、Rock、Global 和 Radio Sausalito 进入沙箱待验收名单。

即使暂时假定这 22,607 个 MP3 地址都符合其他条件，仅用短端点名生成的模拟声明已达 2,442,026 字节，超过 1 MiB manifest 上限；其压缩后仍需约 489 KiB，超过当前正式 ZIP 剩余空间。实际可容纳多少取决于地址长度、重复率和包内资源。扩大覆盖时优先取得按运营方覆盖多个频道的依据，核对是否有可共用的固定 HTTPS 入口，分批验证。其他音频格式需另外实现播放器适配并通过沙箱验证。详见[官方规则核对记录](network-rules.md)。

工具分离公开目录扫描、运营方依据、沙箱候选和正式可播名单。沙箱包 0.1.0 为 3,953,534 字节，保留包内完整目录。桌面 Chromium 和手机 WebKit 视口的无声检查验证了 5 个入口，分批检查确认可从指定起点选择候选并保留已验收频道。四个新候选还需用户在真实 LINUX DO 桌面和手机沙箱验收。正式发布内容沿用已验收的 0.1.0，本次无需更新声屿服务。

开发和打包命令见[微应用说明](../../../apps/web/linuxdo/README.md)。

## 同频道目录条目共用播放端点

- 同一实际频道在目录里的不同编码、码率和历史名称，经核对后复用同一播放端点及验收状态。构建按目录 ID 提供播放入口，按播放 URL 去重网络声明。目录记录与多个频道都匹配时不自动作为别名。
- 正式候选 `0.1.1` 将 Radio Paradise 主频道的播放入口从 1 条目录记录扩到 4 条，继续使用已验收的 MP3 端点。另 4 个频道及其目录条目只进入沙箱。两种包都使用已有目录快照和当前页面播放器。
- 批量工具从本轮快照中识别了 Zeno Media 的 1,986 条 MP3 目录记录和 Triton Digital 的 642 条。Zeno 公布的服务端 API 需要项目凭据，Triton 公布的选台接口返回配置。仍需确认运营方能否提供授权覆盖多个频道并直接返回音频的入口。[Zeno 开发者说明](https://new.zeno.fm/developers/) · [Triton 选台接口](https://help.tritondigital.com/docs/provisioning-request)
- 全量接入仍需平台确认是否支持独立审核的音源白名单。现行 SDK 按 `manifest.json` 中声明的固定端点发起请求。[LINUX DO 网络规则](https://github.com/linux-do/mapp-developer-guide/blob/master/docs/sdk-network.md#声明端点)
- Chromium 桌面和 WebKit 手机视口通过无声隔离检查，覆盖 17 条目录记录的播放入口。正式 ZIP 为 3,953,337 字节，核对为 4 条目录记录共用 1 个已验收端点。沙箱 ZIP 为 3,953,811 字节，核对为 17 条目录记录共用 5 个端点。两个包均低于 4096 KiB。新增 4 个频道仍需真实沙箱双端验收。仅更新微应用产物，本次无需更新声屿服务。

## 新增两个独立电台候选

- 从既有目录快照选出 WMBR 88.1 FM 和 Dandelion Radio。两者是与既有候选节目不同的电台。WMBR 公布了外部播放器的直连 MP3 地址，Dandelion Radio 公布了外部播放器使用的 PLS，候选使用该 PLS 指向的固定 HTTPS 音源。[WMBR 播放说明](https://wmbr.org/?p=listen) · [Dandelion Radio 播放说明](https://www.dandelionradio.com/about.htm)
- 两个音源都通过了 HTTPS、`Origin: https://linux.do` 的 CORS 和 MP3 数据预检。KALX 与 Folk Alley 的试查地址未返回允许论坛来源的响应头。WWOZ 和 Radio Swiss 系列需要继续核对第三方微应用直连播放的使用依据。[WWOZ 使用条款](https://www.wwoz.org/wwozorg-site-terms) · [SRG SSR 使用条款](https://www.srgssr.ch/en/terms-of-use)
- 两台加入 `0.1.1` 沙箱，待真实沙箱在桌面与手机确认出声、停止和切台。正式候选继续使用同一个已验收频道。本次变更只影响 LINUX DO 沙箱包。
- 沙箱 ZIP 为 3,953,968 字节，包含 19 个目录入口和 7 个实际频道。桌面 Chromium 与手机 WebKit 视口的无声检查通过，核对测试包与交付包的音源清单和资源一致。正式 ZIP 的 SHA-256 保持一致。本次无需更新声屿服务。

## 继续核对目录内的独立电台

- 本轮从既有目录快照补充 Radio Fratz、WREK Atlanta 和 Radio Dreyeckland。Radio Fratz 公布了自选播放器的直连地址。WREK 公开了外部播放器收听主频道的方式，目录中的新版 HTTPS 地址与直播响应标识一致。Radio Dreyeckland 发布的 M3U 指向同一电台的 HTTP 流，目录中同域同路径的 HTTPS 入口可直接提供该台直播。[Radio Fratz](https://radio-fratz.de/livestream/) · [WREK 播放说明](https://old.wrek.org/listen/index.html) · [Radio Dreyeckland 播放列表](https://rdl.de/kontakt)
- WFMU 与 Freies Radio für Stuttgart 的受测 MP3 仍缺少适用的跨域许可。Deutschlandradio 的四个频道入口会重定向到带临时凭据的地址。LINUX DO 只允许重定向到另一个已审核的固定端点。当前需要电台提供允许论坛来源读取的固定直播入口，或由平台提供可审核的接入方式。[WFMU 播放说明](https://freeform.wfmu.org/mobile.shtml) · [Stuttgart 播放说明](https://www.freies-radio.de/empfang) · [Deutschlandradio 直播地址](https://www.deutschlandradio.de/streamingdienste-100.html) · [SDK 重定向规则](https://github.com/linux-do/mapp-developer-guide/blob/master/docs/sdk-network.md#http)
- KEXP 公布的外部播放器地址允许跨域读取，但提供 AAC-LC 和 HE-AAC。现有微应用播放器使用 MP3，新格式需单独适配及完成双端验收。[KEXP 外部播放器说明](https://www.kexp.org/mobile/kexp-livestreams/)
- `0.1.1` 沙箱 ZIP 为 3,954,158 字节，包含 10 个实际频道，其中 9 个待在真实 LINUX DO 沙箱双端确认出声、停止和切台。桌面 Chromium 与手机 WebKit 视口的无声检查通过。交付包的音源和资源与测试包一致，正式 ZIP 的 SHA-256 保持一致。本次只更新微应用沙箱，无需更新声屿服务。

## 本批频道直接进入正式候选包

- 根据用户要求，将上一批沙箱的 9 个独立频道移入正式名单，与已验收的 Radio Paradise 主频道一起打入 `0.1.2`。新增频道已有 HTTPS、跨域和 MP3 数据预检，配置逐条标记直接启用，保留空白的真实沙箱验收记录。正式包内使用普通播放入口。
- 平台仍通过沙箱页签接收 ZIP 并生成构建，随后在正式页选择该构建提审。本次按要求跳过项目侧的实际播放验收。[官方发布流程](https://github.com/linux-do/mapp-developer-guide/blob/master/docs/developer-guide.md#开发与发布)
- 10 个音源重新通过 HTTPS、跨域和 MP3 数据预检。正式 ZIP 为 3,954,151 字节，包含 10 个直播端点及 22 条普通播放记录。包体低于 4096 KiB，目录、地图和应用代码与上一版沙箱验证包一致。仅交付微应用正式候选包，本次无需更新声屿服务。
