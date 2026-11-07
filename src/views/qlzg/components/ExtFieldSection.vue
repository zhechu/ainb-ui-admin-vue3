<template>
  <div v-if="visible" class="ext-field-section">
    <el-divider v-if="title" content-position="left">
      <span class="text-14px font-500">{{ title }}</span>
    </el-divider>

    <!-- 🔴 定义拉不到时**必须**看得见，见 loadDefs 的注释 -->
    <el-alert v-if="loadError" type="error" :closable="false" show-icon class="mb-12px">
      <template #title>机构自定义字段没能载入</template>
      <div class="text-12px leading-20px">
        本次不会显示、也不会修改这些字段；宿主其余内容照常保存。
        <el-button link type="primary" :loading="loading" @click="loadDefs">重试</el-button>
      </div>
    </el-alert>

    <!--
      🔴 「一个字段都没配」是**正常状态**，与上面那个故障是两回事，所以文案由调用方给：
      资料那个弹窗要指向「去字段管理」，宿主表单里则压根不该出现这一段（showEmpty=false）。
      只在 loadedOnce 之后判，否则挂载到请求回来之间会闪一下「还没配字段」。
    -->
    <el-alert
      v-else-if="showEmpty && loadedOnce && !hasDefs"
      type="info"
      :closable="false"
      show-icon
      class="mb-12px"
    >
      <template #title>本机构还没有配置这一类自定义字段</template>
      <div class="text-12px leading-20px">
        <slot name="empty"></slot>
      </div>
    </el-alert>

    <!-- 🔴 建不出规则的字段一定要说出来，不能只 warn -->
    <el-alert
      v-if="skipped.length"
      type="warning"
      :closable="false"
      show-icon
      class="mb-12px"
      :title="`有 ${skipped.length} 个字段的控件已不可用，本次不会显示`"
    >
      <div class="text-12px leading-20px">
        {{ skipped.map((item) => item.fieldLabel).join('、') }}
        —— 请联系系统管理员调整这些字段的控件类型。若其中有必填项，本次保存会被服务端拒绝。
      </div>
    </el-alert>

    <form-create
      v-if="rules.length"
      v-model="model"
      v-model:api="fApi"
      :rule="rules"
      :option="formOption"
    />
  </div>
</template>

<script lang="ts" setup>
/**
 * 扩展字段区块（I29-e）
 *
 * <h3>它是一块**子表单**，不接管宿主页面</h3>
 * 照 {@code bpm/processInstance/detail/index.vue} 那几处先例的做法：宿主的
 * {@code el-form} 仍然是权威，这一块只在下面追加一段 {@code <form-create>}，
 * 通过 {@code v-model} 与宿主的 {@code formData.ext} 对接。
 * 整页接管的话，宿主那几十条手写的校验规则与联动逻辑都要重写一遍 ——
 * 而扩展字段的定位是「给主表加几个机构自定义列」，不该反过来定义主表长什么样。
 *
 * <h3>🔴 宿主提交前**必须**先 {@code await extRef.value?.validate()}</h3>
 * 这一块是独立的 form-create 实例，宿主的 {@code formRef.validate()} **管不到它**。
 * 漏掉那一句的后果是：机构配了一个必填的扩展字段，用户不填也能点「确定」，
 * 而服务端的权威校验会拒收 —— 用户看到的是一句从后端回来的报错，
 * 而不是输入框下面那行红字。功能是对的，但体验是坏的，
 * 且**报错文案与界面语言可能不一致**（后端返回的是 {@code FIELD_DEF_REQUIRED_MISSING}）。
 *
 * <h3>🔴 空的时候整块不渲染，但**载入失败**要渲染</h3>
 * 一个机构没配任何扩展字段时（现在的默认状态），这里连分隔线都不出现。
 * 显示一个空的「机构自定义字段」标题会让用户以为功能坏了，
 * 而「没有这一块」与「这一块是空的」在界面上必须是两回事。
 * 但「这一块没载进来」是**第三回事**，必须看得见：它意味着宿主表单少了几列、
 * 而这几列的值本次不会被修改（{@code ext} 原样发回去）。不说的话用户无从知道，
 * 而 §11.20.5 的 UI 纪律是「关掉 / 降级的功能要自己说清楚」。
 *
 * <h3>为什么每次打开都重新拉字段定义</h3>
 * 本仓的 {@code Dialog} 带 {@code destroy-on-close}，所以弹窗关闭即销毁、打开即重挂载，
 * {@code onMounted} 里那一次请求天然就是「每次打开都拉最新」。
 * 🔴 不要为了省一次请求把它改成缓存：机构管理员**刚配完一个字段**就去开项目弹窗，
 * 是最常见的一条验证路径，缓存会让那条路径上「新字段没出现」，
 * 而没有任何提示能让人怀疑到缓存上。
 */
