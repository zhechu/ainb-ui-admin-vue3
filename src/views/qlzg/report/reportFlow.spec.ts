import { describe, expect, it } from 'vitest'
import type {
  QlzgReportFieldPendingVO,
  QlzgReportFieldVO,
  QlzgReportSectionVO,
  QlzgReportVersionDiffVO,
  QlzgReportVersionFieldDiffVO,
  QlzgReportVersionSectionDiffVO,
  QlzgReportVO
} from '@/api/qlzg/report'
import {
  NUMERIC_KINDS,
  ORPHAN_SECTION_KEY,
  TEMPLATE_PENDING_PREFIX,
  blankDraft,
  buildSectionTree,
  candidateReasonText,
  changeSummaryRequired,
  composeButtonLabel,
  composeHasIssue,
  composeResultText,
  composeResultTitle,
  composeState,
  composeStateTagType,
  composeStateText,
  draftChanged,
  draftOf,
  emptyCandidateText,
  fieldsOfSection,
  filledCount,
  flattenSections,
  groupFieldsBySection,
  hasValue,
  isNumericKind,
  markedUnconfirmedCount,
  mergeTemplatePending,
  payloadOf,
  placeholderRemainingText,
  reportTitleOf,
  scoreText,
  sectionIndent,
  templatePendingKey,
  tokenCostText,
  triggeredLabel,
  valueMissingText,
  versionFieldPanel,
  versionFieldSectionText,
  versionFieldSubject,
  versionMarkFlipText,
  versionNewValueText,
  versionOldValueText,
  versionSectionFlipText,
  versionSectionPanel,
  versionSectionSubject,
  versionSourceFlipText,
  versionSummaryText,
  versionValueText,
  voidedByText,
  wordDraftLabel,
  type FieldDraft
} from './reportFlow'

/**
 * 报告作业台纯逻辑层的守卫
 *
 * 这一批用例守的是三类「不会报错、只会让评估师做错事」的失效：
 * <ol>
 * <li>{@link payloadOf} 少搬一态 ⟹ 库里躺着一个谁也不读的旧值；</li>
 * <li>{@link composeState} 把 STALE 说成 FRESH ⟹ 一份<b>旧值</b>的 Word 被交出去，
 *     而两份文件在纸面上长得一模一样；</li>
 * <li>{@link tokenCostText} 把 0 显示成「¥0」⟹ D2 的验收证据对不上库里那一列。</li>
 * </ol>
 *
 * 🔴 还有一类是**口径复刻**：红标该不该标、残留占位符算不算通过、闸的顺序 ——
 *    这三件事的判据都在后端。下面凡是遇到它们的用例，
 *    断言的都是「前端读服务端落定的那一列」，而不是「前端自己推出来的结论」，
 *    因为一旦有人把前端改成自己推，用例要跟着改才绿 —— 那次改动就是漂移本身。
 */

const field = (over: Partial<QlzgReportFieldVO>): QlzgReportFieldVO => ({
  fieldKey: 'address',
  fieldKind: 'TEXT',
  sourceType: 'MANUAL',
  ...over
})

const section = (over: Partial<QlzgReportSectionVO>): QlzgReportSectionVO => ({ ...over })

describe('buildSectionTree：按后端给的顺序追加，**不 sort**', () => {
  it('父子按 parentId 挂起来', () => {
    const roots = buildSectionTree([
      section({ id: 1, parentId: 0, sectionCode: 'S1' }),
      section({ id: 2, parentId: 1, sectionCode: 'S1.1' }),
      section({ id: 3, parentId: 1, sectionCode: 'S1.2' })
    ])
    expect(roots).toHaveLength(1)
    expect(roots[0].sectionCode).toBe('S1')
    expect(roots[0].children.map((c) => c.sectionCode)).toEqual(['S1.1', 'S1.2'])
  })

  it('🔴 清单顺序就是结果顺序：后端已按 sort（文档顺序）排好，前端再排一次会在并列值上给出不同答案', () => {
    const roots = buildSectionTree([
      section({ id: 3, parentId: 0, sectionCode: 'C', sort: 30 }),
      section({ id: 1, parentId: 0, sectionCode: 'A', sort: 10 }),
      section({ id: 2, parentId: 0, sectionCode: 'B', sort: 20 })
    ])
    expect(roots.map((r) => r.sectionCode)).toEqual(['C', 'A', 'B'])
  })

  it('🔴 认不出父节点的行**挂在根上**，不丢掉 —— 它的字段仍然会被渲染进 Word', () => {
    const roots = buildSectionTree([
      section({ id: 1, parentId: 0, sectionCode: 'S1' }),
      section({ id: 9, parentId: 999, sectionCode: 'ORPHAN' })
    ])
    expect(roots.map((r) => r.sectionCode)).toEqual(['S1', 'ORPHAN'])
  })

  it('parentId 为 null / undefined 的行是顶层', () => {
    const roots = buildSectionTree([
      section({ id: 1, parentId: null, sectionCode: 'A' }),
      section({ id: 2, sectionCode: 'B' })
    ])
    expect(roots).toHaveLength(2)
  })

  it('自己当自己的父亲 ⟹ 挂到根上，不死循环', () => {
    const roots = buildSectionTree([section({ id: 5, parentId: 5, sectionCode: 'LOOP' })])
    expect(roots).toHaveLength(1)
    expect(roots[0].children).toEqual([])
  })

  it('没有 id 的行整条跳过（它在 Map 里没有位置，硬留着会变成 undefined 父节点）', () => {
    const roots = buildSectionTree([
      section({ id: 1, parentId: 0, sectionCode: 'A' }),
      section({ parentId: 0, sectionCode: 'NO_ID' }),
      section({ id: null, parentId: 0, sectionCode: 'NULL_ID' })
    ])
    expect(roots.map((r) => r.sectionCode)).toEqual(['A'])
  })

  it('入参为空 ⟹ 空数组', () => {
    expect(buildSectionTree(null)).toEqual([])
    expect(buildSectionTree(undefined)).toEqual([])
    expect(buildSectionTree([])).toEqual([])
  })
})

describe('flattenSections / sectionIndent：拍平是给左栏那一份缩进清单用的', () => {
  it('深度优先，父在前、子在后、兄弟按原序', () => {
    const flat = flattenSections(
      buildSectionTree([
        section({ id: 1, parentId: 0, sectionCode: 'S1', level: 1 }),
        section({ id: 2, parentId: 1, sectionCode: 'S1.1', level: 2 }),
        section({ id: 3, parentId: 2, sectionCode: 'S1.1.1', level: 3 }),
        section({ id: 4, parentId: 1, sectionCode: 'S1.2', level: 2 }),
        section({ id: 5, parentId: 0, sectionCode: 'S2', level: 1 })
      ])
    )
    expect(flat.map((n) => n.sectionCode)).toEqual(['S1', 'S1.1', 'S1.1.1', 'S1.2', 'S2'])
  })

  it('缩进用**全角**空格：半角在 el-tree 之外会被 HTML 折叠掉', () => {
    expect(sectionIndent(1)).toBe('')
    expect(sectionIndent(2)).toBe('　')
    expect(sectionIndent(3)).toBe('　　')
    expect(sectionIndent(null)).toBe('')
    expect(sectionIndent(undefined)).toBe('')
  })

  it('level 为 0 或负数不产生负数 repeat（那会抛 RangeError）', () => {
    expect(sectionIndent(0)).toBe('')
    expect(sectionIndent(-3)).toBe('')
  })

  it('入参为空 ⟹ 空数组', () => {
    expect(flattenSections(null)).toEqual([])
    expect(flattenSections(undefined)).toEqual([])
  })
})

