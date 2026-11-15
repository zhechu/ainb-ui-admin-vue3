<template>
  <Dialog v-model="dialogVisible" :title="dialogTitle" width="860">
    <el-form
      ref="formRef"
      v-loading="formLoading"
      :model="formData"
      :rules="formRules"
      label-width="140px"
    >
      <el-form-item label="所属项目" prop="projectId">
        <!-- 🔴 编辑时所属项目不可改：标的属性是按品类的 param_schema 校验的，
             换项目等于换品类，已填的 attrs 可能整个不合法。要挪只能删了重建 -->
        <span v-if="formType === 'update'" class="text-13px">
          {{ projectLabel }}
          <span class="form-tip-inline">所属项目不能改，要挪到别的项目只能删掉重建</span>
        </span>
        <el-select
          v-else
          v-model="formData.projectId"
          filterable
          remote
          clearable
          reserve-keyword
          :remote-method="searchProjects"
          :loading="projectLoading"
          placeholder="输入项目名称搜索"
          class="w-full"
          @change="handleProjectChange"
        >
          <el-option
            v-for="item in projectOptions"
            :key="item.id"
            :label="item.projectName"
            :value="item.id"
            :disabled="item.status === 'VOIDED'"
          >
            <span>{{ item.projectName }}</span>
            <span class="option-hint"> {{ item.projectNo }} · {{ item.statusDescription }} </span>
          </el-option>
        </el-select>
      </el-form-item>

      <el-form-item label="标的名称" prop="subjectName">
        <el-input v-model="formData.subjectName" placeholder="请输入标的名称" />
      </el-form-item>

      <el-form-item label="标的类型">
        <span class="text-13px">{{ subjectTypeLabel }}</span>
        <span class="form-tip-inline">由项目品类决定，不接受指定</span>
      </el-form-item>

      <el-form-item label="账面价值（元）" prop="bookValue">
        <el-input-number
          v-model="formData.bookValue"
          :min="0"
          :precision="2"
          :controls="false"
          placeholder="请输入账面价值"
          class="!w-240px"
        />
      </el-form-item>

      <el-form-item label="排序" prop="sort">
        <el-input-number
          v-model="formData.sort"
          :min="0"
          :precision="0"
          :controls="false"
          placeholder="一个项目多个标的时的顺序"
          class="!w-240px"
        />
      </el-form-item>

      <el-divider content-position="left">
        <span class="text-13px">标的属性</span>
        <span v-if="categoryName" class="divider-hint">按品类「{{ categoryName }}」的定义渲染</span>
      </el-divider>

      <el-alert v-if="!attrFields.length" type="info" :closable="false" class="mb-16px">
        <template #title>
          <span class="text-13px">
            {{ formData.projectId ? '这个品类没有定义标的属性' : '先选一个项目，属性项才会出现' }}
          </span>
        </template>
        <div v-if="formData.projectId" class="text-12px">
          属性项来自品类的参数 schema（作用域为标的属性的那一批），由实施人员维护。
          这里空着不是界面坏了——是这个品类确实一个属性都没定义。
        </div>
      </el-alert>

      <el-alert v-else-if="orphanList.length" type="warning" :closable="false" class="mb-16px">
        <template #title>
          <span class="text-13px">有 {{ orphanList.length }} 项历史属性已不在品类定义里</span>
        </template>
        <div class="text-12px">
          {{ orphanList.join('、') }}
          ——这些值改不动、也算不进测算，而且<b>保存之后不会再保留</b>。
          留着它们会让这个标的一条也改不了，所以这里不回传；要留档请先导出。
        </div>
      </el-alert>

      <el-form-item
        v-for="field in attrFields"
        :key="field.item.key"
        :label="field.item.label"
        :required="field.item.required"
      >
        <!-- 数值 -->
        <template v-if="isNumeric(field.item.type)">
          <el-input-number
            v-model="attrsModel[field.item.key]"
            :precision="field.precision"
            :min="field.min"
            :max="field.max"
            :controls="false"
            :placeholder="numericPlaceholder(field)"
            class="!w-240px"
          />
          <span v-if="field.item.unit" class="unit-hint">{{ field.item.unit }}</span>
        </template>

        <!-- 枚举 -->
        <el-select
          v-else-if="field.item.type === ATTR_TYPE.ENUM"
          v-model="attrsModel[field.item.key]"
          clearable
          placeholder="请选择"
          class="!w-240px"
        >
          <el-option
            v-for="option in field.item.options ?? []"
            :key="option"
            :label="option"
            :value="option"
          />
        </el-select>

        <!-- 日期 -->
        <el-date-picker
          v-else-if="field.item.type === ATTR_TYPE.DATE"
          v-model="attrsModel[field.item.key]"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="请选择日期"
          class="!w-240px"
        />

        <!-- 经纬度：🔴 只认 lng / lat 两个键名，且经度在前
             🔴 这一支是整个模板里**唯一**对 attrsModel[key] 再取一层属性的地方
                （其余各支都是直接绑 attrsModel[key]，读到 undefined 也无害）。
                它成立的前提是「schema 里有的键，模型里一定有一个对象」，
                而那个前提由 applyCategory 的同步块保证 —— 改那边之前先读它的注释 -->
        <div v-else-if="field.item.type === ATTR_TYPE.GEO" class="flex items-center gap-8px">
          <el-input-number
            v-model="attrsModel[field.item.key].lng"
            :precision="GEO_SCALE"
            :min="GEO_BOUNDS.lngMin"
            :max="GEO_BOUNDS.lngMax"
            :controls="false"
            placeholder="经度 lng"
            class="!w-180px"
          />
          <el-input-number
            v-model="attrsModel[field.item.key].lat"
            :precision="GEO_SCALE"
            :min="GEO_BOUNDS.latMin"
            :max="GEO_BOUNDS.latMax"
            :controls="false"
            placeholder="纬度 lat"
            class="!w-180px"
          />
        </div>

        <!-- 文本 -->
        <el-input
          v-else
          v-model="attrsModel[field.item.key]"
          clearable
          :maxlength="field.item.indexed ? INDEXED_STR_MAX_LENGTH : undefined"
          :show-word-limit="!!field.item.indexed"
          placeholder="请输入"
          class="!w-360px"
        />

        <div v-if="field.item.clauseRef" class="form-tip">依据：{{ field.item.clauseRef }}</div>
      </el-form-item>

      <el-divider content-position="left">
        <span class="text-13px">权属证明文件</span>
        <span class="divider-hint">从本项目已收进来的资料里挑</span>
      </el-divider>

      <el-form-item label="权属证明">
        <div class="w-full">
          <el-select
            v-model="formData.ownershipFileIds"
            multiple
            filterable
            remote
            reserve-keyword
            :remote-method="searchMaterials"
            :loading="materialLoading"
            :disabled="!formData.projectId"
            placeholder="输入文件名搜索本项目的资料"
            class="w-full"
          >
            <el-option
              v-for="option in fileOptions"
              :key="option.fileId"
              :label="option.label"
              :value="option.fileId"
            />
          </el-select>
          <div class="form-tip">
            只能挑本项目下的资料；文件先在资料面板里传上来，这里才挑得到。
            指向已删除文件的项会被后端整批拒回来，请先把下面标红的那几项去掉。
          </div>
          <div v-if="missingFileIds.length" class="form-tip text-[var(--el-color-danger)]">
            有 {{ missingFileIds.length }} 项指向的文件已经查不到了（编号
            {{ missingFileIds.join('、') }}）——保存前必须移除。
          </div>
        </div>
      </el-form-item>
    </el-form>

    <!-- 🔴 放在 </el-form> 外面：form-create 自己也渲染一个 <form>，嵌套表单的行为是未定义的 -->
    <ExtFieldSection
      ref="extRef"
      v-model="formData.ext"
      entity-type="QLZG_SUBJECT"
      label-width="140px"
    />
    <template #footer>
      <el-button :disabled="formLoading" type="primary" @click="submitForm">确 定</el-button>
      <el-button @click="dialogVisible = false">取 消</el-button>
    </template>
  </Dialog>
