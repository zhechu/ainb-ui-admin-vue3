<!--
  提示词模板 新增/编辑/查看面板（需求7）

  🔴 页内面板而非弹窗，与工具管理页保持同一形状：正文是多行文本，弹窗里既要滚正文又要滚字段，
     管理员看不见「上面填了什么」，这正是低代码子系统「配了但配错且不自知」的温床。

  🔴 右侧那块「聊天面板里的样子」不是装饰。模板的唯一用途就是在助手里被点一下插进输入框，
     管理员写的时候看到的却是表单里的裸文本——名称过长会不会被截、说明写不写得下、
     占位符够不够显眼，都得存了再去聊天页试一遍才知道。就地预览把这轮往返省掉。

  🔴 占位符只从正文现算（placeholdersOf），没有独立的 variables 字段：
     存一份派生数据就会与正文分叉，表现为「提示要填 3 个、正文里只有 2 个」。
-->
<template>
  <ContentWrap>
    <div class="panel-header mb-15px flex items-center justify-between">
      <div class="flex items-center">
        <el-button link @click="handleCancel">
          <Icon icon="ep:arrow-left" class="mr-5px" /> 返回
        </el-button>
        <span class="panel-title ml-8px">{{ panelTitle }}</span>
        <el-tag v-if="isView" type="info" size="small" class="ml-8px">只读</el-tag>
      </div>
      <div v-if="!isView" class="flex items-center">
        <el-button @click="handleCancel">取 消</el-button>
        <el-button type="primary" :loading="formLoading" @click="submitForm">保 存</el-button>
      </div>
    </div>

    <el-row :gutter="20">
      <!-- ==================== 左：表单 ==================== -->
      <el-col :xs="24" :lg="15">
        <el-form
          ref="formRef"
          v-loading="formLoading"
          :model="form"
          :rules="formRules"
          :disabled="isView"
          label-width="96px"
        >
          <el-form-item label="模板名称" prop="name">
            <el-input v-model="form.name" placeholder="如：为什么配了不生效" maxlength="128" show-word-limit />
            <div class="form-tip">聊天面板里按钮上显示的就是它，短一点更好认。</div>
          </el-form-item>

          <el-row :gutter="16">
            <el-col :span="12">
              <el-form-item label="分类" prop="category">
                <el-select
                  v-model="form.category"
                  placeholder="选择或直接输入新分类"
                  clearable
                  filterable
                  allow-create
                  default-first-option
                  class="w-full"
                >
                  <el-option v-for="c in categoryOptions" :key="c" :label="c" :value="c" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="排序" prop="sort">
                <el-input-number v-model="form.sort" :min="0" :max="9999" controls-position="right" class="!w-full" />
              </el-form-item>
            </el-col>
          </el-row>
          <div class="form-tip -mt-8px mb-16px ml-96px">
            聊天面板按分类分栏：同分类内排序小的在前，分类之间则按「该分类里最小的排序号」排先后
            ——想让整个分类靠前，就把它某条模板的排序号改小。留空分类归入「{{ UNCATEGORIZED }}」并排最后。
          </div>

          <el-form-item label="状态" prop="status">
            <el-radio-group v-model="form.status">
              <el-radio :value="0">开启</el-radio>
              <el-radio :value="1">关闭</el-radio>
            </el-radio-group>
            <div class="form-tip">关闭后不出现在聊天面板，但仍在列表里可见可改——比删掉再重建常用。</div>
          </el-form-item>

          <el-form-item label="用途说明" prop="description">
            <el-input
              v-model="form.description"
              type="textarea"
              :rows="2"
              maxlength="500"
              show-word-limit
              placeholder="什么时候该用这条模板（只在管理页与聊天面板的悬浮提示里出现，不会发给模型）"
            />
          </el-form-item>

          <el-form-item label="模板正文" prop="content">
            <div class="w-full">
              <div class="mb-6px flex items-center justify-between">
                <div class="text-12px text-[var(--el-text-color-secondary)]">
                  识别到
                  <b :class="placeholders.length ? '' : 'text-[var(--el-text-color-placeholder)]'">
                    {{ placeholders.length }}
                  </b>
                  处占位符
                  <el-tag
                    v-for="p in placeholders"
                    :key="p"
                    size="small"
                    type="warning"
                    effect="plain"
                    class="ml-6px"
                  >
                    {{ p }}
                  </el-tag>
                </div>
                <el-button v-if="!isView" link type="primary" size="small" @click="insertPlaceholder">
                  <Icon icon="ep:plus" class="mr-2px" /> 在光标处插入占位符
                </el-button>
              </div>
              <el-input
                ref="contentRef"
                v-model="form.content"
                type="textarea"
                :rows="14"
                maxlength="8000"
                show-word-limit
                resize="vertical"
                placeholder="请查询{{业务对象}}中满足{{筛选条件}}的记录……"
              />
            </div>
          </el-form-item>
        </el-form>
      </el-col>

      <!-- ==================== 右：聊天面板里的样子 ==================== -->
      <el-col :xs="24" :lg="9">
        <div class="preview-card">
          <div class="preview-title">聊天面板里的样子</div>
          <div class="preview-hint">用户在助手里看到的就是这一条，点它把正文插入输入框。</div>

          <div class="preview-item">
            <div class="preview-item-head">
              <span class="preview-name">{{ form.name || '（未命名模板）' }}</span>
              <el-tag size="small" type="info" effect="plain">{{ form.category || UNCATEGORIZED }}</el-tag>
            </div>
            <div v-if="form.description" class="preview-desc">{{ form.description }}</div>
            <div class="preview-content">
              <template v-for="(seg, i) in previewSegments" :key="i">
                <mark v-if="seg.ph" class="preview-ph">{{ seg.text }}</mark>
                <span v-else>{{ seg.text }}</span>
              </template>
              <span v-if="!form.content" class="text-[var(--el-text-color-placeholder)]">（正文为空）</span>
            </div>
          </div>

          <el-alert
            v-if="form.status === 1"
            type="warning"
            :closable="false"
            show-icon
            class="mt-12px"
            title="当前是关闭状态，聊天面板里不会出现这条模板"
          />
        </div>
      </el-col>
    </el-row>

    <!--
      🔴 说明放在表单最下面：它是「读一遍就懂」的背景知识，不是填表前必须先读的前置条件。
         摆在最上面会把真正要填的字段挤到首屏之下，管理员每次进来都得先跳过一大段文字才看见「模板名称」。
         填表时右边那块「聊天面板里的样子」已经把最要紧的效果就地演示了，这段文字沦为补充说明。
    -->
    <el-alert type="info" :closable="false" show-icon class="mt-16px">
      <template #title>
        <span class="text-12px">
          模板是聊天面板的<b>提问起手式</b>：用户点一下，正文就插入到输入框，他可以改完再发送。
          它<b>不会</b>进系统提示词，也不影响工具调用与权限，所以这里不需要声明风险等级。
          正文里用 <code v-pre>{{占位符}}</code> 标记要用户替换的位置。
        </span>
      </template>
    </el-alert>
  </ContentWrap>
