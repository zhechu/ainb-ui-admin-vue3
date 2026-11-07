<template>
  <Dialog v-model="dialogVisible" :title="dialogTitle" width="760">
    <el-alert
      v-if="isPlatform"
      type="info"
      :closable="false"
      show-icon
      class="mb-12px"
      title="这是平台预置字段，整行只读"
      description="所有机构共用同一份定义，才谈得上口径一致。机构可以另建自己的字段，但不能改动平台的那一份。"
    />

    <el-form
      ref="formRef"
      v-loading="formLoading"
      :model="formData"
      :rules="formRules"
      label-width="132px"
      :disabled="isPlatform"
    >
      <el-form-item label="所属业务对象" prop="entityType">
        <!-- 🔴 编辑时灰掉而不是隐藏：隐藏会被理解成「这功能坏了」（§11.20.5 的 UI 纪律） -->
        <el-select
          v-model="formData.entityType"
          :disabled="isUpdate"
          placeholder="请选择"
          class="w-full"
        >
          <el-option
            v-for="item in ENTITY_TYPE_OPTIONS"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
        <FieldHint v-if="isUpdate" text="创建后不可修改：值存在各宿主表自己的 ext_json 列里，换了宿主等于把已填的值留在旧表里" />
      </el-form-item>

      <el-form-item label="字段标识" prop="fieldKey">
        <el-input
          v-model="formData.fieldKey"
          :disabled="isUpdate"
          placeholder="小写字母开头，只能含小写字母、数字与下划线，如 risk_level"
        />
        <FieldHint
          v-if="isUpdate"
          text="创建后不可修改：改了等于让历史数据里的这个标识变成孤儿，而 30 年档案里的报告可能引用了它"
        />
        <FieldHint
          v-else
          text="这是 ext_json 里的键名，用户在界面上看到的是「显示名称」。报错文案一律用显示名称，不用这个标识"
        />
      </el-form-item>

      <el-form-item label="显示名称" prop="fieldLabel">
        <el-input v-model="formData.fieldLabel" placeholder="用户在界面上看到的名字，如「内部风险等级」" />
      </el-form-item>

      <el-form-item label="控件类型" prop="widgetType">
        <el-select v-model="formData.widgetType" placeholder="请选择" class="w-full">
          <el-option
            v-for="item in widgetOptions"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
        <FieldHint
          v-if="isUpdate"
          text="只能换成同一族的控件（值类型与落库形态都相同），否则已存的值会对不上新控件"
        />
        <el-popover placement="bottom-start" :width="420" trigger="click">
          <template #reference>
            <el-link type="info" :underline="false" class="text-12px mt-4px">
              为什么没有「子表」「字典选择」「文件上传」这些控件？
            </el-link>
          </template>
          <div class="text-12px leading-20px">
            <div v-for="(reason, type) in EXT_FIELD_WIDGET_WITHHELD" :key="type" class="mb-6px">
              <b>{{ widgetLabelOf(String(type)) }}</b>：{{ reason }}
            </div>
          </div>
        </el-popover>
      </el-form-item>

      <!-- 控件配置：只有白名单里的 props 才出现在这里 -->
      <el-form-item v-for="prop in editableProps" :key="prop.name" :label="prop.label">
        <el-select
          v-if="prop.choices"
          v-model="formData.props[prop.name]"
          placeholder="请选择"
          clearable
          class="w-full"
        >
          <el-option v-for="item in prop.choices" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
        <el-switch v-else-if="prop.type === 'boolean'" v-model="formData.props[prop.name]" />
        <el-input-number v-else v-model="formData.props[prop.name]" :min="prop.min" class="!w-200px" />
        <FieldHint :text="prop.desc" />
      </el-form-item>

      <!-- 选项编辑：只有选项类控件才有 -->
      <el-form-item v-if="isOptionEditorVisible" label="可选项">
        <div class="w-full">
          <div v-for="(item, index) in formData.options" :key="index" class="option-row">
            <el-input v-model="item.label" placeholder="显示文字" class="!w-180px" />
            <el-input v-model="item.value" placeholder="存进库里的值" class="!w-180px" />
            <el-button link type="danger" @click="removeOption(index)">删除</el-button>
            <!-- 🔴 层级控件（级联 / 树形选择）才给第二层，判据取自契约而不是控件名 -->
            <template v-if="supportsChildren">
              <div class="w-full">
                <div v-for="(child, ci) in item.children" :key="ci" class="option-child-row">
                  <el-input v-model="child.label" placeholder="二级显示文字" class="!w-180px" />
                  <el-input v-model="child.value" placeholder="二级值" class="!w-180px" />
                  <el-button link type="danger" @click="item.children?.splice(ci, 1)">删除</el-button>
                </div>
                <el-button link type="primary" @click="addChild(item)">
                  <Icon icon="ep:plus" class="mr-2px" /> 添加二级
                </el-button>
              </div>
            </template>
          </div>
          <el-button link type="primary" @click="addOption">
            <Icon icon="ep:plus" class="mr-2px" /> 添加选项
          </el-button>
          <FieldHint
            :text="
              supportsChildren
                ? '只能编两层。存进库里的值必须是文字，不能是数字以外的东西 —— 值一旦存下就再也改不动了（改了历史报告里的那些值就解释不了）'
                : '「存进库里的值」是写进 ext_json 与导出到 Excel 的那一份，改「显示文字」不影响历史数据，改「值」会让已存的值对不上'
            "
          />
        </div>
      </el-form-item>

      <el-form-item label="必填" prop="required">
        <el-switch v-model="formData.required" />
        <FieldHint text="权威校验在服务端：一个 curl 也绕不过去。这里勾上只是让界面上出现红星与提示" />
      </el-form-item>

      <el-form-item label="出现位置" prop="scene">
        <el-radio-group v-model="formData.scene">
          <el-radio v-for="item in EXT_FIELD_SCENES" :key="item.value" :value="item.value">
            {{ item.label }}
          </el-radio>
        </el-radio-group>
        <FieldHint text="绝大多数扩展字段两边都要。选「详情」的字段不会出现在录入表单里，也就永远不会被填上值" />
      </el-form-item>

      <el-form-item label="排序" prop="sort">
        <el-input-number v-model="formData.sort" :min="0" class="!w-200px" />
        <FieldHint text="表单与导出 Excel 的列顺序都是它。导出的列头顺序就是这里，不是创建时间" />
      </el-form-item>

      <el-form-item label="进 Excel 导出" prop="exportable">
        <el-switch v-model="formData.exportable" />
        <FieldHint text="ext_json 不能建索引，列表页不能按它筛选或排序 —— 导出是这个字段唯一的批量出口" />
      </el-form-item>

      <el-form-item v-if="isUpdate" label="启用" prop="enabled">
        <el-switch v-model="formData.enabled" />
        <FieldHint
          text="停用不等于删除：表单里不再出现，但详情页仍显示历史值并标注「（已停用字段）」，导出也仍带这一列"
        />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button :disabled="formLoading || isPlatform" type="primary" @click="submitForm">
        确 定
      </el-button>
      <el-button @click="dialogVisible = false">取 消</el-button>
    </template>
  </Dialog>
