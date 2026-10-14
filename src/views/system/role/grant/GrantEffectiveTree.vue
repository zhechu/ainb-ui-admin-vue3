<template>
  <!--
    🔴 这里**不给死高度**。el-table-v2 的 height 是一个像素数字（不是 CSS 字符串），
    必须由下面 measure() 量出来。用 `h-[calc(100vh-…)]` 那套路子在这里行不通：
    本组件上面还压着 index.vue 的「角色条 + 工具条」那张卡片，它的高度取决于
    EP 按钮行高、表单行距、卡片内边距，把这些猜进 calc 就是一串会漂的魔数；
    而量一次 host 的**顶部位置**，上面压着什么、压了多高全都自动算进去了。

    ⚠️ 因此 infoRef 那个包裹层是必需的：它装着三条内容驱动高度的东西
    （条件渲染的超管提示、会随汇总文案换行的口径提示、会换行的工具条），
    观察它就能在数据回来后自动重量一次，不必把「什么时候该重量」列全
  -->
  <div class="flex flex-col gap-8px">
    <div ref="infoRef" class="flex flex-col gap-8px">
      <!--
        超管提示。🔴 必须显眼：真实鉴权对超管角色是**旁路**授权台账的
        （后端 GrantDecisionService#isSuperAdmin 命中即放行，压根不查 sys_grant），
        而这张图画的是台账本身。不说清楚的话，管理员会拿着这张图去论证
        「超管怎么少了这个权限」—— 而那个权限他其实一直有
      -->
      <el-alert
        v-if="summary?.superAdminRole"
        :closable="false"
        show-icon
        title="这是超级管理员角色：真实鉴权旁路授权台账"
        type="warning"
      >
        <span class="text-12px">
          超级管理员在鉴权时是命中即放行、不查授权台账的，所以它实际能做的**多于**这张图。
          这里画的是台账上真实写着的行，用于核对配置，不代表该角色的实际能力上限。
        </span>
      </el-alert>

      <!-- 口径 + 汇总。🔴 「藏了什么」必须说出来，理由见下面 summaryText 的注释 -->
      <el-alert :closable="false" type="info">
        <div class="text-12px leading-20px">
          <div v-if="summaryText" class="font-bold">{{ summaryText }}</div>
          <div class="text-gray-500">
            只读视图，按<strong>角色维度</strong>求值：本角色 + 它继承的上级角色 + 全员主体
            <template v-if="subjectLabels.length"
              >（实际参与判定：{{ subjectLabels.join('、') }}）</template
            >
            ，<strong>不含</strong>用户级 / 岗位 / 部门 /
            用户组授权，因此少于「拥有该角色的用户实际能做的」。
            只认启用的资源；被显式拒绝的动作不出现在树里（计入上面那句汇总），
            所以列表页的「效果」列在这里恒为允许，逐动作明细见动作标签的悬浮提示。
          </div>
        </div>
      </el-alert>

      <!-- 工具条 -->
      <div class="flex flex-wrap items-center gap-12px">
        <!--
          🔴 筛选是**客户端**的，不重新求值：这棵树本来就是一次性整棵拿回来的，
          再加一个服务端关键词参数就得把「命中节点要连带保留哪些祖先」这条规则
          在后端重实现一遍，两处口径一漂移就是「列表页搜得到、这里搜不到」。
          判据与代价写在 effectiveTree.ts 的 filterEffectiveTree 注释里。

          ⚠️ 不做防抖（ResourceTreePicker 那个搜索框做了 150ms）：那边防的是 EP `filter()`
          对 1086 个节点的全树游走 + 展开态改写；这里只是一次 computed 剪枝，
          输入 700 个节点量级、虚拟化表格只画可见行，逐字符重算比等 150ms 更像「跟手」
        -->
        <el-input
          v-model="keyword"
          class="!w-240px"
          clearable
          placeholder="按资源名称或权限标识筛选"
          size="small"
        >
          <template #prefix>
            <Icon icon="ep:search" />
          </template>
        </el-input>
        <el-checkbox v-model="includeDefaultAllow" size="small">
          <span class="text-12px">显示默认放行（未配置）</span>
        </el-checkbox>
        <el-checkbox v-model="includeFieldLevel" size="small">
          <span class="text-12px">显示字段级资源（列 / 字段）</span>
        </el-checkbox>
        <el-button :disabled="!filteredTree.length" size="small" @click="toggleExpandAll">
          <Icon class="mr-5px" :icon="isExpandAll ? 'ep:fold' : 'ep:expand'" />
          {{ isExpandAll ? '收起全部' : '展开全部' }}
        </el-button>
        <el-button :disabled="!roleId" size="small" @click="load">
          <Icon class="mr-5px" icon="ep:refresh" />
          刷新
        </el-button>
        <!--
          🔴 筛选中必须同时报「命中几个」和「全量几个」。只报命中的那个，
          管理员会把「筛完剩 3 行」读成「这个角色只有 3 项权限」——
          与顶部 summaryText 那段「把藏了什么说出来」是同一类误读，同一个防线
        -->
        <span class="ml-auto text-12px text-gray-400">
          <template v-if="isFiltering">
            命中 {{ filteredNodeCount }} 个资源（全量 {{ summary?.nodeCount ?? 0 }} 个 ·
            {{ summary?.actionCount ?? 0 }} 项生效动作）
          </template>
          <template v-else>
            共 {{ summary?.nodeCount ?? 0 }} 个资源 · {{ summary?.actionCount ?? 0 }} 项生效动作
          </template>
        </span>
      </div>
    </div>

    <!--
      🔴 只量这个 host 的**位置**，绝不要量它的高度，更不要量 el-table-v2 本身：
      表格的高度是我们回写上去的（v2 会把 height 内联写到它的虚拟列表上），
      观察一个你正在给它定尺寸的元素 = ResizeObserver 自激振荡（高度在两个值之间来回跳）。
      overflow-hidden 兜住任何一两像素的舍入溢出
    -->
    <div ref="hostRef" v-loading="loading" class="overflow-hidden">
      <!--
        🔴 用 el-table-v2 而不是 el-table 的树形模式。读过 EP 2.13.7 的 wrappedRowRender：
        树形分支里的 traverse **无条件递归全部后代**并逐个 rowRender，expanded 只被折算成
        display:none，全部节点都在 DOM 里；而 treeData 是它的渲染依赖，
        点一次展开箭头 = 整表重渲染。实测超管角色有 702 个生效节点，
        702 行 × 8 列 ≈ 5600 个 td 全量入 DOM，而超管正是管理员第一个会点的账号。
        虚拟化是唯一能扛住这个规模的选项，src/views/system/menu/index.vue 是同类数据的现成先例
      -->
      <el-auto-resizer>
        <template #default="{ width }">
          <el-table-v2
            v-model:expanded-row-keys="expandedRowKeys"
            :columns="columns"
            :data="filteredTree"
            expand-column-key="name"
            fixed
            :height="tableHeight"
            row-key="id"
            :row-class="stripeRowClass"
            :width="width"
          >
            <template #empty>
              <el-empty :description="emptyText" :image-size="80" />
            </template>
          </el-table-v2>
        </template>
      </el-auto-resizer>
    </div>
  </div>
