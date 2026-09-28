<!--
  流程编排设计器（整页）—— AI助手 UX 修复 / 问题3 + 问题4

  仿门户设计器（InfraPortalEditor）的隐藏路由整页编辑：/agent-workflow/editor?id=xxx。
  替代旧「900px 表单弹窗套 1200px 可视化弹窗」：URL 可刷新可分享、浏览器后退回列表、编辑空间充足。

  - 无 id → 新建态：DEFAULT_DSL 最小骨架，code 可编辑；保存走 createDef，成功后 router.replace 带上 id
    （防刷新重复新建）。
  - 有 id → 编辑态：getDef 回填；非 DRAFT 只读 + 提示（后端 updateDef 也只对草稿生效）。
  - 顶栏：返回（未保存改动 confirm）/ 名称与编码就地编辑 / 状态 tag / 校验 / 保存草稿 / 保存并发布。
  - 基本信息（描述/备注）折叠区 + 主体内嵌 WorkflowEditorCanvas（DSL JSON 兜底在画布组件底部）。
  - 保存软门禁与旧 WorkflowDefFormDialog.handleSubmit 一致：先跑后端双层校验，有阻断错误时二次确认仍可存草稿。
-->
<template>
  <div class="workflow-editor-page" v-loading="loading">
    <!-- 顶栏 -->
    <header class="editor-header flex items-center gap-10px px-16px py-10px">
      <el-button circle title="返回列表" @click="handleBack">
        <Icon icon="ep:arrow-left" />
      </el-button>
      <div class="flex items-center gap-8px flex-1 min-w-0">
        <el-input
          v-model="formData.name"
          class="!w-220px"
          placeholder="流程名称"
          :disabled="readonly"
          @input="markDirty"
        />
        <el-input
          v-model="formData.code"
          class="!w-200px"
          placeholder="流程编码"
          :disabled="isEdit || readonly"
          @input="markDirty"
        />
        <el-tag v-if="isEdit" :type="statusTagType">{{ statusLabel }}</el-tag>
        <el-tag v-else type="info">新建</el-tag>
        <span v-if="readonly" class="text-12px text-[var(--el-color-warning)]">只读</span>
      </div>
      <div class="flex items-center gap-8px flex-shrink-0">
        <el-button :disabled="readonly" :loading="validating" @click="handleValidate">
          <Icon icon="ep:circle-check" class="mr-4px" />校验
        </el-button>
        <el-button
          :loading="savingAction === 'save'"
          :disabled="readonly || (saving && savingAction !== 'save')"
          @click="handleSave('save')"
        >
          <Icon icon="ep:finished" class="mr-4px" />保存草稿
        </el-button>
        <el-button
          type="primary"
          :loading="savingAction === 'publish'"
          :disabled="readonly || (saving && savingAction !== 'publish')"
          v-hasPermi="['agent:workflow:publish']"
          @click="handleSave('publish')"
        >
          <Icon icon="ep:promotion" class="mr-4px" />保存并发布
        </el-button>
      </div>
    </header>

    <!-- 校验结果（结构化 errors/warnings，直接展示后端返回的「怎么改」文案） -->
    <div v-if="validateResult" class="px-16px pt-8px">
      <el-alert
        v-if="validateResult.passed && !validateResult.warnings.length"
        title="校验通过：结构合法，可作为可执行流程发布"
        type="success"
        :closable="false"
        show-icon
      />
      <template v-else>
        <el-alert
          v-if="validateResult.errors.length"
          type="error"
          :closable="false"
          show-icon
          class="mb-6px"
        >
          <template #title>校验未通过：{{ validateResult.errors.length }} 个必须修正的错误</template>
          <ul class="pl-18px mb-0 mt-2px">
            <li v-for="(e, i) in validateResult.errors" :key="i" class="text-12px leading-20px">{{ e }}</li>
          </ul>
        </el-alert>
        <el-alert v-if="validateResult.warnings.length" type="warning" :closable="false" show-icon>
          <template #title>
            {{ validateResult.errors.length ? '另有' : '校验通过，但有' }}
            {{ validateResult.warnings.length }} 条建议调整（不阻断保存）
          </template>
          <ul class="pl-18px mb-0 mt-2px">
            <li v-for="(w, i) in validateResult.warnings" :key="i" class="text-12px leading-20px">{{ w }}</li>
          </ul>
        </el-alert>
      </template>
    </div>

    <!-- 基本信息折叠区 -->
    <div class="px-16px pt-8px">
      <el-collapse v-model="activeCollapse" class="editor-collapse">
        <el-collapse-item name="basic">
          <template #title>
            <span class="text-13px font-600">基本信息（描述 / 备注）</span>
          </template>
          <el-form label-width="60px" size="small" :disabled="readonly">
            <el-form-item label="描述">
              <el-input
                v-model="formData.description"
                type="textarea"
                :rows="2"
                placeholder="选填"
                maxlength="500"
                show-word-limit
                @input="markDirty"
              />
            </el-form-item>
            <el-form-item label="备注">
              <el-input
                v-model="formData.remark"
                type="textarea"
                :rows="2"
                placeholder="选填"
                maxlength="500"
                show-word-limit
                @input="markDirty"
              />
            </el-form-item>
          </el-form>
        </el-collapse-item>
      </el-collapse>
    </div>

    <!-- 主体：可视化画布（DSL JSON 兜底在画布组件底部） -->
    <div class="editor-body px-16px py-10px">
      <WorkflowEditorCanvas
        v-if="canvasReady"
        ref="canvasRef"
        :dsl="dslObject"
        :readonly="readonly"
        @change="markDirty"
        @replace="onCanvasReplace"
      />
      <el-empty v-else description="DSL 解析失败，无法进入画布编辑" />
    </div>
  </div>
