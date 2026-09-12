/**
 * 把内置选项类控件的「选项来源」改造成三选一互斥
 *
 * <h3>改造目标</h3>
 * 下拉框、单选框、多选框、级联选择、树形选择、树形控件这六个控件，属性面板上的
 * 「选项来源」原本只有两项（静态数据 / 远程数据），远程分支是让用户填 URL + 写解析函数。
 * 现在变成三项，且互斥：
 *
 *     选项来源  [ 静态数据 ] [ 数据字典 ] [ 数据接口 ]
 *
 * - 静态数据：原样用设计器内置的选项编辑器
 * - 数据字典：DictSourceConfig，选项来自系统字典
 * - 数据接口：DataInterfaceConfig，直接选数据接口模块里的一条接口，不再填 URL
 *
 * <h3>为什么是「拦截改写」而不是「复刻」</h3>
 * setComponentRuleConfig 的第二参可以是函数，签名 (activeRule, ctx) => rule[]，
 * 而内置属性规则函数本身就挂在 activeRule._menu.props 上 —— 可以先调用它拿到原始规则树，
 * 再就地往里注入第三个分支。
 *
 * 这样全程不需要硬编码 `formCreateEffect>fetch`、`'formCreate' + upper(to)` 这类
 * 内核内部的字段名拼装约定，设计器升级也不容易碎。找不到注入锚点时会降级并告警，
 * 而不是产出一个坏掉的属性面板。
 */
import { Ref, onBeforeUnmount, watch } from 'vue'
import {
  OPTION_SOURCE_TARGETS,
  OPTION_SOURCE_TYPE,
  STATIC_OPTIONS_STASH,
  applyDictSourceToRule,
  collectRemoteOptionTasks,
  detectOptionSourceType,
  readOptionPath,
  resolveRemoteOptionTask,
  writeOptionPath,
  type OptionSourceTarget
} from '@/components/FormCreate/src/utils/optionSource'
import { collectFormFieldOptions } from '@/components/FormCreate/src/utils'
import { buildScenePropRule } from '@/components/FormWidgets/renderScene'

/** 六个内置控件的菜单名。elTreeSelect 是「树形选择」，tree 是「树形控件」 */
const OPTION_SOURCE_MENUS = Object.keys(OPTION_SOURCE_TARGETS)

/** 在规则树里找出「选项来源」那个单选组节点 */
const findOptionTypeNode = (rules: any[]): any | undefined => {
  for (const rule of rules) {
    if (!rule || typeof rule !== 'object') {
      continue
    }
    if (rule.field === '_optionType') {
      return rule
    }
    const hit =
      (Array.isArray(rule.children) && findOptionTypeNode(rule.children)) ||
      (Array.isArray(rule.rule) && findOptionTypeNode(rule.rule))
    if (hit) {
      return hit
    }
  }
  return undefined
}

