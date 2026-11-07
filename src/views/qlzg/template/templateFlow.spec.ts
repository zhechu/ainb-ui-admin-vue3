import { describe, expect, it } from 'vitest'
import type {
  QlzgTemplateClosureFindingVO,
  QlzgTemplateClosureVO,
  QlzgTemplateSuggestionVO,
  QlzgTemplateVersionVO
} from '@/api/qlzg/template'
import {
  autoMappedRateText,
  baselineOf,
  buildEdits,
  changeNoteRequired,
  closureHeadline,
  closureTagType,
  dirtyCount,
  findingFixHint,
  findingTypeLabel,
  nextVersionNo,
  panelRows,
  pendingConfirmCount,
  rollbackNoteDraft,
  rollbackOptions,
  signLabel,
  splitFindings,
  unmappedNoReasonCount
} from './templateFlow'

/**
 * 模板设计器纯逻辑层的守卫
 *
 * 这一批用例守的是同一类失效：**HTTP 200、类型检查绿、界面显示「已保存」，
 * 而库里什么都没变**。它们全部集中在 `/save-mapping` 的 `edits` 上 ——
 * 后端 {@code applyEdits} 的三条分支是按「哪个键非空」分派的，
 * 多带一个键就会静默走进另一条分支，而它不报错。
 *
 * 🔴 下面每一条都写成「先发一个**错的** payload，断言它不是我们发的那个」的形状，
 *    而不是只断言正确的输出：只断言正确输出的话，
 *    把 {@link buildEdits} 改成「整张面板都发上去」依然能让一部分用例通过。
 */

const row = (over: Partial<QlzgTemplateSuggestionVO>): QlzgTemplateSuggestionVO => ({
  placeholder: '{{address}}',
  ...over
})

const finding = (over: Partial<QlzgTemplateClosureFindingVO>): QlzgTemplateClosureFindingVO => ({
  type: 'UNKNOWN_FIELD',
  ...over
})

const version = (over: Partial<QlzgTemplateVersionVO>): QlzgTemplateVersionVO => ({ ...over })

describe('baselineOf：基线是「占位符原文 → 那一行当年的样子」', () => {
  it('键是 placeholder 原文（含花括号与语法符号），不是剥掉符号的 name', () => {
    const baseline = baselineOf([row({ placeholder: '{{?sections}}', name: 'sections' })])
    expect(Object.keys(baseline)).toEqual(['{{?sections}}'])
    // 🔴 传 name 上去后端认不出来：同一个 name 在标量位与区块位是两条不同的映射
    expect(baseline['sections']).toBeUndefined()
  })

  it('trim 之后为空的键一律落成 null —— 空串与 null 在后端是同一个意思', () => {
    const baseline = baselineOf([row({ fieldKey: '   ', unmappedReason: '' })])
    expect(baseline['{{address}}']).toEqual({
      fieldKey: null,
      unmappedReason: null,
      confirmed: false
    })
  })

  it('confirmed 只有严格 true 才算 true：null / undefined 都是「没确认过」', () => {
    expect(baselineOf([row({ confirmed: null })])['{{address}}'].confirmed).toBe(false)
    expect(baselineOf([row({ confirmed: true })])['{{address}}'].confirmed).toBe(true)
  })

  it('placeholder 为空的行不进基线（它压根不是可编辑的一行）', () => {
    expect(baselineOf([row({ placeholder: '' }), row({ placeholder: null as any })])).toEqual({})
  })

  it('入参为 null / undefined 时给空对象，不给 undefined', () => {
    expect(baselineOf(null)).toEqual({})
    expect(baselineOf(undefined)).toEqual({})
  })
})

