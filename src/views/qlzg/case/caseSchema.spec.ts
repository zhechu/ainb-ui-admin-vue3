import { describe, expect, it } from 'vitest'
import type { QlzgCaseImportIssueVO, QlzgCaseImportPreviewVO, QlzgCaseVO } from '@/api/qlzg/case'
import {
  STEP_COUNT,
  STEP_TITLES,
  UNIT_PRICE_SCALE,
  UNIT_PRICE_TOLERANCE,
  YUAN_PER_WAN,
  canGoNextStep,
  carryOverForNextEntry,
  computedUnitPrice,
  emptyCaseForm,
  fromRespVO,
  newImportToken,
  previewBlockingIssue,
  restorePairIssue,
  roundHalfUp,
  saveIssues,
  shouldStopPolling,
  step0Advisories,
  step0Issues,
  step1Issues,
  summarizeIssues,
  toSaveVO,
  toWanYuan,
  unitPriceConsistent,
  unitPriceDeviationPercent,
  wanYuanHint,
  type QlzgCaseFormModel
} from './caseSchema'

/**
 * 案例录入 / 导入这套纯逻辑的守卫。
 *
 * 🔴 本文件钉的是**三处静默失效**，它们坏了都不报错、界面上也都看不出来：
 *
 *  1. **舍入差一分**：`(1.005).toFixed(2)` 给 `"1.00"`，Java 的 BigDecimal HALF_UP 给 `1.01`。
 *     差的那一分落在**单价**上，表现是「表单说单价与算出来的不一致」，
 *     而用户填的就是系统自己显示给他的那个数 —— 改无可改。
 *  2. **整行替换把没碰过的列清空**：`updateCase` 的语义是整行覆盖，
 *     漏一列 ⇒「打开编辑弹窗 → 什么都不动 → 保存」就把那一列删了，界面还提示「修改成功」。
 *     本仓已经栽过一次同款（`ext_json`）。所以这里有一条**穷尽性**用例，
 *     就是 `caseSchema.ts` 的 `fromRespVO` 注释里承诺的那条。
 *  3. **半截坐标落成 0**：只填经度不填纬度时若回落成 `{lng: 120.09, lat: 0}`，
 *     这条案例就被算到赤道上，而空间召回那一层把它**当成一个真实坐标**去比距离。
 *     后端 `readCoordinate` 对认不出的值返回 null、刻意不回落成 0，前端不能替它回落。
 *
 * ⚠️ 反过来，**不钉**的东西也写清楚：这里不测 `.vue` 里的装配与事件
 *    （vitest 跑在 node 环境，值导入 API 层的模块在收集阶段就 `window is not defined`），
 *    也不重复钉后端的权威判定 —— 单价 5%、还原价双向必填、屏 2 不可跳过，
 *    后端各有一条错误码和各自的单测。这里钉的是**前端那份副本与后端一致**，
 *    以及前端**不比后端严**（严了用户拿不到任何解释）。
 */

// ==================== 舍入 ====================

describe('roundHalfUp：镜像 Java 的 BigDecimal HALF_UP', () => {
  it('🔴 1.005 舍到两位得 1.01，不是 toFixed 的 1.00', () => {
    // `1.005 * 100` 在 IEEE 754 下是 100.49999999999999，
    // 所以 toFixed 与「先乘再取整」都会掉一分。这一条是整个模块最要紧的断言
    expect(roundHalfUp(1.005, 2)).toBe(1.01)
    expect((1.005).toFixed(2)).toBe('1.00') // 对照组：说明为什么不能直接用 toFixed
    expect(roundHalfUp(2.675, 2)).toBe(2.68) // 同款：2.675 * 100 = 267.49999999999994
  })

  it('半分点以下照样向下', () => {
    expect(roundHalfUp(1.004, 2)).toBe(1)
    expect(roundHalfUp(2.674, 2)).toBe(2.67)
  })

  it('🔴 负数按「远离 0」取整，与 HALF_UP 的定义一致（Math.round 是向 +∞，不能用）', () => {
    expect(roundHalfUp(-0.5, 0)).toBe(-1)
    expect(Math.round(-0.5)).toBe(-0) // 对照组
    expect(roundHalfUp(-1.005, 2)).toBe(-1.01)
    expect(roundHalfUp(-2.34, 1)).toBe(-2.3)
  })

  it('抹掉 0.1 + 0.2 这类表示误差', () => {
    expect(roundHalfUp(0.1 + 0.2, 2)).toBe(0.3)
    expect(roundHalfUp(1234.5678, 2)).toBe(1234.57)
  })

  it('零位与非有限值原样过', () => {
    expect(roundHalfUp(1.5, 0)).toBe(2)
    expect(roundHalfUp(7, 0)).toBe(7)
    expect(Number.isNaN(roundHalfUp(NaN, 2))).toBe(true)
    expect(roundHalfUp(Infinity, 2)).toBe(Infinity)
  })
})

// ==================== 单价 ====================

