<template>
  <Dialog v-model="dialogVisible" :title="dialogTitle" width="820" :close-on-click-modal="false">
    <!--
      🔴 平台预置行**整行只读**，而这件事要在用户填第一格之前就说出来。
         不说的话，产出是「填完一屏 expr、点了保存、收到 REVIEW_RULE_PLATFORM_IMMUTABLE」——
         那一次的印象是「这个功能坏了」，而真相是「这一行本来就不给你改」。
         出路写在下面那个按钮上：照它新建一条
    -->
    <el-alert
      v-if="platformRow && !copying"
      type="info"
      :closable="false"
      show-icon
      class="mb-12px"
    >
      <div class="alert-text">这是<b>平台预置</b>的规则，改不了也删不了。</div>
      <div class="alert-sub">
        它的口径由平台随版本维护，机构不能改（改了就无法在事后证明「当时查的是什么」）。
        想按同一口径自建一条，用下面的「照它新建一条」——
        <span class="mono">expr</span> 原文会一并带过去，抄一遍比凭空写靠谱。
      </div>
    </el-alert>
    <el-alert v-else-if="copying" type="warning" :closable="false" show-icon class="mb-12px">
      <div class="alert-text">
        正在照平台规则 <b class="mono">{{ existing?.ruleCode }}</b> 新建一条<b>机构自建</b>的规则。
      </div>
      <div class="alert-sub">
        <b>规则码必须换一个新的</b>：原来那个码被平台行占着，抄过来一定撞
        （而且软删之后码也照样被占着，唯一索引不含 deleted）。 新建出来的这一行归你机构，<b
          >从此不再随平台版本更新</b
        >
        —— 平台改了原规则的口径，你这一份不会跟着变。
      </div>
    </el-alert>
    <el-alert v-else-if="viewOnly" type="info" :closable="false" show-icon class="mb-12px">
      <div class="alert-text">只读查看。</div>
    </el-alert>

    <el-form ref="formRef" :model="formData" :rules="formRules" label-width="120px">
      <el-form-item label="规则码" prop="ruleCode">
        <!--
          🔴 修改时**灰掉 + tooltip**，不是隐藏：qlzg_review_run.rule_code 是裸 varchar，
             改码会让已经落库的那一批命中明细指向一个不再存在的码，
             而档案里那一行从此无法归属（REVIEW_RULE_CODE_IMMUTABLE，
             且这道判在内容校验**之前**）。
             隐藏会被理解成「这功能坏了」—— 不可改的东西要看得见它不可改
        -->
        <el-tooltip
          :disabled="codeEditable"
          content="规则码建好之后不能改：历史命中明细是按这个码归档的，改码等于让档案里那些行指向一个不存在的规则"
          placement="top"
        >
          <el-input
            v-model="formData.ruleCode"
            :disabled="!codeEditable"
            :maxlength="16"
            placeholder="大写字母开头，只含大写字母 / 数字 / 下划线 / 连字符，2–16 个字符"
          />
        </el-tooltip>
        <!--
          🔴 码在软删之后**仍然被占着**（唯一索引不含 deleted）。
             这句要写在表单上，别等撞了 REVIEW_RULE_CODE_DUPLICATE 再报错 ——
             那句报错读起来像「系统出错了」，而真相是「这个编号永久退休了」
        -->
        <div v-if="codeEditable" class="form-hint">
          建议用 <span class="mono">ORG-01</span> 这类机构自建的码， 不要用
          <span class="mono">R49</span> —— 那会让人以为它是平台的第 49 条。
          <b>删掉一条规则之后，它的码仍然被占着</b>：历史命中记录按裸码引用规则，
          编号可复用等于让档案里的那一条在某天开始指另一件事。
        </div>
      </el-form-item>

      <el-form-item label="规则名称" prop="ruleName">
        <el-input
          v-model="formData.ruleName"
          :disabled="readOnly"
          :maxlength="128"
          placeholder="复核工作台上给人看的就是这一列，不是规则码"
        />
      </el-form-item>

      <el-form-item label="规则说明">
        <el-input
          v-model="formData.description"
          :disabled="readOnly"
          :maxlength="500"
          type="textarea"
          :rows="2"
          placeholder="这条规则在查什么、依据是本所哪一份制度"
        />
      </el-form-item>

      <el-form-item label="法域">
        <!--
          🔴 **固定显示**，不是一个能选的下拉：后端 resolveLawDomain 对其余五个一律拒
             （REVIEW_RULE_LAW_DOMAIN_FORCED）—— 让一条机构私规在 30 年档案里
             宣称自己有法律授权，是不可接受的。
             一个只有一项可选的下拉，产出的是「为什么选不了法律」这个疑问，
             而答案比疑问更该被看见
        -->
        <div class="fixed-value">
          <el-tag size="small" type="info">{{ lawDomainLabel }}</el-tag>
          <span class="form-hint">
            机构自建的规则一律归「机构内部制度」，<b>这一项不能选</b>。 它照样可以配「拦截」——
            机构自己的内控要求本来就能拦自己人的稿。
          </span>
        </div>
      </el-form-item>

      <el-form-item label="条款依据">
        <el-input
          v-model="formData.clauseRef"
          :disabled="readOnly"
          :maxlength="128"
          placeholder="例如：本所《资产评估执业管理办法》第 3.2 条（机构内部制度可以不填）"
        />
      </el-form-item>

      <el-form-item label="严重度" prop="severity">
        <el-select v-model="formData.severity" :disabled="readOnly" class="w-full">
          <el-option
            v-for="opt in RULE_SEVERITY_OPTIONS"
            :key="opt.value"
            :label="opt.label"
            :value="opt.value"
            :disabled="!severityWithinCeiling(opt.value, severityCeiling)"
          >
            <span>{{ opt.label }}</span>
            <span class="mono option-code">{{ opt.value }}</span>
          </el-option>
        </el-select>
        <!--
          🔴 灰掉的档位旁边要**印出天花板**，而不是让人去猜「为什么选不了」。
             后端那道码是 REVIEW_RULE_SEVERITY_NOT_ALLOWED，
             而「专家指引不能产生强制性拦截」这个理由比那句报错更该被看见。
             ⚠️ 机构自建规则的法域恒为 ORG_INTERNAL、天花板恒为 BLOCK，
                所以本表单上三档通常都能选 —— 这一段只在查看平台行时才会亮起来
        -->
        <div v-if="ceilingBelowBlock" class="form-hint">
          本法域（{{ lawDomainLabel }}）的天花板是
          <b>{{ labelOf(RULE_SEVERITY_OPTIONS, severityCeiling) }}</b
          >：建议性文件不能产生强制性拦截，所以「拦截」这一档选不了。
        </div>
      </el-form-item>

      <el-form-item label="判定表达式" prop="expr">
        <div class="expr-toolbar">
          <el-button v-if="!readOnly" size="small" type="primary" plain @click="openFactDrawer">
            可用事实
          </el-button>
          <span class="form-hint">
            aviator 表达式。写进这里的名字必须来自「可用事实」词表 ——
            <b>写错的名字求值为 nil，而 nil 参与的比较不报错，规则会恒过</b>。
          </span>
        </div>
        <el-input
          ref="exprRef"
          v-model="formData.expr"
          :disabled="readOnly"
          type="textarea"
          :rows="4"
          class="mono"
          placeholder="例：string.contains(report.reportNo, p.requiredPrefix)"
        />
        <!--
          🔴 **不预校验** expr 能不能编译、事实名存不存在：那两件都要读库 / 读引擎才知道。
             前端猜的结果是「界面上说没问题、保存时被拒」，
             而后端那句报错（REVIEW_RULE_EXPR_INVALID 会带上 aviator 的原文）
             比前端能拼出来的任何提示都完整。本页的做法是：不预校验，把后端那句原文显示出来
        -->
      </el-form-item>

      <el-form-item label="阈值参数">
        <el-input
          v-model="formData.exprParams"
          :disabled="readOnly"
          type="textarea"
          :rows="3"
          class="mono"
          :placeholder="EXPR_PARAMS_PLACEHOLDER"
        />
        <div class="form-hint">
          JSON 原文，必须是一个<b>对象</b>（不是数组、不是标量）。键名要与
          <span class="mono">expr</span> 里写的 <span class="mono">p.xxx</span> 对得上。
        </div>
      </el-form-item>

      <el-form-item label="判定目标">
        <el-select v-model="formData.targetKind" :disabled="readOnly" class="w-full">
          <el-option
            v-for="opt in RULE_TARGET_KIND_OPTIONS"
            :key="opt.value"
            :label="opt.label"
            :value="opt.value"
          />
        </el-select>
        <div class="form-hint">
          它决定命中能不能<b>定位回报告里的那一处</b>：写成「章节」却不引用任何
          <span class="mono">sections.*</span> 的话，命中行推不出章节锚点，
          工作台上的「定位」按钮就是不可点的。
        </div>
      </el-form-item>

      <el-form-item label="命中信息模板">
        <el-input
          v-model="formData.messageTemplate"
          :disabled="readOnly"
          :maxlength="1000"
          type="textarea"
          :rows="2"
          placeholder="例：报告编号 ${report.reportNo} 缺少本所要求的前缀 ${p.requiredPrefix}"
        />
        <div class="form-hint">
          里面每一个 <span class="mono">${...}</span> 都必须解析得出来（事实名或
          <span class="mono">p.</span> 参数名），保存时会逐个校验。
        </div>
      </el-form-item>

      <el-form-item label="修改建议模板">
        <el-input
          v-model="formData.suggestionTemplate"
          :disabled="readOnly"
          :maxlength="1000"
          type="textarea"
          :rows="2"
          placeholder="例：请把报告编号改成「启凌估字〔年份〕第 N 号」的形式"
        />
      </el-form-item>

      <el-form-item label="执行顺序">
        <el-input-number v-model="formData.sort" :disabled="readOnly" :min="0" :step="1" />
        <div class="form-hint"> 越小越先。它<b>不影响判定结论</b>，只影响复核工作台上的排列。 </div>
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button v-if="!readOnly" type="primary" :loading="submitting" @click="submitForm">
        保存
      </el-button>
      <el-button v-if="platformRow && !copying" type="primary" plain @click="copyAsNew">
        照它新建一条
      </el-button>
      <el-button @click="dialogVisible = false">{{ readOnly ? '关闭' : '取消' }}</el-button>
    </template>

    <FactListDrawer ref="factDrawerRef" selectable @pick="insertFact" />
  </Dialog>
