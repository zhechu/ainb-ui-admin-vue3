/**
 * {@code extFieldRule.ts} 的守卫
 *
 * <h3>这里钉的是「一行字段定义变成一条规则时，哪些东西**不许**出现」</h3>
 * 造规则的代码是白名单式的，所以它的缺陷不表现为「多写了什么」，
 * 而表现为「白名单里漏了一项该有的」或「契约变了而白名单没跟上」。
 * 前者由逐控件的用例钉住，后者由从**控件契约派生**的那几条断言钉住 ——
 * 派生的断言在契约新增 / 改名控件时会变红，而快照式的断言只会安静地少一个键。
 *
 * <h3>🔴 为什么这些用例值得写：它们守的全是**静默**故障</h3>
 * 下面每一条事故的共同点是「HTTP 200、没有异常、界面上看不出区别」：
 * 选项写错路径 → 配了 5 个选项一个都不显示；{@code switch} 配了 {@code activeValue} →
 * 这个字段每次保存都报错；日期少了 {@code valueFormat} → 填了值、保存成功、详情页那一栏是空的；
 * {@code nodeKey} 与值键不一致 → 树渲染出来了但一个节点都选不中。
 * 这类缺陷不会在评审时被看见，只会在机构用了三个月之后被发现，
 * 而那时已经有一批报告引用了那个字段。
 */
import { describe, expect, it } from 'vitest'
import type { QlzgFieldDefVO } from '@/api/qlzg/fieldDef'
import { getWidgetContract, listWidgetContracts } from '@/components/FormWidgets/contracts'
import { OPTION_SOURCE_TARGETS } from '@/components/FormCreate/src/utils/optionTargets'
import {
  buildExtFieldRule,
  buildExtFieldRules,
  compactExt,
  countSupportedWidgets,
  coversScene,
  DATE_PICKER_VALUE_FORMATS,
  DATE_RANGE_TYPES,
  EDITABLE_PROPS,
  editablePropsOf,
  extFieldsFor,
  EXT_FIELD_SCENES,
  EXT_FIELD_WIDGET_TYPES,
  EXT_FIELD_WIDGET_WITHHELD,
  isAbsentValue,
  isArrayValueWidget,
  isOptionWidget,
  listExtFieldWidgetOptions,
  listSameFamilyWidgetOptions,
  listUnstorablePaletteWidgets,
  loadExtModel,
  optionTargetOf,
  ruleTypeOf,
  sameFamilyWidgets,
  shouldUseFormDesign,
  TIME_VALUE_FORMAT,
  whyNotStorable
} from './extFieldRule'

/** 造一条字段定义。默认是「启用、两边都渲染、非必填、没有选项」 */
const def = (over: Partial<QlzgFieldDefVO> = {}): QlzgFieldDefVO =>
  ({
    id: 1,
    entityType: 'QLZG_PROJECT',
    fieldKey: 'risk_level',
    fieldLabel: '内部风险等级',
    widgetType: 'input',
    required: false,
    sort: 0,
    scene: 'BOTH',
    exportable: true,
    enabled: true,
    platform: false,
    ...over
  }) as QlzgFieldDefVO

const options = (widgetType: string, list: any[], props?: Record<string, any>) =>
  def({ widgetType, options: list.length || props ? { options: list, props } : null })

describe('控件白名单与契约', () => {
  it('🔴 白名单里的每一项都是「可落库」的——这条断言从契约派生，契约改坏了它就红', () => {
    expect(listUnstorablePaletteWidgets()).toEqual([])
  })

  it('🔴 白名单里的每一项在契约里都存在且 supported，且不重复', () => {
    expect(new Set(EXT_FIELD_WIDGET_TYPES).size).toBe(EXT_FIELD_WIDGET_TYPES.length)
    for (const type of EXT_FIELD_WIDGET_TYPES) {
      const contract = getWidgetContract(type)
      expect(contract, `契约里没有 ${type}`).toBeTruthy()
      expect(contract!.supported, `${type} 在契约里是 supported=false`).toBe(true)
    }
  })

  it('🔴 白名单是契约的一个真子集：契约里可落库的控件比它放出来的多', () => {
    // 派生方向是「契约 → 白名单」的反面：白名单不能反过来定义契约。
    // 这里断言的是**没放完**，也就是白名单确实是一次取舍，而不是一份自动生成的清单
    const storable = listWidgetContracts()
      .filter((item) => item.supported && !whyNotStorable(item.type) && !shouldUseFormDesign(item.type))
      .map((item) => item.type)
    expect(storable.length).toBeGreaterThan(EXT_FIELD_WIDGET_TYPES.length)
    for (const type of EXT_FIELD_WIDGET_TYPES) {
      expect(storable).toContain(type)
    }
  })

  it('🔴 扣着的那 9 项一项都不在白名单里，且每一项在契约里都真实存在', () => {
    const withheld = Object.keys(EXT_FIELD_WIDGET_WITHHELD)
    expect(withheld.length).toBe(9)
    for (const type of withheld) {
      expect(EXT_FIELD_WIDGET_TYPES, `${type} 被扣着却也在白名单里`).not.toContain(type)
      expect(getWidgetContract(type), `契约里没有 ${type}，扣留理由就成了空话`).toBeTruthy()
      expect(EXT_FIELD_WIDGET_WITHHELD[type].length).toBeGreaterThan(10)
    }
  })

  it('🔴 扣着的理由必须是**具体**的：指名一个 prop、一列值或一个渲染后果', () => {
    // 「暂时没做」「以后再说」这类理由写不出可验证的内容，也就没人会在放开时删掉它。
    // 具体理由的共同形状是里面有一个技术名词（≥3 个拉丁字母的标识符）或那个 ★ 标记
    // （★ 是契约里 required prop 的记号，意味着「不配它就渲染不出来」）
    for (const [type, reason] of Object.entries(EXT_FIELD_WIDGET_WITHHELD)) {
      expect(reason, `${type} 的理由里没有技术名词`).toMatch(/[A-Za-z_]{3,}|★/)
    }
  })

  it('下拉选项的 label 取自契约，取不到时回落成类型名而不是 undefined', () => {
    const list = listExtFieldWidgetOptions()
    expect(list).toHaveLength(EXT_FIELD_WIDGET_TYPES.length)
    for (const item of list) {
      expect(item.label).toBe(getWidgetContract(item.value)?.label ?? item.value)
      expect(item.label).toBeTruthy()
    }
    expect(countSupportedWidgets()).toBe(55)
  })

  it('场景清单与后端 QlzgFieldSceneEnum 的三个值逐字一致', () => {
    expect(EXT_FIELD_SCENES.map((item) => item.value)).toEqual(['BOTH', 'FORM', 'DETAIL'])
  })
})

