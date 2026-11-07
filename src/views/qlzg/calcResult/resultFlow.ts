import type { QlzgCalculationVO } from '@/api/qlzg/calculation'
import type {
  QlzgCalcResultDetermineVO,
  QlzgCalcResultWeightItemVO
} from '@/api/qlzg/calcResult'
import { combineTypeNeedsFinalValue } from '@/views/qlzg/constants'
import { methodNameOf } from '@/views/qlzg/calculation/calcFlow'

/**
 * 结果确定页的**全部判定**（纯模块，被 `resultFlow.spec.ts` 钉住）
 *
 * <h3>🔴 这里刻意【不抄】任何一个规则参数</h3>
 * 本模块里搜不到「50」「0.20」「2000」「10000000000000000」这几个数，也搜不到
 * 「经综合分析」「综合确定」这两句禁语。它们分别是 R08 的字数下限、R09 的离散度阈值、
 * `determination_reason` 的列宽、`QlzgMoneyWords.MAX_YUAN_EXCLUSIVE`，
 * 以及 R08 `expr_params.banPhrases` 的平台默认值 —— **每一个都已经在后端有一份**，
 * 而且后端的报错文案比前端能拼出来的任何提示都更完整（它会说「只有 32 个字，少于 R08
 * 要求的 50 个字」，而前端要说这句就得先抄那个 50）。
 *
 * <p>抄一份的代价不是「多一行常量」，是**两份真相**：I5 接通 `p.*` 解析之后这些数会变成
 * 机构可调的，届时后端那份跟着机构走、前端这份留在原地，界面上的提示就开始说谎 ——
 * 而一句说「你写得不够」却给不出正确门槛的提示，比没有提示更让人反复试。
 * 所以本页的做法是：**不预校验这些，把后端那句原文显示出来**。
 * `noRuleParameterIsCopied` 那条用例钉住这件事。
 *
 * <h3>🔴 与后端 `assemble` 的校验顺序对齐</h3>
 * 后端是「参与了什么 → 权重 → 最终值 → 理由」，且**权重内部**又是
 * 「逐项（理由、正负）→ 覆盖面 → 之和」。这个顺序是有理由的（后端注释写了）：
 * 覆盖面与和都对不上时先报和的话，用户会把每一项都除以 1.5 让和变成 1，
 * 得到一份**和对了、覆盖面仍然错**的权重，然后第二次提交才看到覆盖面问题 —— 两个来回，
 * 第一次的修改白做。{@link determineErrors} 照抄这个顺序。
 *
 * <h3>⚠️ 前端唯一比后端严的地方</h3>
 * {@link buildDetermineVO} 的权重表是**从参与清单生成**的，不是从草稿数组直接取，
 * 所以「漏给一条权重 / 给了一条没参与的权重 / 同一条给了两次」这三种在后端要报
 * `CALC_RESULT_WEIGHTS_MISMATCH` 的形状，在这里**构造不出来**。
 * 剩下的只有「理由没写」「不是正数」「之和不等于 1」三种真错误。
 */

// ==================== 权重草稿 ====================

/** 一条参与测算的权重草稿 */
export interface WeightDraft {
  calculationId: number
  /** 🔴 `null` 是「还没填」，与 `0` 不是一回事：0 会被后端按「不是正数」拒，而 null 是「没填」 */
  weight: number | null
  reason: string
}

/**
 * 按参与清单建权重草稿
 *
 * 🔴 权重一律**留空**，不预填等权：预填 `1/N` 等于平台给了一个推荐权重，
 *    而 `QlzgCombineTypeEnum` 的类注释明写「权重是专业判断，给推荐值等于替评估师做判断，
 *    一旦出错责任不清」。三项等权要人自己写 0.3334 / 0.3333 / 0.3333 ——
 *    那一次书写本身就是「这个分配是我定的」的留痕。
 */
export const loadWeightDrafts = (participants: QlzgCalculationVO[]): WeightDraft[] =>
  participants.map((row) => ({ calculationId: row.id, weight: null, reason: '' }))

