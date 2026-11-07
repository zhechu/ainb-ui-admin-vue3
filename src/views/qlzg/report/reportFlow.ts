import type {
  QlzgReportComposeVO,
  QlzgReportFieldPendingVO,
  QlzgReportFieldSaveVO,
  QlzgReportFieldVO,
  QlzgReportSectionVO,
  QlzgReportVersionDiffVO,
  QlzgReportVersionFieldDiffVO,
  QlzgReportVersionSectionDiffVO,
  QlzgReportVO
} from '@/api/qlzg/report'
import { FIELD_SOURCE_TYPE_OPTIONS, SECTION_CONTENT_MODE_OPTIONS, labelOf } from '../constants'

/**
 * 报告作业台的**纯逻辑**层：章节树、字段分组、四态值搬运、成文状态措辞
 *
 * <h3>为什么单独一层</h3>
 * 作业台那一个 `.vue` 已经有三栏（章节树 / 字段行 / 话术候选）与六个对话框，
 * 把「怎么拼 payload」「什么时候该说请重新成文」也塞进去，
 * 下一个改这里的人要在七百行模板里找一句判断。而这一层的每一个函数都是
 * 「算错了不会报错、只会让评估师做错事」的那一类：
 *
 * <ul>
 *   <li>{@link payloadOf} 少搬一态 ⟹ 库里躺着一个谁也不读的旧值；</li>
 *   <li>{@link composeState} 把 STALE 说成 FRESH ⟹ 一份<b>旧值</b>的 Word 被交出去，
 *       而两份文件在纸面上长得一模一样；</li>
 *   <li>{@link tokenCostText} 把 0 显示成「¥0」⟹ D2 的验收证据对不上库里那一列。</li>
 * </ul>
 *
 * 这三件事都是 HTTP 200、类型检查绿、单测绿，只有真交出一份报告才显形。
 *
 * <h3>🔴 这一层刻意**不做门禁**</h3>
 * 定稿那几道闸是**有顺序**的，而那个顺序是产品决定（按「评估师当场能改」的先后排，
 * 于是一次报错只指向一件他能立刻做的事）。前端抄一份判据去预先禁用按钮，
 * 顺序迟早会与后端漂开 —— 漂开之后他会先补完 12 个占位符、再被拦一次说「你还没成文」，
 * 每拦一次都要重新读一遍报错、重新找一遍按钮。
 * 所以这里**只**读服务端落定的 {@code editable}，其余一律「发请求 → 把后端原文显示出来」。
 */

/** 章节树的一节。🔴 `children` 的顺序就是后端给的顺序，不要再按 `sort` 排 */
export interface SectionNode extends QlzgReportSectionVO {
  children: SectionNode[]
}

/**
 * 把扁平的章节清单拼成树
 *
 * <h3>🔴 一律按后端给的顺序追加，**不 sort**</h3>
 * `/section/list` 已经按 {@code sort} 排好了，而那个 {@code sort} 是<b>文档顺序</b>
 * —— §11.18 的「中断停在章节边界」说的就是这一列的边界。
 * 前端再排一次的话，两个排序键（后端的 SQL ORDER BY 与前端的比较函数）
 * 迟早会在并列值上给出不同答案，而表现是「目录顺序与 Word 里的顺序不一样」。
 *
 * <h3>🔴 认不出父节点的行**挂在根上**，不丢掉</h3>
 * {@code parentId} 指向一个不在清单里的行（数据被手工改过、或某一节被删了）时，
 * 丢掉它等于让评估师看不到那一节的字段 —— 而那些字段仍然会被渲染进 Word。
 * 挂到根上至少是能看见的。
 */
export const buildSectionTree = (sections?: QlzgReportSectionVO[] | null): SectionNode[] => {
  const list = sections ?? []
  const byId = new Map<number, SectionNode>()
  for (const row of list) {
    if (row?.id === null || row?.id === undefined) continue
    byId.set(row.id, { ...row, children: [] })
  }
  const roots: SectionNode[] = []
  for (const row of list) {
    const node = row?.id === null || row?.id === undefined ? null : byId.get(row.id)
    if (!node) continue
    const parent = node.parentId === null || node.parentId === undefined ? null : byId.get(node.parentId)
    if (parent && parent !== node) {
      parent.children.push(node)
    } else {
      roots.push(node)
    }
  }
  return roots
}

/** 深度优先拍平，用来在树上找一节（ el-tree 的 node-key 之外还要按码找） */
export const flattenSections = (roots?: SectionNode[] | null): SectionNode[] => {
  const out: SectionNode[] = []
  const walk = (nodes: SectionNode[]) => {
    for (const node of nodes) {
      out.push(node)
      walk(node.children ?? [])
    }
  }
  walk(roots ?? [])
  return out
}

/** 层级缩进：全角空格，半角在 el-tree 之外的地方会被折叠掉 */
export const sectionIndent = (level?: number | null): string =>
  '　'.repeat(Math.max(0, (level ?? 1) - 1))

/**
 * 按节分组字段行，**保持后端顺序**
 *
 * 🔴 返回的是 {@code Map}，键是 {@code sectionId}；{@code sectionId} 为空的那一批
 *    挂在 {@link ORPHAN_SECTION_KEY} 下 —— 页眉与首页表格里那几格不属于任何一节，
 *    把它们丢掉的话评估师就改不到报告抬头上的委托方名称与基准日。
 */
export const ORPHAN_SECTION_KEY = '__no_section__'

export const groupFieldsBySection = (
  fields?: QlzgReportFieldVO[] | null
): Map<string, QlzgReportFieldVO[]> => {
  const out = new Map<string, QlzgReportFieldVO[]>()
  for (const row of fields ?? []) {
    if (!row) continue
    const key = row.sectionId === null || row.sectionId === undefined ? ORPHAN_SECTION_KEY : String(row.sectionId)
    const bucket = out.get(key) ?? []
    bucket.push(row)
    out.set(key, bucket)
  }
  return out
}

export const fieldsOfSection = (
  grouped: Map<string, QlzgReportFieldVO[]>,
  sectionId?: number | null
): QlzgReportFieldVO[] =>
  grouped.get(sectionId === null || sectionId === undefined ? ORPHAN_SECTION_KEY : String(sectionId)) ?? []

