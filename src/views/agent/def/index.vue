<!--
  Agent 定义（智能体目录管理）—— P5 Agent Builder 第一刀

  业务人员在此定义/管理一个个可复用的 Agent（当前以「人设 persona」为核心），走与流程编排一致的
  版本化 + 草稿/发布/停用生命周期：def 列表 / 分页 / 新建 / 编辑 / 查看 / 发布 / 停用 / 删除。

  🔴 需求11：已发布/已停用行也可「编辑」，但走<b>派生新草稿版本</b>而非就地改；
     另加「复制」（换 code 成一个独立的新 Agent）。删除放宽到「草稿 + 已停用」。
  🔴 需求10：列表里会有一行<b>系统内置</b>的「默认平台助手」——它就是聊天入口未选 Agent 时用的那份
     系统提示词，可就地维护人设/名称/描述，但不可删除、停用、派生（后端抛 AGENT_DEF_BUILTIN_READONLY）。
  🔴 需求8：已停用可<b>重新发布</b>上线（无需派生新版本）——停用只是从聊天选择器摘掉，配置仍是完整快照。
  🔴 需求9：批量删除，「草稿 / 已停用」的行勾得上（2026-09-29 二轮放开草稿，与单删同口径）。

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
        <!--
          批量删除（需求9）。🔴 只有「草稿 / 已停用」的行勾得上（2026-09-29 二轮放开草稿），
          与单行删除同口径；已发布行须先停用再删，避免线上配置被一整页勾选连带清掉。
          规则藏在灰掉的复选框里没人能猜到，故用 tooltip 说明。
          包一层 span 是因为禁用的 el-button 不派发鼠标事件，tooltip 挂不上去。
        -->
        <el-tooltip
          v-if="checkPermi(['agent:def:delete'])"
          content="仅「草稿 / 已停用」的智能体可勾选，用于批量清理不再使用的配置"
          placement="top"
        >
          <span class="ml-12px align-middle">
            <el-button type="danger" plain :disabled="checkedIds.length === 0" @click="handleDeleteBatch">
              <Icon icon="ep:delete" class="mr-5px" />
              批量删除{{ checkedIds.length ? `（${checkedIds.length}）` : '' }}
            </el-button>
          </span>
        </el-tooltip>
      </el-form-item>
    </el-form>
  </ContentWrap>

  <!-- 列表 -->
  <ContentWrap>
    <el-table
      class="xpy-list-table"
      stripe
      v-loading="loading"
      :data="list"
      @selection-change="handleRowCheckboxChange"
    >
      <!-- 批量删除的勾选列（需求9）。selectable 把不该删的行直接灰掉，而不是让用户勾上后再报错 -->
      <el-table-column type="selection" width="44" :selectable="isRowSelectable" />
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
      <el-table-column label="操作" align="center" min-width="340" fixed="right">
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
          <!--
            需求8：已停用可重新发布上线。停用只是把它从聊天选择器摘掉，配置仍是完整可用的一份快照，
            「临时下线排障、修好了再放回来」是常态；此前只给草稿放行，管理员为了原封不动地恢复一个
            Agent 得先派生新版本再发布，凭空多出一个内容完全相同的 v(n+1)。
            判据写成 !== PUBLISHED 而不是枚举 DRAFT/DISABLED：状态是封闭枚举，PUBLISHED 行本来就另有「停用」，
            将来若再加一个可发布状态，这里自动正确，不会静默漏掉。
          -->
          <el-button
            v-if="scope.row.status !== 'PUBLISHED'"
            link
            type="success"
            @click="handlePublish(scope.row)"
            v-hasPermi="['agent:def:publish']"
          >
            {{ scope.row.status === 'DISABLED' ? '重新发布' : '发布' }}
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
               已发布须先停用（它还挂在聊天选择器里，直接删等于对话选到一个不存在的 Agent）。
               批量删与单删同口径（2026-09-29 二轮放开草稿）：草稿 / 已停用可勾，已发布灰掉。 -->
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
import { checkPermi } from '@/utils/permission'
import { AgentDefApi, type AgentDefVO } from '@/api/agent/def'
import { getToolList, type AgentToolVO } from '@/api/agent/config'
import { keyedLabel } from '@/views/agent/workflow/nameCatalog'

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
    // 翻页/搜索/删除后清空勾选：checkedIds 存的是编号，而列表已经换了一茬，
    // 留着旧编号会让「批量删除（N）」里的 N 与页面上看得见的勾选数对不上。
    // el-table 换数据时本身会重算选中态并触发 selection-change，这里显式清一次是不依赖那个时序。
    checkedIds.value = []
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

/**
 * 工具目录，供发布确认框判「绑的工具停没停用」（D4-25 后端半的界面那侧）。
 *
 * 🔴 为什么列表页也要判一次：编辑器里那句就地警告（`editor/index.vue` 的 `disabledBoundWarning`）
 *    只有**打开编辑器**才看得见，而发布绝大多数时候是在列表页直接点「发布」按钮完成的 ——
 *    那条路径此前一个字都不说，管理员点完「发布成功」，用户聊天时每次调工具都失败。
 *    后端 `publishDefById` 同一时刻会落一条 WARN，但日志不是给点按钮的人看的。
 *
 * 🔴 刻意用**整份**目录，不像编辑器那样先滤掉写工具：这里要判的是「已绑定的键停没停用」，
 *    绑了什么就得能查到什么；滤过的目录查不到写工具，反而会对它们缄默。
 *    （写工具本来就发布不了，后端硬闸会拦，与停用是两条独立的判据。）
 *
 * 🔴 一次页面生命周期只拉一次（`toolCatalog.length > 0` 即短路）：目录是内置工具清单，
 *    变更频率以「管理员去工具管理页点开关」计，不是每次点发布都要重新问一遍的东西。
 */
