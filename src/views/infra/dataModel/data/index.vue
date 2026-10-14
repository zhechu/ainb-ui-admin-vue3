<template>
  <ContentWrap>
    <!-- 模型选择 + 展示模式切换：所有操作都以选中的模型为上下文 -->
    <div class="flex items-center justify-between">
      <el-form :inline="true" class="-mb-15px">
        <el-form-item label="数据模型">
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
      <el-radio-group v-model="viewMode" class="mb-15px">
        <el-radio-button value="raw">原始数据</el-radio-button>
        <el-radio-button value="formatted">展示模式</el-radio-button>
      </el-radio-group>
    </div>
  </ContentWrap>

  <template v-if="modelId">
    <!-- 原始数据模式的查询区：单条件「字段 + 关键字」模糊搜索 -->
    <ContentWrap v-if="viewMode === 'raw'">
      <el-form :inline="true" class="-mb-15px">
        <el-form-item label="字段">
          <el-select
            v-model="rawQueryColumn"
            placeholder="选择字段"
            clearable
            filterable
            class="!w-240px"
          >
            <el-option
              v-for="column in columns"
              :key="column.columnName"
              :label="column.columnComment
                ? `${column.columnName}（${column.columnComment}）`
                : column.columnName"
              :value="column.columnName"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="关键字">
          <el-input
            v-model="rawKeyword"
            placeholder="输入关键字模糊匹配"
            clearable
            class="!w-240px"
            @keyup.enter="handleQuery"
          />
        </el-form-item>
        <el-form-item>
          <el-button @click="handleQuery"><Icon icon="ep:search" class="mr-5px" /> 搜索</el-button>
          <el-button @click="resetQuery"><Icon icon="ep:refresh" class="mr-5px" /> 重置</el-button>
        </el-form-item>
      </el-form>
    </ContentWrap>

    <!-- 展示模式的动态查询区：按字段类型渲染 -->
    <ContentWrap v-else>
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
          </el-button> -->
        </el-form-item>
      </el-form>
    </ContentWrap>

    <!-- 动态列表：原始模式列=物理字段名、值不格式化；展示模式列=注释、值格式化 -->
    <ContentWrap>
      <el-table
        class="xpy-list-table"
        stripe
        v-loading="loading"
        :data="list"
        :row-class-name="() => 'cursor-pointer'"
        @sort-change="handleSortChange"
        @row-click="handleRowClick"
      >
        <el-table-column
          label="序号"
          type="index"
          width="44"
          align="center"
          :index="indexMethod({ pageNo, pageSize })"
          class-name="col-index"
          label-class-name="col-index"
        />
        <!-- 原始数据模式：全部物理列（含系统列），原样展示 -->
        <template v-if="viewMode === 'raw'">
          <el-table-column
            v-for="column in columns"
            :key="column.columnName"
            :label="column.columnName"
            :prop="column.columnName"
            :show-overflow-tooltip="true"
            min-width="120"
            sortable="custom"
          >
            <template #default="{ row }">
              <span v-if="row[column.columnName] === null || row[column.columnName] === undefined"
                class="text-[var(--el-text-color-secondary)]">-</span>
              <span v-else>{{ String(row[column.columnName]) }}</span>
            </template>
          </el-table-column>
        </template>
        <!-- 展示模式：过滤系统列，格式化显示 -->
        <template v-else>
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
              <span v-if="row[column.columnName] === null"
                class="text-[var(--el-text-color-secondary)]">-</span>
              <span v-else>{{ formatCellValue(row[column.columnName], column) }}</span>
            </template>
          </el-table-column>
        </template>
        <template #empty>
          <span class="text-[var(--el-text-color-secondary)]">暂无数据</span>
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

  <el-empty v-else description="请先选择一个数据模型" />

  <!-- 动态表单 -->
  <DataForm ref="formRef" @success="getList" />
  <!-- 行详情：点击任意行查看全部字段的原始值 -->
  <RowDetailDialog ref="rowDetailRef" />
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
import RowDetailDialog from './RowDetailDialog.vue'

/** 数据查看（菜单原名「业务数据」）：免代码生成的动态 CRUD */
defineOptions({ name: 'InfraDataModelData' })

const message = useMessage()
const { t } = useI18n()
const route = useRoute() // 用于接收数据模型页跳转带来的 modelId

/**
 * 展示模式：raw=原始数据（默认，列=物理字段名、值不格式化），
 * formatted=展示模式（列=字段注释、值按类型格式化）
 */
const viewMode = ref<'raw' | 'formatted'>('raw')

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

/** 原始模式的单条件搜索状态 */
const rawQueryColumn = ref<string>()
const rawKeyword = ref('')

/** 查询区字段（展示模式） */
const queryColumns = computed(() => columns.value.filter(isQueryable))
/** 列表展示字段（展示模式） */
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
  rawQueryColumn.value = undefined
  rawKeyword.value = ''
  sortField.value = undefined
  pageNo.value = 1
  if (!modelId.value) {
    return
  }
  columns.value = await DataApi.getDataColumns(modelId.value)
  await getList()
}

/** 切换展示模式：重置分页与两种模式各自的查询条件后重查（列定义共用） */
watch(viewMode, () => {
  queryValues.value = {}
  rawQueryColumn.value = undefined
  rawKeyword.value = ''
  pageNo.value = 1
  getList()
})

/** 把查询区的值转成后端要的条件数组；空值跳过 */
const buildConditions = (): DataApi.DataConditionVO[] => {
  // 原始模式：单条件 LIKE（% 包裹由服务端完成）
  if (viewMode.value === 'raw') {
    if (!rawQueryColumn.value || !rawKeyword.value) {
      return []
    }
    return [
      {
        columnName: rawQueryColumn.value,
        operator: 'LIKE',
        value: rawKeyword.value
      }
    ]
  }
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
  rawQueryColumn.value = undefined
  rawKeyword.value = ''
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

/** 点击行：弹窗查看该行全部字段的原始值（含系统列），不发请求 */
const rowDetailRef = ref()
const handleRowClick = (row: DataApi.DataRowVO) => {
  rowDetailRef.value?.open(row, columns.value)
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

/**
 * 初始化
 *
 * 支持从数据模型页跳转过来时带 modelId，直接定位到该模型并加载数据，
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
