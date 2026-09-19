<template>
  <ContentWrap>
    <!-- 顶部操作栏：配置项较多，页内展示，保存/返回固定在顶部便于随时操作 -->
    <div class="bt-form-header mb-15px flex items-center justify-between">
      <div class="flex items-center">
        <el-button link @click="handleCancel">
          <Icon icon="ep:arrow-left" class="mr-5px" /> 返回
        </el-button>
        <span class="bt-form-title ml-8px">{{ formTitle }}</span>
      </div>
      <div class="flex items-center">
        <el-button @click="handleCancel">取 消</el-button>
        <el-button type="primary" :loading="formLoading" @click="submitForm">保 存</el-button>
      </div>
    </div>

    <!-- 控件较多，分两栏：左栏基本信息、右栏生成配置，减少上下滚动 -->
    <el-form
      ref="formRef"
      v-loading="formLoading"
      :model="formData"
      :rules="formRules"
      label-width="100px"
    >
      <el-row :gutter="24">
        <el-col :span="12">
          <div class="bt-col-title">基本信息</div>
          <el-form-item label="模板名称" prop="name">
            <el-input v-model="formData.name" placeholder="请输入模板名称" maxlength="100" />
          </el-form-item>

          <el-form-item label="模板编码" prop="code">
            <el-input
              v-model="formData.code"
              placeholder="只允许字母、数字、下划线"
              maxlength="100"
              :disabled="formType === 'update'"
            />
            <div class="form-tip">
              表单与其它模块通过它引用本模板。<b>保存后不建议修改</b>——
              它同时是流水计数的标识，改了等于换一个计数器，流水会从头开始。
            </div>
          </el-form-item>

          <el-form-item label="分类" prop="category">
            <el-select v-model="formData.category" placeholder="请选择分类" clearable class="w-full">
              <el-option
                v-for="dict in getStrDictOptions(DICT_TYPE.INFRA_BILL_TEMPLATE_CATEGORY)"
                :key="dict.value"
                :label="dict.label"
                :value="dict.value"
              />
            </el-select>
          </el-form-item>

          <el-form-item label="排序" prop="sort">
            <el-input-number v-model="formData.sort" :min="0" :precision="0" />
          </el-form-item>

          <el-form-item label="状态" prop="status">
            <el-radio-group v-model="formData.status">
              <el-radio :value="0">开启</el-radio>
              <el-radio :value="1">停用</el-radio>
            </el-radio-group>
          </el-form-item>

          <el-form-item label="备注" prop="remark">
            <el-input v-model="formData.remark" type="textarea" :rows="4" maxlength="500" />
          </el-form-item>
        </el-col>

        <el-col :span="12">
          <div class="bt-col-title">生成配置</div>
          <el-form-item label="生成方式" prop="genType">
            <el-radio-group v-model="formData.genType">
              <el-radio v-for="item in GEN_TYPE_OPTIONS" :key="item.value" :value="item.value">
                {{ item.label }}
              </el-radio>
            </el-radio-group>
          </el-form-item>

          <el-form-item label="前缀" prop="prefix">
            <el-input v-model="formData.prefix" placeholder="如 CG" maxlength="50" clearable />
          </el-form-item>

          <!-- 时间流水 -->
          <template v-if="formData.genType === GEN_TYPE.TIME">
            <el-form-item label="日期格式" prop="dateFormat">
              <el-select v-model="formData.dateFormat" class="w-full">
                <el-option
                  v-for="item in DATE_FORMAT_OPTIONS"
                  :key="item.value"
                  :label="item.label"
                  :value="item.value"
                />
              </el-select>
            </el-form-item>
    
            <el-form-item label="流水位数" prop="digit">
              <el-input-number v-model="formData.digit" :min="1" :max="9" :precision="0" />
              <div class="form-tip">
                流水值超过该位数时不会截断，而是输出更长的号码（截断会产生重复号），
                届时日志里会有告警提示调大位数。
              </div>
            </el-form-item>
    
            <el-form-item label="起始值" prop="startNumber">
              <el-input-number v-model="formData.startNumber" :min="0" :precision="0" />
            </el-form-item>
    
            <el-form-item label="步长" prop="step">
              <el-input-number v-model="formData.step" :min="1" :precision="0" />
            </el-form-item>
    
            <el-form-item label="重置周期" prop="resetCycle">
              <el-select v-model="formData.resetCycle" class="w-full">
                <el-option
                  v-for="item in RESET_CYCLE_OPTIONS"
                  :key="item.value"
                  :label="item.label"
                  :value="item.value"
                />
              </el-select>
              <div class="form-tip">
                「跟随日期格式」按日期的最小单位推导：含日按天、含月按月、含年按年。
                注意到秒、到毫秒的格式仍然<b>按天</b>重置——按秒重置会让每张单子的流水都是 1，等于没有流水。
              </div>
            </el-form-item>
    
            <el-form-item label="流水分组" prop="groupByPrefix">
              <el-switch v-model="formData.groupByPrefix" />
              <div class="form-tip">
                开启后<b>按前缀分别计数</b>。前缀是固定字符串时开不开都一样；
                它主要为表单里「前缀取自客户编号」这类场景准备——那时每个客户各自从 1 开始。
              </div>
            </el-form-item>
          </template>
    
          <!-- 随机数编号 -->
          <template v-if="formData.genType === GEN_TYPE.RANDOM">
            <el-form-item label="随机位数" prop="randomDigit">
              <el-select v-model="formData.randomDigit" class="!w-160px">
                <el-option
                  v-for="item in RANDOM_DIGIT_OPTIONS"
                  :key="item.value"
                  :label="item.label"
                  :value="item.value"
                />
              </el-select>
            </el-form-item>
    
            <el-form-item label="随机类型" prop="randomType">
              <el-radio-group v-model="formData.randomType">
                <el-radio v-for="item in RANDOM_TYPE_OPTIONS" :key="item.value" :value="item.value">
                  {{ item.label }}
                </el-radio>
              </el-radio-group>
              <div class="form-tip">
                随机方式不消耗流水计数，理论上存在重复可能，建议给目标列加唯一索引兜底。
              </div>
            </el-form-item>
          </template>
    
          <el-form-item v-if="formData.genType === GEN_TYPE.UUID" label=" ">
            <el-alert type="info" :closable="false" show-icon>
              UUID 方式生成 36 位大写字符串（含连字符），加上前后缀后容易超过
              <code>varchar(64)</code>，请确认目标列长度足够。
            </el-alert>
          </el-form-item>
    
          <el-form-item label="后缀" prop="suffix">
            <el-input v-model="formData.suffix" placeholder="如 -A" maxlength="50" clearable />
          </el-form-item>
    
          <!-- 范例由后端试算，保证与真实出号走同一段代码 -->
          <el-form-item label="范例">
            <div class="example-box">
              <span v-if="previewLoading" class="text-[var(--el-text-color-secondary)]">试算中…</span>
              <span v-else-if="previewError" class="text-[var(--el-color-danger)]">{{ previewError }}</span>
              <span v-else class="example-text">{{ previewText || '-' }}</span>
            </div>
            <div class="form-tip">由服务端按当前配置试算，<b>不消耗流水</b>。</div>
          </el-form-item>

          <el-form-item label="取号日志" prop="logEnabled">
            <el-switch v-model="formData.logEnabled" />
            <div class="form-tip">
              开启后每次取号都会记录日志（谁、何时、何途径、取得何号、当时的周期与序号），
              用于严格追溯场景；日志写在独立事务里，不影响取号结果。默认关闭。
            </div>
          </el-form-item>
        </el-col>
      </el-row>

      <!-- 底部再来一组操作按钮：表单较长，填到底部不必滚回顶部 -->
      <el-form-item label=" ">
        <el-button type="primary" :loading="formLoading" @click="submitForm">保 存</el-button>
        <el-button @click="handleCancel">取 消</el-button>
      </el-form-item>
    </el-form>
  </ContentWrap>