describe('groupFieldsBySection / fieldsOfSection：页眉那几格不属于任何一节', () => {
  const fields = [
    field({ id: 1, sectionId: 10, fieldKey: 'a' }),
    field({ id: 2, sectionId: null, fieldKey: 'report_no' }),
    field({ id: 3, sectionId: 10, fieldKey: 'b' }),
    field({ id: 4, fieldKey: 'base_date' })
  ]

  it('sectionId 为空的挂在 ORPHAN_SECTION_KEY 下', () => {
    const grouped = groupFieldsBySection(fields)
    expect(grouped.get(ORPHAN_SECTION_KEY)?.map((r) => r.fieldKey)).toEqual([
      'report_no',
      'base_date'
    ])
    expect(grouped.get('10')?.map((r) => r.fieldKey)).toEqual(['a', 'b'])
  })

  it('🔴 丢掉孤儿桶的话，评估师就改不到报告抬头上的委托方名称与基准日', () => {
    expect(fieldsOfSection(groupFieldsBySection(fields), null)).toHaveLength(2)
    expect(fieldsOfSection(groupFieldsBySection(fields), undefined)).toHaveLength(2)
  })

  it('没填过的节给空数组，不给 undefined（模板里直接 .length）', () => {
    expect(fieldsOfSection(groupFieldsBySection(fields), 999)).toEqual([])
  })

  it('跳过空行，不产生「undefined 的一格」', () => {
    const grouped = groupFieldsBySection([null as any, field({ id: 1, sectionId: 10 })])
    expect(grouped.get('10')).toHaveLength(1)
  })

  it('入参为空 ⟹ 空 Map', () => {
    expect(groupFieldsBySection(null).size).toBe(0)
    expect(groupFieldsBySection(undefined).size).toBe(0)
  })
})

describe('markedUnconfirmedCount：只读服务端落定的两列，不按 sourceType 自己推', () => {
  it('isMarked 为真且 isConfirmed 不为真 ⟹ 计入', () => {
    expect(
      markedUnconfirmedCount([
        field({ isMarked: true, isConfirmed: false }),
        field({ isMarked: true, isConfirmed: null }),
        field({ isMarked: true, isConfirmed: true }),
        field({ isMarked: false, isConfirmed: false }),
        field({ isMarked: null, isConfirmed: null })
      ])
    ).toBe(2)
  })

  it('🔴 一条 PARAM 行而 isMarked 为假时**不计** —— 「哪些来源该标红」是后端的口径，前端抄一份就会漂', () => {
    // 后端现在的口径是「PARAM 一律标红」，比枚举注释里那句「跨辖区回退才标」更粗。
    // 前端如果按 sourceType 推，等后端把口径收窄（I4-d 的欠账：加 requested_region_code）
    // 之后，界面上就会一直显示一个后端已经不认为是红标的格子
    expect(markedUnconfirmedCount([field({ sourceType: 'PARAM', isMarked: false })])).toBe(0)
    expect(markedUnconfirmedCount([field({ sourceType: 'MANUAL', isMarked: true })])).toBe(1)
  })

  it('入参为空 ⟹ 0', () => {
    expect(markedUnconfirmedCount(null)).toBe(0)
    expect(markedUnconfirmedCount(undefined)).toBe(0)
  })
})

describe('hasValue / filledCount：四态里任一非空即算填了', () => {
  it('空串不算填，0 算填', () => {
    expect(hasValue(field({ valueStr: '' }))).toBe(false)
    expect(hasValue(field({ valueStr: '  ' }))).toBe(true)
    expect(hasValue(field({ valueNum: 0 }))).toBe(true)
    expect(hasValue(field({ valueNum: null }))).toBe(false)
    expect(hasValue(field({ valueDate: '' }))).toBe(false)
    expect(hasValue(field({ valueDate: '2026-11-01' }))).toBe(true)
    expect(hasValue(field({ valueJson: {} }))).toBe(true)
    expect(hasValue(field({ valueJson: null }))).toBe(false)
  })

  it('🔴 valueNum = 0 是一个真实的数（例如「无租约」「面积为 0 的附属物」），不能被当成没填', () => {
    expect(filledCount([field({ valueNum: 0 }), field({})])).toBe(1)
  })

  it('行本身为 null ⟹ 没填', () => {
    expect(hasValue(null)).toBe(false)
    expect(hasValue(undefined)).toBe(false)
  })
})

describe('draftOf / blankDraft：四态**一起**读，不只是当前 kind 的那一态', () => {
  it('一行同时带着两态时两态都读出来', () => {
    const row = field({
      fieldKey: 'k',
      fieldKind: 'AMOUNT',
      placeholder: '{{k}}',
      sort: 3,
      valueStr: '旧文本',
      valueNum: 1200,
      valueDate: null,
      valueJson: { a: 1 }
    })
    expect(draftOf(row)).toEqual({
      fieldKey: 'k',
      fieldKind: 'AMOUNT',
      placeholder: '{{k}}',
      sort: 3,
      text: '旧文本',
      num: 1200,
      date: null,
      json: { a: 1 }
    })
  })

  it('缺失的键一律落成 null，不留 undefined（payloadOf 要发显式 null 才清得掉库里那一列）', () => {
    const draft = draftOf(field({}))
    expect(draft.placeholder).toBeNull()
    expect(draft.sort).toBeNull()
    expect(draft.text).toBeNull()
    expect(draft.num).toBeNull()
    expect(draft.date).toBeNull()
    expect(draft.json).toBeNull()
  })

  it('blankDraft 默认 TEXT，四态全空', () => {
    expect(blankDraft('new_key')).toEqual({
      fieldKey: 'new_key',
      fieldKind: 'TEXT',
      placeholder: null,
      sort: null,
      text: null,
      num: null,
      date: null,
      json: null
    })
    expect(blankDraft('new_key', 'DATE').fieldKind).toBe('DATE')
  })
})

describe('isNumericKind：与后端 QlzgReportFieldKindEnum 同一份口径', () => {
  it('四档数值 kind 走 el-input-number，其余走文本框', () => {
    expect(NUMERIC_KINDS).toEqual(['AMOUNT', 'RATE', 'AREA', 'COUNT'])
    for (const kind of NUMERIC_KINDS) expect(isNumericKind(kind)).toBe(true)
    expect(isNumericKind('TEXT')).toBe(false)
    expect(isNumericKind('DATE')).toBe(false)
    expect(isNumericKind('JSON')).toBe(false)
    expect(isNumericKind(null)).toBe(false)
    expect(isNumericKind(undefined)).toBe(false)
    expect(isNumericKind('')).toBe(false)
  })
})

