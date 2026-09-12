/**
 * 针对 https://github.com/xaboy/form-create-designer 封装的工具类
 */
import { isRef } from 'vue'
import formCreate from '@form-create/element-ui'
import {
  applyDictSource,
  resolveRemoteOptions,
  stripResolvedOptions
} from '@/components/FormCreate/src/utils/optionSource'

/** 编码表单 Conf */
export const encodeConf = (designerRef: object) => {
  // @ts-ignore
  // 关联案例：https://gitee.com/yudaocode/yudao-ui-admin-vue3/pulls/834/
  return formCreate.toJson(designerRef.value.getOption())
}

/** 解码表单 Conf */
export const decodeConf = (conf: string) => {
  return formCreate.parseJson(conf)
}

/** 编码表单 Fields */
export const encodeFields = (designerRef: object) => {
  // @ts-ignore
  const rule = designerRef.value.getRule()
  const fields: string[] = []
  rule.forEach((item: any) => {
    // 设计器的实时预览会把字典/接口解析出的选项写进规则对象，直接保存会把这份快照
    // 一起持久化：表单 JSON 无谓膨胀（大接口能有几千条），而且下次打开时先显示的是
    // 过期快照。选项来源已经声明在规则里，运行时会重新解析，保存时剥掉即可。
    fields.push(formCreate.toJson(stripResolvedOptions(item)))
  })
  return fields
}

/**
 * 解码表单 Fields（同步）
 *
 * 只解析「数据字典」来源 —— 字典在前端有全量缓存，同步就能取到。
 * 「数据接口」来源需要发请求，用 decodeFieldsAsync。
 *
 * 只需要字段元信息（field / title / type）的场景用这个就够了。
 */
export const decodeFields = (fields: string[]) => {
  const rule: object[] = []
  fields.forEach((item) => {
    rule.push(formCreate.parseJson(item))
  })
  applyDictSource(rule)
  return rule
}

/**
 * 解码表单 Fields，并等数据接口的选项取回来
 *
 * 要渲染表单就得用这个。必须在把规则交给 form-create / 设计器**之前**解析完 ——
 * 两边接收规则时都会做深拷贝，之后再改原对象是不生效的。
 */
export const decodeFieldsAsync = async (fields: string[]) => {
  const rule = decodeFields(fields)
  await resolveRemoteOptions(rule)
  return rule
}

/** 设置表单的 Conf 和 Fields，适用 FcDesigner 场景 */
export const setConfAndFields = async (designerRef: object, conf: string, fields: string[]) => {
  // @ts-ignore
  designerRef.value.setOption(decodeConf(conf))
  // 设计器的 setRule 会深拷贝，所以选项必须在调用它之前就解析完
  const rule = await decodeFieldsAsync(fields)
  // @ts-ignore
  designerRef.value.setRule(rule)
}

/** 设置表单的 Conf 和 Fields，适用 form-create 场景 */
export const setConfAndFields2 = async (
  detailPreview: object,
  conf: string,
  fields: string[],
  value?: object
) => {
  if (isRef(detailPreview)) {
    // @ts-ignore
    detailPreview = detailPreview.value
  }

  // 先把数据接口的选项取回来再赋值：form-create 接收规则时会深拷贝，
  // 赋值之后再改原对象不会反映到已渲染的表单上
  const rule = await decodeFieldsAsync(fields)

  // @ts-ignore
  detailPreview.option = decodeConf(conf)
  // @ts-ignore
  detailPreview.rule = rule

  if (value) {
    // @ts-ignore
    detailPreview.value = value
  }
}
