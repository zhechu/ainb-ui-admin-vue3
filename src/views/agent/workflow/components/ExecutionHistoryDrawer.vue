<!--
  执行历史抽屉（增量8 / P4 第一刀）

  按 workflowDefId 拉执行分页；行展开 → 懒加载该执行的节点级 trace 子表。
  🔴 管理端全租户视角（由 agent:workflow:query 把关、租户隔离自动），区别于用户「只看自己」的执行列表。
  状态无数据字典，用本地 map 渲染 tag。空态用 el-empty。

  🔴 重构 S4a-h：INTERRUPTED 行多两个动作「恢复 / 拒绝」，调已有的
  POST /agent/workflow/resume-stream（零后端改动）。加它的理由见 §2-D10：
  本抽屉此前是**只读**的，而 AssistantChat 撞到闸口时会提示「可在流程执行页恢复」——
  那个页不存在，于是运维拿着一条卡死的执行无处可点。
  ⚠️ 批一口径：恢复成功后**不**告知「本次丢弃了哪些未声明变量」（那是 V19 的读取期对偶，
  落 S13 / 批二，见 §7.4-G 推荐的 G1）。这不是漏项，S13 会往 onResume 那个确认框里补。

  🔴 迭代七 B3-9：再加第三个动作「取消」，调新增的 POST /agent/workflow/cancel（权限
  agent:workflow:cancel，SQL 见 xpy-2026-10-07-agent-workflow-cancel-perm.sql）。
  加它的理由是 B3-1/B3-2 的后半截：本轮之前「取消」这件事在系统里**根本没有对应动作**，
  用户想停下唯一办法是关掉 SSE —— 而 .doOnCancel 会把它写成 FAILED 并触发 Saga 反做，
  等于「按停止键 → 记一次故障 → 再把已经做完的动作反做一遍」，三处全错。
  三处口径（与后端注释一一对应，改一处要改三处）：
  · 按钮**看服务端派生的 row.cancellable**，不在前端抄一份状态集合（G14）。集合的唯一出处是
    WorkflowExecutionStatusEnum.CANCELLABLE，同时喂 Java 准入闸与 casToCancelled 的 SQL IN。
  · CANCELLED 的 tag 用 info（灰），**不用 danger**：红会把它和 FAILED 在视觉上重新混成一件事，
    而本轮的全部意义就是把这两件事分开。
  · 确认框必须讲清「取消不是撤销」：它是记账，不是中断线程（在跑的节点会跑完），
    已发生的副作用不回收且**刻意不补偿**，且 CANCELLED 不可 resume（A-Ⅰ）。
