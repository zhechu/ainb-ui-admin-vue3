import type { QlzgParamSchemaItem } from '@/api/qlzg/category'
import type { QlzgParamSaveVO, QlzgParamVO } from '@/api/qlzg/param'
import {
  ATTR_TYPE,
  displayPrecision,
  displayRange,
  isAbsent,
  toDisplayValue,
  toStoredValue
} from '@/views/qlzg/subject/attrSchema'

/**
 * 参数库：品类 schema ↔ 表单模型 ↔ 库里的三列值，三个形态之间的**唯一**一段转换代码
 *
 * <h3>🔴 为什么复用 `subject/attrSchema.ts`，而不是各写一份</h3>
 * 两个模块面对的是**同一份** `param_schema`（只是 `scope` 不同），而那份 schema 里最反直觉的一条
 * 是「{@code unit === '%'} 的项，库里存的是**分数**」（0.075 = 7.5%）。
 * 这条规则一旦有两份实现，就一定会有其中一份忘了 ÷100 或忘了减 2 位小数，
 * 而它的表现是**数字看起来是对的**：资本化率填 7.5、存进去 0.075、
 * 收益法拿 0.075 去算 —— 全对。只有另一个模块把 7.5 直接存进去时才是错的，
 * 那时报告上的评估值会差 100 倍，而 R06（金额自洽）比的是渲染值，照样自洽。
 * 所以显示 ×100 / 提交 ÷100 / range 换算 / 小数位减 2 这四件事**只在 attrSchema 里实现一次**，
 * 这里 import 过来用。
 *
 * <h3>🔴 与标的属性不同的三件事</h3>
 * <ol>
 *   <li><b>值分三列</b>：{@code valueNum} / {@code valueStr} / {@code valueJson}，
 *       由 schema 的 {@code type} 决定该填哪一列（{@link valueKindOf}）。
 *       标的属性是 {@code attrs} 里的一个 JSON 对象，没有这个问题。</li>
 *   <li><b>有效期是业务字段</b>：四维回退按 {@code effective_from <= baseDate <= effective_until}
 *       过滤，所以一条「启用但不在有效期内」的参数是**查不到的**，而台账上它看着完全正常
 *       （{@link effectiveStateOf}）。</li>
 *   <li><b>更新是整行提交</b>：{@code QlzgParamDO} 的 11 个可空列挂了
 *       {@code updateStrategy = ALWAYS}，没传的列会被清成 NULL
 *       （{@link buildSaveVO} 因此必须显式装配，不能展开 RespVO）。</li>
 * </ol>
 *
 * <h3>🔴 这个模块**只用 import type** 引 API 模块</h3>
 * 本仓 vitest 没有 jsdom，任何 value-import 到 {@code @/config/axios} 的模块
 * 在收集阶段就会以 {@code window is not defined} 死掉。上面那三行 {@code import type}
 * 编译后不存在，所以 {@code paramSchema.spec.ts} 能在 node 环境里跑到边界。
 */

/**
 * 「长期有效」的哨兵失效日期
 *
 * 🔴🔴 **只用于写**（开关打开时把它填进 {@code effectiveUntil}），**永远不要拿它做比较**。
 *
 * 判「这一行是不是长期有效」一律读后端派生的 {@code longTermEffective}
 * （见 {@link isLongTermEffective}）。理由后端写在 {@code QlzgParamRespVO} 的类注释里：
 * 这个哨兵值已经存在于 DDL 的 {@code DEFAULT} 与 {@code QlzgParamDO.EFFECTIVE_UNTIL_FOREVER}
 * 两处（{@code QlzgParamMapperTest} 钉着它俩相等），前端再比一次就是**第三份拷贝** ——
 * 而它不像前两份有测试钉着，哪天改成 9999-12-30，界面上会显示一个九千多年的日期，
 * 而四维回退照旧把它当永久有效。
 *
 * ⚠️ 写这一份是**无法避免**的：{@code QlzgParamSaveReqVO} 收的是一个 {@code LocalDate}，
 *    没有「长期有效」这个入参，前端只能把这个日期**造出来**发过去。
 */
