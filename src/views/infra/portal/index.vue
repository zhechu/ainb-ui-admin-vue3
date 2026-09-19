<template>
  <ContentWrap>
    <el-form ref="queryFormRef" :model="queryParams" :inline="true" class="-mb-15px">
      <el-form-item label="门户名称" prop="name"
        ><el-input
          v-model="queryParams.name"
          class="!w-200px"
          clearable
          placeholder="请输入门户名称"
          @keyup.enter="handleQuery"
      /></el-form-item>
      <el-form-item label="门户编码" prop="code"
        ><el-input
          v-model="queryParams.code"
          class="!w-200px"
          clearable
          placeholder="请输入门户编码"
          @keyup.enter="handleQuery"
      /></el-form-item>
      <el-form-item label="状态" prop="status"
        ><el-select v-model="queryParams.status" class="!w-150px" clearable placeholder="全部"
          ><el-option
            v-for="item in STATUS_OPTIONS"
            :key="item.value"
            :label="item.label"
            :value="item.value" /></el-select
      ></el-form-item>
      <el-form-item label="启用" prop="enabled"
        ><el-select v-model="queryParams.enabled" class="!w-120px" clearable placeholder="全部"
          ><el-option label="是" :value="true" /><el-option label="否" :value="false" /></el-select
      ></el-form-item>
      <el-form-item>
        <el-button @click="handleQuery"><Icon icon="ep:search" class="mr-5px" />搜索</el-button>
        <el-button @click="resetQuery"><Icon icon="ep:refresh" class="mr-5px" />重置</el-button>
        <el-button v-hasPermi="['infra:portal:create']" type="primary" plain @click="handleCreate"
          ><Icon icon="ep:plus" class="mr-5px" />新建门户</el-button
        >
      </el-form-item>
    </el-form>
  </ContentWrap>

  <ContentWrap>
    <el-table class="xpy-list-table" stripe v-loading="loading" :data="list">
      <el-table-column
        label="序号"
        type="index"
        width="44"
        align="center"
        :index="indexMethod(queryParams)"
      class-name="col-index"
        label-class-name="col-index"
      />
      <el-table-column label="编号" prop="id" width="75" align="center" />
      <el-table-column label="门户名称" prop="name" min-width="150" show-overflow-tooltip />
      <el-table-column label="编码" prop="code" min-width="150" show-overflow-tooltip />
      <el-table-column label="状态" prop="status" width="125" align="center">
        <template #default="{ row }"
          ><el-tag :type="statusType(row.status)" size="small">{{
            statusLabel(row.status)
          }}</el-tag></template
        >
      </el-table-column>
      <el-table-column label="线上版本" prop="publishedVersion" width="100" align="center"
        ><template #default="{ row }">{{
          row.publishedVersion ? `v${row.publishedVersion}` : '-'
        }}</template></el-table-column
      >
      <el-table-column label="默认" width="80" align="center"
        ><template #default="{ row }"
          ><el-switch
            v-model="row.isDefault"
            :disabled="!row.enabled"
            v-hasPermi="['infra:portal:update']"
            @change="handleDefaultChange(row)" /></template
      ></el-table-column>
      <el-table-column label="启用" width="80" align="center"
        ><template #default="{ row }"
          ><el-switch
            v-model="row.enabled"
            v-hasPermi="['infra:portal:update']"
            @change="handleEnabledChange(row)" /></template
      ></el-table-column>
      <el-table-column
        label="更新时间"
        prop="updateTime"
        width="170"
        align="center"
        :formatter="dateFormatter"
      />
      <el-table-column label="操作" width="390" fixed="right" align="center">
        <template #default="{ row }">
          <el-button
            v-hasPermi="['infra:portal:update']"
            link
            type="primary"
            @click="handleDesign(row)"
            ><Icon icon="ep:edit-pen" class="mr-3px" />设计</el-button
          >
          <el-button
            v-hasPermi="['infra:portal:update']"
            link
            type="primary"
            @click="handleEdit(row)"
            ><Icon icon="ep:setting" class="mr-3px" />编辑</el-button
          >
          <el-button
            v-hasPermi="['infra:portal:publish']"
            link
            type="success"
            @click="handlePublish(row)"
            >{{ row.publishedVersion ? '重新发布' : '发布' }}</el-button
          >
          <el-button v-hasPermi="['infra:portal:query']" link @click="handleVersions(row)"
            >版本</el-button
          >
          <el-dropdown @command="(command: string) => handleCommand(command, row)"
            ><el-button link type="primary"
              >更多<Icon icon="ep:arrow-down" class="ml-2px" /></el-button
            ><template #dropdown
              ><el-dropdown-menu
                ><el-dropdown-item v-hasPermi="['infra:portal:preview']" command="preview"
                  >预览</el-dropdown-item
                ><el-dropdown-item
                  v-if="row.publishedVersion"
                  v-hasPermi="['infra:portal:publish']"
                  command="unpublish"
                  >下线</el-dropdown-item
                ><el-dropdown-item v-hasPermi="['infra:portal:create']" command="copy"
                  >复制</el-dropdown-item
                ><el-dropdown-item v-hasPermi="['infra:portal:delete']" command="delete" divided
                  >删除</el-dropdown-item
                ></el-dropdown-menu
              ></template
            ></el-dropdown
          >
        </template>
      </el-table-column>
    </el-table>
    <Pagination
      v-model:page="queryParams.pageNo"
      v-model:limit="queryParams.pageSize"
      :total="total"
      @pagination="getList"
    />
  </ContentWrap>

  <PortalForm ref="formRef" @success="handleFormSuccess" />
  <VersionDrawer ref="versionDrawerRef" @success="getList" />
  <Dialog
    v-model="previewVisible"
    title="门户预览"
    width="92%"
    top="4vh"
    body-class="portal-preview-dialog__body"
  >
    <div class="preview-container"><PortalRuntime v-if="previewData" :portal="previewData" /></div>
  </Dialog>
