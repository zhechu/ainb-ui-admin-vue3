<!--
  Agent 定义（智能体目录管理）—— P5 Agent Builder 第一刀

  业务人员在此定义/管理一个个可复用的 Agent（当前以「人设 persona」为核心），走与流程编排一致的
  版本化 + 草稿/发布/停用生命周期：def 列表 / 分页 / 新建 / 编辑 / 查看 / 发布 / 停用 / 删除。

  🔴 需求11：已发布/已停用行也可「编辑」，但走<b>派生新草稿版本</b>而非就地改；
     另加「复制」（换 code 成一个独立的新 Agent）。删除放宽到「草稿 + 已停用」。
  🔴 需求10：列表里会有一行<b>系统内置</b>的「默认平台助手」——它就是聊天入口未选 Agent 时用的那份
     系统提示词，可就地维护人设/名称/描述，但不可删除、停用、派生（后端抛 AGENT_DEF_BUILTIN_READONLY）。

  权限（增量14a 拆分，与后端 AgentDefController @PreAuthorize 逐字一致）：
     读（查看）= agent:def:query；新增/复制/派生 = :create；编辑 = :update；删除 = :delete；发布/停用 = :publish。
     按钮权限行 + 角色授权见 sql/mysql/xpy-2026-09-27-agent-fine-grained-perms.sql（super_admin 绕过一切权限点）。
  状态无数据字典，用本地 map 渲染 tag（同 views/agent/workflow 的做法）。
-->
<template>
  <!-- 搜索 -->
  <ContentWrap>
    <el-form class="-mb-15px" :model="queryParams" ref="queryFormRef" :inline="true" label-width="68px">
      <el-form-item label="编码" prop="code">
        <el-input
          v-model="queryParams.code"
          placeholder="请输入编码"
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
          <Icon icon="ep:plus" class="mr-5px" /> 新增
        </el-button>
      </el-form-item>
    </el-form>
  </ContentWrap>

  <!-- 列表 -->
  <ContentWrap>
    <el-table class="xpy-list-table" stripe v-loading="loading" :data="list">
      <!-- 序号列：indexMethod 已配 auto-import（@/utils/table），按当前页码换算全局序号 -->
      <el-table-column
        label="序号"
        type="index"
        width="44"
        align="center"
        :index="indexMethod(queryParams)"
        class-name="col-index"
        label-class-name="col-index"
      />
      <el-table-column label="编号" align="center" prop="id" width="80" />
      <el-table-column label="编码" align="center" prop="code" min-width="160" show-overflow-tooltip />
      <el-table-column label="名称" align="center" prop="name" min-width="140" show-overflow-tooltip />
      <el-table-column label="版本" align="center" prop="version" width="70" />
      <el-table-column label="状态" align="center" prop="status" width="190">
        <template #default="scope">
          <el-tag :type="statusTagType(scope.row.status)" size="small">
            {{ statusLabel(scope.row.status) }}
          </el-tag>
          <!-- 需求10：内置行打标。它不参与版本化、不可删/停用/派生，就地改人设即对下一句对话生效 -->
          <el-tag v-if="scope.row.builtin" type="danger" size="small" effect="plain" class="ml-4px">
            系统内置
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
      <el-table-column label="操作" align="center" min-width="300" fixed="right">
        <template #default="scope">
          <el-button
            link
            type="primary"
            @click="openEditor(scope.row, 'view')"
            v-hasPermi="['agent:def:query']"
          >
            查看
          </el-button>
          <!-- 需求11：编辑对所有状态开放。草稿与内置行=就地改；已发布/已停用=先派生新草稿版本再进编辑器
               （历史版本是不可变快照，就地改会让按该版本路由的对话前后不一致）。见 handleEdit -->
          <el-button
            link
            type="primary"
            @click="handleEdit(scope.row)"
            v-hasPermi="['agent:def:update']"
          >
            编辑
          </el-button>
          <!-- 需求11：复制成一个「另一个 Agent」——新编码、version 从 1 起，人设/模型/知识库/工具整份搬过来。
               🔴 与「编辑派生新版本」是两件事：派生沿用同 code，复制换 code。搞混了会让副本变成别人的 v(n+1) -->
          <el-button
            link
            type="primary"
            @click="openCopyDialog(scope.row)"
            v-hasPermi="['agent:def:create']"
          >
            复制
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
            v-if="scope.row.status === 'PUBLISHED' && !scope.row.builtin"
            link
            type="warning"
            @click="handleDisable(scope.row)"
            v-hasPermi="['agent:def:publish']"
          >
            停用
          </el-button>
          <!-- 需求11：草稿可直接删；已停用也可删（不再被选用，删了不留孤儿）；
               已发布须先停用（它还挂在聊天选择器里，直接删等于对话选到一个不存在的 Agent） -->
          <el-button
            v-if="scope.row.status !== 'PUBLISHED' && !scope.row.builtin"
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

  <!-- 复制弹窗（需求11）。只有两个短字段，弹窗足够；内容多的编辑走整页设计器 -->
  <el-dialog v-model="copyVisible" title="复制智能体" width="480px" append-to-body>
    <el-alert
      type="info"
      :closable="false"
      show-icon
      class="mb-16px"
      title="将复制成一个独立的新智能体（草稿）：人设、模型、知识库、工具配置整份搬过来，编码与名称需另起。"
    />
    <el-form ref="copyFormRef" :model="copyForm" :rules="copyRules" label-width="68px">
      <el-form-item label="源">
        <span class="text-13px">
          {{ copySource?.name }}（{{ copySource?.code }} v{{ copySource?.version }}）
        </span>
      </el-form-item>
      <el-form-item label="新编码" prop="code">
        <el-input v-model="copyForm.code" placeholder="小写字母开头，仅含小写字母/数字/下划线" />
      </el-form-item>
      <el-form-item label="新名称" prop="name">
        <el-input v-model="copyForm.name" placeholder="请输入名称" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button :disabled="copySaving" @click="copyVisible = false">取消</el-button>
      <el-button type="primary" :loading="copySaving" @click="handleCopySubmit">确定</el-button>
    </template>
  </el-dialog>
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
 * 新建/查看：跳整页设计器（隐藏路由 AgentDefEditor，仿流程编排设计器）。
 * 内容较多（人设大文本 + 模型/知识库/工具绑定），弹窗体验差、排版拥挤，改为整页编辑。
 * 带 id 走编辑/查看态，不带走新建态；mode=view 强制只读。
 */
