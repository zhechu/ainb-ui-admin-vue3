<template>
  <Dialog :title="dialogTitle" v-model="dialogVisible" width="1100px">
    <el-form ref="formRef" :model="formData" :rules="formRules" label-width="90px">
      <el-row :gutter="20">
        <el-col :span="8">
          <el-form-item label="表名" prop="tableName">
            <el-input
              v-model="formData.tableName"
              placeholder="如 biz_order"
              :disabled="formType === 'update'"
            />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="表描述" prop="tableComment">
            <el-input v-model="formData.tableComment" placeholder="如 订单表" />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="模型名称" prop="modelName">
            <el-input v-model="formData.modelName" placeholder="如 订单模型" />
          </el-form-item>
        </el-col>
      </el-row>
      <el-form-item label="备注" prop="remark">
        <el-input v-model="formData.remark" placeholder="选填" />
      </el-form-item>
    </el-form>

    <!-- 字段编辑区 -->
    <div class="mb-10px flex items-center justify-between">
      <span class="font-bold">字段列表</span>
      <div>
        <el-button size="small" type="primary" plain @click="handleAddColumn">
          <Icon icon="ep:plus" class="mr-5px" /> 添加字段
        </el-button>
        <el-button size="small" plain @click="handlePreviewDdl">
          <Icon icon="ep:view" class="mr-5px" /> 预览 DDL
        </el-button>
      </div>
    </div>
    <el-alert v-if="formType === 'update'" type="info" :closable="false" class="mb-10px">
      <template #title>
        直接改字段名即视为<b>重命名</b>（保留数据）；删除行则会<b>删除该字段及其数据</b>。
        拖动最左侧图标可调整顺序，但顺序仅影响新建时的字段排列。
      </template>
    </el-alert>

    <el-table :data="formData.columns" border size="small" max-height="400">
      <el-table-column label="" width="40" align="center">
        <template #default>
          <Icon icon="ep:rank" class="cursor-move drag-handle" />
        </template>
      </el-table-column>
      <el-table-column label="字段名" width="150">
        <template #default="{ row }">
          <el-input v-model="row.columnName" size="small" placeholder="字段名" />
        </template>
      </el-table-column>
      <el-table-column label="描述" width="140">
        <template #default="{ row }">
          <el-input v-model="row.columnComment" size="small" placeholder="描述" />
        </template>
      </el-table-column>
      <el-table-column label="类型" width="130">
        <template #default="{ row }">
          <el-select v-model="row.columnType" size="small" @change="handleTypeChange(row)">
            <el-option
              v-for="item in columnTypeList"
              :key="item.type"
              :label="item.type"
              :value="item.type"
            >
              <span>{{ item.type }}</span>
              <span class="ml-10px text-gray-400">{{ item.mysqlType }}</span>
            </el-option>
          </el-select>
        </template>
      </el-table-column>
      <el-table-column label="长度" width="90">
        <template #default="{ row }">
          <el-input-number
            v-if="needLength(row.columnType)"
            v-model="row.length"
            size="small"
            :min="1"
            :max="65535"
            controls-position="right"
            class="!w-80px"
          />
          <span v-else class="text-gray-400">-</span>
        </template>
      </el-table-column>
      <el-table-column label="精度" width="80">
        <template #default="{ row }">
          <el-input-number
            v-if="needScale(row.columnType)"
            v-model="row.scale"
            size="small"
            :min="0"
            :max="30"
            controls-position="right"
            class="!w-70px"
          />
          <span v-else class="text-gray-400">-</span>
        </template>
      </el-table-column>
      <el-table-column label="可空" width="60" align="center">
        <template #default="{ row }">
          <el-checkbox v-model="row.nullable" :disabled="row.primaryKey" />
        </template>
      </el-table-column>
      <el-table-column label="主键" width="60" align="center">
        <template #default="{ row }">
          <el-radio
            :model-value="row.primaryKey"
            :value="true"
            :label="true"
            @change="handlePrimaryKeyChange(row)"
          />
        </template>
      </el-table-column>
      <el-table-column label="自增" width="60" align="center">
        <template #default="{ row }">
          <el-checkbox v-model="row.autoIncrement" :disabled="!canAutoIncrement(row)" />
        </template>
      </el-table-column>
      <el-table-column label="默认值" width="110">
        <template #default="{ row }">
          <el-input v-model="row.defaultValue" size="small" placeholder="无" :disabled="row.primaryKey" />
        </template>
      </el-table-column>
      <el-table-column label="操作" width="60" align="center" fixed="right">
        <template #default="{ $index, row }">
          <el-button link type="danger" size="small" :disabled="row.primaryKey" @click="handleRemoveColumn($index)">
            删除
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <template #footer>
      <el-checkbox v-if="formType === 'update'" v-model="formData.riskConfirmed" class="mr-15px">
        我已知晓风险（删除字段等有损操作需勾选）
      </el-checkbox>
      <el-button @click="submitForm" type="primary" :disabled="formLoading">确 定</el-button>
      <el-button @click="dialogVisible = false">取 消</el-button>
    </template>
  </Dialog>

  <!-- DDL 预览 -->
  <Dialog title="待执行的 DDL" v-model="ddlVisible" width="800px">
    <el-alert v-if="ddlList.length === 0" type="success" :closable="false" title="表结构无变化，无需执行 DDL" />
    <template v-else>
      <el-alert type="warning" :closable="false" class="mb-10px">
        <template #title>以下语句将<b>按顺序执行</b>。若中途失败，前面已执行的语句<b>不会回滚</b>。</template>
      </el-alert>
      <div v-for="(sql, index) in ddlList" :key="index" class="mb-10px">
        <div class="mb-5px text-gray-500">第 {{ index + 1 }} 条</div>
        <pre class="ddl-block">{{ sql }}</pre>
      </div>
    </template>
  </Dialog>