describe('computedUnitPrice：算不出来时给 null，绝不给 0', () => {
  it('正常一路，保留两位', () => {
    expect(computedUnitPrice(1000000, 100)).toBe(10000)
    expect(computedUnitPrice(100, 3)).toBe(33.33)
    expect(computedUnitPrice(3805100, 90.5)).toBe(42045.3)
  })

  it('🔴 任一侧没填 ⇒ null。**不返回 0**：0 是一个合法单价，界面拿它当占位符会显示「0 元/㎡」', () => {
    expect(computedUnitPrice(null, 100)).toBeNull()
    expect(computedUnitPrice(undefined, 100)).toBeNull()
    expect(computedUnitPrice(1000000, null)).toBeNull()
    expect(computedUnitPrice(1000000, undefined)).toBeNull()
    expect(computedUnitPrice('', '')).toBeNull()
    expect(computedUnitPrice(1000000, '')).toBeNull()
  })

  it('面积为 0 ⇒ null（除零不炸，也不给 Infinity）', () => {
    expect(computedUnitPrice(1000000, 0)).toBeNull()
  })

  it('🔴 全空白的字符串算「没填」，不算 0', () => {
    // `Number('   ')` 是 0。不 trim 的话一个残留空格会让面积变成 0，
    // 于是单价从「算不出来」变成「除以 0」这一路 —— 两处判据必须同源
    expect(computedUnitPrice(1000000, '   ')).toBeNull()
    expect(computedUnitPrice('   ', 100)).toBeNull()
  })

  it('字符串入参（el-input 给的就是字符串）照样算', () => {
    expect(computedUnitPrice('1000000', '100')).toBe(10000)
    expect(computedUnitPrice(' 1000000 ', ' 100 ')).toBe(10000)
  })

  it('成交价为 0 ⇒ 0（不是 null）：0 是算得出来的结果，而它合不合法由闸门判', () => {
    expect(computedUnitPrice(0, 100)).toBe(0)
  })

  it('小数位与 DDL 的 decimal(18,2) 一致', () => {
    expect(UNIT_PRICE_SCALE).toBe(2)
  })
})

describe('unitPriceConsistent：5% 阈值', () => {
  it('与后端同一个阈值', () => {
    expect(UNIT_PRICE_TOLERANCE).toBe(0.05)
  })

  it('🔴 恰好 5% 放行，刚超过一点就拦', () => {
    expect(unitPriceConsistent(10500, 10000)).toBe(true) // 正好 5%
    expect(unitPriceConsistent(9500, 10000)).toBe(true) // 正好 -5%
    expect(unitPriceConsistent(10500.01, 10000)).toBe(false)
    expect(unitPriceConsistent(9499.99, 10000)).toBe(false)
  })

  it('数量级错误（把万元当成元填）拦得住', () => {
    expect(unitPriceConsistent(380.51, 3805100)).toBe(false)
  })

  it('🔴 没填单价 ⇒ 恒一致（让后端算，后端才是权威）', () => {
    expect(unitPriceConsistent(null, 10000)).toBe(true)
    expect(unitPriceConsistent(undefined, 10000)).toBe(true)
    expect(unitPriceConsistent('', 10000)).toBe(true)
    expect(unitPriceConsistent('   ', 10000)).toBe(true)
  })

  it('算不出单价 ⇒ 恒一致（拦不住的东西不要拦，后端会自己算）', () => {
    expect(unitPriceConsistent(42000, null)).toBe(true)
    expect(unitPriceConsistent(42000, undefined)).toBe(true)
  })

  it('🔴 算出来的单价是 0 时不炸除法：阈值也是 0，任何非 0 单价都被拦', () => {
    expect(unitPriceConsistent(42000, 0)).toBe(false)
    expect(unitPriceConsistent(0, 0)).toBe(true)
    expect(unitPriceConsistent(null, 0)).toBe(true)
  })

  it('🔴 只放宽不收紧：浮点余量让边界值过去，被后端拒时那条报错里带着两个数，可行动', () => {
    // 10000 的 5% 是 500.00000000000006 这种形状，余量正是为它留的
    expect(unitPriceConsistent(10000 * 1.05, 10000)).toBe(true)
    expect(unitPriceConsistent(3805100 / 90.5, computedUnitPrice(3805100, 90.5))).toBe(true)
  })
})

describe('unitPriceDeviationPercent：给提示文案用', () => {
  it('保留一位小数', () => {
    expect(unitPriceDeviationPercent(10500, 10000)).toBe('5')
    expect(unitPriceDeviationPercent(10123.456, 10000)).toBe('1.2')
    expect(unitPriceDeviationPercent(10000, 10000)).toBe('0')
    expect(unitPriceDeviationPercent(9499.99, 10000)).toBe('5')
  })

  it('算出来是 0 ⇒ "100"（凑不出的百分比，但文案里紧跟着两个数字已经把问题说清了）', () => {
    expect(unitPriceDeviationPercent(42000, 0)).toBe('100')
  })

  it('没填 / 算不出 ⇒ "0"', () => {
    expect(unitPriceDeviationPercent(null, 10000)).toBe('0')
    expect(unitPriceDeviationPercent(42000, null)).toBe('0')
  })
})

// ==================== 万元（改判记录）====================

describe('toWanYuan / wanYuanHint：只读显示，换算结果永不回传', () => {
  it('元 → 万元，两位小数', () => {
    expect(toWanYuan(3805100)).toBe('380.51')
    expect(toWanYuan(1234567)).toBe('123.46')
    expect(toWanYuan(1000000)).toBe('100.00')
    expect(toWanYuan(0)).toBe('0.00')
  })

  it('不足一分万元时显示 0.00，而不是空', () => {
    expect(toWanYuan(1)).toBe('0.00')
    expect(toWanYuan(100)).toBe('0.01')
  })

  it('🔴 没填 ⇒ null，调用方据此**不渲染**那句提示（而不是渲染「≈ 万元」）', () => {
    expect(toWanYuan(null)).toBeNull()
    expect(toWanYuan(undefined)).toBeNull()
    expect(toWanYuan('')).toBeNull()
    expect(toWanYuan('   ')).toBeNull()
  })

  it('字符串入参照样换算', () => {
    expect(toWanYuan('3805100')).toBe('380.51')
  })

  it('提示文本的形状，与一万这个换算因子', () => {
    expect(YUAN_PER_WAN).toBe(10000)
    expect(wanYuanHint(3805100)).toBe('≈ 380.51 万元')
    expect(wanYuanHint(null)).toBe('')
    expect(wanYuanHint('')).toBe('')
  })
})

