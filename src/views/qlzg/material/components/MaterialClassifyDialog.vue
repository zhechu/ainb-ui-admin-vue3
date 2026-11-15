<template>
  <el-dialog
    :model-value="modelValue"
    title="归类"
    width="900px"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    append-to-body
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <div class="flex gap-16px">
      <!-- ==================== 左：文件列表（可多选） ==================== -->
      <div class="flex-1 min-w-0">
        <div class="mb-8px text-13px">
          已选 <b>{{ selected.length }}</b> 份
          <span v-if="selected.length === 0" class="text-[var(--el-text-color-secondary)]">
            —— 先在左边勾上要归到一起的那些，再点右边的类别
          </span>
        </div>
        <el-table
          ref="tableRef"
          :data="materials"
          row-key="id"
          height="420"
          size="small"
          @selection-change="(rows: QlzgMaterialVO[]) => (selected = rows)"
        >
          <el-table-column type="selection" width="45" reserve-selection />
          <el-table-column label="文件名" prop="fileName" min-width="180" show-overflow-tooltip />
          <el-table-column label="当前类别" width="110">
            <template #default="{ row }">
              <span v-if="row.category">{{
                row.categoryDescription || labelOf(MATERIAL_CATEGORY_OPTIONS, row.category)
              }}</span>
              <span v-else class="text-[var(--el-text-color-placeholder)]">未归类</span>
            </template>
          </el-table-column>
          <el-table-column label="清单项" width="130" show-overflow-tooltip>
            <template #default="{ row }">
              <span v-if="row.checklistItemCode">{{
                row.checklistItemName || row.checklistItemCode
              }}</span>
              <span v-else class="text-[var(--el-text-color-placeholder)]">—</span>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <!-- ==================== 右：类别按钮 + 清单项 ==================== -->
      <div class="w-260px flex-none">
        <div class="mb-8px text-13px font-600">归到哪一类</div>
        <!-- 🔴 一次归一类：点一下按钮就归完，**不做成「选类别 + 点确定」两步**。
             选中 20 张查勘照片 → 点「查勘」→ 完成，这是 §11.1.3 明确要求的形状；
             逐个下拉是最坏的那种（20 份就是 20 次点击 + 20 次请求）。 -->
        <div class="grid grid-cols-2 gap-8px">
          <el-button
            v-for="option in MATERIAL_CATEGORY_OPTIONS"
            :key="option.value"
            :disabled="selected.length === 0 || itemSubmitting"
            :loading="submitting === option.value"
            :data-testid="`classify-${option.value}`"
            @click="onClassify(option.value)"
          >
            {{ option.label }}
          </el-button>
        </div>

        <div class="mt-16px mb-8px text-13px font-600">对应清单上的哪一项（可不选）</div>
        <!-- 🔴 改一下就**立刻写库**，不是「存起来等下一次点类别」：
             这个下拉原先只是点类别时顺带捎上的一个参数，于是「先点了类别、再改清单项」
             这条路径上它一个请求都不发（实测 2026-11-08，PUT 一条没有），
             关掉弹窗后列表那一列还是「—」—— 用户读到的正是「设了没用」。
             它**没有**变成「选清单项 + 点确定」的两步：改下拉这一下本身就是动作，
             与上面八个类别按钮同一个口径。 -->
        <el-select
          v-model="checklistItemCode"
          clearable
          placeholder="不占任何清单项"
          class="!w-260px"
          :disabled="!!submitting || selected.length === 0"
          :loading="itemSubmitting"
          data-testid="classify-checklist-item"
          @change="onChecklistItemChange"
        >
          <el-option
            v-for="item in checklist"
            :key="item.itemCode"
            :label="item.name"
            :value="item.itemCode"
          >
            <span>{{ item.name }}</span>
            <span
              v-if="item.lawBasis"
              class="float-right text-12px text-[var(--el-text-color-secondary)]"
            >
              {{ item.lawBasis }}
            </span>
          </el-option>
        </el-select>
        <div class="mt-4px text-12px text-[var(--el-text-color-secondary)]">
          选中的
          {{
            selected.length
          }}
          份会全部归到<b>同一项</b>。改这个下拉会<b>立刻写库</b>（类别保持不变），不同项的资料请分几次归。
        </div>
        <div
          v-if="unclassifiedCount > 0"
          class="mt-4px text-12px text-[var(--el-text-color-secondary)]"
        >
          其中 {{ unclassifiedCount }} 份还没归过类，它们的清单项等你点上面的类别时一起写入。
        </div>
        <div v-if="mixedItem" class="mt-4px text-12px text-[var(--el-color-warning)]">
          这几份现在的清单项不一致：点类别会把它们统一成上面选的那一项（留空 = 都不占）。
        </div>

        <el-alert
          v-if="result"
          :title="result"
          :type="resultType"
          :closable="false"
          show-icon
          class="mt-16px"
        />
      </div>
    </div>

    <template #footer>
      <el-button @click="emit('update:modelValue', false)">关闭</el-button>
    </template>
  </el-dialog>
