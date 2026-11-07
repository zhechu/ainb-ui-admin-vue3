<template>
  <el-dialog
    :model-value="modelValue"
    title="编辑自定义字段"
    width="700px"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    append-to-body
    destroy-on-close
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <div v-loading="loading">
      <div v-if="fileName" class="mb-12px text-13px text-[var(--el-text-color-secondary)]">
        {{ fileName }}
      </div>

      <!-- 🔴 读不到当前值就不能保存：这个端点把「没给」当成「清空」，见类注释 -->
      <el-alert v-if="loadFailed" type="error" :closable="false" show-icon title="资料读不出来">
        <div class="text-12px leading-20px">
          不知道里面原来有什么，就没法安全地写回去 —— 此时保存等于清空。
          <el-button link type="primary" @click="load">重试</el-button>
        </div>
      </el-alert>

      <ExtFieldSection
        v-else
        ref="extRef"
        v-model="ext"
        entity-type="QLZG_MATERIAL"
        scene="FORM"
        title=""
        label-width="140px"
        show-empty
      >
        <template #empty>
          去「启凌智估 → 字段管理」把宿主选成<b>评估资料</b>、加几个字段，这里就会出现。
          <el-button link type="primary" @click="gotoFieldDef">去字段管理</el-button>
        </template>
      </ExtFieldSection>
    </div>

    <template #footer>
      <el-button :disabled="!canSubmit" :loading="submitting" type="primary" @click="submit">
        保 存
      </el-button>
      <el-button @click="emit('update:modelValue', false)">取 消</el-button>
    </template>
  </el-dialog>
</template>

<script lang="ts" setup>
import { QlzgMaterialApi } from '@/api/qlzg/material'
import ExtFieldSection from '@/views/qlzg/components/ExtFieldSection.vue'

/**
 * 单份资料的自定义字段编辑（I29-e）
 *
 * <h3>🔴 为什么资料要一个独立弹窗，而项目 / 委托方 / 标的是挂在主表单里</h3>
 * 那三个宿主的 Save VO 上都有 {@code ext}，改项目时顺手就改了；
 * 资料的写入路径有五条（prepare / confirm / 秒传 / 批量归类 / 重抽），
 * 后端只在 {@code PUT /qlzg/material/update-ext} 这一个端点上收 {@code ext}。
 * 于是这里只能是「读一份资料 → 改这一块 → 单独存」。
 *
 * <h3>🔴 这个端点上 {@code null} / {@code {}} 的含义是【清空】，与三个宿主相反</h3>
 * 所以「读不到当前值」在这里是**致命**的，不是「少显示几个字段」：
 * 拿一份 {@code null} 去保存，就是把这份资料的自定义字段全删了，而后端返回 200、
 * 界面提示「保存成功」。{@link canSubmit} 因此要求两件事同时成立才亮：
 * ① 资料本身读到了（{@code !loadFailed}），
 * ② {@code ExtFieldSection} 就绪（{@code ready} = 定义载入成功**且**确实有字段）。
 *
 * <p>第 ② 条里的「确实有字段」看着多余 —— 没字段还有什么可存的 —— 但少了它，
 * 「本机构一个字段都没配」的情况下点保存会发一个 {@code {}} 上去。此刻库里那一列本来就是空的，
 * 所以**当下**无损；可它是靠「恰好没配过字段」才无损的，而不是靠代码。
 * 哪天字段配上了、而这个弹窗因为权限或网络读不到定义，同一个按钮就会真的删数据。
 *
 * <h3>🔴 「字段没载入」与「一个字段都没配」两句话都由 {@code ExtFieldSection} 说，不在这里重写</h3>
 * 判据住在它里面（{@code loadError} / {@code hasDefs} / {@code loadedOnce}），
 * 这里再抄一份就是第二份会漂的副本。所以本组件只负责两件事：
 * 读资料、锁保存按钮。「去字段管理」那句话走 {@code #empty} 插槽传进去 ——
 * 它是本弹窗特有的指向，不该由通用区块写死。
 *
 * <h3>为什么用 {@code destroy-on-close}</h3>
 * {@code el-dialog} 默认不销毁内容，于是 {@code ExtFieldSection} 只在**第一次**打开时
 * 拉一次字段定义。机构管理员刚配完字段再来开这个弹窗，看到的还是旧的那一份 ——
 * 与本仓 {@code Dialog} 组件的既有行为对齐，顺带也保证每次打开都重读资料当前值
 * （否则两个人同时改同一份资料时，后保存的那个会拿着一份早就过期的 {@code ext} 覆盖上去）。
 */
defineOptions({ name: 'QlzgMaterialExtDialog' })

const props = defineProps<{
  modelValue: boolean
  /** 要编辑的资料行编号；为空时什么都不做 */
  materialId?: number | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', visible: boolean): void
  /** 保存成功 —— 父组件据此刷新列表 */
  (e: 'saved'): void
}>()

const router = useRouter()
const message = useMessage()

const extRef = ref()
const loading = ref(false)
const submitting = ref(false)
const loadFailed = ref(false)
const fileName = ref('')
const ext = ref<Record<string, any> | null>(null)

/**
 * 🔴 两个条件缺一不可，理由见类注释。
 *
 * ⚠️ {@code extRef.value?.ready} 在区块挂载之前是 {@code undefined}（假），
 *    所以「还没挂载」与「没就绪」在这里是同一个处置 —— 按钮灰着。
 *    这正是想要的：不知道状态的时候不许写。
 */
const canSubmit = computed(() => !loading.value && !loadFailed.value && !!extRef.value?.ready)

const load = async () => {
  if (!props.materialId) {
    return
  }
  loading.value = true
  loadFailed.value = false
  try {
    const data = await QlzgMaterialApi.getMaterial(props.materialId)
    fileName.value = data.fileName ?? `资料 ${data.id}`
    // 🔴 读出来的原值必须先落到 ext 上：ExtFieldSection 是照它建模型的
    ext.value = data.ext ?? null
  } catch {
    loadFailed.value = true
    fileName.value = ''
    ext.value = null
  } finally {
    loading.value = false
  }
}

watch(
  () => props.modelValue,
  (visible) => {
    if (visible) {
      ext.value = null
      fileName.value = ''
      load()
    }
  }
)

const submit = async () => {
  // 🔴 再判一次，不靠按钮的 disabled：按钮是渲染出来的，
  //    而 disabled 与「此刻真的能写」之间隔着一个异步（区块可能刚变成未就绪）
  if (!props.materialId || !canSubmit.value) {
    return
  }
  if (!(await extRef.value?.validate())) {
    return
  }
  submitting.value = true
  try {
    await QlzgMaterialApi.updateExt({ id: props.materialId, ext: ext.value ?? {} })
    message.success('已保存')
    emit('update:modelValue', false)
    emit('saved')
  } finally {
    submitting.value = false
  }
}

const gotoFieldDef = () => {
  emit('update:modelValue', false)
  router.push('/qlzg/field-def')
}
</script>
