<!-- 字典数据：查询区与列表区分成两张卡片，表格内部独立滚动 -->
<template>
  <!-- 搜索 -->
  <ContentWrap class="flex-none">
    <div class="mb-12px flex items-center gap-8px">
      <span class="text-16px font-bold">{{ dict?.name }}</span>
      <el-tag size="small" type="info">{{ dict?.type }}</el-tag>
      <el-tag v-if="treeEnabled" size="small" type="success">树形</el-tag>
      <el-tag v-if="dict?.cacheMode === DictCacheModeEnum.LAZY" size="small" type="warning">
        懒加载
      </el-tag>
    </div>
    <el-form :inline="true" :model="queryParams" class="-mb-15px" label-width="68px">
      <el-form-item label="关键字" prop="keyword">
        <el-input
          v-model="queryParams.keyword"
          class="!w-240px"
          clearable
          placeholder="搜索标签/键值"
          @clear="handleQuery"
          @keyup.enter="handleQuery"
        />
      </el-form-item>
      <el-form-item v-if="!treeEnabled" label="状态" prop="status">
        <el-select v-model="queryParams.status" class="!w-240px" clearable placeholder="数据状态">
          <el-option
            v-for="item in getIntDictOptions(DICT_TYPE.COMMON_STATUS)"
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
          v-hasPermi="['system:dict:create']"
          :disabled="!dictType"
          plain
          type="primary"
          @click="emit('create', 0)"
        >
          <Icon class="mr-5px" icon="ep:plus" />
          新增
        </el-button>
        <el-button
          v-hasPermi="['system:dict:import']"
          :disabled="!dictType"
          plain
          type="warning"
          @click="emit('import')"
        >
          <Icon class="mr-5px" icon="ep:upload" />
          导入
        </el-button>
        <el-button
          v-hasPermi="['system:dict:export']"
          :disabled="!dictType"
          :loading="exportLoading"
          plain
          type="success"
          @click="handleExport"
        >
          <Icon class="mr-5px" icon="ep:download" />
          导出
        </el-button>
        <el-button
          v-hasPermi="['system:dict:delete']"
          :disabled="checkedIds.length === 0"
          plain
          type="danger"
          @click="handleDeleteBatch"
        >
          <Icon class="mr-5px" icon="ep:delete" />
          批量删除
        </el-button>
      </el-form-item>
    </el-form>
  </ContentWrap>

  <!-- 列表：卡片撑满剩余高度，表格在内部滚动，表头保持固定 -->
  <ContentWrap :body-style="listBodyStyle" class="min-h-0 flex-1 !mb-0">
    <div class="h-full flex flex-col">
      <el-table stripe
        v-loading="loading"
        :data="list"
        :default-expand-all="treeEnabled"
        :row-key="treeEnabled ? 'id' : undefined"
        :tree-props="{ children: 'children' }"
        class="xpy-list-table min-h-0 flex-1"
        height="100%"
        @selection-change="handleRowCheckboxChange"
      >
        <el-table-column type="selection" width="55" />
        <el-table-column
          v-if="!treeEnabled"
          label="序号"
          type="index"
          width="44"
          align="center"
          :index="indexMethod(queryParams)"
        class-name="col-index"
        label-class-name="col-index"
      />
        <el-table-column label="字典标签" prop="label" show-overflow-tooltip />
        <el-table-column align="center" label="字典键值" prop="value" />
        <el-table-column align="center" label="字典排序" prop="sort" width="90" />
        <el-table-column align="center" label="状态" prop="status" width="90">
          <template #default="scope">
            <StatusSwitch
              :model-value="scope.row.status === CommonStatusEnum.ENABLE"
              :loading="statusLoadingId === scope.row.id"
              :permission="['system:dict:update']"
              @change="(next) => handleUpdateStatus(scope.row, next)"
            />
          </template>
        </el-table-column>
        <el-table-column label="颜色类型" prop="colorType" width="100" />
        <el-table-column label="备注" prop="remark" show-overflow-tooltip />
        <el-table-column
          :formatter="dateFormatter"
          align="center"
          label="创建时间"
          prop="createTime"
          width="180"
        />
        <el-table-column align="center" fixed="right" label="操作" width="200">
          <template #default="scope">
            <el-button
              v-if="treeEnabled"
              v-hasPermi="['system:dict:create']"
              link
              type="primary"
              @click="emit('create', scope.row.id)"
            >
              新增下级
            </el-button>
            <el-button
              v-hasPermi="['system:dict:update']"
              link
              type="primary"
              @click="emit('edit', scope.row.id)"
            >
              修改
            </el-button>
            <el-button
              v-hasPermi="['system:dict:delete']"
              link
              type="danger"
              @click="handleDelete(scope.row)"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <!-- 树形下拿到的是完整一棵树，没有分页的概念 -->
      <Pagination
        v-if="!treeEnabled"
        v-model:limit="queryParams.pageSize"
        v-model:page="queryParams.pageNo"
        :total="total"
        class="flex-none"
        @pagination="getList"
      />
    </div>
  </ContentWrap>
