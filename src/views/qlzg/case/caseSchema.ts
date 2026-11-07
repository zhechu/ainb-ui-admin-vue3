import type {
  QlzgCaseImportIssueVO,
  QlzgCaseImportPreviewVO,
  QlzgCaseSaveVO,
  QlzgCaseVO
} from '@/api/qlzg/case'

/**
 * 案例录入 / 导入的**纯逻辑**：单价一致性、万元显示、三屏闸门、提交装配、问题清单汇总
 *
 * <h3>🔴 为什么单独一个纯模块，而不是写在 CaseForm.vue 里</h3>
 * 本仓 vitest 跑在 `environment: 'node'`（没有 jsdom、没有 `@vue/test-utils`），
 * 而任何**值导入**了 `@/config/axios` 的模块在收集阶段就会 `window is not defined` 死掉。
 * `.vue` 文件必然值导入 API 层，于是它们**一个都测不了** ——
 * qlzg 现有 5 份 spec 全是纯模块（`constants`、`subject/attrSchema`、
 * `material/{folderFlatten,uploadLimits,uploadQueue}`），这不是巧合。
 * 所以规矩是：**要测的逻辑就搬进纯模块**，`.vue` 里只留装配与事件。
 * 本文件对 API 层一律用 `import type`，运行期一个字节都不引。
 *
 * <h3>🔴 本模块的每一条判定都是【建议】，权威判定在后端</h3>
 * 单价 5%、还原价与理由的双向必填、屏 2 不可跳过，后端各有一条错误码。
 * 前端再判一遍**不是为了替代**，是为了让评估师在点保存之前就知道 ——
 * D3 ① 的验收是「三屏填完 ≤ 30 秒」，而一次「保存被拒 → 读报错 → 翻回第 2 屏」
 * 就要十几秒。所以两处判定不一致时，**以后端为准**：本模块刻意放宽
 * （浮点比较留 1e-9 的余量），宁可让一个边界值过去被后端拒，
 * 也不要在这里拦住一个后端本来会接受的值 —— 后者用户拿不到任何解释。
 *
 * @author 走进新时代
 */

// ==================== 单价：自动算 + 5% 一致性 ====================

/**
 * 单价一致性阈值。🔴 与后端 `QlzgCaseServiceImpl` 的 `UNIT_PRICE_TOLERANCE` 同一个数
 *
 * 足够宽以容纳「来源把面积或成交价四舍五入过」，足够窄以拦住数量级错误
 * （把万元当成元填，差一万倍）。改一边必须改另一边
 */
export const UNIT_PRICE_TOLERANCE = 0.05

/**
 * 单价的小数位。🔴 与 DDL 的 `decimal(18,2)` 一致
 *
 * 算出三位再存进去会被列定义截掉，而截掉的那一位**恰好**是
 * 与用户填的单价比对时产生「差 0.005 元/㎡」这种假偏差的来源
 */
export const UNIT_PRICE_SCALE = 2

/**
 * 浮点比较的余量
 *
 * 🔴 方向是**刻意单向的**：只让前端比后端宽，不让它比后端严。
 *    严了的表现是「表单说单价不一致、后端说没问题」，用户改无可改；
 *    宽了的表现是「表单没拦、后端拦」，而那条报错文案里带着填的值与算出的值，可行动
 */
const FLOAT_EPSILON = 1e-9

/**
 * HALF_UP 舍入到指定小数位 —— 镜像 Java 的 `RoundingMode.HALF_UP`
 *
 * 🔴 不能直接 `Number(value.toFixed(scale))`：`toFixed` 在二进制表示落在
 *    半分点下方时会给「银行家」的结果（`(1.005).toFixed(2)` 得到 `"1.00"`），
 *    而 Java 的 BigDecimal 给 `"1.01"`。差的那一分正是假偏差的来源
 * 🔴 也不能直接 `value * factor` 再取整：`1.005 * 100` 在 IEEE 754 下是
 *    `100.49999999999999`。先 `toPrecision(15)` 把这类表示误差抹掉再取整
 * ⚠️ 负数按「远离 0」取整（`-0.5` → `-1`），与 HALF_UP 的定义一致。
 *    `Math.round` 是「向 +∞」（`-0.5` → `-0`），不能用
 */
