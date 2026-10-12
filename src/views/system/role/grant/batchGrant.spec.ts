import { describe, expect, it } from 'vitest'
import { GRANT_ACTION_OPTIONS, grantActionOptionsFor } from '@/views/system/resource/constants'
import {
  GRANT_BATCH_MAX_ITEMS,
  buildSubtreeIndex,
  collectSubtreeIds,
  confirmPastExpireTime,
  expandGrantBatch,
  intersectGrantActionOptions,
  isSubtreeFullyChecked
} from './batchGrant'

/**
 * 批量授权那组纯函数的守卫。
 *
 * 它们决定「点一次确定，究竟有哪些行被提交出去」。写错了不会报错、不会有异常栈，
 * 只会静默配出错误权限 —— 多授了是安全事故，少授了是「我明明勾了怎么没生效」。
 * 两种都只能靠事后追问发现，所以在提交之前就钉住。
 */

/** 后端 GrantActionEnum 里只对流程类资源开放的四个码（constants.ts 的 processOnly） */
const PROCESS_ONLY = ['START', 'DESIGN', 'MANAGE', 'VIEW_ALL']
/** effective = false 的预留码：能存进库、能保存，但不参与鉴权 */
const RESERVED = ['CREATE', 'UPDATE', 'DELETE', 'EXPORT', 'IMPORT', 'PRINT', 'REFERENCE']

const BASE = { subjectType: 'ROLE', subjectRefId: 7, effect: 'ALLOW' }
const valuesOf = (options: { value: string }[]) => options.map((item) => item.value)

describe('GRANT_BATCH_MAX_ITEMS', () => {
  it('是 500，与后端 GrantBatchSaveReqVO#items 上的 @Size(max = 500) 互为镜像', () => {
    // ⚠️ 这条用例的作用不是「记住一个数字」，而是改任何一侧时逼人做一次显式决定：
    // 前端放大了 → 用户先看到本地计数通过、再吃一个后端 400；
    // 前端缩小了 → 后端的余量白留着没人用
    expect(GRANT_BATCH_MAX_ITEMS).toBe(500)
  })
})

describe('expandGrantBatch', () => {
  it('2 资源 × 3 动作展开成 6 行，顺序是资源外层、动作内层', () => {
    const items = expandGrantBatch({
      ...BASE,
      resourceIds: [1, 2],
      actions: ['VIEW', 'CREATE', 'DELETE']
    })
    expect(items).toHaveLength(6)
    expect(items.map((item) => [item.resourceId, item.action])).toEqual([
      [1, 'VIEW'],
      [1, 'CREATE'],
      [1, 'DELETE'],
      [2, 'VIEW'],
      [2, 'CREATE'],
      [2, 'DELETE']
    ])
  })

  it('每行都带上同一份主体、效果与到期时间', () => {
    const items = expandGrantBatch({
      ...BASE,
      resourceIds: [1, 2, 3],
      actions: ['VIEW', 'DELETE'],
      expireTime: '2030-01-01 23:59:59'
    })
    expect(items).toHaveLength(6)
    for (const item of items) {
      expect(item.subjectType).toBe('ROLE')
      expect(item.subjectRefId).toBe(7)
      expect(item.effect).toBe('ALLOW')
      expect(item.expireTime).toBe('2030-01-01 23:59:59')
    }
  })

  it('🔴 不带 ruleId / fieldMode / contextResourceId —— 三个都是「批量配了就是无效行」', () => {
    const items = expandGrantBatch({ ...BASE, resourceIds: [1], actions: ['VIEW'] })
    for (const item of items) {
      // fieldMode 只对 COLUMN/FIELD 有效，ruleId 是精配动作，contextResourceId 连单条表单都没有入口
      expect('ruleId' in item).toBe(false)
      expect('fieldMode' in item).toBe(false)
      expect('contextResourceId' in item).toBe(false)
    }
  })

  it('没勾资源或没选动作时展开成空数组，而不是一行残缺的授权', () => {
    expect(expandGrantBatch({ ...BASE, resourceIds: [], actions: ['VIEW'] })).toEqual([])
    expect(expandGrantBatch({ ...BASE, resourceIds: [1], actions: [] })).toEqual([])
  })
})