describe('可编辑 props 白名单', () => {
  it('🔴 白名单的键都是**控件类型**（不是规则类型），且都在放出来的那 16 项里', () => {
    for (const type of Object.keys(EDITABLE_PROPS)) {
      expect(EXT_FIELD_WIDGET_TYPES, `${type} 不在白名单里，它的可编辑 props 永远用不上`).toContain(
        type
      )
      // textarea 的规则类型是 input；若有人按规则类型写了键，这一条会红
      expect(getWidgetContract(type), `${type} 不是契约类型`).toBeTruthy()
    }
  })

  it('🔴 白名单里列的 prop，凡是契约声明过的都确实存在；契约没声明的那两个必须有据可查', () => {
    // 契约的 props[] 只收录「配错了会静默失效」的那些，所以它**不是**控件 props 的全集。
    // datePicker 的 props.type（面板类型）与 dateRange 的 props.type 都属于「契约没收录但真实存在」，
    // 这一份例外清单是显式的：契约哪天把它俩收录进去，这里就该删掉对应的那一行
    const UNDECLARED_BUT_REAL: Record<string, string[]> = {
      datePicker: ['type'],
      dateRange: ['type']
    }
    for (const [type, names] of Object.entries(EDITABLE_PROPS)) {
      const declared = (getWidgetContract(type)?.props ?? []).map((prop) => prop.name)
      for (const name of names) {
        if (declared.includes(name)) {
          continue
        }
        expect(UNDECLARED_BUT_REAL[type], `${type}.${name} 既不在契约里也不在例外清单里`).toContain(
          name
        )
      }
      // 反方向：例外清单里不能有契约已经声明了的（那说明例外已经过期）
      for (const name of UNDECLARED_BUT_REAL[type] ?? []) {
        if (names.includes(name)) {
          expect(declared, `${type}.${name} 已被契约收录，例外清单该删掉它`).not.toContain(name)
        }
      }
    }
  })

  it('🔴 放出来的 16 项里，没有任何一项在契约里声明了 required 的 prop', () => {
    // 有的话就意味着「这个控件不配那个 prop 就渲染不出来」，而字段管理页必须给它一个编辑器。
    // 现在一条都没有，所以界面上不存在「必填的控件配置」这种东西 —— 这是一条**当前成立**
    // 的事实，将来契约加了就会红，那时才需要动手
    for (const type of EXT_FIELD_WIDGET_TYPES) {
      const required = (getWidgetContract(type)?.props ?? []).filter((prop) => prop.required)
      expect(required, `${type} 有必填 prop 却没有对应的编辑入口`).toEqual([])
    }
  })

  it('不在白名单里的控件一律是「一个 prop 都不能配」', () => {
    for (const type of ['switch', 'input', 'select', 'radio', 'checkbox', 'cascader', 'elTreeSelect', 'timePicker', 'timeRange', 'colorPicker']) {
      expect(editablePropsOf(type)).toEqual([])
    }
    expect(editablePropsOf(undefined)).toEqual([])
    expect(editablePropsOf('不存在的控件')).toEqual([])
    expect(editablePropsOf('textarea')).toEqual(['rows'])
  })

  it('🔴 日期格式表只有 date / datetime 两个键，且没有一个格式里含逗号', () => {
    expect(Object.keys(DATE_PICKER_VALUE_FORMATS)).toEqual(['date', 'datetime'])
    for (const format of Object.values(DATE_PICKER_VALUE_FORMATS)) {
      expect(format).not.toContain(',')
    }
    // 面板上本来还有九种，其中三种交出数组，与契约的 date/scalar 对不上
    expect(DATE_PICKER_VALUE_FORMATS).not.toHaveProperty('daterange')
    expect(DATE_PICKER_VALUE_FORMATS).not.toHaveProperty('datetimerange')
    expect(DATE_PICKER_VALUE_FORMATS).not.toHaveProperty('monthrange')
    expect(DATE_RANGE_TYPES).toEqual(['daterange', 'datetimerange', 'monthrange'])
    expect(TIME_VALUE_FORMAT).toBe('HH:mm:ss')
  })
})