/**
 * 「标红且还没确认」的行数 —— 定稿第二道闸（R16）要它归零
 *
 * 🔴 只**数**，不据此禁用定稿按钮：闸的顺序在后端，理由见文件头那段。
 *    这个数字的用处是让评估师在点定稿之前就知道还差几格，
 *    而不是替他决定能不能点。
 * 🔴 判据是 {@code isMarked === true && isConfirmed !== true}，
 *    两个都由服务端落定（{@code isMarked} 甚至**不接受提交**）。
 *    前端不要自己按 {@code sourceType} 推「哪些该标红」——
 *    那条口径在后端是「{@code PARAM} 一律标红」，比枚举注释里写的更粗，
 *    抄一份过来就会漂。
 */
export const markedUnconfirmedCount = (fields?: QlzgReportFieldVO[] | null): number =>
  (fields ?? []).filter((row) => row?.isMarked === true && row?.isConfirmed !== true).length

/** 已经填了值的行数（四态里任一非空即算填了） */
export const filledCount = (fields?: QlzgReportFieldVO[] | null): number =>
  (fields ?? []).filter((row) => hasValue(row)).length

export const hasValue = (row?: QlzgReportFieldVO | null): boolean => {
  if (!row) return false
  return (
    (row.valueStr !== null && row.valueStr !== undefined && row.valueStr !== '') ||
    (row.valueNum !== null && row.valueNum !== undefined) ||
    (row.valueDate !== null && row.valueDate !== undefined && row.valueDate !== '') ||
    (row.valueJson !== null && row.valueJson !== undefined)
  )
}

/** 字段编辑框的草稿。🔴 四态全带着，不只是当前 kind 的那一态 */
export interface FieldDraft {
  fieldKey: string
  fieldKind: string
  placeholder?: string | null
  sort?: number | null
  text?: string | null
  num?: number | null
  date?: string | null
  json?: Record<string, any> | null
}

/**
 * 从一行读出草稿
 *
 * 🔴 **四态一起读**，不是只读 {@code fieldKind} 对应的那一态。
 *    {@link payloadOf} 要把四态一起发回去，少读一态就等于把它清成 null。
 */
export const draftOf = (row: QlzgReportFieldVO): FieldDraft => ({
  fieldKey: row.fieldKey,
  fieldKind: row.fieldKind,
  placeholder: row.placeholder ?? null,
  sort: row.sort ?? null,
  text: row.valueStr ?? null,
  num: row.valueNum ?? null,
  date: row.valueDate ?? null,
  json: row.valueJson ?? null
})

export const blankDraft = (fieldKey: string, fieldKind = 'TEXT'): FieldDraft => ({
  fieldKey,
  fieldKind,
  placeholder: null,
  sort: null,
  text: null,
  num: null,
  date: null,
  json: null
})

/**
 * 待填格那一行在草稿仓库里的 key 前缀
 *
 * 🔴 与手工「新增一格」的 {@code pending-N} **刻意分开**：两批行的生命周期不一样，
 *    而分辨它们只能靠前缀 —— 按「在不在服务端的清单里」判会把手工加的那一批全删掉
 *    （它们的字段键可能还是空的，也可能是一个模板压根没声明的键，
 *    两种都不会出现在清单里）
 */
export const TEMPLATE_PENDING_PREFIX = 'tpl-'

/** 草稿仓库里的一行：已有行按 {@code String(id)} 存，待填 / 新加的行按一个合成 key 存 */
export interface PendingRow {
  key: string
  sectionId: number | null
  draft: FieldDraft
}

export const templatePendingKey = (sectionId: number, fieldKey: string): string =>
  `${TEMPLATE_PENDING_PREFIX}${sectionId}::${fieldKey}`

/**
 * 把服务端给的待填格并进草稿仓库
 *
 * <h3>🔴 **合并**，不是重建：仓库里可能正躺着评估师敲了一半的字</h3>
 * 存任何一格之后都要重拉字段行（那一格的缺值计数与「需重新成文」标记要重算），
 * 待填清单跟着重拉一次。按服务端那一份**重建**的话，他在别的格子上敲的草稿
 * 会在每次保存之后被清空 —— 界面上一行字忽然没了，
 * 而他的第一反应是「这个工具存不住东西」。
 *
 * <h3>🔴 清单里不再出现的那一批要**删掉**，这不是可选的清理</h3>
 * 服务端的判据是「这个键在本报告已经有行了就不再出格」，
 * 所以「从清单里消失」恰恰意味着「刚存进去的那一格」。留着它的话表上会有两行同一个键
 * （一行已落库、一行是这条幽灵），评估师在幽灵上再点一次保存就建出**同键第二行** ——
 * 而后端一个键只渲**一行**（{@code indexByFieldKey} 取 {@code sort} 最小的那一行），
 * 于是他填的值**静默不渲**：存值 200、界面上那一格消失、Word 里仍是旧值。
 */
export const mergeTemplatePending = (
  store?: PendingRow[] | null,
  cells?: QlzgReportFieldPendingVO[] | null
): PendingRow[] => {
  const wanted = new Map<string, QlzgReportFieldPendingVO>()
  for (const cell of cells ?? []) {
    if (!cell?.fieldKey || cell.sectionId === null || cell.sectionId === undefined) continue
    wanted.set(templatePendingKey(cell.sectionId, cell.fieldKey), cell)
  }
  const out: PendingRow[] = []
  const kept = new Set<string>()
  for (const row of store ?? []) {
    const key = String(row?.key ?? '')
    if (!key.startsWith(TEMPLATE_PENDING_PREFIX)) {
      out.push(row)
      continue
    }
    if (!wanted.has(key)) continue
    out.push(row)
    kept.add(key)
  }
  for (const [key, cell] of wanted) {
    if (kept.has(key)) continue
    out.push({
      key,
      sectionId: cell.sectionId,
      draft: blankDraft(cell.fieldKey, cell.fieldKind || 'TEXT')
    })
  }
  return out
}

