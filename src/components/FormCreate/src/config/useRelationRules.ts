import { generateUUID } from '@/utils'
import { localeProps, makeRequiredRule } from '@/components/FormCreate/src/utils'

/**
 * 远程选择器的设计器规则
 *
 * 替代 ApiSelect：下拉形态 + 数据接口数据源，就是 ApiSelect 的等价物。
 * 三种展示形态共用一套数据源配置 —— 用户改形态不用重配数据源。
 */
export const useRemotePickerRule = () => {
  const label = '远程选择器'
  const name = 'RemotePicker'
  return {
    icon: 'icon-server',
    label,
    name,
    rule() {
      return {
        type: name,
        field: generateUUID(),
        title: label,
        info: '',
        $required: false,
        props: {
          mode: 'select',
          sourceType: 'interface',
          valueField: 'id',
          labelField: 'name',
          multiple: false,
          placeholder: '请选择'
        }
      }
    },
    props(_, { t }) {
      return localeProps(t, name + '.props', [
        makeRequiredRule(),
        {
          type: 'radio',
          field: 'mode',
          title: '展示形态',
          value: 'select',
          options: [
            { label: '下拉选择', value: 'select' },
            { label: '搜索输入', value: 'search' },
            { label: '弹窗表格', value: 'popup' }
          ],
          info: '搜索输入不预加载选项，适合数据量大的场景；弹窗表格能显示多列'
        },
        {
          type: 'radio',
          field: 'sourceType',
          title: '数据来源',
          value: 'interface',
          options: [
            { label: '数据接口', value: 'interface' },
            { label: '数据字典', value: 'dict' },
            { label: '静态数据', value: 'static' }
          ]
        },
        {
          type: 'input',
          field: 'interfaceCode',
          title: '接口编码',
          info: '数据接口模块里那条接口的编码'
        },
        { type: 'input', field: 'dictType', title: '字典类型' },
        { type: 'input', field: 'valueField', title: '取值字段', value: 'id' },
        { type: 'input', field: 'labelField', title: '显示字段', value: 'name' },
        { type: 'switch', field: 'multiple', title: '是否多选', value: false },
        { type: 'input', field: 'placeholder', title: '占位提示' },
        { type: 'input', field: 'popupTitle', title: '弹窗标题', value: '选择数据' }
      ])
    }
  }
}

/**
 * 关联表单的设计器规则
 *
 * 带出字段映射收在本控件的属性面板里（RelationMappingField），而不是让用户
 * 为每个带出字段再拖一个「关联属性」控件 —— 详见控件契约里的说明。
 */
export const useRelationFormRule = () => {
  const label = '关联表单'
  const name = 'RelationForm'
  return {
    icon: 'icon-link',
    label,
    name,
    rule() {
      return {
        type: name,
        field: generateUUID(),
        title: label,
        info: '',
        $required: false,
        props: {
          targetFormCode: '',
          displayField: '',
          mode: 'select',
          fieldMappings: []
        }
      }
    },
    props(_, { t }) {
      return localeProps(t, name + '.props', [
        makeRequiredRule(),
        {
          type: 'RelationConfigField',
          field: '__relation__',
          title: '关联配置',
          // 这一项承载关联表单、显示字段、展示形态与带出映射表四组配置。
          // 拆成独立表单项的话，用户配映射时看不到自己关联的是哪张表单
          props: {}
        }
      ])
    }
  }
}
