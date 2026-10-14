<template>
  <div class="relation-form">
    <!-- 下拉选择：远程搜索，适合目标表单数据量不大或用户知道要找什么 -->
    <el-select
      v-if="mode !== 'popup'"
      v-model="selectedPk"
      class="w-1/1"
      clearable
      :disabled="disabled"
      filterable
      :loading="loading"
      :placeholder="placeholder || '请选择'"
      remote
      :remote-method="handleSearch"
      reserve-keyword
      @change="handleChange"
      @visible-change="handleVisibleChange"
    >
      <el-option v-for="item in options" :key="item.pk" :label="item.label" :value="item.pk" />
    </el-select>

    <!-- 弹窗表格：能显示多列，适合「光看一个名称选不出来」的场景 -->
    <div v-else class="relation-popup-trigger">
      <el-input
        :model-value="selectedLabel"
        :disabled="disabled"
        :placeholder="placeholder || '请选择'"
        readonly
        @click="openPicker"
      >
        <template #suffix>
          <Icon
            v-if="selectedPk && !disabled"
            class="relation-clear"
            icon="ep:circle-close"
            @click.stop="handleChange(undefined)"
          />
          <Icon v-else icon="ep:search" />
        </template>
      </el-input>
    </div>

    <!-- 配置不完整时直说。不说的话界面上是一个点了没反应的空下拉 -->
    <div v-if="!targetFormCode" class="relation-tip">
      这个关联控件还没有配置「关联表单」，请到设计器的属性面板里补上。
    </div>
    <div v-else-if="loadError" class="relation-tip relation-tip--error">{{ loadError }}</div>

    <!-- 选择弹窗 -->
    <Dialog v-model="pickerVisible" append-to-body title="选择数据" width="760px">
      <el-input
        v-model="keyword"
        class="mb-10px"
        clearable
        placeholder="输入关键字搜索"
        @clear="reloadPicker"
        @keyup.enter="reloadPicker"
      >
        <template #append>
          <el-button @click="reloadPicker">
            <Icon icon="ep:search" />
          </el-button>
        </template>
      </el-input>
      <el-table
        v-loading="loading"
        border
        :data="pickerRows"
        height="360"
        highlight-current-row
        @current-change="handlePickRow"
      >
        <el-table-column
          v-for="col in pickerColumns"
          :key="col.field"
          :label="col.title"
          :prop="col.field"
          min-width="140"
          show-overflow-tooltip
        />
      </el-table>
      <Pagination
        v-model:limit="pickerQuery.pageSize"
        v-model:page="pickerQuery.pageNo"
        :total="pickerTotal"
        @pagination="loadPickerRows"
      />
      <template #footer>
        <el-button @click="pickerVisible = false">取 消</el-button>
      </template>
    </Dialog>
  </div>
</template>

<script lang="ts" setup>
/**
 * 关联表单控件（运行时）
 *
 * ## 它为什么是新增的
 *
 * 设计器一直有「关联表单」这个控件（`useRelationFormRule` + `RelationConfigField`），
 * 后端也一直在提交时按它的配置重读被关联记录并覆盖带出字段
 * （`RelationFormResolver` / `RelationFormFiller`）—— **唯独运行时没有渲染组件**。
 *
 * form-create 解析到 `type: 'RelationForm'` 时在自己的组件表与 Vue 全局组件表里
 * 都找不到它，于是产出一个 `<relationform>` 未知元素：页面上是一片空白，
 * 控制台只有一条 `Failed to resolve component` 的 warning。
 * 表现就是「跨表取数示例里关联客户字段不可用，点新增录不了数据」——
 * 而那个字段是必填的，于是整张表单提交不了。
 *
 * ## 值是被关联记录的主键
 *
 * 与设计器的配置、后端的 `RelationFormResolver` 对齐：落库的是目标表单的主键，
 * 显示的是它的 `displayField`。主键按**字符串**回传 —— 目标表单的主键多半是
 * 雪花 ID，JS 的 number 装不下 19 位，转一手就会差几位且不报错。
 *
 * ## 带出字段为什么在前端也写一遍
 *
 * 服务端提交时会重读被关联记录并覆盖，那是权威的一份。前端这一份是为了
 * **让用户当场看到带出了什么** —— 不写的话，选完客户之后下面四个只读框
 * 一直是空的，直到保存成功再打开才有值，看起来像是没生效。
 */
import * as RuntimeApi from '@/api/infra/formDesign/runtime'
import { decodeFieldsAsync } from '@/utils/formCreate'
import { parseFormFields } from '@/components/FormCreate/src/utils'

