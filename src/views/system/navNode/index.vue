<template>
  <!-- 搜索工作栏 -->
  <ContentWrap>
    <el-form
      ref="queryFormRef"
      :inline="true"
      :model="queryParams"
      class="-mb-15px"
      label-width="68px"
    >
      <el-form-item label="节点名称" prop="name">
        <el-input
          v-model="queryParams.name"
          class="!w-240px"
          clearable
          placeholder="请输入节点名称"
          @keyup.enter="handleQuery"
        />
      </el-form-item>
      <el-form-item label="节点类型" prop="nodeType">
        <el-select
          v-model="queryParams.nodeType"
          class="!w-240px"
          clearable
          placeholder="请选择节点类型"
        >
          <el-option
            v-for="opt in NAV_NODE_TYPE_OPTIONS"
            :key="opt.value"
            :label="opt.label"
            :value="opt.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="状态" prop="status">
        <el-select
          v-model="queryParams.status"
          class="!w-240px"
          clearable
          placeholder="请选择状态"
        >
          <el-option
            v-for="dict in getIntDictOptions(DICT_TYPE.COMMON_STATUS)"
            :key="dict.value"
            :label="dict.label"
            :value="dict.value"
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
          v-hasPermi="['system:nav-node:create']"
          plain
          type="primary"
          @click="openForm('create')"
        >
          <Icon class="mr-5px" icon="ep:plus" />
          新增
        </el-button>
        <el-button plain type="danger" @click="toggleExpandAll">
          <Icon class="mr-5px" icon="ep:sort" />
          {{ isExpandAll ? '折叠全部' : '展开全部' }}
        </el-button>
        <el-button
          v-hasPermi="['system:nav-node:delete']"
          :disabled="checkedIds.length === 0"
          plain
          type="danger"
          @click="handleDeleteBatch"
        >
          <Icon class="mr-5px" icon="ep:delete" />
          批量删除{{ checkedIds.length ? `（${checkedIds.length}）` : '' }}
        </el-button>
      </el-form-item>
    </el-form>
  </ContentWrap>

  <!-- 列表 -->
  <ContentWrap>
    <!--
      🔴 与 Web 菜单页同一套虚拟表格（el-table-v2）：行高 41 / 表头 40 对齐「模型列表」的观感，
      表体内部滚动、表头钉住（高度由 useTableV2Height 量出来，写死数字在矮屏上会让整页滚）。
      外层 div 是量高度的锚点，v2 本体拿不到 ref。
      列的排布也对齐 Web 菜单页：名称 ▸ 图标 ▸ 排序 ▸ 权限标识 ▸ 路径 ▸ 状态 ▸ 操作，
      两页并着看时同一类信息在同一档位置上，不用重新学一遍表格。
    -->
    <div v-loading="loading" ref="tableHostRef">
      <el-auto-resizer>
        <template #default="{ width }">
          <el-table-v2
            v-model:expanded-row-keys="expandedRowKeys"
            :columns="columns"
            :data="list"
            expand-column-key="name"
            :header-height="40"
            :height="tableHeight"
            :row-height="41"
            :width="width"
            row-key="id"
            :row-class="stripeRowClass"
          />
        </template>
      </el-auto-resizer>
    </div>
  </ContentWrap>

  <!-- 表单弹窗：添加/修改 -->
  <NavNodeForm ref="formRef" @success="getList" />
</template>
<script lang="tsx" setup>
import { ElCheckbox, ElTag, type Column } from 'element-plus'
import * as NavNodeApi from '@/api/system/navNode'
import { StatusSwitch } from '@/components/StatusSwitch'
import { TableActions, type TableActionButton } from '@/components/TableActions'
import { CommonStatusEnum } from '@/utils/constants'
import { DICT_TYPE, getIntDictOptions } from '@/utils/dict'
import { handleTree } from '@/utils/tree'
import { useTableV2Height } from '@/hooks/web/useTableV2Height'
import NavNodeForm from './NavNodeForm.vue'
import {
  NAV_NODE_TYPE,
  NAV_NODE_TYPE_OPTIONS,
  NAV_TERMINAL,
  navNodeTypeLabel,
  navNodeTypeTag
} from './constants'
import { ensureWotIconFontFace, wotIconChar, wotIconCode, WOT_ICON_FONT_FAMILY } from './wotIcons'

