<template>
  <Dialog :title="dialogTitle" v-model="dialogVisible" width="900px">
    <el-form ref="formRef" :model="formData" :rules="formRules" label-width="100px" v-loading="formLoading">
      <el-row :gutter="16">
        <el-col :span="12">
          <el-form-item label="接口名称" prop="name">
            <el-input v-model="formData.name" placeholder="如 订单列表查询" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="接口编码" prop="code">
            <el-input
              v-model="formData.code"
              placeholder="如 order_list"
              :disabled="formType === 'update'"
            />
          </el-form-item>
        </el-col>
      </el-row>
      <el-row :gutter="16">
        <el-col :span="12">
          <el-form-item label="类型" prop="type">
            <el-select v-model="formData.type" class="w-full" @change="handleTypeChange">
              <el-option
                v-for="item in typeOptions"
                :key="item.value"
                :label="item.label"
                :value="item.value"
              />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="分类" prop="category">
            <el-select
              v-model="formData.category"
              placeholder="请选择分类"
              clearable
              style="width: 100%"
            >
              <el-option
                v-for="dict in getStrDictOptions(DICT_TYPE.INFRA_FORM_TYPE)"
                :key="dict.value"
                :label="dict.label"
                :value="dict.value"
              />
            </el-select>
          </el-form-item>
        </el-col>
      </el-row>

      <!-- 动作类型：SQL 类型必选。
           程序无法可靠判断多条 SQL 组合起来算什么动作，所以交给用户自己选 -->
      <el-form-item v-if="formData.type === 1" label="动作类型" prop="sqlStatementType">
        <div class="w-full">
          <el-radio-group v-model="formData.sqlStatementType" @change="handleStatementTypeChange">
            <el-radio
              v-for="item in statementTypeOptions"
              :key="item.value"
              :value="item.value"
              :label="item.value"
            >
              {{ item.label }}
              <span class="text-gray-400">（{{ item.value }}）</span>
            </el-radio>
          </el-radio-group>
          <div class="mt-2px text-12px text-gray-500">
            一个接口可以写多条 SQL，程序难以准确判断整体属于什么动作，请按实际意图选择。
            <span v-if="!isSelectAction">非查询动作只返回影响行数，且不能开启分页。</span>
          </div>
        </div>
      </el-form-item>

      <!-- 动作类型与 SQL 实际语句不一致时提示。
           后端只在「选查询但含写语句」时阻断，反方向仅提示 -->
      <el-form-item v-if="mismatchTip" label=" ">
        <el-alert :type="mismatchTip.type" :closable="false" show-icon class="w-full">
          <template #title>
            <span class="text-13px">{{ mismatchTip.text }}</span>
          </template>
        </el-alert>
      </el-form-item>

      <!-- SQL 类型显示数据源选择 -->
      <el-form-item v-if="formData.type === 1" label="数据源" prop="dataSourceConfigId">
        <el-select v-model="formData.dataSourceConfigId" class="w-full" placeholder="选择数据源">
          <el-option
            v-for="item in dataSourceOptions"
            :key="item.id"
            :label="item.name"
            :value="item.id"
          />
        </el-select>
        <div class="mt-2px text-12px text-gray-500">
          默认使用主数据源，如需连接其他数据库请在「数据源配置」中添加后选择
        </div>
      </el-form-item>

      <!-- 按类型切换配置区 -->
      <el-form-item label="配置" prop="config">
        <SqlConfig
          v-if="formData.type === 1"
          v-model="formData.config"
          :params="formData.params"
          v-model:hasPage="formData.hasPage"
          v-model:countSql="formData.countSql"
          :dataSourceId="formData.dataSourceConfigId"
          :statementType="formData.sqlStatementType"
        />
        <StaticConfig v-else-if="formData.type === 2" v-model="formData.config" />
        <HttpConfigEnhanced
          v-else
          v-model="formData.config"
          v-model:allowInternalUrl="formData.allowInternalUrl"
        />
      </el-form-item>

      <el-form-item label="入参定义">
        <ParamTable v-model="formData.params" />
      </el-form-item>

      <el-form-item label="后处理脚本">
        <ScriptConfig v-model="formData.script" />
      </el-form-item>

      <el-form-item label="备注" prop="remark">
        <el-input v-model="formData.remark" placeholder="选填" />
      </el-form-item>
      <el-form-item v-if="formType === 'update'" label="变更说明" prop="changeSummary">
        <el-input v-model="formData.changeSummary" placeholder="记入版本历史，便于日后追溯" />
      </el-form-item>
    </el-form>

    <template #footer>
      <!-- 只有选了写动作才需要确认。后端也会校验，这里让用户提前知晓 -->
      <el-checkbox
        v-if="formData.type === 1 && !isSelectAction"
        v-model="formData.riskConfirmed"
        class="mr-15px"
      >
        我知晓此接口会
        <b class="text-red-500">{{ currentActionLabel }}</b>
        数据
      </el-checkbox>
      <el-button type="primary" :disabled="formLoading" @click="submitForm">确 定</el-button>
      <el-button @click="dialogVisible = false">取 消</el-button>
    </template>
  </Dialog>
