import request from '@/config/axios'

/**
 * 机构自定义扩展字段（I29）
 *
 * 与后端 {@code QlzgFieldDefController / QlzgFieldDefRespVO / QlzgFieldDefSaveReqVO} 对应。
 *
 * <h3>🔴 这个 API 对象里【没有】删除</h3>
 * 后端的 {@code DELETE /qlzg/field-def/delete} **一律**抛 {@code FIELD_DEF_DELETE_FORBIDDEN}
 * （§11.20.5：30 年档案里的报告可能引用了这个字段，留痕只能读、不能改）。
 * 那个端点存在的唯一理由是「给一句能读懂的回答，而不是一个 404」。
 * 前端照着它包一个 {@code deleteFieldDef()} 出来，就等于在 API 层留了一把
 * **按下去必定失败**的枪 —— 而下一个人看到它会以为「删除是支持的，只是这里没接」。
 * 所以这里连函数都不建。字段管理页同理，**不渲染删除按钮**。
 *
 * <h3>🔴 {@code options} 是「选项 + 控件 props」的一个打包对象，不是一个数组</h3>
 * 库里那一列叫 {@code options_json}，装的是**与控件无关**的
 * {@code { options: [{label, value, children?}], props: {…} }}。
 *
 * 🔴「这一份选项该塞进 rule 的哪个键」是**渲染**的事，**不存进库里**：
 * {@code select} / {@code radio} / {@code checkbox} 塞根上的 {@code options}，
 * {@code cascader} 塞 {@code props.options}，{@code elTreeSelect} / {@code tree} 塞
 * {@code props.data}（而 {@code tree} 的 {@code valueKey} 还是 {@code id} 不是 {@code value}）。
 * 那张表在 {@code FormCreate/src/utils/optionTargets.ts} 的 {@code OPTION_SOURCE_TARGETS} 里，
 * 由 {@code extFieldRule.ts} 的构造器去读。存「容器原样」会逼着字段管理页的选项编辑器
 * **也**认这张表，于是同一份判据住在两个地方 —— 而它漂的方向是静默的：
 * 一边写在 {@code props.options}、另一边从 {@code options} 读，界面上就是
 * 「配了 5 个选项、表单上一个都不显示」，且没有任何报错。
 *
 * ⚠️ 后端 {@code QlzgFieldOptions#tableOf} 从解析出来的**根**一路递归找 {@code value} 键，
 *    所以两种嵌套它都读得出来；但正规形状仍然是上面那一个，别指望这层兜底。
 */

/** 一个可选项。🔴 {@code children} 是给级联 / 树用的，本页只能编出**一层**，见 FieldDefForm */
export interface QlzgFieldOption {
  label: string
  value: string
  children?: QlzgFieldOption[]
}

/**
 * 控件的选项与 props
 *
 * 🔴 两个键都可以缺省：文本 / 数字 / 日期这一批控件本来就没有选项，
 *    {@code props} 也常常是空的。缺省时**不要**发一个 {@code {}} 上来充数 ——
 *    后端 {@code toJsonOrNull} 把 {@code null} 与空对象一律写成 SQL NULL，
 *    语义上等价，但界面上「这个字段配过东西吗」会变得含糊。
 */
export interface QlzgFieldOptions {
  /** 静态选项清单，选项类控件才有 */
  options?: QlzgFieldOption[]
  /** 控件自身的 props，键名取自控件契约的 {@code props[].name} */
  props?: Record<string, any>
}

/**
 * 服务端跨字段校验规则，形状是后端 {@code CrossFieldRule}
 *
 * 🔴 **本页没有它的编辑器**（I29-e 的取舍，见 {@code FieldDefForm.vue} 的类注释），
 *    所以这个类型只用于**原样回传**：编辑一个已经有规则的字段时，
 *    把它读出来、不改、再发回去。丢了它的表现是「保存成功、规则没了」，
 *    而后端对 {@code validateRule == null} 的处置正是**清空**（{@code toJsonOrNull}）。
 */
export interface QlzgFieldValidateRule {
  when?: Record<string, any>
  must?: Record<string, any>
  message?: string
}

/** 宿主实体类型，与后端 {@code QlzgEntityTypeEnum#getType()} 逐字一致 */
export type QlzgEntityType =
  | 'QLZG_PROJECT'
  | 'QLZG_SUBJECT'
  | 'QLZG_CLIENT'
  | 'QLZG_MATERIAL'
  | 'QLZG_REPORT'

/** 渲染场景，与后端 {@code QlzgFieldSceneEnum} 逐字一致 */
export type QlzgFieldScene = 'FORM' | 'DETAIL' | 'BOTH'

