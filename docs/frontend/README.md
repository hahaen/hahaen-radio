# 前端技术文档

状态：已实现双语电台列表、搜索、播放器与独立音频引擎，真实目录和媒体播放已接入；本地字体、地球、流派与目录缓存已接入，电台收藏、历史、文件迁移、分享和多维筛选已接入，设置、睡眠、快捷键、系统媒体及沉浸基础已接入，曲目与音频增强继续按产品阶段推进。

| 子目录 | 文档 | 负责范围 |
| --- | --- | --- |
| `design/` | [夜航设计规范](design/night-voyage.md)、[本地字体](design/fonts.md) | 已确认概念图、设计变量、构图与双端视觉验收 |
| `application/` | [应用结构与状态](application/structure-and-state.md) | React、路由、查询、状态和样式 |
| `application/` | [收听入口与播放器](application/player-flow.md)、[探索界面](application/exploration.md)、[个人收听工具](application/listening-tools.md)、[收听设置](application/listening-controls.md) | 本阶段构图、真实状态与恢复边界 |
| `rendering/` | [Three.js 渲染](rendering/threejs.md)、[探索目录](rendering/exploration-data.md) | 场景、帧循环、交互与资源 |
| `audio/` | [音频引擎](audio/audio-engine.md) | 播放、HLS、音频处理与状态 |
| `platform/` | [浏览器与本地存储](platform/browser-and-storage.md) | 能力检测、存储和兼容性 |

完整依赖基线见[技术选型](../overview/technology-stack.md)。返回[文档导航](../README.md)。