export const roundHalfUp = (value: number, scale: number): number => {
  if (!Number.isFinite(value)) return value
  const factor = Math.pow(10, scale)
  const scaled = Number((value * factor).toPrecision(15))
  const rounded = scaled >= 0 ? Math.floor(scaled + 0.5) : Math.ceil(scaled - 0.5)
  return rounded / factor
}

/**
 * 空值的统一判据：`undefined` / `null` / `''` / 全空白 / `NaN` 都算没填
 *
 * 🔴 全空白那一路**必须单列**：`Number('   ')` 是 **0**、不是 NaN，
 *    于是「坐标框里剩一个空格」会被当成「填了 0」——
 *    而 0/0 是几内亚湾，空间召回那一层把它当成一个真实坐标去比距离。
 *    后端 `readCoordinate` 对空串返回 null 而**不回落成 0**，前端不能替它回落
 */
const isBlankNumber = (value?: number | string | null): boolean => {
  if (value === undefined || value === null) return true
  if (typeof value === 'string') return value.trim().length === 0 || Number.isNaN(Number(value))
  return Number.isNaN(value)
}

/**
 * 「成交价 ÷ 建筑面积」，保留两位 —— 后端 `resolveUnitPrice` 的前半段
 *
 * @return 算不出来时返回 `null`（任一侧没填、或面积为 0）。
 *         🔴 **不返回 0**：0 是一个合法的单价，界面拿它当占位符会显示「0 元/㎡」，
 *         而用户以为系统算出来了
 */
export const computedUnitPrice = (
  transactionPrice?: number | string | null,
  buildingArea?: number | string | null
): number | null => {
  if (isBlankNumber(transactionPrice) || isBlankNumber(buildingArea)) return null
  const price = Number(transactionPrice)
  const area = Number(buildingArea)
  if (area === 0) return null
  return roundHalfUp(price / area, UNIT_PRICE_SCALE)
}

/**
 * 用户填的单价与算出来的差在不在 5% 以内 —— 后端 `resolveUnitPrice` 的后半段
 *
 * 🔴 判定用「绝对差 vs 阈值」而不是「算出百分比再比」：算出的单价为 0 时除法会炸，
 *    而它为 0 意味着「成交价 ÷ 建筑面积」四舍五入到 `0.00` ——
 *    只有「0.01 元买 1000 ㎡」这种荒谬入参才会走到。此时阈值也是 0，
 *    任何非 0 单价都会被拦下，而那正是想要的
 *
 * @param submitted 用户填的单价；`null` / `undefined` 表示「没填，让后端算」⇒ 恒一致
 */
export const unitPriceConsistent = (
  submitted?: number | string | null,
  computed?: number | null
): boolean => {
  if (isBlankNumber(submitted)) return true
  if (computed === null || computed === undefined) return true
  const diff = Math.abs(Number(submitted) - computed)
  const tolerance = Math.abs(computed * UNIT_PRICE_TOLERANCE)
  return diff <= tolerance + FLOAT_EPSILON
}

/**
 * 偏差百分比，保留一位小数 —— 给提示文案用，镜像后端的 `deviationPercent`
 *
 * ⚠️ 算出的单价为 0 时返回 `"100"`：这是个凑不出的百分比，但文案里紧跟着的
 *    两个数字（「填的是 42000，算出来的是 0.00」）已经把问题说清楚了
 */
export const unitPriceDeviationPercent = (
  submitted?: number | string | null,
  computed?: number | null
): string => {
  if (isBlankNumber(submitted) || computed === null || computed === undefined) return '0'
  if (computed === 0) return '100'
  const percent = (Math.abs(Number(submitted) - computed) * 100) / Math.abs(computed)
  return String(roundHalfUp(percent, 1))
}

