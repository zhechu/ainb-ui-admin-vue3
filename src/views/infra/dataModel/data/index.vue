<template>
  <ContentWrap>
    <!-- 模型选择：所有操作都以选中的模型为上下文 -->
    <el-form :inline="true" class="-mb-15px">
      <el-form-item label="业务模型">
        <el-select
          v-model="modelId"
          placeholder="请选择模型"
          clearable
          filterable
          class="!w-260px"
          @change="handleModelChange"
        >
          <el-option
            v-for="item in modelList"
            :key="item.id"
            :label="`${item.modelName}（${item.tableName}）`"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
    </el-form>
  </ContentWrap>

  <template v-if="modelId">
    <!-- 动态查询区：按字段类型渲染 -->
    <ContentWrap>
      <el-form :inline="true" class="-mb-15px">
        <el-form-item
          v-for="column in queryColumns"
          :key="column.columnName"
          :label="column.columnComment || column.columnName"
        >
          <el-input
            v-if="resolveFormWidget(column) === 'input'"
            v-model="queryValues[column.columnName]"
            :placeholder="`请输入${column.columnComment}`"
            clearable
            class="!w-180px"
            @keyup.enter="handleQuery"
          />
          <el-input-number
            v-else-if="resolveFormWidget(column) === 'number'"
            v-model="queryValues[column.columnName]"
            :placeholder="column.columnComment"
            controls-position="right"
            class="!w-160px"
          />
          <el-select
            v-else-if="resolveFormWidget(column) === 'switch'"
            v-model="queryValues[column.columnName]"
            placeholder="全部"
            clearable
            class="!w-120px"
          >
            <el-option label="是" :value="true" />
            <el-option label="否" :value="false" />
          </el-select>
          <el-date-picker
            v-else
            v-model="queryValues[column.columnName]"
            :type="column.columnType === 'DATE' ? 'date' : 'datetime'"
            :value-format="column.columnType === 'DATE' ? 'YYYY-MM-DD' : 'YYYY-MM-DD HH:mm:ss'"
            placeholder="请选择"
            class="!w-190px"
          />
        </el-form-item>
        <el-form-item>
          <el-button @click="handleQuery"><Icon icon="ep:search" class="mr-5px" /> 搜索</el-button>
          <el-button @click="resetQuery"><Icon icon="ep:refresh" class="mr-5px" /> 重置</el-button>
          <!-- <el-button
            type="primary"
            plain
            @click="openForm('create')"
            v-hasPermi="['infra:data-model-data:create']"
          >
            <Icon icon="ep:plus" class="mr-5px" /> 新增
          </el-button>
          <el-button
            type="danger"
            plain
            :disabled="checkedIds.length === 0"
            @click="handleDeleteBatch"
            v-hasPermi="['infra:data-model-data:delete']"
          >
            <Icon icon="ep:delete" class="mr-5px" /> 批量删除
          </el-button> -->
        </el-form-item>
      </el-form>
    </ContentWrap>

    <!-- 动态列表 -->
    <ContentWrap>
      <el-table class="xpy-list-table" stripe
        v-loading="loading"
        :data="list"
        @selection-change="handleRowCheckboxChange"
        @sort-change="handleSortChange"
      >
        <el-table-column type="selection" width="55" />
        <el-table-column
          label="序号"
          type="index"
          width="44"
          align="center"
          :index="indexMethod({ pageNo, pageSize })"
        class-name="col-index"
        label-class-name="col-index"
      />
        <el-table-column
          v-for="column in listColumns"
          :key="column.columnName"
          :label="column.columnComment || column.columnName"
          :prop="column.columnName"
          :show-overflow-tooltip="true"
          :min-width="isDateType(column.columnType) ? 170 : 120"
          sortable="custom"
        >
          <template #default="{ row }">
            <span v-if="row[column.columnName] === null" class="text-gray-400">-</span>
            <span v-else>{{ formatCellValue(row[column.columnName], column) }}</span>
          </template>
        </el-table-column>
        <!-- <el-table-column label="操作" align="center" width="140" fixed="right">
          <template #default="{ row }">
            <el-button
              link
              type="primary"
              @click="openForm('update', row.id)"
              v-hasPermi="['infra:data-model-data:update']"
            >
              编辑
            </el-button>
            <el-button
              link
              type="danger"
              @click="handleDelete(row.id)"
              v-hasPermi="['infra:data-model-data:delete']"
            >
              删除
            </el-button>
          </template>
        </el-table-column> -->
        <template #empty>
          <span class="text-gray-400">暂无数据</span>
        </template>
      </el-table>
      <Pagination
        :total="total"
        v-model:page="pageNo"
        v-model:limit="pageSize"
        @pagination="getList"
      />
    </ContentWrap>
  </template>

  <el-empty v-else description="请先选择一个业务模型" />

  <!-- 动态表单 -->
  <DataForm ref="formRef" @success="getList" />