</template>
<script lang="ts" setup>
import { QlzgCategoryApi, type QlzgParamSchemaItem } from '@/api/qlzg/category'
import { QlzgMaterialApi } from '@/api/qlzg/material'
import { QlzgProjectApi, type QlzgProjectVO } from '@/api/qlzg/project'
import { QlzgSubjectApi, type QlzgSubjectSaveVO } from '@/api/qlzg/subject'
import { SUBJECT_TYPE_OPTIONS, UNCLASSIFIED, labelOf } from '@/views/qlzg/constants'
import ExtFieldSection from '@/views/qlzg/components/ExtFieldSection.vue'
import {
  ATTR_TYPE,
  GEO_BOUNDS,
  GEO_SCALE,
  buildAttrsPayload,
  displayPrecision,
  displayRange,
  loadAttrsModel,
  missingRequiredLabels,
  orphanKeys,
  subjectAttrSchemaOf
} from './attrSchema'

defineOptions({ name: 'QlzgSubjectForm' })

/**
 * 标的表单 —— 属性区是**按品类 schema 动态渲染**的，不是写死的字段
 *
 * <h3>🔴 属性区的取值 / 回填 / 提交全部走 {@link ./attrSchema}，不要在这个组件里再算一遍</h3>
 * 那里是后端 {@code QlzgSubjectAttrsProcessor} 在前端的镜像，且被 attrSchema.spec.ts 钉着。
 * 在模板里顺手写一个 {@code value * 100} 或 {@code value / 100} 是最容易犯的一处 ——
 * 百分数项库里存的是分数，两个方向的换算只该有一个实现，
 * 否则「详情页与编辑表单对同一个值给出不同数字」这种 bug 就回来了。
 *
 * <h3>🔴 {@code attrs} 是三态：null 不改 / {} 清空 / 非空对象 覆盖</h3>
 * 所以必须区分「用户没碰属性区」与「用户把值都删了」，判据是提交时把
 * {@link attrsModel} 与打开表单那一刻的快照比一次（{@link attrsSnapshot}）。
 * 少这一步的后果是：一次只想改标的名称的保存，会把整个属性区清空 —— **而它不报错**。
 *
 * <h3>🔴 必填校验刻意只有一处，在提交时</h3>
 * {@code el-form} 的规则挂在 {@code formData} 上，而属性模型是**另一个对象**、
 * 键集合还是运行时才知道的。硬要走 el-form 就得给每个动态键算一份 rules，
 * 而 GEO 那种「对象非空但只填了一半」的情况它照样判不出来（{@code {lng: undefined}} 是个非空对象）。
 * 所以这里用 {@code missingRequiredLabels} 在提交前判一次，与后端 {@code normalize} 同一口径。
 *
 * <h3>🔴 刻意【没有】标的类型下拉</h3>
 * 标的类型由项目品类的 {@code subjectType} 决定，后端 {@code QlzgSubjectSaveReqVO}
 * 上根本没有这个字段、传了也会被忽略。放了用户就会去调它，而调不动。
 *
 * <h3>🔴 {@code ext}（机构自定义字段）与 {@code attrs} 是**两列**，别当成一回事</h3>
 * 两者的三态口径相同（null 不改 / {} 清空 / 非空对象 覆盖），但键集合的来源完全不同：
 * {@code attrs} 来自品类 {@code param_schema}（换品类就换一套），
 * {@code ext} 来自 {@code qlzg_field_def}（换机构才换一套）。
 *
 * <p>所以 {@code attrs} 需要 {@link attrsSnapshot} 那一套「碰没碰过」的判据 ——
 * 它的模型是照着 schema 现建的，不判就会在「只改个名字」时把属性区清空。
 * 而 {@code ext} **不需要**，理由分两支：
 * <ul>
 * <li>定义载入成功：{@code ExtFieldSection} 的模型是照记录里那份 {@code ext} 建的，
 *     没碰过时 emit 回来的就是同一批值，发回去幂等。</li>
 * <li>定义载入失败：它一个字都不 emit，{@code formData.ext} 保持 {@link open} 放进去的那一份
 *     —— 也就是 {@code /get} 读来的原值，原样发回去同样幂等。
 *     🔴 那一份**不是 null**：后端 {@code QlzgExtFieldSupport} 把 NULL 列解析成空 Map，
 *     所以「没存过值」读出来是 {@code {}} 而不是 {@code null}。别照 {@code attrs} 的直觉
 *     以为这里是「不传键 = 不修改」那一支。</li>
 * </ul>
 *
 * <p>🔴 而 {@code loadExtModel} **刻意不带**的那三类键（停用字段、{@code scene} 不覆盖 FORM
 * 的字段、库里没有定义的孤儿键），是后端 {@code QlzgExtFieldValidator#carryOverReadOnly}
 * 在整列覆盖时从**库里现值**补回来的 —— 它是唯一能看见现值的一方，
 * 前端手里只有 {@code /get} 那一刻的快照。把 snapshot 那套也套到 ext 上不会更安全，
 * 只会让「哪一份是权威」这件事多一个副本。
 */