</template>

<script lang="tsx" setup>
import { ElTag, ElTooltip, TableV2FixedDir, type Column } from 'element-plus'
// ⚠️ @vueuse/core 没有自动导入（AGENTS.md 记着这一条），必须显式 import
import { useResizeObserver, useWindowSize } from '@vueuse/core'
import * as GrantApi from '@/api/system/grant'
import type { EffectiveActionVO, EffectiveResourceNodeVO } from '@/api/system/grant'
import {
  formatGrantAction,
  formatResourceType,
  resourceTypeTagType
} from '@/views/system/resource/constants'
import {
  actionDetailLines,
  collectKeysUpToDepth,
  countTreeNodes,
  expireCell,
  fieldModeCell,
  filterEffectiveTree,
  nodeStatus,
  rowFilterCell,
  sourceLabel,
  sourceTags,
  subjectLabel
} from './effectiveTree'

defineOptions({ name: 'GrantEffectiveTree' })

const props = defineProps<{ roleId?: number }>()

/**
 * 默认展开到第几层。实测超管角色 702 个生效节点，全展开是一堵墙；
 * 而第一屏真正要回答的是「哪几个大类下面有权限」，两层刚好
 */
const DEFAULT_VISIBLE_LEVELS = 2

/** 动作 chip 最多渲染几个，多出来的收进「+N」。行高是固定的，不设限会溢出后被裁掉 */
const ACTION_CHIP_CAP = 3

