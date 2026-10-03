<!--
  复制流程对话框（重构 S5-d / 方案 §3-L4 4.1）

  两个阶段，同一个对话框：
    ① 填新身份（新编码 + 新名称 + 自动改写开关 + 规则说明）
    ② 复制完成后**留在对话框里**逐条列出服务端对每一格冲突配置的处理结果

  🔴 为什么阶段②必须是「留在对话框里」而不是 toast 一句「复制成功」：
     后端 /copy 走 insertNewVersion，全方法**不跑** validateDsl（S4b 的发布闸门在发布期，复制在建草稿期）
     ⟹ 复制可以产出一份**必然发不出去**的草稿而不报任何错。rewritten[] 是这一步**唯一**的用户可见信号，
     而且**没有任何端点能把它再取回来一次**（它不是落库字段，是 /copy 响应里的一次性载荷）。
     所以：关掉这个对话框 = 清单永久丢失。这也是下面 :close-on-click-modal / :close-on-press-esc
     都设成 false 的原因 —— 误点遮罩就把唯一的信号带走了。

  🔴 全部用文本插值渲染，不用 v-html：path / from / to / reason 都来自后端按 DSL 内容拼的字符串，
     里面有用户自己写的表名、表单编码、节点名。那些是数据不是标记。
     （webhook secret 那一格后端填的是掩码文案，真值永不进响应体，见 WorkflowCopyRewriter.Rewrite。）

  🔴 刻意**没有**「描述」输入框：后端 ReqVO 的语义是「留空 = 沿用源流程的描述」，
     对「复制」这个动作来说那正是默认想要的结果；多一框就多一处要想的事。