// ==================== 三屏闸门 ====================

/** 一份能过全部闸门的表单。每个用例从它出发只改一处 */
const validForm = (): QlzgCaseFormModel => ({
  ...emptyCaseForm(),
  caseKind: 'RESIDENCE',
  cityCode: '330100',
  districtCode: '330106',
  communityName: '文鼎苑',
  address: '杭州市西湖区文一西路 100 号',
  lng: 120.09,
  lat: 30.28,
  purpose: '住宅',
  rightType: '出让',
  transactionDate: '2026-03-15',
  transactionPrice: 3805100,
  buildingArea: 90.5,
  evidenceFileId: 90001,
  evidenceKind: 'DEED',
  evidenceFileName: '不动产权证扫描件.pdf'
})

describe('三屏的形状', () => {
  it('三屏，屏 3 是确认页', () => {
    expect(STEP_COUNT).toBe(3)
    expect(STEP_TITLES).toHaveLength(STEP_COUNT)
    expect([...STEP_TITLES]).toEqual(['基本信息', '证据', '确认与复用'])
  })

  it('🔴 屏 3 没有「下一步」：即使表单完美，canGoNextStep 在第三屏也恒为 false', () => {
    expect(canGoNextStep(2, validForm())).toBe(false)
    expect(canGoNextStep(9, validForm())).toBe(false)
  })
})

describe('step0Issues：与后端的 @NotBlank / @NotNull 一一对应', () => {
  it('一份完整的表单没有阻塞项', () => {
    expect(step0Issues(validForm())).toEqual([])
  })

  it('🔴 空表单**恰好**四条，不多不少', () => {
    // 少了 ⇒ 用户点「下一步」过去、到第三屏保存才被拒，然后翻回第一屏；
    // 多了 ⇒ 拦住一个后端本来会接受的值，而用户不知道那一栏到底要不要填
    expect(step0Issues(emptyCaseForm())).toHaveLength(4)
    expect(step0Issues(emptyCaseForm())).toEqual([
      '案例库类型不能为空',
      '成交日期不能为空',
      '成交价不能为空',
      '建筑面积不能为空'
    ])
  })

  it('四条各自单独触发', () => {
    expect(step0Issues({ ...validForm(), caseKind: '' })).toContain('案例库类型不能为空')
    expect(step0Issues({ ...validForm(), caseKind: '   ' })).toContain('案例库类型不能为空')
    expect(step0Issues({ ...validForm(), transactionDate: '' })).toContain('成交日期不能为空')
    expect(step0Issues({ ...validForm(), transactionPrice: null })).toContain('成交价不能为空')
    expect(step0Issues({ ...validForm(), buildingArea: undefined })).toContain('建筑面积不能为空')
  })

  it('成交价与建筑面积都必须大于 0（后端是 @DecimalMin(0, inclusive = false)）', () => {
    expect(step0Issues({ ...validForm(), transactionPrice: 0 })).toContain('成交价必须大于 0')
    expect(step0Issues({ ...validForm(), transactionPrice: -1 })).toContain('成交价必须大于 0')
    expect(step0Issues({ ...validForm(), buildingArea: 0 })).toContain('建筑面积必须大于 0')
    // 🔴 只报一条：空值那一支与「必须大于 0」那一支是互斥的，
    //    同时出两句用户会以为要填两次
    expect(step0Issues({ ...validForm(), transactionPrice: 0 })).toHaveLength(1)
  })

  it('🔴 小区名留空**不是**阻塞项（后端不要求它：新盘第一次录入时可能只有坐落地址）', () => {
    expect(step0Issues({ ...validForm(), communityName: '' })).toEqual([])
    expect(canGoNextStep(0, { ...validForm(), communityName: '' })).toBe(true)
  })

  it('🔴 城市 / 用途 / 权利性质留空同样不阻塞 —— 它们是静默失效，走 advisories', () => {
    const sparse = { ...validForm(), cityCode: '', purpose: '', rightType: '' }
    expect(step0Issues(sparse)).toEqual([])
    expect(canGoNextStep(0, sparse)).toBe(true)
  })
})

describe('step0Advisories：填不填都能存，而这条案例永远召回不到', () => {
  it('一份完整的表单没有提示', () => {
    expect(step0Advisories(validForm())).toEqual([])
  })

  it('🔴 四个硬过滤字段各给一条，且每条都说清了后果（不是「建议填写」）', () => {
    const notes = step0Advisories(emptyCaseForm())
    expect(notes).toHaveLength(4)
    expect(notes[0]).toContain('召回不到')
    expect(notes[1]).toContain('硬过滤')
    expect(notes[2]).toContain('硬过滤')
    expect(notes[3]).toContain('+40')
  })

  it('只留空一个就只给一条', () => {
    expect(step0Advisories({ ...validForm(), communityName: '  ' })).toHaveLength(1)
    expect(step0Advisories({ ...validForm(), cityCode: '' })[0]).toContain('第 1 层')
  })

  it('🔴 提示**永不**阻塞「下一步」：它是告知，不是校验', () => {
    const bare = {
      ...validForm(),
      cityCode: '',
      districtCode: '',
      purpose: '',
      rightType: '',
      communityName: ''
    }
    expect(step0Advisories(bare)).toHaveLength(4)
    expect(canGoNextStep(0, bare)).toBe(true)
  })
})