</template>

<script lang="ts" setup>
import Sortable from 'sortablejs'
import * as DataModelApi from '@/api/infra/dataModel'

/** 数据模型设计表单 */
defineOptions({ name: 'DataModelForm' })

const { t } = useI18n()
const message = useMessage()

const dialogVisible = ref(false)
const dialogTitle = ref('')
const formLoading = ref(false)
const formType = ref('') // create / update
const formRef = ref()

const formData = ref<DataModelApi.DataModelSaveReqVO>(emptyForm())
const columnTypeList = ref<DataModelApi.DataModelColumnTypeVO[]>([])

const formRules = reactive({
  tableName: [
    { required: true, message: '表名不能为空', trigger: 'blur' },
    {
      pattern: /^[A-Za-z_][A-Za-z0-9_]*$/,
      message: '只允许字母、数字、下划线，且以字母或下划线开头',
      trigger: 'blur'
    }
  ],
  tableComment: [{ required: true, message: '表描述不能为空', trigger: 'blur' }],
  modelName: [{ required: true, message: '模型名称不能为空', trigger: 'blur' }]
})

function emptyForm(): DataModelApi.DataModelSaveReqVO {
  return {
    dataSourceConfigId: 0,
    tableName: '',
    tableComment: '',
    modelName: '',
    remark: '',
    columns: [],
    riskConfirmed: false
  }
}

/** 新建时的默认主键字段，省得每次手工加 */
function defaultIdColumn(): DataModelApi.DataModelColumnVO {
  return {
    columnName: 'id',
    columnComment: '编号',
    columnType: 'LONG',
    nullable: false,
    primaryKey: true,
    autoIncrement: true,
    defaultValue: ''
  }
}

/** 打开弹窗 */
const open = async (type: string, id?: number) => {
  dialogVisible.value = true
  dialogTitle.value = type === 'create' ? '新建模型' : '模型设计'
  formType.value = type
  resetForm()
  // 字段类型选项由后端提供，避免前后端两份枚举不一致
  if (columnTypeList.value.length === 0) {
    columnTypeList.value = await DataModelApi.getColumnTypeList()
  }
  if (type === 'create') {
    formData.value.columns = [defaultIdColumn()]
  } else if (id) {
    formLoading.value = true
    try {
      const model = await DataModelApi.getDataModel(id)
      const columns = await DataModelApi.getDataModelColumns(id)
      formData.value = {
        ...model,
        columns: columns.map((item: DataModelApi.DataModelColumnVO) => ({
          ...item,
          // 记下原字段名，改名时后端据此生成 CHANGE COLUMN 而不是删列重建
          oldColumnName: item.columnName
        })),
        riskConfirmed: false
      }
    } finally {
      formLoading.value = false
    }
  }
  await nextTick()
  initSortable()
}
defineExpose({ open })

const emit = defineEmits(['success'])

const resetForm = () => {
  formData.value = emptyForm()
  formRef.value?.resetFields()
}

// ==================== 字段编辑 ====================

const findType = (type: string) => columnTypeList.value.find((item) => item.type === type)
const needLength = (type: string) => !!findType(type)?.needLength
const needScale = (type: string) => !!findType(type)?.needScale

