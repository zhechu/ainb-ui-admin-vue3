import { describe, expect, it } from 'vitest'
import type { QlzgEntityType } from '@/api/qlzg/fieldDef'
import {
  CALCULATION_STATUS_OPTIONS,
  CASE_DECORATION_SUGGESTIONS,
  CASE_IMPORT_ISSUE_LEVEL_OPTIONS,
  CASE_ORIENTATION_SUGGESTIONS,
  CASE_PROVIDER_TYPE_OPTIONS,
  CASE_RIGHT_TYPE_SUGGESTIONS,
  CASE_SOURCE_STATUS_OPTIONS,
  CASE_SOURCE_TYPE_OPTIONS,
  CASE_TASK_STATUS_OPTIONS,
  CASE_TENANT_SCOPE_OPTIONS,
  CASE_USAGE_SUGGESTIONS,
  CLASSIFY_SOURCE_OPTIONS,
  CLIENT_TYPE_OPTIONS,
  COMBINE_TYPES_NEEDING_FINAL_VALUE,
  COMBINE_TYPE_OPTIONS,
  ENTITY_TYPE_OPTIONS,
  EXTRACT_STATUS_OPTIONS,
  LAW_DOMAIN_OPTIONS,
  MATERIAL_CATEGORY_OPTIONS,
  PARAM_DEFAULT_STRATEGY_OPTIONS,
  PARAM_PLATFORM_LEVEL_OPTIONS,
  PARAM_SCOPE,
  PARAM_SOURCE_TYPE_OPTIONS,
  PARAM_STATUS_OPTIONS,
  PARAM_TYPE_LABELS,
  PROJECT_STATUS_OPTIONS,
  PURPOSE_OPTIONS,
  REPORT_VERSION_DIFF_FIELD_KINDS,
  REPORT_VERSION_DIFF_FIELD_KIND_LABELS,
  REPORT_VERSION_DIFF_FIELD_KIND_TAG_TYPES,
  REPORT_VERSION_DIFF_SECTION_KINDS,
  REPORT_VERSION_DIFF_SECTION_KIND_LABELS,
  REPORT_VERSION_DIFF_SECTION_KIND_TAG_TYPES,
  REVIEW_INHERIT,
  REVIEW_INHERIT_LABEL,
  REVIEW_INHERIT_LABEL_REPORT,
  REVIEW_MODE_CONSEQUENCES,
  REVIEW_MODE_OPTIONS,
  REVIEW_REASON_MAX_LENGTH,
  REVIEW_REASON_MIN_LENGTH,
  REVIEW_RUN_STATUS_OPTIONS,
  RULE_SEVERITY_OPTIONS,
  RULE_SEVERITY_ORDER,
  RULE_TARGET_KIND_OPTIONS,
  SUBJECT_TYPE_OPTIONS,
  UNKNOWN_LABEL_FALLBACK,
  UNCLASSIFIED,
  UPLOADER_CLIENT_TYPE_OPTIONS,
  VALUATION_METHOD_MVP_OPTIONS,
  VALUE_TYPE_OPTIONS,
  VERSION_NOT_DIFFABLE_LABEL,
  WAIVE_SCOPE_OPTIONS,
  calculationStatusTagType,
  caseDispositionTagType,
  caseIssueLevelTagType,
  caseTaskStatusTagType,
  caseTenantScopeTagType,
  combineTypeNeedsFinalValue,
  extractRetryable,
  extractStatusLabel,
  extractStatusTagType,
  labelOf,
  labelOfNumber,
  paramStatusTagType,
  projectStatusTagType,
  reviewModeConsequence,
  reviewModeTagType,
  reviewRunStatusTagType,
  ruleSeverityTagType,
  uploaderClientTypeLabel,
  versionCreatorText,
  versionDiffFieldKindLabel,
  versionDiffFieldKindTagType,
  versionDiffSectionKindLabel,
  versionDiffSectionKindTagType,
  versionDiffTemplateText,
  type QlzgOption
} from './constants'

/**
 * 枚举展示层的守卫。
 *
 * 🔴 下面每一份 `ENUM_ORDER` 都是后端 Java 枚举的**黄金副本**：后端加了码而这里没跟上，
 *    对应的用例必须失败，逼人做一次显式决定（加进来、标好颜色），
 *    而不是让筛选下拉里静默少一个选项。
 *
 * 抄错一个码不会报错，坏法很具体：筛选下拉里选了「已抽取」，发出去的却是 `SUCCEED`，
 * 后端 `QlzgExtractStatusEnum.of()` 返回 null，那一支查询条件被**静默忽略** ——
 * 用户看到的是「筛了没用，还是全都在」。
 *
 * ⚠️ 改这里的顺序之前先去改后端枚举，两边必须同步。后端枚举在
 *    `enlev-module-qlzg/src/main/java/cn/enlev/ainb/module/qlzg/enums/`。
 */

/** 通用形状检查：每份选项表都要过 */
const expectWellFormed = (options: QlzgOption[]) => {
  const values = options.map((item) => item.value)
  const labels = options.map((item) => item.label)
  // 重复的 value = 两个不同选项发同一个码；重复的 label = 用户在下拉里看到两个一样的字
  expect(new Set(values).size).toBe(values.length)
  expect(new Set(labels).size).toBe(labels.length)
  // 首尾空白的 label 在 el-option 里看不出来，但会让「按中文反查」这类代码悄悄失配
  expect(labels.every((label) => label.length > 0 && label === label.trim())).toBe(true)
  expect(values.every((value) => value.length > 0 && value === value.trim())).toBe(true)
}

describe('CLIENT_TYPE_OPTIONS ← QlzgClientTypeEnum', () => {
  it('与后端枚举逐字一致、顺序一致', () => {
    expect(CLIENT_TYPE_OPTIONS.map((item) => item.value)).toEqual([
      'PERSON',
      'ENTERPRISE',
      'GOVERNMENT',
      'COURT'
    ])
    expectWellFormed(CLIENT_TYPE_OPTIONS)
  })
})

describe('PROJECT_STATUS_OPTIONS ← QlzgProjectStatusEnum', () => {
  it('9 档状态按流转顺序排（INIT → … → ARCHIVED → VOIDED）', () => {
    expect(PROJECT_STATUS_OPTIONS.map((item) => item.value)).toEqual([
      'INIT',
      'MATERIAL',
      'SURVEY',
      'VALUING',
      'REPORTING',
      'REVIEWING',
      'SIGNED',
      'ARCHIVED',
      'VOIDED'
    ])
    expectWellFormed(PROJECT_STATUS_OPTIONS)
  })

  it('🔴 VOIDED 必须是红的，ARCHIVED / SIGNED 是绿的', () => {
    // 作废的项目在列表里必须一眼看得出来：它还挂在导航里、还能被搜出来，
    // 而「已作废」用主色显示的话，评估师会在一个死项目上继续收资料
    expect(projectStatusTagType('VOIDED')).toBe('danger')
    expect(projectStatusTagType('ARCHIVED')).toBe('success')
    expect(projectStatusTagType('SIGNED')).toBe('success')
    expect(projectStatusTagType('REVIEWING')).toBe('warning')
    expect(projectStatusTagType('INIT')).toBe('info')
  })

  it('进行中的四档与未知码一律主色 —— 未知码不该看起来像出事了', () => {
    for (const status of ['MATERIAL', 'SURVEY', 'VALUING', 'REPORTING', 'WHATEVER', undefined]) {
      expect(projectStatusTagType(status)).toBe('primary')
    }
  })
})

describe('SUBJECT_TYPE_OPTIONS ← QlzgSubjectTypeEnum', () => {
  it('10 类标的逐字一致', () => {
    expect(SUBJECT_TYPE_OPTIONS.map((item) => item.value)).toEqual([
      'REAL_ESTATE',
      'EQUITY',
      'ENTERPRISE',
      'DEVICE',
      'INTANGIBLE',
      'DATA_ASSET',
      'MINING_RIGHT',
      'FOREST',
      'LAND_USE_RIGHT',
      'FINANCIAL_INSTRUMENT'
    ])
    expectWellFormed(SUBJECT_TYPE_OPTIONS)
  })
})

describe('MATERIAL_CATEGORY_OPTIONS ← QlzgMaterialCategoryEnum', () => {
  it('8 类资料逐字一致', () => {
    expect(MATERIAL_CATEGORY_OPTIONS.map((item) => item.value)).toEqual([
      'ENTRUST',
      'OWNERSHIP',
      'SURVEY',
      'FINANCIAL',
      'INVOICE',
      'INTERNAL_CONTROL',
      'PROMISE_LETTER',
      'OTHER'
    ])
    expectWellFormed(MATERIAL_CATEGORY_OPTIONS)
  })

  it('🔴 OTHER 必须 selectable', () => {
    // 不给兜底，用户就会随手挑一个看起来最像的类别填上去 —— 而错类比无类更坏：
    // 无类在缺件面板上是看得见的缺口，错类会让缺件检测以为这一项已经齐了
    expect(MATERIAL_CATEGORY_OPTIONS.map((item) => item.value)).toContain('OTHER')
    expect(MATERIAL_CATEGORY_OPTIONS.find((item) => item.value === 'OTHER')?.label).toBe('其他')
  })
})