-->
<template>
  <el-dialog
    v-model="visible"
    :title="phase === 'form' ? '复制流程' : '复制完成：请逐条确认以下配置的处理结果'"
    width="720px"
    append-to-body
    :close-on-click-modal="false"
    :close-on-press-esc="false"
    data-testid="workflow-copy-dialog"
  >
    <!-- ==================== 阶段①：填新身份 ==================== -->
    <el-form
      v-if="phase === 'form'"
      ref="formRef"
      :model="form"
      :rules="rules"
      label-width="118px"
      :disabled="submitting"
    >
      <el-form-item label="源流程">
        <span class="wcd__source" data-testid="copy-source">{{ sourceLabel }}</span>
      </el-form-item>

      <el-form-item label="新编码" prop="newCode">
        <el-input
          v-model="form.newCode"
          placeholder="如 wf_plan_customer_copy"
          data-testid="copy-new-code"
          @input="scheduleDedup"
        />
        <!--
          🔴 查重走 /version-list?code=（selectListByCode 是 eq 精确匹配），
             **不走** /page?code=：后者的 mapper 是 likeIfPresent，返回的是「包含该子串」的超集，
             且分页会截断 ⟹ 用它判重会给出假阴/假阳两种错。
             精确 code 查询与后端 validateCodeNotUsed 的判据（selectCount(eq code) > 0）是同一个谓词。
          ⚠️ 这只是**提示**，不是强制点：权威仍是后端的 WORKFLOW_DEF_CODE_DUPLICATE。
             查重请求本身失败时显示「没查成」而不是「可用」—— 宁可让用户提交一次被后端拒，
             也不能拿一个没量到的结果冒充量到了。
        -->
        <div class="wcd__hint" data-testid="copy-code-dedup">
          <span v-if="dedup === 'checking'" class="wcd__hint--muted">正在查重…</span>
          <span v-else-if="dedup === 'taken'" class="wcd__hint--bad">
            这个编码已经有流程在用，换一个（编码相同会被当成同一条流程的新版本，不是复制）
          </span>
          <span v-else-if="dedup === 'error'" class="wcd__hint--muted">
            查重没查成，提交时由后端判定
          </span>
          <span v-else-if="dedup === 'free'" class="wcd__hint--ok">编码可用</span>
        </div>
      </el-form-item>

      <el-form-item label="新名称" prop="newName">
        <el-input v-model="form.newName" placeholder="如 客户跟进流程（副本）" data-testid="copy-new-name" />
      </el-form-item>

      <el-form-item label="自动改写冲突配置">
        <el-switch v-model="form.rewriteConflicts" data-testid="copy-rewrite-switch" />
        <!--
          🔴 这段说明刻意**只列稳定类别，不逐键枚举**：11 条规则的键名与后缀是后端
             WorkflowCopyRewriter 的常量，前端再抄一份键名清单就是 D7 说的第二份口径
             （后端加一条规则，这段文字就成了漏教的旧话）。
             逐格的权威答复永远来自复制后的 rewritten[]，也就是阶段②。
        -->
        <div class="wcd__hint">
          <template v-if="form.rewriteConflicts">
            <b>会改</b>：要建的数据表名、表单编码、BPM 流程 key、webhook 入站 path ——
            这些是平台级全局标识，原样抄一份就是两条流程抢同一个对象（建表撞名、表单互相覆盖、
            同一个匿名入口），而这些写操作<b>不可逆</b>。
            <br /><b>不会改，但会逐条提示</b>：审批流 key、子流程指向、表单事件订阅 ——
            复用源流程那一条通常正是复制的意图，所以保留原值，只在下面的清单里告诉你副本还指着谁。
            <br /><b>沿用源流程</b>：webhook 验签密钥（值不显示）、定时 cron 表达式 ——
            这两格复制后<b>照样生效</b>，清单里会明说：密钥从此多一份副本、
            两条流程会在同一时刻各自触发一次。
          </template>
          <template v-else>
            DSL 原样抄过去，<b>不做任何改写</b>。但清单照样逐格列出哪些配置会撞车、撞了会怎样 ——
            你选择自己处理，就更需要一份完整的待办。
          </template>
        </div>
      </el-form-item>

      <el-alert type="warning" :closable="false" show-icon class="wcd__warn">
        <template #title>复制出的是一份草稿，复制这一步不做发布体检</template>
        复制走的是「建新草稿」，不跑发布前那 19 条检查。也就是说，复制可以成功、
        而这份副本<b>将来发不出去</b>。下面的清单是你此刻唯一能看到的信号，请逐条读完。
      </el-alert>
    </el-form>

    <!-- ==================== 阶段②：改写清单 ==================== -->
    <template v-else-if="result">
      <el-alert :type="changed.length ? 'success' : 'info'" :closable="false" show-icon>
        <template #title>
          已复制为新草稿：{{ result.name }}（{{ result.code }}，v{{ result.version }}）
        </template>
        <div class="wcd__hint">
          草稿还<b>没有发布</b>，要在列表页对它点「发布」才会生效。
        </div>
      </el-alert>

      <!-- 🔴 两段分开列，靠 from === to 区分：把「服务端替你改了」和「刻意没改」混成一张表，
           用户会把后者当成已完成项划掉，而那恰恰是他必须自己处理的待办。 -->
      <div v-if="changed.length" class="wcd__sec">
        <div class="wcd__sec-title" data-testid="copy-changed-title">
          服务端替你改了 {{ changed.length }} 处（不改就会与源流程抢同一个对象）
        </div>
        <div v-for="(r, i) in changed" :key="'c' + i" class="wcd__row" data-testid="copy-rewrite-changed">
          <div class="wcd__reason">{{ r.reason }}</div>
          <div class="wcd__vals">
            <span class="wcd__from">{{ r.from }}</span>
            <span class="wcd__arrow">→</span>
            <span class="wcd__to">{{ r.to }}</span>
          </div>
          <div class="wcd__path">{{ r.path }}</div>
        </div>
      </div>

      <div v-if="kept.length" class="wcd__sec">
        <div class="wcd__sec-title wcd__sec-title--warn" data-testid="copy-kept-title">
          有 {{ kept.length }} 处刻意没改，但你需要知道
        </div>
        <div v-for="(r, i) in kept" :key="'k' + i" class="wcd__row wcd__row--kept" data-testid="copy-rewrite-kept">
          <div class="wcd__reason">{{ r.reason }}</div>
          <div class="wcd__vals">
            <span class="wcd__from">{{ r.from }}</span>
          </div>
          <div class="wcd__path">{{ r.path }}</div>
        </div>
      </div>

      <!--
        ⚠️ 空清单是**正常**的（一条纯 LLM 问答流程里没有任何会撞车的配置），
           但它与「清单不可用」（如 /validate 的 manifest === null）是两回事。
           所以这里的措辞是「没有需要处理的冲突配置」，绝不能写成「清单不可用」。
      -->
      <el-alert v-if="!changed.length && !kept.length" type="info" :closable="false" show-icon class="wcd__sec">
        <template #title>这份流程没有需要处理的冲突配置</template>
        它的 DSL 里没有建表、表单、BPM 流程或 webhook 入口这类平台级标识，复制品与源流程不会互相干扰。
      </el-alert>
    </template>

    <template #footer>
      <template v-if="phase === 'form'">
        <el-button
          type="primary"
          :loading="submitting"
          :disabled="dedup === 'taken'"
          data-testid="copy-submit"
          @click="handleSubmit"
        >
          开始复制
        </el-button>
        <el-button :disabled="submitting" @click="visible = false">取消</el-button>
      </template>
      <template v-else>
        <el-button type="primary" data-testid="copy-go-design" @click="handleGoDesign">去设计器完善</el-button>
        <el-button data-testid="copy-close" @click="visible = false">我已读完，关闭</el-button>
      </template>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import type { FormInstance, FormRules } from 'element-plus'