import type { Api as FormCreateApi } from '@form-create/element-ui'
import { QlzgFieldDefApi, type QlzgEntityType, type QlzgFieldDefVO } from '@/api/qlzg/fieldDef'
import {
  buildExtFieldRules,
  compactExt,
  loadExtModel,
  type ExtFieldRenderScene
} from './extFieldRule'

defineOptions({ name: 'QlzgExtFieldSection' })

const props = withDefaults(
  defineProps<{
    /** 宿主 {@code ext_json} 的值 */
    modelValue?: Record<string, any> | null
    /** 宿主实体类型，与后端 {@code QlzgEntityTypeEnum} 逐字一致 */
    entityType: QlzgEntityType
    /** 渲染场景。表单传 FORM，详情页传 DETAIL */
    scene?: ExtFieldRenderScene
    /** 分隔线上的标题 */
    title?: string
    /** 标签宽度，跟宿主表单对齐才不会看起来是两块拼起来的 */
    labelWidth?: string
    /**
     * 一个字段都没配时，是否显示一段说明
     *
     * 🔴 默认 false：宿主表单里「这一块不出现」才是对的（见类注释）。
     *    但资料那个**独立弹窗**必须显示 —— 用户是专门点进来改字段的，
     *    给他一个空弹窗等于让他猜是坏了还是没配。
     */
    showEmpty?: boolean
  }>(),
  {
    modelValue: null,
    scene: 'FORM',
    title: '机构自定义字段',
    labelWidth: '140px',
    showEmpty: false
  }
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: Record<string, any>): void
}>()

const defs = ref<QlzgFieldDefVO[]>([])
const loading = ref(false)
const loadError = ref(false)
/** 第一次加载有没有跑完（成功或失败都算）。没跑完之前不判「有没有字段」，否则会闪一下空状态 */
const loadedOnce = ref(false)
const fApi = ref<FormCreateApi>()

const built = computed(() => buildExtFieldRules(defs.value, props.scene))
const rules = computed(() => built.value.rules)
const skipped = computed(() => built.value.skipped)

const model = ref<Record<string, any>>({})

/**
 * 🔴 有没有字段定义。**要**暴露出去，因为宿主的处置不一样：
 * 项目 / 委托方 / 标的的表单里，没定义就等于「这一块不出现」，宿主照常保存；
 * 而资料的「编辑自定义字段」是一个**独立的弹窗**，它的「保存」按钮必须靠这个判据锁住 ——
 * 那个端点上 {@code null} / {@code {}} 的含义是**清空**（与三个宿主相反），
 * 所以「不知道有哪些字段」的时候按下去就是删数据。
 */
const hasDefs = computed(() => defs.value.length > 0)

/** 定义已载入、没出错、且确实有字段 —— 只有这个状态下写 {@code ext} 才是安全的 */
const ready = computed(() => loadedOnce.value && !loadError.value && hasDefs.value)

/**
 * 🔴 空的时候整块不渲染；但**载入失败**要渲染（否则「没配字段」与「字段没载进来」
 * 在界面上长得一模一样），{@code showEmpty} 时**确实没配**也要渲染
 */
const visible = computed(
  () => hasDefs.value || loadError.value || (props.showEmpty && loadedOnce.value)
)

const formOption = computed(() => ({
  submitBtn: false,
  resetBtn: false,
  form: { labelWidth: props.labelWidth }
}))

/**
 * 上一次发出去的那一份，用来识别「自己发的值又回来了」
 *
 * 🔴 这个识别是**必须**的，否则会成一个回环：emit → 宿主赋值 → props.modelValue 变 →
 * watch 触发 → 重建 model → 触发 model 的 watch → 再 emit ……
 * 而重建 model 会把用户正在输入的内容**重置成库里那份**，
 * 表现是「输入框里打一个字就跳回原值」，且控制台干干净净。
 */
let lastEmitted: Record<string, any> | null = null
let lastEmittedJson = ''

/** 键排序后的 JSON，用来在「宿主克隆了一份」的情况下也能认出是同一个值 */
const canonical = (value: Record<string, any> | null | undefined): string => {
  const source = value ?? {}
  const sorted: Record<string, any> = {}
  for (const key of Object.keys(source).sort()) {
    sorted[key] = source[key]
  }
  return JSON.stringify(sorted)
}