describe('payloadOf：四态一起搬，空的传**显式 null**', () => {
  it('新建的一格：id 与 sectionId 都是 null，来源是 MANUAL', () => {
    const payload = payloadOf(77, null, blankDraft('new_key', 'DATE'))
    expect(payload).toEqual({
      id: null,
      reportId: 77,
      sectionId: null,
      fieldKey: 'new_key',
      fieldKind: 'DATE',
      placeholder: null,
      sort: null,
      valueStr: null,
      valueNum: null,
      valueDate: null,
      valueJson: null,
      sourceType: 'MANUAL',
      sourceRefId: null,
      provenanceId: null
    })
  })

  it('🔴 没填的那几态是**显式 null**，不是 undefined —— 后端 applyValue 靠它把旧值清掉', () => {
    const payload = payloadOf(1, field({ id: 5, valueStr: '旧文本' }), {
      ...blankDraft('k', 'DATE'),
      date: '2026-11-01'
    })
    // 从 TEXT 改成 DATE：valueStr 必须发 null，否则库里躺着一个谁也不读的旧值，
    // 而渲染按 fieldKind 只读一态 —— 出问题时排查方向会跑到渲染器上去
    expect(payload.valueStr).toBeNull()
    expect(payload.valueNum).toBeNull()
    expect(payload.valueJson).toBeNull()
    expect(payload.valueDate).toBe('2026-11-01')
    expect('valueStr' in payload).toBe(true)
  })

  it('🔴 sourceType / sourceRefId / provenanceId **原样回传**（后端对这三列也是无条件 set）', () => {
    const row = field({
      id: 5,
      sectionId: 10,
      sourceType: 'PHRASE',
      sourceRefId: 1024,
      provenanceId: 88
    })
    const payload = payloadOf(1, row, draftOf(row))
    expect(payload.sourceType).toBe('PHRASE')
    expect(payload.sourceRefId).toBe(1024)
    expect(payload.provenanceId).toBe(88)
    expect(payload.sectionId).toBe(10)
    expect(payload.id).toBe(5)
  })

  it('少传 sourceRefId 的后果：一条话术行变成「来源不明」，而 R36「有依据」照样判它有依据', () => {
    const row = field({ sourceType: 'PHRASE', sourceRefId: 1024 })
    expect(payloadOf(1, row, draftOf(row)).sourceRefId).toBe(1024)
  })

  it('原行的 sourceType 为空时才用入参那一档', () => {
    expect(payloadOf(1, field({ sourceType: '' }), blankDraft('k')).sourceType).toBe('MANUAL')
    expect(payloadOf(1, null, blankDraft('k'), 'PARAM').sourceType).toBe('PARAM')
  })

  it('草稿里的 placeholder 与 sort 照发（作业台不给编辑入口，但搬运时不能吞掉）', () => {
    const row = field({ placeholder: '{{k}}', sort: 9 })
    const payload = payloadOf(1, row, draftOf(row))
    expect(payload.placeholder).toBe('{{k}}')
    expect(payload.sort).toBe(9)
  })
})

describe('draftChanged：没改就**不发**请求', () => {
  const base = field({
    id: 5,
    fieldKey: 'k',
    fieldKind: 'AMOUNT',
    placeholder: null,
    valueNum: 1200
  })

  it('原样搬回来的草稿不算改动', () => {
    expect(draftChanged(base, draftOf(base))).toBe(false)
  })

  it('🔴 数值用 Number() 归一后再比：输入框给的是字符串 "1200"，原行是数字 1200', () => {
    // 不归一的话：白发一次请求、白复位一次已确认的红标
    expect(draftChanged(base, { ...draftOf(base), num: '1200' as any })).toBe(false)
    expect(draftChanged(base, { ...draftOf(base), num: '1200.00' as any })).toBe(false)
    expect(draftChanged(base, { ...draftOf(base), num: '1201' as any })).toBe(true)
  })

  it('空串与 null 在数值上等价（清空输入框给的是 ""）', () => {
    // 🔴 草稿的 fieldKey / fieldKind 必须与原行一致，否则这一条测的就不是数值归一了
    const row = field({ fieldKey: 'k', fieldKind: 'TEXT', valueNum: null })
    expect(draftChanged(row, { ...blankDraft('k'), num: '' as any })).toBe(false)
  })

  it('🔴 改了 fieldKind 而值恰好都是空 ⟹ **算改动**（后端会说「值没变」，可库里那一列的语义已经换了）', () => {
    const row = field({ fieldKind: 'TEXT' })
    expect(draftChanged(row, { ...draftOf(row), fieldKind: 'AMOUNT' })).toBe(true)
  })

  it('改了字段键 / 文本 / 日期 / json 任一项都算改动', () => {
    expect(draftChanged(base, { ...draftOf(base), fieldKey: 'other' })).toBe(true)
    expect(draftChanged(base, { ...draftOf(base), text: '一句话' })).toBe(true)
    expect(draftChanged(base, { ...draftOf(base), date: '2026-11-01' })).toBe(true)
    expect(draftChanged(base, { ...draftOf(base), json: { a: 1 } })).toBe(true)
    expect(draftChanged(base, { ...draftOf(base), placeholder: '{{x}}' })).toBe(true)
  })

  it('json 比的是内容不是引用', () => {
    const row = field({ valueJson: { a: 1, b: [1, 2] } })
    expect(draftChanged(row, { ...draftOf(row), json: { a: 1, b: [1, 2] } })).toBe(false)
    expect(draftChanged(row, { ...draftOf(row), json: { a: 1, b: [1, 3] } })).toBe(true)
  })

  it('新建的一格（原行为 null）永远算改动', () => {
    expect(draftChanged(null, blankDraft('k'))).toBe(true)
  })
})

describe('composeState：三档，STALE 与 NEVER 必须是两句话', () => {
  it('wordFileId 为空 ⟹ NEVER', () => {
    expect(composeState({ wordFileId: null })).toBe('NEVER')
    expect(composeState({})).toBe('NEVER')
    expect(composeState(null)).toBe('NEVER')
    expect(composeState(undefined)).toBe('NEVER')
  })

  it('成过文且 composeStale 为真 ⟹ STALE', () => {
    expect(composeState({ wordFileId: 9, composeStale: true })).toBe('STALE')
  })

  it('成过文且 composeStale 不为真 ⟹ FRESH', () => {
    expect(composeState({ wordFileId: 9, composeStale: false })).toBe('FRESH')
    expect(composeState({ wordFileId: 9, composeStale: null })).toBe('FRESH')
    expect(composeState({ wordFileId: 9 })).toBe('FRESH')
  })

  it('🔴 STALE 的措辞要点明「那份 Word 里是改之前的值」', () => {
    const text = composeStateText({ wordFileId: 9, composeStale: true })
    expect(text).toContain('改之前的值')
    expect(text).toContain('请重新成文')
  })

  it('🔴 NEVER 与 STALE 不共用一句提示：NEVER 是「他手上什么都没有，不会误交」', () => {
    const never = composeStateText({ wordFileId: null })
    const stale = composeStateText({ wordFileId: 9, composeStale: true })
    expect(never).not.toBe(stale)
    expect(never).toContain('还没成过文')
    expect(never).toContain('没有可下载的 Word')
  })

  it('FRESH 只说文件新不新，**不**说「可以定稿」', () => {
    const text = composeStateText({ wordFileId: 9, composeStale: false })
    expect(text).toBe('成稿与库里的值一致')
    expect(text).not.toContain('定稿')
  })

  it('标签颜色：STALE 是 warning，FRESH 是 success，NEVER 是 info', () => {
    expect(composeStateTagType({ wordFileId: 9, composeStale: true })).toBe('warning')
    expect(composeStateTagType({ wordFileId: 9, composeStale: false })).toBe('success')
    expect(composeStateTagType({ wordFileId: null })).toBe('info')
    expect(composeStateTagType(null)).toBe('info')
  })

  it('按钮文字：没成过文是「成文」，成过文是「重新成文」', () => {
    expect(composeButtonLabel({ wordFileId: null })).toBe('成文')
    expect(composeButtonLabel({ wordFileId: 9, composeStale: true })).toBe('重新成文')
    expect(composeButtonLabel({ wordFileId: 9, composeStale: false })).toBe('重新成文')
  })
})