</template>

<script lang="ts" setup>
import { DICT_TYPE, getStrDictOptions } from '@/utils/dict'
import * as BillTemplateApi from '@/api/infra/billTemplate'
import {
  GEN_TYPE,
  GEN_TYPE_OPTIONS,
  DATE_FORMAT_OPTIONS,
  RESET_CYCLE_OPTIONS,
  RANDOM_DIGIT_OPTIONS,
  RANDOM_TYPE_OPTIONS
} from './constants'

defineOptions({ name: 'InfraBillTemplateForm' })

const { t } = useI18n()
const message = useMessage()

/** 面板是否已打开：试算 watch 的守卫，未打开时不发起试算请求 */
const opened = ref(false)
const formTitle = ref('')
const formLoading = ref(false)
const formType = ref('')
const formRef = ref()

const defaultForm = (): BillTemplateApi.BillTemplateSaveReqVO => ({
  id: undefined as any,
  name: '',
  code: '',
  category: undefined,
  genType: GEN_TYPE.TIME,
  prefix: '',
  suffix: '',
  dateFormat: 'yyyyMMdd',
  digit: 4,
  startNumber: 1,
  step: 1,
  resetCycle: 'AUTO',
  groupByPrefix: false,
  randomDigit: 16,
  randomType: 1,
  logEnabled: false,
  status: 0,
  sort: 0,
  remark: ''
})

const formData = ref<BillTemplateApi.BillTemplateSaveReqVO>(defaultForm())

