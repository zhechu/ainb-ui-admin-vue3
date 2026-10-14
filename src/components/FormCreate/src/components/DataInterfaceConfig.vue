<!--
  「选项来源 → 数据接口」的配置面板

  产出的是一份「选项从哪个接口来、参数怎么传」的声明（写到 rule.props.dataSource），
  运行时由 optionSource 解析成实际请求。表单 JSON 里不出现地址，也不出现代码。

  取值/显示字段的候选是实采的：选定接口后调一次预览拿真实返回的首行，用它的键集合做
  候选并展示样例值。比让用户在接口配置里另外维护一份字段清单可靠 —— 那份清单和实际
  返回很容易脱节。
-->
<template>
  <div class="data-interface-config">
    <div class="di-item">
      <el-select
        v-model="source.interfaceCode"
        class="w-1/1"
        clearable
        filterable
        placeholder="选择数据接口"
        @change="handleInterfaceChange"
      >
        <el-option
          v-for="item in interfaces"
          :key="item.code"
          :label="item.name"
          :value="item.code"
        >
          <span>{{ item.name }}</span>
          <span class="ml-8px text-12px op-60">{{ item.code }}</span>
        </el-option>
      </el-select>
      <div v-if="missingInterface" class="di-tip di-tip--warn">
        原先配置的接口「{{
          source.interfaceName || source.interfaceCode
        }}」已停用或被删除，请重新选择
      </div>
      <div v-else-if="loaded && !interfaces.length" class="di-tip">
        暂无可用接口。请先在「基础设施 - 数据管理 - 接口管理」里创建查询型接口并启用
      </div>
    </div>

    <template v-if="source.interfaceCode">
      <div class="di-item">
        <span class="di-label">取值字段</span>
        <el-select
          v-model="source.valueField"
          allow-create
          class="w-1/1"
          clearable
          default-first-option
          filterable
          :loading="sampling"
          placeholder="选项提交给后端的值"
          @change="emitChange"
        >
          <el-option v-for="f in fieldOptions" :key="f.name" :label="f.name" :value="f.name">
            <span>{{ f.name }}</span>
            <span class="ml-8px text-12px op-60">{{ f.sample }}</span>
          </el-option>
        </el-select>
      </div>

      <div class="di-item">
        <span class="di-label">显示字段</span>
        <el-select
          v-model="source.labelField"
          allow-create
          class="w-1/1"
          clearable
          default-first-option
          filterable
          :loading="sampling"
          placeholder="选项展示给用户的文本"
          @change="emitChange"
        >
          <el-option v-for="f in fieldOptions" :key="f.name" :label="f.name" :value="f.name">
            <span>{{ f.name }}</span>
            <span class="ml-8px text-12px op-60">{{ f.sample }}</span>
          </el-option>
        </el-select>
        <div class="di-tip">支持组合，如 ${name}-${code}</div>
      </div>

      <div v-if="treeMode" class="di-item">
        <span class="di-label">子级字段</span>
        <el-input
          v-model="source.childrenField"
          class="w-1/1"
          placeholder="children"
          @change="emitChange"
        />
      </div>

      <div v-if="source.params?.length" class="di-item">
        <span class="di-label">参数设置</span>
        <div v-for="param in source.params" :key="param.name" class="di-param">
          <div class="di-param-head">
            <span class="di-param-name">
              {{ param.label || param.name }}
              <span v-if="param.required" class="di-required">*</span>
            </span>
            <span class="di-param-key">{{ param.name }}</span>
          </div>
          <el-select
            v-model="param.sourceType"
            class="w-1/1"
            @change="handleParamSourceChange(param)"
          >
            <el-option
              v-for="opt in PARAM_SOURCE_OPTIONS"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
          <el-input
            v-if="param.sourceType === 'fixed'"
            v-model="param.value"
            class="mt-4px w-1/1"
            placeholder="填写固定值"
            @change="emitChange"
          />
          <el-select
            v-else-if="param.sourceType === 'formField'"
            v-model="param.field"
            class="mt-4px w-1/1"
            clearable
            filterable
            placeholder="选择本表单的字段"
            @change="emitChange"
          >
            <el-option v-for="f in formFields" :key="f.value" :label="f.label" :value="f.value" />
          </el-select>
          <el-select
            v-else-if="param.sourceType === 'currentUser'"
            v-model="param.userProp"
            class="mt-4px w-1/1"
            @change="emitChange"
          >
            <el-option
              v-for="opt in USER_PROP_OPTIONS"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
          <el-select
            v-else-if="param.sourceType === 'system'"
            v-model="param.systemVar"
            class="mt-4px w-1/1"
            @change="emitChange"
          >
            <el-option
              v-for="opt in SYSTEM_VAR_OPTIONS"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
          <div v-if="paramError(param)" class="di-tip di-tip--warn">{{ paramError(param) }}</div>
        </div>
        <div class="di-tip">绑定表单字段后，该字段变化会自动重新取数，可用来做控件联动</div>
      </div>

      <div class="di-item di-inline">
        <span class="di-label di-label--inline">结果缓存</span>
        <el-switch v-model="source.cache" @change="emitChange" />
      </div>
      <div class="di-tip">开启后同一组参数只请求一次；接口改版时缓存自动失效</div>

      <div class="di-item">
        <el-button :loading="sampling" size="small" @click="sampleFields">
          重新探测返回字段
        </el-button>
        <div v-if="sampleError" class="di-tip di-tip--warn">{{ sampleError }}</div>
        <div v-else-if="sampledEmpty" class="di-tip">
          接口返回为空，字段候选无法探测，可直接手工填写字段名
        </div>
      </div>
    </template>
  </div>
