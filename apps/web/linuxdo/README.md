# 声屿 HAEN

LINUX DO 微应用与官网共用 `apps/web/src` 中的界面、地球、目录筛选、收藏和播放器控制。微应用由此目录的入口启动，使用包内数据和 SDK，运行时无需自建后台。

## 构建与目录快照

使用仓库固定的 Node.js 和 pnpm，从仓库根执行：

```sh
pnpm install --frozen-lockfile
pnpm --filter @haen/contracts build
pnpm --filter @haen/web test:linuxdo
```

首次构建获取固定版本的官方 SDK，缓存于 Git 忽略的 `.local/linuxdo/sdk`。检查命令生成 `apps/web/linuxdo/dist/check/app.zip`，使用专用测试 ID，不可提交至平台。它用桌面 Chromium 和 WebKit 手机视口在禁止音频与外网的隔离 iframe 中检查 ZIP；这不算真实沙箱验收。官网的 `pnpm --filter @haen/web build` 独立输出至 `apps/web/dist`。

当前包内公开快照共有 72,088 条电台，目录版本为 `0e6e045d-d9e2-42bd-9d5f-1ee29f76ef6c`，UTC 导出时间为 `2026-11-10T08:35:43.969Z`。需要更新时才运行 `pnpm --filter @haen/web catalog:export:linuxdo`。它只读请求已发布的公开目录，校验目录版本、规则摘要、分片条数及 ID，再原子替换 `data/catalog.json`。

快照保存电台 ID、名称、国家、地区、城市、附近城市、坐标、位置精度、分类、语言、码率和公开可用状态。目录通过 `sdk.assets.readJson()` 读取；地图通过 SDK 从包内读取。没有精确城市时，页面标注并按附近城市筛选。收藏和设置保存在 SDK 的应用存储中；如曾在同一应用下收藏，首次读取会兼容原有收藏 ID。

## 沙箱与正式打包

1. 在仓库根的 `.local/linuxdo/.env.local` 填写应用管理页分配的 `MINI_APP_ID`（UUIDv7）。此文件被 Git 忽略，权限设为 `600`。
2. 若有获准的 MP3 直播，填写 `data/streams.json` 中的 `stationId`、HTTPS `url`、`operator` 和公开授权依据 `permission`。待验收候选填写 `verification: null`。端点需允许论坛来源跨域读取、返回 `audio/mpeg`，且运营方允许第三方使用。
3. 运行 `pnpm --filter @haen/web package:linuxdo:sandbox`，用管理页上传 `apps/web/linuxdo/dist/sandbox/app.zip`。有候选的包申请 `network.request` 与 `audio.webAudio`；候选显示「沙箱试播」。无候选也可生成仅供目录验收的沙箱包。
4. 在真实沙箱取得桌面和手机的播放、停止、切台验收结果后，再填写 `verification` 中的 `date`、`desktop` 和 `mobile`。运行 `pnpm --filter @haen/web package:linuxdo` 生成 `apps/web/linuxdo/dist/package/app.zip`。正式包只收录通过验收的电台，由用户上架。

直播通过 `sdk.http.stream()` 读取，需浏览器支持 MP3 WebCodecs 和平台授予的 Web Audio。目录本身不含音频、直播 URL 或私有数据。没有名单或播放权限时仍可选台和收藏，页面不会跳转。地图数据来自 Natural Earth，地名参考 GeoNames（CC BY 4.0）。

见 [LINUX DO 官方开发指南](https://github.com/linux-do/mapp-developer-guide/blob/master/docs/developer-guide.md)和[实施记录](../../../docs/iterations/2026-11-10-linuxdo-mini-app/README.md)。
