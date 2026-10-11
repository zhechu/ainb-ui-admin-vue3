<!--
  Workflow 节点级执行回放画布（增量15 / P4 可视化编辑器后续刀：节点级回放）

  在既有「执行历史抽屉」的文本 trace 子表之上，补一个<b>空间化回放</b>：把一次执行的节点级 trace 叠加到
  「该执行绑定版本的 DSL 布局图」上——每个节点按执行结局染色（成功/失败/执行中/跳过/未执行），点节点看该节点
  历次尝试的详情（状态/token/耗时/失败原因/起止时间）。让「流程在哪一步、走没走这条分支、烧了多少 token」一眼可见。

  🔴 零后端改动：三个数据端点都已存在且只读（agent:workflow:query）——
     getExecution(id) 取 workflowDefId、getDef(workflowDefId) 取该执行绑定版本的 DSL、getNodeTrace(id) 取节点 trace。
     合并逻辑全在纯函数 replayModel.ts（vitest 兜底），本组件只负责取数 + 渲染。
  🔴 回放的是「执行当时那一版」的 DSL：execution.workflowDefId 指向具体版本行，getDef 拿到的就是它，
     节点 id 与 trace.nodeId 逐字对应，不会因流程后来又发新版而错位。
  🔴 只读画布：不可拖动/连线/编辑，但可选中最节点看详情。
  🔴 VueFlow 容器必须有显式高度，否则 0 高不渲染（R1）——画布区固定 h-520px。
  🔴 DSL 可能为空/非法：try/catch + el-alert 显式报错，绝不白屏（R3）。