export const EFFECTIVE_UNTIL_FOREVER = '9999-12-31'

/**
 * 国标行政区划码里表示「全国」的那一个
 *
 * 🔴 与 {@code categoryCode} / {@code industryCode} 用 NULL 表示「通用」**不一致**，
 *    而这是 DDL 定的（脚本 03:681-682）。后果写在 {@code QlzgParamMapper} 的类注释里：
 *    {@code region_code IS NULL} 的行是一条**死行** —— 存得进去、台账里看得见、
 *    任何测算都用不到（候选查询是 {@code region_code IN (回退阶梯)}，而 IN 对 NULL 恒为假），
 *    且不报错。所以辖区码在前端是**必填**，「全国」要显式选 {@code 000000}，
 *    留空不是一个可选形状。
 */
export const NATIONAL_REGION_CODE = '000000'

/** 参数值落在哪一列 */
export type ParamValueKind = 'NUM' | 'STR' | 'JSON'

/** 有效期状态，参照日是**今天**（台账没有项目上下文，拿不到评估基准日） */
export type ParamEffectiveState = 'NOT_YET' | 'VALID' | 'EXPIRED'

/**
 * 这一行是不是长期有效
 *
 * 🔴 读后端派生的布尔，**不比日期字面量**，理由见 {@link EFFECTIVE_UNTIL_FOREVER}
 */
export const isLongTermEffective = (row?: Pick<QlzgParamVO, 'longTermEffective'> | null): boolean =>
  row?.longTermEffective === true

/**
 * 有效期状态
 *
 * 🔴 用**字符串比较**不解析成 Date：后端把 {@code LocalDate} 序列化成 ISO 串
 *    （{@code EnlevJacksonAutoConfiguration} 给了显式 formatter，恒出 {@code YYYY-MM-DD}），
 *    而这个格式的字典序**就是**时间序。绕一圈 Date 的代价是要处理时区 ——
 *    {@code new Date('2026-01-01')} 按 UTC 解析，在东八区取 {@code getDate()} 会得到 1，
 *    在西五区会得到 2025-12-31，同一条参数在两个时区的机器上「已过期」的判定不同。
 *
 * 🔴 {@code effectiveFrom} 为空是「**不限起始**」（DDL 与 Mapper 的口径），不是「还没生效」，
 *    所以它不参与判定。{@code effectiveUntil} 是 NOT NULL 的，但前端仍然要容它为空 ——
 *    台账可能来自一个还没跑完迁移的库，那时显示「有效」比显示「已过期」安全
 *    （显示已过期会让人去改一条其实没问题的参数）。
 *
 * @param today 参照日，ISO 串。做成入参而不是内部取 {@code new Date()}：
 *              纯函数才能测边界（恰好等于 from / 恰好等于 until 这两天）
 */
export const effectiveStateOf = (
  from?: string | null,
  until?: string | null,
  today?: string | null
): ParamEffectiveState => {
  if (!today) return 'VALID'
  if (from && today < from) return 'NOT_YET'
  if (until && today > until) return 'EXPIRED'
  return 'VALID'
}

const EFFECTIVE_STATE_LABEL: Record<ParamEffectiveState, string> = {
  NOT_YET: '尚未生效',
  VALID: '有效期内',
  EXPIRED: '已过期'
}

export const effectiveStateLabel = (state: ParamEffectiveState): string =>
  EFFECTIVE_STATE_LABEL[state]

/**
 * 有效期那一格显示什么
 *
 * 🔴 长期有效显示「长期有效」而不是 {@code 9999-12-31}：
 *    一个九千多年的日期在界面上是噪音，而它想说的其实就是这四个字。
 * 🔴 起始日为空显示「不限起始」而不是留白：留白与「这一格没数据」长得一样，
 *    而这两者在四维回退里是**不同的**（空 = 任何基准日都算生效）。
 */