/** 这一档 kind 读/写哪一态。🔴 与后端 {@code QlzgReportFieldKindEnum} 同一份口径 */
export const NUMERIC_KINDS = ['AMOUNT', 'RATE', 'AREA', 'COUNT']

export const isNumericKind = (kind?: string | null): boolean => NUMERIC_KINDS.includes(kind ?? '')

/**
 * 拼 `/field/save` 的 payload
 *
 * <h3>🔴 四态<b>一起</b>搬，空的传显式 null</h3>
 * 后端 {@code applyValue} 是四行无条件 set，配 {@code FieldStrategy.ALWAYS}，
 * 靠一个显式的 null 把旧那一态清掉。只传「有值的那一态」的话，
 * 从 TEXT 改成 DATE 之后 {@code value_str} 里的旧文本还在，
 * 而渲染按 {@code fieldKind} 只读一态 —— 库里躺着一个谁也不读的旧值，
 * 出问题时排查方向会跑到渲染器上去。
 *
 * <h3>🔴 {@code sourceType} / {@code sourceRefId} / {@code provenanceId} <b>原样回传</b></h3>
 * 后端 {@code updateField} 对这三列也是无条件 set。少传 {@code sourceRefId}
 * 就等于把一条话术插入的行改成「来源不明」，而溯源那一栏空着时
 * R36「有依据」照样判它有依据。
 *
 * <p>⚠️ 也正因为这三列是无条件 set，作业台<b>不给</b>「改来源」这个下拉：
 *    一条 PHRASE 行被人改成 MANUAL 之后，{@code sourceRefId} 还指着那条话术 ——
 *    那是一处<b>悬空引用</b>，而它在界面上看不出任何异常。
 *    来源是「谁写的这一格」这个事实，不该由改值的人重新宣称。
 *
 * <h3>🔴 {@code valueNum} 的定标在浏览器里<b>已经丢了</b>，所以没改就别发</h3>
 * 后端那一列是 {@code BigDecimal}，序列化出来是 {@code 1200.00}，
 * 而 {@code JSON.parse} 把它变成 JS 的 {@code 1200} —— 那两位小数再也拿不回来。
 * 后端判「值有没有变」用的是 {@code Objects.equals}，而 {@code BigDecimal.equals}
 * **比定标**：{@code 1200.00} 与 {@code 1200} 不相等。
 * 于是一次「只改了排序」的保存会被判成「值变了」，把已确认的红标打回未确认。
 * 这不是能修的（前端拿不到原文），只能<b>不发</b>：{@link draftChanged} 判没变就不调接口。
 * 作业台也刻意不提供排序与占位符的编辑，理由同这一条。
 */
export const payloadOf = (
  reportId: number,
  row: QlzgReportFieldVO | null,
  draft: FieldDraft,
  sourceType = 'MANUAL'
): QlzgReportFieldSaveVO => ({
  id: row?.id ?? null,
  reportId,
  sectionId: row?.sectionId ?? null,
  fieldKey: draft.fieldKey,
  fieldKind: draft.fieldKind,
  placeholder: draft.placeholder ?? null,
  sort: draft.sort ?? null,
  valueStr: draft.text ?? null,
  valueNum: draft.num ?? null,
  valueDate: draft.date ?? null,
  valueJson: draft.json ?? null,
  sourceType: row?.sourceType || sourceType,
  sourceRefId: row?.sourceRefId ?? null,
  provenanceId: row?.provenanceId ?? null
})

/**
 * 草稿与原行比，有没有**实质**改动
 *
 * 🔴 判据与后端 {@code valueChanged} 同源（逐态比，不比整行），
 *    但**多**比 {@code fieldKind}：改了 kind 而值恰好都是空，
 *    后端会说「值没变」于是不动确认状态，可库里那一列的语义已经换了
 *    （TEXT 的空与 AMOUNT 的空不是一回事，渲染读的是不同的态）。
 *    这种情况必须发出去。
 * 🔴 数值用 {@code Number()} 归一之后再比：{@code draft.num} 来自输入框，
 *    可能是字符串 {@code "1200"}，而原行是数字 {@code 1200}，
 *    直接 {@code !==} 会判成「改了」，于是白发一次请求、白复位一次确认。
 */
export const draftChanged = (row: QlzgReportFieldVO | null, draft: FieldDraft): boolean => {
  if (!row) return true
  const num = (v: any) => (v === null || v === undefined || v === '' ? null : Number(v))
  const text = (v: any) => (v === null || v === undefined ? null : String(v))
  return (
    text(row.fieldKey) !== text(draft.fieldKey) ||
    text(row.fieldKind) !== text(draft.fieldKind) ||
    text(row.placeholder) !== text(draft.placeholder) ||
    text(row.valueStr ?? null) !== text(draft.text ?? null) ||
    num(row.valueNum ?? null) !== num(draft.num ?? null) ||
    text(row.valueDate ?? null) !== text(draft.date ?? null) ||
    JSON.stringify(row.valueJson ?? null) !== JSON.stringify(draft.json ?? null)
  )
}

/**
 * 成文状态三档
 *
 * <h3>🔴 STALE 与 NEVER 必须是**两句话**，不能共用一个提示</h3>
 * {@code composeStale = true} 说的是「成过文，但之后字段值又改过，
 * 那份 Word 已经不是库里的值」—— 不提示的话评估师会把一份<b>旧值</b>的
 * Word 交出去，而两份文件在纸面上长得一模一样，只有逐字比对才发现某一格是改之前的数。
 * {@code composeStale = false} 且 {@code wordFileId} 为空是「还没成过文」，
 * 那是完全不同的处境（他手上什么都没有，不会误交）。
 *
 * <p>⚠️ 第三档 FRESH 也<b>不等于</b>「可以定稿」：残留占位符与红标确认是另外两道闸，
 *    而闸的顺序在后端。这里只说文件新不新。
 */
export type ComposeState = 'NEVER' | 'STALE' | 'FRESH'

export const composeState = (report?: QlzgReportVO | null): ComposeState => {
  if (!report?.wordFileId) return 'NEVER'
  return report.composeStale === true ? 'STALE' : 'FRESH'
}