-->
<template>
  <el-dialog
    v-model="visible"
    :title="dialogTitle"
    width="1100px"
    top="6vh"
    append-to-body
    destroy-on-close
  >
    <!-- 头部：执行元信息 -->
    <el-descriptions v-if="exec" :column="3" border size="small" class="mb-12px">
      <el-descriptions-item label="执行编号">#{{ exec.id }}</el-descriptions-item>
      <el-descriptions-item label="流程">
        {{ defTitle }}<span v-if="exec.workflowVersion"> · v{{ exec.workflowVersion }}</span>
      </el-descriptions-item>
      <el-descriptions-item label="执行状态">
        <el-tag :type="execTagType(exec.status)" size="small">{{ execLabel(exec.status) }}</el-tag>
      </el-descriptions-item>
      <el-descriptions-item label="触发用户">{{ exec.userId ?? '—' }}</el-descriptions-item>
      <el-descriptions-item label="耗时">{{ exec.durationMs != null ? exec.durationMs + ' ms' : '—' }}</el-descriptions-item>
      <el-descriptions-item label="开始时间">{{ exec.beginTime ? formatDate(exec.beginTime) : '—' }}</el-descriptions-item>
      <el-descriptions-item v-if="exec.errorMsg" label="失败原因" :span="3">
        <span class="text-[var(--el-color-danger)]">{{ exec.errorMsg }}</span>
      </el-descriptions-item>
    </el-descriptions>

    <el-alert v-if="parseError" :title="parseError" type="error" :closable="false" show-icon />

    <div v-else class="flex gap-10px h-520px">
      <!-- 左：回放画布 -->
      <div class="flex-1 min-w-0 flex flex-col">
        <!-- 图例 -->
        <div class="mb-6px flex items-center gap-12px flex-wrap text-12px text-[var(--el-text-color-secondary)] flex-shrink-0">
          <span v-for="m in legend" :key="m.label" class="flex items-center gap-4px">
            <i class="inline-block w-12px h-12px rounded-3px border-2px border-solid" :style="{ borderColor: m.color }"></i>
            {{ m.label }}
          </span>
        </div>
        <div
          v-loading="loading"
          class="canvas-wrap flex-1 min-h-0 border border-solid border-[var(--el-border-color)] rounded-6px overflow-hidden"
        >
          <VueFlow
            v-if="flowNodes.length"
            :key="renderKey"
            :nodes="flowNodes"
            :edges="flowEdges"
            :nodes-draggable="false"
            :nodes-connectable="false"
            :elements-selectable="true"
            :edges-updatable="false"
            :edges-focusable="false"
            :zoom-on-double-click="false"
            :fit-view-on-init="true"
            :min-zoom="0.3"
            :default-edge-options="{ type: 'default', markerEnd: MarkerType.ArrowClosed }"
            class="w-full h-full"
            @node-click="onNodeClick"
            @pane-click="onPaneClick"
          >
            <Background :gap="16" pattern-color="#dcdfe6" />
            <!-- 自定义节点：边框按执行态着色 + 类型徽标 + 状态徽标 + 重试次数 -->
            <template #node-dsl="{ data, selected }">
              <div
                class="replay-node px-10px py-8px rounded-6px shadow-sm flex flex-col items-start gap-4px min-w-130px"
                :class="{ 'replay-node--selected': selected }"
                :style="{ borderColor: data.execMeta.color }"
              >
                <div class="flex items-center gap-4px flex-wrap">
                  <el-tag size="small" :type="data.tagType" effect="plain" class="!text-11px">
                    {{ data.nodeType || 'node' }}
                  </el-tag>
                  <el-tag size="small" :type="data.execMeta.tagType" effect="dark" class="!text-11px">
                    {{ data.execMeta.label }}
                  </el-tag>
                  <span v-if="data.attemptCount > 1" class="text-11px text-[var(--el-text-color-secondary)]">
                    ×{{ data.attemptCount }}
                  </span>
                </div>
                <span class="text-13px break-all">{{ data.label }}</span>
              </div>
            </template>
          </VueFlow>
          <el-empty v-else-if="!loading" description="该执行没有可渲染的节点" :image-size="80" />
        </div>
      </div>

      <!-- 右：选中节点的执行详情 -->
      <div class="w-320px flex-shrink-0 border border-solid border-[var(--el-border-color)] rounded-6px p-10px overflow-auto">
        <template v-if="selectedId">
          <div class="text-13px font-600 mb-2px">{{ selectedData?.label || selectedId }}</div>
          <div class="text-11px text-[var(--el-text-color-placeholder)] mb-10px break-all">节点 id：{{ selectedId }}</div>

          <template v-if="selectedTraces.length">
            <div class="mb-8px text-12px text-[var(--el-text-color-secondary)]">
              共 {{ selectedTraces.length }} 次尝试，最终
              <el-tag size="small" :type="nodeStatusMeta(selectedData?.execStatus).tagType" effect="dark" class="!text-11px">
                {{ nodeStatusMeta(selectedData?.execStatus).label }}
              </el-tag>
            </div>
            <div v-for="a in selectedTraces" :key="a.id" class="mb-10px">
              <div class="text-12px font-600 mb-4px flex items-center gap-6px">
                第 {{ a.attempt ?? 1 }} 次尝试
                <el-tag size="small" :type="nodeStatusMeta(a.status).tagType" class="!text-11px">
                  {{ nodeStatusMeta(a.status).label }}
                </el-tag>
              </div>
              <el-descriptions :column="1" border size="small">
                <el-descriptions-item label="耗时">{{ a.durationMs != null ? a.durationMs + ' ms' : '—' }}</el-descriptions-item>
                <el-descriptions-item label="token">
                  {{ a.totalTokens ?? 0 }}
                  <span v-if="a.tokenSource" class="text-11px text-[var(--el-text-color-placeholder)]">（{{ a.tokenSource }}）</span>
                </el-descriptions-item>
                <el-descriptions-item v-if="a.modelId != null" label="模型编号">{{ a.modelId }}</el-descriptions-item>
                <el-descriptions-item label="开始">{{ a.beginTime ? formatDate(a.beginTime) : '—' }}</el-descriptions-item>
                <el-descriptions-item label="结束">{{ a.endTime ? formatDate(a.endTime) : '—' }}</el-descriptions-item>
                <el-descriptions-item v-if="a.errorMsg" label="失败原因">
                  <span class="text-[var(--el-color-danger)] break-all">{{ a.errorMsg }}</span>
                </el-descriptions-item>
              </el-descriptions>
            </div>
          </template>

          <el-empty v-else description="该节点无执行记录（起止端点，或本次执行未走到它）" :image-size="60" />
        </template>

        <div v-else class="text-12px text-[var(--el-text-color-secondary)] leading-20px">
          <div class="font-600 mb-6px">回放说明</div>
          <ul class="pl-16px mb-0">
            <li>节点边框颜色 = 该节点的执行结局</li>
            <li>×N 表示该节点重试了 N 次</li>
            <li>单击节点在此看每次尝试的 token/耗时/失败原因</li>
            <li>灰色「未执行」= 本次没走到（如未命中的条件分支）</li>
          </ul>
        </div>
      </div>
    </div>

    <template #footer>
      <el-button @click="visible = false">关闭</el-button>
    </template>
  </el-dialog>
</template>

<script lang="ts" setup>
import { VueFlow, MarkerType } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import type { Edge, Node } from '@vue-flow/core'
import { formatDate } from '@/utils/formatTime'
import {
  AgentWorkflowApi,
  type AgentNodeExecutionVO,
  type AgentWorkflowExecutionVO
} from '@/api/agent/workflow'
import {
  NODE_STATUS_META,
  NOT_EXECUTED_META,
  buildReplayGraph,
  nodeStatusMeta,
  type NodeTrace,
  type ReplayNodeData
} from '../replayModel'
import { ensureLoaded as ensureNameCatalog, nameResolver } from '../nameCatalog'

defineOptions({ name: 'WorkflowReplayDialog' })

