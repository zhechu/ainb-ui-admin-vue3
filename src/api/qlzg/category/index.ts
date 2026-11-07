import request from '@/config/axios'

/**
 * 评估品类（I1）
 *
 * 与后端 {@code QlzgCategoryController / QlzgCategoryRespVO / QlzgCategorySimpleRespVO} 一一对应。
 *
 * 🔴 **只读**：品类是机构级基础数据，由种子脚本落库、由实施人员维护，没有 create/update/delete 接口。
 *    前端不要为它画「新增」按钮 —— 后端没有那个入口，点了只会得到一个 404 信封（而本系统所有错误
 *    都是 HTTP 200、真码在 body 的 code 字段里，所以它看起来会像「按钮没反应」）。
 *
 * 🔴 详情接口按 **categoryCode** 取，不是按 id。品类码是跨机构的稳定标识
 *    （`REAL_ESTATE_MORTGAGE_RESIDENTIAL` 这种），id 是每个租户各自的自增值，
 *    拿 id 当外键会让「同一个品类在两个机构里是两行」这件事渗到前端来。
 */

/** 参数 schema 的取值范围，只对 DECIMAL / INT 有意义 */
export interface QlzgParamRange {
  min?: number
  max?: number
}

/**
 * 品类参数 schema 的一项
 *
 * 🔴 一个品类下混着**三类**条目，靠 `scope` 分派，**不要靠 key 前缀猜**：
 *    `SUBJECT_ATTR` 标的属性（I1 的标的表单就用这一类）、`PARAM` 测算参数（I3）、
 *    `REPORT_FIELD` 报告字段（I4）。后端刻意不按 scope 过滤后返回，
 *    因为「这个品类一共定义了哪些东西」本身就是一份要整体展示的事实。
 *
 * 🔴 `unit === '%'` 时**库里存的是小数**（0.075 表示 7.5%）：显示要 ×100，
 *    提交与 range 校验都按小数走。两处口径不一致的表现是「填 7.5、存进去变 0.075、
 *    再打开显示 0.075%」—— 而它不报错。
 */
export interface QlzgParamSchemaItem {
  /** 属性/参数/字段键名，如 building_area */
  key: string
  /** 界面显示名，如「建筑面积」 */
  label: string
  /** 值类型，见 QlzgParamTypeEnum：DECIMAL / INT / STRING / ENUM / DATE / GEO */
  type: string
  /** 单位（㎡ / % / 元/㎡），可空 */
  unit?: string
  /** 见 QlzgParamScopeEnum：SUBJECT_ATTR / PARAM / REPORT_FIELD */
  scope: string
  /** 是否必填。🔴 是 Boolean 不是 boolean 默认 false —— 键缺失与显式 false 在后端是两件事 */
  required?: boolean
  /** 是否进 qlzg_subject_index 投影，只对 SUBJECT_ATTR 有意义 */
  indexed?: boolean
  /** 小数位，只 DECIMAL 用，上限 8 */
  scale?: number
  /** 舍入模式，默认 HALF_UP，只 DECIMAL 用 */
  rounding?: string
  /** 取值范围，可空 = 不限 */
  range?: QlzgParamRange | null
  /** 枚举可选值，只 ENUM 用 */
  options?: string[]
  /**
   * 默认值来源：PROMPT_USER / FROM_MATERIAL / FROM_PARAM_LIB / FROM_SURVEY / BASE_DATE_PLUS_ONE_YEAR
   *
   * ⚠️ I1 只解析不消费 —— 现在拿到 FROM_MATERIAL 也没有「从资料里取值」这条通路，
   *    别在界面上承诺它。
   */
  defaultStrategy?: string
  /** 报告字段数值/文本分档：AMOUNT / DATE / TEXT，只 REPORT_FIELD 用 */
  fieldKind?: string
  /** 依据条款，可空 */
  clauseRef?: string
  /** 绑定的规则码，如 ["R29"]，可空 */
  boundRules?: string[]
}

/**
 * 必备资料清单项 —— 缺件检测（R17）的依据
 *
 * 🔴 `required` 是**多态**的：既可能是布尔 `true`（无条件必备），也可能是条件串
 *    `"IF_STATUTORY"`（法定评估才必备）或 `"IF_<字段>_EQ_<值>"`（如 `IF_RIGHT_TYPE_EQ_出让`）。
 *    前端**不要**自己解释这个串 —— 缺件结果一律读 `GET /qlzg/material/missing-items`，
 *    那边是服务端按项目实际情况算好的集合差。这里原样展示即可。
 */
