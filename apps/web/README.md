# 前端应用

状态：已实现双语列表、搜索、真实播放、地球、流派与完整目录缓存；个人工具、曲目和完整交付继续推进。验证边界见产品验收矩阵。

## 目录职责

| 目录 | 用途 |
| --- | --- |
| `src/app/` | 应用入口、路由和全局 Provider |
| `src/components/` | 共用界面组件 |
| `src/features/` | 后续按业务模块组织的代码 |
| `src/graphics/` | 已实现的 Three.js 地球、流派、交互与资源生命周期 |
| `src/catalog/` | 完整场景目录、IndexedDB 缓存与共享候选集合 |
| `src/audio/` | 已实现的音频引擎、HLS 和播放协调 |
| `src/services/` | HTTP 客户端和数据查询 |
| `src/stores/` | Zustand 客户端共享状态 |
| `src/workers/` | 浏览器计算任务 |
| `src/locales/` | 国际化资源 |
| `src/styles/` | 设计变量和全局样式 |
| `public/` | 可公开且不经打包转换的静态资源 |

占位目录由 `.gitkeep` 保留；增加实际文件后可删除相应占位文件。前端目录不保存服务端密钥、数据库或真实环境配置。

技术约定见[前端文档](../../docs/frontend/README.md)，完整结构见[仓库目录](../../docs/architecture/repository-layout.md)。
