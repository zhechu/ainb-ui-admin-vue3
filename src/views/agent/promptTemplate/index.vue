<!--
  提示词模板管理（需求7 + S7 用例库）

  模板 = 聊天面板的「提问起手式」：用户点一下，正文插入输入框，改完再发送。
  它不进系统提示词、不影响工具调用与权限，故本页没有风险等级/权限串那类安全字段。

  🔴 新增/编辑一律【页内面板】而非弹窗，与工具管理页同一形状：正文是多行文本，
     弹窗里既要滚正文又要滚字段，管理员看不见上下文。面板与列表同级条件渲染，URL 不变、不加路由。

  🔴 每行可展开出【用例子表】（S7）。用例是某条模板**填好之后的完整正文**，用户在聊天面板的
     「示例」页签点一下就原样进输入框、可以直接发 —— 骨架不难看懂，难的是往 {{占位符}} 里填什么。
     子表刻意做成行内展开而不是第三个 viewMode：编辑示例时必须看得见「我在给哪条模板加」，
     切走整个列表那个上下文就丢了。示例编辑用弹窗，理由见 PromptTemplateCaseForm.vue 的头注释。
     删除模板会连带删除它名下的示例（后端同事务），故删除确认框必须把这件事说出来。

  权限（与后端 AgentPromptTemplateController / AgentPromptTemplateCaseController 的 @PreAuthorize 逐字一致）：
     读 = agent:prompt-template:query，新增 = :create，编辑 = :update，删除 = :delete。
     菜单与授权见 sql/mysql/xpy-2026-09-29-agent-prompt-template.sql。
     ⚠️ 用例子表**复用同一套权限点**，没有另起 agent:prompt-template-case:*：
        另起一套会让只被授了模板管理的角色看见「示例」按钮却点出 403。故 S7 零菜单、零按钮、零授权 SQL。
     ⚠️ 聊天面板那个模板下拉走的是 /simple-list，用 agent:assistant:use 兜底，
        所以「只有智能助手权限、没有本页权限」的用户照样能用模板，反之亦然。
