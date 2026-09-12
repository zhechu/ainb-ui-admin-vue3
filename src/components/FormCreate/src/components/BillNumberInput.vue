<template>
  <el-input
    :model-value="displayValue"
    readonly
    :placeholder="placeholderText"
    :disabled="disabled"
  >
    <template #prefix>
      <Icon icon="ep:tickets" />
    </template>
    <template v-if="loading" #suffix>
      <Icon icon="ep:loading" class="is-loading" />
    </template>
  </el-input>
</template>

<script lang="ts" setup>
import { occupyBillNo } from '@/api/infra/billTemplate'

/**
 * 单据组件
 *
 * 表单里的单号字段。始终只读 —— 单号由服务端生成，用户不能改。
 *
 * 组件名必须与后端 FormBillFieldResolver.COMPONENT_TYPE 保持一致，
 * 后端靠它在表单规则里认出哪些字段需要填号。
 *
 * 新增时会向服务端「预占」一个号并显示出来，让用户在提交前就能看到自己这张单的编号。
 * 预占对同一用户同一模板是幂等的，反复打开表单不会烧号；放弃填写则等预占过期作废。
 * 提交后服务端会核销这个预占，落库的就是显示的这个号。
 */
defineOptions({ name: 'BillNumberInput' })

const props = defineProps({
  /** form-create 注入的当前值 */
  modelValue: {
    type: String,
    default: ''
  },
  /** 规则模式：1-引用单据模板 2-内联规则 */
  ruleMode: {
    type: Number,
    default: 1
  },
  /** 引用的单据模板编码，ruleMode=1 时使用 */
  templateCode: {
    type: String,
    default: ''
  },
  /** 内联规则配置，ruleMode=2 时使用 */
  ruleConfig: {
    type: Object,
    default: () => ({})
  },
  disabled: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:modelValue'])

/** 预占到的号码。与 modelValue 分开存，避免把「显示用的占位提示」写回表单值 */
const occupied = ref('')
const loading = ref(false)
/** 预占失败的原因，失败时降级成提示文案 */
const failed = ref(false)

/** 已有值（编辑态）优先，其次是本次预占到的号 */
const displayValue = computed(() => props.modelValue || occupied.value)

const placeholderText = computed(() => {
  if (loading.value) return '正在获取单号…'
  // 预占失败不算错误：服务端在保存时仍会生成，只是用户提前看不到而已
  if (failed.value) return '保存后自动生成'
  return '系统自动生成'
})

/**
 * 预占一个单号
 *
 * 只在「新增 + 模板模式 + 已绑定模板」时执行：
 * - 编辑态已有值，再取号就是白白烧一个号
 * - 内联模式的号依赖同表单其它字段的值，用户还没填完，此时预占没有意义
 */
const tryOccupy = async () => {
  if (props.modelValue) return
  if (props.ruleMode !== 1 || !props.templateCode) {
    failed.value = true
    return
  }
  loading.value = true
  failed.value = false
  try {
    const no = await occupyBillNo(props.templateCode)
    occupied.value = no
    // 回写进表单值，提交时一并带给服务端去核销预占
    emit('update:modelValue', no)
  } catch {
    // 静默降级：保存时服务端仍会生成，不该因为预占失败挡住用户填表
    failed.value = true
  } finally {
    loading.value = false
  }
}

onMounted(tryOccupy)

/** 模板换了（设计器里实时改配置）就重新取一次 */
watch(
  () => props.templateCode,
  () => {
    occupied.value = ''
    tryOccupy()
  }
)
</script>