</template>

<script lang="ts" setup>
import {
  QlzgFieldDefApi,
  type QlzgEntityType,
  type QlzgFieldDefSaveVO,
  type QlzgFieldOption,
  type QlzgFieldValidateRule
} from '@/api/qlzg/fieldDef'
import { getWidgetContract, listWidgetProps } from '@/components/FormWidgets/contracts'
import {
  DATE_PICKER_VALUE_FORMATS,
  DATE_RANGE_TYPES,
  EXT_FIELD_SCENES,
  EXT_FIELD_WIDGET_WITHHELD,
  editablePropsOf,
  isOptionWidget,
  listExtFieldWidgetOptions,
  listSameFamilyWidgetOptions,
  optionTargetOf
} from '@/views/qlzg/components/extFieldRule'
import { ENTITY_TYPE_OPTIONS } from '@/views/qlzg/constants'
import FieldHint from '@/views/qlzg/components/FieldHint.vue'

/**
 * 字段定义的编辑弹窗
 *
 * <h3>🔴 这一页有三样东西【刻意没有】，都不是漏做</h3>
 * <ol>
 * <li><b>删除按钮。</b>后端 {@code DELETE /qlzg/field-def/delete} 一律抛
 *     {@code FIELD_DEF_DELETE_FORBIDDEN}。API 层连函数都没建
 *     （见 {@code api/qlzg/fieldDef/index.ts} 的类注释）：包一个「按下去必定失败」的按钮出来，
 *     下一个人会以为「删除是支持的，只是这里没接」。</li>
 * <li><b>跨字段校验规则（{@code validate_json}）的编辑器。</b>它的形状是后端
 *     {@code CrossFieldRule} 的条件组，做编辑器等于把低代码表单设计器再实现一遍。
 *     🔴 但**必须原样回传**：编辑一个已经有规则的字段时，把它读出来、不改、再发回去。
 *     丢了它的表现是「保存成功、规则没了」，而后端对 {@code validateRule == null}
 *     的处置正是**清空**（{@code toJsonOrNull}）。所以这个字段在 {@link #formData} 里
 *     单独存一份，界面上一个字都不渲染。</li>
 * <li><b>平台预置行的任何可编辑项。</b>{@code platform === true} 时整个 {@code el-form} 带
 *     {@code disabled}。理由写在 {@code QlzgFieldDefDO} 的类注释里：
 *     所有机构共用同一份定义，才谈得上口径一致。</li>
 * </ol>
 *
 * <h3>🔴 控件配置的每一个 prop 都来自 {@code extFieldRule.ts} 的 {@code EDITABLE_PROPS} 白名单</h3>
 * 界面上**不出现**「把这个控件的所有 props 都摊开来配」这种东西。
 * 那会把 {@code maskRule}（掩码值回填会覆盖库里的真值）、{@code activeValue}
 * （配成 1/0 之后每次保存都报 {@code EXT_FIELD_VALUE_INVALID}）、
 * {@code multiple} / {@code showCheckbox}（值从标量变成数组，与契约对不上）
 * 一并交到管理员手里，而每一项的后果都是静默的数据损坏。
 * 造规则那一份白名单在 {@code extFieldRule.ts}，这一页读的是**同一个常量** ——
 * 两处各写一份的话，界面上能配的东西与最终生效的东西就会分叉。
 */
