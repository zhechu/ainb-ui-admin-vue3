<template>
  <!-- 搜索 -->
  <ContentWrap>
    <el-form
      class="-mb-15px"
      :model="queryParams"
      ref="queryFormRef"
      :inline="true"
      label-width="68px"
    >
      <el-form-item label="规则名称" prop="name">
        <el-input
          v-model="queryParams.name"
          placeholder="请输入规则名称"
          clearable
          @keyup.enter="handleQuery"
          class="!w-240px"
        />
      </el-form-item>
      <el-form-item label="规则模板" prop="template">
        <el-input
          v-model="queryParams.template"
          placeholder="请输入模板代码"
          clearable
          @keyup.enter="handleQuery"
          class="!w-240px"
        />
      </el-form-item>
      <el-form-item label="来源" prop="builtIn">
        <el-select v-model="queryParams.builtIn" placeholder="请选择来源" clearable class="!w-240px">
          <el-option label="系统内置" :value="true" />
          <el-option label="自定义" :value="false" />
        </el-select>
      </el-form-item>
      <el-form-item label="状态" prop="status">
        <el-select v-model="queryParams.status" placeholder="请选择状态" clearable class="!w-240px">
          <el-option
            v-for="dict in getIntDictOptions(DICT_TYPE.COMMON_STATUS)"
            :key="dict.value"
            :label="dict.label"
            :value="dict.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="创建时间" prop="createTime">
        <el-date-picker
          v-model="queryParams.createTime"
          value-format="YYYY-MM-DD HH:mm:ss"
          type="daterange"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          :default-time="[new Date('1 00:00:00'), new Date('1 23:59:59')]"
          class="!w-240px"
        />
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
          @click="openForm()"
          v-hasPermi="['system:rule:create']"
        >
          <Icon icon="ep:plus" class="mr-5px" />
          新增
        </el-button>
        <el-button
          type="danger"
          plain
          :disabled="checkedIds.length === 0"
          @click="handleDeleteBatch"
          v-hasPermi="['system:rule:delete']"
        >
          <Icon icon="ep:delete" class="mr-5px" />
          批量删除
        </el-button>
      </el-form-item>
    </el-form>
  </ContentWrap>

  <!-- 列表 -->
  <ContentWrap>
    <el-table class="xpy-list-table" stripe
      ref="tableRef"
      v-loading="loading"
      :data="list"
      :height="tableHeight"
      @selection-change="handleRowCheckboxChange"
    >
      <!-- 内置规则后端拒删，勾选了会让整批失败，直接禁选 -->
      <el-table-column type="selection" width="55" :selectable="(row) => !row.builtIn" />
      <el-table-column label="序号" type="index" width="44" align="center" :index="indexMethod(queryParams)" class-name="col-index"
        label-class-name="col-index"
      />
      <el-table-column label="规则编号" align="center" prop="id" width="90" />
      <el-table-column label="规则名称" align="center" prop="name" min-width="140" />
      <el-table-column label="来源" align="center" width="90">
        <template #default="scope">
          <!--
            ⚠️ 判据是 builtIn 字段，不是 template 以 BUILT_IN_ 开头。
            管理员自己建的规则同样可以选内置模板（比如基于「仅自己的数据」建一条），
            拿模板判会把它们全标成「内置」，还连带着让删除按钮被禁用
          -->
          <el-tag :type="scope.row.builtIn ? 'info' : 'warning'">
            {{ scope.row.builtIn ? '内置' : '自定义' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="模板" align="center" prop="template" min-width="140">
        <template #default="scope">
          {{ getTemplateLabel(scope.row.template) }}
        </template>
      </el-table-column>
      <el-table-column label="参数" align="center" prop="params" min-width="160">
        <template #default="scope">
          <!-- 白话摘要，原始 JSON 收进 tooltip（summarizeParams 解析失败时回退原文） -->
          <el-tooltip
            :disabled="!scope.row.params"
            placement="top"
            :content="scope.row.params"
          >
            <span>{{ paramSummary(scope.row) }}</span>
          </el-tooltip>
        </template>
      </el-table-column>
      <el-table-column
        label="描述"
        align="center"
        prop="description"
        min-width="160"
        show-overflow-tooltip
      />
      <el-table-column label="状态" align="center" prop="status" width="80">
        <template #default="scope">
          <dict-tag :type="DICT_TYPE.COMMON_STATUS" :value="scope.row.status" />
        </template>
      </el-table-column>
      <el-table-column
        label="创建时间"
        align="center"
        prop="createTime"
        width="180"
        :formatter="dateFormatter"
      />
      <el-table-column label="操作" align="center" width="130" fixed="right">
        <template #default="scope">
          <!-- 内置规则只读：给「查看」（只读弹窗），不给「编辑」 -->
          <el-button v-if="scope.row.builtIn" link type="primary" @click="openForm(scope.row)">
            查看
          </el-button>
          <el-button
            v-else
            link
            type="primary"
            @click="openForm(scope.row)"
            v-hasPermi="['system:rule:update']"
          >
            编辑
          </el-button>
          <el-button
            link
            type="danger"
            :disabled="scope.row.builtIn"
            :title="scope.row.builtIn ? '内置规则不能删除，可将其停用' : ''"
            @click="handleDelete(scope.row.id)"
            v-hasPermi="['system:rule:delete']"
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

  <!-- 表单弹窗：添加/修改 -->
  <RuleForm ref="formRef" @success="getList" />
</template>

<script lang="ts" setup>
import { DICT_TYPE, getIntDictOptions } from '@/utils/dict'
import { dateFormatter } from '@/utils/formatTime'
import * as GrantApi from '@/api/system/grant'
import type { RuleVO } from '@/api/system/grant'
import RuleForm from './RuleForm.vue'
import { useRuleTemplateMeta } from './useRuleTemplateMeta'
import { summarizeParams } from './components/ruleParams'

defineOptions({ name: 'SystemRule' })

const message = useMessage() // 消息弹窗
const { meta, load, getTemplateLabel } = useRuleTemplateMeta()

const loading = ref(true) // 列表的加载中
const total = ref(0) // 列表的总条数
const list = ref<RuleVO[]>([]) // 列表的数据

/**
 * 表格高度：按表格【实际位置】算，不用 innerHeight 减魔数
 *
 * ⚠️ 必须用 :height 而不是 :max-height —— max-height 时内容少则表格塌到内容高度，
 * 卡片跟着缩，底部空出一大片（实测搜索后只剩几行时空 275px）。
 * ContentWrap 自带的撑高对本页也不生效（它要求表格没设自定义高度）
 */
const tableRef = ref()
const tableHeight = ref(420)
const recalcHeight = () => {
  const el = tableRef.value?.$el as HTMLElement | undefined
  if (!el) {
    tableHeight.value = Math.max(240, window.innerHeight - 360)
    return
  }
  // 减去分页条的真实高度，而不是拍一个经验值 —— 分页条是否换行、有没有显示，
  // 在不同页宽下并不一样
  const pager = document.querySelector('.el-pagination') as HTMLElement | null
  const pagerH = pager ? pager.getBoundingClientRect().height + 16 : 0
  tableHeight.value = Math.max(
    240,
    Math.floor(window.innerHeight - el.getBoundingClientRect().top - pagerH - 24)
  )
}
const queryParams = reactive({
  pageNo: 1,
  pageSize: 20,
  name: undefined,
  template: undefined,
  builtIn: undefined,
  status: undefined,
  createTime: []
})
const queryFormRef = ref() // 搜索的表单

/** 参数列白话摘要（模板元数据驱动，DEPT_IN 也能正确显示「指定部门数据」） */
const paramSummary = (row: RuleVO) => summarizeParams(row.template, row.params, meta.value)

/** 查询列表 */
const getList = async () => {
  loading.value = true
  try {
    const data = await GrantApi.getRulePage(queryParams)
    list.value = data.list
    total.value = data.total
  } finally {
    loading.value = false
  }
}

/** 搜索按钮操作 */
const handleQuery = () => {
  queryParams.pageNo = 1
  getList()
}

/** 重置按钮操作 */
const resetQuery = () => {
  queryFormRef.value.resetFields()
  handleQuery()
}

/** 添加/修改操作 */
const formRef = ref()
const openForm = (row?: RuleVO) => {
  formRef.value?.open(row)
}

/** 删除按钮操作 */
const handleDelete = async (id: number) => {
  // 内置规则的删除按钮已禁用，这里是兜底
  await message.confirm('确认删除该规则？删除后引用它的授权行将失去行过滤效果。')
  await GrantApi.deleteRule(id)
  message.success('删除成功')
  await getList()
}

/** 批量删除按钮操作 */
const checkedIds = ref<number[]>([])
const handleRowCheckboxChange = (rows: RuleVO[]) => {
  checkedIds.value = rows.map((row) => row.id)
}

const handleDeleteBatch = async () => {
  try {
    await message.confirm(
      `确认删除选中的 ${checkedIds.value.length} 条规则？删除后引用它们的授权行将失去行过滤效果。`
    )
    await GrantApi.deleteRuleList(checkedIds.value)
    checkedIds.value = []
    message.success('删除成功')
    await getList()
  } catch {}
}

/** 初始化 **/
onMounted(async () => {
  window.addEventListener('resize', recalcHeight)
  // 元数据用于模板名/参数摘要，失败不阻断列表（摘要会回退原文）
  load().catch(() => {})
  await getList()
  await nextTick()
  recalcHeight()
})
onUnmounted(() => window.removeEventListener('resize', recalcHeight))
</script>
