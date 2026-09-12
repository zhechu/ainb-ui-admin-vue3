/**
 * 上传值形态适配的测试
 *
 * 守的是一件事：**库里存对象、界面上用 URL**，这层收敛不能漏也不能多。
 *
 * - 漏了：附件列表拿到 `[object Object]`，整个控件渲染不出来
 * - 多了（把不该动的值也收敛）：别的控件的值被悄悄改形状，而它不报错
 *
 * ⚠️ 只有读方向。提交方向不做变换 —— 组件发出来的本来就是 URL，
 * 服务端会重新补一遍元信息。少一个方向，也就少一处「两边形态对不上」。
 */
import { describe, expect, it } from 'vitest'
import { collapseUploadValue, collapseUploadValues, collectUploadFields } from './uploadValue'

/** 造一个控件规则。type 用契约里真实存在的控件名 */
const widget = (type: string, field: string, extra: Record<string, any> = {}) => ({
  type,
  field,
  title: field,
  ...extra
})

describe('collapseUploadValue', () => {
  it('对象数组收敛成 URL 数组', () => {
    expect(
      collapseUploadValue([
        { name: '合同.pdf', url: '/a.pdf', size: 100, type: 'application/pdf' },
        { name: '附件.docx', url: '/b.docx', size: 200 }
      ])
    ).toEqual(['/a.pdf', '/b.docx'])
  })

  it('已经是 URL 数组时原样返回入参（引用相等）', () => {
    // 调用方靠引用相等判断要不要写回，与服务端 RichContentGuard 同一个约定 ——
    // 每次都返回新数组的话，form-create 会以为值变了而重设控件
    const value = ['/a.pdf', '/b.docx']
    expect(collapseUploadValue(value)).toBe(value)
  })

  it('裸字符串不动 —— 单图与签名的落库形态是 scalar', () => {
    expect(collapseUploadValue('/avatar.png')).toBe('/avatar.png')
  })

  it('空值与非数组一律原样返回', () => {
    expect(collapseUploadValue(null)).toBe(null)
    expect(collapseUploadValue(undefined)).toBe(undefined)
    const empty: any[] = []
    expect(collapseUploadValue(empty)).toBe(empty)
  })

  it('没有 url 键的对象不动 —— 不是所有对象数组都是上传值', () => {
    // OrgPicker 的值是 {type,id} 对象数组。误收敛的话它会变成一堆 undefined
    const value = [{ type: 'user', id: '1' }]
    expect(collapseUploadValue(value)).toBe(value)
  })

  it('混合形态里只换对象，字符串保持不动', () => {
    expect(collapseUploadValue([{ url: '/a.pdf' }, '/b.docx'])).toEqual(['/a.pdf', '/b.docx'])
  })
})

describe('collectUploadFields', () => {
  it('按契约挑出 storage=json 的文件控件', () => {
    const { main } = collectUploadFields([
      widget('UploadFile', 'attachments'),
      widget('UploadImgs', 'photos'),
      widget('input', 'remark')
    ])
    expect(main).toEqual(new Set(['attachments', 'photos']))
  })

  it('单图与签名不在内 —— 它们是 scalar，值本来就是裸 URL', () => {
    const { main } = collectUploadFields([
      widget('UploadImg', 'avatar'),
      widget('Signature', 'sign')
    ])
    expect(main.size).toBe(0)
  })

  it('递归布局容器', () => {
    const { main } = collectUploadFields([
      { type: 'row', children: [{ type: 'col', children: [widget('UploadFile', 'inner')] }] }
    ])
    expect(main).toEqual(new Set(['inner']))
  })

  it('递归子表内部规则，并记住归属', () => {
    // 少递归子表的话，明细里的附件列收敛不了
    const { main, sub } = collectUploadFields([
      widget('group', 'items', { props: { rule: [widget('UploadFile', 'proof')] } })
    ])
    expect(main.size).toBe(0)
    expect(sub.get('items')).toEqual(new Set(['proof']))
  })
})

describe('collapseUploadValues', () => {
  const rules = [
    widget('UploadFile', 'attachments'),
    widget('UploadImg', 'avatar'),
    widget('input', 'remark'),
    widget('group', 'items', { props: { rule: [widget('UploadFile', 'proof')] } })
  ]

  it('主表、子表的上传字段都收敛，其它字段不动', () => {
    const record = {
      attachments: [{ name: '合同.pdf', url: '/a.pdf', size: 1 }],
      avatar: '/avatar.png',
      remark: '备注',
      items: [{ proof: [{ name: '凭证.jpg', url: '/p.jpg' }], qty: 2 }]
    }
    const result = collapseUploadValues(record, rules)

    expect(result.attachments).toEqual(['/a.pdf'])
    expect(result.items[0].proof).toEqual(['/p.jpg'])
    // 单图是裸 URL，不该被动
    expect(result.avatar).toBe('/avatar.png')
    expect(result.remark).toBe('备注')
    expect(result.items[0].qty).toBe(2)
  })

  it('不修改入参', () => {
    // 入参被改的话，调用方以为拿到的是「服务端返回的原始记录」，
    // 而它其实已经被动过了 —— 与服务端那几个守卫同一条约定
    const record = { attachments: [{ url: '/a.pdf' }] }
    const copy = JSON.parse(JSON.stringify(record))
    collapseUploadValues(record, rules)
    expect(record).toEqual(copy)
  })

  it('表单里没有上传字段时原样返回入参', () => {
    const record = { remark: 'x' }
    expect(collapseUploadValues(record, [widget('input', 'remark')])).toBe(record)
  })

  it('空记录返回空对象', () => {
    expect(collapseUploadValues(null, rules)).toEqual({})
    expect(collapseUploadValues(undefined, rules)).toEqual({})
  })
})
