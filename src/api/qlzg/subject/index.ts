import request from '@/config/axios'
import { exportExcelWithMeta } from '@/utils/exportExcel'

/**
 * 评估标的（I1）
 *
 * 与后端 {@code QlzgSubjectController / QlzgSubjectSaveReqVO / QlzgSubjectRespVO} 一一对应。
 *
 * 🔴 **没有 subjectType 字段可写**：标的类型由项目品类的 `subjectType` 决定
 *    （住宅抵押 → REAL_ESTATE），前端传了也会被忽略。所以创建标的的表单里
 *    不要放「标的类型」下拉 —— 放了用户就会去调它，而调不动，那是最坏的一种界面。
 *
 * 🔴 **所属项目不可改**。要挪到别的项目只能删了重建，因为标的属性是按品类的
 *    param_schema 校验的，换项目等于换品类，已填的 attrs 可能整个不合法。
 *
 * 🔴 `attrs` 是**三态**：`null` = 不改动、`{}` = 清空、非空对象 = 覆盖。
 *    编辑表单必须显式区分「用户没碰这块」与「用户把值都删了」，
 *    否则一次只想改名字的保存会把属性全清掉 —— 而它不报错。
 */

/** 权属证明文件的**展示**视图 */
export interface QlzgOwnershipFile {
  fileId: number
  /** 🔴 missing=true 时为 null */
  fileName?: string | null
  /** 字节数；🔴 missing=true 时为 null */
  fileSize?: number | null
  /**
   * 🔴 true = infra_file 里查不到（已删除或不属于本机构）
   *
   * 这一项**必须渲染出来**（显示成「已失效的文件（4242）」这类占位），
   * 不能 filter 掉：R25 要求权属证明可追溯，少显示一项会让用户以为「材料齐了」，
   * 而实际那一行指向的文件已经没了。
   */
  missing: boolean
}

/** 标的属性的**展示**视图 —— 服务端渲染好的，不要拿 attrs 自己拼 */
export interface QlzgAttrView {
  /** 属性 key，如 usable_area_ratio */
  key: string
  /** 显示名；schema 里已无此项时退回 key 本身 */
  label: string
  /**
   * 值类型，见 QlzgParamTypeEnum
   *
   * 🔴 schema 里已无此项时为 **null** —— 此时界面应标一句「品类已不再定义此属性」，
   *    而不是静默按文本渲染：那一行值是历史数据，改不动也算不进测算。
   */
  type?: string | null
  /** 单位（如 %） */
  unit?: string | null
  /**
   * 服务端渲染好的展示文本（如 `75%`）
   *
   * 🔴 **只有 valueText，没有 value** —— 原始值在 `attrs` 里，供编辑表单回填。
   *    展示一律用 valueText，别在前端重算一遍百分比换算（口径会与后端分叉）。
   */
  valueText: string
}

/** 评估标的（读形态） */
export interface QlzgSubjectVO {
  id: number
  projectId: number
  /** 所属项目编号（展示用，服务端解析） */
  projectNo?: string
  /** 所属项目名称（展示用，服务端解析） */
  projectName?: string
  subjectName: string
  /** 标的类型，见 QlzgSubjectTypeEnum */
  subjectType?: string
  /** 标的类型中文名，服务端解析 —— 展示用它，不要在前端再映射一份 */
  subjectTypeDescription?: string
  /** 🔴 原始值，**只供编辑表单回填**，不要直接展示 */
  attrs?: Record<string, any>
  /** 🔴 展示视图，顺序按品类 schema（孤儿键排最后） */
  attrViews?: QlzgAttrView[]
  /** → R25；给编辑表单回填 */
  ownershipFileIds?: number[]
  /** 🔴 展示视图；顺序跟 ownershipFileIds；取不到的文件仍占位（missing=true） */
  ownershipFiles?: QlzgOwnershipFile[]
  bookValue?: number
  /** 一项目多标的时的顺序，留空按 0 */
  sort?: number
  /**
   * 机构自定义扩展字段的值（I29），键 = {@code qlzg_field_def.field_key}
   *
   * ⚠️ 与 {@link QlzgSubjectSaveVO#attrs} 是**两套东西**，别混：attrs 的键集合来自
   *    品类 {@code param_schema}（{@code scope=SUBJECT_ATTR}，随品类变），ext 的键集合来自
   *    {@code qlzg_field_def}（{@code entityType=QLZG_SUBJECT}，随机构变）。
   *    两者各自独立校验、各自整列覆盖，同一个键名出现在两边也互不影响。
   * 🔴 「一个值都没存过」读出来是 **{@code {}}，不是 {@code null}**，
   *    所以 {@code subject.ext ?? null} 拿到的是 {@code {}}。完整口径见 {@code QlzgProjectVO.ext}。
   */
  ext?: Record<string, any> | null
  createTime?: Date
}

export interface QlzgSubjectPageReqVO extends PageParam {
  projectId?: number
  /** 标的名称，模糊匹配 */
  subjectName?: string
  subjectType?: string
  createTime?: string[]
}

