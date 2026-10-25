# 本机上传部署与 Jenkins 退役

2026-10-25 用户授权移除 my-134 Jenkins、服务器代码及构建缓存、Gitee 仓库及双推配置；生产数据保留，确认采用本机编译上传、Docker 更新，成功仅留最新产物。

实现：`deploy/local/release.py`、运行 Dockerfile/Compose、锁内发布和失败恢复；当前入口见[本机上传](../../deployment/local-upload.md)。无业务接口、SQL 或 Android 源码变化。旧 Jenkinsfile/凭据示例删除，历史回归工具保留为离线工程材料。

Review：仅覆盖本轮部署脚本、运行配置、Git 目标和文档。已修正未登录探针应为 HTTP 401、业务码 1；复核不删除持久卷，源码目录与实际挂载分离。

正式新版本上线及最终清理尚未执行，当前验证见下方记录。


## 首轮与 upstream 同步后复验

PASS：本轮差异 Review 与复审；修正 Java 25 选择、真实 HTTP 401 探针、仅 SQL/JSON 迁移摘要、构建前后源码一致性检查。明确逐项目锁、私有配置边界、失败恢复及最新产物清理范围；无未解决问题。

PASS：逐文件 stash 保存与 SHA-256 恢复核对，`git pull --ff-only` 返回 Already up to date；无冲突，恢复核对后删除本轮 stash。记账首次拉取遇到 SSH 连接中断，重试成功后才恢复改动，未跳过同步。

PASS：每项目 4 项上传产物安全测试、Bash/Python 语法、差异空白检查；电台文档 194 文件、1413 本地链接与变更测试的 ESLint 检查。电台 upstream 复验 436 项 PASS、15 项数据库环境专项跳过，生产构建 PASS；记账 Java 25 `mvn verify` 90 项 PASS、6 项依赖专用开发环境测试跳过，H5 类型检查/生产构建 PASS。此次无数据库结构或业务代码变更，数据库写入专项不适用。

PASS：本机产物上传后，在服务器构建 Linux/amd64 运行镜像；电台模块导入/运行依赖检查通过，记账 Temurin 25.0.4.1 运行镜像检查通过。电台迁移镜像只读核对 pending=[]，本地迁移材料一致；记账当前运行 JAR 与本机 JAR 的 11 份迁移完全一致，无需生产 SQL。

PARTIAL：业务网络已迁移到 `haen_application`，保留 172.20.0.1 网关，Nginx 配置及两服务 HTTP 检查通过。实际新版本上线与最终清理结果将在完成后追加。

复审修正：在替换网页前即设置恢复标记，复制失败时也能从事务备份恢复旧网页。Python 安全测试与 Bash 语法再次通过。