describe('EXTRACT_STATUS_OPTIONS ← QlzgExtractStatusEnum', () => {
  it('5 档抽取状态逐字一致', () => {
    expect(EXTRACT_STATUS_OPTIONS.map((item) => item.value)).toEqual([
      'PENDING',
      'RUNNING',
      'SUCCESS',
      'FAILED',
      'SKIPPED_TOO_LARGE'
    ])
    expectWellFormed(EXTRACT_STATUS_OPTIONS)
  })

  it('🔴 SKIPPED_TOO_LARGE 是 info，**不是 danger**', () => {
    // 它不是失败，是「按规则跳过」：文件本身完全可用（能下载、能归档），只是搜不到里面的字。
    // 标成红的表现是用户以为这份资料坏了、反复重传，而重传多少次结果都一样
    expect(extractStatusTagType('SKIPPED_TOO_LARGE')).toBe('info')
    expect(extractStatusTagType('FAILED')).toBe('danger')
    expect(extractStatusTagType('SUCCESS')).toBe('success')
  })

  it('PENDING / RUNNING / 未知码一律主色（还在转，不是出事）', () => {
    for (const status of ['PENDING', 'RUNNING', 'RETRY_WAITING', undefined]) {
      expect(extractStatusTagType(status)).toBe('primary')
    }
  })

  it('🔴 extractStatusLabel 认不出的码**回落到码本身**，不落到「未知」', () => {
    // 回落成「未知」会把脏数据藏起来：界面上既看不出这一行是什么状态，
    // 也看不出它是没人跑过的新码。原样显示才看得出「后端加了一个前端不认识的状态」
    expect(extractStatusLabel('RETRY_WAITING')).toBe('RETRY_WAITING')
    expect(extractStatusLabel('SUCCESS')).toBe('已抽取')
    expect(extractStatusLabel(undefined)).toBe(UNKNOWN_LABEL_FALLBACK)
  })
})

describe('extractRetryable：与后端 reExtract 的放行条件互为镜像', () => {
  it('FAILED 放行（终态但可重抽）', () => {
    expect(extractRetryable(true, 'FAILED')).toBe(true)
  })

  it('🔴 非终态也放行 —— 非终态不等于「正在抽」', () => {
    // PENDING 可能是派发被线程池拒了 / 派发时没有租户上下文 / JVM 崩在派发之前；
    // RUNNING 可能是占着它的 worker 已失联。一律拒的话这些资料永远转圈且一个按钮都点不动，
    // 而日志里只有一条 ERROR
    expect(extractRetryable(false, 'PENDING')).toBe(true)
    expect(extractRetryable(false, 'RUNNING')).toBe(true)
    expect(extractRetryable(false, undefined)).toBe(true)
  })

  it('SUCCESS 与 SKIPPED_TOO_LARGE 不放行', () => {
    // SUCCESS 不能重抽是因为**正文的段落序号是溯源定位（I6）的落点**，
    // 重抽会让已归档报告指向错误的段落
    expect(extractRetryable(true, 'SUCCESS')).toBe(false)
    expect(extractRetryable(true, 'SKIPPED_TOO_LARGE')).toBe(false)
  })

  it('🔴 判据是 extractTerminal，**不是**状态码集合', () => {
    // 后端加了 RETRY_WAITING（非终态）时，这一支必须自动放行 ——
    // 如果实现里写的是 ['PENDING','RUNNING'].includes(status)，这条会失败
    expect(extractRetryable(false, 'RETRY_WAITING')).toBe(true)
  })
})

describe('CLASSIFY_SOURCE_OPTIONS ← QlzgClassifySourceEnum', () => {
  it('两档，且 AI 那一档**保留**', () => {
    expect(CLASSIFY_SOURCE_OPTIONS.map((item) => item.value)).toEqual(['MANUAL', 'AI'])
    expectWellFormed(CLASSIFY_SOURCE_OPTIONS)
    // AI 在 I1 不会出现（那是 M1/I8 的事），但库里将来会有 AI 归类的行，
    // 筛选时少了这一档就等于「那批资料查不出来」
  })
})

describe('UPLOADER_CLIENT_TYPE_OPTIONS：⚠️ 不是 Java 枚举', () => {
  it('三档，且不做「取值封闭」的断言', () => {
    expect(UPLOADER_CLIENT_TYPE_OPTIONS.map((item) => item.value)).toEqual([
      'web',
      'app',
      'desktop'
    ])
    expectWellFormed(UPLOADER_CLIENT_TYPE_OPTIONS)
  })

  it('认不出的值回落到原值 —— 后端解析不出来时会兜一个值，加了新端也会多出新取值', () => {
    expect(uploaderClientTypeLabel('miniapp')).toBe('miniapp')
    expect(uploaderClientTypeLabel('web')).toBe('网页端')
    expect(uploaderClientTypeLabel(null)).toBe(UNKNOWN_LABEL_FALLBACK)
    expect(uploaderClientTypeLabel(undefined)).toBe(UNKNOWN_LABEL_FALLBACK)
  })
})

describe('PARAM_SCOPE / PARAM_TYPE_LABELS ← QlzgParamScopeEnum / QlzgParamTypeEnum', () => {
  it('三个作用域逐字一致', () => {
    expect(Object.values(PARAM_SCOPE)).toEqual(['SUBJECT_ATTR', 'PARAM', 'REPORT_FIELD'])
  })

  it('🔴 六个值类型都有中文，且 GEO 在列', () => {
    expect(Object.keys(PARAM_TYPE_LABELS)).toEqual([
      'DECIMAL',
      'INT',
      'STRING',
      'ENUM',
      'DATE',
      'GEO'
    ])
    expect(Object.values(PARAM_TYPE_LABELS).every((label) => label.length > 0)).toBe(true)
    // GEO 是唯一一个 projectable=false 的类型（经纬度不参与测算），
    // 少了它的中文名，标的属性表单会把 lat/lng 渲染成裸码
  })
})

describe('PURPOSE_OPTIONS / VALUE_TYPE_OPTIONS：🔴 前端的兜底清单，后端无枚举无字典', () => {
  it('两份都过形状检查，且都有 OTHER / 兜底档', () => {
    expectWellFormed(PURPOSE_OPTIONS)
    expectWellFormed(VALUE_TYPE_OPTIONS)
    expect(PURPOSE_OPTIONS.map((item) => item.value)).toContain('OTHER')
  })

  it('VALUE_TYPE_OPTIONS 含市场价值与五种非市场价值', () => {
    // R24（I5）要求选了非市场价值时必须写理由与定义，所以这一份清单是那条规则的输入。
    // 少一档 = 那一种价值类型选不出来 = R24 永远不触发
    expect(VALUE_TYPE_OPTIONS.map((item) => item.value)).toEqual([
      'MARKET_VALUE',
      'INVESTMENT_VALUE',
      'VALUE_IN_USE',
      'LIQUIDATION_VALUE',
      'RESIDUAL_VALUE',
      'MARKET_RENT'
    ])
  })

  it('⚠️ 刻意**不开** allow-create：这份清单是常量数组，不是可编辑配置', () => {
    // 让用户自由输入会让 qlzg_project.purpose 这一列里混进码和中文两种形态，
    // 而 R22（I2）与 G-05…G-08（I20）都按码判。OTHER 是兜底，任何目的都能落进来，
    // 所以「清单里没有我要的」不会挡住用户
    expect(Array.isArray(PURPOSE_OPTIONS)).toBe(true)
  })
})

describe('labelOf：按码取中文', () => {
  it('认不出的码**回落到码本身**，不落到空白', () => {
    expect(labelOf(CLIENT_TYPE_OPTIONS, 'PERSON')).toBe('个人')
    expect(labelOf(CLIENT_TYPE_OPTIONS, 'ROBOT')).toBe('ROBOT')
  })

  it('空值返回空串 —— 那时该显示的是「未归类」这类占位，由调用方决定', () => {
    expect(labelOf(CLIENT_TYPE_OPTIONS, null)).toBe('')
    expect(labelOf(CLIENT_TYPE_OPTIONS, undefined)).toBe('')
    expect(labelOf(CLIENT_TYPE_OPTIONS, '')).toBe('')
  })

  it('占位常量与「未知」常量都不为空', () => {
    expect(UNCLASSIFIED).toBe('未归类')
    expect(UNKNOWN_LABEL_FALLBACK).toBe('未知')
  })
})

describe('labelOfNumber：数字取值的 label', () => {
  it('🔴 0 要能翻出来 —— 它不是「没有值」', () => {
    // CommonStatusEnum 那一类码是数字，而 0 正是「停用」这一档。
    // 拿 labelOf 去比（或把选项表写成 '0' / '1'）的表现是这一格永远显示不出「停用」，
    // 而台账上停用的行**必须**看得出来：四维回退查参时它们是被过滤掉的
    expect(labelOfNumber(PARAM_STATUS_OPTIONS, 0)).toBe('停用')
    expect(labelOfNumber(PARAM_STATUS_OPTIONS, 1)).toBe('启用')
    expect(labelOfNumber(CASE_SOURCE_STATUS_OPTIONS, 0)).toBe('停用')
  })

  it('空值与认不出的码都落到 —，刻意**不**回落到码本身', () => {
    // 与 labelOf 相反：字符串码原样显示看得出是脏数据（ROBOT），
    // 而数字码原样显示出来是 7，与「这一格没有值」在界面上是同一副样子，
    // 所以这里用占位符把两者分开
    expect(labelOfNumber(PARAM_STATUS_OPTIONS, undefined)).toBe('—')
    expect(labelOfNumber(PARAM_STATUS_OPTIONS, null)).toBe('—')
    expect(labelOfNumber(PARAM_STATUS_OPTIONS, 7)).toBe('—')
  })
})

