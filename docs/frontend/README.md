# 前端技术文档

状态：已实现双语电台列表、搜索、播放器与独立音频引擎，真实目录和媒体播放已接入；本地字体、地球、流派与目录缓存已接入，电台收藏、历史、文件迁移、分享和多维筛选已接入，设置、睡眠、快捷键、系统媒体及沉浸基础已接入，曲目与歌词、手动识曲入口已按当前需求移除，可选音量校准与调台音效已接入，关于、隐私、帮助、资源署名与本地反馈说明已接入，真实设备与发布继续按产品阶段推进。

| 子目录 | 文档 | 负责范围 |
| --- | --- | --- |
| `design/` | [夜航页面整体优化](../iterations/2026-10-18-visual-polish/README.md)、[全屏地球与紧凑播放器](../iterations/2026-10-18-celestial-layout/README.md)、 [夜航设计规范](design/night-voyage.md)、[本地字体](design/fonts.md)、[标签页图标](../iterations/2026-10-18-favicon-concepts/README.md) | 已确认概念图、设计变量、构图与双端视觉验收；透明耳机海湾图标 v2 已接入，修正待发布 |
| `application/` | [应用结构与状态](application/structure-and-state.md) | React、路由、查询、状态和样式 |
| `application/` | [收听入口与播放器](application/player-flow.md)、[探索界面](application/exploration.md)、[个人收听工具](application/listening-tools.md)、[收听设置](application/listening-controls.md)、[曲目与歌词](application/tracks-and-lyrics.md)、[手动识曲](application/recognition.md)、[产品说明与帮助](application/information-and-help.md)、[精简故障报告](application/playback-diagnostics.md) | 本阶段构图、真实状态与恢复边界 |
| `rendering/` | [Three.js 渲染](rendering/threejs.md)、[探索目录](rendering/exploration-data.md) | 场景、帧循环、交互与资源 |
| `audio/` | [音频引擎](audio/audio-engine.md)、[可选音频增强](audio/enhancement.md) | 播放、HLS、音频处理与状态 |
| `platform/` | [浏览器与本地存储](platform/browser-and-storage.md) | 能力检测、存储和兼容性 |

完整依赖基线见[技术选型](../overview/technology-stack.md)。返回[文档导航](../README.md)。

全系统样式统一与验证见[任务记录](../iterations/2026-10-18-unified-visual-style/README.md)。

画面与信息层级优化见[任务记录](../iterations/2026-10-21-visual-refinement/README.md)。

地球亮度与清晰度优化见[任务记录](../iterations/2026-10-21-globe-clarity/README.md)。

地球与流派美化见[任务记录](../iterations/2026-10-21-globe-and-genre-polish/README.md)。

地球、品牌、收听区与浮层整体精修见[任务记录](../iterations/2026-10-21-listening-finish/README.md)。

电影感夜航构图、连续陆地与全系统控件调整见[任务记录](../iterations/2026-10-21-cinematic-night/README.md)。

磨砂界面、夜航动效与沉浸收听调整见[任务记录](../iterations/2026-10-21-search-surface/README.md)。

全屏沉浸环境与地图地点说明见[任务记录](../iterations/2026-10-21-immersive-environments/README.md)。

沉浸环境声浪动效见[任务记录](../iterations/2026-10-21-immersive-waves/README.md)。

电台地图地理位置修复见[任务记录](../iterations/2026-10-21-geographic-position/README.md)。

地球质感与流派星图精修见[任务记录](../iterations/2026-10-21-celestial-atlas/README.md)。