</template>

<script lang="ts" setup>
import { ElMessageBox } from 'element-plus'
import { dateFormatter } from '@/utils/formatTime'
import * as PortalApi from '@/api/infra/portal'
import PortalRuntime from '@/components/Portal/Runtime/PortalRuntime.vue'
import PortalForm from './PortalForm.vue'
import VersionDrawer from './components/VersionDrawer.vue'

defineOptions({ name: 'InfraPortal' })

const message = useMessage()
const { t } = useI18n()
const { push } = useRouter()
const loading = ref(false)
const list = ref<PortalApi.PortalVO[]>([])
const total = ref(0)
const queryFormRef = ref()
const queryParams = reactive({
  pageNo: 1,
  pageSize: 20,
  name: undefined as string | undefined,
  code: undefined as string | undefined,
  status: undefined as number | undefined,
  enabled: undefined as boolean | undefined
})
const STATUS_OPTIONS = [
  { value: 0, label: '草稿' },
  { value: 1, label: '已发布' },
  { value: 2, label: '已发布有改动' }
]

const statusLabel = (status: number) =>
  STATUS_OPTIONS.find((item) => item.value === status)?.label || '-'
const statusType = (status: number) =>
  status === 1 ? 'success' : status === 2 ? 'warning' : 'info'

const getList = async () => {
  loading.value = true
  try {
    const data = await PortalApi.getPortalPage(queryParams)
    list.value = data.list
    total.value = data.total
  } finally {
    loading.value = false
  }
}
const handleQuery = () => {
  queryParams.pageNo = 1
  getList()
}
const resetQuery = () => {
  queryFormRef.value?.resetFields()
  handleQuery()
}

const formRef = ref()
const handleCreate = () => formRef.value?.open('create')
const handleEdit = (row: PortalApi.PortalVO) => formRef.value?.open('update', row)
const handleFormSuccess = async (id?: number) => {
  await getList()
  if (id) push({ name: 'InfraPortalEditor', query: { id } })
}
const handleDesign = (row: PortalApi.PortalVO) =>
  push({ name: 'InfraPortalEditor', query: { id: row.id } })

const handleDefaultChange = async (row: PortalApi.PortalVO) => {
  try {
    await PortalApi.updatePortal(toSaveReq(row))
    message.success(row.isDefault ? '已设置为默认门户' : '已取消默认门户')
    await getList()
  } catch {
    await getList()
  }
}
const handleEnabledChange = async (row: PortalApi.PortalVO) => {
  try {
    await PortalApi.updatePortal(toSaveReq(row))
    message.success(row.enabled ? '已启用' : '已停用')
  } catch {
    await getList()
  }
}
const toSaveReq = (row: PortalApi.PortalVO): PortalApi.PortalSaveReqVO => ({
  id: row.id,
  name: row.name,
  code: row.code,
  description: row.description,
  content: row.content,
  isDefault: row.isDefault,
  enabled: row.enabled
})

const handlePublish = async (row: PortalApi.PortalVO) => {
  try {
    const result = await message.prompt('请输入发布说明（可选）', '发布门户')
    await PortalApi.publishPortal({ id: row.id, publishRemark: result.value })
    message.success('发布成功')
    await getList()
  } catch {
    return
  }
}
const handleUnpublish = async (row: PortalApi.PortalVO) => {
  try {
    await message.confirm(`确认下线门户“${row.name}”吗？下线后首页将不再展示。`)
    await PortalApi.unpublishPortal(row.id)
    message.success('下线成功')
    await getList()
  } catch {
    return
  }
}
const handleCopy = async (row: PortalApi.PortalVO) => {
  try {
    await message.confirm(`确认复制门户“${row.name}”吗？`)
    await PortalApi.copyPortal(row.id)
    message.success('复制成功')
    await getList()
  } catch {
    return
  }
}
const handleDelete = async (row: PortalApi.PortalVO) => {
  try {
    await ElMessageBox.confirm(`确认删除门户“${row.name}”吗？版本历史也会一并删除。`, '删除确认', {
      type: 'warning'
    })
    await PortalApi.deletePortal(row.id)
    message.success(t('common.delSuccess'))
    await getList()
  } catch {
    return
  }
}
const versionDrawerRef = ref()
const handleVersions = (row: PortalApi.PortalVO) => versionDrawerRef.value?.open(row)
const previewVisible = ref(false)
const previewData = ref<PortalApi.PortalRuntimeVO>()
const handlePreview = async (row: PortalApi.PortalVO) => {
  previewData.value = await PortalApi.previewPortal(row.id)
  previewVisible.value = true
}
const handleCommand = (command: string, row: PortalApi.PortalVO) => {
  if (command === 'preview') handlePreview(row)
  if (command === 'unpublish') handleUnpublish(row)
  if (command === 'copy') handleCopy(row)
  if (command === 'delete') handleDelete(row)
}

onMounted(getList)
</script>

<style lang="scss" scoped>
.preview-container {
  max-height: calc(100vh - 150px);
  overflow: auto;
}

.preview-container :deep(.portal-runtime) {
  min-height: 600px;
}

:global(.com-dialog .portal-preview-dialog__body) {
  padding: 0 !important;
}
</style>
