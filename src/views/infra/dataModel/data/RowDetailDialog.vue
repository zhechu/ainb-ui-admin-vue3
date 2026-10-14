<template>
  <el-dialog v-model="dialogVisible" title="数据详情" width="700px" append-to-body>
    <el-descriptions :column="1" border>
      <el-descriptions-item
        v-for="column in columns"
        :key="column.columnName"
        :label="columnLabel(column)"
      >
        <span class="break-all">{{ displayValue(row[column.columnName]) }}</span>
      </el-descriptions-item>
    </el-descriptions>
    <template #footer>
      <el-button @click="dialogVisible = false">关 闭</el-button>
    </template>
  </el-dialog>
</template>

<script lang="ts" setup>
import type { DataModelColumnVO } from '@/api/infra/dataModel'
import type { DataRowVO } from '@/api/infra/dataModel/data'

/**
 * 数据查看页的行详情弹窗
 *
 * 直接展示点击行的内存数据（原始值，不格式化），不发请求；
 * 全量列（含系统列）逐行罗列，方便核对数据库里的真实内容。
 */
defineOptions({ name: 'RowDetailDialog' })

const dialogVisible = ref(false)
const row = ref<DataRowVO>({})
const columns = ref<DataModelColumnVO[]>([])

const columnLabel = (column: DataModelColumnVO) =>
  column.columnComment ? `${column.columnName}（${column.columnComment}）` : column.columnName

/** 原样展示：空值给个占位符，其余转字符串（对象转 JSON，避免显示 [object Object]） */
const displayValue = (value: any): string => {
  if (value === null || value === undefined) {
    return '-'
  }
  if (typeof value === 'object') {
    return JSON.stringify(value)
  }
  return String(value)
}

const open = (rowdata: DataRowVO, cols: DataModelColumnVO[]) => {
  row.value = rowdata
  columns.value = cols
  dialogVisible.value = true
}
defineExpose({ open })
</script>
