<!-- 字典分类管理：右滑抽屉，把整棵分类树摊成一张表，集中做增删改与迁移包收发 -->
<template>
  <el-drawer v-model="drawerVisible" size="900px" title="字典分类管理" @closed="handleClosed">
    <!-- 工具栏 -->
    <div class="mb-12px flex flex-wrap items-center gap-8px">
      <el-input
        v-model="keyword"
        class="!w-260px"
        clearable
        placeholder="搜索分类名称/编码"
        @clear="loadList"
        @keyup.enter="loadList"
      >
        <template #prefix>
          <Icon icon="ep:search" />
        </template>
      </el-input>
      <el-button @click="loadList">
        <Icon class="mr-5px" icon="ep:refresh" />
        刷新
      </el-button>
      <el-button @click="toggleExpandAll">
        <Icon class="mr-5px" :icon="expandAll ? 'ep:fold' : 'ep:expand'" />
        {{ expandAll ? '收起全部' : '展开全部' }}
      </el-button>
      <div class="flex-1"></div>
      <el-dropdown v-hasPermi="['system:dict:create']" @command="handleCreateRoot">
        <el-button plain type="primary">
          <Icon class="mr-5px" icon="ep:plus" />
          新增
          <Icon class="ml-2px" icon="ep:arrow-down" />
        </el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item :command="DictTypeNodeEnum.GROUP">新增分组</el-dropdown-item>
            <el-dropdown-item :command="DictTypeNodeEnum.DICT">新增字典</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
      <el-button v-hasPermi="['system:dict:import']" plain type="warning" @click="emit('import')">
        <Icon class="mr-5px" icon="ep:upload" />
        导入分类
      </el-button>
    </div>

    <!-- 树表。key 参与重建：el-table 的 default-expand-all 不是响应式的，
         切换展开态只能整表重建，否则点了没反应 -->
    <div class="min-h-0 flex-1">
      <el-table
        :key="tableKey"
        v-loading="loading"
        :data="treeData"
        :default-expand-all="expandAll"
        :tree-props="{ children: 'children' }"
        height="100%"
        row-key="id"
        class="xpy-list-table"
      >
        <el-table-column label="分类名称" min-width="210" prop="name" show-overflow-tooltip>
          <template #default="{ row }">
            <Icon class="mr-4px align-middle" :icon="nodeIcon(row)" :size="14" />
            <!-- 文字不能带 align-middle：vertical-align:middle 会把 19px 的字体盒压到基线以下，
                 行盒从 23px 涨到 25px（实测行高 42 而不是 41）。图标带 align-middle 不会，它只有 14px -->
            <span>{{ row.name }}</span>
          </template>
        </el-table-column>
        <el-table-column label="编码" min-width="180" prop="type" show-overflow-tooltip />
        <el-table-column label="类型" width="110">
          <template #default="{ row }">
            <el-tag size="small" :type="isGroup(row) ? 'info' : 'primary'">
              {{ isGroup(row) ? '分组' : '字典' }}
            </el-tag>
            <el-tag v-if="row.treeEnable" class="ml-4px" size="small" type="success">树形</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <StatusSwitch
              :model-value="row.status === CommonStatusEnum.ENABLE"
              :loading="statusLoadingId === row.id"
              :permission="['system:dict:update']"
              @change="(next) => handleUpdateStatus(row, next)"
            />
          </template>
        </el-table-column>
        <el-table-column fixed="right" label="操作" width="235">
          <template #default="{ row }">
            <el-button
              v-if="isGroup(row)"
              v-hasPermi="['system:dict:create']"
              link
              size="small"
              type="primary"
              @click="handleCreateChild(row)"
            >
              新增下级
            </el-button>
            <el-button
              v-hasPermi="['system:dict:update']"
              link
              size="small"
              type="primary"
              @click="emit('edit', row)"
            >
              修改
            </el-button>
            <el-button
              v-hasPermi="['system:dict:export']"
              :loading="exportingId === row.id"
              link
              size="small"
              type="success"
              @click="handleExport(row)"
            >
              导出
            </el-button>
            <el-button
              v-hasPermi="['system:dict:delete']"
              link
              size="small"
              type="danger"
              @click="handleDelete(row)"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty :description="keyword ? '没有匹配的分类' : '还没有任何分类'" />
        </template>
      </el-table>
    </div>

    <template #footer>
      <div class="flex items-center justify-between">
        <span class="text-12px text-[var(--el-text-color-secondary)]">
          导出会把该分类及其全部子分类、连同这些字典下的数据打成一个 JSON 迁移包
        </span>
        <el-button @click="drawerVisible = false">关 闭</el-button>
      </div>
    </template>
  </el-drawer>
