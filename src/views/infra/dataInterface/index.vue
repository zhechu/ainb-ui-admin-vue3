<template>
  <!-- 列表视图：新建/预览/版本/日志都是内容较多的页内视图，切换时整页替换 -->
  <template v-if="viewMode === 'list'">
  <ContentWrap>
    <el-form class="-mb-15px" :model="queryParams" ref="queryFormRef" :inline="true">
      <el-form-item label="接口名称" prop="name">
        <el-input
          v-model="queryParams.name"
          placeholder="请输入接口名称"
          clearable
          @keyup.enter="handleQuery"
          class="!w-200px"
        />
      </el-form-item>
      <el-form-item label="接口编码" prop="code">
        <el-input
          v-model="queryParams.code"
          placeholder="请输入接口编码"
          clearable
          @keyup.enter="handleQuery"
          class="!w-200px"
        />
      </el-form-item>
      <el-form-item label="类型" prop="type">
        <el-select v-model="queryParams.type" placeholder="全部" clearable class="!w-140px">
          <el-option v-for="item in typeOptions" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="含写操作" prop="hasWriteOperation">
        <el-select v-model="queryParams.hasWriteOperation" placeholder="全部" clearable class="!w-120px">
          <el-option label="是" :value="true" />
          <el-option label="否" :value="false" />
        </el-select>
      </el-form-item>
      <el-form-item label="动作类型" prop="sqlStatementType">
        <el-select v-model="queryParams.sqlStatementType" placeholder="全部" clearable class="!w-120px">
          <el-option v-for="item in statementTypeOptions" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-button @click="handleQuery"><Icon icon="ep:search" class="mr-5px" /> 搜索</el-button>
        <el-button @click="resetQuery"><Icon icon="ep:refresh" class="mr-5px" /> 重置</el-button>
        <el-button
          type="primary"
          plain
          @click="openForm('create')"
          v-hasPermi="['infra:data-interface:create']"
        >
          <Icon icon="ep:plus" class="mr-5px" /> 新增
        </el-button>
        <el-button plain @click="openLog()">
          <Icon icon="ep:document" class="mr-5px" /> 调用日志
        </el-button>
      </el-form-item>
    </el-form>
  </ContentWrap>

  <ContentWrap>
    <el-table class="xpy-list-table" stripe v-loading="loading" :data="list">
      <el-table-column label="序号" type="index" width="44" align="center" :index="indexMethod(queryParams)" class-name="col-index"
        label-class-name="col-index"
      />
      <el-table-column label="编号" align="center" prop="id" width="70" />
      <el-table-column label="接口名称" prop="name" :show-overflow-tooltip="true" min-width="140" />
      <el-table-column label="接口编码" prop="code" :show-overflow-tooltip="true" min-width="140" />
      <el-table-column label="责任人" prop="owner" align="center" width="100" :show-overflow-tooltip="true" />
      <el-table-column label="分类" prop="category" align="center" width="100" />
      <el-table-column label="类型" align="center" width="110">
        <template #default="{ row }">
          <el-tag size="small">{{ typeLabel(row.type) }}</el-tag>
        </template>
      </el-table-column>
      <!-- 动作类型是核心信息，SQL 类型的接口优先展示，列宽加大 -->
      <el-table-column label="动作类型" align="center" width="120">
        <template #default="{ row }">
          <!-- 用后端下发的 typeName，避免前端再映射一遍 -->
          <el-tag v-if="row.hasWriteOperation" type="danger" size="small" effect="dark">
            {{ row.sqlStatementTypeName || '写操作' }}
          </el-tag>
          <el-tag v-else-if="row.sqlStatementTypeName" type="success" size="small">
            {{ row.sqlStatementTypeName }}
          </el-tag>
          <span v-else class="text-[var(--el-text-color-secondary)]">-</span>
        </template>
      </el-table-column>
      <el-table-column label="版本" align="center" prop="version" width="70" />
      <el-table-column label="状态" align="center" width="90">
        <template #default="{ row }">
          <el-switch
            :model-value="row.status === 0"
            @change="handleStatusChange(row)"
            v-hasPermi="['infra:data-interface:update']"
          />
        </template>
      </el-table-column>
      <el-table-column
        label="更新时间"
        align="center"
        prop="updateTime"
        width="170"
        :formatter="dateFormatter"
      />
      <el-table-column label="更新者" align="center" prop="updater" width="100" />
      <el-table-column label="操作" align="center" width="280" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openForm('update', row.id)" v-hasPermi="['infra:data-interface:update']">
            配置
          </el-button>
          <el-button link type="primary" @click="openPreview(row)" v-hasPermi="['infra:data-interface:query']">
            预览
          </el-button>
          <el-button link type="primary" @click="openVersion(row)" v-hasPermi="['infra:data-interface:query']">
            版本
          </el-button>
          <el-button link type="primary" @click="openLog(row)" v-hasPermi="['infra:data-interface:query']">
            日志
          </el-button>
          <el-button link type="danger" @click="handleDelete(row)" v-hasPermi="['infra:data-interface:delete']">
            删除
          </el-button>
        </template>
      </el-table-column>
    </el-table>
    <Pagination
      :total="total"
      v-model:page="queryParams.pageNo"
      v-model:limit="queryParams.pageSize"
      @pagination="getList"
    />
  </ContentWrap>
  </template>

  <!-- 页内视图：配置表单 / 预览 / 版本历史 / 调用日志 -->
  <DataInterfaceForm
    v-else-if="viewMode === 'form'"
    ref="formRef"
    @success="handlePanelDone"
    @cancel="handlePanelBack"
  />
  <PreviewPanel v-else-if="viewMode === 'preview'" ref="previewRef" @back="handlePanelBack" />
  <VersionList
    v-else-if="viewMode === 'version'"
    ref="versionRef"
    @success="handlePanelDone"
    @preview="handleVersionPreview"
    @back="handlePanelBack"
  />
  <!-- 版本预览：复用配置表单的只读态，与新建/配置长得一样，便于逐版本翻看 -->
  <DataInterfaceForm
    v-else-if="viewMode === 'versionPreview'"
    ref="versionPreviewRef"
    @cancel="handleVersionPreviewBack"
  />
  <LogList v-else-if="viewMode === 'log'" ref="logRef" @back="handlePanelBack" />
