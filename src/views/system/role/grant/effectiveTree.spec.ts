import { describe, expect, it } from 'vitest'
import type { EffectiveActionVO, EffectiveResourceNodeVO } from '@/api/system/grant'
import {
  actionDetailLines,
  collectKeysUpToDepth,
  countTreeNodes,
  expireCell,
  fieldModeCell,
  filterEffectiveTree,
  isUniformActions,
  isUniformNode,
  nodeStatus,
  rowFilterCell,
  sourceLabel,
  sourceTagType,
  sourceTags,
  subjectLabel
} from './effectiveTree'

/**
 * 「切换智能查看」那棵树的展示层纯函数守卫。
 *
 * 这几个函数**不做任何判定** ——「这个动作生不生效」「它从哪来」全是后端
 * `GrantDecisionEngine#explain` 的结论，经 `EffectiveActionVO` 原样送过来。
 * 但它们决定操作者**读到什么**，而读错一样是事故：来源标签写错一个字，
 * 「从上级继承来的权限」就被当成「本资源上配过一行」，于是有人跑去列表页找那一行、找不着；
 * 聚合列的一致性判据写错，满屏都是「N 个动作配置不同」，真正需要看 tooltip 的那几行反被淹掉。
 * 两种都不报错、没有异常栈，只能靠事后追问发现，所以在提交之前钉住。
 *
 * ⚠️ 组件本身（GrantEffectiveTree.vue）测不了：vitest.config.ts 刻意不挂自动导入插件
 * （见它自己的注释），`useMessage` 这类全局在 node 环境里是未定义的，mount 就抛 ReferenceError
 */

const ACTION_BASE: EffectiveActionVO = { action: 'VIEW', effect: 'ALLOW', source: 'EXPLICIT' }
const act = (over: Partial<EffectiveActionVO> = {}): EffectiveActionVO => ({
  ...ACTION_BASE,
  ...over
})

const NODE_BASE = { id: 11, parentId: 10, name: '授权查询', type: 'ACTION', structural: false }
const node = (over: Partial<EffectiveResourceNodeVO> = {}): EffectiveResourceNodeVO => ({
  ...NODE_BASE,
  actions: [],
  children: [],
  ...over
})

const valueOf = (lines: { label: string; value: string }[], label: string) =>
  lines.find((line) => line.label === label)?.value

describe('collectKeysUpToDepth', () => {
  /**
   * 三层森林，其中 12 / 13 / 21 连 `children` 这个键都没有（后端对叶子就是不给）。
   *
   * 🔴 `depth` 一律给成**与嵌套层级不符**的值：这棵树是剪过枝的，一个 depth=4 的资源
   * 在祖先全被剪掉之后就是根。夹具刻意造成这样，下面那条用例才测得出「层数不读 node.depth」
   */
  const TREE = [
    {
      id: 10,
      depth: 4,
      children: [
        { id: 11, depth: 1, children: [{ id: 13, depth: 9 }] },
        { id: 12, depth: 2 }
      ]
    },
    { id: 20, depth: 1, children: [{ id: 21, depth: 7 }] }
  ] as unknown as EffectiveResourceNodeVO[]

  it('visibleLevels=1 → 一个 key 都不给（第一层本来就可见，展开反而多显示一层）', () => {
    expect(collectKeysUpToDepth(TREE, 1)).toEqual([])
  })

  it('visibleLevels=0 与空树都 → 空数组', () => {
    expect(collectKeysUpToDepth(TREE, 0)).toEqual([])
    expect(collectKeysUpToDepth([], 3)).toEqual([])
    expect(collectKeysUpToDepth(undefined as unknown as EffectiveResourceNodeVO[], 3)).toEqual([])
  })

  it('visibleLevels=2 → 只给第一层里**有子节点**的那些 id', () => {
    expect(collectKeysUpToDepth(TREE, 2)).toEqual([10, 20])
  })

  it('visibleLevels=3 → 再加上第二层里有子节点的那个（前序、按根分组的顺序）', () => {
    expect(collectKeysUpToDepth(TREE, 3)).toEqual([10, 11, 20])
  })

  it('🔴 Infinity = 展开全部：所有有子节点的 id，叶子一个都不进', () => {
    const keys = collectKeysUpToDepth(TREE, Infinity)
    expect(keys).toEqual([10, 11, 20])
    // 叶子塞进去不改变任何观感，只会让「展开全部」在超管那 702 个节点上多造几百个无用 key
    for (const leaf of [12, 13, 21]) {
      expect(keys, `叶子 ${leaf} 不该在 expandedRowKeys 里`).not.toContain(leaf)
    }
  })

  it('🔴 层数按嵌套深度数、不读 node.depth —— 祖先被剪掉后 depth=4 的节点是根，照样展开', () => {
    // 按 node.depth 判的话这里会得到空数组：用户看到一棵「只有一个折叠根」的树，
    // 还以为这个角色没权限。剪枝之后 depth 与嵌套层级没有任何关系
    expect(collectKeysUpToDepth(TREE, 2)).toContain(10)
    const deep = [
      { id: 1, depth: 9, children: [{ id: 2, depth: 9 }] }
    ] as unknown as EffectiveResourceNodeVO[]
    expect(collectKeysUpToDepth(deep, 2)).toEqual([1])
  })
})

