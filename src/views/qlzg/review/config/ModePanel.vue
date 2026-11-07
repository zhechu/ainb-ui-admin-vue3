<template>
  <div v-loading="loading">
    <!--
      🔴 §11.9.2.6 第 1 条：本面板刻意**不在**报告页上，而是挂在「系统管理 → 机构内控配置」下。
         「走过去的那一段路本身就是保护」—— 报告页上一个能改档位的下拉，
         会在赶稿的那一刻被点掉，而赶稿正是这个决定最需要被慎重对待的时刻。
         所以这里不给「快捷入口」，也不要在报告页上补一个跳过来的按钮
    -->

    <!-- ==================== 当前档位 ==================== -->
    <div class="mode-head">
      <div class="mode-head-main">
        <span class="field-label">本机构当前档位</span>
        <el-tag :type="reviewModeTagType(config?.reviewMode)" size="large" effect="dark">
          {{ labelOf(REVIEW_MODE_OPTIONS, config?.reviewMode) }}
        </el-tag>
        <span class="mode-head-code mono">{{ config?.reviewMode }}</span>
      </div>
      <div class="mode-head-consequence">
        {{ reviewModeConsequence(config?.reviewMode) }}
      </div>
    </div>

    <!--
      🔴 「从来没做过这个决定」与「决定过、决定的是提示档」是两件不同的事，
         而两者在界面上如果都只显示一个 ADVISORY 的 tag 就分不出来。
         监管问的恰恰是前一句：「你们做过这个决定吗」
    -->
    <el-alert v-if="config && config.configured !== true" type="info" :closable="false" show-icon>
      <div class="alert-text">本机构<b>从未</b>做过复核档位的决定。</div>
      <div class="alert-sub">
        现在生效的是平台默认档位
        <b>{{ labelOf(REVIEW_MODE_OPTIONS, config.platformDefault) }}</b
        >（{{ reviewModeConsequence(config.platformDefault) }}）。
        下面那个「变更档位」按钮点下去之后，这一行才算「本机构做过决定」， 而那一刻会写进
        <span class="mono">qlzg_review_waiver</span>。
      </div>
    </el-alert>

    <!--
      🔴 这两条是**完整性告警**，不是「配置坏了」的泛泛提示。
         它们对应的只有一种情况：有人绕过 QlzgReviewModeService 直接改了库里那一列。
         此时闸 C 会在定稿那一刻抛 REVIEW_OFF_UNTRACED（「无法回答谁在什么时候决定不跑」），
         而用户完全无从下手 —— 所以在配置页上先把这件事说出来，
         并且**指明是哪一处对不上**，不要只写「配置异常，请联系管理员」
    -->
    <el-alert v-if="traceState === 'NO_TRACE'" type="error" :closable="false" show-icon>
      <div class="alert-text">配置行存在，但<b>找不到授权它的变更记录</b>。</div>
      <div class="alert-sub">
        正常操作走不到这一支：改档位的 Service 在同一个事务里撤销旧记录、插入新记录、
        最后才改配置列。走到这里说明
        <span class="mono">qlzg_org_review_config.review_mode</span> 被人绕过 Service 直接改过。<b
          >在这一行被修好之前，本机构的报告定稿时会报 「无法回答谁在什么时候决定不跑」。</b
        >
      </div>
    </el-alert>
    <el-alert v-else-if="traceState === 'MISMATCH'" type="error" :closable="false" show-icon>
      <div class="alert-text">当前档位与变更记录<b>说的是两件不同的事</b>。</div>
      <div class="alert-sub">
        生效中的那行变更记录写的是
        <b>{{ labelOf(REVIEW_MODE_OPTIONS, effectiveWaiver?.toMode) }}</b
        >，而配置列现在是 <b>{{ labelOf(REVIEW_MODE_OPTIONS, config?.reviewMode) }}</b
        >。两者由同一次操作写下、本该逐字相等。 请以变更记录为准去核对是谁改的 —— 配置列可能被人绕过
        Service 直接改过。
      </div>
    </el-alert>

    <!-- ==================== 责任落点：生效中的那行变更记录 ==================== -->
    <!--
      🔴 这一段的**人 / 时间 / 理由**一律取自变更记录，不取配置行上的 updatedByNickname。
         后端 QlzgOrgReviewConfigMapper#casReviewMode 的注释原话是
         「本表只有一行、会被反复覆盖，而『谁在什么时候关的』这个问题的答案在留痕表里，
         不在这里 —— 所以别把这一列当成责任落点来读」。
         显示它的话，一个改了三次档位的机构只会记住最后那个人，
         而 30 年后要回答的恰恰是「关掉的那一次是谁做的」
    -->
    <div class="section-title">这次决定是谁做的</div>
    <div v-if="effectiveWaiver" class="effective-box">
      <div class="effective-row">
        <span class="field-label">操作人</span>
        <span>{{ effectiveWaiver.waivedByNickname || '（查不到用户）' }}</span>
        <span v-if="effectiveWaiver.waivedByRole" class="role-tag">
          {{ effectiveWaiver.waivedByRole }}
        </span>
      </div>
      <div class="effective-row">
        <span class="field-label">决定时间</span>
        <span>{{ formatDate(effectiveWaiver.createTime) }}</span>
      </div>
      <div class="effective-row">
        <span class="field-label">当时的变更</span>
        <span>
          {{ labelOf(REVIEW_MODE_OPTIONS, effectiveWaiver.fromMode) }}
          <span class="arrow">→</span>
          {{ labelOf(REVIEW_MODE_OPTIONS, effectiveWaiver.toMode) }}
        </span>
      </div>
      <div class="effective-row effective-row-top">
        <span class="field-label">理由（逐字）</span>
        <span class="verbatim">{{ effectiveWaiver.reason }}</span>
      </div>
      <div v-if="effectiveWaiver.ackText" class="effective-row effective-row-top">
        <span class="field-label">当时看到的告知</span>
        <!--
          🔴 ackText 是**当时那一刻**的文案，不是今天这份（常量改过就会不同，而两者都对）。
             逐字渲染、white-space: pre-wrap、不用 v-html：
             「他当时看到的是什么」这个问题只有这一列能回答
        -->
        <span class="verbatim verbatim-ack">{{ effectiveWaiver.ackText }}</span>
      </div>
    </div>
    <div v-else class="hint-line">
      {{
        config && config.configured === true
          ? '（见上面那条告警）'
          : '还没有人做过这个决定，所以这一栏是空的。'
      }}
    </div>

    <!-- ==================== 法定评估业务 ==================== -->
    <!--
      🔴 §11.9.2.6 第 6 条要求的是**红色警示区 + 必须勾选**，而它住在弹层里（决策点上）。
         本面板这一格只是让人在点之前就知道「本机构名下有法定评估项目」，
         所以用 info 而不是 error —— 真正的红区在弹层里，两处都红等于两处都不红
    -->
    <div class="section-title">法定评估业务</div>
    <el-alert v-if="config?.statutory === true" type="warning" :closable="false" show-icon>
      <div class="alert-text">本机构名下有非作废的法定评估项目。</div>
      <div class="alert-sub">
        把档位改到<b>强制复核以外</b>的任何一档，都必须在弹层里勾选一份告知，
        而那份告知的原文会被<b>逐字</b>快照进档案。
        <template v-if="config?.statutoryLockNoticeAt">
          首次配置时已经弹过一次告知（{{ formatDate(config.statutoryLockNoticeAt) }}）。
        </template>
        <template v-else> 本机构还没有弹出过首次告知。 </template>
      </div>
    </el-alert>
    <el-alert v-else type="info" :closable="false" show-icon>
      <div class="alert-text">本机构名下目前没有非作废的法定评估项目。</div>
      <div class="alert-sub">
        变更档位时不需要勾选告知。
        <b>建了一个法定评估项目之后这一句会自动变成上面那条黄色提示</b>，
        它是每次打开本页时现算的，不是一列存着的开关。
      </div>
    </el-alert>

    <!-- ==================== 变更历史 ==================== -->
    <!--
      🔴 §11.9.2.6 第 4 条那句「查看变更记录」在报告页的灰条上，指的就是这一段。
         而它**含**被程序性拒绝的行（后端 /waiver/org-list 刻意不过滤）：
         一行 rejected = 1 记的是「有人在赶稿时想关掉复核」，
         而本列表是它唯一会被看见的地方 —— 折叠进「更多」等于回到过滤掉
    -->
    <div class="section-title section-title-row">
      <span>变更历史（含被拒绝的尝试）</span>
      <div>
        <el-button size="small" @click="loadAll">刷新</el-button>
        <el-button
          size="small"
          type="primary"
          @click="openChangeDialog"
          v-hasPermi="['qlzg:review:config']"
        >
          变更档位
        </el-button>
      </div>
    </div>
    <el-table :data="history" class="xpy-list-table" stripe size="small">
      <el-table-column type="expand">
        <template #default="scope">
          <div class="expand-box">
            <div class="expand-row">
              <span class="field-label">理由（逐字，落库原文）</span>
              <span class="verbatim">{{ scope.row.reason || '（这一行没有理由）' }}</span>
            </div>
            <div v-if="scope.row.ackText" class="expand-row">
              <span class="field-label">当时看到的告知（逐字快照）</span>
              <span class="verbatim verbatim-ack">{{ scope.row.ackText }}</span>
            </div>
            <div v-else class="expand-row">
              <span class="field-label">当时看到的告知</span>
              <span class="form-hint">
                这一行没有告知快照。它只在「法定评估业务 + 目标不是强制复核 +
                <b>确实勾了</b>」三条同时成立时才写，被程序性拒绝的行<b>一律</b>为空。
                所以为空<b>不代表</b>当时没弹告知 —— 弹没弹由下面那一格「勾选框状态」回答。
              </span>
            </div>
            <!--
              🔴 这一格刻意把「记录答不出来的那一部分」也说出来。
                 提交上来的 statutoryAcknowledged 是一个 @NotNull 的布尔，
                 而 false 对应**两种**情况：告知框摆在那里没勾，
                 或者那一次压根没有告知框（当时不涉及法定评估业务，或目标就是强制复核）。
                 留痕表里没有「当时涉不涉及法定业务」这一列，所以从这一行分不开。
                 写成一句「未勾选」的话，读者会以为那人看见了一个框并且没勾 ——
                 一个档案页上的假事实，比一句「这里分不开」坏得多
            -->
            <div class="expand-row">
              <span class="field-label">告知勾选</span>
              <span class="form-hint">
                <template v-if="scope.row.statutoryAcknowledged === true">
                  提交时「我已阅读并确认告知」是<b>勾选的</b>，
                  所以这一次确实摆出了告知框、并且被确认过。
                </template>
                <template v-else>
                  提交时那一个布尔是<b>false</b>。它有两种可能：告知框摆在那里没勾，
                  或者那一次压根没有告知框（当时不涉及法定评估业务，或目标就是强制复核）。
                  留痕行里没有「当时涉不涉及法定业务」这一列，所以从这一行分不开。
                </template>
              </span>
            </div>
            <div class="expand-row">
              <span class="field-label">生效区间</span>
              <span class="form-hint">
                {{ formatDate(scope.row.effectiveFrom) }}
                <template v-if="scope.row.effectiveTo">
                  → {{ formatDate(scope.row.effectiveTo) }}（已被后一次变更改回）
                </template>
                <template v-else-if="scope.row.rejected !== true"> → 长期有效 </template>
                <template v-else> （从未生效） </template>
              </span>
            </div>
            <!--
              🔴 撤销时 revokedBy / waiveReason 两列**保留**，清空那两列等于销毁一段留痕。
                 「关掉过、后来改回来了」这一段必须读得出来
            -->
            <div v-if="scope.row.revokedAt" class="expand-row">
              <span class="field-label">被谁改回</span>
              <span class="form-hint">
                {{ scope.row.revokedByNickname || '（查不到用户）' }} 于
                {{ formatDate(scope.row.revokedAt) }}
              </span>
            </div>
            <div class="expand-row">
              <span class="field-label">留痕编号</span>
              <span class="mono form-hint">#{{ scope.row.id }}</span>
            </div>
          </div>
        </template>
      </el-table-column>
      <el-table-column
        label="时间"
        prop="createTime"
        width="160"
        align="center"
        :formatter="dateFormatter"
      />
      <el-table-column label="变更" min-width="180">
        <template #default="scope">
          <!--
            🔴 认不出的取值**原样显示**，不翻成「未知」：后端刻意不过 of()，
               因为那一支对认不出的码回落 ENFORCE，于是「这一行被写坏了」
               会显示成「本机构改成了最严的一档」—— 一个档案页上的假事实。
               本列表正是发现「这行留痕被写坏了」的唯一场合
          -->
          <span>{{ labelOf(REVIEW_MODE_OPTIONS, scope.row.fromMode) || '（空）' }}</span>
          <span class="arrow">→</span>
          <b>{{ labelOf(REVIEW_MODE_OPTIONS, scope.row.toMode) || '（空）' }}</b>
        </template>
      </el-table-column>
      <el-table-column label="操作人" width="150">
        <template #default="scope">
          <div>{{ scope.row.waivedByNickname || '（查不到用户）' }}</div>
          <div v-if="scope.row.waivedByRole" class="form-hint">{{ scope.row.waivedByRole }}</div>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="130" align="center">
        <template #default="scope">
          <el-tag :type="waiverRowTagType(waiverRowStateOf(scope.row))" size="small">
            {{ waiverRowStateText(scope.row) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="知情降级" width="110" align="center">
        <template #default="scope">
          <!--
            🔴 判据是 ackText **非空**，不是 statutoryAcknowledged：
               后端只在「法定评估业务 + 目标不是强制复核 + 确实勾了」三条同时成立时才快照告知，
               于是「ack_text 非空 ⟺ 这是一次法定评估业务的知情降级」是一个等价关系
               （QlzgReviewWaiverServiceImpl#record 的注释），一条 SQL 就能数出本机构做过几次。
               本列把这个等价关系显示出来，而不是显示那个布尔：
               VO 里**没有** statutory 这一列，光看 statutoryAcknowledged = false
               分不清「不需要勾」与「该勾却没勾」，
               而猜错的方向是让一次 ADVISORY → ENFORCE 的**恢复**显示成「他拒绝确认告知」
          -->
          <el-tag v-if="scope.row.ackText" type="danger" size="small">已确认告知</el-tag>
          <span v-else class="form-hint">—</span>
        </template>
      </el-table-column>
      <el-table-column label="理由" min-width="240">
        <template #default="scope">
          <span class="reason-cell">{{ waiverReasonSummary(scope.row.reason) }}</span>
        </template>
      </el-table-column>
      <template #empty>
        <el-empty description="本机构还没有任何档位变更记录" />
      </template>
    </el-table>
    <div class="hint-line mt-8px">
      时间倒序。被程序性拒绝的尝试<b>照样列在这里</b>，它们没有生效，
      但「有人在赶稿时想关掉复核」这件事本身是档案的一部分。
      点开行首的箭头可以看逐字理由与当时的告知原文。
    </div>

    <ReviewModeChangeDialog ref="dialogRef" @success="loadAll" @rejected="loadHistory" />
  </div>
</template>
<script lang="ts" setup>
import {
  QlzgReviewConfigApi,
  type QlzgOrgReviewConfigVO,
  type QlzgReviewWaiverVO
} from '@/api/qlzg/reviewConfig'
import { dateFormatter, formatDate } from '@/utils/formatTime'
import {
  REVIEW_MODE_OPTIONS,
  labelOf,
  reviewModeConsequence,
  reviewModeTagType
} from '@/views/qlzg/constants'
import ReviewModeChangeDialog from '../ReviewModeChangeDialog.vue'
import {
  currentEffectiveWaiverOf,
  modeTraceStateOf,
  waiverReasonSummary,
  waiverRowStateOf,
  waiverRowTagType
} from '../reviewFlow'

/**
 * 机构内控配置页的**档位**页签（§11.9.2.6）
 *
 * <h3>🔴 这不是一个列表 CRUD 页，是一张**单行配置**页</h3>
 * {@code qlzg_org_review_config} 每租户只有一行，没有「新建」「删除」「分页」。
 * 照抄台账页那套（搜索表单 + 分页 + 操作列）的产物是「一个只有一个行的表格，
 * 上面挂着一个永远不会被点到的新建按钮」—— 而那个按钮点下去会撞 {@code uk_org}。
 * 所以本页的形状是：当前档位 → 谁做的这个决定 → 法定评估业务 → 变更历史。
 *
 * <h3>🔴 人 / 时间 / 理由一律取自变更记录，不取配置行上的 {@code updatedByNickname}</h3>
 * 后端 {@code QlzgOrgReviewConfigMapper#casReviewMode} 的注释原话：
 * 「本表只有一行、会被反复覆盖，而『谁在什么时候关的』这个问题的答案在留痕表里，
 * 不在这里 —— 所以别把这一列当成责任落点来读」。
 * 配置行记的是<b>现在</b>，变更记录记的是<b>那一次</b>，本页要回答的是后者。
 *
 * <h3>🔴 弹层要的数由本面板一次读回来后<b>整个传进去</b></h3>
 * {@code draftReportCount} 与 {@code reviewMode} 必须同刻（§11.9.2.6 第 7 条那个 N），
 * 后端刻意把它们放进一个端点。所以「变更档位」的写法是
 * 「先 await 一次 /config/org，再 open(那一整份)」，不是「弹层自己去读」
 *
 * @author 走进新时代
 */
defineOptions({ name: 'QlzgReviewModePanel' })

const loading = ref(false)
const config = ref<QlzgOrgReviewConfigVO | null>(null)
const history = ref<QlzgReviewWaiverVO[]>([])
const dialogRef = ref()

/** 生效中的那一行变更记录（至多一行，判据见 reviewFlow 的 currentEffectiveWaiverOf） */
const effectiveWaiver = computed(() => currentEffectiveWaiverOf(history.value))

const traceState = computed(() => modeTraceStateOf(config.value, effectiveWaiver.value))

/**
 * 一行留痕的状态文案
 *
 * 🔴 `REJECTED` 那一句必须写明「未生效」，只写「已被拒绝」的话，
 *    读的人会去猜「那档位到底改没改」—— 而这一屏上就挂着当前档位，
 *    两处对不上时用户会认为界面在胡说
 */
const waiverRowStateText = (row: QlzgReviewWaiverVO): string => {
  const state = waiverRowStateOf(row)
  if (state === 'REJECTED') return '已被程序性拒绝，未生效'
  if (state === 'REVOKED') return '已被后一次变更改回'
  return '生效中'
}

const loadConfig = async () => {
  config.value = await QlzgReviewConfigApi.getOrgConfig()
}

const loadHistory = async () => {
  history.value = await QlzgReviewConfigApi.getOrgWaiverList()
}

const loadAll = async () => {
  loading.value = true
  try {
    // 🔴 两个请求**并发**发，但弹层只吃 config 那一份：
    //    历史列表不是弹层的入参，所以它晚一点回来不影响「N 与档位同刻」这个保证
    await Promise.all([loadConfig(), loadHistory()])
  } finally {
    loading.value = false
  }
}

/**
 * 打开变更弹层
 *
 * 🔴 **先重读一次**配置再打开，不复用页面上那一份：用户可能在这个页面上坐了半小时，
 *    而弹层里那个 N（在编报告份数）与当前档位必须是「他点下确认那一刻之前」的实况。
 *    §11.9.2.6 第 7 条要求的是 N **实时**查，页面上那个数不满足这一条
 * 🔴 读失败时**不打开**弹层，也不打开一个「N 未知」的弹层：
 *    机构级这一个调用方**取得到** N —— 它与当前档位来自同一个端点，
 *    取不到只可能是请求本身失败了。既然此刻就能重试，就不要把「N 未知」摆到用户面前。
 *    ⚠️ 项目级 / 报告级那两个调用方传的是 null，而且那是**刻意**的
 *    （数在编份要读报告清单，那要 `qlzg:report:query`，
 *    而持有 `qlzg:review:config` 的人不一定有它）——
 *    所以弹层对那一支的文案**不给**「关掉刷新」这个出路，刷新多少次都还是 null
 * 🔴 这里**不再补一句自己的报错**：axios 拦截器已经把后端那句原文弹出来了，
 *    再叠一句「请稍后再试」既是第二个 toast，又用一个猜测盖掉了真正的原因
 *    （本模块的纪律是「把后端那句原文显示出来，不要自己猜」）。
 *    也**不要 rethrow** —— 本函数是 @click 的处理器，抛出去只会变成一条
 *    unhandled rejection，而它是端到端走查时唯一用来发现静默失效的信号
 */
const openChangeDialog = async () => {
  loading.value = true
  try {
    await loadConfig()
  } catch {
    return
  } finally {
    loading.value = false
  }
  dialogRef.value?.open({
    level: 'ORG',
    scopeLabel: '本机构之后新建的所有报告',
    currentEffectiveMode: config.value?.reviewMode,
    statutory: config.value?.statutory,
    noticeText: config.value?.noticeText,
    draftReportCount: config.value?.draftReportCount
  })
}

onMounted(loadAll)
</script>
<style lang="scss" scoped>
.mode-head {
  padding: 14px 16px;
  margin-bottom: 12px;
  background: var(--el-fill-color-lighter);
  border-radius: 4px;
}

.mode-head-main {
  display: flex;
  gap: 10px;
  align-items: center;
}

.mode-head-code {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}

.mode-head-consequence {
  margin-top: 6px;
  font-size: 13px;
  color: var(--el-text-color-regular);
}

.section-title {
  margin: 16px 0 8px;
  font-size: 14px;
  font-weight: bold;
}

.section-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.field-label {
  display: inline-block;
  min-width: 108px;
  font-size: 13px;
  font-weight: bold;
  color: var(--el-text-color-secondary);
}

.effective-box {
  padding: 12px 14px;
  border: 1px solid var(--el-border-color-lighter);
  border-left: 3px solid var(--el-color-danger);
  border-radius: 4px;
}

.effective-row {
  display: flex;
  gap: 8px;
  align-items: baseline;
  font-size: 13px;
  line-height: 1.8;
}

.effective-row-top {
  align-items: flex-start;
}

.role-tag {
  padding: 0 6px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color);
  border-radius: 3px;
}

.arrow {
  margin: 0 6px;
  color: var(--el-text-color-placeholder);
}

.verbatim {
  flex: 1;
  font-size: 13px;
  line-height: 1.8;
  white-space: pre-wrap;
}

.verbatim-ack {
  padding: 8px 10px;
  color: var(--el-text-color-regular);
  background: var(--el-fill-color-lighter);
  border-radius: 4px;
}

.expand-box {
  padding: 8px 16px 8px 48px;
}

.expand-row {
  display: flex;
  gap: 8px;
  align-items: baseline;
  margin-bottom: 6px;
  font-size: 13px;
  line-height: 1.8;
}

.reason-cell {
  font-size: 13px;
  line-height: 1.7;
}

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

.hint-line {
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}

.form-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.mono {
  font-family: var(--el-font-family-mono, monospace);
}
</style>
