<template>
  <div class="h-full flex flex-col">
    <div
      class="flex-none px-12px py-10px text-14px font-600 border-b border-b-solid border-b-[var(--el-border-color-lighter)]"
    >
      上传批次
    </div>
    <div v-loading="loading" class="flex-1 overflow-y-auto">
      <!-- 「全部」这一项刻意放在批次列表之外、且不参与编号：它是「不按批次过滤」，不是一批 -->
      <div
        class="px-12px py-8px cursor-pointer border-b border-b-solid border-b-[var(--el-border-color-lighter)]"
        :class="rowClass(modelValue === '')"
        data-testid="batch-all"
        @click="emit('update:modelValue', '')"
      >
        <div class="text-13px">全部批次</div>
      </div>

      <div
        v-for="(batch, index) in batches"
        :key="batch.uploadBatchNo"
        class="px-12px py-8px cursor-pointer border-b border-b-solid border-b-[var(--el-border-color-lighter)]"
        :class="rowClass(modelValue === batch.uploadBatchNo)"
        :data-testid="`batch-${index}`"
        @click="emit('update:modelValue', batch.uploadBatchNo)"
      >
        <div class="flex items-center justify-between">
          <span class="text-13px font-500">第 {{ index + 1 }} 批</span>
          <!-- 🔴 未归类份数 >0 时高亮：M0 阶段归类只能人工做，而「传上来了但没归类」的资料
               不进缺件统计、也不进披露清单，是最容易被忘掉的一批 -->
          <el-tag v-if="batch.unclassifiedCount > 0" type="warning" size="small">
            未归类 {{ batch.unclassifiedCount }}
          </el-tag>
        </div>
        <div class="mt-2px text-12px text-[var(--el-text-color-secondary)]">
          {{ formatDate(batch.firstCreateTime, 'YYYY-MM-DD HH:mm') }}
        </div>
        <div class="mt-2px text-12px text-[var(--el-text-color-secondary)]">
          {{ batch.fileCount }} 份 · {{ formatFileSize(batch.totalSize ?? 0) }}
          <template v-if="batch.uploaderClientType">
            · {{ uploaderClientTypeLabel(batch.uploaderClientType) }}
          </template>
        </div>
        <!-- 批次号是服务端发的、跨端排查时唯一能对上号的东西，所以显示出来而不是藏进 tooltip -->
        <div class="mt-2px text-11px text-[var(--el-text-color-placeholder)] break-all">
          {{ batch.uploadBatchNo }}
        </div>
      </div>

      <el-empty
        v-if="!loading && batches.length === 0"
        description="还没收到资料"
        :image-size="60"
      />
    </div>
  </div>
</template>

<script lang="ts" setup>
import type { QlzgMaterialBatchVO } from '@/api/qlzg/material'
import { formatDate } from '@/utils/formatTime'
import { formatFileSize } from '@/utils/file'
import { uploaderClientTypeLabel } from '../../constants'

/**
 * 上传批次时间线（资料面板左侧那一列）
 *
 * 🔴 批次不是表，是**资料行按 `upload_batch_no` 分组算出来的视图**。两个后果：
 *    ① 「白烧掉」的批次号（prepare 了但 0 份 confirm）在这里**不可见** —— 这是对的，
 *       时间线是「收到了哪些东西」的记录，不是「发过哪些号」的记录；
 *    ② 这里的「第 N 批」是**可见序号**（`index + 1`），不是服务端的批次序号，
 *       两者在有过跳号的环境里对不上。批次号那一行才是能对上的东西，所以它要显示出来。
 *
 * ⚠️ 排序由服务端按 `firstCreateTime` 正序给出，这里**不要再 sort**：
 *    前端自己排一遍的话，同一批资料在「刚传完的列表」和「翻页后的列表」里位置可能不同，
 *    而位置变了不报错，用户只会觉得「我刚传的那批跑哪去了」。
 */
defineOptions({ name: 'QlzgBatchTimeline' })

defineProps<{
  batches: QlzgMaterialBatchVO[]
  /** 选中的批次号，空串 = 不过滤 */
  modelValue: string
  loading?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', batchNo: string): void
}>()

const rowClass = (active: boolean) =>
  active
    ? 'bg-[var(--el-color-primary-light-9)] border-l-2px border-l-solid border-l-[var(--el-color-primary)]'
    : 'hover:bg-[var(--el-fill-color-light)] border-l-2px border-l-solid border-l-transparent'
</script>