// ==================== 万元：只读显示 ====================

/** 一万。V5 §11.2.2 的线框图把价格标成「万元」，而全仓存的是**元** */
export const YUAN_PER_WAN = 10000

/**
 * 元 → 万元的**显示**文本，保留两位
 *
 * 🔴 这是一条**改判记录**：线框图写「成交价 [    ] 万元」，但后端
 *    `transactionPrice` / `unitPrice` / `realPriceRestored` 三列的单位都是**元**
 *    （DDL 是 `decimal(18,2)`，报错文案里也写着「单位【元】」），
 *    而项目台账、标的台账存的同样是元。仓里没有任何万元换算助手。
 *
 *    所以：**输入框收元、单位写在标签里**（与 `bookValue`「账面价值（元）」同一口径），
 *    万元只作为标签旁边一句**只读提示**显示，且换算结果**永不回传**。
 *    让表单收万元的话就要在提交前乘一万、回显时除一万 ——
 *    一次乘一次除就是一处四舍五入，而它落在**成交价**上，
 *    错一分钱的成交价与错一分钱的备注不是一个量级的问题
 *
 * @return 没填时返回 `null`（调用方据此不渲染那句提示，而不是渲染「≈ 万元」）
 */
export const toWanYuan = (yuan?: number | string | null): string | null => {
  if (isBlankNumber(yuan)) return null
  return roundHalfUp(Number(yuan) / YUAN_PER_WAN, 2).toFixed(2)
}

/** 「≈ 380.51 万元」；没填时返回空串 */
export const wanYuanHint = (yuan?: number | string | null): string => {
  const wan = toWanYuan(yuan)
  return wan === null ? '' : `≈ ${wan} 万元`
}

// ==================== 三屏闸门（§11.2.2）===================

/**
 * 录入表单的模型。与 `QlzgCaseSaveVO` **同形**，差别只在「空」的表示法：
 * 表单里字符串的空是 `''`（`el-input` 的初值），提交时由 {@link toSaveVO} 收成 `undefined`
 *
 * 🔴 `unitPriceTouched` 是这里唯一一个**不上行**的字段：
 *    单价框在用户没碰过时显示的是算出来的那个值（占位符），
 *    此时提交**不带** `unitPrice`，让后端自己算 —— 后端才是权威，
 *    把前端算的值传回去等于让两份舍入实现必须逐位相同
 */
export interface QlzgCaseFormModel {
  id?: number
  caseKind: string
  sourceType: string
  sourceId?: number | null
  cityCode: string
  districtCode: string
  communityName: string
  address: string
  lng?: number | null
  lat?: number | null
  purpose: string
  rightType: string
  transactionDate: string
  transactionPrice?: number | null
  buildingArea?: number | null
  unitPrice?: number | null
  unitPriceTouched: boolean
  realPriceRestored?: number | null
  priceRestoredFlag: boolean
  restoreReason: string
  floorInfo: string
  orientation: string
  decoration: string
  builtYear?: number | null
  structure: string
  originUrl: string
  evidenceFileId?: number | null
  evidenceFileName: string
  evidenceKind: string
  attrs?: Record<string, any> | null
  remark: string
}

/** 三屏。屏 3 是确认页，没有「下一步」 */
export const STEP_COUNT = 3

export const STEP_TITLES = ['基本信息', '证据', '确认与复用'] as const

/**
 * 屏 1 的阻塞项
 *
 * 🔴 四条与后端的 `@NotBlank` / `@NotNull` 一一对应，多一条少一条都不行：
 *    少了 ⇒ 用户点「下一步」过去、在第 3 屏保存时才被拒，然后要翻回第 1 屏；
 *    多了 ⇒ 拦住一个后端本来会接受的值，而用户不知道那一栏到底要不要填
 *
 * ⚠️ `communityName` **不在**这里面：后端不要求它（新盘第一次录入时可能只有坐落地址）。
 *    但它是打分表里权重最高的一项（同小区 +40），所以留空时给一条**非阻塞**提示，
 *    见 {@link step0Advisories}
 */
