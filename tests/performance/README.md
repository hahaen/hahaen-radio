# 独立资源与持续运行检查

从仓库根运行pnpm test:performance，构建生产Web包、校验静态预算，并通过六个项目用例检查按需绘制、原生句柄及双端Chromium十分钟切台。默认两名worker、零重试；HAEN_SOAK_SECONDS=60只用于快速检查，不能当作600秒结果。

4173提供实际生产包，5173只为独立源码控制器销毁夹具提供模块；均独占，不启动API或使用真实数据库。报告区分两个入口，测试数据不随应用分发。方法、命中阈值、上下文失效与显存限制见[资源预算](../../docs/engineering/resource-budgets.md)，本轮结果见[归档](../../docs/iterations/2026-10-17-resource-budgets/README.md)。