export interface QlzgMaterialChecklistItem {
  /** 清单项码，如 ENTRUST_CONTRACT */
  itemCode: string
  /** 显示名，如「评估委托合同」 */
  name: string
  /** 🔴 boolean 或条件串，见上 */
  required?: boolean | string
  /** 最少份数，null = 1。「传了 2 张、要求 4 张」仍算缺件 */
  minCount?: number | null
  /** 法规依据，如「资产评估法 第三十条」 */
  lawBasis?: string | null
}

/** ③ 方法集 */
export interface QlzgMethodCodes {
  /** 允许的评估方法（I3 的 ValuationMethod 码） */
  allowed: string[]
  /** 推荐方法 —— 🔴 是提示不是白名单，不在里面也能用 */
  recommended: string[]
  /** 明确不支持的方法，用于「本平台当前不支持」提示 */
  forbidden: string[]
}

/** 精简形态：下拉选择用 */
export interface QlzgCategorySimpleVO {
  /** 品类码，如 REAL_ESTATE_MORTGAGE_RESIDENTIAL */
  categoryCode: string
  /** 品类名称，如「住宅抵押」 */
  categoryName: string
  /** 父品类码，如 REAL_ESTATE_MORTGAGE */
  parentCode?: string
  /** 对应的标的类型，如 REAL_ESTATE —— 🔴 标的类型由品类决定，创建标的不接受传入 */
  subjectType: string
  /** 该品类默认是否法定评估：选完品类后表单的初值，项目上的 isStatutory 可覆盖 */
  isStatutoryDefault: boolean
  /** 档案保存年限（15 / 30） */
  retentionYears: number
}

/** 章节树上的一节（**拍平后**的一行）← 后端 {@code QlzgCategorySectionRespVO} */
export interface QlzgCategorySectionVO {
  code: string
  title: string
  level?: number | null
  /** 🔴 响应本身已按声明顺序排好，**不要**据此重排 —— 那份顺序就是报告目录的顺序 */
  sort?: number | null
  required?: boolean | null
  clauseRef?: string | null
  /**
   * 这一节声明的字段键
   *
   * 🔴 它是闸 B ① 允许词表的第三块（另两块是平台结构件与 param_schema 的全部键）。
   *    拿到它之后，模板设计器的字段键下拉**仍然要保留手输** ——
   *    第一块 {@code structuralNames()} 是后端常量，抄一份到前端就是第二份真相。
   */
  fieldKeys?: string[] | null
}

/** 完整形态：含准则包、方法集、参数 schema、资料清单 */
export interface QlzgCategoryVO extends QlzgCategorySimpleVO {
  /** 状态：0 停用 / 1 启用 */
  status: number
  /** 是否平台预置品类（tenant_id = 0） */
  platform: boolean
  /** ① 准则包：准则码列表 */
  standardCodes: string[]
  /** ③ 方法集 */
  methodCodes: QlzgMethodCodes
  /** ④ 参数 schema，🔴 未按 scope 过滤，前端按 scope 自己分派 */
  paramSchema: QlzgParamSchemaItem[]
  /** 必备资料清单 */
  materialChecklist: QlzgMaterialChecklistItem[]
  createTime?: Date
}

export const QlzgCategoryApi = {
  /** 品类精简列表（下拉用，只含启用的） */
  getSimpleList: (): Promise<QlzgCategorySimpleVO[]> =>
    request.get({ url: '/qlzg/category/simple-list' }),

  // 🔴 这里曾经有一个 getList（GET /qlzg/category/list，含停用的品类），已随后端端点一起删掉。
  //    它挂的 qlzg:category:query 是全仓唯一没有承载菜单的 qlzg 权限点，在授权树上是一行
  //    menu_id=NULL / default_effect=DENY 的孤儿；而「品类管理页」压根不存在（V5 也没要求）。
  //    品类是「所有机构一致、30 年不动」的执业口径，不该有能改它的页面。别加回来。

  /** 🔴 按品类码取详情，不是按 id */
  getCategory: (categoryCode: string): Promise<QlzgCategoryVO> =>
    request.get({ url: '/qlzg/category/get', params: { categoryCode } }),

  /**
   * 章节树（**拍平**）← `/section-list`
   *
   * <h3>🔴 两处下拉都靠它，别在前端各写一份章节码清单</h3>
   * ① 话术表单的「挂在哪个章节」—— 写错的码保存时被 {@code PHRASE_SECTION_UNKNOWN} 拒；
   * ② 模板设计器的字段键下拉 —— 闸 B ① 的允许词表里有 {@code section_schema} 声明的键。
   *
   * <p>⚠️ 与 {@code /simple-list}、{@code /get} 一样**只要登录即可**，没有 `@PreAuthorize`。
   *    理由是它喂的是两个不同权限族的表单（`qlzg:phrase:*` 与 `qlzg:template:*`），
   *    给它单挂一个「品类查询」权限点的后果是「配齐了话术权限，章节下拉仍然是空的」。
   *
   * <p>🔴 {@code categoryCode} **必填**，传空不会退回法定默认品类 ——
   *    那是话术校验侧的口径（一条通用话术要在每个品类里都讲得通），
   *    而这里是一个下拉的候选来源：用户还没选品类就没有候选可给。
   *    所以品类为空时把这一格**禁用**，不要拿默认品类的章节树去填它。
   */
  getSectionList: (categoryCode: string): Promise<QlzgCategorySectionVO[]> =>
    request.get({ url: '/qlzg/category/section-list', params: { categoryCode } })
}

