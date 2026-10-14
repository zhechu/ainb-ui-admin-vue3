<template>
  <!-- 列表视图：新增/测试/版本/日志都是内容较多的页内视图，切换时整页替换 -->
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
      <!--
        界面叫「来源」，代码里仍叫 category、字典类型仍是 infra_form_type —— 刻意不跟着改。
        这三个标识符已经是对外契约的一部分：/infra/data-interface/page 的查询参数、
        DataInterfaceSaveReqVO 的字段、agent 工具层的参数名都叫 category，
        改名要连带动前端 api、后端 VO、agent DSL 与存量数据，收益却只是「代码读起来顺一点」。
        标识符是给代码看的，文案是给人看的，两者在这里分家
      -->
      <el-form-item label="来源" prop="category">
        <el-select v-model="queryParams.category" placeholder="全部" clearable class="!w-120px">
          <el-option
            v-for="dict in getStrDictOptions(DICT_TYPE.INFRA_FORM_TYPE)"
            :key="dict.value"
            :label="dict.label"
            :value="dict.value"
          />
        </el-select>
      </el-form-item>
      <!--
        标签只能单选，不是漏做了多选：库里 tags 是逗号串，查询走 FIND_IN_SET，
        多选要拼成 OR 条件，而 FIND_IN_SET 用不上索引 —— 一张只有几行的表也就算了，
        真长大以后这条查询会先垮。「按某一个标签筛」是这个字段的主要用法，单选够用
      -->
      <el-form-item label="标签" prop="tag">
        <el-select v-model="queryParams.tag" placeholder="全部" clearable class="!w-140px">
          <el-option
            v-for="dict in getStrDictOptions(DICT_TYPE.INFRA_DATA_INTERFACE_TAG)"
            :key="dict.value"
            :label="dict.label"
            :value="dict.value"
          />
        </el-select>
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
        <!--
          工具栏「调用日志」查全部接口的流水，行内「日志」锁定单个接口，两者互补：
          行内按钮答「这个接口怎么了」，工具栏按钮答「刚才谁在调什么」。
          全局流水确实可能刷不完，所以面板默认只查近 7 天，且时间区间必填、跨度不超过 3 个月

          v-hasPermi 与行内「日志」按钮同判据（后端 /log-page 上要 infra:data-interface:query）。
          前端不预判权限会让没权限的人也看到这个按钮，点下去吃一个 403
        -->
        <el-button plain @click="openLog()" v-hasPermi="['infra:data-interface:query']">
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
      <!--
        这里原本有一列「编号」（prop="id"，70px），已去掉：接口是拿 code 调的，
        数据库自增 id 对使用者没有任何意义，序号列已经足够定位「第几行」。
        真要看 id，配置页的 URL 与版本历史里都有
      -->
      <el-table-column label="接口名称" prop="name" :show-overflow-tooltip="true" min-width="140" />
      <el-table-column label="接口编码" prop="code" :show-overflow-tooltip="true" min-width="140" />
      <el-table-column label="责任人" prop="owner" align="center" width="100" :show-overflow-tooltip="true" />
      <!--
        「来源」表示这个接口是取系统内部的数据还是外部系统的（字典 infra_form_type，
        当前只有 内部 / 外部 两项，将来加 CRM 等系统只需在字典里加一项，无需改代码）。

        90px 是按 2 个汉字算的：2 字 ≈ 28px，加 el-tag 内边距与 .cell 左右内边距 24px，
        90px 足够且不折行。这一列曾经要 120px —— 那时它是自由文本，库里存着
        「表单设计示例」这种 6 字值，100px 下会折成 2 行把整排行高从 41px 撑到 63px。
        存量值已统一迁到 internal，那个宽度就没必要了。

        ⚠️ 往字典里加「CRM系统」这类 4 字以上的标签名，90px 会重新折行 ——
        tooltip 只兜住被裁的文本，兜不住行高。加之前先量一下，或把 width 换成 min-width
      -->
      <el-table-column label="来源" align="center" width="90" :show-overflow-tooltip="true">
        <template #default="{ row }">
          <dict-tag v-if="row.category" :type="DICT_TYPE.INFRA_FORM_TYPE" :value="row.category" />
          <span v-else class="text-[var(--el-text-color-secondary)]">-</span>
        </template>
      </el-table-column>
      <!--
        标签刻意用 v-for 一个个渲染，而不是把整个数组丢给 dict-tag。
        dict-tag 的 value 是支持数组的（见 DictTag.vue 的 valueArr），但它的根节点是
        display:inline-flex 且没有 flex-wrap —— 三四个标签会横着冲出单元格被 .cell 裁掉。
        一个个渲染时每个 dict-tag 都是独立的行内盒，能像 inline-block 一样自然折行。
        代价是标签多时行高会涨，这里认了：标签就是用来一眼扫的，截断比折行更糟。

        ⚠️ dict-tag 只渲染「字典里还存在」的值（它遍历的是字典项，不是传入值），
        所以管理员从字典里删掉某个标签后，打过这个标签的接口在列表上会少显示一个 —— 数据没丢，
        只是不显示。这是 DictTag 的既有行为，不是这一列的 bug
      -->
      <el-table-column label="标签" align="center" min-width="160">
        <template #default="{ row }">
          <template v-if="row.tags?.length">
            <dict-tag
              v-for="tag in row.tags"
              :key="tag"
              :type="DICT_TYPE.INFRA_DATA_INTERFACE_TAG"
              :value="tag"
              class="mx-2px my-1px"
            />
          </template>
          <span v-else class="text-[var(--el-text-color-secondary)]">-</span>
        </template>
      </el-table-column>
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
      <!--
        更新者在库里存的是 system_users.id（BaseDO.updater 由 MyBatis 元数据处理器写入
        getLoginUserId() 的字符串形式），直接展示是一串数字，管理员认不出是谁。
        这里换成「昵称（用户名）」，例如 超级管理员（admin）。

        180px 是浏览器实测值：现值最长「超级管理员（admin）」在 .cell 里 scrollWidth=164
        （含左右内边距 24px），原先按 160 写会差 6px 而出省略号；180 留 14px 余量，
        更长的昵称仍交给 tooltip
      -->
      <el-table-column
        label="更新者"
        align="center"
        prop="updater"
        width="180"
        :show-overflow-tooltip="true"
        :formatter="updaterFormatter"
      />
      <!--
        实测：折成「配置 预览 版本 + 更多」时需要 214px（含 .cell 左右内边距），200 会折行。
        「预览」后来改叫「测试」，两个都是 2 个汉字、同一字号，宽度不变，所以这个实测值继续适用，
        220 也不需要跟着调
      -->
      <el-table-column label="操作" align="center" width="220" fixed="right">
        <template #default="{ row }">
          <TableActions :row="row" :buttons="rowButtons" />
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

  <!-- 页内视图：配置表单 / 在线测试 / 版本历史 / 调用日志 -->
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
import { DICT_TYPE, getStrDictOptions } from '@/utils/dict'
import * as DataInterfaceApi from '@/api/infra/dataInterface'
import { useUserLabel } from '@/hooks/web/useUserLabel'
import DataInterfaceForm from './DataInterfaceForm.vue'
import PreviewPanel from './components/PreviewPanel.vue'
import VersionList from './VersionList.vue'
import LogList from './LogList.vue'
import type { TableActionButton } from '@/components/TableActions'