describe('composeResultText：残留占位符或缺值格子 > 0 时成文**仍然是成功的**', () => {
  it('🔴 不说「成文失败」—— 说成失败他会去重试，而重试一百次也是同一处', () => {
    const text = composeResultText({ placeholderRemaining: 2, missing: ['built_year', 'usage'] })
    expect(text).not.toContain('失败')
    expect(text).toContain('成文完成')
    expect(text).toContain('那份 Word 已经产出')
  })

  it('🔴 两个计数器是**两件事**，各带各的出路：花括号去改模板，缺值格子去填值', () => {
    const text = composeResultText({ placeholderRemaining: 2, missing: ['built_year', 'usage'] })
    expect(text).toContain('两件事要分别处理')
    expect(text).toContain('模板里还有 2 个占位符没闭合')
    expect(text).toContain('出路是去改模板')
    expect(text).toContain('有 2 个格子取不到值')
    expect(text).toContain('它们是：built_year、usage')
    expect(text).toContain('出路是去填值，不是去改模板')
    expect(text).toContain('【缺值】')
    expect(text).toContain('【未映射】')
    expect(text).toContain('搜左花括号')
  })

  it('🔴 回归：花括号全闭合、但 12 个格子取不到值时，缺值的名字**必须**印出来', () => {
    // 旧实现把 missing 嵌在 `placeholderRemaining > 0` 那一支里面，
    // 于是这一档显示的是一句干净的「成文完成，没有残留的占位符」——
    // 与 QlzgReportRespVO#valueMissingCount 自己那句「要说是哪几格，
    // 去成文响应里的 missing 清单（那才是名字）」正好相反，
    // 而评估师照着「没有残留」去定稿，会被闸 B 拦下且不知道该填哪一格
    const text = composeResultText({
      placeholderRemaining: 0,
      missing: ['built_year', 'usage', 'land_area']
    })
    expect(text).toContain('还有一件事要处理')
    expect(text).toContain('有 3 个格子取不到值')
    expect(text).toContain('built_year、usage、land_area')
    expect(text).not.toContain('花括号全部闭合')
  })

  it('missing 里的空串要滤掉：滤完为空 ⟹ 只剩占位符那一件', () => {
    const text = composeResultText({ placeholderRemaining: 1, missing: ['', null as any] })
    expect(text).toContain('还有一件事要处理')
    expect(text).toContain('模板里还有 1 个占位符没闭合')
    expect(text).not.toContain('取不到值')
  })

  it('两件都干净时是一句完成，且**不**印任何出路', () => {
    const clean = '成文完成，模板里的花括号全部闭合了，每一个格子也都取到了值'
    expect(composeResultText({ placeholderRemaining: 0, missing: [] })).toBe(clean)
    expect(composeResultText({ placeholderRemaining: 0 })).toBe(clean)
    expect(composeResultText({})).toBe(clean)
  })

  it('🔴 reserved 非空要说「公章位已预留」—— 否则评估师会在 Word 里看到三处空白，以为是自己漏填了', () => {
    const text = composeResultText({
      placeholderRemaining: 0,
      reserved: ['seal_org', 'seal_person', 'seal_date']
    })
    expect(text).toContain('公章位已预留（seal_org、seal_person、seal_date）')
    expect(text).toContain('导出时该位留空')
  })

  it('🔴 replacedFileId **一个字都不提**：它不会被删（FileApi 没有删除方法），提它只会引出「那怎么清掉」这个当前答不了的问题', () => {
    const text = composeResultText({ placeholderRemaining: 0, replacedFileId: 4242 })
    expect(text).not.toContain('4242')
    expect(text).not.toContain('清理')
    expect(text).not.toContain('已删除')
  })

  it('🔴 返回值是**纯文本**：这里不允许出现渲染不出来的 markdown（案例页栽过一次）', () => {
    const text = composeResultText({
      placeholderRemaining: 1,
      missing: ['built_year'],
      reserved: ['seal_org']
    })
    expect(text).not.toContain('**')
    expect(text).not.toContain('🔴')
  })

  it('结果为空 ⟹ 空串（不印一句「成文完成」骗人）', () => {
    expect(composeResultText(null)).toBe('')
    expect(composeResultText(undefined)).toBe('')
  })
})

describe('composeHasIssue / composeResultTitle：弹窗的底色与标题必须和正文同一口径', () => {
  it('🔴 只有 missing 非空也算「有事」—— 否则绿色弹窗配一段「取不到值」的正文', () => {
    expect(composeHasIssue({ placeholderRemaining: 0, missing: ['built_year'] })).toBe(true)
    expect(composeHasIssue({ placeholderRemaining: 1 })).toBe(true)
    expect(composeHasIssue({ placeholderRemaining: 0, missing: [] })).toBe(false)
    expect(composeHasIssue({})).toBe(false)
    expect(composeHasIssue(null)).toBe(false)
  })

  it('reserved **不算**「有事」：三个签章位是刻意留空的，不是这一份报告的毛病', () => {
    expect(composeHasIssue({ placeholderRemaining: 0, reserved: ['seal_org'] })).toBe(false)
    expect(composeResultTitle({ placeholderRemaining: 0, reserved: ['seal_org'] })).toBe('成文完成')
  })

  it('missing 里的空串滤完为空 ⟹ 不算「有事」', () => {
    expect(composeHasIssue({ placeholderRemaining: 0, missing: ['', null as any] })).toBe(false)
  })

  it('标题按「哪一件」分三种，且都以「成文完成」开头', () => {
    expect(composeResultTitle({ placeholderRemaining: 0, missing: [] })).toBe('成文完成')
    expect(composeResultTitle({ placeholderRemaining: 1, missing: [] })).toBe(
      '成文完成，但还有未闭合的占位符'
    )
    expect(composeResultTitle({ placeholderRemaining: 0, missing: ['built_year'] })).toBe(
      '成文完成，但还有取不到值的格子'
    )
    expect(composeResultTitle({ placeholderRemaining: 1, missing: ['built_year'] })).toBe(
      '成文完成，但占位符与缺值格子两件事都要处理'
    )
    for (const title of [
      composeResultTitle({ placeholderRemaining: 1 }),
      composeResultTitle({ missing: ['a'] }),
      composeResultTitle({ placeholderRemaining: 1, missing: ['a'] })
    ]) {
      expect(title.startsWith('成文完成')).toBe(true)
      expect(title).not.toContain('失败')
    }
  })

  it('结果为空 ⟹ 空串', () => {
    expect(composeResultTitle(null)).toBe('')
    expect(composeResultTitle(undefined)).toBe('')
  })
})

describe('valueMissingText：为空是「还没数过」，不是「0 个」', () => {
  it('🔴 null / undefined ⟹ 破折号：后端脚本 31 之后这一列真的会为空', () => {
    // 与 placeholderRemainingText 同一条纪律：把 NULL 显示成「0 个」等于
    // 宣称「已经数过了、一个都不缺」。
    // 🔴 这一条分支此前是【不可达】的：那一列建的时候是 NOT NULL DEFAULT 0，
    //    后端补列的那一刻，库里已有的行全部拿到一个看起来像测量结果的假 0，
    //    于是 null 永远送不到前端，而假 0 在这里被显示成「0 个」。
    //    脚本 31 把三列放开成可空、把存量行的假 0 清掉，本条分支才真的会走到。
    // 🔴 后端的定稿闸同步改成 fail closed：三列任一为空即拦
    //    （REPORT_COMPOSE_COUNTS_UNMEASURED），出路是重新成文一次 ——
    //    界面与闸现在说的是同一句话，此前是一个说不知道、一个说干净
    expect(valueMissingText(null)).toBe('—')
    expect(valueMissingText(undefined)).toBe('—')
    expect(valueMissingText({})).toBe('—')
    expect(valueMissingText({ valueMissingCount: null })).toBe('—')
  })

  it('0 就是 0，且**不**加「定稿会被拦」那句', () => {
    expect(valueMissingText({ valueMissingCount: 0 })).toBe('0 个')
  })

  it('> 0 要说清后果，并说清是「格子」不是「纸上处数」', () => {
    const text = valueMissingText({ valueMissingCount: 12 })
    expect(text).toBe('12 个格子取不到值（定稿会被拦）')
    expect(text).not.toContain('处')
  })
})