const TAG_TYPES = ['primary', 'success', 'info', 'warning', 'danger'] as const
type TagType = (typeof TAG_TYPES)[number]
/**
 * 常量模块与后端给的是宽松 string，这里收一次口 ——
 * 免得到处 `as any`，也免得把空串传给 EP 触发 prop 校验告警
 */
const tagType = (value: string | undefined): TagType =>
  TAG_TYPES.includes(value as TagType) ? (value as TagType) : 'info'

const loading = ref(false)
const resp = ref<GrantApi.EffectiveTreeRespVO>()
const includeFieldLevel = ref(false)
const includeDefaultAllow = ref(false)
const expandedRowKeys = ref<number[]>([])
const isExpandAll = ref(false)

const tree = computed(() => resp.value?.tree ?? [])
const summary = computed(() => resp.value?.summary)
const subjectLabels = computed(() =>
  (resp.value?.subjects ?? []).map((subject) => subjectLabel(subject, props.roleId))
)

// -------- 客户端筛选 --------

const keyword = ref('')
/** 判据用 trim 之后的串：只敲了几个空格不算在筛，否则空态与计数会一起切到「筛选中」 */
const isFiltering = computed(() => !!keyword.value.trim())
const filteredTree = computed(() => filterEffectiveTree(tree.value, keyword.value))
const filteredNodeCount = computed(() => countTreeNodes(filteredTree.value))

/**
 * 空态文案三态。
 *
 * 🔴 筛选无命中必须**自己说一句**，不能沿用「该角色在角色维度上没有任何生效权限」：
 * 那句话在筛选中是**假话** —— 权限明明有，只是没匹配上这个词。
 * 把「搜不到」显示成「没有」，管理员下一步就是去列表页查这个角色是不是配错了
 */
const emptyText = computed(() => {
  if (!props.roleId) return '缺少角色参数，请从角色管理页进入'
  if (isFiltering.value) return `没有匹配「${keyword.value.trim()}」的资源，换个词或清空筛选`
  return '该角色在角色维度上没有任何生效权限'
})

/**
 * 顶部那句汇总。
 *
 * 🔴 存在的理由是「把藏了什么说出来」：这棵树是**剪过枝**的，节点数天然少于列表页的行数
 * （多行合并成一个节点、被拒绝的动作不出现、过期行不计入、纯默认放行的节点默认收起）。
 * 不报数的话，管理员拿两页一对，第一反应是「智能查看漏了权限」，而不是「它合并了」
 */
const summaryText = computed(() => {
  const s = summary.value
  if (!s) return ''
  const parts = [`共 ${s.nodeCount} 个资源、${s.actionCount} 项生效动作`]
  const from: string[] = []
  if (s.inheritedCount) from.push(`${s.inheritedCount} 项继承自上级`)
  if (s.allUsersCount) from.push(`${s.allUsersCount} 项来自全员默认`)
  if (from.length) parts.push(`其中 ${from.join('、')}`)
  const hidden: string[] = []
  if (s.deniedCount) hidden.push(`${s.deniedCount} 项被显式拒绝`)
  if (s.expiredSkippedCount) hidden.push(`${s.expiredSkippedCount} 条授权已过期`)
  if (!includeDefaultAllow.value && s.defaultAllowCount) {
    hidden.push(`${s.defaultAllowCount} 个资源属「默认放行（未配置）」已收起`)
  }
  if (hidden.length) parts.push(`另有 ${hidden.join('、')}，均未计入`)
  return `${parts.join('；')}。`
})

// -------- 测高 --------
// ⚠️ 这一段必须排在 load 之前：load 结束时要求量一次高度，
// 而 measure 是 const 箭头函数，放到后面就变成「靠调用时序侥幸不踩 TDZ」

/** 再窄也至少给这么多行高，免得量到一个几十像素的缝就把表压成一条 */
const MIN_TABLE_HEIGHT = 320

/**
 * host 底部到内容区底部之间那几段固定留白：
 * 卡片 body 的下内边距 10（ContentWrap 的 body-style）+ 卡片下边框 1
 * + 内容区 section 的下内边距（--app-content-padding = 9）
 */
const BOTTOM_INSET = 20

const hostRef = ref<HTMLElement>()
const infoRef = ref<HTMLElement>()
const tableHeight = ref(MIN_TABLE_HEIGHT)