export const step0Issues = (form: QlzgCaseFormModel): string[] => {
  const issues: string[] = []
  if (!form.caseKind?.trim()) issues.push('案例库类型不能为空')
  if (!form.transactionDate) issues.push('成交日期不能为空')
  if (isBlankNumber(form.transactionPrice)) issues.push('成交价不能为空')
  else if (Number(form.transactionPrice) <= 0) issues.push('成交价必须大于 0')
  if (isBlankNumber(form.buildingArea)) issues.push('建筑面积不能为空')
  else if (Number(form.buildingArea) <= 0) issues.push('建筑面积必须大于 0')
  return issues
}

/**
 * 屏 1 的非阻塞提示
 *
 * 🔴 这两条都是**静默失效**类：填不填都能存，存了也在台账里看得见，
 *    而这条案例**永远召回不到**，且没有一处会报错。所以必须在填的那一刻就说
 */
export const step0Advisories = (form: QlzgCaseFormModel): string[] => {
  const notes: string[] = []
  if (!form.cityCode?.trim()) {
    notes.push(
      '城市留空：只要标的属性里填了城市，这条案例就一条都召回不到（第 1 层是硬过滤，按文本严格相等比）'
    )
  }
  if (!form.purpose?.trim()) {
    notes.push('用途留空：同上，第 2 层也是硬过滤，留空 ⇒ 召回不到')
  }
  if (!form.rightType?.trim()) {
    notes.push('权利性质留空：第 3 层硬过滤且空值行一律排除（划拨地与出让地的价格口径差 30%–50%）')
  }
  if (!form.communityName?.trim()) {
    notes.push('小区名留空：打分表里权重最高的一项是「同小区 +40」，留空就白送这 40 分')
  }
  return notes
}

/**
 * 屏 2 的阻塞项 —— 🔴 **屏 2 是强制的，不可跳过**（§11.2.2）
 *
 * 无证据的案例在质询时无法自证，等于没有。所以「下一步」按钮在这一屏要**禁用**，
 * 而不是让用户走过去、到第 3 屏保存时吃一个 `CASE_EVIDENCE_REQUIRED`
 */
export const step1Issues = (form: QlzgCaseFormModel): string[] => {
  const issues: string[] = []
  if (isBlankNumber(form.evidenceFileId)) issues.push('至少上传一份佐证材料')
  if (!form.evidenceKind?.trim()) issues.push('请选择佐证类型')
  const restore = restorePairIssue(form)
  if (restore) issues.push(restore)
  return issues
}

/**
 * 还原价与还原理由**两个方向**都必填（§1.4 配套 ②）
 *
 * 🔴 反向那一支（只留理由不留还原价）也要拦：那样一行读起来像做过还原、
 *    却看不到还原成多少，比不做还原更坏
 *
 * @return 没问题时返回 `null`
 */
export const restorePairIssue = (form: QlzgCaseFormModel): string | null => {
  const hasPrice = !isBlankNumber(form.realPriceRestored)
  const hasReason = !!form.restoreReason?.trim()
  if (hasPrice && !hasReason) return '填了还原后的真实价，就必须写还原理由与依据'
  if (!hasPrice && hasReason) return '只写了还原理由、没填还原后的真实价：这一行读起来像做过还原，却看不到还原成多少'
  if (hasPrice && Number(form.realPriceRestored) <= 0) return '还原后的真实价必须大于 0'
  return null
}

/** 「下一步」该不该亮 */
export const canGoNextStep = (step: number, form: QlzgCaseFormModel): boolean => {
  if (step === 0) return step0Issues(form).length === 0
  if (step === 1) return step1Issues(form).length === 0
  return false
}

/**
 * 屏 3 保存前的最终校验（三屏合起来）
 *
 * 🔴 不只是把两屏的阻塞项拼起来：编辑态是从台账直接点进来的，
 *    此时用户**没有走过**前两屏的闸门，所以保存时必须整套再判一次
 */
