/**
 * 表单设计器配置工厂
 *
 * 改造前 `views/infra/formDesign` 与 `views/bpm/form/editor` 各自维护一份近乎相同的
 * designerConfig（30 多个字段），已经出现漂移 —— 例如 showAi 一边关一边开。
 * 两份配置里任何一项的默认值分歧，都会表现为「同一个控件在两个入口行为不一样」，
 * 而这种差异不会报错，只能靠人发现。
 *
 * 现在统一到这里：共同基线 + 按场景的少量覆盖。新增配置项只改一处。
 */
import { listUnsupportedWidgetTypes } from '@/components/FormWidgets/contracts'

/** 设计器使用场景 */
export type DesignerScene =
  /** 低代码表单设计（infra/formDesign）。字段要绑物理列，因此有自定义的基础属性规则 */
  | 'formDesign'
  /** 流程表单设计（bpm/form）。字段不落物理表，由流程变量承载 */
  | 'bpmForm'

/** 配置工厂的可选参数 */
export interface DesignerConfigOptions {
  /**
   * 自定义「基础属性」面板规则
   *
   * formDesign 场景用它把「字段ID」从自由输入换成物理列下拉。
   * 注意传函数而不是直接传值：调用方通常在 setup 顶部就构造配置，
   * 那时它依赖的函数可能还在暂时性死区里。
   */
  baseRule?: (arg: any) => any
  /**
   * 打开「逻辑与扩展」弹窗
   *
   * 传了才会在表单配置面板里追加入口按钮。联动规则 / 跨字段校验 / 扩展方式
   * 这三项原先是向导里的独立一步，配的时候看不到自己刚设计的表单；
   * 改成从设计器里开弹窗后上下文不丢，向导也少一步。
   */
  onOpenLogic?: () => void
  /**
   * 取「逻辑与扩展」当前的问题清单，用于入口按钮上的角标
   *
   * 传 getter 而不是值：属性面板的规则只在面板建立时构造一次，
   * 传值的话之后字段变了角标不会更新。
   */
  getLogicProblems?: () => string[]
}

/**
 * 构造表单设计器配置
 *
 * @param scene   使用场景
 * @param options 场景内的额外定制
 */
export const createDesignerConfig = (scene: DesignerScene, options: DesignerConfigOptions = {}) => {
  const config: Record<string, any> = {
    // ==================== 拖拽与画布 ====================
    switchType: [], // 是否可以切换组件类型，或者可以相互切换的字段
    autoActive: true, // 是否自动选中拖入的组件
    useTemplate: false, // 是否生成 vue2 语法的模板组件
    formOptions: {
      form: {
        labelWidth: '100px' // 默认 label 宽度
      }
    },
    fieldReadonly: false, // field 是否可编辑
    hiddenDragMenu: false, // 隐藏拖拽操作按钮
    hiddenDragBtn: false, // 隐藏拖拽按钮

    // ==================== 菜单与控件可见性 ====================
    hiddenMenu: [], // 隐藏部分菜单
    /**
     * 隐藏本模块不支持的控件
     *
     * 取自控件契约，不手写清单。这一项是实打实在防一个静默丢数据的缺陷：
     * 内核的「表格表单」(tableForm) 和子表控件一样是 array 值控件，但本模块的
     * 子表绑定只认 group。改造前它在菜单里可拖、发布也不报错，用户填完明细提交、
     * 接口返回成功，数据却一行都没进库。「分组」(subForm) 是 object 值的嵌套表单，
     * 本模块的字段映射按扁平 field 组织，同样存不进去。
     *
     * 后端发布校验是第二道防线（FormDesignPublishValidator#validateWidgetsSupported），
     * 两处都要有：这里负责不让用户拖进来，那里负责在本配置漂移或历史表单已含此类控件时兜住。
     */
    hiddenItem: listUnsupportedWidgetTypes(),
    hiddenItemConfig: {}, // 隐藏组件的部分配置项
    disabledItemConfig: {}, // 禁用组件的部分配置项

    // ==================== 右侧配置面板 ====================
    showSaveBtn: false, // 设计器自带的保存按钮。两个场景都用页面自己的保存流程
    showConfig: true, // 右侧配置界面
    showBaseForm: true, // 组件基础配置
    showControl: true, // 组件联动
    showPropsForm: true, // 组件属性配置
    showEventForm: true, // 组件事件配置
    showValidateForm: true, // 组件校验配置
    showFormConfig: true, // 表单配置
    showInputData: true, // 录入按钮
    showDevice: true, // 多端适配选项

    appendConfigData: [] // 渲染规则所需的 formData
  }

  if (scene === 'formDesign') {
    // AI 生成字段不在低代码表单模块范围内。
    // bpm 场景保留内核默认值（开启），两者的差异是有意的，不是漂移
    config.showAi = false

    /**
     * 去掉最左边那条 40px 的图标切换栏（组件列表 / 国际化配置 / JSON）
     *
     * 关掉它之后：
     * - 组件列表面板**照常显示** —— 设计器的 `activeModule` 默认就是 `'base'`，
     *   不靠这条栏来激活，拖控件的主流程不受影响
     * - 国际化配置与 JSON 预览两个面板随之**不可达**。前者本模块是纯中文、用不上；
     *   后者是开发期调试视图，不该暴露给配表单的人
     * - 左栏的收起/展开不受影响：展开按钮 `._fc-l-open` 是独立元素，
     *   不挂在这条栏上，收起后仍能点回来
     *
     * 三个开关里只关这一个就够：栏没了，`showLanguage` / `showJsonPreview`
     * 控制的入口本来就没地方显示，再关是多余的。
     *
     * bpm 场景保留内核默认值（显示），与 showAi 一样属于有意的场景差异。
     */
    config.showMenuBar = false
  }

  if (options.baseRule) {
    // 包一层而不是直接引用：见 DesignerConfigOptions.baseRule 的说明
    config.baseRule = (arg: any) => options.baseRule!(arg)
  }

  if (options.onOpenLogic) {
    /**
     * 往「表单配置」面板末尾追加「逻辑与扩展」入口
     *
     * 用 `{ rule, append }` 而不是直接给个函数：给函数是**整体替换**，
     * 内核那十来项表单级配置（标签位置、尺寸、提交按钮…）会一并消失。
     * append 语义是「原有的 + 我加的」，升级时内核增减配置项也能跟上。
     *
     * 这条规则**不带 field** —— 它是个动作按钮，不是配置项，
     * 带 field 会让它往表单 option 里写一个无意义的值。
     */
    config.formRule = {
      append: true,
      rule: () => [
        {
          type: 'LogicEntryButton',
          props: {
            onOpen: options.onOpenLogic,
            getProblems: options.getLogicProblems
          }
        }
      ]
    }
  }

  return config
}
