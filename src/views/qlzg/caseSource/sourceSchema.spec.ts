import { describe, expect, it } from 'vitest'
import type { QlzgCaseSourceVO } from '@/api/qlzg/caseSource'
import {
  SOURCE_CODE_PATTERN,
  emptySourceForm,
  formatLicenseScope,
  fromVO,
  isWritable,
  normalizeSourceCode,
  parseLicenseScope,
  saveIssues,
  sourceCodeIssue,
  toSaveVO
} from './sourceSchema'
import type { QlzgCaseSourceFormModel } from './sourceSchema'

/**
 * {@code sourceSchema.ts} 的守卫
 *
 * <h3>🔴 这一份钉的是三处「前端与后端各有一份、必须一致」的口径</h3>
 * <ol>
 *   <li><b>来源码的归一化与不可改</b>：码是跨表用裸 varchar 引用的，
 *       前后端归一化口径不一致的表现是「界面上存进去了、导入模板匹配不上」，
 *       报错只会说「数据源不存在」。</li>
 *   <li><b>授权范围的空形状</b>：空文本 / {@code null} / {@code {}} 必须归一成同一个
 *       {@code null}。少认一种，闸 G-10 就会把「没签授权」判成「有授权范围」。</li>
 *   <li><b>接口编号跟着性质走</b>：非第三方接口一律不带编号，
 *       否则「先建成 API 源、再改成公开披露」会在库里留下一个界面上看不见的旧编号。</li>
 * </ol>
 *
 * <h3>⚠️ 刻意【不】钉的东西</h3>
 * <ul>
 *   <li>不钉各列的长度（64 / 128 / 500）：那是后端 {@code @Size} 与输入框 {@code maxlength}
 *       的事，在这里抄一份等于改列宽时要同时改三处。</li>
 *   <li>不钉 {@code updateFrequency} 的取值：这一列后端只存不判、没有枚举也没有消费方，
 *       钉它会造出一个不存在的约束。</li>
 *   <li>不钉错误文案的完整字面：只断言关键片段。整句钉住的结果是改一个标点就红，
 *       下一个人会直接删掉这条断言。</li>
 * </ul>
 */

const validForm = (
  overrides: Partial<QlzgCaseSourceFormModel> = {}
): QlzgCaseSourceFormModel => ({
  ...emptySourceForm(),
  sourceCode: 'ALI_AUCTION',
  sourceName: '阿里拍卖',
  sourceType: 'PUBLIC_DISCLOSURE',
  originUrlPattern: 'https://sf.taobao.com/item_detail.htm?id={id}',
  attributionRequired: '数据来源：阿里拍卖司法拍卖平台',
  ...overrides
})

const fullRow = (): QlzgCaseSourceVO => ({
  id: 77,
  sourceCode: 'DEAL_STATS_API',
  sourceName: 'DealStats',
  sourceType: 'THIRD_PARTY_API',
  sourceTypeDescription: '第三方数据接口',
  apiInterfaceId: 9001,
  originUrlPattern: 'https://dealstats.example.com/record/{id}',
  attributionRequired: 'Source: DealStats, ⟨year⟩ (Portland, OR: BVR, LLC)',
  licenseScope: { sublicense: false, territory: '中国大陆' },
  updateFrequency: 'DAILY',
  status: 1,
  platformPreset: false,
  editable: true,
  createTime: new Date('2026-10-30T10:00:00')
})

