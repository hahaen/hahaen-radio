# Jenkins 环境与凭据

## 构建节点

根 Jenkinsfile 使用专用标签 haen-linux-build。节点需要 Node.js 24.9.0、pnpm 12.5.1、Git、Docker CLI/Buildx 及本机 Linux Docker 引擎；Playwright 的 Linux 系统库预先准备，浏览器版本随锁定包下载。CPU 架构与 HAEN_RELEASE_PLATFORM 一致，不默认使用模拟器或远端构建。

脚本仅接受本机 `/var/run/docker.sock`，DOCKER_CONTEXT 不设置，DOCKER_HOST 为空或 unix:///var/run/docker.sock；拒绝非 Linux 引擎、架构不符和额外 insecure registry 配置。专用节点拥有 Docker 权限，不让不可信 PR、其他用户或其他业务共享这份高权限环境。节点容量需覆盖三类镜像、构建缓存及临时 MySQL 的 1GiB 内存数据挂载，按实测配置，不能挤占正式数据库磁盘。

构建节点不挂载正式或开发服务配置，不设置 DB_*、AUDD_* 等全局运行凭据；不把已有项目目录、数据库卷、个人 Docker 配置或个人环境文件复制进检出。Jenkins 服务本身不运行应用。

| 任务环境变量 | 输入要求 |
| --- | --- |
| HAEN_RELEASE_PLATFORM | linux/amd64 或 linux/arm64，与原生引擎及目标机一致 |
| HAEN_TEST_MYSQL_IMAGE | 独立容器专项使用的 MySQL 8.0.46 固定摘要，日常组件任务不重复该专项 |
| HAEN_RELEASE_APPROVERS | 获授权发起组件发布的 Jenkins 用户 ID，以逗号分隔；同时须在目标清单内 |

BRANCH 是唯一界面参数；完整提交和分发由流水线固定，范围由三个任务名分别确定，见[流水线](pipeline.md)。任务为 Pipeline from SCM，使用 Git SCM，禁用任务侧自动触发；Configure/Replay 权限仅交给可信维护者，不让普通构建权限变成修改审批或读取凭据的权限。提交检出使用任务中已配置的仓库凭据；只有经审核的源码可以在该节点执行安装与测试。

## 无头音频测试

没有声卡的 Linux 构建节点需要为构建身份准备隔离的虚拟音频输出。例如运行该身份拥有的 PulseAudio null sink，通过 `PULSE_SERVER` 指向仅该身份可访问的 Unix socket。服务和 socket 随节点启动，使用私有运行目录与默认身份认证，不开放公网音频端口，也不把该变量注入生产容器。

仅安装音频解码库不能证明音频输出端可用。已观察到 Firefox 能识别 MP3 但返回 `OnMediaSinkAudioError`，导致电台自动切换和后续界面断言超时；虚拟输出建立后，应先用受控 MP3 及原失败浏览器用例复验。当前四核节点的浏览器回归使用两个 worker，普通测试仍使用一个 worker。

Linux 构建节点的 Firefox 图形检查使用带认证、禁止 TCP 监听的 Xvfb 虚拟屏幕；通过构建身份的 `DISPLAY`、`XAUTHORITY` 连接。CI 的 Firefox 项目采用 headed 模式，Chromium 与 WebKit 保持原模式；生产客户端不依赖该屏幕。原生反馈显示此节点 Firefox headless 的 WebGL 2 不可用，同一版本在虚拟屏幕下可创建软件渲染上下文。

## 服务器本地镜像

构建和目标节点必须共用服务器的 `/var/run/docker.sock`。构建标签使用 `radio-local/<component>:<revision>-<validationRun>`；验收后只交接不可变镜像 ID，并绑定 Docker 引擎 ID。目标不下载缺失镜像：本地镜像丢失时明确失败，需重新构建或从独立备份恢复。

日常三个任务不使用 `HAEN_IMAGE_REPOSITORY`、`HAEN_REGISTRY_CA_FILE` 或镜像仓库 Secret file。`radio-registry`、`radio-registry-gateway` 不再是发布依赖。基础镜像仍按 Dockerfile 从上游获取，冻结依赖安装仍需要网络。

成功发布保留各组件当前及上一成功版本、相应配置快照和前端目录；数据库结构对应的迁移工具仍保留。仅清理本次替换掉的更早成功版本，不清理活动构建、其他业务镜像或共享构建缓存。失败/中止构建的未发布镜像需核对后清理。

## 首次目标节点验收

先在目标 Jenkins 使用 Declarative Linter 检查当前 Jenkinsfile，并核对 Pipeline Declarative、Git、Credentials Binding、Input 与 Supporting APIs 插件。可以在受控终端使用权限 600 的私有 netrc（账号与 API token 仅在其中保存）验证：

```sh
curl --fail --netrc-file "$JENKINS_NETRC_FILE" -F 'jenkinsfile=<Jenkinsfile' "$JENKINS_URL/pipeline-model-converter/validate"
```

JENKINS_URL 使用已核对的 HTTPS 地址，不在 URL 中携带凭据。上述命令只做语法验证，不创建或运行任务；接口行为见 [Jenkins Linter](https://www.jenkins.io/doc/book/pipeline/development/#linter)。实际版本、插件、凭据域、SCM 和 submitter 解析由目标实例验收，不以普通 Groovy 或模拟 CLI 通过代替。

先完成适用的工程与隔离镜像验证；获授权人工发起对应组件任务，实际验证本地构建、镜像 ID 交接与目标更新。当前没有额外分发开关；只有存在待迁移项时才确认数据库变更。拒绝缺少验收、标签变动或不同引擎的产物，并在未授权用户、非人工 Cause 下确认无法分发，并确认从阶段重启不可用、不能跳过审批。

## 目标应用服务器

已接入独立haen-linux-target人工更新阶段。数据库变更确认、站点/数据库配置指纹、外部私有环境见[目标阶段](target-stage.md)。构建节点不加载目标数据库配置，目标预检和更新通过显式 env-file 加载并核对目标指纹；不将凭据文件或目标状态复制至stash/归档。

Ubuntu 24.04 LTS、Docker Compose、持久存储、域名/HTTPS、MySQL 8.0.46、可信CA、角色权限、固定备份helper与共享锁由操作者按[执行器](../releases/target-executor.md)准备；三个目标任务已实际成功上线，结果见[正式部署记录](../../iterations/2026-10-17-production-deployment/README.md)。当前直接使用目标agent，不增加SSH链路；未来采用SSH时仍须核验主机密钥。


返回[部署导航](../README.md)。