</template>
<script lang="ts" setup>
import {
  QlzgReviewRuleApi,
  type QlzgReviewRuleSaveVO,
  type QlzgReviewRuleVO
} from '@/api/qlzg/reviewRule'
import {
  LAW_DOMAIN_OPTIONS,
  RULE_SEVERITY_OPTIONS,
  RULE_TARGET_KIND_OPTIONS,
  labelOf
} from '@/views/qlzg/constants'
import FactListDrawer from './FactListDrawer.vue'
import { ruleCodeEditable, ruleRowReadOnly, severityWithinCeiling } from '../reviewFlow'

/**
 * 一条复核规则的新建 / 修改 / 查看表单
 *
 * <h3>🔴 它有**四种**打开方式，而不是常见的两种</h3>
 * {@code create} / {@code update} / {@code view}（平台行只读查看）/
 * {@code copy}（照一条平台行新建，把 expr 原文带过去）。
 * 第四种存在的理由写在 {@code QlzgReviewRuleController#getRule} 上：
 * 「{@code /get} 照样返回平台行，因为配置页要能把它的 {@code expr} 原文展示出来给人参考
 * （机构自建一条同口径的规则时，抄一遍比凭空写靠谱）」。
 * 只做到「展示」而不给一条把它抄成新行的路，那个展示就只是让人手抄一遍
 *
 * <h3>🔴 本表单**只**预校验「本地就能知道、且后端会照抄列宽拒掉」的那几件</h3>
 * 必填与非空、以及各列的 {@code @Size} 上限（用 {@code maxlength} 直接不给超）。
 * {@code expr} 能不能编译、事实名存不存在、{@code ruleCode} 撞不撞码 ——
 * 那三件都要读库 / 读引擎才知道，前端猜的结果是
 * 「界面上说没问题、保存时被拒」，而后端那句报错比前端能拼出来的任何提示都完整。
 * 所以 {@link submitForm} 里**不**兜异常：axios 拦截器已经把后端那句原文显示出来了，
 * 再包一层只会把它换成一句更含糊的「保存失败」
 *
 * <h3>🔴 {@code exprParams} 是**原文字符串**，读进来直接塞、提交时原样回传</h3>
 * 解析成对象再 {@code JSON.stringify} 回去会产生一次<b>假的内容变更</b>：
 * 键序变了（MySQL 的 json 列还会按键长重排），{@code rule_set_version} 对它照实响应 ——
 * 指纹变了、报告页那个红点亮了，用户却什么都没改
 *
 * @author 走进新时代
 */
