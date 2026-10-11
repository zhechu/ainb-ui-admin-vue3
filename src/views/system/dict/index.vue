<template>
  <div
    ref="pageRef"
    :style="{ height: pageHeight ? pageHeight + 'px' : undefined }"
    class="flex gap-[var(--app-content-padding)]"
  >
    <!-- 左：字典分类树 -->
    <ContentWrap :body-style="panelBodyStyle" class="w-280px flex-none h-full !mb-0">
      <DictTypeTree
        ref="treeRef"
        :default-type="defaultType"
        @create="handleCreateType"
        @manage="handleManageType"
        @select="handleSelectType"
      />
    </ContentWrap>

    <!-- 右：查询区与列表区两张卡片，与用户管理页保持一致 -->
    <div class="min-w-0 h-full flex flex-1 flex-col">
      <ContentWrap v-if="!currentType" class="flex-1 !mb-0">
        <el-empty description="请从左侧选择一个字典" />
      </ContentWrap>
      <DictDataTable
        v-else
        ref="tableRef"
        :dict="currentType"
        @create="handleCreateData"
        @edit="handleEditData"
        @import="handleImportData"
      />
    </div>

    <DictTypeManageDrawer
      ref="manageDrawerRef"
      @create="handleCreateType"
      @edit="handleEditType"
      @import="handleImportType"
      @closed="handleManageClosed"
    />
    <DictTypeForm ref="typeFormRef" @success="handleTypeSuccess" />
    <DictTypeImportForm ref="typeImportFormRef" @success="handleTypeSuccess" />
    <DictDataForm ref="dataFormRef" @success="handleDataSuccess" />
    <DictDataImportForm ref="importFormRef" @success="handleDataSuccess" />
  </div>
</template>

<script lang="ts" setup>
import * as DictTypeApi from '@/api/system/dict/dict.type'
import { useDictStoreWithOut } from '@/store/modules/dict'
import DictTypeTree from './components/DictTypeTree.vue'
import DictDataTable from './components/DictDataTable.vue'
import DictTypeForm from './DictTypeForm.vue'
import DictTypeImportForm from './components/DictTypeImportForm.vue'
import DictTypeManageDrawer from './components/DictTypeManageDrawer.vue'
import DictDataForm from './data/DictDataForm.vue'
import DictDataImportForm from './components/DictDataImportForm.vue'

defineOptions({ name: 'SystemDictType' })

const dictStore = useDictStoreWithOut()
const route = useRoute()

// 从旧的 /dict/type/data/:dictType 路由重定向过来时，直接定位到对应字典
const defaultType = route.query.dictType as string | undefined

/**
 * 让整页贴合浏览器可视区
 *
 * 左树有 270+ 个节点，若不给页面一个确定高度，它会把整页撑得很高：
 * 页面出一根滚动条，右侧表格卡片又按视口算自己的高度、再出一根，
 * 于是同屏两根滚动条，左树还得滚很久才到底。
 * 给外层定高之后，左右两栏各自在内部滚动，行为才符合预期。
 */
const pageRef = ref<HTMLElement>()
const pageHeight = ref(0)
// 卡片内容区撑满卡片，内部才能做 flex 布局与独立滚动
const panelBodyStyle = { padding: '10px', overflow: 'hidden', height: '100%' }

const updatePageHeight = () => {
  const el = pageRef.value
  if (!el) return
  const top = el.getBoundingClientRect().top
  const footerTop = document.querySelector('.v-footer')?.getBoundingClientRect().top
  const bottom = Math.min(window.innerHeight, footerTop ?? Number.POSITIVE_INFINITY)
  // 留一点下边距；给个下限，避免窄屏下被压成几像素
  pageHeight.value = Math.max(360, Math.floor(bottom - top - 16))
}

onMounted(() => {
  nextTick(updatePageHeight)
  window.addEventListener('resize', updatePageHeight)
})
onBeforeUnmount(() => window.removeEventListener('resize', updatePageHeight))

const treeRef = ref()
const tableRef = ref()
const typeFormRef = ref()
const typeImportFormRef = ref()
const manageDrawerRef = ref()
const dataFormRef = ref()
const importFormRef = ref()
const currentType = ref<DictTypeApi.DictTypeVO>()

const handleSelectType = (row?: DictTypeApi.DictTypeVO) => {
  currentType.value = row
}

// ========== 分类 ==========

const handleCreateType = (nodeType: number, parentId: number) => {
  typeFormRef.value.open('create', undefined, { nodeType, parentId })
}

const handleEditType = (row: DictTypeApi.DictTypeVO) => {
  typeFormRef.value.open('update', row.id)
}

const handleImportType = (parentId?: number) => {
  typeImportFormRef.value.open(parentId)
}

const handleManageType = () => {
  manageDrawerRef.value.open()
}

/** 抽屉里的增删改都会改到左树，关掉时统一刷一次 */
const handleManageClosed = async () => {
  await treeRef.value?.loadList()
  await refreshDictCache()
}

const handleTypeSuccess = async () => {
  await treeRef.value?.loadList()
  // 抽屉开着的时候，改完要让它自己也跟着变，不能等到关掉才刷新
  await manageDrawerRef.value?.loadList()
  // 改了分类可能改到当前选中的这个，右侧的标题、树形标记都要跟着更新
  if (currentType.value?.id) {
    currentType.value = await DictTypeApi.getDictType(currentType.value.id)
  }
  await refreshDictCache()
}

// ========== 数据 ==========

const handleCreateData = (parentId: number) => {
  dataFormRef.value.open('create', undefined, currentType.value?.type, {
    treeEnabled: !!currentType.value?.treeEnable,
    parentId
  })
}

const handleEditData = (id: number) => {
  dataFormRef.value.open('update', id, currentType.value?.type, {
    treeEnabled: !!currentType.value?.treeEnable
  })
}

const handleImportData = () => {
  importFormRef.value.open(
    currentType.value?.type,
    currentType.value?.name,
    !!currentType.value?.treeEnable
  )
}

const handleDataSuccess = async () => {
  await tableRef.value?.getList()
  await refreshDictCache()
}

/**
 * 刷新前端的字典缓存
 *
 * 不刷的话，管理员刚在这个页面上改完字典，切到别的页面看到的还是旧标签，
 * 要等到下次整站刷新才生效——这正是版本号机制想避免的体验
 */
const refreshDictCache = async () => {
  try {
    await dictStore.resetDict()
  } catch {
    // 缓存刷新失败不该让「保存成功」变成一个错误提示
  }
}
</script>