</template>

<script lang="ts" setup>
import * as DataInterfaceApi from '@/api/infra/dataInterface'
import * as DataSourceConfigApi from '@/api/infra/dataSourceConfig'
import SqlConfig from './components/SqlConfig.vue'
import StaticConfig from './components/StaticConfig.vue'
import HttpConfig from './components/HttpConfig.vue'
import HttpConfigEnhanced from './components/HttpConfigEnhanced.vue'
import ScriptConfig from './components/ScriptConfig.vue'
import ParamTable from './components/ParamTable.vue'
import { DICT_TYPE, getStrDictOptions } from '@/utils/dict'

/** 数据接口配置表单 */
defineOptions({ name: 'DataInterfaceForm' })

const message = useMessage()
const { t } = useI18n()

const dialogVisible = ref(false)
const dialogTitle = ref('')
const formLoading = ref(false)
const formType = ref('')
const formRef = ref()
const typeOptions = ref<DataInterfaceApi.OptionVO[]>([])
const statementTypeOptions = ref<DataInterfaceApi.OptionVO[]>([])
const dataSourceOptions = ref<DataSourceConfigApi.DataSourceConfigVO[]>([])
/** SQL 探测结果，用于提示动作类型是否选对 */
const sqlDetect = ref<DataInterfaceApi.SqlDetectVO | null>(null)

const formData = ref<DataInterfaceApi.DataInterfaceSaveReqVO>(emptyForm())

const formRules = reactive({
  name: [{ required: true, message: '接口名称不能为空', trigger: 'blur' }],
  code: [
    { required: true, message: '接口编码不能为空', trigger: 'blur' },
    {
      pattern: /^[A-Za-z_][A-Za-z0-9_]*$/,
      message: '只允许字母、数字、下划线，且以字母或下划线开头',
      trigger: 'blur'
    }
  ],
  type: [{ required: true, message: '类型不能为空', trigger: 'change' }],
  // 动作类型只在 SQL 类型下必填，用 validator 而不是 required 来表达这个条件
  sqlStatementType: [
    {
      validator: (_rule: any, value: string, callback: any) => {
        if (formData.value.type === 1 && !value) {
          callback(new Error('请选择动作类型'))
          return
        }
        callback()
      },
      trigger: 'change'
    }
  ],
  config: [{ required: true, message: '配置不能为空', trigger: 'blur' }]
})

/** 当前是否查询动作。决定能否开分页、要不要勾风险确认 */
const isSelectAction = computed(() => formData.value.sqlStatementType === 'SELECT')

const currentActionLabel = computed(
  () =>
    statementTypeOptions.value.find((item) => item.value === formData.value.sqlStatementType)
      ?.label ?? '修改'
)

/**
 * 动作类型与 SQL 实际语句的比对提示
 *
 * 两个方向的严重程度不同：
 * - 选「查询」但 SQL 含写语句：后端会拒绝保存，标红
 * - 选写动作但 SQL 全是查询：可能是用户先选类型再写 SQL，也可能是解析器认不准的
 *   写法（存储过程等），后端不阻断，这里只黄色提醒
 */
const mismatchTip = computed(() => {
  const detect = sqlDetect.value
  if (formData.value.type !== 1 || !detect || !detect.success || !formData.value.sqlStatementType) {
    return null
  }
  const writeTypes = detect.writeStatementTypes ?? []
  if (isSelectAction.value && writeTypes.length > 0) {
    return {
      type: 'error' as const,
      text: `SQL 中检测到 ${writeTypes.join('、')} 语句，动作类型不能选「查询」，请改选对应的动作类型。`
    }
  }
  if (!isSelectAction.value && !detect.hasWriteOperation) {
    return {
      type: 'warning' as const,
      text: `SQL 中未检测到写操作语句，请确认动作类型「${currentActionLabel.value}」是否选对。若 SQL 用了存储过程等特殊写法，可忽略此提示。`
    }
  }
  return null
})