</template>

<script lang="ts" setup>
import { QlzgMaterialApi, type QlzgMaterialVO } from '@/api/qlzg/material'
import { QlzgCategoryApi, type QlzgMaterialChecklistItem } from '@/api/qlzg/category'
import { labelOf, MATERIAL_CATEGORY_OPTIONS } from '../../constants'

/**
 * 人工归类（M0 阶段唯一的归类方式）
 *
 * <h3>🔴 类别的初值是**空**，而且刻意不做「先猜一个再让人改」</h3>
 * 按文件名猜（含「合同」就选委托、含「照片」就选查勘）看着省事，实际是把一次
 * **可见的空白**换成一次**不可见的错**：空白在缺件面板上是看得见的缺口，
 * 错类会让缺件检测以为这一项已经齐了 —— 报告交出去之后才被客户发现少了一份材料。
 * 所以右边那八个按钮没有一个是被预选中的。
 *
 * <h3>🔴 后端返回的是**实际更新行数**，不是 boolean</h3>
 * 它可能小于 `ids.length`（跨租户的行、已被删除的行会被静默跳过）。
 * 只报「归类成功」会让用户以为选中的 8 份都归好了，而其中 2 份没动 ——
 * 那 2 份仍然是未归类，缺件面板上仍然是缺的，而用户已经不会再回来看了。
 * 所以差额必须说出来。
 *
 * <h3>🔴 类别与清单项是**两个各自独立的动作**，不是一个表单的两个字段</h3>
 * 两边都是「点一下就写库」：类别是八个按钮，清单项是下拉的 `@change`。
 * 曾经清单项只是点类别时顺带捎上的一个参数，于是「先点了类别、再改清单项」这条路径上
 * 它一个请求都不发（实测 2026-11-08），而界面上没有任何地方说它没发 ——
 * 用户读到的是「归类按钮点了、清单项也设了，没效果」。
 * ⚠️ 这不是把弹窗改成「选清单项 + 点确定」的两步（那是 §11.1.3 明确否掉的形状，
 *    见类别按钮上方那段注释）：改下拉这一下**本身**就是动作，没有确定按钮。
 */
defineOptions({ name: 'QlzgMaterialClassifyDialog' })

const props = defineProps<{
  modelValue: boolean
  /** 候选资料行（父组件把当前页 + 已选中的那些传进来） */
  materials: QlzgMaterialVO[]
  /** 项目的评估品类码，用来取必备资料清单；为空时清单项下拉是空的 */
  categoryCode?: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', visible: boolean): void
  /** 归类成功 —— 父组件据此刷新列表与缺件面板 */
  (e: 'classified'): void
}>()

const tableRef = ref()
const selected = ref<QlzgMaterialVO[]>([])
const checklist = ref<QlzgMaterialChecklistItem[]>([])
const checklistItemCode = ref('')
const submitting = ref('')
const itemSubmitting = ref(false)
const result = ref('')
const resultType = ref<'success' | 'warning'>('success')

/**
 * 选中行里**已经归过类**的那些 —— 「改清单项」这一下能写进去的就是它们
 *
 * `classify` 的 `category` 是必填的，未归类的行没有类别可填，发不出去。
 */
const classifiedRows = computed(() => selected.value.filter((row) => !!row.category))
const unclassifiedCount = computed(() => selected.value.length - classifiedRows.value.length)

/**
 * 候选行当前的清单项是否**不一致**
 *
 * 不一致时点类别会把它们统一成下拉里那一项（留空就是统一清掉），而这一下是不可逆的，
 * 所以必须**提前**说出来 —— 写完再报「归类成功」的话，用户看不到自己刚刚抹掉了什么。
 */
const mixedItem = computed(() => {
  if (props.materials.length < 2) {
    return false
  }
  const first = props.materials[0].checklistItemCode ?? ''
  return props.materials.some((row) => (row.checklistItemCode ?? '') !== first)
})

const itemNameOf = (code: string) =>
  checklist.value.find((item) => item.itemCode === code)?.name || code

