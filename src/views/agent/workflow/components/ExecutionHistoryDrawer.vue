<!--
  执行历史抽屉（增量8 / P4 第一刀）

  按 workflowDefId 拉执行分页；行展开 → 懒加载该执行的节点级 trace 子表。
  🔴 管理端全租户视角（由 agent:workflow:query 把关、租户隔离自动），区别于用户「只看自己」的执行列表。
  状态无数据字典，用本地 map 渲染 tag。空态用 el-empty。
-->
<template>
  <el-drawer v-model="visible" :title="`执行历史 · ${title}`" size="65%" append-to-body destroy-on-close>
    <el-table
      v-loading="loading"
      :data="list"
      stripe
      row-key="id"
      @expand-change="onExpandChange"
    >
      <el-table-column type="expand">
        <template #default="{ row }">
          <div class="px-40px py-8px">
            <el-table
              v-loading="traceLoading[row.id]"
              :data="tracesMap[row.id] ?? []"
              size="small"
              border
            >
              <el-table-column label="节点 id" prop="nodeId" min-width="140" show-overflow-tooltip />
              <el-table-column label="类型" prop="nodeType" width="130" />
              <el-table-column label="状态" prop="status" width="110">
                <template #default="scope">
                  <el-tag :type="execTagType(scope.row.status)" size="small">
                    {{ scope.row.status }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="尝试" prop="attempt" width="60" align="center" />
              <el-table-column label="token" prop="totalTokens" width="80" align="right" />
              <el-table-column label="耗时(ms)" prop="durationMs" width="90" align="right" />
              <el-table-column label="失败原因" prop="errorMsg" min-width="160" show-overflow-tooltip />
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
      <el-table-column label="触发用户" prop="userId" width="90" align="center" />
      <el-table-column label="耗时(ms)" prop="durationMs" width="90" align="right" />
      <el-table-column
        label="开始时间"
        prop="beginTime"
        width="180"
        :formatter="dateFormatter"
      />
      <el-table-column label="失败原因" prop="errorMsg" min-width="160" show-overflow-tooltip />
      <el-table-column label="操作" width="100" align="center" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="onReplay(row.id)">画布回放</el-button>
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
import { dateFormatter } from '@/utils/formatTime'
import {
  AgentWorkflowApi,
  type AgentNodeExecutionVO,
  type AgentWorkflowExecutionVO
} from '@/api/agent/workflow'
import WorkflowReplayDialog from './WorkflowReplayDialog.vue'

defineOptions({ name: 'ExecutionHistoryDrawer' })

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
  COMPENSATING: '补偿中',
  COMPENSATED: '已补偿',
  COMPENSATION_FAILED: '补偿失败'
}
const execLabel = (status: string) => EXEC_LABELS[status] ?? status
const execTagType = (
  status: string
): 'primary' | 'success' | 'warning' | 'danger' | 'info' => {
  if (status === 'SUCCEEDED') return 'success'
  if (status === 'FAILED' || status === 'COMPENSATION_FAILED') return 'danger'
  if (status === 'INTERRUPTED') return 'warning'
  if (status === 'RUNNING' || status === 'CREATED') return 'primary'
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