defineOptions({ name: 'RelationForm' })

interface FieldMapping {
  sourceField: string
  targetField: string
  /** ALWAYS-每次覆盖；ONCE / MANUAL-目标字段为空时才写 */
  updateMode?: string
}

const props = withDefaults(
  defineProps<{
    /** 值：被关联记录的主键 */
    modelValue?: string | number
    /** 目标表单编码 */
    targetFormCode?: string
    /** 选中后输入框展示目标表单的哪个字段 */
    displayField?: string
    /** 展示形态：下拉选择 / 弹窗表格 */
    mode?: string
    /** 带出字段映射 */
    fieldMappings?: FieldMapping[]
    /**
     * 本控件长在哪张表单上。由渲染页的 applyRelationSource 注入
     *
     * 取候选数据要用它 —— REFERENCE 接口的入参是「源表单 + 控件字段」，
     * 目标表单与可见字段由服务端从已发布配置里读，前端传不了
     */
    sourceFormCode?: string
    /** 本控件的字段名，同样由 applyRelationSource 注入 */
    sourceField?: string
    placeholder?: string
    disabled?: boolean
    /** form-create 注入，用来给带出字段赋值 */
    formCreateInject?: any
  }>(),
  { mode: 'select', fieldMappings: () => [] }
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string | undefined): void
}>()

/** 一次拉多少条候选。够覆盖绝大多数下拉场景，再多就该用弹窗表格了 */
const OPTION_PAGE_SIZE = 50

const loading = ref(false)
const loadError = ref('')

/** 目标表单的主键字段名。不同表单可能不叫 id */
const targetPkField = ref('id')
/** 目标表单的主表字段，弹窗表格的列取自它 */
const targetFields = ref<Array<{ field: string; title: string }>>([])

interface OptionItem {
  pk: string
  label: string
  row: Record<string, any>
}

const options = ref<OptionItem[]>([])
const selectedPk = ref<string | undefined>(undefined)
const selectedLabel = ref('')

/**
 * 主键一律按字符串处理
 *
 * 目标表单的主键多半是雪花 ID（19 位）。JS 的 number 只能精确表示到 2^53，
 * 转一手会把末几位改掉 —— 而且不报错，表现是「选了 A 客户，存进去是 B 客户」。
 */
const toPk = (value: any): string | undefined =>
  value === undefined || value === null || value === '' ? undefined : String(value)

/** 某一行的显示文案。没配显示字段时退回主键，至少能看出选了一条 */
const labelOf = (row: Record<string, any>): string => {
  const field = props.displayField
  const raw = field ? row?.[field] : undefined
  if (raw === undefined || raw === null || raw === '') {
    return String(row?.[targetPkField.value] ?? '')
  }
  return String(raw)
}

// ==================== 目标表单的元信息 ====================

/**
 * 拉目标表单的主键字段与字段清单
 *
 * 只要主表字段：关联查询落在目标表单的主表上，明细字段在那条 SQL 里不存在。
 * 拉不到就留一条错误提示，不抛出去打断整张表单的渲染 ——
 * 一个关联控件配错了，不该让别的字段也录不了。
 */
const loadTargetMeta = async () => {
  if (!props.targetFormCode) return
  try {
    const config = await RuntimeApi.getRenderConfig(props.targetFormCode)
    targetPkField.value = config?.pkField || 'id'
    const rules = await decodeFieldsAsync(config?.formFields ?? [])
    const collected: Array<Record<string, any>> = []
    for (const rule of rules) parseFormFields(rule as any, collected)
    targetFields.value = collected
      .filter((f) => f.field && !f.subTableField)
      .map((f) => ({ field: f.field as string, title: (f.title as string) || (f.field as string) }))
    loadError.value = ''
  } catch (e: any) {
    console.error('[RelationForm] 拉取目标表单配置失败', e)
    loadError.value = `关联表单「${props.targetFormCode}」读不到，可能尚未发布或没有查看权限`
  }
}

// ==================== 候选数据 ====================