describe('ENTITY_TYPE_OPTIONS：能挂扩展字段的五个宿主', () => {
  it('🔴 与 API 层的 QlzgEntityType 联合类型双向一致', () => {
    // 类型层面：Record<QlzgEntityType, true> 是**穷尽**的 —— 联合类型少一个键这里就编译不过。
    // 运行层面：下面这句把那份穷尽的键集合与常量数组比对，多一项少一项都失败。
    // 🔴 两侧都要：只靠类型的话「ENTITY_TYPE_OPTIONS 里多写了一个后端不认的码」不会被发现，
    //    而那个码提交上去会撞 FIELD_DEF_ENTITY_TYPE_INVALID，管理员看到的是「选了却存不下」
    const exhaustive: Record<QlzgEntityType, true> = {
      QLZG_PROJECT: true,
      QLZG_SUBJECT: true,
      QLZG_CLIENT: true,
      QLZG_MATERIAL: true,
      QLZG_REPORT: true
    }
    expect(ENTITY_TYPE_OPTIONS.map((item) => item.value)).toEqual(Object.keys(exhaustive))
  })

  it('中文与后端 QlzgEntityTypeEnum 的 description 逐字一致', () => {
    expect(ENTITY_TYPE_OPTIONS.map((item) => item.label)).toEqual([
      '评估项目',
      '评估标的',
      '委托方',
      '评估资料',
      '评估报告'
    ])
  })

  it('labelOf 能用它把码翻成中文', () => {
    expect(labelOf(ENTITY_TYPE_OPTIONS, 'QLZG_MATERIAL')).toBe('评估资料')
  })
})

// ==================== 案例库（I2）====================

describe('CASE_SOURCE_TYPE_OPTIONS ← QlzgCaseSourceTypeEnum', () => {
  it('与后端枚举逐字一致、顺序一致', () => {
    expect(CASE_SOURCE_TYPE_OPTIONS.map((item) => item.value)).toEqual([
      'API',
      'DISCLOSURE',
      'MANUAL',
      'IMPORT'
    ])
    expect(CASE_SOURCE_TYPE_OPTIONS.map((item) => item.label)).toEqual([
      '数据接口',
      '公开披露',
      '人工录入',
      '批量导入'
    ])
    expectWellFormed(CASE_SOURCE_TYPE_OPTIONS)
  })
})

describe('CASE_PROVIDER_TYPE_OPTIONS ← QlzgCaseProviderTypeEnum', () => {
  it('与后端枚举逐字一致、顺序一致', () => {
    expect(CASE_PROVIDER_TYPE_OPTIONS.map((item) => item.value)).toEqual([
      'THIRD_PARTY_API',
      'PUBLIC_DISCLOSURE',
      'MANUAL',
      'GOVERNMENT'
    ])
    expect(CASE_PROVIDER_TYPE_OPTIONS.map((item) => item.label)).toEqual([
      '第三方数据接口',
      '公开披露',
      '人工搜集',
      '政府发布'
    ])
    expectWellFormed(CASE_PROVIDER_TYPE_OPTIONS)
  })

  /**
   * 🔴 这一条守的是「两个枚举**不能合并**」这个决定本身
   *
   * 它们共有 `MANUAL` 这个码，而中文**刻意不同**（人工录入 / 人工搜集）：
   * 一个是「这条案例怎么来的」，一个是「这个数据源是什么性质」。
   * 谁哪天觉得重复、把两份合成一份，这条就红 ——
   * 而合并的代价是数据源管理页里能选到「批量导入」（后端不认那个码），
   * 以及案例台账里筛「人工录入」时把数据源的性质也一起筛进来
   */
  it('🔴 与案例来源类型是两份不同的清单：码集合不同、共有的 MANUAL 中文也不同', () => {
    expect(CASE_SOURCE_TYPE_OPTIONS.map((i) => i.value)).not.toEqual(
      CASE_PROVIDER_TYPE_OPTIONS.map((i) => i.value)
    )
    expect(CASE_SOURCE_TYPE_OPTIONS.some((i) => i.value === 'GOVERNMENT')).toBe(false)
    expect(CASE_PROVIDER_TYPE_OPTIONS.some((i) => i.value === 'IMPORT')).toBe(false)
    expect(labelOf(CASE_SOURCE_TYPE_OPTIONS, 'MANUAL')).toBe('人工录入')
    expect(labelOf(CASE_PROVIDER_TYPE_OPTIONS, 'MANUAL')).toBe('人工搜集')
  })
})

describe('CASE_TENANT_SCOPE_OPTIONS：私有库 / 共享库', () => {
  it('两个码与两句中文与 QlzgCaseController 里现算的那两句逐字一致', () => {
    expect(CASE_TENANT_SCOPE_OPTIONS.map((item) => item.value)).toEqual(['PRIVATE', 'SHARED'])
    expect(CASE_TENANT_SCOPE_OPTIONS.map((item) => item.label)).toEqual([
      '本机构私有库',
      '平台共享库'
    ])
    expectWellFormed(CASE_TENANT_SCOPE_OPTIONS)
  })

  it('共享库用 info（只读，与「编辑/删除置灰」呼应），私有用 primary，未知码也落到 primary', () => {
    expect(caseTenantScopeTagType('SHARED')).toBe('info')
    expect(caseTenantScopeTagType('PRIVATE')).toBe('primary')
    expect(caseTenantScopeTagType('WHATEVER')).toBe('primary')
    expect(caseTenantScopeTagType(undefined)).toBe('primary')
  })
})

describe('CASE_TASK_STATUS_OPTIONS ← QlzgTaskStatusEnum', () => {
  it('与后端枚举逐字一致、顺序一致', () => {
    expect(CASE_TASK_STATUS_OPTIONS.map((item) => item.value)).toEqual([
      'PENDING',
      'RUNNING',
      'SUCCESS',
      'FAILED',
      'INTERRUPTED'
    ])
    expect(CASE_TASK_STATUS_OPTIONS.map((item) => item.label)).toEqual([
      '待执行',
      '执行中',
      '成功',
      '失败',
      '已中断'
    ])
    expectWellFormed(CASE_TASK_STATUS_OPTIONS)
  })

  it('🔴 INTERRUPTED 是 warning 不是 danger：那是进程被 kill 后懒回收判出来的，重提同一个文件就能续上', () => {
    expect(caseTaskStatusTagType('INTERRUPTED')).toBe('warning')
    expect(caseTaskStatusTagType('FAILED')).toBe('danger')
    expect(caseTaskStatusTagType('SUCCESS')).toBe('success')
    expect(caseTaskStatusTagType('PENDING')).toBe('primary')
    expect(caseTaskStatusTagType('RUNNING')).toBe('primary')
    expect(caseTaskStatusTagType('WHATEVER')).toBe('primary')
  })
})

describe('caseDispositionTagType ← QlzgRecallDispositionEnum', () => {
  it('三档各一个颜色，未知码落到 info', () => {
    expect(caseDispositionTagType('OK')).toBe('success')
    expect(caseDispositionTagType('FEW')).toBe('warning')
    expect(caseDispositionTagType('NONE')).toBe('danger')
    expect(caseDispositionTagType(undefined)).toBe('info')
    expect(caseDispositionTagType('WHATEVER')).toBe('info')
  })

  /**
   * 🔴 这里**刻意没有**一份「充足度中文」的黄金副本
   *
   * 界面上照原样渲染后端发来的 `dispositionText`，前端不拼那句中文。
   * 拼了就会与 R48 的规则种子分属两份真相：种子里的 `expr_params.minCases`
   * 是机构可调的专业阈值，而前端字符串里的「3」调不动 ——
   * 于是面板说「3 条充足」、R48 说「不足」，两个数必须一致却分属两种语言。
   * 这条用例守的就是「前端没有那份副本」
   */
  it('🔴 constants 里不存在任何充足度中文（那份文案只能来自后端的 dispositionText）', () => {
    const allLabels = [
      ...CASE_SOURCE_TYPE_OPTIONS,
      ...CASE_PROVIDER_TYPE_OPTIONS,
      ...CASE_TENANT_SCOPE_OPTIONS,
      ...CASE_TASK_STATUS_OPTIONS,
      ...CASE_IMPORT_ISSUE_LEVEL_OPTIONS
    ].map((item) => item.label)
    expect(allLabels.some((label) => label.includes('充足') || label.includes('可比案例'))).toBe(
      false
    )
  })
})

describe('CASE_IMPORT_ISSUE_LEVEL_OPTIONS ← QlzgCaseImportIssueVO 的 LEVEL_* 常量', () => {
  it('三档与后端常量逐字一致', () => {
    expect(CASE_IMPORT_ISSUE_LEVEL_OPTIONS.map((item) => item.value)).toEqual([
      'ERROR',
      'WARNING',
      'SKIPPED'
    ])
    expectWellFormed(CASE_IMPORT_ISSUE_LEVEL_OPTIONS)
  })

  it('🔴 SKIPPED 用 info 不用 danger：那是指纹撞车被去重，重导多少次结果都一样', () => {
    expect(caseIssueLevelTagType('ERROR')).toBe('danger')
    expect(caseIssueLevelTagType('WARNING')).toBe('warning')
    expect(caseIssueLevelTagType('SKIPPED')).toBe('info')
    expect(caseIssueLevelTagType(undefined)).toBe('primary')
  })
})

