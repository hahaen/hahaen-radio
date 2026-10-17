# 从干净检出开始运行

本说明从没有node_modules、dist、私有配置或既有数据库的检出开始。所有命令均在仓库根目录执行；真实账号与密码由操作者在本机或部署环境填写，不从其他人的工作目录复制。当前本机验收见[检出记录](../iterations/2026-10-17-clean-checkout/README.md)，完整状态见[验收矩阵](../product/acceptance.md)。

## 安装与检查

准备.nvmrc指定的Node.js 24.9.0和packageManager指定的pnpm 12.5.1，先核对实际版本，再执行：

```sh
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm check
pnpm docs:check
```

check依次执行格式、Lint、类型检查、普通测试、全部生产构建和Web静态资源预算；数据库用例默认跳过，不能把它写成数据库验收。构建会按依赖顺序生成共享契约，API使用编译后的共享模块，不依赖旧dist或另一工作目录的node_modules。

浏览器回归另外安装固定Playwright版本对应的浏览器后执行：

```sh
pnpm exec playwright install chromium firefox webkit
pnpm test:e2e
```

持续资源验收另见[资源预算](resource-budgets.md)。本机无Docker，镜像和目标Linux实测按用户要求留到部署环境；本地安装、构建成功不能代替该验收。

## 无数据库的基础启动

不需要创建环境文件即可运行：

```sh
pnpm dev
```

打开http://127.0.0.1:5173；Web通过同域/api代理到本机3001端口。另一个终端检查：

```sh
curl -i http://127.0.0.1:5173/api/v1/health/live
curl -i http://127.0.0.1:5173/api/v1/health/ready
```

无数据库配置时live应为200，ready为503且database/catalog均为false；目录接口明确不可用，页面没有可播放电台。这只证明基础启动与失败提示，完整产品需要下一节的真实数据。不要用模拟目录或假播放替代配置。结束时在启动终端按Ctrl+C，确认Web/API进程退出后再复用端口。

## 私有配置与真实目录

共享.gitignore排除根目录.env.local、.env.*.local和.local/，不会排除空值模板.env.example。先检查待用路径已被忽略且未被跟踪：

```sh
git check-ignore -v -- .env.local .env.jobs.local .env.migration.local .local/archive/
git ls-files -- .env.local .env.jobs.local .env.migration.local .local/
```

第一条应显示忽略规则，第二条应无输出；如果已有文件被跟踪，先处理跟踪问题，不能把忽略规则当作历史清理。创建私有配置时保留已有内容，不覆盖旧文件：

```sh
umask 077
cp -n .env.example .env.local
cp -n .env.example .env.jobs.local
cp -n .env.example .env.migration.local
chmod 600 .env.local .env.jobs.local .env.migration.local
```

只填写当前入口实际需要的变量。每个文件显式设置NODE_ENV=development、DB_NAME=ha_radio_dev，并提供各自受限身份和已验证连接；API/jobs/migration不共用高权限账号。直连远端数据库需要可信CA和主机名校验；仅经过核对的SSH回环开发连接可以按[配置文档](../operations/configuration-and-logging.md)设置数据库层TLS。进程环境优先于环境文件，已有DB_*变量可能覆盖文件；核对变量是否设置即可，不把值输出或粘贴到日志。

真实数据的执行顺序如下，各步成功后再进入下一步：

1. 操作者准备MySQL 8.0.46及约定的开发库，显式核对字符集、排序规则、目标和身份。程序不会自动建库或迁移。
2. 停止API、任务和其他写入方。既有非空库先完成一致性备份、受控副本及校验，见[备份流程](../data/backup/backup-and-restore.md)；全新空库按[初始化保护](../data/migrations/target-preflight.md)证明空状态。
3. 运行pnpm db:migrate status，核对完整元数据可见性、历史前缀、表集合和当前三条版本化迁移中的待执行项。缺少权限、非空未管理库或半完成迁移时先排障，不跳过预检，也不扩大API/jobs权限。
4. 仅在实际停写后于私有迁移配置设置MIGRATION_WRITES_STOPPED=true；首次初始化还需MIGRATION_INITIALIZE_EMPTY=true。运行pnpm db:migrate，再次status确认无待执行迁移。成功后撤回首次初始化确认；失败时保留现场，按[迁移流程](../data/migrations/workflow.md)核对DDL和历史，不能无条件重跑。
5. 按[离线地理](../data/offline-geography.md)准备可信GeoNames输入，运行pnpm places import /absolute/path/cities15000.txt；记录输入日期及摘要。地点缺失时保留未知，不伪造城市或时区。
6. 运行pnpm catalog sync，再运行pnpm catalog status，确认完整真实目录已发布。两条命令使用.env.jobs.local；同步失败不得通过清空旧目录修复。
7. 运行pnpm dev及独立的pnpm jobs。API加载.env.local，任务加载.env.jobs.local，迁移加载.env.migration.local；修改文件后重启相应进程。确认ready为200、database/catalog为true，再从页面显式开始播放。业务权限还须包含新诊断表所需的最小权限，见[诊断运维](../operations/playback-diagnostics.md)。

上述步骤会对所选开发库写入数据，必须先核对环境。它们是新环境的操作步骤，不表示所有命令已在当前开发库或正式库执行；当前执行状态以迁移文档为准。可选识曲保持关闭，只有真实凭据、授权额度和持久状态具备后，按[识曲额度](../operations/recognition-quota.md)单独启用。

## 编译运行与手动发布

pnpm build之后可用pnpm --filter @haen/server start运行编译API，用pnpm --filter @haen/server start:jobs运行编译任务；环境文件加载与开发入口相同。不要把NODE_ENV=production下缺少数据库的启动失败误写成无数据库演示模式。

前端生产目录为apps/web/dist。pnpm --filter @haen/web preview用于本机检查构建结果，当前固定Vite配置会继承开发/api代理并连接本机3001端口；须先启动编译API，preview本身不是生产Web服务器。生产由Caddy提供静态文件与API代理，按[镜像构建](../deployment/containers/local-and-image-build.md)、[Jenkins手动流水线](../deployment/jenkins/pipeline.md)、[目标交接](../deployment/jenkins/target-stage.md)与[发布执行器](../deployment/releases/target-executor.md)顺序完成目标环境配置、审批、备份、迁移和启动验收。

真实数据、私有CA、服务端环境文件和备份均不随源码或镜像交付。完整发布由用户执行；本说明不会触发Jenkins、上传镜像或修改正式库。部署后的双端、媒体输出、移动网络、备份副本和恢复检查仍需在对应环境完成。

返回[工程导航](README.md)或[环境与依赖](environment-and-dependencies.md)。