export const composeStateText = (report?: QlzgReportVO | null): string => {
  const state = composeState(report)
  if (state === 'NEVER') return '还没成过文，报告目录下现在没有可下载的 Word'
  if (state === 'STALE') return '成过文，但之后又改过字段值——那份 Word 里是改之前的值，请重新成文'
  return '成稿与库里的值一致'
}

export const composeStateTagType = (
  report?: QlzgReportVO | null
): 'primary' | 'success' | 'warning' | 'info' => {
  const state = composeState(report)
  if (state === 'STALE') return 'warning'
  if (state === 'FRESH') return 'success'
  return 'info'
}

export const composeButtonLabel = (report?: QlzgReportVO | null): string =>
  composeState(report) === 'NEVER' ? '成文' : '重新成文'

/**
 * 成文返回之后要说的那一句
 *
 * <h3>🔴 {@code placeholderRemaining > 0} 时成文**仍然是成功的**</h3>
 * 那份 Word 已经生成好了，评估师要<b>下载它</b>才看得出缺的是哪一格。
 * 说成「成文失败」他会去重试，而重试一百次也是同一处缺口。
 * 说成「成文成功」他可能直接去定稿 —— 所以要说成「成文完成，但……」。
 *
 * <h3>🔴🔴 两个计数器**分成两句**说，各自带自己的出路</h3>
 * {@code placeholderRemaining} 认的是模板里的<b>花括号</b>，出路是<b>改模板</b>；
 * {@code missing} 认的是<b>取不到值的格子</b>（纸上印【缺值】/【未映射】），出路是<b>填值</b>。
 * 上一版把 {@code missing} 的清单嵌在 {@code remaining > 0} 那一支里面，
 * 于是「花括号全闭合了、但 12 个格子取不到值」这一份成文结果
 * 显示成一句干净的「成文完成，没有残留的占位符」——
 * 而 {@code QlzgReportRespVO#valueMissingCount} 那段注释点名要求
 * 「要说是哪几格，去成文响应里的 missing 清单（那才是名字）」。
 * 名字就在这个响应里，却因为另一列为 0 而一个字都没印出来，
 * 用户接着去定稿、被 {@code REPORT_VALUE_MISSING} 拦下，
 * 报错给的还是一个数（不是名字），于是只能回 Word 里一个个找
 *
 * <h3>🔴 {@code missing} 的措辞**不许**说成「纸上有 N 处」</h3>
 * 数的是去重后的模型键：一个占位符在纸上出现十次只算 1。
 * 说「纸上有 3 处」而用户在 Word 里数出 11 处的话，他会认为这个数不可信 ——
 * 而这恰好是定稿闸的判据
 *
 * <h3>🔴 {@code reserved} 非空要说「公章位已预留」</h3>
 * 那是模板声明了、而签章功能在 I30 之前刻意不给数据的键。
 * 不说的话评估师会在 Word 里看到三处空白，以为是自己漏填了。
 *
 * <h3>🔴 {@code replacedFileId} **不要**显示成「已清理」</h3>
 * 它<b>不会被删</b>（{@code FileApi} 没有删除方法），每重新成文一次就多一份孤儿字节，
 * 而它们都算客户的存储账单。这条欠账记在 I6。
 * 界面上提它只会引出「那怎么清掉」这个当前答不了的问题，所以什么都不说。
 *
 * <h3>⚠️ 返回的这一段是**纯文本**，里面不许出现 markdown 记号</h3>
 * 它被 {@code ReportWorkbench} 用插值印在一个弹层里，
 * {@code **加粗**} 会连着星号一起显示出来（案例页栽过一次）
 */
export const composeResultText = (result?: QlzgReportComposeVO | null): string => {
  if (!result) return ''
  const remaining = result.placeholderRemaining ?? 0
  const missing = (result.missing ?? []).filter((key) => !!key)
  const parts: string[] = []
  if (remaining === 0 && missing.length === 0) {
    parts.push('成文完成，模板里的花括号全部闭合了，每一个格子也都取到了值')
  } else {
    const issues = (remaining > 0 ? 1 : 0) + (missing.length > 0 ? 1 : 0)
    parts.push(
      issues > 1
        ? '成文完成，那份 Word 已经产出，但定稿之前有两件事要分别处理'
        : '成文完成，那份 Word 已经产出，但定稿之前还有一件事要处理'
    )
    if (remaining > 0) {
      parts.push(
        `模板里还有 ${remaining} 个占位符没闭合。它们认的是花括号，出路是去改模板` +
          '（改完要发布一个新版本）—— 在这一页填值不会动这个数。' +
          '下载下来搜左花括号就能找到它们'
      )
    }
    if (missing.length > 0) {
      parts.push(
        `有 ${missing.length} 个格子取不到值，纸上印的是【缺值】或【未映射】。` +
          `它们是：${missing.join('、')}。出路是去填值，不是去改模板`
      )
    }
  }
  const reserved = (result.reserved ?? []).filter((key) => !!key)
  if (reserved.length > 0) {
    parts.push(`公章位已预留（${reserved.join('、')}），签章功能在后续迭代，导出时该位留空`)
  }
  return parts.join('。')
}

/**
 * 这次成文**有没有**要在定稿之前处理的事
 *
 * 🔴 两个计数器**都**算，理由与 {@link composeResultText} 那一段完全相同：
 *    只认 {@code placeholderRemaining} 的话，「花括号全闭合、12 个格子取不到值」
 *    这一次成文会显示成一个绿色的成功标题，而用户接着去定稿才被拦下
 */
export const composeHasIssue = (result?: QlzgReportComposeVO | null): boolean => {
  if (!result) return false
  return (result.placeholderRemaining ?? 0) > 0 || (result.missing ?? []).some((key) => !!key)
}

/** 成文结果弹层的标题 */
export const composeResultTitle = (result?: QlzgReportComposeVO | null): string => {
  if (!result) return ''
  const remaining = result.placeholderRemaining ?? 0
  const missing = (result.missing ?? []).filter((key) => !!key).length
  if (remaining > 0 && missing > 0) return '成文完成，但占位符与缺值格子两件事都要处理'
  if (remaining > 0) return '成文完成，但还有未闭合的占位符'
  if (missing > 0) return '成文完成，但还有取不到值的格子'
  return '成文完成'
}

