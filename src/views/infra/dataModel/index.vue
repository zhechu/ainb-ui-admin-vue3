<template>
  <ContentWrap>
    <!-- 搜索工作栏 -->
    <el-form
      class="-mb-15px"
      :model="queryParams"
      ref="queryFormRef"
      :inline="true"
      label-width="68px"
    >
      <el-form-item label="表名" prop="tableName">
        <el-input
          v-model="queryParams.tableName"
          placeholder="请输入表名"
          clearable
          @keyup.enter="handleQuery"
          class="!w-240px"
        />
      </el-form-item>
      <el-form-item label="模型名称" prop="modelName">
        <el-input
          v-model="queryParams.modelName"
          placeholder="请输入模型名称"
          clearable
          @keyup.enter="handleQuery"
          class="!w-240px"
        />
      </el-form-item>
      <el-form-item>
        <el-button @click="handleQuery"><Icon icon="ep:search" class="mr-5px" /> 搜索</el-button>
        <el-button @click="resetQuery"><Icon icon="ep:refresh" class="mr-5px" /> 重置</el-button>
        <el-button
          type="primary"
          plain
          @click="openForm('create')"
          v-hasPermi="['infra:data-model:create']"
        >
          <Icon icon="ep:plus" class="mr-5px" /> 新建模型
        </el-button>
        <el-button
          type="success"
          plain
          @click="openImport"
          v-hasPermi="['infra:data-model:create']"
        >
          <Icon icon="ep:download" class="mr-5px" /> 导入已有表
        </el-button>
        <el-button plain @click="openLog"
          ><Icon icon="ep:document" class="mr-5px" /> DDL 日志</el-button
        >
      </el-form-item>
    </el-form>
  </ContentWrap>

  <!-- 列表 -->
  <ContentWrap>
    <el-alert type="warning" :closable="false" show-icon class="mb-10px">
      <template #title>
        数据建模会<b>直接修改数据库真实表结构</b>，且数据库 的 DDL <b>无法回滚</b>。
        改表前请先点「预览 DDL」确认将要执行的语句。
      </template>
    </el-alert>
    <el-table class="xpy-list-table" stripe v-loading="loading" :data="list">
      <el-table-column label="序号" type="index" width="44" align="center" :index="indexMethod(queryParams)" class-name="col-index"
        label-class-name="col-index"
      />
      <el-table-column label="编号" align="center" prop="id" width="80" />
      <!--
        列宽分配：文本列（模型名称/表名/表描述/备注）用 min-width 弹性伸展，
        吃掉操作列、时间列让出来的空间；创建时间、操作给固定宽，
        避免时间列比模型名称还宽、操作列三个链接按钮却占三百多像素
      -->
      <el-table-column
        label="模型名称"
        align="center"
        prop="modelName"
        min-width="150"
        :show-overflow-tooltip="true"
      />
      <el-table-column
        label="表名"
        align="center"
        prop="tableName"
        min-width="150"
        :show-overflow-tooltip="true"
      />
      <el-table-column
        label="表描述"
        align="center"
        prop="tableComment"
        min-width="130"
        :show-overflow-tooltip="true"
      />
      <el-table-column
        label="备注"
        align="center"
        prop="remark"
        min-width="100"
        :show-overflow-tooltip="true"
      />
      <el-table-column
        label="创建时间"
        align="center"
        prop="createTime"
        width="165"
        :formatter="dateFormatter"
      />
      <el-table-column label="操作" align="center" width="180" fixed="right">
        <template #default="scope">
          <el-button
            link
            type="primary"
            @click="openForm('update', scope.row.id)"
            v-hasPermi="['infra:data-model:update']"
          >
            设计
          </el-button>
          <el-button
            link
            type="primary"
            @click="openPreview(scope.row)"
            v-hasPermi="['infra:data-model-data:query']"
          >
            数据
          </el-button>
          <el-button
            link
            type="danger"
            @click="handleDelete(scope.row)"
            v-hasPermi="['infra:data-model:delete']"
          >
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

  <!-- 弹窗：模型设计（表结构编辑） -->
  <DataModelForm ref="formRef" @success="getList" />
  <!-- 弹窗：导入已有表 -->
  <DataModelImportForm ref="importFormRef" @success="getList" />
  <!-- 弹窗：DDL 日志 -->
  <DataModelLogList ref="logRef" />