</template>

<script lang="ts" setup>
import {
  getReadOnlySimpleList,
  preview,
  type DataInterfaceSimpleVO
} from '@/api/infra/dataInterface'
import {
  PARAM_SOURCE_OPTIONS,
  SYSTEM_VAR_OPTIONS,
  USER_PROP_OPTIONS,
  resolveParams,
  unwrapRows,
  type ParamBinding,
  type RemoteDataSource
} from '@/components/FormCreate/src/utils/dataInterfaceSource'

defineOptions({ name: 'DataInterfaceConfig' })

const props = defineProps<{
  modelValue?: RemoteDataSource
  /** 当前控件是否支持层级（级联、树选择、树控件） */
  treeMode?: boolean
  /** 本表单的其它字段，供参数绑定选择 */
  formFields?: { label: string; value: string }[]
}>()

const emit = defineEmits<{ (e: 'update:modelValue', value: any): void }>()

const interfaces = ref<DataInterfaceSimpleVO[]>([])
const loaded = ref(false)
const sampling = ref(false)
const sampleError = ref('')
const sampledEmpty = ref(false)
const fieldOptions = ref<{ name: string; sample: string }[]>([])

const source = reactive<RemoteDataSource>({
  interfaceCode: '',
  interfaceId: undefined,
  interfaceName: '',
  interfaceVersion: undefined,
  labelField: '',
  valueField: '',
  childrenField: 'children',
  params: [],
  cache: false
})

const formFields = computed(() => props.formFields ?? [])

const selected = computed(() => interfaces.value.find((item) => item.code === source.interfaceCode))

/**
 * 原先配的接口已经不在可用列表里
 *
 * 停用、删除、或被改成写操作接口都会走到这里。必须显式提示 ——
 * 否则用户看到的只是个空下拉框，不知道是配错了还是接口挂了。
 */
const missingInterface = computed(() => loaded.value && !!source.interfaceCode && !selected.value)

const paramError = (param: ParamBinding) => {
  if (!param.required) {
    return ''
  }
  if (param.sourceType === 'fixed' && (param.value === undefined || param.value === '')) {
    return '该参数必填，请填写固定值'
  }
  if (param.sourceType === 'formField' && !param.field) {
    return '该参数必填，请选择绑定字段'
  }
  return ''
}

const emitChange = () => {
  // 没选接口就回传 undefined，别在表单 JSON 里留一个空壳对象
  emit('update:modelValue', source.interfaceCode ? { ...toRaw(source) } : undefined)
}

/** 接口的入参定义变了，重建绑定行；同名参数保留原有绑定，避免换接口时白配一遍 */
const rebuildParams = (definition?: DataInterfaceSimpleVO) => {
  const previous = new Map((source.params ?? []).map((item) => [item.name, item]))
  source.params = (definition?.params ?? []).map((def) => {
    const old = previous.get(def.name)
    if (old) {
      return { ...old, label: def.label, type: def.type, required: def.required }
    }
    return {
      name: def.name,
      label: def.label,
      type: def.type,
      required: def.required,
      sourceType: 'fixed',
      value: def.defaultValue ?? ''
    } as ParamBinding
  })
}

