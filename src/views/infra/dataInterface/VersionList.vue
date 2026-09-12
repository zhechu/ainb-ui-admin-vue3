<template>
  <Dialog :title="`版本历史 - ${interfaceName}`" v-model="dialogVisible" width="1000px">
    <el-alert type="info" :closable="false" class="mb-10px">
      <template #title>
        每次修改前会自动存一份「修改前的配置」。回滚会把该版本的配置写回，
        <b>回滚本身也会产生新版本</b>，操作全程可追溯。
      </template>
    </el-alert>

    <el-table v-loading="loading" :data="list" size="small" max-height="420">
      <el-table-column type="expand">
        <template #default="{ row }">
          <div class="px-20px py-10px">
            <div class="mb-5px font-bold">配置快照</div>
            <pre class="code-block">{{ prettySnapshot(row.snapshot) }}</pre>
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
          <span v-else class="text-gray-400">未填写</span>
        </template>
      </el-table-column>
      <el-table-column label="操作人" prop="creator" width="110" align="center" />
      <el-table-column label="时间" prop="createTime" width="170" :formatter="dateFormatter" />
      <el-table-column label="操作" width="90" align="center" fixed="right">
        <template #default="{ row }">
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
        <span class="text-gray-400">还没有版本记录（首次修改后才会产生）</span>
      </template>
    </el-table>
    <Pagination
      :total="total"
      v-model:page="queryParams.pageNo"
      v-model:limit="queryParams.pageSize"
      @pagination="getList"
    />
  </Dialog>
</template>

<script lang="ts" setup>
import { ElMessageBox } from 'element-plus'
import { dateFormatter } from '@/utils/formatTime'
import * as DataInterfaceApi from '@/api/infra/dataInterface'

/** 版本历史 */
defineOptions({ name: 'DataInterfaceVersionList' })

const message = useMessage()
const { t } = useI18n()

const dialogVisible = ref(false)
const loading = ref(false)
const interfaceId = ref<number>()
const interfaceName = ref('')
const list = ref<DataInterfaceApi.DataInterfaceVersionVO[]>([])
const total = ref(0)
const queryParams = reactive({ pageNo: 1, pageSize: 20 })

const open = async (row: DataInterfaceApi.DataInterfaceVO) => {
  dialogVisible.value = true
  interfaceId.value = row.id
  interfaceName.value = row.name
  queryParams.pageNo = 1
  await getList()
}
defineExpose({ open })

const emit = defineEmits(['success'])

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

/** 快照是 JSON 字符串，格式化后展示；解析不了就原样显示 */
const prettySnapshot = (raw?: string) => {
  if (!raw) {
    return '（无内容）'
  }
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
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
.code-block {
  padding: 10px;
  margin: 0;
  font-family: Consolas, Monaco, monospace;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
  background-color: #f5f7fa;
  border-radius: 4px;
}
</style>