describe('filterEffectiveTree', () => {
  /**
   * 两根的森林：「系统管理」下挂「角色管理」（两个叶子）与「部门管理」（一个叶子），
   * 「基础设施」是个光杆根。刻意让 name 与 permission **都能命中**，
   * 两条判据必须分别测到 —— 权限地图最常见的搜法恰恰是粘一个权限串进去
   */
  const TREE = [
    {
      id: 1,
      name: '系统管理',
      permission: 'system',
      children: [
        {
          id: 11,
          name: '角色管理',
          permission: 'system:role',
          children: [
            { id: 111, name: '角色查询', permission: 'system:role:query' },
            { id: 112, name: '角色删除', permission: 'system:role:delete' }
          ]
        },
        {
          id: 12,
          name: '部门管理',
          permission: 'system:dept',
          children: [{ id: 121, name: '部门查询', permission: 'system:dept:query' }]
        }
      ]
    },
    { id: 2, name: '基础设施', permission: 'infra' }
  ] as unknown as EffectiveResourceNodeVO[]

  const ids = (nodes: EffectiveResourceNodeVO[]): number[] => nodes.map((n) => n.id)

  it('🔴 空关键词（含只有空格）返回**同一个引用**，不是副本', () => {
    // 调用方把它放进 computed 当 el-table-v2 的 :data。返回新数组等于每次输入都换一次 data，
    // 表格整表重建、滚动位置归零 —— 而没在筛的时候压根不该有这件事
    expect(filterEffectiveTree(TREE, '')).toBe(TREE)
    expect(filterEffectiveTree(TREE, '   ')).toBe(TREE)
    expect(filterEffectiveTree(undefined as unknown as EffectiveResourceNodeVO[], '')).toEqual([])
  })

  it('🔴 命中一个父节点 → 保留它的**整棵子树**（含旁支后代），不再往下筛', () => {
    const result = filterEffectiveTree(TREE, '角色管理')
    expect(ids(result)).toEqual([1])
    // 11 命中之所以要看的就是它下面授了什么；只留一行光杆等于把搜索的目的剪掉了
    expect(ids(result[0].children!)).toEqual([11])
    expect(ids(result[0].children![0].children!)).toEqual([111, 112])
    // 旁支的「部门管理」被剪掉：它既没命中，也没有后代命中
    expect(JSON.stringify(result)).not.toContain('部门管理')
  })

  it('🔴 命中一个叶子 → 只保留那条祖先路径，兄弟一律剪掉', () => {
    const result = filterEffectiveTree(TREE, 'system:role:delete')
    expect(ids(result)).toEqual([1])
    expect(ids(result[0].children!)).toEqual([11])
    // 111（角色查询）是 112 的兄弟，没命中也没后代命中，必须掉
    expect(ids(result[0].children![0].children!)).toEqual([112])
  })

  it('name 与 permission 两条判据都算，且大小写不敏感、前后空格被 trim', () => {
    expect(ids(filterEffectiveTree(TREE, '部门'))).toEqual([1])
    expect(ids(filterEffectiveTree(TREE, 'SYSTEM:DEPT'))).toEqual([1])
    expect(ids(filterEffectiveTree(TREE, '  infra  '))).toEqual([2])
    // 命中 permission 前缀时，命中的是 11 这一层 ⟹ 它的两个叶子都要在
    const byPrefix = filterEffectiveTree(TREE, 'System:Role')
    expect(ids(byPrefix[0].children![0].children!)).toEqual([111, 112])
  })

  it('无命中 → 空数组（调用方据此显示「没有匹配「x」的资源」，不是「没有任何生效权限」）', () => {
    expect(filterEffectiveTree(TREE, '不存在的资源')).toEqual([])
    expect(filterEffectiveTree([], '角色')).toEqual([])
  })

  it('🔴 祖先一律是**副本**，源树不被就地改；命中节点保留原身份', () => {
    const result = filterEffectiveTree(TREE, '角色删除')
    // 就地改的话：清空关键词还原不回原样，而且 watch(() => props.tree) 会被自己触发一次
    const srcRoot = TREE[0] as any
    expect(result[0]).not.toBe(TREE[0])
    expect(result[0].children![0]).not.toBe(srcRoot.children[0])
    expect(srcRoot.children).toHaveLength(2)
    expect(srcRoot.children[0].children).toHaveLength(2)
    // 命中的那个叶子是原对象本身 ⟹ row-key 稳定，el-table-v2 不会因为换了对象而重建行
    expect(result[0].children![0].children![0]).toBe(srcRoot.children[0].children[1])
  })

  it('⚠️ 存活节点不会带 children: [] —— 空数组会让 v2 画出一个点开是空的展开箭头', () => {
    const result = filterEffectiveTree(TREE, '角色删除')
    const walk = (nodes: EffectiveResourceNodeVO[]) => {
      nodes.forEach((n) => {
        // 🔴 判据必须是「键存在但为空」，不是「长度不为 0」：后端对叶子压根不给 children 这个键，
        //    拿 `?? 0` 去比会把每一个叶子都误判成缺陷（这条用例第一次跑就是这么红的）
        if (n.children !== undefined) {
          expect(n.children!.length, `节点 ${n.id} 带了空 children`).toBeGreaterThan(0)
        }
        walk(n.children ?? [])
      })
    }
    walk(result)
  })
})

