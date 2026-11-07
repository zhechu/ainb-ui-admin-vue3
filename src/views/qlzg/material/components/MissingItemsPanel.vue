<template>
  <div
    class="border border-solid rounded-6px"
    :class="
      complete
        ? 'border-[var(--el-color-success-light-5)]'
        : 'border-[var(--el-color-warning-light-5)]'
    "
  >
    <div
      class="flex items-center justify-between px-12px py-8px cursor-pointer select-none"
      data-testid="missing-toggle"
      @click="expanded = !expanded"
    >
      <div class="flex items-center gap-8px">
        <Icon
          :icon="complete ? 'ep:circle-check' : 'ep:warning'"
          :size="16"
          :color="complete ? 'var(--el-color-success)' : 'var(--el-color-warning)'"
        />
        <!-- 🔴 标题是一句**固定的话**，三个数字都来自服务端，不在前端重算。
             写成「缺 N 项」这种省略式看着更清爽，但评估师要的是能直接念给委托方听的一句：
             应有几项、到了几项、还差几项 —— 少了前两个数字，「缺 9 项」就没有分母。 -->
        <span class="text-14px font-600" data-testid="missing-title">
          应有 {{ missing?.requiredItemCount ?? 0 }} 项、已到
          {{ missing?.arrivedItemCount ?? 0 }} 项、缺 {{ missing?.missingItems?.length ?? 0 }} 项
        </span>
        <el-tag v-if="complete" type="success" size="small">齐备</el-tag>
      </div>
      <div class="flex items-center gap-6px">
        <span v-if="missing" class="text-12px text-[var(--el-text-color-secondary)]">
          {{ missing.statutory ? '法定评估业务' : '非法定评估业务' }}
        </span>
        <Icon :icon="expanded ? 'ep:arrow-up' : 'ep:arrow-down'" :size="14" />
      </div>
    </div>

    <div v-if="expanded" v-loading="loading" class="px-12px pb-10px">
      <template v-if="missing && !complete">
        <div
          v-for="item in missing.missingItems"
          :key="item.itemCode"
          class="py-6px border-t border-t-solid border-t-[var(--el-border-color-lighter)]"
        >
          <div class="flex items-center justify-between">
            <span class="text-13px">{{ item.name }}</span>
            <span class="text-12px text-[var(--el-text-color-secondary)]">
              应有 {{ item.requiredCount }} 份 · 已到 {{ item.presentCount }} 份 ·
              <span class="text-[var(--el-color-danger)] font-500"
                >缺 {{ item.missingCount }} 份</span
              >
            </span>
          </div>
          <!-- 🔴 法规依据**必须显示**，不是「详情里再看看」：
               评估师要靠它判断「该补、还是披露一下就能出报告」，
               只给一个「缺 2 份」的数字等于把判断依据藏起来了。 -->
          <div v-if="item.lawBasis" class="mt-2px text-12px text-[var(--el-text-color-secondary)]">
            依据：{{ item.lawBasis }}
          </div>
        </div>
      </template>
      <div
        v-else-if="missing && complete"
        class="py-6px text-13px text-[var(--el-text-color-secondary)] border-t border-t-solid border-t-[var(--el-border-color-lighter)]"
      >
        该品类的必备资料清单已全部到齐。
      </div>
      <div
        v-else
        class="py-6px text-13px text-[var(--el-text-color-secondary)] border-t border-t-solid border-t-[var(--el-border-color-lighter)]"
      >
        这个项目还没有确定评估品类，所以算不出应有哪几项资料。
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import type { QlzgMaterialMissingVO } from '@/api/qlzg/material'

/**
 * 缺件面板（R17）
 *
 * 🔴 三个数字全部读服务端给的，**一个都不在前端重算**。尤其是 `arrivedItemCount`：
 *    它等于 `requiredItemCount − 缺件数`，看着可以推出来，但「缺件」的判据是
 *    `minCount`（最少份数）而不是「有没有这一项」—— 传了 2 张、要求 4 张仍然是缺件。
 *    前端按项数一减就会把「已到」算多，而算多不报错，
 *    报告交出去之后才被客户发现少了一份材料。
 *
 * 🔴 这个结果**不要缓存**（父组件每次打开面板都重新拉）：
 *    缺件是「清单应有的项码 − 资料行已覆盖的项码」这个集合差，查询期计算的，
 *    库里刻意不存 is_required / missing_flag 两列 —— 存下来的缺件状态会与资料行漂移。
 *
 * ⚠️ `missingItems` 为空 = **齐备**，不是「还没查」。查不到清单（项目没定品类）时
 *    整个 `missing` 是 null，那是第三种情况，文案不能混。
 */
defineOptions({ name: 'QlzgMissingItemsPanel' })

const props = defineProps<{
  missing?: QlzgMaterialMissingVO | null
  loading?: boolean
}>()

const expanded = ref(true)

const complete = computed(
  () => props.missing != null && (props.missing.missingItems?.length ?? 0) === 0
)
</script>
