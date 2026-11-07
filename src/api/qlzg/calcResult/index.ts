import request from '@/config/axios'

/**
 * 参与综合的一次测算 ← 后端 {@code QlzgCalcResultRespVO.Participant}
 *
 * 🔴 {@code weight} 只在 `combineType = WEIGHTED` 时有值，其余四档恒为 null。
 *    界面上不要显示「权重 0」—— 那会被读成「这次测算被赋予了零权重」，
 *    而实际含义是「这一档不按权重综合」
 */
export interface QlzgCalcResultParticipantVO {
  calculationId: number
  methodCode: string
  methodName?: string
  status: string
  resultValue?: number | null
  weight?: number | null
  weightReason?: string | null
}

/**
 * 结果确定（读模型）← 后端 {@code QlzgCalcResultRespVO}
 *
 * <h3>🔴 {@code deviationRate} 与 {@code deviationWarning} 是 R09 的落点</h3>
 * 偏离率 = |最高 − 最低| / 最高（按参与测算的结果值算）。超过 0.20 时
 * `deviationWarning` 非空，界面上要把它显示成**警示**（不是错误）：
 * 它不拦确定，但报告里必须解释为什么几种方法差这么多。
 * `deviationWarning` 为 null 就是「没超阈值」，不要自己再算一遍 ——
 * 阈值 0.20 是 R09 的参数，前端抄一份就会与规则种子分属两份真相。
 *
 * <h3>🔴 {@code finalValueInWords} 是后端算的中文大写，前端不要自己拼</h3>
 * 中文大写金额有「零」的读法规则（壹佰零贰万 vs 壹佰贰拾万），
 * 而 `CALC_RESULT_FINAL_VALUE_TOO_LARGE`（1042006048）拦的正是超出大写能表达上限的值 ——
 * 那句文案还提示「请先核对是否把『万元』当成了『元』填进来」，
 * 这是实务里最常见的一个数量级错误，界面上要把它显示在金额输入框旁边。
 *
 * <h3>🔴 {@code weights} 的键是**测算 id 的字符串形式**</h3>
 * 值是 `{ weight, reason }`。后端存的是 JSON 列，键必然是字符串；
 * 取的时候写 `weights[String(calculationId)]`，写 `weights[calculationId]`
 * 在 JS 里恰好也能命中（对象键会 toString），但 TS 类型对不上。
 */
export interface QlzgCalcResultVO {
  id?: number | null
  reportId?: number | null
  subjectId: number
  subjectName?: string
  calculationIds: number[]
  combineType: string
  combineTypeDescription?: string
  weights?: Record<string, { weight?: number; reason?: string }> | null
  finalValue?: number | null
  finalUnitPrice?: number | null
  /**
   * 🔴 **一整句中文**，不是码，也不要当码去查表
   *
   * 它存的是 {@code RatioCalculator#ratio(numerator, denominator, basisLabel)} 里由**调用方自己声明**的
   * 那句口径说明，实测四个来源：比较法 {@code "单价 = 还原价 / 建筑面积"}（或 {@code 成交价}，
   * 取决于 {@code realPriceRestored} 有没有还原）、收益法 {@code "单价 = 收益法评估值 / 建筑面积"}、
   * 假设开发法 {@code "单价 = 假设开发法评估值 / 建筑面积"}、结果确定回落 {@code "建筑面积"}。
   *
   * <p>照原样渲染即可。前端建一份「码 → 中文」的映射会把这句话拆成两半、再拼一次，
   * 而拼出来的措辞必然与后端漂（详见 `constants.ts` 里那段「刻意没有 UNIT_PRICE_BASIS_OPTIONS」）。
   */
  unitPriceBasis?: string | null
  unitPriceReason?: string | null
  finalValueInWords?: string | null
  valueType?: string | null
  determinationReason?: string | null
  deviationRate?: number | null
  deviationWarning?: string | null
  rangeLower?: number | null
  rangeUpper?: number | null
  combineFormulaText?: string | null
  participants?: QlzgCalcResultParticipantVO[]
  createTime?: Date
}

