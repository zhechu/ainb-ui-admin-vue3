<template>
  <el-form-item label="数据来源">
    <el-radio-group
      :model-value="modelValue.dataMode || 'static'"
      size="small"
      @change="handleModeChange"
    >
      <el-radio-button label="static">静态数据</el-radio-button>
      <el-radio-button label="dynamic">动态接口</el-radio-button>
    </el-radio-group>
  </el-form-item>

  <template v-if="modelValue.dataMode === 'dynamic'">
    <el-form-item label="数据接口">
      <el-select
        :model-value="modelValue.interfaceCode"
        class="w-full"
        filterable
        clearable
        :loading="loading"
        placeholder="选择已启用的只读接口"
        @change="handleInterfaceChange"
      >
        <el-option
          v-for="item in interfaceOptions"
          :key="item.code"
          :label="`${item.name} (${item.code})`"
          :value="item.code"
        />
      </el-select>
    </el-form-item>

    <div v-if="interfaceParams.length" class="portal-data-source__params">
      <div class="portal-data-source__section-title">参数设置</div>
      <div v-for="param in interfaceParams" :key="param.name" class="portal-data-source__param">
        <span class="portal-data-source__param-label">
          {{ param.label || param.name }}{{ param.required ? ' *' : '' }}
        </span>
        <el-switch
          v-if="param.type?.toUpperCase() === 'BOOLEAN'"
          :model-value="Boolean(requestParams[param.name])"
          @change="updateRequestParam(param.name, $event)"
        />
        <el-input-number
          v-else-if="isNumberType(param.type)"
          :model-value="toNumberOrUndefined(requestParams[param.name])"
          class="w-full"
          controls-position="right"
          @update:model-value="updateRequestParam(param.name, $event)"
        />
        <el-input
          v-else
          :model-value="requestParams[param.name] ?? ''"
          :placeholder="param.remark || `请输入${param.label || param.name}`"
          @update:model-value="updateRequestParam(param.name, $event)"
        />
      </div>
    </div>

    <el-form-item label="高级参数 JSON">
      <el-input
        :model-value="modelValue.requestParams || '{}'"
        type="textarea"
        :rows="3"
        placeholder="请输入 JSON 参数"
        @update:model-value="update('requestParams', $event)"
      />
    </el-form-item>
  </template>

  <div
    v-if="modelValue.dataMode === 'dynamic' && mappingFields.length"
    class="portal-data-source__mapping"
  >
    <div class="portal-data-source__section-title">字段映射</div>
    <div v-for="field in mappingFields" :key="field.key" class="portal-data-source__mapping-row">
      <span>{{ field.label }}</span>
      <el-input
        :model-value="mappingValue(field.key)"
        :placeholder="`默认：${field.fallback}`"
        clearable
        @update:model-value="updateMapping(field.key, $event)"
      />
    </div>
  </div>

  <div v-if="modelValue.dataMode === 'dynamic' && metricFields" class="portal-data-source__mapping">
    <div class="portal-data-source__section-title">指标字段映射</div>
    <div
      v-for="(item, index) in modelValue.items || []"
      :key="item.id || index"
      class="portal-data-source__mapping-row"
    >
      <span>{{ item.label || `指标${Number(index) + 1}` }}</span>
      <el-input
        :model-value="item.dataField || item.id || ''"
        placeholder="对象字段名"
        clearable
        @update:model-value="updateMetricField(index, $event)"
      />
    </div>
  </div>

  <div
    v-if="modelValue.dataMode === 'dynamic' && modelValue.interfaceCode"
    class="portal-data-source__refresh"
  >
    <el-form-item label="自动刷新">
      <el-switch
        :model-value="modelValue.refreshEnabled === true"
        @change="update('refreshEnabled', $event)"
      />
    </el-form-item>
    <el-form-item v-if="modelValue.refreshEnabled" label="刷新间隔">
      <el-input-number
        :model-value="modelValue.refreshInterval || 300"
        :min="10"
        :max="86400"
        controls-position="right"
        class="w-full"
        @update:model-value="update('refreshInterval', $event)"
      >
        <template #suffix>秒</template>
      </el-input-number>
    </el-form-item>
  </div>
</template>

<script lang="ts" setup>
import { computed, onMounted, ref, watch } from 'vue'
import * as DataInterfaceApi from '@/api/infra/dataInterface'

defineOptions({ name: 'PortalDataSourceFields' })

const props = withDefaults(
  defineProps<{
    modelValue: Record<string, any>
    type?: string
  }>(),
  { type: '' }
)
const emit = defineEmits<{ 'update:modelValue': [value: Record<string, any>] }>()

const loading = ref(false)
const interfaceOptions = ref<DataInterfaceApi.DataInterfaceVO[]>([])
const interfaceParams = ref<DataInterfaceApi.ParamDefinitionVO[]>([])

const mappingDefinitions: Record<
  string,
  Array<{ key: string; label: string; fallback: string }>
