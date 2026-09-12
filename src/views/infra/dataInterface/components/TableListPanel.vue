<template>
  <div class="table-list-panel">
    <div class="search-box mb-8px">
      <el-input
        v-model="keyword"
        placeholder="搜索表名"
        clearable
        @input="handleSearch"
      >
        <template #prefix>
          <Icon icon="ep:search" />
        </template>
      </el-input>
    </div>

    <div v-loading="loading" class="tree-box">
      <el-tree
        ref="treeRef"
        :data="filteredTreeData"
        :props="{ label: 'label', children: 'children' }"
        node-key="id"
        :expand-on-click-node="false"
        @node-click="handleNodeClick"
      >
        <template #default="{ node, data }">
          <span class="tree-node">
            <Icon v-if="data.type === 'table'" icon="ep:document" class="mr-4px text-blue-500" />
            <Icon v-else icon="ep:tickets" class="mr-4px text-gray-400" />
            <span class="node-label">{{ node.label }}</span>
            <span v-if="data.comment" class="node-comment">{{ data.comment }}</span>
          </span>
        </template>
      </el-tree>

      <el-empty v-if="!loading && filteredTreeData.length === 0" description="暂无表数据" />
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, watch } from 'vue'
import { getDataSourceTables, type DataSourceTableVO } from '@/api/infra/dataSourceConfig'
import Icon from '@/components/Icon/src/Icon.vue'

defineOptions({ name: 'TableListPanel' })

const props = defineProps<{
  dataSourceId?: number
}>()

const emit = defineEmits<{
  nodeClick: [text: string, type: 'table' | 'column']
}>()

const loading = ref(false)
const keyword = ref('')
const tableList = ref<DataSourceTableVO[]>([])
const treeRef = ref()

interface TreeNode {
  id: string
  label: string
  comment?: string
  type: 'table' | 'column'
  tableName?: string
  columnName?: string
  children?: TreeNode[]
}

// 转换为树形结构
const treeData = computed<TreeNode[]>(() => {
  return tableList.value.map(table => ({
    id: table.tableName,
    label: table.tableName,
    comment: table.tableComment || '',
    type: 'table' as const,
    tableName: table.tableName,
    children: (table.columns || []).map(column => ({
      id: `${table.tableName}.${column.columnName}`,
      label: column.columnName,
      comment: column.columnComment || column.dataType,
      type: 'column' as const,
      tableName: table.tableName,
      columnName: column.columnName
    }))
  }))
})

// 过滤后的树数据
const filteredTreeData = computed(() => {
  if (!keyword.value) {
    return treeData.value
  }
  const kw = keyword.value.toLowerCase()
  return treeData.value.filter(table => {
    return table.label.toLowerCase().includes(kw) ||
           (table.comment && table.comment.toLowerCase().includes(kw))
  })
})

// 加载表列表
const loadTables = async () => {
  if (!props.dataSourceId) {
    tableList.value = []
    return
  }

  loading.value = true
  try {
    const data = await getDataSourceTables(props.dataSourceId)
    tableList.value = data || []
  } catch (error) {
    console.error('加载表列表失败', error)
    tableList.value = []
  } finally {
    loading.value = false
  }
}

// 监听数据源变化
watch(() => props.dataSourceId, loadTables, { immediate: true })

// 搜索防抖
let searchTimer: ReturnType<typeof setTimeout>
const handleSearch = () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    // 搜索后自动展开第一个匹配的表
    if (keyword.value && filteredTreeData.value.length > 0) {
      treeRef.value?.setCurrentKey(filteredTreeData.value[0].id)
    }
  }, 300)
}

// 点击节点：插入表名或字段名到编辑器
const handleNodeClick = (data: TreeNode) => {
  if (data.type === 'table') {
    emit('nodeClick', data.tableName!, 'table')
  } else if (data.type === 'column') {
    emit('nodeClick', data.columnName!, 'column')
  }
}
</script>

<style scoped>
.table-list-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 12px;
  border-left: 1px solid var(--el-border-color);
  background: var(--el-bg-color-page);
}

.tree-box {
  flex: 1;
  overflow-y: auto;
}

.tree-node {
  display: flex;
  align-items: center;
  width: 100%;
  font-size: 13px;
}

.node-label {
  font-weight: 500;
  margin-right: 6px;
}

.node-comment {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  margin-left: auto;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

:deep(.el-tree-node__content) {
  height: 32px;
}

:deep(.el-tree-node__content:hover) {
  background-color: var(--el-fill-color-light);
}
</style>