const draftOf = (drafts: WeightDraft[], calculationId: number): WeightDraft | undefined =>
  drafts.find((item) => item.calculationId === calculationId)

/**
 * 把草稿数组收窄成「只含当前参与清单里那些」
 *
 * 🔴 **和与覆盖面都必须按这一份算**，不能直接拿页面上的草稿数组去算：
 *    用户先勾了三条测算、填了权重，又取消勾选第三条 —— 草稿数组里第三条那一项还在
 *    （它是被 `loadWeightDrafts` 建的，取消勾选时不该去删别人的状态，删了的话
 *    再勾回来就要重填）。直接对它求和会得到一个**含已退出者**的和，
 *    于是「0.4 + 0.6 + 已退出的 0.3」显示成 1.3，而真正要提交的只有 0.4 与 0.6。
 *    这类错误的表现是「我明明填的是 4:6，界面说和是 1.3」。
 */
export const draftsOfParticipants = (
  participants: QlzgCalculationVO[],
  drafts: WeightDraft[]
): WeightDraft[] =>
  participants
    .map((row) => draftOf(drafts, row.id))
    .filter((item): item is WeightDraft => item != null)

/**
 * 权重之和
 *
 * <h3>🔴 不能直接 `reduce((a, b) => a + b)` 然后 `=== 1`</h3>
 * 后端用 `BigDecimal.compareTo(BigDecimal.ONE)`，判的是**十进制精确相等**；
 * 而 JS 的 number 是 IEEE-754 双精度，实测：
 * `0.06 + 0.57 + 0.37` = `0.9999999999999999`，`!== 1`。
 * 三项百分比组合（1%–98% 的全排列）里有 **204 组**是这样一个完全合法的分配会被判成「之和不等于 1」；
 * 四位小数（0.3334 那一档）的三元组合里更是有 **267 万组**。
 * 表现是评估师把权重调到明明和为 1、界面上却一直红着，而他没有任何办法让它变绿 ——
 * 这类「拨不动的输入」最后总是以「换个浏览器试试」收场。
 *
 * <p>所以这里用 `toPrecision(12)` 把二进制噪声洗掉再比。12 位与 `calcFlow.ts` 里
 * 百分数换算用的是同一个精度：够洗掉 double 的末位误差（相对误差量级 10⁻¹⁶），
 * 又远小于权重真实的小数位数（4 位），不会把「真的不等于 1」也洗成等于 1。
 *
 * <p>🔴 `null`（还没填）**跳过**，不当 0：当 0 的话「填了两项 0.5、第三项还没填」
 *    会显示成「和 = 1」，于是用户以为可以提交了，而提交上去后端会先报「第三项没填」。
 *    「还没填完」与「填完了但和不对」是两种处境，界面上要分得开。
 */
export const weightSum = (drafts: WeightDraft[]): number => {
  const raw = drafts.reduce(
    (sum, item) => (item.weight == null ? sum : sum + Number(item.weight)),
    0
  )
  return Number(raw.toPrecision(12))
}

/** 权重之和是不是**正好** 1 */
export const weightSumIsOne = (drafts: WeightDraft[]): boolean => weightSum(drafts) === 1

/**
 * 和为 1 时给一句绿的、否则给一句说明差多少
 *
 * 🔴 **「还没填完」必须排在「和为 1」之前判**：{@link weightSum} 把 null 跳过，
 *    于是两项各填 0.5、第三项还没填时和已经是 1 了。先看和的话这一栏会说「可以提交」，
 *    而提交按钮那边（{@link weightErrors} 逐项报「还没填」）是灰的 ——
 *    一个说行、一个说不行，用户只会认为界面卡了。
 * 🔴 差值也要洗噪声：`1 - 0.9999999999999999` 是 `1.1102230246251565e-16`，
 *    直接显示出来是一串科学计数法，读作「你差了一点点但说不清多少」。
 */
