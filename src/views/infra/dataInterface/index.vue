<template>
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
          <Icon icon="ep:plus" class="mr-5px" /> 新建接口
        </el-button>
        <el-button plain @click="openLog()">
          <Icon icon="ep:document" class="mr-5px" /> 调用日志
        </el-button>
      </el-form-item>
    </el-form>
  </ContentWrap>

  <ContentWrap>
    <el-alert type="warning" :closable="false" show-icon class="mb-10px">
      <template #title>
        接口里的 SQL 会<b>直接对数据库执行</b>。系统已自动为每条语句注入租户条件，
        并禁止 DDL 与对系统内置表的写操作；但<b>含写操作的接口仍会真实修改数据</b>，请谨慎配置。
      </template>
    </el-alert>
    <el-table class="xpy-list-table" stripe v-loading="loading" :data="list">
      <el-table-column label="序号" type="index" width="44" align="center" :index="indexMethod(queryParams)" class-name="col-index"
        label-class-name="col-index"
      />
      <el-table-column label="编号" align="center" prop="id" width="70" />
      <el-table-column label="接口名称" prop="name" :show-overflow-tooltip="true" min-width="140" />
      <el-table-column label="接口编码" prop="code" :show-overflow-tooltip="true" min-width="140" />
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
          <span v-else class="text-gray-400">-</span>
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
      <el-table-column label="操作" align="center" width="230" fixed="right">
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

  <DataInterfaceForm ref="formRef" @success="getList" />
  <PreviewPanel ref="previewRef" />
  <VersionList ref="versionRef" @success="getList" />
  <LogList ref="logRef" />
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

/** 打开配置表单 */
const formRef = ref()
const openForm = (type: string, id?: number) => {
  formRef.value.open(type, id)
}

/** 打开预览 */
const previewRef = ref()
const openPreview = (row: DataInterfaceApi.DataInterfaceVO) => {
  previewRef.value.open(row)
}

/** 打开版本历史 */
const versionRef = ref()
const openVersion = (row: DataInterfaceApi.DataInterfaceVO) => {
  versionRef.value.open(row)
}

/** 打开调用日志 */
const logRef = ref()
const openLog = (interfaceId?: number) => {
  logRef.value.open(interfaceId)
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