describe('countTreeNodes', () => {
  it('递归数全部层级', () => {
    const tree = [
      { id: 1, children: [{ id: 11, children: [{ id: 111 }, { id: 112 }] }, { id: 12 }] },
      { id: 2 }
    ] as unknown as EffectiveResourceNodeVO[]
    expect(countTreeNodes(tree)).toBe(6)
  })

  it('空树 / undefined / 没有 children 键的叶子都不炸', () => {
    expect(countTreeNodes([])).toBe(0)
    expect(countTreeNodes(undefined as unknown as EffectiveResourceNodeVO[])).toBe(0)
    expect(countTreeNodes([{ id: 1 } as unknown as EffectiveResourceNodeVO])).toBe(1)
  })
})

describe('isUniformActions', () => {
  it('0 个或 1 个动作 → 一致（没有可比的东西，报「配置不同」是凭空捏一句）', () => {
    expect(isUniformActions(node(), 'ruleName')).toBe(true)
    expect(isUniformActions(node({ actions: [act({ ruleName: '仅本人' })] }), 'ruleName')).toBe(
      true
    )
    expect(isUniformActions(node({ actions: [act()] }), 'ruleName')).toBe(true)
  })

  it('同值 → 一致，不同值 → 不一致', () => {
    const same = node({
      actions: [act({ ruleName: '仅本人' }), act({ action: 'CREATE', ruleName: '仅本人' })]
    })
    expect(isUniformActions(same, 'ruleName')).toBe(true)
    const diff = node({
      actions: [act({ ruleName: '仅本人' }), act({ action: 'CREATE', ruleName: '本部门' })]
    })
    expect(isUniformActions(diff, 'ruleName')).toBe(false)
  })

  it('🔴 undefined 与 null 归一后相等 ——「两个都没配」不是一致性差异', () => {
    // JSON 里「没配」可能是键被省略（undefined）也可能是显式 null，两种都真实出现过。
    // 直接 === 会把这类节点判成不一致，于是满屏都是「N 个动作配置不同」
    const withNull = {
      ...act({ action: 'CREATE' }),
      ruleName: null
    } as unknown as EffectiveActionVO
    expect(isUniformActions(node({ actions: [act(), withNull] }), 'ruleName')).toBe(true)
    expect(
      isUniformActions(node({ actions: [withNull, withNull] }), 'ruleName'),
      '两个都是 null 同样算一致'
    ).toBe(true)
  })

  it('一个没配、一个配了 → 不一致（这才是真正需要看 tooltip 的那种行）', () => {
    const mixed = node({ actions: [act(), act({ action: 'CREATE', ruleName: '仅本人' })] })
    expect(isUniformActions(mixed, 'ruleName')).toBe(false)
  })

  it('三个被聚合的字段各判各的：一个不一致不影响另一个的结论', () => {
    const n = node({
      actions: [
        act({ ruleName: '仅本人', fieldMode: 'HIDDEN' }),
        act({ action: 'CREATE', ruleName: '本部门', fieldMode: 'HIDDEN' })
      ]
    })
    expect(isUniformActions(n, 'ruleName')).toBe(false)
    expect(isUniformActions(n, 'fieldMode')).toBe(true)
    expect(isUniformActions(n, 'expireTime')).toBe(true)
  })
})