describe('控件族（与后端 validateWidgetFamily 对齐）', () => {
  it('🔴 同族判据是 valueType + storage，不是「看起来像」', () => {
    // input 与 select 同族（都是 string/scalar）—— 这一条**反直觉**，所以要显式钉住：
    // 后端 QlzgFieldDefServiceImpl#validateWidgetFamily 就是这么判的，
    // 前端若「顺手收紧」成按 group 判，界面上会拒掉一个后端允许的改动
    expect(sameFamilyWidgets('input', 'select')).toBe(true)
    expect(sameFamilyWidgets('input', 'textarea')).toBe(true)
    expect(sameFamilyWidgets('inputNumber', 'slider')).toBe(true)
    expect(sameFamilyWidgets('inputNumber', 'rate')).toBe(true)
    expect(sameFamilyWidgets('checkbox', 'cascader')).toBe(true)
    expect(sameFamilyWidgets('dateRange', 'timeRange')).toBe(true)
  })

  it('🔴 跨族一律判不同族', () => {
    expect(sameFamilyWidgets('input', 'inputNumber')).toBe(false)
    expect(sameFamilyWidgets('checkbox', 'select')).toBe(false)
    expect(sameFamilyWidgets('datePicker', 'dateRange')).toBe(false)
    expect(sameFamilyWidgets('switch', 'input')).toBe(false)
  })

  it('🔴 查不到契约就判不同族——库里存着一个契约已不认识的控件时，一律拒绝改动', () => {
    expect(sameFamilyWidgets('不存在的控件', 'input')).toBe(false)
    expect(sameFamilyWidgets('input', '不存在的控件')).toBe(false)
    expect(sameFamilyWidgets(undefined, 'input')).toBe(false)
    // 自己与自己短路，即使契约不认识它
    expect(sameFamilyWidgets('不存在的控件', '不存在的控件')).toBe(true)
  })

  it('同族关系在白名单上是自反、对称、传递的', () => {
    const list = [...EXT_FIELD_WIDGET_TYPES]
    for (const a of list) {
      expect(sameFamilyWidgets(a, a)).toBe(true)
      for (const b of list) {
        expect(sameFamilyWidgets(a, b)).toBe(sameFamilyWidgets(b, a))
      }
    }
    for (const a of list) {
      for (const b of list) {
        for (const c of list) {
          if (sameFamilyWidgets(a, b) && sameFamilyWidgets(b, c)) {
            expect(sameFamilyWidgets(a, c), `${a}~${b}~${c} 不传递`).toBe(true)
          }
        }
      }
    }
  })

  it('🔴 编辑时的控件下拉是「同族 ∩ 白名单」，扣着的 tree 不会因为是 array/delimited 而漏进来', () => {
    const forCheckbox = listSameFamilyWidgetOptions('checkbox').map((item) => item.value)
    expect(forCheckbox).toEqual(['dateRange', 'timeRange', 'checkbox', 'cascader'])
    expect(forCheckbox).not.toContain('tree')
    expect(forCheckbox).not.toContain('elTransfer')
    // switch 与 datePicker 在白名单里各自独占一族
    expect(listSameFamilyWidgetOptions('switch').map((item) => item.value)).toEqual(['switch'])
    expect(listSameFamilyWidgetOptions('datePicker').map((item) => item.value)).toEqual([
      'datePicker'
    ])
    expect(listSameFamilyWidgetOptions(undefined).map((item) => item.value)).toEqual([])
  })
})

describe('规则类型映射', () => {
  it('🔴 textarea 是唯一一个「契约类型 ≠ 规则类型」的控件', () => {
    expect(ruleTypeOf('textarea')).toBe('input')
    for (const type of EXT_FIELD_WIDGET_TYPES) {
      if (type === 'textarea') {
        continue
      }
      expect(ruleTypeOf(type), `${type} 的规则类型与契约类型不一致，覆盖表该更新了`).toBe(type)
    }
  })
})

