import { describe, expect, it } from 'vitest'
import {
  buildResourceIndex,
  isSameIdSet,
  matchResourceNode,
  resourceBreadcrumb
} from './resourceTree'

/**
 * 资源树那几个纯函数的守卫。
 *
 * 它们决定「搜出来的命中项是哪些」「面包屑显示哪几级」「勾选态要不要回写给树」。
 * 三件都是写错了不抛异常的事：面包屑少一级只是难看，搜索匹配写反了会让人
 * 在 1086 个资源里翻不到自己要的那个，而回写守卫写错则表现为勾选框闪烁、连点被吃 ——
 * 后两种只能靠事后追问发现，所以在提交之前就钉住。
 *
 * resourceBreadcrumb 那条防环的用例是**负控**：它今天不会失败（实现里有 seen 集合），
 * 存在的意义是让「顺手把 seen 删掉」这个看起来无害的简化当场挂掉。
 * 那个死循环发生在 computed 里，线上表现是页面冻住且拿不到任何报错
 */

/**
 * 四层夹具，形状对齐 handleTree 的真实输出：
 * 叶子带**显式的** `children: undefined`（adaptToChildrenList 的判据是
 * `childrenListMap[o.id] !== null`，叶子的 map 项是 undefined，`undefined !== null` 成立），
 * 中间层带真实数组。5 / 6 是一对同名根节点 —— 本库「角色管理」确实有 8 个
 */
const tree = [
  {
    id: 1,
    name: '系统管理',
    permission: 'system',
    parentId: 0,
    children: [
      {
        id: 2,
        name: '用户管理',
        permission: 'system:user',
        parentId: 1,
        children: [
          {
            id: 3,
            name: '用户',
            permission: 'system:user:list',
            parentId: 2,
            children: [
              {
                id: 4,
                name: '用户查询',
                permission: 'system:user:query',
                parentId: 3,
                children: undefined
              }
            ]
          }
        ]
      }
    ]
  },
  { id: 5, name: '角色管理', permission: 'system:role', parentId: 0, children: undefined },
  { id: 6, name: '角色管理', permission: 'bpm:role', parentId: 0, children: [] }
]

const byId = buildResourceIndex(tree)

describe('matchResourceNode', () => {
  it("🔴 空串命中所有节点 —— filter('') 是清掉搜索的唯一手段，返回 false 会把整棵树藏光", () => {
    for (const node of byId.values()) {
      expect(matchResourceNode('', node), `节点 ${node.id} 未被空串放行`).toBe(true)
    }
  })

  it('按名称命中', () => {
    expect(matchResourceNode('用户查询', byId.get(4))).toBe(true)
  })

  it('按 permission 命中，且是子串匹配而不是全等', () => {
    // 名称根本不能当检索键：库里有 8 个「角色管理」，permission 才是唯一区分位
    expect(matchResourceNode('system:user:query', byId.get(4))).toBe(true)
    expect(matchResourceNode('user:query', byId.get(4))).toBe(true)
  })

  it('大小写不敏感（关键词与数据两侧都不敏感）', () => {
    expect(matchResourceNode('SYSTEM:USER', byId.get(2))).toBe(true)
    expect(matchResourceNode('system:user', { ...byId.get(2), permission: 'SYSTEM:USER' })).toBe(
      true
    )
  })

  it('名称与 permission 都不沾边时不命中', () => {
    expect(matchResourceNode('流程设计', byId.get(4))).toBe(false)
  })

  it('两个同名资源靠 permission 区分开', () => {
    expect(matchResourceNode('bpm:role', byId.get(5))).toBe(false)
    expect(matchResourceNode('bpm:role', byId.get(6))).toBe(true)
  })

  it('name / permission 缺失时不抛，只按另一侧判', () => {
    expect(matchResourceNode('x', { id: 9 })).toBe(false)
    expect(matchResourceNode('临时', { id: 9, name: '临时资源' })).toBe(true)
  })
})

