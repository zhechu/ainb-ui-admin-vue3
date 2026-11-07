<template>
  <Dialog v-model="dialogVisible" :title="dialogTitle" width="720" :close-on-click-modal="false">
    <!--
      🔴 §11.9.2.6 第 5 条要求弹层明写「将记录到 qlzg_review_waiver，操作人：张三（技术负责人），
         生效范围：本机构之后新建的所有报告」。这里**刻意没有**那个括号里的角色名：
         前端只拿得到角色**码**（`useUserStore().roles` 是 `TECH_LEAD` 这种串），
         而这一行要在 30 年后被念出来。后端 `QlzgReviewWaiverServiceImpl#snapshotRoles`
         存的是**当时的角色名快照**（存 id 会随角色表漂移、存 code 念出来是给机器看的串），
         它只在变更**之后**才存在。前端自己拿码去拼一个名字，就会与那一列的快照分叉 ——
         而分叉的两处都返回 200
    -->
    <el-alert type="info" :closable="false" show-icon class="mb-12px">
      <div class="alert-text">
        将记录到 <span class="mono">qlzg_review_waiver</span>，操作人：<b>{{ operatorName }}</b
        >，生效范围：<b>{{ ctx.scopeLabel }}</b>
      </div>
      <div class="alert-sub">
        理由与你当时看到的告知文案会<b>逐字</b>落库，保存 30 年。口头或线下审批不能代替它。
      </div>
    </el-alert>

    <div class="current-row">
      <span class="field-label">当前档位</span>
      <el-tag :type="reviewModeTagType(ctx.currentEffectiveMode)" size="small">
        {{ labelOf(REVIEW_MODE_OPTIONS, ctx.currentEffectiveMode) }}
      </el-tag>
      <span class="current-consequence">
        {{ reviewModeConsequence(ctx.currentEffectiveMode) }}
      </span>
    </div>

    <!--
      🔴 §11.9.2.6 第 2 条：后果必须写在**选项上**，不是只写档位名。
         「提示必须是决策点上的提示，不是文档里的提示」——
         用户在选的那一刻看到的文字，才是唯一有效的告知。
         所以三档各占一整行，名字下面紧跟一句后果，OFF 那句用危险色
    -->
    <div class="field-label mt-12px">改成</div>
    <div class="mode-list">
      <div
        v-for="opt in modeOptions"
        :key="opt.value"
        class="mode-row"
        :class="{ 'mode-row-on': formData.reviewMode === opt.value }"
      >
        <el-radio v-model="formData.reviewMode" :value="opt.value">
          <span class="mode-name">{{ opt.label }}</span>
          <span v-if="opt.code" class="mono mode-code">{{ opt.code }}</span>
        </el-radio>
        <div class="mode-consequence" :class="{ 'mode-consequence-off': opt.value === 'OFF' }">
          {{ opt.consequence }}
        </div>
      </div>
    </div>
    <div v-if="!formData.reviewMode" class="hint-line">请选择目标档位。</div>
    <!--
      🔴 这一条**可以**在前端拦，与理由那一格相反：后端 `assertChanged` 排在
         `assertProcedurallyCompleteAndTrace` **之前**，「档位没变」那次尝试压根不留痕，
         所以拦下它不丢任何档案。而放过它的产出是一次必然失败的往返 +
         一句「功能坏了」的印象（判据见 reviewFlow 的 reviewModeUnchanged）
    -->
    <div v-else-if="unchanged" class="problem-line">
      目标档位与当前档位相同，后端会判「档位没有变化」并拒绝，那一次不会留下任何记录。
    </div>

    <!--
      🔴 这一段**按级分两支**，因为两级说的是相反的事：
         机构级 / 项目级是「只对之后新建的报告生效」（§11.9.2.6 第 7 条），
         而报告级改的**就是这一份自己**、生效档位立刻重算
         （QlzgReportReviewModeSaveVO 的注释：三级里唯一会重算 review_mode_effective 的一级）。
         共用一句话的话，报告级弹层会印一句「仅对之后新建的报告生效」——
         而用户手上这一份正是被改的那一份，他会据此以为「那我这份还是老样子」，
         于是白改一次、或者反过来以为改不动而去动机构级配置
    -->
    <el-alert v-if="isReportLevel" type="warning" :closable="false" show-icon class="mt-12px">
      <div class="alert-text">
        改的就是<b>这一份报告自己</b>：生效档位立刻重算，三级里唯一会重算的一级。
      </div>
      <div class="alert-sub">
        别的报告、以及本项目下之后新建的报告都不受影响（它们各自在创建那一刻解析档位）。
        已经交出去的那一版<b>不会被收回来</b>：定稿之后再退回修订、再改档位，
        只影响<b>下一次</b>定稿时那一道闸 C。
      </div>
    </el-alert>
    <!--
      🔴 §11.9.2.6 第 7 条：这句必须写出来，且 N 要**实时**查。
         不写的话用户会以为「关掉就能让我手上这份过」。
         ⚠️ N 与当前档位必须来自**同一次** /config/org 请求（后端刻意把它们放进一个端点）：
            拆成两个请求的话，中间插进一次建报告，用户看到的就是
            「档位说 ADVISORY、N 说 3」而清单里只有 2 份 —— 两处对不上时用户会认为界面在胡说。
            所以本弹层**不自己取数**，由调用方在 open() 时把刚读回来的那一整份传进来
    -->
    <el-alert v-else type="warning" :closable="false" show-icon class="mt-12px">
      <div class="alert-text">
        仅对之后新建的报告生效<template v-if="draftCount != null"
          >，已在编制的 <b>{{ draftCount }}</b> 份报告不受影响</template
        >。
      </div>
      <div class="alert-sub">
        一份报告的复核档位在它<b>创建那一刻</b>就冻结了。
        <!--
          🔴 N 取不到时**不给「关掉刷新」这种出路**：项目级那个调用方是**刻意**传 null 的
             （数在编份要读报告清单，那要 qlzg:report:query，
             而持有 qlzg:review:config 的人不一定有它），刷新多少次都还是 null。
             指一条走不通的路，比留一个空格更坏 —— 用户会照做，然后认为界面在胡说
        -->
        <template v-if="draftCount == null">
          在编份数这次没取到（读不到报告清单时就是这样，例如当前登录人没有报告查询权限）。
          它不影响本次变更：改这里不会追溯到任何一份已经存在的报告。
        </template>
        <template v-else> 改这里不会让你手上正在编的那一份过关。 </template>
      </div>
    </el-alert>

    <!--
      🔴 §11.9.2.6 第 6 条：法定评估项目的入口**不置灰**，改成红色警示区 + 必须勾选 +
         告知文案逐字快照。「置灰会被理解成『功能坏了』，勾选确认才是『你决定、你担责』」。
         V4 那道 `REVIEW_MODE_LOCKED_STATUTORY` 硬锁在 V5 已整条撤回：
         `is_statutory` 是客户自己填的 flag，硬锁只拦住诚实的人，它是剧场不是控制
    -->
    <el-alert v-if="ackRequired" type="error" :closable="false" show-icon class="mt-12px">
      <template #title>本次变更涉及法定评估业务</template>
      <!--
        🔴 逐字渲染，**不用 v-html**、也不改写一个字：
           这段文本会被后端从同一个常量快照进 ack_text，
           而测试 #34④ 断言「落库内容与当时界面文案逐字相等」。
           前端改一个字就等于让那条断言在真机上不成立，而这件事没有任何一处会报错
      -->
      <div class="ack-text">{{ ctx.noticeText }}</div>
      <el-checkbox v-model="formData.statutoryAcknowledged" class="mt-8px">
        我已阅读并确认上述告知
      </el-checkbox>
      <!--
        🔴 这个勾选框**不禁用提交按钮**，与理由那一格同一条判据：
           「法定业务 + 目标不是 ENFORCE + 没勾」在后端走的是同一条 traceRejection 路径 ——
           先写一行 rejected = 1 的留痕、再抛 REVIEW_WAIVER_ACK_REQUIRED。
           前端替它拦掉，那一行就再也不会被写下来，
           而它记的正是「有人想在没读告知的情况下关掉法定项目的机器复核」
      -->
      <div class="alert-sub">
        不勾选就提交会被拒绝，并留下一行「已被程序性拒绝」的记录 —— 那一行同样是档案的一部分。
      </div>
    </el-alert>
    <el-alert
      v-else-if="ctx.statutory === true"
      type="info"
      :closable="false"
      show-icon
      class="mt-12px"
    >
      <div class="alert-text">本机构名下有法定评估项目。</div>
      <div class="alert-sub"> 本次目标仍然是强制复核，没有放弃任何控制，所以不需要勾选告知。 </div>
    </el-alert>

    <div class="field-label mt-12px">变更理由</div>
    <el-input
      v-model="formData.reason"
      type="textarea"
      :rows="4"
      :maxlength="REVIEW_REASON_MAX_LENGTH"
      show-word-limit
      placeholder="写清这一次为什么要改档位。这一段会逐字落进档案，30 年后要能靠它回答「谁在什么时候决定的」"
    />
    <!--
      🔴 少于 10 字是**橙色**提示、且**不禁用**提交；空白与超上限才是红色 + 禁用。
         差别不在字数，在「后端会不会为这次尝试写一行 rejected = 1 的留痕」：
         空白撞 @NotBlank、超上限撞 @Size(max = 500)，两道都是 Bean Validation，
         在进 Controller 之前就把请求打回去，那次尝试一个字都留不下来 —— 前端拦下不丢东西；
         而「少于 10 字」后端刻意放在 Service 里判，就是为了先留痕再抛异常。
         前端在这里禁用按钮，等于把「有人在赶稿时想关掉复核」这条记录从档案里抹掉，
         而抹掉之后没有任何一处会报错（判据见 reviewFlow 的 reviewReasonBlocksSubmit）
    -->
    <div v-if="reasonProblem" class="problem-line" :class="{ 'problem-line-warn': !reasonBlocks }">
      {{ reasonProblem }}
    </div>
    <div v-else class="hint-line">
      至少 {{ REVIEW_REASON_MIN_LENGTH }} 个字，最多 {{ REVIEW_REASON_MAX_LENGTH }} 个字符。
    </div>

    <!--
      🔴 「确认变更」**不禁用**在勾选告知这一支上，只禁用在三件事上：
         没选档位、档位没变、理由撞 Bean Validation。
         三件都是「后端压根不写留痕」的场合，拦下不丢档案（判据见 reviewReasonBlocksSubmit）
    -->
    <template #footer>
      <el-button type="primary" :disabled="!canSubmit" :loading="submitting" @click="submitForm">
        确认变更
      </el-button>
      <el-button :disabled="submitting" @click="dialogVisible = false">取消</el-button>
    </template>
  </Dialog>