describe('值的形状', () => {
  it('🔴 0 与 false **不是**「没填」', () => {
    expect(isAbsentValue(0)).toBe(false)
    expect(isAbsentValue(false)).toBe(false)
    expect(isAbsentValue('0')).toBe(false)
    expect(isAbsentValue([0])).toBe(false)
    expect(isAbsentValue(new Date())).toBe(false)
  })

  it('🔴 null / undefined / 空白串 / 空数组 / 空对象才算「没填」', () => {
    for (const value of [null, undefined, '', '   ', '\t\n', [], {}]) {
      expect(isAbsentValue(value), `${JSON.stringify(value)} 应判为空`).toBe(true)
    }
  })

  it('数组类控件从契约的 valueType 派生，四项一个不多一个不少', () => {
    const arrays = EXT_FIELD_WIDGET_TYPES.filter((type) => isArrayValueWidget(type))
    expect(arrays).toEqual(['dateRange', 'timeRange', 'checkbox', 'cascader'])
    expect(isArrayValueWidget('elTreeSelect')).toBe(false)
    expect(isArrayValueWidget(undefined)).toBe(false)
  })

  it('🔴 选项类控件就是 OPTION_SOURCE_TARGETS 里的那几个，落点也从那里读', () => {
    // 派生断言：本模块不另立一份「哪些控件有选项」的清单
    const expected = EXT_FIELD_WIDGET_TYPES.filter((type) => !!OPTION_SOURCE_TARGETS[type])
    expect(expected).toEqual(['select', 'radio', 'checkbox', 'cascader', 'elTreeSelect'])
    for (const type of expected) {
      expect(isOptionWidget(type)).toBe(true)
      expect(optionTargetOf(type)).toBe(OPTION_SOURCE_TARGETS[type])
    }
    expect(isOptionWidget('input')).toBe(false)
    expect(isOptionWidget('tree')).toBe(true) // 在表里，但被扣着不放出来
    expect(optionTargetOf(undefined)).toBeUndefined()
  })
})

describe('场景与过滤', () => {
  it('🔴 BOTH 覆盖两边；scene 为空也覆盖两边（与后端 covers / isRequiredOnForm 同口径）', () => {
    expect(coversScene(def({ scene: 'BOTH' }), 'FORM')).toBe(true)
    expect(coversScene(def({ scene: 'BOTH' }), 'DETAIL')).toBe(true)
    expect(coversScene(def({ scene: 'FORM' }), 'FORM')).toBe(true)
    expect(coversScene(def({ scene: 'FORM' }), 'DETAIL')).toBe(false)
    expect(coversScene(def({ scene: 'DETAIL' }), 'FORM')).toBe(false)
    expect(coversScene(def({ scene: 'DETAIL' }), 'DETAIL')).toBe(true)
    expect(coversScene(def({ scene: undefined as any }), 'FORM')).toBe(true)
    expect(coversScene(def({ scene: undefined as any }), 'DETAIL')).toBe(true)
    // 🔴 小写不算覆盖：前端 renderScene.ts 用的是小写。BOTH 那一支不看 requested 所以照样 true
    //    （与后端 covers 同口径），但 FORM / DETAIL 这两支会**静默失配** ——
    //    表现是「明明勾了『新增/编辑』，表单里却没有这个字段」，而界面上那一格是勾着的
    expect(coversScene(def({ scene: 'FORM' }), 'form' as any)).toBe(false)
    expect(coversScene(def({ scene: 'DETAIL' }), 'detail' as any)).toBe(false)
  })

  it('🔴 FORM 只渲染启用的行，DETAIL 渲染全部（含停用的）', () => {
    const defs = [
      def({ id: 1, fieldKey: 'a', enabled: true }),
      def({ id: 2, fieldKey: 'b', enabled: false })
    ]
    expect(extFieldsFor(defs, 'FORM').map((item) => item.fieldKey)).toEqual(['a'])
    expect(extFieldsFor(defs, 'DETAIL').map((item) => item.fieldKey)).toEqual(['a', 'b'])
  })

  it('🔴 排序键是 sort asc, id asc —— 与后端 Mapper 一致，不是 id 也不是创建时间', () => {
    const defs = [
      def({ id: 9, fieldKey: 'c', sort: 2 }),
      def({ id: 5, fieldKey: 'b2', sort: 1 }),
      def({ id: 3, fieldKey: 'b1', sort: 1 }),
      def({ id: 1, fieldKey: 'a', sort: 1 })
    ]
    // sort=1 的三条按 id 升序是 a(1) / b1(3) / b2(5)，c 的 sort=2 所以排最后
    expect(extFieldsFor(defs, 'FORM').map((item) => item.fieldKey)).toEqual(['a', 'b1', 'b2', 'c'])
    // 🔴 上面那一条只按 id 排也能过（1<3<5<9），所以再补一条 sort 必须压倒 id 的
    expect(
      extFieldsFor(
        [def({ id: 1, fieldKey: 'low', sort: 9 }), def({ id: 99, fieldKey: 'high', sort: 1 })],
        'FORM'
      ).map((item) => item.fieldKey)
    ).toEqual(['high', 'low'])
  })

  it('入参是 null / undefined 时得到空清单，不抛', () => {
    expect(extFieldsFor(null, 'FORM')).toEqual([])
    expect(extFieldsFor(undefined, 'DETAIL')).toEqual([])
    expect(buildExtFieldRules(null, 'FORM')).toEqual({ rules: [], skipped: [] })
  })

  it('🔴 extFieldsFor 不改动传进来的数组', () => {
    // 它内部是 filter 之后才 sort，而 filter 已经造了新数组。
    // 这条断言钉住的是「不要哪天为了少一次遍历改成原地 sort」——
    // 那个数组是 API 返回的对象，改了会连带改掉字段管理页正在显示的那一份
    const defs = [def({ id: 2, sort: 2 }), def({ id: 1, sort: 1 })]
    extFieldsFor(defs, 'FORM')
    expect(defs.map((item) => item.id)).toEqual([2, 1])
  })
})