describe('panelRows：区块收尾不画到面板上', () => {
  it("sign === '/' 的行被过滤掉", () => {
    const rows = [
      row({ placeholder: '{{?sections}}', sign: '?' }),
      row({ placeholder: '{{/sections}}', sign: '/' }),
      row({ placeholder: '{{#case_table}}', sign: '#' })
    ]
    expect(panelRows(rows).map((r) => r.placeholder)).toEqual(['{{?sections}}', '{{#case_table}}'])
  })

  it("🔴 为什么要过滤：后端 applyEdits 建 signBySource 时同样跳过它，发上去得到的是「一条都对不上」", () => {
    // 这一条把「过滤」与「发上去会怎样」钉在一起：
    // 如果哪天有人把过滤去掉，下面这个断言会立刻指出它会产生一条非法编辑
    const closer = row({ placeholder: '{{/sections}}', sign: '/' })
    const baseline = baselineOf([closer])
    const edits = buildEdits([closer], baseline)
    expect(panelRows([closer])).toHaveLength(0)
    // 基线里有它（baselineOf 不看 sign），所以只有 panelRows 这一层拦得住
    expect(baseline['{{/sections}}']).toBeDefined()
    expect(edits).toHaveLength(0)
  })
})

describe('buildEdits：三条分支，多带一个键就静默走进另一条', () => {
  it('一行都没动过 ⟹ 一条编辑都不发', () => {
    const rows = [row({ fieldKey: 'address', confirmed: true })]
    expect(buildEdits(rows, baselineOf(rows))).toEqual([])
  })

  it('① 绑定：发 fieldKey，且**不发 confirmed**', () => {
    const before = row({ fieldKey: null, confirmed: false })
    const after = row({ fieldKey: 'address', confirmed: false })
    const edits = buildEdits([after], baselineOf([before]))
    expect(edits).toEqual([{ placeholder: '{{address}}', fieldKey: 'address' }])
    // 🔴 ① 已经强制把 confirmed 置 true；再带一个 false 上去是自相矛盾的组合
    expect('confirmed' in edits[0]).toBe(false)
  })

  it('② 只改确认标记：发 confirmed，且**不发 fieldKey**', () => {
    const before = row({ fieldKey: 'address', confirmed: false })
    const after = row({ fieldKey: 'address', confirmed: true })
    const edits = buildEdits([after], baselineOf([before]))
    expect(edits).toEqual([{ placeholder: '{{address}}', confirmed: true }])
    // 🔴 带上 fieldKey 就命中 ①，boundBy 被改写成 MANUAL ——
    //    一次「我认可平台猜的这个绑定」在库里变成「这个绑定是人工指定的」，
    //    §11.17.3 第 ① 条的自动映射率从此对不上账
    expect('fieldKey' in edits[0]).toBe(false)
  })

  it('② 撤销确认同样只发 confirmed', () => {
    const before = row({ fieldKey: 'address', confirmed: true })
    const after = row({ fieldKey: 'address', confirmed: false })
    expect(buildEdits([after], baselineOf([before]))).toEqual([
      { placeholder: '{{address}}', confirmed: false }
    ])
  })

  it('③ 解绑：fieldKey 发 null，且**绝不带 confirmed**', () => {
    const before = row({ fieldKey: 'address', confirmed: true })
    // 界面上解绑那一行的 confirmed 也跟着变回 false —— 这正是陷阱所在
    const after = row({ fieldKey: null, confirmed: false })
    const edits = buildEdits([after], baselineOf([before]))
    expect(edits).toEqual([{ placeholder: '{{address}}', fieldKey: null }])
    // 🔴 带了 confirmed 就命中 ②（「fieldKey 空 且 confirmed 非 null 且本来就绑着」），
    //    字段键还在原处，界面显示「已保存」，而 UNMAPPED_NO_REASON 永远不会出现
    expect('confirmed' in edits[0]).toBe(false)
  })

  it('③ 解绑并写了原因：一起发 unmappedReason', () => {
    const before = row({ fieldKey: 'address', confirmed: true, unmappedReason: null })
    const after = row({ fieldKey: null, confirmed: false, unmappedReason: '本项委托方未提供' })
    expect(buildEdits([after], baselineOf([before]))).toEqual([
      {
        placeholder: '{{address}}',
        fieldKey: null,
        unmappedReason: '本项委托方未提供'
      }
    ])
  })

  it('③ 解绑但没写原因：**不发** unmappedReason（发一个 null 上去等于没写）', () => {
    const before = row({ fieldKey: 'address', confirmed: true })
    const after = row({ fieldKey: null, confirmed: false, unmappedReason: '   ' })
    const edits = buildEdits([after], baselineOf([before]))
    expect('unmappedReason' in edits[0]).toBe(false)
  })

  it('只改「未映射原因」这一栏：发 unmappedReason，不发 fieldKey 也不发 confirmed', () => {
    const before = row({ fieldKey: null, confirmed: false, unmappedReason: null })
    const after = row({ fieldKey: null, confirmed: false, unmappedReason: '模板留白，本项不适用' })
    const edits = buildEdits([after], baselineOf([before]))
    expect(edits).toEqual([
      { placeholder: '{{address}}', unmappedReason: '模板留白，本项不适用' }
    ])
  })

  it('🔴 已绑定的行上改 unmappedReason 不算改动 —— 后端一律把那一列清成 null', () => {
    const before = row({ fieldKey: 'address', confirmed: true, unmappedReason: null })
    const after = row({ fieldKey: 'address', confirmed: true, unmappedReason: '随手写的一句' })
    expect(buildEdits([after], baselineOf([before]))).toEqual([])
  })

  it('换绑到另一个键：只发 fieldKey（不带 confirmed、不带 unmappedReason）', () => {
    const before = row({ fieldKey: 'address', confirmed: true })
    const after = row({ fieldKey: 'building_area', confirmed: true })
    expect(buildEdits([after], baselineOf([before]))).toEqual([
      { placeholder: '{{address}}', fieldKey: 'building_area' }
    ])
  })

  it('🔴 不在基线里的行**不发**：发出去会让整次保存报 TEMPLATE_MAPPING_EDIT_UNKNOWN', () => {
    const known = row({ placeholder: '{{address}}', fieldKey: null })
    const stranger = row({ placeholder: '{{from_another_parse}}', fieldKey: 'address' })
    const edits = buildEdits([known, stranger], baselineOf([known]))
    expect(edits.map((e) => e.placeholder)).toEqual([])
    // 陌生行被改掉也不发（keyChanged 为真，但基线里没有它）
    expect(edits).toHaveLength(0)
  })

  it('一批里动过的与没动过的混在一起：只发动过的那几个', () => {
    const a = row({ placeholder: '{{a}}', fieldKey: null })
    const b = row({ placeholder: '{{b}}', fieldKey: 'b_key', confirmed: true })
    const c = row({ placeholder: '{{c}}', fieldKey: null })
    const baseline = baselineOf([a, b, c])
    const edits = buildEdits(
      [
        row({ placeholder: '{{a}}', fieldKey: 'a_key' }),
        row({ placeholder: '{{b}}', fieldKey: 'b_key', confirmed: true }),
        row({ placeholder: '{{c}}', fieldKey: null, unmappedReason: '留白' })
      ],
      baseline
    )
    expect(edits).toEqual([
      { placeholder: '{{a}}', fieldKey: 'a_key' },
      // 🔴 c 那一行走的是「只改未映射原因」分支，所以**不带 fieldKey** ——
      //    它本来就是空的，带上一个 null 会让后端多走一次无条件 set
      { placeholder: '{{c}}', unmappedReason: '留白' }
    ])
  })

  it('入参为 null / undefined ⟹ 空数组（不是抛异常）', () => {
    expect(buildEdits(null, {})).toEqual([])
    expect(buildEdits(undefined, baselineOf([row({})]))).toEqual([])
  })
})

