import { describe, expect, it } from 'vitest'
import {
  GRANT_ACTION_OPTIONS,
  formatGrantAction,
  grantActionGroupsFor,
  grantActionOptionsFor,
  isGrantActionAllowed,
  reservedActionWarning
} from './constants'

/**
 * 授权动作词表的守卫。
 *
 * 这份词表现在是全站唯一一份（收敛之前有四份各自维护的副本），四个授权界面
 * （角色资源授权弹窗、角色管理内嵌面板、资源详情面板、权限诊断页）都从它取选项、
 * 取中文、取「配了到底生不生效」的判断。它说错话的代价是具体的：
 *
 * - **少一个码**：那个码的授权行在界面上渲染成裸英文，或者干脆选不出来。
 *   MANAGE / VIEW_ALL 曾经就是这样在资源详情面板上配不出来的 —— 而它们恰好是
 *   流程资源唯一真正在用的两个码。
 * - **effective 标错**：界面告诉用户「配了不生效」而它其实生效，或者反过来。
 *   这是权限系统里最难查的一类谎：保存成功、列表正常、没有任何报错，
 *   只有「权限怎么没生效」或「他怎么有这个权限」两种事后追问。
 *
 * 所以下面既钉全集，也钉「哪几个生效」这份判断。第一条用例是一份**刻意的**黄金副本：
 * 后端 GrantActionEnum 加了码而这里没跟上时，它必须失败，逼人做一次显式决定
 * （加进来、标好 effective），而不是让界面上静默少一个选项。
 */

/**
 * 后端 GrantActionEnum 里 12 个具名动作的声明顺序。
 * ⚠️ 通配符在枚举中叫 WILDCARD、是**最后一个**常量，不在这份列表里 ——
 * 前端刻意把它排在最前，理由见 GRANT_ACTION_OPTIONS 的注释。
 * 改这里之前先去改枚举，两边必须同步
 */
const ENUM_ORDER = [
  'VIEW',
  'CREATE',
  'UPDATE',
  'DELETE',
  'EXPORT',
  'IMPORT',
  'PRINT',
  'START',
  'DESIGN',
  'MANAGE',
  'VIEW_ALL',
  'REFERENCE'
]

/** 前端下拉的实际顺序 = 通配符打头 + 枚举原序 */
const UI_ORDER = ['*', ...ENUM_ORDER]

/**
 * 只对流程类资源开放的动作码（流程 + 分类；分类是流程的父资源，授权沿祖先链继承）。
 * 与 EFFECTIVE 分开写是为了让下面「收窄只按 processOnly、不按 effective」这条断言
 * 不是把实现重述一遍
 */
const PROCESS_ONLY = ['START', 'DESIGN', 'MANAGE', 'VIEW_ALL']

/** 非流程资源上能选到的那 9 个 */
const NON_PROCESS = UI_ORDER.filter((v) => !PROCESS_ONLY.includes(v))

/**
 * 全后端真的会拿去做匹配的动作码。
 * 判据是 GrantDecisionEngine#isAllowed 的 action 入参：VIEW（接口鉴权 / 菜单树 /
 * 按钮清单 / 字段模式）与 START / DESIGN / MANAGE / VIEW_ALL（BpmProcessPermissionChecker），
 * 外加 '*' 在 GrantDO#actionMatches 里通配。
 *
 * 写成派生式不影响守卫效果：把 CREATE 翻成 effective=true 会让第一项多出 1 个元素而失败，
 * 新增一个码则会先被上面的 ENUM_ORDER 黄金副本拦下
 */
const EFFECTIVE = ['*', 'VIEW', ...PROCESS_ONLY]

describe('GRANT_ACTION_OPTIONS', () => {
  it('与后端 GrantActionEnum 全集一致：通配符打头，其余按枚举声明顺序', () => {
    expect(GRANT_ACTION_OPTIONS.map((a) => a.value)).toEqual(UI_ORDER)
  })

  it('生效动作只有这 6 个，其余都是「配了不参与鉴权」的预留项', () => {
    expect(GRANT_ACTION_OPTIONS.filter((a) => a.effective).map((a) => a.value)).toEqual(EFFECTIVE)
  })

  it('每个码都有中文，且 label 互不重复、没有首尾空白', () => {
    const labels = GRANT_ACTION_OPTIONS.map((a) => a.label)
    // 重复 = 两个不同动作在界面上长得一样，用户无从分辨自己配的是哪一个
    expect(new Set(labels).size).toBe(labels.length)
    expect(labels.every((l) => l.length > 0 && l === l.trim())).toBe(true)
  })
})