describe('step1Issues：屏 2 是强制的，不可跳过', () => {
  it('有佐证材料 + 有佐证类型 ⇒ 放行', () => {
    expect(step1Issues(validForm())).toEqual([])
    expect(canGoNextStep(1, validForm())).toBe(true)
  })

  it('🔴 没有佐证材料 ⇒「下一步」禁用，而不是让用户走到第三屏吃一个 CASE_EVIDENCE_REQUIRED', () => {
    const noEvidence = { ...validForm(), evidenceFileId: null }
    expect(step1Issues(noEvidence)).toContain('至少上传一份佐证材料')
    expect(canGoNextStep(1, noEvidence)).toBe(false)
  })

  it('上传失败留下的空编号同样拦住', () => {
    expect(canGoNextStep(1, { ...validForm(), evidenceFileId: undefined })).toBe(false)
    // 🔴 0 **不在**这里拦：`infra_file` 的自增主键从 1 开始，0 只可能来自「表单初值没被覆盖」
    //    这种代码级错误，而不是用户操作。前端拦它等于替后端发明一条约束，
    //    而 emptyCaseForm 给的是 null —— 真正会走到 0 的路径是表单自己写坏了
  })

  it('有材料但没选佐证类型 ⇒ 拦（后端要求两者成对）', () => {
    expect(step1Issues({ ...validForm(), evidenceKind: '  ' })).toContain('请选择佐证类型')
  })
})

describe('restorePairIssue：还原价与还原理由两个方向都必填', () => {
  it('两个都不填 ⇒ 没问题（大多数案例不做还原）', () => {
    expect(restorePairIssue(validForm())).toBeNull()
  })

  it('两个都填 ⇒ 没问题', () => {
    const restored = {
      ...validForm(),
      realPriceRestored: 4200000,
      restoreReason: '按契税完税凭证还原做低部分',
      priceRestoredFlag: true
    }
    expect(restorePairIssue(restored)).toBeNull()
    expect(step1Issues(restored)).toEqual([])
  })

  it('只填还原价 ⇒ 拦', () => {
    expect(restorePairIssue({ ...validForm(), realPriceRestored: 4200000 })).toBe(
      '填了还原后的真实价，就必须写还原理由与依据'
    )
  })

  it('🔴 只填理由 ⇒ 也拦：那样一行读起来像做过还原、却看不到还原成多少，比不做还原更坏', () => {
    const issue = restorePairIssue({ ...validForm(), restoreReason: '做过还原' })
    expect(issue).not.toBeNull()
    expect(issue).toContain('没填还原后的真实价')
  })

  it('还原价必须大于 0', () => {
    expect(
      restorePairIssue({ ...validForm(), realPriceRestored: 0, restoreReason: '有依据' })
    ).toBe('还原后的真实价必须大于 0')
    expect(
      restorePairIssue({ ...validForm(), realPriceRestored: -5, restoreReason: '有依据' })
    ).toBe('还原后的真实价必须大于 0')
  })

  it('🔴 判据是**值**不是那个复选框：勾了「已还原」但没填价，照样拦', () => {
    expect(
      restorePairIssue({ ...validForm(), priceRestoredFlag: true, realPriceRestored: null })
    ).toBeNull() // 勾了但两个值都空 ⇒ 视为没做还原，不拦
    expect(
      restorePairIssue({ ...validForm(), priceRestoredFlag: false, realPriceRestored: 4200000 })
    ).toBe('填了还原后的真实价，就必须写还原理由与依据')
  })

  it('🔴 「缺理由」那一句优先于「必须大于 0」：还原价为 0 且没写理由时只报一条', () => {
    // 一次只告诉用户一件事。报两条的话他会先去填理由，
    // 填完才发现价还是错的，等于来回两趟
    expect(restorePairIssue({ ...validForm(), realPriceRestored: 0 })).toBe(
      '填了还原后的真实价，就必须写还原理由与依据'
    )
  })
})

describe('saveIssues：编辑态没走过闸门，所以保存时整套再判一次', () => {
  it('等于两屏阻塞项拼起来', () => {
    expect(saveIssues(validForm())).toEqual([])
    expect(saveIssues(emptyCaseForm())).toHaveLength(6)
    expect(saveIssues(emptyCaseForm())).toEqual([
      ...step0Issues(emptyCaseForm()),
      ...step1Issues(emptyCaseForm())
    ])
  })

  it('🔴 第一屏的缺项在保存时仍然拦得住（用户是从台账直接点进编辑弹窗的）', () => {
    expect(saveIssues({ ...validForm(), transactionPrice: null })).toContain('成交价不能为空')
    expect(saveIssues({ ...validForm(), evidenceFileId: null })).toContain('至少上传一份佐证材料')
  })
})

// ==================== 提交装配 ====================

