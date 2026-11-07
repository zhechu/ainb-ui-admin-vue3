<template>
  <Dialog v-model="dialogVisible" :title="dialogTitle" width="860">
    <el-alert
      v-if="platform"
      type="warning"
      :closable="false"
      show-icon
      title="这是平台公共话术，正文与审核状态都改不了"
      description="平台话术对所有机构生效，改它会影响别人。请到台账上点「复制为机构话术」，复制出来的那一份归本机构，可以随便改，但要走本机构自己的审核。"
      class="mb-15px"
    />

    <el-alert
      v-if="wasApproved"
      type="warning"
      :closable="false"
      show-icon
      title="这一条已经审核通过了，保存之后会打回草稿"
      description="改任何东西都会复位审核状态——不只是正文：改触发条件、基础分、条款号、名称、归属章节都一样。理由是一条被批准为「只在划拨土地时出现」的话术，改成无条件触发之后会出现在它从没被审过的语境里。打回草稿意味着它暂时从作业台的候选清单里消失，要重新点一次「审核通过」。"
      class="mb-15px"
    />

    <el-form
      ref="formRef"
      v-loading="formLoading"
      :model="formData"
      :rules="formRules"
      label-width="112px"
    >
      <el-form-item label="话术名称" prop="phraseName">
        <el-input
          v-model="formData.phraseName"
          placeholder="如 划拨土地使用权限制"
          maxlength="255"
          show-word-limit
        />
        <div class="form-hint">
          它是作业台候选清单里唯一能被扫读的东西（正文要点开才看得见）。
          写「划拨土地使用权限制」而不是「话术 3」——后者会让评估师把四十条都点开读一遍。
        </div>
      </el-form-item>

      <el-form-item label="适用品类" prop="categoryCode">
        <el-select
          v-model="formData.categoryCode"
          placeholder="留空 = 通用品类"
          clearable
          class="w-full"
          :disabled="formLoading"
          @change="onCategoryChange"
        >
          <el-option
            v-for="item in categoryList"
            :key="item.categoryCode"
            :label="item.categoryName"
            :value="item.categoryCode"
          />
        </el-select>
        <div class="form-hint">
          留空 = 通用品类，这一条会在<b>每一个</b>品类的候选清单里都出现。
          填一个不存在的码不会报错，但它也就永远不会出现在任何一节里。
        </div>
      </el-form-item>

      <el-form-item label="挂在章节" prop="sectionCode">
        <el-select
          v-model="formData.sectionCode"
          :placeholder="schemaCategoryCode ? '留空 = 不限章节' : '先选品类'"
          clearable
          filterable
          class="w-full"
          :loading="sectionLoading"
          :disabled="!schemaCategoryCode || formLoading"
        >
          <el-option
            v-for="item in sectionList"
            :key="item.code"
            :label="`${sectionIndent(item)}${item.title}（${item.code}）`"
            :value="item.code"
          />
        </el-select>
        <div v-if="!formData.categoryCode && schemaCategoryCode" class="form-hint">
          品类留空时，这里列的是<b>法定默认品类</b>那一棵章节树——
          一条通用话术要在每个品类里都讲得通，所以按最小公共集校验。
          挂在别的品类才有的章节上，保存会被拒。
        </div>
        <div v-else class="form-hint">
          留空 = 不限章节（通用话术）。作业台的候选清单<b>按当前光标所在的那一节</b>取，
          所以挂错章节的后果是「这一条在它该出现的那一节里不出现」。
        </div>
      </el-form-item>

      <el-form-item label="准则条款" prop="clauseRef">
        <el-input
          v-model="formData.clauseRef"
          placeholder="如 〔2018〕35 号 第二十条"
          maxlength="64"
        />
        <div class="form-hint">
          弱引用，不校验存在性——它只是给人看的一句出处。
          真外键要等准则与监管那一层落地之后才换。
        </div>
      </el-form-item>

      <el-form-item label="基础排序分" prop="scoreBase">
        <el-input-number
          v-model="formData.scoreBase"
          :min="0"
          :precision="0"
          :step="1"
          controls-position="right"
          class="!w-180px"
        />
        <div class="form-hint">
          打分公式里<b>唯一由人给</b>的一项，留空按 0 处理。
          它没有上界，所以一条基础分给到 100 的话术会压过所有条件命中与本机构复用次数——
          想让它恒排第一就是这么用，但那等于关掉了排序。
        </div>
      </el-form-item>

      <el-form-item label="话术正文" prop="content">
        <el-input
          v-model="formData.content"
          type="textarea"
          :rows="10"
          maxlength="20000"
          show-word-limit
          placeholder="本次评估对象为坐落于{location}的房地产，建筑面积 {building_area} 平方米。"
        />
        <!--
          🔴 v-pre 不是随手加的：这一段小字里要**原样印出**双花括号，
             而 Vue 的模板编译器会把它当成一个插值表达式去求值 ——
             写 {{'{'}} 这类绕法能过，但下一个人读到时会以为那是个有含义的表达式。
             v-pre 让整棵子树跳过编译，字面量就是字面量
        -->
        <div class="form-hint">
          取值的写法是<b>单花括号</b> <code v-pre>{field_key}</code>
          ，插入报告时按当前标的替换。取不到值是<b>硬失败</b>，不会留个空格——
          一处被静默清空的空格在法定报告里读起来像「这一项本来就没有」。
        </div>
        <div class="form-hint">
          <b>不要写双花括号。</b>从模板 docx 里复制一段带
          <code v-pre>{{building_area}}</code>
          的文字进来是最常见的错误：话术正文是<b>值</b>不是模板，poi-tl 不会再扫它一遍，
          最终报告上印的就是字面量。服务端会拒收，但那一屏就白填了。
        </div>
      </el-form-item>

      <el-form-item v-if="placeholders.length > 0" label="正文里的占位符">
        <el-tag
          v-for="item in placeholders"
          :key="item"
          type="info"
          size="small"
          class="mr-5px mb-5px"
        >
          {{ item }}
        </el-tag>
        <div class="form-hint">
          这一份是<b>保存时后端从正文里解析出来的</b>，改完正文要保存之后才会更新。
          前端不自己扫——两遍扫描的结果不一致时，以库里那一列为准。
        </div>
      </el-form-item>

      <el-form-item label="触发条件">
        <div class="trigger-block">
          <div v-if="unknownTriggerKeys.length > 0" class="trigger-warning">
            有 {{ unknownTriggerKeys.length }} 个键不在当前品类的可触发属性里：
            {{ unknownTriggerKeys.join('、') }}。
            这样的条件<b>恒不命中</b>，而「恒不命中」不会有任何提示——
            话术还在库里、这一页还看得见，但它永远排不到前面。
          </div>

          <div v-for="(row, idx) in triggerRows" :key="idx" class="trigger-row">
            <el-select
              v-model="row.key"
              placeholder="选一个标的属性"
              filterable
              class="trigger-key"
              :disabled="formLoading"
            >
              <el-option
                v-for="opt in triggerKeyOptions"
                :key="opt.key"
                :label="`${opt.label}（${opt.key}）`"
                :value="opt.key"
              />
            </el-select>
            <span class="trigger-eq">等于</span>

            <el-select
              v-if="valueOptionsOf(row.key).length > 0"
              v-model="row.text"
              placeholder="选一个值"
              filterable
              allow-create
              class="trigger-value"
              :disabled="formLoading"
            >
              <el-option v-for="opt in valueOptionsOf(row.key)" :key="opt" :label="opt" :value="opt" />
            </el-select>
            <el-date-picker
              v-else-if="typeOf(row.key) === 'DATE'"
              v-model="row.text"
              type="date"
              value-format="YYYY-MM-DD"
              placeholder="选一个日期"
              class="trigger-value"
              :disabled="formLoading"
            />
            <el-input
              v-else
              v-model="row.text"
              placeholder="值"
              class="trigger-value"
              :disabled="formLoading"
            />

            <el-button link type="danger" :disabled="formLoading" @click="removeTrigger(idx)">
              删掉
            </el-button>
          </div>

          <el-button
            link
            type="primary"
            :disabled="!schemaCategoryCode || formLoading"
            @click="addTrigger"
          >
            加一条条件
          </el-button>
          <div class="form-hint">
            语义是「<b>全部相等才命中</b>」——三条条件就是三个都要满足。
            不支持运算符、区间、或关系，那是复核规则 expr 的活儿。
            一条条件都不加 = 无条件话术，恒命中，但也拿不到命中加分。
          </div>
          <div v-if="!schemaCategoryCode" class="form-hint">
            触发条件只能绑在<b>进了标的索引投影</b>的属性上，而那份清单来自品类的
            param_schema。库里一个品类都没有时这一格用不了。
          </div>
        </div>
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button :disabled="formLoading || platform" type="primary" @click="submitForm">
        确 定
      </el-button>
      <el-button @click="dialogVisible = false">取 消</el-button>
    </template>
  </Dialog>