const openEditor = (row?: AgentDefVO, mode?: 'view' | 'edit') => {
  push({
    name: 'AgentDefEditor',
    query: row ? { id: String(row.id), ...(mode === 'view' ? { mode: 'view' } : {}) } : {}
  })
}

/**
 * 编辑（需求11）：三条分支，只有一条是「直接进编辑器」
 *
 * <ul>
 *   <li><b>草稿</b> → 就地改。草稿从未被选用，改了不影响任何人。</li>
 *   <li><b>系统内置行</b> → 就地改（虽为已发布）。它是聊天入口「未选 Agent」时用的那份系统提示词，
 *       是<b>单例配置</b>不是版本快照，派生新版本毫无意义（新版本不会被当成内置行读）。</li>
 *   <li><b>已发布/已停用</b> → 先派生一个同 code、version+1 的<b>新草稿</b>再进编辑器。
 *       🔴 就地改会让「按 v1 路由的历史对话」和「按 v1 路由的新对话」拿到两份不同的人设，
 *       这正是版本化要防的事；派生则把改动落在一个全新的、尚未生效的版本上。</li>
 * </ul>
 */
const handleEdit = async (row: AgentDefVO) => {
  if (row.status === 'DRAFT' || row.builtin) {
    openEditor(row, 'edit')
    return
  }
  try {
    await message.confirm(
      `「${row.name || row.code}」当前是${statusLabel(row.status)}状态，不可就地修改。` +
        `将基于它派生一个新草稿版本（同编码、版本 v${row.version + 1}），原版本保持不变。确认继续？`
    )
  } catch {
    return
  }
  const newId = await AgentDefApi.deriveDef(row.id)
  message.success(`已派生新草稿 v${row.version + 1}`)
  push({ name: 'AgentDefEditor', query: { id: String(newId) } })
}

// ========== 复制（需求11）==========
const copyVisible = ref(false)
const copySaving = ref(false)
const copySource = ref<AgentDefVO>()
const copyFormRef = ref()
const copyForm = reactive({ code: '', name: '' })
const copyRules = reactive({
  code: [
    { required: true, message: '编码不能为空', trigger: 'blur' },
    {
      pattern: /^[a-z][a-z0-9_]{1,63}$/,
      message: '小写字母开头，仅含小写字母/数字/下划线，长度 2~64',
      trigger: 'blur'
    }
  ],
  name: [{ required: true, message: '名称不能为空', trigger: 'blur' }]
})

/**
 * 打开复制弹窗。默认编码取「源编码_copy」并预填名称「源名称（副本）」，
 * 让「连点确定」这条路也能走通；用户想改再改。
 * 🔴 不校验源编码是否已存在——后端 copyDef 会抛 AGENT_DEF_CODE_EXISTS，
 *    前端再查一遍只是把同一个竞态判断做两次（两次查询之间别人可能刚建了同名编码）。
 */
const openCopyDialog = (row: AgentDefVO) => {
  copySource.value = row
  copyForm.code = `${row.code}_copy`.slice(0, 64)
  copyForm.name = `${row.name || row.code}（副本）`
  copyVisible.value = true
  nextTick(() => copyFormRef.value?.clearValidate())
}

const handleCopySubmit = async () => {
  if (!copySource.value) return
  try {
    await copyFormRef.value.validate()
  } catch {
    return // 字段级校验未过，错误已内联展示
  }
  copySaving.value = true
  try {
    const newId = await AgentDefApi.copyDef({
      id: copySource.value.id,
      code: copyForm.code,
      name: copyForm.name
    })
    copyVisible.value = false
    message.success('复制成功（已落草稿）')
    // 直接进新副本的编辑器：用户复制的目的几乎总是「改一改再用」，回列表再点一次编辑是多余的一步
    push({ name: 'AgentDefEditor', query: { id: String(newId) } })
  } finally {
    copySaving.value = false
  }
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

/** 停用：PUBLISHED → DISABLED（内置行不可停用：停用它等于让「未选 Agent」的对话彻底失去系统提示词） */
const handleDisable = async (row: AgentDefVO) => {
  try {
    await message.confirm(`确认停用 Agent「${row.name || row.code}」(v${row.version})？停用后不再被选用。`)
    await AgentDefApi.disableDef(row.id)
    message.success('停用成功')
    await getList()
  } catch {}
}

/** 删除：草稿与已停用可删（需求11）；已发布须先停用，后端抛 AGENT_DEF_PUBLISHED_NOT_DELETABLE */
const handleDelete = async (row: AgentDefVO) => {
  try {
    await message.delConfirm(
      `确认删除 Agent「${row.name || row.code}」(v${row.version})？删除后不可恢复。`
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