describe('toSaveVO：上行载荷', () => {
  it('🔴 单价框没被碰过 ⇒ unitPrice **缺席**，让后端自己算', () => {
    // 把前端算的值传回去，等于要求两份舍入实现逐位相同 —— 差一分就是一句「单价不一致」
    const untouched = { ...validForm(), unitPrice: 42045.3, unitPriceTouched: false }
    expect(toSaveVO(untouched).unitPrice).toBeUndefined()
  })

  it('碰过 ⇒ 上行；碰过又清空 ⇒ 缺席', () => {
    expect(toSaveVO({ ...validForm(), unitPrice: 42045.3, unitPriceTouched: true }).unitPrice).toBe(
      42045.3
    )
    expect(
      toSaveVO({ ...validForm(), unitPrice: null, unitPriceTouched: true }).unitPrice
    ).toBeUndefined()
    expect(
      toSaveVO({ ...validForm(), unitPrice: undefined, unitPriceTouched: true }).unitPrice
    ).toBeUndefined()
  })

  it('🔴 经纬度都填了才上行 location', () => {
    expect(toSaveVO(validForm()).location).toEqual({ lng: 120.09, lat: 30.28 })
  })

  it('🔴 只填一半 ⇒ location 是 null，**不是** {lng: 120.09, lat: 0}', () => {
    // 半截坐标落成 0 就把案例算到赤道/本初子午线上，
    // 而空间召回那一层把它当成一个真实坐标去比距离。后端拒绝认不出的值、不回落成 0，
    // 前端也不能替它回落
    expect(toSaveVO({ ...validForm(), lat: null }).location).toBeNull()
    expect(toSaveVO({ ...validForm(), lng: undefined }).location).toBeNull()
    expect(toSaveVO({ ...validForm(), lng: null, lat: null }).location).toBeNull()
  })

  it('🔴 全空白的坐标字符串算「没填」，不算 0', () => {
    // 🔴 两处 `as unknown as number` 是刻意的：表单里的经纬度来自 el-input，
    //    用户能敲进去的就是字符串。类型上写 number 是因为**存进库的**是 number，
    //    而 `isBlankNumber` 要同时认这两种形状 —— 只按 number 写的话，
    //    一个全空白的输入框会被 Number('   ') 收成 0，案例就落到赤道上了
    expect(toSaveVO({ ...validForm(), lng: '   ' as unknown as number }).location).toBeNull()
    expect(toSaveVO({ ...validForm(), lat: '' as unknown as number }).location).toBeNull()
  })

  it('空串与全空白一律收成 undefined（JSON 里不出现这一列）', () => {
    const payload = toSaveVO({ ...emptyCaseForm(), remark: '   ', address: '', communityName: '' })
    expect(payload.remark).toBeUndefined()
    expect(payload.address).toBeUndefined()
    expect(payload.communityName).toBeUndefined()
  })

  it('两端空白被剪掉', () => {
    expect(toSaveVO({ ...validForm(), address: '  杭州市西湖区  ' }).address).toBe('杭州市西湖区')
    expect(toSaveVO({ ...validForm(), caseKind: ' RESIDENCE ' }).caseKind).toBe('RESIDENCE')
  })

  it('🔴 四个服务端字段**不上行**：表单里根本不该出现这几个框', () => {
    const payload = toSaveVO(validForm()) as Record<string, any>
    for (const forbidden of ['enteredBy', 'enteredAt', 'isVerified', 'confidence', 'fingerprint']) {
      expect(payload).not.toHaveProperty(forbidden)
    }
  })

  it('字符串数字转成数字（el-input 给的是字符串）', () => {
    const payload = toSaveVO({
      ...validForm(),
      transactionPrice: '3805100' as unknown as number,
      buildingArea: '90.5' as unknown as number,
      builtYear: '2009' as unknown as number
    })
    expect(payload.transactionPrice).toBe(3805100)
    expect(payload.buildingArea).toBe(90.5)
    expect(payload.builtYear).toBe(2009)
  })

  it('成交日期为空 ⇒ undefined，不是空串（空串会被 LocalDate 解析器拒成 400）', () => {
    expect(toSaveVO({ ...validForm(), transactionDate: '' }).transactionDate).toBeUndefined()
  })

  it('attrs 缺席时上行 null（不是 undefined：扩展字段那层要区分「没这列」与「清空这列」）', () => {
    expect(toSaveVO({ ...validForm(), attrs: undefined }).attrs).toBeNull()
    expect(toSaveVO({ ...validForm(), attrs: { 朝向备注: '南' } }).attrs).toEqual({ 朝向备注: '南' })
  })

  it('id 原样带上（新增态是 undefined，编辑态是原编号）', () => {
    expect(toSaveVO(validForm()).id).toBeUndefined()
    expect(toSaveVO({ ...validForm(), id: 7001 }).id).toBe(7001)
  })

  it('🔴 可写列一份不多一份不少（对照 QlzgCaseSaveVO 的 27 个字段）', () => {
    // 这是一份**手写**的黄金副本。后端加一列而这里没跟上时它变红 ——
    // 那时要做的判断是「新列该不该出现在表单上」，不是把断言里的数字改大
    // ⚠️ `lng` / `lat` **不在**清单里：它们是表单模型的两个分量，
    //    上行时合成一个 `location` 对象（后端 `normalizeLocation` 只认这两个键，多一个少一个都拒）
    expect(Object.keys(toSaveVO(validForm())).sort()).toEqual(
      [
        'address',
        'attrs',
        'buildingArea',
        'builtYear',
        'caseKind',
        'cityCode',
        'communityName',
        'decoration',
        'districtCode',
        'evidenceFileId',
        'evidenceKind',
        'floorInfo',
        'id',
        'location',
        'orientation',
        'originUrl',
        'purpose',
        'realPriceRestored',
        'remark',
        'restoreReason',
        'rightType',
        'sourceId',
        'sourceType',
        'structure',
        'transactionDate',
        'transactionPrice',
        'unitPrice'
      ].sort()
    )
  })
})

// ==================== 回显 ====================