export const saveIssues = (form: QlzgCaseFormModel): string[] => [
  ...step0Issues(form),
  ...step1Issues(form)
]

// ==================== 提交装配 ====================

/** 空串收成 `undefined`（JSON 里就不出现这一列，后端按「没传」处理） */
const trimToUndefined = (value?: string | null): string | undefined => {
  if (value === undefined || value === null) return undefined
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

/**
 * 表单模型 → 上行载荷
 *
 * 🔴 四样东西**刻意不上行**，传了也会被后端忽略，但更重要的是
 *    表单里**不该出现**这几个框（见 `QlzgCaseSaveVO` 的注释）：
 *    `enteredBy` / `enteredAt` / `isVerified` / `fingerprint`
 *
 * 🔴 `unitPrice` 只在用户**碰过**那一栏时才上行。没碰过就让它缺席，
 *    后端按「成交价 ÷ 建筑面积」自己算 —— 见 {@link QlzgCaseFormModel} 的注释
 *
 * 🔴 `location` 只在经纬度**都**填了时才上行：只填一半的话后端会把
 *    认不出的那半拒掉（`CASE_LOCATION_INVALID`），而它**不回落成 0** ——
 *    0 会把案例算到几内亚湾，而空间召回那一层把它当成一个真实坐标去比距离
 */
export const toSaveVO = (form: QlzgCaseFormModel): QlzgCaseSaveVO => {
  const hasLng = !isBlankNumber(form.lng)
  const hasLat = !isBlankNumber(form.lat)
  const payload: QlzgCaseSaveVO = {
    id: form.id,
    caseKind: trimToUndefined(form.caseKind),
    sourceType: trimToUndefined(form.sourceType),
    sourceId: form.sourceId ?? undefined,
    cityCode: trimToUndefined(form.cityCode),
    districtCode: trimToUndefined(form.districtCode),
    communityName: trimToUndefined(form.communityName),
    address: trimToUndefined(form.address),
    location: hasLng && hasLat ? { lng: Number(form.lng), lat: Number(form.lat) } : null,
    purpose: trimToUndefined(form.purpose),
    rightType: trimToUndefined(form.rightType),
    transactionDate: form.transactionDate || undefined,
    transactionPrice: isBlankNumber(form.transactionPrice)
      ? undefined
      : Number(form.transactionPrice),
    buildingArea: isBlankNumber(form.buildingArea) ? undefined : Number(form.buildingArea),
    unitPrice:
      form.unitPriceTouched && !isBlankNumber(form.unitPrice) ? Number(form.unitPrice) : undefined,
    realPriceRestored: isBlankNumber(form.realPriceRestored)
      ? undefined
      : Number(form.realPriceRestored),
    restoreReason: trimToUndefined(form.restoreReason),
    floorInfo: trimToUndefined(form.floorInfo),
    orientation: trimToUndefined(form.orientation),
    decoration: trimToUndefined(form.decoration),
    builtYear: isBlankNumber(form.builtYear) ? undefined : Number(form.builtYear),
    structure: trimToUndefined(form.structure),
    originUrl: trimToUndefined(form.originUrl),
    evidenceFileId: isBlankNumber(form.evidenceFileId) ? undefined : Number(form.evidenceFileId),
    evidenceKind: trimToUndefined(form.evidenceKind),
    attrs: form.attrs ?? null,
    remark: trimToUndefined(form.remark)
  }
  return payload
}

/**
 * 台账那一行 → 表单模型
 *
 * 🔴 **必须逐列填满**，一列都不能漏。`updateCase` 的语义是**整行替换**：
 *    入参为空的列会被写成 SQL NULL。所以「打开编辑弹窗 → 什么都不动 → 保存」
 *    如果漏了一列，那一列就被清空了 —— 而界面上没有任何征兆，
 *    用户看到的是一个正常的编辑弹窗和一个「修改成功」的提示
 *
 *    这个仓已经栽过一次同款（`ext_json`：读出为 `{}` 却被当成「整列覆盖成空」发回，
 *    打开表单再保存即删值）。所以本函数配了一条**穷尽性**用例，
 *    见 `caseSchema.spec.ts` 里那条「`toSaveVO(fromRespVO(row))` 与原行逐列等价」
 *
 * 🔴 `unitPriceTouched` 恒为 `false`：库里那个单价是后端算出来的，
 *    原样传回去等于宣称「用户填过它」。置 false 之后它不上行，后端重算，
 *    结果一定与库里那个一致（同一个算式、同一个舍入）
 */
export const fromRespVO = (row: QlzgCaseVO): QlzgCaseFormModel => ({
  id: row.id,
  caseKind: row.caseKind ?? '',
  // 🔴 后端不让改 sourceType，但表单仍要带着它上行：`toSaveVO` 会把它发回去，
  //    而 `updateCase` 见到它与库里不同会拒。带着原值发回去才是「没改」
  sourceType: row.sourceType ?? '',
  sourceId: row.sourceId ?? null,
  cityCode: row.cityCode ?? '',
  districtCode: row.districtCode ?? '',
  communityName: row.communityName ?? '',
  address: row.address ?? '',
  lng: (row.location?.lng as number | undefined) ?? null,
  lat: (row.location?.lat as number | undefined) ?? null,
  purpose: row.purpose ?? '',
  rightType: row.rightType ?? '',
  // LocalDate 上来就是 `"2026-03-15"`，日期选择器用 `value-format="YYYY-MM-DD"` 直接吃
  transactionDate: row.transactionDate ?? '',
  transactionPrice: row.transactionPrice ?? null,
  buildingArea: row.buildingArea ?? null,
  unitPrice: row.unitPrice ?? null,
  unitPriceTouched: false,
  realPriceRestored: row.realPriceRestored ?? null,
  priceRestoredFlag: !isBlankNumber(row.realPriceRestored),
  restoreReason: row.restoreReason ?? '',
  floorInfo: row.floorInfo ?? '',
  orientation: row.orientation ?? '',
  decoration: row.decoration ?? '',
  builtYear: row.builtYear ?? null,
  structure: row.structure ?? '',
  originUrl: row.originUrl ?? '',
  evidenceFileId: row.evidenceFileId ?? null,
  evidenceFileName: '',
  evidenceKind: row.evidenceKind ?? '',
  attrs: row.attrs ?? null,
  remark: row.remark ?? ''
})

/** 一份全空的表单模型（新增态） */
export const emptyCaseForm = (): QlzgCaseFormModel => ({
  id: undefined,
  caseKind: '',
  sourceType: '',
  sourceId: null,
  cityCode: '',
  districtCode: '',
  communityName: '',
  address: '',
  lng: null,
  lat: null,
  purpose: '',
  rightType: '',
  transactionDate: '',
  transactionPrice: null,
  buildingArea: null,
  unitPrice: null,
  unitPriceTouched: false,
  realPriceRestored: null,
  priceRestoredFlag: false,
  restoreReason: '',
  floorInfo: '',
  orientation: '',
  decoration: '',
  builtYear: null,
  structure: '',
  originUrl: '',
  evidenceFileId: null,
  evidenceFileName: '',
  evidenceKind: '',
  attrs: null,
  remark: ''
})

/**
 * 「保存并继续录下一条」之后要留下什么
 *
 * 🔴 这是 §11.2.2 屏 3 那个关键按钮的全部意义：批量录入时不用回列表页。
 *    留下的四样正是**同一批案例之间不变**的那几样（品类、城市、区县、用途），
 *    而清掉的是每条都不同的（小区名、坐落、成交日期、成交价、面积、佐证材料……）
 *
 * ⚠️ 佐证材料**必须清掉**：留着的话第二条案例会挂着第一条的截图，
 *    而两行的披露文本各自引用自己的附件名 —— 存进去之后
 *    「这条案例的证据是哪一份」就再也查不出来了，且没有一处报错
 */
export const carryOverForNextEntry = (form: QlzgCaseFormModel): QlzgCaseFormModel => {
  const next = emptyCaseForm()
  next.caseKind = form.caseKind
  next.cityCode = form.cityCode
  next.districtCode = form.districtCode
  next.purpose = form.purpose
  next.rightType = form.rightType
  return next
}

// ==================== 导入 ====================

/** 问题清单的三档计数 */
export interface QlzgIssueSummary {
  error: number
  warning: number
  skipped: number
}

/**
 * 按 `level` 数一遍
 *
 * 🔴 `SKIPPED` 必须**单列**出来，不能并进 `error`：那是指纹撞车被去重
 *    （这批里本来就有 30 条在库里），不是导坏了。
 *    并到一起的表现是用户以为「失败了 30 条」，于是重导一次 ——
 *    而重导多少次结果都一样，因为撞的还是同一批指纹
 */
export const summarizeIssues = (issues?: QlzgCaseImportIssueVO[] | null): QlzgIssueSummary => {
  const summary: QlzgIssueSummary = { error: 0, warning: 0, skipped: 0 }
  for (const issue of issues ?? []) {
    if (issue.level === 'ERROR') summary.error++
    else if (issue.level === 'WARNING') summary.warning++
    else if (issue.level === 'SKIPPED') summary.skipped++
  }
  return summary
}

/**
 * 预检结果里有没有「不该继续」的东西
 *
 * 🔴 判据是 **`fileIssues` 非空**，不是 `invalidCount > 0`：
 *    §11.2.3 要求**行级错误、不整批失败**，所以 200 条里有 7 条错是**正常**的，
 *    用户看完失败报告照样可以点「开始导入」（那 193 条会进去）。
 *    而文件级问题（表头缺列、文件根本不是 xlsx、超过行数上限）是整份都废，
 *    点下去只会得到同一句报错
 *
 * @return 可以继续时返回 `null`，否则返回一句可直接显示的理由
 */
export const previewBlockingIssue = (preview?: QlzgCaseImportPreviewVO | null): string | null => {
  if (!preview) return '还没有预检结果'
  const fileIssues = preview.fileIssues ?? []
  if (fileIssues.length > 0) {
    return fileIssues.map((issue) => issue.message ?? issue.fieldLabel ?? '文件有问题').join('；')
  }
  if ((preview.total ?? 0) === 0) return '这份文件里没有数据行（模板里的示例行会被跳过，不算数据）'
  return null
}

/**
 * 生成一次导入的幂等键
 *
 * 🔴 **在选中文件的那一刻调用一次**，然后在「预检 → 开始导入」两步里保持不变。
 *    每次请求都新生成一个的话，双击「开始导入」就是两次导入 ——
 *    而服务端刻意**不**替你生成（缺了它报 `CASE_IMPORT_TOKEN_REQUIRED`），
 *    理由就是这一条
 *
 * 🔴 重新选文件时必须**重新生成**：换一个文件还沿用旧令牌，
 *    会被幂等键判成「同一次导入」，第二份文件的内容一条都不会进去
 */
export const newImportToken = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `tok-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

/**
 * 进度轮询该不该停
 *
 * 🔴 判后端的 `terminal` 布尔，**不要**按 `status` 枚举判：
 *    多一种终态时（例如 I6 加的「已取消」），按枚举写的停止条件会漏掉它，
 *    表现是弹窗关不掉、请求一直打
 *
 * ⚠️ 反方向也成立：**不要**因为「看着卡住了」就自己停。
 *    `/import-progress` 顺带做孤儿任务的懒回收 —— 进程被 kill 之后留下的 RUNNING 行，
 *    是由**下一次查询**判成 INTERRUPTED 的。停止轮询 ⇒ 它永远不会被回收
 */
export const shouldStopPolling = (progress?: { terminal?: boolean } | null): boolean =>
  progress?.terminal === true
