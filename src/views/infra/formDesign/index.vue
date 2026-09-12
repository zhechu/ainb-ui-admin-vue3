<template>
  <!-- 搜索栏 -->
  <ContentWrap>
    <el-form
      ref="queryFormRef"
      :inline="true"
      :model="queryParams"
      class="-mb-15px"
      label-width="80px"
    >
      <el-form-item label="表单名称" prop="name">
        <el-input
          v-model="queryParams.name"
          class="!w-240px"
          clearable
          placeholder="请输入表单名称"
          @keyup.enter="handleQuery"
        />
      </el-form-item>
      <el-form-item label="表单编码" prop="code">
        <el-input
          v-model="queryParams.code"
          class="!w-240px"
          clearable
          placeholder="请输入表单编码"
          @keyup.enter="handleQuery"
        />
      </el-form-item>
      <el-form-item label="分类" prop="category">
        <el-select v-model="queryParams.category" class="!w-160px" clearable placeholder="全部">
          <el-option
            v-for="dict in getStrDictOptions(DICT_TYPE.INFRA_FORM_DESIGN_CATEGORY)"
            :key="dict.value"
            :label="dict.label"
            :value="dict.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="表单类型" prop="formType">
        <el-select v-model="queryParams.formType" class="!w-160px" clearable placeholder="全部">
          <el-option
            v-for="item in FORM_TYPE_OPTIONS"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="状态" prop="status">
        <el-select v-model="queryParams.status" class="!w-160px" clearable placeholder="全部">
          <el-option
            v-for="item in STATUS_OPTIONS"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-button @click="handleQuery">
          <Icon class="mr-5px" icon="ep:search" />
          搜索
        </el-button>
        <el-button @click="resetQuery">
          <Icon class="mr-5px" icon="ep:refresh" />
          重置
        </el-button>
        <el-button
          v-hasPermi="['infra:form-design:create']"
          plain
          type="primary"
          @click="handleCreate"
        >
          <Icon class="mr-5px" icon="ep:plus" />
          新增
        </el-button>
      </el-form-item>
    </el-form>
  </ContentWrap>

  <!-- 列表 -->
  <ContentWrap>
    <el-table v-loading="loading" :data="list" class="form-design-table" stripe>
      <!--
        序号列

        取代原来的「编号」列：那一列显示的是数据库自增主键，对用户没有意义
        （他既不会拿它去查什么，也不会在别处引用到它），却占着第一列的位置。
        序号按分页连续编号 —— 第二页第一行是 21 而不是重新从 1 开始，
        否则「第 37 条那个」在页与页之间对不上。
      -->
      <el-table-column align="center" label="序号" width="70">
        <template #default="scope">
          {{ (queryParams.pageNo - 1) * queryParams.pageSize + scope.$index + 1 }}
        </template>
      </el-table-column>
      <el-table-column label="表单名称" prop="name" min-width="140" show-overflow-tooltip />
      <el-table-column label="表单编码" prop="code" min-width="140" show-overflow-tooltip />
      <el-table-column align="center" label="分类" prop="category" width="110">
        <template #default="scope">
          <dict-tag
            v-if="scope.row.category"
            :type="DICT_TYPE.INFRA_FORM_DESIGN_CATEGORY"
            :value="scope.row.category"
          />
          <span v-else>-</span>
        </template>
      </el-table-column>
      <el-table-column align="center" label="表单类型" prop="formType" width="110">
        <template #default="scope">
          {{ formatFormType(scope.row.formType) }}
        </template>
      </el-table-column>
      <el-table-column align="center" label="绑定主表" prop="mainTable" min-width="140">
        <template #default="scope">
          <span v-if="scope.row.mainTable">{{ scope.row.mainTable }}</span>
          <el-text v-else size="small" type="info">未绑定</el-text>
        </template>
      </el-table-column>
      <el-table-column align="center" label="状态" prop="status" width="120">
        <template #default="scope">
          <el-tag :type="statusTagType(scope.row.status)" size="small">
            {{ formatStatus(scope.row.status) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column align="center" label="线上版本" prop="publishedVersion" width="90">
        <template #default="scope">
          <span v-if="scope.row.publishedVersion > 0">v{{ scope.row.publishedVersion }}</span>
          <span v-else>-</span>
        </template>
      </el-table-column>
      <el-table-column
        :formatter="dateFormatter"
        align="center"
        label="创建时间"
        prop="createTime"
        width="170"
      />
      <el-table-column align="center" fixed="right" label="操作" width="280">
        <template #default="scope">
          <el-button
            v-hasPermi="['infra:form-design:update']"
            link
            type="primary"
            @click="handleUpdate(scope.row.id)"
          >
            设计
          </el-button>
          <el-button
            v-hasPermi="['infra:form-design:publish']"
            link
            type="success"
            @click="handlePublish(scope.row)"
          >
            发布
          </el-button>
          <el-button
            v-hasPermi="['infra:form-design:query']"
            link
            @click="handleVersion(scope.row)"
          >
            版本
          </el-button>
          <el-dropdown @command="(cmd: string) => handleCommand(cmd, scope.row)">
            <el-button link type="primary">
              更多<Icon icon="ep:arrow-down" class="ml-2px" />
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="copy">复制</el-dropdown-item>
                <el-dropdown-item v-if="scope.row.menuId" command="unpublish">
                  下线
                </el-dropdown-item>
                <el-dropdown-item command="delete" divided>删除</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </template>
      </el-table-column>
    </el-table>

    <!-- 分页 -->
    <Pagination
      v-model:limit="queryParams.pageSize"
      v-model:page="queryParams.pageNo"
      :total="total"
      @pagination="getList"
    />
  </ContentWrap>

  <!-- 发布弹窗 -->
  <PublishDialog ref="publishDialogRef" @success="getList" />

  <!-- 版本历史抽屉 -->
  <VersionDrawer ref="versionDrawerRef" @success="getList" />
</template>

<script lang="ts" setup>
import { DICT_TYPE, getStrDictOptions } from '@/utils/dict'
import { dateFormatter } from '@/utils/formatTime'
import * as FormDesignApi from '@/api/infra/formDesign'
import * as MenuApi from '@/api/system/menu'
import PublishDialog from './components/PublishDialog.vue'
import VersionDrawer from './components/VersionDrawer.vue'

defineOptions({ name: 'InfraFormDesign' })

const message = useMessage()
const { t } = useI18n()
const { push } = useRouter()

/** 表单类型：与后端 FormTypeEnum 对应 */
const FORM_TYPE_OPTIONS = [
  { value: 1, label: '纯表单' },
  { value: 2, label: '表单+列表' }
]

/** 状态：与后端 FormDesignStatusEnum 对应 */
const STATUS_OPTIONS = [
  { value: 0, label: '草稿' },
  { value: 1, label: '已发布' },
  { value: 2, label: '已发布有改动' }
]

const loading = ref(true)
const list = ref<FormDesignApi.FormDesignVO[]>([])
const total = ref(0)
const queryFormRef = ref()
const queryParams = reactive({
  pageNo: 1,
  pageSize: 20,
  name: undefined,
  code: undefined,
  category: undefined,
  formType: undefined,
  status: undefined
})

const formatFormType = (formType: number) =>
  FORM_TYPE_OPTIONS.find((item) => item.value === formType)?.label ?? '-'

const formatStatus = (status: number) =>
  STATUS_OPTIONS.find((item) => item.value === status)?.label ?? '-'

/** 「已发布有改动」用 warning 提示用户草稿与线上不一致，需重新发布才生效 */
const statusTagType = (status: number) => {
  if (status === 1) return 'success'
  if (status === 2) return 'warning'
  return 'info'
}

const getList = async () => {
  loading.value = true
  try {
    const data = await FormDesignApi.getFormDesignPage(queryParams)
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

/** 新增：跳转到设计器 */
const handleCreate = () => {
  push({ name: 'InfraFormDesignEditor' })
}

/** 设计：跳转到设计器并带上编号 */
const handleUpdate = (id: number) => {
  push({ name: 'InfraFormDesignEditor', query: { id } })
}

const publishDialogRef = ref()
const versionDrawerRef = ref()

const handlePublish = (row: FormDesignApi.FormDesignVO) => {
  publishDialogRef.value?.open(row)
}

const handleVersion = (row: FormDesignApi.FormDesignVO) => {
  versionDrawerRef.value?.open(row)
}

/** 下拉菜单的命令分发 */
const handleCommand = (command: string, row: FormDesignApi.FormDesignVO) => {
  if (command === 'copy') {
    handleCopy(row)
  } else if (command === 'unpublish') {
    handleUnpublish(row)
  } else if (command === 'delete') {
    handleDelete(row)
  }
}

/**
 * 下线：同样是两步操作
 *
 * 后端清掉线上版本号与菜单关联并返回菜单编号，前端再逐个调 /system/menu/delete。
 * 用户可能手工删过这些菜单，所以删除失败要容错跳过而不是中断整个流程。
 */
const handleUnpublish = async (row: FormDesignApi.FormDesignVO) => {
  try {
    await message.confirm(
      `确认下线表单「${row.name}」吗？会删除它生成的菜单与按钮权限，表单状态回到草稿。`
    )
    const menuIds = await FormDesignApi.unpublishFormDesign(row.id)
    let failedCount = 0
    for (const menuId of menuIds) {
      try {
        await MenuApi.deleteMenu(menuId)
      } catch (e) {
        // 菜单可能已被用户手工删除，容错跳过
        failedCount++
        console.warn(`删除菜单 ${menuId} 失败，可能已不存在`, e)
      }
    }
    if (failedCount > 0) {
      message.warning(`已下线，但有 ${failedCount} 个菜单删除失败（可能已被手工删除）`)
    } else {
      message.success('下线成功')
    }
    await getList()
  } catch {}
}

const handleCopy = async (row: FormDesignApi.FormDesignVO) => {
  try {
    await message.confirm(`确认复制表单「${row.name}」吗？副本为草稿状态，不会继承菜单与版本历史。`)
    await FormDesignApi.copyFormDesign(row.id)
    message.success('复制成功')
    await getList()
  } catch {}
}

const handleDelete = async (row: FormDesignApi.FormDesignVO) => {
  try {
    // 已发布的表单会连带回收菜单与按钮权限，提示得更明确些
    if (row.status !== 0) {
      await message.confirm(
        `表单「${row.name}」已发布，删除会同时回收它生成的菜单与按钮权限，确认删除吗？`
      )
    } else {
      await message.delConfirm()
    }
    await FormDesignApi.deleteFormDesign(row.id)
    message.success(t('common.delSuccess'))
    await getList()
  } catch {}
}

onMounted(() => {
  getList()
})
</script>

<style lang="scss" scoped>
/*
  行高与分隔

  这张表的单元格基本都是短文本（表单名、编码、表名）与小号标签，
  没有任何一格会把行撑开，于是整张表挤成一叠细线，扫读时容易串行。

  ⚠️ 选择器为什么要这么写

  ContentWrap 给它包住的**所有**列表页定了一条
  `.content-wrap[data-v-x] .el-table--default .el-table__cell { padding: 4px }`，
  权重是 (0,4,0)。写成 `.form-design-table :deep(.el-table__cell)` 只有 (0,3,0)，
  会被它整条盖掉 —— 这里原先那版 12px 的内边距其实从来没生效过，
  行高一直是 31px。重复一次类名把权重抬到 (0,5,0)，
  比 !important 更容易在 DevTools 里看明白是谁盖了谁。

  只改本模块、不动 ContentWrap：那条规则作用于系统里每一个列表页，
  在这里顺手改掉等于替所有模块做了决定。

  表头压一层浅底色、隔行浅色，是同一件事的另外两半：
  不然滚动时表头会「混进」第一行，横向扫一行十列时也容易串到上下行去。
*/
.form-design-table.form-design-table.el-table--default :deep(.el-table__cell) {
  padding-top: 14px;
  padding-bottom: 14px;
}

.form-design-table :deep(.el-table__header-wrapper th) {
  font-weight: 600;
  color: var(--el-text-color-primary);
  background-color: var(--el-fill-color-light);
}

.form-design-table :deep(.el-table__row--striped .el-table__cell) {
  background-color: var(--el-fill-color-lighter);
}

/* 操作列里几个 link 按钮之间留出间距，避免「设计发布版本更多」连成一串 */
.form-design-table :deep(.el-button + .el-button),
.form-design-table :deep(.el-button + .el-dropdown) {
  margin-left: 12px;
}
</style>