export interface QlzgFieldDefVO {
  id: number
  entityType: QlzgEntityType
  /** 🔴 创建后不可改；改了等于让历史 ext_json 里的这个 key 变成孤儿 */
  fieldKey: string
  fieldLabel: string
  widgetType: string
  /** 控件的显示名，后端从契约里取好了 —— 前端不必为了显示一个名字去查契约 */
  widgetLabel?: string
  required: boolean
  options?: QlzgFieldOptions | null
  validateRule?: QlzgFieldValidateRule | null
  sort: number
  scene: QlzgFieldScene
  exportable: boolean
  /** 🔴 false **不代表可以删**：详情页仍显示历史值并标注（已停用字段），导出也仍带这一列 */
  enabled: boolean
  /** 平台预置行（tenant_id = 0）。true 时整行只读 */
  platform: boolean
  createTime?: Date
}

export interface QlzgFieldDefSaveVO {
  id?: number
  entityType: QlzgEntityType
  fieldKey: string
  fieldLabel: string
  widgetType: string
  required?: boolean
  options?: QlzgFieldOptions | null
  /** 🔴 见 {@link QlzgFieldValidateRule}：没有编辑器，但必须原样回传 */
  validateRule?: QlzgFieldValidateRule | null
  sort?: number
  scene?: QlzgFieldScene
  exportable?: boolean
  enabled?: boolean
}

export interface QlzgExportConfigVO {
  /** 一次最多导出多少条 */
  maxExportRows: number
}

export const QlzgFieldDefApi = {
  /**
   * 按宿主取字段定义清单
   *
   * 🔴 **含停用的行**（后端不按 enabled 过滤）：详情页要显示停用字段的历史值。
   *    渲染表单的调用方自己按 {@code enabled} 过滤 —— 这件事由
   *    {@code extFieldRule.ts} 的 {@code formFieldsOf} 做，不要在页面里各写一次。
   *
   * @param scene 传 {@code undefined} = 不按场景过滤（字段管理页就是这么用的）
   */
  getList: (entityType: QlzgEntityType, scene?: QlzgFieldScene): Promise<QlzgFieldDefVO[]> =>
    request.get({ url: '/qlzg/field-def/list', params: { entityType, scene } }),

  /** 单条详情。🔴 要 {@code qlzg:field-def:query}，与 {@link getList} 的「只要登录」不同 */
  get: (id: number): Promise<QlzgFieldDefVO> =>
    request.get({ url: '/qlzg/field-def/get', params: { id } }),

  create: (data: QlzgFieldDefSaveVO): Promise<number> =>
    request.post({ url: '/qlzg/field-def/create', data }),

  /**
   * 更新
   *
   * 🔴 后端会拒三件事，前端要**在界面上先把它们做成不可操作**，而不是等报错：
   *    改 {@code entityType}（{@code FIELD_DEF_ENTITY_TYPE_IMMUTABLE}）、
   *    改 {@code fieldKey}（{@code FIELD_DEF_KEY_IMMUTABLE}）、
   *    跨族改 {@code widgetType}（{@code FIELD_DEF_WIDGET_INCOMPATIBLE}）。
   *    前两个是「灰掉 + tooltip」，第三个是「下拉里只列同族的」。
   *    隐藏会被理解成「这功能坏了」（§11.20.5 的 UI 纪律），所以一律灰掉。
   */
  update: (data: QlzgFieldDefSaveVO): Promise<boolean> =>
    request.put({ url: '/qlzg/field-def/update', data }),

  /**
   * 启用 / 停用
   *
   * 🔴 停用一个**正被兄弟字段的校验规则引用着**的字段会被拒
   *    （{@code FIELD_DEF_DISABLE_REFERENCED}）。那句报错会说清是被谁引用的，
   *    所以前端不必预先查一遍 —— 预查要把全部字段的 validateRule 都摊开比对，
   *    而那份比对逻辑与后端 {@code collectRuleReferences} 会漂。
   */
  updateEnabled: (id: number, enabled: boolean): Promise<boolean> =>
    request.put({ url: '/qlzg/field-def/update-enabled', params: { id, enabled } }),

  /**
   * 获得导出的限制
   *
   * 导出弹窗要在用户点「导出」**之前**就把上限说清楚，而上限是服务端常量。
   * 前端写死一个 2 万的话，后端哪天调了之后界面上那个数就成了假的 ——
   * 而用户会照着它规划自己的分批，比根本不提示更糟。
   *
   * 🔴 这个接口与 {@link getList} 一样**只要登录**、不要任何 qlzg 权限串：
   *    它服务的是四个不同权限族的导出按钮，挂在其中一族上，另外三族的角色都会看到
   *    一句与本页无关的「无权限」。
   */
  getExportConfig: (): Promise<QlzgExportConfigVO> =>
    request.get({ url: '/qlzg/field-def/export-config' })
}

/**
 * 旧名字的别名
 *
 * ⚠️ 只为 {@code LedgerExportForm.vue} 那一处 import 留着。它读的是「导出上限」，
 *    与字段定义是两件事，但接口挂在同一个 Controller 下（后端也只有这一个位置能拿到那个常量）。
 */
export const getExportConfig = QlzgFieldDefApi.getExportConfig