/** 进投影的 STRING 属性在 {@code qlzg_subject_index.attr_value_str} 上的列宽 */
const INDEXED_STR_MAX_LENGTH = 255

const { t } = useI18n()
const message = useMessage()

const dialogVisible = ref(false)
const dialogTitle = ref('')
const formLoading = ref(false)
const formType = ref('')
const formRef = ref()

const emptyForm = () => ({
  id: undefined as number | undefined,
  projectId: undefined as number | undefined,
  subjectName: '',
  bookValue: undefined as number | undefined,
  sort: 0,
  ownershipFileIds: [] as number[],
  /** 🔴 null = 不修改。见类注释里「ext 与 attrs 是两列」那一段 */
  ext: null as Record<string, any> | null
})

const formData = ref(emptyForm())
const formRules = reactive({
  projectId: [{ required: true, message: '所属项目不能为空', trigger: 'change' }],
  subjectName: [{ required: true, message: '标的名称不能为空', trigger: 'blur' }]
})

// ==================== 品类与属性 schema ====================

const categoryName = ref('')
const subjectType = ref('')
const attrSchema = ref<QlzgParamSchemaItem[]>([])
/** 属性表单模型，形态是「显示口径」（百分数已乘 100） */
const attrsModel = ref<Record<string, any>>({})
/** 打开表单那一刻的模型快照，用来判「用户动没动过属性区」 */
const attrsSnapshot = ref('')
/** 库里有值、schema 已不再定义的属性 */
const orphanList = ref<string[]>([])