describe('buildResourceIndex', () => {
  it('覆盖全部四个层级，一个不漏', () => {
    expect(byId.size).toBe(6)
    for (const id of [1, 2, 3, 4, 5, 6]) {
      expect(byId.get(id)?.id, `id=${id} 未被索引`).toBe(id)
    }
  })

  it('叶子的 children 是 undefined 而不是缺失时照样收进索引、且不往下走', () => {
    // 这条钉的是遍历条件必须写成 children?.length：
    // 换成 `'children' in node` 会对叶子调 forEach(undefined) 直接抛
    expect(byId.get(4)).toEqual(expect.objectContaining({ id: 4, permission: 'system:user:query' }))
  })

  it('children 是空数组时同样收进索引', () => {
    expect(byId.get(6)?.name).toBe('角色管理')
  })

  it('空树给出空索引，而不是 undefined（调用方直接 .get 不必判空）', () => {
    expect(buildResourceIndex([]).size).toBe(0)
  })
})

describe('resourceBreadcrumb', () => {
  it('四层节点返回四段，顺序是根 → 叶', () => {
    expect(resourceBreadcrumb(byId.get(4), byId).map((n) => n.name)).toEqual([
      '系统管理',
      '用户管理',
      '用户',
      '用户查询'
    ])
  })

  it('根节点只返回自身一段', () => {
    expect(resourceBreadcrumb(byId.get(1), byId).map((n) => n.id)).toEqual([1])
  })

  it('末段恒为传入的节点本身（面包屑要能高亮当前项）', () => {
    const chain = resourceBreadcrumb(byId.get(3), byId)
    expect(chain[chain.length - 1]).toBe(byId.get(3))
  })

  it('parentId 指向索引里没有的 id 时不抛，停在能追到的那一级', () => {
    // 根节点的 parentId=0 在库里就不存在，这是常态；
    // 被「显示字段级资源」开关移出视野的祖先也是同一种情况
    const orphan = { id: 99, name: '孤儿', permission: 'orphan', parentId: 404 }
    expect(resourceBreadcrumb(orphan, byId).map((n) => n.id)).toEqual([99])
  })

  it('传入的节点自身不在索引里时，照样能沿 parentId 上溯', () => {
    const detached = { id: 7, name: '用户新增', permission: 'system:user:create', parentId: 3 }
    // 索引里没有 7（它不在树上），但它的 parentId=3 在
    expect(resourceBreadcrumb(detached, byId).map((n) => n.name)).toEqual([
      '系统管理',
      '用户管理',
      '用户',
      '用户新增'
    ])
  })

  it('🔴 parentId 成环时终止（负控：删掉实现里的 seen 集合，这条会以「超时」的形式挂掉）', () => {
    const a = { id: 10, name: 'A', parentId: 11 }
    const b = { id: 11, name: 'B', parentId: 10 }
    const cyclic = new Map<number, any>([
      [10, a],
      [11, b]
    ])
    // 自环是最短的那种环，一并钉住
    const self = { id: 12, name: 'C', parentId: 12 }
    cyclic.set(12, self)

    expect(resourceBreadcrumb(a, cyclic)).toHaveLength(2)
    expect(resourceBreadcrumb(self, cyclic)).toHaveLength(1)
  })
})

describe('isSameIdSet', () => {
  it('同集合不同顺序 → true（勾选态的顺序不稳定，比较不能带上顺序）', () => {
    expect(isSameIdSet([1, 2, 3], [3, 1, 2])).toBe(true)
  })

  it('空 vs 空 → true', () => {
    expect(isSameIdSet([], [])).toBe(true)
  })

  it('一侧多一个 → false', () => {
    expect(isSameIdSet([1, 2], [1, 2, 3])).toBe(false)
    expect(isSameIdSet([1, 2, 3], [1, 2])).toBe(false)
  })

  it('长度相同但成员不同 → false（只比长度会漏掉「换了一个」）', () => {
    expect(isSameIdSet([1, 2], [1, 3])).toBe(false)
  })

  it('🔴 含重复项时不误判：长度相等 + 单向包含在 [1,1] vs [1,2] 上会说 true', () => {
    expect(isSameIdSet([1, 1], [1, 2])).toBe(false)
    // 完全相同的重复列表仍然是同一集合，不能矫枉过正判成 false
    expect(isSameIdSet([1, 1], [1, 1])).toBe(true)
  })
})