> = {
  'chart.bar': [
    { key: 'series', label: '系列字段', fallback: 'type' },
    { key: 'dimension', label: '维度字段', fallback: 'name' },
    { key: 'value', label: '数值字段', fallback: 'value' }
  ],
  'chart.line': [
    { key: 'series', label: '系列字段', fallback: 'type' },
    { key: 'dimension', label: '维度字段', fallback: 'name' },
    { key: 'value', label: '数值字段', fallback: 'value' }
  ],
  'chart.pie': [
    { key: 'dimension', label: '分类字段', fallback: 'name' },
    { key: 'value', label: '数值字段', fallback: 'value' }
  ],
  'chart.radar': [
    { key: 'series', label: '系列字段', fallback: 'type' },
    { key: 'dimension', label: '维度字段', fallback: 'name' },
    { key: 'value', label: '数值字段', fallback: 'value' },
    { key: 'max', label: '最大值字段', fallback: 'max' }
  ],
  timeAxis: [
    { key: 'content', label: '内容字段', fallback: 'content' },
    { key: 'timestamp', label: '时间字段', fallback: 'timestamp' }
  ],
  mapChart: [
    { key: 'name', label: '地区字段', fallback: 'name' },
    { key: 'value', label: '数值字段', fallback: 'value' },
    { key: 'longitude', label: '经度字段', fallback: 'longitude' },
    { key: 'latitude', label: '纬度字段', fallback: 'latitude' }
  ],
  text: [
    { key: 'content', label: '文本字段', fallback: 'content' },
    { key: 'link', label: '链接字段', fallback: 'link' }
  ],
  image: [
    { key: 'src', label: '图片字段', fallback: 'src' },
    { key: 'alt', label: '替代文本字段', fallback: 'alt' },
    { key: 'caption', label: '说明字段', fallback: 'caption' },
    { key: 'link', label: '链接字段', fallback: 'link' }
  ],
  carousel: [
    { key: 'src', label: '图片字段', fallback: 'src' },
    { key: 'title', label: '标题字段', fallback: 'title' },
    { key: 'link', label: '链接字段', fallback: 'link' }
  ],
  video: [
    { key: 'src', label: '视频字段', fallback: 'src' },
    { key: 'poster', label: '封面字段', fallback: 'poster' }
  ],
  iframe: [{ key: 'url', label: '网页地址字段', fallback: 'url' }],
  commonFunc: [
    { key: 'label', label: '名称字段', fallback: 'label' },
    { key: 'icon', label: '图标字段', fallback: 'icon' },
    { key: 'color', label: '颜色字段', fallback: 'color' },
    { key: 'url', label: '链接字段', fallback: 'url' }
  ],
  myTodo: [
    { key: 'label', label: '名称字段', fallback: 'label' },
    { key: 'value', label: '数量字段', fallback: 'value' },
    { key: 'url', label: '链接字段', fallback: 'url' }
  ],
  todoList: [
    { key: 'name', label: '任务名称字段', fallback: 'name' },
    { key: 'processName', label: '流程名称字段', fallback: 'processName' },
    { key: 'createTime', label: '创建时间字段', fallback: 'createTime' },
    { key: 'url', label: '链接字段', fallback: 'url' }
  ],
  doingList: [
    { key: 'name', label: '任务名称字段', fallback: 'name' },
    { key: 'processName', label: '流程名称字段', fallback: 'processName' },
    { key: 'createTime', label: '创建时间字段', fallback: 'createTime' },
    { key: 'url', label: '链接字段', fallback: 'url' }
  ],
  notice: [
    { key: 'title', label: '标题字段', fallback: 'title' },
    { key: 'category', label: '分类字段', fallback: 'category' },
    { key: 'content', label: '摘要字段', fallback: 'content' },
    { key: 'time', label: '时间字段', fallback: 'time' },
    { key: 'url', label: '链接字段', fallback: 'url' }
  ],
  email: [
    { key: 'subject', label: '主题字段', fallback: 'subject' },
    { key: 'sender', label: '发件人字段', fallback: 'sender' },
    { key: 'date', label: '时间字段', fallback: 'date' },
    { key: 'unread', label: '未读字段', fallback: 'unread' }
  ],
  rankList: [
    { key: 'label', label: '名称字段', fallback: 'label' },
    { key: 'value', label: '数值字段', fallback: 'value' },
    { key: 'url', label: '链接字段', fallback: 'url' }
  ]
}

const mappingFields = computed(() => mappingDefinitions[props.type] || [])
const metricFields = computed(() => props.type === 'dataBoard')

