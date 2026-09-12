<!-- 字典分类树：左树右表的左半边 -->
<template>
  <div class="h-full flex flex-col">
    <!-- 搜索框独占一行：面板只有 280px，跟一排操作按钮挤在同一行的话，
         输入框会被压到看不清自己输了什么 -->
    <el-input
      v-model="keyword"
      class="mb-8px"
      clearable
      placeholder="搜索分类名称/编码"
      @clear="loadList"
      @keyup.enter="loadList"
    >
      <template #prefix>
        <Icon icon="ep:search" />
      </template>
    </el-input>

    <div class="mb-8px flex items-center justify-between gap-4px">
      <el-dropdown v-hasPermi="['system:dict:create']" @command="handleCreate">
        <el-button plain size="small" type="primary">
          <Icon class="mr-2px" icon="ep:plus" />
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

      <!-- 用图标按钮而不是文字：四个操作的文字加起来放不进这点宽度，
           鼠标停上去有 tooltip。图标按钮本身没有可读文本，所以补 aria-label -->
      <div class="dict-tree-tools flex items-center gap-4px">
        <el-tooltip content="刷新数据" placement="top">
          <el-button aria-label="刷新数据" plain size="small" @click="handleRefresh">
            <Icon icon="ep:refresh" />
          </el-button>
        </el-tooltip>
        <el-tooltip content="展开全部" placement="top">
          <el-button aria-label="展开全部" plain size="small" @click="handleExpandAll(true)">
            <Icon icon="ep:caret-bottom" />
          </el-button>
        </el-tooltip>
        <el-tooltip content="折叠全部" placement="top">
          <el-button aria-label="折叠全部" plain size="small" @click="handleExpandAll(false)">
            <Icon icon="ep:caret-right" />
          </el-button>
        </el-tooltip>
        <el-tooltip content="分类管理" placement="top">
          <el-button aria-label="分类管理" plain size="small" @click="emit('manage')">
            <Icon icon="ep:setting" />
          </el-button>
        </el-tooltip>
      </div>
    </div>

    <!-- 分类有 270+ 个，这里一定会滚。用 el-scrollbar 而不是 overflow-auto：
         原生滚动条会常驻占掉 8~17px，把本就不宽的分类名再挤窄一截 -->
    <el-scrollbar class="flex-1 min-h-0">
      <el-tree
        ref="treeRef"
        v-loading="loading"
        :allow-drop="allowDrop"
        :data="treeData"
        :draggable="hasUpdatePermission"
        :expand-on-click-node="false"
        :default-expanded-keys="expandedKeys"
        :props="{ label: 'name', children: 'children' }"
        highlight-current
        node-key="id"
        @node-click="handleNodeClick"
        @node-drop="handleNodeDrop"
      >
        <template #default="{ node, data }">
          <!-- 节点上不放操作按钮：这里只有 280px 宽，挂两三个按钮就把分类名挤没了。
               增删改和导出都在「分类管理」抽屉里做，那边一行摆得开 -->
          <span class="flex items-center gap-4px overflow-hidden">
            <Icon :icon="nodeIcon(data)" :size="14" />
            <span class="truncate">{{ node.label }}</span>
          </span>
        </template>
      </el-tree>
    </el-scrollbar>
  </div>
</template>

<script lang="ts" setup>
import { handleTree } from '@/utils/tree'
import { checkPermi } from '@/utils/permission'
import * as DictTypeApi from '@/api/system/dict/dict.type'
import { DictTypeNodeEnum } from '@/api/system/dict/dict.type'

defineOptions({ name: 'DictTypeTree' })

const props = defineProps<{
  /** 首次加载时要选中的字典编码，用于从旧路由重定向过来时定位 */
  defaultType?: string
}>()

const emit = defineEmits<{
  (e: 'select', row: DictTypeApi.DictTypeVO): void
  (e: 'create', nodeType: number, parentId: number): void
  (e: 'manage'): void
}>()

const message = useMessage()

const loading = ref(false)
const keyword = ref('')
const treeRef = ref()
const list = ref<DictTypeApi.DictTypeVO[]>([])
const currentId = ref<number>()

const treeData = computed(() => handleTree(list.value.map((item) => ({ ...item }))))
const expandedKeys = ref<number[]>([])

/**
 * 计算默认展开哪些节点
 *
 * 存量字典有 270+ 个，全展开等于没分组，用户还是要在一长串里找。
 * 默认只展开当前选中项所在的那条分支；搜索时则全展开，否则命中项藏在折叠的分组里看不见。
 */
const computeExpandedKeys = (targetId?: number) => {
  if (keyword.value) {
    expandedKeys.value = list.value.map((item) => item.id!)
    return
  }
  const byId = new Map(list.value.map((item) => [item.id!, item]))
  const keys: number[] = []
  let node = targetId ? byId.get(targetId) : undefined
  // 循环上限兜底：数据被改坏形成环时不能把页面卡死
  for (let i = 0; i < 64 && node?.parentId; i++) {
    keys.push(node.parentId)
    node = byId.get(node.parentId)
  }
  expandedKeys.value = keys
}
const hasUpdatePermission = computed(() => checkPermi(['system:dict:update']))