describe('isUniformNode', () => {
  it('三项「每动作」属性全一致 → 真', () => {
    const n = node({
      actions: [
        act({ ruleName: '仅本人', fieldMode: 'HIDDEN', expireTime: '2030-01-01 23:59:59' }),
        act({
          action: 'CREATE',
          ruleName: '仅本人',
          fieldMode: 'HIDDEN',
          expireTime: '2030-01-01 23:59:59'
        })
      ]
    })
    expect(isUniformNode(n)).toBe(true)
  })

  it.each([
    ['ruleName', { ruleName: '仅本人' }, { ruleName: '本部门' }],
    ['fieldMode', { fieldMode: 'HIDDEN' }, { fieldMode: 'READONLY' }],
    ['expireTime', { expireTime: '2030-01-01 23:59:59' }, { expireTime: '2031-01-01 00:00:00' }]
  ] as const)('🔴 只有 %s 不一致时也报假 —— 三项是「且」不是「或」', (_field, first, second) => {
    const n = node({ actions: [act(first), act({ action: 'CREATE', ...second })] })
    expect(isUniformNode(n)).toBe(false)
  })

  it('没有动作的路径节点 → 真（状态列另有「路径节点」那一支，走不到这里）', () => {
    expect(isUniformNode(node({ structural: true }))).toBe(true)
  })
})