watch(
  model,
  () => {
    // 🔴 定义没载进来时一个字都不发，见 loadDefs 的注释
    if (loadError.value) {
      return
    }
    const next = compactExt(model.value)
    lastEmitted = next
    lastEmittedJson = canonical(next)
    emit('update:modelValue', next)
  },
  { deep: true }
)

watch(
  () => props.modelValue,
  (value) => {
    if (loadError.value) {
      return
    }
    // 自己发出去的那一份回来了：既不是同一个对象（宿主可能克隆过），值也一样，就什么都不做
    if (value === lastEmitted || canonical(value) === lastEmittedJson) {
      return
    }
    model.value = loadExtModel(defs.value, value, props.scene)
  },
  { deep: true }
)

/**
 * 拉字段定义
 *
 * <h3>🔴 失败时**一个字都不能发回宿主**，这一条是这里唯一真正的数据安全线</h3>
 * 发出去的是 {@code compactExt(model)}，而失败时 {@code defs} 是空的 → {@code model} 是空的 →
 * 发出去的就是 {@code {}}。对三个宿主 Save VO 来说 {@code {}} **不是**「不改」而是
 * **整列覆盖成空**，后端只把「没有定义的键」和「停用字段」从库里带回来，
 * **启用中的字段的值一律被删掉**（{@code QlzgExtFieldValidator#carryOverReadOnly}）。
 * 对 {@code QlzgMaterialApi.updateExt} 更直接：那个端点上 {@code null} / {@code {}} 就是「清空」。
 *
 * <p>于是「一次网络抖动」的代价是**静默清空机构自定义字段**，而界面上显示的是「保存成功」 ——
 * 因为宿主表单本身没坏、后端也确实返回了 200。所以 {@link loadError} 同时做三件事：
 * ① 挡住两个 watch（不 emit、也不重建 model，宿主的 {@code ext} 保持从记录里读来的原值，
 * 原样发回去后端会按同一批定义再校验一遍，值没变自然通过）；
 * ② 让整块渲染出来（{@link visible}），③ 显示一个带「重试」的红色 alert。
 *
 * ⚠️ 别把 {@code model.value = loadExtModel(...)} 挪进 {@code finally}「让代码整齐一点」：
 *    那恰好会在失败那一支给 model 赋一个新对象，deep watch 立刻触发，上面那条防线就没了。
 *    这里「catch 分支不碰 model」不是遗漏，是**实现**。
 *
 * ⚠️ 不静默重试：拉不到定义时宿主表单是完整的、只是少了几个字段，
 *    自动重试会在用户填表的过程中突然把这一块插进页面、把布局顶下去。
 *    交给用户点「重试」，代价只是他多点一次。
 * ⚠️ 也不再弹一次错误提示：axios 那一层已经弹过了，同一个错误说两遍。
 */
const loadDefs = async () => {
  loading.value = true
  try {
    defs.value = (await QlzgFieldDefApi.getList(props.entityType)) ?? []
    loadError.value = false
    model.value = loadExtModel(defs.value, props.modelValue, props.scene)
  } catch {
    defs.value = []
    loadError.value = true
  } finally {
    loading.value = false
    loadedOnce.value = true
  }
}

onMounted(loadDefs)

/**
 * 校验这一块
 *
 * 🔴 没有规则时返回 {@code true}，不是 {@code undefined} ——
 * 宿主写的是 {@code if (!(await extRef.value?.validate())) return}，
 * 一个 undefined 会被当成校验失败，于是「没配扩展字段的机构」永远存不下项目。
 *
 * @returns 校验通过返回 true；不通过返回 false（form-create 的 reject 结果被吞掉，
 *          因为它已经在界面上标红了，宿主不需要那份明细）
 */
const validate = async (): Promise<boolean> => {
  if (!rules.value.length || !fApi.value) {
    return true
  }
  try {
    await fApi.value.validate()
    return true
  } catch {
    return false
  }
}

/**
 * 🔴 暴露出去的四个状态各有调用方，别删：
 * {@code validate} 给三个宿主表单（提交前必须 await）；
 * {@code ready} 给资料那个独立弹窗（它的 {@code null}/{@code {}} 语义是清空，
 * 所以「没就绪」时保存按钮必须是灰的，见 {@code MaterialExtDialog}）；
 * {@code loadError} / {@code loading} 给同一处的文案分支。
 */
defineExpose({ validate, loading, loadError, hasDefs, ready, reload: loadDefs })
</script>

<style lang="scss" scoped>
.ext-field-section {
  :deep(.el-divider__text) {
    color: var(--el-text-color-primary);
  }
}
</style>