</template>
<script lang="ts" setup>
import {
  QlzgCategoryApi,
  phraseTriggerKeyOptionsOf,
  type QlzgCategorySectionVO,
  type QlzgCategorySimpleVO,
  type QlzgCategoryVO
} from '@/api/qlzg/category'
import { QlzgPhraseApi, type QlzgPhraseSaveVO } from '@/api/qlzg/phrase'

/**
 * 新建 / 修改一条话术
 *
 * <h3>🔴 建好之后它<b>不会</b>出现在作业台的候选清单里</h3>
 * 候选清单有一条 SQL 闸：只返回 {@code review_status = APPROVED} 的行。
 * 新建的是 DRAFT，所以保存成功的那一句必须把「还要审核」说出来 ——
 * 只说「保存成功」的话，评估师回到作业台看见右栏还是空的，
 * 会以为话术库坏了（而平台的 56 条种子目前也全是 DRAFT，同一件事）。
 *
 * <h3>🔴 触发条件的键**只**给品类 {@code param_schema} 里 {@code indexed=true} 的那些</h3>
 * 这是后端 {@code indexedAttrKeys} 的同一份判据。写错键的后果是<b>恒不命中且不报错</b> ——
 * 话术还在库里、这一页还看得见，但永远排不到前面，而没有任何一处会说出来。
 * 所以这里既不给「允许手输」，也要把已存的越界键<b>显示出来</b>并标红
 * （{@link unknownTriggerKeys}）：不显示的话 el-select 会渲染成空白，
 * 评估师会以为那条条件没了，于是重新加一条，库里就多了一条重复的。
 *
 * <h3>🔴 值那一格保留原样类型，不一律转成字符串</h3>
 * 打分时两边都会先 normalize 成文本再比（数值还额外按值比），
 * 所以 {@code 1998} 与 {@code "1998"} 命中结果相同。
 * 但「保存一次话术，{@code trigger_expr} 里 {@code built_year=1998}（数值）变成
 * {@code built_year="1998"}（字符串）」是一处<b>没人要求</b>的改动，
 * 而它会让这一列的 json 形状取决于「最后一次是谁在界面上点的保存」。
 *
 * <h3>⚠️ 这里**不校验**正文里的花括号</h3>
 * 服务端的判据不只是「含 {@code {{}}」：花括号层数不对称（{@code {abc}}}、{@code {{abc}}）
 * 同样拒收，而 {@code {{abc}} 是「朴素 replace 吃掉一半定界符」之后留下的形状。
 * 在前端抄一份判据就是第二份真相，漂开之后表现为「界面说没问题、保存被拒」。
 * 这里只把规则**写给人看**（正文下面那两行小字），判定留给后端。
 */
