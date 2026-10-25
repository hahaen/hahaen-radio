# 本机编译、上传与 Docker 部署

2026-10-25 起替代 Jenkins。代码只推送 GitHub，服务器不拉取 Git、不保留项目源码。旧 Jenkins 专题保留为历史设计，不作为当前部署入口。

## 使用

在仓库根目录执行：

```sh
python3 deploy/local/release.py all
python3 deploy/local/release.py api
python3 deploy/local/release.py jobs
python3 deploy/local/release.py frontend
python3 deploy/local/release.py all --build-only
```

需要固定 Node.js 24.9.0、pnpm 12.5.1、Python 3.9+、可访问生产目标的 `hahaen-server` SSH 别名与已校验主机密钥；可用 `--host` 指定另一已配置目标。本机不需要 Docker。先提交跟踪文件改动，再构建发布，使 revision 与源码一致。新克隆仅配置 GitHub upstream，不添加 Gitee remote 或镜像同步。

本机依次验证相关应用的类型、单元测试、编译及前端体积限制。后端用锁文件生成仅运行依赖的 portable 包，扫描越界链接、密钥、环境文件及原生二进制；若将来引入平台相关依赖，发布会明确失败，届时必须改用匹配 Linux/amd64 的构建环境，不能复制 macOS 原生库。上传包只包含编译后服务、依赖、迁移材料、网页和运行配置模板，带 SHA-256 校验；上传和解压临时目录结束即删除。

## 服务器配置

稳定运行文件位于 `/home/hahaen/hahaen-radio/compose.yaml` 和 `release.env`，环境文件只引用现有私有 `config/api.env`、`jobs.env`、`migration.env`、MySQL CA 路径和每组件镜像；`migrations.sha256` 记录实际已执行的迁移材料摘要。外部网络 `radio_application`、已有三个 `radio_*` 命名卷继续使用；禁止删除卷或识曲预算状态。共享 Nginx 继续服务 `web/current`。

服务器使用 Docker 复制编译产物形成 Linux/amd64 运行镜像，不安装依赖、不编译应用。发布受项目文件锁保护；API 以 Docker ready 探针验收，任务检查持续运行且没有重启，再经实际 HTTPS 虚拟主机检查页面和 ready。普通发布拒绝迁移材料变化；先完成审核、隔离 MySQL 验证、停写、一致性备份及 Drizzle Kit 单次迁移，确认生产迁移历史后才能更新摘要。不可手工覆盖摘要来跳过迁移。

共享契约改变时审核混合版本兼容并优先 `all`，顺序为 API/任务后前端。独立发布仅适用于相互兼容版本。Android APK 仍需独立构建和安装。

## 保留与失败处理

发布期间临时保留旧运行镜像、Compose 和网页；失败恢复旧运行配置，数据库不自动降级。成功后仅保留当前镜像和静态目录，删除上传材料、被替换的项目镜像及 Docker 打包缓存。不同组件仍引用同一旧镜像时保留至最后一个引用替换。既有数据库、对象文件、运行配置、证书、日志及其他服务镜像不纳入清理。

成功后的回退需要从 Git 选择兼容版本重新编译上传。Git 自动提交/推送不等于授权上线，后续发布遵守用户当次范围。

## 本轮验证

实现与服务器迁移结果见[记录](../iterations/2026-10-25-local-upload/README.md)。
