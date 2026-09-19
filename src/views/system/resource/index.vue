<template>
  <ContentWrap>
    <el-form :inline="true" :model="queryParams" class="-mb-15px" label-width="80px">
      <el-form-item label="权限标识" prop="permission">
        <el-input
          v-model="queryParams.permission"
          class="!w-220px"
          clearable
          placeholder="支持模糊搜索，如 system:user"
          @keyup.enter="handleQuery"
        />
      </el-form-item>
      <el-form-item label="资源名称" prop="name">
        <el-input
          v-model="queryParams.name"
          class="!w-180px"
          clearable
          placeholder="请输入资源名称"
          @keyup.enter="handleQuery"
        />
      </el-form-item>
      <el-form-item label="类型" prop="type">
        <el-select v-model="queryParams.type" class="!w-150px" clearable placeholder="全部类型">
          <el-option v-for="t in TYPES" :key="t.value" :label="t.label" :value="t.value" />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-button @click="handleQuery"><Icon class="mr-5px" icon="ep:search" />搜索</el-button>
        <el-button @click="resetQuery"><Icon class="mr-5px" icon="ep:refresh" />重置</el-button>
        <el-button
          v-hasPermi="['system:resource:update']"
          plain
          type="primary"
          @click="openForm('create')"
        >
          <Icon class="mr-5px" icon="ep:plus" />新增
        </el-button>
      </el-form-item>
    </el-form>
  </ContentWrap>

  <ContentWrap>
    <div class="mb-12px flex flex-wrap items-center gap-10px text-13px">
      <span class="text-gray-600">共 {{ total }} 个资源</span>
      <span v-if="isSearching" class="text-12px text-orange-500">搜索结果已展开全部层级</span>
      <!--
        字段级资源默认不加载：它们按表单数量线性增长，全量拉进来会把要看的 ACTION 淹没，
        也是这个页面最主要的渲染开销来源。口径与授权页一致
      -->
      <el-checkbox v-model="includeFieldLevel" size="small" @change="getList">
        <span class="text-12px">包含列 / 字段级资源</span>
      </el-checkbox>
      <span class="ml-auto text-12px text-gray-400">点击行展开子资源，点「详情」查看授权与槽位</span>
    </div>

    <!--
      ⚠️ 用 lazy 懒加载，而不是 default-expand-all 或受控折叠。
      el-table 的树形表格会把【全部】节点一次性渲染进 tbody，折叠只是 CSS 隐藏 ——
      实测全库 650+ 资源时首屏就是 653 行 DOM，折叠根本不减少渲染量，页面明显卡。
      lazy 模式下首屏只拉约 100 个根节点，子节点展开时才请求。

      搜索时关掉 lazy 并 default-expand-all：命中结果散落在各层，
      不展开的话行虽然渲染了却是 hidden，用户看到的是「搜了有结果但列表空着」。
      结果集已被筛小，全展开的渲染量可控。
      ⚠️ :key 必须【每次数据重载都变】，不能只在 search/lazy 两态间切换。
      el-table 内部维护着 lazyTreeNodeMap（已展开节点的子数据缓存），
      key 相同 → 组件复用 → 那份缓存留着，而 data 已经换了一批 ——
      再点展开时它拿旧缓存去匹配新行，实测直接把渲染进程搞崩（Page crashed）。
      复现路径：搜索 → 重置 → 点展开
    -->
    <!--
      ⚠️ 搜索态与懒加载态用【两个独立的 el-table】，靠 v-if 互斥，而不是同一个组件
      切 :lazy 属性。

      el-table 的 lazy 是有内部状态的（states.lazyTreeNodeMap / treeData 缓存已展开
      节点的子数据）。让同一个实例在「懒加载的根列表」和「搜索出来的完整树」之间来回切，
      这些缓存会和新数据对不上 —— 实测会直接把渲染进程搞崩（Page crashed，
      控制台里连一条 JS 错误都没有），复现路径是「搜索空结果 → 重置 → 点展开」。
      加 :key 强制重建、先清空数据再赋值、加竞态守卫都压不住，因为问题出在
      组件复用本身。拆成两个实例后，切换 = 一个销毁一个新建，不存在脏状态。
    -->
    <el-table
      v-if="mode === 'lazy'"
      key="tbl-lazy"
      ref="tableRef"
      v-loading="loading"
      :data="list"
      row-key="id"
      lazy
      :load="loadChildren"
      :tree-props="{ children: 'children', hasChildren: 'hasChildren' }"
      :height="tableHeight"
      highlight-current-row
    >
      <el-table-column label="资源名称" min-width="230">
        <template #default="{ row }">
          <span class="text-13px">{{ row.name }}</span>
          <el-tag v-if="row.menuId" class="ml-6px" size="small" type="info">菜单派生</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="权限标识" prop="permission" min-width="250" show-overflow-tooltip />
      <el-table-column label="类型" width="100" align="center">
        <template #default="{ row }">
          <el-tag size="small" :type="(typeTagType(row.type) as any)">{{ row.type }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="默认效果" width="90" align="center">
        <template #default="{ row }">
          <el-tag size="small" :type="row.defaultEffect === 'ALLOW' ? 'success' : 'info'">
            {{ row.defaultEffect }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="排序" prop="sort" width="70" align="center" />
      <el-table-column label="操作" width="170" align="center" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click.stop="openDetail(row)">详情</el-button>
          <el-button
            v-hasPermi="['system:resource:update']"
            link
            type="primary"
            size="small"
            @click.stop="openForm('update', row)"
          >
            编辑
          </el-button>
          <el-button
            v-hasPermi="['system:resource:update']"
            link
            type="danger"
            size="small"
            @click.stop="handleDelete(row)"
          >
            删除
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-table
      v-else
      key="tbl-search"
      ref="tableRef"
      v-loading="loading"
      :data="list"
      row-key="id"
      default-expand-all
      :tree-props="{ children: 'children' }"
      :height="tableHeight"
      highlight-current-row
    >
      <el-table-column label="资源名称" min-width="230">
        <template #default="{ row }">
          <span class="text-13px">{{ row.name }}</span>
          <el-tag v-if="row.menuId" class="ml-6px" size="small" type="info">菜单派生</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="权限标识" prop="permission" min-width="250" show-overflow-tooltip />
      <el-table-column label="类型" width="100" align="center">
        <template #default="{ row }">
          <el-tag size="small" :type="(typeTagType(row.type) as any)">{{ row.type }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="默认效果" width="90" align="center">
        <template #default="{ row }">
          <el-tag size="small" :type="row.defaultEffect === 'ALLOW' ? 'success' : 'info'">
            {{ row.defaultEffect }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="排序" prop="sort" width="70" align="center" />
      <el-table-column label="操作" width="170" align="center" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click.stop="openDetail(row)">详情</el-button>
          <el-button
            v-hasPermi="['system:resource:update']"
            link
            type="primary"
            size="small"
            @click.stop="openForm('update', row)"
          >
            编辑
          </el-button>
          <el-button
            v-hasPermi="['system:resource:update']"
            link
            type="danger"
            size="small"
            @click.stop="handleDelete(row)"
          >
            删除
          </el-button>
        </template>
      </el-table-column>
    </el-table>
  </ContentWrap>

  <!-- 新增/编辑 -->
  <Dialog v-model="formVisible" :title="formTitle" width="560px">
    <el-alert v-if="formDerived" class="mb-12px" type="warning" :closable="false" show-icon>
      该资源由菜单（id={{ formData.menuId }}）自动维护，只能改显示顺序与状态。
      要改权限标识/名称，请到「菜单管理」修改对应菜单，否则下次菜单同步会覆盖回去。
    </el-alert>
    <el-form ref="formRef" :model="formData" :rules="formRules" label-width="96px">
      <el-form-item label="权限标识" prop="permission">
        <el-input v-model="formData.permission" :disabled="formDerived" placeholder="如 system:user:query" />
      </el-form-item>
      <el-form-item label="资源名称" prop="name">
        <el-input v-model="formData.name" :disabled="formDerived" placeholder="如 用户查询" />
      </el-form-item>
      <el-form-item label="资源类型" prop="type">
        <el-select v-model="formData.type" class="w-full" :disabled="formDerived" placeholder="请选择类型">
          <el-option v-for="t in TYPES" :key="t.value" :label="t.label" :value="t.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="父资源" prop="parentId">
        <el-select
          v-model="formData.parentId"
          class="w-full"
          :disabled="formDerived"
          filterable
          placeholder="挂在根下请选「根节点」"
        >
          <el-option label="根节点" :value="0" />
          <el-option
            v-for="r in parentCandidates"
            :key="r.id"
            :label="`${r.name}（${r.permission || '无权限串'}）`"
            :value="r.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="显示顺序" prop="sort">
        <el-input-number v-model="formData.sort" :min="0" class="!w-160px" />
      </el-form-item>
      <el-form-item label="状态" prop="status">
        <el-radio-group v-model="formData.status">
          <el-radio :value="0">开启</el-radio>
          <el-radio :value="1">关闭</el-radio>
        </el-radio-group>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button :loading="saving" type="primary" @click="submitForm">确 定</el-button>
      <el-button @click="formVisible = false">取 消</el-button>
    </template>
  </Dialog>

  <ResourceDetailPanel ref="detailRef" />
</template>

<script lang="ts" setup>
import * as GrantApi from '@/api/system/grant'
import { handleTree } from '@/utils/tree'
import ResourceDetailPanel from './ResourceDetailPanel.vue'

defineOptions({ name: 'SystemResource' })

const message = useMessage()

const TYPES = [
  { label: 'MENU 菜单', value: 'MENU' },
  { label: 'ACTION 操作', value: 'ACTION' },
  { label: 'DATASET 数据集', value: 'DATASET' },
  { label: 'COLUMN 列', value: 'COLUMN' },
  { label: 'FIELD 字段', value: 'FIELD' },
  { label: 'PROCESS 流程', value: 'PROCESS' },
  { label: 'CATEGORY 分类', value: 'CATEGORY' }
]

const loading = ref(false)
const rawList = shallowRef<any[]>([])
/**
 * 表格重建 key：每次数据重载都 +1。
 * 见模板里的说明 —— 光按 search/lazy 两态切换不够，会留下脏的懒加载缓存
 */
const tableKey = ref(0)

/**
 * 表格当前模式。⚠️ 它只在 getList 里跟着数据一起切，不要改成由 queryParams 实时计算 ——
 * 那样模式会先于数据变化，中间态下 el-table 会拿错误的树结构跑 lazy 逻辑
 */
const mode = ref<'search' | 'lazy'>('lazy')
const isSearching = computed(() => mode.value === 'search')
const includeFieldLevel = ref(false)
const queryParams = reactive({ permission: '', name: '', type: '' })

/**
 * 表格高度（像素，不是 max-height）
 *
 * ⚠️ 必须用 height 而不是 max-height：
 *   · max-height 时内容少则表格只有内容那么高，卡片跟着塌，底部空一大片
 *     （实测搜索后只剩 3 行时，卡片 219px、底部空 275px）
 *   · height="100%" 在父容器没有确定高度时会退化成内容高度，
 *     102 行全渲染直接把卡片撑到 4201px，页面变成超长滚动条
 * 所以按视口算一个确定的像素值，内容多时表格内部滚动，内容少时下方留白但卡片不塌。
 *
 * ContentWrap 本来有自动撑高，但它要求「卡片里有 el-pagination」且「表格没设自定义高度」——
 * 这个页面是树表、没有分页，两个条件都不满足，只能自己接管
 */
const tableRef = ref()
const tableHeight = ref(420)

/**
 * 按表格在页面上的【实际位置】算高度，而不是 window.innerHeight 减一个魔数。
 *
 * ⚠️ 固定减 300 这种写法在换一个视口 / 换一套布局（折叠侧边栏、多标签页栏、
 * 搜索区换行）时必然失准 —— 头部占多高是会变的，减固定值等于假设它永远不变。
 * 取表格自身的 getBoundingClientRect().top，剩下多少就用多少，才是真正的自适应。
 */
const recalcHeight = () => {
  const el = tableRef.value?.$el as HTMLElement | undefined
  if (!el) {
    tableHeight.value = Math.max(260, window.innerHeight - 300)
    return
  }
  const top = el.getBoundingClientRect().top
  // 24px 是卡片底部内边距 + 视觉留白，不留的话表格边框会贴着窗口底边
  tableHeight.value = Math.max(260, Math.floor(window.innerHeight - top - 24))
}

const getList = async () => {
  loading.value = true
  try {
    const searching = !!(queryParams.permission.trim() || queryParams.name.trim() || queryParams.type)
    let rows: any[]
    if (searching) {
      // 搜索/按类型筛选：要全量才能算出命中路径
      rows = await GrantApi.getResourceList(
        queryParams.type || undefined,
        includeFieldLevel.value
      )
    } else {
      // 默认视图：只取根节点，子节点等展开时再拉
      rows = await GrantApi.getResourceChildren(0, includeFieldLevel.value)
    }
    // ⚠️ 模式标记与数据必须【一起】换，且换完就重建表格。
    //
    // 原来 lazy/default-expand-all 绑的是 isSearching（由 queryParams 实时算出），
    // 而 rawList 要等接口回来才更新 —— 中间这一小段时间里，el-table 已经切到
    // lazy 模式，手上却还是搜索态留下的树结构。此时点展开，它拿 lazy 的逻辑
    // 去处理一棵不该由它管的树，直接把渲染进程搞崩（Page crashed，无 JS 报错）。
    // 复现路径：搜索空结果 → 重置 → 点展开。
    // ⚠️ 先清空再赋值，中间 await 一帧：
    // 让 el-table 先以「空数据」完成一次销毁重建，再接收新数据。
    // 直接从「搜索态的树」切到「懒加载的根列表」时，el-table 内部的
    // states.lazyTreeNodeMap / treeData 还残留着上一批的节点引用，
    // 新旧结构对不上就会崩（Page crashed，无 JS 报错）
    rawList.value = []
    mode.value = searching ? 'search' : 'lazy'
    tableKey.value++
    await nextTick()
    rawList.value = rows
    tableKey.value++
  } finally {
    loading.value = false
  }
}

/**
 * el-table 懒加载回调：展开某行时拉它的子资源
 *
 * ⚠️ 必须用 tableKey 做版本守卫。
 * 数据重载时 tableKey++ 会销毁并重建 el-table，而本函数是异步的 ——
 * 上一批的请求可能在组件销毁【之后】才 resolve，把数据塞进一个已经不存在的树里。
 * 实测这会直接把渲染进程搞崩（Page crashed），复现路径是「搜索 → 重置 → 点展开」，
 * 且只在部分视口下稳定复现（小屏先崩，大屏可能侥幸不崩）——
 * 这种「看运气」的表现正是竞态的典型特征
 */
const loadChildren = async (row: any, _treeNode: unknown, resolve: (data: any[]) => void) => {
  const versionAtStart = tableKey.value
  try {
    const data = await GrantApi.getResourceChildren(row.id, includeFieldLevel.value)
    if (versionAtStart !== tableKey.value) {
      resolve([]) // 表格已重建，这次结果属于上一批，丢弃
      return
    }
    resolve(data)
  } catch {
    resolve([])
  }
}

onMounted(async () => {
  window.addEventListener('resize', recalcHeight)
  await getList()
  // 等表格渲染出来再量它的位置，DOM 还没有时量到的是 0
  await nextTick()
  recalcHeight()
})
onUnmounted(() => window.removeEventListener('resize', recalcHeight))

/** id → 节点，供筛选时上溯祖先用。用 shallowRef 的原始数组算一次即可 */
const byId = computed(() => new Map<number, any>(rawList.value.map((r) => [r.id, r])))

/**
 * 过滤 + 组装树。
 *
 * ⚠️ 命中的节点必须连同祖先一起保留，否则子节点会挂在一个不存在的 parentId 上
 * 被 handleTree 整体丢弃 —— 表现是「搜了个确实存在的权限串，一条都不显示」。
 * 这与历史上「菜单树返回空数组」是同一个病根
 */
const list = computed(() => {
  const kw = queryParams.permission.trim().toLowerCase()
  const nameKw = queryParams.name.trim().toLowerCase()
  let rows = rawList.value
  if (kw || nameKw) {
    const map = byId.value
    const keep = new Set<number>()
    for (const r of rows) {
      const hit =
        (!kw || (r.permission ?? '').toLowerCase().includes(kw)) &&
        (!nameKw || (r.name ?? '').toLowerCase().includes(nameKw))
      if (!hit) continue
      let cur: any = r
      let guard = 0
      while (cur && guard++ < 32) {
        keep.add(cur.id)
        cur = map.get(cur.parentId)
      }
    }
    rows = rows.filter((r) => keep.has(r.id))
  }
  // ⚠️ 这里【不能】写 total.value = rows.length。
  // 在 computed 里改 ref 是副作用：total 变化会触发依赖它的渲染，
  // 渲染又可能重新求值本 computed，配合 tableKey 的组件重建形成循环，
  // 最终把渲染进程撑爆（表现是 Page crashed，控制台里一条 JS 错误都没有）。
  // 复现路径：搜索空结果 → 重置 → 点展开。
  // total 改成独立 computed，见下方
  //
  // 懒加载模式下 rawList 就是根节点列表，不需要也不能再 handleTree
  // （那会把没有 children 的根节点当成孤儿丢掉）
  return mode.value === 'search' ? handleTree(rows, 'id', 'parentId') : rows
})

/** 过滤后的行数。独立算，不在 list 的 computed 里赋值 ref */
const total = computed(() => {
  const kw = queryParams.permission.trim().toLowerCase()
  const nameKw = queryParams.name.trim().toLowerCase()
  if (!kw && !nameKw) return rawList.value.length
  return rawList.value.filter(
    (r: any) =>
      (!kw || (r.permission ?? '').toLowerCase().includes(kw)) &&
      (!nameKw || (r.name ?? '').toLowerCase().includes(nameKw))
  ).length
})

const handleQuery = async () => {
  await getList()
  await nextTick()
  recalcHeight()
}
const resetQuery = async () => {
  queryParams.permission = ''
  queryParams.name = ''
  queryParams.type = ''
  await getList()
  await nextTick()
  recalcHeight()
}

const typeTagType = (t: string) =>
  ({ ACTION: 'primary', DATASET: 'warning', MENU: 'info', COLUMN: 'success', FIELD: 'success' })[t] ?? ''

// -------- 新增 / 编辑 --------

const formVisible = ref(false)
const formTitle = ref('新增资源')
const saving = ref(false)
const formRef = ref()
const formData = ref<any>({})
const formDerived = computed(() => !!formData.value.menuId)
const formRules = {
  permission: [{ required: true, message: '请输入权限标识', trigger: 'blur' }],
  name: [{ required: true, message: '请输入资源名称', trigger: 'blur' }],
  type: [{ required: true, message: '请选择资源类型', trigger: 'change' }],
  parentId: [{ required: true, message: '请选择父资源', trigger: 'change' }]
}

/** 可选父资源：排除列/字段级（它们是叶子，不该有子节点） */
const parentCandidates = computed(() =>
  rawList.value.filter((r) => !['COLUMN', 'FIELD'].includes(r.type))
)

const openForm = (type: 'create' | 'update', row?: any) => {
  formTitle.value = type === 'create' ? '新增资源' : '编辑资源'
  formData.value =
    type === 'create'
      ? { permission: '', name: '', type: 'ACTION', parentId: 0, sort: 0, status: 0 }
      : { ...row }
  formVisible.value = true
  nextTick(() => formRef.value?.clearValidate())
}

const submitForm = async () => {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  saving.value = true
  try {
    if (formData.value.id) {
      await GrantApi.updateResource(formData.value)
      message.success('修改成功')
    } else {
      await GrantApi.createResource(formData.value)
      message.success('新增成功')
    }
    formVisible.value = false
    await getList()
  } finally {
    saving.value = false
  }
}

const handleDelete = async (row: any) => {
  try {
    await message.delConfirm(`确认删除资源「${row.name}」？`)
  } catch {
    return
  }
  await GrantApi.deleteResource(row.id)
  message.success('删除成功')
  await getList()
}

const detailRef = ref()
const openDetail = (row: any) => detailRef.value?.open(row)
</script>

<style lang="scss" scoped>
/*
  高度由表格的 :height 决定（见脚本里的 tableHeight）。
  这里只保证卡片体不额外挤压表格 —— 不用 flex 撑满那一套：
  ContentWrap 的自动撑高对本页不生效（要求有 el-pagination，而这是棵树表），
  而 height:100% 在父容器没有确定高度时会退化成内容高度，把页面撑成长滚动条
*/
:deep(.el-card__body) {
  padding-bottom: 12px;
}
</style>
