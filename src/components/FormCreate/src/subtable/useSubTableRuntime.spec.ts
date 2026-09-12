/**
 * 子表运行时接线的单元测试
 *
 * 纯函数（合计怎么算、判空口径）由 useSubTableEnhance.spec.ts 覆盖，
 * 这里只测接线：从规则树里认出子表、合计行的 suffix、提交前校验的汇总。
 */

import { describe, expect, it } from 'vitest'
import {
  buildSummarySuffix,
  checkSubTables,
  collectSubTables,
  toSubTableMessage
} from './useSubTableRuntime'

/** 一个带两列的子表，其中单价配了合计、名称是必填 */
const subTableRule = (overrides: Record<string, any> = {}) => ({
  type: 'group',
  field: 'items',
  title: '明细',
  props: {
    min: 1,
    max: 3,
    summaryColumns: [{ field: 'price', label: '单价', method: 'SUM', precision: 2 }],
    rule: [
      { type: 'input', field: 'name', title: '名称', $required: true },
      { type: 'inputNumber', field: 'price', title: '单价' }
    ],
    ...overrides
  }
})

describe('从规则树里认出子表', () => {
  it('读到行数区间、合计配置与明细列', () => {
    const metas = collectSubTables([subTableRule()])
    expect(metas).toHaveLength(1)
    expect(metas[0].label).toBe('明细')
    expect(metas[0].min).toBe(1)
    expect(metas[0].max).toBe(3)
    expect(metas[0].summaryColumns).toHaveLength(1)
    expect(metas[0].columns.map((c) => c.field)).toEqual(['name', 'price'])
    expect(metas[0].columns[0].required).toBe(true)
  })

  it('子表被放在布局容器里也要认出来', () => {
    const metas = collectSubTables([{ type: 'col', children: [subTableRule()] }])
    expect(metas).toHaveLength(1)
  })

  it('明细列被放在栅格里也要收到 —— 漏掉就等于那些列没有必填校验', () => {
    const metas = collectSubTables([
      subTableRule({
        rule: [
          {
            type: 'col',
            children: [{ type: 'input', field: 'memo', title: '备注', $required: true }]
          }
        ]
      })
    ])
    expect(metas[0].columns.map((c) => c.field)).toEqual(['memo'])
  })

  it('没有子表时返回空数组', () => {
    expect(collectSubTables([{ type: 'input', field: 'a' }])).toEqual([])
    expect(collectSubTables(null)).toEqual([])
  })
})

describe('合计行', () => {
  it('按配置算出合计并拼成 suffix', () => {
    const meta = collectSubTables([subTableRule()])[0]
    const suffix = buildSummarySuffix(meta, [{ price: 10.5 }, { price: 20.25 }])
    expect(suffix?.children?.[0]).toContain('单价：30.75')
  })

  it('没配合计列时不渲染 —— 空的合计条比不显示更碍眼', () => {
    const meta = collectSubTables([subTableRule({ summaryColumns: [] })])[0]
    expect(buildSummarySuffix(meta, [{ price: 1 }])).toBeUndefined()
  })

  it('明细为空时合计为 0，而不是不显示 —— 用户要能看出「确实是 0」', () => {
    const meta = collectSubTables([subTableRule()])[0]
    expect(buildSummarySuffix(meta, [])?.children?.[0]).toContain('单价：0')
    expect(buildSummarySuffix(meta, undefined)?.children?.[0]).toContain('单价：0')
  })
})

describe('提交前校验', () => {
  const meta = () => collectSubTables([subTableRule()])[0]

  it('行数低于下限 / 高于上限都要报', () => {
    expect(checkSubTables([meta()], { items: [] }).rowCountErrors[0]).toContain('至少需要 1 行')
    const many = { items: [{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }] }
    expect(checkSubTables([meta()], many).rowCountErrors[0]).toContain('最多 3 行')
  })

  it('行内必填缺失带行号，行号从 1 开始与界面一致', () => {
    const result = checkSubTables([meta()], { items: [{ name: '' }, { name: 'b' }, { name: null }] })
    expect(result.cellErrors.map((e) => e.rowNumber)).toEqual([1, 3])
  })

  it('同一列的多行缺失合并成一条 —— 30 条错误是刷屏', () => {
    const rows = Array.from({ length: 30 }, () => ({ name: '' }))
    const result = checkSubTables([{ ...meta(), max: null }], { items: rows })
    const message = toSubTableMessage(result)
    expect(message).toContain('等 30 行')
    // 只有一条「名称必填」，不是 30 条
    expect(message.split('；').filter((p) => p.includes('名称'))).toHaveLength(1)
  })

  it('全部合规时没有任何提示', () => {
    const result = checkSubTables([meta()], { items: [{ name: 'a', price: 1 }] })
    expect(toSubTableMessage(result)).toBe('')
  })
})
