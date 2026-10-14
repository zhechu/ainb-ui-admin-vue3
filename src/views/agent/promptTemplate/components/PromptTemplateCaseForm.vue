<!--
  提示词模板**用例** 新增/编辑弹窗（S7 / L5）

  用例 = 某条模板**填好之后的完整正文**，用户在聊天面板的「示例」页签点一下就原样进输入框、可以直接发。
  它的价值不在「多一条模板」，而在**示范填法**：业务人员对着 {{字段清单}} 常常写出一句「就是那些字段」，
  于是拿到一句同样含糊的回答，然后断定「这助手不行」。看到一条填得具体的示例，他就知道自己那条该怎么写。

  🔴 这里用弹窗、而模板本身用页内面板，差别是有意的：
     用例是模板的**子项**，编辑时必须看得见「我在给哪条模板加示例」。页内面板会切走整个列表，
     那个上下文就丢了。代价是弹窗里滚正文，故把宽度开到 760px、正文给 12 行，
     并把期望要点/分型/排序/状态压进正文下方一行，避免出现「滚完字段才看见正文」。

  🔴 期望要点 / 期望分型是给**机器验收**用的，不进任何提示词：
     把「合格答案该长什么样」喂给模型，等于把考卷和答案一起发下去。
     所以这两栏在表单里刻意排在正文之后、并明确标注「不会发给模型」。

  🔴 期望分型留空是**有意义的第三态**（两种分型都算对），不是「忘了填」，故下拉第一项就是「留空」。
     分型是一次 temperature=0 的真实模型调用，正压在「问怎么做」与「让你去做」界线上的用例
     换个模型就会翻面；把猜测写成断言，只会得到一条所有人都学会忽略的红测试。

  权限复用 agent:prompt-template:* —— 用例子表就长在「提示词模板」页里，
  能被授到这一页的人天然就该能维护页里的子表。另起一套权限点会让只被授了模板管理的角色
  看见「示例」按钮却点出 403。
-->
<template>
  <el-dialog
    v-model="visible"
    :title="dialogTitle"
    width="760px"
    append-to-body
    :close-on-click-modal="false"
    data-testid="case-form-dialog"
  >
    <el-form ref="formRef" v-loading="formLoading" :model="form" :rules="formRules" label-width="96px">
      <el-form-item label="所属模板">
        <!-- 只读展示：改挂到别的模板等于换一条用例，该用「删掉再建」，不该在这里悄悄改 -->
        <el-input :model-value="templateName" disabled />
      </el-form-item>

      <el-form-item label="标题" prop="title">
        <el-input v-model="form.title" placeholder="如：设备报修单，两级审批" maxlength="128" show-word-limit />
        <div class="form-tip">
          「示例」页签里显示的就是它，短到一行能读完：它的作用是让人在几十条示例里一眼认出「这条像我的场景」。
        </div>
      </el-form-item>

      <el-form-item label="正文" prop="content">
        <div class="w-full">
          <div class="mb-6px text-12px text-[var(--el-text-color-secondary)]">
            识别到
            <b :class="placeholders.length ? '' : 'text-[var(--el-text-color-placeholder)]'">
              {{ placeholders.length }}
            </b>
            处 <code v-pre>{{…}}</code>
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
          <el-input
            v-model="form.content"
            type="textarea"
            :rows="12"
            maxlength="8000"
            show-word-limit
            resize="vertical"
            placeholder="把这条模板填好之后的完整样子，点一下会原样插进聊天输入框"
          />
          <div class="form-tip">
            点一下<b>原样</b>插进输入框：不改写、不补全、不 trim 内部空白。写满真实细节
            （具体表名、具体字段、具体报错原文），而不是又一篇换个说法的骨架。
            正常情况下不该留下未填的 <code v-pre>{{占位符}}</code>；
            但工作流 DSL 的取值表达式本身就长这样（<code v-pre>{{$.input.tableName}}</code>），
            教用户问 DSL 的示例必须能把它写出来，故这里不拦。
          </div>
        </div>
      </el-form-item>

      <el-form-item label="期望要点" prop="expectHint">
        <el-input
          v-model="form.expectHint"
          type="textarea"
          :rows="2"
          maxlength="500"
          show-word-limit
          placeholder="如：要给出发布体检的入口菜单路径，并逐条列出体检发现的问题"
        />
        <div class="form-tip">
          一次合格回答<b>结构上</b>该出现什么，只给管理页和验收脚本看，<b>不会发给模型</b>。
          写可判定的事实（「是否提到 DDL 预览」），别写「回答应当专业、清晰、有条理」——
          后者永远为真，也就永远验不出任何回归。
        </div>
      </el-form-item>

      <el-row :gutter="16">
        <el-col :span="8">
          <el-form-item label="期望分型" prop="expectIntent">
            <el-select v-model="form.expectIntent" placeholder="留空" clearable class="w-full">
              <el-option
                v-for="o in CASE_INTENT_OPTIONS"
                :key="o.value"
                :label="o.label"
                :value="o.value"
              />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="排序" prop="sort">
            <el-input-number v-model="form.sort" :min="0" :max="9999" controls-position="right" class="!w-full" />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="状态" prop="status">
            <el-radio-group v-model="form.status">
              <el-radio :value="0">开启</el-radio>
              <el-radio :value="1">关闭</el-radio>
            </el-radio-group>
          </el-form-item>
        </el-col>
      </el-row>
      <div class="form-tip -mt-8px mb-4px ml-96px">
        期望分型留空 = 这条用例正压在「问怎么做」与「让你去做」的界线上，<b>两种都算对</b>，
        验收时不拿它做断言。关闭 = 不出现在聊天面板，但这里仍可见可改（比删掉再建常用）。
      </div>
    </el-form>

    <template #footer>
      <el-button @click="visible = false">取 消</el-button>
      <el-button type="primary" :loading="formLoading" @click="submitForm" data-testid="case-form-save">
        保 存
      </el-button>
    </template>
  </el-dialog>