describe('changeSummaryRequired：判据是 versionNo > 1，与后端 finalizeReport 同一条', () => {
  it('第 1 版留空', () => {
    expect(changeSummaryRequired({ versionNo: 1 })).toBe(false)
    expect(changeSummaryRequired({ versionNo: null })).toBe(false)
    expect(changeSummaryRequired({})).toBe(false)
    expect(changeSummaryRequired(null)).toBe(false)
  })

  it('第 2 版及以后必填', () => {
    expect(changeSummaryRequired({ versionNo: 2 })).toBe(true)
    expect(changeSummaryRequired({ versionNo: 7 })).toBe(true)
  })

  it('🔴 versionNo 是**本报告**的第几版（由「退回修订」递增），与模板的版本号是两套号', () => {
    // 界面上同时出现两个「版本」时必须写清是谁的；
    // 定稿本身不递增它，reopenForRevision 才递增
    const report: QlzgReportVO = { versionNo: 3, templateVersionId: 55 }
    expect(changeSummaryRequired(report)).toBe(true)
  })
})

describe('voidedByText：空白会被读成「没有人作废过它」', () => {
  it('没作废过 ⟹ 破折号', () => {
    expect(voidedByText({})).toBe('—')
    expect(voidedByText(null)).toBe('—')
    expect(voidedByText({ voidedAt: null, voidedBy: null })).toBe('—')
  })

  it('记下了名字就用名字', () => {
    expect(voidedByText({ voidedBy: 7, voidedByName: '张三' })).toBe('张三')
  })

  it('🔴 名字为空但有编号 ⟹「已离岗（编号 N）」，**不是**空白', () => {
    // 报告号的唯一性查全库含 VOIDED（作废掉的号也不会被复用），
    // 一份看不出被谁作废的报告在复核时是一堵墙
    expect(voidedByText({ voidedBy: 7, voidedByName: null })).toBe('已离岗（编号 7）')
    expect(voidedByText({ voidedBy: 7 })).toBe('已离岗（编号 7）')
  })

  it('只有时间没有编号 ⟹ 如实说「未记下操作人」', () => {
    expect(voidedByText({ voidedAt: new Date('2026-11-01T00:00:00Z'), voidedBy: null })).toBe(
      '未记下操作人'
    )
  })
})

describe('tokenCostText：D2 验收的可对账证据', () => {
  it('🔴 恰好为 0 时补六位小数 —— D2 的判据是 token_cost = 0.000000，显示成「¥0」对不上账', () => {
    expect(tokenCostText(0)).toBe('0.000000')
  })

  it('🔴 别的值一律原样，**不** toFixed(6)：那会四舍五入一个非零值，补出来的那几位在后端没有对应项', () => {
    expect(tokenCostText(1.5)).toBe('1.5')
    expect(tokenCostText(0.000123)).toBe('0.000123')
    expect(tokenCostText(12.345678901)).toBe('12.345678901')
    expect(tokenCostText(-1)).toBe('-1')
  })

  it('不带货币符号（那一列在库里是裸数，加符号会让客户 IT 对不上）', () => {
    expect(tokenCostText(0)).not.toContain('¥')
  })

  it('为空 ⟹ 破折号', () => {
    expect(tokenCostText(null)).toBe('—')
    expect(tokenCostText(undefined)).toBe('—')
  })
})

describe('wordDraftLabel：草稿与定稿在纸面上没有区别', () => {
  it('定稿件 / 草稿两种说法', () => {
    expect(wordDraftLabel(true)).toBe('定稿件')
    expect(wordDraftLabel(false)).toContain('不要交付')
    expect(wordDraftLabel(null)).toContain('不要交付')
    expect(wordDraftLabel(undefined)).toContain('不要交付')
  })
})

describe('reportTitleOf：title 可空，回落成「报告号 · 交付物」', () => {
  it('有标题就用标题（纯空白不算有）', () => {
    expect(reportTitleOf({ title: '某某项目结果报告' })).toBe('某某项目结果报告')
    expect(reportTitleOf({ title: '   ', reportNo: 'R-1' })).not.toBe('   ')
  })

  it('回落时优先用中文的交付物类型', () => {
    expect(reportTitleOf({ reportNo: 'R-1', reportType: 'RESULT' }, '结果报告')).toBe(
      'R-1 · 结果报告'
    )
    expect(reportTitleOf({ reportNo: 'R-1', reportType: 'RESULT' }, null)).toBe('R-1 · RESULT')
  })

  it('🔴 报告号也没有时不印一个空的「· 」', () => {
    expect(reportTitleOf({ id: 5 })).toBe('报告 5')
    expect(reportTitleOf({})).toBe('报告 ')
  })

  it('report 为空 ⟹ 破折号', () => {
    expect(reportTitleOf(null)).toBe('—')
    expect(reportTitleOf(undefined, '结果报告')).toBe('—')
  })
})

describe('placeholderRemainingText：为空是「还没数过」，不是「0 处」', () => {
  it('🔴 那一列在**成过文之后**才有值；显示 0 会让人以为已经检查过了', () => {
    expect(placeholderRemainingText({ placeholderRemaining: null })).toBe('—')
    expect(placeholderRemainingText({})).toBe('—')
    expect(placeholderRemainingText(null)).toBe('—')
  })

  it('> 0 时只说「定稿会被拦」，不说「成文失败」', () => {
    const text = placeholderRemainingText({ placeholderRemaining: 12 })
    expect(text).toBe('12 处未闭合（定稿会被拦）')
    expect(text).not.toContain('失败')
  })

  it('恰好 0 时说「0 处」', () => {
    expect(placeholderRemainingText({ placeholderRemaining: 0 })).toBe('0 处')
  })
})

describe('emptyCandidateText：空**不是**故障，但必须把原因说出来', () => {
  it('选了节而清单为空 ⟹ 指向「去话术库点审核通过」', () => {
    const text = emptyCandidateText('S03')
    expect(text).toContain('审核通过')
    expect(text).toContain('56 条种子')
    expect(text).toContain('草稿')
  })

  it('🔴 没选节时是**另一句**：那时后端只返回不限章节的通用话术，是入参的问题不是审核的问题', () => {
    const text = emptyCandidateText(null)
    expect(text).toContain('先在左栏选一节')
    expect(text).toContain('不限章节')
    expect(text).not.toBe(emptyCandidateText('S03'))
  })

  it('空串与 undefined 走「没选节」那一句', () => {
    expect(emptyCandidateText('')).toBe(emptyCandidateText(null))
    expect(emptyCandidateText(undefined)).toBe(emptyCandidateText(null))
  })
})

describe('scoreText：不做浮点运算、不 toFixed', () => {
  it('原样印出来', () => {
    expect(scoreText(12.5)).toBe('12.5')
    expect(scoreText(0)).toBe('0')
    expect(scoreText(88.1234)).toBe('88.1234')
  })

  it('🔴 0 分是一个真实的分（触发条件全不命中的兜底话术），不是「没有分」', () => {
    expect(scoreText(0)).not.toBe('—')
  })

  it('为空 ⟹ 破折号', () => {
    expect(scoreText(null)).toBe('—')
    expect(scoreText(undefined)).toBe('—')
  })
})

describe('candidateReasonText：窄栏用 because，展开用 reasons，两者同源', () => {
  it('because 非空白时用它', () => {
    expect(candidateReasonText({ because: '后端拼好的一句', reasons: ['a', 'b'] })).toBe(
      '后端拼好的一句'
    )
  })

  it('because 为空时把 reasons 用「 · 」连起来', () => {
    expect(candidateReasonText({ because: '   ', reasons: ['同辖区', '同品类'] })).toBe(
      '同辖区 · 同品类'
    )
    expect(candidateReasonText({ reasons: ['同辖区', '', null as any, '同品类'] })).toBe(
      '同辖区 · 同品类'
    )
  })

  it('两个都没有 ⟹ 空串（不自己按 scoreDetail 再拼一句）', () => {
    expect(candidateReasonText({})).toBe('')
    expect(candidateReasonText(null)).toBe('')
    expect(candidateReasonText(undefined)).toBe('')
  })
})