describe('normalizeSourceCode', () => {
  it('去首尾空白 + 转大写', () => {
    expect(normalizeSourceCode('  ali_auction  ')).toBe('ALI_AUCTION')
    expect(normalizeSourceCode('ALI_AUCTION')).toBe('ALI_AUCTION')
  })

  it('空值一律归一成空串，不是 undefined', () => {
    expect(normalizeSourceCode(undefined)).toBe('')
    expect(normalizeSourceCode(null)).toBe('')
    expect(normalizeSourceCode('   ')).toBe('')
  })

  it('🔴 与浏览器语言无关：土耳其语下 i 的大写是 İ，而这里必须仍是 I', () => {
    // ⚠️ 对照组：这三条证的是「这个场景真的会出事」，不是装饰。
    //    少了它，下面那条断言在一个永远不会出问题的实现上同样是绿的
    expect('i'.toLocaleUpperCase('tr-TR')).toBe('İ')
    // 🔴 两个 i 都会变，不只是第一个：al**i**_auct**i**on
    expect('ali_auction'.toLocaleUpperCase('tr-TR')).toBe('ALİ_AUCTİON')
    expect(SOURCE_CODE_PATTERN.test('ali_auction'.toLocaleUpperCase('tr-TR'))).toBe(false)
    // 被测的那一支：不管浏览器语言是什么，都得到同一个码
    expect(normalizeSourceCode('ali_auction')).toBe('ALI_AUCTION')
    expect(SOURCE_CODE_PATTERN.test(normalizeSourceCode('ali_auction'))).toBe(true)
  })
})

describe('SOURCE_CODE_PATTERN', () => {
  it('只认大写字母、数字与下划线', () => {
    expect(SOURCE_CODE_PATTERN.test('ALI_AUCTION')).toBe(true)
    expect(SOURCE_CODE_PATTERN.test('GOV2026')).toBe(true)
    expect(SOURCE_CODE_PATTERN.test('_LEADING')).toBe(true)
  })

  it('🔴 全角空格与半角空格都不认——Excel 吃掉半角却留着全角', () => {
    expect(SOURCE_CODE_PATTERN.test('ALI AUCTION')).toBe(false)
    expect(SOURCE_CODE_PATTERN.test('ALI\u3000AUCTION')).toBe(false)
    expect(SOURCE_CODE_PATTERN.test(normalizeSourceCode('ALI\u3000AUCTION'))).toBe(false)
  })

  it('小写、连字符、空串、超长都不认', () => {
    expect(SOURCE_CODE_PATTERN.test('ali_auction')).toBe(false)
    expect(SOURCE_CODE_PATTERN.test('ALI-AUCTION')).toBe(false)
    expect(SOURCE_CODE_PATTERN.test('')).toBe(false)
    expect(SOURCE_CODE_PATTERN.test('A'.repeat(64))).toBe(true)
    expect(SOURCE_CODE_PATTERN.test('A'.repeat(65))).toBe(false)
  })
})

describe('sourceCodeIssue', () => {
  it('新增态：空、非法字面各给一条，合法的给 null', () => {
    expect(sourceCodeIssue('')).toContain('不能为空')
    expect(sourceCodeIssue('   ')).toContain('不能为空')
    expect(sourceCodeIssue('ALI-AUCTION')).toContain('大写字母、数字与下划线')
    expect(sourceCodeIssue('ali_auction')).toBeNull()
  })

  it('🔴 编辑态：与原码不一致就拒，且大小写不算不一致', () => {
    expect(sourceCodeIssue('ALI_AUCTION_V2', 'ALI_AUCTION')).toContain('建了就不能改')
    expect(sourceCodeIssue('ali_auction', 'ALI_AUCTION')).toBeNull()
    expect(sourceCodeIssue('  ALI_AUCTION  ', 'ALI_AUCTION')).toBeNull()
  })

  it('🔴 编辑态不再校验字面：库里的码是既成事实，改不了也不该报错', () => {
    // 一个非法字面的旧码（例如早年用连字符建的）在编辑态不该拦住整张表单，
    // 否则这一行永远改不了名字
    expect(sourceCodeIssue('ALI-AUCTION', 'ALI-AUCTION')).toBeNull()
  })
})

describe('parseLicenseScope', () => {
  it('🔴 三种「空」归一成同一个 null，不是 {}', () => {
    for (const empty of ['', '   ', 'null', '{}', '  {  }  ']) {
      expect(parseLicenseScope(empty)).toEqual({ value: null, issue: null })
    }
  })

  it('对象原样收下，嵌套也收', () => {
    expect(parseLicenseScope('{"sublicense": false}')).toEqual({
      value: { sublicense: false },
      issue: null
    })
    expect(parseLicenseScope('{"a": {"b": [1, 2]}}').value).toEqual({ a: { b: [1, 2] } })
  })

  it('🔴 顶层不是对象的一律拦下：后端那一列是 Map，发数组过去是整个请求失败', () => {
    for (const bad of ['[1,2]', '"禁止转授权"', '123', 'true']) {
      const result = parseLicenseScope(bad)
      expect(result.value).toBeNull()
      expect(result.issue).toContain('必须是一个 JSON 对象')
    }
  })

  it('语法错误给一条能看懂的文案，不是 JSON.parse 的原文', () => {
    for (const bad of ['{', '{sublicense: false}', '{"a":}']) {
      const result = parseLicenseScope(bad)
      expect(result.value).toBeNull()
      expect(result.issue).toContain('不是合法的 JSON')
    }
  })
})