const requestParams = computed<Record<string, any>>(() => {
  try {
    const value = JSON.parse(props.modelValue.requestParams || '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch {
    return {}
  }
})

const update = (field: string, value: any) => {
  emit('update:modelValue', { ...props.modelValue, [field]: value })
}

const handleModeChange = (value: string) => {
  if (value === 'static') {
    emit('update:modelValue', {
      ...props.modelValue,
      dataMode: value,
      interfaceCode: '',
      interfaceName: '',
      requestParams: '{}'
    })
    interfaceParams.value = []
    return
  }
  update('dataMode', value)
  loadInterfaces()
}

const parseParams = (
  raw?: string | DataInterfaceApi.ParamDefinitionVO[]
): DataInterfaceApi.ParamDefinitionVO[] => {
  if (!raw) return []
  if (Array.isArray(raw)) return raw.filter((item) => item && typeof item.name === 'string')
  try {
    const value = JSON.parse(raw)
    return Array.isArray(value) ? value.filter((item) => item && typeof item.name === 'string') : []
  } catch {
    return []
  }
}

const findInterface = async (code: string) => {
  const existing = interfaceOptions.value.find((item) => item.code === code)
  if (existing) return existing
  try {
    const result = await DataInterfaceApi.getDataInterfacePage({ pageNo: 1, pageSize: 1, code })
    return result?.list?.[0]
  } catch {
    return undefined
  }
}

const loadInterfaces = async () => {
  if (loading.value) return
  loading.value = true
  try {
    const result = await DataInterfaceApi.getDataInterfacePage({
      pageNo: 1,
      pageSize: 100,
      status: 0
    })
    interfaceOptions.value = Array.isArray(result?.list)
      ? result.list.filter(
          (item) => item.type !== 1 || item.sqlStatementType?.toUpperCase() === 'SELECT'
        )
      : []
    if (
      props.modelValue.interfaceCode &&
      !interfaceOptions.value.some((item) => item.code === props.modelValue.interfaceCode)
    ) {
      const selected = await findInterface(props.modelValue.interfaceCode)
      if (selected) interfaceOptions.value.unshift(selected)
    }
  } catch {
    interfaceOptions.value = []
  } finally {
    loading.value = false
  }
}

const handleInterfaceChange = async (code: string | undefined) => {
  if (!code) {
    emit('update:modelValue', {
      ...props.modelValue,
      interfaceCode: '',
      interfaceName: '',
      requestParams: '{}'
    })
    interfaceParams.value = []
    return
  }
  const item = await findInterface(code)
  const params = parseParams(item?.params)
  interfaceParams.value = params
  const values = { ...requestParams.value }
  params.forEach((param) => {
    if (values[param.name] === undefined && param.defaultValue !== undefined) {
      values[param.name] = param.defaultValue
    }
  })
  emit('update:modelValue', {
    ...props.modelValue,
    dataMode: 'dynamic',
    interfaceCode: code,
    interfaceName: item?.name || code,
    requestParams: JSON.stringify(values, null, 2)
  })
}

const updateRequestParam = (name: string, value: any) => {
  const values = { ...requestParams.value }
  if (value === undefined || value === null || value === '') delete values[name]
  else values[name] = value
  update('requestParams', JSON.stringify(values, null, 2))
}

const isNumberType = (type?: string) =>
  ['INT', 'LONG', 'DECIMAL', 'NUMBER'].includes(type?.toUpperCase() || '')
const toNumberOrUndefined = (value: any) => {
  if (value === undefined || value === null || value === '') return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

const mappingValue = (key: string) => {
  const current = (props.modelValue.mappingConfig || []).find(
    (item: any) => item.key === key || item.field === key
  )
  return current?.value || ''
}

const updateMapping = (key: string, value: string) => {
  const mappings =
    mappingDefinitions[props.type]?.map((field) => ({
      key: field.key,
      field: field.key,
      value: mappingValue(field.key)
    })) || []
  const target = mappings.find((item) => item.key === key)
  if (target) target.value = value
  update('mappingConfig', mappings)
}

const updateMetricField = (index: string | number, value: string) => {
  const itemIndex = Number(index)
  const items = Array.isArray(props.modelValue.items) ? [...props.modelValue.items] : []
  items[itemIndex] = { ...items[itemIndex], dataField: value }
  update('items', items)
}

const initInterface = async () => {
  if (props.modelValue.dataMode !== 'dynamic') return
  await loadInterfaces()
  if (props.modelValue.interfaceCode) {
    const item = await findInterface(props.modelValue.interfaceCode)
    interfaceParams.value = parseParams(item?.params)
  }
}

watch(
  () => [props.modelValue.dataMode, props.modelValue.interfaceCode],
  () => {
    if (props.modelValue.dataMode === 'dynamic') initInterface()
    else interfaceParams.value = []
  },
  { immediate: true }
)

onMounted(initInterface)
</script>

<style lang="scss" scoped>
.portal-data-source__section-title {
  margin: 4px 0 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--portal-text-secondary);
}

.portal-data-source__params,
.portal-data-source__mapping {
  padding: 8px 10px;
  margin-bottom: 12px;
  background: var(--portal-surface-soft);
  border: 1px solid var(--portal-border);
  border-radius: 6px;
}

.portal-data-source__param,
.portal-data-source__mapping-row {
  display: grid;
  grid-template-columns: 92px minmax(0, 1fr);
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}

.portal-data-source__param:last-child,
.portal-data-source__mapping-row:last-child {
  margin-bottom: 0;
}

.portal-data-source__param-label {
  overflow: hidden;
  color: var(--portal-text-tertiary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.portal-data-source__refresh :deep(.el-form-item) {
  margin-bottom: 12px;
}

.w-full {
  width: 100%;
}
</style>
