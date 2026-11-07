import { describe, expect, it } from 'vitest'
import { listWidgetContracts } from '@/components/FormWidgets/contracts'
import {
  OPTION_SOURCE_TARGETS,
  readByPath,
  renameValueKey,
  writeByPath,
  type OptionNode
} from './optionTargets'

/**
 * {@link OPTION_SOURCE_TARGETS} 与两个纯函数的单元测试
 *
 * <h3>🔴 这张表的大部分内容是【从控件契约推出来的】，不是快照</h3>
 * 「哪些控件有选项落点」= 契约里声明了 {@code options} / {@code data} 数组 prop 的那些；
 * 「值键叫什么」= 契约里 {@code nodeKey} 那个 prop 的示例值。
 * 两条都能推，就都推 —— 写成快照的话，契约里加一个选项类控件时这张表会安安静静地少一个键，
 * 而少一个键的后果不是报错，是那个控件**拿不到选项**（字典 / 接口 / 静态三条路径都靠它定位落点）。
 *
 * <p>推不出来的只有 {@code tree} 那一位与「落在 {@code rule.options} 还是
 * {@code rule.props.options}」，逐个钉住并写明为什么推不出来。
 *
 * <p>⚠️ 本模块零依赖，所以这份 spec 能在 vitest 的 node 环境下直接收集 ——
 * 而这正是它从 {@code optionSource.ts} 里搬出来的全部理由（见 {@code optionTargets.ts} 文件头）。
 */

const contractOf = (type: string) => listWidgetContracts().find((item) => item.type === type)

/** 契约里那个「装选项的数组 prop」，没有就是 undefined */
const optionPropOf = (type: string) =>
  (contractOf(type)?.props ?? []).find(
    (prop) => (prop.name === 'options' || prop.name === 'data') && prop.type === 'array'
  )