describe('dirtyCount：它就是「还有几行没保存」', () => {
  it('与 buildEdits 同源，不另算一套判据', () => {
    const before = row({ fieldKey: null })
    const baseline = baselineOf([before])
    expect(dirtyCount([before], baseline)).toBe(0)
    expect(dirtyCount([row({ fieldKey: 'address' })], baseline)).toBe(1)
  })
})

describe('splitFindings：按 blocking 分流，**不按 type 猜**', () => {
  it('blocking === true 进 blockers，其余（false / null / undefined）进 notes', () => {
    const closure: QlzgTemplateClosureVO = {
      status: 'FAILED',
      findings: [
        finding({ type: 'UNKNOWN_FIELD', blocking: true }),
        finding({ type: 'SEAL_RESERVED', blocking: false }),
        finding({ type: 'UNMAPPED_WITH_REASON', blocking: null }),
        finding({ type: 'RENDER_RESIDUAL' })
      ]
    }
    const { blockers, notes } = splitFindings(closure)
    expect(blockers.map((f) => f.type)).toEqual(['UNKNOWN_FIELD'])
    expect(notes.map((f) => f.type)).toEqual([
      'SEAL_RESERVED',
      'UNMAPPED_WITH_REASON',
      'RENDER_RESIDUAL'
    ])
  })

  it('🔴 同一个 type 可以既是阻断项又是不阻断项 —— 这正是不能按 type 分流的原因', () => {
    // MISSING_REQUIRED_FIELD 在后端按交付物类型分派过：技术报告要 16 个必填字段全有位置，
    // 结果报告只要 6 个。前端复刻不了那份分派，一复刻就漂
    const closure: QlzgTemplateClosureVO = {
      status: 'FAILED',
      findings: [
        finding({ type: 'MISSING_REQUIRED_FIELD', blocking: true, fieldKey: 'built_year' }),
        finding({ type: 'MISSING_REQUIRED_FIELD', blocking: false, fieldKey: 'usage' })
      ]
    }
    const { blockers, notes } = splitFindings(closure)
    expect(blockers).toHaveLength(1)
    expect(notes).toHaveLength(1)
    expect(blockers[0].fieldKey).toBe('built_year')
  })

  it('closure 为 null / findings 缺失 ⟹ 两个空数组', () => {
    expect(splitFindings(null)).toEqual({ blockers: [], notes: [] })
    expect(splitFindings({ status: 'PENDING' })).toEqual({ blockers: [], notes: [] })
  })
})