defineOptions({ name: 'QlzgPhraseForm' })

interface TriggerRow {
  key: string
  /** 输入框里显示的文本 */
  text: string
  /** 🔴 从后端读回来的**原值**，用来在没改过时原样发回去 */
  raw: any
}

const message = useMessage()
const emit = defineEmits(['success'])

const dialogVisible = ref(false)
const formLoading = ref(false)
const sectionLoading = ref(false)
const editingId = ref<number | null>(null)
const platform = ref(false)
const placeholders = ref<string[]>([])
/** 打开时那一行的审核状态。🔴 只用来给「保存会打回草稿」那条警示判真假，不参与提交 */
const reviewStatus = ref<string | null>(null)

const categoryList = ref<QlzgCategorySimpleVO[]>([])
const categoryDetail = ref<QlzgCategoryVO | null>(null)
const sectionList = ref<QlzgCategorySectionVO[]>([])
const triggerRows = ref<TriggerRow[]>([])

const formRef = ref()
const formData = ref({
  phraseName: '',
  categoryCode: '',
  sectionCode: '',
  content: '',
  clauseRef: '',
  scoreBase: undefined as number | undefined
})

const formRules = {
  phraseName: [{ required: true, message: '话术名称不能为空', trigger: 'blur' }],
  content: [{ required: true, message: '话术正文不能为空', trigger: 'blur' }]
}

const dialogTitle = computed(() => (editingId.value ? '修改话术' : '新建话术'))

/**
 * 打开时这一条是**已通过**的 —— 保存会把它打回草稿
 *
 * 🔴 后端 {@code updatePhrase} 是**无条件**复位审核状态的，不是「改了正文才复位」：
 *    名称、条款号、基础分、触发条件、品类、章节，改哪一项都一样。
 *    所以这条警示要在<b>点保存之前</b>就在，而不是保存之后才在成功提示里说一句 ——
 *    评估师改一个错别字，顺手点保存，然后这一条话术从他正在写的报告的候选清单里消失了，
 *    而他会以为是作业台坏了。
 */