</template>

<script lang="ts" setup>
import {
  AgentWorkflowApi,
  type AgentWorkflowDefSaveVO,
  type AgentWorkflowDefValidateVO
} from '@/api/agent/workflow'
import WorkflowEditorCanvas from '../components/WorkflowEditorCanvas.vue'
import type { EditorDsl } from '../editorModel'
import { CODE_PATTERN, DEFAULT_DSL } from './defaults'

defineOptions({ name: 'AgentWorkflowEditor' })

const message = useMessage()
const route = useRoute()
const { push, replace } = useRouter()

const loading = ref(false)
const validating = ref(false)
const saving = ref(false)
const savingAction = ref<'' | 'save' | 'publish'>('')
const dirty = ref(false)

const isEdit = ref(false)
const readonly = ref(false)
const status = ref('DRAFT')
const activeCollapse = ref<string[]>([])

const canvasRef = ref()
const validateResult = ref<AgentWorkflowDefValidateVO>()

const formData = ref<AgentWorkflowDefSaveVO>({
  id: undefined,
  code: '',
  name: '',
  dsl: '',
  description: '',
  remark: ''
})

/** 画布事实源：解析后的 DSL 对象（canvasReady=false 表示 DSL 非法 JSON，画布不渲染） */
const dslObject = ref<EditorDsl>({ nodes: [], edges: [] })
const canvasReady = ref(false)

const statusLabel = computed(() =>
  status.value === 'PUBLISHED' ? '已发布' : status.value === 'DISABLED' ? '已停用' : '草稿'
)
const statusTagType = computed<'info' | 'success' | 'warning'>(() =>
  status.value === 'PUBLISHED' ? 'success' : status.value === 'DISABLED' ? 'warning' : 'info'
)

const markDirty = () => {
  dirty.value = true
}

/** 把 DSL 原文解析进画布事实源；非法 JSON 返回 false（画布降级为 empty） */
const loadDslText = (text: string): boolean => {
  try {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false
    dslObject.value = parsed
    canvasReady.value = true
    return true
  } catch {
    canvasReady.value = false
    return false
  }
}

/** 画布内 JSON 兜底整体替换后，把新对象接回页面事实源 */
const onCanvasReplace = (dsl: EditorDsl) => {
  dslObject.value = dsl
  markDirty()
  validateResult.value = undefined
}

/** 当前 DSL 原文：优先取画布（含坐标写回），画布不可用时退回表单字段 */
const currentDslText = (): string => {
  if (canvasReady.value && canvasRef.value?.getDslText) {
    const text = canvasRef.value.getDslText()
    formData.value.dsl = text
    return text
  }
  return formData.value.dsl
}

const initCreate = () => {
  isEdit.value = false
  readonly.value = false
  status.value = 'DRAFT'
  formData.value = { id: undefined, code: '', name: '', dsl: DEFAULT_DSL, description: '', remark: '' }
  loadDslText(DEFAULT_DSL)
  dirty.value = false
}

const loadDef = async (id: number) => {
  loading.value = true
  try {
    const data = await AgentWorkflowApi.getDef(id)
    isEdit.value = true
    status.value = data.status ?? 'DRAFT'
    // 仅 DRAFT 可编辑（后端 updateDef 对非草稿抛 WORKFLOW_DEF_NOT_DRAFT）；其余状态只读展示
    readonly.value = status.value !== 'DRAFT'
    formData.value = {
      id: data.id,
      code: data.code,
      name: data.name,
      dsl: data.dsl ?? '',
      description: data.description ?? '',
      remark: data.remark ?? ''
    }
    if (!loadDslText(formData.value.dsl || '{}')) {
      message.error('该流程的 DSL 不是合法 JSON，无法进入画布编辑')
    }
    dirty.value = false
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  const id = Number(route.query.id)
  if (route.query.id && Number.isFinite(id) && id > 0) {
    loadDef(id)
  } else {
    initCreate()
  }
})

