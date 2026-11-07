import type { QlzgParamSchemaItem } from '@/api/qlzg/category'

/**
 * 标的属性：品类 schema ↔ 表单模型 ↔ 库里的 attrs，三个形态之间的**唯一**一段转换代码
 *
 * <h3>🔴 为什么单独一个纯函数模块，而不是写在 SubjectForm.vue 里</h3>
 * 后端 {@code QlzgSubjectAttrsProcessor} 是同一件事在服务端的那一半，它的类注释把理由写全了：
 * 这是本平台里唯一一段「同一个输入必须永远得到同一个输出」的转换，而它的错误**全都不报错** ——
 * 归一化在写入路径上会拦，但拦下来的那句话用户看不懂；换算错了则根本拦不住。
 * 做成纯函数换来的是能在 vitest 的 **node 环境**里测到边界（本仓 vitest 没有 jsdom，
 * 任何 value-import 到 {@code @/config/axios} 的模块在收集阶段就会以
 * {@code window is not defined} 死掉，所以这里对 API 模块**只用 import type**）。
 *
 * <h3>🔴 三个形态，别混</h3>
 * <ol>
 *   <li><b>库里的 attrs</b>：DECIMAL 是数、INT 是数、DATE 是 {@code "2026-10-30"} 字符串、
 *       GEO 是 {@code {lng, lat}}（**只有这两个键名**，后端不做别名兼容，
 *       因为 R33 拼的是 {@code Point(lng, lat)}、顺序敏感）、
 *       {@code unit='%'} 的项存的是**分数**（0.075 表示 7.5%）。</li>
 *   <li><b>表单模型</b>：与库里同形，唯一区别是百分数项**乘过 100**（用户填 7.5）。</li>
 *   <li><b>提交给后端的 attrs</b>：与库里同形，且**不含值为空的键</b>。</li>
 * </ol>
 *
 * <h3>🔴 「不含空键」不是洁癖，是后端的硬约束</h3>
 * STRING 类型收到空字符串会**报错**（「不能是空字符串（要清空请传 null）」），
 * 而 GEO 收到 {@code {}} 算「没填」、收到 {@code {lng: 116.4}} 算「缺 lat」也报错。
 * 所以这里统一把 undefined / null / 空串 / 只有半个的对象**整个键省掉**：
 * 后端把「键不存在」与「值为 null」都判成没填，选填项直接跳过、必填项报一句人看得懂的话。
 *
 * <h3>🔴 孤儿键（schema 已不再定义、但值还在库里）必须【丢掉】，不能回传</h3>
 * 后端对「入参有、schema 里没有」的处置是**不对称**的：值非空 → 报错；值是 null / 空白 → 静默跳过。
 * 所以把 {@code attrViews} 里那些 {@code type === null} 的项原样塞回 attrs，
 * 结果是「这个标的再也改不动了」——改个名字都会被一条历史属性挡住。
 * 丢掉它们与后端行为一致：{@code normalize} 遍历的是 schema，孤儿键在任何一次成功保存后本来就不在了。
 *
 * <h3>🔴 值级别的那几个纯函数是**两个模块共用**的，改它们要连着参数库一起看</h3>
 * {@code param/paramSchema.ts}（参数库，I3）import 了这里的
 * {@link ATTR_TYPE} / {@link isPercentItem} / {@link isAbsent} / {@link displayPrecision} /
 * {@link displayRange} / {@link toDisplayValue} / {@link toStoredValue} ——
 * 因为两个模块面对的是**同一份** {@code param_schema}（只是 {@code scope} 不同），
 * 而「{@code unit='%'} 的项库里存分数」这条规则一旦有两份实现，
 * 就一定会有其中一份忘了 ÷100，而它的表现是**数字看起来是对的**。
 * 🔴 所以这几个函数**只认 {@code QlzgParamSchemaItem} 与一个值**，
 *    不要往它们的签名里加「标的」或「参数」专有的东西 ——
 *    加了就把复用切断，下一个人只好抄一份。
 *    宿主专有的形状（attrs 对象 vs 三个值列）各自留在自己模块里。
 */

/** 品类 schema 里的值类型，与后端 {@code QlzgParamTypeEnum} 逐字一致 */
export const ATTR_TYPE = {
  DECIMAL: 'DECIMAL',
  INT: 'INT',
  STRING: 'STRING',
  ENUM: 'ENUM',
  DATE: 'DATE',
  GEO: 'GEO'
} as const

/** GEO 的经纬度界限，与后端 {@code QlzgSubjectAttrsProcessor} 的四个常量一致 */
export const GEO_BOUNDS = { lngMin: -180, lngMax: 180, latMin: -90, latMax: 90 } as const

/** GEO 的经纬度保留位数。🔴 与后端同值：6 位 ≈ 0.11 米，而手机 GPS 实测精度是 ±5 米 */
export const GEO_SCALE = 6

/** 百分数项的显示倍数 */
const HUNDRED = 100

/** 这一项的单位是不是百分号 */
export const isPercentItem = (item: QlzgParamSchemaItem): boolean => item.unit === '%'