describe('sourceLabel', () => {
  it.each([
    ['EXPLICIT', '本资源已配置'],
    ['ALL_USERS', '全员默认拥有'],
    ['DEFAULT', '默认放行（未配置）']
  ] as const)('%s → %s', (source, label) => {
    expect(sourceLabel(act({ source }))).toBe(label)
  })

  it('🔴 INHERITED 带上祖先名 —— 这是整张图相对扁平列表唯一多出来的信息', () => {
    // 列表页只看得到父菜单那一行（而且它常常没有 permission，连名字都对不上），
    // 完全看不出它其实放行了下面二十个子按钮
    expect(sourceLabel(act({ source: 'INHERITED', sourceResourceName: '角色管理' }))).toBe(
      '继承自「角色管理」'
    )
  })

  it('祖先名缺失时退化成「上级」，而不是整条标签消失', () => {
    // 来源标签本身比名字重要：名字没了就整条不显示的话，那一格会变成空白，
    // 读起来像「不知道从哪来的」，而这恰恰是最需要说清楚的一格
    expect(sourceLabel(act({ source: 'INHERITED' }))).toBe('继承自「上级」')
    expect(sourceLabel(act({ source: 'INHERITED', sourceResourceName: '' }))).toBe('继承自「上级」')
  })

  it('认不出的来源原样显示（后端加了一种来源、前端漏配时界面上看得见原值）', () => {
    const raw = 'SOMETHING_NEW' as EffectiveActionVO['source']
    expect(sourceLabel(act({ source: raw }))).toBe('SOMETHING_NEW')
  })
})

describe('sourceTagType', () => {
  it.each([
    ['EXPLICIT', 'success'],
    ['INHERITED', 'primary'],
    ['ALL_USERS', 'info'],
    ['DEFAULT', 'warning']
  ] as const)('%s → %s', (source, type) => {
    expect(sourceTagType(act({ source }))).toBe(type)
  })

  it('认不出的来源回落 info（灰）—— 不能回落成空串，那会让 tag 变成 EP 默认蓝', () => {
    expect(sourceTagType(act({ source: 'SOMETHING_NEW' as EffectiveActionVO['source'] }))).toBe(
      'info'
    )
  })
})

describe('rowFilterCell', () => {
  it('🔴 路径节点（没有任何生效动作）→ 灰色短横，而不是「不受限（全部行）」', () => {
    // 它上面根本没有授权行，说它「不受限」等于凭空捏一条配置
    expect(rowFilterCell(node({ structural: true }))).toEqual({ text: '-', muted: true })
  })

  it('配了规则 → 规则名，不灰', () => {
    expect(
      rowFilterCell(node({ type: 'DATASET', actions: [act({ ruleName: '仅本人' })] }))
    ).toEqual({ text: '仅本人', muted: false })
  })

  it('🔴 数据集上没配规则 → 「不受限（全部行）」', () => {
    expect(rowFilterCell(node({ type: 'DATASET', actions: [act()] }))).toEqual({
      text: '不受限（全部行）',
      muted: true
    })
  })

  it.each(['MENU', 'ACTION', 'PROCESS', 'CATEGORY', 'COLUMN', 'FIELD'])(
    '🔴 type=%s 上没配规则 → 短横（与列表页那三态逐字同口径）',
    (type) => {
      // 菜单/按钮上压根没有「行」这个概念，对它说「不受限（全部行）」是句假话。
      // 两边不一致的话，同一条授权在列表页与智能查看里会读出两种意思
      expect(rowFilterCell(node({ type, actions: [act()] }))).toEqual({ text: '-', muted: true })
    }
  )

  it('🔴 多个动作规则不同 → 报数，且不灰（它是个真结论，不是空值）', () => {
    const n = node({
      type: 'DATASET',
      actions: [act({ ruleName: '仅本人' }), act({ action: 'CREATE', ruleName: '本部门' })]
    })
    expect(rowFilterCell(n)).toEqual({ text: '2 个动作配置不同', muted: false })
  })

  it('不一致优先于类型判断 —— 列表页对非数据集行也是「有 ruleName 就显示」', () => {
    // index.vue 那一列的 v-if 排在三态判断之前，所以聚合列同序。
    // 反过来写的话，同一条绑在菜单上的 ruleId 在列表页看得见、在智能查看里被吞掉，又是一处口径漂移
    const n = node({
      type: 'MENU',
      actions: [act({ ruleName: '仅本人' }), act({ action: 'CREATE' })]
    })
    expect(rowFilterCell(n)).toEqual({ text: '2 个动作配置不同', muted: false })
  })
})