describe('案例表单的四份「建议值」（不是枚举）', () => {
  /**
   * 🔴 这四份的 `label` 与 `value` **必须相等**：后端存的就是中文原文
   *    （`purpose` / `rightType` / `orientation` / `decoration` 都是自由文本 String(32)），
   *    存码的话召回第 2、3 层的硬过滤会拿「MORTGAGE」去比「住宅」，永远不相等
   */
  it('label 即 value —— 存的是中文原文，不是码', () => {
    for (const options of [
      CASE_USAGE_SUGGESTIONS,
      CASE_RIGHT_TYPE_SUGGESTIONS,
      CASE_ORIENTATION_SUGGESTIONS,
      CASE_DECORATION_SUGGESTIONS
    ]) {
      expect(options.every((item) => item.label === item.value)).toBe(true)
      expectWellFormed(options)
    }
  })

  /**
   * 🔴 这一条是全套用例里最值钱的一条
   *
   * 案例的 `purpose` 与项目的 `purpose` 在后端**同名而不同义**：
   * 前者是房屋用途（「住宅」），后者是评估目的（`MORTGAGE` 这类码）。
   * 谁在案例表单上顺手 import 了 `PURPOSE_OPTIONS`，案例就会存进一堆码 ——
   * 而召回第 2 层是硬过滤，于是这批案例一条都召回不到，台账里却看得见，
   * 全程没有一处报错。两份清单的值集合必须**不相交**
   */
  it('🔴 房屋用途与评估目的的值集合不相交（用错一份会让这批案例永远召回不到）', () => {
    const projectPurposes = new Set(PURPOSE_OPTIONS.map((item) => item.value))
    expect(CASE_USAGE_SUGGESTIONS.some((item) => projectPurposes.has(item.value))).toBe(false)
    expect(CASE_USAGE_SUGGESTIONS.map((item) => item.value)).toContain('住宅')
    expect(PURPOSE_OPTIONS.map((item) => item.value)).toContain('MORTGAGE')
  })

  /**
   * 🔴 这三份清单里各有一段是**标的侧 ENUM 的逐字副本**，抄的是种子脚本 06
   *    里 `qlzg_category.param_schema` 的三个参数（`right_type` / `orientation` /
   *    `decoration`，都是 ENUM、`indexed = true`）。
   *
   *    为什么必须逐字相同：召回的第 2、3 层与打分表的朝向、装修两项都是
   *    **按文本严格相等**比的，而标的侧只能从 ENUM 里挑。
   *    案例侧少一个值，评估师就得靠 allow-create 手打 ——
   *    打错一个字的表现是「这条案例召回不到 / 这一项恒拿不到分」，
   *    台账里看得见，全程没有一处报错。
   *
   *    ⚠️ 这一段是**手写**的黄金副本，不是从脚本生成的：
   *    生成之后再来比就是同义反复，恒绿。改种子脚本时必须同步改这里
   */
  it('🔴 权利性质：前三项就是标的侧 ENUM 的三值，且排在案例侧独有的两项之前', () => {
    const values = CASE_RIGHT_TYPE_SUGGESTIONS.map((item) => item.value)
    expect(values.slice(0, 3)).toEqual(['出让', '划拨', '租赁'])
    expect(values).toEqual(['出让', '划拨', '租赁', '集体', '自有'])
  })

  it('🔴 朝向与装修：标的侧 ENUM 的每一项都要在建议里挑得到', () => {
    const orientations = CASE_ORIENTATION_SUGGESTIONS.map((item) => item.value)
    for (const subjectSide of ['东', '南', '西', '北', '东南', '东北', '西南', '西北', '南北']) {
      expect(orientations).toContain(subjectSide)
    }
    expect(CASE_DECORATION_SUGGESTIONS.map((item) => item.value)).toEqual([
      '毛坯',
      '简装',
      '精装',
      '豪装'
    ])
  })

  it('🔴 房屋用途：标的侧 ENUM 的四项排在最前面（后面才是案例侧独有的登记口径）', () => {
    expect(CASE_USAGE_SUGGESTIONS.map((item) => item.value).slice(0, 4)).toEqual([
      '住宅',
      '商业',
      '办公',
      '工业'
    ])
  })
})

// ==================== 参数库与测算（I3）====================

describe('PARAM_SOURCE_TYPE_OPTIONS ← QlzgParamSourceTypeEnum', () => {
  it('与后端枚举逐字一致、顺序一致', () => {
    expect(PARAM_SOURCE_TYPE_OPTIONS.map((item) => item.value)).toEqual([
      'STANDARD',
      'GOVERNMENT',
      'EXPERT_GUIDE',
      'ORG_INTERNAL',
      'MARKET'
    ])
    expect(PARAM_SOURCE_TYPE_OPTIONS.map((item) => item.label)).toEqual([
      '准则规范',
      '政府发布',
      '专家指引',
      '机构内部',
      '市场统计'
    ])
    expectWellFormed(PARAM_SOURCE_TYPE_OPTIONS)
  })

  /**
   * 🔴 `EXPERT_GUIDE` 是 R36 的输入（`allFromExpertGuide` ⇒ 报告里必须披露），
   *    也是纪律 2「专家指引不能当 BLOCK 级规则的引用对象」的唯一判据。
   *    这个码错一个字母，两处判定同时静默失效 —— 表单上那个开关会「拨得动、存不下、也不报错」
   */
  it('🔴 EXPERT_GUIDE 这一档必须在列，且中文就是「专家指引」', () => {
    expect(labelOf(PARAM_SOURCE_TYPE_OPTIONS, 'EXPERT_GUIDE')).toBe('专家指引')
  })
})

describe('PARAM_STATUS_OPTIONS ← 框架 CommonStatusEnum（0 停用 / 1 启用）', () => {
  /**
   * 🔴 这一条守的是**类型**，不是取值：`value` 必须是 `number`
   *
   * `el-option` 的 `:value` 与 `el-select` 的 `v-model` 走全等比较，写成 `'0'` / `'1'`
   * 的表现是筛选下拉永远命不中、编辑弹窗里那一栏空白，**两处都不报错**。
   * 与 `CASE_SOURCE_STATUS_OPTIONS` 是同一个坑的第二次出现
   */
  it('🔴 value 是数字 1 / 0，不是字符串', () => {
    expect(PARAM_STATUS_OPTIONS.map((item) => item.value)).toEqual([1, 0])
    expect(PARAM_STATUS_OPTIONS.map((item) => typeof item.value)).toEqual(['number', 'number'])
    expect(PARAM_STATUS_OPTIONS.map((item) => item.label)).toEqual(['启用', '停用'])
    // 重复的 label 会让下拉里出现两个一样的字
    expect(new Set(PARAM_STATUS_OPTIONS.map((item) => item.label)).size).toBe(
      PARAM_STATUS_OPTIONS.length
    )
  })

  it('停用是 info 不是 danger —— 停用不等于删除，而且删除多半删不掉', () => {
    expect(paramStatusTagType(1)).toBe('success')
    expect(paramStatusTagType(0)).toBe('info')
    expect(paramStatusTagType(undefined)).toBe('info')
  })
})

describe('PARAM_PLATFORM_LEVEL_OPTIONS：三态筛选', () => {
  /**
   * 🔴 「全部」那一项的 value 必须是 **undefined**
   *
   * 后端 `QlzgParamPageReqVO.platformLevel` 是 `Boolean`，不传 = 两者都要。
   * 写成 `''` 或 `false` 的表现是：选了「全部」却看不到平台级参数 ——
   * 而平台级恰恰是基准地价、资本化率这些最常用的那批
   */
  it('🔴 正好三项，且第一项的 value 是 undefined（不是 null、不是空串、不是 false）', () => {
    expect(PARAM_PLATFORM_LEVEL_OPTIONS).toHaveLength(3)
    expect(PARAM_PLATFORM_LEVEL_OPTIONS[0].value).toBeUndefined()
    expect(PARAM_PLATFORM_LEVEL_OPTIONS.map((item) => item.label)).toEqual([
      '全部',
      '平台级',
      '本机构'
    ])
    expect(PARAM_PLATFORM_LEVEL_OPTIONS.map((item) => item.value)).toEqual([undefined, true, false])
  })
})

describe('PARAM_DEFAULT_STRATEGY_OPTIONS：⚠️ 不是 Java 枚举', () => {
  it('两档，与 qlzg_category.param_schema 里 PARAM 作用域的字面量一致', () => {
    expect(PARAM_DEFAULT_STRATEGY_OPTIONS.map((item) => item.value)).toEqual([
      'FROM_PARAM_LIB',
      'PROMPT_USER'
    ])
    expectWellFormed(PARAM_DEFAULT_STRATEGY_OPTIONS)
  })

  /**
   * 🔴 `default_strategy` 一共有**五个**取值，这份清单**刻意只有两个**
   *
   * 另外三个（FROM_MATERIAL / FROM_SURVEY / BASE_DATE_PLUS_ONE_YEAR）实测只出现在
   * SUBJECT_ATTR 与 REPORT_FIELD 两种作用域的键上（种子脚本 06 与 16）。
   * 把它们「补全」进来的后果是确认闸的下拉里多出「从资料里取」这一档，
   * 而确认闸只读 PARAM 作用域的键 —— 那是一个点了必然对不上的选项，
   * 与「不给一个点了必然报错的选项」是同一条纪律
   */
  it('🔴 另外三个作用域专属的取值一律不在清单里', () => {
    for (const outOfScope of ['FROM_MATERIAL', 'FROM_SURVEY', 'BASE_DATE_PLUS_ONE_YEAR']) {
      expect(PARAM_DEFAULT_STRATEGY_OPTIONS.some((item) => item.value === outOfScope)).toBe(false)
    }
  })

  /**
   * 🔴 `PROMPT_USER` 的含义是「这一项不许系统替人决定」，后端 RespVO 的 @Schema 写明
   *    **即便命中了也要评估师亲手确认**。它在确认闸上「不命中参数库」是设计如此、不是缺陷。
   *    把它渲染成「未命中，去参数库新建」会让用户去建一条根本不该存在的参数
   */
  it('🔴 两份清单不共用码：PROMPT_USER 不在参数出处类型里', () => {
    expect(PARAM_SOURCE_TYPE_OPTIONS.some((item) => item.value === 'PROMPT_USER')).toBe(false)
  })
})

