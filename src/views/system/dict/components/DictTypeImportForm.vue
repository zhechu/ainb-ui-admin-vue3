<!-- 字典迁移包导入窗口 -->
<template>
  <Dialog v-model="dialogVisible" title="导入字典分类" width="720">
    <el-form label-width="96px" v-loading="formLoading">
      <el-form-item label="导入到">
        <el-tree-select
          v-model="parentId"
          :data="groupOptions"
          :props="{ label: 'name', value: 'id', children: 'children' }"
          check-strictly
          class="w-1/1"
          clearable
          node-key="id"
          placeholder="不选表示放在分类树的根节点下"
        />
        <div class="form-tip">
          包里的顶层分类会挂到这里；包内部的层级关系原样保留，不受这个选择影响
        </div>
      </el-form-item>
      <el-form-item label="冲突处理">
        <el-radio-group v-model="policy">
          <el-radio :value="DictImportPolicyEnum.SKIP">跳过</el-radio>
          <el-radio :value="DictImportPolicyEnum.OVERWRITE">覆盖</el-radio>
          <el-radio :value="DictImportPolicyEnum.RENAME">建副本</el-radio>
        </el-radio-group>
        <div class="form-tip">{{ policyTip }}</div>
      </el-form-item>
      <el-form-item label="迁移包">
        <el-upload
          ref="uploadRef"
          v-model:file-list="fileList"
          :auto-upload="false"
          :disabled="formLoading"
          :limit="1"
          :on-exceed="handleExceed"
          accept=".json"
          action="none"
          class="w-1/1"
          drag
        >
          <Icon icon="ep:upload" />
          <div class="el-upload__text">将文件拖到此处，或<em>点击上传</em></div>
          <template #tip>
            <div class="el-upload__tip">
              仅支持本系统「导出分类」产出的 .json 文件。批量改字典的选项值请走字典数据的 Excel
              导入，两条通道各管一件事
            </div>
          </template>
        </el-upload>
      </el-form-item>
    </el-form>

    <!-- 结果按分类逐行列出。只报总数的话，用户知道有东西没进去，却不知道是哪一个 -->
    <template v-if="result">
      <el-divider content-position="left">导入结果</el-divider>
      <el-table :data="result.types" max-height="280" size="small">
        <el-table-column label="分类" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">
            <span>{{ row.name }}</span>
            <el-tag class="ml-6px" size="small" type="info">
              {{ row.savedType || row.type }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="结果" width="90">
          <template #default="{ row }">
            <el-tag :type="actionTagType(row.action)" size="small">
              {{ ACTION_TEXTS[row.action] || row.action }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="字典数据" width="200">
          <template #default="{ row }">
            <span v-if="row.action === 'failed'" class="text-12px text-gray">—</span>
            <span v-else class="text-12px">
              新增 {{ row.dataCreateCount }}
              <template v-if="row.dataUpdateCount"> / 更新 {{ row.dataUpdateCount }}</template>
              <template v-if="row.dataSkipCount"> / 跳过 {{ row.dataSkipCount }}</template>
              <template v-if="failureCountOf(row)">
                / <span class="text-danger">失败 {{ failureCountOf(row) }}</span>
              </template>
            </span>
          </template>
        </el-table-column>
        <el-table-column label="说明" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="text-12px">{{ describe(row) }}</span>
          </template>
        </el-table-column>
      </el-table>
    </template>

    <template #footer>
      <el-button :disabled="formLoading" type="primary" @click="submitForm">确 定</el-button>
      <el-button @click="dialogVisible = false">关 闭</el-button>
    </template>
  </Dialog>
</template>

<script lang="ts" setup>
import type { UploadUserFile } from 'element-plus'
import { handleTree } from '@/utils/tree'
import * as DictTypeApi from '@/api/system/dict/dict.type'
import { DictImportPolicyEnum, DictTypeNodeEnum } from '@/api/system/dict/dict.type'

defineOptions({ name: 'DictTypeImportForm' })

const message = useMessage()

const dialogVisible = ref(false)
const formLoading = ref(false)
const uploadRef = ref()
const fileList = ref<UploadUserFile[]>([])
const policy = ref<DictImportPolicyEnum>(DictImportPolicyEnum.SKIP)
const parentId = ref<number>()
const groupOptions = ref<any[]>([])
const result = ref<DictTypeApi.DictImportRespVO>()

const ACTION_TEXTS: Record<string, string> = {
  created: '新增',
  updated: '更新',
  skipped: '已存在',
  renamed: '副本',
  failed: '失败'
}

const POLICY_TIPS: Record<number, string> = {
  [DictImportPolicyEnum.SKIP]:
    '已存在的分类和字典值一律保持原样，只补上缺的。三种里唯一不会改动现有数据的选项',
  [DictImportPolicyEnum.OVERWRITE]:
    '已存在的分类和字典值按包里的内容更新。节点类型、树形开关不会被改动，不一致会直接报错',
  [DictImportPolicyEnum.RENAME]:
    '整棵子树新建一份，编码和名称自动加后缀。适合拿现有字典改造出一套新的，原来那套不受影响'
}

const policyTip = computed(() => POLICY_TIPS[policy.value])

const actionTagType = (action: string) => {
  if (action === 'failed') return 'danger'
  if (action === 'skipped') return 'info'
  if (action === 'updated' || action === 'renamed') return 'warning'
  return 'success'
}

const failureCountOf = (row: DictTypeApi.DictImportTypeResultVO) =>
  Object.keys(row.dataFailures ?? {}).length

/** 一行的说明文字：失败原因优先，其次是没进去的那几个键值 */
const describe = (row: DictTypeApi.DictImportTypeResultVO) => {
  if (row.reason) return row.reason
  const failures = Object.entries(row.dataFailures ?? {})
  if (!failures.length) return ''
  return failures.map(([value, reason]) => `${value}：${reason}`).join('；')
}

/** 打开弹窗 */
const open = async (defaultParentId?: number) => {
  dialogVisible.value = true
  await resetForm()
  parentId.value = defaultParentId
  await loadGroupOptions()
}
defineExpose({ open })

/** 只列分组：字典节点底下挂的是字典数据，不能再挂分类 */
const loadGroupOptions = async () => {
  const list = await DictTypeApi.getDictTypeList()
  groupOptions.value = handleTree(
    list.filter((item) => item.nodeType === DictTypeNodeEnum.GROUP).map((item) => ({ ...item }))
  )
}

const emits = defineEmits(['success'])

/** 提交表单 */
const submitForm = async () => {
  if (fileList.value.length === 0) {
    message.error('请上传迁移包文件')
    return
  }
  formLoading.value = true
  try {
    result.value = await DictTypeApi.importDictTypeJson(
      fileList.value[0].raw as File,
      policy.value,
      parentId.value
    )
    const types = result.value?.types ?? []
    const failed = types.filter(
      (item) => item.action === 'failed' || failureCountOf(item) > 0
    ).length
    if (failed === 0) {
      message.success(`导入完成，共处理 ${types.length} 个分类`)
      dialogVisible.value = false
    } else {
      // 有失败项时不关弹窗：结果表格就在下面，关掉用户就再也看不到是哪几个没进去了
      message.warning(`导入完成，但有 ${failed} 个分类存在未导入的内容，请查看下方结果`)
    }
    // 无论成败都刷新左树——成功的那部分已经落库了
    emits('success')
  } finally {
    formLoading.value = false
    await nextTick()
    uploadRef.value?.clearFiles()
    fileList.value = []
  }
}

/** 重置表单 */
const resetForm = async () => {
  fileList.value = []
  policy.value = DictImportPolicyEnum.SKIP
  parentId.value = undefined
  result.value = undefined
  await nextTick()
  uploadRef.value?.clearFiles()
}

/** 文件数超出提示 */
const handleExceed = (): void => {
  message.error('最多只能上传一个文件！')
}
</script>

<style lang="scss" scoped>
.form-tip {
  font-size: 12px;
  line-height: 1.5;
  color: var(--el-text-color-secondary);
}

.text-danger {
  color: var(--el-color-danger);
}

.text-gray {
  color: var(--el-text-color-placeholder);
}
</style>