/** 契约里 nodeKey 的示例值（示例是带引号的 JSON 文本，如 {@code "id"}） */
const nodeKeyOf = (type: string) => {
  const example = (contractOf(type)?.props ?? []).find((prop) => prop.name === 'nodeKey')?.example
  return example ? example.replace(/"/g, '') : undefined
}

describe('OPTION_SOURCE_TARGETS', () => {
  it('🔴 键集合与契约里「选项有落点」的控件集合完全一致（双向）', () => {
    const fromContract = listWidgetContracts()
      .map((widget) => widget.type)
      .filter((type) => !!optionPropOf(type))
      .sort()

    // 少一个键：那个控件拿不到选项，且不报错。多一个键：契约里已经没有这个控件了，
    // 而这张表还在替它声明落点 —— 两个方向都必须是红的
    expect(Object.keys(OPTION_SOURCE_TARGETS).sort()).toEqual(fromContract)
  })

  it('🔴 path 的最后一段就是契约里那个数组 prop 的名字', () => {
    Object.entries(OPTION_SOURCE_TARGETS).forEach(([type, target]) => {
      const prop = optionPropOf(type)
      expect(prop, `契约里 ${type} 应当声明一个 options/data 数组 prop`).toBeTruthy()
      expect(target.path.split('.').pop()).toBe(prop!.name)
    })
  })

  it('🔴 扁平控件落在 rule.options、层级控件落在 rule.props 下——这是 form-create 的形状，契约里没有', () => {
    // 推不出来的那一位：契约只说「有个叫 options 的 prop」，不说 form-create 把它读在哪。
    // select / radio / checkbox 读的是 rule.options（内核 elm-select 那一支就是这么写的），
    // 其余三个读 rule.props.options 与 rule.props.data。写错一层不报错，只是选项不显示
    expect(OPTION_SOURCE_TARGETS.select.path).toBe('options')
    expect(OPTION_SOURCE_TARGETS.radio.path).toBe('options')
    expect(OPTION_SOURCE_TARGETS.checkbox.path).toBe('options')
    expect(OPTION_SOURCE_TARGETS.cascader.path).toBe('props.options')
    expect(OPTION_SOURCE_TARGETS.elTreeSelect.path).toBe('props.data')
    expect(OPTION_SOURCE_TARGETS.tree.path).toBe('props.data')
  })

  it('🔴 valueKey 取自契约里 nodeKey 的示例值：tree 是 id，其余是 value', () => {
    Object.entries(OPTION_SOURCE_TARGETS).forEach(([type, target]) => {
      // nodeKey 写错的表现是「树渲染出来了、但一个节点都选不中、也不报错」
      expect(target.valueKey, `${type} 的 valueKey`).toBe(nodeKeyOf(type) ?? 'value')
    })
    expect(OPTION_SOURCE_TARGETS.tree.valueKey).toBe('id')
  })

  it('tree 位逐个钉住：cascader 的层级来自 children 而不是 nodeKey，所以推不出来', () => {
    expect(OPTION_SOURCE_TARGETS.select.tree).toBe(false)
    expect(OPTION_SOURCE_TARGETS.radio.tree).toBe(false)
    expect(OPTION_SOURCE_TARGETS.checkbox.tree).toBe(false)
    expect(OPTION_SOURCE_TARGETS.cascader.tree).toBe(true)
    expect(OPTION_SOURCE_TARGETS.elTreeSelect.tree).toBe(true)
    expect(OPTION_SOURCE_TARGETS.tree.tree).toBe(true)
  })

  it('elTransfer 不在表里，而这是对的：它在契约里一个 prop 都没声明，选项没有落点', () => {
    // 它是 select 族里唯一进不了这张表的控件。别「顺手补上」——
    // 补了就得同时给契约加一个 props 声明，而那属于改契约，要走 SYNC.md 的流程
    expect(OPTION_SOURCE_TARGETS.elTransfer).toBeUndefined()
    expect(contractOf('elTransfer')?.props ?? []).toEqual([])
  })
})

describe('readByPath / writeByPath', () => {
  it('读根上的键与读嵌套的键', () => {
    const rule = { options: [1], props: { data: [2] } }
    expect(readByPath(rule, 'options')).toEqual([1])
    expect(readByPath(rule, 'props.data')).toEqual([2])
  })

  it('🔴 路径中途断了原样返回那个断点，不抛错', () => {
    // 设计器里随时可能出现「规则还没配 props」的中间状态，抛错会让整个属性面板打不开。
    // ⚠️ 断点是 null 时返回的就是 null 而不是 undefined —— 调用方判空要用 == null
    expect(readByPath({ props: {} }, 'props.data')).toBeUndefined()
    expect(readByPath({}, 'props.data')).toBeUndefined()
    expect(readByPath(null, 'props.data')).toBeNull()
    expect(readByPath({ props: null }, 'props.data')).toBeNull()
  })

  it('写入时中途缺的对象会被建出来，且不动同级的其它键', () => {
    const rule: any = { props: { clearable: true } }
    writeByPath(rule, 'props.data', [{ label: '甲', id: 1 }])
    expect(rule.props.data).toEqual([{ label: '甲', id: 1 }])
    expect(rule.props.clearable).toBe(true)
  })

  it('写完再读，拿到的是同一个引用——运行时靠这个把选项原地填进响应式规则', () => {
    const rule: any = {}
    const options = [{ label: '甲', value: 'A' }]
    writeByPath(rule, 'options', options)
    expect(readByPath(rule, 'options')).toBe(options)
  })
})

describe('renameValueKey', () => {
  const tree: OptionNode[] = [
    {
      label: '浙江',
      value: 'ZJ',
      children: [
        { label: '杭州', value: 'HZ' },
        { label: '宁波', value: 'NB', extra: '多余的键' } as OptionNode
      ]
    }
  ]

  it("valueKey 是 'value' 时原样返回同一个数组，不深拷贝", () => {
    // 六个控件里五个走这一支。字典解析在每次渲染时都会跑，
    // 白拷一遍几千条选项没有意义
    expect(renameValueKey(tree, 'value')).toBe(tree)
  })

  it("🔴 valueKey 是 'id' 时递归改名：只改顶层会让二级节点选不中，而且不报错", () => {
    const renamed = renameValueKey(tree, 'id')
    expect(renamed).toEqual([
      {
        label: '浙江',
        id: 'ZJ',
        children: [
          { label: '杭州', id: 'HZ' },
          { label: '宁波', id: 'NB' }
        ]
      }
    ])
    // 原来的 value 键必须没了：留着的话 el-tree 会同时看到两个候选 key
    expect(JSON.stringify(renamed)).not.toContain('"value"')
  })

  it('改名时只保留 label 与那个值键，其余键一律丢掉', () => {
    expect(renameValueKey(tree, 'id')[0].children[1]).toEqual({ label: '宁波', id: 'NB' })
  })

  it('children 是空数组时不写 children 键：控件会把空数组当成「有子节点但加载不出来」', () => {
    const renamed = renameValueKey([{ label: '甲', value: 'A', children: [] }], 'id')
    expect(renamed).toEqual([{ label: '甲', id: 'A' }])
    expect('children' in renamed[0]).toBe(false)
  })

  it('空清单进、空清单出', () => {
    expect(renameValueKey([], 'id')).toEqual([])
  })
})