</template>

<script lang="ts" setup>
import * as DataModelApi from '@/api/infra/dataModel'
import * as DataApi from '@/api/infra/dataModel/data'
import type { DataModelColumnVO } from '@/api/infra/dataModel'
import {
  formatCellValue,
  isDateType,
  isEditable,
  isQueryable,
  isVisibleInList,
  resolveFormWidget,
  resolveQueryOperator
} from './columnMeta'
import DataForm from './DataForm.vue'

/** 业务数据管理（免代码生成的动态 CRUD） */
defineOptions({ name: 'InfraDataModelData' })

const message = useMessage()
const { t } = useI18n()
const route = useRoute() // 用于接收数据建模页跳转带来的 modelId

const modelList = ref<DataModelApi.DataModelVO[]>([])
const modelId = ref<number>()
const columns = ref<DataModelColumnVO[]>([])
const list = ref<DataApi.DataRowVO[]>([])
const total = ref(0)
const loading = ref(false)
const pageNo = ref(1)
const pageSize = ref(20)
const queryValues = ref<Record<string, any>>({})
const sortField = ref<string>()
const sortAsc = ref(false)
const checkedIds = ref<(string | number)[]>([])

/** 查询区字段 */
const queryColumns = computed(() => columns.value.filter(isQueryable))
/** 列表展示字段 */
const listColumns = computed(() => columns.value.filter(isVisibleInList))

/** 加载可选模型 */
const getModelList = async () => {
  const data = await DataModelApi.getDataModelPage({ pageNo: 1, pageSize: 100 })
  modelList.value = data.list
}

/** 切换模型：字段、查询条件、分页全部重置 */
const handleModelChange = async () => {
  columns.value = []
  list.value = []
  total.value = 0
  queryValues.value = {}
  sortField.value = undefined
  pageNo.value = 1
  if (!modelId.value) {
    return
  }
  columns.value = await DataApi.getDataColumns(modelId.value)
  await getList()
}
/** 把查询区的值转成后端要的条件数组；空值跳过 */
const buildConditions = (): DataApi.DataConditionVO[] => {
  const conditions: DataApi.DataConditionVO[] = []
  queryColumns.value.forEach((column) => {
    const value = queryValues.value[column.columnName]
    if (value === undefined || value === null || value === '') {
      return
    }
    conditions.push({
      columnName: column.columnName,
      operator: resolveQueryOperator(column),
      value
    })
  })
  return conditions
}

const getList = async () => {
  if (!modelId.value) {
    return
  }
  loading.value = true
  try {
    const data = await DataApi.getDataPage({
      modelId: modelId.value,
      pageNo: pageNo.value,
      pageSize: pageSize.value,
      conditions: buildConditions(),
      sortField: sortField.value,
      sortAsc: sortAsc.value
    })
    list.value = data.list
    total.value = data.total
  } finally {
    loading.value = false
  }
}

const handleQuery = () => {
  pageNo.value = 1
  getList()
}

const resetQuery = () => {
  queryValues.value = {}
  handleQuery()
}

/** 排序：字段名交给后端做白名单校验 */
const handleSortChange = ({ prop, order }: { prop: string; order: string | null }) => {
  if (!order) {
    sortField.value = undefined
  } else {
    sortField.value = prop
    sortAsc.value = order === 'ascending'
  }
  getList()
}

const handleRowCheckboxChange = (rows: DataApi.DataRowVO[]) => {
  checkedIds.value = rows.map((row) => row.id)
}

const formRef = ref()
const openForm = (type: string, id?: string | number) => {
  formRef.value.open(type, modelId.value, columns.value.filter(isEditable), id)
}

const handleDelete = async (id: string | number) => {
  try {
    await message.delConfirm()
    await DataApi.deleteData(modelId.value!, id)
    message.success(t('common.delSuccess'))
    await getList()
  } catch {
    // 取消删除，无需处理
  }
}

const handleDeleteBatch = async () => {
  try {
    await message.delConfirm()
    await DataApi.deleteDataList(modelId.value!, checkedIds.value)
    message.success(t('common.delSuccess'))
    checkedIds.value = []
    await getList()
  } catch {
    // 取消删除，无需处理
  }
}

/**
 * 初始化
 *
 * 支持从数据建模页跳转过来时带 modelId，直接定位到该模型并加载数据，
 * 省掉「进来还要再选一次模型」的多余一步。
 */
onMounted(async () => {
  await getModelList()
  const queryModelId = route.query.modelId
  if (queryModelId) {
    const id = Number(queryModelId)
    // 确认该模型确实在可选列表里，避免传了无效 id 后页面卡在空白态
    if (modelList.value.some((item) => item.id === id)) {
      modelId.value = id
      await handleModelChange()
    }
  }
})
</script>