</template>

<script lang="ts" setup>
import type { FormInstance, FormRules } from 'element-plus'
import {
  AgentPromptTemplateApi,
  placeholdersOf,
  UNCATEGORIZED,
  type AgentPromptTemplateSaveVO
} from '@/api/agent/promptTemplate'

defineOptions({ name: 'PromptTemplateForm' })

const emit = defineEmits<{ success: [isCreate: boolean]; cancel: [] }>()
const message = useMessage()

const formLoading = ref(false)
const mode = ref<'create' | 'edit' | 'view'>('create')
const isView = computed(() => mode.value === 'view')
const isEdit = computed(() => mode.value === 'edit')
const panelTitle = computed(() =>
  mode.value === 'create' ? '新增模板' : mode.value === 'edit' ? '编辑模板' : '查看模板'
)

const formRef = ref<FormInstance>()
const contentRef = ref()
const editId = ref<number | undefined>(undefined)
const categoryOptions = ref<string[]>([])
/**
 * 当前列表已有的排序号，由父页在打开面板前塞进来，只用于给新模板算一个不撞车的默认排序。
 * 🔴 不在这里自己再拉一次分页：父页已经有这份数据，重复请求还会与父页的筛选条件不一致。
 */
const knownSorts = ref<number[]>([])
const setKnownSorts = (sorts: number[]) => {
  knownSorts.value = sorts ?? []
}
/** 新模板默认排在最后一条之后，留 10 的间隔便于日后插空位 */
const nextSort = () => knownSorts.value.reduce((acc, s) => Math.max(acc, s), 0) + 10

interface TemplateForm {
  name: string
  content: string
  category: string
  description: string
  sort: number
  status: number
}

const defaultForm = (): TemplateForm => ({
  name: '',
  content: '',
  category: '',
  description: '',
  sort: 0,
  status: 0
})

const form = ref<TemplateForm>(defaultForm())

const formRules = reactive<FormRules>({
  name: [
    { required: true, message: '模板名称不能为空', trigger: 'blur' },
    { max: 128, message: '模板名称长度不能超过 128', trigger: 'blur' }
  ],
  content: [
    { required: true, message: '模板正文不能为空', trigger: 'blur' },
    { max: 8000, message: '模板正文长度不能超过 8000', trigger: 'blur' }
  ]
})