defineOptions({ name: 'QlzgFieldDefForm' })

const message = useMessage()
const { t } = useI18n()

const dialogVisible = ref(false)
const dialogTitle = ref('')
const formLoading = ref(false)
const formType = ref('')
const formRef = ref()

const isUpdate = computed(() => formType.value === 'update')

interface PropEditor {
  name: string
  label: string
  type: string
  desc: string
  min?: number
  choices?: Array<{ value: string; label: string }>
}

const formData = ref({
  id: undefined as number | undefined,
  entityType: 'QLZG_PROJECT' as QlzgEntityType,
  fieldKey: '',
  fieldLabel: '',
  widgetType: '',
  required: false,
  /** 控件 props，只有 EDITABLE_PROPS 白名单里的键会进来 */
  props: {} as Record<string, any>,
  /** 选项。层级控件多一层 {@code children} */
  options: [] as QlzgFieldOption[],
  sort: 0,
  scene: 'BOTH' as QlzgFieldDefSaveVO['scene'],
  exportable: true,
  enabled: true
})

/**
 * 🔴 单独存的跨字段校验规则：界面上不渲染，提交时原样回传。见类注释第 2 条
 */
let carriedValidateRule: QlzgFieldValidateRule | null = null
/** 平台预置行 */
const isPlatform = ref(false)

/**
 * {@code fieldKey} 的形状，与后端 {@code QlzgFieldDefDO.FIELD_KEY_PATTERN} 逐字一致
 *
 * 🔴 上限 62 而不是 63：{@code ^[a-z]} 已经吃掉一个字符，列宽是 {@code varchar(64)}。
 * 写成 {@code {1,63}} 的话最长能凑出 64 字符，正好卡在列宽上 —— 不报错，
 * 但再想加一个字就截断了，而截断后的标识与历史数据里的对不上。
 *
 * <p>⚠️ {@code constructor} / {@code toString} / {@code valueOf} / {@code hasOwnProperty}
 * 都**匹配**这个正则，因此都是合法的字段标识。这不是缺陷：后端与前端读写
 * {@code ext_json} 时用的都是 {@code hasOwnProperty} / {@code Object.keys}，
 * 不走原型链。所以这里**不要**顺手加一条「不许用 JS 保留名」的黑名单 ——
 * 那会拦住一批本来能正常工作的字段，而它防的那个问题已经在两处代码里被解决了。
 */
