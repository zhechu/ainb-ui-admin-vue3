<template>
  <el-input
    v-model="innerValue"
    type="password"
    :show-password="showPassword"
    class="w-1/1"
    v-bind="attrs"
    @update:model-value="onInput"
  />
</template>

<script lang="ts" setup>
/**
 * 密码输入（运行时）
 *
 * ## 为什么需要这个组件
 *
 * 控件契约把 `password` 登记成一个**规则类型**（storage=scalar、maskable=true，
 * 且刻意关掉了列表列 / 查询 / 导出三个能力位 —— 密码字段出现在列表或导出文件里
 * 本身就是缺陷），后端也按 `rule.type` 去查这份契约。
 *
 * 但设计器内核的「密码输入」只是一个**菜单名**，它拖出来的规则是
 * `type: 'input' + props.type: 'password'`。于是：
 *
 * - 按契约写出来的规则（示例表单、外部导入的表单 JSON）里 `type: 'password'`
 *   在 form-create 里解析不到组件，渲染成一个 `<password>` 未知元素 —— 看得见标签、
 *   点不进去，就是「密码框无法输入」
 * - 反过来，从菜单拖出来的那个因为类型是 `input`，契约上那三个「不该出现在列表/导出里」
 *   的限制一条都不会生效
 *
 * 所以这里补上渲染器，并在 `useFormCreateDesigner` 里把菜单产出的规则类型也对齐到
 * `password`，让「契约怎么写的」和「设计器产出什么」是同一件事。
 *
 * ## 注册方式
 *
 * 走 form-create 自己的组件表（见 registerExtraWidgets.ts），不是 Vue 全局组件表。
 */
defineOptions({ name: 'PasswordInput' })

const attrs = useAttrs()

const props = withDefaults(
  defineProps<{
    modelValue?: string
    /** 是否显示「显示/隐藏密码」的小眼睛。默认开，与设计器属性面板的默认值一致 */
    showPassword?: boolean
    formCreateInject?: any
  }>(),
  { showPassword: true }
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

const innerValue = ref<string | undefined>(props.modelValue)

watch(
  () => props.modelValue,
  (value) => {
    innerValue.value = value
  }
)

const onInput = (value: string) => emit('update:modelValue', value)
</script>