export const useOptionSource = (designer: Ref) => {
  /**
   * 静态选项的镜像
   *
   * 三种来源共用同一个选项路径（options / props.options / props.data）。切到字典或接口时，
   * form-create 会把「静态选项编辑器」这条规则从属性表单里摘掉，**连带把绑定的
   * rule.options 整个删掉**，而且这一步发生在选项来源的 change 回调之前 ——
   * 也就是说在回调里再去读选项路径，读到的已经是 undefined，来不及暂存。
   *
   * 所以改成持续镜像：属性面板一建立就开始盯选项路径，只要当前来源是静态数据且路径上
   * 有内容，就同步进 rule._staticOptions。用户在面板里改选项也会被跟上，
   * 不会像「切换那一刻才快照」那样丢掉最近的编辑。
   */
  let stopStaticMirror: (() => void) | undefined
  /** 停止「把配好的数据源解析成选项」的监听 */
  let stopSourceResolve: (() => void) | undefined
  /** 当前选中的来源。change 里更新，镜像逻辑据此判断路径上的内容能不能当静态选项 */
  let currentSourceType = OPTION_SOURCE_TYPE.STATIC

  const mirrorStaticOptions = (activeRule: any, target: OptionSourceTarget) => {
    stopStaticMirror?.()
    currentSourceType = detectOptionSourceType(activeRule)
    stopStaticMirror = watch(
      () => readOptionPath(activeRule, target.path),
      (value) => {
        if (currentSourceType !== OPTION_SOURCE_TYPE.STATIC) {
          return
        }
        if (Array.isArray(value) && value.length) {
          activeRule[STATIC_OPTIONS_STASH] = JSON.parse(JSON.stringify(value))
        }
      },
      { immediate: true, deep: true }
    )
  }

  /**
   * 配好字典/接口后，把选项解析进「活规则」
   *
   * 设计器的画布和预览都读活规则（预览走 getJson → getRule，是活规则的深拷贝），
   * 而字典/接口来源在规则里只是一份声明。不在这里解析的话，用户配完只能看到一个空下拉，
   * 根本没法验证配置对不对 —— 静态数据之所以「有数据」，是因为它的选项本来就在规则里。
   *
   * 写进去的选项在保存时会被 stripResolvedOptions 剥掉，不会进表单 JSON；
   * 运行时由 decodeFieldsAsync 按声明重新解析，拿的始终是最新数据。
   */
  const resolveIntoActiveRule = (activeRule: any) => {
    stopSourceResolve?.()
    stopSourceResolve = watch(
      () => [activeRule.props?.dictSource, activeRule.props?.dataSource],
      () => {
        // 字典走前端全量缓存，同步就能出结果
        if (activeRule.props?.dictSource?.dictType) {
          applyDictSourceToRule(activeRule)
          return
        }
        // 接口要发请求，各控件独立解析，失败只影响自己
        const tasks = collectRemoteOptionTasks([activeRule])
        tasks.forEach((task) => {
          resolveRemoteOptionTask(task).catch(() => undefined)
        })
      },
      { immediate: true, deep: true }
    )
  }

  // 属性面板的规则是设计器在组件作用域外构建的，watch 不会被自动回收，
  // 这里跟着设计器所在组件一起收尾
  onBeforeUnmount(() => {
    stopStaticMirror?.()
    stopStaticMirror = undefined
    stopSourceResolve?.()
    stopSourceResolve = undefined
  })

  /**
   * 切换选项来源时清理另外两种的残留
   *
   * 不清理的话三种配置会同时存在于表单 JSON 里，最终生效的是哪个只能靠代码里的隐式
   * 优先级，跨版本行为不稳定；控件默认值也会残留成不匹配的类型（多选控件留个 ''）。
   */
  const clearOtherSources = (activeRule: any, nextType: number, target: OptionSourceTarget) => {
    if (!activeRule) {
      return
    }
    currentSourceType = nextType
    activeRule.props = activeRule.props || {}

    if (nextType !== OPTION_SOURCE_TYPE.DICT) {
      delete activeRule.props.dictSource
    }
    if (nextType !== OPTION_SOURCE_TYPE.REMOTE) {
      delete activeRule.props.dataSource
      // 内置远程分支写在 effect.fetch 上，换成别的来源后必须清掉，
      // 否则内核仍会按它发请求，把我们填的选项覆盖掉
      if (activeRule.effect) {
        activeRule.effect.fetch = ''
      }
    }

    if (nextType === OPTION_SOURCE_TYPE.STATIC) {
      // 回到静态数据：把镜像里的选项还回来。
      // 没有镜像（比如打开的是一张存好的、原本就配了字典的表单）就置空 ——
      // 路径上那批是字典/接口解析出来的，不能当成用户的静态选项留着
      const mirrored = activeRule[STATIC_OPTIONS_STASH]
      writeOptionPath(activeRule, target.path, Array.isArray(mirrored) ? mirrored : [])
    } else {
      // 清掉选项路径，避免运行时取数前先闪一批与数据源无关的选项
      writeOptionPath(activeRule, target.path, [])
    }

    // 默认值必须跟着重置：多选类留标量、单选类留数组都会让运行时报类型错
    const multiple = activeRule.props?.multiple || activeRule.type === 'checkbox'
    activeRule.value = multiple ? [] : ''
  }

  /** 往「选项来源」单选组里注入「数据字典」，并把「远程数据」换成数据接口 */
  const injectOptionSource = (rules: any[], activeRule: any, target: any) => {
    const node = findOptionTypeNode(rules)
    if (!node || !Array.isArray(node.options) || !Array.isArray(node.control)) {
      // 内核可能改了选项来源的实现，此时不硬撑：把两个配置项追加到面板末尾保底，
      // 功能仍可用，只是不互斥。开发环境给出明确告警便于及时跟进。
      if (import.meta.env.DEV) {
        console.warn(
          '[OptionSource] 未能在属性面板中找到「选项来源」(_optionType)，已降级为追加模式。' +
            '请检查 @form-create/designer 版本是否变更了该实现。'
        )
      }
      rules.push(dictRule(target), interfaceRule(target, activeRule))
      return
    }

    // 顺序调整为 静态 / 字典 / 接口，枚举值沿用内核原义（静态=2、远程=1），
    // 这样存量表单不需要做值映射
    const staticOption = node.options.find((o: any) => o.value === OPTION_SOURCE_TYPE.STATIC)
    const remoteOption = node.options.find((o: any) => o.value === OPTION_SOURCE_TYPE.REMOTE)
    if (staticOption) {
      staticOption.label = '静态数据'
    }
    if (remoteOption) {
      remoteOption.label = '数据接口'
    }
    node.options = [
      staticOption,
      { label: '数据字典', value: OPTION_SOURCE_TYPE.DICT },
      remoteOption
    ].filter(Boolean)

    // 把远程分支里的内置 FetchConfig（填 URL + 写解析函数）换成数据接口选择器
    const remoteBranch = node.control.find((c: any) => c.value === OPTION_SOURCE_TYPE.REMOTE)
    if (remoteBranch) {
      remoteBranch.rule = [interfaceRule(target, activeRule)]
    }
    node.control.push({
      value: OPTION_SOURCE_TYPE.DICT,
      rule: [dictRule(target)]
    })

    // 内核的 _optionType 恒取默认值 2，没有任何按已存规则反推的逻辑。
    // 不补这一步，配了字典/接口的控件重开属性面板会显示「静态数据」。
    node.value = detectOptionSourceType(activeRule)

    node.on = {
      ...(node.on || {}),
      change: (value: any) => clearOtherSources(activeRule, Number(value), target)
    }
  }

  const dictRule = (target: any) => ({
    type: 'DictSourceConfig',
    // formCreateProps>dictSource 会被设计器写到 rule.props.dictSource
    field: 'formCreateProps>dictSource',
    props: { treeMode: target.tree }
  })

  const interfaceRule = (target: any, activeRule: any) => ({
    type: 'DataInterfaceConfig',
    field: 'formCreateProps>dataSource',
    props: {
      treeMode: target.tree,
      // 参数绑定的「表单字段」候选要在打开属性面板时实时从设计器取，
      // 排除自身避免用户把该控件自己选成自己的取数参数
      formFields: collectFormFieldOptions(designer, activeRule?.field)
    }
  })

  /** 给六个内置控件装上三选一的选项来源 */
  const buildOptionSource = () => {
    OPTION_SOURCE_MENUS.forEach((name) => {
      const target = OPTION_SOURCE_TARGETS[name]
      designer.value?.setComponentRuleConfig(
        name,
        (activeRule: any, ctx: any) => {
          // 先原样拿到内置属性规则，一行不改
          const builtin = activeRule?._menu?.props?.(activeRule, ctx)
          if (!Array.isArray(builtin)) {
            // 拿不到内置规则说明内核结构变了，只给我们自己的两项，保证面板不白屏
            if (import.meta.env.DEV) {
              console.warn(`[OptionSource] 控件[${name}]的内置属性规则不可用`)
            }
            return [dictRule(target), interfaceRule(target, activeRule), buildScenePropRule()]
          }
          injectOptionSource(builtin, activeRule, target)
          // 属性面板每次重建都重挂这两个监听，盯的是当前选中的这条规则
          mirrorStaticOptions(activeRule, target)
          resolveIntoActiveRule(activeRule)
          // 「出现场景」也在这里拼进去。
          // ⚠️ 不能另起一次 setComponentRuleConfig —— 同一个控件注册两次，
          // 后一次会把这里的选项来源改造整个覆盖掉，而且不报错
          return [...builtin, buildScenePropRule()]
        },
        // 内置规则已经被我们包含进去了，不要再 append
        false
      )
    })
  }

  return { buildOptionSource }
}
