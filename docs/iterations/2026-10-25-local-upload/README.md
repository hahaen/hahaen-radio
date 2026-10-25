# 本机上传部署与 Jenkins 退役

2026-10-25 用户授权移除 my-134 Jenkins、服务器代码及构建缓存、Gitee 仓库及双推配置；生产数据保留，确认采用本机编译上传、Docker 更新，成功仅留最新产物。

实现：`deploy/local/release.py`、运行 Dockerfile/Compose、锁内发布和失败恢复；当前入口见[本机上传](../../deployment/local-upload.md)。无业务接口、SQL 或 Android 源码变化。旧 Jenkinsfile/凭据示例删除，历史回归工具保留为离线工程材料。

Review：仅覆盖本轮部署脚本、运行配置、Git 目标和文档。已修正未登录探针应为 HTTP 401、业务码 1；复核不删除持久卷，源码目录与实际挂载分离。

实现、验证及正式上线结果见下方记录。


## 首轮与 upstream 同步后复验

PASS：本轮差异 Review 与复审；修正 Java 25 选择、真实 HTTP 401 探针、仅 SQL/JSON 迁移摘要、构建前后源码一致性检查。明确逐项目锁、私有配置边界、失败恢复及最新产物清理范围；无未解决问题。

PASS：逐文件 stash 保存与 SHA-256 恢复核对，`git pull --ff-only` 返回 Already up to date；无冲突，恢复核对后删除本轮 stash。记账首次拉取遇到 SSH 连接中断，重试成功后才恢复改动，未跳过同步。

PASS：每项目 4 项上传产物安全测试、Bash/Python 语法、差异空白检查；电台文档 194 文件、1413 本地链接与变更测试的 ESLint 检查。电台 upstream 复验 436 项 PASS、15 项数据库环境专项跳过，生产构建 PASS；记账 Java 25 `mvn verify` 90 项 PASS、6 项依赖专用开发环境测试跳过，H5 类型检查/生产构建 PASS。此次无数据库结构或业务代码变更，数据库写入专项不适用。

PASS：本机产物上传后，在服务器构建 Linux/amd64 运行镜像；电台模块导入/运行依赖检查通过，记账 Temurin 25.0.4.1 运行镜像检查通过。电台迁移镜像只读核对 pending=[]，本地迁移材料一致；记账当前运行 JAR 与本机 JAR 的 11 份迁移完全一致，无需生产 SQL。

PASS：业务网络已迁移到 `haen_application`，保留 172.20.0.1 网关，Nginx 配置及两服务 HTTP 检查通过。旧记账容器保留原网络模式，已用稳定 Compose 重建后恢复；最终上线及清理结果如下。

复审修正：在替换网页前即设置恢复标记，复制失败时也能从事务备份恢复旧网页。Python 安全测试与 Bash 语法再次通过。


## 正式上线与清理结果（2026-10-25）

PASS：分别实际执行 `python3 -B deploy/local/release.py all`。记账后端/H5 发布源码为 `30ebe59`，电台 API/任务/网页为 `aa17c16`。本机重新测试和编译、SHA-256 上传、服务器仅复制编译产物形成运行镜像、服务替换、公网入口检查和旧产物清理完整成功；三个应用容器均 running，重启数为 0，电台 API healthy。

PASS：Nginx、记账与电台页面及直接引用的 5+5 个脚本/样式/图标实际 HTTPS 返回正确资源类型；ready 包含 database/catalog=true，随机中国电台接口成功。记账受保护 API 返回预期 HTTP 401。最初追加探针误写 `/catalog/stations/random-china` 返回 404，按实际路由更正为 `/stations/random-china` 后通过；未修改业务接口。

PASS：删除 Jenkins 控制器容器/镜像、两个代理与音视频 CI 服务、工作区、Java agent 运行时、专用账号/SSH home/ACL/sudo 与 Docker 权限、Nginx 的 Jenkins 路由和旧代理配置备份。旧 `jenkins_default` 网络由同网关的 `haen_application` 替代。当前服务清单无 Jenkins，相关 systemd/活动配置无匹配，`/jenkins/` 返回 404。

PASS：删除 `/home/hahaen/hahaen-ledger` 和电台 `source/`、旧状态快照、构建 cache、归档、旧网页版本、旧应用镜像与旧迁移工具。项目运行目录无 `.git`/`Jenkinsfile`，上传临时目录为空。只保留当前运行配置、当前网页和应用镜像、当前数据库迁移工具，以及现有备份所需的 Node/MySQL/编译后工具；不保留两项目源码树。保留 MySQL/Redis/MinIO、业务文件、配置密钥、证书、电台日志卷与识曲预算状态，不删除 Docker 卷。

PASS：清理后根分区总 42,156,257,280 字节，已用 18,485,022,720，可用 21,829,373,952（约 20.33 GiB），`df -h` 显示可用 21G/使用率 46%；开始时约 8.6G/78%。Docker 构建缓存 0B，9/9 容器运行；电台服务器目录由约 1.6G 降至 296M，记账运行配置目录 20K。

PASS：Gitee 仓库由用户删除，随后工作台显示两条已删除仓库动态；两本机仓库无 Gitee remote/双推，只向 GitHub main 普通推送。初次实施提交均已核对远端等于 HEAD。历史工程文档保留追溯用途，其旧命令不再是当前操作规范。

复审补充：成功更新 API 后同步现有备份工具的 `backup-version/current`；本次已实际更新并读取核对。新增脚本分支仅更新版本标记，未执行备份、迁移或业务 SQL。后续回退须从 Git 选定兼容版本重新构建上传；成功后不保留旧发布产物。

服务更新状态：记账后端、H5，电台 API、任务及网页均已更新；Nginx 已调整并验证。微信小程序和 Android 无本轮客户端源码变化，不需要更新，未上传、提审或分发客户端。
