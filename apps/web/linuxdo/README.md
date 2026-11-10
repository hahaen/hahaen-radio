# 声屿 HAEN

LINUX DO 微应用与官网共用 `apps/web/src` 中的界面、地球、筛选、收藏和播放控制。微应用通过官方 SDK 读取包内目录和地图，收藏和设置保存在 SDK 应用存储。微应用运行时不请求声屿后台，使用访客模式。

## 目录和直播

`data/catalog.json` 是官网公开目录的快照，记录线上目录版本、导出时间和条数。电台详情、筛选、搜索、同城和随机选台使用包内公开字段。要更新目录，运行 `pnpm --filter @haen/web export:linuxdo:catalog`，从官网公开接口只读导出后重新打包。打包使用已有快照，不访问官网 API。

沙箱包含 Radio Paradise 主频道的试听入口。直播经 SDK 直接读取运营方的 MP3 端点，在当前页面解码播放。扩充直播时，先核对音源与目录为同一频道，再在 `data/streams.json` 记录目录电台 ID、对应的 `catalogUrl`、运营方提供的 MP3 `url` 和公开依据。打包时只纳入快照中状态可用的电台。实际沙箱验收完成后再填写 `verification`。

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