</template>

<script lang="ts" setup>
import { ElMessageBox } from 'element-plus'
import { dateFormatter } from '@/utils/formatTime'
import * as DataModelApi from '@/api/infra/dataModel'
import DataModelForm from './DataModelForm.vue'
import DataModelImportForm from './DataModelImportForm.vue'
import DataModelLogList from './DataModelLogList.vue'

/** 数据建模列表 */
defineOptions({ name: 'InfraDataModel' })

const message = useMessage()
const { t } = useI18n()
const { push } = useRouter() // 路由跳转

/**
 * 支持 HTML 的确认框
 *
 * 内容里的换行与强调标记需要 dangerouslyUseHTMLString 才会渲染。
 * 这里的内容全部由本页面拼装，表名来自后端已校验的模型登记，不含用户自由输入，
 * 因此不存在 XSS 风险。
 */
const confirmHtml = (content: string, title: string) => {
  return ElMessageBox.confirm(content, title, {
    confirmButtonText: t('common.ok'),
    cancelButtonText: t('common.cancel'),
    type: 'warning',
    dangerouslyUseHTMLString: true
  })
}

const loading = ref(true)
const list = ref<DataModelApi.DataModelVO[]>([])
const total = ref(0)
const queryParams = reactive({
  pageNo: 1,
  pageSize: 20,
  tableName: undefined,
  modelName: undefined
})
const queryFormRef = ref()

/** 查询列表 */
const getList = async () => {
  loading.value = true
  try {
    const data = await DataModelApi.getDataModelPage(queryParams)
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

/** 打开模型设计弹窗 */
const formRef = ref()
const openForm = (type: string, id?: number) => {
  formRef.value.open(type, id)
}

/** 打开导入弹窗 */
const importFormRef = ref()
const openImport = () => {
  importFormRef.value.open()
}

/** 跳转到业务数据页，并直接定位到该模型 */
const openPreview = (row: DataModelApi.DataModelVO) => {
  push({ name: 'InfraDataModelData', query: { modelId: row.id } })
}

/** 打开 DDL 日志 */
const logRef = ref()
const openLog = () => {
  logRef.value.open()
}

/** 删除模型
 *
 * 分两步问：先问删不删、再问要不要连真实表一起删。
 * 默认只删登记（保留真实表），这是不会丢数据的安全选项。
 *
 * 这里直接用 ElMessageBox 而非 message.confirm：后者没有开启
 * dangerouslyUseHTMLString，`<br/>` 与 `<b>` 会被当纯文本显示。
 * 不去改公共 hook，避免影响其它页面。
 */
const handleDelete = async (row: DataModelApi.DataModelVO) => {
  let dropTable = false
  try {
    // 第一步：是否连真实表一起删
    await confirmHtml(
      `确认删除模型「${row.modelName}」吗？<br/>点击「确定」仅删除模型登记，保留数据库中的表 ${row.tableName}。`,
      '删除确认'
    )
  } catch {
    return
  }
  // 第二步：询问是否顺带删表
  try {
    await confirmHtml(
      `是否<b style="color:#f56c6c">同时删除数据库中的真实表 ${row.tableName}</b>？<br/>` +
        `此操作会丢失该表全部数据，且<b>无法回滚</b>。<br/>点击「取消」则仅删除模型登记。`,
      '高危操作'
    )
    dropTable = true
  } catch {
    dropTable = false
  }

  try {
    await DataModelApi.deleteDataModel(row.id, dropTable, false)
    message.success(t('common.delSuccess'))
    await getList()
  } catch (error: any) {
    // 后端在表中有数据时会要求二次确认风险，这里承接该提示
    const msg = error?.msg || ''
    if (dropTable && msg.includes('我已知晓风险')) {
      await confirmHtml(`${msg}<br/><br/>确认继续删除？`, '再次确认')
      await DataModelApi.deleteDataModel(row.id, true, true)
      message.success(t('common.delSuccess'))
      await getList()
    }
  }
}

onMounted(() => {
  getList()
})
</script>