</template>

<script lang="ts" setup>
import { handleTree } from '@/utils/tree'
import download from '@/utils/download'
import * as DictTypeApi from '@/api/system/dict/dict.type'
import { CommonStatusEnum } from '@/utils/constants'
import { DictTypeNodeEnum } from '@/api/system/dict/dict.type'

defineOptions({ name: 'DictTypeManageDrawer' })

const message = useMessage()
const { t } = useI18n()

const emit = defineEmits<{
  (e: 'create', nodeType: number, parentId: number): void
  (e: 'edit', row: DictTypeApi.DictTypeVO): void
  (e: 'import', parentId?: number): void
  /** 抽屉关掉时通知外面刷新左树：里面的增删改都会改变它 */
  (e: 'closed'): void
}>()

const drawerVisible = ref(false)
const loading = ref(false)
const keyword = ref('')
const list = ref<DictTypeApi.DictTypeVO[]>([])
const exportingId = ref<number>()
const expandAll = ref(true)
const tableKey = ref(0)

const treeData = computed(() => handleTree(list.value.map((item) => ({ ...item }))))

const isGroup = (row: DictTypeApi.DictTypeVO) => row.nodeType === DictTypeNodeEnum.GROUP

const nodeIcon = (row: DictTypeApi.DictTypeVO) => {
  if (isGroup(row)) {
    return 'ep:folder'
  }
  // 树形字典单独给个图标，和左树保持一致的视觉语言
  return row.treeEnable ? 'ep:share' : 'ep:document'
}

/** 加载分类列表 */
const loadList = async () => {
  // 抽屉是常驻挂载、靠 v-model 控制显隐的。外面每次保存成功都会来喊一嗓子，
  // 关着的时候不必真去请求，等下次打开自然会拉
  if (!drawerVisible.value) {
    return
  }
  loading.value = true
  try {
    list.value = await DictTypeApi.getDictTypeList(keyword.value || undefined)
    // 搜索时把结果全展开，否则命中项藏在折叠的分组里根本看不见
    if (keyword.value) {
      expandAll.value = true
    }
    tableKey.value++
  } finally {
    loading.value = false
  }
}

const toggleExpandAll = () => {
  expandAll.value = !expandAll.value
  tableKey.value++
}

/** 打开抽屉 */
const open = async () => {
  drawerVisible.value = true
  keyword.value = ''
  expandAll.value = true
  await loadList()
}
defineExpose({ open, loadList })

const handleCreateRoot = (nodeType: number) => {
  emit('create', nodeType, 0)
}

const handleCreateChild = (row: DictTypeApi.DictTypeVO) => {
  emit('create', DictTypeNodeEnum.DICT, row.id!)
}

/** 导出一棵分类子树 */
const handleExport = async (row: DictTypeApi.DictTypeVO) => {
  exportingId.value = row.id
  try {
    const res = await DictTypeApi.exportDictTypeJson(row.id!)
    download.json(res, `${row.name}.json`)
  } finally {
    exportingId.value = undefined
  }
}

/** 状态列快捷开关：走整行更新接口，与编辑表单保存同一条后端路径 */
const statusLoadingId = ref<number | null>(null)
const handleUpdateStatus = async (row: any, next: boolean) => {
  statusLoadingId.value = row.id
  try {
    await DictTypeApi.updateDictType({
      ...row,
      status: next ? CommonStatusEnum.ENABLE : CommonStatusEnum.DISABLE
    })
    message.success(next ? '已开启' : '已关闭')
    await loadList()
  } finally {
    statusLoadingId.value = null
  }
}

const handleDelete = async (row: DictTypeApi.DictTypeVO) => {
  try {
    await message.delConfirm(`是否确认删除「${row.name}」？`)
    await DictTypeApi.deleteDictType(row.id!)
    message.success(t('common.delSuccess'))
    await loadList()
  } catch {}
}

const handleClosed = () => emit('closed')
</script>

<style lang="scss" scoped>
// 抽屉正文默认是普通块级容器，表格的 height="100%" 无从算起。
// 改成纵向 flex 之后：工具栏占自然高度，表格吃掉剩下的，滚动发生在表格内部
:deep(.el-drawer__body) {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
</style>