export const weightSumText = (drafts: WeightDraft[]): string => {
  const filled = drafts.filter((item) => item.weight != null).length
  const sum = weightSum(drafts)
  if (filled < drafts.length) {
    return `还有 ${drafts.length - filled} 项没填权重（现在填了的这些之和是 ${sum}）`
  }
  if (sum === 1) return '权重之和 = 1，可以提交'
  const diff = Number((1 - sum).toPrecision(12))
  return `权重之和是 ${sum}，与 1 差 ${diff}。它必须正好是 1，后端不会替你归一化`
}

// ==================== 取舍理由 ====================

/**
 * 取舍理由的字数（**trim 之后**）
 *
 * 🔴 与后端逐字对齐：后端是 `reason.trim()` 之后取 `text.length()`。
 *    不 trim 的话，用户在末尾敲几个空格就能凑够字数，而落库的那一份是 trim 过的 ——
 *    于是「界面上说够了」与「后端说不够」当场打架。
 *
 * 🔴 用 `String#length`（UTF-16 码元），**不要**「改成」`[...text].length`（码点）。
 *    看着像修 bug，实际是把两份口径拆开：Java 的 `String#length()` 也是 UTF-16 码元，
 *    所以两边对汉字都是 1、对 emoji 都是 2，**恰好一致**。
 *    按码点数会对 emoji 少算 1，而理由里贴一个 emoji 是完全可能的。
 */
export const reasonCharCount = (reason?: string | null): number => (reason ?? '').trim().length

// ==================== 阻断项 ====================

/** 结果确定表单的草稿 */
export interface DetermineDraft {
  subjectId: number | null
  /**
   * 已选中的参与测算。
   *
   * 🔴 顺序**敏感**：后端不排序，`calculationIds` 原样落库，而它的顺序
   *    「即报告上的展示顺序」（`QlzgCalcResultRespVO.calculationIds`）。
   *    页面给的是**台账顺序**，不是点击顺序 —— `el-table` 的 selection 数组
   *    是按点击先后排的，而那个顺序用户自己既看不见也控制不了，
   *    落进 30 年的档案就成了「同一批测算两次确定的展示顺序不一样」
   */
  participants: QlzgCalculationVO[]
  combineType: string
  weights: WeightDraft[]
  finalValue: number | null
  valueType: string
  determinationReason: string
}

/**
 * 权重那几步的阻断项
 *
 * 🔴 顺序照后端：**逐项**（理由 → 正负）→ **之和**。
 *    覆盖面（漏项 / 多项 / 重复）刻意不在这里查 —— {@link buildDetermineVO}
 *    从参与清单生成权重表，那三种形状构造不出来。
 * 🔴 之和按 {@link draftsOfParticipants} 收窄后的那一份算，理由见它的注释。
 */
export const weightErrors = (
  participants: QlzgCalculationVO[],
  drafts: WeightDraft[]
): string[] => {
  const errors: string[] = []
  for (const row of participants) {
    const name = methodNameOf(row.methodCode, row.methodName)
    const draft = draftOf(drafts, row.id)
    if (!draft) {
      // 这一支不该出现：草稿是随参与清单一起建的。真出现了要**说出来**，
      // 而不是把它当成「理由没写」—— 后者会把一个界面 bug 报成用户的错
      errors.push(`「${name}」的权重行没有建出来，请刷新页面后重试`)
      continue
    }
    if (!draft.reason.trim()) {
      errors.push(
        `「${name}」的权重理由没写 —— 平台刻意不给推荐权重，` +
          '这一次分配的依据只能由你写下来，而 R08 会读它'
      )
      continue
    }
    if (draft.weight == null) {
      errors.push(`「${name}」的权重还没填`)
      continue
    }
    if (!(draft.weight > 0)) {
      errors.push(
        `「${name}」的权重是 ${draft.weight}，必须是正数 —— ` +
          '一条测算占了 0 权重就等于没参与，那它不该出现在参与清单里'
      )
    }
  }
  const scoped = draftsOfParticipants(participants, drafts)
  if (scoped.length && scoped.some((item) => item.weight != null) && !weightSumIsOne(scoped)) {
    errors.push(weightSumText(scoped))
  }
  return errors
}

