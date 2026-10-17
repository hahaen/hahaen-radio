# 应用目录归类

## 需求与变更

按应用职责组织仓库：数据库表结构与迁移归属后端，前端测试与资源工具归属前端；保留根目录统一命令入口。

- `migrations/` 移至 `apps/server/migrations/`，同步 Drizzle、迁移预检、备份核对、隔离测试和发布清单路径。表结构继续位于 `apps/server/src/db/schema.ts`。
- 浏览器功能测试、独立性能测试及音频素材移至 `apps/web/tests/`；Playwright 配置、工具类型检查及前端资源脚本归入 `apps/web/`。
- 本地 HTML 报告与运行产物移至 `apps/web/playwright-report/`、`apps/web/test-results/`，配置固定后续输出路径，继续由 Git 忽略。
- 部署工具测试归入 `deploy/tests/`，镜像、交接、目标更新与日志探测脚本归入 `deploy/scripts/`，同步 Jenkins 与受控部署入口；共享包、文档检查、构建清理和分类文档保留在根目录。
- 根 `pnpm test:e2e`、`pnpm test:performance` 转发至 Web，普通检查仍覆盖全部应用和部署测试。更新文档导航、路径说明及 Docker 上下文排除。

## Review 与验证

仅 Review 本任务的移动及路径、配置、命令和文档变更；重点检查源码与编译产物相对路径、服务工作目录、测试发现、迁移清单、构建上下文及私有文件排除。修正移动后的共享契约及部署模块导入，格式修正后复审无未解决问题，再执行相关验证。

- `pnpm check`：格式、Lint、类型检查、普通测试、生产构建及资源预算通过；220 项测试通过，10 项需要专项环境的测试按默认配置跳过。
- `pnpm docs:check`：124 个 Markdown 文件、779 个本地链接通过；检查已覆盖移动后的应用及部署说明。
- 从仓库根加载两份新 Playwright 配置，分别发现 260 个功能用例及 6 个独立性能用例。
- `pnpm test:e2e application.spec.ts audio.spec.ts --grep 'same-origin|Chinese and English|decodes controlled' --workers=2 --retries=0`：20 项通过，覆盖 Chromium、Firefox、WebKit 与手机 Chromium 模拟项目的双语、同域 API、MP3/AAC/HLS 解码及暂停恢复。执行时显式设置 `NODE_ENV=test`，并以空 `DB_HOST`、`DB_NAME` 覆盖本地配置，未连接真实数据库。
- `pnpm test:performance resources.spec.ts --workers=2 --retries=0`：四项目 4 项资源检查通过，验证生产包、源码控制器夹具和移动后测试输出路径；未重复执行十分钟持续测试。
- 编译后的迁移预检、Drizzle 输出位置与发布清单一致读取三条迁移，无数据库连接。3 条 SQL、4 份迁移元数据和 11 份媒体素材共 18 个文件与移动前逐字节一致。
- 移动后的相对模块导入、Git 忽略及差异空白检查通过，原根目录迁移、测试和测试报告目录已移除。

同步 upstream 无新增提交或冲突；恢复后核对 156 个任务文件及删除状态的内容指纹一致。同步后再次 Review 路径、调用入口及材料完整性，并复跑迁移计划与部署工具 26 项测试，全部通过；构建及浏览器结果适用于内容未变的同一版本。

## 环境与交付边界

本次为目录调整，无数据库结构或业务行为变更，无新增运行环境变量；不执行 SQL，不连接开发或正式库，不触发 Jenkins、镜像分发或实际发布。实际 Docker/服务器和真机专项保持既有验收边界。后续发布使用同一提交构建各目标，沿用既有发布流程。

历史归档保留当时的路径与结果；当前执行路径以[仓库结构](../../architecture/repository-layout.md)为准。返回[归档导航](../README.md)。
