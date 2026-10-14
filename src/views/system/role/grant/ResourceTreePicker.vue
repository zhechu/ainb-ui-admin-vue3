<template>
  <div class="flex min-h-0 w-full flex-1 flex-col">
    <!-- 工具栏 -->
    <div class="mb-6px flex w-full items-center gap-8px">
      <el-input
        v-model="filterKeyword"
        class="!w-240px"
        clearable
        placeholder="按名称或权限标识搜索"
        @input="onFilterInput"
      >
        <template #prefix>
          <Icon icon="ep:search" />
        </template>
      </el-input>
      <el-checkbox
        :model-value="includeFieldLevel"
        size="small"
        @change="onIncludeFieldLevelChange"
      >
        <span class="text-12px">显示字段级资源（列 / 字段）</span>
      </el-checkbox>
      <template v-if="multiple">
        <span class="ml-auto text-12px text-gray-400">已选 {{ checkedIds.length }} 个资源</span>
        <el-button :disabled="!checkedIds.length" link type="primary" @click="clearChecked">
          清空
        </el-button>
      </template>
    </div>
    <div class="mb-4px text-11px leading-tight text-gray-400">
      <template v-if="multiple">
        勾一个资源<b>不会</b>自动带上它下面的资源。想整片选，点该行的「全选下级」
        （会把它和它下面的资源一起勾上，括号里是数量）；想整片撤，点「取消下级」。
      </template>
      <template v-else>
        字段权限（如手机号隐藏）要勾上「显示字段级资源」才能选到对应资源。
      </template>
    </div>

    <!--
      🔴 测高只量这个 host 外壳，绝不要量 el-tree-v2 本身：
      el-tree-v2 会把 `height: <N>px` 内联写到它的虚拟列表上，
      观察一个你正在给它定尺寸的元素 = ResizeObserver 自激振荡（高度在两个值之间来回跳）。
      host 的高度来自 flex 布局（flex:1 + min-h-0）而不是内容，所以它是稳定的被测量。
      overflow-hidden 兜住任何一两像素的舍入溢出
    -->
    <div
      ref="hostRef"
      class="min-h-0 flex-1 overflow-hidden rounded-4px border border-solid border-[var(--el-border-color)] p-4px"
      :class="disabled ? 'pointer-events-none opacity-60' : ''"
    >
      <!--
        🔴 check-strictly 必须开，但**理由不是**「给父资源授权不隐含子资源」——
        那句话曾经写在 GrantBatchForm 里，是错的。后端 GrantDecisionEngine#isAllowed
        把资源自身与它全部祖先的 id 收进同一个 chainIds，再用 chainIds.contains
        过滤授权行，祖先与自身的行无差别地混在一起判；优先级是 全局拒绝 > 上下文拒绝 >
        上下文允许 > 全局允许 > 资源默认效果。所以祖先上一条「允许」本来就足以放行后代，
        祖先上一条「拒绝」也能否决后代自己的「允许」。本库 1086 个资源里 954 个有真实父级，
        grant-enabled 也是 true —— 这套继承对约 88% 的资源是活的，不是纸面机制。

        真正要开 check-strictly 的理由是：联动模式下父节点的勾选态由子节点**反推**
        （子节点没勾满时父节点会被踢出 checkedKeys 落进半选态），
        于是「只勾这个菜单本身、不勾它下面的按钮」这个配置就表达不出来了 ——
        而本项目菜单可见性同样走 sys_grant，这个能力有实际用途。
        加上 el-tree-v2 没有把重算父节点状态的那个方法 expose 出来，
        切换模式后勾选态与外部值会对不上，且无法主动纠正。

        于是「全选下级」的真实代价也要说清楚：它产生的是**冗余但更耐久**的授权行 ——
        不是多授了权（祖先链本来就覆盖后代），而是将来撤销父级那一条时，
        下级因为自己有行而**不受影响**，一步撤不干净。这是显式勾选换来的确定性，
        不是隐患，但操作者得知道自己换的是什么
      -->
      <el-tree-v2
        ref="treeRef"
        v-bind="treeModeAttrs"
        :data="tree"
        :props="{ label: 'name', children: 'children', value: 'id' }"
        :height="treeHeight"
        :filter-method="matchResourceNode"
        :expand-on-click-node="false"
        @check="onCheck"
        @node-click="onNodeClick"
      >
        <template #default="{ node, data }">
          <!--
            🔴 permission 不能为了省宽度砍掉：本库「角色管理」这一个名字下有 8 个资源，
            名称不是可用的区分位。整行的 title 带完整权限串，截断了也还能靠悬停看清
          -->
          <span class="flex items-center gap-6px overflow-hidden" :title="data.permission">
            <span class="shrink-0 text-13px">{{ node.label }}</span>
            <!--
              类型标记放在 permission **前面**：它是对后面那串编码的分类说明，
              排在其后就变成了「一串编码尾巴上挂着个颜色」，读不出归属。

              🔴 文案与配色一律取 `@/views/system/resource/constants` 那一份，
              与权限资源列表页「类型」列是**同一个表达式**（逐字相同）。
              本库在这套词表上已经有过四份副本各写一遍的代价（见 constants.ts 里
              GRANT_ACTION_OPTIONS 那段注释），资源类型不该再长出第五份。

              ⚠️ shrink-0：类型标签只有两三个字，被压扁之后既读不出颜色也读不出字，
              比让 permission 多截断几个字符更亏 —— 完整权限串本来就在整行的 title 里
            -->
            <el-tag
              v-if="data.type"
              class="shrink-0"
              size="small"
              :type="resourceTypeTagType(data.type) as any"
            >
              {{ formatResourceType(data.type) }}
            </el-tag>
            <span v-if="data.permission" class="min-w-0 flex-1 truncate text-11px text-gray-400">
              {{ data.permission }}
            </span>
            <el-button
              v-if="multiple && data.children?.length"
              class="ml-auto shrink-0"
              link
              size="small"
              type="primary"
              @click.stop="toggleSubtree(data)"
            >
              {{ subtreeActionLabel(data.id) }}
            </el-button>
          </span>
        </template>
      </el-tree-v2>
    </div>
    <div v-if="disabled" class="mt-4px text-11px leading-tight text-gray-400">
      编辑时不可更换资源（换了等于让后端的 upsert 语义静默生成另一条授权行）；
      要换请先删掉这一行再新增。搜索与展开仍然可用，方便确认它长在哪一层。
    </div>
  </div>