/**
 * 「确定」按钮的阻断项
 *
 * 🔴 **刻意不查**的三样（理由见文件头）：理由字数与禁语（R08）、离散度（R09）、
 *    最终值的上限（`MAX_YUAN_EXCLUSIVE`）。RANGE 档的区间也**不查** ——
 *    上下界是后端从参与测算的 `result_value` 上取 min/max **算**出来的
 *    （`qlzg_calc_result` 里根本没有存区间的两列），前端自己算一遍就是第二份口径。
 */
export const determineErrors = (draft: DetermineDraft): string[] => {
  const errors: string[] = []
  if (!draft.subjectId) {
    errors.push('这一页要从标的台账进来 —— 只有一个标的编号时才知道能挑哪些测算')
    return errors
  }
  if (!draft.combineType) {
    errors.push('还没有选综合方式')
  }
  if (!draft.participants.length) {
    errors.push('至少要挑一条测算参与综合')
  }
  if (draft.combineType === 'SINGLE' && draft.participants.length !== 1) {
    errors.push(
      `「单一方法」只能有一条测算参与，现在挑了 ${draft.participants.length} 条。` +
        '要综合多条请改选算术平均、加权、区间或专业判断'
    )
  }
  if (draft.combineType === 'WEIGHTED') {
    errors.push(...weightErrors(draft.participants, draft.weights))
  }
  if (combineTypeNeedsFinalValue(draft.combineType) && draft.finalValue == null) {
    errors.push(
      `「${draft.combineType === 'RANGE' ? '区间' : '专业判断'}」这一档的最终评估值由你给出，` +
        '后端不会替你算'
    )
  }
  if (!draft.determinationReason.trim()) {
    errors.push('取舍理由必填 —— 这一段是 R08 的判据，也是报告里「为什么取这个值」的出处')
  }
  return errors
}

// ==================== 装配请求体 ====================

/**
 * 装配 `/qlzg/calc-result/determine`（与 `/preview`）的请求体
 *
 * <h3>🔴 权重表**从参与清单生成**</h3>
 * 于是它与 `calculationIds` 天然一一对应：漏项、多项、重复三种形状都构造不出来。
 * 没填的那一项落成 `weight: 0`、`reason: ''` —— 这不是「偷偷塞一个 0 上去」，
 * 而是让 {@link weightErrors} 先把这两种情况拦住（0 不是正数、空理由），
 * 提交按钮在那之前就灰着。
 *
 * <h3>🔴 非 WEIGHTED 档**不发** `weights`，非手填档**不发** `finalValue`</h3>
 * 后端对这两样都是「忽略」而不是「报错」，所以留着残留不会失败 ——
 * 但它也不会落库，于是「我明明填了权重，怎么档案里没有」变成一次排查。
 * 切换综合方式时把残留摘掉，比让它发上去再被忽略诚实。
 *
 * <h3>🔴 `determinationReason` **不 trim**</h3>
 * 后端自己 `trim()` 之后落库。前端先 trim 的话，用户看见的字数与发出去的字符串就不是一回事；
 * 而 {@link reasonCharCount} 已经按 trim 后的长度报数，两边不会打架。
 */
export const buildDetermineVO = (draft: DetermineDraft): QlzgCalcResultDetermineVO => {
  const weighted = draft.combineType === 'WEIGHTED'
  const weights: QlzgCalcResultWeightItemVO[] | undefined = weighted
    ? draft.participants.map((row) => {
        const item = draftOf(draft.weights, row.id)
        return {
          calculationId: row.id,
          weight: item?.weight ?? 0,
          reason: item?.reason ?? ''
        }
      })
    : undefined
  return {
    subjectId: draft.subjectId ?? 0,
    calculationIds: draft.participants.map((row) => row.id),
    combineType: draft.combineType,
    weights,
    finalValue: combineTypeNeedsFinalValue(draft.combineType) ? draft.finalValue : undefined,
    valueType: draft.valueType?.trim() || null,
    determinationReason: draft.determinationReason
  }
}

// ==================== 读模型上的取值 ====================

