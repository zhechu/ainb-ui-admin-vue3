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
            DDL（建表/改表/删表请用数据模型），多条语句用分号分隔且在同一事务内
          </div>
          <div>
            <strong>动作类型：</strong>返回格式由上方选的动作类型决定 ——
            写多条 SQL 时程序判断不准，<span class="text-red-500">请按实际意图自己选</span>
          </div>
        </div>
      </template>
    </el-alert> -->

    <!-- 编辑器与表结构等高成一行：两侧严丝合缝，不再一高一矮 -->
    <div class="flex items-stretch gap-8px mb-8px h-[320px]">
      <CodeEditor
        ref="codeEditorRef"
        v-model="sqlText"
        language="sql"
        :placeholder="sqlPlaceholder"
        :readonly="readonly"
        height="100%"
        :sqlSchema="sqlSchema"
        class="flex-1"
      />
      <!-- 表结构：纵向 flex，搜索行固定在顶部，仅下方的树滚动 -->
      <div
        v-if="props.dataSourceId !== undefined"
        class="w-280px h-full flex flex-col border border-[var(--el-border-color)] rounded"
      >
        <div class="shrink-0 px-8px py-6px flex items-center gap-4px">
          <el-input
            v-model="tableFilterText"
            placeholder="搜索表名 / 字段 / 说明"
            clearable
            size="small"
            class="flex-1"
            @keyup.enter="applySearch"
            @clear="applySearch"
          >
            <template #prefix><Icon icon="ep:search" /></template>
          </el-input>
          <el-button size="small" title="搜索" @click="applySearch">
            <Icon icon="ep:search" />
          </el-button>
          <el-button size="small" title="刷新表结构" @click="loadTables">
            <Icon icon="ep:refresh" />
          </el-button>
        </div>
        <div class="shrink-0 px-8px pb-6px text-12px text-[var(--el-text-color-secondary)]">
          <template v-if="activeKeyword">命中 {{ hitTables }} 表 / {{ hitColumns }} 字段</template>
          <template v-else>共 {{ tableTree.length }} 张表</template>
        </div>
        <el-scrollbar class="flex-1 min-h-0 px-4px">
          <el-tree
            ref="tableTreeRef"
            v-loading="tableLoading"
            :data="tableTree"
            :props="{ label: 'label', children: 'children' }"
            node-key="id"
            :filter-node-method="filterTableNode"
            :default-expanded-keys="expandedKeys"
          >
            <template #default="{ data }">
              <span
                class="text-12px cursor-pointer hover:text-primary"
                :class="data.isColumn ? 'text-[var(--el-text-color-regular)]' : 'font-bold'"
                @click="insertTableOrColumn(data)"
              >
                <!-- 命中片段高亮：用模板插值切片渲染，不用 v-html，天然免 XSS -->
                <template v-for="(seg, i) in highlightSegments(data.label)" :key="i">
                  <span
                    v-if="seg.hit"
                    class="bg-[var(--el-color-warning-light-5)] text-[var(--el-color-primary)] rounded px-1px"
                    >{{ seg.text }}</span
                  >
                  <template v-else>{{ seg.text }}</template>
                </template>
              </span>
            </template>
          </el-tree>
          <!-- 空态：搜索无命中时给出明确反馈与一键清空 -->
          <div
            v-if="activeKeyword && !tableLoading && hitTables === 0 && hitColumns === 0"
            class="px-8px py-20px text-center"
          >
            <div class="text-12px text-[var(--el-text-color-secondary)] mb-8px">无匹配的表或字段</div>
            <el-button link type="primary" size="small" @click="clearSearch">
              清空搜索
            </el-button>
          </div>
        </el-scrollbar>
      </div>
    </div>

    <div v-if="!readonly" class="mt-8px flex flex-wrap items-center gap-6px">
      <span class="text-12px text-[var(--el-text-color-secondary)]">点击插入：</span>
      <el-tag
        v-for="p in props.params"
        :key="p.name"
        size="small"
        class="cursor-pointer"
        @click="insert(`#{${p.name}}`)"
      >
        #{{ '{' + p.name + '}' }}
        <span v-if="p.label" class="text-[var(--el-text-color-secondary)] ml-4px">{{ p.label }}</span>
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
        <span class="text-[var(--el-text-color-secondary)] ml-4px">{{ v.remark }}</span>
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
          <span v-if="isSelectAction" class="ml-8px text-12px text-[var(--el-text-color-secondary)]">
            开启后返回 <code>{total, list}</code> 格式，自动执行 COUNT SQL
          </span>
          <span v-else class="ml-8px text-12px text-[var(--el-text-color-secondary)]">
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
          <div class="mt-4px text-[var(--el-text-color-regular)]">
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
          <div class="ml-16px mb-6px text-[var(--el-text-color-regular)] text-12px">
            开启分页后，系统自动提供以下参数：<br />
            • <code>#{pageSize}</code> - 每页条数（用户传入，默认20）<br />
            • <code>#{pageNo}</code> - 当前页码（用户传入，默认1）<br />
            • <code>#{offsetSize}</code> - 偏移量（系统自动计算：(pageNo-1)*pageSize）
          </div>

          <div class="mb-4px">
            <strong>2. 编写分页查询 SQL</strong>
          </div>
          <div class="ml-16px mb-6px text-[var(--el-text-color-regular)] font-mono text-12px">
            SELECT * FROM user WHERE status = #{status}<br />
            ORDER BY create_time DESC<br />
            LIMIT #{pageSize} OFFSET #{offsetSize}
          </div>

          <div class="mb-4px">
            <strong>3. 调用时传参</strong>
          </div>
          <div class="ml-16px mb-6px text-[var(--el-text-color-regular)] text-12px">
            只需传递 pageNo 和 pageSize（可选，有默认值）：<br />
            <code>{"pageNo": 2, "pageSize": 20}</code>
          </div>

          <div class="mb-4px">
            <strong>4. 返回格式</strong>
          </div>
          <div class="ml-16px mb-6px text-[var(--el-text-color-regular)] text-12px">
            系统会自动执行 COUNT SQL 获取总数，返回：<br />
            <code>{"total": 100, "list": [...]}</code>
          </div>
        </div>
      </template>
    </el-alert>

    <el-row v-if="isSelectAction && hasPageValue === 1" :gutter="16">
      <el-col :span="24">
        <el-form-item label="COUNT SQL">
          <!-- w-full 必须有：el-form-item 内容是 flex，编辑器不声明宽度会被压成几像素宽 -->
          <CodeEditor
            v-model="countSqlValue"
            language="sql"
            placeholder="留空时自动生成（推荐）"
            :readonly="readonly"
            :minLines="5"
            :maxLines="10"
            :sqlSchema="sqlSchema"
            class="w-full"
          />
          <div class="mt-4px text-12px text-[var(--el-text-color-secondary)]">
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
    /** 只读态：版本预览用，编辑器只读、隐藏「点击插入」 */
    readonly?: boolean
  }>(),
  {
    modelValue: '',
    params: () => [],
    hasPage: 0,
    countSql: '',
    dataSourceId: undefined,
    statementType: 'SELECT',
    readonly: false
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
const tableTreeRef = ref()
const tableFilterText = ref('')

/**
 * 表结构树的搜索过滤
 *
 * 节点 label 已包含「名称（说明）」，所以匹配 label 即可同时命中表名/表注释
 * 与字段名/字段注释；表名命中时保留其下全部字段，便于直接查看与点插。
 */
const filterTableNode = (value: string, data: any, node: any) => {
  if (!value) {
    return true
  }
  const kw = value.toLowerCase()
  if ((data.label || '').toLowerCase().includes(kw)) {
    return true
  }
  const parentLabel = node?.parent?.data?.label
  return !!parentLabel && parentLabel.toLowerCase().includes(kw)
}

/** 已生效的搜索词：只在回车 / 点查询按钮时更新，避免逐字过滤大表树的卡顿 */
const activeKeyword = ref('')

/** label 是否命中已生效的搜索词（大小写不敏感） */
const isMatch = (label: string) => {
  const kw = activeKeyword.value.trim().toLowerCase()
  return !!kw && (label || '').toLowerCase().includes(kw)
}

/** 命中的表数（按表名/表注释匹配） */
const hitTables = computed(() => tableTree.value.filter((t) => isMatch(t.label)).length)

/** 命中的字段数（跨所有表累加） */
const hitColumns = computed(() =>
  tableTree.value.reduce(
    (sum, t) => sum + (t.children || []).filter((c: any) => isMatch(c.label)).length,
    0
  )
)

/**
 * 把 label 按搜索词切成「命中/未命中」片段，供模板高亮渲染
 *
 * 返回纯文本片段、由模板用插值渲染，绝不拼 HTML，避免表名/注释里的特殊字符注入。
 */
const highlightSegments = (label: string): { text: string; hit: boolean }[] => {
  const text = label || ''
  const kw = activeKeyword.value.trim()
  if (!kw) {
    return [{ text, hit: false }]
  }
  const lowerText = text.toLowerCase()
  const lowerKw = kw.toLowerCase()
  const segs: { text: string; hit: boolean }[] = []
  let start = 0
  let idx = lowerText.indexOf(lowerKw)
  while (idx !== -1) {
    if (idx > start) {
      segs.push({ text: text.slice(start, idx), hit: false })
    }
    segs.push({ text: text.slice(idx, idx + kw.length), hit: true })
    start = idx + kw.length
    idx = lowerText.indexOf(lowerKw, start)
  }
  if (start < text.length) {
    segs.push({ text: text.slice(start), hit: false })
  }
  return segs
}

/** 搜索时自动展开命中项所在的表，省去逐层点开 */
const expandedKeys = ref<string[]>([])

/** 回车 / 点查询按钮才真正发起搜索：215 张表逐字过滤既卡又没必要 */
const applySearch = () => {
  const kw = tableFilterText.value.trim()
  activeKeyword.value = kw
  tableTreeRef.value?.filter(kw)
  if (!kw) {
    expandedKeys.value = []
    return
  }
  expandedKeys.value = tableTree.value
    .filter((t) => isMatch(t.label) || (t.children || []).some((c: any) => isMatch(c.label)))
    .map((t) => t.id)
}

const clearSearch = () => {
  tableFilterText.value = ''
  applySearch()
}

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