describe('grantActionOptionsFor：按资源类型收窄', () => {
  it('流程与分类放开全部 13 个（分类是流程的父资源，授权会沿祖先链继承）', () => {
    for (const type of ['PROCESS', 'CATEGORY']) {
      expect(grantActionOptionsFor(type).map((a) => a.value)).toEqual(UI_ORDER)
    }
  })

  it('其他类型只少掉流程专属动作，预留动作照给', () => {
    for (const type of ['MENU', 'ACTION', 'DATASET', 'COLUMN', 'FIELD', undefined]) {
      const values = grantActionOptionsFor(type).map((a) => a.value)
      expect(values).toEqual(NON_PROCESS)
      // 收窄的只有 processOnly 那几项。预留动作在哪种资源上都不生效，
      // 但从下拉里彻底拿掉会让人以为「这功能没有」，而库里明明存着这类行
      expect(values).toContain('CREATE')
      expect(values).not.toContain('START')
    }
  })
})

describe('grantActionGroupsFor：分组 + 把当前值补回选项', () => {
  it('生效组排在前、预留组在后（分组本身就是提示，不靠人读文档）', () => {
    const groups = grantActionGroupsFor('PROCESS', undefined)
    expect(groups.effective.map((a) => a.value)).toEqual(EFFECTIVE)
    expect(groups.reserved.map((a) => a.value)).toEqual(
      UI_ORDER.filter((v) => !EFFECTIVE.includes(v))
    )
  })

  it('菜单资源上只有 * 与 查看 是生效的', () => {
    const groups = grantActionGroupsFor('MENU', undefined)
    expect(groups.effective.map((a) => a.value)).toEqual(['*', 'VIEW'])
    expect(groups.reserved).toHaveLength(7)
  })

  it('编辑一条「菜单上配了 START」的既有行时，START 被补回生效组而不是渲染成裸码', () => {
    // el-select 找不到对应 option 时会把选中项显示成 value 本身，看着像控件坏了。
    // ⚠️ 补选项而不是把值改成 VIEW：静默改值等于篡改一条已存在的授权，
    // 而用户这次可能只是想改个到期时间
    const groups = grantActionGroupsFor('MENU', 'START')
    expect(groups.effective.map((a) => a.value)).toEqual(['*', 'VIEW', 'START'])
    expect(groups.effective.find((a) => a.value === 'START')?.label).toBe('发起')
  })

  it('枚举外的脏值也被补回来，落在预留组、label 就是原值', () => {
    // 本库曾有 4 行 action=EXEC（已被 xpy-2026-10-12-grant-action-enum-cleanup.sql 软删，
    // 但没跑过该脚本的环境里还在）。label 用原值是有意的：界面上要看得出这是脏数据，
    // 兜成 '-' 或兜成「查看」都会把它藏起来
    const groups = grantActionGroupsFor('MENU', 'EXEC')
    expect(groups.effective.map((a) => a.value)).toEqual(['*', 'VIEW'])
    const dirty = groups.reserved.find((a) => a.value === 'EXEC')
    expect(dirty?.label).toBe('EXEC')
    expect(dirty?.effective).toBe(false)
  })

  it('当前值本来就在开放范围内时不重复补一份', () => {
    const groups = grantActionGroupsFor('PROCESS', 'MANAGE')
    expect(groups.effective.filter((a) => a.value === 'MANAGE')).toHaveLength(1)
  })
})