import { AgentWorkflowApi, type AgentWorkflowDefCopyResultVO } from '@/api/agent/workflow'

defineOptions({ name: 'WorkflowCopyDialog' })

/**
 * 复制只需要「源是哪一条」这三个字段，故不接整行的 `AgentWorkflowDefVO`。
 *
 * 🔴 刻意收窄而不是图省事：调用方有两个（列表页拿到整行、设计器只读态手里只有
 * `formData` 那几个字段）。要整行的话，设计器那边就得为打开一个对话框去凑一份假 VO
 * ——凑出来的字段一旦被这个组件用上，就成了「界面上写着、库里没有」的谎。
 *
 * 另：`<script setup>` 里不能写 ES module 导出，所以这个类型只能就地声明。
 */
interface CopySource {
  id: number
  code: string
  name: string
}

const emit = defineEmits<{
  /** 复制已落库（宿主据此刷新列表）。🔴 此时对话框**不关**，还要展示清单 */
  success: [result: AgentWorkflowDefCopyResultVO]
  /** 「去设计器完善」：只报新草稿的 id，跳到哪由宿主决定（同 PublishGateDialog） */
  design: [id: number]
}>()

const visible = ref(false)
const submitting = ref(false)
const phase = ref<'form' | 'result'>('form')
const formRef = ref<FormInstance>()
const source = ref<CopySource>()
const result = ref<AgentWorkflowDefCopyResultVO>()

const form = reactive({
  newCode: '',
  newName: '',
  rewriteConflicts: true
})

/** 查重三态 + 「没量到」。刻意不设「可用」的默认值：没查过就是没查过 */
const dedup = ref<'idle' | 'checking' | 'free' | 'taken' | 'error'>('idle')
let dedupTimer: ReturnType<typeof setTimeout> | undefined
/**
 * 🔴 请求序号，不是装饰：输入快时两个查重请求会并发，晚发的那个可能先回。
 * 只认「最新一次发出的请求」的结果，否则输入框里的编码和旁边的结论会各说各话。
 */
let dedupSeq = 0

const sourceLabel = computed(() =>
  source.value ? `${source.value.name}（${source.value.code}）` : ''
)
const changed = computed(() => (result.value?.rewritten ?? []).filter((r) => r.from !== r.to))
const kept = computed(() => (result.value?.rewritten ?? []).filter((r) => r.from === r.to))

const rules: FormRules = {
  newCode: [{ required: true, message: '新编码不能为空', trigger: 'blur' }],
  newName: [{ required: true, message: '新名称不能为空', trigger: 'blur' }]
  // 🔴 刻意不在这里校验编码格式：后端正则的 message 已经是给人看的中文，
  //    前端再抄一份 CODE_PATTERN 字面量，两处一漂就表现为「前端放过了、后端拒了」。
}

/** 输入停顿 400ms 才查：每敲一个字符打一次后端，换来的是列表页上肉眼看不出的收益 */
const scheduleDedup = () => {
  if (dedupTimer) clearTimeout(dedupTimer)
  const code = form.newCode.trim()
  if (!code) {
    dedupSeq++
    dedup.value = 'idle'
    return
  }
  dedup.value = 'checking'
  dedupTimer = setTimeout(async () => {
    const seq = ++dedupSeq
    try {
      const versions = await AgentWorkflowApi.getVersionList(code)
      if (seq !== dedupSeq) return
      dedup.value = versions?.length ? 'taken' : 'free'
    } catch {
      if (seq !== dedupSeq) return
      // 拦截器已经把后端的提示弹出去了（台账 #91：调用方拿不到 msg），这里只负责不撒谎
      dedup.value = 'error'
    }
  }, 400)
}

