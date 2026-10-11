<template>
  <!-- 未选中主体时的空态 -->
  <el-empty
    v-if="!subjectRefId && !subjectCode"
    description="从左侧选择一个角色，查看并配置它的资源授权"
    :image-size="80"
  />

  <div v-else v-loading="formLoading" class="grant-assign-panel">
    <!-- 主体信息 -->
    <div class="mb-12px flex items-center gap-8px text-13px">
      <span class="text-gray-500">主体</span>
      <el-tag size="small">{{ subjectTypeLabel }}</el-tag>
      <el-tag size="small" type="info">{{ subjectName }}</el-tag>
      <span class="ml-auto text-gray-500">
        已配置 {{ grantList.length }} 条<template v-if="isFiltered"
          >，筛出 {{ filteredGrantList.length }} 条</template
        >
      </span>
      <el-button v-if="!rowFormVisible" type="primary" size="small" @click="openAddRow">
        <Icon icon="ep:plus" class="mr-4px" />新增授权
      </el-button>
    </div>

    <!--
        授权列表的查询区。纯前端过滤：一个主体的授权撑死几百条，已经全在内存里，
        走后端反而多一次往返。资源名 / 权限串 / 规则名都能搜 ——
        配权限时最常见的问题是「这个角色对 xx 有没有授权」，靠肉眼翻表格找不现实
      -->
    <div class="mb-12px flex flex-wrap items-center gap-8px">
      <el-input
        v-model="query.keyword"
        class="!w-260px"
        clearable
        size="small"
        placeholder="搜索资源名称 / 权限标识 / 规则名"
      >
        <template #prefix><Icon icon="ep:search" /></template>
      </el-input>
      <el-select v-model="query.action" class="!w-130px" clearable size="small" placeholder="动作">
        <!-- 筛选下拉给全量词表、不分组：目的是「找到库里已存在的行」，
             预留动作和脏值都可能已经落在库里，筛不出来就等于这行搜不到 -->
        <el-option
          v-for="a in GRANT_ACTION_OPTIONS"
          :key="a.value"
          :label="a.label"
          :value="a.value"
        />
      </el-select>
      <el-select v-model="query.effect" class="!w-110px" clearable size="small" placeholder="效果">
        <el-option label="允许 ALLOW" value="ALLOW" />
        <el-option label="拒绝 DENY" value="DENY" />
      </el-select>
      <el-select
        v-model="query.ruleState"
        class="!w-150px"
        clearable
        size="small"
        placeholder="行过滤"
      >
        <el-option label="已绑定规则" value="BOUND" />
        <el-option label="不受限（全部行）" value="UNBOUND" />
      </el-select>
      <el-button v-if="isFiltered" size="small" link type="primary" @click="resetQuery">
        重置
      </el-button>
    </div>

    <!--
        新增/编辑内联表单。
        ⚠️ 这里刻意【不用】第二个 Dialog：原来的实现是「点资源授权弹一次、点新增再弹一次」，
        配一条授权要穿过两层弹窗，且第二层盖住第一层的列表，看不到已配了什么 ——
        而「这条会不会和已有的冲突」恰恰是配授权时最需要对照的信息
      -->
    <el-card v-if="rowFormVisible" class="mb-12px" shadow="never" body-style="padding: 16px">
      <template #header>
        <span class="text-14px font-bold">{{ rowFormTitle }}</span>
      </template>
      <el-form ref="rowFormRef" :model="rowForm" :rules="rowFormRules" label-width="96px">
        <el-row :gutter="16">
          <el-col :span="24">
            <el-form-item label="资源" prop="resourceId">
              <!--
                  ⚠️ 用 el-select + el-tree-v2，而不是 el-tree-select。
                  el-tree-select 底层是普通 el-tree，会把全部节点一次性渲染成 DOM；
                  资源有 700+ 个，每次输入都要全量过滤 + 重建 DOM，输入卡顿非常明显。
                  el-tree-v2 是虚拟化树，只渲染可视区域的十几个节点，与总量无关
                -->
              <el-select
                v-model="rowForm.resourceId"
                class="w-full"
                clearable
                filterable
                :filter-method="onResourceFilter"
                placeholder="按名称或权限标识搜索"
                @visible-change="onResourceDropdownToggle"
              >
                <!--
                    字段级资源默认不进树：一张表单几十个字段，几十张表单就是几千个叶子，
                    会把真正要配的 ACTION 淹没掉。但默认不给又没有出口的话，
                    【授权页里根本找不到 system:user:fld:mobile 这类资源，字段权限压根配不出来】。

                    ⚠️ 开关必须放在下拉浮层【内部】：放在外面时，浮层是 teleport 到 body 的，
                    展开后会把下方的开关盖住 —— 用户「翻了半天没找到字段资源，想去找开关」
                    的路径上正好被浮层挡着，点不到
                  -->
                <template #header>
                  <el-checkbox
                    v-model="includeFieldLevel"
                    size="small"
                    @change="reloadResourceTree"
                  >
                    <span class="text-12px">显示字段级资源（列 / 字段）</span>
                  </el-checkbox>
                  <div class="mt-2px text-11px text-gray-400 leading-tight">
                    字段权限（如手机号隐藏）要勾上这项才能选到对应资源
                  </div>
                </template>

                <!-- 选中项的回显：el-select 需要一个 option 才能显示 label -->
                <el-option
                  v-if="selectedResource"
                  :key="selectedResource.id"
                  :label="selectedResourceLabel"
                  :value="selectedResource.id"
                />
                <template #empty>
                  <div class="p-8px">
                    <el-tree-v2
                      ref="resourceTreeRef"
                      :data="resourceTree"
                      :props="{ label: 'name', children: 'children', value: 'id' }"
                      :height="280"
                      :filter-method="treeFilterMethod"
                      :expand-on-click-node="false"
                      highlight-current
                      @node-click="onResourceNodeClick"
                    >
                      <template #default="{ node, data }">
                        <span class="flex items-center gap-6px overflow-hidden">
                          <span class="text-13px">{{ node.label }}</span>
                          <span v-if="data.permission" class="text-11px text-gray-400 truncate">
                            {{ data.permission }}
                          </span>
                        </span>
                      </template>
                    </el-tree-v2>
                  </div>
                </template>
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item prop="action">
              <template #label>
                <span class="inline-flex items-center">动作<GrantActionHelp /></span>
              </template>
              <el-select v-model="rowForm.action" class="w-full" placeholder="请选择动作">
                <el-option-group :label="GRANT_ACTION_GROUP_LABELS.effective">
                  <el-option
                    v-for="a in actionGroups.effective"
                    :key="a.value"
                    :label="a.label"
                    :value="a.value"
                  />
                </el-option-group>
                <el-option-group
                  v-if="actionGroups.reserved.length"
                  :label="GRANT_ACTION_GROUP_LABELS.reserved"
                >
                  <el-option
                    v-for="a in actionGroups.reserved"
                    :key="a.value"
                    :label="a.label"
                    :value="a.value"
                  />
                </el-option-group>
              </el-select>
            </el-form-item>
          </el-col>
          <!--
            独占一整行、紧跟在动作下面：分组标题那句「配了不生效」随下拉收起就没了，
            而保存会成功、权限不会生效，点「确定」之前得有一处一直提醒着。
            放进上面那个 span=12 的列里会被挤成两百来像素宽，一行字要折三四行
          -->
          <el-col v-if="actionWarning" :span="24">
            <el-alert type="warning" :closable="false" show-icon class="mb-18px !py-4px">
              <div class="text-12px leading-snug">{{ actionWarning }}</div>
            </el-alert>
          </el-col>
          <el-col :span="12">
            <el-form-item label="效果" prop="effect">
              <el-radio-group v-model="rowForm.effect">
                <el-radio value="ALLOW">允许</el-radio>
                <el-radio value="DENY">拒绝</el-radio>
              </el-radio-group>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="行过滤规则">
              <el-select
                v-model="rowForm.ruleId"
                class="w-full"
                clearable
                placeholder="不绑定（该主体不受行限制）"
              >
                <el-option v-for="r in ruleList" :key="r.id" :label="r.name" :value="r.id">
                  <span>{{ r.name }}</span>
                  <span class="ml-8px text-11px text-gray-400">{{ r.description }}</span>
                </el-option>
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="字段显示模式">
              <el-select
                v-model="rowForm.fieldMode"
                class="w-full"
                clearable
                :disabled="!isFieldLevelResource"
                :placeholder="isFieldLevelResource ? '不限制' : '仅对「列/字段」类资源有效'"
              >
                <!-- ⚠️ value 必须与后端 FieldModeEnum 完全一致：EDITABLE / READONLY / HIDDEN。
                       这里原先写的是 VISIBLE —— 后端 FieldModeEnum.parse("VISIBLE") 返回 null，
                       而引擎会把 parse 不出来的授权行【整行过滤掉】，
                       表现是「选了可见、保存成功、列表也显示可见，但判定时完全不生效」 -->
                <el-option label="可编辑 (EDITABLE)" value="EDITABLE" />
                <el-option label="只读 (READONLY)" value="READONLY" />
                <el-option label="隐藏 (HIDDEN)" value="HIDDEN" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="到期时间">
              <el-date-picker
                v-model="rowForm.expireTime"
                :default-time="defaultExpireTime"
                type="datetime"
                class="w-full"
                clearable
                placeholder="不填=永不过期；清空可取消"
                value-format="YYYY-MM-DD HH:mm:ss"
              />
            </el-form-item>
          </el-col>
        </el-row>
        <!-- 不绑规则时说清楚它的含义，这一条直接决定多角色合并的结果 -->
        <el-alert
          v-if="!rowForm.ruleId && rowForm.effect === 'ALLOW'"
          type="info"
          :closable="false"
          show-icon
          class="mb-12px"
        >
          未绑定行过滤规则 = 该主体可以看到这张表的<b>全部行</b>。
          用户拥有多个角色时，只要有一个角色是「不受限」，合并结果就是不受限。
        </el-alert>
        <div class="text-right">
          <el-button :loading="rowSaving" type="primary" size="small" @click="submitRowForm">
            确 定
          </el-button>
          <el-button size="small" @click="closeRowForm">取 消</el-button>
        </div>
      </el-form>
    </el-card>

    <el-table :data="filteredGrantList" size="small" border :max-height="tableMaxHeight">
      <el-table-column label="资源" min-width="180">
        <template #default="{ row }">
          <div class="text-13px">{{ row.resourceName || row.resourcePermission }}</div>
          <div class="text-11px text-gray-400">{{ row.resourcePermission }}</div>
        </template>
      </el-table-column>
      <el-table-column label="动作" width="90" align="center">
        <template #default="{ row }">
          <el-tag size="small" :type="row.action === '*' ? 'warning' : 'info'">
            {{ formatGrantAction(row.action) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="效果" width="80" align="center">
        <template #default="{ row }">
          <el-tag size="small" :type="row.effect === 'ALLOW' ? 'success' : 'danger'">
            {{ row.effect === 'ALLOW' ? '允许' : '拒绝' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="行过滤规则" min-width="130">
        <template #default="{ row }">
          <span v-if="row.ruleName" class="text-13px">{{ row.ruleName }}</span>
          <span v-else class="text-12px text-gray-400">不受限（全部行）</span>
        </template>
      </el-table-column>
      <el-table-column label="字段模式" width="90" align="center">
        <template #default="{ row }">
          <el-tag v-if="row.fieldMode" size="small" :type="fieldModeTagType(row.fieldMode) as any">
            {{ fieldModeLabel(row.fieldMode) }}
          </el-tag>
          <span v-else class="text-12px text-gray-400">-</span>
        </template>
      </el-table-column>
      <el-table-column label="到期时间" width="140" align="center">
        <template #default="{ row }">
          <template v-if="row.expireTime">
            <el-tag v-if="row.expired" size="small" type="danger">已过期</el-tag>
            <span v-else class="text-12px">{{ formatDate(row.expireTime) }}</span>
          </template>
          <span v-else class="text-12px text-gray-400">永不过期</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="100" align="center" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="openEditRow(row)">编辑</el-button>
          <el-button link type="danger" size="small" @click="handleDeleteRow(row.id)"
            >删除</el-button
          >
        </template>
      </el-table-column>
    </el-table>

    <el-empty
      v-if="filteredGrantList.length === 0 && !formLoading"
      :description="isFiltered ? '没有符合条件的授权' : '暂无授权配置'"
      :image-size="60"
    />
  </div>
</template>

<script lang="ts" setup>
import * as GrantApi from '@/api/system/grant'
import type { GrantVO, GrantSaveReqVO, RuleVO } from '@/api/system/grant'
import { handleTree } from '@/utils/tree'
import { formatDate } from '@/utils/formatTime'
import {
  GRANT_ACTION_GROUP_LABELS,
  GRANT_ACTION_OPTIONS,
  formatGrantAction,
  grantActionGroupsFor,
  isGrantActionAllowed,
  reservedActionWarning
} from '@/views/system/resource/constants'
import GrantActionHelp from '@/views/system/resource/components/GrantActionHelp.vue'
import dayjs from 'dayjs'

defineOptions({ name: 'SystemGrantAssignPanel' })

const message = useMessage()

/** 只选日期不选时间时，默认到当天 23:59:59 —— 「有效期到某天」的直觉是含当天全天 */
const defaultExpireTime = new Date(2000, 0, 1, 23, 59, 59)

/**
 * 主体由外部传入（角色管理页是左侧选中的那一行）。
 * 改成 props 驱动而不是 open() 命令式调用：面板常驻在页面右侧，
 * 左边换一个角色右边就要跟着换，用 watch 比让父组件记得调 open() 可靠
 */
const props = defineProps<{
  subjectType: string
  subjectRefId?: number
  subjectCode?: string
  name?: string
}>()

const formLoading = ref(false)

const subjectType = computed(() => props.subjectType)
const subjectRefId = computed(() => props.subjectRefId)
const subjectCode = computed(() => props.subjectCode)
const subjectName = computed(() => props.name ?? '')

const subjectTypeLabel = computed(() => {
  const MAP: Record<string, string> = {
    ROLE: '角色',
    USER: '用户',
    DEPT: '部门',
    POST: '岗位',
    GROUP: '用户组',
    SYSTEM: '系统身份',
    ALL: '全部用户'
  }
  return MAP[subjectType.value] ?? subjectType.value
})

// 授权列表
const grantList = ref<GrantVO[]>([])

// -------- 查询（纯前端过滤）--------

const query = reactive({ keyword: '', action: '', effect: '', ruleState: '' })
const isFiltered = computed(
  () => !!(query.keyword || query.action || query.effect || query.ruleState)
)
const resetQuery = () => {
  query.keyword = ''
  query.action = ''
  query.effect = ''
  query.ruleState = ''
}
const filteredGrantList = computed(() => {
  if (!isFiltered.value) return grantList.value
  const kw = query.keyword.trim().toLowerCase()
  return grantList.value.filter((g: any) => {
    if (query.action && g.action !== query.action) return false
    if (query.effect && g.effect !== query.effect) return false
    if (query.ruleState === 'BOUND' && !g.ruleId) return false
    if (query.ruleState === 'UNBOUND' && g.ruleId) return false
    if (!kw) return true
    return [g.resourceName, g.resourcePermission, g.ruleName].some((v) =>
      (v ?? '').toLowerCase().includes(kw)
    )
  })
})

/**
 * 表格最大高度：撑满剩余视口，而不是写死 380px。
 * 写死的后果是「上面内容少时底部一大片空白、内容多时又挤在一个小框里滚」
 */
const tableMaxHeight = ref(420)
const recalcTableHeight = () => {
  // 视口高度减去页头/搜索区/面板头等固定占用，留 40px 余量。
  // ⚠️ 这些数都是估的不是量的：动作下面那条预留警告展开时得把它的高度也算进去，
  // 否则表格底边会被顶出视口。actionWarning 在本函数【之后】才定义 —— 与下面
  // rowFormVisible 同理，靠「本函数只在 onMounted / 用户操作时才被调用」成立
  const formHeight = 620 + (actionWarning.value ? 52 : 0)
  tableMaxHeight.value = Math.max(
    240,
    window.innerHeight - (rowFormVisible.value ? formHeight : 340)
  )
}
onMounted(() => {
  recalcTableHeight()
  window.addEventListener('resize', recalcTableHeight)
})
onUnmounted(() => window.removeEventListener('resize', recalcTableHeight))
// 资源树（用于选择资源）
const resourceTree = ref<any[]>([])
// 规则列表
const ruleList = ref<RuleVO[]>([])

// 动作选项走 @/views/system/resource/constants 的共享词表，本文件不再存副本

/**
 * 资源树与规则列表与主体无关，整个面板生命周期里只拉一次。
 * 每换一个角色都重拉 800+ 条资源是纯浪费，而且会让切换有明显卡顿
 */
const staticLoaded = ref(false)
/** 资源树是否包含 COLUMN/FIELD 级资源。默认关，打开才加载 */
const includeFieldLevel = ref(false)

const loadStatic = async () => {
  if (staticLoaded.value) return
  const [resources, rules] = await Promise.all([
    GrantApi.getResourceList(undefined, includeFieldLevel.value),
    GrantApi.getSimpleRuleList()
  ])
  resourceTree.value = handleTree(resources, 'id', 'parentId')
  ruleList.value = rules
  staticLoaded.value = true
}

/** 切换「显示字段级资源」时重新拉一次资源树 */
const reloadResourceTree = async () => {
  const resources = await GrantApi.getResourceList(undefined, includeFieldLevel.value)
  resourceTree.value = handleTree(resources, 'id', 'parentId')
  nextTick(() => resourceTreeRef.value?.filter(''))
}

/** 重新加载当前主体的授权列表 */
const reload = async () => {
  if (props.subjectRefId == null && !props.subjectCode) {
    grantList.value = []
    return
  }
  formLoading.value = true
  resetQuery() // 换角色时清掉筛选，否则会以为新角色「没有授权」
  closeRowForm() // 切主体时把上一次没关的表单收起来，否则会把 A 的表单提交到 B 身上
  try {
    await loadStatic()
    grantList.value = await GrantApi.getGrantListBySubject(
      props.subjectType,
      props.subjectRefId,
      props.subjectCode
    )
  } finally {
    formLoading.value = false
  }
}

// -------- 资源选择（虚拟化树）--------

const resourceTreeRef = ref()
/** 扁平索引：按 id 取资源，用于回显选中项。建一次即可 */
const resourceById = computed(() => {
  const map = new Map<number, any>()
  const walk = (ns: any[]) =>
    ns.forEach((n) => {
      map.set(n.id, n)
      if (n.children?.length) walk(n.children)
    })
  walk(resourceTree.value)
  return map
})
const selectedResource = computed(() =>
  rowForm.value.resourceId ? resourceById.value.get(rowForm.value.resourceId) : undefined
)
/**
 * 选中的是不是列/字段级资源。
 * fieldMode 只有落在 COLUMN/FIELD 资源上才有意义 —— 配到 ACTION 上是无效配置，
 * 而无效配置在这个系统里的典型表现就是「配了、存了、没生效、也不报错」，
 * 所以这里直接把它禁掉，而不是让人配完才发现没用
 */
const isFieldLevelResource = computed(() => {
  const r = selectedResource.value
  return !!r && ['COLUMN', 'FIELD'].includes(r.type)
})
/** 动作下拉的可选项随资源类型变：流程专属动作只在流程/分类上开放 */
const actionGroups = computed(() =>
  grantActionGroupsFor(selectedResource.value?.type, rowForm.value.action)
)
/** 选了不生效的动作时给一句常驻警告，见 reservedActionWarning */
const actionWarning = computed(() => reservedActionWarning(rowForm.value.action))
// 警告出现/消失会改变表单高度，表格的让位量要跟着重算
watch(actionWarning, recalcTableHeight)

const selectedResourceLabel = computed(() => {
  const r = selectedResource.value
  if (!r) return ''
  return r.permission ? `${r.name}（${r.permission}）` : r.name
})

/** el-tree-v2 的过滤：名称和权限标识都能搜到 */
const treeFilterMethod = (value: string, data: any) => {
  if (!value) return true
  const kw = value.toLowerCase()
  return (
    (data.name ?? '').toLowerCase().includes(kw) ||
    (data.permission ?? '').toLowerCase().includes(kw)
  )
}

/**
 * el-select 的输入转发给树做过滤。
 * 加 150ms 防抖：不防抖的话每敲一个字符都要触发一次树的全量重算，
 * 连打几个字就会明显掉帧
 */
let filterTimer: any = null
const onResourceFilter = (value: string) => {
  if (filterTimer) clearTimeout(filterTimer)
  filterTimer = setTimeout(() => resourceTreeRef.value?.filter(value), 150)
}
const onResourceDropdownToggle = (visible: boolean) => {
  if (visible) nextTick(() => resourceTreeRef.value?.filter(''))
}
const onResourceNodeClick = (data: any) => {
  // 换到非字段级资源时清掉 fieldMode，否则会把上一次选的模式残留着提交上去
  if (!['COLUMN', 'FIELD'].includes(data.type)) {
    rowForm.value.fieldMode = undefined
  }
  // 动作同理：换资源之后原来那个动作可能在新资源上不开放（从流程切到菜单，START 就没意义了）。
  // 这里重置是安全的 —— 是用户主动换的资源，不是在回显一条既有授权行
  if (!isGrantActionAllowed(rowForm.value.action, data.type)) {
    rowForm.value.action = 'VIEW'
  }
  // 结构节点（没有权限标识的 MENU 层）也允许选：给父节点授权会继承给子节点，
  // 这是资源树的核心用法，不能因为它没有 permission 就禁掉
  rowForm.value.resourceId = data.id
}

// -------- 新增/编辑授权行（内联，不再另开弹窗） --------

const rowFormVisible = ref(false)
const rowFormTitle = ref('新增授权')
const rowSaving = ref(false)
const rowFormRef = ref()

const buildEmptyForm = (): GrantSaveReqVO => ({
  subjectType: subjectType.value,
  subjectRefId: subjectRefId.value,
  subjectCode: subjectCode.value,
  // ⚠️ 这里必须是 undefined，不能是 0。
  // Element Plus 的 required 校验把 0 当作「已填」，用 0 做初值时
  // 不选资源直接点确定也能通过校验，然后提交一条 resourceId=0 的脏授权
  resourceId: undefined as unknown as number,
  action: 'VIEW',
  effect: 'ALLOW'
})

const rowForm = ref<GrantSaveReqVO>(buildEmptyForm())
const rowFormRules = {
  resourceId: [{ required: true, message: '请选择资源', trigger: 'change' }],
  action: [{ required: true, message: '请选择动作', trigger: 'change' }],
  effect: [{ required: true, message: '请选择效果', trigger: 'change' }]
}

const openAddRow = () => {
  rowFormTitle.value = '新增授权'
  rowForm.value = buildEmptyForm()
  rowFormVisible.value = true
  nextTick(() => {
    rowFormRef.value?.clearValidate()
    recalcTableHeight()
  })
}

const openEditRow = (row: GrantVO) => {
  rowFormTitle.value = '编辑授权'
  rowForm.value = {
    id: row.id,
    subjectType: row.subjectType,
    subjectRefId: row.subjectRefId,
    subjectCode: row.subjectCode,
    resourceId: row.resourceId,
    contextResourceId: row.contextResourceId,
    action: row.action,
    effect: row.effect,
    ruleId: row.ruleId,
    fieldMode: row.fieldMode,
    // 后端返回毫秒数，date-picker 带 value-format 时只认格式化字符串，直接塞数字会回显空白
    expireTime: row.expireTime ? dayjs(row.expireTime).format('YYYY-MM-DD HH:mm:ss') : undefined
  }
  rowFormVisible.value = true
  nextTick(() => {
    rowFormRef.value?.clearValidate()
    recalcTableHeight()
  })
}

const closeRowForm = () => {
  rowFormVisible.value = false
  nextTick(recalcTableHeight)
  rowSaving.value = false
}

const submitRowForm = async () => {
  const valid = await rowFormRef.value?.validate().catch(() => false)
  if (!valid) return
  // 到期时间填了过去的时间 = 保存即「已过期」，几乎一定是手误，先问一句
  if (rowForm.value.expireTime && dayjs(rowForm.value.expireTime).isBefore(dayjs())) {
    const ok = await message
      .confirm('到期时间早于当前时间，保存后该授权会立即处于「已过期」状态。是否继续？')
      .catch(() => false)
    if (!ok) return
  }
  rowSaving.value = true
  try {
    if (rowForm.value.id) {
      await GrantApi.updateGrant(rowForm.value)
      message.success('修改成功')
    } else {
      await GrantApi.createGrant(rowForm.value)
      message.success('新增成功')
    }
    closeRowForm()
    await reload()
  } finally {
    rowSaving.value = false
  }
}

const handleDeleteRow = async (id: number) => {
  // ⚠️ confirm 在点「取消」时是 reject，不 catch 会抛出未处理的 Promise 异常
  try {
    await message.confirm('确认删除该授权行？删除后立即生效。')
  } catch {
    return
  }
  await GrantApi.deleteGrant(id)
  message.success('删除成功')
  grantList.value = grantList.value.filter((g) => g.id !== id)
}

// -------- 辅助展示 --------

const fieldModeLabel = (mode: string) => {
  return { EDITABLE: '可编辑', READONLY: '只读', HIDDEN: '隐藏' }[mode] ?? mode
}
const fieldModeTagType = (mode: string) => {
  return { EDITABLE: 'success', READONLY: 'warning', HIDDEN: 'danger' }[mode] ?? ''
}
// ⚠️ watch 放在文件最末尾，不能提到 reload 定义处。
// immediate: true 会在 setup 阶段立刻执行一次 reload，而 reload 里用到的
// closeRowForm 是下面才定义的 const —— 提前触发会直接抛
// "Cannot access 'closeRowForm' before initialization"，面板整个白屏
watch(() => [props.subjectType, props.subjectRefId, props.subjectCode], reload, { immediate: true })
defineExpose({ reload })
</script>