/**
 * 从品类的 paramSchema 里挑出标的属性那一类，保持后端给的顺序
 *
 * 🔴 顺序有意义：标的详情页的 attrViews 就是按这个顺序渲染的（孤儿键排最后），
 *    前端自己 sort 一遍会让「同一份数据在两个页面上顺序不同」。
 */
export const subjectAttrSchemaOf = (category?: QlzgCategoryVO | null): QlzgParamSchemaItem[] =>
  (category?.paramSchema ?? []).filter((item) => item.scope === 'SUBJECT_ATTR')

/**
 * 从品类的 paramSchema 里挑出**测算参数**那一类（I3）
 *
 * 🔴 这份清单是「某个品类下允许录哪些 `paramKey`」的**唯一**前端依据，
 *    与后端 {@code QlzgParamServiceImpl#validateParamKeyDeclared} 读的是同一份数据。
 *    参数库的 `paramKey` 下拉**必须**用它填，而不是让人自由输入：
 *    后端对「schema 没声明的键」抛 {@code PARAM_KEY_NOT_DECLARED}，
 *    而那条报错在**新增和查询两侧**都会出现 —— 录进去一个没声明的键，
 *    之后连打开这条参数的详情都会失败。
 *
 * <h3>🔴 品类留空（通用参数）时用的是**跨品类并集**，不是自由输入</h3>
 * 后端那时的判据是「该键在**任意一个可见品类**的 PARAM 作用域里被声明过」，
 * 所以参数库台账会把 simple-list 里每个品类的详情各拉一次（{@code Promise.allSettled}），
 * 在 {@code index.vue} 里拼出 {@code schemaByCategory} 与并集 {@code schemaIndex} 两张表。
 *
 * <p>⚠️ 代价是「打开这一页要发 1 + N 个请求」。今天种子里只有 1 个品类，
 *    品类又是机构级基础数据、由实施人员维护，量级是个位数，所以可以接受。
 *    🔴 哪个机构真把品类堆到几十个，正确的修法是**后端加一个只返回 PARAM 作用域并集的端点**，
 *    不是在前端加缓存层 —— 缓存层解决不了「品类改了 schema、这一页还拿着旧的」，
 *    而那份陈旧会让一个合法的键被判成没声明。
 *
 * <p>⚠️ 退化成自由输入是**更坏**的选项，别走回头路：那等于给一个必然被后端拒的输入框，
 *    而通用参数（{@code category_code IS NULL}）恰恰是四维回退里最常被命中的那批行。
 */
export const paramSchemaOf = (category?: QlzgCategoryVO | null): QlzgParamSchemaItem[] =>
  (category?.paramSchema ?? []).filter((item) => item.scope === 'PARAM')

/**
 * 模板设计器映射面板的字段键候选（I4）
 *
 * <h3>🔴 这一份**不按 scope 过滤**，与前两个 helper 刻意不同</h3>
 * 后端 {@code QlzgTemplateGateB#allowedFieldKeys} 的允许词表是
 * 「平台结构件 ∪ **param_schema 的全部键**（不分 scope）∪ section_schema 声明的键」。
 * 前端只挑 {@code REPORT_FIELD} 那一档的话，往一个标的属性占位符上绑
 * {@code building_area} 会被闸 B ① 判成 {@code UNKNOWN_FIELD} ——
 * 而它本来是合法的。按 scope 收窄是**前端自己造的一道假门禁**。
 *
 * <h3>⚠️ 这份清单**不完整**：还缺平台结构件那一块</h3>
 * 允许词表有三块：① 平台结构件 {@code QlzgTemplateModelKeys.structuralNames()}、
 * ② {@code param_schema} 的全部键（本 helper 给的就是这一块）、
 * ③ {@code section_schema} 声明的键（{@link QlzgCategoryApi.getSectionList} 的
 *    {@code fieldKeys}，用 {@link mergeSectionFieldKeys} 并进来）。
 * ① 是后端常量，抄一份到前端就是第二份真相 —— 所以哪怕 ②③ 都齐了，
 * 下拉**仍然是** {@code filterable allow-create} 的：**允许手输**。
 * 拦住手输的代价是「用了结构件键的模板永远绑不上」，
 * 而放开手输的代价是「打错一个字母」—— 后者会在保存映射的那一刻被
 * 后端重跑的闸 B ① 当场报成 UNKNOWN_FIELD，一句话就能看懂。
 * 🔴 别把这道下拉改成不允许手输的严格枚举，那不是更安全，是把一类合法模板堵死了。
 */
