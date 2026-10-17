# Jenkins 人工目标发布

根 Jenkinsfile 已接入同一任务中的目标阶段，调用已有[发布执行器](../releases/target-executor.md)。代码推送不触发发布；PUBLISH_IMAGES 和 DEPLOY_TARGET 均默认 false。当前没有创建远端任务、配置节点或执行正式发布，实际 Jenkins DSL、插件与 Linux/Docker 行为仍待目标环境验收。

## 执行链与审批

1. SOURCE_COMMIT 固定已审核完整提交；先冻结检查、三浏览器回归、同提交镜像构建、隔离容器验收。DEPLOY_TARGET=true 但 PUBLISH_IMAGES=false 会在首次检查时拒绝。
2. 人工确认镜像分发后，生成不可变 release.json；分发审批不授予目标更新权限。
3. 仅选择目标更新时，seal 读取同任务 build/image-check/release，检查提交、平台、验收run、镜像仓库与迁移摘要，生成 deploy-handoff.json 和完整 SHA256。
4. 指定目标审批人确认目标名、HTTPS站点、配置指纹、范围、提交和交接摘要；输入对应的外部停写、分端兼容、空库初始化与首次目录同步确认。四项确认默认 false，按实际状态选择，不自动代填。
5. 审批上下文存入 Jenkins CPS Map，跨节点使用明确的 withEnv 绑定，不重新从目标节点同名环境变量读取目标或范围。随后才分配 haen-linux-target 节点。
6. 目标节点分配本次发布的新独占工作区，确认其为空后重新检出同提交，固定工具链、冻结安装并构建服务端工具。stash/unstash 只传递同一run的交接JSON，不传配置、凭据、依赖或备份。
7. accept 校验原始文件SHA与全部上下文、源码/迁移，检查私有环境文件后独占生成600的 target-release.json。执行器在数据库连接前再核对该文件SHA与配置指纹，读取target配置后再核对实际站点。
8. 仅此时绑定独立镜像拉取凭据，通过显式 Node env-file 调用编译入口。文件锁和数据库release锁覆盖完整维护/备份/迁移/启动窗口。成功条件仍以执行器的持久状态、探针和实际检查为准。

PUBLISH_IMAGES=true、DEPLOY_TARGET=false 只分发。DEPLOY_SCOPE 支持 full、web、server；分端更新仍要求人工兼容确认，完整发布不跳过真实迁移、备份和目录就绪检查。回退/恢复沿用执行器的明确人工流程，本流水线不自动回退、不自动重试失败迁移。

## 目标配置与角色

| 配置 | 位置与作用 |
| --- | --- |
| HAEN_TARGET_NAME | 任务配置，2–40位小写字母/数字/连字符，首位字母；稳定的人类可识别目标名 |
| HAEN_TARGET_SITE | 任务配置，无端口/尾斜杠的HTTPS域名；必须等于target私有JSON的site |
| HAEN_TARGET_DATABASE_FINGERPRINT | 任务配置，64位连接配置指纹，与目标发布身份读取的 host/port/库名/TLS/CA 完全一致 |
| HAEN_DEPLOY_APPROVERS | 目标发布 input 的获授权用户或组；与镜像分发审批分开配置 |
| HAEN_DEPLOY_ENV_FILE | 仅目标节点配置，仓库/工作区外的规范绝对路径，目标运行用户所有、600、普通文件；示例模板见 deploy/jenkins/deploy.env.example |
| haen-image-registry-pull-config | Jenkins Secret file，目标阶段绑定为 HAEN_REGISTRY_CONFIG_FILE；仅项目仓库拉取权限，不复用推送身份 |

这些配置不提供默认实际值。公开文档和模板只记录变量与用途，真实内容由操作者保存到目标环境。Jenkins内部生成 HAEN_CI_DEPLOY、HAEN_APPROVED_HANDOFF_SHA256、HAEN_EXPECTED_RELEASE_SHA256、HAEN_EXPECTED_DATABASE_FINGERPRINT、HAEN_EXPECTED_SITE、HAEN_RELEASE_FILE 和审批旗标，不在私有环境文件中另配这些控制值。

配置指纹可由操作者在准备好可信CA、私有配置及同版本编译工具后只读计算（不连接数据库、不打印凭据）：

