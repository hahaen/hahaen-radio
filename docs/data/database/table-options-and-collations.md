# 建库建表选项与排序规则

日期：2026-10-16。范围：只读分析现有库的建表选项与字符列配置，形成新项目规范，不迁移业务表或业务数据。

## 实际核对结果

本次通过本机 DBX 已有连接执行 `SELECT` 元数据查询，没有改变连接安全设置、服务器参数、表结构或数据。读取范围为版本变量及 `information_schema` 的库、表和字符列元数据。

| 层级 | 实际结果 |
| --- | --- |
| 服务器版本 | MySQL 8.0.46 |
| 服务器默认字符集与排序规则 | `utf8mb4`、`utf8mb4_unicode_ci` |
| 参照库默认设置 | `utf8mb4`、`utf8mb4_general_ci` |
| 18 张表的存储引擎 | 全部为 InnoDB |
| 18 张表的默认排序规则 | 全部为 `utf8mb4_general_ci` |
| 18 张表的行格式 | 全部为 Dynamic |
| 字符列分布 | 93 列为 `utf8mb4/utf8mb4_general_ci`，23 列为 `ascii/ascii_bin` |
| 项目目标库 | 开发 `ha_radio_dev`、正式 `ha_radio`；检查时都不存在，本次未创建 |

服务器、库和列的设置可以不同，不能仅根据服务器默认值判断项目表的设置。原始元数据仅保存在 Git 排除的本地私有归档，本文件记录适用的技术结论。

## 项目统一设置

建库时显式指定：

```sql
CHARACTER SET utf8mb4
COLLATE utf8mb4_general_ci
```

新业务表显式指定：

```sql
ENGINE = InnoDB
DEFAULT CHARSET = utf8mb4
COLLATE = utf8mb4_general_ci
ROW_FORMAT = DYNAMIC
```

以上是 SQL 选项片段，不是已执行的迁移。行格式来自实际元数据；这不代表已确认原有每条建表 SQL 都显式写过该选项。项目新表在迁移层显式约束，避免依赖环境默认值。

## 字符列例外

- 普通名称、描述和其他 Unicode 文本默认继承 `utf8mb4_general_ci`。
- 幂等键、摘要及机器标识等仅含 ASCII 且要求区分大小写的字段，明确使用 `CHARACTER SET ascii COLLATE ascii_bin`，同时定义长度、输入范围和空白处理。
- 允许 Unicode 且要求区分大小写的字段需选择合适的 Unicode 排序规则，不能直接限制为 ASCII。
- `utf8mb4_general_ci` 不区分大小写，也有相应的重音与空格比较语义；唯一索引需要按这些语义验证。
- `_bin` 排序规则不等同于二进制字符串，尾空格处理不能想当然；严格按字节比较的值评估 `VARBINARY` 等类型，不能承诺 `ascii_bin` 覆盖所有字节相等需求。

不因参照库对部分状态类字段使用 ASCII 就要求项目所有状态字段照搬；每个字段按自己的值域和比较语义决定。

## 连接与迁移

1. mysql2 连接显式设置项目字符集与排序规则，并核对连接会话的实际值；只写 `utf8mb4` 不能作为排序规则已经正确的证明。
2. Drizzle Schema 使用 MySQL 方言，生成 SQL 后检查库、表与列级例外。锁定版本的工具不能表达表选项时，通过 Drizzle Kit 管理的自定义迁移实现，不增加第二套执行器。
3. 既有表转换排序规则前检查唯一键、关联列、现有数据与锁表影响；禁止直接批量转换参照库或目标库。
4. 初始化和迁移前核对 `DB_NAME`，开发与正式明确隔离，不能因目标库尚未存在而自动改用其他业务库。
5. 当前兼容验证目标为实际 MySQL 8.0.46。原定 8.4 LTS 不代表已部署，如后续升级或新建其他版本，应单独更新决策并完成迁移和连接验收。

## 验证边界

本次已核对元数据，未验证应用连接池、Drizzle SQL 生成、迁移执行或数据库恢复。独立 Node.js 连接的 TLS 校验尚未通过，本机工具的成功读取不能代替应用连接验收。

当前也未创建开发或正式数据库、运行账户、业务表或迁移 SQL。后续初始化需在明确授权和正确目标环境下执行。

参考技术资料：[MySQL 表级字符集](https://dev.mysql.com/doc/refman/8.0/en/charset-table.html)、[排序规则命名](https://dev.mysql.com/doc/refman/8.0/en/charset-collation-names.html)、[二进制与 `_bin` 排序规则](https://dev.mysql.com/doc/refman/8.0/en/charset-binary-collations.html)。

返回[数据导航](../README.md)。