/** 一行填满的台账数据：每一列都有值，专门用来抓「漏了一列」 */
const fullRow = (): QlzgCaseVO => ({
  id: 7001,
  caseKind: 'RESIDENCE',
  sourceType: 'MANUAL',
  sourceTypeDescription: '人工录入',
  sourceId: undefined,
  sourceName: undefined,
  cityCode: '330100',
  districtCode: '330106',
  communityName: '文鼎苑',
  address: '杭州市西湖区文一西路 100 号',
  location: { lng: 120.09, lat: 30.28 },
  purpose: '住宅',
  rightType: '出让',
  transactionDate: '2026-03-15',
  transactionPrice: 3805100,
  buildingArea: 90.5,
  unitPrice: 42045.3,
  realPriceRestored: 4200000,
  restoreReason: '按契税完税凭证还原做低部分',
  floorInfo: '12/18',
  orientation: '南',
  decoration: '精装',
  builtYear: 2009,
  structure: '钢混',
  originUrl: 'https://example.invalid/deed/7001',
  evidenceFileId: 90001,
  evidenceKind: 'DEED',
  evidenceKindDescription: '不动产权证',
  enteredBy: 1,
  enteredByNickname: '评估一部',
  enteredAt: new Date(1780000000000),
  confidence: 0.9,
  isVerified: true,
  fingerprint: 'fp-7001',
  tenantScope: 'PRIVATE',
  tenantScopeDescription: '本机构私有库',
  editable: true,
  disclosureText: '本案例由本机构评估人员人工搜集录入。',
  attrs: { 车位: '含一个' },
  remark: '同一栋楼第三次成交',
  createTime: new Date(1780000000000)
})

describe('fromRespVO：台账那一行 → 表单模型', () => {
  it('🔴 表单模型的键集合与 emptyCaseForm 完全一致（漏一列这里就红）', () => {
    // 这一条是「穷尽性」的**结构**半边：`QlzgCaseFormModel` 加了字段、
    // `emptyCaseForm` 跟上了、而 `fromRespVO` 忘了 —— 新增态看不出来，
    // 只有编辑态会漏，而漏掉的列在整行替换语义下会被清空
    expect(Object.keys(fromRespVO(fullRow())).sort()).toEqual(Object.keys(emptyCaseForm()).sort())
  })

  it('🔴🔴 toSaveVO(fromRespVO(row)) 与原行逐列等价（整行替换语义下的穷尽性用例）', () => {
    // `caseSchema.ts` 的 fromRespVO 注释里承诺的就是这一条。
    // 语义是**整行替换**：入参为空的列会被写成 SQL NULL。
    // 所以「打开编辑弹窗 → 什么都不动 → 保存」必须一列都不丢，
    // 而丢列的表现是**没有任何征兆** —— 界面是一个正常的编辑弹窗加一句「修改成功」
    const row = fullRow()
    const payload = toSaveVO(fromRespVO(row))

    expect(payload.id).toBe(row.id)
    expect(payload.caseKind).toBe(row.caseKind)
    expect(payload.sourceType).toBe(row.sourceType)
    expect(payload.sourceId).toBeUndefined() // 人工录入不挂数据源，原行也没有
    expect(payload.cityCode).toBe(row.cityCode)
    expect(payload.districtCode).toBe(row.districtCode)
    expect(payload.communityName).toBe(row.communityName)
    expect(payload.address).toBe(row.address)
    expect(payload.location).toEqual({ lng: 120.09, lat: 30.28 })
    expect(payload.purpose).toBe(row.purpose)
    expect(payload.rightType).toBe(row.rightType)
    expect(payload.transactionDate).toBe(row.transactionDate)
    expect(payload.transactionPrice).toBe(row.transactionPrice)
    expect(payload.buildingArea).toBe(row.buildingArea)
    expect(payload.realPriceRestored).toBe(row.realPriceRestored)
    expect(payload.restoreReason).toBe(row.restoreReason)
    expect(payload.floorInfo).toBe(row.floorInfo)
    expect(payload.orientation).toBe(row.orientation)
    expect(payload.decoration).toBe(row.decoration)
    expect(payload.builtYear).toBe(row.builtYear)
    expect(payload.structure).toBe(row.structure)
    expect(payload.originUrl).toBe(row.originUrl)
    expect(payload.evidenceFileId).toBe(row.evidenceFileId)
    expect(payload.evidenceKind).toBe(row.evidenceKind)
    expect(payload.attrs).toEqual(row.attrs)
    expect(payload.remark).toBe(row.remark)

    // 🔴 **单价是唯一的例外**，而它是刻意的：库里那个值是后端算出来的，
    //    原样传回去等于宣称「用户填过它」。缺席之后后端重算，
    //    同一个算式 + 同一个舍入 ⇒ 结果与库里那个逐位相同
    expect(payload.unitPrice).toBeUndefined()
    expect(computedUnitPrice(row.transactionPrice, row.buildingArea)).toBe(row.unitPrice)

    // 🔴 服务端那五列**不在**上行载荷里：带着它们发回去会被忽略，
    //    但更重要的是表单里不该有这几个框（一个能勾的「已核实」等于白送打分表里的 10 分）
    const sent = payload as Record<string, any>
    for (const readOnly of ['enteredBy', 'enteredAt', 'isVerified', 'confidence', 'fingerprint']) {
      expect(sent).not.toHaveProperty(readOnly)
    }
    expect(row.isVerified).toBe(true) // 原行确实有值，所以这条不是「恰好都为空」的假绿
  })

  it('🔴 unitPriceTouched 恒为 false，即使库里那个单价就在眼前', () => {
    expect(fromRespVO(fullRow()).unitPriceTouched).toBe(false)
    expect(fromRespVO(fullRow()).unitPrice).toBe(42045.3) // 值仍要回显给用户看
  })

  it('priceRestoredFlag 从还原价**推导**出来，不依赖任何一列布尔', () => {
    expect(fromRespVO(fullRow()).priceRestoredFlag).toBe(true)
    expect(fromRespVO({ ...fullRow(), realPriceRestored: undefined }).priceRestoredFlag).toBe(false)
    expect(fromRespVO({ ...fullRow(), realPriceRestored: null }).priceRestoredFlag).toBe(false)
  })

  it('🔴 evidenceFileName 恒为空串：RespVO 里没有文件名', () => {
    // 所以界面上要显示「已上传（编号 90001）」而不是一个空框 ——
    // 空框看起来像「什么都没传」，而 evidenceFileId 明明有值，屏 2 也照样放行
    expect(fromRespVO(fullRow()).evidenceFileName).toBe('')
    expect(fromRespVO(fullRow()).evidenceFileId).toBe(90001)
  })

  it('空列落成空串 / null（表单里的「空」用这两种表示，不用 undefined）', () => {
    const bare = fromRespVO({ id: 7002, caseKind: 'RESIDENCE', sourceType: 'MANUAL' })
    expect(bare.cityCode).toBe('')
    expect(bare.communityName).toBe('')
    expect(bare.transactionDate).toBe('')
    expect(bare.transactionPrice).toBeNull()
    expect(bare.buildingArea).toBeNull()
    expect(bare.unitPrice).toBeNull()
    expect(bare.evidenceFileId).toBeNull()
    expect(bare.attrs).toBeNull()
    expect(bare.lng).toBeNull()
    expect(bare.lat).toBeNull()
  })

  it('location 只有一半时，另一半落成 null（于是 toSaveVO 会把整个 location 收掉）', () => {
    const half = fromRespVO({ ...fullRow(), location: { lng: 120.09 } })
    expect(half.lng).toBe(120.09)
    expect(half.lat).toBeNull()
    expect(toSaveVO(half).location).toBeNull()
  })

  it('🔴 sourceType 原样带着：后端不让改它，而「带着原值发回去」才是「没改」', () => {
    expect(fromRespVO({ ...fullRow(), sourceType: 'API' }).sourceType).toBe('API')
    expect(toSaveVO(fromRespVO({ ...fullRow(), sourceType: 'API' })).sourceType).toBe('API')
  })

  it('transactionDate 上来就是 ISO 字符串，日期选择器用 value-format 直接吃', () => {
    expect(fromRespVO(fullRow()).transactionDate).toBe('2026-03-15')
  })
})