-->
<template>
  <!-- ==================== 列表 ==================== -->
  <template v-if="viewMode === 'list'">
    <!-- 搜索 -->
    <ContentWrap>
      <el-form class="-mb-15px" :model="queryParams" ref="queryFormRef" :inline="true" label-width="68px">
        <el-form-item label="名称" prop="name">
          <el-input
            v-model="queryParams.name"
            placeholder="请输入模板名称"
            clearable
            @keyup.enter="handleQuery"
            class="!w-200px"
          />
        </el-form-item>
        <el-form-item label="正文" prop="content">
          <el-input
            v-model="queryParams.content"
            placeholder="按正文关键字找"
            clearable
            @keyup.enter="handleQuery"
            class="!w-200px"
          />
        </el-form-item>
        <el-form-item label="分类" prop="category">
          <el-select
            v-model="queryParams.category"
            placeholder="全部"
            clearable
            filterable
            class="!w-160px"
          >
            <el-option v-for="c in categoryOptions" :key="c" :label="c" :value="c" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态" prop="status">
          <el-select v-model="queryParams.status" placeholder="全部" clearable class="!w-140px">
            <el-option label="开启" :value="0" />
            <el-option label="关闭" :value="1" />
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
          <el-button
            type="primary"
            plain
            data-testid="tpl-create"
            @click="openForm()"
            v-hasPermi="['agent:prompt-template:create']"
          >
            <Icon icon="ep:plus" class="mr-5px" /> 新增
          </el-button>
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
        row-key="id"
        row-class-name="tpl-row"
        @expand-change="onExpandChange"
      >
        <!-- S7：展开出这条模板的用例子表 -->
        <el-table-column type="expand">
          <template #default="scope">
            <div class="case-panel" data-testid="case-panel" v-loading="caseLoading[scope.row.id]">
              <div class="case-panel-head">
                <span class="case-panel-title">
                  「{{ scope.row.name }}」的示例
                  <span class="case-panel-count">{{ (caseMap[scope.row.id] ?? []).length }} 条</span>
                </span>
                <el-button
                  type="primary"
                  size="small"
                  plain
                  data-testid="case-create"
                  v-hasPermi="['agent:prompt-template:create']"
                  @click="openCaseForm(scope.row)"
                >
                  <Icon icon="ep:plus" class="mr-4px" /> 新增示例
                </el-button>
              </div>
              <el-table :data="caseMap[scope.row.id] ?? []" size="small" border>
                <el-table-column label="标题" min-width="150" show-overflow-tooltip>
                  <template #default="s">
                    <span data-testid="case-title">{{ s.row.title }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="正文（点一下原样插进聊天输入框）" min-width="280" show-overflow-tooltip>
                  <template #default="s">
                    <span class="content-cell">{{ s.row.content }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="期望要点" min-width="220" show-overflow-tooltip>
                  <template #default="s">
                    <span v-if="s.row.expectHint">{{ s.row.expectHint }}</span>
                    <span v-else class="text-[var(--el-text-color-placeholder)]">未填</span>
                  </template>
                </el-table-column>
                <el-table-column label="期望分型" align="center" width="100">
                  <template #default="s">
                    <el-tag
                      v-if="s.row.expectIntent"
                      size="small"
                      effect="plain"
                      :type="s.row.expectIntent === 'BUILD' ? 'warning' : 'info'"
                      :data-testid="`case-intent-${s.row.expectIntent}`"
                    >
                      {{ s.row.expectIntent }}
                    </el-tag>
                    <!-- 🔴 显示「留空」而不是空白：留空是有意义的第三态（两种分型都算对），
                         空白会被读成「管理员忘了填」，于是有人去补一个会随机翻面的期望值 -->
                    <el-tooltip
                      v-else
                      content="留空 = 这条示例正压在「问怎么做」与「让你去做」的界线上，两种分型都算对，验收时不拿它做断言"
                      placement="top"
                    >
                      <span data-testid="case-intent-blank" class="text-[var(--el-text-color-placeholder)]">留空</span>
                    </el-tooltip>
                  </template>
                </el-table-column>
                <el-table-column label="排序" align="center" prop="sort" width="70" />
                <el-table-column label="状态" align="center" width="80">
                  <template #default="s">
                    <el-tag :type="s.row.status === 0 ? 'success' : 'info'" size="small">
                      {{ s.row.status === 0 ? '开启' : '关闭' }}
                    </el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="操作" align="center" width="120" fixed="right">
                  <template #default="s">
                    <el-button
                      link
                      type="primary"
                      data-testid="case-edit"
                      v-hasPermi="['agent:prompt-template:update']"
                      @click="openCaseForm(scope.row, s.row)"
                    >
                      编辑
                    </el-button>
                    <el-button
                      link
                      type="danger"
                      data-testid="case-delete"
                      v-hasPermi="['agent:prompt-template:delete']"
                      @click="handleDeleteCase(scope.row, s.row)"
                    >
                      删除
                    </el-button>
                  </template>
                </el-table-column>
                <template #empty>
                  <div class="case-empty">
                    这条模板还没有示例。示例是「填好之后的完整正文」，用户点一下就能直接发 ——
                    比骨架更能教会人怎么问。
                  </div>
                </template>
              </el-table>
            </div>
          </template>
        </el-table-column>
        <el-table-column
          label="序号"
          type="index"
          align="center"
          width="70"
          :index="indexMethod(queryParams)"
        />
        <el-table-column label="模板名称" align="center" min-width="160" show-overflow-tooltip>
          <template #default="scope">
            <span data-testid="tpl-name">{{ scope.row.name }}</span>
          </template>
        </el-table-column>
        <!--
          🔴 下面三列都挂 data-testid 而不是让 e2e 数 td:nth-child(n)：
             S7 在最左边加了「展开用例子表」那一列，所有列的位置一次性右移一位，
             按位置写的断言会**静默指到隔壁列**（第 3 列从「分类」变成「模板名称」），
             有的照样通过、有的报一个指向错误列的失败。按 testid 写就不会随列序漂。
        -->
        <el-table-column label="分类" align="center" min-width="110">
          <template #default="scope">
            <span data-testid="tpl-category">
              <el-tag v-if="scope.row.category" size="small" type="info">{{ scope.row.category }}</el-tag>
              <span v-else class="text-[var(--el-text-color-placeholder)]">{{ UNCATEGORIZED }}</span>
            </span>
          </template>
        </el-table-column>
        <el-table-column label="正文" align="left" min-width="260" show-overflow-tooltip>
          <template #default="scope">
            <span class="content-cell" data-testid="tpl-content">{{ scope.row.content }}</span>
          </template>
        </el-table-column>
        <el-table-column label="占位符" align="center" min-width="150">
          <template #default="scope">
            <span data-testid="tpl-placeholders">
              <el-tag
                v-for="p in placeholdersOf(scope.row.content)"
                :key="p"
                size="small"
                type="warning"
                effect="plain"
                class="mr-4px"
              >
                {{ p }}
              </el-tag>
              <span
                v-if="!placeholdersOf(scope.row.content).length"
                class="text-[var(--el-text-color-placeholder)]"
              >
                无
              </span>
            </span>
          </template>
        </el-table-column>
        <el-table-column label="排序" align="center" prop="sort" width="80" />
        <el-table-column label="状态" align="center" prop="status" width="90">
          <template #default="scope">
            <span data-testid="tpl-status">
              <el-tag :type="scope.row.status === 0 ? 'success' : 'info'" size="small">
                {{ scope.row.status === 0 ? '开启' : '关闭' }}
              </el-tag>
            </span>
          </template>
        </el-table-column>
        <el-table-column
          label="创建时间"
          align="center"
          prop="createTime"
          width="180"
          :formatter="dateFormatter"
        />
        <el-table-column label="操作" align="center" min-width="200" fixed="right">
          <template #default="scope">
            <el-button
              link
              type="primary"
              data-testid="tpl-view"
              @click="openForm(scope.row, 'view')"
              v-hasPermi="['agent:prompt-template:query']"
            >
              查看
            </el-button>
            <el-button
              link
              type="primary"
              data-testid="tpl-edit"
              @click="openForm(scope.row, 'edit')"
              v-hasPermi="['agent:prompt-template:update']"
            >
              编辑
            </el-button>
            <el-button
              link
              type="danger"
              data-testid="tpl-delete"
              @click="handleDelete(scope.row)"
              v-hasPermi="['agent:prompt-template:delete']"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <Pagination
        :total="total"
        v-model:page="queryParams.pageNo"
        v-model:limit="queryParams.pageSize"
        @pagination="getList"
      />
    </ContentWrap>

    <!-- S7：用例编辑弹窗。始终挂载（不是条件渲染），故 openCaseForm 里不用等 nextTick -->
    <PromptTemplateCaseForm ref="caseFormRef" @success="onCaseSaved" />
  </template>

  <!-- ==================== 页内面板（与列表同级，切 viewMode 换视图） ==================== -->
  <PromptTemplateForm v-else ref="formRef" @success="onSaved" @cancel="backToList" />
</template>

<script lang="ts" setup>
import { dateFormatter } from '@/utils/formatTime'
import {
  AgentPromptTemplateApi,
  placeholdersOf,
  UNCATEGORIZED,
  type AgentPromptTemplateVO
} from '@/api/agent/promptTemplate'
import PromptTemplateForm from './components/PromptTemplateForm.vue'
import PromptTemplateCaseForm from './components/PromptTemplateCaseForm.vue'
import {
  AgentPromptTemplateCaseApi,
  type AgentPromptTemplateCaseVO
} from '@/api/agent/promptTemplateCase'

// 🔴 必须与 system_menu.component_name 一致，否则 keep-alive 缓存不到本页
defineOptions({ name: 'AgentPromptTemplate' })

const message = useMessage()

/** 页内视图：list=列表，form=新增/编辑/查看面板 */
const viewMode = ref<'list' | 'form'>('list')

const loading = ref(true)
const total = ref(0)
const list = ref<AgentPromptTemplateVO[]>([])
const categoryOptions = ref<string[]>([])
const queryParams = reactive({
  pageNo: 1,
  pageSize: 20,
  name: undefined,
  content: undefined,
  category: undefined,
  status: undefined
})
const queryFormRef = ref()
const formRef = ref()

const getList = async () => {
  loading.value = true
  try {
    const data = await AgentPromptTemplateApi.getPromptTemplatePage(queryParams)
    list.value = data.list
    total.value = data.total
  } finally {
    loading.value = false
  }
}

const loadCategories = async () => {
  try {
    categoryOptions.value = (await AgentPromptTemplateApi.getCategoryList()) ?? []
  } catch {
    categoryOptions.value = []
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

const handleDelete = async (row: AgentPromptTemplateVO) => {
  try {
    // 🔴 删模板会**连带删它名下的示例**（后端 deletePromptTemplate 同事务做这件事）。
    //    确认框必须把它说出来：示例是人工一条条写的、删了不可恢复，
    //    只说「确认删除模板」的话，管理员事后会发现「我只是想删条模板，怎么示例也没了」。
    //    没展开过的行手里没有示例数，这里现拉一次；拉不到（比如只有 delete 没有 query 权限）
    //    就退化成不提数字，但「示例会一并删除」这句话一定要有。
    const cases = await AgentPromptTemplateCaseApi.getCaseListByTemplate(row.id).catch(() => null)
    const cascade =
      cases === null || !cases.length ? '它名下的示例会一并删除。' : `它名下的 ${cases.length} 条示例会一并删除。`
    await message.delConfirm(`确认删除模板「${row.name}」？${cascade}删除后聊天面板里就不再出现。`)
    await AgentPromptTemplateApi.deletePromptTemplate(row.id)
    message.success('删除成功')
    // 删掉本页最后一行就往前退一页：留在越界的空页上，管理员会以为「模板全没了」
    const lastPage = Math.max(1, Math.ceil((total.value - 1) / queryParams.pageSize))
    if (queryParams.pageNo > lastPage) queryParams.pageNo = lastPage
    await Promise.all([getList(), loadCategories()])
  } catch {}
}

// ==================== 用例子表（S7）====================

/**
 * 各模板已加载的用例，key=templateId
 *
 * <p>🔴 用 map 而不是一个扁平 list：子表是行内展开的，同一时刻可能有好几行同时开着。
 *    共用一个 list 的话，展开第二行会把第一行的内容换掉，看起来像「示例自己跑了」。
 */
const caseMap = reactive<Record<number, AgentPromptTemplateCaseVO[]>>({})
const caseLoading = reactive<Record<number, boolean>>({})
const caseFormRef = ref()

const loadCasesOf = async (templateId: number) => {
  caseLoading[templateId] = true
  try {
    // 🔴 走 /list-by-template 而不是 /simple-list：子表要**含关闭态**。
    //    用 simple-list 的话，管理员把一条示例关掉，它就当场从子表里消失 ——「删不掉也找不到」
    caseMap[templateId] = (await AgentPromptTemplateCaseApi.getCaseListByTemplate(templateId)) ?? []
  } catch {
    // 置空 + 明确报错，两件事都要做：只置空的话管理员会把「接口挂了」读成「这条模板没有示例」，
    // 然后去新建一条同名的；只报错不置空的话面板会一直转圈
    caseMap[templateId] = []
    message.error('示例加载失败，请稍后重试')
  } finally {
    caseLoading[templateId] = false
  }
}

/**
 * 行展开时拉这条模板的用例
 *
 * <p>🔴 每次展开都重拉、不做「拉过就不拉」的缓存：管理员常在另一个标签页改完示例切回来，
 * 缓存着旧数据的表现是「刚存的示例在这里找不到」。这张子表就几条到几十条，重拉的代价可以忽略。
 * <p>收起时不动缓存：expandedRows 是「当前所有展开的行」，收起时这一行不在里面，直接返回即可。
 */
const onExpandChange = (row: AgentPromptTemplateVO, expandedRows: AgentPromptTemplateVO[]) => {
  if (!expandedRows.some((r) => r.id === row.id)) return
  loadCasesOf(row.id)
}

const openCaseForm = (tpl: AgentPromptTemplateVO, row?: AgentPromptTemplateCaseVO) => {
  // 新示例的默认排序号取「这条模板下已有示例的最大值 + 10」，口径必须是子表（同一模板内部），
  // 不能取全表：跨模板撞号无所谓，同模板内撞号才会让聊天面板里的先后顺序变得说不清
  const sorts = (caseMap[tpl.id] ?? []).map((c) => c.sort ?? 0)
  caseFormRef.value?.open({ id: tpl.id, name: tpl.name }, row?.id, sorts)
}

const handleDeleteCase = async (tpl: AgentPromptTemplateVO, row: AgentPromptTemplateCaseVO) => {
  try {
    await message.delConfirm(`确认删除示例「${row.title}」？删除后聊天面板的「示例」页签里就不再出现。`)
    await AgentPromptTemplateCaseApi.deleteCase(row.id)
    message.success('删除成功')
    await loadCasesOf(tpl.id)
  } catch {}
}

/** 存完只刷这一条模板的子表：外层模板列表没变，重拉它只会让人白等一次并丢掉已展开的其他行 */
const onCaseSaved = (templateId: number) => loadCasesOf(templateId)

/**
 * 打开页内面板
 * 面板是 v-else 条件渲染的，切完 viewMode 要等 nextTick 让组件挂载后才能拿到 ref 调 open()
 */
const openForm = async (row?: AgentPromptTemplateVO, m?: 'view' | 'edit') => {
  viewMode.value = 'form'
  await nextTick()
  if (!row) {
    // 🔴 新建时的排序号候选必须是【全表】口径，不能拿当前页的 list：
    //    新模板要「排在最后一条之后」，而当前页只是全表的一页（模板已 40 条、分两页），
    //    取页内最大值 +10 会和后面几页撞号——结果是以为排在最后、实际插在中间，聊天面板顺序就乱了。
    //    simple-list 不分页，正是全量口径；它只含开启中的模板，与已关闭的撞号无妨
    //    （关闭的本就不进聊天面板，重新开启时同序号由 id 兜底排序）。
    const all = await AgentPromptTemplateApi.getSimplePromptTemplateList().catch(() => [])
    formRef.value?.setKnownSorts(all.map((item) => item.sort ?? 0))
  }
  formRef.value?.open(row?.id, m)
}

/**
 * 保存成功：回列表并刷新（分类可能新增了，一并重取）
 *
 * 🔴 新增后跳到【最后一页】：新模板的排序号是「全表最大 + 10」，在 sort 升序的列表里必然垫底。
 *    不跳的话管理员存完停在第 1 页、看不见自己刚建的那条——正是本模块头号缺陷
 *    「保存成功但不生效且无提示」的形状。编辑不改排序号，行还在原页，不用跳。
 */
const onSaved = async (isCreate: boolean) => {
  viewMode.value = 'list'
  await Promise.all([getList(), loadCategories()])
  if (!isCreate) return
  const lastPage = Math.max(1, Math.ceil(total.value / queryParams.pageSize))
  if (lastPage === queryParams.pageNo) return
  queryParams.pageNo = lastPage
  await getList()
}

/** 返回：只回列表，不强制刷新（没改过东西就别白发一次请求） */
const backToList = () => {
  viewMode.value = 'list'
}

onMounted(() => {
  getList()
  loadCategories()
})

// 页面被 keep-alive 缓存时 onMounted 不重跑，故 onActivated 兜底刷新。首次激活跳过，避免与 onMounted 重复请求。
let firstActivated = true
onActivated(() => {
  if (firstActivated) {
    firstActivated = false
    return
  }
  // 从面板态被激活时不回列表：用户可能只是切走又切回来，强行退回会丢掉填了一半的正文
  if (viewMode.value === 'list') {
    getList()
    loadCategories()
  }
})
</script>

<style lang="scss" scoped>
.content-cell {
  // 正文里的换行在表格里压成一行（列已开 show-overflow-tooltip，悬停看全文）
  white-space: pre-line;
}

/* S7 用例子表：展开行里的内容。左右各留一点内边距，否则子表会顶着外层表格的边框，
   看起来像是「表格套表格出错了」而不是「这是这条模板的下级内容」。 */
.case-panel {
  padding: 8px 16px 12px 48px;
}

.case-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.case-panel-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.case-panel-count {
  margin-left: 6px;
  font-weight: 400;
  color: var(--el-text-color-secondary);
}

.case-empty {
  padding: 12px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
  text-align: left;
}
</style>