</template>
<script lang="ts" setup>
import { useElementSize } from '@vueuse/core'
import { formatResourceType, resourceTypeTagType } from '@/views/system/resource/constants'
import { isSameIdSet, matchResourceNode } from './resourceTree'
import { buildSubtreeIndex, isSubtreeFullyChecked } from './batchGrant'

/**
 * 资源选择器：一棵常驻可见的虚拟化树 + 搜索框。
 *
 * **取代了什么**：单条授权表单原先把 el-tree-v2 塞在 `el-select filterable` 的 `#empty`
 * 槽里（「无匹配选项时显示的内容」），再靠一个 `<el-option>` 单纯为了回显 label，
 * 「显示字段级资源」开关塞在 `#header` 槽里，树只有 280px 高。那是能跑，
 * 但用户得先点开一个下拉才能看见资源，而且下拉一关什么都看不见。
 *
 * **单/多选是同一个组件**：两者的差异全部是属性级（`highlight-current` vs
 * `show-checkbox`）或整块区域级（工具栏的「已选 N / 清空」、行尾的两态按钮），
 * 没有一处是结构级 —— 先例是 FormCreate 下的 OrgPicker。
 * 两条防烂规矩：模式差异只准收进 `treeModeAttrs` 这一个 computed，
 * 模板保持扁平；`v-if="multiple"` 只准包整块区域，不准包属性、不准包半个表达式。
 *
 * **数据层不在这里**：树、id 索引、「显示字段级资源」开关都由父级的
 * useResourceCatalog 持有，本组件只收 `tree` / `includeFieldLevel` 两个 prop。
 * 理由见 useResourceCatalog 的注释（穿过 template ref 的响应性会悄悄断）
 */
defineOptions({ name: 'ResourceTreePicker' })

