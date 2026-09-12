<template>
  <!--
    v-show 而不是 v-if：非当前步的字段必须留在 DOM 与表单里。
    用 v-if 的话，第 2 步的必填项在第 1 步时根本不存在，
    提交时内核校验不到它们 —— 表现是「必填项没填也能提交」。
  -->
  <div v-show="isActive" class="form-step">
    <slot></slot>
  </div>
</template>

<script lang="ts" setup>
/**
 * 步骤条里的一步（运行时）
 *
 * 挂载时把自己的标题与字段注册进容器，注册顺序就是文档顺序，
 * 容器的头部与内容都用这一份数组（见 FormSteps.vue 的说明）。
 *
 * 不在容器外单独使用：契约里它 `inside: true`，设计器只允许拖进容器内部。
 * 万一真被单独渲染（历史规则、手改 JSON），注入取不到就一直显示自己 ——
 * 藏起来的话，那一段字段会静默从表单上消失。
 */
import { collectStepFields } from '@/components/FormWidgets/formSteps'
import { STEPS_INJECT_KEY, type StepHandle } from './formStepsInject'

defineOptions({ name: 'FormStep' })

const props = defineProps<{
  /** 步骤标题 */
  title?: string
  /** 设计器注入。从中取本步骤的规则子树，收集要校验的字段 */
  formCreateInject?: any
}>()

const steps = inject(STEPS_INJECT_KEY, null)

/** 本步骤里的字段。规则子树变了要跟着变，否则新拖进来的字段不参与分步校验 */
const fields = computed(() => collectStepFields(props.formCreateInject?.rule))
const title = computed(() => props.title || '步骤')

/**
 * 在 setup 期注册，不放到 onMounted
 *
 * 两个原因：
 * - onMounted 里注册的话，首帧 handle 还是空，`isActive` 只能返回 true，
 *   于是所有步骤会先一起闪一下再收起来
 * - handle 必须是响应式的。`let handle` 赋值不会让 `isActive` 重算，
 *   表现是内容区永远停在第一步
 *
 * setup 的执行顺序同样是文档顺序，注册顺序不受影响。
 */
const handle = shallowRef<StepHandle | null>(
  steps?.register({ title: title.value, fields: fields.value }) ?? null
)

const isActive = computed(() => {
  // 不在容器里时一直显示，理由见组件说明
  if (!steps || !handle.value) return true
  return handle.value.index.value === steps.active.value
})

watch([title, fields], ([newTitle, newFields]) => {
  handle.value?.update({ title: newTitle, fields: newFields })
})

onBeforeUnmount(() => {
  handle.value?.unregister()
  handle.value = null
})
</script>
