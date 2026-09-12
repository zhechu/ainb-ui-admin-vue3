/**
 * 上传值的形态适配（B8）
 *
 * ## 库里存对象，界面上用 URL
 *
 * 设计方案 §5.9 要求上传字段的值统一成 `[{name, url, size, type}]`。这一步由服务端
 * 在提交时补齐（`FileMetaEnricher` 从 `infra_file` 反查），所以**读回来的值是对象数组**。
 *
 * 但共享的三个上传组件（`UploadImg` / `UploadImgs` / `UploadFile`）只认 URL 字符串 ——
 * 它们在 `plugins/formCreate/index.ts` 里全局注册，`src` 下有 **80 个调用方**直接靠它
 * 解析，改不得。所以这里做一层「读的时候收敛回 URL」的值变换。
 *
 * 交接文档第十一节把这个落脚点说清楚了：适配要做成**运行时的值变换**，
 * 挂在 `render/index.vue`，与 `useLogicRuntime` / `useFormulaRuntime` 同一类接线；
 * 而不是造一个同名组件去顶替全局注册（那等于改了那 80 个调用方）。
 *
 * ## 提交方向不用管
 *
 * 组件发出来的本来就是 URL，服务端会重新补一遍元信息 —— 所以前端**不需要**在提交前
 * 把对象拼回去。少一个方向的变换，也就少一处「两边形态对不上」的可能。
 *
 * ## ⚠️ 元信息在界面上还是看不到
 *
 * 收敛之后组件拿到的仍然只有 URL，附件列表上显示的还是哈希文件名。要显示原文件名，
 * 得**替换**那三个共享组件，而那正是这一节一直在避开的 80 个调用方问题。
 * 元信息目前的价值在库那一侧：导出、列表、打印模板、外部系统读库都能拿到原文件名与大小。
 */
import { getWidgetContract, isFileWidget } from '@/components/FormWidgets/contracts'

/** 上传值的元素形态，与服务端 `FileMetaEnricher` 产出的键一致 */
export interface UploadItem {
  name?: string
  url: string
  size?: number
  type?: string
}

/**
 * 把一个上传字段的值收敛成组件认得的形态
 *
 * @returns 收敛后的值。入参已经是 URL 形态时**原样返回入参**，
 *          调用方靠引用相等判断要不要写回（与服务端 `RichContentGuard` 同一个约定）
 */
export const collapseUploadValue = (value: any): any => {
  if (!Array.isArray(value)) {
    // 单图 / 签名是裸 URL 字符串，本来就不用收敛 —— 它们的落库形态是 scalar。
    return value
  }
  let changed = false
  const collapsed = value.map((item) => {
    if (item && typeof item === 'object' && typeof item.url === 'string') {
      changed = true
      return item.url
    }
    return item
  })
  return changed ? collapsed : value
}

/**
 * 收集表单里落库形态为数组的文件字段
 *
 * 判据全部来自控件契约（`valueType = file` 且 `storage = json`），不在这里列控件名 ——
 * 新增一个文件类控件时忘了改这里，表现会是那个控件读回来是一堆 `[object Object]`。
 *
 * 要递归两处：布局容器的 `children`、子表控件的内部规则。少递归子表的话，
 * 明细里的附件列收敛不了。
 *
 * @param rules form-create 的规则树（已解析成对象）
 * @returns 主表字段名 → true；子表字段名 → 该子表内的文件字段名清单
 */
export const collectUploadFields = (
  rules: any[]
): { main: Set<string>; sub: Map<string, Set<string>> } => {
  const main = new Set<string>()
  const sub = new Map<string, Set<string>>()

  const isArrayFile = (type?: string): boolean =>
    isFileWidget(type) && getWidgetContract(type)?.storage === 'json'

  const walk = (node: any, owner: string | null) => {
    if (!node || typeof node !== 'object') return
    const field = typeof node.field === 'string' ? node.field : null
    if (field && isArrayFile(node.type)) {
      if (owner) {
        if (!sub.has(owner)) sub.set(owner, new Set())
        sub.get(owner)!.add(field)
      } else {
        main.add(field)
      }
    }
    // 子表控件：内部规则挂在 props.rule 下，它们的归属子表就是本控件
    const inner = node.props?.rule
    if (field && Array.isArray(inner)) {
      for (const child of inner) walk(child, field)
    }
    if (Array.isArray(node.children)) {
      // 布局容器不改变归属
      for (const child of node.children) walk(child, owner)
    }
  }

  for (const rule of rules ?? []) walk(rule, null)
  return { main, sub }
}

/**
 * 把一整条记录里的上传字段收敛成 URL 形态
 *
 * @param record 取详情接口返回的记录。本函数**不修改入参**
 * @param rules  form-create 的规则树
 * @returns 收敛后的记录；没有任何上传字段时原样返回入参
 */
export const collapseUploadValues = (
  record: Record<string, any> | null | undefined,
  rules: any[]
): Record<string, any> => {
  if (!record) return {}
  const { main, sub } = collectUploadFields(rules)
  if (main.size === 0 && sub.size === 0) return record

  const result = { ...record }
  for (const field of main) {
    const collapsed = collapseUploadValue(result[field])
    if (collapsed !== result[field]) result[field] = collapsed
  }
  for (const [subField, fields] of sub) {
    const rows = result[subField]
    if (!Array.isArray(rows) || rows.length === 0) continue
    let rowsChanged = false
    const copied = rows.map((row) => {
      if (!row || typeof row !== 'object') return row
      let rowChanged = false
      const copy = { ...row }
      for (const field of fields) {
        const collapsed = collapseUploadValue(copy[field])
        if (collapsed !== copy[field]) {
          copy[field] = collapsed
          rowChanged = true
        }
      }
      if (!rowChanged) return row
      rowsChanged = true
      return copy
    })
    if (rowsChanged) result[subField] = copied
  }
  return result
}
