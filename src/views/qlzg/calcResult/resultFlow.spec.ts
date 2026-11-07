import { describe, expect, it } from 'vitest'
import type { QlzgCalculationVO } from '@/api/qlzg/calculation'
import { COMBINE_TYPE_OPTIONS, combineTypeNeedsFinalValue } from '@/views/qlzg/constants'
import {
  COMBINE_TYPE_HINTS,
  buildDetermineVO,
  calcSheetFilenameBase,
  combineTypeNeedsWeights,
  determineErrors,
  draftsOfParticipants,
  loadWeightDrafts,
  participantName,
  reasonCharCount,
  weightErrors,
  weightSum,
  weightSumIsOne,
  weightSumText,
  type DetermineDraft,
  type WeightDraft
} from './resultFlow'

/**
 * 结果确定的全部判定
 *
 * <h3>🔴 这一份 spec 里最要紧的一条是「权重之和」那组</h3>
 * 后端判的是 `BigDecimal.compareTo(BigDecimal.ONE) == 0`（十进制精确相等），
 * 而 JS 的 number 是 IEEE-754 双精度。实测 `0.06 + 0.57 + 0.37` 得到
 * `0.9999999999999999`，一个完全合法的 6:57:37 分配会被 `=== 1` 判成不合法 ——
 * 而且是**没法修**的那种：评估师无论怎么调都让不了它变绿。
 * 三项百分比组合的全排列里有 204 组是这样，四位小数的三元组合里有 267 万组。
 *
 * <p>所以下面既测「洗掉噪声之后等于 1」，也**同时测「不洗就不等于 1」** ——
 * 少了后半句，这组用例会因为「本来就没问题」而恒绿，等于没测。
 *
 * <h3>🔴 另一条要紧的是「界面文本不得抄规则参数」</h3>
 * R08 的字数下限、R09 的离散度阈值、`determination_reason` 的列宽、金额上限、
 * 以及 R08 的禁语表，**后端各有一份**，且 I5 起会变成机构可调的。
 * 前端抄一份不会立刻出错，它会在「机构把门槛改了」那天开始说谎。
 * 本页的做法是不预校验、把后端原文显示出来，`noRuleParameterIsCopied` 钉住这件事。
 */

// ==================== 夹具 ====================

const calc = (
  id: number,
  methodCode: string,
  status = 'SUCCESS',
  resultValue: number | null = 1000000
): QlzgCalculationVO => ({
  id,
  subjectId: 7,
  methodCode,
  methodName: undefined,
  status,
  resultValue,
  createTime: new Date('2026-11-01T10:00:00')
})

const METHOD_NAMES: Record<string, string> = {
  MARKET_COMPARISON: '市场比较法',
  INCOME_APPROACH: '收益法',
  COST: '成本法',
  HYPOTHETICAL_DEVELOPMENT: '假设开发法'
}

const twoParticipants = () => [calc(11, 'MARKET_COMPARISON'), calc(12, 'INCOME_APPROACH')]
const threeParticipants = () => [...twoParticipants(), calc(13, 'COST')]

/** 建一份「理由都写了、权重按给的值填」的草稿 */
const drafts = (
  participants: QlzgCalculationVO[],
  weights: (number | null)[],
  reason = '本标的的成交案例更贴近市场，故给这一档更高的权重'
): WeightDraft[] => participants.map((row, i) => ({ calculationId: row.id, weight: weights[i], reason }))

const baseDraft = (over: Partial<DetermineDraft> = {}): DetermineDraft => {
  const participants = over.participants ?? twoParticipants()
  return {
    subjectId: 7,
    participants,
    combineType: 'ARITHMETIC_MEAN',
    weights: loadWeightDrafts(participants),
    finalValue: null,
    valueType: '',
    determinationReason: '两种方法的假设都成立，取算术平均以抹平单一方法的偶发偏差。',
    ...over
  }
}

const sumOf = (weights: (number | null)[]): number =>
  weightSum(weights.map((weight, i) => ({ calculationId: i + 1, weight, reason: '理由' })))