const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{1,62}$/

const formRules = reactive({
  entityType: [{ required: true, message: '所属业务对象不能为空', trigger: 'change' }],
  fieldKey: [
    { required: true, message: '字段标识不能为空', trigger: 'blur' },
    {
      validator: (_rule: any, value: string, callback: (error?: Error) => void) => {
        if (value && !FIELD_KEY_PATTERN.test(value)) {
          callback(
            new Error('小写字母开头，只能含小写字母、数字与下划线，长度 2–63；不支持中文与连字符')
          )
          return
        }
        callback()
      },
      trigger: 'blur'
    }
  ],
  fieldLabel: [{ required: true, message: '显示名称不能为空', trigger: 'blur' }],
  widgetType: [{ required: true, message: '控件类型不能为空', trigger: 'change' }],
  scene: [{ required: true, message: '出现位置不能为空', trigger: 'change' }]
})

/**
 * 打开时的控件类型。同族过滤要以它为基准，而不是以当前选中的那个
 *
 * ⚠️ 必须声明在 {@link widgetOptions} **之前**：那个 computed 是惰性的，
 * 所以写在后面也能跑（求值时已经初始化了），但那是靠求值时机而不是靠代码 ——
 * 哪天有人在 setup 里同步读一次 {@code widgetOptions.value}，就是 TDZ 报错。
 */
const originalWidgetType = ref('')

/**
 * 控件下拉：新增时是全部 16 项，编辑时只有同族的那些
 *
 * 🔴 同族判据与后端 {@code validateWidgetFamily} 一致（契约的 {@code valueType} + {@code storage}），
 * 所以「界面上能选的一定能存下」，不会让用户选完之后撞一句
 * {@code FIELD_DEF_WIDGET_INCOMPATIBLE}。
 */
const widgetOptions = computed(() =>
  isUpdate.value
    ? listSameFamilyWidgetOptions(originalWidgetType.value)
    : listExtFieldWidgetOptions()
)

const widgetLabelOf = (type: string): string => getWidgetContract(type)?.label ?? type

/** 这个控件是不是层级型的（级联 / 树形选择），判据取自 {@code OPTION_SOURCE_TARGETS.tree} */
const supportsChildren = computed(() => !!optionTargetOf(formData.value.widgetType)?.tree)

const isOptionEditorVisible = computed(() => isOptionWidget(formData.value.widgetType))

/** prop 的中文标签。契约里只有 desc 没有 label，而 desc 是一整句话，当标签太长 */
const PROP_LABELS: Record<string, string> = {
  rows: '显示行数',
  precision: '小数位数',
  min: '最小值',
  max: '最大值',
  thousands: '千分位'
}

/**
 * 该渲染哪几个 prop 编辑框
 *
 * 🔴 类型与说明取自控件契约的 {@code props[]}（那一份是「配错了会静默失效」的清单），
 * 而**放开了哪几个**取自 {@code extFieldRule.ts} 的 {@code EDITABLE_PROPS}。
 * 两者的交集才是这里渲染的东西 —— 只读契约会把 {@code maskRule} 这类危险项摊出来，
 * 只读白名单则拿不到类型与说明。
 *
 * <p>⚠️ {@code datePicker.type} 与 {@code dateRange.type} 契约里没有声明
 * （契约只收「配错了会静默失效」的那些，而这两个面板类型是**必须**配的），
 * 所以它们的类型与选项在这里补齐，且选项是**封闭**的两三个值，不给自由文本 ——
 * {@code datePicker} 的面板本来有九种，其中三种交出数组，与契约的 {@code date/scalar} 对不上。
 */
