import { generateUUID } from '@/utils'
import { localeProps, makeRequiredRule } from '@/components/FormCreate/src/utils'

/**
 * 组织选择器的设计器规则
 *
 * 替代 UserSelect 与 DeptSelect：勾选「可选主体类型」即可限定成只选用户或只选部门。
 * 对标产品把这些拆成 6 个独立控件 —— 从「选用户」改成「选用户或部门」意味着换控件、
 * 重配一遍。
 */
export const useOrgPickerRule = () => {
  const label = '组织选择器'
  const name = 'OrgPicker'
  return {
    icon: 'icon-user-o',
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
          types: ['user'],
          multiple: false,
          maxCount: 0,
          placeholder: '请选择'
        }
      }
    },
    props(_, { t }) {
      return localeProps(t, name + '.props', [
        makeRequiredRule(),
        {
          type: 'checkbox',
          field: 'types',
          title: '可选类型',
          value: ['user'],
          options: [
            { label: '用户', value: 'user' },
            { label: '部门', value: 'dept' },
            { label: '岗位', value: 'post' },
            { label: '角色', value: 'role' }
          ],
          info: '勾选多个即可在同一个控件里混选。值的形态是 {type, id}，不同类型的 id 不会互相混淆'
        },
        { type: 'switch', field: 'multiple', title: '是否多选', value: false },
        {
          type: 'inputNumber',
          field: 'maxCount',
          title: '数量上限',
          value: 0,
          info: '0 表示不限。仅多选时有效'
        },
        { type: 'input', field: 'placeholder', title: '占位提示' }
      ])
    }
  }
}

/**
 * 系统值控件的设计器规则
 *
 * 只读展示，没有「默认值」「是否必填」这类属性 ——
 * 必填一个用户填不了的字段没有意义，而值由后端自动填充写入。
 */
export const useSystemValueRule = () => {
  const label = '系统值'
  const name = 'SystemValue'
  return {
    icon: 'icon-lock',
    label,
    name,
    rule() {
      return {
        type: name,
        field: generateUUID(),
        title: label,
        info: '',
        // 系统值字段不参与必填校验：用户没有途径去「填」它
        $required: false,
        props: {
          source: 'CREATOR',
          dateFormat: 'YYYY-MM-DD HH:mm:ss'
        }
      }
    },
    props(_, { t }) {
      return localeProps(t, name + '.props', [
        {
          type: 'select',
          field: 'source',
          title: '取值来源',
          value: 'CREATOR',
          options: [
            { label: '创建人', value: 'CREATOR' },
            { label: '创建时间', value: 'CREATE_TIME' },
            { label: '更新人', value: 'UPDATER' },
            { label: '更新时间', value: 'UPDATE_TIME' },
            { label: '当前登录人', value: 'CURRENT_USER' },
            { label: '当前部门', value: 'CURRENT_DEPT' },
            { label: '当前岗位', value: 'CURRENT_POST' },
            { label: '当前时间', value: 'NOW' }
          ],
          info: '前四种由后端自动填充列写入；后四种只做展示，不落库'
        },
        {
          type: 'input',
          field: 'dateFormat',
          title: '日期格式',
          value: 'YYYY-MM-DD HH:mm:ss',
          info: '仅时间类来源有效'
        }
      ])
    }
  }
}