describe('CALCULATION_STATUS_OPTIONS ← QlzgCalculationStatusEnum', () => {
  it('与后端枚举逐字一致、顺序一致', () => {
    expect(CALCULATION_STATUS_OPTIONS.map((item) => item.value)).toEqual([
      'SUCCESS',
      'FAILED',
      'STALE'
    ])
    expect(CALCULATION_STATUS_OPTIONS.map((item) => item.label)).toEqual([
      '成功',
      '失败',
      '输入已变化，待重算'
    ])
    expectWellFormed(CALCULATION_STATUS_OPTIONS)
  })

  /**
   * 🔴 `STALE` 是这三档里最容易被做错的那一个
   *
   * 它**不是一次失败的运行**，而是一次曾经成功、现在已经过期的运行。
   * 标成红的表现是评估师以为算错了、去查算式，而实际要做的只是「再跑一次」；
   * 标成绿的更坏：`CALCULATION_STALE`（1042006006）的文案是「结果不可用于出稿」，
   * 而一个绿色的「成功」会让人拿它去出稿
   */
  it('🔴 STALE 必须是 warning，既不是 danger 也不是 success', () => {
    expect(calculationStatusTagType('STALE')).toBe('warning')
    expect(calculationStatusTagType('STALE')).not.toBe('danger')
    expect(calculationStatusTagType('STALE')).not.toBe('success')
    expect(calculationStatusTagType('SUCCESS')).toBe('success')
    expect(calculationStatusTagType('FAILED')).toBe('danger')
  })

  it('未知码落到 info —— 不该看起来像出事了', () => {
    expect(calculationStatusTagType('WHATEVER')).toBe('info')
    expect(calculationStatusTagType(undefined)).toBe('info')
  })
})

describe('VALUATION_METHOD_MVP_OPTIONS ← QlzgValuationMethodEnum（后端有 24 个）', () => {
  it('🔴 只有四个，且是后端枚举的**前四项**、顺序一致', () => {
    expect(VALUATION_METHOD_MVP_OPTIONS.map((item) => item.value)).toEqual([
      'MARKET_COMPARISON',
      'INCOME_APPROACH',
      'COST',
      'HYPOTHETICAL_DEVELOPMENT'
    ])
    expect(VALUATION_METHOD_MVP_OPTIONS.map((item) => item.label)).toEqual([
      '市场比较法',
      '收益法',
      '成本法',
      '假设开发法'
    ])
    expectWellFormed(VALUATION_METHOD_MVP_OPTIONS)
  })

  /**
   * 🔴 这一条守的是「只放四个」这个决定本身
   *
   * 后端枚举的第 5..24 项平台**没有实现**（`QlzgValuationMethod` 只有四个实现类），
   * 选它们会得到 `CALCULATION_METHOD_NOT_IMPLEMENTED`（1042006010），
   * 那句文案是「平台尚未实现」—— 评估师会以为要等版本，而他本来可以换一种方法算。
   * 谁哪天把 24 个都抄进来「让下拉更全」，这条就红
   */
  it('🔴 第五个及以后的方法一律不在清单里', () => {
    for (const notImplemented of [
      'DCF_FCFF',
      'DCF_FCFE',
      'TRANSACTION_CASE_COMPARISON',
      'NET_PRESENT_VALUE_INCOME',
      'EVA',
      'DDM'
    ]) {
      expect(VALUATION_METHOD_MVP_OPTIONS.some((item) => item.value === notImplemented)).toBe(false)
    }
  })

  /**
   * ⚠️ 后端枚举的第三个构造参数 `textbookOnly` 在 24 个里只有 `EVA` 与 `DDM` 是 true，
   *    这四个 MVP 方法全是 false —— 所以前端**不需要**这个维度。
   *    这一条钉住「不需要」：等 I5 的规则要按它分档时再加，届时它才有第二种取值
   */
  it('⚠️ 四个 MVP 方法的 textbookOnly 都是 false，前端不搬这个维度', () => {
    expect(VALUATION_METHOD_MVP_OPTIONS).toHaveLength(4)
    expect(Object.keys(VALUATION_METHOD_MVP_OPTIONS[0])).toEqual(['label', 'value'])
  })
})

describe('COMBINE_TYPE_OPTIONS ← QlzgCombineTypeEnum（§11.4.3 的五种）', () => {
  it('与后端枚举逐字一致、顺序一致', () => {
    expect(COMBINE_TYPE_OPTIONS.map((item) => item.value)).toEqual([
      'SINGLE',
      'ARITHMETIC_MEAN',
      'WEIGHTED',
      'RANGE',
      'PROFESSIONAL_JUDGMENT'
    ])
    expect(COMBINE_TYPE_OPTIONS.map((item) => item.label)).toEqual([
      '单一方法',
      '算术平均',
      '加权',
      '区间',
      '专业判断'
    ])
    expectWellFormed(COMBINE_TYPE_OPTIONS)
  })

  /**
   * 🔴 只有这两档要用户手填 `finalValue`：其余三档的最终值由后端从参与测算的结果值算出来
   *    （SINGLE 取那一条，ARITHMETIC_MEAN 取平均，WEIGHTED 取加权和）。
   *    在那三档上放一个可编辑的金额框，用户填了却不生效 ——
   *    那是「拨得动、存不下、也不报错」，与 `canBeBlockRule` 那条同一个坏法
   */
  it('🔴 combineTypeNeedsFinalValue 只对 RANGE / PROFESSIONAL_JUDGMENT 为真', () => {
    expect(COMBINE_TYPES_NEEDING_FINAL_VALUE).toEqual(['RANGE', 'PROFESSIONAL_JUDGMENT'])
    for (const combineType of ['SINGLE', 'ARITHMETIC_MEAN', 'WEIGHTED']) {
      expect(combineTypeNeedsFinalValue(combineType)).toBe(false)
    }
    for (const combineType of ['RANGE', 'PROFESSIONAL_JUDGMENT']) {
      expect(combineTypeNeedsFinalValue(combineType)).toBe(true)
    }
  })

  /**
   * 🔴 这两档**都要**填，但约束不同：RANGE 的 `finalValue` 必须落在参与测算的
   *    `[rangeLower, rangeUpper]` 内，而 PROFESSIONAL_JUDGMENT **可以**在区间外
   *    —— 要另给一个区间外的值就必须改用这一档，那是
   *    `CALC_RESULT_FINAL_VALUE_OUT_OF_RANGE` 文案里明说的出路。
   *    界面上两档共用一个提示「请填写最终评估值」是不够的，会把用户推进一次必然被拒的提交
   */
  it('🔴 五档每一档都在 COMBINE_TYPE_OPTIONS 里取得到中文名', () => {
    for (const code of [
      'SINGLE',
      'ARITHMETIC_MEAN',
      'WEIGHTED',
      'RANGE',
      'PROFESSIONAL_JUDGMENT'
    ]) {
      expect(labelOf(COMBINE_TYPE_OPTIONS, code)).not.toBe(code)
    }
  })

  it('未知码与空值一律不需要 finalValue（回落到 false，不要抛）', () => {
    expect(combineTypeNeedsFinalValue('WHATEVER')).toBe(false)
    expect(combineTypeNeedsFinalValue(undefined)).toBe(false)
    expect(combineTypeNeedsFinalValue('')).toBe(false)
  })
})

/**
 * 🔴 这一条守的是「前端没有第二份单价口径码表」
 *
 * `qlzg_calc_result.unit_price_basis` 存的不是码，是**一整句中文**（比较法写
 * 「单价 = 成交价 / 建筑面积」，收益法写「单价 = 收益法评估值 / 建筑面积」，
 * 结果确定回落「建筑面积」）—— 它是 `RatioCalculator#ratio` 的 `basisLabel` 入参，
 * 由每个方法自己声明。前端**原样渲染**。
 *
 * 造一份三值码表（BUILDING / USABLE / LAND）看起来「更规范」，实际后果是：
 * `labelOf` 认不出那些句子、回落到原文，于是**界面上照样显示对的**，
 * 而仓库里多出一份没人维护、永远对不上真实数据的映射。
 * 这条用例在 I3-g-1 时确实拦下过一次：那份码表已经写进 constants.ts 又被删掉
 */
describe('🔴 刻意没有 UNIT_PRICE_BASIS_OPTIONS', () => {
  it('constants 里不存在任何「面积口径码表」', () => {
    const allValues = [
      ...PARAM_SOURCE_TYPE_OPTIONS,
      ...PARAM_DEFAULT_STRATEGY_OPTIONS,
      ...CALCULATION_STATUS_OPTIONS,
      ...VALUATION_METHOD_MVP_OPTIONS,
      ...COMBINE_TYPE_OPTIONS
    ].map((item) => item.value)
    expect(allValues.some((value) => ['BUILDING', 'USABLE', 'LAND'].includes(value))).toBe(false)
  })
})

// ==================== 复核域（I5）====================