describe('nodeStatus', () => {
  it('路径节点 → 「路径节点」灰', () => {
    expect(nodeStatus(node({ structural: true }))).toEqual({ label: '路径节点', type: 'info' })
  })

  it('🔴 全部动作都是 DEFAULT → 「默认放行」，不是「生效中」', () => {
    // 没人配过一行授权、按资源的 default_effect 列放行，与「有人显式授过权」必须读得出区别，
    // 否则操作者会跑去列表页找那一行 —— 它压根不存在
    const n = node({ type: 'DATASET', actions: [act({ source: 'DEFAULT' })] })
    expect(nodeStatus(n)).toEqual({ label: '默认放行', type: 'warning' })
  })

  it('有人配过（哪怕只有一项属性）→ 「生效中」', () => {
    expect(nodeStatus(node({ actions: [act()] }))).toEqual({ label: '生效中', type: 'success' })
    expect(
      nodeStatus(node({ actions: [act({ source: 'INHERITED', sourceResourceName: '角色管理' })] }))
    ).toEqual({ label: '生效中', type: 'success' })
  })

  it('🔴 混合来源不算「默认放行」：只要有一项是有人配的，就按有人配的读', () => {
    const n = node({
      type: 'DATASET',
      actions: [act({ source: 'DEFAULT' }), act({ action: 'CREATE', source: 'EXPLICIT' })]
    })
    expect(nodeStatus(n)).toEqual({ label: '生效中', type: 'success' })
  })

  it('🔴 三个聚合字段有一项不一致 → 「多动作配置不同」（那句话本身不解决问题，明细在 tooltip 里）', () => {
    const n = node({
      type: 'DATASET',
      actions: [act({ ruleName: '仅本人' }), act({ action: 'CREATE', ruleName: '本部门' })]
    })
    expect(nodeStatus(n)).toEqual({ label: '多动作配置不同', type: 'warning' })
  })

  it('「默认放行」那一支排在一致性判断之前：全 DEFAULT 的节点上不该再出现「配置不同」', () => {
    const n = node({
      type: 'DATASET',
      actions: [act({ source: 'DEFAULT' }), act({ action: 'CREATE', source: 'DEFAULT' })]
    })
    expect(nodeStatus(n)).toEqual({ label: '默认放行', type: 'warning' })
  })
})

describe('fieldModeCell', () => {
  it('路径节点与「没配字段模式」都是灰色短横', () => {
    expect(fieldModeCell(node({ structural: true }))).toEqual({ text: '-', muted: true })
    expect(fieldModeCell(node({ actions: [act()] }))).toEqual({ text: '-', muted: true })
  })

  it('🔴 有值时走全站同一份翻译与配色，不在这一列印裸码', () => {
    expect(fieldModeCell(node({ actions: [act({ fieldMode: 'HIDDEN' })] }))).toEqual({
      text: '隐藏',
      muted: false,
      tag: 'danger'
    })
    expect(fieldModeCell(node({ actions: [act({ fieldMode: 'EDITABLE' })] })).text).toBe('可编辑')
  })

  it('认不出的码原样显示、配色回落空串', () => {
    expect(fieldModeCell(node({ actions: [act({ fieldMode: 'SOMETHING_NEW' })] }))).toEqual({
      text: 'SOMETHING_NEW',
      muted: false,
      tag: ''
    })
  })

  it('🔴 不一致时报数 —— 与 rowFilterCell 同一套判据，两列不能一个说不同一个说一致', () => {
    const n = node({
      actions: [act({ fieldMode: 'HIDDEN' }), act({ action: 'CREATE', fieldMode: 'READONLY' })]
    })
    expect(fieldModeCell(n)).toEqual({ text: '2 个动作配置不同', muted: false })
  })
})