</template>
<script lang="ts" setup>
import { QlzgReviewConfigApi, type QlzgReviewModeSaveVO } from '@/api/qlzg/reviewConfig'
// 🔴 store **不在自动导入清单里**（自动导入只收 Vue/vue-router API、useI18n、useMessage、
//    useTable、useCrudSchemas、DICT_TYPE 与 src/components/** 下的组件），漏掉这一行
//    的表现是「ReferenceError」—— 而它只在真打开弹层那一刻才发生，类型检查与单测都不响
import { useUserStore } from '@/store/modules/user'
import {
  REVIEW_INHERIT,
  REVIEW_INHERIT_LABEL,
  REVIEW_INHERIT_LABEL_REPORT,
  REVIEW_MODE_OPTIONS,
  REVIEW_REASON_MAX_LENGTH,
  REVIEW_REASON_MIN_LENGTH,
  WAIVE_SCOPE_OPTIONS,
  labelOf,
  reviewModeConsequence,
  reviewModeTagType
} from '@/views/qlzg/constants'
import {
  resolvedTargetModeOf,
  reviewInheritAvailable,
  reviewModeUnchanged,
  reviewReasonBlocksSubmit,
  reviewReasonProblem,
  statutoryAckRequired,
  type ReviewModeLevel
} from './reviewFlow'