describe('REVIEW_MODE_OPTIONS ← QlzgReviewModeEnum', () => {
  /**
   * 🔴 三条中文现在是后端枚举 description 的**逐字副本**。
   *
   * I5-c 之前那个枚举只有码没有中文名，于是这三条曾是前端自己编的
   * （ADVISORY 写成「仅提示」、OFF 写成「关闭（须留豁免痕）」）。
   * 枚举补上 description 之后两份就开始分叉 —— 而分叉**不报错**：
   * 配置页显示一个名字，工作台与留痕列表显示后端那一个，
   * 同一个档位在两个页面上叫两个名字，用户会以为是两件事。
   */
  it('与后端枚举逐字一致、顺序一致', () => {
    expect(REVIEW_MODE_OPTIONS.map((item) => item.value)).toEqual(['ENFORCE', 'ADVISORY', 'OFF'])
    expect(REVIEW_MODE_OPTIONS.map((item) => item.label)).toEqual([
      '强制复核',
      '提示复核',
      '关闭复核'
    ])
    expectWellFormed(REVIEW_MODE_OPTIONS)
  })

  /**
   * 🔴 INHERIT **不在这一份里**，也不该在：它是项目级 / 报告级两个弹层里
   *    「清空本级配置、回到继承上一级」这个**动作**的取值，不是一档。
   *    后端刻意没把它放进枚举 —— 塞进去的话，「三档」的唯一权威就要为一个
   *    不可能出现在 review_mode_effective 里的取值编一个答案，而任何答案都是错的
   */
  it('🔴 INHERIT 刻意不在选项表里，单独一个常量', () => {
    expect(REVIEW_MODE_OPTIONS.some((item) => item.value === REVIEW_INHERIT)).toBe(false)
    expect(REVIEW_INHERIT).toBe('INHERIT')
    // 大写、逐字，前端也不做大小写归一：归一等于替用户猜意图，
    // 而猜错的产物是一行**看起来完全正常**的假留痕
    expect(REVIEW_INHERIT).toBe(REVIEW_INHERIT.toUpperCase())
  })

  it('🔴 「跟随机构配置」那一句要说清跟谁走，不叫「清除」也不叫「默认」', () => {
    // 「清除」听起来像撤销一个多余的动作，而它可能是一次**实际的控制放松**：
    // 机构是 OFF、本项目原来钉着 ENFORCE 的话，回到继承之后本项目就跟着变成 OFF
    expect(REVIEW_INHERIT_LABEL).toContain('跟随')
    expect(REVIEW_INHERIT_LABEL).not.toContain('清除')
    expect(REVIEW_INHERIT_LABEL).not.toBe('默认')
    expect(REVIEW_INHERIT_LABEL).toContain('机构')
  })

  /**
   * 🔴 两级的「跟随上级」**刻意不是同一句**，因为它们跟的不是同一个人
   *
   * 项目级的父级是机构（后端 `resolveFromOrg`），报告级的父级是**项目**
   * （`resolveFromProject`），而项目自己那列也可空。
   * 报告级弹层上写「跟随机构配置」的话，一个「项目钉着 ENFORCE、机构是 OFF」的项目里，
   * 点它的人以为自己在把这份报告放松到 OFF，解析出来的却是 ENFORCE；
   * 反过来（项目 OFF、机构 ENFORCE）他以为在收紧、其实是放松。
   * 两处都返回 200，留痕行如实记下解析后的档位 —— **只有界面上那句话是错的**。
   *
   * ⚠️ 所以这一条断言的是「两句不同、且报告级那句必须提到项目」，
   *    不是断言整句文案逐字：文案还会改，而「报告级弹层不许提机构」这个约束不会
   */
  it('🔴 报告级那一句要跟的是「项目」，不是「机构」', () => {
    expect(REVIEW_INHERIT_LABEL_REPORT).not.toBe(REVIEW_INHERIT_LABEL)
    expect(REVIEW_INHERIT_LABEL_REPORT).toContain('项目')
    expect(REVIEW_INHERIT_LABEL_REPORT).not.toContain('清除')
    // 「清空本级」说的是**数据动作**（那一列被写成 NULL），「跟随…」说的是**后果**，两者都要
    expect(REVIEW_INHERIT_LABEL_REPORT).toContain('清空本级')
    expect(REVIEW_INHERIT_LABEL).toContain('清空本级')
  })

  /**
   * 🔴 三档的 tag 颜色：OFF 是**红的**。
   *
   * 这里的红不是说「配置坏了」，是说「控制被关掉了」——
   * 而这正是内控配置页上唯一该让监管的眼睛第一时间找到的东西
   * （§11.9.2.6 第 4 条在报告页用一条常驻灰条办同一件事）。
   * ADVISORY 是黄的：规则照跑、只是不拦，而「跑了但不拦」在责任上是一次**转移**
   * （§11.9.2.5：机器不拦了，人必须拦），不该看起来与 ENFORCE 一样安心。
   */
  it('🔴 OFF 红 / ADVISORY 黄 / ENFORCE 绿', () => {
    expect(reviewModeTagType('OFF')).toBe('danger')
    expect(reviewModeTagType('ADVISORY')).toBe('warning')
    expect(reviewModeTagType('ENFORCE')).toBe('success')
  })

  /**
   * 🔴 认不出的码是**灰的**，不是红的：那一格旁边会把原码一并显示出来
   *    （labelOf 的回落），红灰之分要留给「关掉了」与「不知道」这两件不同的事 ——
   *    前者查留痕就能问清是谁决定的，后者是数据坏了，两件事的出路完全不同
   */
  it('认不出的码是灰的（info），不是红的', () => {
    expect(reviewModeTagType('WHATEVER')).toBe('info')
    expect(reviewModeTagType(undefined)).toBe('info')
    expect(reviewModeTagType('')).toBe('info')
    // 与 projectStatusTagType 的「未知码不该看起来像出事了」不冲突：
    // 那边未知码回落成主色是因为它**可能**是一个还没映射的新状态；
    // 这边后端 of() 对认不出的取值一律回落 ENFORCE，于是「未知」只可能是数据坏了
    expect(reviewModeTagType('off')).toBe('info') // 小写不归一，后端也不归一
  })
})

describe('REVIEW_MODE_CONSEQUENCES ← §11.9.2.6 第 2 条', () => {
  /**
   * 🔴 三档选择器必须把**后果**写在选项上，不是只写档位名。
   *    三轮要求 3 的原话是「我们做好提示和声明就可以了」——
   *    而提示必须是**决策点上**的提示，不是文档里的提示。
   *    放进帮助文档、放进 tooltip 的「?」图标里，都等于没放：
   *    赶稿的人不会去点那个问号，而赶稿正是这个选择器最需要被看见的时刻
   */
  it('🔴 三档的后果逐字取自 §11.9.2.6 第 2 条', () => {
    expect(REVIEW_MODE_CONSEQUENCES.ENFORCE).toBe('机器复核，BLOCK 未清零不能定稿')
    expect(REVIEW_MODE_CONSEQUENCES.ADVISORY).toBe('机器复核照跑，只提示不拦截')
    expect(REVIEW_MODE_CONSEQUENCES.OFF).toBe('不跑机器复核，报告页不再显示 BLOCK 清单')
  })

  /**
   * 🔴 键集必须与 REVIEW_MODE_OPTIONS 的 value 集**完全相同**：
   *    后端加一档而这里没跟上，那一档在下拉里就只有一行名字、没有后果 ——
   *    而「没有后果」的那一档看起来像「安全的默认选择」
   */
  it('🔴 键集与选项表的 value 集逐字相同（不多不少、不看顺序）', () => {
    expect(Object.keys(REVIEW_MODE_CONSEQUENCES).sort()).toEqual(
      REVIEW_MODE_OPTIONS.map((item) => item.value).sort()
    )
  })

  /**
   * 🔴 认不出的码返回**空串**，不回落成码本身 —— 与 labelOf 的回落规则刻意不同：
   *    label 认不出时显示原码是有用的（「这一列被写坏了」看得见），
   *    而后果认不出时显示原码，产出的是一句 WHATEVER 冒充「选了它会发生什么」——
   *    一句读起来像说明的乱码，比一片空白更坏
   */
  it('🔴 认不出的码返回空串，不回落成码', () => {
    expect(reviewModeConsequence('WHATEVER')).toBe('')
    expect(reviewModeConsequence(undefined)).toBe('')
    expect(reviewModeConsequence(null)).toBe('')
    expect(reviewModeConsequence('')).toBe('')
    expect(reviewModeConsequence('off')).toBe('')
  })

  it('三档都取得到一句非空的后果', () => {
    for (const { value } of REVIEW_MODE_OPTIONS) {
      expect(reviewModeConsequence(value).length).toBeGreaterThan(0)
    }
  })

  /**
   * 🔴 后果文案里不许出现 markdown 强调符。
   *    V5 原文写的是「不跑机器复核，报告页不再显示 BLOCK 清单」外面套一对星号，
   *    那两个星号是文档里的强调，不是界面文案 —— .vue 的 template 是 HTML 不是 Markdown，
   *    插值会把星号**逐字**印出来（renderedMarkdownBan.spec.ts 守的就是这件事）
   */
  it('🔴 后果文案里不含 markdown 强调符与源码标记', () => {
    for (const text of Object.values(REVIEW_MODE_CONSEQUENCES)) {
      expect(text).not.toContain('**')
      expect(text).not.toContain('🔴')
      expect(text).not.toContain('⚠')
    }
  })
})

