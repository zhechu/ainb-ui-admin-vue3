<template>
  <!-- 下拉形态 -->
  <el-select
    v-if="mode === 'select'"
    v-model="innerValue"
    :placeholder="placeholder"
    :multiple="multiple"
    :disabled="disabled"
    clearable
    filterable
    :loading="loading"
    class="w-1/1"
    @change="onChange"
  >
    <el-option v-for="opt in options" :key="opt.value" :label="opt.label" :value="opt.value" />
  </el-select>

  <!-- 搜索输入形态（自动完成）：适合选项很多、不宜一次拉全的场景 -->
  <el-select
    v-else-if="mode === 'search'"
    v-model="innerValue"
    :placeholder="placeholder"
    :multiple="multiple"
    :disabled="disabled"
    clearable
    filterable
    remote
    :remote-method="onRemoteSearch"
    :loading="loading"
    class="w-1/1"
    @change="onChange"
  >
    <el-option v-for="opt in options" :key="opt.value" :label="opt.label" :value="opt.value" />
  </el-select>

  <!-- 弹窗表格形态：字段多的远程数据用下拉看不清，要能看到多列 -->
  <div v-else class="popup-picker">
    <el-input
      :model-value="displayText"
      :placeholder="placeholder"
      :disabled="disabled"
      readonly
      class="w-1/1"
      @click="openPopup"
    >
      <template #suffix>
        <Icon v-if="!displayText" icon="ep:search" class="cursor-pointer" />
        <Icon v-else icon="ep:circle-close" class="cursor-pointer" @click.stop="clearValue" />
      </template>
    </el-input>

    <el-dialog v-model="popupVisible" :title="popupTitle" width="800px" append-to-body>
      <el-input
        v-model="keyword"
        placeholder="输入关键字搜索"
        clearable
        class="mb-10px"
        @input="onPopupSearch"
      />
      <el-table
        :data="options"
        v-loading="loading"
        height="360"
        highlight-current-row
        @current-change="onRowSelect"
      >
        <el-table-column
          v-for="col in popupColumns"
          :key="col.field"
          :prop="col.field"
          :label="col.label"
          show-overflow-tooltip
        />
        <el-table-column v-if="popupColumns.length === 0" prop="label" label="名称" />
      </el-table>
      <template #footer>
        <el-button @click="popupVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmPopup">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script lang="ts" setup>
import { getDictOptions } from '@/utils/dict'
import { fetchOptions } from '@/api/infra/dataInterface'
import { unwrapRows } from '@/components/FormCreate/src/utils/dataInterfaceSource'

defineOptions({ name: 'RemotePicker' })

/**
 * 远程选择器
 *
 * 三种展示形态（下拉 / 搜索输入 / 弹窗表格）共用一套数据源配置与值契约 ——
 * 用户改形态不用重配数据源。对标实现是三到四个独立控件、各自一套配置，
 * 从下拉换成弹窗表格意味着删掉重配。
 *
 * 它替代了 ApiSelect：下拉形态 + 数据接口数据源，就是 ApiSelect 的等价物。
 */
const props = withDefaults(
  defineProps<{
    modelValue?: any
    /** 展示形态 */
    mode?: 'select' | 'search' | 'popup'
    /** 数据源类型 */
    sourceType?: 'interface' | 'dict' | 'static'
    /**
     * 数据接口编码
     *
     * 用 code 而不是 id：取选项走的是 fetchOptions 接口，它只要登录态、
     * 不要求数据接口的管理权限 —— 填单人不可能有那个权限。该接口按 code 寻址
     */
    interfaceCode?: string
    /** 字典类型 */
    dictType?: string
    /** 静态选项 */
    staticOptions?: Array<{ label: string; value: any }>
    /** 取值字段名 */
    valueField?: string
    /** 显示字段名 */
    labelField?: string
    multiple?: boolean
    disabled?: boolean
    placeholder?: string
    popupTitle?: string
    /** 弹窗表格的列 */
    popupColumns?: Array<{ field: string; label: string }>
    /**
     * 依赖字段的值
     *
     * 由运行时注入。变化时重新拉取并清空当前值 —— 上级变了，下级的旧值
     * 很可能已经不在新的可选范围里，留着比清掉更糟
     */
    dependentValues?: Record<string, any>
  }>(),
  {
    mode: 'select',
    sourceType: 'interface',
    valueField: 'id',
    labelField: 'name',
    placeholder: '请选择',
    popupTitle: '选择数据',
    popupColumns: () => []
  }
)

const emit = defineEmits<{
  'update:modelValue': [value: any]
  change: [value: any]
}>()