/**
 * 定稿时「本版说明」是否必填
 *
 * 🔴 判据是 {@code versionNo > 1}，与后端 {@code finalizeReport} 同一条：
 *    第 1 版留空（逼他为一版「初始定稿」编一句他只会写「首次定稿」的摘要，
 *    等于没有这一项），第 2 版及以后必填。
 * 🔴 {@code versionNo} 是**本报告**的第几版，由「退回修订」递增，
 *    与模板的版本号是两套号 —— 界面上同时出现两个「版本」时必须写清是谁的。
 */
export const changeSummaryRequired = (report?: QlzgReportVO | null): boolean =>
  (report?.versionNo ?? 1) > 1

/**
 * 作废人怎么显示
 *
 * 🔴 {@code voidedByName} 为空时要渲染成「已离岗（编号 N）」，**不要**渲染成空白：
 *    空白会被读成「没有人作废过它」，而报告号的唯一性查全库**含 VOIDED**
 *    （作废掉的号也不会被复用），一份看不出被谁作废的报告在复核时是一堵墙。
 */
export const voidedByText = (report?: QlzgReportVO | null): string => {
  if (!report?.voidedAt && !report?.voidedBy) return '—'
  if (report.voidedByName) return report.voidedByName
  return report.voidedBy ? `已离岗（编号 ${report.voidedBy}）` : '未记下操作人'
}

/**
 * token 成本怎么显示 —— D2 验收的可对账证据
 *
 * <h3>🔴 恰好为 0 时补六位小数，别的值一律原样</h3>
 * D2 的判据是 {@code qlzg_report.token_cost = 0.000000 且 mode = M0}，
 * 客户 IT 会拿界面上这个数去和库里那一列对。显示成「¥0」对不上账。
 *
 * <p>⚠️ 但<b>不要</b>一律 {@code toFixed(6)}：那会四舍五入一个非零值，
 *    而补出来的那几位在后端没有对应项。M0 恒为 0，所以只对 0 补位是安全的；
 *    真到了 I9 上 M2，非零值要按后端给的原文显示，而不是前端补零。
 *
 * <p>🔴 前端**不做任何算术**（不乘单价、不求和、不算占比）。
 *    {@code 0.1 + 0.2 !== 0.3}，而这一列是钱。
 */
export const tokenCostText = (cost?: number | null): string => {
  if (cost === null || cost === undefined) return '—'
  return cost === 0 ? '0.000000' : String(cost)
}

/**
 * 下载到的那一份是不是草稿
 *
 * 🔴 {@code finalized = false} 时界面与文件名都要说出来。
 *    一份草稿的 Word 与定稿的 Word 在纸面上<b>没有区别</b>
 *    （定稿不改正文，只冻结一版并写档案），
 *    而交出去的是哪一份，30 年后翻档案的人只能靠文件名与这句提示分辨。
 */
export const wordDraftLabel = (finalized?: boolean | null): string =>
  finalized === true ? '定稿件' : '草稿（还没定稿，不要交付）'

/** 台账上显示的标题：{@code title} 可空，回落成「报告号 + 交付物」 */
export const reportTitleOf = (
  report?: QlzgReportVO | null,
  reportTypeLabel?: string | null
): string => {
  if (!report) return '—'
  if (report.title && report.title.trim() !== '') return report.title
  const parts = [report.reportNo, reportTypeLabel || report.reportType].filter((item) => !!item)
  return parts.length > 0 ? parts.join(' · ') : `报告 ${report.id ?? ''}`
}

/**
 * 残留占位符那一格怎么说
 *
 * 🔴 {@code > 0} 时**只**说「定稿会被拦」，不说「成文失败」：
 *    成文是成功的，那份带标记的 Word 正是用来找缺口的。
 * 🔴 {@code placeholderRemaining} 为空时显示「—」而不是 0：
 *    那一列在<b>成过文之后</b>才有值，一份从没成过文的报告不是「0 处残留」，
 *    是「还没数过」。显示 0 会让人以为已经检查过了。
 * 🔴 后端定稿闸对空<b>不放行</b>（{@code REPORT_COMPOSE_COUNTS_UNMEASURED}），
 *    出路是重新成文一次 —— 所以这一格显示「—」时，定稿按钮点下去会拿到一句
 *    说清出路的报错，而不是一个静默的成功。界面文案不要替它编一个「0 处」
 */
export const placeholderRemainingText = (report?: QlzgReportVO | null): string => {
  const remaining = report?.placeholderRemaining
  if (remaining === null || remaining === undefined) return '—'
  if (remaining > 0) return `${remaining} 处未闭合（定稿会被拦）`
  return '0 处'
}

/**
 * 缺值格子那一格怎么说 —— 与 {@link placeholderRemainingText} **刻意分成两句**
 *
 * <h3>🔴 两个数都表现为「定不了稿」，而出路完全相反</h3>
 * {@code placeholderRemaining} 认的是模板里的**花括号**，修法是**改模板**；
 * {@code valueMissingCount} 认的是成文那一刻取不到值的格子
 * （纸上印出来的【缺值】/【未映射】），修法是**填值**。
 * 合成一句「还有 N 处没弄好」的产物是：用户去改模板，改完发现数没动，
 * 然后认为这个工具坏了 —— 而它一直在说另一件事。
 *
 * <h3>🔴 措辞里**不能**出现「纸上有 N 处」</h3>
 * 数的是**去重后的模型键**：一个占位符在纸上出现十次只算 1。
 * 说「纸上有 3 处」而用户在 Word 里数出 11 处的话，他会认为这个数不可信 ——
 * 而这恰好是定稿闸的判据。要说是哪几格，去成文响应里的 missing 清单（那才是名字）
 *
 * <h3>🔴 为空时同样是「还没数过」，不是 0</h3>
 * 与 {@code placeholderRemaining} 一样，这一列在<b>成过文之后</b>才有值。
 * 🔴 但这一列<b>还多一种</b>为空的来由：它是后端脚本 23 才补上的列，
 *    补列那一刻写的是 {@code NOT NULL DEFAULT 0}，于是当时库里已有的行全部拿到
 *    一个<b>看起来像测量结果</b>的假 0，而它们的 Word 从来没被数过缺值。
 *    脚本 31 把这一列（连同 {@code placeholderScanHits}）放开成可空并清掉那些假 0，
 *    所以一份老报告在这一格上显示「—」是<b>如实</b>的，不是数据丢了。
 *    {@code placeholderRemaining} 刻意没被清 —— 它是三列里唯一自建表起就在、
 *    成文那次 UPDATE 一直无条件写的那一列
 */