function emptyForm(): DataInterfaceApi.DataInterfaceSaveReqVO {
  return {
    name: '',
    code: '',
    category: '',
    type: 1,
    status: 0,
    dataSourceConfigId: 0,
    config: '',
    params: [],
    script: '',
    // 默认「查询」：最常用也最安全，选错了顶多是少了个提示，不会误改数据
    sqlStatementType: 'SELECT',
    remark: '',
    changeSummary: '',
    riskConfirmed: false,
    hasPage: 0,
    countSql: '',
    baseUrl: '',
    allowInternalUrl: 0
  }
}

const open = async (type: string, id?: number) => {
  dialogVisible.value = true
  dialogTitle.value = type === 'create' ? '新建数据接口' : '配置数据接口'
  formType.value = type
  formData.value = emptyForm()
  formRef.value?.resetFields()
  sqlDetect.value = null

  if (typeOptions.value.length === 0) {
    typeOptions.value = await DataInterfaceApi.getTypeOptions()
  }
  if (statementTypeOptions.value.length === 0) {
    statementTypeOptions.value = await DataInterfaceApi.getStatementTypeOptions()
  }
  // 加载数据源列表
  if (dataSourceOptions.value.length === 0) {
    dataSourceOptions.value = await DataSourceConfigApi.getDataSourceConfigList()
  }
  if (type === 'update' && id) {
    formLoading.value = true
    try {
      const data = await DataInterfaceApi.getDataInterface(id)
      formData.value = {
        ...data,
        // 后端存的是 JSON 字符串，前端要数组
        params: parseParams(data.params),
        // 历史数据可能没有动作类型，兜底成查询，让用户显式确认一次
        sqlStatementType: data.sqlStatementType || 'SELECT',
        changeSummary: '',
        riskConfirmed: false
      }
      // 打开就探测一次，让「历史数据动作类型不对」立刻暴露出来
      runDetect()
    } finally {
      formLoading.value = false
    }
  }
}
defineExpose({ open })

const emit = defineEmits(['success'])

/** 入参定义在后端以 JSON 字符串存储，解析失败时退回空数组而不是崩掉表单 */
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

/** 切类型时清掉配置，避免把 SQL 当 JSON 提交 */
const handleTypeChange = () => {
  formData.value.config = ''
  sqlDetect.value = null
  if (formData.value.type === 1) {
    formData.value.sqlStatementType = 'SELECT'
  } else {
    // 非 SQL 类型没有动作类型与分页概念，一并清掉，避免提交脏值
    formData.value.sqlStatementType = undefined
    formData.value.hasPage = 0
    formData.value.countSql = ''
    formData.value.riskConfirmed = false
  }
}

/** 切动作类型时的联动：非查询动作关掉分页，并重置风险确认 */
const handleStatementTypeChange = () => {
  if (!isSelectAction.value) {
    formData.value.hasPage = 0
    formData.value.countSql = ''
  }
  // 换了动作类型就得重新确认一次风险，不能沿用上次的勾选
  formData.value.riskConfirmed = false
}

/**
 * 探测 SQL 里的语句类型
 *
 * 解析失败不提示 —— 用户正在编辑，SQL 写一半是常态，弹一堆红字很吵。
 */
const runDetect = async () => {
  if (formData.value.type !== 1 || !formData.value.config?.trim()) {
    sqlDetect.value = null
    return
  }
  try {
    sqlDetect.value = await DataInterfaceApi.detectSql(formData.value.config)
  } catch {
    sqlDetect.value = null
  }
}

/** SQL 改动后延迟探测，避免每敲一个字符都发请求 */
let detectTimer: ReturnType<typeof setTimeout> | undefined
watch(
  () => formData.value.config,
  () => {
    if (formData.value.type !== 1) {
      return
    }
    clearTimeout(detectTimer)
    detectTimer = setTimeout(runDetect, 600)
  }
)

const submitForm = async () => {
  try {
    await formRef.value?.validate()
  } catch {
    return
  }
  // 选「查询」但 SQL 含写语句，后端会拒绝。这里先拦一次，省一趟请求
  if (mismatchTip.value?.type === 'error') {
    message.error(mismatchTip.value.text)
    return
  }
  if (formData.value.type === 1 && !isSelectAction.value && !formData.value.riskConfirmed) {
    message.warning(`请勾选「我知晓此接口会${currentActionLabel.value}数据」`)
    return
  }
  formLoading.value = true
  try {
    if (formType.value === 'create') {
      await DataInterfaceApi.createDataInterface(formData.value)
      message.success(t('common.createSuccess'))
    } else {
      await DataInterfaceApi.updateDataInterface(formData.value)
      message.success(t('common.updateSuccess'))
    }
    dialogVisible.value = false
    emit('success')
  } finally {
    formLoading.value = false
  }
}
</script>
