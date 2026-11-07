import type {
  QlzgTemplateClosureFindingVO,
  QlzgTemplateClosureVO,
  QlzgTemplateMappingEditVO,
  QlzgTemplateSuggestionVO,
  QlzgTemplateVersionVO
} from '@/api/qlzg/template'
import { CLOSURE_FINDING_TYPE_OPTIONS, PLACEHOLDER_SIGN_LABELS, labelOf } from '../constants'

/**
 * 模板设计器的纯逻辑：闸 B 面板的措辞 + 映射面板的增量 diff
 *
 * <h3>为什么这一层单独抽出来</h3>
 * 设计器上有两处「算错了不会报错、只会让人白干一轮」的地方，它们都不该写在 .vue 里：
 * <ol>
 * <li>{@link buildEdits} —— `/save-mapping` 的 `edits` 是**增量**的，而且
 *     `fieldKey` / `confirmed` 两个键在后端 {@code applyEdits} 里是**互斥**的三条分支。
 *     把整张面板都发上去，或者在解绑那一行顺手带上 `confirmed`，
 *     得到的都是「保存成功、什么都没变」—— 后端返回 200、闸 B 结论也照旧，
 *     唯一的现象是评估师改了半天绑不动。</li>
 * <li>闸 B 的措辞 —— {@code PENDING} 不是 {@code FAILED}（回滚之后返回的就是 PENDING），
 *     而「哪一条去哪里改」说错了，评估师会去改错的地方，改完还是红的。</li>
 * </ol>
 *
 * <h3>🔴 这一层刻意**不做门禁**</h3>
 * 「能不能发布」由后端 {@code publish} 里那三道闸 B 判，前端只负责**描述现状**。
 * 前端自己算一遍 `passed` 的后果是两份真相：后端的允许词表随品类 schema 变，
 * 前端这份不会，于是界面上显示「可以发布」、点了报
 * {@code TEMPLATE_PLACEHOLDER_NOT_CLOSED}。
 * 所以 {@link closureHeadline} 读的是 {@code closure.passed} 与 {@code blockingCount}，
 * 从不去数 {@code findings}。
 */

/** 一行映射的基线快照，键是占位符**原文** */
export interface MappingBaselineEntry {
  fieldKey: string | null
  unmappedReason: string | null
  confirmed: boolean
}

export type MappingBaseline = Record<string, MappingBaselineEntry>

const text = (value?: string | null): string | null => {
  const trimmed = (value ?? '').trim()
  return trimmed ? trimmed : null
}

/**
 * 从解析 / 保存映射的返回里截一份基线
 *
 * 🔴 每次拿到新的 `suggestions` 都要重新截一次：基线过期之后
 *    {@link buildEdits} 会把「上一次已经存进去的改动」再发一遍，
 *    而重发一次绑定会把 `boundBy` 从 STRUCTURAL / AUTO_* 一律改写成 MANUAL
 *    —— 也就是把「平台自动认出来的」悄悄变成「人工指定的」，审计口径就错了。
 */
export const baselineOf = (suggestions?: QlzgTemplateSuggestionVO[] | null): MappingBaseline => {
  const baseline: MappingBaseline = {}
  for (const row of suggestions ?? []) {
    if (!row?.placeholder) continue
    baseline[row.placeholder] = {
      fieldKey: text(row.fieldKey),
      unmappedReason: text(row.unmappedReason),
      confirmed: row.confirmed === true
    }
  }
  return baseline
}

/**
 * 映射面板上真正要显示的行
 *
 * 🔴 过滤掉区块收尾（`{{/sections}}`，`sign === '/'`）：它不是一个要绑字段的东西，
 *    后端 {@code applyEdits} 建 `signBySource` 时也刻意跳过它，
 *    所以它一旦出现在面板上并被编辑，得到的是
 *    {@code TEMPLATE_MAPPING_EDIT_UNKNOWN}「一条都对不上」。
 *    那不是后端苛求，是这一行压根不该被画出来。
 */
export const panelRows = (suggestions?: QlzgTemplateSuggestionVO[] | null) =>
  (suggestions ?? []).filter((row) => row?.sign !== '/')