export const effectiveRangeLabel = (
  row?: Pick<QlzgParamVO, 'effectiveFrom' | 'effectiveUntil' | 'longTermEffective'> | null
): string => {
  if (!row) return ''
  if (isLongTermEffective(row)) {
    return row.effectiveFrom ? `${row.effectiveFrom} 起，长期有效` : '长期有效'
  }
  const from = row.effectiveFrom || '不限起始'
  return row.effectiveUntil ? `${from} ~ ${row.effectiveUntil}` : from
}

/**
 * 辖区码合不合法：恰好 6 位数字
 *
 * 🔴 与 {@code QlzgParamLookup#isLegalRegionCode} 同一口径（{@code REGION_CODE_LENGTH = 6}）。
 *    传一个 5 位的码进去，后端不会报错 —— 它生成的回退阶梯会**只剩 ["000000"]}**，
 *    于是这条参数只能被「全国」那一级命中。表现是「录了西湖区的资本化率，
 *    测算却用了全国的」，而两个数都合法、报告上都会渲染、R36 还会判它「有依据」。
 */
export const isLegalRegionCode = (code?: string | null): boolean => /^\d{6}$/.test(code ?? '')

/**
 * 辖区码是哪一级 —— 也就是它在四维回退阶梯上 sits 多高
 *
 * 🔴 **先判全国**：{@code 000000} 也以 {@code 0000} 结尾，顺序反了会得到「省级」。
 * 🔴 返回 {@code null} 表示「不是合法码」，调用方要显示原值而不是空白 ——
 *    一个非法码在台账里必须**看得出来**，因为它的后果是静默的（见 {@link isLegalRegionCode}）。
 */
export const regionScopeLabel = (code?: string | null): string | null => {
  if (!isLegalRegionCode(code)) return null
  if (code === NATIONAL_REGION_CODE) return '全国'
  if (code!.endsWith('0000')) return '省级'
  if (code!.endsWith('00')) return '市级'
  return '区县级'
}

/**
 * 这条参数的值该落在哪一列
 *
 * <p>🔴 由 schema 的 {@code type} 决定，**不由「哪一列有值」决定** ——
 *    后者正是那个静默故障：值放错列的行**能被四维回退命中**
 *    （命中只看 {@code param_key} 与四个维度），命中之后引擎按 {@code type} 读它认定的那一列，
 *    读到 {@code null}。表现是「参数库明明有这个数，测算却说缺输入」，
 *    而 {@code PARAM_VALUE_REQUIRED} 拦不住它（那一行确实有值，只是在另一列）。
 *
 * <p>🔴 表单**只给一个值输入框**，控件形状由这里决定。给三个框（数值 / 文本 / 复合）
 *    等于把「填错列」这个故障做成界面的默认形状 —— 而后端只会说「这一列不能为空」，
 *    用户看不出真正的问题是另一列有值。
 *
 * <p>⚠️ {@code GEO} 归到 {@code JSON}：{@code QlzgParamServiceImpl#validateValueTypeMatchesSchema}
 *    对 GEO **不校验**，而脚本 06 / 16 里 {@code scope=PARAM} 的 14 个键**没有一个是 GEO**
 *    （{@code geo_location} 是标的属性）。所以这一支今天走不到，留着是为了
 *    {@code valueJson} 有值时台账能把它渲染出来而不是显示空白。
 *
 * @param item 该 {@code paramKey} 在品类 schema 里的声明，可为空（键未声明 / 选了通用品类）
 * @param row  库里那一行，用于**没有 schema 时**的回落
 */
