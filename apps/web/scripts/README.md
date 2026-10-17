# 前端资源脚本

本目录只放前端专用工具。以下命令均从仓库根运行，脚本通过自身位置解析应用内资源，不依赖调用方工作目录。

| 脚本 | 用途 |
| --- | --- |
| `check-web-budget.mjs` | 检查本应用 `dist/` 的文件、体积、gzip 与摘要；也可运行 `pnpm --filter @haen/web check:budget` |
| `prepare-fonts.mjs` | 生成本地字体、许可、摘要及 CSS；普通构建不联网生成字体 |
| `prepare-land.mjs` | 从固定摘要的地理输入生成本地大陆资源 |
| `generate-audio-fixtures.mjs` | 使用 FFmpeg 生成 `tests/fixtures/audio/` 的自制测试音源 |

操作前提见[字体](../../../docs/frontend/design/fonts.md)、[离线地理](../../../docs/data/offline-geography.md)、[测试音源](../tests/fixtures/audio/README.md)和[资源预算](../../../docs/engineering/resource-budgets.md)。跨应用工具保留在根 [scripts](../../../scripts/README.md)。