const props = withDefaults(
  defineProps<{
    /** 单选 = 资源 id；多选 = 资源 id 列表。与 OrgPicker 同口径的联合值契约 */
    modelValue?: number | number[]
    multiple?: boolean
    tree: any[]
    includeFieldLevel?: boolean
    /** 编辑既有一行授权时资源不可更换，见模板里那条提示 */
    disabled?: boolean
  }>(),
  { multiple: false, includeFieldLevel: false, disabled: false }
)

const emit = defineEmits<{
  'update:modelValue': [value: number | number[] | undefined]
  'update:includeFieldLevel': [value: boolean]
}>()

const treeRef = ref()

/**
 * 单选与多选的全部属性差异，收在这一个对象里。
 *
 * 显式标成 Record：vue-tsc 对 `v-bind` 一个联合类型的对象会去逐个分支比对
 * el-tree-v2 的 props，两种形状对不上就报错。这里不需要那种检查 ——
 * 键名写错了 el-tree-v2 会当成普通 attribute 落到根元素上，看得见
 */
const treeModeAttrs = computed<Record<string, any>>(() =>
  props.multiple
    ? { showCheckbox: true, checkStrictly: true }
    : // current-node-key 是响应式 prop（useTree 里 watch 带 immediate），
      // 所以单选回显纯声明式，不需要暴露 setCurrentKey
      { highlightCurrent: true, currentNodeKey: props.modelValue as number | undefined }
)

// -------- 搜索 --------

const filterKeyword = ref('')
let filterTimer: any = null

/**
 * 把过滤词打到树上。
 *
 * 🔴 空串这一支必须紧跟一次 `setExpandedKeys([])`。EP 的 `filter(query)` 是
 * `const keys = doFilter(query); if (keys) expandedKeySet.value = keys`，
 * 而 `doFilter` 对每个命中节点会把它**整条 family 栈**都 `expandKeySet.add` +
 * `expanded = true`；`matchResourceNode('')` 又必须返回 true（它是清掉
 * `hiddenNodeKeySet` 的唯一手段）。两条一叠加：`filter('')` = 把 1086 个节点全展开。
 * 本库 sys_resource（deleted=0）1086 行、depth 1/2/3/4 = 132/113/726/115，
 * 于是「清空搜索框」会当场立起一面 1086 行的墙。
 *
 * 顺序也是承重的：`hiddenNodeKeySet` 只在 `doFilter` 里 `clear()`，
 * `setExpandedKeys` 不碰它，所以清搜索没有别的办法，只能先 filter 再把展开度收回来。
 * 收完只剩 132 个根节点，虚拟化下约 23 行可见
 */
const applyFilter = (keyword: string) => {
  treeRef.value?.filter(keyword)
  if (!keyword) {
    treeRef.value?.setExpandedKeys([])
  }
}

// 150ms 防抖：不防抖每敲一个字符都触发一次全树重算
const onFilterInput = (value: string) => {
  if (filterTimer) clearTimeout(filterTimer)
  // 清空（含点 clearable 那个叉：EP 的 clear() 也会 emit input）不走防抖，
  // 立刻收树 —— 慢 150ms 才收起一面墙，观感上就是「点没反应」
  if (!value) {
    applyFilter('')
    return
  }
  filterTimer = setTimeout(() => applyFilter(value), 150)
}

const onIncludeFieldLevelChange = (value: any) => {
  emit('update:includeFieldLevel', !!value)
}

// -------- 测高 --------

const hostRef = ref<HTMLElement>()
const { height } = useElementSize(hostRef)
/**
 * 只接受非零值。抽屉关掉之后外层 display:none，ResizeObserver 会报 0×0；
 * 直接用它的话下次打开时树先缩成 160px 的一条，等布局稳定了再弹回来
 */
const lastHeight = ref(0)
watch(height, (h) => {
  if (h > 0) lastHeight.value = h
})
/** el-tree-v2 的 height 是 Number（像素）而不是 CSS 字符串，必须喂它一个量出来的数字 */
const treeHeight = computed(() => Math.max(160, Math.floor(lastHeight.value)))

// -------- 勾选态（多选） --------

const checkedIds = computed(() =>
  props.multiple && Array.isArray(props.modelValue) ? props.modelValue : []
)
const checkedSet = computed(() => new Set(checkedIds.value))
const subtreeIndex = computed(() => buildSubtreeIndex(props.tree))