const editableProps = computed<PropEditor[]>(() => {
  const type = formData.value.widgetType
  const declared = listWidgetProps(type)
  const result: PropEditor[] = []
  for (const name of editablePropsOf(type)) {
    if (name === 'type' && type === 'datePicker') {
      result.push({
        name,
        label: '日期精度',
        type: 'string',
        desc: '决定存进库里的格式：按天是 YYYY-MM-DD，到秒是 YYYY-MM-DD HH:mm:ss',
        choices: Object.keys(DATE_PICKER_VALUE_FORMATS).map((value) => ({
          value,
          label: value === 'date' ? '到日（2026-10-31）' : '到秒（2026-10-31 09:30:00）'
        }))
      })
      continue
    }
    if (name === 'type' && type === 'dateRange') {
      result.push({
        name,
        label: '区间精度',
        type: 'string',
        desc: '决定存进库里那两头的格式',
        choices: DATE_RANGE_TYPES.map((value) => ({
          value,
          label: value === 'daterange' ? '按天' : value === 'datetimerange' ? '到秒' : '按月'
        }))
      })
      continue
    }
    const spec = declared.find((item) => item.name === name)
    result.push({
      name,
      label: PROP_LABELS[name] ?? name,
      type: spec?.type ?? 'number',
      desc: spec?.desc ?? '',
      // 🔴 rate / slider / inputNumber 的 max 不给下界（0 星没有意义但也不该由这里拦），
      //    rows / precision 给 0；负数一律不给，因为契约里这几个 prop 的语义都是「个数 / 位数」
      min: name === 'rows' || name === 'precision' ? 0 : undefined,
      choices: spec?.allowedValues?.length
        ? spec.allowedValues.map((value) => ({ value, label: value }))
        : undefined
    })
  }
  return result
})

/** 打开弹窗 */
const open = async (type: string, id?: number) => {
  dialogVisible.value = true
  dialogTitle.value = t('action.' + type)
  formType.value = type
  resetForm()
  if (!id) {
    return
  }
  formLoading.value = true
  try {
    const data = await QlzgFieldDefApi.get(id)
    isPlatform.value = !!data.platform
    originalWidgetType.value = data.widgetType
    carriedValidateRule = data.validateRule ?? null
    formData.value = {
      id: data.id,
      entityType: data.entityType,
      fieldKey: data.fieldKey,
      fieldLabel: data.fieldLabel,
      widgetType: data.widgetType,
      required: !!data.required,
      // 🔴 只抄白名单里的那几个键。库里可能存着别的东西（历史数据 / 直接改库），
      //    抄进 formData 再发回去，就等于绕过了白名单
      props: pickEditableProps(data.widgetType, data.options?.props),
      options: (data.options?.options ?? []).map(cloneOption),
      sort: data.sort ?? 0,
      scene: data.scene ?? 'BOTH',
      exportable: data.exportable !== false,
      enabled: data.enabled !== false
    }
  } finally {
    formLoading.value = false
  }
}
defineExpose({ open })

/** 只留白名单里的 props 键 */
const pickEditableProps = (widgetType: string, source?: Record<string, any> | null) => {
  const result: Record<string, any> = {}
  if (!source) {
    return result
  }
  for (const name of editablePropsOf(widgetType)) {
    // 🔴 hasOwnProperty 而不是 `in`：constructor / toString / valueOf / hasOwnProperty
    //    全都匹配 FIELD_KEY_PATTERN，因此都是合法的 prop 名，用 `in` 会从原型链上读到函数
    if (!Object.prototype.hasOwnProperty.call(source, name)) {
      continue
    }
    const value = source[name]
    if (value !== undefined && value !== null && value !== '') {
      result[name] = value
    }
  }
  return result
}

/** 选项只认 label / value / children 三个键，其余一律丢掉 */
const cloneOption = (item: QlzgFieldOption): QlzgFieldOption => {
  const next: QlzgFieldOption = { label: item.label ?? '', value: item.value ?? '' }
  if (item.children?.length) {
    next.children = item.children.map(cloneOption)
  }
  return next
}

const addOption = () => {
  formData.value.options.push({ label: '', value: '' })
}
const removeOption = (index: number) => {
  formData.value.options.splice(index, 1)
}
const addChild = (item: QlzgFieldOption) => {
  if (!item.children) {
    item.children = []
  }
  item.children.push({ label: '', value: '' })
}

/** 换控件时，白名单变了，已经填的 props 要跟着清掉 */
watch(
  () => formData.value.widgetType,
  (type) => {
    formData.value.props = pickEditableProps(type, formData.value.props)
    if (!isOptionWidget(type)) {
      formData.value.options = []
    }
    // 🔴 从层级控件换到扁平控件时把 children 摘掉：留在库里就是一段没人读的数据，
    //    而导出与详情页都会把它当普通值渲染出来
    if (!optionTargetOf(type)?.tree) {
      formData.value.options = formData.value.options.map((item) => ({
        label: item.label,
        value: item.value
      }))
    }
  }
)

