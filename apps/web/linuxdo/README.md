# 声屿 HAEN

LINUX DO 微应用与官网共用 `apps/web/src` 中的界面、地球、筛选、收藏和播放控制。微应用通过官方 SDK 读取现有 `radio-api` 的公开目录与详情，地图从包内加载，收藏和设置保存在 SDK 应用存储。

## 目录和直播

现有 `radio-api` 通过 `/radio/api/v1/linuxdo/scene`、`/chunk` 和 `/stations` 提供目录清单、分片和详情。接口与官网使用同一个目录服务，跨域响应允许 `https://linux.do`。部署新版 API 后，首次打开微应用会读取现有目录，目录版本变化时刷新。目录下载完成后，本次会话的筛选、搜索和随机选台在页面内执行。

沙箱包含 Radio Paradise 主频道的试听入口。电台详情必须匹配官网目录中的同频道来源，微应用才会读取运营方公开提供给播放器的 MP3 端点。直播经 SDK 直接读取电台音频，在当前页面解码播放。扩充直播时，在 `data/streams.json` 记录官网目录电台 ID、对应的 `catalogUrl`、运营方提供的 MP3 `url` 和公开依据。实际沙箱验收完成后再填写 `verification`。

## 打包

使用仓库固定的 Node.js 和 pnpm。从仓库根执行以下命令。

```sh
pnpm install --frozen-lockfile
pnpm --filter @haen/contracts build
pnpm --filter @haen/web test:linuxdo
pnpm --filter @haen/web package:linuxdo:sandbox
```

应用 ID 填在仓库根目录的 `.env.local.linuxdo`，变量名为 `MINI_APP_ID`。首次构建把固定版本的官方 SDK 缓存在 `.local/linuxdo/sdk`。检查包位于 `apps/web/linuxdo/dist/check/app.zip`，使用本地测试 ID。沙箱包位于 `apps/web/linuxdo/dist/sandbox/app.zip`，使用应用管理页分配的真实 ID。配置文件和 ZIP 均由 Git 忽略。

在管理页上传沙箱包并授予网络和 Web Audio 权限后，验证桌面与手机的目录、播放、停止和切台。记录验收结果后才可运行 `pnpm --filter @haen/web package:linuxdo` 生成正式候选包。正式上架由用户操作。

地图数据来自 Natural Earth，地名参考 GeoNames（CC BY 4.0）。平台能力见 [LINUX DO HTTP 与 WebSocket 指南](https://github.com/linux-do/mapp-developer-guide/blob/master/docs/sdk-network.md)，本项目变更见[实施记录](../../../docs/iterations/2026-11-10-linuxdo-mini-app/README.md)。