/**
 * 🔴 这一份是**测试私有**的，刻意不用 `constants.ts` 导出的 `combineTypeNeedsFinalValue`
 *
 * 有条用例要断言「非手填档不要求最终值」，而那份断言如果直接用被测代码依赖的同一个函数，
 * 就成了同义反复：函数错了，用例跟着错，两边一起绿。
 * 这里按 V5 §11.4.3 的五档表**另写一份**，于是它与 `constants.ts` 那一份互为对照
 * （文件末尾那条用例就是这份对照）。
 */
const combineTypeNeedsFinalValueLocal = (combineType: string): boolean =>
  combineType === 'RANGE' || combineType === 'PROFESSIONAL_JUDGMENT'

// ==================== 权重之和 ====================

describe('🔴 权重之和：二进制噪声不能把一份合法的分配判成不合法', () => {
  it('常规的两项、三项、四项分配都等于 1', () => {
    expect(sumOf([0.6, 0.4])).toBe(1)
    expect(sumOf([0.3334, 0.3333, 0.3333])).toBe(1)
    expect(sumOf([0.5, 0.25, 0.125, 0.125])).toBe(1)
    expect(sumOf([0.06, 0.57, 0.37])).toBe(1)
    expect(weightSumIsOne(drafts(twoParticipants(), [0.6, 0.4]))).toBe(true)
  })

  it('🔴 非空过：不洗噪声时这些组合确实不等于 1，否则上面那组是恒绿的', () => {
    const raw = (weights: number[]) => weights.reduce((a, b) => a + b, 0)
    // 这一句是整组用例的**负控**：它证明「洗噪声」这一步真的在做事
    expect(raw([0.06, 0.57, 0.37])).not.toBe(1)
    expect(raw([0.06, 0.57, 0.37])).toBe(0.9999999999999999)
    expect(weightSum(drafts(threeParticipants(), [0.06, 0.57, 0.37]))).toBe(1)
  })

  it('🔴 三项百分比的全排列（1%–98%）一份都不能被误判', () => {
    let checked = 0
    let wouldFailWithoutScrub = 0
    const bad: string[] = []
    for (let a = 1; a <= 98; a++) {
      for (let b = 1; b <= 98 - a; b++) {
        const c = 100 - a - b
        if (c < 1) continue
        const weights = [a / 100, b / 100, c / 100]
        checked++
        if (weights.reduce((x, y) => x + y, 0) !== 1) wouldFailWithoutScrub++
        if (!weightSumIsOne(drafts(threeParticipants(), weights))) {
          bad.push(weights.join(' + '))
        }
      }
    }
    // 非空过：真的扫了东西，而且不洗噪声时真的有一批会失败
    expect(checked).toBeGreaterThan(4000)
    expect(wouldFailWithoutScrub).toBeGreaterThan(0)
    expect(bad, `这些合法的分配被判成「之和不等于 1」：${bad.slice(0, 5).join('；')}`).toHaveLength(0)
  })

  it('🔴 四位小数的三元组合抽样也不能被误判（0.3334 那一档）', () => {
    const bad: string[] = []
    for (let a = 1; a <= 9998; a += 37) {
      for (let b = 1; b <= 9998 - a; b += 41) {
        const c = 10000 - a - b
        if (c < 1) continue
        const weights = [a / 10000, b / 10000, c / 10000]
        if (!weightSumIsOne(drafts(threeParticipants(), weights))) bad.push(weights.join(' + '))
      }
    }
    expect(bad, `四位小数下被误判的分配：${bad.slice(0, 5).join('；')}`).toHaveLength(0)
  })

  it('不等于 1 的必须照样报出来（洗噪声不能把真错误也洗掉）', () => {
    expect(sumOf([0.5, 0.5, 0.5])).toBe(1.5)
    expect(sumOf([0.3, 0.3])).toBe(0.6)
    expect(sumOf([0.3333, 0.3333, 0.3333])).toBe(0.9999)
    expect(weightSumIsOne(drafts(twoParticipants(), [0.3333, 0.3333]))).toBe(false)
  })

  it('🔴 没填的项跳过，不当 0 —— 否则「填了一半」会显示成「和 = 1」', () => {
    expect(sumOf([0.5, 0.5, null])).toBe(1)
    expect(sumOf([1, null])).toBe(1)
    expect(sumOf([null, null])).toBe(0)
    expect(sumOf([])).toBe(0)
    // 这一条说明「跳过」是有代价的：只填一半时和可能已经是 1，
    // 所以「还没填」必须由 weightErrors 单独报，不能指望和这一栏拦住
    expect(weightSumText(drafts(threeParticipants(), [0.5, 0.5, null]))).toContain('还有 1 项没填')
  })
})