describe('carryOverForNextEntry：保存并继续录下一条', () => {
  it('留下同一批案例之间不变的那几样', () => {
    const next = carryOverForNextEntry(validForm())
    expect(next.caseKind).toBe('RESIDENCE')
    expect(next.cityCode).toBe('330100')
    expect(next.districtCode).toBe('330106')
    expect(next.purpose).toBe('住宅')
    expect(next.rightType).toBe('出让')
  })

  it('🔴 佐证材料**必须清掉**：留着的话第二条案例会挂着第一条的截图', () => {
    // 而两行的披露文本各自引用自己的附件名，存进去之后
    // 「这条案例的证据是哪一份」就再也查不出来了，且没有一处报错
    const next = carryOverForNextEntry(validForm())
    expect(next.evidenceFileId).toBeNull()
    expect(next.evidenceFileName).toBe('')
    expect(next.evidenceKind).toBe('')
  })

  it('清掉每条都不同的那些', () => {
    const next = carryOverForNextEntry({ ...validForm(), id: 7001 })
    expect(next.id).toBeUndefined() // 🔴 留着 id 的话第二条会 UPDATE 掉第一条
    expect(next.communityName).toBe('')
    expect(next.address).toBe('')
    expect(next.transactionDate).toBe('')
    expect(next.transactionPrice).toBeNull()
    expect(next.buildingArea).toBeNull()
    expect(next.unitPrice).toBeNull()
    expect(next.unitPriceTouched).toBe(false)
    expect(next.realPriceRestored).toBeNull()
    expect(next.priceRestoredFlag).toBe(false)
    expect(next.restoreReason).toBe('')
    expect(next.remark).toBe('')
    expect(next.originUrl).toBe('')
    expect(next.attrs).toBeNull()
    expect(next.lng).toBeNull()
    expect(next.lat).toBeNull()
  })

  it('🔴 造出来的是一份新表单，改它不会动到原来那份（批量录入时原表单还在屏上）', () => {
    const original = validForm()
    const next = carryOverForNextEntry(original)
    expect(next).not.toBe(original)
    next.communityName = '第二条案例的小区'
    expect(original.communityName).toBe('文鼎苑')
  })

  it('带走的那份表单过不了屏 1 的闸门（成交价与日期都已清空），这是对的', () => {
    expect(canGoNextStep(0, carryOverForNextEntry(validForm()))).toBe(false)
  })
})

// ==================== 导入 ====================

const issue = (level: string, over: Partial<QlzgCaseImportIssueVO> = {}): QlzgCaseImportIssueVO => ({
  level,
  message: `${level} 一条`,
  ...over
})