const wasApproved = computed(() => !!editingId.value && reviewStatus.value === 'APPROVED')

/**
 * 🔴 品类留空时退回**法定默认品类**，与后端 {@code resolveSchemaCategoryCode} 同一条口径
 *
 * 连它都取不到（库里一个品类都没有）就返回空串，此时章节下拉与触发条件都禁用 ——
 * 后端那时也是<b>跳过</b>校验的（机构刚开通、连品类都没配，拦住他建话术没有意义）。
 */
const schemaCategoryCode = computed(
  () =>
    formData.value.categoryCode ||
    categoryList.value.find((item) => item.isStatutoryDefault === true)?.categoryCode ||
    ''
)

const triggerKeyOptions = computed(() => {
  const base = phraseTriggerKeyOptionsOf(categoryDetail.value)
  const known = new Set(base.map((item) => item.key))
  const extra = triggerRows.value
    .map((row) => row.key?.trim())
    .filter((key): key is string => !!key && !known.has(key))
  return [
    ...base,
    ...[...new Set(extra)].map((key) => ({
      key,
      label: `${key} 不在本品类的可触发属性里`,
      type: 'STRING',
      options: [] as string[]
    }))
  ]
})

/**
 * 越界的触发键
 *
 * 🔴 品类详情**没拉到**时返回空表，不返回「全部越界」：
 *    那时 `known` 是空集，判据会把每一条都算成越界，
 *    于是一个失败的网络请求会显示成「你填的条件全是错的」——
 *    而那句红字的措辞很重（「恒不命中」），评估师会照着它把好条件删掉。
 *    拿不到清单就什么都不说，让他自己看下拉里有没有候选。
 */
const unknownTriggerKeys = computed(() => {
  if (!categoryDetail.value) return []
  const known = new Set(phraseTriggerKeyOptionsOf(categoryDetail.value).map((item) => item.key))
  const keys = triggerRows.value.map((row) => row.key?.trim() ?? '')
  return [...new Set(keys)].filter((key) => key !== '' && !known.has(key))
})

const optionOf = (key: string) => triggerKeyOptions.value.find((item) => item.key === key)
const typeOf = (key: string) => optionOf(key)?.type ?? 'STRING'
const valueOptionsOf = (key: string) => optionOf(key)?.options ?? []

/** 层级用全角空格缩进：半角空格在 el-option 里会被折叠掉 */
const sectionIndent = (item: QlzgCategorySectionVO) =>
  '　'.repeat(Math.max(0, (item.level ?? 1) - 1))

const loadCategories = async () => {
  if (categoryList.value.length > 0) return
  try {
    categoryList.value = (await QlzgCategoryApi.getSimpleList()) ?? []
  } catch {
    categoryList.value = []
  }
}

/**
 * 拉当前 schema 品类的详情与章节树
 *
 * 🔴 两个请求各自失败得起：详情挂了只是触发条件的下拉没候选，
 *    章节树挂了只是章节下拉没候选，而这两个字段**都可以留空**，
 *    所以任一失败都不该把整个表单变成打不开
 */
const loadSchema = async () => {
  const code = schemaCategoryCode.value
  if (!code) {
    categoryDetail.value = null
    sectionList.value = []
    return
  }
  sectionLoading.value = true
  try {
    const [detail, secs] = await Promise.allSettled([
      QlzgCategoryApi.getCategory(code),
      QlzgCategoryApi.getSectionList(code)
    ])
    categoryDetail.value = detail.status === 'fulfilled' ? detail.value : null
    sectionList.value = secs.status === 'fulfilled' ? secs.value ?? [] : []
  } finally {
    sectionLoading.value = false
  }
}

const onCategoryChange = async () => {
  await loadSchema()
  // 🔴 换品类之后原来的章节码大概率不在新树里，而它**不会**自己清空。
  //    留着提交，后端报 PHRASE_SECTION_UNKNOWN 并指名那一节 ——
  //    报错看得懂，但评估师看不出是「刚才换了品类」造成的，会去改话术名字
  const stillThere = sectionList.value.some((item) => item.code === formData.value.sectionCode)
  if (formData.value.sectionCode && !stillThere) {
    formData.value.sectionCode = ''
  }
  // 触发条件的键**不**清空：那会静默删掉用户填的东西。
  // 越界的键由 unknownTriggerKeys 标红，让他自己决定改还是删
}

const addTrigger = () => triggerRows.value.push({ key: '', text: '', raw: null })
const removeTrigger = (idx: number) => triggerRows.value.splice(idx, 1)

