<template>
  <Dialog :title="dialogTitle" v-model="dialogVisible" width="680px">
    <el-form
      ref="formRef"
      v-loading="formLoading"
      :model="formData"
      :rules="formRules"
      label-width="120px"
    >
      <el-form-item
        v-for="column in editColumns"
        :key="column.columnName"
        :label="column.columnComment || column.columnName"
        :prop="column.columnName"
      >
        <!-- 控件类型由字段类型推导，见 columnMeta.resolveFormWidget -->
        <el-input
          v-if="widgetOf(column) === 'input'"
          v-model="formData[column.columnName]"
          :placeholder="`请输入${column.columnComment}`"
          :maxlength="column.length || undefined"
          show-word-limit
          clearable
        />
        <el-input
          v-else-if="widgetOf(column) === 'textarea'"
          v-model="formData[column.columnName]"
          type="textarea"
          :rows="3"
          :placeholder="`请输入${column.columnComment}`"
        />
        <el-input-number
          v-else-if="widgetOf(column) === 'number'"
          v-model="formData[column.columnName]"
          :precision="column.columnType === 'DECIMAL' ? column.scale ?? 2 : 0"
          controls-position="right"
          class="!w-240px"
        />
        <el-switch
          v-else-if="widgetOf(column) === 'switch'"
          v-model="formData[column.columnName]"
        />
        <el-date-picker
          v-else
          v-model="formData[column.columnName]"
          :type="column.columnType === 'DATE' ? 'date' : 'datetime'"
          :value-format="column.columnType === 'DATE' ? 'YYYY-MM-DD' : 'YYYY-MM-DD HH:mm:ss'"
          placeholder="请选择"
          class="!w-240px"
        />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="submitForm" type="primary" :disabled="formLoading">确 定</el-button>
      <el-button @click="dialogVisible = false">取 消</el-button>
    </template>
  </Dialog>
</template>

<script lang="ts" setup>
import type { DataModelColumnVO } from '@/api/infra/dataModel'
import * as DataApi from '@/api/infra/dataModel/data'
import { isEditable, resolveFormWidget } from './columnMeta'

/** 动态业务数据表单 */
defineOptions({ name: 'DataModelDataForm' })

const message = useMessage()
const { t } = useI18n()

const dialogVisible = ref(false)
const dialogTitle = ref('')
const formLoading = ref(false)
const formType = ref('')
const formRef = ref()
const formData = ref<Record<string, any>>({})
const modelId = ref<number>()
const rowId = ref<string | number>()
const columns = ref<DataModelColumnVO[]>([])

/** 需要用户填写的字段：系统字段（含自增主键、审计字段）全部排除 */
const editColumns = computed(() => columns.value.filter(isEditable))

const widgetOf = (column: DataModelColumnVO) => resolveFormWidget(column)

/**
 * 校验规则由字段定义推导
 *
 * 后端会再校验一遍（NOT NULL 由数据库保证），这里只是让用户少跑一趟。
 */
const formRules = computed(() => {
  const rules: Record<string, any[]> = {}
  editColumns.value.forEach((column) => {
    const items: any[] = []
    if (column.nullable === false) {
      items.push({
        required: true,
        message: `${column.columnComment || column.columnName}不能为空`,
        trigger: widgetOf(column) === 'date' || widgetOf(column) === 'datetime' ? 'change' : 'blur'
      })
    }
    if (items.length > 0) {
      rules[column.columnName] = items
    }
  })
  return rules
})

/** 打开弹窗
 * @param type create / update
 * @param id 更新时传入
 */
const open = async (
  type: string,
  currentModelId: number,
  currentColumns: DataModelColumnVO[],
  id?: string | number
) => {
  dialogVisible.value = true
  dialogTitle.value = type === 'create' ? '新增数据' : '编辑数据'
  formType.value = type
  modelId.value = currentModelId
  columns.value = currentColumns
  rowId.value = id
  resetForm()

  if (type === 'update' && id !== undefined) {
    formLoading.value = true
    try {
      const data = await DataApi.getData(currentModelId, id)
      formData.value = normalizeForEdit(data)
    } finally {
      formLoading.value = false
    }
  }
}
defineExpose({ open })

const emit = defineEmits(['success'])

/** 表单初值：布尔给 false，其余留空，避免 undefined 导致控件告警 */
const resetForm = () => {
  const initial: Record<string, any> = {}
  editColumns.value.forEach((column) => {
    initial[column.columnName] = column.columnType === 'BOOLEAN' ? false : undefined
  })
  formData.value = initial
  formRef.value?.resetFields()
}

/**
 * 后端返回的值转成控件能用的形式
 *
 * 时间是毫秒时间戳，日期控件需要字符串；布尔可能是 0/1
 */
const normalizeForEdit = (data: Record<string, any>) => {
  const result: Record<string, any> = {}
  columns.value.forEach((column) => {
    const value = data[column.columnName]
    if (value === null || value === undefined) {
      result[column.columnName] = undefined
      return
    }
    if (column.columnType === 'BOOLEAN') {
      result[column.columnName] = value === true || value === 1 || value === '1'
    } else if (['DATE', 'DATETIME'].includes(column.columnType) && typeof value === 'number') {
      const d = new Date(value)
      const pad = (n: number) => String(n).padStart(2, '0')
      const ymd = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      result[column.columnName] =
        column.columnType === 'DATE'
          ? ymd
          : `${ymd} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    } else {
      result[column.columnName] = value
    }
  })
  return result
}

const submitForm = async () => {
  try {
    await formRef.value?.validate()
  } catch {
    return
  }
  formLoading.value = true
  try {
    // 只提交需要用户填写的字段，系统字段交给后端处理
    const payload: Record<string, any> = {}
    editColumns.value.forEach((column) => {
      payload[column.columnName] = formData.value[column.columnName] ?? null
    })
    if (formType.value === 'create') {
      await DataApi.createData(modelId.value!, payload)
      message.success(t('common.createSuccess'))
    } else {
      await DataApi.updateData(modelId.value!, rowId.value!, payload)
      message.success(t('common.updateSuccess'))
    }
    dialogVisible.value = false
    emit('success')
  } finally {
    formLoading.value = false
  }
}
</script>