describe('findingTypeLabel：后端给的优先、前端那份兜底', () => {
  it('typeDescription 非空时用它', () => {
    expect(findingTypeLabel(finding({ typeDescription: '后端新写的说法' }))).toBe('后端新写的说法')
  })

  it('🔴 typeDescription 缺失时回落前端表 —— placeholderClosureDetail 那个 json 列只有五个键，压根没有它', () => {
    expect(findingTypeLabel(finding({ type: 'UNKNOWN_FIELD' }))).toBe(
      '映射到了品类字段清单之外的键'
    )
    expect(findingTypeLabel(finding({ type: 'SEAL_RESERVED' }))).toBe(
      '签章位已预留，签章功能在 I30'
    )
    // 🔴 这一条钉的是「前端那份中文是逐条抄后端枚举 description」：
    //    漏抄的表现不是报错，是这一类在界面上显示成裸码 MISSING_RULE_DEMANDED_SECTION
    expect(findingTypeLabel(finding({ type: 'MISSING_RULE_DEMANDED_SECTION' }))).toBe(
      '启用中的拦截规则要读的章节，在模板里没有位置'
    )
  })

  it('表里也没有的 type：显示原码，不显示破折号', () => {
    // 后端加一类而前端忘了补时，裸码至少是可搜的；显示成「—」就把唯一的线索抹掉了
    expect(findingTypeLabel(finding({ type: 'SOMETHING_NEW' }))).toBe('SOMETHING_NEW')
  })

  it('finding 为 null ⟹ 破折号', () => {
    expect(findingTypeLabel(null)).toBe('—')
    expect(findingTypeLabel(undefined)).toBe('—')
  })
})