describe('formatLicenseScope', () => {
  it('null 与 {} 都还原成空串', () => {
    expect(formatLicenseScope(null)).toBe('')
    expect(formatLicenseScope(undefined)).toBe('')
    expect(formatLicenseScope({})).toBe('')
  })

  it('🔴 与 parseLicenseScope 互为逆运算', () => {
    const scope = { sublicense: false, territory: '中国大陆' }
    const text = formatLicenseScope(scope)
    expect(text).toContain('\n')
    expect(parseLicenseScope(text).value).toEqual(scope)
  })
})

describe('saveIssues', () => {
  it('一份合法的表单没有任何问题', () => {
    expect(saveIssues(validForm())).toEqual([])
  })

  it('来源码空 / 名称空 / 授权范围坏各给一条', () => {
    expect(saveIssues(validForm({ sourceCode: '' }))).toEqual([expect.stringContaining('不能为空')])
    expect(saveIssues(validForm({ sourceName: '  ' }))).toEqual([
      expect.stringContaining('来源名称不能为空')
    ])
    expect(saveIssues(validForm({ licenseScopeText: '[1]' }))).toHaveLength(1)
  })

  it('🔴 第三方接口必须带接口编号，其余三种不带也可以', () => {
    expect(saveIssues(validForm({ sourceType: 'THIRD_PARTY_API', apiInterfaceId: null }))).toEqual([
      expect.stringContaining('必须选一个数据接口')
    ])
    expect(saveIssues(validForm({ sourceType: 'THIRD_PARTY_API', apiInterfaceId: 9001 }))).toEqual([])
    for (const type of ['PUBLIC_DISCLOSURE', 'MANUAL', 'GOVERNMENT']) {
      expect(saveIssues(validForm({ sourceType: type, apiInterfaceId: null }))).toEqual([])
    }
  })

  it('🔴🔴 每一种会让 toSaveVO 悄悄发 null 的授权范围文本，saveIssues 都必须非空', () => {
    // 这条钉的是一个配对关系，不是单个函数：toSaveVO 在解析失败时发的是 null（= 清空授权条款），
    // 只有「解析失败 ⇒ 提交被拦住」这个蕴含成立，它才不是静默丢数据
    const malformed = ['', '   ', 'null', '{}', '{', '{sublicense: false}', '[1,2]', '"文本"', '123']
    for (const text of malformed) {
      const payload = toSaveVO(validForm({ licenseScopeText: text }))
      if (payload.licenseScope === null) {
        const issues = saveIssues(validForm({ licenseScopeText: text }))
        const isGenuinelyEmpty = ['', '   ', 'null', '{}'].includes(text)
        if (!isGenuinelyEmpty) {
          expect(issues.length, `「${text}」会让授权条款被清空，却没有拦住提交`).toBeGreaterThan(0)
        }
      }
    }
  })
})

describe('toSaveVO', () => {
  it('🔴 性质不是第三方接口时，接口编号一律发 null——哪怕表单里还留着旧值', () => {
    const payload = toSaveVO(
      validForm({ sourceType: 'PUBLIC_DISCLOSURE', apiInterfaceId: 9001 })
    )
    expect(payload.apiInterfaceId).toBeNull()
  })

  it('性质是第三方接口时原样带上', () => {
    expect(
      toSaveVO(validForm({ sourceType: 'THIRD_PARTY_API', apiInterfaceId: 9001 })).apiInterfaceId
    ).toBe(9001)
  })

  it('来源码归一化、各文本列去空白、空串发 undefined 而不是空串', () => {
    const payload = toSaveVO(
      validForm({
        sourceCode: '  ali_auction ',
        originUrlPattern: '   ',
        attributionRequired: '  署名  ',
        updateFrequency: ' DAILY ',
        licenseScopeText: '   '
      })
    )
    expect(payload.sourceCode).toBe('ALI_AUCTION')
    expect(payload.originUrlPattern).toBeUndefined()
    expect(payload.attributionRequired).toBe('署名')
    expect(payload.updateFrequency).toBe('DAILY')
    expect(payload.licenseScope).toBeNull()
  })

  it('不发租户归属：平台预置行不能通过普通修改变成机构私有', () => {
    expect(toSaveVO(validForm())).not.toHaveProperty('tenantId')
  })
})