const formRules = reactive({
  name: [{ required: true, message: '模板名称不能为空', trigger: 'blur' }],
  code: [
    { required: true, message: '模板编码不能为空', trigger: 'blur' },
    {
      pattern: /^[A-Za-z_][A-Za-z0-9_]*$/,
      message: '只允许字母、数字、下划线，且以字母或下划线开头',
      trigger: 'blur'
    }
  ],
  genType: [{ required: true, message: '生成方式不能为空', trigger: 'change' }],
  digit: [{ required: true, message: '流水位数不能为空', trigger: 'blur' }]
})

// ==================== 范例试算 ====================

const previewText = ref('')
const previewLoading = ref(false)
const previewError = ref('')

/** 试算请求的去抖计时器 */
let previewTimer: ReturnType<typeof setTimeout> | undefined
/**
 * 请求序号，用于丢弃过期响应
 *
 * 用户快速改配置会连发多个试算请求，网络乱序时后到的可能是旧配置的结果，
 * 范例框就会停在一个和当前配置对不上的值上。只认最后一次发出的请求。
 */
let previewSeq = 0

const doPreview = async () => {
  // 位数没填时后端会直接拒绝，没必要发这一趟
  if (formData.value.genType === GEN_TYPE.TIME && !formData.value.digit) {
    previewText.value = ''
    previewError.value = ''
    return
  }
  const seq = ++previewSeq
  previewLoading.value = true
  previewError.value = ''
  try {
    const text = await BillTemplateApi.previewBillTemplate({
      genType: formData.value.genType,
      prefix: formData.value.prefix,
      suffix: formData.value.suffix,
      dateFormat: formData.value.dateFormat,
      digit: formData.value.digit,
      startNumber: formData.value.startNumber,
      step: formData.value.step,
      randomDigit: formData.value.randomDigit,
      randomType: formData.value.randomType
    })
    if (seq !== previewSeq) return
    previewText.value = text
  } catch (e: any) {
    if (seq !== previewSeq) return
    previewText.value = ''
    previewError.value = e?.msg || '配置不合法，无法试算'
  } finally {
    if (seq === previewSeq) {
      previewLoading.value = false
    }
  }
}

/** 配置一变就重新试算，去抖 300ms 避免逐字输入时刷请求 */
watch(
  () => [
    formData.value.genType,
    formData.value.prefix,
    formData.value.suffix,
    formData.value.dateFormat,
    formData.value.digit,
    formData.value.startNumber,
    formData.value.step,
    formData.value.randomDigit,
    formData.value.randomType
  ],
  () => {
    if (!opened.value) return
    clearTimeout(previewTimer)
    previewTimer = setTimeout(doPreview, 300)
  }
)

// ==================== 打开与提交 ====================

const open = async (type: string, id?: number) => {
  opened.value = true
  formTitle.value = type === 'create' ? '新建单据模板' : '编辑单据模板'
  formType.value = type
  resetForm()
  if (id) {
    formLoading.value = true
    try {
      const data = await BillTemplateApi.getBillTemplate(id)
      // 逐字段挑，不整个对象铺开：详情里还有 example / lastNo / currentNumber /
      // resetCycleActual 这些只读字段，后端不接受前端回传它们（统计值只能由出号流程写）
      formData.value = {
        id: data.id,
        name: data.name,
        code: data.code,
        category: data.category,
        genType: data.genType,
        prefix: data.prefix ?? '',
        suffix: data.suffix ?? '',
        dateFormat: data.dateFormat,
        digit: data.digit,
        startNumber: data.startNumber,
        step: data.step,
        resetCycle: data.resetCycle,
        groupByPrefix: data.groupByPrefix,
        randomDigit: data.randomDigit,
        randomType: data.randomType,
        logEnabled: data.logEnabled ?? false,
        status: data.status,
        sort: data.sort,
        remark: data.remark
      }
    } finally {
      formLoading.value = false
    }
  }
  await doPreview()
}
defineExpose({ open })

const emit = defineEmits(['success', 'back'])

const handleCancel = () => {
  opened.value = false
  emit('back')
}

const submitForm = async () => {
  await formRef.value?.validate()
  formLoading.value = true
  try {
    const data = { ...formData.value }
    if (formType.value === 'create') {
      await BillTemplateApi.createBillTemplate(data)
      message.success(t('common.createSuccess'))
    } else {
      await BillTemplateApi.updateBillTemplate(data)
      message.success(t('common.updateSuccess'))
    }
    opened.value = false
    emit('success')
  } finally {
    formLoading.value = false
  }
}

const resetForm = () => {
  formData.value = defaultForm()
  previewText.value = ''
  previewError.value = ''
  formRef.value?.resetFields()
}
</script>

<style lang="scss" scoped>
.bt-form-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.bt-col-title {
  padding-bottom: 8px;
  margin-bottom: 18px;
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.form-tip {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}

.example-box {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 32px;
  padding: 0 12px;
  background-color: var(--el-fill-color-light);
  border-radius: 4px;
}

.example-text {
  font-family: Consolas, Monaco, 'Courier New', monospace;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.5px;
}
</style>
