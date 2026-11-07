<template>
  <Dialog
    v-model="dialogVisible"
    :title="dialogTitle"
    width="1180"
    :close-on-click-modal="false"
    :close-on-press-esc="false"
  >
    <div v-loading="loading">
      <!-- 后端那句文案原样显示：它说的是「去项目上补基准日」这种可行动的结论 -->
      <el-alert
        v-if="loadError"
        type="error"
        :closable="false"
        show-icon
        :title="loadError"
        class="mb-12px"
      />

      <template v-if="preview">
        <el-steps :active="step" align-center finish-status="success" class="mb-16px">
          <el-step v-for="item in stepDefs" :key="item.title" :title="item.title" />
        </el-steps>

        <!-- ==================== 第①步：选方法 ==================== -->
        <template v-if="step === 0">
          <el-alert type="info" :closable="false" show-icon class="mb-12px">
            <template #title>标的与品类</template>
            <div>
              {{ preview.subjectName || `#${preview.subjectId}` }}
              　品类 {{ preview.categoryName || preview.categoryCode || '—' }}
              　评估基准日 {{ preview.baseDate || '—' }}
            </div>
          </el-alert>

          <div class="method-list">
            <div v-for="option in methodOptions" :key="option.value" class="method-row">
              <el-radio
                v-model="methodCode"
                :value="option.value"
                :disabled="!option.allowed || option.forbidden"
              >
                <span class="method-label">{{ option.label }}</span>
                <el-tag v-if="option.recommended" type="success" size="small" class="ml-8px">
                  本品类推荐
                </el-tag>
                <el-tag v-if="option.forbidden" type="danger" size="small" class="ml-8px">
                  本品类不支持
                </el-tag>
              </el-radio>
              <!--
                不允许的方法**列出来并灰掉**，不是从下拉里删掉：删掉的表现是
                用户找不到「收益法」然后认为系统少了功能，而正确的信息是
                「这个品类不允许用收益法」。这一句理由把 CALCULATION_METHOD_NOT_ALLOWED
                在点之前就告诉他
              -->
              <div v-if="option.reason" class="method-reason">{{ option.reason }}</div>
              <div v-else class="method-need">
                必需参数：{{ requirementsOf(option.value).paramKeys.join('、') || '（无）' }}
                　必需标的属性：{{ requirementsOf(option.value).subjectAttrs.join('、') || '（无）' }}
                <el-tag
                  v-if="requirementsOf(option.value).requiresCaseSet"
                  type="warning"
                  size="small"
                  class="ml-8px"
                >
                  要走案例终选
                </el-tag>
              </div>
            </div>
          </div>

          <el-alert
            v-if="comparisonMethodBlocked(recall)"
            type="error"
            :closable="false"
            show-icon
            :title="recall?.comparisonMethodBlockReason || '比较法不可用'"
            class="mt-12px"
          />
        </template>

        <!-- ==================== 第②步：参数确认闸（HITL 第①闸） ==================== -->
        <template v-if="step === 1">
          <div class="gate-summary">
            <el-tag type="success">命中 {{ hitCount }} 条</el-tag>
            <el-tag :type="preview.missCount ? 'danger' : 'info'">
              未命中 {{ preview.missCount }} 条
            </el-tag>
            <el-tag :type="preview.attentionCount ? 'warning' : 'info'">
              需人工判断 {{ preview.attentionCount }} 条
            </el-tag>
            <el-tag>已确认 {{ confirmedCount }} / {{ preview.items.length }} 条</el-tag>
          </div>

          <!--
            allFromExpertGuide 是**警示**不是阻断：全部口径都来自专家指引意味着
            这一次测算没有一个数是从参数库（带依据、带出处）取到的，
            而 R36 要判「每个参数都有依据」。挡住它没有意义（后端不挡），
            但藏起来更坏 —— 出稿之后才发现整份报告的口径没有一条外部依据
          -->
          <el-alert
            v-if="preview.allFromExpertGuide"
            type="warning"
            :closable="false"
            show-icon
            class="mb-12px"
          >
            <template #title>这一次的口径全部来自专家指引，没有一条来自参数库</template>
            <div>
              专家指引是平台内置的兜底值，不是本机构的测算原则。它能算出一个数，
              但那个数在档案里没有外部依据（政府文件、机构测算记录），
              复核时会被 R36 判为「依据不足」。要换掉它，请到参数库为本机构建一条同键的参数。
            </div>
          </el-alert>

          <el-table :data="preview.items" size="small" border class="mb-12px">
            <el-table-column label="参数" min-width="150">
              <template #default="scope">
                <div :class="{ 'row-attention': scope.row.needAttention }">
                  <b>{{ scope.row.label || scope.row.paramKey }}</b>
                  <el-tag
                    v-if="isRequiredKey(scope.row.paramKey)"
                    type="danger"
                    size="small"
                    class="ml-6px"
                  >
                    本方法必需
                  </el-tag>
                  <div class="param-key">{{ scope.row.paramKey }}</div>
                </div>
              </template>
            </el-table-column>

            <el-table-column label="值" min-width="200">
              <template #default="scope">
                <!-- 未命中的行**不给输入框**：paramId 不可空是后端 record 上的明文约定，
                     就地填一个数上去只会得到一句与处境无关的 PARAM_NOT_EXISTS -->
                <span v-if="!scope.row.hit || scope.row.paramId == null" class="miss-text">
                  未命中，无法在此填写
                </span>
                <template v-else>
                  <el-input-number
                    v-if="kindOf(scope.row) === 'NUM'"
                    v-model="states[scope.row.paramKey].display"
                    :precision="precisionOf(scope.row)"
                    :min="rangeOf(scope.row).min"
                    :max="rangeOf(scope.row).max"
                    :controls="false"
                    class="!w-140px"
                    @change="markTouched(scope.row.paramKey)"
                  />
                  <el-select
                    v-else-if="scope.row.options?.length"
                    v-model="states[scope.row.paramKey].display"
                    class="!w-180px"
                    @change="markTouched(scope.row.paramKey)"
                  >
                    <el-option v-for="o in scope.row.options" :key="o" :label="o" :value="o" />
                  </el-select>
                  <el-date-picker
                    v-else-if="scope.row.type === 'DATE'"
                    v-model="states[scope.row.paramKey].display"
                    type="date"
                    value-format="YYYY-MM-DD"
                    class="!w-160px"
                    @change="markTouched(scope.row.paramKey)"
                  />
                  <el-input
                    v-else-if="kindOf(scope.row) === 'STR'"
                    v-model="states[scope.row.paramKey].display"
                    class="!w-180px"
                    @input="markTouched(scope.row.paramKey)"
                  />
                  <span v-else class="miss-text">复合值（本页不可编辑）</span>
                  <span v-if="scope.row.unit" class="unit-hint">{{ scope.row.unit }}</span>
                </template>
              </template>
            </el-table-column>

            <el-table-column label="出处" width="110" align="center">
              <template #default="scope">
                {{ scope.row.sourceTypeDescription || '—' }}
              </template>
            </el-table-column>

            <el-table-column label="依据 / 回退" min-width="230">
              <template #default="scope">
                <div class="basis-line">{{ scope.row.basis || '（没有写明依据）' }}</div>
                <div class="fallback-line">
                  {{ scope.row.fallbackPath || '—' }}
                  <el-tag v-if="scope.row.platformLevel" size="small" class="ml-4px">平台级</el-tag>
                  <el-tag v-if="scope.row.matchedCount > 1" type="danger" size="small" class="ml-4px">
                    同级命中 {{ scope.row.matchedCount }} 条
                  </el-tag>
                </div>
                <!-- needAttention 的行标红：后端不替用户在多条同级命中里挑一条，
                     挑错了就是口径错了，而口径错在报告里看不出来 -->
                <div v-if="scope.row.needAttention" class="attention-line">
                  {{ scope.row.attentionReason }}
                </div>
              </template>
            </el-table-column>

            <el-table-column label="改动理由" min-width="200">
              <template #default="scope">
                <el-input
                  v-if="isModified(scope.row)"
                  v-model="states[scope.row.paramKey].modifyReason"
                  type="textarea"
                  :rows="2"
                  placeholder="必填：这句话会被追加进口径快照的依据列"
                />
                <span v-else class="form-hint">没有改动</span>
              </template>
            </el-table-column>

            <el-table-column label="确认" width="70" align="center">
              <template #default="scope">
                <el-checkbox
                  v-model="states[scope.row.paramKey].confirmed"
                  :disabled="!scope.row.hit || scope.row.paramId == null"
                />
              </template>
            </el-table-column>
          </el-table>

          <!-- 未命中的行单列一张表，必需的排前面 -->
          <el-card v-if="missingRows.length" shadow="never" class="mb-12px">
            <template #header>
              <span class="card-title">
                这几个键在参数库里查不到（{{ missingRows.length }} 个）
              </span>
            </template>
            <div class="miss-tip">
              后端的设计是「查不到就回参数库补一条，再回来确认」，而不是在确认页上手打一个数：
              手打的数没有依据（basis）、没有出处（source_type），而 R36 要判「每个参数都有依据」。
            </div>
            <div v-for="row in missingRows" :key="row.paramKey" class="miss-row">
              <el-tag :type="row.requiredByMethod ? 'danger' : 'info'" size="small">
                {{ row.requiredByMethod ? '本方法必需' : '本方法用不到' }}
              </el-tag>
              <b class="ml-8px">{{ row.label }}</b>
              <span class="param-key ml-8px">{{ row.paramKey }}</span>
              <el-button link type="primary" class="ml-8px" @click="goParamLib(row.paramKey)">
                去参数库新建
              </el-button>
            </div>
          </el-card>

          <div v-for="(text, i) in gateErrors" :key="i" class="error-line">{{ text }}</div>
        </template>

        <!-- ==================== 第③步：案例终选（HITL 第②闸） ==================== -->
        <template v-if="step === 2">
          <div v-loading="recallLoading">
            <el-alert
              v-if="recallError"
              type="error"
              :closable="false"
              show-icon
              :title="recallError"
              class="mb-12px"
            />

            <template v-if="recall">
              <div class="disposition-row">
                <el-tag :type="caseDispositionTagType(recall.dispositionCode)" effect="dark">
                  {{ recall.dispositionDescription || recall.dispositionCode }}
                </el-tag>
                <!-- dispositionText 照原样渲染，一个字都不改：它是后端按 R48 拼的完整结论，
                     前端再翻一遍就会出现「面板说充足、规则说不足」这种两份文案打架的局面 -->
                <div class="disposition-text">{{ recall.dispositionText }}</div>
              </div>

              <div class="selected-row">
                本次采纳 <b>{{ selectedCount(decisions) }}</b> 条，剔除
                <b>{{ (recall.candidates ?? []).length - selectedCount(decisions) }}</b> 条
                <span class="form-hint ml-8px">
                  默认全部采纳：六层召回已经把硬约束筛过了，你要做的是挑出不能用的那几条
                </span>
              </div>

              <el-alert
                v-if="comparisonMethodBlocked(recall)"
                type="error"
                :closable="false"
                show-icon
                :title="recall.comparisonMethodBlockReason || '比较法不可用'"
                class="mb-12px"
              />

              <el-table :data="recall.candidates ?? []" size="small" border row-key="rank">
                <el-table-column label="名次" prop="rank" width="60" align="center" />
                <el-table-column label="得分" width="80" align="center">
                  <template #default="scope">
                    {{ scope.row.score ?? '—' }}
                    <span class="form-hint">/ {{ scope.row.scoreDetail?.total_max ?? '—' }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="案例" min-width="200">
                  <template #default="scope">
                    <b>{{ scope.row.caseInfo?.communityName || '（未填小区名）' }}</b>
                    <div class="param-key">{{ scope.row.caseInfo?.address || '—' }}</div>
                  </template>
                </el-table-column>
                <el-table-column label="成交日期" width="104" align="center">
                  <template #default="scope">
                    {{ scope.row.caseInfo?.transactionDate || '—' }}
                  </template>
                </el-table-column>
                <el-table-column label="生效单价" width="110" align="right">
                  <template #default="scope">
                    {{ thousands(scope.row.effectiveUnitPrice) }}
                  </template>
                </el-table-column>
                <el-table-column label="时点差" width="88" align="center">
                  <template #default="scope">
                    <span v-if="scope.row.dealDateDiffDays == null" class="form-hint">算不出</span>
                    <span v-else>{{ scope.row.dealDateDiffDays }} 天</span>
                  </template>
                </el-table-column>
                <el-table-column label="预选警示" min-width="240">
                  <template #default="scope">
                    <div
                      v-for="warning in scope.row.reviewWarnings"
                      :key="warning.ruleCode"
                      class="warning-line"
                    >
                      <el-tag type="warning" size="small">{{ warning.ruleCode }}</el-tag>
                      <span class="ml-6px">{{ warning.text }}</span>
                    </div>
                    <span v-if="!(scope.row.reviewWarnings ?? []).length" class="form-hint">无</span>
                  </template>
                </el-table-column>
                <el-table-column label="采纳" width="70" align="center">
                  <template #default="scope">
                    <el-checkbox
                      v-if="decisionOf(scope.row)"
                      v-model="decisionOf(scope.row)!.selected"
                      @change="clearReason(scope.row.caseInfo?.id)"
                    />
                    <!--
                      这一支不该出现：一条候选没有 caseId 就无法终选（提交要 caseId）。
                      真出现了要**说出来**而不是留一个点不动的复选框 ——
                      后者读作「界面卡了」，而前者读作「这条案例的数据有问题」
                    -->
                    <el-tooltip v-else content="这条候选没有案例编号，无法终选">
                      <span class="miss-text">—</span>
                    </el-tooltip>
                  </template>
                </el-table-column>
                <el-table-column label="剔除理由" min-width="200">
                  <template #default="scope">
                    <el-input
                      v-if="decisionOf(scope.row)?.selected === false"
                      v-model="decisionOf(scope.row)!.rejectedReason"
                      type="textarea"
                      :rows="2"
                      placeholder="必填：剔除一条可比案例是要写进报告的程序性决定"
                    />
                    <span v-else class="form-hint">—</span>
                  </template>
                </el-table-column>
              </el-table>

              <el-empty v-if="!(recall.candidates ?? []).length" description="没有召回任何案例" />
            </template>

            <el-empty v-else-if="!recallLoading && !recallError" description="还没有召回结果" />
          </div>

          <div v-for="(text, i) in caseErrors" :key="i" class="error-line">{{ text }}</div>
        </template>
      </template>
    </div>

    <template #footer>
      <el-button v-if="step > 0" :disabled="submitting" @click="step--">上一步</el-button>
      <el-button
        v-if="!isLastStep"
        type="primary"
        :disabled="!canNext || submitting"
        @click="step++"
      >
        下一步
      </el-button>
      <!--
        提交期间必须禁用：/run 不是幂等的 —— 它同时冻结参数快照、写 qlzg_case_match、
        按召回充足度写 qlzg_project.procedure_limited。点两次会产生两条测算记录，
        而两条记录的口径可能不同（第二次重跑召回时案例库已经变了）
      -->
      <el-button
        v-if="isLastStep"
        type="primary"
        :loading="submitting"
        :disabled="!!allErrors.length || submitting"
        @click="submit"
      >
        提交并测算
      </el-button>
      <el-button :disabled="submitting" @click="dialogVisible = false">取 消</el-button>
    </template>
  </Dialog>
</template>
<script lang="ts" setup>
import { QlzgCalculationApi } from '@/api/qlzg/calculation'
import { QlzgCaseApi, type QlzgCaseRecallVO } from '@/api/qlzg/case'
import { QlzgCategoryApi, type QlzgMethodCodes } from '@/api/qlzg/category'
import { QlzgParamApi, type QlzgParamConfirmPreviewVO } from '@/api/qlzg/param'
import { QlzgSubjectApi } from '@/api/qlzg/subject'
import { caseDispositionTagType, thousands } from '@/views/qlzg/constants'
import {
  buildRunVO,
  caseSelectionErrors,
  comparisonMethodBlocked,
  confirmGateErrors,
  confirmPrecisionOf,
  confirmRangeOf,
  confirmValueKindOf,
  isValueModified,
  loadCaseDecisions,
  loadConfirmStates,
  methodOptionStates,
  missingParamRows,
  needsCaseSelection,
  requirementsOf,
  selectedCount,
  type CaseDecision,
  type CaseDecisionMap,
  type ParamConfirmStateMap
} from './calcFlow'

/**
 * 发起测算（V5 §11.3 的 HITL 第①闸 + §11.2.5 的第②闸）
 *
 * <h3>🔴 三步向导，而第③步只在比较法时出现</h3>
 * `requiresCaseSet()` 是方法自己声明的，四个 MVP 方法里只有市场比较法为真。
 * 给成本法也放一步「案例终选」，用户会认真挑几条案例，
 * 而后端把它们写进 `qlzg_case_match` —— 档案里于是出现
 * 「这条案例参与过成本法测算」这样一个与算式无关的假事实，
 * 而 R47（候选条数）读的正是那些行。
 *
 * <h3>🔴 能在提交前算出来的约束一律先算，不要把后端的报错当界面</h3>
 * 这一页要在一个请求里同时满足三份互相独立的清单（方法的必需参数键、
 * 方法的必需标的属性、召回的候选集合），而这三份清单都不在它读的那个接口里。
 * 全部判定都在 `./calcFlow` 里，并被 90 个用例钉住。
 *
 * <h3>🔴 `requiredSubjectAttrs` 刻意不在这里校验</h3>
 * 标的属性不在确认闸预览里，要另拉一次标的详情。缺属性时后端落
 * `CALCULATION_INPUT_REQUIRED`，文案里带键名；界面上第①步把每个方法
 * 需要的属性**列出来给人看**（`method-need` 那一行），比在这里猜一个
 * 「你大概缺 building_area」要诚实。
 */
defineOptions({ name: 'QlzgCalcRunDialog' })

const message = useMessage()
const { push } = useRouter()

const dialogVisible = ref(false)
const loading = ref(false)
const loadError = ref('')
const submitting = ref(false)

const subjectId = ref<number>(0)
const subjectName = ref('')
const preview = ref<QlzgParamConfirmPreviewVO | null>(null)
const states = ref<ParamConfirmStateMap>({})
const methodCodes = ref<QlzgMethodCodes | null>(null)
const methodCode = ref('')
const recall = ref<QlzgCaseRecallVO | null>(null)
const recallLoading = ref(false)
const recallError = ref('')
const decisions = ref<CaseDecisionMap>({})
const step = ref(0)

const dialogTitle = computed(() =>
  subjectName.value ? `发起测算 · ${subjectName.value}` : '发起测算'
)

const methodOptions = computed(() => methodOptionStates(methodCodes.value))

const stepDefs = computed(() => {
  const defs = [{ title: '选择评估方法' }, { title: '参数确认闸' }]
  if (needsCaseSelection(methodCode.value)) defs.push({ title: '案例终选' })
  return defs
})

const isLastStep = computed(() => step.value === stepDefs.value.length - 1)

// ==================== 确认闸 ====================

const kindOf = confirmValueKindOf
const precisionOf = confirmPrecisionOf
const rangeOf = confirmRangeOf
const isModified = isValueModified

const hitCount = computed(
  () => (preview.value?.items ?? []).filter((item) => item.hit && item.paramId != null).length
)
const confirmedCount = computed(
  () => Object.values(states.value).filter((state) => state.confirmed).length
)
const missingRows = computed(() => missingParamRows(preview.value, methodCode.value))
const requiredKeys = computed(() => new Set(requirementsOf(methodCode.value).paramKeys))
const isRequiredKey = (key: string) => requiredKeys.value.has(key)

const markTouched = (key: string) => {
  const state = states.value[key]
  if (state) state.touched = true
}

const gateErrors = computed(() => confirmGateErrors(preview.value, states.value, methodCode.value))

/**
 * 跳参数库，并把键名带过去替用户填好搜索框
 *
 * 🔴 走 path 不走 name：菜单的 `component_name` 一旦没填，`push({ name })`
 *    就是一次静默失败（vue-router 只在控制台 warn，界面停在原地）
 */
const goParamLib = (paramKey: string) => {
  push({ path: '/qlzg/param', query: { paramKey } })
}

// ==================== 案例终选 ====================

const caseErrors = computed(() =>
  caseSelectionErrors(recall.value, decisions.value, methodCode.value)
)

/** 一条候选的终选决定；候选没有 caseId 时是 null（那一行不给复选框） */
const decisionOf = (candidate?: { caseInfo?: { id?: number | null } | null }): CaseDecision | null => {
  const caseId = candidate?.caseInfo?.id
  return caseId == null ? null : (decisions.value[caseId] ?? null)
}

/** 重新采纳一条时清掉上一次的剔除理由：留着的话它会被当成「采纳但写了理由」提交上去 */
const clearReason = (caseId?: number | null) => {
  if (caseId == null) return
  const decision = decisions.value[caseId]
  if (decision?.selected) decision.rejectedReason = ''
}

// ==================== 步骤推进 ====================

const canNext = computed(() => {
  if (step.value === 0) return !!methodCode.value
  if (step.value === 1) return !gateErrors.value.length
  return true
})

const allErrors = computed(() => [...gateErrors.value, ...caseErrors.value])

// ==================== 加载 ====================

/**
 * 拉召回结果
 *
 * 🔴 **懒加载**：只有比较法要它，成本法打开弹窗时不该多打一次六层召回
 *    （那一次要扫全库案例并打分，是这一页最贵的一个请求）。
 * 🔴 拉一次就够，不要在每一步重拉：`/run` 内部会**自己再跑一次**
 *    `recallPreview`，而提交的 `caseId` 必须落在它新跑出来的那一批里
 *    （否则 `CASE_MATCH_CASE_NOT_IN_CANDIDATES`）。所以这里的候选清单只在
 *    「打开弹窗到提交之间案例库没变」时有效 —— 变了后端会拒，而那句拒
 *    比前端缓存一份陈旧清单要诚实
 */
const loadRecall = async () => {
  if (!subjectId.value || recall.value) return
  recallLoading.value = true
  recallError.value = ''
  try {
    recall.value = await QlzgCaseApi.recallPreview(subjectId.value)
    decisions.value = loadCaseDecisions(recall.value)
  } catch (error: any) {
    recallError.value = error?.message || '召回失败'
  } finally {
    recallLoading.value = false
  }
}

watch(methodCode, (code) => {
  if (needsCaseSelection(code)) loadRecall()
})

const open = async (id: number) => {
  dialogVisible.value = true
  step.value = 0
  loadError.value = ''
  loading.value = true
  subjectId.value = id
  subjectName.value = ''
  preview.value = null
  states.value = {}
  methodCodes.value = null
  methodCode.value = ''
  recall.value = null
  recallError.value = ''
  decisions.value = {}
  try {
    // 🔴 先建状态、后放预览：表格里每一个输入框都是 `states[row.paramKey].display`，
    //    反过来赋值的话就存在「preview 有行、states 还没有」的一瞬间，
    //    而那一瞬间的渲染错误会把整个弹窗变成空白（不是一个格子空，是整页白）
    const loaded = await QlzgParamApi.previewConfirmation(id)
    states.value = loadConfirmStates(loaded)
    preview.value = loaded
    const categoryCode = loaded?.categoryCode ?? ''
    // 标的名与品类的方法集是两个独立请求，都失败得起：
    // 名字失败只是标题里少一个名字，methodCodes 失败则四个方法一律放行
    // （那是「品类详情没拉到」，不是「品类不允许」，拦住用户等于把一次网络失败
    //   变成一个功能不可用，而后端本来就会拦）
    const [, category] = await Promise.allSettled([
      QlzgSubjectApi.getSubject(id).then((subject) => {
        subjectName.value = subject.subjectName
      }),
      categoryCode ? QlzgCategoryApi.getCategory(categoryCode) : Promise.resolve(null)
    ])
    methodCodes.value =
      category.status === 'fulfilled' ? (category.value?.methodCodes ?? null) : null
    const allowed = methodOptionStates(methodCodes.value).filter(
      (option) => option.allowed && !option.forbidden
    )
    // 只有一个方法可选时替用户选好：那一次点击不会改变任何结果，
    // 而省掉它能让「打开弹窗 → 看见参数确认闸」少一步
    if (allowed.length === 1) methodCode.value = allowed[0].value
  } catch (error: any) {
    loadError.value = error?.message || '确认闸预览加载失败'
  } finally {
    loading.value = false
  }
}

defineExpose({ open })

const emit = defineEmits<{ (e: 'success', calculationId: number): void }>()

const submit = async () => {
  if (allErrors.value.length) return
  submitting.value = true
  try {
    const runVO = buildRunVO(
      subjectId.value,
      methodCode.value,
      preview.value,
      states.value,
      recall.value,
      decisions.value
    )
    // 🔴 返回的是测算 id，而 **FAILED 也会返回 id** —— 失败的运行同样落库
    //    （status = FAILED + errorMessage），因为「算不出来」本身是要留痕的。
    //    所以不能按「有没有抛异常」判断这次跑得怎么样，一律打开明细看
    const calculationId = await QlzgCalculationApi.run(runVO)
    dialogVisible.value = false
    message.success(`测算已完成（#${calculationId}），正在打开明细`)
    emit('success', calculationId)
  } finally {
    submitting.value = false
  }
}
</script>
<style lang="scss" scoped>
.card-title {
  font-size: 13px;
  font-weight: bold;
}

.form-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.unit-hint {
  margin-left: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.param-key {
  font-family: var(--el-font-family-mono, monospace);
  font-size: 11px;
  color: var(--el-text-color-secondary);
}

.method-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.method-row {
  padding: 10px 14px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
}

.method-label {
  font-size: 14px;
  font-weight: bold;
}

.method-need,
.method-reason {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}

.method-reason {
  color: var(--el-color-danger);
}

.gate-summary {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.row-attention {
  color: var(--el-color-danger);
}

.basis-line {
  font-size: 12px;
  line-height: 1.6;
}

.fallback-line {
  margin-top: 2px;
  font-size: 11px;
  color: var(--el-text-color-secondary);
}

.attention-line {
  margin-top: 2px;
  font-size: 12px;
  color: var(--el-color-danger);
}

.miss-text {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}

.miss-tip {
  margin-bottom: 8px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}

.miss-row {
  display: flex;
  align-items: center;
  padding: 4px 0;
  font-size: 13px;
}

.error-line {
  padding: 6px 10px;
  margin-top: 6px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--el-color-danger);
  background: var(--el-color-danger-light-9);
  border-radius: 4px;
}

.disposition-row {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  margin-bottom: 8px;
}

.disposition-text {
  flex: 1;
  font-size: 13px;
  line-height: 1.8;
  white-space: pre-wrap;
}

.selected-row {
  margin-bottom: 12px;
  font-size: 13px;
}

.warning-line {
  display: flex;
  align-items: flex-start;
  font-size: 12px;
  line-height: 1.7;
}
</style>