</template>

<script lang="ts" setup>
import { DICT_TYPE, getIntDictOptions } from '@/utils/dict'
import { dateFormatter } from '@/utils/formatTime'
import { handleTree } from '@/utils/tree'
import download from '@/utils/download'
import * as DictDataApi from '@/api/system/dict/dict.data'
import { CommonStatusEnum } from '@/utils/constants'
import type { DictTypeVO } from '@/api/system/dict/dict.type'
import { DictCacheModeEnum } from '@/api/system/dict/dict.type'

defineOptions({ name: 'DictDataTable' })

const props = defineProps<{
  /** 当前选中的字典；为空表示左树还没选中任何字典 */
  dict?: DictTypeVO
}>()

const emit = defineEmits<{
  (e: 'create', parentId: number): void
  (e: 'edit', id: number): void
  (e: 'import'): void
}>()

const message = useMessage()
const { t } = useI18n()

const loading = ref(false)
const exportLoading = ref(false)
const total = ref(0)
const list = ref<any[]>([])
const checkedIds = ref<number[]>([])
const queryParams = reactive({
  pageNo: 1,
  pageSize: 20,
  keyword: '',
  status: undefined
})

const dictType = computed(() => props.dict?.type)
const treeEnabled = computed(() => !!props.dict?.treeEnable)
// 卡片内容区撑满卡片，内部才能做 flex 布局、让表格拿到确定高度
const listBodyStyle = { padding: '10px', overflow: 'hidden', height: '100%' }

const getList = async () => {
  if (!dictType.value) {
    list.value = []
    total.value = 0
    return
  }
  loading.value = true
  try {
    if (treeEnabled.value) {
      const data = await DictDataApi.getDictDataTreeList(
        dictType.value,
        queryParams.keyword || undefined
      )
      // 后端返回扁平列表（关键字过滤时已连同祖先一并返回），这里组装成树
      list.value = handleTree(data.map((item) => ({ ...item })))
      total.value = data.length
    } else {
      const data = await DictDataApi.getDictDataPage({
        ...queryParams,
        // 平铺字典沿用原来的分页接口，关键字只匹配标签
        label: queryParams.keyword,
        dictType: dictType.value
      } as any)
      list.value = data.list
      total.value = data.total
    }
  } finally {
    loading.value = false
  }
}

const handleQuery = () => {
  queryParams.pageNo = 1
  getList()
}

const resetQuery = () => {
  queryParams.keyword = ''
  queryParams.status = undefined
  handleQuery()
}

/** 状态列快捷开关：走整行更新接口，与编辑表单保存同一条后端路径 */
const statusLoadingId = ref<number | null>(null)
const handleUpdateStatus = async (row: any, next: boolean) => {
  statusLoadingId.value = row.id
  try {
    await DictDataApi.updateDictData({
      ...row,
      status: next ? CommonStatusEnum.ENABLE : CommonStatusEnum.DISABLE
    })
    message.success(next ? '已开启' : '已关闭')
    await getList()
  } finally {
    statusLoadingId.value = null
  }
}

const handleDelete = async (row: any) => {
  const hasChildren = row.children?.length > 0
  try {
    await message.delConfirm(
      hasChildren
        ? `「${row.label}」下还有子节点，删除会连同整棵子树一起删除，是否继续？`
        : `是否确认删除「${row.label}」？`
    )
    // 有子节点时用户已经在上面的提示里确认过级联语义了
    await DictDataApi.deleteDictData(row.id, hasChildren)
    message.success(t('common.delSuccess'))
    await getList()
  } catch {}
}

const handleRowCheckboxChange = (rows: any[]) => {
  checkedIds.value = rows.map((row) => row.id)
}

const handleDeleteBatch = async () => {
  try {
    await message.delConfirm()
    await DictDataApi.deleteDictDataList(checkedIds.value)
    checkedIds.value = []
    message.success(t('common.delSuccess'))
    await getList()
  } catch {}
}

const handleExport = async () => {
  try {
    await message.exportConfirm()
    exportLoading.value = true
    // 导出整份字典，而不是当前筛选结果：导出的文件要能改完直接导回来，
    // 只导出筛出来的那几行，导回去反而像是把其余数据删了
    const data = await DictDataApi.exportDictData(dictType.value!)
    download.excel(data, '字典数据.xls')
  } catch {
  } finally {
    exportLoading.value = false
  }
}

// 左树切换字典时重新取数。切换后要把上一个字典的搜索条件清掉，
// 否则会出现「换了字典却查不到数据」这种看起来像 bug 的现象
watch(
  dictType,
  () => {
    queryParams.keyword = ''
    queryParams.status = undefined
    queryParams.pageNo = 1
    checkedIds.value = []
    getList()
  },
  { immediate: true }
)

defineExpose({ getList })
</script>