describe('REVIEW_RUN_STATUS_OPTIONS ← QlzgReviewRunStatusEnum', () => {
  it('与后端枚举逐字一致、顺序一致', () => {
    expect(REVIEW_RUN_STATUS_OPTIONS.map((item) => item.value)).toEqual(['OK', 'FAILED', 'SKIPPED'])
    expect(REVIEW_RUN_STATUS_OPTIONS.map((item) => item.label)).toEqual([
      '复核完成',
      '复核未完成',
      '未运行（档位关闭）'
    ])
    expectWellFormed(REVIEW_RUN_STATUS_OPTIONS)
  })

  /**
   * 🔴 SKIPPED 用**灰**（info），与报告页那条灰条同一个语义：不是出错，是「按配置没跑」。
   *    用红的话，一个依法关掉了机器复核、并且**留了痕**的机构，
   *    在自己的内控页上看起来像出了事故
   */
  it('🔴 OK 绿 / FAILED 红 / SKIPPED 灰', () => {
    expect(reviewRunStatusTagType('OK')).toBe('success')
    expect(reviewRunStatusTagType('FAILED')).toBe('danger')
    expect(reviewRunStatusTagType('SKIPPED')).toBe('info')
  })

  /**
   * 🔴 SKIPPED 与 FAILED 必须**不同色**：前者是「一行规则都没跑」（按配置），
   *    后者是「引擎在半路上出错了」。两者在 ENFORCE 档下都会拦住定稿，
   *    而出路完全不同 —— 前者去内控配置页，后者去看 errorMsg
   */
  it('🔴 SKIPPED 与 FAILED 不同色（不是一回事）', () => {
    expect(reviewRunStatusTagType('SKIPPED')).not.toBe(reviewRunStatusTagType('FAILED'))
  })

  /**
   * ⚠️ 认不出的码给黄：这一列决定报告页显示哪一条横条
   *    （reviewFlow 的 reportReviewBannerOf 判据是「不是 OK 就算没跑完」，
   *    于是坏码落到红条 INCOMPLETE，与这里的黄同一个方向：都不把它当「查完了」），
   *    一个坏值既不是「查完了」也不是「没跑」，该被看见
   */
  it('认不出的码是黄的（这一列坏了会影响报告页那条横条）', () => {
    expect(reviewRunStatusTagType('WHATEVER')).toBe('warning')
    expect(reviewRunStatusTagType(undefined)).toBe('warning')
  })
})

describe('RULE_SEVERITY_OPTIONS ← QlzgRuleSeverityEnum', () => {
  it('与后端枚举逐字一致、顺序一致（从严到轻）', () => {
    expect(RULE_SEVERITY_OPTIONS.map((item) => item.value)).toEqual(['BLOCK', 'WARN', 'INFO'])
    expect(RULE_SEVERITY_OPTIONS.map((item) => item.label)).toEqual(['拦截', '提示', '告知'])
    expectWellFormed(RULE_SEVERITY_OPTIONS)
  })

  /**
   * 🔴 两份是同一件事的**两个方向**，都要钉住：
   *    OPTIONS 从严到轻（配置页要让人先看见能拦人的那一档），
   *    ORDER 从轻到严（供比大小用，即后端那个 priority 的序）。
   *    改一个不改另一个的话，「灰掉非法档位」那道判据会整个反过来 ——
   *    而反过来的表现是「专家指引的规则能选 BLOCK、机构内部制度的选不了」，
   *    恰好把「建议性文件不能产生强制性拦截」那条颠倒过来
   */
  it('🔴 ORDER 是 OPTIONS 的反序', () => {
    expect(RULE_SEVERITY_ORDER).toEqual(RULE_SEVERITY_OPTIONS.map((item) => item.value).reverse())
  })

  it('🔴 BLOCK 红 / WARN 黄 / INFO 灰，认不出的码也是灰', () => {
    expect(ruleSeverityTagType('BLOCK')).toBe('danger')
    expect(ruleSeverityTagType('WARN')).toBe('warning')
    expect(ruleSeverityTagType('INFO')).toBe('info')
    // 认不出的码给灰：它已经拦不住任何报告了（后端 ofStrict 对它返回 null，
    // 于是 blocksFinalizeNow 恒为 false），给红会让人以为定稿被一条坏数据卡住了，
    // 而实际卡住它的是别的东西
    expect(ruleSeverityTagType('WHATEVER')).toBe('info')
    expect(ruleSeverityTagType(undefined)).toBe('info')
  })
})

describe('LAW_DOMAIN_OPTIONS ← QlzgLawDomainEnum', () => {
  /**
   * 🔴 顺序是**优先级 1 → 6**，即「依据有多硬」，不是显示偏好。
   *    优先级决定两件事：同一处命中被多条规则判到时听谁的，以及**天花板**
   *    （maxSeverity()）—— 优先级 5「专家指引」的天花板是 WARN，
   *    因为建议性文件不能产生强制性拦截，且**永不升级**
   */
  it('与后端枚举逐字一致、顺序一致（优先级 1 → 6）', () => {
    expect(LAW_DOMAIN_OPTIONS.map((item) => item.value)).toEqual([
      'LAW',
      'REGULATION',
      'STANDARD',
      'SPEC',
      'EXPERT_GUIDE',
      'ORG_INTERNAL'
    ])
    expect(LAW_DOMAIN_OPTIONS.map((item) => item.label)).toEqual([
      '法律',
      '强制法规',
      '执业准则',
      '专业规范',
      '专家指引',
      '机构内部制度'
    ])
    expectWellFormed(LAW_DOMAIN_OPTIONS)
  })

  /**
   * 🔴 规则配置页上这一项是**固定显示「机构内部制度」**，不是一个能选的下拉：
   *    后端 resolveLawDomain 对其余五个一律拒（REVIEW_RULE_LAW_DOMAIN_FORCED）——
   *    让一条机构私规在 30 年档案里宣称自己有法律授权，是不可接受的。
   *    而 ORG_INTERNAL **照样可以配 BLOCK**：机构自己的内控要求本来就能拦自己人的稿。
   *    所以「选不了法律」不是功能缺失，这六个值出现在这份表里只为**展示**
   *    （平台预置行、留痕里的引用），不为选择
   */
  it('🔴 ORG_INTERNAL 在表里（配置页固定显示的那一个），且是最后一个', () => {
    expect(LAW_DOMAIN_OPTIONS[LAW_DOMAIN_OPTIONS.length - 1].value).toBe('ORG_INTERNAL')
    expect(labelOf(LAW_DOMAIN_OPTIONS, 'ORG_INTERNAL')).toBe('机构内部制度')
  })

  it('六个值都取得到中文名（labelOf 不回落成码）', () => {
    for (const { value } of LAW_DOMAIN_OPTIONS) {
      expect(labelOf(LAW_DOMAIN_OPTIONS, value)).not.toBe(value)
    }
  })
})

describe('WAIVE_SCOPE_OPTIONS ← QlzgWaiveScopeEnum', () => {
  it('与后端枚举逐字一致、顺序一致（由粗到细）', () => {
    expect(WAIVE_SCOPE_OPTIONS.map((item) => item.value)).toEqual(['ORG', 'PROJECT', 'REPORT'])
    expect(WAIVE_SCOPE_OPTIONS.map((item) => item.label)).toEqual(['机构', '项目', '报告'])
    expectWellFormed(WAIVE_SCOPE_OPTIONS)
  })

  it('认不出的作用域**原样显示**，不翻成「未知」', () => {
    // 后端 scopeNameOf 认不出取值时下发**原串**，不下发 of() 的回落值：
    // of() 对认不出的取值回落 REPORT，那是为「一行作用域写坏的留痕不该被当成
    // 机构级放行依据」而定的、落在严的一侧的回落 —— 用在**解析**上是对的，
    // 用在**显示**上会把一行坏数据显示成「报告级」，
    // 而配置页历史列表正是发现「这一行被写坏了」的唯一场合
    expect(labelOf(WAIVE_SCOPE_OPTIONS, 'WHATEVER')).toBe('WHATEVER')
  })
})

describe('RULE_TARGET_KIND_OPTIONS ← QlzgRuleTargetKindEnum', () => {
  it('与后端枚举逐字一致、顺序一致', () => {
    expect(RULE_TARGET_KIND_OPTIONS.map((item) => item.value)).toEqual([
      'FIELD',
      'SECTION',
      'CALC',
      'REPORT'
    ])
    expect(RULE_TARGET_KIND_OPTIONS.map((item) => item.label)).toEqual([
      '字段',
      '章节',
      '测算',
      '报告'
    ])
    expectWellFormed(RULE_TARGET_KIND_OPTIONS)
  })

  /**
   * 🔴 REPORT 这一档的 Anchor 是 NONE（无处可指），但**前端不要按 targetKind 推可定位性**：
   *    工作台那一列「定位」按钮的判据是后端算好的 locatable，
   *    而一份 REPORT 级的规则也可能带着 sectionCode，那时它是可定位的。
   *    前端自己推的结果是「明明能定位的行上没有那个按钮」，而两处都不报错
   */
  it('🔴 这一份只有 label 与 value 两列，没有第三列去替后端决定「可定位」', () => {
    for (const option of RULE_TARGET_KIND_OPTIONS) {
      expect(Object.keys(option)).toEqual(['label', 'value'])
    }
  })
})