const toolCatalog = ref<AgentToolVO[]>([])
const loadToolCatalog = async () => {
  if (toolCatalog.value.length > 0) return
  try {
    toolCatalog.value = (await getToolList()) || []
  } catch {
    // 目录拉不到就保持空 ⟹ 下面的判据返回空 ⟹ 确认框不提这事。
    // 🔴 宁可不说：我们此时**不知道**某个键停没停用，凭猜测把人往「解绑」上推是有代价的
    //    （解绑要重新进编辑器改配置）。与编辑器里 `disabledBoundTools` 的同款取舍。
    toolCatalog.value = []
  }
}

/**
 * 这一行绑定的工具里，当前处于停用状态的那些。
 *
 * <p>🔴 `enabled` 读**生效值**（`/agent/config/tool-list` 下发的就是覆盖后的值），
 *    与后端 `validateToolKeys` 里那条 `def.isEnabled()` 同源同口径 ——
 *    安全网关运行期读的也是它，所以「这里说停用」与「聊天时真被拒」必然一致。
 *    只读判据读声明值、启用判据读生效值，这个不对称是刻意的，别「顺手统一」。
 */
const disabledBoundToolsOf = (row: AgentDefVO): AgentToolVO[] => {
  const bound = new Set(
    (row.toolKeys || '')
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean)
  )
  if (!bound.size || !toolCatalog.value.length) return []
  return toolCatalog.value.filter((t) => bound.has(t.name) && !t.enabled)
}

/**
 * 发布：DRAFT / DISABLED → PUBLISHED（需求8：停用后可重新上线）
 *
 * 确认文案按来源状态分开写：草稿是「首次让它生效」，已停用是「放回线上」——
 * 后者需要提醒管理员，这个版本的配置在停用期间没被复查过，重新上线即刻对聊天入口生效。
 *
 * 🔴 D4-25：绑了已停用的工具时，确认框里**多说一段**，但**照样让发**。
 *    不拦是裁定（停用是「工具管理」页的动作，与本 Agent 的配置无关；硬拦会让改人设、
 *    换模型这类无关改动也发布不了，连「重新发布」这个恢复动作都一起堵死）。
 *    但「不拦」不等于「不说」—— 不说就是本模块头号缺陷「配了不生效且无提示」。
 */
const handlePublish = async (row: AgentDefVO) => {
  const relaunch = row.status === 'DISABLED'
  await loadToolCatalog()
  const offTools = disabledBoundToolsOf(row)
  const offClause = offTools.length
    ? `注意：它绑定的 ${offTools.map((t) => keyedLabel(t.name, t.displayName)).join('、')}` +
      '当前已被停用，发布不会拦你，但聊天时模型每次调用它们都会被安全网关拒绝' +
      '（用户只看到一句失败）。要恢复请进编辑器解绑这些工具，或到「工具管理」页重新启用它们。'
    : ''
  try {
    await message.confirm(
      (relaunch
        ? `确认重新发布 Agent「${row.name || row.code}」(v${row.version})？` +
          `它停用期间的配置未作改动，发布后即刻回到聊天选择器中可被选用。`
        : `确认发布 Agent「${row.name || row.code}」(v${row.version})？`) + offClause
    )
    await AgentDefApi.publishDef(row.id)
    message.success(relaunch ? '重新发布成功' : '发布成功')
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

// ========== 批量删除（需求9）==========
const checkedIds = ref<number[]>([])

/**
 * 哪些行勾得上（需求9 批量删除；2026-09-29 二轮：草稿也放开）
 *
 * <p>内置行永远排除：它是「聊天入口未选 Agent 时用哪段系统提示词」的平台设置，不是业务 Agent，
 * 删掉它所有未选 Agent 的对话都会退化成模型自由发挥。
 * <p>已发布行勾不上：后端 validateDeletable 只认 DRAFT/DISABLED，勾上已发布行只会换来整批被拒。
 * <p>判据与工具栏 tooltip、确认框文案三处必须一致，否则会出现「勾上了却删不掉」。
 */
const isRowSelectable = (row: AgentDefVO) =>
  (row.status === 'DISABLED' || row.status === 'DRAFT') && !row.builtin

const handleRowCheckboxChange = (rows: AgentDefVO[]) => {
  checkedIds.value = rows.map((row) => row.id)
}

/**
 * 批量删除。后端是「全成或全不成」：先把 ids 全查回来校验，有一条不该删就整批拒绝、一条都不动。
 * 确认框把要删的名字列出来（最多 5 个 + 「等 N 个」），因为批量删是不可恢复操作，
 * 只显示数量不足以让人发现「勾错了」。
 */
const handleDeleteBatch = async () => {
  if (checkedIds.value.length === 0) {
    return
  }
  const rows = list.value.filter((row) => checkedIds.value.includes(row.id))
  const names = rows.map((row) => `「${row.name || row.code}」v${row.version}`)
  const preview =
    names.length <= 5 ? names.join('、') : `${names.slice(0, 5).join('、')} 等 ${names.length} 个`
  try {
    await message.delConfirm(`确认删除选中的 Agent（草稿或已停用）：${preview}？删除后不可恢复。`)
    await AgentDefApi.deleteDefList(checkedIds.value)
    message.success('删除成功')
    // getList 内部会清空勾选
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