describe('造规则：危险 props 到不了 rule.props', () => {
  it('🔴 input 的 maskRule / uniqueCheck / validateRules 一律不出现', () => {
    const rule = buildExtFieldRule(
      def({
        widgetType: 'input',
        options: {
          props: {
            maskRule: 'NAME',
            uniqueCheck: true,
            validateRules: [{ type: 'BUILTIN', patternKey: 'MOBILE' }],
            placeholder: '这个键也不在白名单里'
          }
        }
      }),
      'FORM'
    )!
    expect(rule.type).toBe('input')
    expect(rule.props).toEqual({})
    // 掩码值被回填上来会覆盖库里的真值，本仓已经栽过一次（CLIENT_SECRET_IS_MASKED）
    expect(rule.props).not.toHaveProperty('maskRule')
  })

  it('🔴 switch 的 activeValue / inactiveValue 一律不出现', () => {
    const rule = buildExtFieldRule(
      options('switch', [], { activeValue: 1, inactiveValue: 0 }),
      'FORM'
    )!
    expect(rule.type).toBe('switch')
    expect(rule.props).toEqual({})
    // 后端 normalizeBoolean 只认真 Boolean；配成 1/0 之后这个字段**每次保存都报错**
  })

  it('🔴 timePicker 的 isRange 一律不出现，而 valueFormat 是强制的', () => {
    const rule = buildExtFieldRule(
      options('timePicker', [], { isRange: true, valueFormat: '随便写一个' }),
      'FORM'
    )!
    expect(rule.type).toBe('timePicker')
    expect(rule.props).toEqual({ valueFormat: TIME_VALUE_FORMAT })
    expect(rule.props).not.toHaveProperty('isRange')
  })

  it('🔴 select / radio / checkbox 的 multiple 一律不出现', () => {
    for (const type of ['select', 'radio', 'checkbox']) {
      const rule = buildExtFieldRule(options(type, [], { multiple: true, clearable: true }), 'FORM')!
      expect(rule.type).toBe(type)
      expect(rule.props, `${type} 的 props 该是空的`).toEqual({})
    }
  })

  it('🔴 elTreeSelect 的 showCheckbox 一律不出现——内核那条默认规则里它是 true，照抄就交出数组', () => {
    const rule = buildExtFieldRule(
      options('elTreeSelect', [{ label: '华东', value: '1' }], {
        showCheckbox: true,
        nodeKey: 'id',
        multiple: true
      }),
      'FORM'
    )!
    expect(rule.type).toBe('elTreeSelect')
    expect(rule.props).not.toHaveProperty('showCheckbox')
    expect(rule.props).not.toHaveProperty('multiple')
    // 🔴 nodeKey 由代码按 OPTION_SOURCE_TARGETS 的 valueKey 强制，管理员配的那个 'id' 到不了这里
    expect(rule.props.nodeKey).toBe('value')
    expect(rule.props.data).toEqual([{ label: '华东', value: '1' }])
  })

  it('🔴 白名单里的 props 会过去，白名单外的不会', () => {
    const rule = buildExtFieldRule(
      options('inputNumber', [], { precision: 4, min: 0, max: 100, step: 5, disabled: false }),
      'FORM'
    )!
    expect(rule.props).toEqual({ precision: 4, min: 0, max: 100 })
    expect(rule.props).not.toHaveProperty('step')
  })

  it('🔴 白名单里的 props 值为 null / undefined / 空串时不写进规则', () => {
    const rule = buildExtFieldRule(
      options('slider', [], { min: null, max: undefined, step: 1 }),
      'FORM'
    )!
    expect(rule.props).toEqual({})
    expect(Object.keys(rule.props)).toEqual([])
    // min: 0 是合法值，不能被上一条顺带丢掉
    expect(buildExtFieldRule(options('slider', [], { min: 0 }), 'FORM')!.props).toEqual({ min: 0 })
  })

  it('textarea 的 rows 走白名单，且规则类型是 input', () => {
    const rule = buildExtFieldRule(options('textarea', [], { rows: 6 }), 'FORM')!
    expect(rule.type).toBe('input')
    expect(rule.props).toEqual({ type: 'textarea', rows: 6 })
  })
})