describe('weightSumText：三种处境要说得不同', () => {
  it('和为 1 → 一句可以提交', () => {
    expect(weightSumText(drafts(twoParticipants(), [0.6, 0.4]))).toContain('可以提交')
  })

  it('还没填完 → 说还剩几项，不说「差多少」', () => {
    const text = weightSumText(drafts(threeParticipants(), [0.4, null, null]))
    expect(text).toContain('还有 2 项没填')
    expect(text).toContain('0.4')
  })

  it('填完了但和不对 → 说差多少，且不得是科学计数法', () => {
    const text = weightSumText(drafts(threeParticipants(), [0.5, 0.5, 0.5]))
    expect(text).toContain('1.5')
    expect(text).toContain('正好是 1')
    // 🔴 `1 - 0.9999999999999999` 是 `1.11e-16`：直接拼进文案会得到一串科学计数法，
    //    读作「差一点点但说不清多少」。这一条钉住它不出现
    expect(text).not.toMatch(/e[-+]/i)
    expect(weightSumText(drafts(threeParticipants(), [0.06, 0.57, 0.36]))).not.toMatch(/e[-+]/i)
  })
})

// ==================== 收窄到参与清单 ====================

describe('🔴 draftsOfParticipants：已退出参与的那一项不得进和', () => {
  it('取消勾选之后，残留的草稿不算进和', () => {
    const three = threeParticipants()
    const all = drafts(three, [0.4, 0.3, 0.3])
    // 用户取消勾选了第三条：参与清单只剩两条，草稿数组里第三条还在
    const scoped = draftsOfParticipants(three.slice(0, 2), all)
    expect(scoped.map((item) => item.calculationId)).toEqual([11, 12])
    expect(weightSum(all)).toBe(1) // 三份都在时是 1
    expect(weightSum(scoped)).toBe(0.7) // 只剩两份时不是 1，要报出来
    expect(weightErrors(three.slice(0, 2), all).some((text) => text.includes('0.7'))).toBe(true)
  })

  it('🔴 非空过：直接拿草稿数组去算和会得到一个「假绿」的 1', () => {
    const three = threeParticipants()
    const all = drafts(three, [0.4, 0.3, 0.3])
    // 这一句是上面那条的负控：如果 weightErrors 不收窄，它会认为和是 1、什么都不报
    expect(weightSumIsOne(all)).toBe(true)
    expect(weightErrors(three.slice(0, 2), all)).not.toHaveLength(0)
  })

  it('草稿缺失时给一句诚实的话，不报成「理由没写」', () => {
    const rows = twoParticipants()
    const errors = weightErrors(rows, [{ calculationId: 11, weight: 0.5, reason: '理由' }])
    expect(errors.some((text) => text.includes('没有建出来'))).toBe(true)
    expect(errors.some((text) => text.includes('理由没写'))).toBe(false)
  })
})

// ==================== 取舍理由 ====================

describe('取舍理由的字数：与后端逐字对齐', () => {
  it('按 trim 之后的长度算', () => {
    expect(reasonCharCount('  经综合分析  ')).toBe(5)
    expect(reasonCharCount('\n\t 甲乙丙 \n')).toBe(3)
    expect(reasonCharCount('')).toBe(0)
    expect(reasonCharCount(null)).toBe(0)
    expect(reasonCharCount(undefined)).toBe(0)
    expect(reasonCharCount('   ')).toBe(0)
  })

  it('🔴 用 UTF-16 码元计数（与 Java 的 String#length 一致），不是码点', () => {
    const withEmoji = '这一段理由带一个🔴标记'
    // Java String#length() 对 BMP 外的字符算 2，JS 的 .length 也是 2 ⟹ 两份一致
    expect(reasonCharCount(withEmoji)).toBe(withEmoji.length)
    expect(reasonCharCount(withEmoji)).toBe(12)
    // 🔴 非空过：按码点数会少 1，所以「不要改成 [...s].length」这句话是有内容的
    expect([...withEmoji].length).toBe(11)
    expect(reasonCharCount(withEmoji)).not.toBe([...withEmoji].length)
  })
})