/**
 * 变更复核档位的弹层 —— 三级**共用一个**（§11.9.2.6）
 *
 * <h3>🔴 为什么三级共用，而不是各写一个</h3>
 * 三级的差别只有两处：机构级没有「跟随上级」这一项、
 * 项目级 / 报告级各自要带 {@code projectId} / {@code reportId}。
 * 写成三个弹层的话，§11.9.2.6 第 2 条那三句后果文案与第 7 条那句
 * 「仅对之后新建的报告生效」就会有三份拷贝 ——
 * 而它们是「用户在选的那一刻看到的文字」，是唯一有效的告知。
 * 三份拷贝里改掉一份，两个入口就开始对同一件事说不同的话，而两处都返回 200
 *
 * <h3>🔴 本弹层**不自己取数**，全部由 {@link open} 的入参带进来</h3>
 * 尤其是 {@code draftReportCount} 与 {@code currentEffectiveMode}：
 * 后端刻意把它们放进 {@code /config/org} 一个端点，就是为了让这两个数**同刻**。
 * 弹层自己再打一次请求的话，「同刻」这个保证就没了，而它是第 7 条那句话唯一的价值。
 * 所以调用方的写法是「先 await 一次 /config/org，再 open(那一整份)」，
 * 不是「open() 之后弹层自己去读」
 *
 * <h3>🔴 {@code currentEffectiveMode} 要传**解析后**的档位</h3>
 * 机构级就是 {@code /config/org} 的 {@code reviewMode}（后端已经过了 {@code of()}）；
 * 项目级 / 报告级要传 {@code review_mode_effective} 那一类解析结果，
 * <b>不是</b> {@code qlzg_project.review_mode} 的字面值 —— 那一列可空，
 * 空值的含义是「跟着上一级走」，按字面值比会把「已经是继承、又提交一次 INHERIT」
 * 判成一次变更，正是后端注释里点名要避免的那件事
 *
 * <h3>🔴 失败也要 {@code emit('rejected')}，让调用方刷新历史</h3>
 * 后端对「理由少于 10 字」「法定业务没勾告知」两类是
 * <b>先写一行 {@code rejected = 1} 的留痕、再抛异常</b>的。
 * 只在成功时刷新的话，用户被拒一次、关掉弹层，历史列表里就少了刚写下的那一行 ——
 * 而那一行正是「有人在赶稿时想关掉复核」的记录
 *
 * @author 走进新时代
 */
