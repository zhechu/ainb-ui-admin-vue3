<template>
  <div class="w-full">
    <!-- <el-alert type="info" :closable="false" class="mb-8px">
      <template #title>
        <div class="leading-relaxed">
          <div class="mb-4px">
            <strong>参数引用：</strong>用
            <code>#{参数名}</code> 引用入参，值会以占位符方式绑定（防注入）
          </div>
          <div class="mb-4px">
            <strong>租户隔离：</strong>系统会自动为每张含
            <code>tenant_id</code> 的表注入租户条件，<span class="text-red-500"
              >无需也不要自己写</span
            >
          </div>
          <div class="mb-4px">
            <strong>限制说明：</strong>不支持
            DDL（建表/改表/删表请用数据建模），多条语句用分号分隔且在同一事务内
          </div>
          <div>
            <strong>动作类型：</strong>返回格式由上方选的动作类型决定 ——
            写多条 SQL 时程序判断不准，<span class="text-red-500">请按实际意图自己选</span>
          </div>
        </div>
      </template>
    </el-alert> -->

    <div class="flex gap-8px mb-8px">
      <CodeEditor
        ref="codeEditorRef"
        v-model="sqlText"
        language="sql"
        :placeholder="sqlPlaceholder"
        :minLines="5"
        :maxLines="10"
        :sqlSchema="sqlSchema"
        class="flex-1"
      />
      <el-scrollbar
        v-if="props.dataSourceId !== undefined"
        class="w-200px border rounded p-8px"
        max-height="280px"
      >
        <div class="flex items-center justify-between mb-8px">
          <span class="text-12px font-bold text-gray-700">表结构</span>
          <el-button link type="primary" size="small" @click="loadTables">
            <Icon icon="ep:refresh" />
          </el-button>
        </div>
        <el-tree
          v-loading="tableLoading"
          :data="tableTree"
          :props="{ label: 'label', children: 'children' }"
          node-key="id"
        >
          <template #default="{ data }">
            <span
              class="text-12px cursor-pointer hover:text-primary"
              :class="data.isColumn ? 'text-gray-600' : 'font-bold'"
              @click="insertTableOrColumn(data)"
            >
              {{ data.label }}
            </span>
          </template>
        </el-tree>
      </el-scrollbar>
    </div>

    <div class="mt-8px flex flex-wrap items-center gap-6px">
      <span class="text-12px text-gray-500">点击插入：</span>
      <el-tag
        v-for="p in props.params"
        :key="p.name"
        size="small"
        class="cursor-pointer"
        @click="insert(`#{${p.name}}`)"
      >
        #{{ '{' + p.name + '}' }}
        <span v-if="p.label" class="text-gray-500 ml-4px">{{ p.label }}</span>
      </el-tag>
      <el-tag
        v-for="v in BUILTIN_VARIABLES"
        :key="v.name"
        size="small"
        type="success"
        class="cursor-pointer"
        @click="insert(`#{${v.name}}`)"
      >
        #{{ '{' + v.name + '}' }}
        <span class="text-gray-500 ml-4px">{{ v.remark }}</span>
      </el-tag>
    </div>

    <el-divider content-position="left">分页设置</el-divider>
    <el-row :gutter="16">
      <el-col :span="24">
        <el-form-item label="是否分页">
          <!-- 分页只对查询动作有意义：写操作只返回影响行数，没有「页」的概念 -->
          <el-switch
            v-model="hasPageValue"
            :active-value="1"
            :inactive-value="0"
            :disabled="!isSelectAction"
          />
          <span v-if="isSelectAction" class="ml-8px text-12px text-gray-500">
            开启后返回 <code>{total, list}</code> 格式，自动执行 COUNT SQL
          </span>
          <span v-else class="ml-8px text-12px text-gray-400">
            动作类型为「{{ actionLabel }}」时不支持分页，只返回
            <code>{affectedRows}</code>
          </span>
        </el-form-item>
      </el-col>
    </el-row>

    <!-- 写动作的返回格式说明：多条语句只汇总影响行数，中间的 SELECT 结果不外传 -->
    <el-alert v-if="!isSelectAction" type="warning" :closable="false" class="mb-12px">
      <template #title>
        <div class="text-13px leading-relaxed">
          动作类型为「{{ actionLabel }}」，调用后<b>只返回受影响的行数</b>，不返回结果集：
          <code>{"affectedRows": 3}</code>
          <div class="mt-4px text-gray-600">
            写多条语句时返回各条影响行数之和；若中间夹了 SELECT（如查主键回填），
            该语句照常执行但结果不会返回给调用方。多条语句在同一事务内，失败全部回滚。
          </div>
        </div>
      </template>
    </el-alert>

    <el-alert
      v-if="isSelectAction && hasPageValue === 1"
      type="success"
      :closable="false"
      class="mb-12px"
    >
      <template #title>
        <div class="text-13px leading-relaxed">
          <div class="font-bold mb-6px">📖 分页功能说明</div>

          <div class="mb-4px">
            <strong>1. 分页参数（系统自动注入，无需定义）</strong>
          </div>
          <div class="ml-16px mb-6px text-gray-700 text-12px">
            开启分页后，系统自动提供以下参数：<br />
            • <code>#{pageSize}</code> - 每页条数（用户传入，默认20）<br />
            • <code>#{pageNo}</code> - 当前页码（用户传入，默认1）<br />
            • <code>#{offsetSize}</code> - 偏移量（系统自动计算：(pageNo-1)*pageSize）
          </div>

          <div class="mb-4px">
            <strong>2. 编写分页查询 SQL</strong>
          </div>
          <div class="ml-16px mb-6px text-gray-700 font-mono text-12px">
            SELECT * FROM user WHERE status = #{status}<br />
            ORDER BY create_time DESC<br />
            LIMIT #{pageSize} OFFSET #{offsetSize}
          </div>

          <div class="mb-4px">
            <strong>3. 调用时传参</strong>
          </div>
          <div class="ml-16px mb-6px text-gray-700 text-12px">
            只需传递 pageNo 和 pageSize（可选，有默认值）：<br />
            <code>{"pageNo": 2, "pageSize": 20}</code>
          </div>

          <div class="mb-4px">
            <strong>4. 返回格式</strong>
          </div>
          <div class="ml-16px mb-6px text-gray-700 text-12px">
            系统会自动执行 COUNT SQL 获取总数，返回：<br />
            <code>{"total": 100, "list": [...]}</code>
          </div>
        </div>
      </template>
    </el-alert>

    <el-row v-if="isSelectAction && hasPageValue === 1" :gutter="16">
      <el-col :span="24">
        <el-form-item label="COUNT SQL">
          <CodeEditor
            v-model="countSqlValue"
            language="sql"
            placeholder="留空时自动生成（推荐）"
            :minLines="5"
            :maxLines="10"
            :sqlSchema="sqlSchema"
          />
          <div class="mt-4px text-12px text-gray-500">
            <Icon icon="ep:info-filled" class="mr-4px" />
            留空时自动生成：<code>SELECT COUNT(*) FROM (原SQL去除LIMIT/OFFSET) AS t</code>
          </div>
        </el-form-item>
      </el-col>
    </el-row>
  </div>