/**
 * 「没填」的判定，与后端 {@code isAbsent} 同一口径
 *
 * 🔴 空对象也算没填：{@code {lng: null, lat: null}} 是「用户点开了地图但没选点」的正常产物。
 */
export const isAbsent = (value: unknown): boolean => {
  if (value == null) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'object') return Object.keys(value as object).length === 0
  return false
}

/** 是不是一个能当数用的值。🔴 空串要单独挡：{@code Number('')} 是 0，是个合法的数 */
const isNumeric = (value: unknown): boolean =>
  value != null && value !== '' && Number.isFinite(Number(value))

/** GEO 的两个分量是不是都有值 */
const isGeoComplete = (value: unknown): value is { lng: number; lat: number } => {
  if (typeof value !== 'object' || value == null) return false
  const geo = value as { lng?: unknown; lat?: unknown }
  return isNumeric(geo.lng) && isNumeric(geo.lat)
}

/**
 * 输入控件的小数位
 *
 * 🔴 schema **没声明** scale 时返回 undefined（= 不限制），**不要**替它补一个：
 * 补零会凭空造出精度 —— 库里存的是 1234567、界面显示 1234567.00，
 * 而那两个 0 从来没有被任何人断言过。在评估报告里「凭空多出来的精度」正是 R06 那一类规则要防的东西。
 *
 * 🔴 百分数项要**减 2**：库里 scale=4 的分数 0.0750，显示成 7.50 只需要 2 位。
 *    直接沿用 4 位会让用户看到 7.5000，而下一次编辑再乘回去就是 0.075000 —— 数字没错，
 *    但界面上多了两个谁也没填过的 0。
 */
export const displayPrecision = (item: QlzgParamSchemaItem): number | undefined => {
  if (item.scale == null) return undefined
  if (item.type !== ATTR_TYPE.DECIMAL) return item.type === ATTR_TYPE.INT ? 0 : undefined
  return isPercentItem(item) ? Math.max(item.scale - 2, 0) : item.scale
}

/**
 * 输入控件的取值范围，**换算到显示口径**
 *
 * 🔴 后端 {@code range} 描述的是**库里的分数**（如 {@code [0.01, 0.30]}）。
 *    直接把它塞给显示 7.5 的输入框，用户会看到「超出 [0.01, 0.3]」而完全不知道该填什么 ——
 *    后端那句报错已经特意把两种口径都写进去了，前端不该先制造这个困惑。
 *
 * 🔴 乘完必须 {@code toPrecision(12)} 削一刀：{@code 0.29 * 100} 在 JS 里是
 *    {@code 28.999999999999996}（实测），于是「填一个恰好等于上限的值」会被拒 ——
 *    而 {@code el-input-number} 的 {@code :max} 收到这个数之后连**加号**都点不到 29。
 *    这个故障的恶劣之处在于它**挑值**：{@code 0.3 * 100} 恰好是 30、{@code 0.29 * 100} 不是，
 *    所以换一个品类、换一个参数就复现或不复现，报上来的样子是「校验时严时松」。
 *    ⚠️ 只削浮点噪声，**不做业务舍入**：12 位远超 {@code decimal(24,8)} 的 8 位标度，
 *    任何真实边界都不会被这一步改动。
 */
export const displayRange = (item: QlzgParamSchemaItem): { min?: number; max?: number } => {
  const range = item.range
  if (!range) return {}
  const factor = isPercentItem(item) && item.type === ATTR_TYPE.DECIMAL ? HUNDRED : 1
  const scale = (value?: number) =>
    value == null ? undefined : Number((value * factor).toPrecision(12))
  return { min: scale(range.min), max: scale(range.max) }
}

/**
 * 库里的值 → 表单模型的值
 *
 * 🔴 GEO 在 {@code raw} 为空时返回 {@code {lng: undefined, lat: undefined}} 而**不是** undefined：
 *    模板里两个输入框绑的是 {@code model[key].lng} / {@code model[key].lat}，
 *    模型值是 undefined 的话第一次渲染就会在读属性时抛错。
 *    而这个「半个对象」在提交侧仍然算没填（{@link toStoredValue} 会整个键省掉）。
 *
 * @param item schema 项
 * @param raw  库里 {@code attrs[key]} 的原始值，可为 undefined
 */
export const toDisplayValue = (item: QlzgParamSchemaItem, raw: unknown): unknown => {
  if (item.type === ATTR_TYPE.GEO) {
    const source = (raw != null && typeof raw === 'object' ? raw : {}) as {
      lng?: unknown
      lat?: unknown
    }
    return {
      lng: isNumeric(source.lng) ? Number(source.lng) : undefined,
      lat: isNumeric(source.lat) ? Number(source.lat) : undefined
    }
  }
  if (raw == null) return undefined
  switch (item.type) {
    case ATTR_TYPE.DECIMAL: {
      const value = Number(raw)
      if (!Number.isFinite(value)) return undefined
      // 🔴 乘完削一刀浮点噪声，理由与 displayRange 那条完全相同：
      //    1.1 * 100 = 110.00000000000001。表单里它被 el-input-number 的 precision
      //    挡住看不见，但**模型值**仍然带着这串噪声，而 schema 没声明 scale 时
      //    toStoredValue 不做舍入，噪声就原样落进 decimal(24,8)
      return isPercentItem(item) ? Number((value * HUNDRED).toPrecision(12)) : value
    }
    case ATTR_TYPE.INT: {
      const value = Number(raw)
      return Number.isFinite(value) ? value : undefined
    }
    default:
      // STRING / ENUM / DATE 库里存的就是字符串，原样给控件
      return raw
  }
}