describe('expireCell', () => {
  it('🔴 路径节点 → 短横，而不是「永不过期」（它上面没有任何授权行）', () => {
    expect(expireCell(node({ structural: true }))).toEqual({ text: '-', muted: true })
  })

  it('有行但没写到期时间 → 「永不过期」，与列表页同一句话', () => {
    expect(expireCell(node({ actions: [act()] }))).toEqual({ text: '永不过期', muted: true })
  })

  it('有到期时间 → 交给 formatDate（与列表页同一个格式化函数）', () => {
    const n = node({ actions: [act({ expireTime: '2030-01-01 23:59:59' })] })
    expect(expireCell(n)).toEqual({ text: '2030-01-01 23:59:59', muted: false })
  })

  it('不一致时报数', () => {
    const n = node({
      actions: [
        act({ expireTime: '2030-01-01 23:59:59' }),
        act({ action: 'CREATE', expireTime: '2031-01-01 00:00:00' })
      ]
    })
    expect(expireCell(n)).toEqual({ text: '2 个动作配置不同', muted: false })
  })
})

describe('sourceTags', () => {
  it('没有动作 → 两个空数组（路径节点这一格什么都不该渲染）', () => {
    expect(sourceTags(node({ structural: true }))).toEqual({ shown: [], rest: [] })
  })

  it('同一个祖先继承来的多个动作合成一个 tag', () => {
    const n = node({
      actions: [
        act({ source: 'INHERITED', sourceResourceName: '角色管理' }),
        act({ action: 'CREATE', source: 'INHERITED', sourceResourceName: '角色管理' })
      ]
    })
    expect(sourceTags(n).shown).toEqual([{ label: '继承自「角色管理」', type: 'primary' }])
    expect(sourceTags(n).rest).toEqual([])
  })

  it('🔴 两个不同祖先必须分开显示 —— 按 source 去重就看不出这一行的权限来自两处', () => {
    const n = node({
      actions: [
        act({ source: 'INHERITED', sourceResourceName: '角色管理' }),
        act({ action: 'CREATE', source: 'INHERITED', sourceResourceName: '系统管理' })
      ]
    })
    expect(sourceTags(n).shown.map((tag) => tag.label)).toEqual([
      '继承自「角色管理」',
      '继承自「系统管理」'
    ])
  })

  it('超过 cap 的部分进 rest（调用方渲染成「+N」，tooltip 里列全）', () => {
    const n = node({
      actions: [
        act({ source: 'INHERITED', sourceResourceName: '角色管理' }),
        act({ action: 'CREATE', source: 'INHERITED', sourceResourceName: '系统管理' }),
        act({ action: 'DELETE', source: 'ALL_USERS' }),
        act({ action: 'EXPORT', source: 'EXPLICIT' })
      ]
    })
    expect(sourceTags(n).shown).toHaveLength(2)
    expect(sourceTags(n).rest.map((tag) => tag.label)).toEqual(['全员默认拥有', '本资源已配置'])
    expect(sourceTags(n, 3).shown).toHaveLength(3)
    expect(sourceTags(n, Infinity).rest).toEqual([])
  })
})

describe('subjectLabel', () => {
  it('全员主体 → 人话', () => {
    expect(subjectLabel('ALL:all-users')).toBe('全员（所有登录用户）')
  })

  it('🔴 本角色与继承来的上级角色要读得出区别', () => {
    expect(subjectLabel('ROLE:7', 7)).toBe('本角色')
    expect(subjectLabel('ROLE:3', 7)).toBe('上级角色 #3')
    // 不传 selfRoleId 时一律按「上级」读：宁可说得含糊，也不能把上级角色标成「本角色」
    expect(subjectLabel('ROLE:7')).toBe('上级角色 #7')
  })

  it('认不出的类型与没有分隔符的串原样显示', () => {
    expect(subjectLabel('DEPT:100')).toBe('DEPT:100')
    expect(subjectLabel('ROLE')).toBe('角色')
    expect(subjectLabel('')).toBe('')
  })
})