defineOptions({ name: 'QlzgReviewRuleForm' })

const emit = defineEmits(['success'])
const message = useMessage()

/** {@link open} 的第一个入参 */
type OpenMode = 'create' | 'update' | 'view' | 'copy'

/**
 * 「阈值参数」那一格的示例文案
 *
 * 放在 script 里而不是模板属性上，是因为示例本身带双引号：
 * 写进模板就得用单引号包属性（撞 `vue/html-quotes`）或者转义成 `&quot;`（读不出那是 JSON）。
 * 🔴 示例的键名逐字取自平台规则种子脚本里那一句说明（`maxDays=180` 平铺成 `p.maxDays`），
 *    别换成一个编出来的键名：expr 里写的 `p.xxx` 在这一列没有对应键时**恒为 nil**，
 *    规则恒过，而配置页与引擎都不报错
 */
const EXPR_PARAMS_PLACEHOLDER = '例：{"maxDays": 180}，expr 里写 p.maxDays'

const dialogVisible = ref(false)
const submitting = ref(false)
const mode = ref<OpenMode>('create')
/** 打开时那一份原始行；create 时为 null */
const existing = ref<QlzgReviewRuleVO | null>(null)
const formRef = ref()
const exprRef = ref()
const factDrawerRef = ref()

const formData = ref({
  id: undefined as number | undefined,
  ruleCode: '',
  ruleName: '',
  description: '',
  clauseRef: '',
  severity: 'WARN',
  expr: '',
  exprParams: '',
  targetKind: 'REPORT',
  messageTemplate: '',
  suggestionTemplate: '',
  sort: 0
})

