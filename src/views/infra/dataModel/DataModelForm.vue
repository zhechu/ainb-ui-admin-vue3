<template>
  <ContentWrap>
    <!-- 顶部操作栏：内容较多，页内展示，操作固定在顶部便于随时保存/返回 -->
    <div class="dm-form-header mb-15px flex items-center justify-between">
      <div class="flex items-center">
        <el-button link @click="handleCancel">
          <Icon icon="ep:arrow-left" class="mr-5px" /> 返回
        </el-button>
        <span class="dm-form-title ml-8px">{{ formTitle }}</span>
      </div>
      <div class="flex items-center">
        <!--
          把「已确认要删哪些字段」一直显示在保存按钮旁边（B4-7）。
          🔴 必须常驻：二次确认弹窗只在那一刻出现，用户点完「确定」就再也看不到自己同意了什么，
             而保存可能是十分钟之后。删列不可回滚，这个状态不该是一次性的
        -->
        <el-tag v-if="formType === 'update' && confirmedDropColumns.length > 0" type="danger" class="mr-15px">
          将删除字段：{{ confirmedDropColumns.join('、') }}
        </el-tag>
        <el-checkbox v-if="formType === 'update'" v-model="formData.riskConfirmed" class="mr-15px">
          我已知晓风险（删除字段等有损操作需勾选）
        </el-checkbox>
        <el-button @click="handlePreviewDdl">
          <Icon icon="ep:view" class="mr-5px" /> 预览 DDL
        </el-button>
        <el-button @click="handleCancel">取 消</el-button>
        <el-button type="primary" :loading="formLoading" @click="submitForm">保 存</el-button>
      </div>
    </div>

    <el-form ref="formRef" :model="formData" :rules="formRules" label-width="90px">
      <el-row :gutter="20">
        <el-col :span="8">
          <el-form-item label="表名" prop="tableName">
            <el-input
              v-model="formData.tableName"
              placeholder="如 biz_order"
              :disabled="formType === 'update'"
            />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="表描述" prop="tableComment">
            <el-input v-model="formData.tableComment" placeholder="如 订单表" />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="模型名称" prop="modelName">
            <el-input v-model="formData.modelName" placeholder="如 订单模型" />
          </el-form-item>
        </el-col>
      </el-row>
      <el-row :gutter="20">
        <el-col :span="8">
          <el-form-item label="备注" prop="remark">
            <el-input v-model="formData.remark" placeholder="选填" />
          </el-form-item>
        </el-col>
        <!-- 系统列策略只在新建时可选：它决定建表那一刻注入哪些系统列，建完就不再有意义 -->
        <el-col v-if="formType === 'create'" :span="8">
          <el-form-item label="系统列策略">
            <el-select
              v-model="formData.systemColumnProfile"
              class="w-full"
              @change="handleProfileChange"
            >
              <el-option
                v-for="item in SYSTEM_COLUMN_PROFILES"
                :key="item.value"
                :label="item.label"
                :value="item.value"
              >
                <span>{{ item.label }}</span>
                <span class="ml-10px text-gray-400 text-12px">{{ item.tip }}</span>
              </el-option>
            </el-select>
          </el-form-item>
        </el-col>
        <el-col v-if="formType === 'create'" :span="8">
          <div class="profile-tip">{{ currentProfileTip }}</div>
        </el-col>
      </el-row>
    </el-form>

    <!-- 选了非默认策略时给出显著提示：丢掉 tenant_id 是有安全含义的，不能悄悄发生 -->
    <el-alert
      v-if="formType === 'create' && formData.systemColumnProfile !== 'TENANT'"
      type="warning"
      show-icon
      :closable="false"
      class="mb-10px"
    >
      <template #title>
        该策略<b>不会注入 tenant_id</b>，这张表的数据将<b>对所有租户可见</b>。
        请确认这正是你要的 —— 业务表一律应当用「多租户表」。
      </template>
    </el-alert>

    <!-- 流程表提示：审批类业务表需要 process_instance_id 与 process_status，可用下方「快速添加」一键补齐 -->
    <el-alert type="warning" show-icon :closable="true" class="mb-10px">
      <template #title>
        若该表用于<b>流程审批</b>，需额外增加 <b>process_instance_id</b>（流程实例编号）与
        <b>process_status</b>（流程状态）两个字段。
        可用下方字段列表的「快速添加」一键补齐流程字段或常用字段。
      </template>
    </el-alert>

    <!-- 🔴 两列已在、但类型/长度不合格：常驻红条，见 flowColumnProblem 的注释 -->
    <el-alert
      v-if="flowColumnProblem"
      type="error"
      show-icon
      :closable="false"
      class="mb-10px"
      :title="flowColumnProblem"
    />

    <!-- 字段编辑区 -->
    <div class="mb-10px flex items-center justify-between">
      <span class="font-bold">字段列表</span>
      <div class="flex items-center">
        <el-dropdown trigger="click" @command="handleQuickAdd">
          <el-button size="small" type="primary" plain class="mr-10px">
            <Icon icon="ep:magic-stick" class="mr-5px" /> 快速添加
            <Icon icon="ep:arrow-down" class="ml-5px" />
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="__process__">
                <Icon icon="ep:share" class="mr-5px" /> 流程字段（process_instance_id + process_status）
              </el-dropdown-item>
              <el-dropdown-item disabled divided>常用字段</el-dropdown-item>
              <el-dropdown-item
                v-for="item in COMMON_FIELD_PRESETS"
                :key="item.command"
                :command="item.command"
              >
                {{ item.label }}
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <el-button size="small" type="primary" plain @click="handleAddColumn">
          <Icon icon="ep:plus" class="mr-5px" /> 添加字段
        </el-button>
      </div>
    </div>
    <el-alert v-if="formType === 'create'" type="info" :closable="false" class="mb-10px">
      <template #title>
        灰色行是<b>系统内置字段</b>（主键
        id、审计字段、租户与逻辑删除），建表时自动补齐，名称与类型<b>只能查看不能修改</b>。
        你只需维护中间的业务字段。主键<b>默认是内置 id</b>，也可在「主键」列改选某个业务字段（此时
        id 自动降级为普通字段）。
      </template>
    </el-alert>
    <el-alert v-else type="info" :closable="false" class="mb-10px">
      <template #title>
        直接改字段名即视为<b>重命名</b>（保留数据）；删除行则会<b>删除该字段及其数据</b>。
        灰色的系统内置字段不可改动。拖动最左侧图标可调整业务字段顺序（仅影响新建）。
      </template>
    </el-alert>

    <div class="column-table">
      <el-table
        :data="displayColumns"
        border
        size="small"
        max-height="460"
        :row-class-name="columnRowClass"
      >
        <el-table-column label="" width="40" align="center">
          <template #default="{ row }">
            <Icon
              v-if="formType === 'create' && !row.readonly"
              icon="ep:rank"
              class="cursor-move drag-handle"
            />
          </template>
        </el-table-column>
        <el-table-column label="字段名" min-width="160">
          <template #default="{ row }">
            <el-input
              v-model="row.columnName"
              size="small"
              placeholder="字段名（字母/数字/下划线）"
              :disabled="row.readonly"
              @input="handleColumnNameInput(row)"
            />
            <div
              v-if="row.columnName && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(row.columnName) && !row.readonly"
              class="text-xs text-red-500 mt-1"
            >
              只允许字母、数字、下划线，且以字母或下划线开头
            </div>
          </template>
        </el-table-column>
        <el-table-column label="描述" min-width="180">
          <template #default="{ row }">
            <el-input
              v-model="row.columnComment"
              size="small"
              placeholder="描述"
              :disabled="row.readonly"
              @input="row.commentTouched = true"
            />
          </template>
        </el-table-column>
        <el-table-column label="类型" min-width="140">
          <template #default="{ row }">
            <el-select
              v-model="row.columnType"
              size="small"
              :disabled="row.readonly"
              @change="handleTypeChange(row)"
            >
              <el-option
                v-for="item in columnTypeList"
                :key="item.type"
                :label="item.type"
                :value="item.type"
              >
                <span>{{ item.type }}</span>
                <span class="ml-10px text-gray-400">{{ item.mysqlType }}</span>
              </el-option>
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="长度" width="90">
          <template #default="{ row }">
            <el-input-number
              v-if="needLength(row.columnType) && !row.readonly"
              v-model="row.length"
              size="small"
              :min="1"
              :max="16383"
              controls-position="right"
              class="!w-80px"
            />
            <span v-else class="text-gray-400">{{ row.length ?? '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="精度" width="80">
          <template #default="{ row }">
            <el-input-number
              v-if="needScale(row.columnType) && !row.readonly"
              v-model="row.scale"
              size="small"
              :min="0"
              :max="row.length != null ? row.length - 1 : 29"
              controls-position="right"
              class="!w-70px"
            />
            <span v-else class="text-gray-400">{{ row.scale ?? '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="可空" width="60" align="center">
          <template #default="{ row }">
            <el-checkbox v-model="row.nullable" :disabled="row.readonly || row.primaryKey" />
          </template>
        </el-table-column>
        <el-table-column label="主键" width="70" align="center">
          <template #default="{ row }">
            <!-- 新建：主键可改选（业务字段或内置 id）；编辑：主键不可变，仅展示 -->
            <el-radio
              v-if="formType === 'create' && canBePrimaryKey(row)"
              :model-value="row.primaryKey"
              :value="true"
              class="pk-radio"
              @change="handlePrimaryKeyChange(row)"
            >
              <span></span>
            </el-radio>
            <template v-else>
              <el-tag v-if="row.primaryKey" type="warning" size="small">主键</el-tag>
              <span v-else class="text-gray-400">-</span>
            </template>
          </template>
        </el-table-column>
        <el-table-column label="自增" width="60" align="center">
          <template #default="{ row }">
            <el-checkbox
              v-model="row.autoIncrement"
              :disabled="(formType === 'update' && row.readonly) || !canAutoIncrement(row)"
            />
          </template>
        </el-table-column>
        <el-table-column label="默认值" min-width="140">
          <template #default="{ row }">
            <el-input
              v-model="row.defaultValue"
              size="small"
              placeholder="无"
              :disabled="row.readonly || row.primaryKey"
            />
          </template>
        </el-table-column>
        <el-table-column label="字典/关联" width="150">
          <template #default="{ row }">
            <!-- 业务语义不落物理表，也不参与结构比对，所以单独一列用弹窗编辑，不挤在主表格里 -->
            <el-button
              v-if="!row.readonly"
              link
              type="primary"
              size="small"
              @click="openMetaDialog(row)"
            >
              <span v-if="metaSummary(row)">{{ metaSummary(row) }}</span>
              <span v-else class="text-gray-400">设置</span>
            </el-button>
            <span v-else class="text-gray-400">-</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="60" align="center" fixed="right">
          <template #default="{ row }">
            <el-button
              v-if="!row.readonly"
              link
              type="danger"
              size="small"
              @click="handleRemoveColumn(row)"
            >
              删除
            </el-button>
            <span v-else class="text-gray-400">-</span>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 索引编辑区 -->
    <div class="mb-10px mt-15px flex items-center justify-between">
      <span class="font-bold">索引列表</span>
      <el-button size="small" type="primary" plain @click="handleAddIndex">
        <Icon icon="ep:plus" class="mr-5px" /> 添加索引
      </el-button>
    </div>
    <el-alert type="info" :closable="false" class="mb-10px">
      <template #title>
        索引能显著加快查询，但会略微拖慢写入并占用空间。<b>唯一索引</b>会强制列值不重复。
        多列索引遵循<b>最左前缀</b>原则，列的顺序很重要。索引名会按所选列自动生成，可手动修改。
      </template>
    </el-alert>
    <el-table :data="formData.indexes" border size="small" max-height="300">
      <el-table-column label="索引名" width="200">
        <template #default="{ row }">
          <el-input
            v-model="row.indexName"
            size="small"
            placeholder="如 idx_name"
            @input="row.nameTouched = true"
          />
        </template>
      </el-table-column>
      <el-table-column label="类型" width="120">
        <template #default="{ row }">
          <el-select v-model="row.indexType" size="small" @change="handleIndexAutoName(row)">
            <el-option label="普通索引" value="NORMAL" />
            <el-option label="唯一索引" value="UNIQUE" />
          </el-select>
        </template>
      </el-table-column>
      <el-table-column label="索引列（按顺序）">
        <template #default="{ row }">
          <el-select
            v-model="row.columnNames"
            size="small"
            multiple
            placeholder="选择一个或多个字段"
            class="w-full"
            @change="handleIndexAutoName(row)"
          >
            <el-option
              v-for="col in indexColumnOptions"
              :key="col.value"
              :label="col.label"
              :value="col.value"
            />
          </el-select>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="60" align="center">
        <template #default="{ row }">
          <el-button link type="danger" size="small" @click="handleRemoveIndex(row)"
            >删除</el-button
          >
        </template>
      </el-table-column>
      <template #empty>
        <span class="text-gray-400">暂无索引，可按需添加</span>
      </template>
    </el-table>
  </ContentWrap>

  <!-- DDL 预览：仍用弹窗，属于临时查看，不占用主视图 -->
  <Dialog title="待执行的 DDL" v-model="ddlVisible" width="800px">
    <el-alert
      v-if="ddlList.length === 0"
      type="success"
      :closable="false"
      title="表结构无变化，无需执行 DDL"
    />
    <template v-else>
      <el-alert type="warning" :closable="false" class="mb-10px">
        <template #title
          >以下语句将<b>按顺序执行</b>。若中途失败，前面已执行的语句<b>不会回滚</b>。</template
        >
      </el-alert>
      <div v-for="(sql, index) in ddlList" :key="index" class="mb-10px">
        <div class="mb-5px ddl-seq">第 {{ index + 1 }} 条</div>
        <pre class="ddl-block">{{ sql }}</pre>
      </div>
    </template>
  </Dialog>

  <!-- 字典/关联：业务语义，不改物理表结构、不建物理外键 -->
  <Dialog :title="`业务语义 - ${metaRow?.columnName ?? ''}`" v-model="metaVisible" width="560px">
    <el-alert type="info" :closable="false" class="mb-15px">
      <template #title>
        这里配的是<b>业务语义</b>，不会改动表结构，也不会建物理外键。
        配好后表单设计等场景可直接读取，不必再填一遍。
      </template>
    </el-alert>
    <el-form label-width="90px">
      <el-form-item label="字典类型">
        <el-input v-model="metaForm.dictType" placeholder="如 order_status，对应字典管理里的类型" />
        <div class="meta-hint">状态、类型这类字段（建议用 TINYINT）配上它</div>
      </el-form-item>
      <el-form-item label="关联表">
        <el-input v-model="metaForm.refTable" placeholder="如 biz_customer" />
      </el-form-item>
      <el-form-item label="关联列">
        <el-input v-model="metaForm.refColumn" placeholder="如 id" />
        <div class="meta-hint">两项要一起填才有意义；留空表示不关联</div>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="clearMeta">清 空</el-button>
      <el-button type="primary" @click="saveMeta">确 定</el-button>
    </template>
  </Dialog>
</template>

<script lang="ts" setup>
import Sortable from 'sortablejs'
import * as DataModelApi from '@/api/infra/dataModel'
import { SYSTEM_COLUMN_PROFILES } from '@/api/infra/dataModel'

/** 数据模型设计表单（页内展示，非弹窗） */
defineOptions({ name: 'DataModelForm' })

/** 展示用的字段行：在 API 结构上附加只读标记 */
type ColumnRow = DataModelApi.DataModelColumnVO & {
  readonly?: boolean
  /** 描述是否被用户手动改过；未改过时描述跟随字段名自动生成 */
  commentTouched?: boolean
}
/** 展示用的索引行：附加「名字是否被手改过」标记，用于是否继续自动命名 */
type IndexRow = DataModelApi.DataModelIndexVO & { nameTouched?: boolean }

const { t } = useI18n()
const message = useMessage()

const formTitle = ref('')
const formLoading = ref(false)
const formType = ref('') // create / update
const formRef = ref()

const formData = ref<{
  id?: number
  dataSourceConfigId: number
  tableName: string
  tableComment: string
  modelName: string
  remark?: string
  columns: ColumnRow[]
  indexes: IndexRow[]
  riskConfirmed: boolean
  /** 系统列策略，仅新建时有意义 */
  systemColumnProfile: string
  /**
   * 乐观锁版本（B4-4）。改表时原样回传，取自 getDataModelStructure
   * 🔴 只由 open() 写入，界面上没有输入框 —— 让人填版本号没有意义，
   *    填错的表现是「保存被拒」，而用户看不懂为什么
   */
  version?: number
  /** 结构指纹（B4-2）。同上，只由 open() 写入、原样回传 */
  schemaFingerprint?: string
}>(emptyForm())

/**
 * 用户在二次确认弹窗里明确同意删除的业务字段名（B4-3）
 *
 * 🔴 这份名单是 `confirmDropColumns` 的唯一来源：非空 ⟹ 提交时置真。
 * 之所以不让用户去勾一个「我确认删列」的复选框（像 riskConfirmed 那样），
 * 是因为那个复选框与「具体删哪几列」在时间上是分开的 ——
 * 先勾上、再删三个字段，用户早就忘了自己勾过什么。
 * 确认必须发生在<b>删这个动作的当下</b>，弹窗里就写着这一列的名字。
 */
const confirmedDropColumns = ref<string[]>([])
const columnTypeList = ref<DataModelApi.DataModelColumnTypeVO[]>([])
/** 系统内置字段模板（拉取一次，用于只读判定与新建时展示）：首项是主键 id */
const systemColumns = ref<ColumnRow[]>([])
/**
 * 新建时的内置字段「工作副本」：每次打开都重新克隆，
 * 因为主键可改选到业务字段，内置 id 会被降级，不能污染共享模板。
 */
const builtinColumns = ref<ColumnRow[]>([])

const formRules = reactive({
  tableName: [
    { required: true, message: '表名不能为空', trigger: 'blur' },
    {
      // ⚠️ 只在【新建】时校验规范，与后端口径一致。
      // 改表也校验的话，存量表（test_demo_* 无 biz_ 前缀、导入表可能是驼峰）会立刻改不动，
      // 而它们正在被表单设计器使用。表名本身在改表时是只读的。
      validator: (_rule: any, value: string, callback: any) => {
        if (formType.value !== 'create') {
          callback()
          return
        }
        if (/^biz_[a-z0-9_]*[a-z0-9]$/.test(value ?? '')) {
          callback()
        } else {
          callback(
            new Error('表名须以 biz_ 开头，且只允许小写字母、数字、下划线（不以下划线结尾）')
          )
        }
      },
      trigger: 'blur'
    }
  ],
  tableComment: [
    { required: true, message: '表描述不能为空', trigger: 'blur' },
    {
      // 同上：只在新建时要求，与后端注释质量下限一致（至少 2 字符且含字母或汉字）
      validator: (_rule: any, value: string, callback: any) => {
        if (formType.value !== 'create') {
          callback()
          return
        }
        const trimmed = (value ?? '').trim()
        if (trimmed.length >= 2 && /[a-zA-Z一-龥]/.test(trimmed)) {
          callback()
        } else {
          callback(new Error('表描述至少 2 个字符，且不能是纯数字或纯标点'))
        }
      },
      trigger: 'blur'
    }
  ],
  modelName: [{ required: true, message: '模型名称不能为空', trigger: 'blur' }]
})

function emptyForm() {
  return {
    dataSourceConfigId: 0,
    tableName: '',
    tableComment: '',
    modelName: '',
    remark: '',
    columns: [] as ColumnRow[],
    indexes: [] as IndexRow[],
    riskConfirmed: false,
    systemColumnProfile: 'TENANT'
  }
}

/** 新建时置顶的系统主键字段 */
const systemTop = computed(() =>
  formType.value === 'create' ? builtinColumns.value.slice(0, 1) : []
)
/** 新建时置底的审计/租户/删除字段 */
const systemBottom = computed(() =>
  formType.value === 'create' ? builtinColumns.value.slice(1) : []
)

/**
 * 表格实际渲染的行：
 * - 新建：内置 id（只读） + 业务字段（可编辑） + 内置审计字段（只读）
 * - 编辑：真实表的全部字段，其中系统字段标记为只读
 */
const displayColumns = computed<ColumnRow[]>(() => {
  if (formType.value === 'create') {
    return [...systemTop.value, ...formData.value.columns, ...systemBottom.value]
  }
  return formData.value.columns
})

/** 索引可选的列：包含业务字段与系统字段（常给 tenant_id、create_time 建索引） */
const indexColumnOptions = computed(() =>
  displayColumns.value
    .filter((col) => !!col.columnName)
    .map((col) => ({
      value: col.columnName,
      label: col.columnComment ? `${col.columnName}（${col.columnComment}）` : col.columnName
    }))
)

const columnRowClass = ({ row }: { row: ColumnRow }) => (row.readonly ? 'col-readonly' : '')

/** 由父级在切换到本视图后调用，加载数据 */
const open = async (type: string, id?: number) => {
  formTitle.value = type === 'create' ? '新建模型' : '模型设计'
  formType.value = type
  resetForm()
  // 字段类型选项由后端提供，避免前后端两份枚举不一致
  if (columnTypeList.value.length === 0) {
    columnTypeList.value = await DataModelApi.getColumnTypeList()
  }
  // 系统内置字段列表：新建时按所选策略只读展示，编辑时用于判定哪些行不可改
  await loadSystemColumns(formData.value.systemColumnProfile)
  if (type === 'create') {
    formData.value.columns = []
    // 每次打开都用全新的内置字段副本，避免上一次的主键改选残留
    builtinColumns.value = systemColumns.value.map((col) => ({ ...col }))
  } else if (id) {
    formLoading.value = true
    try {
      const model = await DataModelApi.getDataModel(id)
      const structure = await DataModelApi.getDataModelStructure(id)
      formData.value = {
        ...model,
        columns: structure.columns.map((item) => ({
          ...item,
          // 记下原字段名，改名时后端据此生成 CHANGE COLUMN 而不是删列重建
          oldColumnName: item.columnName,
          // 系统内置字段只读，不可删改
          readonly: isSystemColumn(item.columnName),
          // 已有字段的描述视为用户已确认，不再跟随字段名自动改写
          commentTouched: true
        })),
        indexes: (structure.indexes || []).map((item) => ({ ...item, nameTouched: true })),
        riskConfirmed: false,
        // 🔴 两条基线都取 structure 的返回值，不取 model 的（B4-2 / B4-4）。
        //    version 两边都有且同值，但指纹只有 structure 有，而它必须是
        //    「与这份列清单同一次读出来的那一份」—— 分两次取的话，
        //    中间若有人改了库，提交上去的就是一个自相矛盾的基线，
        //    后端要么误判漂移、要么放过真漂移
        version: structure.version,
        schemaFingerprint: structure.schemaFingerprint,
        // 改表时 profile 无意义（后端也会忽略），占位即可
        systemColumnProfile: 'TENANT'
      }
      // 换了一张表，上一次的删列确认一律作废
      confirmedDropColumns.value = []
    } finally {
      formLoading.value = false
    }
  }
  await nextTick()
  initSortable()
}
defineExpose({ open })

const emit = defineEmits(['success', 'cancel'])

const resetForm = () => {
  formData.value = emptyForm()
  confirmedDropColumns.value = []
  formRef.value?.resetFields()
}

/** 返回列表：取消按钮与返回箭头都走这里 */
const handleCancel = () => {
  emit('cancel')
}

/**
 * 系统内置字段名的「并集」：用于编辑已有表时判定只读
 *
 * 🔴 不能只用当前 profile 那一份。读一张已存在的表时，我们并不知道它当初是按哪个策略建的
 * （profile 刻意不落库，物理表结构本身就是事实来源）。
 * 只按 TENANT 那份判定的话，存量 LEGACY 表的 version 列在界面上是可编辑可删的，
 * 而后端的系统列保护会拒绝删它 —— 又一个「界面让做、保存才报错」。
 */
const systemColumnNames = ref<Set<string>>(new Set())

/** 按策略加载系统内置字段；同时把并集补进 systemColumnNames */
const loadSystemColumns = async (profile: string) => {
  const cols = await DataModelApi.getSystemColumns(profile)
  systemColumns.value = cols.map((col) => ({ ...col, readonly: true }))
  cols.forEach((col) => systemColumnNames.value.add(col.columnName.toLowerCase()))
  // LEGACY 含 version、TENANT 含 tenant_id，谁也不是谁的超集，取一次并集补齐
  if (systemColumnNames.value.size < 8) {
    const others = await DataModelApi.getSystemColumns(profile === 'LEGACY' ? 'TENANT' : 'LEGACY')
    others.forEach((col) => systemColumnNames.value.add(col.columnName.toLowerCase()))
  }
}

/** 切换系统列策略：内置字段要跟着变，否则界面展示的与建出来的表不一致 */
const handleProfileChange = async (profile: string) => {
  await loadSystemColumns(profile)
  builtinColumns.value = systemColumns.value.map((col) => ({ ...col }))
  // 策略变了可能移除了 tenant_id，清掉引用了已消失列的索引，避免提交时报「索引列不存在」
  const available = new Set(displayColumns.value.map((c) => c.columnName?.toLowerCase()))
  formData.value.indexes = formData.value.indexes.filter((idx) =>
    (idx.columnNames || []).every((n) => available.has((n || '').toLowerCase()))
  )
}

const currentProfileTip = computed(
  () =>
    SYSTEM_COLUMN_PROFILES.find((p) => p.value === formData.value.systemColumnProfile)?.tip ?? ''
)

/** 是否为系统内置字段（大小写不敏感） */
const isSystemColumn = (name: string) => systemColumnNames.value.has((name || '').toLowerCase())

// ==================== 字段编辑 ====================

const findType = (type: string) => columnTypeList.value.find((item) => item.type === type)
const needLength = (type: string) => !!findType(type)?.needLength
const needScale = (type: string) => !!findType(type)?.needScale

/** 只有主键且是整数类型才能自增 */
const canAutoIncrement = (row: ColumnRow) =>
  row.primaryKey && ['INT', 'LONG'].includes(row.columnType)

const handleAddColumn = () => {
  formData.value.columns.push({
    columnName: '',
    columnComment: '',
    columnType: 'STRING',
    length: 255,
    nullable: true,
    primaryKey: false,
    autoIncrement: false,
    defaultValue: '',
    commentTouched: false
  })
}

/** 输入字段名时，若用户还没手改过描述，就让描述跟随字段名，省得再填一遍 */
const handleColumnNameInput = (row: ColumnRow) => {
  if (!row.commentTouched) {
    row.columnComment = row.columnName
  }
}

/** 新建时主键可选：业务字段，或内置 id 本身（其余内置审计/租户字段不可为主键） */
const canBePrimaryKey = (row: ColumnRow) =>
  !row.readonly || (row.columnName || '').toLowerCase() === 'id'

/**
 * 改选主键：单选，选中谁其余全部取消。
 * 主键强制 NOT NULL、不给默认值；非整数主键不能自增；被顶替的内置 id 自动降级为普通字段。
 */
const handlePrimaryKeyChange = (target: ColumnRow) => {
  displayColumns.value.forEach((row) => {
    const isTarget = row === target
    row.primaryKey = isTarget
    if (isTarget) {
      row.nullable = false
      row.defaultValue = ''
      if (!['INT', 'LONG'].includes(row.columnType)) {
        row.autoIncrement = false
      }
    } else {
      row.autoIncrement = false
    }
  })
}

// ==================== 快速添加字段 ====================

/** 构造一个可空业务字段行 */
const presetColumn = (
  columnName: string,
  columnComment: string,
  columnType: string,
  length?: number
): ColumnRow => ({
  columnName,
  columnComment,
  columnType,
  length,
  nullable: true,
  primaryKey: false,
  autoIncrement: false,
  defaultValue: '',
  // 预设字段自带描述，视为已确认，不再跟随字段名改写
  commentTouched: true
})

/**
 * 流程字段预设：参考内置 test_leave 表。
 *
 * 🔴 这两列的类型不是随手挑的，是平台**校验**的：BPM 挂流程前会查
 * `process_instance_id` 是不是字符串且不短于 64、`process_status` 是不是整数型，
 * 不合格就把这张表单标成「不可用」（后端 `FormDesignApiImpl#resolveUnavailableReason` 第 6/7 条）。
 * process_status 用 INT 而不是 TINYINT —— 两者都过整数型判定，这里与「状态」预设保持一致；
 * 受控类型集里**是有** TINYINT 的（本页字段类型那栏的提示就在推荐它）。
 */
const PROCESS_FIELD_PRESETS: ColumnRow[] = [
  presetColumn('process_instance_id', '流程实例编号', 'STRING', 64),
  presetColumn('process_status', '流程状态', 'INT')
]

/** 常用字段预设：低代码建表的高频字段，点一个加一个 */
const COMMON_FIELD_PRESETS: { command: string; label: string; build: () => ColumnRow }[] = [
  {
    command: 'name',
    label: '名称（name）',
    build: () => presetColumn('name', '名称', 'STRING', 64)
  },
  {
    command: 'code',
    label: '编码（code）',
    build: () => presetColumn('code', '编码', 'STRING', 64)
  },
  {
    command: 'status',
    label: '状态（status）',
    build: () => presetColumn('status', '状态', 'INT')
  },
  { command: 'type', label: '类型（type）', build: () => presetColumn('type', '类型', 'INT') },
  { command: 'sort', label: '排序（sort）', build: () => presetColumn('sort', '排序', 'INT') },
  {
    command: 'remark',
    label: '备注（remark）',
    build: () => presetColumn('remark', '备注', 'STRING', 500)
  }
]

/** 追加预设字段：已存在同名字段（大小写不敏感）则跳过，避免制造重复列 */
const addPresetColumns = (presets: ColumnRow[]) => {
  const existing = new Set(
    formData.value.columns.map((item) => (item.columnName || '').toLowerCase())
  )
  let added = 0
  presets.forEach((preset) => {
    const key = preset.columnName.toLowerCase()
    if (existing.has(key)) {
      return
    }
    formData.value.columns.push(preset)
    existing.add(key)
    added++
  })
  if (added === 0) {
    // 🔴 「已存在」不等于「已合格」：流程那两列名对而类型不对时，这张表照样挂不上审批流。
    //    此前这里只有一句「无需重复添加」，用户被留在死路上（B18）。
    //    具体差在哪由 flowColumnProblem 那条常驻红条说 —— toast 只活 3 秒，说不完也不够改。
    message.info(
      flowColumnProblem.value ? '相关字段已存在，但类型不合格，见上方红色提示' : '相关字段已存在，无需重复添加'
    )
  } else {
    message.success(`已快速添加 ${added} 个字段`)
  }
}

/**
 * 流程回写列已存在、但类型或长度不合格时的那句常驻提示；合格时为空串（红条不出现）
 *
 * <h3>为什么要一条常驻提示，而不是点「快速添加」时弹一句</h3>
 * 这是个<b>不报错的坏状态</b>：表建得成、表单发得出去、列表能查能录，
 * 只有在【流程模型 → 表单设计】选在线表单时才被标成「不可用」，
 * 而那一刻用户已经离根因四段路远了。既有的黄色提示只说「要有这两列」，
 * 两列在、类型错的时候它一声不响 —— 于是唯一的线索是流程那一侧的一句
 * 「process_status 列类型为 VARCHAR，需改为整数型」，而回到这一页没有任何东西与之对应。
 *
 * <p>🔴 只<b>说</b>、不替用户改：把 varchar 改成 int 是一次可能失败、可能截断数据的 ALTER，
 * 那必须是人看着表里的数据做的决定。类型下拉就在下面那张表里，一次点击的事。
 *
 * <p>🔴 「合格」不等于「等于预设里写的那一个类型」：后端判 `process_status` 收的是<b>整数族</b>
 * （TINYINT / INT / LONG，见 `DataModelApiImpl#integerColumnTypes`），预设只写 INT。
 * 拿预设当判据的话，AI 照 `datamodel_create` 的说明建成 TINYINT（那边推荐的正是它），
 * 人打开这一页却看到红字说它不合格 —— 提示与后端各说一套，比不提示更坏（B18，方案 §10.13）。
 * 所以整数族从 `columnTypeList` 的 `javaType` 现推，判据与后端同一个（`javaType ∈ {Integer, Long}`），
 * 枚举里日后多一个整数类型这里自动跟上；非整数型的预设仍只收它自己。
 *
 * <p>⚠️ 类型词表还没加载到（接口失败）时<b>整条沉默</b>：判据缺一半还去报「不合格」，
 * 报出来的是错误结论。与后端那条约束读不到名单就沉默同口径。
 */
const INTEGER_JAVA_TYPES = ['Integer', 'Long']

/** 受控类型里的整数族；判据取自后端下发的 javaType，不在前端再抄一份类型名 */
const integerColumnTypes = computed(() =>
  columnTypeList.value
    .filter((item) => INTEGER_JAVA_TYPES.includes(item.javaType))
    .map((item) => item.type.toUpperCase())
)

/** 某个预设类型的「合格集合」：整数型收整个整数族，其余只收它自己 */
const acceptedTypesOf = (presetType: string) => {
  const upper = presetType.toUpperCase()
  const integers = integerColumnTypes.value
  return integers.includes(upper) ? integers : [upper]
}

const flowColumnProblem = computed(() => {
  if (columnTypeList.value.length === 0) {
    return ''
  }
  const bad: string[] = []
  PROCESS_FIELD_PRESETS.forEach((preset) => {
    const row = formData.value.columns.find(
      (item) => (item.columnName || '').toLowerCase() === preset.columnName.toLowerCase()
    )
    if (!row) {
      return
    }
    const accepted = acceptedTypesOf(preset.columnType)
    const type = (row.columnType || '').toUpperCase()
    if (!accepted.includes(type)) {
      bad.push(`${preset.columnName} 现在是 ${row.columnType || '未设置'}，要求 ${accepted.join(' / ')}`)
      return
    }
    if (preset.length && (row.length || 0) < preset.length) {
      bad.push(
        `${preset.columnName} 长度现在是 ${row.length || '未设置'}，要求不小于 ${preset.length}`
      )
    }
  })
  if (bad.length === 0) {
    return ''
  }
  return (
    `${bad.join('；')}。类型不合格时建表与发布都不会报错，` +
    `但这张表上的在线表单会被【流程模型 → 表单设计】标成「不可用」，挂不上审批流。` +
    `请在下方字段列表里改这一列的类型/长度，改完点「保存」（会执行 ALTER TABLE）`
  )
})

const handleQuickAdd = (command: string) => {
  if (command === '__process__') {
    // 流程字段每次新建对象，避免多张表共享同一引用被相互改动
    addPresetColumns(PROCESS_FIELD_PRESETS.map((item) => ({ ...item })))
    return
  }
  const preset = COMMON_FIELD_PRESETS.find((item) => item.command === command)
  if (preset) {
    addPresetColumns([preset.build()])
  }
}

/**
 * 删除业务字段：先二次确认，再按行引用删除，并清理引用了该字段的索引
 *
 * <h3>🔴 为什么必须弹窗（B4-3 / B4-7）</h3>
 * 改表是【全量同步】语义：这一行从数组里消失，保存时后端就会生成
 * {@code ALTER TABLE … DROP COLUMN}。而 MySQL 的 DDL <b>没有事务</b> ——
 * 点一下垃圾桶图标就把一个字段连同它的数据永久删掉，这个代价与那一下点击太不成比例。
 * 修改前这里<b>一次确认都没有</b>：点一下行就没了，保存时也不再有第二次机会，
 * 空表上后端还会放行（「有数据才拦」），于是整条路上没有任何一处会让人停下来。
 *
 * <p>确认之后把字段名记进 {@link confirmedDropColumns}，它就是提交时
 * {@code confirmDropColumns=true} 的唯一来源 —— 后端那道闸要的正是「人确实同意删这几列」，
 * 而这份同意只能在删的当下取得。
 *
 * <p>⚠️ 只对本次<b>真的会 DROP</b> 的字段弹窗：{@code oldColumnName} 有值说明这列
 * 物理表里已经存在（它是 open() 从真实结构读回来时记下的）。刚在这个页面上新加、
 * 还没保存过的行没有它 —— 删掉只是撤销一次误点，吓用户一跳没有任何好处。
 */
const handleRemoveColumn = async (row: ColumnRow) => {
  const name = row.columnName || ''
  if (formType.value === 'update' && row.oldColumnName) {
    try {
      await message.confirm(
        `确定要删除字段「${name}」吗？保存后数据库会执行 DROP COLUMN，` +
          `该字段与其中的数据将永久丢失，且无法回滚。`,
        '删除字段确认'
      )
    } catch {
      return // 用户取消：什么都不做，包括不动 confirmedDropColumns
    }
    if (name && !confirmedDropColumns.value.includes(name)) {
      confirmedDropColumns.value.push(name)
    }
  }
  formData.value.columns = formData.value.columns.filter((item) => item !== row)
  const removed = (row.columnName || '').toLowerCase()
  if (removed) {
    formData.value.indexes.forEach((index) => {
      index.columnNames = index.columnNames.filter(
        (columnName) => columnName.toLowerCase() !== removed
      )
    })
    // 列被删空的索引已无意义，直接移除
    formData.value.indexes = formData.value.indexes.filter((index) => index.columnNames.length > 0)
  }
}

/** 切类型时清掉不适用的长度与精度，避免残留脏值提交到后端 */
const handleTypeChange = (row: ColumnRow) => {
  if (!needLength(row.columnType)) {
    row.length = undefined
  } else if (!row.length) {
    row.length = row.columnType === 'DECIMAL' ? 10 : 255
  }
  if (!needScale(row.columnType)) {
    row.scale = undefined
  } else if (row.scale === undefined) {
    row.scale = 2
  }
  if (!canAutoIncrement(row)) {
    row.autoIncrement = false
  }
}

// ==================== 索引编辑 ====================

const handleAddIndex = () => {
  formData.value.indexes.push({
    indexName: '',
    indexType: 'NORMAL',
    columnNames: [],
    nameTouched: false
  })
}

const handleRemoveIndex = (row: IndexRow) => {
  formData.value.indexes = formData.value.indexes.filter((item) => item !== row)
}

/** 未手动改过名字时，按「类型前缀 + 列名」自动生成索引名 */
const handleIndexAutoName = (row: IndexRow) => {
  if (row.nameTouched) {
    return
  }
  const prefix = row.indexType === 'UNIQUE' ? 'uk_' : 'idx_'
  row.indexName = row.columnNames.length > 0 ? prefix + row.columnNames.join('_') : ''
}

/** 拖拽排序：仅新建模式下重排业务字段，系统内置行不可拖动也不可作为落点 */
const initSortable = () => {
  if (formType.value !== 'create') {
    return
  }
  const tbody = document.querySelector('.column-table .el-table__body tbody')
  if (!tbody) {
    return
  }
  Sortable.create(tbody as HTMLElement, {
    handle: '.drag-handle',
    animation: 150,
    filter: '.col-readonly',
    onMove: (evt) => !evt.related.classList.contains('col-readonly'),
    onEnd: ({ oldIndex, newIndex }) => {
      if (oldIndex === undefined || newIndex === undefined || oldIndex === newIndex) {
        return
      }
      // DOM 行号含置顶的内置 id，换算回业务字段区间
      const offset = systemTop.value.length
      const columns = formData.value.columns
      const from = oldIndex - offset
      const to = Math.min(Math.max(newIndex - offset, 0), columns.length - 1)
      if (from < 0 || from >= columns.length) {
        return
      }
      columns.splice(to, 0, columns.splice(from, 1)[0])
    }
  })
}

// ==================== 预览与提交 ====================

const ddlVisible = ref(false)
const ddlList = ref<string[]>([])

// ==================== 字典/关联（业务语义） ====================

const metaVisible = ref(false)
const metaRow = ref<ColumnRow | null>(null)
const metaForm = ref({ dictType: '', refTable: '', refColumn: '' })

/** 表格里的摘要文案：优先显示字典，其次显示关联 */
const metaSummary = (row: ColumnRow) => {
  if (row.dictType) {
    return `字典：${row.dictType}`
  }
  if (row.refTable) {
    return `关联：${row.refTable}${row.refColumn ? '.' + row.refColumn : ''}`
  }
  return ''
}

const openMetaDialog = (row: ColumnRow) => {
  metaRow.value = row
  metaForm.value = {
    dictType: row.dictType ?? '',
    refTable: row.refTable ?? '',
    refColumn: row.refColumn ?? ''
  }
  metaVisible.value = true
}

const saveMeta = () => {
  if (metaRow.value) {
    // 空串归一成 undefined：后端按「没配」处理，避免存下一堆空字符串
    metaRow.value.dictType = metaForm.value.dictType.trim() || undefined
    metaRow.value.refTable = metaForm.value.refTable.trim() || undefined
    metaRow.value.refColumn = metaForm.value.refColumn.trim() || undefined
  }
  metaVisible.value = false
}

const clearMeta = () => {
  metaForm.value = { dictType: '', refTable: '', refColumn: '' }
  saveMeta()
}

/** 组装提交给后端的载荷：剥离只读/自动命名等纯前端标记 */
const buildPayload = (): DataModelApi.DataModelSaveReqVO => {
  // 新建：把内置字段一并提交，后端就不会再自行注入 id 作主键，从而尊重界面上改选的主键；
  // 编辑：formData.columns 本就是真实表的全部字段。
  const sourceColumns = formType.value === 'create' ? displayColumns.value : formData.value.columns
  const columns = sourceColumns.map((row) => ({
    columnName: row.columnName,
    columnComment: row.columnComment,
    columnType: row.columnType,
    length: row.length,
    scale: row.scale,
    nullable: row.nullable,
    primaryKey: row.primaryKey,
    autoIncrement: row.autoIncrement,
    defaultValue: row.defaultValue,
    oldColumnName: row.oldColumnName,
    // 业务语义：不落物理表，后端单独存进 column_meta。
    // 改表时后端按提交的完整列表重建，所以这里必须原样带上，漏传等于清空
    dictType: row.dictType,
    refTable: row.refTable,
    refColumn: row.refColumn
  }))
  const indexes = formData.value.indexes.map((row) => ({
    indexName: row.indexName,
    indexType: row.indexType,
    columnNames: row.columnNames
  }))
  const isUpdate = formType.value === 'update'
  return {
    id: formData.value.id,
    dataSourceConfigId: formData.value.dataSourceConfigId,
    tableName: formData.value.tableName,
    tableComment: formData.value.tableComment,
    modelName: formData.value.modelName,
    remark: formData.value.remark,
    columns,
    indexes,
    riskConfirmed: formData.value.riskConfirmed,
    // 只在新建时提交：改表传了后端也会忽略，但传了容易让人误以为能改
    systemColumnProfile: isUpdate ? undefined : formData.value.systemColumnProfile,
    // 🔴 下面三项只在改表时提交。新建时一律不带：
    //    建表没有「原来那一版」可比，带上只会让后端以为要加锁
    version: isUpdate ? formData.value.version : undefined,
    schemaFingerprint: isUpdate ? formData.value.schemaFingerprint : undefined,
    // 真删了列才置真（B4-3）。名单来自删字段时那个二次确认弹窗，
    // 所以它为真 ⟺ 有人在那一刻看着字段名点了「确定」
    confirmDropColumns:
      isUpdate && confirmedDropColumns.value.length > 0 ? true : undefined
  }
}

const handlePreviewDdl = async () => {
  if (!(await validateForm())) {
    return
  }
  try {
    ddlList.value = await DataModelApi.previewDdl(buildPayload())
    ddlVisible.value = true
  } catch (error: any) {
    message.error(error?.msg || '预览失败')
  }
}

/** 提交前的前端校验：后端会再校验一遍，这里只是让用户少跑一趟 */
const validateForm = async () => {
  try {
    await formRef.value?.validate()
  } catch {
    return false
  }
  const columns = displayColumns.value
  if (columns.length === 0) {
    message.warning('至少需要一个字段')
    return false
  }
  // 空字段名/空描述只校验用户可编辑的字段：系统内置字段是只读的，
  // 其描述由框架托管（真实表里可能本就为空），用户无法填写，不应因此拦住预览/保存
  const editableColumns = columns.filter((item) => !item.readonly)
  if (editableColumns.some((item) => !item.columnName)) {
    message.warning('存在字段名为空的字段')
    return false
  }
  if (editableColumns.some((item) => !item.columnComment)) {
    message.warning('存在描述为空的字段')
    return false
  }
  // 字段名重复：MySQL 大小写不敏感，统一转小写比较（含内置字段，防止业务字段与内置字段撞名）
  const names = columns.map((item) => (item.columnName || '').toLowerCase())
  const duplicate = names.find((name, index) => name && names.indexOf(name) !== index)
  if (duplicate) {
    message.warning(`字段名重复：${duplicate}`)
    return false
  }
  // 主键必须且只能有一个：仅新建时校验（此时用户可改选主键）；
  // 设计已有表时主键不可变，且导入的表可能是复合主键，不该在此拦住预览
  if (formType.value === 'create' && columns.filter((item) => item.primaryKey).length !== 1) {
    message.warning('必须且只能指定一个主键')
    return false
  }
  return validateIndexes()
}

/** 索引校验：名字合法且不重复、至少一列 */
const validateIndexes = () => {
  const indexes = formData.value.indexes
  const nameSet = new Set<string>()
  for (const index of indexes) {
    const name = (index.indexName || '').trim()
    if (!name || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      message.warning('索引名不合法：只允许字母、数字、下划线，且以字母或下划线开头')
      return false
    }
    const lower = name.toLowerCase()
    if (nameSet.has(lower)) {
      message.warning(`索引名重复：${name}`)
      return false
    }
    nameSet.add(lower)
    if (!index.columnNames || index.columnNames.length === 0) {
      message.warning(`索引「${name}」至少需要选择一个列`)
      return false
    }
  }
  return true
}

const submitForm = async () => {
  if (!(await validateForm())) {
    return
  }
  formLoading.value = true
  try {
    if (formType.value === 'create') {
      await DataModelApi.createDataModel(buildPayload())
      message.success(t('common.createSuccess'))
    } else {
      await DataModelApi.updateDataModel(buildPayload())
      message.success(t('common.updateSuccess'))
    }
    emit('success')
  } catch (error: any) {
    // 🔴 取 message 而不是 msg：axios 那层业务错误 reject 的是 new Error(msg)（见 config/axios/service.ts），
    //    它身上只有 message。原来这里读 error?.msg，恒为 undefined，
    //    于是「后端要求勾选我已知晓风险」那句提示**从来没弹出来过** ——
    //    用户只看到右上角那条 4.5 秒就消失的通知，读完之前它就没了
    const msg: string = error?.message ?? error?.msg ?? ''
    if (msg.includes('已被他人修改') || msg.includes('未执行任何 DDL')) {
      // 版本冲突 / 结构漂移（B4-4 / B4-2）：这两条的补救都是「重新打开本页」，
      // 而它们的消息很长、且必须留得住 —— 用 alert 而不是会自动消失的通知。
      // 🔴 文案里不塞 \n 当换行：ElMessageBox 的消息体是普通 HTML，没有 white-space: pre-line
      //    时换行符会被折叠成一个空格（与 ExecutionHistoryDrawer 的 droppedKeysNotice 同一口径），
      //    分句一律用内联 ' ⚠️ ' 分隔。
      // 🔴 刻意**不**自动重新拉取结构：那等于用别人的最新数据顶掉用户手里这份，
      //    用户会以为自己的修改还在，其实已经被覆盖 —— 乐观锁要防的正是这件事
      message.alertError(
        `${msg} ⚠️ 本页仍持有旧的基线，继续点保存只会重复失败。` +
          `请点「返回」重新进入本页取回最新结构，在其上重做本次修改。`
      )
    } else if (msg.includes('我已知晓风险')) {
      message.warning(msg)
    }
  } finally {
    formLoading.value = false
  }
}
</script>

<style lang="scss" scoped>
.dm-form-header {
  padding-bottom: 12px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.dm-form-title {
  font-size: 16px;
  font-weight: bold;
  color: var(--el-text-color-primary);
}

.profile-tip {
  padding-top: 8px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--el-text-color-secondary);
}

.meta-hint {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--el-text-color-secondary);
}

.ddl-block {
  padding: 10px;
  margin: 0;
  font-family: Consolas, Monaco, monospace;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-primary);
  white-space: pre-wrap;
  word-break: break-all;
  background-color: var(--el-fill-color-light);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
}

.ddl-seq {
  color: var(--el-text-color-secondary);
}

/* 系统内置字段行：底色区分，输入框已由 disabled 置灰 */
:deep(.col-readonly) {
  background-color: var(--el-fill-color-lighter);
}

/* 主键单选：只显示圆点，不显示 label 文本 */
.pk-radio {
  margin-right: 0;

  :deep(.el-radio__label) {
    display: none;
  }
}
</style>
