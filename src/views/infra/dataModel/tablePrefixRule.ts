import type { DataModelTablePrefixVO } from '@/api/infra/dataModel'

/**
 * 新建表名的前端校验（V5 §5.9.1 F2 / §19.3 测试 #33 ④）
 *
 * 为什么抽成一个纯函数：
 * 它原本是 `DataModelForm.vue` 里 `formRules.tableName` 的一个内联 validator，
 * 而那份实现把正则**硬编码**成 `/^biz_[a-z0-9_]*[a-z0-9]$/`。后端的前缀是可配的
 * （`enlev.data-model.table-prefix`），运维加一个 `qlzg_app_`，后端放行了、前端照样拦，
 * 保存按钮永远点不动，而界面上没有任何提示说为什么 —— 这个 bug 能活下来，
 * 正是因为它藏在 SFC 里、没有任何测试能碰到它。
 *
 * 抽出来之后它可以被单测直接钉住，包括那条最容易写反的：
 * **`tablePrefixEnforced` 为假时一律放行**。写反的表现是运维关掉强制之后前端比后端还严，
 * 而那是「存量库接入」的正规姿势，一旦坏了就没人能把老库导进来。
 *
 * @returns 错误文案；`null` 表示通过
 */
export const validateNewTableName = (
  rawName: string | undefined | null,
  rules: DataModelTablePrefixVO | null | undefined
): string | null => {
  const name = (rawName ?? '').trim()
  // 命名规范：与后端 SqlSafeGuard 的标识符白名单同源（全小写 snake_case、字母开头、不以下划线结尾）。
  // 🔴 这一半【不受】tablePrefixEnforced 影响 —— 关掉的是「必须带业务前缀」这条建模规范，
  // 不是标识符合法性。后者在 SqlSafeGuard 里是硬编码不可关的（它防的是把库搞坏，不是搞乱）
  if (!/^[a-z][a-z0-9_]*[a-z0-9]$/.test(name)) {
    return '表名只允许小写字母、数字、下划线，须字母开头、不以下划线结尾'
  }
  // 接口没回来 / 运维关掉了强制：不校验前缀，把判断交给后端
  if (!rules?.tablePrefixEnforced) {
    return null
  }
  // 🔴 空白项要滤掉，与后端 SqlSafeGuard.checkBusinessTablePrefix 的归一化保持一致：
  // 一份全是空白项的清单意思是「没配白名单」，不是「谁都不许建」
  const prefixes = (rules.businessPrefixes ?? []).filter((prefix) => !!prefix?.trim())
  if (prefixes.length === 0 || prefixes.some((prefix) => name.startsWith(prefix))) {
    return null
  }
  // 🔴 把【全部】合法前缀都列出来。只报第一个，用户会以为另一个不合法 ——
  // 而另一个恰恰可能是这次刚放开的那一个
  return `表名须以 ${prefixes.join(' 或 ')} 开头`
}