/**
 * 🔴 **每次打开都重算**清单项下拉的初值，不能只靠品类码那个 watcher
 *
 * <h3>不重算 ⟹ 上一份资料的选择会漏到下一份</h3>
 * 品类码在同一个项目的两份资料之间是**不变的**，所以那个 watcher 压根不触发。
 * 实测 2026-11-08：给 id=28 选了「不动产权证」，关掉再给 id=29 打开、点「其他」，
 * 发出去的是 {@code {ids:[29], category:"OTHER", checklistItemCode:"OWNERSHIP_CERT"}} ——
 * 一份土地出让合同变成了「类别=其他 / 清单项=不动产权证」，全程 200 无异常，
 * 而缺件检测看的是清单项，于是它认为「不动产权证」这一项已经齐了。
 *
 * <h3>不回填 ⟹ 点类别会静默清掉存着的清单项</h3>
 * 一份已经是「委托 / 评估委托合同」的资料，重开弹窗时右边显示「不占任何清单项」，
 * 而后端 {@code classifyMaterials} 写的是
 * {@code StrUtil.trimToNull(reqVO.getChecklistItemCode())} —— **整列覆盖**，
 * 留空就是写 SQL NULL。这时点任何一个类别都会把存着的清单项抹掉，界面上还报「归类成功」。
 *
 * <p>所以初值只有一个正确来源：候选行自己现在存的那一份。全都一样就填上，
 * 不一样就留空（留空由 {@link mixedItem} 那行黄字提前说明后果）。
 */
const prefillChecklistItem = () => {
  const codes = new Set(props.materials.map((row) => row.checklistItemCode ?? ''))
  checklistItemCode.value = codes.size === 1 ? [...codes][0] : ''
  dropStaleChecklistItem()
}

/**
 * 下拉里那个码已经不在当前品类的清单里时，把它摘掉
 *
 * 🔴 不摘的后果不是「显示成一个裸编码」，而是**点类别直接失败**：
 *    后端 {@code validateChecklistItemCode} 按项目品类的清单校验，不认就抛
 *    {@code MATERIAL_CHECKLIST_ITEM_UNKNOWN}。而品类 schema 改过之后，
 *    库里留着的正是这种历史码（{@code QlzgMaterialVO.checklistItemName} 的注释写明
 *    它会退回编码本身）。用户点的是「权属」，收到的报错却在讲清单项 —— 而他没碰清单项。
 * ⚠️ 清单**为空**时不判：那时候任何码都「不在清单里」，判了等于每次打开都清成空。
 *    清单取不到（{@code getCategory} 抛了）同样是空，同样放行 —— 归类不该被它阻断。
 * 🔴 这两个函数刻意定义在**两个 watcher 之前**：品类码那个是 {@code immediate: true}，
 *    注册当刻就会跑一遍并调到 {@code dropStaleChecklistItem}。它现在能跑通只是因为
 *    中间夹了一个 {@code await}（于是调用被推到 setup 结束之后的微任务里），
 *    而「靠一个 await 躲过 TDZ」正是那种改一行就炸、且炸在打开弹窗那一刻的写法。
 */
const dropStaleChecklistItem = () => {
  const code = checklistItemCode.value
  if (!code || checklist.value.length === 0) {
    return
  }
  if (checklist.value.some((item) => item.itemCode === code)) {
    return
  }
  checklistItemCode.value = ''
  resultType.value = 'warning'
  result.value =
    `这份资料原先记的清单项「${code}」已不在当前品类的清单里，` +
    '这里按「不占任何清单项」处理；点类别不会把它写回去'
}

/**
 * 品类详情按 **categoryCode** 取，不是 id；清单是缺件检测的依据，也是这里下拉的来源
 */
watch(
  () => props.categoryCode,
  async (code) => {
    checklist.value = []
    checklistItemCode.value = ''
    if (!code) {
      return
    }
    try {
      const detail = await QlzgCategoryApi.getCategory(code)
      checklist.value = detail.materialChecklist ?? []
    } catch {
      // 取不到清单不阻断归类：`checklistItemCode` 留空是合法的（不占任何清单项）
    }
    // 🔴 清单加载完再校一次：`prefillChecklistItem` 可能在它之前就填了个历史码
    dropStaleChecklistItem()
  },
  { immediate: true }
)

watch(
  () => props.modelValue,
  (visible) => {
    if (!visible) {
      return
    }
    result.value = ''
    prefillChecklistItem()
    // 🔴 打开时把传进来的每一行都勾上，并且**先清空**上一次的勾选
    //    （`reserve-selection` 会把选择跨开关保留下来）：
    //    父组件是按「已经选好了这几行」开的这个弹窗，左边显示成一片未勾选的话，
    //    用户会以为刚才在表格里那几下点击没生效，于是再勾一遍 —— 而这时勾的
    //    可能不是同一批行，归错类是不报错的
    nextTick(() => {
      tableRef.value?.clearSelection()
      props.materials.forEach((row) => tableRef.value?.toggleRowSelection(row, true))
    })
  }
)