/**
 * 打开对话框（列表页「复制」/「复制为新草稿」，以及设计器只读态的「复制为新草稿」）。
 *
 * 🔴 每次 open 都整体重置：这个对话框会被同一页反复打开（复制一条、再复制另一条），
 * 残留上一份的 result 会让用户把 A 的改写清单读成 B 的。
 */
const open = (src: CopySource) => {
  source.value = src
  phase.value = 'form'
  result.value = undefined
  dedup.value = 'idle'
  dedupSeq++
  if (dedupTimer) clearTimeout(dedupTimer)
  form.newCode = `${src.code}_copy`
  form.newName = `${src.name}（副本）`
  form.rewriteConflicts = true
  visible.value = true
  // 预填的编码也要查一次：源流程叫 wf_x 而 wf_x_copy 已经存在（比如上次复制过一半）时，
  // 用户看到的应该是一条红字，而不是点「开始复制」后被后端拒。
  nextTick(scheduleDedup)
}

const handleSubmit = async () => {
  if (!source.value) return
  await formRef.value?.validate()
  submitting.value = true
  try {
    const data = await AgentWorkflowApi.copyDef({
      id: source.value.id,
      newCode: form.newCode.trim(),
      newName: form.newName.trim(),
      // 🔴 不传 newDescription：留空 = 沿用源流程的描述（后端 ReqVO 的语义）
      rewriteConflicts: form.rewriteConflicts
    })
    result.value = data
    phase.value = 'result'
    // 先让宿主刷新列表，再展示清单：清单是这一步唯一的信号，不能被 toast 抢走注意力，
    // 所以这里刻意**不**再 message.success（阶段②的 el-alert 就是那句「成功了」）
    emit('success', data)
  } catch {
    // 失败时停在阶段①：拦截器已弹出后端的具体原因（如「编码已存在」），
    // 这里再补一句「复制失败」只会盖掉它。表单内容也保持不动，用户改完直接重试。
  } finally {
    submitting.value = false
  }
}

const handleGoDesign = () => {
  const id = result.value?.id
  if (!id) return
  visible.value = false
  emit('design', id)
}

defineExpose({ open })
</script>

<style lang="scss" scoped>
.wcd__source {
  font-weight: 600;
}

.wcd__hint {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);

  &--ok {
    color: var(--el-color-success);
  }

  &--bad {
    color: var(--el-color-danger);
  }

  &--muted {
    color: var(--el-text-color-placeholder);
  }
}

.wcd__warn {
  margin-top: 4px;
}

.wcd__sec {
  margin-top: 12px;
}

.wcd__sec-title {
  margin-bottom: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--el-color-success);

  &--warn {
    color: var(--el-color-warning);
  }
}

.wcd__row {
  padding: 8px 10px;
  margin-bottom: 6px;
  background: var(--el-fill-color-lighter);
  border-left: 3px solid var(--el-color-success);
  border-radius: 4px;

  &--kept {
    border-left-color: var(--el-color-warning);
  }
}

/* 🔴 reason 排在最上面、字号最大：它是写给「要据此决定发不发布」的人看的，
   path 只是给需要去 DSL 里找那一格的人当坐标，不该抢在它前面 */
.wcd__reason {
  font-size: 13px;
  line-height: 1.6;
  word-break: break-word;
}

.wcd__vals {
  margin-top: 4px;
  font-family: var(--el-font-family-mono, monospace);
  font-size: 12px;
  word-break: break-all;
}

.wcd__from {
  color: var(--el-text-color-secondary);
  text-decoration: line-through;
}

.wcd__arrow {
  margin: 0 6px;
  color: var(--el-text-color-placeholder);
}

.wcd__to {
  font-weight: 600;
  color: var(--el-color-primary);
}

.wcd__path {
  margin-top: 2px;
  font-family: var(--el-font-family-mono, monospace);
  font-size: 11px;
  color: var(--el-text-color-placeholder);
  word-break: break-all;
}
</style>
