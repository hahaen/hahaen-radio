# 本机编译、上传与 Docker 部署

2026-10-25 起替代 Jenkins。代码只推送 GitHub，服务器不拉取 Git、不保留项目源码。旧 Jenkins 专题保留为历史设计，不作为当前部署入口。

## 使用

用户已长期授权本项目在完成代码修改后自动发布受影响的生产服务。执行任务的助手按以下顺序完成，不再重复询问是否上线：实现及文档、Review 与复审、相关测试和构建、同步 upstream 后复审复验、逐文件暂存、提交推送、核对远端等于本地 HEAD，然后在仓库根目录运行对应发布入口。

仅前端变化发布 `frontend`；独立且兼容的 API 或任务变化分别发布 `api` 或 `jobs`；共享后端、契约、依赖或部署运行配置变化发布 `all`。纯文档、协作规则及仅 Android 变化无需更新服务器；Android APK 分发单独授权。用户当次要求不发布、只分析或指定环境时优先。

这是助手完成任务后的自动执行流程，没有 Git 推送钩子、Jenkins 或 GitHub Actions 发布触发器。手动提交推送本身不会启动服务器发布。Review、验证、同步、推送或远端核对失败时停止，不绕过前置检查。

发布入口：

```sh
python3 deploy/local/release.py all
python3 deploy/local/release.py api
python3 deploy/local/release.py jobs
python3 deploy/local/release.py frontend
python3 deploy/local/release.py all --build-only
```

需要固定 Node.js 24.22.1、pnpm 12.5.1、Python 3.9+、可访问生产目标的 `hahaen-server` SSH 别名与已校验主机密钥；可用 `--host` 指定另一已配置目标。本机不需要 Docker。先提交跟踪文件改动，再构建发布，使 revision 与源码一致。新克隆仅配置 GitHub upstream，不添加 Gitee remote 或镜像同步。

本机依次验证相关应用的类型、单元测试、编译及前端体积限制。后端用锁文件生成仅运行依赖的 portable 包，扫描越界链接、密钥、环境文件及原生二进制；若将来引入平台相关依赖，发布会明确失败，届时必须改用匹配 Linux/amd64 的构建环境，不能复制 macOS 原生库。上传包只包含编译后服务、依赖、迁移材料、网页和运行配置模板，带 SHA-256 校验；上传和解压临时目录结束即删除。

2026-10-27 将固定 Node.js 基线从 24.9.0 升级为 24.22.1，运行镜像固定官方多平台摘要。此变更需发布 `all`，更新 API、后台任务及同一提交构建的前端；不涉及数据库迁移。安全修复范围见 [Node.js 官方公告](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)。

## 服务器配置

稳定运行文件位于 `/home/hahaen/hahaen-radio/compose.yaml` 和 `release.env`，环境文件只引用现有私有 `config/api.env`、`jobs.env`、`migration.env`、MySQL CA 路径和每组件镜像；`migrations.sha256` 记录实际已执行的迁移材料摘要。外部网络 `radio_application`、已有三个 `radio_*` 命名卷继续使用；禁止删除卷或识曲预算状态。共享 Nginx 继续服务 `web/current`。

服务器使用 Docker 复制编译产物形成 Linux/amd64 运行镜像，不安装依赖、不编译应用。发布受项目文件锁保护；API 以 Docker ready 探针验收，任务检查持续运行且没有重启，再经实际 HTTPS 虚拟主机检查页面和 ready。普通发布拒绝迁移材料变化；先完成审核、隔离 MySQL 验证、停写、一致性备份及 Drizzle Kit 单次迁移，确认生产迁移历史后才能更新摘要。不可手工覆盖摘要来跳过迁移。

共享契约改变时审核混合版本兼容并优先 `all`，顺序为 API/任务后前端。独立发布仅适用于相互兼容版本。Android APK 仍需独立构建和安装。

## 保留与失败处理

不备份旧网页、运行配置或镜像，也不自动回退。先准备好新网页再替换当前目录；旧网页不复制归档。后端替换前写入本次运行配置，失败时保留尝试发布的配置供修复重试，不将其视为成功记录。仅全部检查通过才写入 `latest-release.txt`。

成功后仅保留当前镜像和静态目录，删除上传材料、被替换且已无容器引用的项目镜像及 Docker 打包缓存。其他组件仍在使用的镜像继续保留。既有数据库、对象文件、当前运行配置、证书、日志及其他服务不纳入旧版本清理；数据库结构迁移前的一致性备份要求不变。

失败可能已更新部分组件，需核对实际容器 revision 和前端内容，修复后重新编译上传。若需要旧代码，从 Git 选定兼容版本重建，不依赖服务器保留旧产物。

## 发布结果交付

发布脚本逐项输出 `frontend`、`radio-api` 和 `radio-jobs` 的状态：`SUCCESS` 表示所需运行/HTTPS 检查通过，`UNVERIFIED` 表示已尝试更新但尚未验证，`NOT_COMPLETED` 表示未完成更新，`NOT_REQUESTED` 表示本轮未选择。后端同时核对容器 revision 等于目标提交，前端核对 HTTPS 返回的 HTML 与上传产物一致。脚本失败时仍输出已验证组件的结果；上传成功、容器创建成功都不能单独当作发布成功。

最终交付明确说明整体是否发布成功、哪些组件成功、失败或未执行，以及无需更新的组件。列出实际发布版本和验证依据；部分成功不能只写“发布失败”或“全部成功”。SSH 中断或缺少输出时通过只读检查补充实际状态，无法确认时如实标注未验证。

## 本轮验证

初始实现与服务器迁移结果见[记录](../iterations/2026-10-25-local-upload/README.md)；自动发版及取消旧版本备份见[后续记录](../iterations/2026-10-25-automatic-release/README.md)。
