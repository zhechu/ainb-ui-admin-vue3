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

      <!-- ==================== 右：类别按钮 ==================== -->
      <div class="w-260px flex-none">
        <div class="mb-8px text-13px font-600">归到哪一类</div>
        <!-- 🔴 一次归一类：点一下按钮就归完，**不做成「选类别 + 点确定」两步**。
             选中 20 张查勘照片 → 点「查勘」→ 完成，这是 §11.1.3 明确要求的形状；
             逐个下拉是最坏的那种（20 份就是 20 次点击 + 20 次请求）。 -->
        <div class="grid grid-cols-2 gap-8px">
          <el-button
            v-for="option in MATERIAL_CATEGORY_OPTIONS"
            :key="option.value"
            :disabled="selected.length === 0"
            :loading="submitting === option.value"
            :data-testid="`classify-${option.value}`"
            @click="onClassify(option.value)"
          >
            {{ option.label }}
          </el-button>
        </div>

        <div class="mt-16px mb-8px text-13px font-600">对应清单上的哪一项（可不选）</div>
        <el-select
          v-model="checklistItemCode"
          clearable
          placeholder="不占任何清单项"
          class="!w-260px"
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
          选中的 {{ selected.length }} 份会全部归到<b>同一项</b>。不同项的资料请分几次归。
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
const result = ref('')
const resultType = ref<'success' | 'warning'>('success')

/** 品类详情按 **categoryCode** 取，不是 id；清单是缺件检测的依据，也是这里下拉的来源 */
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
    if (updated < ids.length) {
      resultType.value = 'warning'
      result.value =
        `选中 ${ids.length} 份，实际归类 ${updated} 份。` +
        '差额那几份不属于本项目或已被删除，它们仍然是未归类'
    } else {
      resultType.value = 'success'
      result.value = `已把 ${updated} 份归到「${label}」`
    }
    // 🔴 本地也改一份：父组件刷新回来之前，左边那一列要立刻对得上，
    //    否则用户看着「当前类别」还是未归类，会以为刚才那一下没生效而再点一次
    const categoryDescription = label
    selected.value.forEach((row) => {
      const target = props.materials.find((item) => item.id === row.id)
      if (target) {
        target.category = category
        target.categoryDescription = categoryDescription
        target.checklistItemCode = checklistItemCode.value || null
      }
    })
    emit('classified')
  } finally {
    submitting.value = ''
  }
}
</script>
