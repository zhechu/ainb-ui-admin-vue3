<!--
  自定义工具 新增/编辑/查看面板（2026-09-29 由弹窗改页内 + 由 HTTP 改绑数据接口）

  🔴 为什么页内：字段比弹窗装得下的多（关联接口后还要展示接口的入参定义），弹窗里得滚动，
     管理员看不见「上面填了什么、下面要填什么」，这是低代码子系统的老毛病来源之一。

  🔴 为什么不再自己填 URL/Header/凭据：自定义工具现在只是**数据接口的 AI 包装层**。
     地址、SQL、鉴权、租户注入、系统表保护、版本与日志，数据接口那边已经治理过一遍；
     在这里再填一次等于同一件事配两处，而且绕开了全部治理。所以 config 只剩 {code,mode}，
     凭据彻底不进这张表（后端连脱敏逻辑都删了）。

  🔴 两处「替管理员先想到」的联动，都只在页面上提示、不偷偷改安全字段：
     · 绑的接口含写操作 → 只读模式跑不动它，给出醒目提示让他改执行方式；
     · 执行方式选「全能力执行」→ 权限里必须有 infra:data-interface:invoke，否则后端直接拒。
       这一条是自动补上的（并明确告知），因为漏了必然保存失败，补上不会放松任何东西。
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

    <el-alert type="info" :closable="false" show-icon class="mb-16px max-w-900px mx-auto">
      <template #title>
        <span class="text-12px">
          自定义工具 = 把一个<b>接口</b>包装成 AI 能直接调用的工具。接口的地址/SQL/鉴权/租户隔离
          在「基础设施 → 数据管理 → 接口管理」里维护，这里只决定<b>用哪个接口、怎么执行、需要什么权限</b>。
        </span>
      </template>
    </el-alert>

    <el-form
      ref="formRef"
      v-loading="formLoading"
      :model="form"
      :rules="formRules"
      :disabled="isView"
      label-width="120px"
      class="max-w-900px mx-auto"
    >
      <el-row :gutter="16">
        <el-col :span="12">
          <el-form-item label="工具键" prop="toolKey">
            <el-input
              v-model="form.toolKey"
              :disabled="isEdit"
              placeholder="小写字母开头，如 sales_daily_report"
            />
            <div class="form-tip">模型按它调用、流程节点按它引用，改键等于换一个工具，故编辑时不可改。</div>
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="展示名" prop="displayName">
            <el-input v-model="form.displayName" placeholder="给人看的中文名，如 销售日报" />
          </el-form-item>
        </el-col>
      </el-row>

      <el-form-item label="工具说明" prop="description">
        <el-input
          v-model="form.description"
          type="textarea"
          :rows="3"
          placeholder="写清「什么时候该用这把工具、能得到什么」。这段文字直接进模型提示词，是模型选对工具的唯一依据"
        />
        <div class="form-tip">留空模型就只能靠工具键猜用途，容易选错或反复试。</div>
      </el-form-item>

      <el-row :gutter="16">
        <el-col :span="12">
          <el-form-item label="分组" prop="groupName">
            <el-select
              v-model="form.groupName"
              placeholder="管理页归类用，可下拉选也可自己输入"
              filterable
              allow-create
              default-first-option
              clearable
              class="!w-full"
            >
              <el-option v-for="g in GROUP_OPTIONS" :key="g" :label="g" :value="g" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="风险等级" prop="riskLevel">
            <el-select v-model="form.riskLevel" placeholder="请选择风险等级" class="!w-full">
              <el-option v-for="r in RISK_OPTIONS" :key="r.value" :label="r.label" :value="r.value">
                <span class="float-left">{{ r.label }}</span>
                <span class="float-right text-12px text-[var(--el-text-color-secondary)] ml-12px">{{ r.hint }}</span>
              </el-option>
            </el-select>
            <div class="form-tip">
              中风险及以上会先进 Plan 让用户确认再执行。
              <span v-if="isRiskUnderstated" class="text-[var(--el-color-danger)]">
                ⚠️ 所绑接口含写操作，标成「{{ riskLabel(form.riskLevel) }}」会让它绕过确认。
              </span>
            </div>
          </el-form-item>
        </el-col>
      </el-row>

      <el-form-item label="关联数据接口" prop="interfaceCode">
        <el-select
          v-model="form.interfaceCode"
          placeholder="输入接口编码/名称搜索（仅列出启用中的接口，最多 50 条）"
          filterable
          remote
          clearable
          :remote-method="searchInterfaces"
          :loading="interfaceLoading"
          class="!w-full"
          @change="handleInterfaceChange"
        >
          <el-option
            v-for="item in interfaceOptions"
            :key="item.code"
            :label="`${item.name || item.code}（${item.code}）`"
            :value="item.code"
          >
            <span class="float-left">{{ item.name || item.code }}</span>
            <span class="float-right text-12px text-[var(--el-text-color-secondary)] ml-12px">
              {{ item.code }}
              <el-tag v-if="item.writeOperation" type="danger" size="small" class="ml-6px">含写</el-tag>
            </span>
          </el-option>
        </el-select>
        <div v-if="!interfaceLoading && !interfaceOptions.length" class="form-tip text-[var(--el-color-warning)]">
          目录里没有可选接口：请先在「基础设施 → 数据管理 → 接口管理」建好并启用，再回来关联。
        </div>
        <div v-else-if="boundInterface" class="form-tip">
          <!--
            分类走字典翻译。后端下发的是字典值（internal / external），直接渲染会让用户
            看到一串英文；而分类字典曾经存过自由文本（「表单设计示例」这类），
            那种值在字典里查不到 —— 所以查不到时原样兜底，而不是显示空白
          -->
          {{ boundInterface.typeName || '接口' }} · {{ categoryLabel(boundInterface.category) }}
          <span v-if="boundInterface.writeOperation" class="text-[var(--el-color-danger)]"> · 含写操作</span>
          <span v-if="boundInterface.remark"> · {{ boundInterface.remark }}</span>
        </div>
      </el-form-item>

      <el-form-item label="执行方式" prop="mode">
        <el-radio-group v-model="form.mode" @change="handleModeChange">
          <el-radio-button value="QUERY">只读查询</el-radio-button>
          <el-radio-button value="INVOKE">全能力执行</el-radio-button>
        </el-radio-group>
        <div class="form-tip" :class="{ 'text-[var(--el-color-danger)]': isModeMismatch }">
          只读查询：只能跑不含写操作的接口，安全默认。全能力执行：可写数据，需额外权限且默认进 Plan 确认。
          <span v-if="isModeMismatch">⚠️ 所绑接口含写操作，只读查询跑不了它，请改为「全能力执行」。</span>
        </div>
      </el-form-item>

      <el-form-item v-if="boundParams.length" label="接口入参">
        <el-table :data="boundParams" size="small" border class="w-full">
          <el-table-column label="参数名" prop="name" width="180" />
          <el-table-column label="含义" min-width="160">
            <template #default="scope">{{ scope.row.label || scope.row.remark || '—' }}</template>
          </el-table-column>
          <el-table-column label="类型" prop="type" width="110" align="center" />
          <el-table-column label="必填" width="80" align="center">
            <template #default="scope">
              <el-tag :type="scope.row.required ? 'danger' : 'info'" size="small">
                {{ scope.row.required ? '必填' : '可选' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="默认值" width="120" align="center">
            <template #default="scope">{{ scope.row.defaultValue || '—' }}</template>
          </el-table-column>
        </el-table>
        <div class="form-tip">模型会照这份定义拼参数；下面的「参数说明」留空时，后端按它自动生成。</div>
      </el-form-item>

      <el-form-item label="所需权限" prop="permissions">
        <el-input v-model="form.permissions" placeholder="逗号分隔的权限串；留空=登录即可调用" />
        <div class="form-tip" :class="{ 'text-[var(--el-color-danger)]': missingInvokePermission }">
          留空表示任何登录用户都能让 AI 调这把工具。
          <span v-if="missingInvokePermission">
            ⚠️ 全能力执行必须在权限里包含 {{ INVOKE_PERMISSION }}，否则保存会被拒。
          </span>
        </div>
      </el-form-item>

      <el-form-item label="参数说明" prop="paramsSchema">
        <el-input
          v-model="form.paramsSchema"
          type="textarea"
          :rows="3"
          placeholder="留空=后端按所绑接口的入参定义自动生成（推荐）"
        />
        <div class="form-tip">这段文字进模型提示词，是模型知道该传哪些键的唯一来源。自动生成后不会跟随接口变更。</div>
      </el-form-item>

      <el-row :gutter="16">
        <el-col :span="12">
          <el-form-item label="启用" prop="enabled">
            <el-switch v-model="form.enabled" />
            <div class="form-tip">停用后网关直接拒绝调用，但流程节点里的引用还在。</div>
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="备注" prop="remark">
            <el-input v-model="form.remark" placeholder="选填，记录这把工具给谁用" />
          </el-form-item>
        </el-col>
      </el-row>
    </el-form>
  </ContentWrap>
</template>

<script lang="ts" setup>
import type { FormInstance, FormRules } from 'element-plus'
import { getDictLabel } from '@/utils/dict'
import {
  AgentToolDefApi,
  type AgentToolDefSaveVO,
  type DataInterfaceSimpleVO,
  type DataInterfaceToolConfigVO
} from '@/api/agent/tooldef'

defineOptions({ name: 'ToolDefForm' })

const emit = defineEmits<{ success: []; cancel: [] }>()
const message = useMessage()

const TOOL_KEY_PATTERN = /^[a-z][a-z0-9_]{1,63}$/
/** 与后端 AgentToolDefServiceImpl.INVOKE_PERMISSION 逐字一致 */
const INVOKE_PERMISSION = 'infra:data-interface:invoke'

const RISK_OPTIONS = [
  { value: 'READ_ONLY', label: '只读', hint: '只查询、不改数据' },
  { value: 'LOW', label: '低风险', hint: '可逆的小改动' },
  { value: 'MEDIUM', label: '中风险', hint: '会写业务数据' },
  { value: 'HIGH', label: '高风险', hint: '影响面大/较难撤销' },
  { value: 'IRREVERSIBLE', label: '不可逆', hint: '一旦执行无法撤销' }
]
const riskLabel = (risk?: string) => RISK_OPTIONS.find((r) => r.value === risk)?.label ?? risk ?? ''

/**
 * 分组下拉的候选值，与后端 @AgentTool(groupName=...) 的代码声明保持一致
 *
 * 🔴 里面的「数据建模」「数据接口」<b>刻意没有</b>跟着 2026-10 的菜单改名一起变成
 *    「数据模型」「接口管理」。分组描述的是<b>一类工具在做什么</b>，不是<b>用户从哪个菜单进去</b>；
 *    而且 agent_tool_override.group_name 里存着已生效的覆盖值，改一处漏一处就会让
 *    同一组工具在管理页被拆成两半。完整理由见后端 AgentTool#groupName 的注释，
 *    读到这里的不要「顺手统一」
 */
const GROUP_OPTIONS = [
  '数据建模',
  '表单设计',
  '表单数据',
  '流程审批',
  '数据接口',
  '控件契约',
  '诊断排错',
  '平台手册'
]

const formLoading = ref(false)
const mode = ref<'create' | 'edit' | 'view'>('create')
const isView = computed(() => mode.value === 'view')
const isEdit = computed(() => mode.value === 'edit')
const panelTitle = computed(() =>
  mode.value === 'create' ? '新增工具' : mode.value === 'edit' ? '编辑工具' : '查看工具'
)

const formRef = ref<FormInstance>()
const editId = ref<number | undefined>(undefined)

interface ToolForm {
  toolKey: string
  displayName: string
  description: string
  groupName: string
  riskLevel: string
  permissions: string
  enabled: boolean
  paramsSchema: string
  remark: string
  /** config 拆成两个字段编辑，提交时再序列化回去 */
  interfaceCode: string
  mode: 'QUERY' | 'INVOKE'
}

const defaultForm = (): ToolForm => ({
  toolKey: '',
  displayName: '',
  description: '',
  groupName: '',
  riskLevel: 'READ_ONLY',
  permissions: '',
  enabled: true,
  paramsSchema: '',
  remark: '',
  interfaceCode: '',
  mode: 'QUERY'
})

const form = ref<ToolForm>(defaultForm())

// ==================== 数据接口目录 ====================
const interfaceLoading = ref(false)
const interfaceOptions = ref<DataInterfaceSimpleVO[]>([])

const searchInterfaces = async (keyword?: string) => {
  interfaceLoading.value = true
  try {
    interfaceOptions.value = await AgentToolDefApi.getBindableInterfaceList(keyword)
  } finally {
    interfaceLoading.value = false
  }
}

const boundInterface = computed(() =>
  interfaceOptions.value.find((item) => item.code === form.value.interfaceCode)
)
const boundParams = computed(() => boundInterface.value?.params ?? [])
/** 后端权威的「含写操作」——它分析脚本得出，比表单上填的可信 */
const boundIsWrite = computed(() => boundInterface.value?.writeOperation === true)

/** 接口来源的展示文案：字典值翻译成中文，字典里查不到就原样显示，都没有才是「未指定来源」 */
const categoryLabel = (category?: string) =>
  (category && (getDictLabel(DICT_TYPE.INFRA_FORM_TYPE, category) || category)) || '未指定来源'

const isModeMismatch = computed(() => boundIsWrite.value && form.value.mode === 'QUERY')
const isRiskUnderstated = computed(() => boundIsWrite.value && form.value.riskLevel === 'READ_ONLY')

const permissionList = computed(() =>
  form.value.permissions
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
)
const missingInvokePermission = computed(
  () => form.value.mode === 'INVOKE' && !permissionList.value.includes(INVOKE_PERMISSION)
)

/**
 * 选「全能力执行」时自动补上 invoke 权限。
 * 🔴 这是全表单唯一一处自动改字段，因为漏了必然被后端拒（保存失败但用户看不出缺什么），
 *    而补上不会放松任何东西——它只会让要求变严。风险等级就相反：那是安全字段，
 *    只提示不代改，免得「我没选高风险它自己变了」。
 */
const handleModeChange = (val: string | number | boolean | undefined) => {
  if (val !== 'INVOKE') return
  if (permissionList.value.includes(INVOKE_PERMISSION)) return
  const next = [...permissionList.value, INVOKE_PERMISSION]
  form.value.permissions = next.join(',')
  message.info(`已自动补上所需权限 ${INVOKE_PERMISSION}（全能力执行必须带）`)
}

/** 换绑接口后，执行方式若跑不动它就直接切过去（比让他保存失败再回来改省事） */
const handleInterfaceChange = () => {
  if (boundIsWrite.value && form.value.mode === 'QUERY') {
    form.value.mode = 'INVOKE'
    handleModeChange('INVOKE')
    message.warning('所绑接口含写操作，执行方式已切为「全能力执行」')
  }
}

const formRules = reactive<FormRules>({
  displayName: [{ required: true, message: '展示名不能为空', trigger: 'blur' }],
  toolKey: [
    { required: true, message: '工具键不能为空', trigger: 'blur' },
    {
      validator: (_r, v, cb) => {
        if (!v) return cb()
        if (!TOOL_KEY_PATTERN.test(v)) {
          return cb(new Error('小写字母开头，仅含小写字母/数字/下划线，长度 2~64'))
        }
        cb()
      },
      trigger: 'blur'
    }
  ],
  riskLevel: [{ required: true, message: '请选择风险等级', trigger: 'change' }],
  interfaceCode: [{ required: true, message: '请选择要关联的数据接口', trigger: 'change' }],
  mode: [{ required: true, message: '请选择执行方式', trigger: 'change' }]
})

/** 打开面板：无 id=新建；有 id 拉详情并解析 config */
const open = async (id?: number, m?: 'view' | 'edit') => {
  form.value = defaultForm()
  editId.value = id
  await searchInterfaces()
  if (!id) {
    mode.value = 'create'
    nextTick(() => formRef.value?.clearValidate())
    return
  }
  mode.value = m === 'view' ? 'view' : 'edit'
  formLoading.value = true
  try {
    const vo = await AgentToolDefApi.getToolDef(id)
    let cfg: DataInterfaceToolConfigVO = {}
    try {
      cfg = vo.config ? (JSON.parse(vo.config) as DataInterfaceToolConfigVO) : {}
    } catch {
      cfg = {}
    }
    form.value = {
      toolKey: vo.toolKey ?? '',
      displayName: vo.displayName ?? '',
      description: vo.description ?? '',
      groupName: vo.groupName ?? '',
      riskLevel: vo.riskLevel ?? 'READ_ONLY',
      permissions: vo.permissions ?? '',
      enabled: vo.enabled !== false,
      paramsSchema: vo.paramsSchema ?? '',
      remark: vo.remark ?? '',
      interfaceCode: cfg.code ?? '',
      mode: (cfg.mode ?? 'QUERY').toUpperCase() === 'INVOKE' ? 'INVOKE' : 'QUERY'
    }
    // 🔴 已绑的接口可能不在默认那 50 条里（生产有 380+ 个接口），不补一条占位选项的话
    //    下拉只会显示光秃秃的 code，且 boundInterface 为空 → 入参表、含写提示全都不出现，
    //    看起来像「配置丢了」。这里按 code 精确查一次，查到就用真的，查不到也留个壳。
    if (form.value.interfaceCode && !boundInterface.value) {
      const hit = await AgentToolDefApi.getBindableInterfaceList(form.value.interfaceCode)
      const exact = hit.find((item) => item.code === form.value.interfaceCode)
      interfaceOptions.value = exact
        ? [exact, ...interfaceOptions.value]
        : [{ code: form.value.interfaceCode, name: '（接口已停用或不存在）' }, ...interfaceOptions.value]
    }
  } finally {
    formLoading.value = false
  }
  nextTick(() => formRef.value?.clearValidate())
}
defineExpose({ open })

const handleCancel = () => emit('cancel')

const submitForm = async () => {
  if (!formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return
  // 前端先拦一道：后端也会拒，但报错要在保存之后才看得见，且看不出该补哪个权限
  if (missingInvokePermission.value) {
    message.warning(`全能力执行的工具，所需权限里必须包含 ${INVOKE_PERMISSION}`)
    return
  }
  if (isModeMismatch.value) {
    message.warning('所绑接口含写操作，请把执行方式改为「全能力执行」')
    return
  }
  formLoading.value = true
  try {
    const payload: AgentToolDefSaveVO = {
      id: editId.value,
      toolKey: form.value.toolKey.trim(),
      displayName: form.value.displayName.trim(),
      description: form.value.description || undefined,
      source: 'DATA_INTERFACE',
      groupName: form.value.groupName || undefined,
      riskLevel: form.value.riskLevel,
      permissions: form.value.permissions || undefined,
      enabled: form.value.enabled,
      config: JSON.stringify({ code: form.value.interfaceCode, mode: form.value.mode }),
      paramsSchema: form.value.paramsSchema || undefined,
      remark: form.value.remark || undefined
    }
    if (isEdit.value && editId.value) {
      await AgentToolDefApi.updateToolDef(payload)
      message.success('修改成功')
    } else {
      await AgentToolDefApi.createToolDef(payload)
      message.success('新增成功')
    }
    emit('success')
  } finally {
    formLoading.value = false
  }
}
</script>

<style lang="scss" scoped>
.panel-title {
  font-size: 15px;
  font-weight: 600;
}

.form-tip {
  font-size: 11px;
  line-height: 16px;
  margin-top: 2px;
  color: var(--el-text-color-placeholder);
}
</style>
