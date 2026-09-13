<template>
  <div v-if="table" class="table-quick-actions">
    <el-tooltip content="复制表名" placement="top">
      <el-button link type="primary" size="small" @click="handleCopy">
        <Icon icon="ep:document-copy" />
      </el-button>
    </el-tooltip>
    <el-tooltip content="查看这张表的业务数据" placement="top">
      <el-button link type="primary" size="small" :loading="jumping" @click="handleOpenData">
        <Icon icon="ep:tickets" />
      </el-button>
    </el-tooltip>
  </div>
</template>

<script lang="ts" setup>
import { useClipboard } from '@vueuse/core'
import * as DataModelApi from '@/api/infra/dataModel'

defineOptions({ name: 'TableQuickActions' })

/**
 * 绑定的表旁边的两个快捷动作：复制表名、跳到业务数据
 *
 * 做成组件而不是在 StepTableBinding 里写两遍：主表在表单项里、关联表在表格行里，
 * 两处的按钮行为完全一样，抄一遍必然会在后续改动时漂移。
 */
const props = defineProps<{
  /** 物理表名。为空时整组按钮不渲染 */
  table?: string
}>()

const message = useMessage()
const { push } = useRouter()
// legacy: true —— 非 HTTPS 下 navigator.clipboard 不可用，要退回 execCommand
const { copy } = useClipboard({ legacy: true })

const jumping = ref(false)

const handleCopy = async () => {
  if (!props.table) return
  await copy(props.table)
  message.success(`已复制表名：${props.table}`)
}

/**
 * 跳到业务数据页
 *
 * 业务数据页按 modelId 定位，而这里只有表名，中间要过一次数据模型查询。
 * page 接口的 tableName 是模糊匹配，所以要再精确比对一次 ——
 * 否则 `biz_order` 会命中 `biz_order_item`，跳过去看到的是另一张表的数据。
 */
const handleOpenData = async () => {
  if (!props.table) return
  jumping.value = true
  try {
    const page = await DataModelApi.getDataModelPage({
      tableName: props.table,
      pageNo: 1,
      pageSize: 50
    })
    const matched = (page?.list ?? []).find((item: any) => item.tableName === props.table)
    if (!matched) {
      // 说明这张表还没被纳入数据建模。说清楚下一步该干什么，
      // 不然用户只看到「没找到」，不知道是该去建模还是表名写错了
      message.warning(`表 ${props.table} 还没有对应的数据模型，请先到【数据建模】里导入这张表`)
      return
    }
    push({ path: '/infra/data-model-data', query: { modelId: matched.id } })
  } finally {
    jumping.value = false
  }
}
</script>

<style lang="scss" scoped>
.table-quick-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 2px;
  align-items: center;
}
</style>
