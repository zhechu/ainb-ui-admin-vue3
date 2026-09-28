<!--
  Agent 定义（智能体目录管理）—— P5 Agent Builder 第一刀

  业务人员在此定义/管理一个个可复用的 Agent（当前以「人设 persona」为核心），走与流程编排一致的
  版本化 + 草稿/发布/停用生命周期：def 列表 / 分页 / 新建 / 编辑 / 查看 / 发布 / 停用 / 删除。

  🔴 有界：本刀只交付「管理目录」。人设尚无运行期消费方——把它接入对话流（聊天入口按 Agent 路由）
     与 model/工具集/知识库/绑定工作流是 slice-2。故本页没有「调试/对话」入口，只有目录 CRUD。

  权限（增量14a 拆分，与后端 AgentDefController @PreAuthorize 逐字一致）：
     读（查看）= agent:def:query；新增 = :create；编辑 = :update；删除 = :delete；发布/停用 = :publish。
     按钮权限行 + 角色授权见 sql/mysql/xpy-2026-09-27-agent-fine-grained-perms.sql（super_admin 绕过一切权限点）。
  状态无数据字典，用本地 map 渲染 tag（同 views/agent/workflow 的做法）。
-->
<template>
  <!-- 搜索 -->
  <ContentWrap>
    <el-form class="-mb-15px" :model="queryParams" ref="queryFormRef" :inline="true" label-width="68px">
      <el-form-item label="Agent 编码" prop="code">
        <el-input
          v-model="queryParams.code"
          placeholder="请输入 Agent 编码"
          clearable
          @keyup.enter="handleQuery"
          class="!w-240px"
        />
      </el-form-item>
      <el-form-item label="名称" prop="name">
        <el-input
          v-model="queryParams.name"
          placeholder="请输入名称"
          clearable
          @keyup.enter="handleQuery"
          class="!w-240px"
        />
      </el-form-item>
      <el-form-item label="状态" prop="status">
        <el-select v-model="queryParams.status" placeholder="请选择状态" clearable class="!w-240px">
          <el-option
            v-for="item in STATUS_OPTIONS"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-button @click="handleQuery">
          <Icon icon="ep:search" class="mr-5px" />
          搜索
        </el-button>
        <el-button @click="resetQuery">
          <Icon icon="ep:refresh" class="mr-5px" />
          重置
        </el-button>
        <!-- 操作按钮放搜索表单末尾，与 tenant 等列表页同款布局（原先孤悬在列表区顶部，位置突兀） -->
        <el-button
          type="primary"
          plain
          @click="openEditor()"
          v-hasPermi="['agent:def:create']"
        >
          <Icon icon="ep:plus" class="mr-5px" /> 新增 Agent
        </el-button>
      </el-form-item>
    </el-form>
  </ContentWrap>

  <!-- 列表 -->
  <ContentWrap>
    <el-table class="xpy-list-table" stripe v-loading="loading" :data="list">
      <el-table-column label="编号" align="center" prop="id" width="80" />
      <el-table-column label="Agent 编码" align="center" prop="code" min-width="160" show-overflow-tooltip />
      <el-table-column label="名称" align="center" prop="name" min-width="140" show-overflow-tooltip />
      <el-table-column label="版本" align="center" prop="version" width="70" />
      <el-table-column label="状态" align="center" prop="status" width="150">
        <template #default="scope">
          <el-tag :type="statusTagType(scope.row.status)" size="small">
            {{ statusLabel(scope.row.status) }}
          </el-tag>
          <!-- 增量12 / slice-3c：被已发布 chatflow 驱动的 Agent 打标（discoverability），提示「对话即跑工作流」 -->
          <el-tag
            v-if="scope.row.workflowDriven"
            type="primary"
            size="small"
            effect="plain"
            class="ml-4px"
          >
            工作流驱动
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="描述" align="center" prop="description" min-width="180" show-overflow-tooltip />
      <el-table-column
        label="创建时间"
        align="center"
        prop="createTime"
        width="180"
        :formatter="dateFormatter"
      />
      <el-table-column label="操作" align="center" min-width="280" fixed="right">
        <template #default="scope">
          <el-button
            link
            type="primary"
            @click="openEditor(scope.row, 'view')"
            v-hasPermi="['agent:def:query']"
          >
            查看
          </el-button>
          <el-button
            v-if="scope.row.status === 'DRAFT'"
            link
            type="primary"
            @click="openEditor(scope.row, 'edit')"
            v-hasPermi="['agent:def:update']"
          >
            编辑
          </el-button>
          <el-button
            v-if="scope.row.status === 'DRAFT'"
            link
            type="success"
            @click="handlePublish(scope.row)"
            v-hasPermi="['agent:def:publish']"
          >
            发布
          </el-button>
          <el-button
            v-if="scope.row.status === 'PUBLISHED'"
            link
            type="warning"
            @click="handleDisable(scope.row)"
            v-hasPermi="['agent:def:publish']"
          >
            停用
          </el-button>
          <el-button
            v-if="scope.row.status === 'DRAFT'"
            link
            type="danger"
            @click="handleDelete(scope.row)"
            v-hasPermi="['agent:def:delete']"
          >
            删除
          </el-button>
        </template>
      </el-table-column>
    </el-table>
    <!-- 分页 -->
    <Pagination
      :total="total"
      v-model:page="queryParams.pageNo"
      v-model:limit="queryParams.pageSize"
      @pagination="getList"
    />
  </ContentWrap>