defineOptions({ name: 'SystemNavNode' })

const message = useMessage() // 消息弹窗
const { t } = useI18n() // 国际化

const loading = ref(true) // 列表加载中
const list = ref<any[]>([]) // 树形列表数据
const queryParams = reactive({
  terminal: NAV_TERMINAL,
  name: undefined,
  nodeType: undefined,
  status: undefined
})
const queryFormRef = ref() // 搜索表单
/** 展开的行编号（v2 靠它决定拍平后渲染哪些行，没有 default-expand-all 这种开关） */
const expandedRowKeys = ref<number[]>([])

/** 批量选中的节点编号（v2 不支持 type="selection"，勾选列是自己用 ElCheckbox 渲染的） */
const checkedIds = ref<number[]>([])

const tableHostRef = ref<HTMLElement>()
const { tableHeight } = useTableV2Height(tableHostRef)

// 隔行浅色按真实行号取模：v2 只渲染可视窗口的行，CSS nth-child 会让条纹跟着滚动手抖
const stripeRowClass = ({ rowIndex }: { rowIndex: number }) =>
  rowIndex % 2 === 1 ? 'xpy-v2-striped' : ''

/** 把树形列表拍平成一维编号，供「全选」与「展开全部」用 */
const flattenIds = (rows: any[]): number[] =>
  rows.flatMap((row) => [row.id, ...flattenIds(row.children ?? [])])
const allFlatIds = computed(() => flattenIds(list.value))

/**
 * 是否已全展开。**由展开态推出来**，不再单独存一个 ref 手工维护：
 * 用户点行首箭头逐层折叠时那个 ref 不会跟着变，按钮就会写着「折叠全部」而树其实已经收起来了
 * ——点下去变成展开，读到的是「按钮坏了」。
 */
const isExpandAll = computed(
  () => allFlatIds.value.length > 0 && expandedRowKeys.value.length >= allFlatIds.value.length
)

const toggleCheck = (id: number, val: boolean) => {
  checkedIds.value = val
    ? [...new Set([...checkedIds.value, id])]
    : checkedIds.value.filter((checkedId) => checkedId !== id)
}

const toggleCheckAll = (val: boolean) => {
  checkedIds.value = val ? allFlatIds.value : []
}

/** 行操作按钮：必须是 setup 层的常量，TableActions 靠它做依赖追踪（见组件注释） */
const rowButtons: TableActionButton[] = [
  {
    key: 'update',
    label: '修改',
    permission: ['system:nav-node:update'],
    onClick: (row) => openForm('update', row.id)
  },
  {
    key: 'create',
    label: '新增',
    permission: ['system:nav-node:create'],
    // 导航项是叶子，不允许再挂子节点（与移动端三层渲染一致）
    show: (row) => row.nodeType !== NAV_NODE_TYPE.ITEM,
    onClick: (row) => openForm('create', undefined, row.id)
  },
  {
    key: 'delete',
    label: '删除',
    type: 'danger',
    divided: true,
    permission: ['system:nav-node:delete'],
    onClick: (row) => handleDelete(row.id)
  }
]