export const valueKindOf = (
  item?: QlzgParamSchemaItem | null,
  row?: Pick<QlzgParamVO, 'valueNum' | 'valueStr' | 'valueJson'> | null
): ParamValueKind => {
  switch (item?.type) {
    case ATTR_TYPE.DECIMAL:
    case ATTR_TYPE.INT:
      return 'NUM'
    case ATTR_TYPE.STRING:
    case ATTR_TYPE.ENUM:
    case ATTR_TYPE.DATE:
      return 'STR'
    case ATTR_TYPE.GEO:
      return 'JSON'
    default:
      break
  }
  // 没有 schema 可依：按这一行**已经**填了哪一列回落。
  // 🔴 NUM 是**兜底**，不是先判的一档：先判 NUM 的话，一条文本型参数（只有 valueStr 有值）
  //    会被认成 NUM，提交时写进 valueNum —— 正是这个函数要防的那个故障。
  //    三列都空时也给 NUM，那是最常见的一档（资本化率、修正系数都是数）
  if (!row) return 'NUM'
  if (!isAbsent(row.valueStr)) return 'STR'
  if (!isAbsent(row.valueJson)) return 'JSON'
  return 'NUM'
}

/**
 * 把一个值写进它该在的那一列，**另外两列显式置 null**
 *
 * 🔴 置 null 不是省掉：{@code updateById} 是全行更新（11 个可空列挂了
 *    {@code updateStrategy = ALWAYS}），省掉一个键与传 null 在 MP 眼里是两件事，
 *    而改了 {@code paramKey}（换到另一种类型的键）时，上一类型那一列**必须**被清掉。
 *    留着的后果是这一行同时有两列有值，而下一次编辑打开表单时
 *    {@link valueKindOf} 按新 schema 只认一列 —— 另一列成了一个界面上看不见、
 *    却仍然躺在库里的值。
 */
export const valueColumnsOf = (
  kind: ParamValueKind,
  value: unknown
): Pick<QlzgParamSaveVO, 'valueNum' | 'valueStr' | 'valueJson'> => ({
  valueNum: kind === 'NUM' && !isAbsent(value) ? (value as number) : null,
  valueStr: kind === 'STR' && !isAbsent(value) ? (value as string) : null,
  valueJson: kind === 'JSON' && !isAbsent(value) ? (value as Record<string, any>) : null
})

/**
 * 台账那一格显示什么
 *
 * 🔴 百分数项**乘回 100** 再显示（复用 {@link toDisplayValue}），与表单口径一致。
 *    台账显示 0.075、表单显示 7.5 的话，用户会以为其中一个错了 —— 而两个都「对」。
 *
 * 🔴 末尾那一步 {@code toPrecision(12)} 是**必需的**，不是洁癖：
 *    {@code 1.1 * 100} 在 JS 里是 {@code 110.00000000000001}（实测），
 *    直接 {@code String()} 出来就是这一串。表单里它被 {@code el-input-number} 的
 *    {@code precision} 挡住了，台账是纯文本，挡不住。
 *    ⚠️ 只在 **schema 没声明 scale** 时走这一支：声明了就用 {@code toFixed(scale)}，
 *    那一步同时负责补零（库里 0.0750 显示成 7.50），两者不能混。
 *
 * @returns 没有值时返回空串（台账那一格留白），不要返回 {@code 'null'}
 */
export const displayValueOf = (
  item: QlzgParamSchemaItem | null | undefined,
  row: Pick<QlzgParamVO, 'valueNum' | 'valueStr' | 'valueJson' | 'unit'>
): string => {
  const kind = valueKindOf(item, row)
  if (kind === 'JSON') {
    return isAbsent(row.valueJson) ? '' : JSON.stringify(row.valueJson)
  }
  const raw = kind === 'NUM' ? row.valueNum : row.valueStr
  if (isAbsent(raw)) return ''
  if (kind === 'STR') return String(raw)
  const shown = toDisplayValue(item ?? ({ type: ATTR_TYPE.DECIMAL } as QlzgParamSchemaItem), raw)
  if (typeof shown !== 'number') return String(raw)
  const precision = item ? displayPrecision(item) : undefined
  // 🔴 没有 schema 就没有 scale，也就没有「该显示几位」的断言 ——
  //    这时**不补零**（凭空造精度正是 R06 那一类规则要防的），只把浮点噪声削掉
  return precision == null ? String(Number(shown.toPrecision(12))) : shown.toFixed(precision)
}