interface AttrField {
  item: QlzgParamSchemaItem
  precision?: number
  min?: number
  max?: number
}

/**
 * 渲染用的属性字段视图
 *
 * 🔴 精度与区间在这里**一次算好**，不在模板里反复调函数：
 *    模板里每一次重渲染都会重新求值，而 {@code displayRange} 会做乘法 ——
 *    除了浪费，更要紧的是「模板里出现算术」正是换算逻辑长出第二份实现的开头。
 */
const attrFields = computed<AttrField[]>(() =>
  attrSchema.value.map((schemaItem) => ({
    item: schemaItem,
    precision: displayPrecision(schemaItem),
    ...displayRange(schemaItem)
  }))
)

const subjectTypeLabel = computed(() =>
  subjectType.value ? labelOf(SUBJECT_TYPE_OPTIONS, subjectType.value) : '—'
)

const isNumeric = (type: string) => type === ATTR_TYPE.DECIMAL || type === ATTR_TYPE.INT

const numericPlaceholder = (field: AttrField): string => {
  const { min, max } = field
  if (min == null && max == null) return '请输入'
  const text = (value?: number) => (value == null ? '不限' : String(value))
  return `可填 ${text(min)} ~ ${text(max)}${field.item.unit ?? ''}`
}

// ==================== 项目下拉（远程搜索） ====================

const projectOptions = ref<QlzgProjectVO[]>([])
const projectLoading = ref(false)
const projectLabel = ref('')

const searchProjects = async (keyword: string) => {
  if (!keyword) return
  projectLoading.value = true
  try {
    const data = await QlzgProjectApi.getProjectPage({
      pageNo: 1,
      pageSize: 20,
      projectName: keyword
    })
    projectOptions.value = data.list
  } finally {
    projectLoading.value = false
  }
}

