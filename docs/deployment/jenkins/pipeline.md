# Jenkins 流水线

已实现根 [Jenkinsfile](../../../Jenkinsfile) 的确定提交、工程检查、三类镜像构建、隔离容器验收与可选人工分发。目标主机人工更新阶段已接入[目标交接与执行](target-stage.md)，默认关闭；只有另行目标审批后才调用执行器，不把镜像分发等同为应用部署。

## 手动执行与参数

使用 Pipeline from SCM，SCM 为本项目 Git 仓库，读取已审核分支上的 Jenkinsfile。代码通过 Git 插件使用任务配置的仓库凭据检出指定提交，不在 shell 中重新拼接真实连接信息。文件没有 cron、轮询或 webhook 触发声明；任务侧也保持手动，普通代码推送不是上线指令。

| 参数 | 行为 |
| --- | --- |
| SOURCE_COMMIT | 必填，完整 40 位小写提交号；检出后实际核对 HEAD，拒绝模糊分支名和脏工作区 |
| DEPLOY_TARGET | 默认 false，要求本任务先分发镜像及单独目标审批；之后才分配目标节点 |
| DEPLOY_SCOPE | full/web/server，默认full；分端更新另确认兼容 |
| PUBLISH_IMAGES | 默认 false；true 时在验收后要求人工发起构建且由已配置审批人确认，才分发镜像 |

构建开始时清理构建节点的独占工作区，防止归档旧产物；目标阶段使用新的独占空工作区，不删除旧目录。脚本只在该检出的 Git info/exclude 中加入自己的私有产物目录，先拒绝已跟踪的产物路径，不改变共享忽略规则；不能把共享开发目录用作这个工作区。禁用同任务并发和从阶段重启，避免跳过独立审批阶段，90 分钟总上限。构建日志默认 7 天/最多 20 份，所列产物默认 30 天/最多 10 份；这不代替应用普通日志的时间保留。

## 当前可执行阶段

1. 固定源码：Git 插件检出 SOURCE_COMMIT，实际比对 HEAD；检查 Node.js 24.9.0 与 pnpm 12.5.1。
2. 工程检查：冻结安装、`pnpm check`、`pnpm docs:check`，安装锁定 Playwright 对应浏览器后执行 `pnpm test:e2e`。Linux 系统库由构建节点预先准备，流水线不临时授予 root 安装权限。
3. 生产客户端持续运行：显式HAEN_SOAK_SECONDS=600执行pnpm test:performance，包含四项目句柄/按需绘制及双端Chromium十分钟检查；失败阻止镜像构建。方法见[资源预算](../../engineering/resource-budgets.md)。
4. 镜像构建：`node deploy/scripts/release/pipeline.mjs build`，构建 Web/server/migration，统一应用提交标签；采用独有构建后缀，实际核对镜像 ID、revision label、Linux 原生架构和迁移文件摘要，写 build.json。
5. 隔离验收：`node deploy/scripts/release/pipeline.mjs test-images`，启动独立内部网络与临时 MySQL，应用并重复迁移，检查迁移哈希及表选项；使用明确的单台测试目录，经实际 API、任务进程、Web 代理与静态资源完成基础检查，再优雅退出应用并验证清理，写 image-check.json。
6. 人工分发：仅 PUBLISH_IMAGES=true 且具备人工构建 Cause、审批人配置与确认后，绑定独立镜像仓库 Secret file，执行 `node deploy/scripts/release/pipeline.mjs publish`。逐镜像再次核对本地 ID，上传后按不可变摘要从仓库读取 manifest，证明 config digest 等于实际验收镜像 ID，最后写 release.json。
7. 目标审批与交接：仅DEPLOY_TARGET=true时seal脱敏交接材料并stash，目标审批冻结上下文；在独立目标agent重新检出、accept核验后绑定只读拉取凭据，调用编译的发布入口，详见[目标阶段](target-stage.md)。

上述脚本只调用已实现的入口，没有部署任务占位命令。镜像分发步骤本身不创建数据库或更新容器；后续更新仍需DEPLOY_TARGET及独立审批，同一流水线内完成，不触发另一个任务。目标执行器只消费同任务已验收且明确批准的交接材料，并再次核对配置指纹和站点。