export const valueMissingText = (report?: QlzgReportVO | null): string => {
  const missing = report?.valueMissingCount
  if (missing === null || missing === undefined) return '—'
  if (missing > 0) return `${missing} 个格子取不到值（定稿会被拦）`
  return '0 个'
}

/**
 * 右栏候选清单为空时要说的那一句
 *
 * <h3>🔴 空**不是**故障，而这句话必须把原因说出来</h3>
 * 候选清单有一条 SQL 闸：只返回 {@code review_status = APPROVED} 的行。
 * 而平台那 56 条种子<b>目前全是 DRAFT</b>（话术库种子「没有一条能由 AI 独立确定」，
 * 而平台在结构上不能自我审核）。所以一个还没自己审过话术的机构，右栏<b>一定</b>是空的。
 *
 * <p>不写这一句的话，评估师会得出「这个工具的推荐是坏的」——
 *    而正确的动作是去话术库点「审核通过」。
 *
 * @param sectionCode 当前光标所在那一节的码；为空时给另一句话，
 *        因为那时后端只返回不限章节的通用话术，是<b>入参</b>的问题不是审核的问题
 */
export const emptyCandidateText = (sectionCode?: string | null): string =>
  sectionCode
    ? '这一节还没有通过审核的话术。候选清单只收「审核通过」的行，而平台自带的 56 条种子目前都是草稿——要到「话术库」里点一次「审核通过」，它们才会出现在这里。'
    : '先在左栏选一节。不选章节时后端只返回「不限章节」的通用话术，而平台种子的 56 条全都挂在具体章节上，所以这里会是空的。'

/**
 * 候选卡上那个分数怎么显示
 *
 * 🔴 **不做浮点运算、不 {@code toFixed}**：{@code score} 是后端 4 位定标的 BigDecimal，
 *    {@code toFixed} 会补零，补出来的那一位在后端的明细里没有对应项，对不上账。
 *    要排序就按后端给的顺序（它已经排好了）。
 */
export const scoreText = (score?: number | null): string =>
  score === null || score === undefined ? '—' : String(score)

/**
 * 一条候选的「为什么排在这里」
 *
 * 🔴 窄栏用 {@code because}（后端拼好的一句），展开用 {@code reasons}（拆开的清单），
 *    两者同源。**不要**自己按 {@code scoreDetail} 再拼一句 ——
 *    那份明细是给机器复算的，拼出来的措辞会与后端的对不上，
 *    而「工具给的理由与它自己算的分对不上」正是评估师不再信任排序的那个瞬间。
 *
 * 🔴 {@code triggered = false} 时 {@code hitKeys} 仍然如实记着半命中，
 *    而命中键**不加分**。界面上不要把 {@code hitKeys > 0} 显示成「已命中」——
 *    那会让评估师以为这一条是按他的标的挑出来的，
 *    而它其实只是一个触发条件没满足的兜底。
 */
export const candidateReasonText = (candidate?: {
  because?: string | null
  reasons?: string[] | null
} | null): string => {
  if (candidate?.because && candidate.because.trim() !== '') return candidate.because
  const reasons = (candidate?.reasons ?? []).filter((item) => !!item)
  return reasons.length > 0 ? reasons.join(' · ') : ''
}

/** 触发状态怎么标。🔴 判据是 {@code triggered}，不是 {@code hitKeys > 0} */
export const triggeredLabel = (candidate?: {
  triggered?: boolean | null
  hitKeys?: number | null
} | null): string => {
  if (candidate?.triggered === true) {
    const hits = candidate.hitKeys ?? 0
    return hits > 0 ? `条件全部命中（${hits} 个）` : '无条件话术'
  }
  const hits = candidate?.hitKeys ?? 0
  return hits > 0 ? `条件没满足（半命中 ${hits} 个，不加分）` : '条件没满足'
}

// ==================== 历史版本与红标（I6-b，§11.11.3） ====================

/**
 * 一张红标表要显示的**全部**结论
 *
 * <h3>🔴 这一层存在的唯一理由：把「没有变化」与「没法比」分开</h3>
 * 后端在不可比时**直接把清单设成空**，所以「清单是空的」这一个观察
 * 对应两个完全相反的结论：
 * <ul>
 * <li>可比 + 0 行 ⟹ 这一版真的一个字都没改，是可以签字的绿；</li>
 * <li>不可比 ⟹ 谁也不知道改了什么，是必须被读出来的黄。</li>
 * </ul>
 * 两者都显示成「本版没有变更」就是**假绿**：复核人看完会签字，
 * 签的是一份压根没有比对过的东西。红标的价值全在复核人的注意力分配
 * （40 页逐字读要 40 分钟，看红标只要 3 分钟），而一份假绿的红标
 * 比没有红标更坏 —— 没有红标时他至少知道自己得逐字读。
 */
export interface VersionDiffPanel {
  /** 能不能比。🔴 `false` 时下面那张表**必须**不渲染，只渲染 {@link #headline} */
  comparable: boolean
  /** `comparable = false` 时后端给的那一句，**原样**印 */
  reason: string | null
  /** 变了几行。🔴 数的是**实际渲染出来的清单**，不是后端那个 count 字段 */
  rows: number
  /** 表头那一句：可比时是「变了 N 处」或「本版没有变化」，不可比时就是那句 reason */
  headline: string
  alertType: 'success' | 'warning'
}

/**
 * 🔴 只在「后端说不可比、却没给理由」时用到，而那**不该发生**
 * （三条理由都在 {@code QlzgReportVersionDiff} 的理由那一节里现拼）。
 * 留一句兜底是因为 TS 上那一列是 `string | null`：真出现了，
 * 印这一句至少不会让表头变成一个空格
 */
const NOT_COMPARABLE_FALLBACK = '这一版与上一版之间没法比'