// ==================== 权重逐项校验 ====================

describe('weightErrors：逐项（理由 → 正负）→ 之和', () => {
  it('都填对了就一条都不报', () => {
    expect(weightErrors(twoParticipants(), drafts(twoParticipants(), [0.6, 0.4]))).toHaveLength(0)
    expect(
      weightErrors(threeParticipants(), drafts(threeParticipants(), [0.3334, 0.3333, 0.3333]))
    ).toHaveLength(0)
  })

  it('理由没写 → 报出来，且带上是哪一档', () => {
    const rows = twoParticipants()
    const errors = weightErrors(rows, [
      { calculationId: 11, weight: 0.6, reason: '   ' },
      { calculationId: 12, weight: 0.4, reason: '收益法的假设在本标的上不成立' }
    ])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('市场比较法')
    expect(errors[0]).toContain('理由没写')
  })

  it('理由没写时**不再**接着报权重（一项一条，不要刷屏）', () => {
    const rows = twoParticipants()
    const errors = weightErrors(rows, [
      { calculationId: 11, weight: 0, reason: '' },
      { calculationId: 12, weight: 1, reason: '理由' }
    ])
    expect(errors.filter((text) => text.includes('市场比较法'))).toHaveLength(1)
    expect(errors.some((text) => text.includes('市场比较法') && text.includes('正数'))).toBe(false)
  })

  it('没填 / 0 / 负数各自报', () => {
    const rows = twoParticipants()
    expect(weightErrors(rows, drafts(rows, [null, 1])).join('\n')).toContain('还没填')
    expect(weightErrors(rows, drafts(rows, [0, 1])).join('\n')).toContain('必须是正数')
    expect(weightErrors(rows, drafts(rows, [-0.2, 1.2])).join('\n')).toContain('-0.2')
  })

  it('🔴 顺序：逐项的问题排在「之和」之前', () => {
    const rows = threeParticipants()
    const errors = weightErrors(rows, [
      { calculationId: 11, weight: 0.5, reason: '理由' },
      { calculationId: 12, weight: 0.5, reason: '理由' },
      { calculationId: 13, weight: 0.5, reason: '' }
    ])
    expect(errors).toHaveLength(2)
    expect(errors[0]).toContain('理由没写')
    expect(errors[1]).toContain('权重之和')
  })

  it('🔴 顺序：理由排在正负之前（后端就是这个顺序）', () => {
    const rows = [calc(11, 'COST')]
    const errors = weightErrors(rows, [{ calculationId: 11, weight: -1, reason: '  ' }])
    // 之和那一条也会报（-1 不等于 1），所以这里断言的是**顺序**与**抑制**，不是条数
    expect(errors[0]).toContain('理由没写')
    expect(errors.some((text) => text.includes('正数'))).toBe(false)
  })
})

// ==================== 确定按钮的阻断项 ====================