```sh
node --env-file=/etc/haen/deploy.env --input-type=module -e 'import {readDatabaseConfig,databaseTargetFingerprint} from "./apps/server/dist/config/database.js"; console.info(databaseTargetFingerprint(readDatabaseConfig()))'
```

它绑定连接配置，不证明DNS/代理后实际实例身份、权限或停写；部署者仍须保证所有连接指向同一MySQL主实例并完成真实TLS/主机名验证。CA或目标配置改变后重新核对指纹，不能跳过匹配检查。

haen-linux-build 与 haen-linux-target 应为不同节点，标签不得互相混用。目标节点直接位于既定应用主机，仅一个executor、专用于可信发布任务；不在该节点执行任意PR或无关任务。顶层构建agent在目标阶段仍被保留，不能将唯一构建executor也当作目标节点。当前不引入远程SSH发布；若改变执行拓扑，应单独评估并验证。

目标节点需要Node.js 24.9.0、pnpm 12.5.1、Git、本机Docker/Compose及执行器要求的持久目录、共享锁、备份helper/最小sudo权限。目标阶段不deleteDir旧工作区；新目录已存在内容时拒绝复用，不自动清理。工作区只存源码、构建输出和非敏感交接；路径不含空白或引号，常见@2工作区后缀可接受。状态、维护目录、私有配置、备份与证书均放工作区外。发布完成后，管理员按已结束run、实际进程及持久状态核对后清理对应源码工作区，并纳入已有磁盘/保留策略；异常或仍在执行的run保留现场，不能按目录名盲删。节点和发布/备份身份准备见[目标执行器](../releases/target-executor.md)。

目标环境文件由Node显式加载，模板仅有空值；NODE_ENV必须为production。accept会检查实际路径，拒绝指向新旧工作区的路径别名、非600文件及NODE_OPTIONS等进程启动/调试注入变量。容器自己的raw env文件仍按执行器规则配置，不能与这个Node环境文件的解析格式混用。目标阶段也清空继承调试选项并保持TLS校验。

## 产物与失败处理

只新增归档 deploy-handoff.json，仍使用精确文件清单；target-release.json、target私有配置、Jenkins Secret file、临时认证目录和目标状态均不扩大归档。交接包只含受校验release、站点/目标名/配置指纹、范围和源信息，拒绝未知字段，不能塞入凭据。它是发布预案和完整性证据，不是数字签名或成功部署报告。

同一run的stash在审批前准备，拒绝审批后不进入目标节点；不配置preserveStashes、不从历史构建取“最近成功”产物。禁用阶段重启与同任务并发；没有给状态性阶段增加retry。Configure/Replay和目标节点权限仍只交给可信维护者，Jenkins管理员权限按目标实例实际机制管理。

交接失败不会调用目标执行器；数据库配置指纹或已接受文件不符会在连接前拒绝。实际发布过程中失败按持久attempt和维护状态处理，下一轮使用新工作区，不清除旧文件或持久记录。Jenkins/节点断开或强杀时不能凭控制台结束推断目标进程已退出，应核对现存进程、两层锁、容器及最后阶段，再按明确恢复流程处理。

## 部署前实际补测

本机检查涵盖原生Node交接CLI、两个干净临时Git检出间传递、摘要/目标/范围错配拒绝、私有文件与CI上下文校验；不代表Jenkins CPS、input、stash、Credentials或Linux发布通过。

目标需执行Declarative Linter，并演练：默认不部署、不分发直接部署拒绝、非人工Cause/未授权审批拒绝、四项确认默认false、审批后站点/范围/摘要改变拒绝、跨节点传递权限、只读拉取凭据、数据库错配不连接、完整/分端发布、迁移失败保留、节点/控制器中断及明确恢复。Docker实测按用户要求留在实际部署环境；不得以本机帮助工具测试替代。

语法与传递机制依据：[Pipeline Syntax](https://www.jenkins.io/doc/book/pipeline/syntax/)、[stash/unstash](https://www.jenkins.io/doc/pipeline/steps/workflow-basic-steps/)。返回[流水线](pipeline.md)、[环境与凭据](environment-and-credentials.md)或[归档记录](../../iterations/2026-10-17-jenkins-target/README.md)。