/**
 * 加权综合的一项 ← 后端 {@code QlzgCalcResultDetermineReqVO.WeightItem}
 *
 * 🔴 {@code reason} **必填**（`CALC_RESULT_WEIGHT_REASON_REQUIRED`，1042006040）：
 *    后端刻意没有加 `@NotBlank`，而是用自己的错误码拦，为的是给出那句
 *    「而 R08 会读它」的提示。界面上同样要按必填处理。
 * 🔴 权重之和必须**正好是 1**（`compareTo`，不是浮点相等）。
 *    三项等权要写 0.3334 / 0.3333 / 0.3333 —— 后端错误码
 *    `CALC_RESULT_WEIGHT_SUM_INVALID`（1042006042）的文案里就是这么教的。
 *    前端**不要**替用户「自动补齐最后一项」：那等于替他做了一个专业判断，
 *    而权重分配正是这次确定里最需要人负责的那一步。
 */
export interface QlzgCalcResultWeightItemVO {
  calculationId: number
  weight: number
  reason?: string | null
}

/**
 * 结果确定（写模型）← 后端 {@code QlzgCalcResultDetermineReqVO}
 *
 * <h3>🔴 {@code calculationIds} 是**顺序敏感**的，而且不去重</h3>
 * 后端只做「是否属于本标的」「是否重复」「是否 SUCCESS」三项校验，
 * **不排序**。所以「单一方法」那一档里，用户挑的那一条必须排在第一个 ——
 * 而 `SINGLE` 本来就只允许一条（`CALC_RESULT_SINGLE_NEEDS_ONE`，1042006037）。
 * 重复的同一条会被 `CALC_RESULT_CALCULATION_DUPLICATE`（1042006034）拒，
 * 文案是「请把多出来的那一次从清单里去掉」。
 *
 * <h3>🔴 {@code weights} 只在 WEIGHTED 时被读，其余四档传了也**不落库**</h3>
 * 所以切换综合方式时要把权重表清空，不要留着上一次的残留发上去。
 *
 * <h3>🔴 {@code finalValue} 只在 RANGE / PROFESSIONAL_JUDGMENT 两档必填</h3>
 * `CALC_RESULT_FINAL_VALUE_REQUIRED`（1042006043）的文案提到「R07 会直接判 BLOCK」。
 * 而 RANGE 档还要求它落在 `[rangeLower, rangeUpper]` 内
 * （`CALC_RESULT_FINAL_VALUE_OUT_OF_RANGE`，1042006044），
 * 要另给一个区间外的值必须改用「专业判断」档 —— 这条规则要写在界面上，
 * 否则用户会以为系统不让他填。
 *
 * <h3>🔴 {@code determinationReason} 必填，且不能只有套话</h3>
 * 三道校验：为空（1042006045，引用《资产评估法》第二十六条与中评协〔2018〕35号
 * 第十四条(七)）、太短（1042006046，R08 有字数下限）、
 * 去掉套话之后没内容（1042006047）。前端**不要**自己算字数下限 ——
 * 那个数在 R08 的参数里，抄一份就会漂。做法是：不预校验，
 * 把后端那句原文显示出来（它已经写了「只有 N 个字，少于 R08 要求的 M 个字」）。
 */
export interface QlzgCalcResultDetermineVO {
  subjectId: number
  calculationIds: number[]
  combineType: string
  weights?: QlzgCalcResultWeightItemVO[]
  finalValue?: number | null
  valueType?: string | null
  determinationReason?: string | null
}