describe('intersectGrantActionOptions', () => {
  it("['MENU'] 收窄掉流程专属动作", () => {
    const values = valuesOf(intersectGrantActionOptions(['MENU']))
    for (const action of PROCESS_ONLY) {
      expect(values).not.toContain(action)
    }
    expect(values).toContain('VIEW')
  })

  it("🔴 ['PROCESS', 'CATEGORY'] 保留 START/DESIGN/MANAGE/VIEW_ALL —— 交集基数必须是全集", () => {
    // 基数若写成 grantActionOptionsFor(undefined)，它已经滤掉了 processOnly 那四项，
    // 于是「勾的全是流程/分类」这个**唯一能配出流程动作**的场景反而配不出来
    const values = valuesOf(intersectGrantActionOptions(['PROCESS', 'CATEGORY']))
    expect(values).toEqual(expect.arrayContaining(PROCESS_ONLY))
  })

  it("['MENU', 'PROCESS'] 取交集：混了非流程资源就裁掉流程专属动作", () => {
    const values = valuesOf(intersectGrantActionOptions(['MENU', 'PROCESS']))
    for (const action of PROCESS_ONLY) {
      expect(values).not.toContain(action)
    }
  })

  it('空数组回落到「不按类型收窄」，与 grantActionOptionsFor(undefined) 逐项相同', () => {
    expect(intersectGrantActionOptions([])).toEqual(grantActionOptionsFor(undefined))
  })

  it('预留动作在任何组合下都保留 ——「一次开 查看/新增/修改/删除」配的正是它们', () => {
    const combos: (string | undefined)[][] = [
      [],
      ['MENU'],
      ['DATASET'],
      ['PROCESS', 'CATEGORY'],
      ['MENU', 'PROCESS'],
      ['COLUMN', 'FIELD']
    ]
    for (const combo of combos) {
      const values = valuesOf(intersectGrantActionOptions(combo))
      for (const action of RESERVED) {
        // 裁掉预留动作等于砍掉批量授权的一半用途；
        // 「配了不生效」由 reservedActionWarning 的常驻警告说明，不是靠从选项里消失来暗示
        expect(values, `组合 ${JSON.stringify(combo)} 少了 ${action}`).toContain(action)
      }
    }
  })

  it('返回顺序与 GRANT_ACTION_OPTIONS 一致（列表页搜索下拉与批量表单要对得上号）', () => {
    const order = valuesOf(GRANT_ACTION_OPTIONS)
    const values = valuesOf(intersectGrantActionOptions(['MENU']))
    expect(values).toEqual(order.filter((value) => values.includes(value)))
  })
})