/** 参数表单的模型 */
export interface ParamFormModel {
  id?: number
  paramKey: string
  paramName: string
  /**
   * 空串 = **通用参数**（不绑品类，库里是 NULL）
   *
   * 🔴 模型里只有 `''` 这一种表示，**不要**用 `null` 表示同一件事：
   *    「通用参数」在下拉里是一个 {@code value=""} 的**显式选项**
   *    （它是一个有语义的选择，不是「还没选」），模型值是 `null` 的话
   *    {@code el-select} 命不中那个选项，编辑一条通用参数时品类框会**空着** ——
   *    用户看到的是一个像漏填了的必填框，于是顺手挑一个品类，
   *    一条通用参数就被静默收窄成某个品类专属的了（提交成功、不报错）
   */
  categoryCode?: string | null
  regionCode: string
  industryCode?: string | null
  /**
   * 🔴 单一值输入框的模型值，**显示口径**（百分数已 ×100）
   *
   * ⚠️ 类型刻意是 {@code any} 而不是 {@code unknown} 或一个联合类型：
   *    这一个字段要同时喂给 {@code el-input-number}（要 {@code number}）、
   *    {@code el-input}（要 {@code string}）、{@code el-select}、{@code el-date-picker}
   *    四种控件，而 {@code el-input-number} 的 {@code v-model} 在 vue-tsc 下
   *    **只接受** {@code number | undefined} —— 任何联合类型都会在模板里报
   *    「不能赋给 number」。控件形状由 {@link valueKindOf} 在运行时选，
   *    所以类型上只能放开。与 {@code SubjectForm.vue} 的
   *    {@code attrsModel: Record<string, any>} 是同一条处置。
   */
  value?: any
  unit?: string | null
  effectiveFrom?: string | null
  effectiveUntil?: string | null
  /** 「长期有效」开关。打开时 {@link buildSaveVO} 把哨兵日期填进 effectiveUntil */
  longTermEffective: boolean
  versionNo?: string | null
  basis?: string | null
  /** 🔴 I3 只读，上传与下载归 I6（V5 §15.1 的「参数依据文件」） */
  basisFileId?: number | null
  sourceType: string
  publishedBy?: string | null
  status: number
}

/**
 * 新建时的初值
 *
 * 🔴 {@code effectiveUntil} 是 **null**，不是哨兵日期：哨兵值只在
 *    {@link buildSaveVO} 提交那一刻**造出来**。让它躺在模型里的后果是
 *    「长期有效开着 + 日期框里有值」这个组合从第一秒就成立，
 *    而 {@link validateFormModel} 要拦的正是它（用户先填了日期、又去打开开关，
 *    提交时他的日期会被静默覆盖）—— 一个新建表单什么都没动就过不了校验。
 *    界面上「会写成 9999-12-31」这句话由 {@code ParamForm.vue} 的提示文字给，
 *    不需要日期框里真有一个九千多年的值。
 *
 * 🔴 {@code categoryCode} 是 **''**（= 通用参数），不是 {@code null}：新建表单从第一秒起
 *    就把「通用」这个**合法形状**显示出来，而不是留一个看着像漏填的空框。
 *    那一档的 label 自己写着后果（「不绑品类，任何品类的测算都能命中它」），
 *    所以它不需要再靠「必填」去逼人做选择 —— 与 {@code regionCode} 不同：
 *    辖区码留空**不是**一档（NULL 是死行），所以它是必填、且不给 000000 当默认值
 */
