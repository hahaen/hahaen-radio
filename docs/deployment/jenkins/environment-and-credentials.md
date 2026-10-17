# Jenkins 环境与凭据

## 构建节点

根 Jenkinsfile 使用专用标签 haen-linux-build。节点需要 Node.js 24.9.0、pnpm 12.5.1、Git、Docker CLI/Buildx 及本机 Linux Docker 引擎；Playwright 的 Linux 系统库预先准备，浏览器版本随锁定包下载。CPU 架构与 HAEN_RELEASE_PLATFORM 一致，不默认使用模拟器或远端构建。

脚本仅接受本机 `/var/run/docker.sock`，DOCKER_CONTEXT 不设置，DOCKER_HOST 为空或 unix:///var/run/docker.sock；拒绝非 Linux 引擎、架构不符和额外 insecure registry 配置。专用节点拥有 Docker 权限，不让不可信 PR、其他用户或其他业务共享这份高权限环境。节点容量需覆盖三类镜像、构建缓存及临时 MySQL 的 1GiB 内存数据挂载，按实测配置，不能挤占正式数据库磁盘。

构建节点不挂载正式或开发服务配置，不设置 DB_*、AUDD_* 等全局运行凭据；不把已有项目目录、数据库卷、个人 Docker 配置或个人环境文件复制进检出。Jenkins 服务本身不运行应用。

| 任务环境变量 | 输入要求 |
| --- | --- |
| HAEN_IMAGE_REPOSITORY | 镜像仓库/项目路径，例如命名结构为 registry-host/team；不含账号、口令、scheme 或 query |
| HAEN_RELEASE_WEB_BASE_PATH | 非敏感发布路径，默认 `/`；镜像构建阶段显式传入 `HAEN_WEB_BASE_PATH`，如 `/radio/`；常规检查仍使用根路径 |
| HAEN_RELEASE_PLATFORM | linux/amd64 或 linux/arm64，与原生引擎及目标机一致 |
| HAEN_TEST_MYSQL_IMAGE | 已核对来源的完整 MySQL 8.0.46 镜像@sha256 引用；不使用浮动标签 |
| HAEN_RELEASE_APPROVERS | 获授权的 Jenkins 用户或组，交给 input 的 submitter；未设置则不能分发 |

SOURCE_COMMIT、PUBLISH_IMAGES、DEPLOY_TARGET 与 DEPLOY_SCOPE 是界面参数，见[流水线](pipeline.md)。任务为 Pipeline from SCM，使用 Git SCM，禁用任务侧自动触发；Configure/Replay 权限仅交给可信维护者，不让普通构建权限变成修改审批或读取凭据的权限。提交检出使用任务中已配置的仓库凭据；只有经审核的源码可以在该节点执行安装与测试。

## 镜像仓库认证

Credentials 中创建 ID 为 haen-image-registry-config 的 Secret file，仅供人工分发阶段绑定为 HAEN_REGISTRY_CONFIG_FILE。文件在节点权限须为 400 或 600，仅当前用户可读；只允许单个目标 registry-host 的 auths/auth 配置，不支持额外 credential helper、credsStore 或其他仓库条目。

示意结构只说明字段，不能把真实值填入可提交文件：

```json
{"auths":{"<registry-host>":{"auth":""}}}
```

auth 为账号与访问令牌的 Docker Basic 认证编码，编码后仍是秘密。由操作者在私有环境准备，不能从个人全量配置直接复制或写入仓库、镜像和普通日志。仓库地址需与 HAEN_IMAGE_REPOSITORY 的首段完全一致；服务使用可信 HTTPS，不配置远程 insecure registry。推送身份只授予本项目仓库的必要权限。

工具分发时写临时 700 目录及 600 config.json，凭据只通过 DOCKER_CONFIG 提供给 Docker/Buildx，finally 删除；临时目录不在归档清单。进程被强杀时 finally 可能未执行，应先核对本轮进程与目录归属，再清理残留；不自动删除其他活动任务资料。Jenkins Credentials 的原始文件由插件控制生命周期，勿把整个 workspace@tmp 或 `.local/` 归档。

## 首次目标节点验收

先在目标 Jenkins 使用 Declarative Linter 检查当前 Jenkinsfile，并核对 Pipeline Declarative、Git、Credentials Binding、Input 与 Supporting APIs 插件。可以在受控终端使用权限 600 的私有 netrc（账号与 API token 仅在其中保存）验证：

```sh
curl --fail --netrc-file "$JENKINS_NETRC_FILE" -F 'jenkinsfile=<Jenkinsfile' "$JENKINS_URL/pipeline-model-converter/validate"
```

JENKINS_URL 使用已核对的 HTTPS 地址，不在 URL 中携带凭据。上述命令只做语法验证，不创建或运行任务；接口行为见 [Jenkins Linter](https://www.jenkins.io/doc/book/pipeline/development/#linter)。实际版本、插件、凭据域、SCM 和 submitter 解析由目标实例验收，不以普通 Groovy 或模拟 CLI 通过代替。

首次使用 PUBLISH_IMAGES=false，完整执行工程与容器检查并检查资源归属/清理及脱敏产物。随后在获授权的人工构建中打开分发参数，由指定审批人确认，实际验证镜像仓库的摘要解析与认证清理。拒绝缺少验收、标签变动和清理失败的产物，并在未授权用户、非人工 Cause 下确认无法分发，并确认从阶段重启不可用、不能跳过审批。

## 目标应用服务器

已接入独立haen-linux-target人工更新阶段。独立审批、站点/数据库配置指纹、外部私有环境与只读拉取凭据haen-image-registry-pull-config见[目标阶段](target-stage.md)。构建节点不加载目标数据库配置，目标节点在交接核验后才显式加载；不将凭据文件或目标状态复制至stash/归档。

Ubuntu 24.04 LTS、Docker Compose、持久存储、域名/HTTPS、MySQL 8.0.46、可信CA、角色权限、固定备份helper与共享锁由操作者按[执行器](../releases/target-executor.md)准备；目标真实演练仍待执行。本轮没有创建节点、任务、连接、镜像仓库或服务器资源。当前直接使用目标agent，不增加SSH链路；未来采用SSH时仍须核验主机密钥。


返回[部署导航](../README.md)。