describe('REVIEW_REASON_MIN_LENGTH / MAX_LENGTH ← QlzgReviewWaiverDO', () => {
  /**
   * 🔴 10 是 §11.9.2.7 第 5 条写死的规格，500 是 qlzg_review_waiver.reason 的**列宽**。
   *    两者都**不随机构变**，所以抄一份是安全的（与 resultFlow「不抄任何规则参数」
   *    那条纪律不冲突，理由写在 reviewFlow.ts 的类注释里）。
   *    超上限的后果是 MySQL Data too long，用户看到的是「系统异常」——
   *    前端不拦就等于把一个 SQL 报错交给评估师读
   */
  it('与后端同值', () => {
    expect(REVIEW_REASON_MIN_LENGTH).toBe(10)
    expect(REVIEW_REASON_MAX_LENGTH).toBe(500)
  })

  it('下限小于上限（写反的话每一句理由都不合格）', () => {
    expect(REVIEW_REASON_MIN_LENGTH).toBeLessThan(REVIEW_REASON_MAX_LENGTH)
  })
})

// ==================== 版本 diff 与红标（I6-b，§11.11.3） ====================

/**
 * 🔴 这两份清单是后端 {@code QlzgReportVersionDiffRespVO.FieldKind} /
 *    {@code SectionKind} 那两组 {@code String} 常量的**黄金副本**。
 *
 * ⚠️ 它们在后端**不是枚举**，是常量持有类（`public static final String`），
 *    所以 `changeKinds` 是 {@code List<String>} —— 后端加一种变化不需要改任何签名，
 *    编译期一个提示都没有。这一批用例就是那道提示：
 *    后端加了码而这里没跟上，用例红，逼人做一次显式决定（加进来、标好颜色），
 *    而不是让一条红标在界面上显示成一个谁也不认识的原始码。
 */
describe('REPORT_VERSION_DIFF_FIELD_KINDS ← QlzgReportVersionDiffRespVO.FieldKind', () => {
  it('与后端那六个常量逐字一致、顺序一致', () => {
    expect([...REPORT_VERSION_DIFF_FIELD_KINDS]).toEqual([
      'ADDED',
      'REMOVED',
      'VALUE',
      'PARAGRAPH',
      'SOURCE',
      'MARK'
    ])
  })

  it('每一个码都有中文与颜色（后端加了码而这里没跟上时这一条会红）', () => {
    for (const kind of REPORT_VERSION_DIFF_FIELD_KINDS) {
      expect(REPORT_VERSION_DIFF_FIELD_KIND_LABELS[kind], `缺中文：${kind}`).toBeTruthy()
      expect(REPORT_VERSION_DIFF_FIELD_KIND_TAG_TYPES[kind], `缺颜色：${kind}`).toBeTruthy()
    }
    expect(Object.keys(REPORT_VERSION_DIFF_FIELD_KIND_LABELS).sort()).toEqual(
      [...REPORT_VERSION_DIFF_FIELD_KINDS].sort()
    )
  })

  it('🔴 PARAGRAPH 在清单里，而且不是 VALUE 的别名 —— 两者分开数', () => {
    // §11.11.3 原话：「段落文字变了也标红」（M2 下 AI 重生成一段，复核人必须看见）。
    // 折进 VALUE 里的话后端那个 changedParagraphCount 就没有对应的中文，
    // 而「有没有哪一段散文被改过」正是复核人最先要问的一句
    expect(REPORT_VERSION_DIFF_FIELD_KIND_LABELS.PARAGRAPH).toBe('段落文字变了')
    expect(REPORT_VERSION_DIFF_FIELD_KIND_LABELS.VALUE).toBe('值变了')
  })

  it('🔴 danger 只给三种：删一格、值变了、段落文字变了', () => {
    // 删一格比改一格更值得红（改还有旧值可对，删了就什么都没有了），
    // 而其余三种（新增、来源变了、红标状态变了）都是事、但都不直接指向报告上的错
    expect(REPORT_VERSION_DIFF_FIELD_KIND_TAG_TYPES.REMOVED).toBe('danger')
    expect(REPORT_VERSION_DIFF_FIELD_KIND_TAG_TYPES.VALUE).toBe('danger')
    expect(REPORT_VERSION_DIFF_FIELD_KIND_TAG_TYPES.PARAGRAPH).toBe('danger')
    expect(REPORT_VERSION_DIFF_FIELD_KIND_TAG_TYPES.ADDED).toBe('warning')
    expect(REPORT_VERSION_DIFF_FIELD_KIND_TAG_TYPES.SOURCE).toBe('warning')
    expect(REPORT_VERSION_DIFF_FIELD_KIND_TAG_TYPES.MARK).toBe('warning')
  })

  it('🔴 认不出的码回落成**原始码**，不回落成「未知」', () => {
    // 与 provenanceSourceLabel 那条相反：红标种类认不出意味着后端加了一种
    // 前端还不知道的变化，藏进「未知」等于让复核人扫一眼就过去
    expect(versionDiffFieldKindLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW')
    expect(versionDiffFieldKindTagType('SOMETHING_NEW')).toBe('info')
    expect(versionDiffFieldKindLabel(null)).toBe(UNKNOWN_LABEL_FALLBACK)
    expect(versionDiffFieldKindTagType(undefined)).toBe('info')
  })
})

describe('REPORT_VERSION_DIFF_SECTION_KINDS ← QlzgReportVersionDiffRespVO.SectionKind', () => {
  it('与后端那六个常量逐字一致、顺序一致', () => {
    expect([...REPORT_VERSION_DIFF_SECTION_KINDS]).toEqual([
      'ADDED',
      'REMOVED',
      'TITLE',
      'CLAUSE_REF',
      'CONTENT_MODE',
      'ORDER'
    ])
  })

  it('每一个码都有中文与颜色', () => {
    for (const kind of REPORT_VERSION_DIFF_SECTION_KINDS) {
      expect(REPORT_VERSION_DIFF_SECTION_KIND_LABELS[kind], `缺中文：${kind}`).toBeTruthy()
      expect(REPORT_VERSION_DIFF_SECTION_KIND_TAG_TYPES[kind], `缺颜色：${kind}`).toBeTruthy()
    }
  })

  it('🔴 只有 CLAUSE_REF 是 danger —— 它是 G-04 的输入，一条法律事实', () => {
    // 改一列就让一条 BLOCK 规则静默失效：一份报告声称遵循的准则条款被换掉，
    // 比这一节挪了个位置严重得多
    expect(REPORT_VERSION_DIFF_SECTION_KIND_TAG_TYPES.CLAUSE_REF).toBe('danger')
    for (const kind of REPORT_VERSION_DIFF_SECTION_KINDS) {
      if (kind === 'CLAUSE_REF') continue
      expect(REPORT_VERSION_DIFF_SECTION_KIND_TAG_TYPES[kind], `${kind} 不该是 danger`).toBe(
        'warning'
      )
    }
  })

  it('🔴 认不出的码同样回落成原始码', () => {
    expect(versionDiffSectionKindLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW')
    expect(versionDiffSectionKindTagType('SOMETHING_NEW')).toBe('info')
  })
})

describe('versionDiffTemplateText：三态，null 不是 false', () => {
  it('true → warning，而且要说清「字段级红标比不出这件事」', () => {
    const banner = versionDiffTemplateText(true)
    expect(banner?.type).toBe('warning')
    expect(banner?.text).toContain('版式换了')
    expect(banner?.text).toContain('比不出')
  })

  it('false → null（整栏不显示）：「版式没变」是常态，印在每一版上就是稀释要紧的那一句', () => {
    expect(versionDiffTemplateText(false)).toBeNull()
  })

  it('🔴 null → 也要说，而且必须说成「无法判断」', () => {
    // 把「不知道」显示成「没变」，等于对着一份可能整篇重排过的报告说「版式没变」
    const banner = versionDiffTemplateText(null)
    expect(banner?.type).toBe('info')
    expect(banner?.text).toContain('无法判断')
    expect(versionDiffTemplateText(undefined)?.text).toBe(banner?.text)
  })

  it('🔴 三种措辞里都**不含数字** —— 后端给的是行编号，不是「第几版」', () => {
    // fromTemplateVersionId / toTemplateVersionId 是 qlzg_template_version 的主键。
    // 印成「第 700 版 → 第 701 版」是一句假话，而它读起来又完全像一个版本号
    const texts = [true, false, null]
      .map((value) => versionDiffTemplateText(value))
      .filter((banner): banner is { text: string; type: 'warning' | 'info' } => banner !== null)
    // 🔴 先证明这一条**非空过**：三态里 true 与 null 各给一句话，false 整栏不显示
    expect(texts).toHaveLength(2)
    for (const text of texts.map((banner) => banner.text)) {
      expect(/\d/.test(text), `印出了数字：${text}`).toBe(false)
    }
  })
})

describe('VERSION_NOT_DIFFABLE_LABEL / versionCreatorText：清单页那两格', () => {
  it('🔴 那句话里不许出现「没有变更」—— 两句话在复核人眼里是完全不同的结论', () => {
    expect(VERSION_NOT_DIFFABLE_LABEL).not.toContain('没有变更')
    expect(VERSION_NOT_DIFFABLE_LABEL).toContain('没有可比的上文')
  })

  it('有人名给人名，没有人名给「已离岗（编号 N）」，两者都没有才给「未知」', () => {
    expect(versionCreatorText('1234', '张三')).toBe('张三')
    // 🔴 定稿人是《资产评估法》第二十六条的责任锚点，
    //    把「查不到」伪装成「查过了，没有这个人」是不行的
    expect(versionCreatorText('1234', null)).toBe('已离岗（编号 1234）')
    expect(versionCreatorText(1234, '')).toBe('已离岗（编号 1234）')
    expect(versionCreatorText(null, null)).toBe(UNKNOWN_LABEL_FALLBACK)
  })
})