const panelOf = (
  comparable: boolean,
  reason: string | null | undefined,
  rows: number,
  changed: (rows: number) => string,
  empty: string
): VersionDiffPanel => {
  if (!comparable) {
    return {
      comparable: false,
      reason: reason ?? null,
      rows,
      headline: reason ?? NOT_COMPARABLE_FALLBACK,
      alertType: 'warning'
    }
  }
  return {
    comparable: true,
    reason: null,
    rows,
    headline: rows === 0 ? empty : changed(rows),
    alertType: rows === 0 ? 'success' : 'warning'
  }
}

/**
 * 字段级红标那一张表的结论
 *
 * <h3>🔴 `reason` 一律**原样**印，不改写、不截断、不换成「加载失败」</h3>
 * 那几句话是后端按「哪一版的快照读不出来 / 哪一版没冻章节」现拼的，
 * 措辞本身就是产品的一部分。其中「快照读不出来」那一句还带着
 * 「这通常意味着档案已经被改坏」—— 前端另拼一句就把这个事实抹掉了。
 *
 * <h3>🔴 段落数单独说出来</h3>
 * 复核人最先要问的是「有没有哪一段散文被改过」：M2 下 AI 重生成一段，
 * 他必须看见（§11.11.3 原话）。把它折进「变了 N 处」里，
 * 他就得逐行找哪几行是段落
 */
export const versionFieldPanel = (diff?: QlzgReportVersionDiffVO | null): VersionDiffPanel =>
  panelOf(
    diff?.fieldComparable === true,
    diff?.fieldNotComparableReason,
    diff?.fieldDiff?.length ?? 0,
    (rows) => {
      const paragraphs = diff?.changedParagraphCount ?? 0
      return paragraphs > 0 ? `变了 ${rows} 处，其中 ${paragraphs} 处是段落文字` : `变了 ${rows} 处`
    },
    '本版没有一处字段变化'
  )

/**
 * 章节级红标那一张表的结论
 *
 * 🔴 与字段级**各算各的**，不合成一句话：「字段可比、段落不可比」是一种
 *    真实存在的状态（I6-b 之前定稿的版本读得出字段、而没有冻章节），
 *    合并之后就读不出是哪一半比不了
 */
export const versionSectionPanel = (diff?: QlzgReportVersionDiffVO | null): VersionDiffPanel =>
  panelOf(
    diff?.sectionComparable === true,
    diff?.sectionNotComparableReason,
    diff?.sectionDiff?.length ?? 0,
    (rows) => `变了 ${rows} 节`,
    '本版没有章节结构变化'
  )

/**
 * 红标里一格值怎么显示
 *
 * <h3>🔴 **原样**返回后端给的快照字串：不 trim、不 toFixed、不补千分位、不换算单位</h3>
 * 格式化要读品类的 `param_schema` 才知道单位与小数位，而那份 schema 是**活的** ——
 * 三年后单位改了，同一份 diff 就会显示成另一个数，
 * 红标就不再是「当年看见的那一条」。单位写在列标签上，不要拼进值里。
 *
 * <h3>🔴 空值印成「（空）」，不留白</h3>
 * 一个空单元格与「这一列坏了」在界面上长得一模一样。
 * 而 ADDED / REMOVED 两种行**必然**有一侧是空的，那一侧要读成
 * 「上一版没有这一格」—— 见下面那两个专用函数
 */
export const versionValueText = (value?: string | null): string =>
  value === null || value === undefined || value === '' ? '（空）' : value

/** 上一版那一格。🔴 ADDED 行要说「没有这一格」，不是「（空）」——两者是不同的事实 */
export const versionOldValueText = (row?: QlzgReportVersionFieldDiffVO | null): string =>
  row?.changeKinds?.includes('ADDED') ? '（上一版没有这一格）' : versionValueText(row?.oldValue)

/** 本版那一格。🔴 REMOVED 行同理：这一格是被**删掉**了，不是被清空了 */
export const versionNewValueText = (row?: QlzgReportVersionFieldDiffVO | null): string =>
  row?.changeKinds?.includes('REMOVED') ? '（本版没有这一格了）' : versionValueText(row?.newValue)

/**
 * 字段那一列显示什么
 *
 * 🔴 优先给 `placeholder`（模板里的占位符名，评估师在纸上看见的就是它），
 *    回落 `fieldKey`（机器名）。两个都没有时**不要**留白：
 *    一行红标如果连「是哪一格」都说不出来，复核人只能整份重读，红标就白做了
 */
export const versionFieldSubject = (row?: QlzgReportVersionFieldDiffVO | null): string =>
  row?.placeholder || row?.fieldKey || '（这一格没有键）'

/** 章节那一列显示什么。🔴 优先本版标题（纸上现在是它），REMOVED 行回落到上一版的 */
export const versionSectionSubject = (row?: QlzgReportVersionSectionDiffVO | null): string =>
  row?.newSectionTitle || row?.oldSectionTitle || row?.sectionCode || '（这一节没有标题）'

/**
 * 版本清单上「本版说明」那一格
 *
 * 🔴 第 1 版为空是**设计**：第 1 版没有「变更」，强制它只会让所有人写「初始版本」，
 *    而那一句在 30 年后翻档案时一个字的信息量都没有。所以两种空要给两句话 ——
 *    合成一句「（没写说明）」会让第 1 版看起来像是有人偷懒跳过了必填项
 */
export const versionSummaryText = (
  row?: {
    versionNo?: number | null
    changeSummary?: string | null
  } | null
): string => {
  if (row?.changeSummary) return row.changeSummary
  return (row?.versionNo ?? 1) > 1 ? '（这一版没写说明）' : '（第 1 版没有「变更」，不要求写说明）'
}