const handleParamSourceChange = (param: ParamBinding) => {
  // 换了来源，旧来源的取值要清掉，否则 JSON 里会留下互相矛盾的残留
  param.value = undefined
  param.field = undefined
  param.userProp = param.sourceType === 'currentUser' ? 'userId' : undefined
  param.systemVar = param.sourceType === 'system' ? 'today' : undefined
  emitChange()
}

/** 实采返回字段：调一次预览，用真实返回的首行做候选 */
const sampleFields = async () => {
  fieldOptions.value = []
  sampleError.value = ''
  sampledEmpty.value = false
  const definition = selected.value
  if (!definition) {
    return
  }
  sampling.value = true
  try {
    // 预览按当前已配的参数传，目的是看返回结构
    const result: any = await preview(definition.id, resolveParams(source.params))
    const rows = unwrapRows(result?.data ?? result)
    const first = rows[0]
    if (!first || typeof first !== 'object') {
      sampledEmpty.value = true
      return
    }
    fieldOptions.value = Object.keys(first).map((name) => {
      const value = first[name]
      const sample = value === null || value === undefined ? '' : String(value)
      return { name, sample: sample.length > 20 ? `${sample.slice(0, 20)}…` : sample }
    })
  } catch (error: any) {
    // 探测失败不阻断配置，把原因显示出来让用户自己判断，字段名仍可手填
    sampleError.value = error?.msg || error?.message || '返回字段探测失败，可手工填写字段名'
  } finally {
    sampling.value = false
  }
}

const handleInterfaceChange = async (code: string) => {
  const definition = interfaces.value.find((item) => item.code === code)
  source.interfaceId = definition?.id
  source.interfaceName = definition?.name ?? ''
  source.interfaceVersion = definition?.version
  source.labelField = ''
  source.valueField = ''
  fieldOptions.value = []
  sampleError.value = ''
  sampledEmpty.value = false
  rebuildParams(definition)
  emitChange()
  if (!code) {
    return
  }
  await sampleFields()
  // 常见字段名给个默认，省掉大部分场景下的两次点击
  const names = fieldOptions.value.map((item) => item.name)
  source.valueField = names.find((n) => ['id', 'value', 'code'].includes(n)) ?? names[0] ?? ''
  source.labelField =
    names.find((n) => ['name', 'label', 'title', 'nickname'].includes(n)) ?? names[1] ?? ''
  emitChange()
}

watch(
  () => props.modelValue,
  (value) => {
    source.interfaceCode = value?.interfaceCode ?? ''
    source.interfaceId = value?.interfaceId
    source.interfaceName = value?.interfaceName ?? ''
    source.interfaceVersion = value?.interfaceVersion
    source.labelField = value?.labelField ?? ''
    source.valueField = value?.valueField ?? ''
    source.childrenField = value?.childrenField ?? 'children'
    source.params = value?.params ? value.params.map((item) => ({ ...item })) : []
    source.cache = value?.cache ?? false
  },
  { immediate: true, deep: true }
)

onMounted(async () => {
  try {
    interfaces.value = await getReadOnlySimpleList()
  } finally {
    loaded.value = true
  }
  // 回填已有配置时刷新字段候选，让用户能看到当前接口到底返回了什么
  if (source.interfaceCode && selected.value) {
    // 接口可能已改版，顺带把版本号更新到最新
    source.interfaceVersion = selected.value.version
    await sampleFields()
  }
})
</script>

<style lang="scss" scoped>
.di-item {
  margin-top: 8px;
}

.di-inline {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.di-label {
  display: block;
  margin-bottom: 4px;
  font-size: 12px;
  color: var(--el-text-color-regular);

  &--inline {
    margin-bottom: 0;
  }
}

.di-tip {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--el-text-color-secondary);

  &--warn {
    color: var(--el-color-warning);
  }
}

.di-param {
  padding: 8px;
  margin-top: 6px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
}

.di-param-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}

.di-param-name {
  font-size: 12px;
  color: var(--el-text-color-primary);
}

.di-param-key {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}

.di-required {
  color: var(--el-color-danger);
}
</style>