describe('summarizeIssues：三档计数', () => {
  it('没有清单 ⇒ 三个 0', () => {
    expect(summarizeIssues()).toEqual({ error: 0, warning: 0, skipped: 0 })
    expect(summarizeIssues(null)).toEqual({ error: 0, warning: 0, skipped: 0 })
    expect(summarizeIssues([])).toEqual({ error: 0, warning: 0, skipped: 0 })
  })

  it('各档分别数', () => {
    expect(
      summarizeIssues([
        issue('ERROR'),
        issue('ERROR'),
        issue('WARNING'),
        issue('SKIPPED'),
        issue('SKIPPED'),
        issue('SKIPPED')
      ])
    ).toEqual({ error: 2, warning: 1, skipped: 3 })
  })

  it('🔴 SKIPPED 单列，**不并进 error**', () => {
    // 那是指纹撞车被去重（这批里本来就有 30 条在库里），不是导坏了。
    // 并到一起的表现是用户以为「失败了 30 条」，于是重导一次 ——
    // 而重导多少次结果都一样，因为撞的还是同一批指纹
    const summary = summarizeIssues([issue('SKIPPED'), issue('SKIPPED')])
    expect(summary.skipped).toBe(2)
    expect(summary.error).toBe(0)
  })

  it('认不出的档位不计入任何一档（后端加了新档时这里会少数，而不是错数）', () => {
    expect(summarizeIssues([issue('INFO'), issue('error')])).toEqual({
      error: 0,
      warning: 0,
      skipped: 0
    })
  })
})

describe('previewBlockingIssue：判据是文件级问题，不是行级错误数', () => {
  it('还没有预检结果', () => {
    expect(previewBlockingIssue()).toBe('还没有预检结果')
    expect(previewBlockingIssue(null)).toBe('还没有预检结果')
  })

  it('🔴 200 条里有 7 条错**不拦**：§11.2.3 要求行级错误、不整批失败', () => {
    const preview: QlzgCaseImportPreviewVO = {
      total: 200,
      validCount: 193,
      invalidCount: 7,
      warningCount: 12,
      fileIssues: [],
      rows: []
    }
    // 用户看完失败报告照样可以点「开始导入」，那 193 条会进去。
    // 拿 invalidCount 当判据的话，一个正常的批次会被整份拦下
    expect(previewBlockingIssue(preview)).toBeNull()
  })

  it('🔴 文件级问题非空 ⇒ 拦，并把每条原文拼出来', () => {
    const preview: QlzgCaseImportPreviewVO = {
      total: 0,
      invalidCount: 0,
      fileIssues: [issue('ERROR', { message: '表头缺少「成交日期」列' }), issue('ERROR', { message: '文件不是 xlsx' })]
    }
    expect(previewBlockingIssue(preview)).toBe('表头缺少「成交日期」列；文件不是 xlsx')
  })

  it('文件级问题优先于「没有数据行」（两件事同时成立时只说更要紧的那件）', () => {
    const preview: QlzgCaseImportPreviewVO = {
      total: 0,
      fileIssues: [issue('ERROR', { message: '表头对不上' })]
    }
    expect(previewBlockingIssue(preview)).toBe('表头对不上')
  })

  it('没有数据行 ⇒ 拦，并说清模板里的示例行不算数据', () => {
    expect(previewBlockingIssue({ total: 0, fileIssues: [] })).toContain('示例行')
    expect(previewBlockingIssue({ fileIssues: [] })).toContain('示例行') // total 缺席按 0 算
  })

  it('只跳过了示例行、数据行有 ⇒ 放行', () => {
    expect(previewBlockingIssue({ total: 30, skippedExampleCount: 3, fileIssues: [] })).toBeNull()
  })

  it('文件级问题缺 message 时退到 fieldLabel，再退到一句兜底', () => {
    expect(previewBlockingIssue({ total: 5, fileIssues: [issue('ERROR', { message: undefined, fieldLabel: '成交日期' })] })).toBe(
      '成交日期'
    )
    expect(previewBlockingIssue({ total: 5, fileIssues: [issue('ERROR', { message: undefined })] })).toBe(
      '文件有问题'
    )
  })

  it('fileIssues 缺席（后端没给这个键）不等于有问题', () => {
    expect(previewBlockingIssue({ total: 8 })).toBeNull()
  })
})

describe('newImportToken：一次导入一个幂等键', () => {
  it('非空、且两次调用给的不是同一个', () => {
    const a = newImportToken()
    const b = newImportToken()
    expect(a).toBeTruthy()
    expect(b).toBeTruthy()
    expect(a).not.toBe(b)
  })

  it('🔴 长度够长（太短的话两次导入撞上同一个键，第二份文件的内容一条都不会进去）', () => {
    expect(newImportToken().length).toBeGreaterThanOrEqual(16)
  })

  it('连开 200 个也不重复', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => newImportToken()))
    expect(tokens.size).toBe(200)
  })
})

describe('shouldStopPolling：判 terminal 布尔，不判 status 枚举', () => {
  it('terminal 为 true 才停', () => {
    expect(shouldStopPolling({ terminal: true })).toBe(true)
    expect(shouldStopPolling({ terminal: false })).toBe(false)
  })

  it('🔴 拿不到进度 ⇒ 不停', () => {
    // `/import-progress` 顺带做孤儿任务的懒回收：进程被 kill 之后留下的 RUNNING 行，
    // 是由**下一次查询**判成 INTERRUPTED 的。停止轮询 ⇒ 它永远不会被回收，
    // 于是台账上永远挂着一个「执行中」
    expect(shouldStopPolling()).toBe(false)
    expect(shouldStopPolling(null)).toBe(false)
    expect(shouldStopPolling({})).toBe(false)
  })

  it('🔴 status 与 terminal 冲突时以 terminal 为准（多一种终态时按枚举写的条件会漏掉它）', () => {
    expect(shouldStopPolling({ status: 'FAILED', terminal: false } as any)).toBe(false)
    expect(shouldStopPolling({ status: 'RUNNING', terminal: true } as any)).toBe(true)
    expect(shouldStopPolling({ status: 'CANCELLED', terminal: true } as any)).toBe(true)
  })
})