/** 按关键字查目标表单的数据。关键字为空时取第一页 */
const queryRows = async (keywordText: string, pageNo = 1, pageSize = OPTION_PAGE_SIZE) => {
  if (!props.targetFormCode) return { list: [], total: 0 }

  // 下拉选择走 REFERENCE 弱查询：它只要目标表单的 reference 权限，
  // 而不是完整的 query。这正是「能填订单但不该浏览客户列表」那类用户
  // 能选到客户的原因。
  //
  // ⚠️ 只在「有源表单上下文 + 第一页」时走它。REFERENCE 按设计不支持翻页
  // （支持了就等于 query），所以弹窗表格那条路径仍然走分页接口 ——
  // 那条路径本来就是在浏览列表，要 query 权限是合理的
  if (props.sourceFormCode && props.sourceField && pageNo === 1) {
    const rows = await RuntimeApi.getReferenceOptions(
      props.sourceFormCode,
      props.sourceField,
      keywordText || undefined,
      pageSize
    )
    const list = (rows ?? []) as Record<string, any>[]
    // REFERENCE 不返回总数 —— 它不分页，也就没有「共几条」可言。
    // 这里拿条数充数只是为了让调用方的解构不报错
    return { list, total: list.length }
  }

  // 关键字打在显示字段上。没配显示字段就不加条件 —— 打在主键上搜不出东西
  const conditions =
    keywordText && props.displayField
      ? [{ field: props.displayField, operator: 'LIKE', value: keywordText }]
      : []
  const data = await RuntimeApi.getDataPage(props.targetFormCode, {
    pageNo,
    pageSize,
    conditions
  })
  return { list: (data?.list ?? []) as Record<string, any>[], total: data?.total ?? 0 }
}

const loadOptions = async (keywordText = '') => {
  if (!props.targetFormCode) return
  loading.value = true
  try {
    const { list } = await queryRows(keywordText)
    options.value = list
      .map((row) => ({ pk: toPk(row[targetPkField.value]) ?? '', label: labelOf(row), row }))
      .filter((item) => item.pk !== '')
    // 已选中的那条要留在选项里，否则搜索之后下拉框会显示成主键
    ensureSelectedOption()
    loadError.value = ''
  } catch (e: any) {
    console.error('[RelationForm] 拉取关联数据失败', e)
    loadError.value = e?.msg || '关联数据读取失败，请确认对目标表单有查询权限'
  } finally {
    loading.value = false
  }
}

const handleSearch = (keywordText: string) => loadOptions(keywordText)

/** 展开下拉时若还没有候选就拉一次，不必等用户先打字 */
const handleVisibleChange = (visible: boolean) => {
  if (visible && options.value.length === 0) void loadOptions()
}

/** 把当前选中项补进候选，保证下拉框显示的是名称而不是主键 */
const ensureSelectedOption = () => {
  const pk = selectedPk.value
  if (!pk || options.value.some((item) => item.pk === pk)) return
  options.value = [{ pk, label: selectedLabel.value || pk, row: {} }, ...options.value]
}

// ==================== 回显 ====================

/**
 * 按主键把被关联记录读回来
 *
 * 不能只指望候选列表里有它：候选只取第一页 50 条，而被关联的那条记录
 * 完全可能排在第 200 条 —— 表现是「打开一条老单据，关联客户显示成一串数字」。
 */
const restoreSelected = async (pk: string) => {
  if (!props.targetFormCode) return
  try {
    const row = await RuntimeApi.getData(props.targetFormCode, pk)
    selectedLabel.value = row ? labelOf(row) : pk
  } catch (e) {
    // 目标记录可能已被删除。显示主键而不是留空 —— 留空看起来像「没关联」，
    // 而它其实关联着一条查不到的记录，两者的处理方式完全不同
    console.warn('[RelationForm] 关联记录读取失败', pk, e)
    selectedLabel.value = String(pk)
  }
  ensureSelectedOption()
}

// ==================== 选中与带出 ====================

const handleChange = async (pk: string | undefined) => {
  const next = toPk(pk)
  selectedPk.value = next
  emit('update:modelValue', next)

  if (!next) {
    // 清空关联时带出字段一并清空。不清的话会留下
    // 「关联记录已清空、带出的客户名还在」这种自相矛盾的数据
    applyMappings({}, true)
    selectedLabel.value = ''
    return
  }

  const hit = options.value.find((item) => item.pk === next)
  let row: Record<string, any> = hit?.row ?? {}
  // 候选里那条可能是 ensureSelectedOption 补的空壳，得真读一次
  if (Object.keys(row).length === 0) {
    try {
      row = (await RuntimeApi.getData(props.targetFormCode!, next)) ?? {}
    } catch {
      row = {}
    }
  }
  selectedLabel.value = labelOf(row)
  applyMappings(row, false)
}

