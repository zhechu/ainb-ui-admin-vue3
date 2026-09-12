<template>
  <el-drawer
    v-model="visible"
    class="portal-theme"
    :title="`版本历史 - ${portalName}`"
    size="720px"
  >
    <el-alert type="info" :closable="false" show-icon class="mb-12px">
      回滚只会覆盖当前草稿，不会修改线上版本；回滚后的内容需要重新发布才会生效。
    </el-alert>
    <el-table v-loading="loading" :data="versions" size="small" height="calc(100vh - 150px)">
      <el-table-column type="expand">
        <template #default="{ row }">
          <pre class="version-content">{{ prettyContent(row.content) }}</pre>
        </template>
      </el-table-column>
      <el-table-column label="版本" prop="version" width="90" align="center">
        <template #default="{ row }"
          ><el-tag size="small">v{{ row.version }}</el-tag></template
        >
      </el-table-column>
      <el-table-column
        label="发布说明"
        prop="publishRemark"
        min-width="180"
        show-overflow-tooltip
      />
      <el-table-column label="发布人" prop="creator" width="100" align="center" />
      <el-table-column label="时间" prop="createTime" width="165" :formatter="dateFormatter" />
      <el-table-column label="操作" width="85" fixed="right" align="center">
        <template #default="{ row }">
          <el-button
            v-hasPermi="['infra:portal:rollback']"
            link
            type="primary"
            @click="handleRollback(row)"
            >回滚</el-button
          >
        </template>
      </el-table-column>
      <template #empty><el-empty description="暂无发布版本" /></template>
    </el-table>
  </el-drawer>
</template>

<script lang="ts" setup>
import { ElMessageBox } from 'element-plus'
import { dateFormatter } from '@/utils/formatTime'
import * as PortalApi from '@/api/infra/portal'

defineOptions({ name: 'InfraPortalVersionDrawer' })

const message = useMessage()
const visible = ref(false)
const loading = ref(false)
const portalId = ref<number>()
const portalName = ref('')
const versions = ref<PortalApi.PortalVersionVO[]>([])

const open = async (row: PortalApi.PortalVO) => {
  portalId.value = row.id
  portalName.value = row.name
  visible.value = true
  await loadVersions()
}
defineExpose({ open })

const emit = defineEmits<{ success: [] }>()

const loadVersions = async () => {
  if (!portalId.value) return
  loading.value = true
  try {
    versions.value = await PortalApi.getPortalVersionList(portalId.value)
  } finally {
    loading.value = false
  }
}

const prettyContent = (content: string) => {
  try {
    return JSON.stringify(JSON.parse(content), null, 2)
  } catch {
    return content
  }
}

const handleRollback = async (row: PortalApi.PortalVersionVO) => {
  try {
    await ElMessageBox.confirm(`确认回滚到版本 v${row.version} 吗？`, '回滚确认', {
      type: 'warning'
    })
    await PortalApi.rollbackPortal(portalId.value!, row.version)
    message.success('回滚成功')
    emit('success')
  } catch {
    return
  }
}
</script>

<style lang="scss" scoped>
.version-content {
  max-height: 360px;
  padding: 12px;
  margin: 0;
  overflow: auto;
  font-family: Consolas, Monaco, monospace;
  font-size: 12px;
  line-height: 1.6;
  color: var(--portal-text-regular);
  word-break: break-all;
  white-space: pre-wrap;
  background: var(--portal-surface-soft);
  border-radius: 4px;
}
</style>