describe('determineErrors', () => {
  it('没有标的编号时**只**报这一条就返回（后面每一步都依赖它）', () => {
    const errors = determineErrors(baseDraft({ subjectId: null, combineType: '', participants: [] }))
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('从标的台账进来')
  })

  it('还没挑测算 / 还没选综合方式', () => {
    expect(determineErrors(baseDraft({ participants: [], combineType: '' })).join('\n')).toContain(
      '还没有选综合方式'
    )
    expect(determineErrors(baseDraft({ participants: [] })).join('\n')).toContain('至少要挑一条')
  })

  it('🔴 SINGLE 只能一条，多了要说清怎么改', () => {
    const errors = determineErrors(baseDraft({ combineType: 'SINGLE' }))
    expect(errors.some((text) => text.includes('只能有一条'))).toBe(true)
    expect(errors.join('\n')).toContain('2 条')
    expect(errors.join('\n')).toContain('算术平均')
  })

  it('SINGLE 只挑一条时不报条数', () => {
    const one = [calc(11, 'COST')]
    const errors = determineErrors(baseDraft({ combineType: 'SINGLE', participants: one, weights: loadWeightDrafts(one) }))
    expect(errors.join('\n')).not.toContain('只能有一条')
    expect(errors).toHaveLength(0)
  })

  it('WEIGHTED 把权重那几步接进来', () => {
    const rows = twoParticipants()
    const errors = determineErrors(
      baseDraft({ combineType: 'WEIGHTED', participants: rows, weights: loadWeightDrafts(rows) })
    )
    expect(errors.some((text) => text.includes('理由没写'))).toBe(true)
  })

  it('🔴 非 WEIGHTED 档**不查**权重（后端会忽略，查了就是造一个不存在的约束）', () => {
    const rows = twoParticipants()
    for (const combineType of ['SINGLE', 'ARITHMETIC_MEAN', 'RANGE', 'PROFESSIONAL_JUDGMENT']) {
      const errors = determineErrors(
        baseDraft({
          combineType,
          participants: combineType === 'SINGLE' ? rows.slice(0, 1) : rows,
          weights: loadWeightDrafts(rows),
          finalValue: combineTypeNeedsFinalValueLocal(combineType) ? 900000 : null
        })
      )
      expect(
        errors.some((text) => text.includes('权重')),
        `${combineType} 不该查权重，却报了：${errors.join('；')}`
      ).toBe(false)
    }
  })

  it('🔴 只有 RANGE 与 PROFESSIONAL_JUDGMENT 要求手填最终值', () => {
    for (const combineType of ['RANGE', 'PROFESSIONAL_JUDGMENT']) {
      const errors = determineErrors(baseDraft({ combineType, finalValue: null }))
      expect(errors.some((text) => text.includes('最终评估值由你给出')), combineType).toBe(true)
    }
    for (const combineType of ['SINGLE', 'ARITHMETIC_MEAN', 'WEIGHTED']) {
      const rows = combineType === 'SINGLE' ? [calc(11, 'COST')] : twoParticipants()
      const errors = determineErrors(
        baseDraft({
          combineType,
          participants: rows,
          weights: drafts(rows, rows.length === 2 ? [0.6, 0.4] : [1]),
          finalValue: null
        })
      )
      expect(
        errors.some((text) => text.includes('最终评估值')),
        `${combineType} 的最终值由后端算，不该要求手填：${errors.join('；')}`
      ).toBe(false)
    }
  })

  it('理由没写要报，且带上它是 R08 的判据', () => {
    const errors = determineErrors(baseDraft({ determinationReason: '   ' }))
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('R08')
  })

  it('🔴 理由**太短**不在前端报 —— 那个字数下限是后端的', () => {
    // 后端会回「只有 4 个字，少于 R08 要求的 50 个字」，那句原文比前端能拼的任何提示都完整。
    // 前端要拼这句就得先抄那个 50，而 I5 起它是机构可调的
    const errors = determineErrors(baseDraft({ determinationReason: '取平均' }))
    expect(errors).toHaveLength(0)
  })

  it('🔴 全是套话也不在前端报 —— 禁语表是后端的', () => {
    const errors = determineErrors(
      baseDraft({
        determinationReason:
          '经综合分析，综合确定。经综合分析，综合确定。经综合分析，综合确定。经综合分析，综合确定。'
      })
    )
    expect(errors).toHaveLength(0)
  })
})

// ==================== 装配请求体 ====================