defineOptions({ name: 'QlzgReviewModeChangeDialog' })

/**
 * {@link open} 的入参
 *
 * ⚠️ 这个类型**刻意不导出**：调用方通过 {@code dialogRef.value.open({...})} 传对象字面量，
 *    与本仓其它弹层（{@code CaseSourceForm} / {@code ReportForm}）同一条形状。
 *    跨 {@code defineExpose} 的类型在 .vue 之间本来就传不出去，
 *    硬要导出一份就得再建一个 .ts —— 而那份与这里的字段清单是同一个事实的两份拷贝
 */
interface ReviewModeChangeContext {
  /** 改的是三级里的哪一级 */
  level: ReviewModeLevel
  /**
   * 生效范围那句话的后半截，逐字写清楚。
   * 例：机构级「本机构之后新建的所有报告」、报告级「仅本报告」
   */
  scopeLabel: string
  /** 解析后的当前档位，见类注释第三条 */
  currentEffectiveMode?: string | null
  /** 本次变更涉不涉及法定评估业务（决定红色警示区可不可见） */
  statutory?: boolean | null
  /** 告知文案，逐字渲染。后端 /config/org 或 /config/notice 下发的那一份 */
  noticeText?: string | null
  /** 不受本次变更影响的在编报告数，必须与 currentEffectiveMode 同刻取回 */
  draftReportCount?: number | null
  /** 选「跟随上级」时会解析成哪一档。缺值时那一项的后果文案会如实说「没取到」 */
  inheritResolvesTo?: string | null
  /** level = PROJECT 时必填 */
  projectId?: number
  /** level = REPORT 时必填 */
  reportId?: number
}