</template>

<script lang="ts" setup>
import { ElMessageBox } from 'element-plus'
import { dateFormatter } from '@/utils/formatTime'
import * as DataInterfaceApi from '@/api/infra/dataInterface'
import DataInterfaceForm from './DataInterfaceForm.vue'
import PreviewPanel from './components/PreviewPanel.vue'
import VersionList from './VersionList.vue'
import LogList from './LogList.vue'

/** 数据接口列表 */
defineOptions({ name: 'InfraDataInterface' })

const message = useMessage()
const { t } = useI18n()

/**
 * 页内视图切换：list=列表，其余为整页替换的子视图。
 * 表单/预览/版本/日志内容都较多，弹窗放不下，参考数据建模页的做法
 */
const viewMode = ref<'list' | 'form' | 'preview' | 'version' | 'versionPreview' | 'log'>('list')

const loading = ref(true)
const list = ref<DataInterfaceApi.DataInterfaceVO[]>([])
const total = ref(0)
const typeOptions = ref<DataInterfaceApi.OptionVO[]>([])
const statementTypeOptions = ref<DataInterfaceApi.OptionVO[]>([])
const queryParams = reactive({
  pageNo: 1,
  pageSize: 20,
  name: undefined,
  code: undefined,
  type: undefined,
  hasWriteOperation: undefined,
  sqlStatementType: undefined
})
const queryFormRef = ref()

const typeLabel = (type: number) =>
  typeOptions.value.find((item) => item.value === type)?.label ?? String(type)