describe('triggeredLabel：判据是 triggered，**不是** hitKeys > 0', () => {
  it('triggered 为真且有命中键 ⟹「条件全部命中（N 个）」', () => {
    expect(triggeredLabel({ triggered: true, hitKeys: 3 })).toBe('条件全部命中（3 个）')
  })

  it('triggered 为真而没有命中键 ⟹「无条件话术」（它压根没有触发条件）', () => {
    expect(triggeredLabel({ triggered: true, hitKeys: 0 })).toBe('无条件话术')
    expect(triggeredLabel({ triggered: true })).toBe('无条件话术')
  })

  it('🔴 triggered 为假而 hitKeys > 0 ⟹ 必须说「没满足」且点明「不加分」', () => {
    // hitKeys 如实记着半命中，而命中键**不加分**。
    // 显示成「已命中」会让评估师以为这一条是按他的标的挑出来的，
    // 而它其实只是一个触发条件没满足的兜底
    const text = triggeredLabel({ triggered: false, hitKeys: 2 })
    expect(text).toBe('条件没满足（半命中 2 个，不加分）')
    expect(text).not.toContain('已命中')
    expect(text).toContain('不加分')
  })

  it('triggered 为假且没命中 ⟹「条件没满足」', () => {
    expect(triggeredLabel({ triggered: false, hitKeys: 0 })).toBe('条件没满足')
    expect(triggeredLabel({ triggered: null, hitKeys: null })).toBe('条件没满足')
    expect(triggeredLabel({})).toBe('条件没满足')
    expect(triggeredLabel(null)).toBe('条件没满足')
    expect(triggeredLabel(undefined)).toBe('条件没满足')
  })
})

// ==================== 历史版本与红标（I6-b，§11.11.3） ====================

/**
 * 🔴 这一批用例守的是一件**具体的**事：把「没法比」显示成「没有变化」
 *
 * 后端在不可比时把两个清单**直接设成空**，所以「清单是空的」这一个观察
 * 对应两个完全相反的结论，而它们在界面上都长得像一张空表。
 * 假绿的红标比没有红标更坏：复核人看完会签字，签的是一份压根没有比对过的东西；
 * 而没有红标时他至少知道自己得逐字读
 */
const diffOf = (over: Partial<QlzgReportVersionDiffVO>): QlzgReportVersionDiffVO => ({ ...over })

const fieldRow = (over: Partial<QlzgReportVersionFieldDiffVO>): QlzgReportVersionFieldDiffVO => ({
  ...over
})

const sectionRow = (
  over: Partial<QlzgReportVersionSectionDiffVO>
): QlzgReportVersionSectionDiffVO => ({ ...over })

describe('versionFieldPanel / versionSectionPanel：把「没法比」与「没有变化」分开', () => {
  it('🔴 不可比 + 空清单 ⟹ 原样印那句 reason，绝不印「没有变化」', () => {
    const reason = '上一版的快照里没有冻章节（它定稿于段落比对上线之前），所以段落无法比对'
    const panel = versionSectionPanel(
      diffOf({ sectionComparable: false, sectionNotComparableReason: reason, sectionDiff: [] })
    )
    expect(panel.comparable).toBe(false)
    expect(panel.headline).toBe(reason)
    expect(panel.alertType, '不可比时给绿 ⟹ 假绿').not.toBe('success')
    expect(panel.headline).not.toContain('本版没有')
  })

  it('可比 + 空清单 ⟹ 这才是「本版没有变化」，而且它可以是绿的', () => {
    const panel = versionFieldPanel(
      diffOf({ fieldComparable: true, fieldDiff: [], changedFieldCount: 0 })
    )
    expect(panel.comparable).toBe(true)
    expect(panel.rows).toBe(0)
    expect(panel.headline).toBe('本版没有一处字段变化')
    expect(panel.alertType).toBe('success')
  })

  it('🔴 comparable 为 null / undefined 一律当不可比 —— 它是三态里的「不知道」', () => {
    for (const value of [null, undefined]) {
      const panel = versionFieldPanel(
        diffOf({ fieldComparable: value as null, fieldDiff: [], sectionDiff: [] })
      )
      expect(panel.comparable, `fieldComparable = ${value} 被当成了可比`).toBe(false)
      expect(panel.alertType).toBe('warning')
    }
  })

  it('🔴 两半各判各的：「字段可比、段落不可比」是一种真实存在的状态', () => {
    // I6-b 之前定稿的版本读得出字段、而没有冻章节。合成一句话就读不出是哪一半比不了
    const diff = diffOf({
      fieldComparable: true,
      fieldDiff: [fieldRow({ changeKinds: ['VALUE'] })],
      sectionComparable: false,
      sectionNotComparableReason:
        '两版的快照里都没有冻章节（它们都定稿于段落比对上线之前），所以段落无法比对',
      sectionDiff: []
    })
    expect(versionFieldPanel(diff).comparable).toBe(true)
    expect(versionSectionPanel(diff).comparable).toBe(false)
    expect(versionFieldPanel(diff).headline).not.toBe(versionSectionPanel(diff).headline)
  })

  it('段落数单独说出来：复核人最先要问的是「有没有哪一段散文被改过」', () => {
    const diff = diffOf({
      fieldComparable: true,
      fieldDiff: [
        fieldRow({ changeKinds: ['VALUE'] }),
        fieldRow({ changeKinds: ['PARAGRAPH'] }),
        fieldRow({ changeKinds: ['PARAGRAPH', 'SOURCE'] })
      ],
      changedParagraphCount: 2
    })
    expect(versionFieldPanel(diff).headline).toBe('变了 3 处，其中 2 处是段落文字')
  })

  it('没有段落变化时不提段落 —— 每一版都挂一句「其中 0 处」就是在稀释要紧的那一句', () => {
    const diff = diffOf({
      fieldComparable: true,
      fieldDiff: [fieldRow({ changeKinds: ['VALUE'] })],
      changedParagraphCount: 0
    })
    expect(versionFieldPanel(diff).headline).toBe('变了 1 处')
  })

  it('🔴 rows 数的是**实际渲染的清单**，不是后端那个 count 字段', () => {
    // 两者本该相等。不相等时以清单为准：界面上印的数字必须与他数出来的行数一致，
    // 而「表头说变了 5 处、表里只有 2 行」会让他以为自己漏看了三行
    const panel = versionFieldPanel(
      diffOf({
        fieldComparable: true,
        fieldDiff: [fieldRow({ changeKinds: ['VALUE'] }), fieldRow({ changeKinds: ['MARK'] })],
        changedFieldCount: 5
      })
    )
    expect(panel.rows).toBe(2)
    expect(panel.headline).toBe('变了 2 处')
  })

  it('🔴 diff 整个为 null（还没加载 / 加载失败）时不给绿的', () => {
    expect(versionFieldPanel(null).comparable).toBe(false)
    expect(versionFieldPanel(null).alertType).toBe('warning')
    expect(versionSectionPanel(undefined).comparable).toBe(false)
    expect(versionSectionPanel(undefined).alertType).toBe('warning')
  })
})