describe('fromVO', () => {
  it('缺列时给默认值，status 留空按启用', () => {
    const model = fromVO({ id: 1, sourceCode: 'A', sourceName: '甲', sourceType: 'MANUAL' })
    expect(model.status).toBe(1)
    expect(model.licenseScopeText).toBe('')
    expect(model.apiInterfaceId).toBeNull()
    expect(model.originUrlPattern).toBe('')
  })

  it('授权范围还原成带缩进的原文', () => {
    expect(fromVO(fullRow()).licenseScopeText).toContain('"sublicense": false')
  })

  it('🔴🔴 toSaveVO(fromVO(row)) 与原行逐列等价', () => {
    const row = fullRow()
    const payload = toSaveVO(fromVO(row))
    expect(payload.id).toBe(row.id)
    expect(payload.sourceCode).toBe(row.sourceCode)
    expect(payload.sourceName).toBe(row.sourceName)
    expect(payload.sourceType).toBe(row.sourceType)
    expect(payload.apiInterfaceId).toBe(row.apiInterfaceId)
    expect(payload.originUrlPattern).toBe(row.originUrlPattern)
    expect(payload.attributionRequired).toBe(row.attributionRequired)
    expect(payload.licenseScope).toEqual(row.licenseScope)
    expect(payload.updateFrequency).toBe(row.updateFrequency)
    expect(payload.status).toBe(row.status)
    // ⚠️ 只读列一个字都不发：发了就等于让前端能改后端算出来的东西
    const sent = payload as Record<string, any>
    for (const readOnly of ['platformPreset', 'editable', 'sourceTypeDescription', 'tenantId']) {
      expect(sent).not.toHaveProperty(readOnly)
    }
  })

  it('🔴 非第三方接口的行即使库里还挂着旧编号，回写时也会被清掉', () => {
    const row = { ...fullRow(), sourceType: 'GOVERNMENT' as const }
    expect(row.apiInterfaceId).toBe(9001)
    expect(toSaveVO(fromVO(row)).apiInterfaceId).toBeNull()
  })
})

describe('isWritable', () => {
  it('按后端下发的 editable 判，undefined 按可写', () => {
    expect(isWritable({ editable: true })).toBe(true)
    expect(isWritable({ editable: false })).toBe(false)
    // 🔴 后端没下发这个字段时按可写：按不可写处理会让整页按钮全部灰掉，
    //    而灰掉的按钮不报错，用户只会以为「这个页面是只读的」
    expect(isWritable({})).toBe(true)
    expect(isWritable(null)).toBe(true)
    expect(isWritable(undefined)).toBe(true)
  })
})

describe('emptySourceForm', () => {
  it('🔴 键集合与 fromVO 完全一致（漏一列这里就红）', () => {
    expect(Object.keys(fromVO(fullRow())).sort()).toEqual(Object.keys(emptySourceForm()).sort())
  })

  it('默认值：性质给公开披露、状态给启用、其余留空', () => {
    const form = emptySourceForm()
    expect(form.sourceType).toBe('PUBLIC_DISCLOSURE')
    expect(form.status).toBe(1)
    expect(form.apiInterfaceId).toBeNull()
    // 🔴 空表单只有两条阻塞：来源码与名称。性质默认是公开披露，所以接口编号那一条不响
    expect(saveIssues(form)).toEqual([
      expect.stringContaining('来源码不能为空'),
      expect.stringContaining('来源名称不能为空')
    ])
  })
})