const handleProjectChange = async (projectId?: number) => {
  fileOptions.value = []
  if (!projectId) {
    clearCategory()
    return
  }
  const selected = projectOptions.value.find((item) => item.id === projectId)
  // 换项目 = 换品类 = 属性区整个重来。这里刻意**不保留**已填的值（第二个参数留空）：
  // 两个品类的 key 集合不同，留着只会得到一批谁也看不见的孤儿键
  await applyCategory(selected?.categoryCode)
  await searchMaterials('')
}

/** 清空品类与属性区。**同步**，不发请求 */
const clearCategory = () => {
  categoryName.value = ''
  subjectType.value = ''
  // 🔴 先清 schema 再重建模型：resetAttrs 是照着 attrSchema 建 key 集合的，
  //    顺序反了会得到一份「按上一个品类建的空模型」，而它和快照相等，
  //    于是 touched 恒为 false —— 这个 bug 不显形，但它是靠巧合而不是靠代码正确
  attrSchema.value = []
  resetAttrs(null)
}

/**
 * 按品类码载入品类，并用 {@code attrs} 重建属性区
 *
 * <p>🔴 详情接口按 categoryCode 取，不是按 id：品类码是跨机构的稳定标识，
 *    id 是每个租户各自的自增值。
 *
 * <p>🔴 **{@code attrSchema} 与 {@code attrsModel} 必须在同一个同步块里一起换，
 *    中间一个 {@code await} 都不能夹** —— 夹了就会多刷一次渲染，而那一帧是
 *    「新品类的 schema + 上一份的模型」，两者的 key 集合不一样。
 *    GEO 那一支模板写的是 {@code attrsModel[key].lng}（模板里唯一一处对模型再取一层属性的），
 *    于是读到 {@code undefined.lng} 抛 TypeError、渲染在 {@code ElFormItem} 里中断，
 *    连带 {@code v-loading} 这一次的更新也没执行 —— 结果是 loading 遮罩**永远不消失**、
 *    整个弹窗点不动。而四个接口全是 {@code code=0}、后端日志干净、界面上只在转圈，
 *    看起来就是「点编辑卡住了」（2026-11-08 实测：标的台账的每一行都必中，
 *    因为住宅品类的 schema 里有「经纬度」这一项）。
 *    所以下面刻意分成「await 取品类」与「连着四行落状态」两段；
 *    要往第二段里加东西，先确认它不是 {@code await}。
 */
const applyCategory = async (categoryCode?: string, attrs?: Record<string, any> | null) => {
  if (!categoryCode) {
    clearCategory()
    return
  }
  const category = await QlzgCategoryApi.getCategory(categoryCode)
  categoryName.value = category.categoryName
  subjectType.value = category.subjectType
  attrSchema.value = subjectAttrSchemaOf(category)
  resetAttrs(attrs)
}

/** 重建属性模型并把快照对齐 —— 之后任何与快照的差异都算「用户动过了」 */
const resetAttrs = (attrs?: Record<string, any> | null) => {
  attrsModel.value = loadAttrsModel(attrSchema.value, attrs)
  orphanList.value = orphanKeys(attrSchema.value, attrs)
  attrsSnapshot.value = JSON.stringify(attrsModel.value)
}

// ==================== 权属证明文件（从项目资料里挑） ====================

interface FileOption {
  fileId: number
  label: string
}

const fileOptions = ref<FileOption[]>([])
const materialLoading = ref(false)
/** 指向已删除文件的项 —— 后端会整批拒回来，必须先移除 */
const missingFileIds = ref<number[]>([])

const searchMaterials = async (keyword: string) => {
  const projectId = formData.value.projectId
  if (!projectId) return
  materialLoading.value = true
  try {
    const data = await QlzgMaterialApi.getMaterialPage({
      projectId,
      fileName: keyword || undefined,
      pageNo: 1,
      pageSize: 50
    })
    const searched = data.list.map((row) => ({
      fileId: row.fileId,
      label: `${row.fileName}（${row.categoryDescription || UNCLASSIFIED}）`
    }))
    // 🔴 已选中的项必须留在 options 里，否则远程搜索一换关键字，
    //    选中的那些就只剩一个裸文件编号显示
    const chosen = fileOptions.value.filter((option) =>
      formData.value.ownershipFileIds.includes(option.fileId)
    )
    const merged = new Map<number, FileOption>()
    for (const option of [...chosen, ...searched]) merged.set(option.fileId, option)
    fileOptions.value = [...merged.values()]
  } finally {
    materialLoading.value = false
  }
}

