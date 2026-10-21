# 生产客户端资源预算与持续运行

本页补充短时[规模回归](scale-and-stability.md)，检查实际生产构建、静止绘制和有限持续运行。它不是手机帧率、物理显存、全天候运行或外网质量保证；真实设备和部署节点仍单独验收。

## 可重复入口

```sh
pnpm test:performance
```

命令先构建共享契约和Web生产包，检查产物预算，再启动独占的4173预览与5173模块服务。六个用例、两名worker、零重试：四个浏览器项目执行资源检查，桌面与移动Chromium另各执行默认600秒的持续运行。测试不启动API、连接MySQL或访问外部供应商；目录与媒体仅由测试上下文拦截。

快速检查可以显式缩短到60秒，不得将其记录为十分钟验收：

```sh
HAEN_SOAK_SECONDS=60 pnpm test:performance
```

HAEN_SOAK_SECONDS只由测试进程读取，接受60–3600的整数秒数；不进入前端环境或应用配置。Jenkins在工程检查后增加独立持续运行阶段，显式设600秒，失败阻止后续镜像构建。实际Jenkins DSL、浏览器系统库与Linux节点仍待原有部署条件验收。服务生命周期使用[Playwright webServer](https://playwright.dev/docs/test-webserver)，端口已占用时拒绝复用其他进程。

## 静态产物预算

普通pnpm check在生产构建后调用apps/web/scripts/check-web-budget.mjs；独立性能入口也执行相同检查。脚本读取固定dist目录，不联网，不接受任意目标路径。以下是当前版本的工程回归上限，目的是防止资源无意膨胀；不是行业通用标准，也不能证明慢网首屏速度。

| 项目 | 上限 |
| --- | --- |
| 应用入口JavaScript gzip | 220KiB |
| 全部JavaScript gzip（含按需HLS与地球） | 600KiB |
| 全部CSS gzip | 50KiB |
| 三种本地字体原始体积 | 512KiB |
| land.json与静态world.svg合计原始体积 | 1MiB |
| 省/州资源regions.json原始体积 | 1MiB |

上限基于当前约181KiB入口、491KiB全部JavaScript、290KiB字体与307KiB地理资源设置有限回归余量。脚本保留逐文件字节数、Node gzip默认压缩结果和SHA256；压缩算法/级别与实际服务器传输可能不同，不把它当作Caddy传输量。缺少入口、CSS、地理或任一种字体时拒绝。既有三个JavaScript分包超过Vite的500kB警告仍保留，没有通过改高警告阈值掩盖问题。

## WebGL句柄与绘制

测试探针仅通过addInitScript注入测试页面，包装实际原生创建/删除/绘制调用；不改变函数参数、返回值或对象生命周期。句柄只以WeakMap关联计数，不强引用GPU对象。统计created、deleted、invalidated、live、peak，以及context loss与绘制次数，不推断物理显存字节或驱动立即释放时间。

生产页面加载30000条合成目录，检查绘制缓冲按容器宽度限制像素比（窄容器1.5、其余1.75）；静止1.5秒与流派隐藏1.5秒不新增绘制，返回地球后实际恢复绘制。

独立模块夹具从当前源码加载真实createGlobe与本地地形，四项目各创建/销毁12次，每次六轮切换30000/15000个地理点；该夹具是开发模块入口，不能被描述为生产包销毁路径。每轮在相同状态比较活跃句柄，验证旧几何缓冲持续删除、Buffer/Program/Shader/VertexArray在dispose后归零、重复destroy安全且画布移除。

Three.js内部回退纹理和临时帧缓冲可能由上下文销毁统一失效；报告保留显式删除与失效两类，不伪造全部逐项删除。每轮必须实际收到context lost，之后live归零且created=deleted+invalidated。资源管理依据[Three.js释放说明](https://threejs.org/manual/pages/how-to-dispose-of-objects.html)，上下文事件语义见[WebGL规范](https://registry.khronos.org/webgl/specs/latest/1.0/)；当前锁定版本的内部对象还与本地依赖源码交叉核对。

## 生产页面持续运行

桌面与移动Chromium分别使用完整生产静态包和30000条合成目录，交替收听两个测试电台，每约四秒切换；每六轮实际筛选一半目录、恢复全部并切换地球/流派。12秒合成MP3通过持续切台保持解码，不修改产品媒体循环策略；测试将音量设为零，时间推进只能证明解码与媒体时钟，不能证明扬声器或直播来源。

至少第六轮热身后取基线，之后约30秒及结束取样。Chromium使用CDP请求GC并读取JS堆、节点与监听器；指标缺失直接失败。所有样本相对热身基线须满足：堆增量小于10MiB、节点增量小于200、监听器增量小于100。GL活跃句柄类型与数量保持相同，每轮检查只有一个音频元素和一个画布，无context loss或页面异常。参数与指标入口依据[Chrome DevTools Performance](https://chromedevtools.github.io/devtools-protocol/tot/Performance/)。

目录只能读取30个分片，详情不超过实际切台次数加首次播放；媒体最多每次播放两次Range请求，元数据请求上限包含切台与每分钟轮询，目录清单按产品现有五分钟刷新单独计数，其他API总量同时受约束。禁止未列入测试本地域名的网络请求。每个报告记录实际经过时间、切台次数、全部样本、浏览器版本和视口，不用模拟时钟替代墙钟十分钟。

本机阈值用于发现持续增长，不能证明任何时长都无泄漏；Firefox/WebKit本轮只有短程原生句柄检查，不宣称它们完成Chromium堆观测。具体运行与失败修正见[阶段记录](../iterations/2026-10-17-resource-budgets/README.md)。返回[工程导航](README.md)。
