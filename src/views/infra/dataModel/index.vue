<template>
  <!-- 列表视图 -->
  <template v-if="viewMode === 'list'">
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
      </el-form-item>
    </el-form>
  </ContentWrap>

  <!-- 列表 -->
  <ContentWrap>
    <el-alert type="warning" :closable="false" show-icon class="mb-10px">
      <template #title>
        数据建模会<b>直接修改数据库真实表结构</b>，且数据库 的 DDL <b>无法回滚</b>。
        改表前请先点「预览 DDL」确认将要执行的语句。
        <!--
          系统内置表这一句原来挂在「删除」按钮的 el-tooltip 上（「系统内置表，禁止通过数据建模删除」）。
          操作列换成 TableActions 后单元格内部由组件渲染，页面没地方再套 tooltip；
          而 tooltip 要包住 disabled 的按钮必须额外套一层 span，那层 span 会打断
          styles/index.scss 里 .el-button + .el-button 的相邻选择器、让整排按钮贴在一起。
          搬到页头 alert 是净赚：不用悬停就能看见，也不影响按钮间距。
          前缀名单由后端 SystemTablePolicy 下发，所以这里不写死具体前缀。
        -->
        系统内置表的「删除」按钮会置灰，这类表不能通过数据建模删除。
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
      <!-- 实测：设计 数据 DDL日志 删除 = 224px（含 .cell 左右内边距），220 会折行 -->
      <el-table-column label="操作" align="center" width="230" fixed="right">
        <template #default="scope">
          <TableActions :row="scope.row" :buttons="rowButtons" />
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

  <!-- 页内视图：模型设计 / 新建（内容较多，不用弹窗） -->
  <DataModelForm v-else ref="formRef" @success="handleFormDone" @cancel="handleFormDone" />

  <!-- 弹窗：导入已有表 -->
  <DataModelImportForm ref="importFormRef" @success="getList" />
  <!-- 弹窗：DDL 日志（按模型查看） -->
  <DataModelLogList ref="logRef" />
</template>

<script lang="ts" setup>
import { ElMessageBox } from 'element-plus'
import { dateFormatter } from '@/utils/formatTime'
import * as DataModelApi from '@/api/infra/dataModel'
import DataModelForm from './DataModelForm.vue'
import DataModelImportForm from './DataModelImportForm.vue'
import DataModelLogList from './DataModelLogList.vue'
import type { TableActionButton } from '@/components/TableActions'

/** 数据建模列表 */
defineOptions({ name: 'InfraDataModel' })

const message = useMessage()
const { t } = useI18n()
const { push } = useRouter() // 路由跳转

/**
 * 系统内置表前缀，页面初始化时从后端拉取（`/infra/data-model/list-system-table-prefix`）。
 *
 * 此前这里硬编码了一份，与后端 SqlSafeGuard 的名单两处维护 —— 后端新增 qrtz_/flw_ 时
 * 前端漏跟就会出现「按钮能点、点了报错」。现在唯一来源是后端的 SystemTablePolicy。
 *
 * 前端仅用于「禁用删除按钮 + 提示」，后端 deleteDataModel 仍会二次拦截，双保险。
 * 拉取失败时按空数组处理：不误禁按钮，真正的拦截交给后端。
 */
const frameworkTablePrefixes = ref<string[]>([])
const isFrameworkTable = (tableName?: string) => {
  const name = (tableName || '').toLowerCase()
  return frameworkTablePrefixes.value.some((prefix) => name.startsWith(prefix))
}

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

/** 视图切换：列表 / 页内设计表单 */
const viewMode = ref<'list' | 'form'>('list')

/** 打开模型设计（页内视图，内容较多不用弹窗） */
const formRef = ref()
const openForm = async (type: string, id?: number) => {
  viewMode.value = 'form'
  // 等表单组件挂载后再灌数据
  await nextTick()
  formRef.value?.open(type, id)
}

/** 表单保存成功或取消：回到列表并刷新 */
const handleFormDone = () => {
  viewMode.value = 'list'
  getList()
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

/** 打开某个模型的 DDL 日志（按表名过滤） */
const logRef = ref()
const openLog = (row: DataModelApi.DataModelVO) => {
  logRef.value.open(row.tableName)
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
    // 只删登记时把「表还在」说清楚。不说的话它就成了一张孤儿表：
    // 列表上再也看不到，下次建同名表才会撞上，而那时已经很难想起它是怎么来的
    if (dropTable) {
      message.success(t('common.delSuccess'))
    } else {
      message.success(
        `模型登记已删除。数据库中的表 ${row.tableName} 仍然保留 —— ` +
          `需要再次使用时，用「导入已有表」把它登记回来即可，不要新建同名表`
      )
    }
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

const rowButtons: TableActionButton[] = [
  {
    key: 'design',
    label: '设计',
    permission: ['infra:data-model:update'],
    onClick: (row) => openForm('update', row.id)
  },
  {
    key: 'data',
    label: '数据',
    permission: ['infra:data-model-data:query'],
    onClick: (row) => openPreview(row)
  },
  {
    key: 'log',
    label: 'DDL日志',
    permission: ['infra:data-model:query'],
    onClick: (row) => openLog(row)
  },
  {
    key: 'delete',
    label: '删除',
    type: 'danger',
    divided: true,
    permission: ['infra:data-model:delete'],
    disabled: (row) => isFrameworkTable(row.tableName),
    onClick: (row) => handleDelete(row)
  }
]

onMounted(async () => {
  // 前缀名单拉取失败不应拖垮列表页 —— 失败时按空数组走，拦截交给后端
  try {
    frameworkTablePrefixes.value = await DataModelApi.getSystemTablePrefixes()
  } catch {
    frameworkTablePrefixes.value = []
  }
  getList()
})
</script>