describe('versionValueText：原样返回快照字串，空值印成「（空）」', () => {
  it('🔴 不 trim、不补千分位、不换算单位 —— 格式化要读**活着的** param_schema', () => {
    expect(versionValueText('  1200000  ')).toBe('  1200000  ')
    expect(versionValueText('0.0500')).toBe('0.0500')
    expect(versionValueText('第一段\n第二段')).toBe('第一段\n第二段')
  })

  it('空值印成「（空）」而不是留白：空单元格与「这一列坏了」长得一模一样', () => {
    expect(versionValueText(null)).toBe('（空）')
    expect(versionValueText(undefined)).toBe('（空）')
    expect(versionValueText('')).toBe('（空）')
  })

  it('🔴 ADDED / REMOVED 那一侧要说「没有这一格」，不是「（空）」', () => {
    const added = fieldRow({ changeKinds: ['ADDED'], oldValue: null, newValue: '1200000' })
    expect(versionOldValueText(added)).toBe('（上一版没有这一格）')
    expect(versionNewValueText(added)).toBe('1200000')

    const removed = fieldRow({ changeKinds: ['REMOVED'], oldValue: '1200000', newValue: null })
    expect(versionOldValueText(removed)).toBe('1200000')
    expect(versionNewValueText(removed)).toBe('（本版没有这一格了）')
  })

  it('值真被清空时仍然是「（空）」—— 那与「删掉一格」是两件不同的事', () => {
    const cleared = fieldRow({ changeKinds: ['VALUE'], oldValue: '1200000', newValue: '' })
    expect(versionNewValueText(cleared)).toBe('（空）')
    expect(versionOldValueText(cleared)).toBe('1200000')
  })
})

describe('versionFieldSubject / versionSectionSubject：优先给纸上看得见的那个名字', () => {
  it('placeholder 优先于 fieldKey（前者是评估师在纸上看见的，后者是机器名）', () => {
    expect(
      versionFieldSubject(fieldRow({ placeholder: '建筑面积', fieldKey: 'building_area' }))
    ).toBe('建筑面积')
  })

  it('🔴 两个都没有也**不留白**：说不出是哪一格的红标等于让复核人整份重读', () => {
    expect(versionFieldSubject(fieldRow({ fieldKey: 'building_area' }))).toBe('building_area')
    expect(versionFieldSubject(fieldRow({}))).toBe('（这一格没有键）')
  })

  it('章节优先本版标题，REMOVED 行回落到上一版的', () => {
    expect(
      versionSectionSubject(
        sectionRow({ changeKinds: ['REMOVED'], oldSectionTitle: '被删掉的一节' })
      )
    ).toBe('被删掉的一节')
    expect(versionSectionSubject(sectionRow({ sectionCode: 'S06-1' }))).toBe('S06-1')
    expect(versionSectionSubject(sectionRow({}))).toBe('（这一节没有标题）')
  })
})

describe('versionSourceFlipText：判据是**种类**，不是自己比两个来源码', () => {
  it('没带 SOURCE 时给 null（整栏不显示）—— 两个码不相等也不算', () => {
    expect(
      versionSourceFlipText(
        fieldRow({ changeKinds: ['VALUE'], oldSourceType: 'CALC', newSourceType: 'MANUAL' })
      )
    ).toBeNull()
  })

  it('带 SOURCE 时把码翻成中文', () => {
    expect(
      versionSourceFlipText(
        fieldRow({ changeKinds: ['SOURCE'], oldSourceType: 'CALC', newSourceType: 'MANUAL' })
      )
    ).toBe('测算 → 人工录入')
  })

  it('🔴 改了值必然换一行溯源，那一行**不该**被前端读成「来源变了」', () => {
    // 后端只给 ['VALUE']：手工溯源的规矩是「值变了就新写一行 qlzg_provenance」，
    // 于是改值必然换 provenanceId。前端自己比 provenanceId 会让「来源变化」这一栏
    // 在每一行上都亮 —— 实测一份改了 6 格的报告，6 行里 5 行会亮，
    // 而 sourceType / sourceRefId 一个字都没动
    expect(
      versionSourceFlipText(
        fieldRow({
          changeKinds: ['VALUE'],
          oldSourceType: 'MANUAL',
          newSourceType: 'MANUAL',
          oldProvenanceId: 28,
          newProvenanceId: 39
        })
      )
    ).toBeNull()
  })

  it('🔴 类型没变、变的是它指向的那一条时，不要印成「测算 → 测算」', () => {
    // 后端对 sourceType / sourceRefId 任一变了、或值没变而 provenanceId 变了都报 SOURCE，
    // 而前端只读得到第一个。印成「测算 → 测算」会被读成一句废话，
    // 于是复核人扫一眼就过去 —— 而这一行确实有变化：有人把这一格的依据换掉了
    const text = versionSourceFlipText(
      fieldRow({
        changeKinds: ['SOURCE'],
        oldSourceType: 'CALC',
        newSourceType: 'CALC',
        oldSourceRefId: 1,
        newSourceRefId: 2
      })
    )
    expect(text).toContain('测算')
    expect(text).toContain('指向的那一条')
  })

  it('来源码为空时印「（无）」，不印空白', () => {
    expect(
      versionSourceFlipText(
        fieldRow({ changeKinds: ['SOURCE'], oldSourceType: null, newSourceType: 'MANUAL' })
      )
    ).toBe('（无） → 人工录入')
  })
})

describe('versionMarkFlipText：布尔是**三态**，null 不是 false', () => {
  it('没带 MARK 时给 null，即使两个布尔确实不相等', () => {
    expect(
      versionMarkFlipText(fieldRow({ changeKinds: ['VALUE'], oldMarked: false, newMarked: true }))
    ).toBeNull()
  })

  it('只翻了红标就只说红标', () => {
    expect(
      versionMarkFlipText(
        fieldRow({
          changeKinds: ['MARK'],
          oldMarked: false,
          newMarked: true,
          oldConfirmed: true,
          newConfirmed: true
        })
      )
    ).toBe('未标红 → 已标红')
  })

  it('两个都翻了就用 · 连起来', () => {
    expect(
      versionMarkFlipText(
        fieldRow({
          changeKinds: ['MARK'],
          oldMarked: true,
          newMarked: false,
          oldConfirmed: true,
          newConfirmed: false
        })
      )
    ).toBe('已标红 → 未标红 · 已确认 → 未确认')
  })

  it('🔴 null 印成「（没记下）」—— 形状 1 的老快照压根没冻这两个键', () => {
    // 印成「未标红」是一句假话：真相是没人知道当年有没有人标过红
    expect(
      versionMarkFlipText(fieldRow({ changeKinds: ['MARK'], oldMarked: null, newMarked: true }))
    ).toBe('（没记下） → 已标红')
  })
})

describe('versionSectionFlipText：一行可以同时带几种，全部说出来', () => {
  it('🔴 CLAUSE_REF 要连旧值一起给全 —— 它是 G-04 的输入，一条法律事实', () => {
    const text = versionSectionFlipText(
      sectionRow({
        changeKinds: ['CLAUSE_REF'],
        oldClauseRef: '《资产评估执业准则——资产评估报告》第二十条',
        newClauseRef: '《资产评估执业准则——资产评估报告》第二十一条'
      })
    )
    expect(text).toContain('第二十条')
    expect(text).toContain('第二十一条')
  })

  it('用换行拼、界面上 pre-wrap 渲染（不用 v-html：章节标题来自机构上传的 docx）', () => {
    const text = versionSectionFlipText(
      sectionRow({
        changeKinds: ['TITLE', 'ORDER'],
        oldSectionTitle: '评估结论',
        newSectionTitle: '评估结论与建议',
        oldSort: 61,
        newSort: 62,
        oldLevel: 2,
        newLevel: 2
      })
    )
    expect(text.split('\n')).toHaveLength(2)
    expect(text).toContain('标题：评估结论 → 评估结论与建议')
    expect(text).toContain('顺序：61 → 62')
  })

  it('ADDED / REMOVED 排在最前面（那是最严重的一种）', () => {
    expect(
      versionSectionFlipText(
        sectionRow({ changeKinds: ['TITLE', 'ADDED'], newSectionTitle: '新增的一节' })
      ).startsWith('本版新出现的一节')
    ).toBe(true)
    expect(
      versionSectionFlipText(sectionRow({ changeKinds: ['REMOVED'], oldSectionTitle: '旧的一节' }))
    ).toBe('上一版有、本版没有了')
  })

  it('内容来源翻成中文', () => {
    expect(
      versionSectionFlipText(
        sectionRow({
          changeKinds: ['CONTENT_MODE'],
          oldContentMode: 'STATIC',
          newContentMode: 'MIXED'
        })
      )
    ).toBe('内容来源：模板静态文本 → 混合')
  })
})

