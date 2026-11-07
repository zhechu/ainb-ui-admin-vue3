import request from '@/config/axios'
import type { QlzgParamSnapshotVO } from '@/api/qlzg/paramSnapshot'

/**
 * 确认闸上**提交回来**的一项 ← 后端 {@code QlzgParamConfirmItem}（一个 record，8 个组件）
 *
 * <h3>🔴 与预览那一份（{@code QlzgParamConfirmItemVO}）不是同一个类型，别混用</h3>
 * 预览有三十来个字段（schema 段 + 命中段 + 标红段），提交只要这 8 个。
 * 把整个预览对象原样发回去**能编译过**（后端按名字取），但那等于把「用户看过的」
 * 当成「用户确认过的」—— 而这两件事的差别正是 HITL 第①闸存在的理由。
 * 所以界面上要显式装配这 8 个字段。
 *
 * <h3>🔴 {@code paramId} 必须非空：没命中的参数不能在确认闸上就地填</h3>
 * 后端的设计是「查不到就回参数库补一条，再回来确认」，而不是「在确认页上手打一个数」。
 * 手打的数没有 `basis`（依据）、没有 `sourceType`（出处），而 R36（I5）要判
 * 「每个参数都有依据」。所以未命中的那几行在界面上要显示成
 * **「去参数库新建」的链接**，不是两个输入框。
 *
 * <h3>🔴 改过值就必须给 {@code modifyReason}</h3>
 * `PARAM_CONFIRM_MODIFY_REASON_REQUIRED`（1042006020）拦的是「在确认闸上把
 * 0.06 改成 0.05 却不写为什么」。判据是**值变了**，不是 `confirmed` 是 false。
 */
export interface QlzgParamConfirmItem {
  paramKey: string
  paramId: number
  confirmed: boolean
  valueNum?: number | null
  valueStr?: string | null
  valueJson?: Record<string, any> | null
  modifyReason?: string | null
  /** 原样回传预览给的 `fallbackPath`，后端用它复核「你确认的是同一条」 */
  fallbackPath?: string | null
}

/**
 * 案例终选的一项 ← 后端 {@code QlzgCalculationRunReqVO.CaseSelection}
 *
 * 🔴 {@code selected = false} 时 {@code rejectedReason} **必填**
 *    （`CASE_MATCH_REJECT_REASON_REQUIRED`，1042006029）。
 *    剔除一条可比案例是要写进报告的程序性决定，不是界面上的一个勾选状态。
 * 🔴 只有**本次召回的候选**能被终选：拿一个库里的 caseId 硬发上来会被
 *    `CASE_MATCH_CASE_NOT_IN_CANDIDATES`（1042006030）拒。
 *    所以候选清单必须来自召回面板那一次，不要让用户去案例台账里挑。
 */
export interface QlzgCaseSelection {
  caseId: number
  selected: boolean
  rejectedReason?: string | null
}

/**
 * 跑一次测算 ← 后端 {@code QlzgCalculationRunReqVO}
 *
 * 🔴 {@code methodCode} 必须是品类 `method_codes.allowed` 里的那一个，
 *    否则 `CALCULATION_METHOD_NOT_ALLOWED`（1042006005）。
 *    而 MVP 只实现了四种（比较法 / 收益法 / 成本法 / 假设开发法），
 *    其余 20 个方法码会以 `CALCULATION_METHOD_NOT_IMPLEMENTED`（1042006010）拒回来 ——
 *    所以下拉里**只放这四个**，放 24 个的话用户会以为系统坏了。
 * 🔴 {@code caseSelections} 只有比较法需要（它 `requiresCaseSet()`）。
 *    其余三个方法传了也会被忽略，但**不要**传：那会让「这条案例参与过测算」
 *    在 `qlzg_case_match` 里留下与算式无关的行。
 */
export interface QlzgCalculationRunVO {
  subjectId: number
  methodCode: string
  paramItems: QlzgParamConfirmItem[]
  caseSelections?: QlzgCaseSelection[]
  switches?: Record<string, any>
}

/**
 * 一次测算（列表 / 概要）← 后端 {@code QlzgCalculationRespVO}
 *
 * <h3>🔴 {@code status} 有三档，`STALE` 是最容易被忽略的那一个</h3>
 * `SUCCESS` / `FAILED` / `STALE`。`STALE` 的含义是「输入已经变了但没重算」——
 * 标的属性改了、案例被终选/剔除了、参数快照被改值了，都会把已有测算标成 STALE。
 * `CALCULATION_STALE`（1042006006）的文案是「结果不可用于出稿」。
 * 界面上 STALE 要用**警示色**而不是错误色：它不是一次失败的运行，
 * 它是一次**曾经成功、现在已经过期**的运行。
 *
 * <h3>🔴 {@code reportId} 在 I3 恒为 null，{@code provenanceIds} 也恒为 null</h3>
 * 溯源写入路径归 I6。别渲染这两栏。
 */
