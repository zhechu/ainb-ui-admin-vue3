import request from '@/config/axios'

/**
 * 一条已冻结的口径快照 ← 后端 {@code QlzgParamSnapshotRespVO}
 *
 * <h3>🔴 这是**只读的历史**，不是参数库的视图</h3>
 * 快照在 `/qlzg/calculation/run` 那一次落库，之后参数库里那条参数怎么改都不影响它 ——
 * 这正是「口径冻结」的意义：报告出稿之后还能回答「当时用的是哪个数、依据是什么」。
 * 所以这个对象上**刻意没有** `paramName` / `unit` / `versionNo`：
 * 它们会变，而快照要的是当时那一个值。界面上要显示参数名，
 * 得从确认闸那一份（`QlzgParamConfirmItemVO.label`）或参数库另查一次，别指望这里。
 *
 * <h3>🔴 {@code reportId} 在 I3 恒为 null</h3>
 * 报告要到 I4 才有写入路径，届时由 `bindReport(...)` 回填。
 * 界面上不要渲染「所属报告」这一栏 —— 一个恒为空的列会让人以为数据丢了。
 */
export interface QlzgParamSnapshotVO {
  id: number
  reportId?: number | null
  calculationId: number
  paramId?: number | null
  paramKey: string
  frozenValueNum?: number | null
  frozenValueStr?: string | null
  frozenValueJson?: Record<string, any> | null
  sourceType?: string | null
  sourceTypeDescription?: string | null
  basis?: string | null
  /** LocalDateTime ⇒ epoch 毫秒 */
  frozenAt?: Date
  frozenBy?: number | null
  changeReason?: string | null
  /** 改过几次；0 = 从冻结那一刻起没动过 */
  changeCount: number
  /** 后端派生：{@code changeCount > 0} */
  changed?: boolean
  provenanceId?: number | null
}

/**
 * 改一个已冻结的值 ← 后端 {@code QlzgParamSnapshotChangeReqVO}
 *
 * 🔴 {@code changeReason} **必填**，后端 `PARAM_SNAPSHOT_CHANGE_REASON_REQUIRED`
 *    （1042006003）的文案是「口径已冻结，再改必须写明变更理由
 *    （《资产评估执业准则——资产评估方法》要求一经确定不得随意变更）」。
 *    所以弹窗里这一栏不能是可选的，也不要给默认值 ——
 *    一个预填了「修正」的理由框等于没有理由框，而 R08（I5）会读它。
 *
 * 🔴 三个值字段**全部**都要发：改的那一列换新值，其余两列**原样回传**。
 *    后端 `validateValueShapeUnchanged` 判的是「哪几列有值」这个形状不能变 ——
 *    原本没有的列不许带上（「改口径只能改值，不能改值的类型」），
 *    原本有的列不许清掉。所以只发改的那一列 = 把另外两列清空 = 当场被拒。
 *    装配请走 `calcFlow.ts` 的 `buildSnapshotChangeVO`，那里是这个规则唯一的实现
 */
export interface QlzgParamSnapshotChangeVO {
  id: number
  valueNum?: number | null
  valueStr?: string | null
  valueJson?: Record<string, any> | null
  changeReason: string
}

export const QlzgParamSnapshotApi = {
  /**
   * 按测算取全部冻结参数 ← `QlzgParamSnapshotController#getSnapshotListByCalculationId`
   *
   * ⚠️ 权限点是 `qlzg:param:query`（**不是** `qlzg:param-snapshot:query`）：
   *    后端刻意没有为「读快照」单开一个权限串，因为读快照的人就是能读参数的人。
   *    新权限串没有对应按钮菜单时，非超管会**静默**失去能力（全程 200 无异常）
   */
  listByCalculation: (calculationId: number): Promise<QlzgParamSnapshotVO[]> =>
    request.get({ url: '/qlzg/param-snapshot/list-by-calculation', params: { calculationId } }),

  /**
   * 改一个已冻结的值 ← `QlzgParamSnapshotController#changeFrozenValue`
   *
   * 🔴 返回的是**改完之后**的那一份，直接用它替换本地行，不要再拉一次列表 ——
   *    拉列表会丢掉滚动位置，而改值是在明细页里逐条做的
   * 🔴 权限点是 `qlzg:param-snapshot:update`，这是 I3 里**唯一**一个
   *    带 `-snapshot` 的权限串，建菜单时别漏
   */
  changeValue: (data: QlzgParamSnapshotChangeVO): Promise<QlzgParamSnapshotVO> =>
    request.put({ url: '/qlzg/param-snapshot/change-value', data })
}