describe('versionSummaryText：两种「空」要给两句话', () => {
  it('🔴 第 1 版为空是**设计**，不能读成「有人跳过了必填项」', () => {
    expect(versionSummaryText({ versionNo: 1, changeSummary: null })).toContain('第 1 版')
    expect(versionSummaryText({ versionNo: null, changeSummary: null })).toContain('第 1 版')
  })

  it('第 2 版之后为空要如实说没写', () => {
    expect(versionSummaryText({ versionNo: 2, changeSummary: '' })).toBe('（这一版没写说明）')
    expect(versionSummaryText({ versionNo: 7 })).toBe('（这一版没写说明）')
  })

  it('🔴 原样返回、不 trim —— 它是 30 年后翻档案时唯一的答案', () => {
    expect(versionSummaryText({ versionNo: 3, changeSummary: '  改了建筑面积  ' })).toBe(
      '  改了建筑面积  '
    )
  })
})

describe('versionFieldSectionText：说不出是哪一节就整行不渲染，不编一句回落文案', () => {
  it('有章节标题就显示它', () => {
    expect(versionFieldSectionText(fieldRow({ sectionTitle: '三、评估对象概况' }))).toBe(
      '三、评估对象概况'
    )
  })

  it('🔴 空时给 null —— 「没归到某一节」在**章节冻得好好的**那一版里也是常态，不是异常', () => {
    // qlzg_report_field.section_id 可空是设计（报告编号、评估基准日、机构名住在页眉或首页
    // 表格里），实测库里 63 格**全部**为 null。给每行挂同一句话是版面上的假红：
    // 一行字如果在每一行上说的都是同一件事，复核人就会学会跳过它，
    // 连带跳过它偶尔真的给出节标题的那一次
    expect(versionFieldSectionText(fieldRow({ sectionTitle: null }))).toBeNull()
    expect(versionFieldSectionText(fieldRow({}))).toBeNull()
    expect(versionFieldSectionText(null)).toBeNull()
  })

  it('🔴 【不能】写「这一版没冻章节」—— 那是一句假话', () => {
    // 本函数拿到的只有 sectionTitle，而它为空有两个互斥的原因：快照压根没冻章节
    // （形状 1），或者冻了、只是这一格不属于任何节。前者由章节表那一段
    // sectionNotComparableReason 整段说明，比在每一行上重复一遍更准；
    // 在字段表里替它说话必然说错其中一个（实测 report 9 的 sectionComparable 为 true）
    expect(versionFieldSectionText(fieldRow({ sectionTitle: '' }))).not.toBe('（这一版没冻章节）')
  })
})

describe('mergeTemplatePending：待填格是**并**进草稿仓库，不是重建', () => {
  const cell = (over: Partial<QlzgReportFieldPendingVO>): QlzgReportFieldPendingVO => ({
    sectionId: 5120,
    sectionCode: 'S06',
    sectionTitle: '评估依据',
    fieldKey: 'basis_law',
    fieldKind: 'TEXT',
    ...over
  })

  const tplRow = (sectionId: number, fieldKey: string, draft?: Partial<FieldDraft>) => ({
    key: templatePendingKey(sectionId, fieldKey),
    sectionId,
    draft: { ...blankDraft(fieldKey, 'TEXT'), ...draft }
  })

  it('清单里每一格出一行，key 由（节, 键）拼出来', () => {
    const out = mergeTemplatePending([], [cell({}), cell({ sectionId: 5121, fieldKey: 'basis_standard' })])
    expect(out.map((row) => row.key)).toEqual([
      `${TEMPLATE_PENDING_PREFIX}5120::basis_law`,
      `${TEMPLATE_PENDING_PREFIX}5121::basis_standard`
    ])
    expect(out[0].draft.fieldKey).toBe('basis_law')
    expect(out[0].sectionId).toBe(5120)
  })

  it('🔴 已经敲了字的那一行**原样留着**：存任何一格都会重拉清单，重建就等于清掉他的草稿', () => {
    // 这不是假设出来的场景：存一格之后要重算缺值计数与「需重新成文」标记，
    // 于是 reloadFields 必然再跑一次。按服务端那一份重建的话，
    // 他在**别的**格子上敲了一半的字每次保存都会被清空 ——
    // 界面上一行字忽然没了，而他的第一反应是「这个工具存不住东西」
    const typed = tplRow(5120, 'basis_law', { text: '《资产评估法》第二十条' })
    const out = mergeTemplatePending([typed], [cell({})])
    expect(out).toHaveLength(1)
    expect(out[0].draft.text).toBe('《资产评估法》第二十条')
  })

  it('🔴 手工「新增一格」那一批一个都不动，哪怕它不在清单里', () => {
    // 那一批的字段键可能还是空的，也可能是一个模板压根没声明的键
    // （下拉是 filterable allow-create 的，允许手输），两种都不会出现在清单里。
    // 按「在不在清单里」判会把它们全部删掉 —— 他手加的那一行凭空消失
    const manual = { key: 'pending-3', sectionId: 5120, draft: blankDraft('', 'TEXT') }
    const out = mergeTemplatePending([manual], [cell({})])
    expect(out.map((row) => row.key)).toEqual(['pending-3', `${TEMPLATE_PENDING_PREFIX}5120::basis_law`])
  })

  it('🔴 清单里不再出现的那一批要**删掉**，否则会建出同键第二行，而它静默不渲', () => {
    // 服务端的判据是「这个键在本报告已经有行了就不再出格」，
    // 所以「从清单里消失」恰恰意味着「刚存进去的那一格」。
    // 留着它的话表上有两行同一个键（一行已落库、一行是这条幽灵），
    // 在幽灵上再点一次保存就建出第二行 —— 而后端一个键只渲一行
    // （indexByFieldKey 取 sort 最小的那一行），他填的值一个字都不上纸
    const saved = tplRow(5120, 'basis_law', { text: '已存进去了' })
    const out = mergeTemplatePending([saved], [cell({ sectionId: 5121, fieldKey: 'basis_standard' })])
    expect(out.map((row) => row.key)).toEqual([`${TEMPLATE_PENDING_PREFIX}5121::basis_standard`])
  })

  it('同一个键被两节声明时出两行 —— sectionCodesDeclaring 返回的是**清单**', () => {
    // 实测住宅抵押品类 70 个键里被多节声明的是 0 个，但 S07 与 S07-1…S07-5
    // 那种形状在别的品类里合法。前端替调用方挑一节的话，挑错的表现是
    // 「值照样渲进 Word、复核清单上那一节恒为 0 字」
    const out = mergeTemplatePending([], [cell({}), cell({ sectionId: 5199, sectionCode: 'S99' })])
    expect(out).toHaveLength(2)
    expect(out.map((row) => row.sectionId)).toEqual([5120, 5199])
  })

  it('🔴 fieldKind 回落 TEXT：一个数值类的格子在界面上会是数字框，而它本该是多行文本', () => {
    const out = mergeTemplatePending([], [cell({ fieldKind: '' })])
    expect(out[0].draft.fieldKind).toBe('TEXT')
  })

  it('键为空或节为空的那一格跳过：它落不了库，出一行只是让人点一次报错', () => {
    const out = mergeTemplatePending([], [
      cell({ fieldKey: '' }),
      cell({ sectionId: null as unknown as number })
    ])
    expect(out).toEqual([])
  })

  it('两份入参都为空时给空清单，不抛', () => {
    expect(mergeTemplatePending(undefined, undefined)).toEqual([])
    expect(mergeTemplatePending(null, null)).toEqual([])
  })
})
