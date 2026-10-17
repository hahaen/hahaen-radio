# 服务器项目目录

Radio 的服务器总目录统一为 `/home/hahaen/hahaen-radio/`。源码和私有配置分开，Jenkins 每次仍在专用工作区检出固定提交；不能在服务器源码副本中临时修改后绕过发布检查。

| 子目录 | 用途与权限 |
| --- | --- |
| `source/` | 完整源码检出及编译工具，发布身份所有；具体提交以 Git 和构建归档为准 |
| `config/` | target JSON、API/jobs/migration/deploy/backup 环境文件和数据库 CA；身份文件 600、目录按维护组受限 |
| `runtime/` | 固定 Node、pnpm、Java、原生 MySQL 客户端和受控运维包，管理员所有 |
| `jenkins/build/`、`jenkins/target/` | 两个隔离身份的 home、agent、工作区和缓存，各自 700；agent secret 600 |
| `ci/` | 构建专用虚拟音频配置；显示认证材料仍在构建身份的私有 home |
| `data/` | API/jobs 日志、识曲状态、Caddy 数据与配置；Docker 命名卷通过 local bind 驱动持久指向这里 |
| `registry/` | 项目私有镜像仓库数据、TLS 和分发/拉取配置；秘密文件及目录保持独立权限 |
| `state/`、`maintenance/`、`locks/` | 发布持久状态 700、无敏感内容的维护标记 755、管理员控制的共享锁目录 750 |
| `backups/`、`backup-version/`、`backup-home/` | 备份身份的私有目录和实际应用版本记录；不代表已有独立存储副本 |
| `systemd/`、`operations/` | 项目服务定义、固定 helper 和私有管理工具；管理员控制，不给构建/发布身份写权限 |
| `cache/`、`archive/` | 本轮下载缓存及管理员私有归档；归档不进入源码、镜像或 Jenkins 公开产物 |

## 路径与运行条件

Jenkins 两个节点的 remote FS 已指向上述 agent 目录，`HAEN_DEPLOY_ENV_FILE`、`XAUTHORITY`、运行时 PATH、systemd 工作目录与私有 target/备份路径同步采用总目录。环境文件仍由启动命令显式加载；迁移目录不会让变量自动生效。

迁移前先确认运行构建结束、没有发布进程或迁移，再停止项目 agent 与 CI 辅助服务。移动保留原所有者、权限和文件内容；节点重新上线后核对配置指纹、私有 target 路径、虚拟音频和镜像仓库认证。目录整理本身不执行 SQL、不清理发布状态、不重跑迁移。

旧绝对路径保留兼容链接，实际内容存放在总目录。旧执行器对 `/var/lib/haen-maintenance/` 使用严格 `lstat` 与 fd/inode 验证，因此该路径采用受保护的持久 bind mount 指向 `locks/`，保持原锁 inode；不能用普通符号链接或新锁文件替代。挂载已写入系统 fstab，重启后须确认挂载存在再发版。

systemd 的系统入口与固定 sudo helper 保留在标准系统位置，指向项目内受控文件；`/run/` 中的音频 socket 属于临时运行资源。Docker 引擎、共享 Jenkins 主目录与 Credentials、现有 Nginx/MySQL 等仍在各自原位置，未搬动共享服务或数据库数据。项目命名卷的设备路径记录在受控管理材料中，不通过删除持久卷修复配置。

## Docker 命名

Compose 项目为 `radio`，三个常驻容器固定为 `radio-web`、`radio-api`、`radio-jobs`，发布时重建同名容器；应用网络为 `radio_application`，命名卷以 `radio_` 开头，仍绑定 `data/` 中原设备路径。项目私有仓库容器为 `radio-registry` 与 `radio-registry-gateway`，镜像命名空间为 `radio`。共享 MySQL、Nginx 与 Jenkins 保留各自名称。目标执行器同时核对固定容器名与 Compose 归属，拒绝接管名称冲突的其他容器。

## 当前验证边界

2026-10-18 已实际完成目录归并，两个 Jenkins 节点重新在线，私有镜像仓库认证读取成功，配置指纹与私有路径检查通过，音频身份认证通过；共享 Jenkins、博客和个人页面仍返回 200。构建 #8 由用户终止，未进入正式迁移或目标更新；首次上线从新目录继续执行，最终结果见[正式部署记录](../../iterations/2026-10-17-production-deployment/README.md)。

当前没有独立备份位置；每日副本定时器未启用，后续非空库结构升级仍必须先完成独立存储配置与校验。

返回[部署导航](../README.md)或[目标执行器](../releases/target-executor.md)。