export const emptyFormModel = (): ParamFormModel => ({
  paramKey: '',
  paramName: '',
  categoryCode: '',
  regionCode: '',
  industryCode: null,
  value: undefined,
  unit: null,
  effectiveFrom: null,
  effectiveUntil: null,
  longTermEffective: true,
  versionNo: null,
  basis: null,
  basisFileId: null,
  sourceType: 'ORG_INTERNAL',
  publishedBy: null,
  status: 1
})

/**
 * 库里那一行 → 表单模型
 *
 * 🔴 {@code longTermEffective} 直接抄后端派生的那个布尔，**不比日期**（见上）
 * 🔴 {@code categoryCode} 的 NULL 落成 **''**（模型里通用参数只有这一种表示，见
 *    {@link ParamFormModel}）：落成 {@code null} 的话下拉命不中「通用参数」那一项，
 *    品类框空着，用户顺手挑一个品类就把这条通用参数静默收窄了
 * 🔴 打开开关时把 {@code effectiveUntil} 从模型里清掉：留着 {@code 9999-12-31} 的话，
 *    用户关掉开关会看到一个九千多年的日期躺在日期框里，而那是哨兵值不是他填的
 */
export const loadFormModel = (
  row: QlzgParamVO,
  item?: QlzgParamSchemaItem | null
): ParamFormModel => {
  const longTerm = isLongTermEffective(row)
  const kind = valueKindOf(item, row)
  // 🔴 复合值不走 toDisplayValue：那个函数是给**标的属性的 GEO** 写的，
  //    它只认 {lng, lat} 两个键，拿去处理一个任意形状的 JSON 会得到一个空点
  const raw =
    kind === 'JSON' ? row.valueJson : kind === 'NUM' ? row.valueNum : row.valueStr
  return {
    id: row.id,
    paramKey: row.paramKey,
    paramName: row.paramName,
    categoryCode: row.categoryCode ?? '',
    regionCode: row.regionCode,
    industryCode: row.industryCode ?? null,
    value: kind === 'JSON' ? raw : item ? toDisplayValue(item, raw) : (raw ?? undefined),
    unit: row.unit ?? null,
    effectiveFrom: row.effectiveFrom ?? null,
    effectiveUntil: longTerm ? null : (row.effectiveUntil ?? null),
    longTermEffective: longTerm,
    versionNo: row.versionNo ?? null,
    basis: row.basis ?? null,
    basisFileId: row.basisFileId ?? null,
    sourceType: row.sourceType,
    publishedBy: row.publishedBy ?? null,
    status: row.status
  }
}