describe('collectSubtreeIds / buildSubtreeIndex', () => {
  /**
   * 三层森林，形状照 handleTree 的真实产出：顶层两条，一条有下级、一条是叶子。
   * 本库 sys_resource 的 depth 分布是 1/2/3/4，这个夹具覆盖到「有下级的行」这一类就够了 ——
   * 按钮只在有下级的行上渲染
   */
  const forest = [
    {
      id: 1,
      children: [{ id: 2, children: [{ id: 4 }, { id: 5, children: [] }] }, { id: 3 }]
    },
    { id: 6 }
  ]

  it('单节点 → 只含自身；没有 children 字段与 children: [] 都算叶子', () => {
    expect(collectSubtreeIds({ id: 6 })).toEqual([6])
    expect(collectSubtreeIds({ id: 5, children: [] })).toEqual([5])
  })

  it('🔴 前序遍历、含自身、无重复', () => {
    const ids = collectSubtreeIds(forest[0])
    // 含自身是「全选下级」的语义要求：点一个菜单，它自己也得被授上，
    // 否则配出来的是「下面的按钮全给了、菜单本身看不见」这种自相矛盾的组合
    expect(ids).toEqual([1, 2, 4, 5, 3])
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('森林里每个节点都有一条，叶子映射到只含自身的数组', () => {
    const index = buildSubtreeIndex(forest)
    expect([...index.keys()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6])
    expect(index.get(4)).toEqual([4])
    expect(index.get(5)).toEqual([5])
    expect(index.get(6)).toEqual([6])
  })

  it('🔴 索引与 collectSubtreeIds 同源：每个节点的条目就等于对它自己跑一次收集', () => {
    // 索引是「按钮上显示的数量」与 setCheckedKeys 入参的唯一来源。
    // 若这里另写一份遍历，两份逻辑漂移之后按钮写着 5 而实际勾中 4 —— 静默少授一个资源，
    // 而少掉的那个通常是最不起眼的叶子
    const index = buildSubtreeIndex(forest)
    const walk = (nodes: any[]) => {
      nodes.forEach((node) => {
        expect(index.get(node.id), `节点 ${node.id}`).toEqual(collectSubtreeIds(node))
        if (node.children?.length) walk(node.children)
      })
    }
    walk(forest)
  })

  it('父节点的条目 = 自身 + 各子节点的条目拼接（括号里那个数就是这么来的）', () => {
    const index = buildSubtreeIndex(forest)
    expect(index.get(1)).toEqual([1, ...index.get(2)!, ...index.get(3)!])
  })

  it('空树 → 空索引', () => {
    expect(buildSubtreeIndex([]).size).toBe(0)
  })
})

describe('isSubtreeFullyChecked', () => {
  it('🔴 undefined → false：没有索引的行必须显示「全选下级」', () => {
    // 显示成「取消下级」的话，点下去是把一个**没勾上的**资源当成已勾的去取消，
    // 用户看到的就是按钮按了没反应
    expect(isSubtreeFullyChecked(undefined, new Set([1, 2]))).toBe(false)
  })

  it('空数组 → false，而不是 every 的空真', () => {
    expect(isSubtreeFullyChecked([], new Set([1]))).toBe(false)
    expect(isSubtreeFullyChecked([], new Set())).toBe(false)
  })

  it('整片勾上 → true（按钮就地翻成「取消下级」）', () => {
    expect(isSubtreeFullyChecked([1, 2, 4], new Set([1, 2, 4]))).toBe(true)
  })

  it('少勾一个 → false：手动取消掉一个子项后按钮必须回到「全选下级」，一个都没勾同理', () => {
    expect(isSubtreeFullyChecked([1, 2, 4], new Set([1, 2]))).toBe(false)
    expect(isSubtreeFullyChecked([1, 2, 4], new Set([2, 4]))).toBe(false)
    expect(isSubtreeFullyChecked([1, 2, 4], new Set())).toBe(false)
  })

  it('勾了子树外的资源不影响判定 —— 只看这一片，不看总数', () => {
    expect(isSubtreeFullyChecked([1, 2], new Set([1, 2, 99, 100]))).toBe(true)
    expect(isSubtreeFullyChecked([1, 2], new Set([99, 100]))).toBe(false)
  })
})

describe('confirmPastExpireTime', () => {
  // ⚠️ 只测两条不弹窗的分支：vitest.config.ts 刻意不带自动导入插件
  // （见它自己的注释），`useMessage` 在 node 环境里是个未定义的全局，
  // 走到弹窗那条分支只会抛 ReferenceError，测不出任何有意义的东西。
  // 弹窗分支的行为由手工验证覆盖
  it('没填到期时间时直接放行', async () => {
    await expect(confirmPastExpireTime(undefined)).resolves.toBe(true)
  })

  it('到期时间在未来时直接放行', async () => {
    await expect(confirmPastExpireTime('2999-01-01 00:00:00')).resolves.toBe(true)
  })
})