/**
 * 算出本次要提交的 `edits`（增量）
 *
 * <h3>🔴 只发**动过的那几个键**，一个都不能多</h3>
 * 后端 {@code QlzgTemplateDesignServiceImpl#applyEdits} 的三条分支是这样排布的：
 * <pre>
 * ① fieldKey 有值        → 绑定，boundBy 改写成 MANUAL，confirmed 强制 true，清掉未映射原因
 * ② fieldKey 空 且 confirmed 非 null 且**这一行本来就绑着** → 只改 confirmed
 * ③ 其余                 → 解绑（清 fieldKey / boundBy，confirmed=false，写入未映射原因）
 * </pre>
 * 由此推出三条前端纪律，每一条违反都是「200 + 什么都没变」：
 * <ul>
 * <li>解绑那一行**不能**带 `confirmed`：带了就命中 ②，字段键还在原处，
 *     界面显示「已保存」，而闸 B 的 UNMAPPED_NO_REASON 也永远不会出现。</li>
 * <li>只想确认/撤销确认时**不能**带 `fieldKey`：带了就命中 ①，
 *     `boundBy` 被改写成 MANUAL —— 一次「我认可平台猜的这个绑定」
 *     在库里变成了「这个绑定是人工指定的」，而 §11.17.3 第 ① 条的
 *     自动映射率从此对不上账。</li>
 * <li>绑定那一行**不必**带 `confirmed`：① 已经强制置 true，
 *     而 `confirmed=false` 配一个字段键是自相矛盾的组合。</li>
 * </ul>
 */
export const buildEdits = (
  rows: QlzgTemplateSuggestionVO[] | null | undefined,
  baseline: MappingBaseline
): QlzgTemplateMappingEditVO[] => {
  const edits: QlzgTemplateMappingEditVO[] = []
  for (const row of rows ?? []) {
    const placeholder = row?.placeholder
    if (!placeholder) continue
    const base = baseline[placeholder]
    // 🔴 不在基线里的行**不发**：它是别处（例如另一次解析）漏进来的，
    //    发出去会命中 unmatched 分支，让整次保存报 TEMPLATE_MAPPING_EDIT_UNKNOWN，
    //    连带把同批里合法的编辑一起废掉
    if (!base) continue

    const nowKey = text(row.fieldKey)
    const keyChanged = nowKey !== base.fieldKey
    // 只有未映射的行才谈得上「未映射原因」；已绑定的行后端一律把它清成 null
    const nowReason = nowKey ? null : text(row.unmappedReason)
    const reasonChanged = nowReason !== base.unmappedReason
    const nowConfirmed = row.confirmed === true
    const confirmedChanged = nowConfirmed !== base.confirmed
    if (!keyChanged && !reasonChanged && !confirmedChanged) continue

    const edit: QlzgTemplateMappingEditVO = { placeholder }
    if (keyChanged) {
      edit.fieldKey = nowKey
      if (!nowKey && nowReason) {
        edit.unmappedReason = nowReason
      }
      // 🔴 这里刻意不发 confirmed，理由见函数注释的分支 ②
    } else if (confirmedChanged) {
      edit.confirmed = nowConfirmed
      // 🔴 这里刻意不发 fieldKey，理由见函数注释的分支 ①
    } else {
      edit.unmappedReason = nowReason
    }
    edits.push(edit)
  }
  return edits
}

/** 面板上还有几行没保存。用于「离开前提醒」与保存按钮的禁用态 */
export const dirtyCount = (
  rows: QlzgTemplateSuggestionVO[] | null | undefined,
  baseline: MappingBaseline
): number => buildEdits(rows, baseline).length

/**
 * 按 `blocking` 分流，**不按 type 猜**
 *
 * 🔴 `blocking` 是后端当年判定的结果原样透传的。前端按 type 自己分一次的话，
 *    等于把「哪一类阻断发布」这条规则抄了两份 —— 而它在
 *    {@code MISSING_REQUIRED_FIELD} 上已经按交付物类型分派过一次了
 *    （技术报告要 16 个必填字段全有位置，结果报告只要 6 个），
 *    那份分派逻辑前端复刻不了，一复刻就漂。
 */
export const splitFindings = (
  closure?: QlzgTemplateClosureVO | null
): { blockers: QlzgTemplateClosureFindingVO[]; notes: QlzgTemplateClosureFindingVO[] } => {
  const findings = closure?.findings ?? []
  return {
    blockers: findings.filter((f) => f?.blocking === true),
    notes: findings.filter((f) => f?.blocking !== true)
  }
}

/**
 * 一条发现的中文说法
 *
 * 🔴 **后端给的优先、前端那份兜底**，理由见 `CLOSURE_FINDING_TYPE_OPTIONS` 的注释：
 *    `placeholderClosureDetail`（模板行 / 版本行上那个 json 列）只有五个键，
 *    **不含** `typeDescription`，所以刚打开设计器时后端那份中文压根不存在。
 *    反过来（前端优先）的话，后端哪天把某一类的说法改准了，界面上还是旧的那句。
 */
