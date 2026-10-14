import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { layoutDsl, nodeTagType, X_GAP } from './layout'

/**
 * layoutDsl 纯逻辑单测（增量8 / P4 第一刀，可选但有价值）
 *
 * 只测「逻辑图 → 视觉图」的三件核心事：① 链式分层正确；② 条件边展开成多条带 label 的边；
 * ③ 孤立/不可达节点不丢。不碰 Vue Flow 运行时（layoutDsl 是纯函数）。
 */
describe('layoutDsl', () => {
  it('链式 START→a→b→END 分层正确、合成端点存在', () => {
    const { nodes, edges } = layoutDsl({
      nodes: [
        { id: 'a', type: 'tool', name: '查数据' },
        { id: 'b', type: 'llm', name: '生成' }
      ],
      edges: [
        { from: 'START', to: 'a' },
        { from: 'a', to: 'b' },
        { from: 'b', to: 'END' }
      ]
    })

    // 4 个视觉节点：合成 START/END + a + b
    expect(nodes).toHaveLength(4)
    expect(edges).toHaveLength(3)

    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]))
    expect(byId['__start__']).toBeTruthy()
    expect(byId['__end__']).toBeTruthy()
    // x 随层递增（每层 +X_GAP）：start=0、a=1、b=2、end=3
    // 🔴 断言用导出的 X_GAP 而不是写死数字：写死等于把同一个常量钉在两处，改间距必然漏改一边。
    //    间距本身的**下界**由下面那条读 CSS 的用例守。
    expect(byId['__start__'].position.x).toBe(0)
    expect(byId['a'].position.x).toBe(X_GAP)
    expect(byId['b'].position.x).toBe(X_GAP * 2)
    expect(byId['__end__'].position.x).toBe(X_GAP * 3)
    // 节点 data 带上 label + 着色用的 tagType
    expect(byId['a'].data.label).toBe('查数据')
    expect(byId['a'].data.tagType).toBe('primary') // tool → primary
  })

  it('条件边按 cases + default 展开成多条带 label 的边', () => {
    const { edges } = layoutDsl({
      nodes: [{ id: 'a', type: 'condition.llm' }, { id: 'b' }, { id: 'c' }],
      edges: [
        { from: 'START', to: 'a' },
        { from: 'a', to: 'END', type: 'conditional', cases: { pass: 'b', fail: 'c' }, default: 'END' }
      ]
    })

    // START→a 一条 + 条件展开三条（pass→b、fail→c、default→END）= 4
    expect(edges).toHaveLength(4)
    const labels = edges.map((e) => e.label).filter(Boolean).sort()
    expect(labels).toEqual(['default', 'fail', 'pass'])
    // 主干边（START→a）无 label
    const trunk = edges.find((e) => e.source === '__start__')
    expect(trunk?.label).toBeFalsy()
  })

  it('孤立节点不丢，排到末层之后', () => {
    const { nodes } = layoutDsl({
      nodes: [{ id: 'a' }, { id: 'orphan' }],
      edges: [
        { from: 'START', to: 'a' },
        { from: 'a', to: 'END' }
      ]
    })

    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]))
    expect(byId['orphan']).toBeTruthy()
    // 主干末层是 END（layer 2）；孤立源点排到 maxLayer+1 = 3
    expect(byId['orphan'].position.x).toBeGreaterThan(byId['__end__'].position.x)
  })

  it('空 DSL 容错：只有合成端点、不崩', () => {
    const { nodes, edges } = layoutDsl({})
    expect(nodes.map((n) => n.id).sort()).toEqual(['__end__', '__start__'])
    expect(edges).toHaveLength(0)
  })

  it('边指向不存在的节点时跳过，不崩', () => {
    const { edges } = layoutDsl({
      nodes: [{ id: 'a' }],
      edges: [
        { from: 'START', to: 'a' },
        { from: 'a', to: 'ghost' } // ghost 不存在 → 跳过
      ]
    })
    expect(edges).toHaveLength(1)
  })

  it('节点存过 position 就用持久化坐标，不再自动分层（AI助手 UX 修复：坐标持久化读侧）', () => {
    const { nodes } = layoutDsl({
      nodes: [
        { id: 'a', type: 'tool', position: { x: 999, y: 888 } },
        { id: 'b', type: 'llm' }
      ],
      edges: [
        { from: 'START', to: 'a' },
        { from: 'a', to: 'b' }
      ]
    })
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]))
    expect(byId['a'].position).toEqual({ x: 999, y: 888 })
    // b 没存坐标 → 仍走自动分层（x = 层号 * X_GAP）
    expect(byId['b'].position.x).toBe(X_GAP * 2)
  })

  it('节点 data 带中文类型名 + 一句话摘要 + 必填缺口标记（供画布节点卡片渲染）', () => {
    const { nodes } = layoutDsl({
      nodes: [
        { id: 'a', type: 'tool', name: '查数据', config: { toolId: 'form_get' } },
        { id: 'b', type: 'llm', config: {} }
      ],
      edges: [{ from: 'START', to: 'a' }]
    })
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]))
    expect(byId['a'].data.typeLabel).toBe('工具')
    expect(byId['a'].data.summary).toContain('form_get')
    expect(byId['a'].data.hasGap).toBe(false)
    // llm 缺 prompt → 摘要说未配置、打缺口红点
    expect(byId['b'].data.summary).toContain('未填写提示词')
    expect(byId['b'].data.hasGap).toBe(true)
    // 合成端点没有类型名/摘要
    expect(byId['__start__'].data.typeLabel).toBe('')
    expect(byId['__start__'].data.summary).toBe('')
  })
})

