/**
 * 列表「序号」列工具。
 *
 * 序号列无法用全局 CSS 注入，只能每张表加一列 <el-table-column type="index">。
 * 为了让每页只写一行、且跨页连续编号的算法只有一处真相，这里统一提供 :index 工厂。
 *
 * 用法（indexMethod 已配到 auto-import，页面无需 import）：
 *   <el-table-column label="序号" type="index" width="60" align="center" :index="indexMethod(queryParams)" />
 */

/**
 * 生成 el-table type="index" 列的 :index 回调：跨页连续编号。
 * 第 pageNo 页第 index 行 = (pageNo - 1) * pageSize + index + 1。
 *
 * 省略 query（或字段缺失）时 pageSize 视作 0，退化为当前页 1..N，
 * 这样无分页的列表（如数据源配置）也能安全复用同一列写法。
 */
export const indexMethod =
  (query?: { pageNo?: number; pageSize?: number }) =>
  (index: number): number => {
    const pageNo = query?.pageNo ?? 1
    const pageSize = query?.pageSize ?? 0
    return (pageNo - 1) * pageSize + index + 1
  }