</template>

<script lang="ts" setup>
import { ref, watch, computed } from 'vue'
import { useVModel } from '@vueuse/core'
import type { ParamDefinitionVO } from '@/api/infra/dataInterface'
import { getDataSourceTables, type DataSourceTableVO } from '@/api/infra/dataSourceConfig'
import { ElMessage } from 'element-plus'
import CodeEditor from '@/components/CodeEditor'
import Icon from '@/components/Icon/src/Icon.vue'

defineOptions({ name: 'SqlConfig' })

const props = withDefaults(
  defineProps<{
    modelValue: string
    params?: ParamDefinitionVO[]
    hasPage?: number
    countSql?: string
    dataSourceId?: number
    /** 用户选的动作类型：SELECT / INSERT / UPDATE / DELETE */
    statementType?: string
  }>(),
  {
    modelValue: '',
    params: () => [],
    hasPage: 0,
    countSql: '',
    dataSourceId: undefined,
    statementType: 'SELECT'
  }
)
const emit = defineEmits(['update:modelValue', 'update:hasPage', 'update:countSql'])
const sqlText = useVModel(props, 'modelValue', emit)
const hasPageValue = useVModel(props, 'hasPage', emit)
const countSqlValue = useVModel(props, 'countSql', emit)

const ACTION_LABELS: Record<string, string> = {
  SELECT: '查询',
  INSERT: '新增',
  UPDATE: '修改',
  DELETE: '删除'
}
const isSelectAction = computed(() => props.statementType === 'SELECT')
const actionLabel = computed(() => ACTION_LABELS[props.statementType] ?? props.statementType)

