<template>
  <ContentWrap>
    <!-- 顶部操作栏：页内展示，从列表行点「测试」进来，锁定单个模板 -->
    <div class="bt-panel-header mb-15px flex items-center justify-between">
      <div class="flex items-center">
        <el-button link @click="emit('back')">
          <Icon icon="ep:arrow-left" class="mr-5px" /> 返回
        </el-button>
        <span class="bt-panel-title ml-8px">取号测试 - {{ templateName }}</span>
        <el-tag v-if="template" size="small" class="ml-8px font-mono">{{ template.code }}</el-tag>
      </div>
    </div>

    <el-alert type="info" :closable="false" class="mb-15px">
      <template #title>
        <b>模拟取号</b>（默认）只试算下一个号，不消耗流水、不写日志，可反复执行；
        <b>真实取号</b>与业务出号走同一路径，会<b>消耗流水</b>并在日志中记为「测试取号」，
        严格取号场景请优先使用模拟，避免正式单据跳号。
      </template>
    </el-alert>

    <el-form label-width="90px" class="max-w-640px">
      <el-form-item label="取号模式">
        <el-radio-group v-model="real">
          <el-radio :value="false">模拟取号（不消耗流水）</el-radio>
          <el-radio :value="true">真实取号（消耗流水）</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :loading="running" @click="handleRun">
          <Icon :icon="real ? 'ep:warning' : 'ep:video-play'" class="mr-5px" />
          {{ real ? '真实取号' : '模拟取号' }}
        </el-button>
      </el-form-item>
    </el-form>

    <!-- 最近一次结果 -->
    <div
      v-if="result"
      class="bt-result mb-15px p-12px rounded border border-[var(--el-border-color-lighter)]"
    >
      <div class="flex items-center gap-8px">
        <span class="text-18px font-mono font-bold text-[var(--el-text-color-primary)]">
          {{ result.no }}
        </span>
        <el-tag size="small" :type="result.real ? 'danger' : 'success'">
          {{ result.real ? '真实取号 · 已消耗流水' : '模拟取号 · 未消耗流水' }}
        </el-tag>
      </div>
      <div class="mt-6px text-12px text-[var(--el-text-color-secondary)]">
        周期段：{{ result.period || '-' }}　流水序号：{{ result.seq ?? '-' }}
      </div>
    </div>

    <el-row :gutter="16">
      <!-- 本次会话的执行历史（仅内存，不落库） -->
      <el-col :span="14">
        <div class="bt-section-title">执行历史（仅本次页面会话）</div>
        <el-table :data="history" size="small" stripe max-height="320" empty-text="尚未执行">
          <el-table-column label="时间" width="160" align="center">
            <template #default="{ row }">{{ formatDate(row.time) }}</template>
          </el-table-column>
          <el-table-column label="模式" width="90" align="center">
            <template #default="{ row }">
              <el-tag size="small" :type="row.real ? 'danger' : 'success'">
                {{ row.real ? '真实' : '模拟' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="单据号" min-width="180">
            <template #default="{ row }">
              <span class="font-mono">{{ row.no }}</span>
            </template>
          </el-table-column>
          <el-table-column label="序号" width="80" align="center">
            <template #default="{ row }">{{ row.seq ?? '-' }}</template>
          </el-table-column>
        </el-table>
      </el-col>
      <!-- 模板当前统计：真实取号后会刷新，模拟取号不应改变它 -->
      <el-col :span="10">
        <div class="bt-section-title">模板当前状态</div>
        <el-descriptions v-if="template" :column="1" size="small" border>
          <el-descriptions-item label="生成方式">
            {{ genTypeLabel(template.genType) }}
          </el-descriptions-item>
          <el-descriptions-item label="范例">
            <span class="font-mono">{{ template.example || '-' }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="当前周期">
            {{ template.lastPeriod || '-' }}
          </el-descriptions-item>
          <el-descriptions-item label="当前流水">
            {{ template.genType === GEN_TYPE.TIME ? (template.currentNumber ?? 0) : '-' }}
          </el-descriptions-item>
          <el-descriptions-item label="最近单号">
            <span class="font-mono">{{ template.lastNo || '-' }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="取号日志">
            <el-tag size="small" :type="template.logEnabled ? 'success' : 'info'">
              {{ template.logEnabled ? '已开启' : '未开启' }}
            </el-tag>
          </el-descriptions-item>
        </el-descriptions>
        <div v-else class="text-13px text-[var(--el-text-color-secondary)]">加载中…</div>
      </el-col>
    </el-row>
  </ContentWrap>
</template>

<script lang="ts" setup>
import { ElMessageBox } from 'element-plus'
import { formatDate } from '@/utils/formatTime'
import * as BillTemplateApi from '@/api/infra/billTemplate'
import { GEN_TYPE, GEN_TYPE_OPTIONS } from './constants'

/** 取号测试面板：模拟（默认）不烧号，真实与业务出号同路径 */
defineOptions({ name: 'BillTemplateTestPanel' })

const emit = defineEmits<{ back: [] }>()

const message = useMessage()

const templateId = ref<number>()
const templateName = ref('')
const template = ref<BillTemplateApi.BillTemplateVO>()
/** 是否真实取号。默认模拟 —— 严格取号场景下测试绝不能造成跳号 */
const real = ref(false)
const running = ref(false)
const result = ref<BillTemplateApi.BillTemplateTestVO>()

type HistoryItem = BillTemplateApi.BillTemplateTestVO & { time: Date }
const history = ref<HistoryItem[]>([])

const genTypeLabel = (genType: number) =>
  GEN_TYPE_OPTIONS.find((item) => item.value === genType)?.label ?? String(genType)

const open = async (id: number, name: string) => {
  templateId.value = id
  templateName.value = name
  real.value = false
  result.value = undefined
  history.value = []
  await loadTemplate()
}

const loadTemplate = async () => {
  if (!templateId.value) return
  template.value = await BillTemplateApi.getBillTemplate(templateId.value)
}

const handleRun = async () => {
  if (!templateId.value) return
  if (real.value) {
    // 真实取号会消耗流水，二次确认挡住误点
    try {
      await ElMessageBox.confirm(
        `真实取号将消耗模板「${templateName.value}」的一个流水号，且不可归还（可能造成正式单据跳号）。确认执行吗？`,
        '真实取号确认',
        { confirmButtonText: '确认取号', cancelButtonText: '取消', type: 'warning' }
      )
    } catch {
      return
    }
  }
  running.value = true
  try {
    const data = await BillTemplateApi.testBillTemplate(templateId.value, real.value)
    result.value = data
    history.value.unshift({ ...data, time: new Date() })
    message.success(data.real ? '真实取号成功，流水已消耗' : '模拟取号成功，流水未消耗')
    // 真实取号会回写统计；模拟取号刷新一次也无妨，正好验证统计没被改动
    await loadTemplate()
  } finally {
    running.value = false
  }
}

defineExpose({ open })
</script>

<style lang="scss" scoped>
.bt-panel-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.bt-section-title {
  padding-bottom: 6px;
  margin-bottom: 10px;
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-regular);
  border-bottom: 1px solid var(--el-border-color-lighter);
}
</style>