/** 占位符与预览分段都从正文现算，与聊天面板共用 api 里的同一个正则 */
const placeholders = computed(() => placeholdersOf(form.value.content))

const previewSegments = computed(() => {
  const text = form.value.content ?? ''
  const parts: { text: string; ph: boolean }[] = []
  const re = /{{\s*[^{}]+?\s*}}/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index), ph: false })
    parts.push({ text: m[0], ph: true })
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last), ph: false })
  return parts
})

/**
 * 在光标处插入一对空花括号并把光标停在中间
 *
 * 🔴 拿不到 textarea（比如只读态或组件还没挂载）就退化成追加到末尾——总比点了没反应好。
 */
const insertPlaceholder = () => {
  const token = '{{}}'
  const el = contentRef.value?.textarea as HTMLTextAreaElement | undefined
  if (!el) {
    form.value.content += token
    return
  }
  const start = el.selectionStart ?? form.value.content.length
  const end = el.selectionEnd ?? start
  form.value.content =
    form.value.content.slice(0, start) + token + form.value.content.slice(end)
  nextTick(() => {
    el.focus()
    const pos = start + 2
    el.setSelectionRange(pos, pos)
  })
}

const loadCategories = async () => {
  try {
    categoryOptions.value = (await AgentPromptTemplateApi.getCategoryList()) ?? []
  } catch {
    // 取不到只是少一份下拉候选（仍可 allow-create 手输），不值得弹错打断填表
    categoryOptions.value = []
  }
}

/** 打开面板：无 id=新建；有 id 拉详情 */
const open = async (id?: number, m?: 'view' | 'edit') => {
  form.value = defaultForm()
  editId.value = id
  await loadCategories()
  if (!id) {
    mode.value = 'create'
    // 新建时排在最后一条之后，省得管理员自己想一个不撞车的序号
    form.value.sort = nextSort()
    nextTick(() => formRef.value?.clearValidate())
    return
  }
  mode.value = m === 'view' ? 'view' : 'edit'
  formLoading.value = true
  try {
    const vo = await AgentPromptTemplateApi.getPromptTemplate(id)
    form.value = {
      name: vo.name ?? '',
      content: vo.content ?? '',
      category: vo.category ?? '',
      description: vo.description ?? '',
      sort: vo.sort ?? 0,
      status: vo.status ?? 0
    }
    // 编辑时若该分类已不在候选里（比如别人把同类模板都删了），补一条，否则下拉显示成空白
    if (form.value.category && !categoryOptions.value.includes(form.value.category)) {
      categoryOptions.value = [...categoryOptions.value, form.value.category]
    }
  } finally {
    formLoading.value = false
  }
  nextTick(() => formRef.value?.clearValidate())
}
defineExpose({ open, setKnownSorts })

const handleCancel = () => emit('cancel')

const submitForm = async () => {
  if (!formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return
  formLoading.value = true
  try {
    const payload: AgentPromptTemplateSaveVO = {
      id: editId.value,
      name: form.value.name.trim(),
      content: form.value.content,
      category: form.value.category?.trim() || undefined,
      description: form.value.description?.trim() || undefined,
      sort: form.value.sort ?? 0,
      status: form.value.status ?? 0
    }
    if (isEdit.value && editId.value) {
      await AgentPromptTemplateApi.updatePromptTemplate(payload)
      message.success('修改成功')
      emit('success', false)
    } else {
      await AgentPromptTemplateApi.createPromptTemplate(payload)
      message.success('新增成功，聊天面板立即可用')
      // 🔴 告诉列表页这是新增：新模板的排序号是「全表最大 + 10」，在 sort 升序的列表里必然垫底，
      //    列表页要据此跳到最后一页，否则管理员存完在第 1 页什么都看不见。
      emit('success', true)
    }
  } finally {
    formLoading.value = false
  }
}
</script>

<style lang="scss" scoped>
.panel-header {
  padding-bottom: 12px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.panel-title {
  font-size: 16px;
  font-weight: 600;
}

.form-tip {
  width: 100%;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}

.preview-card {
  padding: 14px;
  background: var(--el-fill-color-lighter);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
}

.preview-title {
  font-size: 13px;
  font-weight: 600;
}

.preview-hint {
  margin-bottom: 12px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.preview-item {
  padding: 10px 12px;
  cursor: default;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
}

.preview-item-head {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
}

.preview-name {
  overflow: hidden;
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-desc {
  margin-top: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.preview-content {
  padding: 8px;
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-regular);
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--el-fill-color-light);
  border-radius: 4px;
}

.preview-ph {
  padding: 0 2px;
  color: var(--el-color-warning);
  background: var(--el-color-warning-light-9);
  border-radius: 2px;
}
</style>
