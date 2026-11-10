# LINUX DO 直播音源接入规则

2026-11-10 核对 LINUX DO 官方 SDK 开发指南和提审说明。适用范围为声屿在微应用页面内直连第三方电台直播，包内保留目录，不依赖声屿服务或自建代理。

## 批量声明与限制

- 在 `manifest.json` 的 `endpoints` 中按名称声明 HTTPS URL、HTTP 方法和可选动态查询键，运行时按名称调用。官方没有另设端点数限制，可以在本地用脚本去重、批量生成。同一个已获准接入的实际 URL 可以由多条目录记录引用同一端点。提审仍需说明每个端点的运营方、用途、参数和响应示例。[网络端点说明](https://github.com/linux-do/mapp-developer-guide/blob/master/docs/sdk-network.md#声明端点) · [提审材料](https://github.com/linux-do/mapp-developer-guide/blob/master/docs/submission-review.md#准备材料)
- 整个 manifest 上限为 1 MiB、最多 32 层，单端点声明最多 64 KiB，端点名和动态查询键均为 1–64 个规定的 ASCII 字符，编码后的 URL 连同动态查询最多 16 KiB。运行时只能填写预先声明的动态查询键，不能改写固定 URL、固定查询值或请求头。文档要求使用有权运营的服务，公开可访问、存在于电台目录以及通过 CORS 检测都不能代替运营方允许第三方使用的依据。运营方使用规则也不能代替平台对具体端点的审核。[网络端点说明](https://github.com/linux-do/mapp-developer-guide/blob/master/docs/sdk-network.md#声明端点) · [开发说明](https://github.com/linux-do/mapp-developer-guide/blob/master/docs/developer-guide.md#manifest)
- ZIP 上传上限以实际管理页面为准，本项目按 4096 KiB 校验。官方解压限制是整包 128 MiB、单文件 32 MiB、最多 1024 个文件。端点数量上限要以实际 manifest 字节数和整个 ZIP 的压缩大小分别计算。新增声明和音源清单都会占用预算。[开发说明](https://github.com/linux-do/mapp-developer-guide/blob/master/docs/developer-guide.md#manifest) · [微应用打包约定](../../../apps/web/linuxdo/README.md#打包)

## 适用的播放方案

| 方案 | 对电台扩展的影响 |
| --- | --- |
| 固定直播端点 | 申请 `network.request`，使用 `sdk.http.stream()` 读取已声明的端点，通过 `audio.webAudio` 在用户操作后输出。服务需允许论坛来源的 CORS，实际格式还需播放器和目标浏览器支持。现有实现直接处理 HTTPS MP3。默认不跟随重定向，`redirectTo` 只能指向清单中的已审核 GET/HEAD 端点，不能使用响应提供的任意 `Location`。[HTTP 流式读取](https://github.com/linux-do/mapp-developer-guide/blob/master/docs/sdk-network.md#下载进度与流式读取) · [SDK 原生 Web Audio](https://github.com/linux-do/mapp-developer-guide/blob/master/sdk/README.md#原生-web-audio) |
| 运营方共用一个入口 | 由固定 URL 和动态查询的规则可推知，如果同一运营方已有允许第三方使用的固定 HTTPS 接口，并以 `channel` 等查询参数提供多个频道，可以让这些频道共用一个声明。需要按该接口的使用依据、CORS 和实际播放结果审核，不能将任意电台地址传给一个转发接口。[网络端点说明](https://github.com/linux-do/mapp-developer-guide/blob/master/docs/sdk-network.md#声明端点) |
| `remote_assets` 和 `audio.play` | 适合版本固定的文件。远程素材必须声明固定 URL、实际字节数、MIME 和 SHA-256，完整校验后才可使用，单文件方式不支持边下载边播放。这条通道不能作为变化中的连续直播入口。目录仍随包发布。[开发者 CDN 素材](https://github.com/linux-do/mapp-developer-guide/blob/master/docs/developer-guide.md#开发者-cdn-素材) |
| HLS/DASH 媒体时间线 | SDK 有高级视频节目接口，支持受限的 fMP4 HLS/DASH。清单解析不发请求，每个初始化段、媒体段或字幕仍须映射到已声明素材或已审核 GET 端点，并校验大小、MIME 和 SHA-256。HLS 路径不转换 MPEG-TS，也不支持 DRM 或低延迟部分段。适合运营方已提供合规索引和分片的内容，不能把官网目录中普通 HLS 或其他任意地址直接交给该接口。[高级视频时间线与直播](https://github.com/linux-do/mapp-developer-guide/blob/master/docs/media-timelines.md) |

对当前微应用，优先复用已核准、经 CORS 实测的直连 MP3。批量技术筛查和运营方使用依据分别记录。只有通过桌面及手机真实 LINUX DO 沙箱的实际出声、停止与切台验证，才进入正式清单。真实审核及沙箱结果以平台和用户验收为准。