/** 上一次写进树的那份勾选态。用**副本**存，免得与父级的数组共享引用 */
const lastSynced = ref<number[]>([])

/**
 * 唯一一处「往树里写勾选态」的地方。
 *
 * 分工写清楚，否则「谁负责写树」会含糊：**用户手点**勾选框时树自己就是权威，
 * 只报值给父级、并把这份记进 lastSynced 让下面那个 watch 跳过（见 onCheck）；
 * **程序改值**时（全选下级、清空、父级过滤）必须由这里显式写一次树。
 * 两条路都会更新 lastSynced，所以 watch 永远只在「值真的从外面变了」时才动手
 */
const writeChecked = (ids: number[]) => {
  lastSynced.value = ids.slice()
  // setCheckedKeys 不会触发 @check，所以要自己把外部值与树的勾选态一起写
  nextTick(() => treeRef.value?.setCheckedKeys(ids))
}

/**
 * 外部值 → 树的勾选态。
 *
 * ⚠️ isSameIdSet 那道守卫不是性能优化，是行为正确性：
 * `setCheckedKeys` 内部先 `clear()` 再在 nextTick 里重设，每次用户手点都来一遍
 * 等于让勾选框闪一下，还会吃掉正在进行的连点
 */
watch(
  () => props.modelValue,
  (val) => {
    if (!props.multiple) return
    const next = Array.isArray(val) ? val : []
    if (isSameIdSet(next, lastSynced.value)) return
    writeChecked(next)
  },
  { immediate: true }
)

/**
 * 行尾按钮的文案。括号里的数量**含自身**，且与 toggleSubtree 取自同一份索引 ——
 * 「按钮上写的数」和「点下去实际勾中的数」必须是同一个数，否则这个数字就是在骗人。
 *
 * `!` 是安全的：按钮只渲染在有下级的行上，而索引覆盖了树里的每一个节点
 */
const subtreeActionLabel = (id: number) => {
  const ids = subtreeIndex.value.get(id)!
  const label = isSubtreeFullyChecked(ids, checkedSet.value) ? '取消下级' : '全选下级'
  return `${label}（${ids.length}）`
}

/**
 * 整片勾选 / 整片取消，一个函数两个方向。
 *
 * 只有「选」没有「取消」时，用户想撤掉一片只能一个个点回去，或者点「清空」把**全部**
 * 已选项一起炸掉 —— 勾了几十个资源之后，后者基本等于放弃这次操作重来。
 *
 * ⚠️ check-strictly 下 setCheckedKeys **不会级联**（useCheck 里 toggle 的递归被
 * `!props.checkStrictly` 挡着），必须传完整的显式 id 列表 ——
 * 这正是 buildSubtreeIndex 那份索引存在的理由
 */
const toggleSubtree = (data: any) => {
  if (props.disabled) return
  const ids = subtreeIndex.value.get(data.id)!
  let next: number[]
  if (isSubtreeFullyChecked(ids, checkedSet.value)) {
    const drop = new Set(ids)
    next = checkedIds.value.filter((id) => !drop.has(id))
  } else {
    // 并集语义：部分勾选时点「全选下级」只把缺的补上，不翻掉已经勾好的那些
    next = [...new Set([...checkedIds.value, ...ids])]
  }
  emit('update:modelValue', next)
  writeChecked(next)
}

const clearChecked = () => {
  if (props.disabled) return
  emit('update:modelValue', [])
  writeChecked([])
}

// -------- 选中（单选） --------

const onCheck = (_data: any, checkedInfo: { checkedKeys: (string | number)[] }) => {
  if (!props.multiple || props.disabled) return
  // el-tree-v2 的 CheckedInfo.checkedKeys 是 TreeKey[]（string | number），
  // 而这里的节点 key 恒为资源 id（:props 里 value: 'id'），统一收成 number 再往下传
  const next = checkedInfo.checkedKeys.map(Number)
  // 树已经是权威状态了，只把它记成「已同步」，让 modelValue 那个 watch 跳过回写
  lastSynced.value = next
  emit('update:modelValue', next)
}

