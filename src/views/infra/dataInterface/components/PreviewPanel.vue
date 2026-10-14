<template>
  <ContentWrap>
    <!-- 顶部操作栏：内容较多，页内展示 -->
    <div class="di-panel-header mb-15px flex items-center justify-between">
      <div class="flex items-center">
        <el-button link @click="emit('back')">
          <Icon icon="ep:arrow-left" class="mr-5px" /> 返回
        </el-button>
        <span class="di-panel-title ml-8px">在线测试 - {{ interfaceName }}</span>
      </div>
      <el-button type="primary" :loading="loading" @click="doPreview">
        <Icon icon="ep:video-play" class="mr-5px" /> 执行
      </el-button>
    </div>

    <!--
      写操作的常驻警示。必须在执行前就看得见 —— 等到点了「执行」才弹确认框，
      用户已经被「测试」这个词骗进来一次了
    -->
    <el-alert v-if="willWriteData" type="warning" :closable="false" show-icon class="mb-8px">
      <template #title>
        <span class="text-13px">
          该接口含写操作，点「执行」会<b>真的改动数据</b>，不是干跑。
          执行成功即提交，不会回滚；HTTP 类型的请求发出去更收不回来。
        </span>
      </template>
    </el-alert>

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

    <span class="text-12px text-[var(--el-text-color-secondary)]">测试最多返回 100 条</span>

    <!-- 实际执行的 SQL：核对租户条件是否按预期注入 -->
    <template v-if="executeSql">
      <div class="mb-6px mt-14px font-bold">实际执行的 SQL</div>
      <pre class="code-block">{{ executeSql }}</pre>
    </template>

    <!-- HTTP 接口配置信息 -->
    <template v-if="interfaceType === 3 && (baseUrl || allowInternalUrl)">
      <div class="mb-6px mt-14px font-bold">HTTP 配置</div>
      <div class="text-12px text-[var(--el-text-color-secondary)] mb-8px">
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
        <span v-if="isWriteAction && resultRows?.affectedRows !== undefined" class="ml-6px text-12px text-[var(--el-text-color-secondary)]">
          影响 {{ resultRows.affectedRows }} 行
        </span>
        <span v-else-if="Array.isArray(resultRows)" class="ml-6px text-12px text-[var(--el-text-color-secondary)]">
          共 {{ resultRows.length }} 条
        </span>
      </div>
      <el-alert v-if="errorMsg" type="error" :closable="false" :title="errorMsg" class="mb-8px" />
      <pre v-else class="code-block">{{ jsonResultText }}</pre>
    </template>
  </ContentWrap>
</template>

<script lang="ts" setup>
import * as DataInterfaceApi from '@/api/infra/dataInterface'

/** 在线测试面板（菜单按钮叫「测试」，文件名与组件名仍叫 Preview —— 理由见 index.vue 的 viewMode 注释）
 *
 * 与正式调用走同一个后端执行逻辑，所以「测试能跑通」等于「正式调用也能跑通」。
 * 页内展示（非弹窗），内容较多时体验更好。
 *
 * 🔴 正因为走的是同一套逻辑，含写操作的接口在这里点「执行」是真的会改库 ——
 * 后端的 preview 只在抛异常时回滚，成功就提交。所以本面板对写操作既常驻警示、
 * 又在执行前二次确认；后端 DataInterfaceServiceImpl#validatePreviewWritePermission
 * 还会再校验一次「配置写操作SQL」权限（前端拦不住直接调接口的人）
 */
defineOptions({ name: 'PreviewPanel' })

const emit = defineEmits(['back'])

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
/** HTTP 类型接口配置里的请求方法，用来判断这次测试会不会写数据 */
const httpMethod = ref('')

// 分页参数
const pageNo = ref(1)
const pageSize = ref(20)

/** 是否为写动作（INSERT/UPDATE/DELETE）。决定结果如何呈现 */
const isWriteAction = computed(
  () => sqlStatementType.value && sqlStatementType.value !== 'SELECT'
)

/**
 * 这次测试会不会真的动数据
 *
 * 三种类型分开判，判据逐条对齐后端 DataInterfaceServiceImpl#isReadOnly ——
 * 两边各写一套规则迟早会漂，漂了以后就是「前端说安全、后端拒绝执行」或者反过来。
 * 后端的 hasWriteOperation 字段只在 SQL 解析时写入，HTTP 的 POST 不体现在上面，
 * 所以这里不能图省事只看那一个字段
 */
const willWriteData = computed(() => {
  // 静态 JSON：没有副作用
  if (interfaceType.value === 2) {
    return false
  }
  // HTTP 转发：GET / HEAD 之外都算写
  if (interfaceType.value === 3) {
    const method = (httpMethod.value || 'GET').toUpperCase()
    return method !== 'GET' && method !== 'HEAD'
  }
  // SQL：动作类型不是 SELECT 就算写
  return !!isWriteAction.value
})

const jsonResultText = computed(() => {
  if (resultRows.value === null || resultRows.value === undefined) {
    return '（无返回内容）'
  }
  return JSON.stringify(resultRows.value, null, 2)
})

const isDateType = (type: string) => ['DATE', 'DATETIME'].includes(type)

const open = (row: DataInterfaceApi.DataInterfaceVO) => {
  interfaceId.value = row.id
  interfaceName.value = row.name
  interfaceType.value = row.type
  sqlStatementType.value = row.sqlStatementType
  baseUrl.value = row.baseUrl || ''
  allowInternalUrl.value = row.allowInternalUrl
  hasPage.value = row.hasPage ?? 0
  httpMethod.value = parseHttpMethod(row.config)
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

/**
 * 从 HTTP 配置里取请求方法
 *
 * 配置解析不出来时返回空串，由 willWriteData 兜底成 GET（与后端 isReadOnly 的默认值一致）。
 * 这里刻意不因为解析失败就假定「是写操作」：一个配置坏掉的 HTTP 接口本来就跑不通，
 * 报红条只会让人以为权限出了问题，反而盖住真正的错因
 */
const parseHttpMethod = (config?: string): string => {
  if (!config) {
    return ''
  }
  try {
    const parsed = JSON.parse(config)
    const method = parsed?.method
    return method == null ? '' : String(method)
  } catch {
    return ''
  }
}

const doPreview = async () => {
  if (!interfaceId.value) {
    return
  }
  // 写操作二次确认。常驻警示条已经说明过后果，这里只需要一个明确的「我真的要执行」
  if (willWriteData.value) {
    try {
      await ElMessageBox.confirm(
        `接口「${interfaceName.value}」含写操作，执行后会真实改动数据且不可回滚。确认执行？`,
        '写操作确认',
        { confirmButtonText: '确认执行', cancelButtonText: '取消', type: 'warning' }
      )
    } catch {
      return
    }
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
    // 执行失败也要展示原因，这是测试最有价值的场景之一
    errorMsg.value = e?.msg ?? e?.message ?? '执行失败'
    resultRows.value = null
  } finally {
    executed.value = true
    loading.value = false
  }
}
</script>

<style lang="scss" scoped>
.di-panel-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.code-block {
  padding: 10px;
  margin: 0;
  font-family: Consolas, Monaco, monospace;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--el-text-color-regular);
  background-color: var(--el-fill-color-light);
  border-radius: 4px;
}
</style>