const formRules = {
  ruleCode: [{ required: true, message: '规则码不能为空', trigger: 'blur' }],
  ruleName: [{ required: true, message: '规则名称不能为空', trigger: 'blur' }],
  severity: [{ required: true, message: '严重度不能为空', trigger: 'change' }],
  expr: [{ required: true, message: '判定表达式不能为空', trigger: 'blur' }]
}

/** 平台预置行：整行只读，改不了也删不了 */
const platformRow = computed(() => ruleRowReadOnly(existing.value))
/**
 * 正在「照一条平台行新建」
 *
 * 🔴 这一支必须从 {@link readOnly} 里**摘出来**：此时 {@link existing} 仍然是那条平台行
 *    （表单要拿它的 expr / 模板列当种子），于是 {@link platformRow} 为真 ——
 *    不摘出来的话一个本该能填的表单整屏灰掉，看起来像功能坏了
 */
const copying = computed(() => mode.value === 'copy')
/** 只读查看 */
const viewOnly = computed(() => mode.value === 'view')
const readOnly = computed(() => viewOnly.value || (platformRow.value && !copying.value))
/** 规则码这一格能不能编辑 —— 即「这是新建表单还是修改表单」 */
const codeEditable = computed(
  () => !readOnly.value && ruleCodeEditable(mode.value === 'update' ? existing.value : null)
)

const dialogTitle = computed(() => {
  if (mode.value === 'create') return '新建复核规则'
  if (copying.value) return '照平台规则新建一条'
  return readOnly.value ? '查看复核规则' : '修改复核规则'
})

/**
 * 法域那一格显示什么
 *
 * 🔴 机构自建一律是 ORG_INTERNAL（后端强制，不接受别的取值）；
 *    只有**查看平台行**时才显示它自己那一列的真实法域 ——
 *    那时它不是表单，是一段说明：「这一条为什么最高只能到提示」的答案就在这一格里
 */
const lawDomainLabel = computed(() =>
  platformRow.value && !copying.value
    ? existing.value?.lawDomainName ||
      labelOf(LAW_DOMAIN_OPTIONS, existing.value?.lawDomain) ||
      '（这一行没有法域）'
    : labelOf(LAW_DOMAIN_OPTIONS, 'ORG_INTERNAL')
)

/**
 * 天花板
 *
 * 🔴 copy 那一支**刻意返回 null**（⇒ 按 BLOCK）：新行是机构自建、法域被强制成
 *    ORG_INTERNAL，它的天花板就是 BLOCK。沿用源那条平台行的天花板的话，
 *    照一条「专家指引」的规则抄出来的新表单上「拦截」会是灰的 ——
 *    而新行压根不是专家指引，那个灰没有任何理由
 */
const severityCeiling = computed(() =>
  copying.value ? null : (existing.value?.severityCeiling ?? null)
)
const ceilingBelowBlock = computed(() => !severityWithinCeiling('BLOCK', severityCeiling.value))