describe('actionDetailLines', () => {
  it('效果与来源恒在前两行，ALLOW → 允许、DENY → 拒绝', () => {
    expect(actionDetailLines(act()).slice(0, 2)).toEqual([
      { label: '效果', value: '允许' },
      { label: '来源', value: '本资源已配置' }
    ])
    expect(valueOf(actionDetailLines(act({ effect: 'DENY' })), '效果')).toBe('拒绝')
  })

  it('🔴 空值不产出行：一个 VIEW 动作没有授权行、规则与字段模式，tooltip 不该被三行短横撑长', () => {
    expect(actionDetailLines(act()).map((line) => line.label)).toEqual(['效果', '来源', '到期时间'])
  })

  it('有值时按固定顺序逐行补上', () => {
    const lines = actionDetailLines(
      act({
        grantId: 88,
        ruleName: '仅本人',
        fieldMode: 'HIDDEN',
        expireTime: '2030-01-01 23:59:59',
        subjectType: 'ROLE',
        subjectRefId: 7
      })
    )
    expect(lines.map((line) => line.label)).toEqual([
      '效果',
      '来源',
      '授权行',
      '行过滤规则',
      '字段模式',
      '到期时间',
      '命中主体'
    ])
    expect(valueOf(lines, '授权行')).toBe('#88')
  })

  it('🔴 字段模式走全站同一份翻译，不在 tooltip 里印裸码', () => {
    // 同一行的「字段模式」列显示「隐藏」而 tooltip 印 HIDDEN，读起来像两处数据对不上
    expect(valueOf(actionDetailLines(act({ fieldMode: 'HIDDEN' })), '字段模式')).toBe('隐藏')
    expect(valueOf(actionDetailLines(act({ fieldMode: 'READONLY' })), '字段模式')).toBe('只读')
    expect(valueOf(actionDetailLines(act({ fieldMode: 'EDITABLE' })), '字段模式')).toBe('可编辑')
  })

  it('认不出的字段模式码原样显示', () => {
    expect(valueOf(actionDetailLines(act({ fieldMode: 'SOMETHING_NEW' })), '字段模式')).toBe(
      'SOMETHING_NEW'
    )
  })

  it('没有到期时间 → 「永不过期」，与列表页同一句话', () => {
    expect(valueOf(actionDetailLines(act()), '到期时间')).toBe('永不过期')
  })

  it('有到期时间 → 交给 formatDate，与列表页同一个格式化函数', () => {
    expect(valueOf(actionDetailLines(act({ expireTime: '2030-01-01 23:59:59' })), '到期时间')).toBe(
      '2030-01-01 23:59:59'
    )
    // ⚠️ 后端把 LocalDateTime 序列化成**毫秒时间戳**（TimestampLocalDateTimeSerializer），
    // 而前端 VO 沿用了 GrantVO 既有的 `string` 声明 ⟹ 运行期其实是数字。
    // 这里两种形状都要吃得下：dayjs 对数字与 ISO 串都能解析，但不能把数字原样印出来
    const stamp = 1893455999000 as unknown as string
    expect(valueOf(actionDetailLines(act({ expireTime: stamp })), '到期时间')).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/
    )
  })

  it('🔴 命中主体用短横连接主体类型与编号，不出现冒号', () => {
    // 冒号加数字那个形状会被 commentLineRefBan 的 RE_A 判成源码位置引用。
    // 展示文案与注释里都避开它，省得这句话哪天被谁抄进注释就成了一处守卫违规
    const value = valueOf(
      actionDetailLines(act({ subjectType: 'ROLE', subjectRefId: 7 })),
      '命中主体'
    )
    expect(value).toBe('ROLE-7')
    expect(value).not.toContain(':')
  })

  it('主体没有编号时用编码（全员主体那一类）', () => {
    const lines = actionDetailLines(
      act({ source: 'ALL_USERS', subjectType: 'ALL', subjectCode: 'all-users' })
    )
    expect(valueOf(lines, '命中主体')).toBe('ALL-all-users')
    expect(valueOf(lines, '来源')).toBe('全员默认拥有')
  })

  it('编号与编码都缺时只显示主体类型；主体类型缺失则整行不产出', () => {
    expect(valueOf(actionDetailLines(act({ subjectType: 'ROLE' })), '命中主体')).toBe('ROLE')
    expect(actionDetailLines(act()).map((line) => line.label)).not.toContain('命中主体')
  })
})