// ==================== 打开弹窗 ====================

const open = async (type: string, id?: number) => {
  dialogVisible.value = true
  dialogTitle.value = t('action.' + type)
  formType.value = type
  resetForm()
  if (!id) return
  formLoading.value = true
  try {
    const subject = await QlzgSubjectApi.getSubject(id)
    formData.value = {
      id: subject.id,
      projectId: subject.projectId,
      subjectName: subject.subjectName ?? '',
      bookValue: subject.bookValue,
      sort: subject.sort ?? 0,
      // 🔴 过滤掉 null：后端逐个校验文件可见性，数组里的 null 元素也会被报出来
      ownershipFileIds: (subject.ownershipFileIds ?? []).filter(
        (fileId): fileId is number => fileId != null
      ),
      ext: subject.ext ?? null
    }
    projectLabel.value = `${subject.projectNo ?? ''}　${subject.projectName ?? ''}`

    // 🔴 已失效的文件也要占位显示，不能 filter 掉：R25 要求权属证明可追溯，
    //    少显示一项会让用户以为材料齐了，而那一行指向的文件其实已经没了
    const missing: number[] = []
    fileOptions.value = (subject.ownershipFiles ?? []).map((file) => {
      if (file.missing) {
        missing.push(file.fileId)
        return { fileId: file.fileId, label: `已失效的文件（${file.fileId}）` }
      }
      return { fileId: file.fileId, label: file.fileName ?? `文件 ${file.fileId}` }
    })
    missingFileIds.value = missing

    const project = await QlzgProjectApi.getProject(subject.projectId)
    await applyCategory(project.categoryCode, subject.attrs)
  } finally {
    formLoading.value = false
  }
}
defineExpose({ open })

// ==================== 提交 ====================

const emit = defineEmits(['success'])
const extRef = ref()
const submitForm = async () => {
  if (!formRef.value) return
  const valid = await formRef.value.validate()
  if (!valid) return
  // 🔴 扩展字段是**另一个** form-create 实例，上面那句 validate 管不到它
  if (!(await extRef.value?.validate())) return
  const missing = missingRequiredLabels(attrSchema.value, attrsModel.value)
  if (missing.length) {
    message.error(`还有必填的标的属性没填：${missing.join('、')}`)
    return
  }
  if (missingFileIds.value.length) {
    message.error(`权属证明里有 ${missingFileIds.value.length} 项指向已删除的文件，请先移除再保存`)
    return
  }
  formLoading.value = true
  try {
    const touched = JSON.stringify(attrsModel.value) !== attrsSnapshot.value
    const data: QlzgSubjectSaveVO = {
      ...formData.value,
      // 🔴 没动过就发 null（= 不修改）；动过了才发对象，而对象可能是 {}（= 清空）
      attrs: touched ? buildAttrsPayload(attrSchema.value, attrsModel.value) : null
    }
    if (formType.value === 'create') {
      await QlzgSubjectApi.createSubject(data)
      message.success(t('common.createSuccess'))
    } else {
      await QlzgSubjectApi.updateSubject(data)
      message.success(t('common.updateSuccess'))
    }
    dialogVisible.value = false
    emit('success')
  } finally {
    formLoading.value = false
  }
}

/** 重置表单 */
const resetForm = () => {
  formData.value = emptyForm()
  projectOptions.value = []
  projectLabel.value = ''
  fileOptions.value = []
  missingFileIds.value = []
  clearCategory()
  formRef.value?.resetFields()
}
</script>
<style lang="scss" scoped>
.form-tip {
  width: 100%;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}

.form-tip-inline {
  margin-left: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.unit-hint {
  margin-left: 8px;
  font-size: 13px;
  color: var(--el-text-color-regular);
}

.divider-hint {
  margin-left: 8px;
  font-size: 12px;
  font-weight: normal;
  color: var(--el-text-color-secondary);
}

.option-hint {
  float: right;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