const open = async (openMode: OpenMode, row?: QlzgReviewRuleVO) => {
  mode.value = openMode
  // 🔴 update / view 一律**重读一次** /get，不用列表里那一行：
  //    列表下发的字段与详情是同一个 VO，但列表可能是几分钟前读的，
  //    而 expr 这一格是要被原样回传的 —— 拿一份旧的去覆盖别人刚改的，
  //    后端没有版本列可以 CAS，两处都不报错
  existing.value =
    openMode === 'create' ? null : row?.id != null ? await QlzgReviewRuleApi.getRule(row.id) : null
  const src = existing.value
  formData.value = {
    // 🔴 copy 刻意**不带** id：带了就变成一次修改，而后端对平台行的修改一律拒
    id: openMode === 'update' ? src?.id : undefined,
    ruleCode: openMode === 'copy' ? '' : (src?.ruleCode ?? ''),
    ruleName: src?.ruleName ?? '',
    description: src?.description ?? '',
    clauseRef: src?.clauseRef ?? '',
    severity: src?.severity ?? 'WARN',
    expr: src?.expr ?? '',
    // 🔴 原文字符串，不 parse：见类注释第三条
    exprParams: src?.exprParams ?? '',
    targetKind: src?.targetKind ?? 'REPORT',
    messageTemplate: src?.messageTemplate ?? '',
    suggestionTemplate: src?.suggestionTemplate ?? '',
    sort: src?.sort ?? 0
  }
  dialogVisible.value = true
  // copy 时把焦点放到规则码上：那是唯一一格**必须**由人填的（原码被占着，抄过来一定撞）
  if (openMode === 'copy') {
    await nextTick()
    formRef.value?.clearValidate()
  }
}
defineExpose({ open })

/** 在只读查看一条平台行时，切到「照它新建一条」 */
const copyAsNew = () => {
  if (existing.value == null) return
  open('copy', existing.value)
}

const openFactDrawer = () => factDrawerRef.value?.open()

/**
 * 把一个事实名插进 expr
 *
 * 🔴 插在**光标处**，不是末尾：一条已经写好的 expr，末尾追加一个名字
 *    产出的是一个语法错误的串，用户还得手工剪一遍 ——
 *    而剪错了的表现是保存时被拒，报错指着 aviator 的原文，看起来像表达式引擎坏了
 * 🔴 取不到光标位置时回落到末尾追加，并在前面补一个空格：
 *    `report.statusfoo` 与 `report.status foo` 是两个完全不同的错误，
 *    后者至少还能被 aviator 报出「这里多了个东西」
 */
const insertFact = (key: string) => {
  const textarea: HTMLTextAreaElement | undefined = exprRef.value?.textarea
  const text = formData.value.expr ?? ''
  if (textarea == null || typeof textarea.selectionStart !== 'number') {
    formData.value.expr = text === '' ? key : `${text} ${key}`
    return
  }
  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  formData.value.expr = text.slice(0, start) + key + text.slice(end)
  nextTick(() => {
    textarea.focus()
    const caret = start + key.length
    textarea.setSelectionRange(caret, caret)
  })
}

const submitForm = async () => {
  await formRef.value?.validate()
  const data: QlzgReviewRuleSaveVO = {
    id: formData.value.id,
    ruleCode: formData.value.ruleCode,
    ruleName: formData.value.ruleName,
    description: formData.value.description || null,
    // 🔴 一律送 ORG_INTERNAL，不送 null：后端 resolveLawDomain 对空值同样强制成它，
    //    但**显式**送上去意味着「界面上显示的那一格」与「库里落的那一列」是同一件事，
    //    不需要靠读后端代码来确认
    lawDomain: 'ORG_INTERNAL',
    clauseRef: formData.value.clauseRef || null,
    severity: formData.value.severity,
    expr: formData.value.expr,
    exprParams: formData.value.exprParams || null,
    targetKind: formData.value.targetKind,
    messageTemplate: formData.value.messageTemplate || null,
    suggestionTemplate: formData.value.suggestionTemplate || null,
    sort: formData.value.sort
  }
  submitting.value = true
  try {
    if (data.id != null) {
      await QlzgReviewRuleApi.updateRule(data)
      message.success('规则已修改')
    } else {
      await QlzgReviewRuleApi.createRule(data)
      message.success('规则已新建')
    }
    dialogVisible.value = false
    emit('success')
  } finally {
    submitting.value = false
  }
}
</script>
<style lang="scss" scoped>
.alert-text {
  font-size: 13px;
  line-height: 1.7;
}

.alert-sub {
  margin-top: 2px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}

.fixed-value {
  display: flex;
  gap: 10px;
  align-items: center;
}

.expr-toolbar {
  display: flex;
  gap: 10px;
  align-items: center;
  width: 100%;
  margin-bottom: 6px;
}

.form-hint {
  width: 100%;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}

.option-code {
  float: right;
  font-size: 11px;
  color: var(--el-text-color-placeholder);
}

.mono {
  font-family: var(--el-font-family-mono, monospace);
}

.w-full {
  width: 100%;
}
</style>