const visible = ref(false)
const loading = ref(false)
const parseError = ref('')
const exec = ref<AgentWorkflowExecutionVO>()
const defTitle = ref('')
const flowNodes = ref<Node[]>([])
const flowEdges = ref<Edge[]>([])
/** 每次回放换一个 key，强制 VueFlow 重挂载：避免在不同执行间残留上一份的视口/选中态 */
const renderKey = ref<string | number>('empty')
/** nodeId → 聚合 trace（点节点时右侧详情面板取用） */
const traceByNode = ref<Map<string, NodeTrace>>(new Map())
/** nodeId → 回放 data（选中节点的标签/执行态从这里取，不回读 VueFlow Node.data 以避 TS2589） */
const dataByNode = ref<Map<string, ReplayNodeData>>(new Map())
const selectedId = ref<string | null>(null)

const dialogTitle = computed(() => (defTitle.value ? `执行回放 · ${defTitle.value}` : '执行回放'))

/** 图例：四种执行态 + 未执行 */
const legend = [
  NODE_STATUS_META.SUCCESS,
  NODE_STATUS_META.FAILURE,
  NODE_STATUS_META.RUNNING,
  NODE_STATUS_META.SKIPPED,
  NOT_EXECUTED_META
]

const selectedData = computed<ReplayNodeData | undefined>(() =>
  selectedId.value ? dataByNode.value.get(selectedId.value) : undefined
)
const selectedTraces = computed<AgentNodeExecutionVO[]>(
  () => (selectedId.value ? traceByNode.value.get(selectedId.value)?.attempts ?? [] : [])
)

/** 执行实例级状态本地 map（无数据字典），与后端 WorkflowExecutionStatusEnum 一致（同 ExecutionHistoryDrawer 口径） */
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
const execLabel = (status?: string) => (status ? EXEC_LABELS[status] ?? status : '—')
const execTagType = (status?: string): 'primary' | 'success' | 'warning' | 'danger' | 'info' => {
  if (status === 'SUCCEEDED') return 'success'
  if (status === 'FAILED' || status === 'COMPENSATION_FAILED') return 'danger'
  if (status === 'INTERRUPTED') return 'warning'
  if (status === 'RUNNING' || status === 'CREATED') return 'primary'
  return 'info'
}

const onNodeClick = (payload: any) => {
  selectedId.value = payload?.node?.id ?? null
}
const onPaneClick = () => {
  selectedId.value = null
}

/**
 * 打开回放：按执行编号取「执行元信息 + 节点 trace」，再按执行绑定的 workflowDefId 取那一版 DSL，合并成回放图。
 * @param executionId 执行实例编号
 */
const open = async (executionId: number) => {
  visible.value = true
  loading.value = true
  parseError.value = ''
  exec.value = undefined
  defTitle.value = ''
  flowNodes.value = []
  flowEdges.value = []
  traceByNode.value = new Map()
  dataByNode.value = new Map()
  selectedId.value = null
  renderKey.value = 'empty'
  try {
    // 执行元信息与节点 trace 无依赖，并行取；DSL 要先拿到 execution.workflowDefId 才能取，故随后串行
    const [execution, traces] = await Promise.all([
      AgentWorkflowApi.getExecution(executionId),
      AgentWorkflowApi.getNodeTrace(executionId),
      // 名称目录（重构 S1）：节点摘要里的工具键/子流程 code 要翻成中文名。ensureLoaded 永不 reject
      ensureNameCatalog()
    ])
    exec.value = execution
    const def = await AgentWorkflowApi.getDef(execution.workflowDefId)
    defTitle.value = def.name || def.code || `#${execution.workflowDefId}`
    if (!def.dsl) {
      parseError.value = '该执行绑定的流程定义没有 DSL 正文，无法回放画布。'
      return
    }
    let parsed: any
    try {
      parsed = JSON.parse(def.dsl)
    } catch (e: any) {
      parseError.value = `DSL 解析失败：${e?.message ?? '格式不合法'}`
      return
    }
    const graph = buildReplayGraph(parsed, traces, nameResolver)
    flowNodes.value = graph.nodes
    flowEdges.value = graph.edges
    traceByNode.value = graph.traceByNode
    dataByNode.value = graph.dataByNode
    renderKey.value = `replay-${executionId}`
  } catch (e: any) {
    // 取数失败（执行/定义查不到、网络错）：显式报错而非白屏（全局拦截器可能已弹 toast，这里再兜一层）
    if (!parseError.value) {
      parseError.value = `加载执行回放失败：${e?.message ?? e}`
    }
  } finally {
    loading.value = false
  }
}

defineExpose({ open })
</script>

<style scoped>
.replay-node {
  border-width: 2px;
  border-style: solid;
  background: var(--el-bg-color);
}
.replay-node--selected {
  box-shadow: 0 0 0 2px var(--el-color-primary-light-5);
}
</style>
