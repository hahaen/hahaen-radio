# 前端技术文档

Safari 分享面板、主屏幕与 Mac 程序坞深色图标见[当前修正](../iterations/2026-10-24-safari-dark-icon/README.md)及[平台说明](platform/browser-and-storage.md)，早期实现见[图标记录](../iterations/2026-10-18-favicon-concepts/README.md)。

可选账号登录与收藏、历史自动同步见[任务记录](../iterations/2026-10-23-account-sync/README.md)，未登录保持本机使用方式。

刷新恢复与地球入场连续性优化见[任务记录](../iterations/2026-10-23-startup-continuity/README.md)。

地球播放动效的帧连续性修复见[任务记录](../iterations/2026-10-23-globe-frame-pacing/README.md)。

地球播放声波、暂停渐隐与恢复播放视角规则见[任务记录](../iterations/2026-10-22-globe-sound-waves/README.md)。

当前收听区、搜索与流派条样式见[收听页面布局优化](../iterations/2026-10-22-listening-layout/README.md)。

沉浸场景与地球页的色调统一见[沉浸收听配色](../iterations/2026-10-22-immersive-palette/README.md)。

播放与切台自动转向电台标记见[播放电台居中](../iterations/2026-10-22-globe-playback-centering/README.md)。

状态：已实现双语电台列表、搜索、播放器与独立音频引擎，真实目录和媒体播放已接入；本地字体、地球、流派与目录缓存已接入，电台收藏、历史、文件迁移、分享和多维筛选已接入，设置、睡眠、快捷键、系统媒体及沉浸基础已接入，曲目与歌词、手动识曲入口已按当前需求移除，可选音量校准与调台音效已接入，关于、隐私与帮助已接入，资源署名与问题反馈界面已按需求移除，真实设备与发布继续按产品阶段推进。

| 子目录 | 文档 | 负责范围 |
| --- | --- | --- |
| `design/` | [夜航页面整体优化](../iterations/2026-10-18-visual-polish/README.md)、[全屏地球与紧凑播放器](../iterations/2026-10-18-celestial-layout/README.md)、 [夜航设计规范](design/night-voyage.md)、[本地字体](design/fonts.md)、[标签页图标](../iterations/2026-10-18-favicon-concepts/README.md)、[Safari 深色图标](../iterations/2026-10-24-safari-dark-icon/README.md) | 已确认概念图、设计变量、构图与双端视觉验收；标签页图标透明，Safari 应用图标使用不透明深色底 |
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
