# Jenkins 流水线

根 [Jenkinsfile](../../../Jenkinsfile) 支持手动选择分支，一次完成检查、镜像构建、分发和完整部署前后端。实际首次上线状态见[正式部署记录](../../iterations/2026-10-17-production-deployment/README.md)。

## 日常发版

在 Jenkins 文件夹内打开构建任务，点击构建入口，在唯一的 `BRANCH` 下拉框中选择分支（默认 `main`），开始构建。无需手填 40 位提交号、镜像上传、目标更新或分端范围参数。Git Parameter 插件从任务的 SCM 与凭据读取分支列表，不在页面或 shell 中拼接真实连接凭据。

任务须使用 Pipeline from SCM，控制 Jenkinsfile 的分支由管理员固定，应用分支通过下拉框选择。仅允许已审核、包含当前发布工具的可信分支。代码推送不触发发布，任务不配置 cron、轮询或 webhook；只有同时列于分发和目标发布用户清单的人工发起者才能发布。

## 当前阶段

1. 固定源码：校验分支并抓取，实际核对 HEAD 与抓取引用，记录 `source.json` 中的分支和完整提交。构建说明显示分支与短提交；后续全程使用完整提交，不再次追随分支变化。
2. 工程检查：冻结安装、`pnpm check`、文档检查和完整浏览器回归。Node.js 固定 24.9.0，pnpm 固定 12.5.1，Playwright 浏览器与系统依赖由受控构建节点提供。
3. 持续运行：`HAEN_SOAK_SECONDS=600` 执行既有生产资源与双端切台检查，失败阻止镜像构建。
4. 构建镜像：同一提交构建 Web、server 和 migration，核对原生架构、镜像 ID、revision label 和迁移摘要，生成 build.json。
5. 隔离验收：在独立临时 MySQL 8.0.46 中执行并重复迁移，核对历史、表选项、API、任务、Web 和静态资源，优雅退出并检查清理，生成 image-check.json。
6. 分发产物：使用独立 Secret file 上传已验收镜像，读取平台 manifest，核对 config digest 等于验收镜像 ID，生成不可变 release.json。
7. 冻结交接：固定 `full` 范围、站点、数据库指纹、平台和提交，生成并 stash 交接材料。
8. 目标更新：独立目标节点重新检出同提交，验证交接和私有环境；只读预检无待执行迁移时自动继续，有迁移或空库初始化时仅作一次数据库变更确认，再执行原有备份、迁移与启动验收。详见[目标阶段](target-stage.md)。

禁用并发和阶段重启，90 分钟总上限；没有给迁移或状态性阶段添加自动重试。构建节点开始时清理独占工作区，目标节点使用新空目录。保留原有日志和产物期限：构建日志 7 天/最多 20 份，明确列出的产物 30 天/最多 10 份。旧目标工作区和失败现场不由新发布盲删。

## 隔离镜像检查的范围

测试 MySQL 镜像由 HAEN_TEST_MYSQL_IMAGE 以完整仓库与 sha256 摘要配置，部署者先核对官方来源；实际运行仍检查 VERSION 为 8.0.46。只使用本轮临时容器、内部网络和内存数据挂载，不发布主机数据库端口，不连接开发或正式实例。

原生 MySQL 客户端使用临时 600 option file，服务端与应用变量通过 600 env file 注入；密码不作为命令参数、不打印原始进程错误，也不进镜像构建上下文。测试迁移/API/jobs 共享临时 MySQL 容器的网络命名空间，以已明确隔离的 loopback test 配置连接；这不是生产 TLS 证明。Web 在同一内部网络通过 API 地址验证同域代理。

测试夹具只为验收注入，不成为产品默认目录或真实播放证据。检查还包含迁移重复执行、迁移历史哈希/表选项、API 就绪和电台详情、任务启动、静态资源、优雅退出；不是完整并发、移动设备或生产音频验收。完整业务数据库升级与仓储验收继续使用既有独立 MySQL 入口，不能由这项容器基础检查替代。

每个本轮容器和网络带独有名称与 org.haen.ci.run 标签，清理前核对归属，删除后实际查询。清理查询失败不按“不存在”处理，不签发通过记录；不执行 system prune 或删除其他任务资源。Docker 失联、父进程强杀等异常由操作者按本轮日志中的 run/resourceRun 与标签核对现场后处理。

## 产物与失败

只归档 `.local/archive/release-pipeline/` 下明确的 build.json、image-check.json、release.json，source.json 和 deploy-handoff.json，禁止扩大成整个私有目录。上述文件只记录提交、镜像、目标站点/配置指纹与验证元数据，不含私密变量值、账号、口令、SQL、真实数据库或临时 Docker 认证配置。

release.json 固定提交、原生平台、Web/server/migration 不可变引用、迁移文件与 SHA256，以及对应验收 run。仓库返回 OCI index 时选择唯一匹配平台的子 manifest 并验证 config digest；最终引用固定到该已验收平台的内容，不依赖可覆盖的标签。

构建、隔离验收或分发失败不会产生对应的完整镜像发布记录；目标阶段失败时，已有release.json也不代表部署成功，应检查目标持久attempt和运行状态。标签变化、远端内容不符、验收缺失或清理失败会拒绝后续分发。多个仓库上传不是事务：失败时可能已上传部分镜像，但缺少完整发布记录时不得进入目标部署，不通过删除他人镜像伪造回滚。镜像分发及目标阶段分别将自己的独立身份复制至临时私有DOCKER_CONFIG，退出时清理，不调用会记录密码参数的登录命令。

## 仍需完成与目标节点验收

本机没有 Docker，按用户要求不执行实际镜像/容器检查；本轮 CLI 编排测试使用清楚标注的模拟 Docker 引擎。Jenkins Declarative Linter、实际插件/凭据绑定、浏览器系统库、原生 Linux 构建、真实容器及镜像仓库分发仍要在受控节点验收。

[目标执行器](../releases/target-executor.md)已提供独立手动入口，Jenkins已通过单独审批的[目标阶段](target-stage.md)接入，实际节点仍待验收；完整窗口不得拆成绕过入口的独立 Docker/SQL 命令。其实际流程包含：共享目标数据库发布锁和本机备份文件锁，预检与维护状态，停止写入，迁移前备份及副本验证，Drizzle Kit 单次执行，API→Web→任务验收顺序，失败留在维护状态及适用回退。它们继续属于完整交付范围；已存在的备份与迁移维护锁不能代替这些步骤。

准备条件见[环境与凭据](environment-and-credentials.md)，目标更新与恢复原则见[发布与回退](../releases/release-and-rollback.md)。实现记录见[镜像产物链](../../iterations/2026-10-17-release-images/README.md)。语法与人工 Cause API 依据为 [Pipeline Syntax](https://www.jenkins.io/doc/book/pipeline/syntax/) 和 [RunWrapper](https://javadoc.jenkins.io/plugin/workflow-support/org/jenkinsci/plugins/workflow/support/steps/build/RunWrapper.html)。