/**
 * 一条参与测算在界面上叫什么（后端给了就用后端的，没给就按码查表）
 *
 * 🔴 **权重不在这里取**：渲染一条已确定的结果时，权重与权重理由读
 *    `result.participants[].weight` / `.weightReason` —— 后端
 *    `QlzgCalcResultServiceImpl#toParticipants` 已经把 JSON 列 `weights`
 *    摊平到参与测算清单上了（键是测算编号的字符串形式，它自己按
 *    `String.valueOf(calculationId)` 查）。前端再按同一个键查一遍
 *    就是**同一个事实的第二条取值路径**：两条路径哪天不一致，
 *    界面上会出现「权重列有值、而那一格是空的」这种查不出来源的显示。
 */
export const participantName = (row?: {
  methodCode?: string | null
  methodName?: string | null
} | null): string => methodNameOf(row?.methodCode, row?.methodName)

/**
 * 导出文件名里「台账名」那一段
 *
 * 🔴 走 `buildExportFilename(base, false, 1, false)` 时它只负责补 `.xlsx`，
 *    所以**区分度全靠 base**：几个标的的计算成果表混在下载目录里，
 *    叫「计算成果表.xlsx」的文件一个都认不出来。
 * 🔴 标的名可能为空（历史数据 / 接口失败），回落成编号，**不要**回落成空串 ——
 *    空串会得到一个叫「计算成果表.xlsx」的文件，恰好是最没用的那个名字。
 * ⚠️ 文件名里不能带 `/ \ : * ? " < > |`（Windows 保留字符），
 *    标的名是自由文本，实测有人会把地址整串填进去。
 * 🔴 它**只到标的名为止**，不含「哪一次确定」：导出是按一次确定导的
 *    （`exportCalcSheet(id)`），而同一个标的可以确定多次，所以调用方要再接一段
 *    `-#编号`。这一层刻意不放在这里 —— 本函数管的是「标的名怎么洗成合法的文件名」，
 *    编号从哪来是页面的事
 */
export const calcSheetFilenameBase = (
  subjectName?: string | null,
  subjectId?: number | null
): string => {
  const cleaned = (subjectName ?? '')
    .trim()
    .replace(/[/\\:*?"<>|]/g, '_')
    .slice(0, 40)
  return `计算成果表-${cleaned || (subjectId ? `标的${subjectId}` : '未知标的')}`
}

// ==================== 五档的界面说明 ====================

/**
 * 每一档综合方式在界面上要说的那一句
 *
 * <h3>🔴 这里**一个规则参数都不写**</h3>
 * 没有字数下限、没有离散度阈值、没有金额上限、没有列宽。
 * `noRuleParameterIsCopied` 会把本记录里的全部文本扫一遍。
 *
 * <h3>⚠️ 也没有「建议 6:4」这类推荐权重</h3>
 * `QlzgCombineTypeEnum` 的类注释写了理由：放了就会有人点，点了之后
 * `determination_reason` 里写的是平台的建议，而《资产评估法》第二十六条要的是
 * **评估师**的分析。
 */
export const COMBINE_TYPE_HINTS: Record<string, string> = {
  SINGLE:
    '只挑一条测算，最终值就取那一条的结果。选它等于承认本报告只用了一种方法，复核会命中 R02（方法数不少于两种），届时要走豁免并留下理由。',
  ARITHMETIC_MEAN:
    '最终值由后端取参与测算的算术平均，页面上填的金额不会被读。这一档不要权重。',
  WEIGHTED:
    '逐项给权重与理由，权重之和必须正好是 1，后端不会替你归一化。平台刻意不给推荐权重——权重分配是这次确定里最需要你负责的一步。',
  RANGE:
    '最终值由你在参与测算的最小值与最大值之间取。超出这个区间会被拦下，因为那个数不是从这几次测算来的；要另给一个区间外的值请改用「专业判断」。',
  PROFESSIONAL_JUDGMENT:
    '最终值由你直接给出，可以在区间外。这一档没有任何算式可以回头核对，取舍理由是唯一的依据，复核对它要求最严。'
}

/** 某档要不要显示权重表 */
export const combineTypeNeedsWeights = (combineType?: string): boolean =>
  combineType === 'WEIGHTED'