export interface QlzgCalculationVO {
  id: number
  reportId?: number | null
  subjectId: number
  subjectName?: string
  methodCode: string
  methodName?: string
  inputSnapshot?: Record<string, any> | null
  outputSnapshot?: Record<string, any> | null
  engineVersion?: string
  resultValue?: number | null
  resultValueUpper?: number | null
  resultValueLower?: number | null
  unitPrice?: number | null
  durationMs?: number | null
  status: string
  statusDescription?: string
  errorMessage?: string | null
  provenanceIds?: number[] | null
  createTime?: Date
}

/** 算式的一步 ← 后端 {@code QlzgCalculationDetailRespVO.Step} */
export interface QlzgCalcStepVO {
  stepOrder: number
  code: string
  label?: string
  formulaText?: string
  output?: number | null
}

/**
 * 一条参与本次测算的案例 ← 后端 {@code QlzgCalculationDetailRespVO.CaseMatch}
 *
 * 🔴 {@code selected} 是 **Integer 1/0**，不是 Boolean（与提交那一份
 *    {@code QlzgCaseSelection.selected} 的 Boolean 不同）。判的时候写 `=== 1`，
 *    写 `if (row.selected)` 在 0 上恰好也对，但 `row.selected === true` 会**恒假**
 * 🔴 {@code dealDateDiffDays} 是 R32 的判据（成交日与基准日相差的天数，取了绝对值）。
 *    超过阈值时召回面板已经给过预选警示，这里是**事后**的那一份
 */
export interface QlzgCaseMatchVO {
  id: number
  caseId: number
  caseSummary?: string
  transactionPrice?: number | null
  buildingArea?: number | null
  unitPrice?: number | null
  realPriceRestored?: number | null
  restoreReason?: string | null
  transactionDate?: string | null
  dealDateDiffDays?: number | null
  score?: number | null
  scoreDetail?: Record<string, any> | null
  recallLayerHits?: number[] | null
  selected?: number
  selectedBy?: number | null
  selectedAt?: Date | null
  rejectedReason?: string | null
  sort?: number | null
}

/**
 * 测算明细 ← 后端 {@code QlzgCalculationDetailRespVO}
 *
 * 🔴 {@code fingerprint} 是「同输入同输出」的凭据（SHA-256，64 位小写十六进制），
 *    配方里混进了 `engineVersion`。它要**显示出来**并允许复制：
 *    两次测算的指纹相同 = 口径与算法都没变，这是复核人唯一能一眼验的东西。
 * 🔴 {@code disclosures} 是一个开放的 Map，键由方法自己决定
 *    （例：`development_kind` / `negative_value` / `area_type_mismatch`）。
 *    渲染时按「键 → 值」逐条列出，不要挑几个认识的显示：
 *    少显示一条披露，在报告里就是一个漏掉的限制条件。
 */
export interface QlzgCalculationDetailVO {
  calculation: QlzgCalculationVO
  frozenParams: QlzgParamSnapshotVO[]
  caseMatches: QlzgCaseMatchVO[]
  steps: QlzgCalcStepVO[]
  disclosures?: Record<string, any> | null
  fingerprint?: string
  resultValue?: number | null
  formulaText?: string
}

export const QlzgCalculationApi = {
  /**
   * 跑一次测算 ← `QlzgCalculationController#runCalculation`
   *
   * 🔴 返回的是**测算 id**，不是结果。而且 **FAILED 也会返回 id** ——
   *    失败的运行同样落库（`status = FAILED` + `errorMessage`），因为
   *    「算不出来」本身是要留痕的。所以拿到 id 之后**必须**再调 `/get-detail`，
   *    不要按「有没有报错」来判断这次跑得怎么样。
   * 🔴 这一次同时做三件写库的事：冻结参数快照、写 `qlzg_case_match`（终选结果）、
   *    以及按召回充足度写 `qlzg_project.procedure_limited`。所以它**不是幂等**的，
   *    点两次会产生两条测算记录 —— 提交按钮必须在请求期间禁用。
   * ⚠️ 权限点是 `qlzg:calculation:create`
   */
  run: (data: QlzgCalculationRunVO): Promise<number> =>
    request.post({ url: '/qlzg/calculation/run', data }),

  getCalculation: (id: number): Promise<QlzgCalculationVO> =>
    request.get({ url: '/qlzg/calculation/get', params: { id } }),

  /**
   * 按标的取全部测算 ← `QlzgCalculationController#getCalculationListBySubject`
   *
   * 🔴 **不过滤**：FAILED 与 STALE 的行都在里面。这是刻意的 ——
   *    结果确定那一步要让人看见「试过的都在这儿」，而不是只看见成功的。
   *    要挑参与综合的那几条，是**前端**按 `status === 'SUCCESS'` 筛，
   *    并把筛掉的那几条灰着列出来
   */
  listBySubject: (subjectId: number): Promise<QlzgCalculationVO[]> =>
    request.get({ url: '/qlzg/calculation/list-by-subject', params: { subjectId } }),

  getDetail: (id: number): Promise<QlzgCalculationDetailVO> =>
    request.get({ url: '/qlzg/calculation/get-detail', params: { id } })
}