</template>

<script lang="ts" setup>
import { dateFormatter } from '@/utils/formatTime'
import { AgentDefApi, type AgentDefVO } from '@/api/agent/def'

defineOptions({ name: 'AgentDef' })

const message = useMessage()
const { push } = useRouter()

const loading = ref(true)
const total = ref(0)
const list = ref<AgentDefVO[]>([])
const queryParams = reactive({
  pageNo: 1,
  pageSize: 20,
  code: undefined,
  name: undefined,
  status: undefined
})
const queryFormRef = ref()

/** 状态本地 map（无数据字典）。与后端 AgentDefStatusEnum 一致 */
const STATUS_OPTIONS = [
  { value: 'DRAFT', label: '草稿' },
  { value: 'PUBLISHED', label: '已发布' },
  { value: 'DISABLED', label: '已停用' }
]
const statusLabel = (status: string) =>
  STATUS_OPTIONS.find((s) => s.value === status)?.label ?? status
const statusTagType = (status: string): 'info' | 'success' | 'warning' => {
  if (status === 'PUBLISHED') return 'success'
  if (status === 'DISABLED') return 'warning'
  return 'info' // DRAFT 及未知
}

/** 查询列表 */
const getList = async () => {
  loading.value = true
  try {
    const data = await AgentDefApi.getDefPage(queryParams)
    list.value = data.list
    total.value = data.total
  } finally {
    loading.value = false
  }
}

const handleQuery = () => {
  queryParams.pageNo = 1
  getList()
}

const resetQuery = () => {
  queryFormRef.value.resetFields()
  handleQuery()
}

/**
 * 新建/编辑/查看：跳整页设计器（隐藏路由 AgentDefEditor，仿流程编排设计器）。
 * 内容较多（人设大文本 + 模型/知识库/工具绑定），弹窗体验差、排版拥挤，改为整页编辑。
 * 编辑仅对 DRAFT 行开放（与后端 updateDef 草稿守卫一致）；查看对任意状态开放（整页只读）。
 * 带 id 走编辑/查看态，不带走新建态；mode=view 强制只读。
 */
const openEditor = (row?: AgentDefVO, mode?: 'view' | 'edit') => {
  push({
    name: 'AgentDefEditor',
    query: row ? { id: String(row.id), ...(mode === 'view' ? { mode: 'view' } : {}) } : {}
  })
}

/** 发布：DRAFT → PUBLISHED */
const handlePublish = async (row: AgentDefVO) => {
  try {
    await message.confirm(`确认发布 Agent「${row.name || row.code}」(v${row.version})？`)
    await AgentDefApi.publishDef(row.id)
    message.success('发布成功')
    await getList()
  } catch {}
}

/** 停用：PUBLISHED → DISABLED */
const handleDisable = async (row: AgentDefVO) => {
  try {
    await message.confirm(`确认停用 Agent「${row.name || row.code}」(v${row.version})？停用后不再被选用。`)
    await AgentDefApi.disableDef(row.id)
    message.success('停用成功')
    await getList()
  } catch {}
}

/** 删除：仅 DRAFT 可删（草稿从未被选用，删了不留孤儿；后端 deleteDef 对非草稿抛 AGENT_DEF_NOT_DRAFT） */
const handleDelete = async (row: AgentDefVO) => {
  try {
    await message.delConfirm(
      `确认删除草稿 Agent「${row.name || row.code}」(v${row.version})？删除后不可恢复。`
    )
    await AgentDefApi.deleteDef(row.id)
    message.success('删除成功')
    await getList()
  } catch {}
}

onMounted(() => {
  getList()
})

// 从整页设计器返回时刷新列表（页面被 keep-alive 缓存时 onMounted 不会重跑）；首次激活跳过，避免与 onMounted 重复请求
let firstActivated = true
onActivated(() => {
  if (firstActivated) {
    firstActivated = false
    return
  }
  getList()
})
</script>