## 隔离镜像检查的范围

测试 MySQL 镜像由 HAEN_TEST_MYSQL_IMAGE 以完整仓库与 sha256 摘要配置，部署者先核对官方来源；实际运行仍检查 VERSION 为 8.0.46。只使用本轮临时容器、内部网络和内存数据挂载，不发布主机数据库端口，不连接开发或正式实例。

原生 MySQL 客户端使用临时 600 option file，服务端与应用变量通过 600 env file 注入；密码不作为命令参数、不打印原始进程错误，也不进镜像构建上下文。测试迁移/API/jobs 共享临时 MySQL 容器的网络命名空间，以已明确隔离的 loopback test 配置连接；这不是生产 TLS 证明。Web 在同一内部网络通过 API 地址验证同域代理。

测试夹具只为验收注入，不成为产品默认目录或真实播放证据。检查还包含迁移重复执行、迁移历史哈希/表选项、API 就绪和电台详情、任务启动、静态资源、优雅退出；不是完整并发、移动设备或生产音频验收。完整业务数据库升级与仓储验收继续使用既有独立 MySQL 入口，不能由这项容器基础检查替代。

每个本轮容器和网络带独有名称与 org.haen.ci.run 标签，清理前核对归属，删除后实际查询。清理查询失败不按“不存在”处理，不签发通过记录；不执行 system prune 或删除其他任务资源。Docker 失联、父进程强杀等异常由操作者按本轮日志中的 run/resourceRun 与标签核对现场后处理。

## 产物与失败

只归档 `.local/archive/release-pipeline/` 下明确的 build.json、image-check.json、release.json，以及选择目标更新时的deploy-handoff.json，禁止扩大成整个私有目录。上述文件只记录提交、镜像、目标站点/配置指纹与验证元数据，不含私密变量值、账号、口令、SQL、真实数据库或临时 Docker 认证配置。

release.json 固定提交、原生平台、Web/server/migration 不可变引用、迁移文件与 SHA256，以及对应验收 run。仓库返回 OCI index 时选择唯一匹配平台的子 manifest 并验证 config digest；最终引用固定到该已验收平台的内容，不依赖可覆盖的标签。

构建、隔离验收或分发失败不会产生对应的完整镜像发布记录；目标阶段失败时，已有release.json也不代表部署成功，应检查目标持久attempt和运行状态。标签变化、远端内容不符、验收缺失或清理失败会拒绝后续分发。多个仓库上传不是事务：失败时可能已上传部分镜像，但缺少完整发布记录时不得进入目标部署，不通过删除他人镜像伪造回滚。镜像分发及目标阶段分别将自己的独立身份复制至临时私有DOCKER_CONFIG，退出时清理，不调用会记录密码参数的登录命令。

## 仍需完成与目标节点验收

本机没有 Docker，按用户要求不执行实际镜像/容器检查；本轮 CLI 编排测试使用清楚标注的模拟 Docker 引擎。Jenkins Declarative Linter、实际插件/凭据绑定、浏览器系统库、原生 Linux 构建、真实容器及镜像仓库分发仍要在受控节点验收。

[目标执行器](../releases/target-executor.md)已提供独立手动入口，Jenkins已通过单独审批的[目标阶段](target-stage.md)接入，实际节点仍待验收；完整窗口不得拆成绕过入口的独立 Docker/SQL 命令。其实际流程包含：共享目标数据库发布锁和本机备份文件锁，预检与维护状态，停止写入，迁移前备份及副本验证，Drizzle Kit 单次执行，API→Web→任务验收顺序，失败留在维护状态及适用回退。它们继续属于完整交付范围；已存在的备份与迁移维护锁不能代替这些步骤。

准备条件见[环境与凭据](environment-and-credentials.md)，目标更新与恢复原则见[发布与回退](../releases/release-and-rollback.md)。实现记录见[镜像产物链](../../iterations/2026-10-17-release-images/README.md)。语法与人工 Cause API 依据为 [Pipeline Syntax](https://www.jenkins.io/doc/book/pipeline/syntax/) 和 [RunWrapper](https://javadoc.jenkins.io/plugin/workflow-support/org/jenkinsci/plugins/workflow/support/steps/build/RunWrapper.html)。