describe('isGrantActionAllowed：只用于「用户主动换资源后要不要重置动作」', () => {
  it('* 与 查看 在任何资源上都是合法可选项', () => {
    for (const type of ['MENU', 'ACTION', 'PROCESS', 'DATASET', undefined]) {
      expect(isGrantActionAllowed('*', type)).toBe(true)
      expect(isGrantActionAllowed('VIEW', type)).toBe(true)
    }
  })

  it('流程专属动作只在流程/分类上合法', () => {
    expect(isGrantActionAllowed('START', 'MENU')).toBe(false)
    expect(isGrantActionAllowed('MANAGE', 'ACTION')).toBe(false)
    expect(isGrantActionAllowed('DESIGN', 'PROCESS')).toBe(true)
    expect(isGrantActionAllowed('VIEW_ALL', 'CATEGORY')).toBe(true)
  })

  it('⚠️ 预留动作返回 true —— 它不合法是「不生效」，不是「不能选」', () => {
    // 这条最容易被人「顺手修正」成 false。一旦返回 false，用户从流程资源切到菜单资源时
    // onResourceNodeClick 就会把他选的「新增」重置成「查看」—— 那是静默改值，
    // 而「配了不生效」这件事该由 reservedActionWarning 说出来，不该由这里偷偷改掉
    expect(isGrantActionAllowed('CREATE', 'MENU')).toBe(true)
    expect(isGrantActionAllowed('REFERENCE', 'DATASET')).toBe(true)
  })

  it('枚举外脏值与空值都返回 false', () => {
    expect(isGrantActionAllowed('EXEC', 'MENU')).toBe(false)
    expect(isGrantActionAllowed(undefined, 'MENU')).toBe(false)
    expect(isGrantActionAllowed('', 'MENU')).toBe(false)
  })
})

describe('reservedActionWarning：选了不生效的动作时那句常驻警告', () => {
  it('空值不提示 —— 那时该说话的是表单校验那句「请选择动作」', () => {
    expect(reservedActionWarning(undefined)).toBeUndefined()
    expect(reservedActionWarning('')).toBeUndefined()
  })

  it('生效动作不提示（含刚从预留翻过来的 DESIGN）', () => {
    for (const action of EFFECTIVE) {
      expect(reservedActionWarning(action)).toBeUndefined()
    }
  })

  it('预留动作提示，并带上它的中文名与「不生效」这个结论', () => {
    const warning = reservedActionWarning('CREATE')
    expect(warning).toContain('新增')
    expect(warning).toContain('不生效')
    // 措辞里必须留着「能正常保存」：这一档的后果是静默无效，不是报错。
    // 漏了这半句，用户会以为保存时会被拦下来，于是不敢点确定
    expect(warning).toContain('能正常保存')
  })

  it('每个预留码都有各自的提示（不能只对某几个特判）', () => {
    for (const option of GRANT_ACTION_OPTIONS.filter((a) => !a.effective)) {
      expect(reservedActionWarning(option.value)).toContain(option.label)
    }
  })

  it('枚举外脏值走另一条文案：它会被后端参数校验拦下，不只是不生效', () => {
    const dirty = reservedActionWarning('EXEC')
    const reserved = reservedActionWarning('CREATE')
    expect(dirty).toContain('EXEC')
    expect(dirty).toContain('历史脏数据')
    expect(dirty).not.toBe(reserved)
    // 两档后果不同，措辞就不能混：脏值那一条如果不说清「保存会被拦」，
    // 用户看到的是一个「我只想改个到期时间，怎么报参数错误」的 400
    expect(reserved).not.toContain('历史脏数据')
  })
})

describe('formatGrantAction：认不出的码原样显示', () => {
  it('已知码给中文', () => {
    expect(formatGrantAction('VIEW')).toBe('查看')
    expect(formatGrantAction('*')).toBe('* 全部动作')
    expect(formatGrantAction('REFERENCE')).toBe('被引用查询')
    expect(formatGrantAction('VIEW_ALL')).toBe('查看全部')
  })

  it('⚠️ 认不出的码返回原值，不能兜成 undefined 或 "-"', () => {
    // 兜底掉了就渲染成空白 tag：界面上既看不出这一行是什么动作，
    // 也看不出它是脏数据 —— 两种信息一起丢
    expect(formatGrantAction('EXEC')).toBe('EXEC')
    expect(formatGrantAction('view')).toBe('view')
    expect(formatGrantAction(undefined)).toBeUndefined()
  })
})