export const findingTypeLabel = (finding?: QlzgTemplateClosureFindingVO | null): string =>
  finding?.typeDescription || labelOf(CLOSURE_FINDING_TYPE_OPTIONS, finding?.type) || '—'

/**
 * 一条发现「去哪里改」
 *
 * 🔴 这一句是说错了代价最大的文案：改错地方的人会改完再跑一遍、还是红的，
 *    第三遍开始他就认定这个功能坏了。
 *    所以按 type 分派到**三个不同的处置面**：
 *    映射面板（换字段 / 填原因 / 点确认）、Word 原件（改字符 / 加位置）、
 *    以及前端改不了、要找实施人员的那两类。
 */
export const findingFixHint = (finding?: QlzgTemplateClosureFindingVO | null): string => {
  switch (finding?.type) {
    case 'UNKNOWN_FIELD':
      return '在下面映射面板里把这一行改绑到品类字段清单里的键；清单里没有合适的键就说明这份 docx 要的数不在品类定义内，要先找实施人员扩品类'
    case 'INVISIBLE_PLACEHOLDER':
      return '下载 docx，在 Word 里把这一处改成下面「建议写法」那一栏的样子（平台不代改文件），再重新上传解析一次'
    case 'WRONG_SIGN':
      return '下载 docx，在 Word 里把花括号后面那个语法符号改对（区块用 ?、表格用 #、图片用 @），再重新上传解析一次'
    case 'UNMAPPED_NO_REASON':
      return '在下面映射面板里绑一个字段；如果这一处是有意留白，就在「未映射原因」里写一句为什么（写了原因就不阻断发布，且这句话会随版本冻结进档案）'
    case 'UNMAPPED_WITH_REASON':
      return '无需处置。原因已随版本冻结进档案，30 年后翻档的人能看见当年为什么留空'
    case 'SIMILAR_NOT_CONFIRMED':
      return '在下面映射面板里对这一行点一次「确认」；确认只是表示认可平台按相似度猜的绑定，不会把它改写成人工绑定'
    case 'MISSING_REQUIRED_FIELD':
      return '下载 docx，在 Word 里给这个必填字段留一个位置（写成占位符），再重新上传解析一次'
    case 'MISSING_RULE_DEMANDED_SECTION':
      return '下载 docx，在 Word 里给这一节留位置（后端那句话点名了哪条规则、哪一节、以及放进去就行的那些键），再重新上传发布一版。映射面板上补不出来：章节树是发布那一刻冻结的快照，版本行不可改'
    case 'SECTION_SORT_VIOLATION':
      return '这一条不在模板上，是品类章节树的 sort 交叉了；要找实施人员改品类的 section_schema，改完这里会自动重新判定'
    case 'RENDER_FAILED':
      return '点一次「预览」看渲染产物里的具体报错；最常见的原因是往表格占位符里喂了字符串'
    case 'RENDER_RESIDUAL':
      return '点一次「预览」下载渲染产物，搜索残留的花括号定位到具体页；按出现次数计，一处印了 12 次就是 12 处要改'
    case 'SEAL_RESERVED':
      return '无需处置。公章位在导出时留空，签章功能在 I30；这一条已经写进版本档案'
    default:
      return finding?.message || '按后端给的这句话处置'
  }
}

/**
 * 闸 B 面板的标题句
 *
 * 🔴 **三态**，而 {@code PENDING} 不是 {@code FAILED}：
 * 回滚产生的新版本返回的就是 PENDING（那一版当年三道全过，闸 B 不重跑），
 * 把 PENDING 显示成「未通过」会让人以为回滚回坏了一版。
 */
export const closureHeadline = (closure?: QlzgTemplateClosureVO | null): string => {
  const status = closure?.status
  if (!closure || status === 'PENDING' || !status) {
    return '闸 B 还没有结论。上传一次 docx 解析、或点一次「预览」，这里才会出现①②③三道的判定'
  }
  if (status === 'PASSED') {
    const notes = splitFindings(closure).notes.length
    return notes > 0
      ? `闸 B 通过，可以发布。另有 ${notes} 条不阻断的发现，它们会一起冻结进版本档案`
      : '闸 B 通过，可以发布'
  }
  const count = closure.blockingCount ?? splitFindings(closure).blockers.length
  return `闸 B 未通过，有 ${count} 处阻断项。逐条列在下面，每条都写了去哪里改`
}