-->
<template>
  <el-drawer
    v-model="visible"
    :title="`执行历史 · ${title}`"
    size="65%"
    append-to-body
    destroy-on-close
  >
    <el-table v-loading="loading" :data="list" stripe row-key="id" @expand-change="onExpandChange">
      <el-table-column type="expand">
        <template #default="{ row }">
          <div class="px-40px py-8px">
            <el-table
              v-loading="traceLoading[row.id]"
              :data="tracesMap[row.id] ?? []"
              size="small"
              border
            >
              <!-- 🔴 节点 id 保持显示机器 id（与设计器里画的一致，运维就是拿它对回去找节点），
                   显示名（node_name，迭代六 D2）挂在 title 上 —— 与隔壁「类型」列「中文在外、原始 type 在 title」
                   同一个套路。不单独开一列：子表已经 7 列，而名字对排障是辅助信息不是定位信息。 -->
              <el-table-column label="节点 id" min-width="140" show-overflow-tooltip>
                <template #default="scope">
                  <span :title="scope.row.nodeName">{{ scope.row.nodeId }}</span>
                </template>
              </el-table-column>
              <!-- 🔴 类型中文化（重构 S1 / L1）：原来直出 condition.rule 这类 DSL 原始 type，
                   运维看执行历史时得先背一遍 13 种类型名。原始 type 留在 title 里，排障时悬停可看。 -->
              <el-table-column label="类型" width="130" show-overflow-tooltip>
                <template #default="scope">
                  <span :title="scope.row.nodeType">{{
                    nodeTypeMeta(scope.row.nodeType).label
                  }}</span>
                </template>
              </el-table-column>
              <!-- 工具（迭代六 D2）：这一列以前**压根不存在**，因为后端 trace 行里就没有 tool_id ——
                   tool 节点执行时明明把 toolId 传给了工具执行器（还强校验了非空），却没落库，
                   于是运维看到一行失败的 tool trace 只知道「某个工具炸了」。
                   🔴 空格子**不要**渲染成告警标：为空有三种含义，其中「agent_loop 的 act 行」是按构造
                      永远为空的（每步现选只读工具，不存在单一 toolId），给它打标会把每一轮循环都染成黄色、
                      真出问题的行反而看不出来。详见 AgentNodeExecutionVO.toolId 的注释。 -->
              <el-table-column label="工具" prop="toolId" min-width="120" show-overflow-tooltip />
              <el-table-column label="状态" prop="status" width="110">
                <template #default="scope">
                  <el-tag :type="execTagType(scope.row.status)" size="small">
                    {{ execLabel(scope.row.status) }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="尝试" prop="attempt" width="60" align="center" />
              <el-table-column label="token" prop="totalTokens" width="80" align="right" />
              <el-table-column label="耗时(ms)" prop="durationMs" width="90" align="right" />
              <el-table-column
                label="失败原因"
                prop="errorMsg"
                min-width="160"
                show-overflow-tooltip
              />
            </el-table>
            <el-empty
              v-if="!traceLoading[row.id] && (tracesMap[row.id] ?? []).length === 0"
              description="该执行暂无节点级 trace"
              :image-size="60"
            />
          </div>
        </template>
      </el-table-column>
      <el-table-column label="执行编号" prop="id" width="90" align="center" />
      <el-table-column label="版本" prop="workflowVersion" width="70" align="center" />
      <el-table-column label="状态" prop="status" width="130" align="center">
        <template #default="scope">
          <el-tag :type="execTagType(scope.row.status)" size="small">
            {{ execLabel(scope.row.status) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="当前节点" prop="currentNode" min-width="130" show-overflow-tooltip />
      <!-- 🔴 与「当前节点」并列摆，就是为了让这两格的差别看得见（迭代六 D1）：当前节点是「最后**跑完了**的」，
           挂起闸口是「被 interruptsBefore 拦下、正在等的」。以前只有前者，救援按钮因此说不清要恢复哪里 ——
           挂起节点只存在内存的 interruptedNode 里，刷新即丢，抽屉上根本没有这一格。 -->
      <el-table-column label="挂起闸口" min-width="130" show-overflow-tooltip>
        <template #default="{ row }">
          <span v-if="row.suspendNode">{{ row.suspendNode }}</span>
          <el-tooltip
            v-else-if="row.status === 'INTERRUPTED'"
            :content="SUSPEND_NODE_UNKNOWN"
            placement="top"
          >
            <el-tag type="warning" size="small">未知</el-tag>
          </el-tooltip>
        </template>
      </el-table-column>
      <el-table-column label="触发用户" prop="userId" width="90" align="center" />
      <el-table-column label="耗时(ms)" prop="durationMs" width="90" align="right" />
      <el-table-column label="开始时间" prop="beginTime" width="180" :formatter="dateFormatter" />
      <el-table-column label="失败原因" prop="errorMsg" min-width="160" show-overflow-tooltip />
      <el-table-column label="操作" width="250" align="center" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="onReplay(row.id)">画布回放</el-button>
          <!-- 🔴 只在 INTERRUPTED 行出现：其余状态调 resume 后端会直接抛 STATE_INVALID
               （AgentWorkflowExecutionServiceImpl#resume 的 isResumable 守卫），摆出来只是让人点了看报错。
               这两个按钮是 §2-D10「卡死执行」的最后一条出路 —— V13 只拦得住**新发布**的无头流程，
               已经卡在 INTERRUPTED 的存量执行此前**没有任何 UI 能救**（路存在但等于不存在）。 -->
          <template v-if="row.status === 'INTERRUPTED'">
            <el-button
              link
              type="success"
              :loading="resuming[row.id] === 'approve'"
              :disabled="!!resuming[row.id]"
              @click="onResume(row, true)"
            >
              恢复
            </el-button>
            <el-button
              link
              type="danger"
              :loading="resuming[row.id] === 'reject'"
              :disabled="!!resuming[row.id]"
              @click="onResume(row, false)"
            >
              拒绝
            </el-button>
          </template>
          <!-- 🔴 取消（迭代七 B3-2 / B3-9）。判据用**服务端派生**的 row.cancellable，
               不要在这里重写 `['CREATED','RUNNING','INTERRUPTED'].includes(row.status)` ——
               后端那份集合（WorkflowExecutionStatusEnum#isCancellable）同时喂 cancel 的预检与
               casToCancelled 的 SQL IN；前端再抄一份，等第 05 轮（B3-4）或 A-Ⅰ 复议改动它时
               就会出现「按钮亮着、点了被拒」。与 AgentWorkflowDefVO.editable 同一条纪律（G14）。
               ⚠️ INTERRUPTED 行也会出这个按钮，且那是**有意**的：挂起中的执行没有活着的流可断，
                  POST cancel 是「卡在闸口上没人管」时唯一的收尾手段（否则它永远挂在等待确认）。 -->
          <template v-if="row.cancellable">
            <!-- 🔴 v-hasPermi 只挂在这个新按钮上：隔壁 恢复/拒绝 至今**没有**权限指令
                 （它们要 agent:workflow:run），给它们补属于另一刀的一致性收尾，本轮不夹带。
                 这里挂上是为了不让「只有 query 权」的管理员看见一个点了就 403 的按钮 ——
                 那正是本模块头号缺陷「配了、存在了、但不生效且没提示」的形状。 -->
            <el-button
              link
              type="warning"
              :loading="cancelling[row.id]"
              :disabled="!!cancelling[row.id]"
              v-hasPermi="['agent:workflow:cancel']"
              @click="onCancel(row)"
            >
              取消
            </el-button>
          </template>
        </template>
      </el-table-column>
    </el-table>

    <el-empty v-if="!loading && list.length === 0" description="暂无执行记录" :image-size="80" />

    <Pagination
      :total="total"
      v-model:page="queryParams.pageNo"
      v-model:limit="queryParams.pageSize"
      @pagination="getList"
    />

    <!-- 节点级执行回放画布（增量15 / P4 后续刀）：把某次执行的 trace 叠加到该版本的流程图上 -->
    <WorkflowReplayDialog ref="replayRef" />
  </el-drawer>
</template>

<script lang="ts" setup>
import { ElMessageBox } from 'element-plus'
import { dateFormatter } from '@/utils/formatTime'
import {
  AgentWorkflowApi,
  type AgentNodeExecutionVO,
  type AgentWorkflowExecutionVO
} from '@/api/agent/workflow'
import WorkflowReplayDialog from './WorkflowReplayDialog.vue'
import { nodeTypeMeta } from '../nodeSummary'

defineOptions({ name: 'ExecutionHistoryDrawer' })

const message = useMessage()

const replayRef = ref()

/** 打开画布回放：把该执行的节点 trace 叠加到其流程图版本上 */
const onReplay = (executionId: number) => {
  replayRef.value?.open(executionId)
}

const visible = ref(false)
const loading = ref(false)
const title = ref('')
const list = ref<AgentWorkflowExecutionVO[]>([])
const total = ref(0)
const queryParams = reactive({
  pageNo: 1,
  pageSize: 20,
  workflowDefId: undefined as number | undefined
})

/** 节点级 trace 懒加载缓存：executionId → trace 列表 */
const tracesMap = reactive<Record<number, AgentNodeExecutionVO[]>>({})
const traceLoading = reactive<Record<number, boolean>>({})

/** 执行状态本地 map（无数据字典），与后端 WorkflowExecutionStatusEnum 一致 */
const EXEC_LABELS: Record<string, string> = {
  CREATED: '已创建',
  RUNNING: '运行中',
  INTERRUPTED: '等待确认',
  SUCCEEDED: '成功',
  FAILED: '失败',
  // 🔴 迭代七 B3-2 新增。漏掉这一格的表现是状态列直接印机器串「CANCELLED」——
  //    不报错、不难看，只是运维得自己猜它跟「失败」有什么区别（而区别正是本轮的全部意义）
  CANCELLED: '已取消',
  COMPENSATING: '补偿中',
  COMPENSATED: '已补偿',
  COMPENSATION_FAILED: '补偿失败'
}
const execLabel = (status: string) => EXEC_LABELS[status] ?? status
const execTagType = (status: string): 'primary' | 'success' | 'warning' | 'danger' | 'info' => {
  if (status === 'SUCCEEDED') return 'success'
  if (status === 'FAILED' || status === 'COMPENSATION_FAILED') return 'danger'
  if (status === 'INTERRUPTED') return 'warning'
  if (status === 'RUNNING' || status === 'CREATED') return 'primary'
  // 🔴 CANCELLED 显式落 'info'（灰），**刻意不给 'danger'**：本轮把「用户按了停」从 FAILED 里拆出来，
  //    若它在界面上仍旧是一片红，那两件事在运维眼里就还是同一件 —— 数据分开了、视觉没分开，
  //    等于只修了三层错里的一层。灰 = 「停下来了，但不是故障」。
  //    写在兜底 return 之前，是为了让这一档在代码里**看得见**，而不是靠「碰巧落到兜底」成立。
  if (status === 'CANCELLED') return 'info'
  return 'info' // COMPENSATING / COMPENSATED 及未知
}

const getList = async () => {
  loading.value = true
  try {
    const data = await AgentWorkflowApi.getExecutionPage(queryParams)
    list.value = data.list
    total.value = data.total
  } finally {
    loading.value = false
  }
}

/** 展开行时懒加载该执行的节点 trace（已缓存则不重复请求） */
const onExpandChange = async (row: AgentWorkflowExecutionVO) => {
  if (tracesMap[row.id]) return
  traceLoading[row.id] = true
  try {
    tracesMap[row.id] = await AgentWorkflowApi.getNodeTrace(row.id)
  } finally {
    traceLoading[row.id] = false
  }
}

// ========== 挂起执行的兜底救援（重构 S4a-h / §2-D10） ==========

/** 正在恢复中的执行：executionId → 哪个动作。既让按钮转圈，也挡住同一行被连点两次 */
const resuming = reactive<Record<number, 'approve' | 'reject'>>({})
/** 每行一个 AbortController：抽屉 destroy-on-close，关掉时要把在途的流掐掉 */
const resumeAborts = new Map<number, AbortController>()

/**
 * 🔴 两个 HITL 默认键**都要给**，这是本按钮最容易写错的一半。
 *
 * 方案 §2-D10 写的是「feedback 传 `{hitl_approved: true|false}`」，那**只对 `hitl.confirm` 成立**：
 * `hitl.bpm_approval` 读的是 `bpm_approved` / `bpm_status`
 * （`HitlBpmApprovalNodeExecutor#execute`）。只给 `hitl_approved` 的话它读到 null
 * → `isApproved=false` → 流程走**拒绝**分支，而执行状态照样报 SUCCEEDED ——
 * 正是 HitlBpmApprovalNodeExecutor#execute 里那段回退注释点名的「审批通过了却没干活」（#46 修的就是这一类）。
 * 运维点的是「恢复」，流程却按「驳回」续跑且一路绿灯，比卡死更难查。
 *
 * 两个键都给则各自只被对应的执行器读到、对另一种节点惰性无害；且这三个键都在
 * `KeyStrategyFactoryGenerator#generate` 无条件注册过，能活过 resume 时
 * `OverAllState.input()` 那道「只保留注册过 KeyStrategy 的键」的过滤。
 * 自定义了 `approveVar` 的流程也不用管：两个执行器读不到自定义键时都回退默认键。
 *
 * ⚠️ 刻意**不给** `bpm_status`：给了 4 会被 `HitlBpmApprovalNodeExecutor#resolveResult` 判成「取消」，
 * 而运维点的是恢复/拒绝、不是取消；留空则 bpmStatus=null，按 isApproved 判，语义才对。
 */
const resumeFeedback = (approved: boolean) => ({
  hitl_approved: approved,
  bpm_approved: approved
})

/**
 * 「说不清挂在哪」这一档的统一措辞（列表的「未知」标签与恢复确认框共用一份）。
 *
 * 🔴 刻意抽成常量而不是两处各写一遍：这两处一旦措辞漂移，运维在列表看到的和在确认框看到的
 * 就成了两件事，而这个字段的全部意义就是「让人知道要恢复哪里」。
 *
 * 后端取不到挂起节点时**刻意**留 NULL 而不回落成「最后跑完的节点」
 * （`DslToStateGraphCompiler#resolveSuspendNodeId`）：NULL 只是说不清在哪恢复，
 * 错值会把救援的人指到一个早已跑完的节点上，还让他确信自己是对的。所以这里必须直说「未知」。
 */
const SUSPEND_NODE_UNKNOWN =
  '后端挂起时没能从 checkpoint 取到挂起节点，说不清会在哪个闸口续跑。仍可恢复，但请先确认这条执行的最后节点符合你的预期。'

/**
 * 恢复 / 拒绝一条挂起的执行。
 *
 * <p>⚠️ 这不是「改个状态」的只读操作：确认之后流程会**从断点真跑下去**，
 * 后续节点该写的库、该发的审批都会真的发生，所以必须先过确认框、且文案要说清后果。
 */
const onResume = async (row: AgentWorkflowExecutionVO, approved: boolean) => {
  const verb = approved ? '恢复' : '拒绝'
  try {
    // 🔴 纯文本插值，不开 dangerouslyUseHTMLString：suspendNode / currentNode 都是服务端数据。
    // 🔴 措辞分两档，别混成一档（迭代六 B3-10）：
    //    · suspend_node 有值 → 说「正挂在闸口 X」。X 是被 interruptsBefore 拦下、**还没跑**的那个节点，
    //      恢复后第一个执行的就是它，所以这句话是可以照着去核对的。
    //    · 为空 → **不能**改口说「停在 currentNode」。current_node 只在**节点跑完**时写
    //      （AgentWorkflowExecutionServiceImpl#runGraph 的 else 分支），它记的是最后一个跑完的节点，
    //      真正的挂起点在它后面；说成「停在 X」会让运维去查一个其实已经跑完的节点。
    //      为空只有两种可能：非挂起态（本按钮只在 INTERRUPTED 行出现，故排除），或后端挂起时取不到
    //      checkpoint 快照（那一刻意返回 null 而不回落成错值）。所以这一档必须直说「未知」，
    //      与列表里那个「未知」标签同一份措辞（SUSPEND_NODE_UNKNOWN）。
    const where = row.suspendNode
      ? `正挂在闸口「${row.suspendNode}」上，恢复后第一个执行的就是它（它最后跑完的节点是「${
          row.currentNode || '未知'
        }」）。`
      : `说不清挂在哪个闸口上。${SUSPEND_NODE_UNKNOWN}（它最后跑完的节点是「${row.currentNode || '未知'}」）`
    await ElMessageBox.confirm(
      `执行 #${row.id} ${where}` +
        (approved
          ? '点「仍要恢复」= 以「同意」从断点续跑，后续节点会真执行（该写的库、该发的审批都会真的发生），不是预览。'
          : '点「仍要拒绝」= 以「不同意」从断点续跑，流程走拒绝分支，该分支上的节点同样会真执行。') +
        ' ⚠️ 若它其实停在 wait 等待节点而不是人工确认节点，这一步等于跳过等待直接续跑，' +
        '等待中的事件负载（waitType=event）不会带入。',
      `${verb}挂起的执行`,
      {
        confirmButtonText: `仍要${verb}`,
        cancelButtonText: '取消',
        type: 'warning'
      }
    )
  } catch {
    return // 用户取消
  }

  resuming[row.id] = approved ? 'approve' : 'reject'
  const ctrl = new AbortController()
  resumeAborts.set(row.id, ctrl)
  /**
   * 终态：'' 未定 / DONE / INTERRUPTED / ERROR。空串用来区分「后端报了错」与「连接断了、结果未知」。
   *
   * 🔴 刻意标成 `string` 而不是字面量联合：赋值发生在 SSE 回调里，而 TS 的控制流分析**不认**
   * 「那个回调会在下面几句比较之前跑过」，写成联合类型会报 TS2367「两个类型没有重叠」
   * （它以为 outcome 到这里还只可能是 '' | 'ERROR'）。取值仍只来自上面 switch 的四个分支。
   */
  let outcome = ''
  let detail = ''
  try {
    await AgentWorkflowApi.resumeStream(
      row.id,
      resumeFeedback(approved),
      ctrl,
      (event) => {
        let payload: any
        try {
          payload = JSON.parse(event.data)
        } catch {
          return
        }
        if (payload.code !== 0) {
          // 后端把 ServiceException 也塞进流里（AgentWorkflowController#resumeStream），
          // 最常见的是这条执行已被轮询器/审批回调抢先恢复 → STATE_INVALID
          outcome = 'ERROR'
          detail = payload.msg || '恢复被后端拒绝'
          return
        }
        switch (payload.data?.type) {
          case 'ERROR':
            outcome = 'ERROR'
            detail = payload.data.errorMsg || '续跑过程中出错'
            break
          case 'INTERRUPTED':
            // 🔴 续跑后又撞上下一道闸口：不是失败，但也**不能报「恢复成功」**，
            //    否则运维以为跑完了，实际它还停着（只是停在更后面一个节点）
            outcome = 'INTERRUPTED'
            detail = payload.data.nodeId || ''
            break
          case 'DONE':
            outcome = 'DONE'
            break
          default:
            break // META / NODE 只是过程事件，本抽屉不渲染流
        }
      },
      (err) => {
        // 🔴 必须 throw：onerror 不抛异常 fetchEventSource 就会无限重连，
        //    把同一次恢复反复打后端（与 AssistantChat.vue 的 handleHitlDecision 同一条纪律）
        if (!outcome) {
          outcome = 'ERROR'
          detail = '连接中断，恢复结果未知——请先刷新列表看这条执行的最新状态，不要直接再点一次'
        }
        throw err
      },
      () => {}
    )
  } catch {
    if (!outcome) {
      outcome = 'ERROR'
      detail = '恢复请求失败'
    }
  } finally {
    delete resuming[row.id]
    resumeAborts.delete(row.id)
    // 续跑会产生新的节点 trace，把懒加载缓存清掉，下次展开才看得到
    delete tracesMap[row.id]
  }

  if (outcome === 'DONE') {
    message.success(`执行 #${row.id} 已续跑完成`)
  } else if (outcome === 'INTERRUPTED') {
    message.warning(
      `执行 #${row.id} 已续跑，但又停在了下一个人工闸口` +
        `${detail ? `（节点「${detail}」）` : ''}，需要再决定一次`
    )
  } else {
    message.error(`执行 #${row.id} 恢复未完成：${detail || '原因未知'}`)
  }
  // 🔴 必须刷新：不刷的话这行还挂着「等待确认」，运维无从判断刚才那一下到底生效没有
  //    （本子系统最典型的缺陷就是「操作成功但不生效且无提示」）
  await getList()
}

// ========== 主动取消（迭代七 B3-2 / B3-9） ==========

/** 正在取消中的执行：executionId → true。既让按钮转圈，也挡住同一行被连点两次 */
const cancelling = reactive<Record<number, boolean>>({})

/**
 * 取消一条执行。
 *
 * <p>🔴 确认框里那三句「⚠️」不是免责声明式的凑字，每一句都对着一个<b>会被误判的后果</b>：
 * <ol>
 *   <li><b>停不下正在跑的节点</b> —— 后端是记账语义（图跑在 boundedElastic 上、内部 blockLast()，
 *       那个 Disposable 没被留下）。不说清的话，用户会以为点了取消就立刻不烧 token 了；</li>
 *   <li><b>已发出的副作用收不回来，且不触发补偿</b> —— 不说的话，用户会拿它当「回滚」用
 *       （「跑错了我取消一下」），而取消恰恰<b>刻意</b>不反做：反做是「失败后的补救」，
 *       用户主动中止不是失败，触发补偿等于把他想停的东西再跑一遍；</li>
 *   <li><b>不可恢复</b> —— 裁定 A-Ⅰ：本轮不做「取消转可恢复」。对一个正挂在闸口上、
 *       本来点「恢复」就能接着跑的执行，取消是<b>不可逆</b>的，必须让人在点之前知道。</li>
 * </ol>
 *
 * <p>⚠️ 与隔壁 {@link onResume} 不同，这里<b>没有</b> AbortController：cancel 是一次普通 POST，
 * 不是流。抽屉关掉时没有需要掐的在途连接（那个请求要么已落库、要么已被后端拒，两种都是终局）。
 */
const onCancel = async (row: AgentWorkflowExecutionVO) => {
  // 🔴 「它停在哪」分三档，别混成一档 —— 与隔壁 onResume 同一条纪律（迭代六 B3-10）。
  //    本轮初版这里只有一句 `它最后跑完的节点是「currentNode」`，对 INTERRUPTED 行是**错的**：
  //    current_node 只在**节点跑完**时写，真正挂起的那个闸口在它后面（suspend_node）。
  //    于是运维在取消一个挂起执行时，读到的位置是一个**早就跑完**的节点 —— 正是 B3-10 上一轮
  //    刚从「恢复」确认框里拆掉的那个缺陷，新加的动作不能把它原样再引入一遍。
  //    · INTERRUPTED + suspend_node 有值 → 点名闸口（取消掉的就是这道等待）；
  //    · INTERRUPTED + 为空 → 直说「说不清」，**不许**改口说「停在 currentNode」；
  //    · 其余档（CREATED/RUNNING）→ 这时没有闸口可言，currentNode 才是对的位置。
  const where =
    row.status === 'INTERRUPTED'
      ? row.suspendNode
        ? `它正挂在闸口「${row.suspendNode}」上等人工确认（最后跑完的节点是「${
            row.currentNode || '未知'
          }」）。`
        : `它正挂在某道闸口上等人工确认，但${SUSPEND_NODE_UNKNOWN}（最后跑完的节点是「${
            row.currentNode || '未知'
          }」）。`
      : row.currentNode
        ? `它最后跑完的节点是「${row.currentNode}」。`
        : ''
  try {
    // 🔴 纯文本插值，不开 dangerouslyUseHTMLString：suspendNode / currentNode / status 都是服务端数据
    await ElMessageBox.confirm(
      `执行 #${row.id} 当前状态「${execLabel(row.status)}」。${where}` +
        '取消后它落终态「已取消」。' +
        ' ⚠️ 这不是「掐断线程」：后端停不下正在执行的那个节点，它会自然跑完，只是收尾不再改写这一行。' +
        ' ⚠️ 已经发出去的外部副作用收不回来（token 已扣、库已写、审批已发），且不会触发补偿反做 —— ' +
        '想撤销已生效的写操作，取消做不到，得另走人工处置。' +
        ' ⚠️ 取消后不可恢复，要重跑得从头再跑一次。' +
        (row.status === 'INTERRUPTED'
          ? ' ⚠️ 取消等于放弃这次等待，而它本来点「恢复」就能接着跑。'
          : ''),
      '取消这条执行',
      { confirmButtonText: '仍要取消', cancelButtonText: '返回', type: 'warning' }
    )
  } catch {
    return // 用户返回
  }

  cancelling[row.id] = true
  try {
    await AgentWorkflowApi.cancelExecution(row.id)
    message.success(`执行 #${row.id} 已取消`)
  } catch {
    // 🔴 刻意**不**在这里另编文案：后端 STATE_INVALID 的 msg 里带的是**重读到的真实状态**
    //    （例如「当前状态（SUCCEEDED）不允许该操作」），axios 拦截器已经把它 toast 出去了。
    //    前端再补一句「取消失败，请重试」会把那句真话盖掉，而这两档的处置完全不同：
    //    「它已经跑完了」= 没什么可做；「它正在回滚」= 等它跑完再说。
  } finally {
    delete cancelling[row.id]
    // 那个还在跑的节点可能又落了新的 trace，缓存清掉，下次展开才看得到
    delete tracesMap[row.id]
    // 🔴 成功、失败**都要**刷。失败最常见的原因恰恰是「就在你点下去那一刻它自己收尾了」，
    //    不刷的话这行还显示「运行中」，而库里已经是 SUCCEEDED —— 界面替后端撒了个谎，
    //    而后端那边为了不说这句谎专门做了「CAS 输掉就重读再报真实状态」。
    await getList()
  }
}

onBeforeUnmount(() => {
  // 抽屉 destroy-on-close：关掉就掐掉在途的恢复流，否则它还在后台往已销毁的行写状态
  resumeAborts.forEach((c) => c.abort())
  resumeAborts.clear()
})

/** 打开抽屉：按定义 id 拉执行历史 */
const open = async (workflowDefId: number, defTitle: string) => {
  visible.value = true
  title.value = defTitle
  queryParams.pageNo = 1
  queryParams.workflowDefId = workflowDefId
  list.value = []
  total.value = 0
  await getList()
}

defineExpose({ open })
</script>
