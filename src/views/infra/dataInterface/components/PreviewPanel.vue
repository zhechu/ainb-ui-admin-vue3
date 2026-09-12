<template>
  <Dialog :title="`在线预览 - ${interfaceName}`" v-model="dialogVisible" width="900px">
    <!-- 参数录入区：按入参定义动态渲染 -->
    <template v-if="paramList.length > 0">
      <div class="mb-8px font-bold">请求参数</div>
      <el-form :inline="true" size="small" class="mb-8px">
        <el-form-item
          v-for="p in paramList"
          :key="p.name"
          :label="p.label || p.name"
          :required="p.required"
        >
          <el-input
            v-if="!isDateType(p.type) && p.type !== 'BOOLEAN'"
            v-model="args[p.name]"
            :placeholder="p.remark || p.type"
            clearable
            class="!w-160px"
          />
          <el-select
            v-else-if="p.type === 'BOOLEAN'"
            v-model="args[p.name]"
            clearable
            class="!w-120px"
          >
            <el-option label="是" :value="true" />
            <el-option label="否" :value="false" />
          </el-select>
          <el-date-picker
            v-else
            v-model="args[p.name]"
            :type="p.type === 'DATE' ? 'date' : 'datetime'"
            :value-format="p.type === 'DATE' ? 'YYYY-MM-DD' : 'YYYY-MM-DD HH:mm:ss'"
            placeholder="请选择"
            class="!w-180px"
          />
        </el-form-item>
      </el-form>
    </template>
    <el-alert
      v-else
      type="info"
      :closable="false"
      class="mb-8px"
      title="该接口无需参数，直接执行即可"
    />

    <!-- 分页参数：开启分页时显示 -->
    <template v-if="hasPage === 1">
      <div class="mb-8px font-bold">分页参数（系统变量）</div>
      <el-form :inline="true" size="small" class="mb-8px">
        <el-form-item label="当前页码">
          <el-input-number v-model="pageNo" :min="1" class="!w-120px" />
        </el-form-item>
        <el-form-item label="每页条数">
          <el-input-number v-model="pageSize" :min="1" :max="1000" class="!w-120px" />
        </el-form-item>
      </el-form>
    </template>

    <el-button type="primary" :loading="loading" @click="doPreview">
      <Icon icon="ep:video-play" class="mr-5px" /> 执行
    </el-button>
    <span class="ml-10px text-12px text-gray-500">预览最多返回 100 条</span>

    <!-- 实际执行的 SQL：核对租户条件是否按预期注入 -->
    <template v-if="executeSql">
      <div class="mb-6px mt-14px font-bold">实际执行的 SQL</div>
      <pre class="code-block">{{ executeSql }}</pre>
    </template>

    <!-- HTTP 接口配置信息 -->
    <template v-if="interfaceType === 3 && (baseUrl || allowInternalUrl)">
      <div class="mb-6px mt-14px font-bold">HTTP 配置</div>
      <div class="text-12px text-gray-600 mb-8px">
        <div v-if="baseUrl"
          >基础URL: <code>{{ baseUrl }}</code></div
        >
        <div v-if="allowInternalUrl === 1" class="text-warning"> ⚠️ 已启用内网访问 </div>
      </div>
    </template>

    <!-- 结果 -->
    <template v-if="executed">
      <div class="mb-6px mt-14px font-bold">
        执行结果
        <!-- 写动作显示影响行数，查询动作显示条数 -->
        <span v-if="isWriteAction && resultRows?.affectedRows !== undefined" class="ml-6px text-12px text-gray-500">
          影响 {{ resultRows.affectedRows }} 行
        </span>
        <span v-else-if="Array.isArray(resultRows)" class="ml-6px text-12px text-gray-500">
          共 {{ resultRows.length }} 条
        </span>
      </div>
      <el-alert v-if="errorMsg" type="error" :closable="false" :title="errorMsg" class="mb-8px" />
      <pre v-else class="code-block">{{ jsonResultText }}</pre>
    </template>
  </Dialog>
</template>

<script lang="ts" setup>
import * as DataInterfaceApi from '@/api/infra/dataInterface'

/** 在线预览面板
 *
 * 与正式调用走同一个后端执行逻辑，所以「预览能跑通」等于「正式调用也能跑通」。
 */
defineOptions({ name: 'PreviewPanel' })

const dialogVisible = ref(false)
const loading = ref(false)
const executed = ref(false)
const interfaceId = ref<number>()
const interfaceName = ref('')
const interfaceType = ref<number>()
const sqlStatementType = ref<string>()
const baseUrl = ref('')
const allowInternalUrl = ref<number>()
const hasPage = ref<number>(0) // 是否分页
const paramList = ref<DataInterfaceApi.ParamDefinitionVO[]>([])
const args = ref<Record<string, any>>({})
const executeSql = ref('')
const errorMsg = ref('')
const resultRows = ref<any>(null)

// 分页参数
const pageNo = ref(1)
const pageSize = ref(20)

/** 是否为写动作（INSERT/UPDATE/DELETE）。决定结果如何呈现 */
const isWriteAction = computed(
  () => sqlStatementType.value && sqlStatementType.value !== 'SELECT'
)

const jsonResultText = computed(() => {
  if (resultRows.value === null || resultRows.value === undefined) {
    return '（无返回内容）'
  }
  return JSON.stringify(resultRows.value, null, 2)
})

const isDateType = (type: string) => ['DATE', 'DATETIME'].includes(type)

const open = (row: DataInterfaceApi.DataInterfaceVO) => {
  dialogVisible.value = true
  interfaceId.value = row.id
  interfaceName.value = row.name
  interfaceType.value = row.type
  sqlStatementType.value = row.sqlStatementType
  baseUrl.value = row.baseUrl || ''
  allowInternalUrl.value = row.allowInternalUrl
  hasPage.value = row.hasPage ?? 0
  paramList.value = parseParams(row.params)
  // 用默认值预填，减少手工输入
  const initial: Record<string, any> = {}
  paramList.value.forEach((p) => {
    initial[p.name] = p.defaultValue ?? undefined
  })
  args.value = initial
  // 重置分页参数
  pageNo.value = 1
  pageSize.value = 20
  executed.value = false
  executeSql.value = ''
  errorMsg.value = ''
  resultRows.value = null
}
defineExpose({ open })

const parseParams = (raw?: string): DataInterfaceApi.ParamDefinitionVO[] => {
  if (!raw) {
    return []
  }
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const doPreview = async () => {
  if (!interfaceId.value) {
    return
  }
  loading.value = true
  errorMsg.value = ''
  try {
    // 合并业务参数和分页参数
    const requestArgs = { ...args.value }
    if (hasPage.value === 1) {
      requestArgs['pageNo'] = pageNo.value
      requestArgs['pageSize'] = pageSize.value
    }
    const res = await DataInterfaceApi.preview(interfaceId.value, requestArgs)
    resultRows.value = res?.data ?? null
    executeSql.value = res?.executeSql ?? ''
  } catch (e: any) {
    // 执行失败也要展示原因，这是预览最有价值的场景之一
    errorMsg.value = e?.msg ?? e?.message ?? '执行失败'
    resultRows.value = null
  } finally {
    executed.value = true
    loading.value = false
  }
}
</script>

<style lang="scss" scoped>
.code-block {
  padding: 10px;
  margin: 0;
  font-family: Consolas, Monaco, monospace;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
  background-color: #f5f7fa;
  border-radius: 4px;
}
</style>