/**
 * 闸 B 面板的 tag 颜色
 *
 * 🔴 PENDING 用 `info` 不用 `danger`：它不是坏消息，只是「还没跑」。
 *    一个刚建出来、还没上传过 docx 的模板本来就是 PENDING，
 *    给它一个红标签等于告诉评估师「你建错了」。
 */
export const closureTagType = (closure?: QlzgTemplateClosureVO | null) => {
  const status = closure?.status
  if (status === 'PASSED') return 'success'
  if (status === 'FAILED') return 'danger'
  return 'info'
}

/** 占位符语法符号的人话。空串 = 标量 */
export const signLabel = (sign?: string | null): string =>
  PLACEHOLDER_SIGN_LABELS[sign ?? ''] ?? (sign ? sign : '标量')

/**
 * §11.17.3 第 ① 条要的那个自动映射率
 *
 * 🔴 后端给的就是百分比整数，前端**不做任何运算**（不除、不四舍五入、不 toFixed）：
 *    算两次的后果是界面上的数与 `autoMappedRatePercent` 对不上，
 *    而验收时要拿这个数说话。
 */
export const autoMappedRateText = (ratePercent?: number | null): string =>
  ratePercent == null ? '—' : `${ratePercent}%`

/** 还需要人工点确认的行数。与 SIMILAR_NOT_CONFIRMED 同一批，但按面板行算，便于就地提示 */
export const pendingConfirmCount = (rows?: QlzgTemplateSuggestionVO[] | null): number =>
  (rows ?? []).filter((row) => row?.needsConfirmation === true && row?.confirmed !== true).length

/** 未映射且没写原因的行数。§11.17.3 第 ② 条：这类不禁止发布，但必须写一句为什么 */
export const unmappedNoReasonCount = (rows?: QlzgTemplateSuggestionVO[] | null): number =>
  panelRows(rows).filter((row) => !text(row.fieldKey) && !text(row.unmappedReason)).length

/**
 * 发布要不要填「本版改了什么」
 *
 * 🔴 判据是**已经有几个版本行**，不是 `template.versionNo`：
 *    后者是给人看的版本号文本（可空、随便写），与
 *    {@code qlzg_template_version.version_no}（int，单调递增）不是一回事。
 *    用它判的话，一个从没发布过但文本版本号写着「V2.0」的模板会被要求填说明，
 *    而一个发布过三次、文本版本号还空着的模板反而不被要求。
 * 🔴 第 1 版**留空**：逼评估师为它编一句他只会写「初始版本」的必填项，
 *    而一句所有人都写同一句话的必填项等于没有这一项。
 */
export const changeNoteRequired = (versions?: QlzgTemplateVersionVO[] | null): boolean =>
  (versions ?? []).length > 0

/** 下一版的版本号（单调递增；回滚也走递增） */
export const nextVersionNo = (versions?: QlzgTemplateVersionVO[] | null): number => {
  const list = versions ?? []
  return list.reduce((max, v) => Math.max(max, v?.versionNo ?? 0), 0) + 1
}

/**
 * 回滚下拉的候选
 *
 * 🔴 排除当前版：把当前版「回滚」到自己会造出一个内容完全相同的新版本行，
 *    而版本号已经递增了 —— 档案里多一版什么都没改的版本，
 *    且 `changeNote` 会写着「回滚自第 N 版」，读起来像发生过一次退回。
 * 🔴 按版本号**降序**：评估师要退回的几乎总是最近的那一版，
 *    升序的话它排在几十个选项的最后。
 */
export const rollbackOptions = (
  versions?: QlzgTemplateVersionVO[] | null
): { label: string; value: number }[] =>
  (versions ?? [])
    .filter((v) => v && v.isCurrent !== true && v.versionNo != null)
    .slice()
    .sort((a, b) => (b.versionNo ?? 0) - (a.versionNo ?? 0))
    .map((v) => ({
      label: `第 ${v.versionNo} 版${v.changeNote ? `（${v.changeNote}）` : ''}`,
      value: v.versionNo as number
    }))

/**
 * 回滚说明的默认句
 *
 * 🔴 预填而不留空：回滚的 `changeNote` 是**必填**的，而它要回答的是审计问题
 *    「谁在什么时候把这个模板退回了哪一版」。留空的话评估师会写「回滚」两个字，
 *    那两个字回答不了「退回哪一版」—— 预填一句把版本号带进去的，
 *    他至少不会写出一个不完整的档案条目。
 */
export const rollbackNoteDraft = (targetVersionNo?: number | null): string =>
  targetVersionNo == null ? '' : `回滚自第 ${targetVersionNo} 版`
