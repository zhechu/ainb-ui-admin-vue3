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
    <el-table v-loading="loading" :data="list" class="xpy-list-table" stripe>
      <el-table-column
        label="序号"
        type="index"
        width="44"
        align="center"
        class-name="col-index"
        label-class-name="col-index"
        :index="indexMethod(queryParams)"
      />
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
      <el-table-column align="center" fixed="right" label="操作" width="220">
        <!--
          本页的「更多」曾是全站样式标杆（hover 触发、link primary 触发器、纯文字下拉项、
          删除项 divided）。那段标杆写法已收进 TableActions，浏览器实测两者计算样式逐字一致，
          所以这里换组件不换观感
        -->
        <template #default="scope">
          <TableActions :row="scope.row" :buttons="rowButtons" />
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
import type { TableActionButton } from '@/components/TableActions'
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

/**
 * 操作列按钮清单。下拉里的三项原来不带权限门控（复制/下线/删除谁都能点），
 * 搬进清单后保持不门控：permission 不传 = 不门控，与组件口径一致
 */
const rowButtons: TableActionButton[] = [
  {
    key: 'update',
    label: '设计',
    permission: ['infra:form-design:update'],
    onClick: (row) => handleUpdate(row.id)
  },
  {
    key: 'publish',
    label: '发布',
    type: 'success',
    permission: ['infra:form-design:publish'],
    onClick: (row) => handlePublish(row)
  },
  {
    key: 'version',
    label: '版本',
    permission: ['infra:form-design:query'],
    onClick: (row) => handleVersion(row)
  },
  { key: 'copy', label: '复制', onClick: (row) => handleCopy(row) },
  {
    key: 'unpublish',
    label: '下线',
    show: (row) => !!row.menuId,
    onClick: (row) => handleUnpublish(row)
  },
  {
    key: 'delete',
    label: '删除',
    type: 'danger',
    divided: true,
    onClick: (row) => handleDelete(row)
  }
]

/**
 * 下线：同样是两步操作
 *
 * 后端清掉线上版本号与菜单关联并返回菜单编号，前端再回收这些菜单。
 *
 * 🔴 回收必须用 delete-list 一次删整棵树，不能逐个调 /system/menu/delete。
 *    menuIds 的顺序就是 infra_form_design_menu 的插入顺序，而 bindMenu 是先插父菜单再插按钮，
 *    所以**父菜单永远排在第一个**；MenuServiceImpl#deleteMenu 一见「还有子菜单」就抛
 *    MENU_EXISTS_CHILDREN。逐个删的必然结果是：第一个（父菜单）失败、7 个按钮随后删光，
 *    侧边栏里留下一棵点得开却什么都不是的孤儿父菜单，而且没有任何东西拦住它 ——
 *    旧代码把这个失败算进 failedCount，然后提示「可能已被手工删除」，把真因说反了。
 *    库里有实证：「图书借阅登记」的 7 个按钮在 2026-10-13 01:25:07~09 被这个循环删掉，
 *    父菜单却直到 01:32:49 才消失，且与另外 7 个父菜单**同一秒** ——
 *    那是有人受不了了，去菜单管理页手工批量清理的。
 *    delete-list 的判据刻意排除了「同批一起被选中」的子菜单（见 MenuServiceImpl#deleteMenuList），
 *    正是为删一整棵子树写的；顺带少了 7 个来回，整棵树在一个事务里同生共死。
 *
 * ⚠️ 「用户已经手工删过这些菜单」这个原本要容错的场景照样容错：
 *    delete-list 不像单删那样校验存在性，deleteByIds 对不存在的行只是命中 0 行。
 */
const handleUnpublish = async (row: FormDesignApi.FormDesignVO) => {
  try {
    await message.confirm(
      `确认下线表单「${row.name}」吗？会删除它生成的菜单与按钮权限，表单状态回到草稿。`
    )
  } catch {
    return // 用户点了取消
  }
  let menuIds: number[]
  try {
    menuIds = await FormDesignApi.unpublishFormDesign(row.id)
  } catch {
    // 后端事务回滚了，表单侧什么都没变。错误提示由 axios 拦截器给，这里只把列表刷回真实状态
    await getList()
    return
  }
  try {
    // 空数组不能发这个请求：join 出来是空串，后端 @RequestParam List<Long> 绑不上
    if (menuIds?.length) {
      await MenuApi.deleteMenuList(menuIds)
    }
    message.success('下线成功')
  } catch {
    // 🔴 到这一步表单侧【已经下线并提交】（unpublish 是它自己的事务，早已提交），菜单却还活着。
    //    绝不能报「下线成功」，也绝不能像旧代码那样报「可能已被手工删除」——
    //    必须直说菜单没回收掉、去哪儿收拾，否则用户看到的就是一棵莫名多出来的孤儿菜单树。
    message.error(
      `表单已下线，但菜单回收失败：请到「系统管理 → 菜单管理」手工删除「${row.name}」及其按钮权限`
    )
  }
  await getList()
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
    // 已关联菜单的表单后端会拒绝删除（菜单只能由「下线」流程回收），
    // 这里直接拦下并指路，而不是让用户白点一次再吃接口报错
    if (row.menuId) {
      message.alertWarning(
        `表单「${row.name}」已发布并关联菜单，不能直接删除。` +
          `请先在「更多」中执行「下线」回收菜单与按钮权限，再删除表单`
      )
      return
    }
    if (row.status !== 0) {
      await message.confirm(
        `表单「${row.name}」已发布（未关联菜单），删除会同时清除它的版本历史，确认删除吗？`
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
  // 空闲时预热编辑器 chunk。用户点「编辑」/「新增」时几乎瞬时打开。
  // 失败静默吞掉 —— 预热失败不该在控制台留一条刺眼的 unhandled rejection，
  // 真正点进去时路由自己的动态 import 还会再试一次
  const preload = () => import('./editor/index.vue').catch(() => {})
  if ('requestIdleCallback' in window) {
    ;(window as any).requestIdleCallback(preload, { timeout: 3000 })
  } else {
    setTimeout(preload, 1500)
  }
})
</script>
