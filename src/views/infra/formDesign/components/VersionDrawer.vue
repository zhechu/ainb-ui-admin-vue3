<template>
  <el-drawer v-model="drawerVisible" title="版本历史" size="560px">
    <el-alert
      title="每个表单最多保留最新 10 个版本。回滚只把配置写回草稿，线上版本不变，需再点发布才生效。"
      type="info"
      :closable="false"
      class="mb-15px"
    />

    <el-timeline v-if="versionList.length > 0">
      <el-timeline-item
        v-for="item in versionList"
        :key="item.id"
        :timestamp="formatDate(item.createTime)"
        placement="top"
        :type="item.version === publishedVersion ? 'primary' : ''"
      >
        <el-card shadow="never">
          <div class="version-header">
            <span class="version-no">v{{ item.version }}</span>
            <el-tag v-if="item.version === publishedVersion" size="small" type="success">
              当前线上
            </el-tag>
            <el-button
              v-hasPermi="['infra:form-design:rollback']"
              link
              size="small"
              type="primary"
              @click="handleRollback(item)"
            >
              回滚到此版本
            </el-button>
          </div>
          <div class="version-summary">
            {{ item.changeSummary || '无变更说明' }}
          </div>
          <div class="version-meta">发布人：{{ item.creator || '-' }}</div>
        </el-card>
      </el-timeline-item>
    </el-timeline>

    <el-empty v-else description="还没有发布过，暂无版本历史" />
  </el-drawer>
</template>

<script lang="ts" setup>
import * as FormDesignApi from '@/api/infra/formDesign'
import { formatDate } from '@/utils/formatTime'

defineOptions({ name: 'FormDesignVersionDrawer' })

const message = useMessage()
const emit = defineEmits(['success'])

const drawerVisible = ref(false)
const designId = ref<number>()
const publishedVersion = ref<number>()
const versionList = ref<FormDesignApi.FormDesignVersionVO[]>([])

const open = async (row: FormDesignApi.FormDesignVO) => {
  designId.value = row.id
  publishedVersion.value = row.publishedVersion
  drawerVisible.value = true
  await loadVersions()
}

defineExpose({ open })

const loadVersions = async () => {
  if (!designId.value) return
  versionList.value = await FormDesignApi.getVersionList(designId.value)
}

const handleRollback = async (item: FormDesignApi.FormDesignVersionVO) => {
  try {
    await message.confirm(
      `确认回滚到版本 v${item.version} 吗？回滚只影响草稿，线上仍是 v${publishedVersion.value ?? '-'}，需要重新发布才会生效。`
    )
    await FormDesignApi.rollbackVersion(designId.value!, item.version)
    message.success('回滚成功，配置已写回草稿')
    emit('success')
    drawerVisible.value = false
  } catch {}
}
</script>

<style lang="scss" scoped>
.version-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}

.version-no {
  font-size: 15px;
  font-weight: bold;
}

.version-summary {
  font-size: 13px;
  color: var(--el-text-color-regular);
  margin-bottom: 4px;
}

.version-meta {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