const nodeIcon = (data: DictTypeApi.DictTypeVO) => {
  if (data.nodeType === DictTypeNodeEnum.GROUP) {
    return 'ep:folder'
  }
  // 树形字典单独给个图标，让人一眼看出右侧会是树表而不是普通表格
  return data.treeEnable ? 'ep:share' : 'ep:document'
}

/** 加载分类列表 */
const loadList = async () => {
  loading.value = true
  try {
    list.value = await DictTypeApi.getDictTypeList(keyword.value || undefined)
    // 展开项要在树渲染前算好，否则 default-expanded-keys 不生效
    const keepId =
      currentId.value && list.value.some((item) => item.id === currentId.value)
        ? currentId.value
        : resolveDefaultNode()?.id
    computeExpandedKeys(keepId)
    await nextTick()
    // 选中态在重新加载后要保住，否则每次增删改都会把右侧表格弹回未选中状态
    if (currentId.value && list.value.some((item) => item.id === currentId.value)) {
      treeRef.value?.setCurrentKey(currentId.value)
    } else {
      selectFirstDict()
    }
    if (keyword.value) {
      // 搜索时命中项必须看得见。用户之前点过的「折叠全部」在这里要让位，
      // 否则搜出来的结果全藏在收起的分组里，等于搜了个寂寞
      setExpandedAll(true)
    } else if (expandAllState.value !== undefined) {
      setExpandedAll(expandAllState.value)
    }
  } finally {
    loading.value = false
  }
}

/** 默认落在哪个节点：优先指定的字典，否则第一个字典节点（分组不承载数据，选中它右侧没东西可显示） */
const resolveDefaultNode = () =>
  (props.defaultType && list.value.find((item) => item.type === props.defaultType)) ||
  list.value.find((item) => item.nodeType === DictTypeNodeEnum.DICT)

const selectFirstDict = () => {
  const target = resolveDefaultNode()
  if (!target) {
    currentId.value = undefined
    emit('select', undefined as any)
    return
  }
  currentId.value = target.id
  treeRef.value?.setCurrentKey(target.id)
  emit('select', target)
}

const handleNodeClick = (data: DictTypeApi.DictTypeVO) => {
  currentId.value = data.id
  emit('select', data)
}

const handleCreate = (nodeType: number) => {
  // 当前选中的是分组就挂在它下面，否则挂到根；选中字典时不能往它下面挂分类
  const current = list.value.find((item) => item.id === currentId.value)
  const parentId = current?.nodeType === DictTypeNodeEnum.GROUP ? current.id! : 0
  emit('create', nodeType, parentId)
}

/** 刷新：重新拉一次分类，顺带给个反馈——数据没变化时用户看不出点没点到 */
const handleRefresh = async () => {
  await loadList()
  message.success('已刷新')
}

/**
 * 展开 / 折叠全部
 *
 * el-tree 没有现成的整树展开 API，只能直接改 store 里每个节点的 expanded。
 * `default-expanded-keys` 帮不上忙：它只在数据重建时生效一次，点按钮时不会被重新读取
 */
const setExpandedAll = (expanded: boolean) => {
  const nodesMap = treeRef.value?.store?.nodesMap ?? {}
  Object.values(nodesMap).forEach((node: any) => (node.expanded = expanded))
}

/**
 * 记住用户最后一次的展开意图
 *
 * 换数据时 el-tree 会按 `default-expanded-keys` 重建展开态。不记这个的话，
 * 「展开全部」之后随便点一下刷新或新增，整棵树就又塌回默认那一条分支了
 */
const expandAllState = ref<boolean>()

const handleExpandAll = (expanded: boolean) => {
  expandAllState.value = expanded
  setExpandedAll(expanded)
}

/**
 * 只允许拖到分组内部，或者作为某个节点的兄弟
 *
 * 字典节点底下挂的是字典数据，不能再挂分类——这条规则后端也会校验，
 * 这里拦住是为了不让用户做完拖拽动作才收到一个报错
 */
const allowDrop = (_draggingNode: any, dropNode: any, type: string) => {
  if (type === 'inner') {
    return dropNode.data.nodeType === DictTypeNodeEnum.GROUP
  }
  return true
}

const handleNodeDrop = async (draggingNode: any, dropNode: any, dropType: string) => {
  const parentId = dropType === 'inner' ? dropNode.data.id : (dropNode.data.parentId ?? 0)
  // 用落位后的同级下标当排序值，拖到哪就是第几个
  const siblings = dropType === 'inner' ? dropNode.childNodes : dropNode.parent.childNodes
  const sort = siblings.findIndex((n: any) => n.data.id === draggingNode.data.id)
  try {
    await DictTypeApi.moveDictType({ id: draggingNode.data.id, parentId, sort })
    message.success('移动成功')
  } catch {
    // 后端拒绝时要把树还原，否则界面上呈现的是一个并未生效的位置
  } finally {
    await loadList()
  }
}

defineExpose({ loadList })

onMounted(() => loadList())
</script>

<style lang="scss" scoped>
// element-plus 默认给相邻按钮加了 12px 外边距。这里只有 280px，
// 四个图标按钮加上默认间距会把最后一个挤出卡片被裁掉，间距统一交给 gap 控制
.dict-tree-tools :deep(.el-button + .el-button) {
  margin-left: 0;
}
</style>