/**
 * 表格高度 = min(内容区底部, 滚动视口底部) - host 顶部 - BOTTOM_INSET。
 *
 * 与 ContentWrap 自己的 `updateListLayout` 同一套算法 —— 那边是给「有 .el-table 且有
 * .el-pagination」的卡片自动定高，本组件用的是 .el-table-v2，压根走不进那条分支，只能自己算。
 *
 * 🔴 三个量都在**视口坐标系**里，所以页面滚动时它们一起移动、差值不变 ⟹ 与滚动位置无关。
 * 🔴 夹 min(内容区底部, 视口底部) 是防振荡的关键一环：section 用的是 min-h，
 * 表格一旦把它撑破，「内容区底部」就跟着往下跑，算出来的余量反而更大 ⟹ 越量越高。
 * 夹住视口就断掉了这个正反馈；而算准之后总高恰好等于内容区高度，section 也就不会被撑破。
 */
const measure = () => {
  const el = hostRef.value
  if (!el) return
  const scroller = el.closest('.el-scrollbar__wrap')
  const viewportBottom = scroller
    ? Math.min(window.innerHeight, scroller.getBoundingClientRect().bottom)
    : window.innerHeight
  const section = el.closest('section')
  const sectionBottom = section ? section.getBoundingClientRect().bottom : viewportBottom
  const next = Math.floor(
    Math.min(sectionBottom, viewportBottom) - el.getBoundingClientRect().top - BOTTOM_INSET
  )
  // 只接受正值：切到别的页面 / 卡片被 display:none 时量出来是负的，
  // 直接写上去会让表格缩成 0，切回来还得再量一次
  if (next > 0) tableHeight.value = Math.max(MIN_TABLE_HEIGHT, next)
}

/**
 * 什么时候重量：
 *  · 窗口尺寸变了（视口底部变了）
 *  · infoRef 那一坨的高度变了（超管提示条件渲染出现、汇总文案换行、工具条换行、字体加载完）
 *  · 数据回来了（load 里 nextTick 补一次，兜住 ResizeObserver 与渲染的时序差）
 * 🔴 观察的是 infoRef 而不是 host：infoRef 的高度是内容驱动的，我们从不回写它 ⟹ 不会自激振荡
 */
const { width: windowWidth, height: windowHeight } = useWindowSize()
watch([windowWidth, windowHeight], () => nextTick(measure))
useResizeObserver(infoRef, () => measure())

/**
 * 重算展开态。**唯一**一处写 expandedRowKeys 的地方（除了「收起全部」那一下），
 * load 与关键词变更都走它，免得两处各写一份、日后漂成两种展开口径。
 *
 * 🔴 筛选中一律全展开：命中项可能落在很深的位置，而它的祖先是被剪枝后**新造**的副本，
 * 沿用「默认展开两层」会让用户搜到东西却只看见几行折叠的父级 ——
 * 「搜了没反应」和「搜不到」在体感上是同一件事。
 * 全展开的规模由命中数兜住，不是整棵 702 个节点的树
 *
 * ⚠️ isExpandAll 必须跟着置位：它是「展开全部 / 收起全部」那个按钮的文案与图标来源，
 * 只改 key 不改它，按钮会写着「展开全部」而树其实已经全开了 —— 点下去变成收起，
 * 用户读到的是「按钮坏了」
 */
const applyExpansion = () => {
  isExpandAll.value = isFiltering.value
  expandedRowKeys.value = collectKeysUpToDepth(
    filteredTree.value,
    isFiltering.value ? Infinity : DEFAULT_VISIBLE_LEVELS
  )
}

const load = async () => {
  if (!props.roleId) {
    resp.value = undefined
    return
  }
  loading.value = true
  try {
    resp.value = await GrantApi.getEffectiveTree(
      'ROLE',
      props.roleId,
      includeFieldLevel.value,
      // 🔴 全员主体恒开：实测库里有 9 条 ALL / ALLOW 行，关掉它们这张图就会少东西。
      // 参与判定的主体清单在响应里，已经印在顶部那句口径说明里了
      true,
      includeDefaultAllow.value
    )
    // 重新求值后展开态必须重算：换一个开关树的形状就变了，
    // 攥着上一批 key 会让新树里同 id 的节点莫名其妙是展开的
    applyExpansion()
  } finally {
    loading.value = false
    // 汇总文案与超管提示都可能在这次数据回来后**换行/出现**，把 host 往下推 ⟹ 必须重量一次。
    // 等 nextTick 是为了量在 DOM 更新之后；ResizeObserver 也会兜，但两者的时序不该互相依赖
    await nextTick()
    measure()
  }
}

