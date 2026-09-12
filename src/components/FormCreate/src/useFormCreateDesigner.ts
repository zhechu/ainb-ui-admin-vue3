import {
  useDictSelectRule,
  useEditorRule,
  useUploadFileRule,
  useUploadImgRule,
  useUploadImgsRule,
  useIframeRule,
  useAreaSelectRule,
  useBillFieldRule,
  useFormulaRule,
  useRemotePickerRule,
  useRelationFormRule,
  useOrgPickerRule,
  useSystemValueRule,
  useValidateRule,
  useInputEnhanceRule,
  useSubTableRule,
  useLinkRule,
  useCodeImageRule,
  useSignatureRule,
  useFormStepsRule,
  useFormStepRule
} from './config'
import { useOptionSource } from './config/useOptionSource'
import { useFieldDeduplication } from './designer/useFieldDeduplication'
import { alignContractWidgetTypes } from './designer/useContractWidgetTypes'
import { Ref } from 'vue'
import { Menu } from '@/components/FormCreate/src/type'

/**
 * 表单设计器增强 hook
 * 新增
 * - 文件上传
 * - 单图上传
 * - 多图上传
 * - 字典选择器
 * - 用户选择器
 * - 部门选择器
 * - 富文本
 */
export const useFormCreateDesigner = async (designer: Ref) => {
  const { buildOptionSource } = useOptionSource(designer)
  const { buildValidateRule } = useValidateRule(designer)
  const { buildInputEnhance } = useInputEnhanceRule(designer)
  const { buildSubTableRule, buildTitleRule, buildTabsRule } = useSubTableRule(designer)
  const editorRule = useEditorRule()
  const uploadFileRule = useUploadFileRule()
  const uploadImgRule = useUploadImgRule()
  const uploadImgsRule = useUploadImgsRule()

  /**
   * 构建表单组件
   */
  const buildFormComponents = () => {
    // 移除自带的上传组件规则，使用 uploadFileRule、uploadImgRule、uploadImgsRule 替代
    designer.value?.removeMenuItem('upload')
    // 移除自带的富文本组件规则，使用 editorRule 替代
    designer.value?.removeMenuItem('fcEditor')
    // 移除自带的手写签名，使用 signatureRule 替代 ——
    // 内核那个的值是 canvas 直出的 base64（单张 20–100KB）且未接文件存储，
    // 映射到 varchar 列直接写失败、映射到 TEXT 则拖慢列表查询与导出。
    // 契约里它已标 supported=false，hiddenItem 也会隐藏它，这里再显式移除一次：
    // 两条路径的判据不同（一个按契约、一个按菜单名），任一条失效都不该让它重新可拖
    designer.value?.removeMenuItem('signaturePad')
    const iframeRule = useIframeRule()
    const areaSelectRule = useAreaSelectRule()
    const components = [
      editorRule,
      uploadFileRule,
      uploadImgRule,
      uploadImgsRule,
      iframeRule,
      areaSelectRule,
      useFormulaRule(),
      useRemotePickerRule(),
      useRelationFormRule(),
      useLinkRule(),
      useCodeImageRule(),
      useSignatureRule()
    ]
    components.forEach((component) => {
      // 插入组件规则
      designer.value?.addComponent(component)
      // 插入拖拽按钮到 `main` 分类下
      designer.value?.appendMenuItem('main', {
        icon: component.icon,
        name: component.name,
        label: component.label
      })
    })

    // 步骤条容器。⚠️ 只 addComponent，【不要】再 appendMenuItem ——
    // 它的菜单项上带了 `menu: 'layout'`，addComponent 会据此自己放进布局分类。
    // 再手动追加一次的结果是左侧面板里出现两个「步骤条」，是 e2e 抓到的。
    // 上面那批组件需要显式 appendMenuItem，是因为它们的菜单项没有 menu 字段。
    //
    // 子节点 FormStep 同样只 addComponent：它 `inside: true`，只能拖进容器内部；
    // 进了面板用户就能拖出一个没有容器的孤儿步骤
    designer.value?.addComponent(useFormStepsRule())
    designer.value?.addComponent(useFormStepRule())
  }

  // UserSelect 与 DeptSelect 已在 B4 删除，由 OrgPicker 替代 ——
  // 勾选「可选主体类型」即可限定成只选用户或只选部门。
  // 契约里保留了它们的条目并标为不支持，作为发布校验的第二道防线
  const dictSelectRule = useDictSelectRule()
  // 传入 designer：内联规则的「取字段」下拉要从设计器里实时读当前表单已有的字段
  const billFieldRule = useBillFieldRule(designer)
  // ApiSelect 已在 B3 删除，由 RemotePicker（下拉形态 + 数据接口数据源）替代。
  // 契约里保留了它的条目并标为不支持，作为发布校验的第二道防线 ——
  // 万一有历史表单还留着这个控件，发布时会明确报错而不是运行时静默失效

  /**
   * 构建系统字段菜单
   */
  const buildSystemMenu = () => {
    // 移除自带的下拉选择器组件，使用 currencySelectRule 替代
    // designer.value?.removeMenuItem('select')
    // designer.value?.removeMenuItem('radio')
    // designer.value?.removeMenuItem('checkbox')
    const components = [
      dictSelectRule,
      billFieldRule,
      useOrgPickerRule(),
      useSystemValueRule()
    ]
    const menu: Menu = {
      name: 'system',
      title: '系统字段',
      list: components.map((component) => {
        // 插入组件规则
        designer.value?.addComponent(component)
        // 插入拖拽按钮到 `system` 分类下
        return {
          icon: component.icon,
          name: component.name,
          label: component.label
        }
      })
    }
    designer.value?.addMenu(menu)
  }

  /**
   * 修复重复的字段 ID
   *
   * 实现见 designer/useFieldDeduplication.ts。改造前这段逻辑写在本文件里，
   * 有两个问题：只遍历顶层规则（递归层里的重复检测不到，而复制容器恰好是最常见的情形），
   * 以及用 deep watch 侦听整棵规则树（大表单上每次属性微调都触发全树遍历）。
   */
  useFieldDeduplication(designer)

  onMounted(async () => {
    await nextTick()
    buildFormComponents()
    buildSystemMenu()
    // 内核的密码输入 / 日期区间 / 时间区间三个菜单产出的规则类型与契约对不上，
    // 在这里对齐。见 designer/useContractWidgetTypes.ts —— 不对齐的后果不是少个渲染器，
    // 而是日期区间的数组值被按标量往日期列里写
    alignContractWidgetTypes(designer)
    // 把内置选项类控件的「选项来源」改造成 静态数据 / 数据字典 / 数据接口 三选一
    buildOptionSource()
    // 给输入类控件加上「格式校验」属性（内置正则库 + 自定义正则）
    buildValidateRule()
    // 千分位、金额大写、相对日期默认值
    buildInputEnhance()
    // 子表的「合计行」配置
    buildSubTableRule()
    // 分组标题的「可折叠」
    buildTitleRule()
    // 标签页容器的「分步校验」
    buildTabsRule()
  })
}