const emit = defineEmits(['success', 'rejected'])
const message = useMessage()
const userStore = useUserStore()

const dialogVisible = ref(false)
const submitting = ref(false)
const ctx = ref<ReviewModeChangeContext>({ level: 'ORG', scopeLabel: '' })

const formData = ref({
  reviewMode: '' as string,
  reason: '',
  statutoryAcknowledged: false
})

const dialogTitle = computed(
  () => `变更复核档位 —— ${labelOf(WAIVE_SCOPE_OPTIONS, ctx.value.level)}级`
)

/**
 * 操作人昵称。
 *
 * 🔴 取不到时显示「当前登录人」而不是空白：这一句是 §11.9.2.6 第 5 条要求弹层明写的内容，
 *    空着一个位置会让人以为「这一行不会记人」—— 而它一定会记，
 *    后端 {@code requireLoginUserId} 拿不到登录上下文时是**响亮地**抛异常的
 */
const operatorName = computed(() => userStore.getUser?.nickname || '当前登录人')

const draftCount = computed(() => ctx.value.draftReportCount ?? null)

/**
 * 是不是报告级。生效范围那段话与成功那句 toast 都按它分两支
 *
 * 🔴 报告级是三级里**唯一**会重算 {@code review_mode_effective} 的一级 ——
 *    改的就是用户手上这一份，而不是「之后新建的」。所以那一支不能说
 *    「仅对之后新建的报告生效」，成功那句也不能说「已在编的报告不受影响」：
 *    被改的正是已在编的（甚至已定稿的）那一份。
 *    说错方向的后果是用户以为白改了一次，于是转而去动机构级配置 ——
 *    那一次会落到本项目之后**所有**新建的报告上，是比原问题大得多的动作
 */
const isReportLevel = computed(() => ctx.value.level === 'REPORT')

/**
 * 选「跟随上级」时解析成哪一档
 *
 * 🔴 后端 {@code assertChanged} 与留痕行的 {@code to_mode} 用的都是**解析后**的值，
 *    所以前端要预判「档位没变」与「要不要勾告知」，就必须先做同一次解析
 */
const resolvedTarget = computed(() =>
  resolvedTargetModeOf(formData.value.reviewMode, ctx.value.inheritResolvesTo)
)

const unchanged = computed(() =>
  reviewModeUnchanged(ctx.value.currentEffectiveMode, resolvedTarget.value)
)

const ackRequired = computed(() => statutoryAckRequired(ctx.value.statutory, resolvedTarget.value))

const reasonProblem = computed(() => reviewReasonProblem(formData.value.reason))
const reasonBlocks = computed(() => reviewReasonBlocksSubmit(formData.value.reason))

const canSubmit = computed(
  () => !!formData.value.reviewMode && !unchanged.value && !reasonBlocks.value
)

/** 「跟随上级」那一项的后果文案：必须把**会变成哪一档**说出来 */
const inheritConsequence = computed(() => {
  const resolved = ctx.value.inheritResolvesTo
  if (resolved == null || resolved === '') {
    return (
      '清空本级配置，之后新建的报告跟随上一级 —— ' +
      '上一级现在是什么档位这次没取到，请关掉弹层刷新一次再选'
    )
  }
  return (
    `清空本级配置，之后新建的报告跟随上一级，也就是「${labelOf(REVIEW_MODE_OPTIONS, resolved)}」` +
    `（${reviewModeConsequence(resolved)}）`
  )
})

const modeOptions = computed(() => {
  const base = REVIEW_MODE_OPTIONS.map((opt) => ({
    value: opt.value,
    label: opt.label,
    code: opt.value,
    consequence: reviewModeConsequence(opt.value)
  }))
  if (!reviewInheritAvailable(ctx.value.level)) return base
  // 🔴 机构级压根走不到这里：机构级 review_mode 是 NOT NULL DEFAULT 'ADVISORY'，
  //    它没有上一级。传 INHERIT 的后果与传任何一个错字相同 —— of() 按「配置坏了」
  //    回落 ENFORCE，于是档位被改成最严的一档、留痕如实记下 to_mode = 'ENFORCE'
  return [
    ...base,
    {
      value: REVIEW_INHERIT,
      label: ctx.value.level === 'REPORT' ? REVIEW_INHERIT_LABEL_REPORT : REVIEW_INHERIT_LABEL,
      code: '',
      consequence: inheritConsequence.value
    }
  ]
})