/**
 * 表单模型 → 提交给后端的整行
 *
 * <h3>🔴 逐字段装配，**不展开** {@code QlzgParamVO}</h3>
 * RespVO 上有五个字段 SaveReqVO 上**没有**：{@code longTermEffective} /
 * {@code sourceTypeDescription} / {@code platformLevel} / {@code creator} / {@code createTime}。
 * 把它们一起发上去今天不会报错（后端按字段名绑定，多的忽略），
 * 但那是**碰巧**：哪天后端给 SaveReqVO 加一个同名的派生字段，
 * 前端这份展开就会开始往写路径上送一个服务端本来要自己算的值 ——
 * 而 {@code canBeBlockRule} 正是这样一个字段（见下）。
 *
 * <h3>🔴 {@code canBeBlockRule} **不由前端决定**</h3>
 * 后端 {@code applyDerivedColumns} 按 {@code source_type} 强制派生它
 * （{@code EXPERT_GUIDE} ⇒ false，§11.9.1 纪律 2），所以这里**不发**这个字段。
 * 表单上那个开关是灰的、且 {@code EXPERT_GUIDE} 时被强制成 false，
 * 那是**提示**不是控制 —— 真正的控制在服务端。
 * 前端发它的话，等于宣称自己知道这一列该是什么，而后端会把它覆盖掉：
 * 界面上勾了、库里是 0，用户看到的是「开关不生效」。
 *
 * <h3>🔴 长期有效开关打开时**造出**哨兵日期</h3>
 * {@code effectiveUntil} 在后端是必填（{@code PARAM_EFFECTIVE_UNTIL_REQUIRED}），
 * 而 DDL 的 {@code DEFAULT '9999-12-31'} **救不了**它：靠默认值的话
 * 「我没填」与「我判断它长期有效」在库里是同一个东西，而前者是漏了、后者是专业判断。
 *
 * <h3>🔴 复合值（{@code valueJson}）原样带回，不碰</h3>
 * PARAM 作用域的 14 个键里**没有一个是复合值**，所以本页不给它输入控件。
 * 但「不给输入控件」不等于「这一行改不动了」—— 那样用户连改个参数名都会被挡住
 * （与 {@code attrSchema} 的孤儿键是同一条纪律：界面上看不见的值不能因为看不见就被清掉）。
 * 所以这一支把 {@code original.valueJson} 原样写回。
 *
 * @param item     该 {@code paramKey} 的 schema 声明；为空时值不做类型换算，原样发
 * @param original 编辑时 {@code /get} 回来的那一行。**两个用途**：
 *                 ① 没有 schema 可依时，回落判「这一行的值本来在哪一列」
 *                 （不传的话一律按 NUM 处理，于是一条文本型参数会被写进 {@code valueNum}
 *                 —— 正是 {@link valueKindOf} 要防的那个静默故障）；
 *                 ② 复合值原样带回。新建时传 {@code null}
 */
export const buildSaveVO = (
  model: ParamFormModel,
  item?: QlzgParamSchemaItem | null,
  original?: QlzgParamVO | null
): QlzgParamSaveVO => {
  const kind = valueKindOf(item, original)
  // 🔴 换算成存储口径（百分数 ÷100、INT 截断、空白 → undefined）
  const stored =
    kind === 'JSON'
      ? (original?.valueJson ?? null)
      : item
        ? toStoredValue(item, model.value)
        : model.value
  return {
    id: model.id,
    paramKey: model.paramKey,
    paramName: model.paramName,
    // 通用参数 / 全行业在库里是 NULL，不是空串：
    // 🔴 台账的 categoryCode / industryCode 是**精确**匹配、刻意不加 OR IS NULL
    //    （selectVisiblePage 的注释：加了 OR 这个筛选框就说谎，选了住宅会混进一堆通用行，
    //    而想看通用参数的那一半再也筛不出来）。所以发空串的后果不是「查不到」，
    //    而是这一行落进一个**筛不出来**的集合里
    categoryCode: isAbsent(model.categoryCode) ? undefined : (model.categoryCode as string),
    regionCode: model.regionCode,
    industryCode: isAbsent(model.industryCode) ? undefined : (model.industryCode as string),
    ...valueColumnsOf(kind, isAbsent(stored) ? undefined : stored),
    unit: isAbsent(model.unit) ? undefined : (model.unit as string),
    effectiveFrom: isAbsent(model.effectiveFrom) ? null : (model.effectiveFrom as string),
    effectiveUntil: model.longTermEffective
      ? EFFECTIVE_UNTIL_FOREVER
      : (model.effectiveUntil as string),
    versionNo: isAbsent(model.versionNo) ? undefined : (model.versionNo as string),
    basis: isAbsent(model.basis) ? undefined : (model.basis as string),
    basisFileId: model.basisFileId ?? null,
    sourceType: model.sourceType,
    publishedBy: isAbsent(model.publishedBy) ? undefined : (model.publishedBy as string),
    status: model.status
  }
}