/** 按动作类型给不同的 SQL 示例，比一句通用提示更好用 */
const sqlPlaceholder = computed(() => {
  switch (props.statementType) {
    case 'INSERT':
      return 'INSERT INTO biz_order (order_no, amount) VALUES (#{orderNo}, #{amount})'
    case 'UPDATE':
      return 'UPDATE biz_order SET status = #{status} WHERE id = #{id}'
    case 'DELETE':
      return 'DELETE FROM biz_order WHERE id = #{id}'
    default:
      return 'SELECT id, order_no FROM biz_order WHERE status = #{status}'
  }
})

const BUILTIN_VARIABLES = [
  { name: '_userId', remark: '当前登录用户编号' },
  { name: '_tenantId', remark: '当前租户编号' },
  { name: '_deptId', remark: '当前用户部门编号' },
  { name: 'pageSize', remark: '分页大小' },
  { name: 'pageNo', remark: '当前页码' },
  { name: 'offsetSize', remark: '偏移量' }
]

const codeEditorRef = ref()
const tableLoading = ref(false)
const tableTree = ref<any[]>([])
const tablesData = ref<DataSourceTableVO[]>([])

// 转换为 Monaco Editor 的 SQL Schema 格式
const sqlSchema = computed(() => {
  if (!tablesData.value || tablesData.value.length === 0) {
    return undefined
  }
  return {
    tables: tablesData.value.map((table) => ({
      name: table.tableName,
      comment: table.tableComment,
      columns: (table.columns || []).map((col) => ({
        name: col.columnName,
        comment: col.columnComment,
        type: col.dataType
      }))
    }))
  }
})

const loadTables = async () => {
  if (props.dataSourceId === undefined) return
  tableLoading.value = true
  try {
    const res = await getDataSourceTables(props.dataSourceId)
    tablesData.value = res as DataSourceTableVO[]
    tableTree.value = tablesData.value.map((table: DataSourceTableVO) => ({
      id: table.tableName,
      label: table.tableComment ? `${table.tableName} (${table.tableComment})` : table.tableName,
      tableName: table.tableName,
      isColumn: false,
      children:
        table.columns?.map((col) => ({
          id: `${table.tableName}.${col.columnName}`,
          label: col.columnComment
            ? `${col.columnName} (${col.columnComment})`
            : `${col.columnName} (${col.dataType})`,
          tableName: table.tableName,
          columnName: col.columnName,
          isColumn: true
        })) || []
    }))
  } catch (error) {
    ElMessage.error('加载表结构失败')
  } finally {
    tableLoading.value = false
  }
}

watch(
  () => props.dataSourceId,
  (newVal) => {
    if (newVal !== undefined) {
      loadTables()
    } else {
      tableTree.value = []
    }
  },
  { immediate: true }
)

/**
 * 在光标处插入一段文本
 *
 * 模板里「点击插入」的参数标签与内置变量标签都调它。
 * 之前只有 insertTableOrColumn，没有这个函数 —— 模板照样写了 insert(...)，
 * 于是点那些标签会直接抛 "insert is not a function"，整个「点击插入」是坏的。
 * 类型检查早就报了 TS2339，只是被淹在项目里其它既有报错里。
 */
const insert = (text: string) => {
  // 走 Monaco Editor 的 insertText 在光标位置插入
  if (codeEditorRef.value?.insertText) {
    codeEditorRef.value.insertText(text)
  } else {
    // 降级：直接拼接到末尾
    sqlText.value = `${sqlText.value ?? ''}${text}`
  }
}

const insertTableOrColumn = (data: any) => {
  const text = data.isColumn ? data.columnName : data.tableName
  insert(text)
}
</script>

<style lang="scss" scoped>
.sql-input :deep(.el-textarea__inner) {
  font-family: Consolas, Monaco, 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.6;
}
</style>