/**
 * 单选的选中入口。
 *
 * ⚠️ 本组件**只在用户操作时** emit `update:modelValue`：回显走 `current-node-key`
 * 那个响应式 prop，不经过事件。父级因此可以放心把「选中后要不要连带重置其它字段」
 * 挂在这个事件上 —— 编辑一行既有授权时不会被回显触发一次静默改值
 */
const onNodeClick = (data: any) => {
  // 🔴 多选下 checkOnClickLeaf 默认为 true，点叶子行的文字会**同时**触发 check 与
  // node-click。选中值由 onCheck 报，这里必须 return，
  // 否则同一次点击会发两次 update:modelValue（第二次还把值发成单个 id）
  if (props.multiple || props.disabled) return
  emit('update:modelValue', data.id)
}

// -------- 对外暴露的三个动作 --------

/**
 * 回到「刚打开」的样子：搜索词清空、树收到根级、多选下勾选清空。
 *
 * ⚠️ 单选下**不动选中值** —— modelValue 是父级的，父级在调 reset() 之前刚设好，
 * 这里再去 emit 一个 undefined 会把回显擦掉。
 * 抽屉不加 destroy-on-close（见 useResourceCatalog 的注释），
 * 于是搜索词、EP 内部的 hiddenNodeKeySet / expandedKeySet / 勾选 Set
 * 全都跨开关存活，必须在 open() 里显式收一次
 */
const reset = () => {
  if (filterTimer) clearTimeout(filterTimer)
  filterKeyword.value = ''
  applyFilter('')
  if (props.multiple) {
    writeChecked([])
  }
}

/**
 * 展开到某个资源并滚到可见处，用于编辑既有授权行时的回显。
 *
 * 顺序承重：`scrollToNode` 内部是 `flattenTree.indexOf(node)`，
 * 而 flattenTree 只包含**已展开**的节点 —— 祖先没收开就滚不过去。
 * `setExpandedKeys([id])` 会沿 node.parent 展开整条祖先链、同时收掉其它所有节点，
 * 正好是「只露出这一条路径」的语义
 *
 * getNode 那道判空不是防御性冗余：`setExpandedKeys` 内部读
 * `tree.value.treeNodeMap` 没有可选链，id 不在当前树里（字段级开关没开、
 * 或那行资源已被删）就是当场抛 TypeError
 */
const reveal = async (id: number) => {
  await nextTick()
  // 不叫 tree：那个名字是 prop（`:data="tree"`），在这里再声明一个同名的局部变量
  // 只是给读者添一次「这到底是哪个 tree」的停顿
  const instance = treeRef.value
  if (!instance?.getNode(id)) return
  instance.setExpandedKeys([id])
  await nextTick()
  instance.scrollToNode(id)
}

/**
 * 数据源被换掉时（父级切「显示字段级资源」），把**与 DOM 耦合的那几份状态**重新对齐一次。
 *
 * 这件事归本组件管而不是让父级喊一嗓子，是因为「换了数据源要修什么」完全是内部知识：
 *
 * 1. **过滤态**。EP 的 `hiddenNodeKeySet` 只在 `doFilter` 里 clear，`setData` 不碰它，
 *    于是新树会带着按旧树算出来的隐藏集渲染。重新打一次当前关键词即可
 *    （关键词留着不清：用户搜着词切视野，把搜索框清空是抢他的输入）。
 * 2. 🔴 **勾选态**。`useCheck` 里那条
 *    `watch([tree, defaultCheckedKeys]) → nextTick(() => _setCheckedKeys(defaultCheckedKeys))`
 *    被 `keys?.length > 0` 挡着 —— **换数据源时 EP 只让 `getCheckedKeys()` 的出口
 *    过滤掉消失的 key，从不清内部那个 checkedKeys Set**。于是「一个 id 都没掉」
 *    这个最常见分支下，外部值与 lastSynced 完全相同、modelValue 那个 watch 会跳过回写，
 *    而树的内部 Set 已经和外部值对不上了。别指望那个「出口过滤」，它只是碰巧看起来对
 */
watch(
  () => props.tree,
  async () => {
    await nextTick()
    applyFilter(filterKeyword.value)
    if (props.multiple) {
      writeChecked(checkedIds.value)
    }
  }
)

defineExpose({ reset, reveal })
</script>
