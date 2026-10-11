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
          ><Icon icon="ep:plus" class="mr-5px" />新增</el-button
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
      <el-table-column label="类型" width="90" align="center">
        <template #default="{ row }">
          <el-tag :type="isLinkPortal(row) ? 'warning' : 'primary'" size="small">
            {{ isLinkPortal(row) ? '自定义链接' : '在线设计' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="排序" prop="sort" width="70" align="center" />
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
      <el-table-column label="操作" width="220" fixed="right" align="center">
        <template #default="{ row }">
          <TableActions :row="row" :buttons="rowButtons" />
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
import type { TableActionButton } from '@/components/TableActions'
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

const isLinkPortal = (row: PortalApi.PortalVO) => row.type === 1
const isPublished = (row: PortalApi.PortalVO) => row.status !== 0

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
  type: row.type,
  linkType: row.linkType,
  linkUrl: row.linkUrl,
  sort: row.sort,
  content: row.content,
  isDefault: row.isDefault,
  enabled: row.enabled,
  visibleScope: row.visibleScope,
  visibleIds: row.visibleIds
})

const handlePublish = async (row: PortalApi.PortalVO) => {
  try {
    let publishRemark: string | undefined
    if (isLinkPortal(row)) {
      // 链接门户没有内容快照，不产生版本，无需填写发布说明
      await message.confirm(`确认发布门户“${row.name}”吗？`)
    } else {
      const result = await message.prompt('请输入发布说明（可选）', '发布门户')
      publishRemark = result.value
    }
    await PortalApi.publishPortal({ id: row.id, publishRemark })
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
/**
 * 操作列按钮清单。行级条件（外链门户没有设计/版本/预览、未发布没有下线）
 * 原来散在模板的 v-if 里，现在落在各按钮的 show 上；command 字符串映射消失
 */
const rowButtons: TableActionButton[] = [
  {
    key: 'design',
    label: '设计',
    permission: ['infra:portal:update'],
    show: (row) => !isLinkPortal(row),
    onClick: (row) => handleDesign(row)
  },
  {
    key: 'edit',
    label: '编辑',
    permission: ['infra:portal:update'],
    onClick: (row) => handleEdit(row)
  },
  {
    key: 'publish',
    label: '发布',
    type: 'success',
    permission: ['infra:portal:publish'],
    onClick: (row) => handlePublish(row)
  },
  {
    key: 'versions',
    label: '版本',
    permission: ['infra:portal:query'],
    show: (row) => !isLinkPortal(row),
    onClick: (row) => handleVersions(row)
  },
  {
    key: 'preview',
    label: '预览',
    permission: ['infra:portal:preview'],
    show: (row) => !isLinkPortal(row),
    onClick: (row) => handlePreview(row)
  },
  {
    key: 'unpublish',
    label: '下线',
    permission: ['infra:portal:publish'],
    show: (row) => isPublished(row),
    onClick: (row) => handleUnpublish(row)
  },
  {
    key: 'copy',
    label: '复制',
    permission: ['infra:portal:create'],
    onClick: (row) => handleCopy(row)
  },
  {
    key: 'delete',
    label: '删除',
    type: 'danger',
    divided: true,
    permission: ['infra:portal:delete'],
    onClick: (row) => handleDelete(row)
  }
]

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