const open = (context: ReviewModeChangeContext) => {
  ctx.value = context
  formData.value = { reviewMode: '', reason: '', statutoryAcknowledged: false }
  dialogVisible.value = true
}
defineExpose({ open })

const submitForm = async () => {
  // 🔴 statutoryAcknowledged 一律送**布尔**，不送 undefined：
  //    后端那一个字段是 @NotNull，缺了会被 Bean Validation 打回去，
  //    而那句报错是「请明确勾选或取消勾选法定评估告知」—— 用户眼前的勾选框明明是取消状态
  const payload: QlzgReviewModeSaveVO = {
    reviewMode: formData.value.reviewMode,
    reason: formData.value.reason,
    statutoryAcknowledged: formData.value.statutoryAcknowledged
  }
  submitting.value = true
  try {
    let waiverId: number
    if (ctx.value.level === 'PROJECT') {
      waiverId = await QlzgReviewConfigApi.changeProjectMode({
        ...payload,
        projectId: ctx.value.projectId!
      })
    } else if (ctx.value.level === 'REPORT') {
      waiverId = await QlzgReviewConfigApi.changeReportMode({
        ...payload,
        reportId: ctx.value.reportId!
      })
    } else {
      waiverId = await QlzgReviewConfigApi.changeOrgMode(payload)
    }
    // 🔴 成功那句话**再念一遍**范围，理由与弹层里那段生效范围相同：
    //    那段话写在弹层里，而用户点完确认的那一刻弹层就关了 ——
    //    最容易记错方向的正是这一刻。
    //    报告级**不能**念「已在编的报告不受影响」：被改的恰恰是已在编的这一份。
    //    念错方向的后果不是「多读一句废话」，而是用户以为刚才那一下没生效，
    //    于是转而去动机构级配置 —— 那一次会落到本机构之后**所有**新建的报告上
    message.success(
      isReportLevel.value
        ? `档位已变更（留痕编号 ${waiverId}）。本报告的生效档位已重算，定稿时按新档位过闸`
        : `档位已变更（留痕编号 ${waiverId}）。已在编的报告不受影响`
    )
    dialogVisible.value = false
    emit('success')
  } catch {
    // 🔴 失败也要 emit('rejected')：这一次很可能已经写下了一行 rejected = 1 的留痕，
    //    调用方刷新之后它才看得见（见类注释第四条）
    // 🔴 **不 rethrow、也不补一句自己的报错**：本函数是 @click 的处理器，
    //    抛出去只会变成一条 unhandled rejection；而后端那句原文 axios 拦截器已经弹出来了，
    //    「理由至少 10 个字」与「请先勾选告知」这两句正是要让用户逐字读到的东西，
    //    再叠一句「提交失败，请稍后再试」就把它们盖掉了
    emit('rejected')
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

.field-label {
  font-size: 13px;
  font-weight: bold;
}

.current-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.current-consequence {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.mode-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mode-row {
  padding: 10px 14px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
}

.mode-row-on {
  background: var(--el-color-primary-light-9);
  border-color: var(--el-color-primary);
}

.mode-name {
  font-size: 14px;
  font-weight: bold;
}

.mode-code {
  margin-left: 8px;
  font-size: 11px;
  color: var(--el-text-color-placeholder);
}

.mode-consequence {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}

.mode-consequence-off {
  color: var(--el-color-danger);
}

.ack-text {
  font-size: 13px;
  line-height: 1.8;
  white-space: pre-wrap;
}

.hint-line {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}

.problem-line {
  padding: 6px 10px;
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-color-danger);
  background: var(--el-color-danger-light-9);
  border-radius: 4px;
}

.problem-line-warn {
  color: var(--el-color-warning);
  background: var(--el-color-warning-light-9);
}

.mono {
  font-family: var(--el-font-family-mono, monospace);
}
</style>
