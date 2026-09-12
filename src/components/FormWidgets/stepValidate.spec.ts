/**
 * 分步校验的单元测试
 *
 * 三条最要紧的：只拦往后走、认不出来的切换一律放行、校验不过时真的返回 false。
 */

import { describe, expect, it, vi } from 'vitest'
import { applyStepValidate, collectStepTabs } from './stepValidate'

const pane = (name: string, fields: string[]) => ({
  type: 'elTabPane',
  props: { name, label: name },
  children: fields.map((f) => ({ type: 'input', field: f }))
})

const tabs = (panes: any[], stepValidate = true) => ({
  type: 'elTabs',
  field: 'tabs1',
  props: { stepValidate },
  children: panes
})

describe('收集分步标签页', () => {
  it('按页收集字段', () => {
    const found = collectStepTabs([tabs([pane('1', ['a', 'b']), pane('2', ['c'])])])
    expect(found).toHaveLength(1)
    expect(found[0].panes.get('1')).toEqual(['a', 'b'])
    expect(found[0].panes.get('2')).toEqual(['c'])
  })

  it('嵌套在栅格里的字段也要收 —— 漏掉就等于那一页没有校验', () => {
    const nested = {
      type: 'elTabPane',
      props: { name: '1' },
      children: [{ type: 'col', children: [{ type: 'input', field: 'deep' }] }]
    }
    expect(collectStepTabs([tabs([nested])])[0].panes.get('1')).toEqual(['deep'])
  })

  it('没开分步校验的标签页不收', () => {
    expect(collectStepTabs([tabs([pane('1', ['a'])], false)])).toEqual([])
  })

  it('标签页容器藏在别的容器里也要找到', () => {
    const wrapped = { type: 'elCard', children: [tabs([pane('1', ['a'])])] }
    expect(collectStepTabs([wrapped])).toHaveLength(1)
  })
})

describe('before-leave 行为', () => {
  const setup = (result: boolean) => {
    const validate = vi.fn(async () => result)
    const tree: any[] = [tabs([pane('1', ['a']), pane('2', ['b']), pane('3', ['c'])])]
    applyStepValidate(tree, validate)
    return { validate, beforeLeave: tree[0].props.beforeLeave as any }
  }

  it('往后走且校验通过 → 放行', async () => {
    const { beforeLeave, validate } = setup(true)
    expect(await beforeLeave('2', '1')).toBe(true)
    expect(validate).toHaveBeenCalledWith(['a'])
  })

  it('⚠️ 往后走但校验不过 → 拦住', async () => {
    const { beforeLeave } = setup(false)
    expect(await beforeLeave('2', '1')).toBe(false)
  })

  it('⚠️ 往回退一律放行 —— 回上一步改东西是正常操作，拦着等于不让他改', async () => {
    const { beforeLeave, validate } = setup(false)
    expect(await beforeLeave('1', '2')).toBe(true)
    expect(validate, '往回退不该触发校验').not.toHaveBeenCalled()
  })

  it('⚠️ 认不出来的页一律放行 —— 拦一个判断不了的切换，用户会卡在这页出不去', async () => {
    const { beforeLeave } = setup(false)
    expect(await beforeLeave('unknown', '1')).toBe(true)
    expect(await beforeLeave('2', 'unknown')).toBe(true)
  })

  it('空页直接放行，不白跑一次校验', async () => {
    const validate = vi.fn(async () => false)
    const tree: any[] = [tabs([pane('1', []), pane('2', ['b'])])]
    applyStepValidate(tree, validate)
    expect(await tree[0].props.beforeLeave('2', '1')).toBe(true)
    expect(validate).not.toHaveBeenCalled()
  })

  it('跨页前进（1 → 3）校验的是当前页', async () => {
    const { beforeLeave, validate } = setup(true)
    await beforeLeave('3', '1')
    expect(validate).toHaveBeenCalledWith(['a'])
  })

  it('没开分步校验时不挂 beforeLeave', () => {
    const tree: any[] = [tabs([pane('1', ['a'])], false)]
    applyStepValidate(tree, async () => true)
    expect(tree[0].props.beforeLeave).toBeUndefined()
  })
})
