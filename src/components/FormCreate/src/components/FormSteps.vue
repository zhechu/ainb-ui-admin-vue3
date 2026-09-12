<template>
  <div class="form-steps">
    <el-steps :active="active" finish-status="success" align-center class="form-steps__header">
      <el-step
        v-for="(step, index) in steps"
        :key="step.id"
        :title="step.title"
        :class="{ 'is-clickable': index !== active }"
        @click="jumpTo(index)"
      />
    </el-steps>

    <!-- 每一步的内容由 FormStep 自己渲染，靠注入进去的 active 决定显隐 -->
    <div class="form-steps__body">
      <slot></slot>
    </div>

    <div v-if="steps.length > 1" class="form-steps__footer">
      <el-button :disabled="active <= 0" @click="prev">上一步</el-button>
      <el-button
        type="primary"
        :disabled="active >= steps.length - 1"
        :loading="validating"
        @click="next"
      >
        下一步
      </el-button>
    </div>
  </div>
</template>

<script lang="ts" setup>
/**
 * 步骤条容器（运行时）
 *
 * ## 步骤清单来自子组件注册，不来自规则树
 *
 * 容器能从 `formCreateInject.rule.children` 读到子规则，一开始也是那么写的。
 * 但那样有两个来源：头部的标题来自规则树，内容的显隐来自子组件 ——
 * 两边一旦不同步（设计器里拖动排序、复制粘贴），表现是「第 2 步的标题
 * 配着第 3 步的内容」，而且不报错。
 *
 * 现在只有一个来源：每个 FormStep 挂载时把自己的标题与字段注册进来，
 * 注册顺序就是文档顺序。头部与内容用的是同一份数组，不可能对不上。
 *
 * ## 只拦往后走，不拦往回退
 *
 * 与标签页上的分步校验（stepValidate.ts）语义一致。回到上一步改东西是正常操作，
 * 这时拦着他等于说「你上一步填错了所以不许回去改」。
 *
 * ## 设计器里不校验
 *
 * `validateStep` 由运行时注入（见 formSteps.ts 的说明）。设计器画布上取不到它，
 * 点「下一步」直接过 —— 设计者只是想看看第二步长什么样，不该被自己表单的
 * 必填项拦住。
 */
import { STEPS_INJECT_KEY, type StepEntry } from './formStepsInject'

defineOptions({ name: 'FormSteps' })

const props = defineProps<{
  /** 是否开启分步校验。属性面板默认开 */
  stepValidate?: boolean
  /**
   * 校验一批字段，由运行时注入。
   * 取不到就是设计器环境，一律放行
   */
  validateStep?: (fields: string[]) => Promise<boolean>
  /** 设计器注入 */
  formCreateInject?: any
}>()

const active = ref(0)
const validating = ref(false)
const steps = ref<StepEntry[]>([])

let seq = 0

provide(STEPS_INJECT_KEY, {
  active,
  /**
   * 子步骤注册
   *
   * @returns 本步骤的下标（响应式）——「我是第几步」会随着前面的步骤增删而变
   */
  register(entry: Omit<StepEntry, 'id'>) {
    const id = ++seq
    steps.value.push({ ...entry, id })
    const index = computed(() => steps.value.findIndex((step) => step.id === id))
    return {
      index,
      update(patch: Partial<StepEntry>) {
        const current = steps.value.find((step) => step.id === id)
        if (current) Object.assign(current, patch)
      },
      unregister() {
        const at = steps.value.findIndex((step) => step.id === id)
        if (at >= 0) steps.value.splice(at, 1)
        // 删掉的正好是当前步或它前面的步时，把游标收回到还存在的范围内，
        // 否则内容区会整个空掉 —— 看起来像表单坏了
        if (active.value > steps.value.length - 1) {
          active.value = Math.max(0, steps.value.length - 1)
        }
      }
    }
  }
})

/** 当前步能否离开 */
const canLeaveCurrent = async (): Promise<boolean> => {
  if (props.stepValidate === false || !props.validateStep) return true
  const fields = steps.value[active.value]?.fields ?? []
  if (fields.length === 0) return true
  validating.value = true
  try {
    return await props.validateStep(fields)
  } finally {
    validating.value = false
  }
}

const prev = () => {
  if (active.value > 0) active.value--
}

const next = async () => {
  if (active.value >= steps.value.length - 1 || validating.value) return
  if (!(await canLeaveCurrent())) return
  active.value++
}

/**
 * 点头部跳步
 *
 * 往回跳不校验；往前跳与「下一步」同一套规则，且只允许跳一步 ——
 * 允许从第 1 步直接跳到第 4 步的话，中间两步的校验就被绕过去了。
 */
const jumpTo = async (index: number) => {
  if (index === active.value || validating.value) return
  if (index < active.value) {
    active.value = index
    return
  }
  if (index > active.value + 1) return
  if (!(await canLeaveCurrent())) return
  active.value = index
}
</script>

<style lang="scss" scoped>
.form-steps__header {
  margin-bottom: 18px;
}

.form-steps__body {
  min-height: 40px;
}

.form-steps__footer {
  display: flex;
  gap: 8px;
  justify-content: center;
  margin-top: 12px;
}

// 可点的步骤给个手型，否则用户不知道头部能点
:deep(.is-clickable) {
  cursor: pointer;
}
</style>