export const QlzgCalcResultApi = {
  /**
   * 预览一次综合 ← `QlzgCalcResultController#preview`
   *
   * 🔴 **一个字都不写库**，返回的对象 `id` 为 null（那就是「这是预览」的判据）。
   *    它算的与 `/determine` 完全同一套：偏离率、区间、单价、中文大写、综合算式文本。
   *    所以正确用法是**先 preview 给人看，确认无误再 determine** ——
   *    尤其是「专业判断」档，评估师要先看见区间与偏离率才能写出取舍理由。
   * 🔴 preview 同样会跑那三道理由校验，所以理由没写够时 preview 就会拒。
   *    这是刻意的：让错误在**不写库**的那一次就暴露出来。
   * ⚠️ 权限点是 `qlzg:calc-result:query`（只读的人也要能预览）
   */
  preview: (data: QlzgCalcResultDetermineVO): Promise<QlzgCalcResultVO> =>
    request.post({ url: '/qlzg/calc-result/preview', data }),

  /**
   * 落一次结果确定 ← `QlzgCalcResultController#determine`
   *
   * 🔴 返回的是**记录 id**。同一个标的可以确定多次（改主意了就再确定一次），
   *    `/get-latest` 取的是 `max(id)` 那一条。
   * ⚠️ 权限点是 `qlzg:calc-result:create`
   */
  determine: (data: QlzgCalcResultDetermineVO): Promise<number> =>
    request.post({ url: '/qlzg/calc-result/determine', data }),

  getCalcResult: (id: number): Promise<QlzgCalcResultVO> =>
    request.get({ url: '/qlzg/calc-result/get', params: { id } }),

  listBySubject: (subjectId: number): Promise<QlzgCalcResultVO[]> =>
    request.get({ url: '/qlzg/calc-result/list-by-subject', params: { subjectId } }),

  /**
   * 取最新一次确定 ← `QlzgCalcResultController#getLatestBySubjectId`
   *
   * ⚠️ 一次都没确定过时返回 **null**（不是 404、不是空对象）。
   *    调用方要按 null 处理，别解引用
   */
  getLatest: (subjectId: number): Promise<QlzgCalcResultVO | null> =>
    request.get({ url: '/qlzg/calc-result/get-latest', params: { subjectId } }),

  /**
   * 导出计算成果表 ← `QlzgCalcResultController#exportCalcSheet`
   *
   * <h3>🔴 权限点是 `:query`，**不是**新造的 `:export`</h3>
   * 新权限串没有对应按钮菜单时，`PermissionScanRunner` 只建出一条
   * `menu_id = NULL` 的承载行，而 `default_effect = DENY` ——
   * 结果是**所有非超管静默失去导出能力**，全程 200 无异常。
   *
   * <h3>🔴 文件名由调用方自己拼</h3>
   * 后端**确实**发了 `Content-Disposition`：`QlzgCalcSheetExporter#write` 是
   * 「先出完整字节 → 再设头 → 最后写体」，与 `ExcelUtils.write` 那个
   * 「先写流后设头、流一写完响应就提交」的顺序**相反**。
   * 读不到的原因在前端这一侧：`request.download` 走 blob 那一支响应拦截器，
   * 它 `return response.data`，响应头在这一层就被丢掉了。
   * 要读头得换 `exportExcelWithMeta` 那种自己发一次 axios 的写法。
   *
   * <h3>⚠️ 这一份导出与台账导出不同，**不需要** `exportExcelWithMeta`</h3>
   * 它是单条记录的三个 sheet（计算过程 / 参数口径 / 案例明细），
   * sheet 之间是**真公式**而不是死值，没有行数上限、也就没有 `X-Export-Truncated` 可读。
   *
   * <h3>⚠️ 但它有自己的一个头：`X-Export-File-Id`</h3>
   * 值是这一份导出件登记进 `infra_file` 的**行编号** —— 导出件在服务端登记过一次，
   * 于是「客户拿走的那一份」与「平台记录的那条 `sha256`」能对上（方案 D1② 的 xlsx 半边）。
   * 今天前端不读它：登记是服务端自己完成的，读不读都不影响下载。
   * 哪天真要在界面上显示「已归档，编号 X」，读的就是这个头
   * （它已经列进后端 `EnlevWebAutoConfiguration.EXPOSED_HEADERS`，跨源也拿得到）。
   */
  exportCalcSheet: (id: number): Promise<any> =>
    request.download({ url: '/qlzg/calc-result/export-calc-sheet', params: { id } })
}