describe('buildDetermineVO', () => {
  it('WEIGHTED：权重表**从参与清单**生成，顺序与 calculationIds 一致', () => {
    const rows = threeParticipants()
    const vo = buildDetermineVO(
      baseDraft({
        combineType: 'WEIGHTED',
        participants: rows,
        weights: [
          { calculationId: 13, weight: 0.3333, reason: '丙' },
          { calculationId: 11, weight: 0.3334, reason: '甲' },
          { calculationId: 12, weight: 0.3333, reason: '乙' }
        ]
      })
    )
    expect(vo.calculationIds).toEqual([11, 12, 13])
    // 🔴 草稿数组是乱序的，生成的权重表却按参与清单的顺序 —— 于是「一一对应」是构造出来的，
    //    后端的 CALC_RESULT_WEIGHTS_MISMATCH 在这条路径上不可能触发
    expect(vo.weights?.map((item) => item.calculationId)).toEqual([11, 12, 13])
    expect(vo.weights?.map((item) => item.weight)).toEqual([0.3334, 0.3333, 0.3333])
    expect(vo.weights?.map((item) => item.reason)).toEqual(['甲', '乙', '丙'])
  })

  it('WEIGHTED 且某一项没有草稿 → 落成 0 与空理由（提交按钮在那之前就灰着）', () => {
    const rows = twoParticipants()
    const vo = buildDetermineVO(
      baseDraft({
        combineType: 'WEIGHTED',
        participants: rows,
        weights: [{ calculationId: 11, weight: 1, reason: '甲' }]
      })
    )
    expect(vo.weights).toEqual([
      { calculationId: 11, weight: 1, reason: '甲' },
      { calculationId: 12, weight: 0, reason: '' }
    ])
    expect(determineErrors(baseDraft({ combineType: 'WEIGHTED', participants: rows, weights: [{ calculationId: 11, weight: 1, reason: '甲' }] }))).not.toHaveLength(0)
  })

  it('🔴 非 WEIGHTED 档**不发** weights，即使草稿里有残留', () => {
    const rows = twoParticipants()
    const residue = drafts(rows, [0.6, 0.4])
    for (const combineType of ['SINGLE', 'ARITHMETIC_MEAN', 'RANGE', 'PROFESSIONAL_JUDGMENT']) {
      const vo = buildDetermineVO(
        baseDraft({
          combineType,
          participants: combineType === 'SINGLE' ? rows.slice(0, 1) : rows,
          weights: residue,
          finalValue: 900000
        })
      )
      expect(vo.weights, `${combineType} 不该带 weights`).toBeUndefined()
    }
  })

  it('🔴 只有 RANGE / PROFESSIONAL_JUDGMENT 发 finalValue，其余三档摘掉残留', () => {
    const rows = twoParticipants()
    for (const combineType of ['RANGE', 'PROFESSIONAL_JUDGMENT']) {
      expect(buildDetermineVO(baseDraft({ combineType, finalValue: 987654.32 })).finalValue).toBe(
        987654.32
      )
    }
    for (const combineType of ['ARITHMETIC_MEAN', 'WEIGHTED']) {
      const vo = buildDetermineVO(
        baseDraft({ combineType, finalValue: 987654.32, weights: drafts(rows, [0.6, 0.4]) })
      )
      expect(vo.finalValue, `${combineType} 的最终值由后端算，不该发上去`).toBeUndefined()
    }
    const one = rows.slice(0, 1)
    expect(
      buildDetermineVO(baseDraft({ combineType: 'SINGLE', participants: one, finalValue: 987654.32 }))
        .finalValue
    ).toBeUndefined()
  })

  it('valueType：空串与全空白落成 null，有值则 trim', () => {
    expect(buildDetermineVO(baseDraft({ valueType: '' })).valueType).toBeNull()
    expect(buildDetermineVO(baseDraft({ valueType: '   ' })).valueType).toBeNull()
    expect(buildDetermineVO(baseDraft({ valueType: '  MARKET_VALUE  ' })).valueType).toBe(
      'MARKET_VALUE'
    )
  })

  it('🔴 determinationReason 原样发出，**不在前端 trim**（后端自己 trim）', () => {
    const reason = '  两种方法的假设都成立，取算术平均。  '
    expect(buildDetermineVO(baseDraft({ determinationReason: reason })).determinationReason).toBe(
      reason
    )
  })

  it('subjectId 为 null 时落成 0，而不是把 null 发出去', () => {
    // 这一支到不了后端：determineErrors 在没有标的编号时就拦下了。
    // 落成 0 是为了让类型是 number（后端 @NotNull 会拒 null，0 会被拒成「标的不存在」）
    expect(buildDetermineVO(baseDraft({ subjectId: null })).subjectId).toBe(0)
  })
})

// ==================== 读模型 ====================

describe('participantName', () => {
  it('后端给了 methodName 就用后端的', () => {
    expect(participantName({ methodCode: 'COST', methodName: '成本法（机构自定义名）' })).toBe(
      '成本法（机构自定义名）'
    )
  })

  it('没给就按码查表；查不到回落到码本身，不显示成空白', () => {
    expect(participantName({ methodCode: 'COST' })).toBe(METHOD_NAMES.COST)
    expect(participantName({ methodCode: 'DCF' })).toBe('DCF')
    expect(participantName(null)).toBe('')
  })
})