describe('造规则：日期与时间', () => {
  it('🔴 datePicker 的 props.type 只有两个封闭取值，valueFormat 由它派生', () => {
    const date = buildExtFieldRule(options('datePicker', [], { type: 'date' }), 'FORM')!
    expect(date.props).toEqual({ type: 'date', valueFormat: 'YYYY-MM-DD' })
    const datetime = buildExtFieldRule(options('datePicker', [], { type: 'datetime' }), 'FORM')!
    expect(datetime.props).toEqual({ type: 'datetime', valueFormat: 'YYYY-MM-DD HH:mm:ss' })
  })

  it('🔴 datePicker 配了一个交数组的面板类型时，收敛到 date 而不是原样透传', () => {
    // 原样透传的后果：值是数组，而契约声明 date/scalar，后端 normalizeDate 拒收 ——
    // 于是**这个宿主的每一次保存**都失败，而管理员此时可能正在改一个别的字段
    for (const bad of ['daterange', 'datetimerange', 'monthrange', 'year', '乱写', '']) {
      const rule = buildExtFieldRule(options('datePicker', [], { type: bad }), 'FORM')!
      expect(rule.props.type, `type=${bad} 没被收敛`).toBe('date')
      expect(rule.props.valueFormat).toBe('YYYY-MM-DD')
    }
    // 没配 type 时也收敛，不留下一个 undefined
    expect(buildExtFieldRule(def({ widgetType: 'datePicker' }), 'FORM')!.props).toEqual({
      type: 'date',
      valueFormat: 'YYYY-MM-DD'
    })
  })

  it('🔴 dateRange 强制 type 三选一，且**不**写 valueFormat（渲染组件自己按 type 推）', () => {
    const rule = buildExtFieldRule(options('dateRange', [], { type: 'monthrange' }), 'FORM')!
    expect(rule.type).toBe('dateRange')
    expect(rule.props).toEqual({ type: 'monthrange' })
    expect(rule.props).not.toHaveProperty('valueFormat')
    // 在这里再抄一份格式表就是第二份会漂的副本
    expect(buildExtFieldRule(options('dateRange', [], { type: '乱写' }), 'FORM')!.props).toEqual({
      type: 'daterange'
    })
  })

  it('timeRange 一个 prop 都不需要：渲染组件里 is-range 是写死的', () => {
    const rule = buildExtFieldRule(options('timeRange', [], { isRange: false }), 'FORM')!
    expect(rule.type).toBe('timeRange')
    expect(rule.props).toEqual({})
  })
})

describe('造规则：选项落点', () => {
  it('🔴 扁平控件落在 rule.options，层级控件落在 rule.props 下', () => {
    const list = [
      { label: '高', value: '1' },
      { label: '低', value: '2' }
    ]
    for (const type of ['select', 'radio', 'checkbox']) {
      const rule = buildExtFieldRule(options(type, list), 'FORM')!
      expect(rule.options, `${type} 的选项没落在根上`).toEqual(list)
      expect(rule.props.options).toBeUndefined()
    }
    const cascader = buildExtFieldRule(options('cascader', list), 'FORM')!
    expect(cascader.props.options).toEqual(list)
    expect(cascader.options).toBeUndefined()
    // cascader 的层级来自 children 而不是 nodeKey，所以这里刻意**不加** nodeKey
    expect(cascader.props).not.toHaveProperty('nodeKey')
  })

  it('🔴 级联的子节点原样保留（valueKey 是 value 时不改写，所以 children 不会丢）', () => {
    const list = [{ label: '华东', value: '1', children: [{ label: '杭州', value: '1-1' }] }]
    const rule = buildExtFieldRule(options('cascader', list), 'FORM')!
    expect(rule.props.options[0].children).toEqual([{ label: '杭州', value: '1-1' }])
  })

  it('🔴 没有选项时**不写**这个键，而不是写一个空数组', () => {
    const rule = buildExtFieldRule(def({ widgetType: 'select' }), 'FORM')!
    expect(rule).not.toHaveProperty('options')
    expect(rule.props).not.toHaveProperty('options')
    expect(buildExtFieldRule(options('select', []), 'FORM')!).not.toHaveProperty('options')
  })

  it('非选项类控件即使库里存了 options 也不会写进规则', () => {
    const rule = buildExtFieldRule(options('input', [{ label: '甲', value: '1' }]), 'FORM')!
    expect(rule).not.toHaveProperty('options')
    expect(rule.props).toEqual({})
  })
})

describe('造规则：必填与只读', () => {
  it('🔴 required 只设 rule.required，**绝不**设 rule.validate', () => {
    // form-create 内核那个 provider 的实现是 inject.getProp().validate = [validate]，
    // 它【覆盖】而不是追加。自己写一条更友好的文案会被静默换回默认的那一句
    const rule = buildExtFieldRule(def({ required: true }), 'FORM')!
    expect(rule.required).toBe(true)
    expect(rule).not.toHaveProperty('validate')
    expect(rule).not.toHaveProperty('$required')
  })

  it('🔴 非必填时连 required 这个键都不出现', () => {
    const rule = buildExtFieldRule(def({ required: false }), 'FORM')!
    expect(rule).not.toHaveProperty('required')
  })

  it('🔴 DETAIL 场景不设 required，而是给每个控件加 props.disabled', () => {
    const rule = buildExtFieldRule(def({ required: true }), 'DETAIL')!
    expect(rule).not.toHaveProperty('required')
    expect(rule.props.disabled).toBe(true)
  })

  it('🔴 FORM 场景不加 disabled——加了整块表单就成了只读的', () => {
    const rule = buildExtFieldRule(def(), 'FORM')!
    expect(rule.props).not.toHaveProperty('disabled')
  })

  it('🔴 详情页里停用的字段标题带「（已停用字段）」，且不带 required', () => {
    const stopped = def({ fieldLabel: '内部风险等级', required: true, enabled: false })
    const rule = buildExtFieldRule(stopped, 'DETAIL')!
    expect(rule.title).toBe('内部风险等级（已停用字段）')
    expect(rule).not.toHaveProperty('required')
    // 同一行在 FORM 场景下压根不渲染，所以那里不需要这条标注
    expect(extFieldsFor([stopped], 'FORM')).toEqual([])
  })

  it('启用的字段标题就是 fieldLabel，不加任何后缀', () => {
    expect(buildExtFieldRule(def({ fieldLabel: '客户分级' }), 'DETAIL')!.title).toBe('客户分级')
    expect(buildExtFieldRule(def({ fieldLabel: '客户分级' }), 'FORM')!.title).toBe('客户分级')
  })

  it('🔴 rule.field 就是 fieldKey，原样不改', () => {
    // 加前缀（比如 ext_）会让提交上来的键与库里的键对不上，
    // 而后端对认不出的键报 EXT_FIELD_KEY_UNKNOWN
    expect(buildExtFieldRule(def({ fieldKey: 'risk_level' }), 'FORM')!.field).toBe('risk_level')
    expect(buildExtFieldRule(def({ fieldKey: 'constructor' }), 'FORM')!.field).toBe('constructor')
  })
})