/**
 * 「哪一格」下面那行小字：这一格在哪一节
 *
 * <h3>🔴 说不出是哪一节时给 `null`（整行不渲染），**不给**一句恒定的回落文案</h3>
 * `qlzg_report_field.section_id` 是<b>可空</b>的（报告编号、评估基准日、机构名
 * 住在 Word 的页眉或首页表格里，不属于任何一节），所以「这一格的节标题为空」
 * 在<b>章节冻得好好的</b>那一版里也是常态，不是异常。
 * 给每一行都挂同一句「（没有归到某一节）」是版面上的假红：
 * 一行字如果在每一行上说的都是同一件事，复核人就会学会跳过它，
 * 连带跳过它偶尔真的给出节标题的那一次
 *
 * <h3>🔴 也**不能**写「这一版没冻章节」——那是一句假话</h3>
 * 本函数拿到的只有 `sectionTitle`，而它为空有两个互斥的原因：
 * 快照压根没冻章节（形状 1，段落比对上线之前定稿的），
 * 或者冻了、只是这一格不属于任何一节。前者由下面那张章节表的
 * `sectionNotComparableReason` 整段说明（后端现拼的那一句），
 * 比在每一行上重复一遍更准；在字段表里替它说话必然说错其中一个
 */
export const versionFieldSectionText = (row?: QlzgReportVersionFieldDiffVO | null): string | null =>
  row?.sectionTitle || null

/**
 * 「来源变了」那一格
 *
 * <h3>🔴 判据是**种类**，不是「两个来源码不相等」</h3>
 * 后端报 SOURCE 的条件是 `sourceType` / `sourceRefId` 任一变了，
 * 或者**值没变**而 `provenanceId` 变了（改值必然换一行手工溯源，
 * 那一次的 `provenanceId` 变化不算「换了依据」，否则 SOURCE 会在每一行上亮）。
 * 三个键里只有 `sourceType` 是给人读的码。前端自己比 `sourceType` 会漏掉
 * 「值没变、来源引用换了」那一种 —— 也就是「有人把这一格的依据换掉了」，
 * 而那正是复核人最要看的一条。
 *
 * <h3>🔴 只在这一行真带 SOURCE 时给字串，其余给 `null`（整栏不显示）</h3>
 * 与置信度那一栏同一条处置：给每一行都挂一个「来源：测算 → 测算」，
 * 会让人以为「这一栏本该有变化、只是这次没变」
 */
export const versionSourceFlipText = (row?: QlzgReportVersionFieldDiffVO | null): string | null => {
  if (!row?.changeKinds?.includes('SOURCE')) return null
  const from = labelOf(FIELD_SOURCE_TYPE_OPTIONS, row.oldSourceType) || '（无）'
  const to = labelOf(FIELD_SOURCE_TYPE_OPTIONS, row.newSourceType) || '（无）'
  // 🔴 印成「测算 → 测算」会被读成一句废话，于是复核人扫一眼就过去。
  //    而这一行**确实**有变化，变的是它指向的那一条（案例 / 参数 / 溯源行）
  return from === to ? `${from}（类型没变，变的是它指向的那一条依据）` : `${from} → ${to}`
}

/**
 * 一个布尔的三态翻转
 *
 * 🔴 `null` 是**第三态**，读作「这一版没冻这个键」（形状 1 的老快照），
 *    **不能**读成 `false`：把「没记下」印成「未标红」，
 *    等于对着一份老档案说「当年这一格没有人标过红」—— 而真相是没人知道
 */
const flipOf = (
  oldValue?: boolean | null,
  newValue?: boolean | null,
  onWord = '',
  offWord = ''
): string | null => {
  if (oldValue === newValue) return null
  const word = (v?: boolean | null) => (v === true ? onWord : v === false ? offWord : '（没记下）')
  return `${word(oldValue)} → ${word(newValue)}`
}

/** 「红标 / 确认状态变了」那一格。🔴 判据同样是种类，不是自己比布尔 */
export const versionMarkFlipText = (row?: QlzgReportVersionFieldDiffVO | null): string | null => {
  if (!row?.changeKinds?.includes('MARK')) return null
  const parts = [
    flipOf(row?.oldMarked, row?.newMarked, '已标红', '未标红'),
    flipOf(row?.oldConfirmed, row?.newConfirmed, '已确认', '未确认')
  ].filter((item): item is string => !!item)
  return parts.length > 0 ? parts.join(' · ') : '红标或确认状态变了'
}

/**
 * 章节那一行的「变了什么」
 *
 * <h3>🔴 用 `\n` 拼、界面上 `pre-wrap` 渲染，不用 `<br>` 也不用 `v-html`</h3>
 * 一行章节变更可以同时带几种（标题与条款号一起改），
 * 挤在一行里读不出是哪几件；而 `v-html` 在本模块是禁的 ——
 * 章节标题来自模板解析，模板是机构上传的 docx
 *
 * <h3>🔴 `CLAUSE_REF` 那一条要连旧值一起给全</h3>
 * 它是 G-04（准则有效性校验）的输入，也就是一条**法律事实**：
 * 复核人要判的是「换掉的那一条还有效吗」，只给新值他判不了
 */
export const versionSectionFlipText = (row?: QlzgReportVersionSectionDiffVO | null): string => {
  const kinds = row?.changeKinds ?? []
  const parts: string[] = []
  if (kinds.includes('ADDED')) parts.push('本版新出现的一节')
  if (kinds.includes('REMOVED')) parts.push('上一版有、本版没有了')
  if (kinds.includes('TITLE')) {
    parts.push(`标题：${row?.oldSectionTitle || '（无）'} → ${row?.newSectionTitle || '（无）'}`)
  }
  if (kinds.includes('CLAUSE_REF')) {
    parts.push(`准则条款号：${row?.oldClauseRef || '（无）'} → ${row?.newClauseRef || '（无）'}`)
  }
  if (kinds.includes('CONTENT_MODE')) {
    const from = labelOf(SECTION_CONTENT_MODE_OPTIONS, row?.oldContentMode) || '（无）'
    const to = labelOf(SECTION_CONTENT_MODE_OPTIONS, row?.newContentMode) || '（无）'
    parts.push(`内容来源：${from} → ${to}`)
  }
  if (kinds.includes('ORDER')) {
    parts.push(
      `顺序：${row?.oldSort ?? '（无）'} → ${row?.newSort ?? '（无）'}` +
        `　层级：第 ${row?.oldLevel ?? '（无）'} 层 → 第 ${row?.newLevel ?? '（无）'} 层`
    )
  }
  return parts.join('\n')
}