/** 调后端双层校验并落到 validateResult；返回结果对象（DSL 为空则提示并返回 null）。不弹 toast */
const runValidate = async (): Promise<AgentWorkflowDefValidateVO | null> => {
  const dsl = currentDslText()
  if (!dsl?.trim()) {
    message.warning('DSL 为空，无法校验')
    return null
  }
  validating.value = true
  try {
    const res = await AgentWorkflowApi.validateDsl(dsl)
    validateResult.value = res
    return res
  } finally {
    validating.value = false
  }
}

const handleValidate = async () => {
  const res = await runValidate()
  if (!res) return
  if (res.passed) {
    res.warnings.length
      ? message.warning(`校验通过，但有 ${res.warnings.length} 条建议调整`)
      : message.success('校验通过')
  } else {
    message.error(`校验未通过：${res.errors.length} 个错误`)
  }
}

/** 顶栏字段级校验（无 el-form rules，手动查）：返回错误文案，通过返回 '' */
const validateForm = (): string => {
  if (!formData.value.name?.trim()) return '请填写流程名称'
  if (!isEdit.value) {
    const code = formData.value.code?.trim() ?? ''
    if (!code) return '请填写流程编码'
    if (!CODE_PATTERN.test(code)) return '流程编码需小写字母开头，仅含小写字母/数字/下划线，长度 2~64'
  }
  if (!currentDslText()?.trim()) return 'DSL 不能为空'
  return ''
}

/**
 * 保存（软门禁）：字段校验 → 后端双层校验（有阻断错误二次确认可存草稿）→ create/update。
 * publish=true 时保存成功后再发布（发布要求校验通过，故有 error 直接拦下不进发布）。
 */
const handleSave = async (action: 'save' | 'publish') => {
  const fieldErr = validateForm()
  if (fieldErr) {
    message.warning(fieldErr)
    return
  }
  const res = await runValidate()
  if (!res) return
  if (!res.passed) {
    if (action === 'publish') {
      message.error(`存在 ${res.errors.length} 个阻断错误，无法发布；请修正后再试（可先保存草稿）`)
      return
    }
    try {
      await message.confirm(
        `DSL 存在 ${res.errors.length} 个错误，仍要保存为草稿吗？草稿不可执行，可稍后修正再发布。`
      )
    } catch {
      return
    }
  }

  saving.value = true
  savingAction.value = action
  try {
    const payload: AgentWorkflowDefSaveVO = { ...formData.value, dsl: currentDslText() }
    // 🔴 先记住本次是不是「新建」：createDef 成功后会把 isEdit 翻成 true（URL 补 id、后续保存转 update），
    //    若等到提示时再看 isEdit 就永远是 true，「新建成功」分支成了死代码、创建与更新提示无法区分。
    const wasCreate = !isEdit.value
    let id = payload.id
    if (isEdit.value && id) {
      await AgentWorkflowApi.updateDef(payload)
    } else {
      id = await AgentWorkflowApi.createDef(payload)
      // 新建成功 → 切编辑态并把 id 补进 URL（防刷新重复新建）
      isEdit.value = true
      formData.value.id = id
      status.value = 'DRAFT'
      readonly.value = false
      replace({ name: 'AgentWorkflowEditor', query: { id: String(id) } })
    }
    dirty.value = false

    if (action === 'publish' && id) {
      await AgentWorkflowApi.publishDef(id)
      status.value = 'PUBLISHED'
      readonly.value = true // 已发布不可再改（要改走版本回滚生成新草稿）
      message.success('已保存并发布')
    } else {
      message.success(wasCreate ? '新建成功（草稿）' : '保存成功')
    }
    validateResult.value = undefined
  } finally {
    saving.value = false
    savingAction.value = ''
  }
}

const handleBack = async () => {
  if (dirty.value) {
    try {
      await message.confirm('有未保存的改动，确认离开吗？')
    } catch {
      return
    }
  }
  push({ path: '/agent/workflow' })
}
</script>

<style scoped>
.workflow-editor-page {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 84px);
  background: var(--el-bg-color-page);
}
.editor-header {
  flex-shrink: 0;
  background: var(--el-bg-color);
  border-bottom: 1px solid var(--el-border-color-light);
}
/* 主体撑满剩余高度；画布组件内部自己 flex（VueFlow 容器要有显式高度） */
.editor-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.editor-body > * {
  flex: 1;
  min-height: 0;
}
.editor-collapse :deep(.el-collapse-item__header) {
  height: 36px;
  line-height: 36px;
}
</style>