/** 接口管理列表（菜单原名「数据接口」） */
defineOptions({ name: 'InfraDataInterface' })

const message = useMessage()
const { t } = useI18n()

/**
 * 页内视图切换：list=列表，其余为整页替换的子视图。
 * 表单/测试/版本/日志内容都较多，弹窗放不下，参考数据模型页的做法
 *
 * viewMode 里的 'preview'、PreviewPanel、openPreview 这些标识符刻意不跟着按钮改叫 test：
 * 按钮文案是给人看的，标识符是给代码看的，改它要连带动文件名、组件名、API 路径，
 * 而 /infra/data-interface/preview 已经有前端 api、agent 工具等多处调用方。
 * 后端 DataInterfaceController#preview 上留了同一条说明
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
  category: undefined,
  tag: undefined,
  type: undefined,
  hasWriteOperation: undefined,
  sqlStatementType: undefined
})
const queryFormRef = ref()

/**
 * 「更新者」列的展示
 *
 * 库里存的是 system_users.id（BaseDO.updater 由 MyBatis 元数据处理器写入
 * getLoginUserId() 的字符串形式），直接展示是一串数字，管理员认不出是谁，
 * 这里换成「昵称（用户名）」，例如 超级管理员（admin）
 */
const { userFormatter: updaterFormatter } = useUserLabel('更新者')

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

/**
 * 打开调用日志
 *
 * row 为空时是工具栏入口：查全部接口的流水；带 row 时是行内入口：只看该接口。
 * LogList#open 两种都支持，靠 interfaceId 是否为 undefined 决定是否隐藏「接口编码」列与搜索项
 */
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

const rowButtons: TableActionButton[] = [
  {
    key: 'config',
    label: '配置',
    permission: ['infra:data-interface:update'],
    onClick: (row) => openForm('update', row.id)
  },
  {
    // key 仍是 preview：它是这一族按钮的稳定标识，改文案不动它。
    // 叫「测试」而不是「预览」是因为它真的会执行 —— 走的是与正式调用同一套逻辑，
    // 只是限制了返回条数并回传实际执行的 SQL。「预览」听起来不会动数据，
    // 而一个 UPDATE 接口点下去是真的会改库的。
    //
    // permission 只写 query 是刻意的：绝大多数接口是查询型，为它们要求写权限会把按钮整个藏掉。
    // 含写操作的那部分由后端 validatePreviewWritePermission 单独拦（要 write-sql 权限），
    // 面板里也会先弹确认。前端不预判权限，是为了避免与后端的判据各写一套而漂移
    key: 'preview',
    label: '测试',
    permission: ['infra:data-interface:query'],
    onClick: (row) => openPreview(row)
  },
  {
    key: 'version',
    label: '版本',
    permission: ['infra:data-interface:query'],
    onClick: (row) => openVersion(row)
  },
  {
    key: 'log',
    label: '日志',
    permission: ['infra:data-interface:query'],
    onClick: (row) => openLog(row)
  },
  {
    key: 'delete',
    label: '删除',
    type: 'danger',
    divided: true,
    permission: ['infra:data-interface:delete'],
    onClick: (row) => handleDelete(row)
  }
]

onMounted(async () => {
  typeOptions.value = await DataInterfaceApi.getTypeOptions()
  statementTypeOptions.value = await DataInterfaceApi.getStatementTypeOptions()
  await getList()
})
</script>