describe('findingFixHint：按 type 分派到三个不同的处置面', () => {
  it('映射面板能改的那四类，措辞里都指向「下面映射面板」', () => {
    for (const type of [
      'UNKNOWN_FIELD',
      'UNMAPPED_NO_REASON',
      'SIMILAR_NOT_CONFIRMED'
    ]) {
      expect(findingFixHint(finding({ type }))).toContain('映射面板')
    }
  })

  it('要在 Word 原件里改的那三类，措辞里都要求「重新上传解析」', () => {
    for (const type of ['INVISIBLE_PLACEHOLDER', 'WRONG_SIGN', 'MISSING_REQUIRED_FIELD']) {
      const hint = findingFixHint(finding({ type }))
      expect(hint).toContain('下载 docx')
      expect(hint).toContain('重新上传解析')
    }
  })

  it('🔴 规则要读的章节缺位置：出路是「重新上传发布一版」，不是「重新上传解析」', () => {
    // 与上一条的 MISSING_REQUIRED_FIELD 只差一个词，而那个词是全部差别：
    // 必填字段缺位置，重新解析一次、在映射面板上绑一下就好了；
    // 而章节树是发布那一刻冻结的快照、版本行不可改，只重新解析的话评估师改完还是红的 ——
    // 按本文件那句判据，第三遍开始他就认定这个功能坏了
    const hint = findingFixHint(finding({ type: 'MISSING_RULE_DEMANDED_SECTION' }))
    expect(hint).toContain('下载 docx')
    expect(hint).toContain('重新上传发布一版')
    expect(hint).not.toContain('重新上传解析')
    expect(hint).toContain('映射面板上补不出来')
    expect(hint).toContain('章节树是发布那一刻冻结的快照')
  })

  it('🔴 平台**不代改** docx 这一句必须写出来', () => {
    expect(findingFixHint(finding({ type: 'INVISIBLE_PLACEHOLDER' }))).toContain('平台不代改文件')
  })

  it('前端改不了、要找实施人员的两类各自指到对的地方', () => {
    expect(findingFixHint(finding({ type: 'SECTION_SORT_VIOLATION' }))).toContain('实施人员')
    expect(findingFixHint(finding({ type: 'UNKNOWN_FIELD' }))).toContain('实施人员')
  })

  it('「无需处置」的两类必须明说，否则评估师会去改一个本来没问题的东西', () => {
    expect(findingFixHint(finding({ type: 'UNMAPPED_WITH_REASON' }))).toContain('无需处置')
    expect(findingFixHint(finding({ type: 'SEAL_RESERVED' }))).toContain('无需处置')
  })

  it('SIMILAR_NOT_CONFIRMED 要点明「确认不会把它改写成人工绑定」', () => {
    // 不点明的话评估师会以为点确认等于宣称这是自己绑的，于是不敢点
    expect(findingFixHint(finding({ type: 'SIMILAR_NOT_CONFIRMED' }))).toContain(
      '不会把它改写成人工绑定'
    )
  })

  it('渲染那两类指向「预览」', () => {
    expect(findingFixHint(finding({ type: 'RENDER_FAILED' }))).toContain('预览')
    expect(findingFixHint(finding({ type: 'RENDER_RESIDUAL' }))).toContain('预览')
  })

  it('RENDER_RESIDUAL 要说清「按出现次数计」', () => {
    expect(findingFixHint(finding({ type: 'RENDER_RESIDUAL' }))).toContain('按出现次数计')
  })

  it('表里没有的 type：回落 message，再回落一句通用话', () => {
    expect(findingFixHint(finding({ type: 'SOMETHING_NEW', message: '后端给的整句' }))).toBe(
      '后端给的整句'
    )
    expect(findingFixHint(finding({ type: 'SOMETHING_NEW' }))).toBe('按后端给的这句话处置')
    expect(findingFixHint(null)).toBe('按后端给的这句话处置')
  })
})

