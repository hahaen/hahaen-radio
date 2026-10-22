# 离线地点与地球资源

## 数据与许可

- 地点采用 [GeoNames cities15000](https://download.geonames.org/export/dump/)，其范围为人口大于 15,000 的城市或首府，不能表示完整的所有聚落。[19 列格式与许可](https://download.geonames.org/export/dump/readme.txt)规定 UTF-8、制表符及 CC BY 4.0；应用展示中须保留 GeoNames 署名和许可链接。
- 大陆轮廓来自 Natural Earth 1:110m land，固定数据版本 5.1.2。[许可](https://www.naturalearthdata.com/about/terms-of-use/)为公有领域，当前资源元数据保留来源和完整摘要。
- 不在浏览期间逐站访问在线地名服务。地点在服务端 MySQL 保存，地形作为前端本地静态资源交付。
- 目录同步先核对单调递增的导入标记与总数，再按 ID 每批读取最多 1,000 条。读取中途更换地点版本时拒绝发布混合数据；每次数据库操作仍限制为 15 秒，整体读取限制为 90 秒，并响应取消信号。

## 地点导入

使用服务端任务身份和 `.env.jobs.local`；加载方式、目标库限制与凭据规则沿用[目录管线](catalog-pipeline.md)。运行前核对 NODE_ENV、DB_NAME 和目标实例，不使用生产库做开发或测试。

1. 从上述 GeoNames 官方目录下载 `cities15000.zip`，使用系统 ZIP 工具仅解出 `cities15000.txt`，保存在本地私有工作目录。生产导入前记录日期与文件 SHA-256；每日数据会变化，不将旧摘要当作以后版本的固定值。
2. 在仓库根目录执行 `pnpm places import /absolute/path/cities15000.txt`。路径传到本机命令，不通过浏览器上传，也不记录到普通日志。
3. 命令检查 UTF-8、最多 50MiB、恰好 19 列、聚落类型、唯一 ID、国家代码、经纬度和可识别 IANA 时区；整批必须在 1,000–100,000 条以内。非法记录拒绝整批，不能静默丢失一部分后报告完整成功。
4. 使用既有 `places`、`job_leases`、`job_runs` 表；独立 `places-import` 行锁串行化导入，单个事务内清除旧地点、每批 2,000 条写入并记录成功。取消、约束或 15 秒数据库操作超时会回滚，原地点保持可用。失败记录只包含固定错误码；数据库已不可用时记录可能无法写入，应以命令失败状态排障。
5. 成功日志仅输出条数和输入摘要。随后执行 `pnpm catalog sync`，在下一次成功目录发布时生效；导入地点本身不会修改正在使用的目录。

地点数据不是凭据，但本机原始下载、调试结果和连接信息不作为普通交付材料。目录任务用固定错误码 `CATALOG_PLACES_UNAVAILABLE` 表示地点读取或校验失败，不输出 SQL、源内容或驱动异常。

导入无需新迁移，也不会对正式库自动执行命令。

## 位置与时间证据

- 保留电台原始坐标及精度，不将国家级或未知位置转换成城市坐标。
- 使用国家代码和一度网格查询 20km 内最近的 GeoNames 聚落，处理日期变更线和极区。结果写入 `nearbyCity`，界面必须明确显示“附近”；不凭距离设置 `city`，也不从台名猜城市。
- 只有电台坐标距聚落点不超过 100m，且同国家 20km 内的候选时区全部一致，才补充 `timezone` 并标注 `timezoneSource=geonames`。这是保守的地名点证据，并非行政边界测绘；其他电台继续保持未知时区，不展示虚构当地时间。
- 匹配过程不改变电台坐标、码率、线路或可用性。无法匹配不妨碍列表、搜索与播放。

## 国家级地图展示位置

前端单独维护 `src/graphics/countries.json`，来自 Natural Earth 5.1.2 的 10m 地图单元 `ISO_A2_EH`、`LABEL_Y`、`LABEL_X`。同代码出现多个单元时选择 `POP_EST` 最大的单元标签，250 个代码的展示位置与原始下载及生成文件摘要记录在 `public/geography/countries-source.json`；许可为公有领域。

从来源清单的固定 HTTPS 地址下载 GeoJSON 后，运行 `node apps/web/scripts/prepare-countries.mjs /absolute/path/ne_10m_admin_0_map_units.geojson`，脚本核对原始 SHA-256、代码、坐标和数量再生成本地资源。普通构建与浏览不访问该数据源。

国家标签点作为偏移原点；分组锚点使用同一下载数据生成的 `src/graphics/country-interiors.json`。生成时对各地图单元进行包含孔洞的三角剖分，按面积保留候选，选择每个代码最大的一个安全内陆三角形，向内部收缩后量化，并检查量化后顶点仍在原始三角形内。输出为相对国家标签点的整数偏移，每个代码首项记录缩放倍率；生成资源摘要记录在来源清单中。只保留这些安全内陆区域用于展示，不宣称覆盖国家所有陆地或识别电台实际城市。

国家级电台共用第一个安全内陆三角形的重心作为分组锚点，不按 ID 散布位置；国家标签点可能位于海上，因此不直接将其当作地图落点。分组不随候选排序、筛选、刷新或省电模式移动，空心圆代表区域内的全部低精度电台，不代表任何一台的经纬度、城市或时区证据。原始 API 和缓存格式保持兼容，无需重新同步目录。交互与验证范围见[定位准确性修正](../iterations/2026-10-22-station-location-accuracy/README.md)。

## 地形资源再生成

`apps/web/public/geography/` 包含 `land.json`（127 个多边形、7,595 个约等距大陆点）、`world.svg`（静态地理降级资源）和 `source.json`（版本与摘要）。这些文件是地图数据与渲染输入，尚不代表地球交互已实现。

从 `source.json` 的固定 HTTPS 地址下载对应 GeoJSON，再在根目录运行：

```sh
node apps/web/scripts/prepare-land.mjs /absolute/path/ne_110m_land.geojson
```

脚本核对固定版本的 SHA-256，再校验多边形和坐标，只输出到上述固定目录。点阵通过大陆包含关系生成并排除孔洞，不使用随机地理形状。`land.json` 保留确定的紧凑序列化以核对摘要，因此只针对该生成文件排除格式化；生成脚本继续接受 Lint 与格式检查。

实际执行结果与待验收范围见[地理数据归档](../iterations/2026-10-17-offline-geography/README.md)。返回[数据导航](README.md)。

## 坐标范围与省/州级展示

`country-coverage.json` 从同一固定国家 GeoJSON 生成半度陆地网格；`public/geography/regions.json` 从固定版本的 Natural Earth 10m 一级行政区生成 4,584 个行政区的别名、安全内陆三角形和四分之一度范围索引，摘要与许可见相邻的 `regions-source.json`。网格包含边界与小岛，查询容忍相邻一格，只用来拒绝明显矛盾；区域分组锚点使用原始行政区安全内部三角形的重心。

在根目录按已核对的来源清单下载原始输入，再运行：

```sh
node apps/web/scripts/prepare-country-coverage.mjs /absolute/path/ne_10m_admin_0_map_units.geojson
node apps/web/scripts/prepare-regions.mjs /absolute/path/ne_10m_admin_1_states_provinces.geojson
```

脚本校验固定 SHA-256；国家资源脚本写入 `countries-source.json` 的校验摘要，应在 `prepare-countries.mjs` 之后运行。行政区生成文件保持紧凑序列化，普通构建与浏览不访问外部数据源。新行政区静态资源单独限制原始体积不超过 1MiB。

来源坐标与国家或已匹配省/州明显矛盾时，地图降为最具体的已知行政区位置；原始 API、坐标、时区与缓存不修改。已知省/州的电台共用相应安全三角形的重心，以一个空心分组展示，不按 ID 散点。匹配仅在所属国家内使用确切名称、别名或标准代码；存在歧义或地区字段缺失时保留国家级位置，不从台名或语言猜测。完整范围与边界验证见[地理位置修复](../iterations/2026-10-21-geographic-position/README.md)。