/**
 * 🔴 本地也改一份：父组件刷新回来之前，左边那一列要立刻对得上，
 *    否则用户看着「当前类别 / 清单项」还是旧值，会以为刚才那一下没生效而再点一次
 */
const applyLocal = (rows: QlzgMaterialVO[], patch: Partial<QlzgMaterialVO>) => {
  rows.forEach((row) => {
    const target = props.materials.find((item) => item.id === row.id)
    if (target) {
      Object.assign(target, patch)
    }
  })
}

/**
 * 改清单项 —— 🔴 **这一下就写库**，不等下一次点类别
 *
 * 类别与清单项是两个维度，而 {@code classify} 是唯一能写清单项的端点、
 * 它的 {@code category} 又是必填。所以这里按选中行**现有的类别**分组、逐组发一次：
 * 组内类别原样回填、只有清单项被改写，这正是「我只想改清单项」的语义。
 *
 * ⚠️ 还没归过类的行发不出去（没有 category 可填），它们的值留在下拉里等点类别时一起写 ——
 *    这一支**必须**在界面上说出来（{@link unclassifiedCount} 那行小字 + 这里的提示），
 *    否则又变成一次「设了没用」。
 * ⚠️ 副作用与点类别完全相同：{@code classify_source} 置 MANUAL、{@code classify_confidence}
 *    置 SQL NULL。对一份机器归过类的资料只改清单项也会抹掉那个置信度 —— 这是后端口径，
 *    而抹掉是对的：这一行从此是人工定的，留着机器置信度反而说不清谁判的。
 * ⚠️ 用 el-select 的 {@code @change} 而不是 watch 这个 ref：`prefillChecklistItem`
 *    与 `dropStaleChecklistItem` 都会程序化地写它，watch 会把「打开弹窗回填」
 *    当成「用户改了一下」而立刻发一批 PUT。
 */
const onChecklistItemChange = async (value: string) => {
  const rows = classifiedRows.value
  if (rows.length === 0) {
    resultType.value = 'success'
    result.value =
      unclassifiedCount.value > 0
        ? `选中的 ${unclassifiedCount.value} 份还没归过类，清单项会在你点上面的类别时一起写入`
        : ''
    return
  }
  const groups = new Map<string, number[]>()
  rows.forEach((row) => {
    if (!row.category) {
      return
    }
    const ids = groups.get(row.category) ?? []
    ids.push(row.id)
    groups.set(row.category, ids)
  })
  itemSubmitting.value = true
  try {
    let updated = 0
    for (const [category, ids] of groups) {
      updated += await QlzgMaterialApi.classify({
        ids,
        category,
        checklistItemCode: value || undefined
      })
    }
    const what = value ? `改成「${itemNameOf(value)}」` : '清空'
    resultType.value = updated < rows.length ? 'warning' : 'success'
    result.value =
      `已把 ${updated} 份的清单项${what}（类别保持不变）` +
      (updated < rows.length ? `。选中 ${rows.length} 份，差额那几份不属于本项目或已被删除` : '') +
      (unclassifiedCount.value > 0
        ? `。另外 ${unclassifiedCount.value} 份还没归过类，等你点类别时一起写入`
        : '')
    applyLocal(rows, {
      checklistItemCode: value || null,
      checklistItemName: value ? itemNameOf(value) : null
    })
    emit('classified')
  } finally {
    itemSubmitting.value = false
  }
}

const onClassify = async (category: string) => {
  const ids = selected.value.map((row) => row.id)
  if (ids.length === 0) {
    return
  }
  submitting.value = category
  try {
    const updated = await QlzgMaterialApi.classify({
      ids,
      category,
      checklistItemCode: checklistItemCode.value || undefined
    })
    const label = labelOf(MATERIAL_CATEGORY_OPTIONS, category)
    // 🔴 清单项也一起说出来：它是**整列覆盖**，留空那一下会抹掉原来存的值，
    //    只报「已归到某类」的话用户看不出清单项发生了什么
    const itemText = checklistItemCode.value
      ? `，清单项「${itemNameOf(checklistItemCode.value)}」`
      : ''
    if (updated < ids.length) {
      resultType.value = 'warning'
      result.value =
        `选中 ${ids.length} 份，实际归类 ${updated} 份${itemText}。` +
        '差额那几份不属于本项目或已被删除，它们仍然是未归类'
    } else {
      resultType.value = 'success'
      result.value = `已把 ${updated} 份归到「${label}」${itemText}`
    }
    applyLocal(selected.value, {
      category,
      categoryDescription: label,
      checklistItemCode: checklistItemCode.value || null,
      checklistItemName: checklistItemCode.value ? itemNameOf(checklistItemCode.value) : null
    })
    emit('classified')
  } finally {
    submitting.value = ''
  }
}
</script>