/**
 * 把被关联记录的字段抄到当前表单
 *
 * ⚠️ 这一份不是权威的：服务端提交时会重读一遍并覆盖（见 RelationFormFiller）。
 * 它存在的意义是让用户**当场看到带出了什么** —— 不写的话，选完客户之后
 * 下面几个只读框一直是空的，直到保存成功再打开才有值，看起来像没生效。
 *
 * @param clearing 清空关联时传 true：此时无条件清掉全部带出字段，
 *                 不看 updateMode —— 「仅首次带出」说的是不覆盖用户改过的值，
 *                 而关联本身都没了，留着那些值只会是一条自相矛盾的记录
 */
const applyMappings = (row: Record<string, any>, clearing: boolean) => {
  const api = props.formCreateInject?.api
  if (!api?.setValue) return
  const payload: Record<string, any> = {}
  for (const mapping of props.fieldMappings ?? []) {
    if (!mapping?.targetField) continue
    if (clearing) {
      payload[mapping.targetField] = undefined
      continue
    }
    const mode = mapping.updateMode || 'ALWAYS'
    if (mode !== 'ALWAYS') {
      // 仅首次带出：目标字段已经有值就不动它
      const current = api.getValue?.(mapping.targetField)
      if (current !== undefined && current !== null && current !== '') continue
    }
    payload[mapping.targetField] = mapping.sourceField ? row?.[mapping.sourceField] : undefined
  }
  if (Object.keys(payload).length > 0) api.setValue(payload)
}

// ==================== 弹窗表格 ====================

const pickerVisible = ref(false)
const keyword = ref('')
const pickerRows = ref<Record<string, any>[]>([])
const pickerTotal = ref(0)
const pickerQuery = reactive({ pageNo: 1, pageSize: 10 })

/** 弹窗表格的列。显示字段排第一列，其余按字段顺序取前几个，避免列多到要横向拖 */
const pickerColumns = computed(() => {
  const fields = targetFields.value
  const first = fields.filter((f) => f.field === props.displayField)
  const rest = fields.filter((f) => f.field !== props.displayField).slice(0, 4)
  return [...first, ...rest]
})

const openPicker = () => {
  if (props.disabled || !props.targetFormCode) return
  keyword.value = ''
  pickerQuery.pageNo = 1
  pickerVisible.value = true
  void loadPickerRows()
}

const reloadPicker = () => {
  pickerQuery.pageNo = 1
  void loadPickerRows()
}

const loadPickerRows = async () => {
  loading.value = true
  try {
    const { list, total } = await queryRows(keyword.value, pickerQuery.pageNo, pickerQuery.pageSize)
    pickerRows.value = list
    pickerTotal.value = total
  } catch (e: any) {
    console.error('[RelationForm] 拉取关联数据失败', e)
    loadError.value = e?.msg || '关联数据读取失败，请确认对目标表单有查询权限'
  } finally {
    loading.value = false
  }
}

const handlePickRow = async (row: Record<string, any> | null) => {
  if (!row) return
  const pk = toPk(row[targetPkField.value])
  if (!pk) return
  // 行数据已经在手上，直接进候选，省掉 handleChange 里的那次回查
  options.value = [
    { pk, label: labelOf(row), row },
    ...options.value.filter((item) => item.pk !== pk)
  ]
  await handleChange(pk)
  pickerVisible.value = false
}

// ==================== 生命周期 ====================

watch(
  () => props.modelValue,
  (value) => {
    const pk = toPk(value)
    if (pk === selectedPk.value) return
    selectedPk.value = pk
    if (pk) {
      void restoreSelected(pk)
    } else {
      selectedLabel.value = ''
    }
  },
  { immediate: true }
)

// 换了目标表单（设计器里改配置时会发生）要把元信息与候选全部作废
watch(
  () => props.targetFormCode,
  async () => {
    options.value = []
    await loadTargetMeta()
    if (selectedPk.value) await restoreSelected(selectedPk.value)
  }
)

onMounted(async () => {
  await loadTargetMeta()
  // 回显要在元信息之后 —— labelOf 依赖 targetPkField
  if (selectedPk.value) await restoreSelected(selectedPk.value)
})
</script>

<style lang="scss" scoped>
.relation-form {
  width: 100%;
}

.relation-popup-trigger :deep(.el-input__inner) {
  cursor: pointer;
}

.relation-clear {
  cursor: pointer;

  &:hover {
    color: var(--el-color-primary);
  }
}

.relation-tip {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--el-text-color-secondary);

  &--error {
    color: var(--el-color-danger);
  }
}
</style>