describe('closureHeadline / closureTagType：三态，PENDING 不是 FAILED', () => {
  it('PENDING 说「还没有结论」，并给出怎么才能得出结论', () => {
    const text = closureHeadline({ status: 'PENDING' })
    expect(text).toContain('还没有结论')
    expect(text).not.toContain('未通过')
    expect(closureTagType({ status: 'PENDING' })).toBe('info')
  })

  it('🔴 一个刚建出来、还没上传过 docx 的模板本来就是 PENDING，给它红标签等于告诉评估师「你建错了」', () => {
    expect(closureTagType({ status: 'PENDING' })).not.toBe('danger')
    expect(closureTagType(null)).toBe('info')
    expect(closureTagType(undefined)).toBe('info')
  })

  it('closure 为 null / status 为空 ⟹ 与 PENDING 同一句话', () => {
    const pending = closureHeadline({ status: 'PENDING' })
    expect(closureHeadline(null)).toBe(pending)
    expect(closureHeadline({ status: '' })).toBe(pending)
  })

  it('PASSED 且没有不阻断项：一句干净的「可以发布」', () => {
    expect(closureHeadline({ status: 'PASSED', passed: true, findings: [] })).toBe(
      '闸 B 通过，可以发布'
    )
    expect(closureTagType({ status: 'PASSED' })).toBe('success')
  })

  it('PASSED 但有非阻断项：要说出来，并说清它们会一起冻结进档案', () => {
    const text = closureHeadline({
      status: 'PASSED',
      passed: true,
      findings: [finding({ type: 'SEAL_RESERVED', blocking: false })]
    })
    expect(text).toContain('另有 1 条不阻断的发现')
    expect(text).toContain('冻结进版本档案')
  })

  it('FAILED：报后端给的 blockingCount，**不自己数 findings**', () => {
    // 🔴 两份数字不一致时以后端为准：前端数出来的是「这次返回的清单里有几条 blocking」，
    //    而后端那个数是当年判定时落定的
    const text = closureHeadline({
      status: 'FAILED',
      passed: false,
      blockingCount: 3,
      findings: [finding({ blocking: true })]
    })
    expect(text).toContain('有 3 处阻断项')
    expect(text).toContain('每条都写了去哪里改')
    expect(closureTagType({ status: 'FAILED' })).toBe('danger')
  })

  it('blockingCount 缺失时才回落自己数', () => {
    const text = closureHeadline({
      status: 'FAILED',
      findings: [finding({ blocking: true }), finding({ blocking: true })]
    })
    expect(text).toContain('有 2 处阻断项')
  })
})

describe('signLabel / autoMappedRateText：只翻译，不运算', () => {
  it('五个语法符号各有一句人话，空串是标量', () => {
    expect(signLabel('')).toBe('标量')
    expect(signLabel(null)).toBe('标量')
    expect(signLabel('?')).toBe('区块（开始）')
    expect(signLabel('#')).toBe('表格')
    expect(signLabel('@')).toBe('图片')
    expect(signLabel('/')).toBe('区块（收尾）')
  })

  it('表里没有的符号原样显示（它是一个事实，不该被抹掉）', () => {
    expect(signLabel('$')).toBe('$')
  })

  it('自动映射率原样拼一个百分号，不除、不四舍五入、不 toFixed', () => {
    expect(autoMappedRateText(87)).toBe('87%')
    expect(autoMappedRateText(0)).toBe('0%')
    expect(autoMappedRateText(100)).toBe('100%')
    expect(autoMappedRateText(null)).toBe('—')
    expect(autoMappedRateText(undefined)).toBe('—')
  })
})

describe('pendingConfirmCount / unmappedNoReasonCount', () => {
  it('待确认 = needsConfirmation 为真且 confirmed 不为真', () => {
    expect(
      pendingConfirmCount([
        row({ needsConfirmation: true, confirmed: false }),
        row({ needsConfirmation: true, confirmed: true }),
        row({ needsConfirmation: false, confirmed: false }),
        row({ needsConfirmation: null, confirmed: null })
      ])
    ).toBe(1)
  })

  it('🔴 未映射且没写原因的计数**不含**区块收尾行', () => {
    expect(
      unmappedNoReasonCount([
        row({ placeholder: '{{/sections}}', sign: '/', fieldKey: null }),
        row({ placeholder: '{{a}}', fieldKey: null, unmappedReason: null }),
        row({ placeholder: '{{b}}', fieldKey: null, unmappedReason: '  ' }),
        row({ placeholder: '{{c}}', fieldKey: null, unmappedReason: '本项不适用' }),
        row({ placeholder: '{{d}}', fieldKey: 'd_key' })
      ])
    ).toBe(2)
  })

  it('入参为空 ⟹ 0', () => {
    expect(pendingConfirmCount(null)).toBe(0)
    expect(unmappedNoReasonCount(undefined)).toBe(0)
  })
})