describe('nodeTagType', () => {
  it('按类型着色，未知默认 info', () => {
    expect(nodeTagType('tool')).toBe('primary')
    expect(nodeTagType('script')).toBe('primary')
    expect(nodeTagType('llm')).toBe('success')
    expect(nodeTagType('condition.llm')).toBe('warning')
    expect(nodeTagType('hitl.confirm')).toBe('danger')
    expect(nodeTagType('hitl.bpm_approval')).toBe('danger')
    expect(nodeTagType('whatever')).toBe('info')
    expect(nodeTagType(undefined)).toBe('info')
  })
})

/**
 * X_GAP 的**下界**由节点卡片的 CSS 决定 —— 这条用例就是那个「强制点」（重构 S1 暴露的旧账）。
 *
 * 🔴 为什么要用单测去读一个 .vue 的 CSS：X_GAP 在本目录的 layout.ts，而 `max-width: 240px` 与
 * `right: -34px` 在 `editor/components/WorkflowDesigner.vue` 的 scoped style 里，**两者之间没有任何
 * 编译期或运行期的联系**。谁把 max-width 调大、或把悬停「＋」往外挪，都不会有任何东西变红，
 * 只会在浏览器里表现为「＋看得见却点不着」（Playwright 报 `subtree intercepts pointer events`）。
 * 这正是方案 §0.8 的「约束无强制点」：写在注释里的规则等于没写，所以这里把注释变成断言。
 *
 * 🔴 S1 之前 X_GAP 恰好等于 max-width(240)，即「节点一长满，两个卡片边贴边、＋整颗被下一个节点盖住」。
 * 只是那时 tool 节点的摘要都是 `调用工具「form_list」` 这种短英文键，节点停在 160px 的 min-width 上，
 * 永远碰不到 max-width，所以没人发现；S1 把摘要变成 `调用工具「查询表单列表」（form_list）`，
 * **每个** tool 节点都顶到 240px，旧账立刻变成必现故障（agent-workflow-editor.spec.ts 曾因此挂 3 分钟）。
 */
describe('X_GAP 与节点卡片 CSS 的硬约束', () => {
  const css = readFileSync(
    fileURLToPath(new URL('./editor/components/WorkflowDesigner.vue', import.meta.url)),
    'utf-8'
  )

  /** 抓 `选择器 { … }` 的规则体。🔴 抓不到就抛，绝不回落默认值让断言假通过。 */
  const ruleBody = (selector: string): string => {
    const m = css.match(new RegExp(`${selector.replace(/\./g, '\\.')}\\s*\\{([^}]*)\\}`))
    if (!m) throw new Error(`WorkflowDesigner.vue 里找不到 CSS 规则「${selector}」：改名了？请同步本用例`)
    return m[1]
  }
  /** 抓规则体里的某个 px 值（允许负号）。同样：读不到就抛。 */
  const pxOf = (body: string, prop: string): number => {
    const m = body.match(new RegExp(`${prop}\\s*:\\s*(-?\\d+)px`))
    if (!m) throw new Error(`「${prop}」已不是 px 值：请改本用例的读法，不要放宽断言`)
    return Number(m[1])
  }

  it('层间距 ≥ 节点最大宽度 + 悬停「＋」的外凸量 + 余量，否则＋会被下一个节点盖住', () => {
    const maxWidth = pxOf(ruleBody('.wf-node'), 'max-width')
    // right 是负值（-34px）＝按钮往节点外凸出 34px，取绝对值当外凸量
    const plusProtrusion = Math.abs(pxOf(ruleBody('.wf-node__plus'), 'right'))
    // 余量至少留一个「＋」的宽度：紧贴着下一个卡片的边框浮一颗圆按钮，视觉上像是长在别人身上
    const MIN_CLEARANCE = 20

    expect(X_GAP).toBeGreaterThanOrEqual(maxWidth + plusProtrusion + MIN_CLEARANCE)
  })
})
