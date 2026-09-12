import type { App } from 'vue'
// 👇使用 form-create 需额外全局引入 element plus 组件
import {
  // ElAutocomplete,
  // ElButton,
  // ElCascader,
  // ElCheckbox,
  // ElCheckboxButton,
  // ElCheckboxGroup,
  // ElCol,
  // ElColorPicker,
  // ElDatePicker,
  // ElDialog,
  // ElForm,
  // ElInput,
  // ElInputNumber,
  // ElPopover,
  // ElRadio,
  // ElRadioButton,
  // ElRadioGroup,
  // ElRate,
  // ElRow,
  // ElSelect,
  // ElSlider,
  // ElSwitch,
  // ElTimePicker,
  // ElTooltip,
  // ElTree,
  // ElUpload,
  // ElIcon,
  // ElProgress,
  // 以上会由 @form-create/element-ui/auto-import 自动引入
  ElAlert,
  ElTransfer,
  ElAside,
  ElContainer,
  ElDivider,
  ElHeader,
  ElMain,
  ElPopconfirm,
  ElTable,
  ElTableColumn,
  ElTabPane,
  ElTabs,
  ElDropdown,
  ElDropdownMenu,
  ElDropdownItem,
  ElBadge,
  ElTag,
  ElText,
  ElMenu,
  ElMenuItem,
  ElFooter,
  ElMessage,
  ElCollapse,
  ElCollapseItem,
  ElCard,
  ElTreeSelect
  // ElFormItem,
  // ElOption
} from 'element-plus'
import FcDesigner from '@form-create/designer'
import formCreate from '@form-create/element-ui'
import install from '@form-create/element-ui/auto-import'

//======================= 自定义组件 =======================
import { UploadFile, UploadImg, UploadImgs } from '@/components/UploadFile'
import { Editor } from '@/components/Editor'
import DictSelect from '@/components/FormCreate/src/components/DictSelect.vue'
import IframeComponent from '@/components/FormCreate/src/components/IframeComponent.vue'
import AreaSelect from '@/components/FormCreate/src/components/AreaSelect.vue'
import BillNumberInput from '@/components/FormCreate/src/components/BillNumberInput.vue'
import BillInlineRuleEditor from '@/components/FormCreate/src/components/BillInlineRuleEditor.vue'
// 表单设计器「字段ID」属性用：从物理列里下拉选择，替代自由输入
import DbFieldSelect from '@/components/FormCreate/src/components/DbFieldSelect.vue'
// 计算公式：运行时只读展示 + 属性面板的表达式编辑器
import Formula from '@/components/FormFormula/Formula.vue'
import FormulaEditorField from '@/components/FormCreate/src/components/FormulaEditorField.vue'
// 远程选择器与关联表单
import RemotePicker from '@/components/FormCreate/src/components/RemotePicker.vue'
import RelationForm from '@/components/FormCreate/src/components/RelationForm.vue'
import RelationConfigField from '@/components/FormCreate/src/components/RelationConfigField.vue'
// 组织选择器与系统值（B4 合并控件，替代 UserSelect / DeptSelect）
import OrgPicker from '@/components/FormCreate/src/components/OrgPicker.vue'
import SystemValue from '@/components/FormCreate/src/components/SystemValue.vue'
// 属性面板「选项来源」的两个分支：数据字典 / 数据接口
import DictSourceConfig from '@/components/FormCreate/src/components/DictSourceConfig.vue'
import DataInterfaceConfig from '@/components/FormCreate/src/components/DataInterfaceConfig.vue'
// 属性面板「格式校验」：内置正则库 + 自定义正则，产出 props.validateRules
import ValidateRulesEditor from '@/components/FormValidation/ValidateRulesEditor.vue'
// 属性面板「合计行」：产出 props.summaryColumns
import SubTableSummaryField from '@/components/FormCreate/src/components/SubTableSummaryField.vue'
// 超链接：纯展示，地址支持字段插值，协议走白名单
import Link from '@/components/FormCreate/src/components/Link.vue'
// 分组标题的折叠开关：挂在标题规则的 suffix 上
import CollapseToggle from '@/components/FormCreate/src/components/CollapseToggle.vue'
// 条码/二维码：纯展示，值支持字段插值
import CodeImage from '@/components/FormCreate/src/components/CodeImage.vue'
// 手写签名：canvas 产物上传文件服务，值只存 URL（替代内核的 signaturePad）
import Signature from '@/components/FormCreate/src/components/Signature.vue'
// 步骤条容器与它的步骤。容器负责头部与上一步/下一步，步骤负责显隐自己那段内容
import FormSteps from '@/components/FormCreate/src/components/FormSteps.vue'
import FormStep from '@/components/FormCreate/src/components/FormStep.vue'
// 子表控件的包装：给每一行加「复制本行」。见该文件里为什么必须在组件层接
import { registerSubTableGroup } from '@/components/FormCreate/src/subtable/registerSubTableGroup'
// 契约里有、但 form-create 解析不到渲染组件的那几个控件类型（图片 / 超链接 / 密码 / 日期区间 / 时间区间）
import { registerExtraWidgets } from '@/components/FormCreate/src/registerExtraWidgets'


const components = [
  ElAlert,
  ElTransfer,
  ElAside,
  ElContainer,
  ElDivider,
  ElHeader,
  ElMain,
  ElPopconfirm,
  ElTable,
  ElTableColumn,
  ElTabPane,
  ElTabs,
  ElTreeSelect,
  ElDropdown,
  ElDropdownMenu,
  ElDropdownItem,
  ElBadge,
  ElTag,
  ElText,
  ElMenu,
  ElMenuItem,
  ElFooter,
  ElMessage,
  // ElFormItem,
  // ElOption,
  UploadImg,
  UploadImgs,
  UploadFile,
  DictSelect,
  Editor,
  IframeComponent,
  AreaSelect,
  BillNumberInput,
  BillInlineRuleEditor,
  DbFieldSelect,
  Formula,
  FormulaEditorField,
  RemotePicker,
  RelationForm,
  RelationConfigField,
  OrgPicker,
  SystemValue,
  DictSourceConfig,
  DataInterfaceConfig,
  ValidateRulesEditor,
  SubTableSummaryField,
  Link,
  CollapseToggle,
  CodeImage,
  Signature,
  FormSteps,
  FormStep,
  ElCollapse,
  ElCollapseItem,
  ElCard
]

// 参考 http://www.form-create.com/v3/element-ui/auto-import.html 文档
export const setupFormCreate = (app: App<Element>) => {
  components.forEach((component) => {
    app.component(component.name!, component)
  })
  formCreate.use(install)
  // 把子表控件换成带「复制本行」的包装版。
  // ⚠️ 写的是 form-create 自己的组件表，不是 Vue 全局组件表 ——
  // 只有 form-create 渲染 type: 'group' 时才会用到它
  registerSubTableGroup(formCreate)
  // 同一张组件表：补上 elImage / Link / password / dateRange / timeRange 的渲染器。
  // 这几个走 Vue 全局注册是不够的，原因见 registerExtraWidgets.ts
  registerExtraWidgets(formCreate)
  app.use(formCreate)
  app.use(FcDesigner)
}