describe('changeNoteRequired：判据是版本行数，不是 versionNo 文本', () => {
  it('一个版本行都没有 ⟹ 第 1 版，留空', () => {
    expect(changeNoteRequired([])).toBe(false)
    expect(changeNoteRequired(null)).toBe(false)
    expect(changeNoteRequired(undefined)).toBe(false)
  })

  it('已经有版本行 ⟹ 必填', () => {
    expect(changeNoteRequired([version({ versionNo: 1 })])).toBe(true)
    expect(changeNoteRequired([version({ versionNo: 1 }), version({ versionNo: 2 })])).toBe(true)
  })

  it('🔴 版本行上的 versionNo 是 int 且可空，与模板行上那个「给人看的版本号文本」不是一回事', () => {
    // 用文本版本号判的话：一个从没发布过但文本写着「V2.0」的模板会被要求填说明，
    // 而一个发布过三次、文本版本号还空着的模板反而不被要求
    expect(changeNoteRequired([version({ versionNo: null })])).toBe(true)
  })
})

describe('nextVersionNo：单调递增，回滚也走递增', () => {
  it('取最大版本号 + 1，不看清单顺序', () => {
    expect(nextVersionNo([])).toBe(1)
    expect(nextVersionNo(null)).toBe(1)
    expect(nextVersionNo([version({ versionNo: 1 })])).toBe(2)
    expect(
      nextVersionNo([version({ versionNo: 2 }), version({ versionNo: 5 }), version({ versionNo: 3 })])
    ).toBe(6)
  })

  it('versionNo 缺失的行按 0 计，不产生 NaN', () => {
    expect(nextVersionNo([version({}), version({ versionNo: 4 })])).toBe(5)
  })
})

describe('rollbackOptions：排除当前版，按版本号降序', () => {
  const versions = [
    version({ versionNo: 1, changeNote: '初始版本' }),
    version({ versionNo: 2, isCurrent: true, changeNote: '改了封面' }),
    version({ versionNo: 3, changeNote: null }),
    version({ versionNo: null, changeNote: '脏数据' })
  ]

  it('🔴 当前版不在候选里：把当前版「回滚」到自己会造出一个内容相同、版本号却递增的新行', () => {
    expect(rollbackOptions(versions).map((o) => o.value)).toEqual([3, 1])
    expect(rollbackOptions(versions).some((o) => o.value === 2)).toBe(false)
  })

  it('降序：评估师要退回的几乎总是最近的那一版', () => {
    const opts = rollbackOptions([
      version({ versionNo: 1 }),
      version({ versionNo: 4 }),
      version({ versionNo: 2 })
    ])
    expect(opts.map((o) => o.value)).toEqual([4, 2, 1])
  })

  it('versionNo 为空的行不进候选（它压根不能当回滚目标）', () => {
    expect(rollbackOptions([version({ versionNo: null })])).toEqual([])
  })

  it('label 带上 changeNote，没有说明就只写第几版', () => {
    const opts = rollbackOptions(versions)
    expect(opts[0].label).toBe('第 3 版')
    expect(opts[1].label).toBe('第 1 版（初始版本）')
  })

  it('入参为空 ⟹ 空数组', () => {
    expect(rollbackOptions(null)).toEqual([])
    expect(rollbackOptions(undefined)).toEqual([])
  })

  it('🔴 不改动传入的数组（sort 是原地的，漏了 slice 就会把台账的顺序也改掉）', () => {
    const input = [version({ versionNo: 1 }), version({ versionNo: 3 }), version({ versionNo: 2 })]
    rollbackOptions(input)
    expect(input.map((v) => v.versionNo)).toEqual([1, 3, 2])
  })
})

describe('rollbackNoteDraft：预填而不留空', () => {
  it('带上目标版本号 —— 回滚的 changeNote 是必填的审计条目', () => {
    expect(rollbackNoteDraft(3)).toBe('回滚自第 3 版')
  })

  it('还没选目标时给空串，不给「回滚自第 null 版」', () => {
    expect(rollbackNoteDraft(null)).toBe('')
    expect(rollbackNoteDraft(undefined)).toBe('')
  })

  it('🔴 第 0 版是一个合法的目标编号吗？不是 —— 但 0 不该被当成「没选」', () => {
    // == null 才叫没选；写成 !targetVersionNo 的话 0 会被当成没选，
    // 而 versionNo 是 int 单调递增，0 只会来自脏数据，那时也该如实印出来
    expect(rollbackNoteDraft(0)).toBe('回滚自第 0 版')
  })
})
