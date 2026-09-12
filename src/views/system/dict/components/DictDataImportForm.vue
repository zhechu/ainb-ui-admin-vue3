<!-- 字典数据导入窗口 -->
<template>
  <Dialog v-model="dialogVisible" title="字典数据导入" width="560">
    <div class="mb-10px flex items-center">
      <span class="mr-10px">导入到</span>
      <el-tag>{{ dictName }}</el-tag>
      <el-tag class="ml-6px" type="info">{{ dictType }}</el-tag>
      <el-tag v-if="treeEnabled" class="ml-6px" type="success">树形</el-tag>
    </div>
    <el-upload
      ref="uploadRef"
      v-model:file-list="fileList"
      :auto-upload="false"
      :disabled="formLoading"
      :limit="1"
      :on-exceed="handleExceed"
      accept=".xlsx, .xls"
      action="none"
      drag
    >
      <Icon icon="ep:upload" />
      <div class="el-upload__text">将文件拖到此处，或<em>点击上传</em></div>
      <template #tip>
        <div class="el-upload__tip text-center">
          <div class="el-upload__tip">
            <el-checkbox v-model="updateSupport" />
            是否更新已经存在的字典数据（“字典键值”重复）
          </div>
          <span v-if="treeEnabled" class="text-12px">
            层级用「上级键值」列表达，留空表示顶层。父行排在子行后面也没关系
          </span>
          <div>
            <span>仅允许导入 xls、xlsx 格式文件。</span>
            <el-link
              :underline="false"
              style="font-size: 12px; vertical-align: baseline"
              type="primary"
              @click="importTemplate"
            >
              下载模板
            </el-link>
          </div>
        </div>
      </template>
    </el-upload>

    <!-- 失败项用表格列出来。拼成一长串文本的话，几十行失败就完全没法读了 -->
    <template v-if="result">
      <el-divider content-position="left">导入结果</el-divider>
      <div class="mb-8px">
        <el-tag type="success">新增 {{ result.createValues.length }}</el-tag>
        <el-tag class="ml-6px" type="warning">更新 {{ result.updateValues.length }}</el-tag>
        <el-tag class="ml-6px" type="danger">失败 {{ failureRows.length }}</el-tag>
      </div>
      <el-table v-if="failureRows.length" :data="failureRows" max-height="240" size="small">
        <el-table-column label="字典键值" prop="value" width="160" show-overflow-tooltip />
        <el-table-column label="失败原因" prop="reason" show-overflow-tooltip />
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
import request from '@/config/axios'
import download from '@/utils/download'
import * as DictDataApi from '@/api/system/dict/dict.data'

defineOptions({ name: 'DictDataImportForm' })

const message = useMessage()

const dialogVisible = ref(false)
const formLoading = ref(false)
const uploadRef = ref()
const fileList = ref<UploadUserFile[]>([])
const updateSupport = ref(false)
const dictType = ref('')
const dictName = ref('')
const treeEnabled = ref(false)
const result = ref<DictDataApi.DictDataImportRespVO>()

const failureRows = computed(() =>
  Object.entries(result.value?.failureValues ?? {}).map(([value, reason]) => ({ value, reason }))
)

/** 打开弹窗 */
const open = async (type: string, name: string, tree: boolean) => {
  dialogVisible.value = true
  dictType.value = type
  dictName.value = name
  treeEnabled.value = tree
  await resetForm()
}
defineExpose({ open })

const emits = defineEmits(['success'])

/** 提交表单 */
const submitForm = async () => {
  if (fileList.value.length === 0) {
    message.error('请上传文件')
    return
  }
  formLoading.value = true
  try {
    const formData = new FormData()
    formData.append('file', fileList.value[0].raw as Blob)
    formData.append('dictType', dictType.value)
    formData.append('updateSupport', String(updateSupport.value))
    result.value = await request.post({
      url: '/system/dict-data/import-excel',
      data: formData,
      headersType: 'multipart/form-data'
    })
    const failed = Object.keys(result.value?.failureValues ?? {}).length
    if (failed === 0) {
      message.success(
        `导入完成，新增 ${result.value!.createValues.length} 条，更新 ${result.value!.updateValues.length} 条`
      )
      dialogVisible.value = false
    } else {
      // 有失败项时不关弹窗：结果表格就在下面，关掉用户就再也看不到哪几行没进去了
      message.warning(`导入完成，但有 ${failed} 条未导入，请查看下方结果`)
    }
    // 无论成败都刷新列表——成功的那部分已经落库了
    emits('success')
  } catch {
    message.error('上传失败，请您重新上传！')
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
  updateSupport.value = false
  result.value = undefined
  await nextTick()
  uploadRef.value?.clearFiles()
}

/** 文件数超出提示 */
const handleExceed = (): void => {
  message.error('最多只能上传一个文件！')
}

/** 下载模板操作 */
const importTemplate = async () => {
  const res = await DictDataApi.importDictDataTemplate()
  download.excel(res, '字典数据导入模板.xls')
}
</script>
