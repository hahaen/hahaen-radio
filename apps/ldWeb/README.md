# 声屿 HAEN · LINUX DO 微应用

这是独立的纯前端版本。微应用从包内读取公开目录、地图和站内直播索引。目录浏览、详情、搜索、分类、语言、同城、随机选台和收藏在本机完成。直播经获批的 LINUX DO SDK 端点读取，经浏览器解码后在当前页面输出。

## 开发与目录更新

使用仓库固定的 Node.js 和 pnpm。首次构建从官方指南仓库获取固定版本的 SDK，缓存于 Git 忽略的 `.local/ldweb/sdk`。Vite 预览只用于目录与界面检查。

```bash
pnpm install --frozen-lockfile
pnpm --filter @haen/ld-web dev
pnpm --filter @haen/ld-web catalog:export
```

目录更新命令只对已发布公开目录发出 GET 请求，检查版本、规则摘要、每片数量与 ID 后原子替换 `data/catalog.json`。快照记录目录版本、UTC 导出时间和条数。电台条目按固定顺序存放 ID、名称、国家代码、地区、城市、附近城市、纬度、经度、位置精度、分类、语言、码率和公开可用状态。正式运行包通过 `sdk.assets.readJson()` 读取这些字段，公开可用状态与沙箱可播状态分别管理。地图使用项目已引入的 Natural Earth 公共领域数据。

## 沙箱包与站内播放

1. 在应用管理页创建应用，将分配的 UUIDv7 写入 `apps/ldWeb/.env.local` 的 `MINI_APP_ID`。新检出可在此路径自行建立本地文件，权限设为 `600`。
2. 在 `data/streams.json` 中填写候选电台的 `stationId`、固定的 HTTPS `url`、`operator` 和公开授权依据 `permission`。首个候选使用 `verification: null`，音源须允许论坛来源跨域读取、返回 `audio/mpeg`，并允许第三方接入。`stationId` 对应公开快照中的记录。
3. 运行 `pnpm --filter @haen/ld-web package:sandbox`，用应用管理页上传 `dist/sandbox/app.zip`。沙箱候选显示「沙箱试播」。在真实桌面与手机打开沙箱，选择开启声音，检查首次播放是否实际出声、停止是否安静、选另一台是否停止旧流，再从新台起播。检查过程留在当前页。记录使用的设备、浏览器和结果。
4. 完成桌面及手机验收后，记录 `verification` 的 `date`、`desktop` 和 `mobile`。运行 `pnpm --filter @haen/ld-web package` 生成 `dist/package/app.zip`，只收录有验收记录的音源。正式上架由用户操作。

SDK 根据每个版本的清单审批 `network.request` 和 `audio.webAudio`。播放需要浏览器的 MP3 WebCodecs 支持。目录仍可在没有播放权限或没有批准音源时使用。ZIP 内只有数据和代码，直播由电台端点提供。平台流程见 [LINUX DO 开发指南](https://github.com/linux-do/mapp-developer-guide/blob/master/docs/developer-guide.md)及[提审说明](https://github.com/linux-do/mapp-developer-guide/blob/master/docs/submission-review.md)。

## 本地无声验证

```bash
pnpm --filter @haen/ld-web package:check
pnpm --filter @haen/ld-web test:package
```

`dist/check/app.zip` 使用专用测试 ID，仅用于本地检查。浏览器检查以隔离 iframe 模拟 SDK 和资源读取，禁用 AudioContext，检查目录和收藏等交互。真实 ID、运营方授权、沙箱审批和真机听测按[实施记录](../../docs/iterations/2026-11-10-linuxdo-mini-app/README.md)核对。