// ==================== 导出文件名 ====================

describe('calcSheetFilenameBase', () => {
  it('有标的名时带上它（几个文件混在下载目录里要认得出谁是谁）', () => {
    expect(calcSheetFilenameBase('朝阳区某小区 3 号楼', 7)).toBe('计算成果表-朝阳区某小区 3 号楼')
  })

  it('🔴 没有标的名时回落到编号，绝不回落成空串', () => {
    expect(calcSheetFilenameBase('', 7)).toBe('计算成果表-标的7')
    expect(calcSheetFilenameBase(null, 7)).toBe('计算成果表-标的7')
    expect(calcSheetFilenameBase('   ', 7)).toBe('计算成果表-标的7')
    expect(calcSheetFilenameBase(null, null)).toBe('计算成果表-未知标的')
    // 空串会得到一个叫「计算成果表.xlsx」的文件，恰好是最没用的那个名字
    expect(calcSheetFilenameBase('', 7)).not.toBe('计算成果表-')
  })

  it('🔴 Windows 保留字符替换成下划线（标的名是自由文本，实测有人把整串地址填进去）', () => {
    expect(calcSheetFilenameBase('A/B\\C:D*E?F"G<H>I|J', 7)).toBe('计算成果表-A_B_C_D_E_F_G_H_I_J')
  })

  it('超长截到 40 字（文件名过长会被下载器自己截，截在哪儿不由我们决定）', () => {
    const long = '很'.repeat(80)
    expect(calcSheetFilenameBase(long, 7)).toBe(`计算成果表-${'很'.repeat(40)}`)
  })
})

// ==================== 界面文本的两条禁令 ====================

/** 把本模块会渲染给人看的文本全部收上来（含每一条能触发的报错） */
const collectUserVisibleTexts = (): string[] => {
  const rows = threeParticipants()
  const texts: string[] = [...Object.values(COMBINE_TYPE_HINTS)]

  const pushAll = (list: string[]) => texts.push(...list)
  pushAll(determineErrors(baseDraft({ subjectId: null })))
  pushAll(determineErrors(baseDraft({ participants: [], combineType: '' })))
  for (const combineType of ['SINGLE', 'ARITHMETIC_MEAN', 'WEIGHTED', 'RANGE', 'PROFESSIONAL_JUDGMENT']) {
    pushAll(
      determineErrors(
        baseDraft({
          combineType,
          participants: rows,
          weights: loadWeightDrafts(rows),
          finalValue: null,
          determinationReason: ''
        })
      )
    )
  }
  pushAll(weightErrors(rows, loadWeightDrafts(rows)))
  pushAll(weightErrors(rows, drafts(rows, [0, -1, null])))
  pushAll(weightErrors(rows, [{ calculationId: 11, weight: 1, reason: '' }]))
  pushAll(weightErrors(rows, drafts(rows, [0.5, 0.5, 0.5])))
  pushAll(weightErrors(rows.slice(0, 2), drafts(rows, [0.4, 0.3, 0.3])))
  texts.push(
    weightSumText(drafts(rows, [1, 1, 1])),
    weightSumText(drafts(rows, [null, null, null])),
    weightSumText(drafts(rows, [0.9999999999999999, 0, 0]))
  )
  texts.push(calcSheetFilenameBase('', null), calcSheetFilenameBase('名', 1))
  return texts.filter((text) => text.length > 0)
}

describe('🔴 界面文本不得抄规则参数', () => {
  it('非空过：真的收到了文本', () => {
    const texts = collectUserVisibleTexts()
    expect(texts.length).toBeGreaterThan(20)
    expect(texts.join('\n')).toContain('权重')
  })

  it('R08 的字数下限、R09 的阈值、列宽、金额上限、禁语表一个都不出现', () => {
    const texts = collectUserVisibleTexts()
    const joined = texts.join('\n')
    // 后端各有一份、且 I5 起机构可调：抄一份就会在「门槛被改了」那天开始说谎
    for (const banned of ['0.20', '2000', '10000000000000000', '经综合分析', '综合确定']) {
      expect(joined, `界面文本里抄了后端的「${banned}」`).not.toContain(banned)
    }
    // 字数下限：不能出现「50 个字」「不少于 50」这类。用「50 前后是字/个/最少」来定位，
    // 免得把「0.50」这种合法的数值也拦下来
    expect(joined).not.toMatch(/50\s*[个字]/)
    expect(joined).not.toMatch(/[至少少于不]{1,3}\s*50/)
    // 🔴 非空过：上面那些正则真的能命中东西
    expect('只有 32 个字，少于 R08 要求的 50 个字').toMatch(/50\s*[个字]/)
    expect('经综合分析').toContain('经综合分析')
  })
})

