# 前端应用

状态：已实现双语列表、搜索、真实播放、地球、流派与完整目录缓存；电台收藏、历史、筛选、恢复及迁移已接入，设置、睡眠、快捷键、系统媒体和沉浸基础已接入，曲目与歌词、可选音量校准及调台音效已接入，真实设备和完整交付继续推进。验证边界见产品验收矩阵。

## 目录职责

| 目录 | 用途 |
| --- | --- |
| `src/app/` | 应用入口、路由和全局 Provider |
| `src/components/` | 共用界面组件 |
| `src/features/` | 后续按业务模块组织的代码 |
| `src/graphics/` | 已实现的 Three.js 地球、流派、交互与资源生命周期 |
| `src/library/` | 本地清单、文件迁移、筛选与收听面板 |
| `src/catalog/` | 完整场景目录、IndexedDB 缓存与共享候选集合 |
| `src/audio/` | 已实现的音频引擎、HLS、播放协调与可选音频增强 |
| `src/tracks/` | 当前元数据、歌词手动校时、歌曲收藏与外部搜索 |
| `src/platform/` | 睡眠截止时间、快捷键、闲置和系统媒体的独立生命周期 |
| `src/services/` | HTTP 客户端和数据查询 |
| `src/stores/` | Zustand 客户端共享状态 |
| `src/workers/` | 浏览器计算任务 |
| `src/locales/` | 国际化资源 |
| `src/styles/` | 设计变量和全局样式 |
| `public/` | 可公开且不经打包转换的静态资源 |

占位目录由 `.gitkeep` 保留；增加实际文件后可删除相应占位文件。前端目录不保存服务端密钥、数据库或真实环境配置。

技术约定见[前端文档](../../docs/frontend/README.md)，完整结构见[仓库目录](../../docs/architecture/repository-layout.md)。

## 测试与资源工具

- `tests/e2e/`：浏览器功能回归；`tests/performance/`：生产资源与持续运行检查；`tests/fixtures/`：可控测试素材。
- `playwright.config.ts`、`playwright.performance.config.ts`：浏览器测试配置；`tsconfig.tools.json`：测试与配置的类型检查。
- `scripts/`：本地字体、地理资源、测试音源生成与生产资源预算检查。
- `playwright-report/`、`test-results/`：被 Git 忽略的测试产物，固定输出到本应用内。

从仓库根继续使用 `pnpm test:e2e`、`pnpm test:performance`；也可用 `pnpm --filter @haen/web test:e2e` 或 `test:performance`，此前先构建共享契约。测试会自行启动所需服务，并显式以仓库根作为服务工作目录。