const open = async (id?: number) => {
  dialogVisible.value = true
  formLoading.value = true
  editingId.value = null
  platform.value = false
  placeholders.value = []
  reviewStatus.value = null
  triggerRows.value = []
  categoryDetail.value = null
  sectionList.value = []
  formData.value = {
    phraseName: '',
    categoryCode: '',
    sectionCode: '',
    content: '',
    clauseRef: '',
    scoreBase: undefined
  }
  try {
    await loadCategories()
    if (!id) {
      await loadSchema()
      return
    }
    const detail = await QlzgPhraseApi.getPhrase(id)
    editingId.value = detail?.id ?? id
    platform.value = detail?.platform === true
    placeholders.value = detail?.placeholders ?? []
    reviewStatus.value = detail?.reviewStatus ?? null
    formData.value = {
      phraseName: detail?.phraseName ?? '',
      categoryCode: detail?.categoryCode ?? '',
      sectionCode: detail?.sectionCode ?? '',
      content: detail?.content ?? '',
      clauseRef: detail?.clauseRef ?? '',
      scoreBase: detail?.scoreBase ?? undefined
    }
    triggerRows.value = Object.entries(detail?.triggerExpr ?? {}).map(([key, value]) => ({
      key,
      text: value === null || value === undefined ? '' : String(value),
      raw: value
    }))
    await loadSchema()
  } finally {
    formLoading.value = false
  }
}
defineExpose({ open })

/**
 * 拼 {@code trigger_expr}
 *
 * 🔴 一行都没填时返回 **null** 而不是 {@code {}}：后端把两者归一成同一个空表，
 *    但发一个 {@code {}} 过去会让「这个人动过触发条件」在日志里看起来成立
 */
const buildTriggerExpr = (): Record<string, any> | null => {
  const out: Record<string, any> = {}
  let filled = false
  for (const row of triggerRows.value) {
    const key = row.key?.trim()
    if (!key) continue
    const text = (row.text ?? '').trim()
    // 没改过值就把原样类型发回去，见类注释「值那一格保留原样类型」
    out[key] = String(row.raw ?? '') === text ? row.raw : text
    filled = true
  }
  return filled ? out : null
}

const submitForm = async () => {
  if (platform.value) {
    message.error('平台公共话术不能改，请到台账上复制一份成机构自有的再改')
    return
  }
  await formRef.value?.validate()
  // 🔴 半填的行必须在**发出去之前**拦住：后端对空值不报错
  //    （normalize 之后是 null，valueEquals 恒假），于是这一条条件被静默存成「恒不命中」
  const halfFilled = triggerRows.value.some(
    (row) => !!row.key?.trim() !== !!(row.text ?? '').trim()
  )
  if (halfFilled) {
    message.error('触发条件里有半填的行：键与值要么都填，要么把整行删掉')
    return
  }
  const payload: QlzgPhraseSaveVO = {
    id: editingId.value ?? undefined,
    phraseName: formData.value.phraseName.trim(),
    categoryCode: formData.value.categoryCode || null,
    sectionCode: formData.value.sectionCode || null,
    content: formData.value.content,
    clauseRef: formData.value.clauseRef.trim() || null,
    triggerExpr: buildTriggerExpr(),
    scoreBase: formData.value.scoreBase ?? null
  }
  formLoading.value = true
  try {
    if (editingId.value) {
      await QlzgPhraseApi.updatePhrase(payload)
      // 🔴 这一句必须说「打回草稿」，不能只说「修改成功」：
      //    后端是无条件复位审核状态的，而复位之后这一条就从作业台的候选清单里消失了
      message.success(
        wasApproved.value
          ? '修改成功，审核状态已打回草稿。要重新点一次「审核通过」，它才会再出现在作业台的候选清单里'
          : '修改成功'
      )
    } else {
      await QlzgPhraseApi.createPhrase(payload)
      message.success('话术已建好。它是草稿，要在台账上点「审核通过」之后才会出现在作业台的候选清单里')
    }
    dialogVisible.value = false
    emit('success')
  } finally {
    formLoading.value = false
  }
}
</script>
<style lang="scss" scoped>
.form-hint {
  width: 100%;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}

.trigger-block {
  width: 100%;
}

.trigger-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}

.trigger-key {
  width: 260px;
}

.trigger-eq {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.trigger-value {
  flex: 1;
}

.trigger-warning {
  padding: 6px 10px;
  margin-bottom: 8px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-color-danger);
  background: var(--el-color-danger-light-9);
  border-radius: 4px;
}
</style>