describe('🔴 界面文本不得含 markdown 与「这里有坑」标记', () => {
  it('没有 **加粗**、没有 🔴、没有 ⚠️', () => {
    // 这一类缺陷 I2-g 一次性发过 17 处（`renderedMarkdownBan.spec.ts` 守的是 .vue 模板）。
    // 而**纯模块里的字符串同样会被渲染**，那条守卫扫不到它们 ⟹ 这里补一条
    const joined = collectUserVisibleTexts().join('\n')
    expect(joined).not.toContain('**')
    expect(joined).not.toContain('🔴')
    expect(joined).not.toContain('⚠')
    // 🔴 非空过：这套断言在一段含违规的文本上确实会红
    expect('它必须**正好**是 1').toContain('**')
  })
})

// ==================== 五档说明 ====================

describe('COMBINE_TYPE_HINTS 与五档一一对应', () => {
  it('键集合与 COMBINE_TYPE_OPTIONS 双向相等', () => {
    const hintKeys = Object.keys(COMBINE_TYPE_HINTS).sort()
    const optionValues = COMBINE_TYPE_OPTIONS.map((item) => item.value).sort()
    expect(hintKeys).toEqual(optionValues)
    expect(optionValues).toEqual([
      'ARITHMETIC_MEAN',
      'PROFESSIONAL_JUDGMENT',
      'RANGE',
      'SINGLE',
      'WEIGHTED'
    ])
  })

  it('每一档都有一句非空的说明', () => {
    for (const [combineType, hint] of Object.entries(COMBINE_TYPE_HINTS)) {
      expect(hint.trim().length, `${combineType} 的说明是空的`).toBeGreaterThan(10)
    }
  })

  it('combineTypeNeedsWeights 只对 WEIGHTED 为真', () => {
    expect(combineTypeNeedsWeights('WEIGHTED')).toBe(true)
    for (const combineType of ['SINGLE', 'ARITHMETIC_MEAN', 'RANGE', 'PROFESSIONAL_JUDGMENT']) {
      expect(combineTypeNeedsWeights(combineType)).toBe(false)
    }
    expect(combineTypeNeedsWeights(undefined)).toBe(false)
    expect(combineTypeNeedsWeights('')).toBe(false)
  })

  it('🔴 说明里没有**具体的**推荐权重（给了就会有人点，点了之后理由写的是平台的建议）', () => {
    const joined = Object.values(COMBINE_TYPE_HINTS).join('\n')
    expect(joined).not.toMatch(/建议.{0,6}\d\s*[:：]\s*\d/)
    expect(joined).not.toMatch(/推荐.{0,6}\d\s*[:：]\s*\d/)
    // 「平台刻意不给推荐权重」这句要留着 —— 它说的是【没有】推荐。
    // 禁掉这个子串会把唯一一句解释「为什么没有建议按钮」的话也一起禁掉
    expect(COMBINE_TYPE_HINTS.WEIGHTED).toContain('刻意不给推荐权重')
    // 非空过：上面两条正则真的能命中东西
    expect('建议权重 6:4').toMatch(/建议.{0,6}\d\s*[:：]\s*\d/)
    expect('推荐 6:4').toMatch(/推荐.{0,6}\d\s*[:：]\s*\d/)
  })
})

describe('🔴 constants.ts 那份「哪些档要手填最终值」与本 spec 独立写的那份一致', () => {
  it('五档逐个对照', () => {
    for (const option of COMBINE_TYPE_OPTIONS) {
      expect(combineTypeNeedsFinalValue(option.value), `${option.value} 在两份口径里不一致`).toBe(
        combineTypeNeedsFinalValueLocal(option.value)
      )
    }
  })
})