/**
 * 列定义
 *
 * 🔴 用 computed 而不是常量数组：勾选态与「状态开关 loading」都存在 ref 里，而 v2 的单元格是它
 *    自己虚拟滚动时渲染的，光靠 cellRenderer 里读 ref 不保证会重画（内部有 cell 缓存）。
 *    让 columns 依赖它们后，状态一变就产出一个新的列定义数组，表格必然整表重渲染。
 *
 * 🔴 列宽走 flex 而不是「表格 fixed + 固定列」：v2 的 fixed 模式下所有列宽写死，列总宽一旦
 *    超过容器就横向滚，状态开关 / 操作按钮会被推出屏幕外；而 v1 列表（模型列表那套观感）
 *    是 min-width 自适应、永远铺满不横滚。这里给短列 flexShrink:0 锁死宽度、
 *    长文本列 flexGrow + minWidth 分摊余量与压缩量：宽屏铺满、窄屏先压文本列、压到 minWidth 才横滚。
 *    ⚠️ 不用 v2 的左右固定列：fixed=false 时主网格的列会被 flex 压缩，而左右覆盖层按未压缩的
 *    宽度自己排版，两层会错位，所以这页不做列固定。
 */
const columns = computed<Column<NavNodeApi.NavNodeVO>[]>(() => {
  const checked = checkedIds.value
  const all = allFlatIds.value
  const allChecked = all.length > 0 && all.every((id) => checked.includes(id))
  const indeterminate = checked.length > 0 && !allChecked
  return [
    {
      key: 'checkbox',
      title: '',
      width: 40,
      flexShrink: 0,
      align: 'center',
      headerCellRenderer: () => (
        <ElCheckbox
          modelValue={allChecked}
          indeterminate={indeterminate}
          aria-label="全选当前列表"
          onChange={(val) => toggleCheckAll(!!val)}
        />
      ),
      cellRenderer: ({ rowData }) => (
        <ElCheckbox
          modelValue={checked.includes(rowData.id)}
          aria-label={`选择节点 ${rowData.name}`}
          onChange={(val) => toggleCheck(rowData.id, !!val)}
        />
      )
    },
    {
      // v2 的 rowIndex 是【展开后可见行】的序号（折叠掉的节点压根不进 flattenedData），
      // 所以折叠时序号仍然 1、2、3 连续——这是 v1 el-table 做不到的：那边 type="index"
      // 给的是整棵拍平树的位次，被折叠的子树照样占号，可见行的序号会跳。
      key: 'index',
      title: '序号',
      width: 56,
      flexShrink: 0,
      align: 'center',
      cellRenderer: ({ rowIndex }) => <span>{rowIndex + 1}</span>
    },
    {
      key: 'name',
      title: '名称',
      dataKey: 'name',
      width: 240,
      minWidth: 160,
      flexGrow: 1
    },
    {
      // 图标列与 Web 菜单页同位置同宽度：那边画 iconify 图标，这边画 wot 字形。
      // 名字不在移动端图标表里时不画任何东西 —— 画个问号反而像在指责用户
      key: 'icon',
      title: '图标',
      dataKey: 'icon',
      width: 70,
      flexShrink: 0,
      align: 'center',
      cellRenderer: ({ rowData }) => {
        const code = rowData.icon ? wotIconCode(rowData.icon) : undefined
        if (code === undefined) {
          return null
        }
        return (
          <span class="text-16px" style={{ fontFamily: WOT_ICON_FONT_FAMILY }}>
            {wotIconChar(code)}
          </span>
        )
      }
    },
    {
      key: 'sort',
      title: '排序',
      dataKey: 'sort',
      width: 60,
      flexShrink: 0
    },
    {
      // 留空＝所有登录用户可见，与 Web 菜单页一样直接留白，不写一句解释进单元格
      key: 'permissions',
      title: '权限标识',
      dataKey: 'permissions',
      width: 260,
      minWidth: 160,
      flexGrow: 1
    },
    {
      key: 'route',
      title: '页面路径',
      dataKey: 'route',
      width: 320,
      minWidth: 180,
      flexGrow: 2
    },
    {
      key: 'nodeType',
      title: '类型',
      dataKey: 'nodeType',
      width: 90,
      flexShrink: 0,
      align: 'center',
      cellRenderer: ({ rowData }) => (
        <ElTag type={navNodeTypeTag(rowData.nodeType)}>
          {navNodeTypeLabel(rowData.nodeType)}
        </ElTag>
      )
    },
    {
      key: 'visible',
      title: '显示',
      dataKey: 'visible',
      width: 70,
      flexShrink: 0,
      align: 'center',
      cellRenderer: ({ rowData }) => (
        <ElTag type={rowData.visible ? 'success' : 'info'}>
          {rowData.visible ? '显示' : '隐藏'}
        </ElTag>
      )
    },
    {
      key: 'status',
      title: '状态',
      dataKey: 'status',
      width: 60,
      flexShrink: 0,
      align: 'center',
      cellRenderer: ({ rowData }) => (
        <StatusSwitch
          modelValue={rowData.status === CommonStatusEnum.ENABLE}
          loading={statusLoadingId.value === rowData.id}
          permission={['system:nav-node:update']}
          onChange={(next: boolean) => handleUpdateStatus(rowData, next)}
        />
      )
    },
    {
      key: 'operations',
      title: '操作',
      align: 'center',
      width: 160,
      flexShrink: 0,
      cellRenderer: ({ rowData }) => <TableActions row={rowData} buttons={rowButtons} />
    }
  ]
})

