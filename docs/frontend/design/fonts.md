# 本地字体资源

夜航字形保持[设计规范](night-voyage.md)的角色：Noto Serif SC 用于品牌与短标题，Noto Sans SC 用于操作界面，IBM Plex Mono 用于坐标和时间。

字体以 WOFF2 放在 `apps/web/public/fonts/`，许可证与来源摘要随资源交付；CSS 仅请求本站 `/fonts/` 路径，普通安装、构建和浏览不访问字体服务。使用 `font-display: swap`，失败或未覆盖的字形沿用系统回退，不能让字体加载阻断选台或收听。

## 覆盖与许可

- 中文资源覆盖当前双语语言文件中的汉字、标点和基本拉丁字形，外部电台名称、其他语言和未覆盖字形由系统字体显示，不动态向字体服务发送电台或用户内容。
- 正文提供 300–600 可变字重，衬线与等宽字重为 400。没有请求的字重保留浏览器匹配，不伪造额外字体文件。
- 三个家族均随附 SIL Open Font License 1.1 和版权声明，见字体目录中的 `*-LICENSE.txt`；原始许可入口分别是 [Noto Serif SC](https://github.com/google/fonts/blob/main/ofl/notoserifsc/OFL.txt)、[Noto Sans SC](https://github.com/google/fonts/blob/main/ofl/notosanssc/OFL.txt)和 [IBM Plex Mono](https://github.com/google/fonts/blob/main/ofl/ibmplexmono/OFL.txt)。
- 许可证仅统一换行并去除行尾空白，保留原文字、版权和条款。
- 本地文件 SHA-256、字形范围与字重记录在 `source.json`。不在运行时下载字体，也不把远程服务可用性当作构建前提。

## 更新字形

新增或修改中文界面文案后，在开发环境手动执行：

```sh
node apps/web/scripts/prepare-fonts.mjs
pnpm exec prettier --write apps/web/src/styles/fonts.css apps/web/public/fonts/source.json
```

再运行适用检查，确认新文字有覆盖且系统回退仍有效。此生成步骤需要系统 `curl` 和网络，通过 Google Fonts 官方 CSS API 请求项目公开界面文字对应的字形，并验证 HTTPS 来源、WOFF2 格式、大小与许可。所有家族均成功获取后才写入本地文件；资源已提交，因此普通用户构建无需执行生成步骤。

实现使用[官方字体请求接口](https://developers.google.com/fonts/docs/css2)的文字子集能力，接口本身可能更新；重新生成后的二进制与摘要应作为新的资源差异审查，不假定远端永远返回同一文件。

返回[前端导航](../README.md)。