const toggleExpandAll = () => {
  isExpandAll.value = !isExpandAll.value
  expandedRowKeys.value = isExpandAll.value
    ? collectKeysUpToDepth(filteredTree.value, Infinity)
    : []
}

// 隔行浅色按真实行号取模：v2 只渲染可视窗口的行，CSS nth-child 会让条纹跟着滚动手抖
const stripeRowClass = ({ rowIndex }: { rowIndex: number }) =>
  rowIndex % 2 === 1 ? 'xpy-v2-striped' : ''

// -------- 单元格 --------

/**
 * 纯文本单元格：超长省略 + 原生 title。
 *
 * el-table-v2 没有 show-overflow-tooltip，而给每个格子挂一个 ElTooltip 不划算：
 * 一屏 20 行 × 8 列 = 160 个实例，滚动时反复创建销毁。原生 title 在虚拟化下是零成本的
 */
const textCell = (text: string, muted: boolean) => (
  <span class={['min-w-0 truncate', muted ? 'text-gray-400' : '']} title={text}>
    {text}
  </span>
)

/** 一个动作 chip，悬浮时给出这一项的完整明细（效果 / 来源 / 授权行 / 规则 / 字段模式 / 到期 / 主体） */
const actionChip = (action: EffectiveActionVO) => {
  const isWildcard = action.action === '*'
  return (
    <ElTooltip key={action.action} effect="dark" placement="top">
      {{
        default: () => (
          <ElTag size="small" type={isWildcard ? 'warning' : 'info'}>
            {isWildcard ? '全部动作' : formatGrantAction(action.action)}
          </ElTag>
        ),
        content: () => (
          <div class="max-w-300px">
            {actionDetailLines(action).map((line) => (
              <div key={line.label} class="flex gap-8px">
                <span class="opacity-70">{line.label}</span>
                <span class="ml-auto">{line.value}</span>
              </div>
            ))}
          </div>
        )
      }}
    </ElTooltip>
  )
}

/** 「+N」chip：超出上限的那些动作，悬浮时列全（连带各自的来源） */
const moreChip = (rest: EffectiveActionVO[]) => (
  <ElTooltip effect="dark" placement="top">
    {{
      default: () => (
        <ElTag effect="plain" size="small" type="info">
          +{rest.length}
        </ElTag>
      ),
      content: () => (
        <div class="max-w-300px">
          {rest.map((action) => (
            <div key={action.action}>
              {formatGrantAction(action.action)}（{sourceLabel(action)}）
            </div>
          ))}
        </div>
      )
    }}
  </ElTooltip>
)

/**
 * 🔴 columns 必须是 computed 而不是常量数组：v2 的单元格由它自己在虚拟滚动时渲染，
 * 内部有 cell 缓存，光靠 cellRenderer 里读 ref 不保证会重画。让 columns 依赖状态后，
 * 状态一变就产出一个新的列定义数组，表格必然整表重渲染（menu/index.vue 记着同一条）
 */