/** 查询列表 */
const getList = async () => {
  loading.value = true
  try {
    const data = await NavNodeApi.getNavNodeList(queryParams)
    list.value = handleTree(data)
    // 刷新后清空勾选，避免残留旧编号在批量删除时误删
    checkedIds.value = []
    // v2 没有 default-expand-all：整棵树只有 82 行量级，默认全展开比让人一层层点更有用；
    // 搜索命中深层节点时同理，折叠着等于「搜了没反应」
    expandedRowKeys.value = flattenIds(list.value)
  } finally {
    loading.value = false
  }
}

/** 展开/折叠操作 */
const toggleExpandAll = () => {
  // 展开必须是拍平后的全部编号，只放一级的话孙子层仍然折叠着，「展开」名不副实
  expandedRowKeys.value = isExpandAll.value ? [] : allFlatIds.value
}

/** 搜索按钮操作 */
const handleQuery = () => {
  getList()
}

/** 重置按钮操作 */
const resetQuery = () => {
  queryFormRef.value.resetFields()
  queryParams.terminal = NAV_TERMINAL // resetFields 会清掉 terminal，补回
  handleQuery()
}

/** 添加/修改操作 */
const formRef = ref()
const openForm = (type: string, id?: number, parentId?: number) => {
  formRef.value.open(type, id, parentId)
}

/** 状态快捷开关：整行提交（row 来自 /list，含全部必填字段） */
const statusLoadingId = ref<number | null>(null)
const handleUpdateStatus = async (row: any, next: boolean) => {
  statusLoadingId.value = row.id
  try {
    await NavNodeApi.updateNavNode({
      ...row,
      status: next ? CommonStatusEnum.ENABLE : CommonStatusEnum.DISABLE
    })
    message.success(next ? '已启用' : '已停用')
    await getList()
  } finally {
    statusLoadingId.value = null
  }
}

/** 删除按钮操作 */
const handleDelete = async (id: number) => {
  try {
    await message.delConfirm()
    await NavNodeApi.deleteNavNode(id)
    message.success(t('common.delSuccess'))
    await getList()
  } catch {}
}

/** 批量删除按钮操作 */
const handleDeleteBatch = async () => {
  if (checkedIds.value.length === 0) {
    return
  }
  try {
    await message.delConfirm(`确定删除选中的 ${checkedIds.value.length} 个节点吗？`)
    await NavNodeApi.deleteNavNodeList(checkedIds.value)
    message.success(t('common.delSuccess'))
    await getList()
  } catch {}
}

/** 初始化 **/
onMounted(() => {
  // 图标列要画 wot 字形，字体不在 web 的图标集里，得自己注入一次
  ensureWotIconFontFace()
  getList()
})
</script>
