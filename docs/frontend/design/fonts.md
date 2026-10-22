# 本地字体资源

夜航字形保持[设计规范](night-voyage.md)的角色：Inter 用于拉丁界面和品牌，系统中文无衬线与 Noto Sans SC 用于中文界面，Noto Serif SC 用于手机展示标题；JetBrains Mono 用于坐标、统计和时间，IBM Plex Mono 保留为回退。

字体以 WOFF2 放在 `apps/web/public/fonts/`，许可证与来源摘要随资源交付；CSS 仅请求本站 `/fonts/` 路径，普通安装、构建和浏览不访问字体服务。使用 `font-display: optional`，主要字体提前预加载；字体来不及在首次绘制前就绪时，本次页面保留系统回退，避免显示后的字形替换。失败或未覆盖的字形沿用系统回退，不能让字体加载阻断选台或收听。

## 覆盖与许可

- 中文资源覆盖当前双语语言文件和农历月日格式器中的汉字、标点及基本拉丁字形，外部电台名称、其他语言和未覆盖字形由系统字体显示，不动态向字体服务发送电台或用户内容。
- Inter 提供 300–650、中文正文提供 300–600 可变字重，衬线与等宽字重为 400。没有请求的字重保留浏览器匹配，不伪造额外字体文件。
- 五个家族均随附 SIL Open Font License 1.1 和版权声明，见字体目录中的 `*-LICENSE.txt`；原始许可入口分别是 [Noto Serif SC](https://github.com/google/fonts/blob/main/ofl/notoserifsc/OFL.txt)、[Noto Sans SC](https://github.com/google/fonts/blob/main/ofl/notosanssc/OFL.txt)、[Inter](https://github.com/google/fonts/blob/main/ofl/inter/OFL.txt)、[JetBrains Mono](https://github.com/google/fonts/blob/main/ofl/jetbrainsmono/OFL.txt) 和 [IBM Plex Mono](https://github.com/google/fonts/blob/main/ofl/ibmplexmono/OFL.txt)。
- 许可证仅统一换行并去除行尾空白，保留原文字、版权和条款。
- 本地文件 SHA-256、字形范围与字重记录在 `source.json`。不在运行时下载字体，也不把远程服务可用性当作构建前提。

## 更新字形

新增或修改中文界面文案后，在开发环境手动执行：

```sh
node apps/web/scripts/prepare-fonts.mjs
pnpm exec prettier --write apps/web/src/styles/fonts.css apps/web/public/fonts/source.json
```

生成脚本同步更新入口 HTML 中三个预加载字体的版本号，使其与 CSS 请求一致，避免重复下载。再运行适用检查，确认新文字有覆盖且系统回退仍有效。此生成步骤需要系统 `curl` 和网络，通过 Google Fonts 官方 CSS API 请求项目公开界面文字对应的字形，并验证 HTTPS 来源、WOFF2 格式、大小与许可。所有家族均成功获取后才写入本地文件；资源已提交，因此普通用户构建无需执行生成步骤。

实现使用[官方字体请求接口](https://developers.google.com/fonts/docs/css2)的文字子集能力，接口本身可能更新；重新生成后的二进制与摘要应作为新的资源差异审查，不假定远端永远返回同一文件。

## 2026-10-22 首屏文字显示调整

- 需求：首次进入及刷新时，整页文字突然出现，视觉上有闪动感。
- 变更：HTML 提前提供与页面一致的墨绿底色；预加载 Inter、Noto Serif SC 与 JetBrains Mono；全部本地字体使用 `optional`，生成脚本保持同样策略并同步预加载版本号。
- 整页根容器增加 420ms 的透明度淡入，不移动布局、不等待目录或字体下载，也不延迟交互；省电模式以零时长完成，系统减少动态效果设置关闭动画。既有欢迎区动效继续保留。
- Review 范围仅包含入口 HTML、字体样式与生成脚本、全局入场样式及对应浏览器回归；复核了子路径部署、字体失败回退、减少动态效果与省电切换。省电采用零时长而非更换动画名称，避免开关设置时重新淡入。
- 验证：`initial-text.spec.ts` 与 `welcome.spec.ts` 在独立 `/radio/` 生产预览中运行，Chromium、Firefox、WebKit 与 Pixel 7 Chromium 模拟共 36 项通过。覆盖首次进入、刷新、迟到字体不换宽、字体失败、省电及减少动态效果；检查 1440×900、768×1024、390×844、320×700、844×390，并查看桌面、手机及横屏截图。桌面与手机逐帧采样均捕捉到中间透明度，最终为 1；三个预加载字体均从 `/radio/fonts/` 成功返回。
- 工程检查：前端 TypeScript、相关 ESLint/Prettier、Vite 生产构建、资源预算、文档链接与差异检查通过；同步后已复审本次差异并复验。Vite 仍提示既有大分块警告，构建成功。字体文件本身未重新生成，普通构建没有访问外部字体服务。
- 未完成事项：未执行手机真机验收和生产发布；浏览器设备模拟不能替代真机。
- 发布范围：仅需更新 `radio-frontend` 前端静态资源；不涉及 API、后台任务、数据库迁移或配置调整。本轮不执行生产发布。

返回[前端导航](../README.md)。