const columns = computed<Column<EffectiveResourceNodeVO>[]>(() => [
  {
    key: 'name',
    title: '资源名称',
    dataKey: 'name',
    width: 280,
    fixed: TableV2FixedDir.LEFT,
    cellRenderer: ({ rowData }) => (
      <div class="flex min-w-0 flex-1 items-center gap-4px">
        <span
          class={['min-w-0 truncate', rowData.structural ? 'text-gray-400' : '']}
          title={rowData.name}
        >
          {rowData.name}
        </span>
        <ElTag size="small" type={tagType(resourceTypeTagType(rowData.type))}>
          {formatResourceType(rowData.type)}
        </ElTag>
        {/* 路径节点：自身没有任何生效权限，只是为了让树不断链才留着。
            不标出来的话，一个空目录会被读成「这一层也有权限」 */}
        {rowData.structural ? (
          <ElTag effect="plain" size="small" type="info">
            路径
          </ElTag>
        ) : null}
      </div>
    )
  },
  {
    key: 'permission',
    title: '权限标识',
    dataKey: 'permission',
    width: 200,
    // ⚠️ 从 rowData 取而不是 cellData：EP 把 CellRendererProps 的 cellData 也标成了整行的类型 T，
    // 于是 `cellData as string` 会被 TS2352 拦下（两种类型没有重叠）。其余各列一律读 rowData，正好同口径
    cellRenderer: ({ rowData }) =>
      rowData.permission ? textCell(rowData.permission, false) : textCell('-', true)
  },
  {
    key: 'actions',
    title: '生效动作',
    dataKey: 'actions',
    width: 240,
    cellRenderer: ({ rowData }) => {
      const actions = rowData.actions ?? []
      if (!actions.length) return textCell('-', true)
      const rest = actions.slice(ACTION_CHIP_CAP)
      return (
        <div class="flex min-w-0 flex-wrap items-center gap-4px overflow-hidden">
          {actions.slice(0, ACTION_CHIP_CAP).map((action) => actionChip(action))}
          {rest.length ? moreChip(rest) : null}
        </div>
      )
    }
  },
  {
    key: 'source',
    title: '权限来源',
    width: 200,
    cellRenderer: ({ rowData }) => {
      const { shown, rest } = sourceTags(rowData)
      if (!shown.length) return textCell('-', true)
      return (
        <div class="flex min-w-0 flex-wrap items-center gap-4px overflow-hidden">
          {shown.map((tag) => (
            <ElTag key={tag.label} effect="plain" size="small" type={tagType(tag.type)}>
              <span class="max-w-160px truncate">{tag.label}</span>
            </ElTag>
          ))}
          {rest.length ? (
            <ElTooltip effect="dark" placement="top">
              {{
                default: () => (
                  <ElTag effect="plain" size="small" type="info">
                    +{rest.length}
                  </ElTag>
                ),
                content: () => (
                  <div class="max-w-300px">
                    {rest.map((tag) => (
                      <div key={tag.label}>{tag.label}</div>
                    ))}
                  </div>
                )
              }}
            </ElTooltip>
          ) : null}
        </div>
      )
    }
  },
  {
    key: 'ruleName',
    title: '行过滤规则',
    width: 150,
    cellRenderer: ({ rowData }) => {
      const cell = rowFilterCell(rowData)
      return textCell(cell.text, cell.muted)
    }
  },
  {
    key: 'fieldMode',
    title: '字段模式',
    width: 100,
    align: 'center',
    cellRenderer: ({ rowData }) => {
      const cell = fieldModeCell(rowData)
      return cell.tag ? (
        <ElTag size="small" type={tagType(cell.tag)}>
          {cell.text}
        </ElTag>
      ) : (
        textCell(cell.text, cell.muted)
      )
    }
  },
  {
    key: 'expireTime',
    title: '到期时间',
    width: 170,
    cellRenderer: ({ rowData }) => {
      const cell = expireCell(rowData)
      return textCell(cell.text, cell.muted)
    }
  },
  {
    key: 'status',
    title: '状态',
    width: 120,
    align: 'center',
    fixed: TableV2FixedDir.RIGHT,
    cellRenderer: ({ rowData }) => {
      const status = nodeStatus(rowData)
      return (
        <ElTag effect="plain" size="small" type={tagType(status.type)}>
          {status.label}
        </ElTag>
      )
    }
  }
])

// -------- 初始化 --------

watch([includeFieldLevel, includeDefaultAllow], load)
watch(
  () => props.roleId,
  () => load()
)
/**
 * 关键词变更**只重算展开态**，不重新求值：剪枝本身是 filteredTree 那个 computed 在做。
 *
 * ⚠️ 换角色、切「显示字段级 / 默认放行」两个开关时**都不清关键词** ——
 * 用户搜着词切视野，把搜索框清空是抢他的输入（与 ResourceTreePicker 同一条口径）
 */
watch(keyword, () => applyExpansion())
onMounted(async () => {
  await load()
  // 兜一次首屏：roleId 缺失时 load 会提前 return，那里不会重量，
  // 而空态的 el-empty 也把 host 撑到了另一个高度
  await nextTick()
  measure()
})

/**
 * 父页面在抽屉提交成功后要能就地刷新这棵树 —— 那时人还停在树形页，组件**没有**重新挂载，
 * 靠 onMounted 是等不来的。
 *
 * 对外叫 reload 而不是 load：对调用方来说这是「重新拉一次」，
 * 而 load 在本组件内部还兼着首次加载与两个勾选框变更时的重载
 */
defineExpose({ reload: load })
</script>