/** 只有主键且是整数类型才能自增 */
const canAutoIncrement = (row: DataModelApi.DataModelColumnVO) =>
  row.primaryKey && ['INT', 'LONG'].includes(row.columnType)

const handleAddColumn = () => {
  formData.value.columns.push({
    columnName: '',
    columnComment: '',
    columnType: 'STRING',
    length: 255,
    nullable: true,
    primaryKey: false,
    autoIncrement: false,
    defaultValue: ''
  })
}

const handleRemoveColumn = (index: number) => {
  formData.value.columns.splice(index, 1)
}

/** 切类型时清掉不适用的长度与精度，避免残留脏值提交到后端 */
const handleTypeChange = (row: DataModelApi.DataModelColumnVO) => {
  if (!needLength(row.columnType)) {
    row.length = undefined
  } else if (!row.length) {
    row.length = row.columnType === 'DECIMAL' ? 10 : 255
  }
  if (!needScale(row.columnType)) {
    row.scale = undefined
  } else if (row.scale === undefined) {
    row.scale = 2
  }
  if (!canAutoIncrement(row)) {
    row.autoIncrement = false
  }
}

/** 主键单选：选中一个就把其他的取消，同时强制 NOT NULL */
const handlePrimaryKeyChange = (target: DataModelApi.DataModelColumnVO) => {
  formData.value.columns.forEach((row) => {
    row.primaryKey = row === target
    if (row.primaryKey) {
      row.nullable = false
      row.defaultValue = ''
    } else {
      row.autoIncrement = false
    }
  })
}

/** 拖拽排序 */
const initSortable = () => {
  const tbody = document.querySelector('.el-dialog__body .el-table__body tbody')
  if (!tbody) {
    return
  }
  Sortable.create(tbody as HTMLElement, {
    handle: '.drag-handle',
    animation: 150,
    onEnd: ({ oldIndex, newIndex }) => {
      if (oldIndex === undefined || newIndex === undefined || oldIndex === newIndex) {
        return
      }
      const columns = formData.value.columns
      columns.splice(newIndex, 0, columns.splice(oldIndex, 1)[0])
    }
  })
}

// ==================== 预览与提交 ====================

const ddlVisible = ref(false)
const ddlList = ref<string[]>([])

const handlePreviewDdl = async () => {
  if (!(await validateForm())) {
    return
  }
  try {
    ddlList.value = await DataModelApi.previewDdl(formData.value)
    ddlVisible.value = true
  } catch (error: any) {
    message.error(error?.msg || '预览失败')
  }
}

/** 提交前的前端校验：后端会再校验一遍，这里只是让用户少跑一趟 */
const validateForm = async () => {
  try {
    await formRef.value?.validate()
  } catch {
    return false
  }
  const columns = formData.value.columns
  if (columns.length === 0) {
    message.warning('至少需要一个字段')
    return false
  }
  if (columns.some((item) => !item.columnName)) {
    message.warning('存在字段名为空的字段')
    return false
  }
  if (columns.some((item) => !item.columnComment)) {
    message.warning('存在描述为空的字段')
    return false
  }
  // 字段名重复：MySQL 大小写不敏感，统一转小写比较
  const names = columns.map((item) => item.columnName.toLowerCase())
  const duplicate = names.find((name, index) => names.indexOf(name) !== index)
  if (duplicate) {
    message.warning(`字段名重复：${duplicate}`)
    return false
  }
  if (columns.filter((item) => item.primaryKey).length !== 1) {
    message.warning('必须且只能指定一个主键')
    return false
  }
  return true
}

const submitForm = async () => {
  if (!(await validateForm())) {
    return
  }
  formLoading.value = true
  try {
    if (formType.value === 'create') {
      await DataModelApi.createDataModel(formData.value)
      message.success(t('common.createSuccess'))
    } else {
      await DataModelApi.updateDataModel(formData.value)
      message.success(t('common.updateSuccess'))
    }
    dialogVisible.value = false
    emit('success')
  } catch (error: any) {
    // 后端要求确认风险时，提示用户勾选而不是直接报错了事
    const msg = error?.msg || ''
    if (msg.includes('我已知晓风险')) {
      message.warning(msg)
    }
  } finally {
    formLoading.value = false
  }
}
</script>

<style lang="scss" scoped>
.ddl-block {
  padding: 10px;
  margin: 0;
  font-family: Consolas, Monaco, monospace;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
  background-color: #f5f7fa;
  border-radius: 4px;
}
</style>
