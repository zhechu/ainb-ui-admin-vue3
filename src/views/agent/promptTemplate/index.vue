<!--
  提示词模板管理（需求7）

  模板 = 聊天面板的「提问起手式」：用户点一下，正文插入输入框，改完再发送。
  它不进系统提示词、不影响工具调用与权限，故本页没有风险等级/权限串那类安全字段。

  🔴 新增/编辑一律【页内面板】而非弹窗，与工具管理页同一形状：正文是多行文本，
     弹窗里既要滚正文又要滚字段，管理员看不见上下文。面板与列表同级条件渲染，URL 不变、不加路由。

  权限（与后端 AgentPromptTemplateController 的 @PreAuthorize 逐字一致）：
     读 = agent:prompt-template:query，新增 = :create，编辑 = :update，删除 = :delete。
     菜单与授权见 sql/mysql/xpy-2026-09-29-agent-prompt-template.sql。
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
          <el-button type="primary" plain @click="openForm()" v-hasPermi="['agent:prompt-template:create']">
            <Icon icon="ep:plus" class="mr-5px" /> 新增
          </el-button>
        </el-form-item>
      </el-form>
    </ContentWrap>

    <!-- 列表 -->
    <ContentWrap>
      <el-alert type="info" :closable="false" class="mb-12px">
        <template #title>
          <span class="text-12px">
            模板保存后<b>立即</b>出现在「智能助手」输入框旁的模板按钮里（关闭态除外），无需重启或刷新其它页面。
            正文里的 <code v-pre>{{占位符}}</code> 会在插入后高亮提醒用户替换。
          </span>
        </template>
      </el-alert>

      <el-table class="xpy-list-table" stripe v-loading="loading" :data="list">
        <el-table-column
          label="序号"
          type="index"
          align="center"
          width="70"
          :index="indexMethod(queryParams)"
        />
        <el-table-column label="模板名称" align="center" prop="name" min-width="160" show-overflow-tooltip />
        <el-table-column label="分类" align="center" min-width="110">
          <template #default="scope">
            <el-tag v-if="scope.row.category" size="small" type="info">{{ scope.row.category }}</el-tag>
            <span v-else class="text-[var(--el-text-color-placeholder)]">{{ UNCATEGORIZED }}</span>
          </template>
        </el-table-column>
        <el-table-column label="正文" align="left" min-width="260" show-overflow-tooltip>
          <template #default="scope">
            <span class="content-cell">{{ scope.row.content }}</span>
          </template>
        </el-table-column>
        <el-table-column label="占位符" align="center" min-width="150">
          <template #default="scope">
            <template v-if="placeholdersOf(scope.row.content).length">
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
            </template>
            <span v-else class="text-[var(--el-text-color-placeholder)]">无</span>
          </template>
        </el-table-column>
        <el-table-column label="排序" align="center" prop="sort" width="80" />
        <el-table-column label="状态" align="center" prop="status" width="90">
          <template #default="scope">
            <el-tag :type="scope.row.status === 0 ? 'success' : 'info'" size="small">
              {{ scope.row.status === 0 ? '开启' : '关闭' }}
            </el-tag>
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
              @click="openForm(scope.row, 'view')"
              v-hasPermi="['agent:prompt-template:query']"
            >
              查看
            </el-button>
            <el-button
              link
              type="primary"
              @click="openForm(scope.row, 'edit')"
              v-hasPermi="['agent:prompt-template:update']"
            >
              编辑
            </el-button>
            <el-button
              link
              type="danger"
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
    await message.delConfirm(`确认删除模板「${row.name}」？删除后聊天面板里就不再出现。`)
    await AgentPromptTemplateApi.deletePromptTemplate(row.id)
    message.success('删除成功')
    // 删掉本页最后一行就往前退一页：留在越界的空页上，管理员会以为「模板全没了」
    const lastPage = Math.max(1, Math.ceil((total.value - 1) / queryParams.pageSize))
    if (queryParams.pageNo > lastPage) queryParams.pageNo = lastPage
    await Promise.all([getList(), loadCategories()])
  } catch {}
}

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
</style>