export const templateFieldKeyOptionsOf = (
  category?: QlzgCategoryVO | null
): { key: string; label: string; scope: string }[] =>
  (category?.paramSchema ?? [])
    .filter((item) => !!item.key)
    .map((item) => ({ key: item.key, label: item.label || item.key, scope: item.scope }))

/**
 * 把 {@code section_schema} 声明的字段键并进映射面板的候选里（第 ③ 块）
 *
 * <h3>🔴 已有的键**不覆盖**，只在末尾追加新键</h3>
 * 同一个键可能同时出现在 {@code param_schema}（带中文名与 scope）与某一节的
 * {@code field_keys} 里（只有键名）。用后者覆盖前者的话，下拉里那一行会从
 * 「建筑面积 · 标的属性」退化成「building_area · 章节字段」——
 * 而 {@code param_schema} 那份是有中文名的，退化没有任何好处。
 *
 * <p>⚠️ 后端 {@code allowedFieldKeys} 求的是<b>并集</b>，不关心顺序也不关心来源，
 *    所以这里怎么排都不影响闸 B 的判定；排成「schema 在前、章节字段在后」
 *    只是因为前者是绝大多数占位符要绑的东西。
 */
export const mergeSectionFieldKeys = (
  base: { key: string; label: string; scope: string }[],
  sections?: QlzgCategorySectionVO[] | null
): { key: string; label: string; scope: string }[] => {
  const out = [...base]
  const seen = new Set(out.map((item) => item.key))
  for (const section of sections ?? []) {
    for (const key of section?.fieldKeys ?? []) {
      if (!key || seen.has(key)) continue
      seen.add(key)
      // 🔴 scope 写 'SECTION'：它不在 PARAM_SCOPE 那三档里，是「这一节声明的」第四种来源。
      //    分组标题因此会多出一组「章节字段」，那是如实的 —— 它确实不在 param_schema 里
      out.push({ key, label: key, scope: 'SECTION' })
    }
  }
  return out
}

/**
 * 话术**触发条件**能用的键（I4）← 后端 {@code QlzgPhraseServiceImpl#indexedAttrKeys}
 *
 * <h3>🔴 只留 {@code indexed === true}，与上面那个 helper 刻意不同</h3>
 * 后端那份允许词表就是「{@code param_schema} 里 {@code indexed=true} 的键」——
 * 只有进了 {@code qlzg_subject_index} 投影的属性能被触发条件匹配上。
 * 用一份不收窄的清单（{@link templateFieldKeyOptionsOf}）去填这个下拉，
 * 等于让人挑一个**保存时就该被拒**的键：后端抛
 * {@code PHRASE_TRIGGER_KEY_NOT_INDEXED}，一句话看得懂，但白跑一趟。
 *
 * <h3>🔴 这一份是**完整的**，所以下拉不给 {@code allow-create}</h3>
 * 与模板映射那份（缺 {@code section_schema} 声明键与平台结构件，只能允许手输）相反：
 * {@code indexedAttrKeys} 读的就是 {@code param_schema}，而品类详情接口把它整份吐出来了。
 * 前端能给出完整清单时就不要放开手输 —— 触发条件写错键的后果是
 * 「话术还在库里、管理页还看得见，但永远排不到前面」，而**没有任何一处会说出来**。
 *
 * <p>⚠️ {@code options} 只在 {@code type === 'ENUM'} 时非空，用来把值那一格
 *    从自由输入收成下拉。非枚举（DECIMAL / DATE / STRING）没有可选值清单，
 *    老实给人一个输入框。
 */
export const phraseTriggerKeyOptionsOf = (
  category?: QlzgCategoryVO | null
): { key: string; label: string; type: string; options: string[] }[] =>
  (category?.paramSchema ?? [])
    .filter((item) => item.indexed === true && !!item.key)
    .map((item) => ({
      key: item.key,
      label: item.label || item.key,
      type: item.type,
      options: item.options ?? []
    }))