/** 提交表单 */
const emit = defineEmits(['success'])
const submitForm = async () => {
  if (!formRef.value) {
    return
  }
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) {
    return
  }
  const optionError = validateOptions()
  if (optionError) {
    message.error(optionError)
    return
  }
  formLoading.value = true
  try {
    const data: QlzgFieldDefSaveVO = {
      id: formData.value.id,
      entityType: formData.value.entityType,
      fieldKey: formData.value.fieldKey,
      fieldLabel: formData.value.fieldLabel,
      widgetType: formData.value.widgetType,
      required: formData.value.required,
      options: buildOptions(),
      // 🔴 原样回传，见类注释第 2 条
      validateRule: carriedValidateRule,
      sort: formData.value.sort,
      scene: formData.value.scene,
      exportable: formData.value.exportable,
      enabled: formData.value.enabled
    }
    if (formType.value === 'create') {
      await QlzgFieldDefApi.create(data)
      message.success(t('common.createSuccess'))
    } else {
      await QlzgFieldDefApi.update(data)
      message.success(t('common.updateSuccess'))
    }
    dialogVisible.value = false
    emit('success')
  } finally {
    formLoading.value = false
  }
}

/**
 * 🔴 没有选项、也没有 props 时发 {@code null}，不发 {@code {}}
 *
 * 后端 {@code toJsonOrNull} 把两者一律写成 SQL NULL，语义上等价，
 * 但界面上「这个字段配过东西吗」会变得含糊 —— 而字段管理页正是靠这一点
 * 判断要不要显示「已配置 N 个选项」。
 */
const buildOptions = () => {
  const options = formData.value.options.filter((item) => item.label || item.value)
  const props = Object.keys(formData.value.props).length ? formData.value.props : undefined
  if (!options.length && !props) {
    return null
  }
  return { options: options.length ? options : undefined, props }
}

/**
 * 选项的本地校验
 *
 * 🔴 这里只拦**必然错**的那些（重名、空值、有显示文字却没有值）。
 * 服务端 {@code QlzgFieldOptions#tableOf} 还会再查一遍，两侧不重复：
 * 本地拦是为了给一句「第 3 行的值与第 1 行重复」这样指得清位置的话，
 * 而服务端那句话只能说「选项值重复」。
 *
 * <p>⚠️ 「值重复」是必须拦的：两个选项同值的话，选中任一个存进去的都是同一个值，
 * 而详情页按值反查显示文字时会命中**第一个** —— 用户选的是「乙」，
 * 存下来再打开显示的是「甲」，全程不报错。
 */
const validateOptions = (): string | undefined => {
  if (!isOptionEditorVisible.value) {
    return undefined
  }
  const flat: QlzgFieldOption[] = []
  formData.value.options.forEach((item) => {
    flat.push(item)
    ;(item.children ?? []).forEach((child) => flat.push(child))
  })
  const seen = new Map<string, number>()
  for (let i = 0; i < flat.length; i++) {
    const item = flat[i]
    if (!item.label && !item.value) {
      continue
    }
    if (!item.label.trim()) {
      return `第 ${i + 1} 个选项没有填显示文字`
    }
    if (!String(item.value).trim()) {
      return `选项「${item.label}」没有填「存进库里的值」。留着空值的话，选中它存进 ext_json 的就是一个空串，与「没选」分不开`
    }
    const key = String(item.value).trim()
    if (seen.has(key)) {
      return `选项值「${key}」重复了（第 ${seen.get(key)! + 1} 个与第 ${i + 1} 个）：两个选项同值时，存下来再打开显示的是排在前面的那一个`
    }
    seen.set(key, i)
  }
  return undefined
}

/** 重置表单 */
const resetForm = () => {
  formData.value = {
    id: undefined,
    entityType: 'QLZG_PROJECT',
    fieldKey: '',
    fieldLabel: '',
    widgetType: '',
    required: false,
    props: {},
    options: [],
    sort: 0,
    scene: 'BOTH',
    exportable: true,
    enabled: true
  }
  carriedValidateRule = null
  isPlatform.value = false
  originalWidgetType.value = ''
  formRef.value?.resetFields()
}
</script>

<style lang="scss" scoped>
.option-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  width: 100%;
  margin-bottom: 8px;
}

.option-child-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin: 4px 0 4px 24px;
}
</style>
