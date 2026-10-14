<template>
  <ContentWrap>
    <!-- 顶部操作栏：内容较多，页内展示 -->
    <div class="di-panel-header mb-15px flex items-center justify-between">
      <div class="flex items-center">
        <el-button link @click="emit('back')">
          <Icon icon="ep:arrow-left" class="mr-5px" /> 返回
        </el-button>
        <span class="di-panel-title ml-8px">版本历史 - {{ interfaceName }}</span>
      </div>
    </div>

    <el-alert type="info" :closable="false" class="mb-10px">
      <template #title>
        每次修改前会自动存一份「修改前的配置」，单个接口最多保留 100 个版本（超出自动清理最旧的）。
        回滚会把该版本的配置写回，<b>回滚本身也会产生新版本</b>，操作全程可追溯。
      </template>
    </el-alert>

    <el-table v-loading="loading" :data="list" size="small">
      <el-table-column type="expand">
        <template #default="{ row }">
          <div class="px-20px py-10px">
            <div class="mb-8px font-bold">配置快照</div>
            <VersionSnapshotView :snapshot="row.snapshot" />
          </div>
        </template>
      </el-table-column>
      <el-table-column label="版本" prop="version" width="80" align="center">
        <template #default="{ row }">
          <el-tag size="small">v{{ row.version }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="变更说明" prop="changeSummary" :show-overflow-tooltip="true" min-width="200">
        <template #default="{ row }">
          <span v-if="row.changeSummary">{{ row.changeSummary }}</span>
          <span v-else class="text-[var(--el-text-color-secondary)]">未填写</span>
        </template>
      </el-table-column>
      <el-table-column label="操作人" prop="creator" width="110" align="center" />
      <el-table-column label="时间" prop="createTime" width="170" :formatter="dateFormatter" />
      <el-table-column label="操作" width="140" align="center" fixed="right">
        <template #default="{ row }">
          <el-button
            link
            type="primary"
            size="small"
            @click="emit('preview', row)"
            v-hasPermi="['infra:data-interface:query']"
          >
            预览
          </el-button>
          <el-button
            link
            type="primary"
            size="small"
            @click="handleRollback(row)"
            v-hasPermi="['infra:data-interface:update']"
          >
            回滚
          </el-button>
        </template>
      </el-table-column>
      <template #empty>
        <span class="text-[var(--el-text-color-secondary)]">还没有版本记录（首次修改后才会产生）</span>
      </template>
    </el-table>
    <Pagination
      :total="total"
      v-model:page="queryParams.pageNo"
      v-model:limit="queryParams.pageSize"
      @pagination="getList"
    />
  </ContentWrap>
</template>

<script lang="ts" setup>
import { ElMessageBox } from 'element-plus'
import { dateFormatter } from '@/utils/formatTime'
import * as DataInterfaceApi from '@/api/infra/dataInterface'
import VersionSnapshotView from './components/VersionSnapshotView.vue'

/** 版本历史（页内展示） */
defineOptions({ name: 'DataInterfaceVersionList' })

const message = useMessage()
const { t } = useI18n()

const emit = defineEmits(['back', 'success', 'preview'])

const loading = ref(false)
const interfaceId = ref<number>()
const interfaceName = ref('')
const list = ref<DataInterfaceApi.DataInterfaceVersionVO[]>([])
const total = ref(0)
const queryParams = reactive({ pageNo: 1, pageSize: 20 })

const open = async (row: DataInterfaceApi.DataInterfaceVO) => {
  interfaceId.value = row.id
  interfaceName.value = row.name
  queryParams.pageNo = 1
  await getList()
}
defineExpose({ open })

const getList = async () => {
  if (!interfaceId.value) {
    return
  }
  loading.value = true
  try {
    const data = await DataInterfaceApi.getVersionPage(interfaceId.value, queryParams)
    list.value = data.list
    total.value = data.total
  } finally {
    loading.value = false
  }
}

const handleRollback = async (row: DataInterfaceApi.DataInterfaceVersionVO) => {
  try {
    await ElMessageBox.confirm(
      `确认回滚到版本 v${row.version} 的配置吗？<br/>当前配置会先被存为一个新版本，不会丢失。`,
      '回滚确认',
      {
        confirmButtonText: t('common.ok'),
        cancelButtonText: t('common.cancel'),
        type: 'warning',
        dangerouslyUseHTMLString: true
      }
    )
  } catch {
    return
  }
  await DataInterfaceApi.rollbackVersion(interfaceId.value!, row.version)
  message.success('回滚成功')
  await getList()
  emit('success')
}
</script>

<style lang="scss" scoped>
.di-panel-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
</style>
