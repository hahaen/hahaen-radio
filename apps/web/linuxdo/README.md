# 声屿 HAEN

LINUX DO 微应用与官网共用 `apps/web/src` 中的界面、地球、筛选、收藏和播放控制。微应用通过官方 SDK 读取包内目录和地图，收藏和设置保存在 SDK 应用存储。微应用运行时不请求声屿后台，使用访客模式。

## 目录和直播

`data/catalog.json` 是官网公开目录的快照，记录线上目录版本、导出时间和条数。电台详情、筛选、搜索、同城和随机选台使用包内公开字段。要更新目录，运行 `pnpm --filter @haen/web export:linuxdo:catalog`，从官网公开接口只读导出后重新打包。打包把快照无损转换为按字段排列的 JSON，提高 ZIP 压缩率。微应用读取后恢复原有记录和顺序。打包使用已有快照，不访问官网 API。

首个正式可播电台为 Radio Paradise 主频道。直播经 SDK 直接读取运营方的 MP3 端点，在当前页面解码播放。扩充直播时，先核对音源与目录为同一频道，再在 `data/streams.json` 记录目录电台 ID、对应的 `catalogUrl`、运营方提供的 MP3 `url` 和公开依据。打包时只纳入快照中状态可用的电台。实际沙箱验收完成后再填写 `verification`。

### 批量筛选音源

1. 运行 `pnpm --filter @haen/web scan:linuxdo:sources`。工具核对包内目录与当前线上版本，再按官网搜索范围批量读取公开详情。若版本不一致，先更新目录快照。清点结果保存在 Git 忽略的 `.local/linuxdo/station-inventory.json`。
2. 在 `data/source-evidence.json` 记录运营方的公开使用依据、频道对应的目录地址和实际播放端点。多频道可共用运营方的依据。运行 `pnpm --filter @haen/web prepare:linuxdo:sources` 查看格式、使用依据、连接预检和去重统计。工具只预检有依据的固定端点，不播放声音。
3. 核对结果后运行 `pnpm --filter @haen/web prepare:linuxdo:sources --write-candidates` 生成 `data/sandbox-streams.json`。同一频道的目录条目通过 `aliases` 共用一个播放端点。需要补齐已验收频道的目录关联时，另加 `--write-aliases` 更新 `data/streams.json` 中已核对的别名，保留原音源和验收记录。正式包仅载入已验收频道，沙箱和本地检查包另载入候选频道。
4. 使用 `HAEN_LINUXDO_SANDBOX_OFFSET=0 HAEN_LINUXDO_SANDBOX_LIMIT=10 pnpm --filter @haen/web package:linuxdo:sandbox` 可分批构建。`OFFSET` 从 0 开始，默认每批最多 100 条候选，已验收音源随每批沙箱包提供。沙箱实际通过后，将对应候选和 `verification` 写入正式可播清单。

`source-evidence.json` 的 `reviewGroups` 为待排查的托管平台，统计按域名归组的 MP3 目录条目。同一条电台可能使用多个平台。这组数据仅供核对覆盖范围，正式和沙箱候选依然按 `allowed` 的频道依据筛选。

参见[官方规则核对记录](../../../docs/iterations/2026-11-10-linuxdo-mini-app/network-rules.md)和[批量筛选结果](../../../docs/iterations/2026-11-10-linuxdo-mini-app/README.md#批量筛选官网音源)。

## 打包

微应用的实际发布内容有变化时，更新 `version.json`，将补丁版本加 1，再交付正式候选 ZIP。同一次交付的检查、沙箱和正式包使用同一版本。仅改文档、协作规则或不会改变包内内容的工具时，保留版本和现有包。使用仓库固定的 Node.js 和 pnpm，从仓库根执行以下命令。

```sh
pnpm install --frozen-lockfile
pnpm --filter @haen/contracts build
pnpm --filter @haen/web test:linuxdo
pnpm --filter @haen/web package:linuxdo
```

应用 ID 填在仓库根目录的 `.env.local.linuxdo`，变量名为 `MINI_APP_ID`。首次构建把固定版本的官方 SDK 缓存在 `.local/linuxdo/sdk`。检查包位于 `apps/web/linuxdo/dist/check/app.zip`，使用本地测试 ID。沙箱包位于 `apps/web/linuxdo/dist/sandbox/app.zip`，使用应用管理页分配的真实 ID。配置文件和 ZIP 均由 Git 忽略。

打包按管理页的 4096 KiB 上传上限检查最终 ZIP。超限时构建报错，保留上一次输出。

正式候选包位于 `apps/web/linuxdo/dist/package/app.zip`，仅包含已记录真实沙箱验收的音源。验证新音源时，另用 `pnpm --filter @haen/web package:linuxdo:sandbox` 构建沙箱包，在桌面和手机验证目录、实际出声、停止和切台，再更新验收记录。上传、提审和正式上架由用户操作。详细交付约定见[微应用协作规范](AGENTS.md)。

地图数据来自 Natural Earth，地名参考 GeoNames（CC BY 4.0）。平台能力见 [LINUX DO HTTP 与 WebSocket 指南](https://github.com/linux-do/mapp-developer-guide/blob/master/docs/sdk-network.md)，本项目变更见[实施记录](../../../docs/iterations/2026-11-10-linuxdo-mini-app/README.md)。