describe('造规则：建不出来的控件', () => {
  it('🔴 group（子表）返回 undefined，且指向的是低代码表单设计', () => {
    expect(shouldUseFormDesign('group')).toBe(true)
    expect(buildExtFieldRule(def({ widgetType: 'group' }), 'FORM')).toBeUndefined()
    expect(buildExtFieldRules([def({ widgetType: 'group' })], 'FORM').skipped).toHaveLength(1)
  })

  it('🔴 契约里不存在的控件返回 undefined，而不是造一条渲染成空元素的规则', () => {
    expect(whyNotStorable('不存在的控件')).toBeTruthy()
    expect(buildExtFieldRule(def({ widgetType: '不存在的控件' }), 'FORM')).toBeUndefined()
  })

  it('🔴 文件 / 富文本 / 不落库 / password 各有一句具体理由', () => {
    expect(whyNotStorable('UploadImg')).toContain('文件')
    expect(whyNotStorable('Editor')).toContain('HTML')
    expect(whyNotStorable('elDivider')).toContain('不落库')
    expect(whyNotStorable('password')).toContain('口令')
    expect(whyNotStorable('input')).toBeUndefined()
    expect(whyNotStorable(undefined)).toContain('契约里没有')
  })

  it('🔴 子表的理由是 undefined——它不是「不可落库」，是「该走别的路」', () => {
    expect(whyNotStorable('group')).toBeUndefined()
    expect(shouldUseFormDesign('group')).toBe(true)
    expect(shouldUseFormDesign('tableForm')).toBe(true)
    expect(shouldUseFormDesign('input')).toBe(false)
  })

  it('🔴 buildExtFieldRules 把跳过的字段回传给调用方，并留一行 warn', () => {
    const defs = [
      def({ id: 1, fieldKey: 'ok', widgetType: 'input' }),
      def({ id: 2, fieldKey: 'bad', fieldLabel: '坏的字段', widgetType: '不存在的控件' })
    ]
    const result = buildExtFieldRules(defs, 'FORM')
    expect(result.rules.map((rule) => rule.field)).toEqual(['ok'])
    expect(result.skipped.map((item) => item.fieldKey)).toEqual(['bad'])
  })

  it('空清单进来就是空结果', () => {
    expect(buildExtFieldRules([], 'FORM')).toEqual({ rules: [], skipped: [] })
  })
})