const getList = async () => {
  loading.value = true
  try {
    const data = await DataInterfaceApi.getDataInterfacePage(queryParams)
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

/**
 * 打开各页内视图
 *
 * 面板是 v-else-if 条件渲染的，切完 viewMode 要等 nextTick
 * 让组件挂载后才能拿到 ref 调 open()
 */
const formRef = ref()
const openForm = async (type: string, id?: number) => {
  viewMode.value = 'form'
  await nextTick()
  formRef.value?.open(type, id)
}

const previewRef = ref()
const openPreview = async (row: DataInterfaceApi.DataInterfaceVO) => {
  viewMode.value = 'preview'
  await nextTick()
  previewRef.value?.open(row)
}

const versionRef = ref()
/** 记住当前正在看版本的接口，版本预览返回时据此复原版本列表 */
const versionRow = ref<DataInterfaceApi.DataInterfaceVO>()
const openVersion = async (row: DataInterfaceApi.DataInterfaceVO) => {
  versionRow.value = row
  viewMode.value = 'version'
  await nextTick()
  versionRef.value?.open(row)
}

/** 版本预览：进入只读表单态，用与新建/配置一样的页面展示该版本快照 */
const versionPreviewRef = ref()
const handleVersionPreview = async (verRow: DataInterfaceApi.DataInterfaceVersionVO) => {
  viewMode.value = 'versionPreview'
  await nextTick()
  versionPreviewRef.value?.openPreview({
    snapshot: verRow.snapshot,
    version: verRow.version,
    interfaceName: versionRow.value?.name
  })
}

/** 版本预览返回：回到版本列表（而非主列表），便于连续翻看多个版本 */
const handleVersionPreviewBack = async () => {
  if (!versionRow.value) {
    viewMode.value = 'list'
    return
  }
  viewMode.value = 'version'
  await nextTick()
  versionRef.value?.open(versionRow.value)
}

/** row 为空时是工具栏入口：查看全部接口的日志 */
const logRef = ref()
const openLog = async (row?: DataInterfaceApi.DataInterfaceVO) => {
  viewMode.value = 'log'
  await nextTick()
  logRef.value?.open(row?.id, row?.name)
}

/** 子视图保存/回滚成功：回列表并刷新 */
const handlePanelDone = () => {
  viewMode.value = 'list'
  getList()
}

/** 子视图返回：只回列表，不强制刷新 */
const handlePanelBack = () => {
  viewMode.value = 'list'
}

/** 启用/停用 */
const handleStatusChange = async (row: DataInterfaceApi.DataInterfaceVO) => {
  const newStatus = row.status === 0 ? 1 : 0
  try {
    await DataInterfaceApi.updateStatus(row.id, newStatus)
    message.success(newStatus === 0 ? '已启用' : '已停用')
    await getList()
  } catch {
    // 失败时列表不变，开关会因为重新渲染回到原状态
  }
}

/** 删除接口
 *
 * 含写操作的接口额外提示一次 —— 这类接口通常被其它系统依赖，删掉影响面更大
 */
const handleDelete = async (row: DataInterfaceApi.DataInterfaceVO) => {
  const extra = row.hasWriteOperation
    ? '<br/><b style="color:#f56c6c">该接口含写操作，删除后依赖它的调用方会立即失败。</b>'
    : ''
  try {
    await ElMessageBox.confirm(
      `确认删除接口「${row.name}」吗？<br/>版本历史会一并删除，此操作不可恢复。${extra}`,
      '删除确认',
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
  await DataInterfaceApi.deleteDataInterface(row.id)
  message.success(t('common.delSuccess'))
  await getList()
}

onMounted(async () => {
  typeOptions.value = await DataInterfaceApi.getTypeOptions()
  statementTypeOptions.value = await DataInterfaceApi.getStatementTypeOptions()
  await getList()
})
</script>