const innerValue = ref<any>(props.modelValue)
const options = ref<Array<Record<string, any>>>([])
const loading = ref(false)
const popupVisible = ref(false)
const keyword = ref('')
const pendingRow = ref<Record<string, any> | null>(null)

watch(
  () => props.modelValue,
  (v) => (innerValue.value = v)
)

/** 弹窗形态下输入框里显示的文本 */
const displayText = computed(() => {
  if (innerValue.value === null || innerValue.value === undefined || innerValue.value === '') {
    return ''
  }
  const hit = options.value.find((o) => o[props.valueField] === innerValue.value)
  // 找不到对应选项时退化成显示原始值，而不是显示空白 ——
  // 空白会让用户以为没选，其实值是在的
  return hit ? String(hit[props.labelField] ?? hit.label ?? innerValue.value) : String(innerValue.value)
})

/** 把原始行归一成 { label, value } 形态，同时保留原字段供弹窗表格显示多列 */
const normalize = (rows: any[]): Array<Record<string, any>> =>
  (rows ?? []).map((row) => ({
    ...row,
    label: row[props.labelField] ?? row.label ?? '',
    value: row[props.valueField] ?? row.value
  }))

/**
 * 拉取选项
 *
 * @param search 关键字，仅搜索形态与弹窗形态用
 */
const loadOptions = async (search?: string) => {
  loading.value = true
  try {
    if (props.sourceType === 'static') {
      options.value = normalize(props.staticOptions ?? [])
      return
    }
    if (props.sourceType === 'dict') {
      // 字典在前端有全量缓存，同步就能取到
      options.value = normalize(
        getDictOptions(props.dictType ?? '').map((d) => ({
          [props.labelField]: d.label,
          [props.valueField]: d.value
        }))
      )
      return
    }
    if (!props.interfaceCode) {
      options.value = []
      return
    }
    // 依赖字段的值作为接口参数传下去
    const params: Record<string, any> = { ...(props.dependentValues ?? {}) }
    if (search) params.keyword = search
    // ⚠️ 必须走 unwrapRows：SQL / 静态 JSON 类型的接口，服务端会先把结果包一层
    // {code,msg,data}（DataInterfaceServiceImpl.wrapStandardResponse），Controller 的
    // success() 再包一层，axios 拦截器只剥得掉外面那层 —— 拿到手的是个对象而不是数组。
    // 这里原先只判了 `Array.isArray(rows) ? rows : rows?.list`，于是永远落到空列表：
    // 接口取数成功、下拉却一个选项都没有，控制台也没有任何报错。
    // 剥壳逻辑与「选项来源＝数据接口」那条路共用同一个函数，两条路不会再各自漂移
    const rows = unwrapRows(await fetchOptions(props.interfaceCode, params))
    options.value = normalize(rows)
  } catch (e) {
    // 拉取失败给空列表，不抛出去 —— 一个数据源配错的控件不该让整张表单打不开。
    // 下拉点开是空的，用户能直接看出问题所在
    console.error('[RemotePicker] 拉取选项失败', e)
    options.value = []
  } finally {
    loading.value = false
  }
}

const onRemoteSearch = (search: string) => loadOptions(search)
const onPopupSearch = () => loadOptions(keyword.value)

const onChange = (value: any) => {
  emit('update:modelValue', value)
  emit('change', value)
}

const openPopup = () => {
  if (props.disabled) return
  popupVisible.value = true
  keyword.value = ''
  loadOptions()
}

const onRowSelect = (row: Record<string, any> | null) => {
  pendingRow.value = row
}

const confirmPopup = () => {
  if (pendingRow.value) {
    innerValue.value = pendingRow.value[props.valueField]
    onChange(innerValue.value)
  }
  popupVisible.value = false
}

const clearValue = () => {
  innerValue.value = props.multiple ? [] : undefined
  onChange(innerValue.value)
}

/**
 * 依赖字段变化时重新拉取并清空当前值
 *
 * 清空是必要的：上级变了（比如省份改了），下级（城市）的旧值很可能已经不在
 * 新的可选范围里。留着会形成一条看起来正常、实际非法的数据
 */
watch(
  () => props.dependentValues,
  () => {
    if (innerValue.value !== undefined && innerValue.value !== null && innerValue.value !== '') {
      clearValue()
    }
    if (props.mode !== 'search') loadOptions()
  },
  { deep: true }
)

onMounted(() => {
  // 搜索形态不预加载：它的存在意义就是「选项太多不宜一次拉全」
  if (props.mode !== 'search') loadOptions()
})
</script>

<style lang="scss" scoped>
.popup-picker :deep(.el-input__inner) {
  cursor: pointer;
}
</style>