/**
 * 表单模型的值 → 要提交给后端的值
 *
 * @returns {@code undefined} 表示**整个键应当省掉**，不是「提交一个 null」
 */
export const toStoredValue = (item: QlzgParamSchemaItem, value: unknown): unknown => {
  if (isAbsent(value)) return undefined
  switch (item.type) {
    case ATTR_TYPE.DECIMAL: {
      const parsed = Number(value)
      if (!Number.isFinite(parsed)) return undefined
      // 🔴 除以 100：界面上的 7.5 要存成 0.075。乘回去用浮点会引入
      //    0.07500000000000001 这类噪声，而后端拿 BigDecimal.valueOf(double) 收，
      //    噪声会原样落进 decimal(24,8) —— 所以先按显示精度截一刀再换算
      if (!isPercentItem(item)) return parsed
      const precision = displayPrecision(item)
      const rounded = precision == null ? parsed : Number(parsed.toFixed(precision))
      return rounded / HUNDRED
    }
    case ATTR_TYPE.INT: {
      const parsed = Number(value)
      return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined
    }
    case ATTR_TYPE.STRING:
    case ATTR_TYPE.ENUM:
    case ATTR_TYPE.DATE: {
      // 🔴 STRING 收到空串后端会报错，而 isAbsent 已经把空串挡在上面了
      const text = String(value).trim()
      return text === '' ? undefined : text
    }
    case ATTR_TYPE.GEO: {
      if (!isGeoComplete(value)) return undefined
      const geo = value as { lng: number; lat: number }
      return {
        lng: Number(Number(geo.lng).toFixed(GEO_SCALE)),
        lat: Number(Number(geo.lat).toFixed(GEO_SCALE))
      }
    }
    default:
      return undefined
  }
}

/**
 * 库里的 attrs → 表单模型
 *
 * 🔴 只遍历 schema，**不遍历 attrs**：孤儿键不进模型（理由见文件头），
 *    顺序也跟着 schema 走（后端 {@code attrViews} 是同一个顺序，两边一致才不会
 *    出现「详情页与编辑表单里属性顺序不同」）。
 */
export const loadAttrsModel = (
  schema: QlzgParamSchemaItem[],
  attrs?: Record<string, any> | null
): Record<string, any> => {
  const model: Record<string, any> = {}
  for (const item of schema) {
    model[item.key] = toDisplayValue(item, attrs?.[item.key])
  }
  return model
}

/**
 * 表单模型 → 要提交的 attrs
 *
 * @returns 值为空的键**整个省掉**。返回的对象可能是 {@code {}}，
 *          而 {@code {}} 在后端的语义是「清空全部属性」—— 所以调用方必须自己判
 *          「用户到底动没动过这块」，没动过就发 {@code null}（= 不修改），见 SubjectForm.vue
 */
export const buildAttrsPayload = (
  schema: QlzgParamSchemaItem[],
  model: Record<string, any>
): Record<string, any> => {
  const payload: Record<string, any> = {}
  for (const item of schema) {
    const value = toStoredValue(item, model[item.key])
    if (value !== undefined) payload[item.key] = value
  }
  return payload
}

/**
 * 孤儿键：库里有值、schema 已不再定义的属性
 *
 * 🔴 这些值在**保存之后就不会再保留**（后端 {@code normalize} 遍历的是 schema）。
 *    界面上必须把这件事说出来，否则用户改个标的名字、顺手点确定，
 *    一批历史属性就没了 —— 而那不会报错。
 */
export const orphanKeys = (
  schema: QlzgParamSchemaItem[],
  attrs?: Record<string, any> | null
): string[] => {
  if (!attrs) return []
  const known = new Set(schema.map((item) => item.key))
  return Object.keys(attrs).filter((key) => !known.has(key) && !isAbsent(attrs[key]))
}

/**
 * 必填项缺了哪些，返回「显示名」列表
 *
 * ⚠️ 这是**提交前**的一道友好提示，不是替代后端校验：后端的 {@code normalize}
 *    还会管类型、range、ENUM 可选值、STRING 长度这些这里刻意不重复实现的规则
 *    （重复实现就是两份会漂移的检查点）。
 */
export const missingRequiredLabels = (
  schema: QlzgParamSchemaItem[],
  model: Record<string, any>
): string[] =>
  schema
    .filter((item) => item.required && isAbsent(toStoredValue(item, model[item.key])))
    .map((item) => item.label || item.key)