/**
 * 评估标的（写形态）
 *
 * ⚠️ 分页接口**不支持按属性筛选**（attrs 是 JSON 列，跨品类的键集合还不一样），
 *    所以搜索表单里不要放「建筑面积 > 100」这类框。
 */
export interface QlzgSubjectSaveVO {
  /** 编号，创建时不传 */
  id?: number
  projectId?: number
  subjectName: string
  /** 🔴 null = 不改，{} = 清空；key 集合由品类 param_schema（scope=SUBJECT_ATTR）决定 */
  attrs?: Record<string, any> | null
  /**
   * 权属证明文件 ID 列表 → R25
   *
   * ⚠️ 后端逐个校验「存在且本机构可见」，**不合规时一次性全报** MATERIAL_FILE_NOT_VISIBLE；
   *    数组里的 `null` 元素也会被报出来。所以前端不要往这个数组里塞空位。
   */
  ownershipFileIds?: number[]
  bookValue?: number
  sort?: number
  /**
   * 机构自定义扩展字段的值（I29），三态与 {@link QlzgSubjectSaveVO#attrs} 同形：
   * **不传键 / {@code null} = 不改**，非空对象 = **整列覆盖**（{@code {}} 即清空）。
   *
   * 🔴 但两者是**两列**（{@code attrs_json} / {@code ext_json}），改一个不会带上另一个 ——
   *    所以编辑表单必须把两块都回填、都发回去，只发 attrs 不会误删 ext，反之亦然。
   * 🔴 且 ext 的「整列覆盖」不等于「没发过去的键一律被删」：停用字段、{@code scene} 不覆盖 FORM
   *    的字段、孤儿键这三类由后端 {@code carryOverReadOnly} 从库里现值补回。
   *    {@code attrs} **没有**这一层（它的判据是前端的 {@code attrsSnapshot}）—— 完整理由见
   *    {@code QlzgProjectSaveVO.ext} 与 {@code SubjectForm.vue} 类注释里「ext 与 attrs 是两列」那一段。
   */
  ext?: Record<string, any> | null
}

export const QlzgSubjectApi = {
  /** 标的分页（跨项目台账） */
  getSubjectPage: (params: QlzgSubjectPageReqVO): Promise<PageResult<QlzgSubjectVO[]>> =>
    request.get({ url: '/qlzg/subject/page', params }),

  /**
   * 🔴 项目下的**全部**标的，不分页，按 sort 升序
   *
   * 项目详情页 / 资料面板 / 清单汇编一律用这个，不要用 `/page` 取第一页当全部 ——
   * 那种写法在两三套房子时是对的，多了就错，表现是「报告里少了一套房」，
   * 而少的那一套不会报错，只会在客户拿到报告之后被发现。
   */
  getSubjectListByProject: (projectId: number): Promise<QlzgSubjectVO[]> =>
    request.get({ url: '/qlzg/subject/list-by-project', params: { projectId } }),

  /** 标的详情 */
  getSubject: (id: number): Promise<QlzgSubjectVO> =>
    request.get({ url: '/qlzg/subject/get', params: { id } }),

  /** 创建标的：attrs 按品类 param_schema 校验，并在同一事务里重投影到 qlzg_subject_index */
  createSubject: (data: QlzgSubjectSaveVO): Promise<number> =>
    request.post({ url: '/qlzg/subject/create', data }),

  /** 更新标的：所属项目不可改；项目已作废时抛 PROJECT_VOIDED */
  updateSubject: (data: QlzgSubjectSaveVO): Promise<boolean> =>
    request.put({ url: '/qlzg/subject/update', data }),

  /**
   * 删除标的
   *
   * ⚠️ 名下有资料时抛 SUBJECT_HAS_MATERIAL。资料行是证据，不能随标的一起蒸发；
   *    标的本身是逻辑删除，而 qlzg_subject_index 的投影行是**物理**删除
   *    （投影是派生数据，留着会让测算读到已删标的的属性）。
   */
  deleteSubject: (id: number): Promise<boolean> =>
    request.delete({ url: '/qlzg/subject/delete', params: { id } }),

  /**
   * 导出标的台账
   *
   * 🔴 标的属性（来自品类的 `param_schema`）在导出里摊成**一列**文本，不摊成 N 列：
   *    每一行的属性集合取决于它所属项目的品类，摊成 N 列的话表头会随「这次恰好导到了哪些品类」
   *    而漂移，机构写好的 Excel 公式与数据透视会静默错位。代价是这一列在 Excel 里没法排序筛选 ——
   *    要按属性比对标的走 `qlzg_subject_index` 与复核规则，不是走台账。
   *
   * 🔴 **不走 `request.download`**：那个封装只把 Blob 交出来、响应头拿不到，
   *    而「这次有没有被上限截断」正是走 `X-Export-Truncated` 传的。理由全文在
   *    `@/utils/exportExcel` 的 `exportExcelWithMeta` 上，那里是全仓唯一一份。
   *
   * @param currentPage true-只导当前页 / false-按当前条件导全部（受上限约束）
   */
  exportExcel: (params: any, currentPage: boolean) =>
    exportExcelWithMeta('/qlzg/subject/export-excel', { ...params, currentPage })
}