/**
 * 提交前的一道友好提示，返回**人看得懂**的那一句；没问题时返回 {@code null}
 *
 * ⚠️ 这**不替代**后端校验。后端还管类型与列的匹配、range、ENUM 可选值、
 *    {@code paramKey} 是否在 schema 里声明过、平台级行不可改这些这里刻意不重复实现的规则
 *    （重复实现就是两份会漂移的检查点）。这里只拦**后端拦不住或拦得很晚**的几件：
 *    辖区码形状（后端会拦，但报错发生在四个字段都填完之后）、
 *    长期有效与失效日期同时给了（后端只会用哨兵值覆盖，用户看不到自己填的日期没了）、
 *    以及值超 range（后端会拦，但那时用户已经等了一个往返，而且它那句报错
 *    要说清「库里存的是分数」这件事，前端在**显示口径**上说更直接）。
 *
 * @param item     该 {@code paramKey} 的 schema 声明
 * @param original 编辑时 {@code /get} 回来的那一行，与 {@link buildSaveVO} 同一个用途
 */
export const validateFormModel = (
  model: ParamFormModel,
  item?: QlzgParamSchemaItem | null,
  original?: QlzgParamVO | null
): string | null => {
  if (isAbsent(model.paramKey)) return '请选择或填写参数键'
  if (isAbsent(model.paramName)) return '请填写参数名称'
  if (!isLegalRegionCode(model.regionCode)) {
    return '辖区码必须是 6 位国标行政区划码（全国填 000000）——' +
      '填 5 位不会报错，但这条参数只能被「全国」那一级命中'
  }
  if (!model.longTermEffective && isAbsent(model.effectiveUntil)) {
    return '失效日期必填：长期有效请打开上面的开关，不要留空'
  }
  if (model.longTermEffective && !isAbsent(model.effectiveUntil)) {
    return '「长期有效」已打开，失效日期会被写成 9999-12-31；要指定一个失效日期请先关掉开关'
  }
  if (!model.longTermEffective && model.effectiveFrom && model.effectiveUntil
      && model.effectiveFrom > model.effectiveUntil) {
    return '生效日期不能晚于失效日期'
  }
  if (isAbsent(model.sourceType)) return '请选择来源类型'
  if (!item) return null
  const kind = valueKindOf(item, original)
  // 🔴 复合值不给输入控件，所以这里**不校验它的值**：
  //    拦下来的话这一行连改个名字都提交不了（见 buildSaveVO 的复合值那一段）
  if (kind === 'JSON') return null
  const stored = toStoredValue(item, model.value)
  if (isAbsent(stored)) return `请填写参数「${item.label || item.key}」的值`
  if (item.type === ATTR_TYPE.ENUM && item.options?.length
      && !item.options.includes(String(stored))) {
    return `参数「${item.label || item.key}」的取值只能是：${item.options.join(' / ')}`
  }
  if (kind !== 'NUM') return null
  const shown = Number(model.value)
  if (!Number.isFinite(shown)) return null
  // 🔴 比的是**显示口径**：displayRange 已经把库里的分数区间换算成百分数了
  //    （[0.01, 0.30] → [1, 30]），所以这里报「不能大于 30%」而不是「不能大于 0.3」
  const { min, max } = displayRange(item)
  const unit = item.unit ?? ''
  if (min != null && shown < min) {
    return `参数「${item.label || item.key}」不能小于 ${min}${unit}`
  }
  if (max != null && shown > max) {
    return `参数「${item.label || item.key}」不能大于 ${max}${unit}`
  }
  return null
}

/**
 * 🔴 「专家指引」一律不能派生 BLOCK 级规则（§11.9.1 纪律 2）
 *
 * 前端把它做成**灰掉的开关**而不是校验，理由与后端同一条：
 * 前端禁用只是提示，绕过前端照样能提交，而库里那一列一旦被写成 1，
 * I5 的规则配置页就会允许把一条专家指引配成 BLOCK，那时已经没有第二道校验了 ——
 * 所以真正的强制在服务端 {@code applyDerivedColumns}，这里只负责让用户**看得见**它为什么灰。
 */
export const canBeBlockRuleLocked = (sourceType?: string | null): boolean =>
  sourceType === 'EXPERT_GUIDE'