describe('装载与回收', () => {
  it('🔴 数组类控件的空值给 []，不是 undefined', () => {
    // Element Plus 的 checkbox-group / cascader 拿到 undefined 会在渲染里抛，
    // 表现是「点编辑，弹窗打不开」，而控制台那行错指向 element-plus 内部
    const model = loadExtModel(
      [
        def({ fieldKey: 'a', widgetType: 'checkbox' }),
        def({ fieldKey: 'b', widgetType: 'cascader' }),
        def({ fieldKey: 'c', widgetType: 'dateRange' }),
        def({ fieldKey: 'd', widgetType: 'timeRange' }),
        def({ fieldKey: 'e', widgetType: 'input' }),
        def({ fieldKey: 'f', widgetType: 'switch' })
      ],
      null,
      'FORM'
    )
    expect(model).toEqual({ a: [], b: [], c: [], d: [], e: undefined, f: undefined })
  })

  it('🔴 有值但形状不对时**原样保留**，不收敛成 []', () => {
    // 收敛成 [] 之后提交上去就是「没填」，后端整列覆盖会把历史值删掉 ——
    // 那是一次静默的数据丢失。原样保留的代价是控件渲染得怪 + 保存时一句指名道姓的报错
    const model = loadExtModel(
      [def({ fieldKey: 'a', widgetType: 'checkbox' })],
      { a: '一个字符串' },
      'FORM'
    )
    expect(model.a).toBe('一个字符串')
  })

  it('🔴 0 / false / 空串这三种「像空但不是空」的值原样进模型', () => {
    const model = loadExtModel(
      [
        def({ fieldKey: 'n', widgetType: 'inputNumber' }),
        def({ fieldKey: 'b', widgetType: 'switch' }),
        def({ fieldKey: 's', widgetType: 'input' })
      ],
      { n: 0, b: false, s: '' },
      'FORM'
    )
    expect(model.n).toBe(0)
    expect(model.b).toBe(false)
    expect(model.s).toBe('')
  })

  it('🔴 只为要渲染的字段建键：FORM 场景下停用的字段与孤儿键都不进模型', () => {
    // 后端 carryOverReadOnly 会在整列覆盖时把它们从库里那份原样带过去。
    // 前端也带一份的话两边就都在管同一件事，而只有后端那一份看得见库里现值
    const model = loadExtModel(
      [
        def({ id: 1, fieldKey: 'live', widgetType: 'input' }),
        def({ id: 2, fieldKey: 'dead', widgetType: 'input', enabled: false })
      ],
      { live: '甲', dead: '乙', orphan: '丙' },
      'FORM'
    )
    expect(Object.keys(model)).toEqual(['live'])
  })

  it('🔴 scene=DETAIL 的字段不进 FORM 模型——它靠后端 carryOverReadOnly 活着，不是靠这里', () => {
    // 复现路径全在界面上：建一个 scene=BOTH 的字段、填个值，再到字段管理页把
    // 「出现位置」改成「详情」，然后打开宿主编辑弹窗点确定（哪怕一个字都没改）。
    // 这里不为它建键 ⟹ payload 里没有它 ⟹ 后端若只带停用字段与孤儿键，那个值就被静默删掉，
    // 而提示是「修改成功」。后端 QlzgExtFieldValidator#isReadOnlyOnWrite 已把这一类补进去。
    const model = loadExtModel(
      [
        def({ id: 1, fieldKey: 'live', widgetType: 'input' }),
        def({ id: 2, fieldKey: 'detail_only', widgetType: 'input', scene: 'DETAIL' })
      ],
      { live: '甲', detail_only: '乙' },
      'FORM'
    )
    expect(Object.keys(model), 'detail_only 不该进 FORM 模型').toEqual(['live'])
    // 反过来：DETAIL 场景要能看见它
    expect(loadExtModel([def({ fieldKey: 'detail_only', scene: 'DETAIL' })], { detail_only: '乙' }, 'DETAIL')).toEqual({
      detail_only: '乙'
    })
  })

  it('🔴 DETAIL 场景下停用的字段进模型（详情页要显示它的历史值）', () => {
    const model = loadExtModel(
      [
        def({ id: 1, fieldKey: 'live', widgetType: 'input' }),
        def({ id: 2, fieldKey: 'dead', widgetType: 'input', enabled: false })
      ],
      { live: '甲', dead: '乙' },
      'DETAIL'
    )
    expect(model).toEqual({ live: '甲', dead: '乙' })
  })

  it('🔴 fieldKey 叫 constructor / toString 时也能正常装载', () => {
    // 这两个名字都匹配后端的 FIELD_KEY_PATTERN（^[a-z][a-z0-9_]{1,62}$），
    // 所以是**合法**的 fieldKey。用 `key in obj` 判存在会从原型链上读到一个函数当值
    const model = loadExtModel(
      [
        def({ fieldKey: 'constructor', widgetType: 'input' }),
        def({ fieldKey: 'toString', widgetType: 'input' })
      ],
      { constructor: '甲' },
      'FORM'
    )
    expect(model.constructor).toBe('甲')
    expect(model.toString).toBeUndefined()
  })

  it('🔴 compactExt 摘掉空值的键，保住 0 与 false', () => {
    const result = compactExt({
      keep0: 0,
      keepFalse: false,
      keepStr: '甲',
      keepArr: ['甲'],
      dropNull: null,
      dropUndef: undefined,
      dropBlank: '   ',
      dropEmptyArr: [],
      dropEmptyObj: {}
    })
    expect(result).toEqual({ keep0: 0, keepFalse: false, keepStr: '甲', keepArr: ['甲'] })
    expect(Object.keys(result)).toEqual(['keep0', 'keepFalse', 'keepStr', 'keepArr'])
  })

  it('🔴 compactExt 用 Object.keys，所以原型链上的名字不会混进来', () => {
    expect(compactExt({})).toEqual({})
    expect(Object.keys(compactExt({}))).toEqual([])
    // toString / valueOf 是合法 fieldKey；valueOf 的值是 0，还要同时钉住「0 不是空」
    expect(compactExt({ toString: '甲', valueOf: 0 })).toEqual({ toString: '甲', valueOf: 0 })
    expect(compactExt(null)).toEqual({})
    expect(compactExt(undefined)).toEqual({})
  })

  it('🔴 装出来又原样收回去，形状不变（一条往返回路上不丢东西）', () => {
    const defs = [
      def({ id: 1, fieldKey: 'n', widgetType: 'inputNumber' }),
      def({ id: 2, fieldKey: 'b', widgetType: 'switch' }),
      def({ id: 3, fieldKey: 'c', widgetType: 'checkbox' }),
      def({ id: 4, fieldKey: 's', widgetType: 'input' })
    ]
    const stored = { n: 0, b: false, c: ['甲'], s: '乙' }
    expect(compactExt(loadExtModel(defs, stored, 'FORM'))).toEqual(stored)
  })

  it('🔴 装载时补的 [] 在回收时被摘掉，不会被当成「用户清空了」提交上去', () => {
    // 这一条是上面那条的反面：新开的表单里数组控件是 []，
    // 提交上去若带着 {"c": []}，ext_json 里就多一个解释不了的空数组
    const defs = [def({ fieldKey: 'c', widgetType: 'checkbox' })]
    expect(compactExt(loadExtModel(defs, null, 'FORM'))).toEqual({})
  })
})