</template>

<script lang="ts" setup>
import type { FormInstance, FormRules } from 'element-plus'
import { placeholdersOf } from '@/api/agent/promptTemplate'
import {
  AgentPromptTemplateCaseApi,
  CASE_INTENT_OPTIONS,
  type AgentPromptTemplateCaseSaveVO
} from '@/api/agent/promptTemplateCase'

defineOptions({ name: 'PromptTemplateCaseForm' })

const emit = defineEmits<{ success: [templateId: number] }>()
const message = useMessage()

const visible = ref(false)
const formLoading = ref(false)
const editId = ref<number | undefined>(undefined)
const isEdit = computed(() => editId.value != null)
const dialogTitle = computed(() => (isEdit.value ? '编辑示例' : '新增示例'))

/** 所属模板固定由父页传进来，表单里只读展示 */
const templateId = ref<number>(0)
const templateName = ref('')

const formRef = ref<FormInstance>()

interface CaseForm {
  title: string
  content: string
  expectHint: string
  /** '' = 留空（有意义的第三态），提交时转成 undefined */
  expectIntent: string
  sort: number
  status: number
}

const defaultForm = (): CaseForm => ({
  title: '',
  content: '',
  expectHint: '',
  expectIntent: '',
  sort: 0,
  status: 0
})

const form = ref<CaseForm>(defaultForm())

const formRules = reactive<FormRules>({
  title: [
    { required: true, message: '标题不能为空', trigger: 'blur' },
    { max: 128, message: '标题长度不能超过 128', trigger: 'blur' }
  ],
  content: [
    { required: true, message: '正文不能为空', trigger: 'blur' },
    { max: 8000, message: '正文长度不能超过 8000', trigger: 'blur' }
  ],
  expectHint: [{ max: 500, message: '期望要点长度不能超过 500', trigger: 'blur' }]
})

/** 占位符从正文现算，与聊天面板、模板表单共用 api 里的同一个正则 */
const placeholders = computed(() => placeholdersOf(form.value.content))

/**
 * 打开弹窗
 *
 * @param tpl    所属模板（新增与编辑都要，编辑时用来显示「所属模板」那一栏）
 * @param id     有值=编辑，无值=新增
 * @param sorts  该模板下已有的排序号，用来给新示例算一个不撞车的默认值
 */
const open = async (
  tpl: { id: number; name: string },
  id?: number,
  sorts: number[] = []
) => {
  form.value = defaultForm()
  templateId.value = tpl.id
  templateName.value = tpl.name
  editId.value = id
  visible.value = true
  if (!id) {
    // 新示例排在该模板已有示例之后，留 10 的间隔便于日后插空位
    form.value.sort = sorts.reduce((acc, s) => Math.max(acc, s), 0) + 10
    nextTick(() => formRef.value?.clearValidate())
    return
  }
  formLoading.value = true
  try {
    const vo = await AgentPromptTemplateCaseApi.getCase(id)
    form.value = {
      title: vo.title ?? '',
      content: vo.content ?? '',
      expectHint: vo.expectHint ?? '',
      // 🔴 null / undefined / '' 三种「留空」都要收成 ''，别用 ?? 'CHAT' 之类兜底：
      //    那会把「两种分型都算对」悄悄改成「必须是 CHAT」，验收脚本据此断言就会随机翻红
      expectIntent: vo.expectIntent ?? '',
      sort: vo.sort ?? 0,
      status: vo.status ?? 0
    }
  } finally {
    formLoading.value = false
  }
  nextTick(() => formRef.value?.clearValidate())
}
defineExpose({ open })

const submitForm = async () => {
  if (!formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return
  if (!templateId.value) {
    // 兜底：没有所属模板的用例落库就是孤儿（管理页子表按 templateId 查，永远查不到它）
    message.error('缺少所属模板，请从模板行的「示例」里打开本弹窗')
    return
  }
  formLoading.value = true
  try {
    const payload: AgentPromptTemplateCaseSaveVO = {
      id: editId.value,
      templateId: templateId.value,
      // 🔴 只有标题 trim：正文是要被原样插进输入框再原样发出去的那段话，首尾空行可能是有意的排版
      title: form.value.title.trim(),
      content: form.value.content,
      expectHint: form.value.expectHint?.trim() || undefined,
      expectIntent: form.value.expectIntent?.trim() || undefined,
      sort: form.value.sort ?? 0,
      status: form.value.status ?? 0
    }
    if (isEdit.value) {
      await AgentPromptTemplateCaseApi.updateCase(payload)
      message.success('修改成功')
    } else {
      await AgentPromptTemplateCaseApi.createCase(payload)
      message.success('新增成功，聊天面板「示例」页签立即可用')
    }
    visible.value = false
    emit('success', templateId.value)
  } finally {
    formLoading.value = false
  }
}
</script>

<style lang="scss" scoped>
.form-tip {
  width: 100%;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}
</style>
