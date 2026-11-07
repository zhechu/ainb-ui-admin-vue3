<template>
  <el-drawer v-model="visible" :title="title" size="72%" destroy-on-close>
    <div v-loading="loading">
      <el-alert
        v-if="loadError"
        type="error"
        :closable="false"
        show-icon
        :title="loadError"
        class="mb-12px"
      />

      <template v-if="detail">
        <!-- ==================== 概要 ==================== -->
        <el-alert
          v-if="unusableReason(detail.calculation)"
          :type="detail.calculation.status === 'STALE' ? 'warning' : 'error'"
          :closable="false"
          show-icon
          :title="unusableReason(detail.calculation)!"
          class="mb-12px"
        />

        <el-descriptions :column="3" border size="small" class="mb-12px">
          <el-descriptions-item label="标的">
            {{ detail.calculation.subjectName || `#${detail.calculation.subjectId}` }}
          </el-descriptions-item>
          <el-descriptions-item label="评估方法">
            {{ methodNameOf(detail.calculation.methodCode, detail.calculation.methodName) }}
          </el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="calculationStatusTagType(detail.calculation.status)" size="small">
              {{ detail.calculation.statusDescription || detail.calculation.status }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="评估值（元）">
            <b>{{ thousands(detail.resultValue ?? detail.calculation.resultValue) }}</b>
            <span v-if="detail.calculation.resultValueLower != null" class="form-hint ml-6px">
              区间 {{ thousands(detail.calculation.resultValueLower) }} –
              {{ thousands(detail.calculation.resultValueUpper) }}
            </span>
          </el-descriptions-item>
          <el-descriptions-item label="单价（元/㎡）">
            {{ thousands(detail.calculation.unitPrice) }}
          </el-descriptions-item>
          <el-descriptions-item label="耗时">
            {{ detail.calculation.durationMs == null ? '—' : `${detail.calculation.durationMs} ms` }}
          </el-descriptions-item>
          <el-descriptions-item label="引擎版本">
            {{ detail.calculation.engineVersion || '—' }}
          </el-descriptions-item>
          <el-descriptions-item label="测算时间">
            {{ formatNullableDate(detail.calculation.createTime, 'YYYY-MM-DD HH:mm:ss', '—') }}
          </el-descriptions-item>
          <el-descriptions-item label="算式">
            {{ detail.formulaText || '—' }}
          </el-descriptions-item>
        </el-descriptions>

        <!--
          指纹要**显示出来并允许复制**：它是「同输入同输出」的凭据（SHA-256，
          配方里混进了 engine_version）。两次测算的指纹相同 = 口径与算法都没变，
          这是复核人唯一能一眼验的东西
        -->
        <div v-if="detail.fingerprint" class="fingerprint-row">
          <span class="card-title">输入指纹</span>
          <code class="fingerprint">{{ detail.fingerprint }}</code>
          <el-button link type="primary" @click="copyFingerprint">复制</el-button>
        </div>

        <!-- ==================== 算式步骤 ==================== -->
        <el-card shadow="never" class="mb-12px">
          <template #header>
            <span class="card-title">算式步骤（{{ (detail.steps ?? []).length }} 步）</span>
          </template>
          <el-table :data="detail.steps ?? []" size="small" border>
            <el-table-column label="#" prop="stepOrder" width="56" align="center" />
            <el-table-column label="算子" prop="code" width="180" />
            <el-table-column label="名称" min-width="160">
              <template #default="scope">{{ scope.row.label || '—' }}</template>
            </el-table-column>
            <el-table-column label="算式" min-width="300">
              <template #default="scope">{{ scope.row.formulaText || '—' }}</template>
            </el-table-column>
            <el-table-column label="结果" width="150" align="right">
              <template #default="scope">{{ thousands(scope.row.output) }}</template>
            </el-table-column>
          </el-table>
          <el-empty v-if="!(detail.steps ?? []).length" description="这一次测算没有留下算式步骤" />
        </el-card>

        <!-- ==================== 披露 ==================== -->
        <el-card shadow="never" class="mb-12px">
          <template #header>
            <span class="card-title">披露与限制条件</span>
            <span class="form-hint ml-8px">
              键由方法自己决定，这里逐条列出、不挑认识的显示：少显示一条披露，
              在报告里就是一个漏掉的限制条件
            </span>
          </template>
          <el-descriptions v-if="disclosures.length" :column="1" border size="small">
            <el-descriptions-item v-for="entry in disclosures" :key="entry.key" :label="entry.key">
              {{ entry.text }}
            </el-descriptions-item>
          </el-descriptions>
          <el-empty v-else description="这一次测算没有需要披露的事项" />
        </el-card>

        <!-- ==================== 冻结口径 ==================== -->
        <el-card shadow="never" class="mb-12px">
          <template #header>
            <span class="card-title">
              冻结口径（{{ (detail.frozenParams ?? []).length }} 条）
            </span>
            <span class="form-hint ml-8px">
              这是测算那一刻的副本，参数库里那条之后怎么改都不影响它
            </span>
          </template>
          <el-table :data="detail.frozenParams ?? []" size="small" border>
            <el-table-column label="参数" min-width="160">
              <template #default="scope">
                <b>{{ snapshotLabelOf(scope.row, confirmItems) }}</b>
                <div class="param-key">{{ scope.row.paramKey }}</div>
              </template>
            </el-table-column>
            <el-table-column label="冻结值" min-width="150">
              <template #default="scope">
                {{ snapshotValueText(scope.row) }}
                <!--
                  🔴 括号里那一句是**提示**，不是值：快照上没有 unit，
                     直接换算等于拿今天的 schema 去改一个已经冻结的数。
                     两样都显示，谁都不冒充谁
                -->
                <span v-if="snapshotPercentHintOf(scope.row, confirmItems)" class="form-hint ml-6px">
                  （{{ snapshotPercentHintOf(scope.row, confirmItems) }}）
                </span>
              </template>
            </el-table-column>
            <el-table-column label="出处" width="110" align="center">
              <template #default="scope">
                {{ scope.row.sourceTypeDescription || '—' }}
              </template>
            </el-table-column>
            <el-table-column label="依据" min-width="220">
              <template #default="scope">{{ scope.row.basis || '（没有写明依据）' }}</template>
            </el-table-column>
            <el-table-column label="变更" width="90" align="center">
              <template #default="scope">
                <el-tooltip v-if="scope.row.changed" :content="scope.row.changeReason || '（没有留理由）'">
                  <el-tag type="warning" size="small">改过 {{ scope.row.changeCount }} 次</el-tag>
                </el-tooltip>
                <span v-else class="form-hint">没动过</span>
              </template>
            </el-table-column>
            <el-table-column label="冻结时间" width="160" align="center">
              <template #default="scope">
                {{ formatNullableDate(scope.row.frozenAt, 'YYYY-MM-DD HH:mm:ss', '—') }}
              </template>
            </el-table-column>
            <el-table-column label="操作" width="80" align="center" fixed="right">
              <template #default="scope">
                <el-button
                  link
                  type="primary"
                  @click="openChange(scope.row)"
                  v-hasPermi="['qlzg:param-snapshot:update']"
                >
                  改值
                </el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-empty v-if="!(detail.frozenParams ?? []).length" description="这一次测算没有冻结任何口径" />
        </el-card>

        <!-- ==================== 参与案例 ==================== -->
        <el-card shadow="never">
          <template #header>
            <span class="card-title">
              案例终选（{{ (detail.caseMatches ?? []).length }} 条）
            </span>
            <span class="form-hint ml-8px">
              采纳与被剔除的都在这里：复核要回答的正是「为什么没用那条更近的案例」
            </span>
          </template>
          <el-table :data="detail.caseMatches ?? []" size="small" border>
            <el-table-column label="案例" min-width="200">
              <template #default="scope">
                {{ scope.row.caseSummary || `#${scope.row.caseId}` }}
              </template>
            </el-table-column>
            <el-table-column label="成交价（元）" width="130" align="right">
              <template #default="scope">{{ thousands(scope.row.transactionPrice) }}</template>
            </el-table-column>
            <el-table-column label="还原价（元）" width="130" align="right">
              <template #default="scope">
                <el-tooltip
                  v-if="scope.row.realPriceRestored != null"
                  :content="scope.row.restoreReason || '（没有写明还原理由）'"
                >
                  <span class="text-[var(--el-color-warning)]">
                    {{ thousands(scope.row.realPriceRestored) }}
                  </span>
                </el-tooltip>
                <span v-else class="form-hint">未还原</span>
              </template>
            </el-table-column>
            <el-table-column label="单价" width="110" align="right">
              <template #default="scope">{{ thousands(scope.row.unitPrice) }}</template>
            </el-table-column>
            <el-table-column label="成交日期" width="106" align="center">
              <template #default="scope">{{ scope.row.transactionDate || '—' }}</template>
            </el-table-column>
            <el-table-column label="时点差" width="88" align="center">
              <template #default="scope">
                <span v-if="scope.row.dealDateDiffDays == null" class="form-hint">算不出</span>
                <span v-else>{{ scope.row.dealDateDiffDays }} 天</span>
              </template>
            </el-table-column>
            <el-table-column label="得分" prop="score" width="80" align="center">
              <template #default="scope">{{ scope.row.score ?? '—' }}</template>
            </el-table-column>
            <el-table-column label="终选" width="90" align="center">
              <template #default="scope">
                <!--
                  🔴 selected 是 Integer 1/0，不是 Boolean：写 `row.selected === true` 会恒假，
                     于是全部案例都显示成「已剔除」，而这一页是复核人核对终选的唯一入口
                -->
                <el-tag v-if="caseMatchIsSelected(scope.row)" type="success" size="small">采纳</el-tag>
                <el-tooltip v-else :content="scope.row.rejectedReason || '（没有留理由）'">
                  <el-tag type="info" size="small">已剔除</el-tag>
                </el-tooltip>
              </template>
            </el-table-column>
          </el-table>
          <el-empty
            v-if="!(detail.caseMatches ?? []).length"
            description="这一次测算没有用到可比案例（收益法 / 成本法 / 假设开发法都不看案例）"
          />
        </el-card>
      </template>

      <el-empty v-else-if="!loading && !loadError" description="还没有测算明细" />
    </div>

    <!-- ==================== 改一个已冻结的值 ==================== -->
    <Dialog
      v-model="changeVisible"
      title="改一个已冻结的口径值"
      width="620"
      :close-on-click-modal="false"
      :close-on-press-esc="false"
    >
      <el-form v-if="changeRow" label-width="110px">
        <el-form-item label="参数">
          <b>{{ snapshotLabelOf(changeRow, confirmItems) }}</b>
          <span class="param-key ml-8px">{{ changeRow.paramKey }}</span>
        </el-form-item>
        <el-form-item label="冻结值">
          {{ snapshotValueText(changeRow) }}
          <span v-if="snapshotPercentHintOf(changeRow, confirmItems)" class="form-hint ml-6px">
            （{{ snapshotPercentHintOf(changeRow, confirmItems) }}）
          </span>
        </el-form-item>
        <el-form-item label="改成">
          <!--
            复合值不给编辑器：JSON 的相等性在 JS 与 Java 之间没有一份共同的判据，
            而改一半（例如只改 steps 里的一项）会让快照与算式对不上
          -->
          <span v-if="changeKind === 'JSON'" class="form-hint">
            复合值不能在这里改，请到参数库改那条参数，再重跑一次测算
          </span>
          <el-input-number
            v-else-if="changeKind === 'NUM'"
            v-model="changeValue"
            :controls="false"
            class="!w-220px"
          />
          <el-input v-else v-model="changeValue" class="!w-320px" />
        </el-form-item>
        <el-form-item label="变更理由" required>
          <el-input
            v-model="changeReason"
            type="textarea"
            :rows="3"
            placeholder="必填，且不会替你预填任何内容"
          />
          <!--
            理由框不能是可选的、也不给默认值：后端 PARAM_SNAPSHOT_CHANGE_REASON_REQUIRED
            的文案引的是《资产评估执业准则——资产评估方法》「一经确定不得随意变更」。
            一个预填了「修正」的理由框等于没有理由框，而 R08（I5）会读它
          -->
          <div class="form-hint mt-4px">
            这句话会被留进快照的变更理由列，是这次偏离在档案里唯一的留痕。
          </div>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button
          type="primary"
          :loading="changeLoading"
          :disabled="!changeReason.trim() || changeKind === 'JSON' || changeLoading"
          @click="submitChange"
        >
          确 定
        </el-button>
        <el-button :disabled="changeLoading" @click="changeVisible = false">取 消</el-button>
      </template>
    </Dialog>
  </el-drawer>
</template>
<script lang="ts" setup>
import { useClipboard } from '@vueuse/core'
import { formatNullableDate } from '@/utils/formatTime'
import { QlzgCalculationApi, type QlzgCalculationDetailVO } from '@/api/qlzg/calculation'
import { QlzgParamApi, type QlzgParamConfirmItemVO } from '@/api/qlzg/param'
import { QlzgParamSnapshotApi, type QlzgParamSnapshotVO } from '@/api/qlzg/paramSnapshot'
import { calculationStatusTagType, thousands } from '@/views/qlzg/constants'
import {
  buildSnapshotChangeVO,
  caseMatchIsSelected,
  disclosureEntries,
  methodNameOf,
  snapshotLabelOf,
  snapshotPercentHintOf,
  snapshotValueKindOf,
  snapshotValueText,
  unusableReason
} from './calcFlow'

/**
 * 测算明细
 *
 * <h3>🔴 这一页刻意**不渲染** `reportId` 与 `provenanceIds`</h3>
 * 两个在 I3 恒为 null：报告的写入路径在 I4，溯源在 I6。
 * 一个恒为空的列会让人以为数据丢了，而它其实还没开始写。
 *
 * <h3>🔴 改一个冻结值之后，STALE 要单独取一次 calculation 才看得见</h3>
 * `changeFrozenValue` 末尾调 `calculationMapper.markStale(...)`，
 * 这一次测算当场从 SUCCESS 变成 STALE —— 但它返回的是**改完的那条快照**，
 * 里面没有 `status`。所以这里换掉本地那一行（保住滚动位置，接口注释就是这么要求的）
 * 之后，**另取一次 `/get`**。少了这一步，界面上还显示着「成功」而库里已经是
 * 「结果不可用于出稿」，用户会拿着一个被自己改废了的结果去出稿。
 *
 * <h3>🔴 参数名与百分数提示要另拉一次确认闸预览</h3>
 * 快照上刻意没有 `paramName` / `unit` / `type`（它是历史，不是参数库的视图），
 * 见 {@link loadConfirmItems}：那一次请求失败得起，失败了就只显示键名与冻结的原值。
 */
defineOptions({ name: 'QlzgCalcDetailDrawer' })

const message = useMessage()
const { copy } = useClipboard({ legacy: true })

const visible = ref(false)
const loading = ref(false)
const loadError = ref('')
const detail = ref<QlzgCalculationDetailVO | null>(null)
const confirmItems = ref<QlzgParamConfirmItemVO[]>([])

const title = computed(() =>
  detail.value
    ? `测算明细 · ${methodNameOf(detail.value.calculation.methodCode, detail.value.calculation.methodName)}`
    : '测算明细'
)

const disclosures = computed(() => disclosureEntries(detail.value?.disclosures))

const load = async (calculationId: number) => {
  loading.value = true
  loadError.value = ''
  try {
    detail.value = await QlzgCalculationApi.getDetail(calculationId)
  } catch (error: any) {
    loadError.value = error?.message || '明细加载失败'
    return
  } finally {
    loading.value = false
  }
  await loadConfirmItems()
}

/**
 * 另拉一次确认闸预览，只为给人读（参数名、单位、百分数换算）
 *
 * 🔴 这一次请求**失败得起**：失败了「冻结口径」那一列就只显示键名与冻结的原值，
 *    不猜、不换算。所以它不串在明细的 try 里 —— 串进去的话一次网络失败
 *    会让整份明细（含算式、指纹、案例终选）都变成空白
 */
const loadConfirmItems = async () => {
  const subjectId = detail.value?.calculation?.subjectId
  if (!subjectId) return
  try {
    confirmItems.value = (await QlzgParamApi.previewConfirmation(subjectId))?.items ?? []
  } catch {
    confirmItems.value = []
  }
}

const open = async (calculationId: number) => {
  visible.value = true
  detail.value = null
  confirmItems.value = []
  await load(calculationId)
}

defineExpose({ open })

const emit = defineEmits(['changed'])

const copyFingerprint = async () => {
  if (!detail.value?.fingerprint) return
  await copy(detail.value.fingerprint)
  message.success('指纹已复制')
}

// ==================== 改一个已冻结的值 ====================

const changeVisible = ref(false)
const changeLoading = ref(false)
const changeRow = ref<QlzgParamSnapshotVO | null>(null)
const changeValue = ref<any>(null)
const changeReason = ref('')

const changeKind = computed(() => snapshotValueKindOf(changeRow.value))

/**
 * 「改值」按钮**不**按权限之外的理由禁用：复合值那一档点进去是一句解释
 * （去参数库改，再重跑一次测算），而不是一个灰掉的按钮。
 * 一个灰掉的按钮不说明「为什么灰」，用户会以为是自己没权限
 */
const openChange = (row: QlzgParamSnapshotVO) => {
  changeRow.value = row
  changeReason.value = ''
  const kind = snapshotValueKindOf(row)
  changeValue.value =
    kind === 'NUM' ? row.frozenValueNum : kind === 'STR' ? row.frozenValueStr : null
  changeVisible.value = true
}

const submitChange = async () => {
  const row = changeRow.value
  if (!row || !changeReason.value.trim()) return
  // 🔴 三列全部带上：后端 validateValueShapeUnchanged 要求「不能新增一个原本没有值的列，
  //    也不能清掉一个原本有值的列」，所以改的那一列换新值、其余两列原样回传
  const reqVO = buildSnapshotChangeVO(row, changeValue.value, changeReason.value)
  if (!reqVO) return
  changeLoading.value = true
  try {
    const changed = await QlzgParamSnapshotApi.changeValue(reqVO)
    changeVisible.value = false
    // 🔴 「值与库里一致」时后端不计一次变更、原样返回那一行（理由写在它的接口注释里：
    //    误报「你改了口径」的代价是用户学会编理由）。所以提示语要按 changeCount 分岔，
    //    不能一律说「已改」—— 说了而库里没动，用户下一次就不再相信这句话
    if (changed.changeCount === row.changeCount) {
      message.info('值与库里一致，不计一次变更')
    } else {
      message.success('已改。这一次测算已被标成「输入已变化，待重算」')
    }
    const frozenParams = detail.value?.frozenParams ?? []
    const index = frozenParams.findIndex((item) => item.id === changed.id)
    if (index >= 0) frozenParams[index] = changed
    if (detail.value) {
      detail.value.calculation = await QlzgCalculationApi.getCalculation(
        detail.value.calculation.id
      )
    }
    emit('changed')
  } finally {
    changeLoading.value = false
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

.param-key {
  font-family: var(--el-font-family-mono, monospace);
  font-size: 11px;
  color: var(--el-text-color-secondary);
}

.fingerprint-row {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 8px 12px;
  margin-bottom: 12px;
  background: var(--el-fill-color-light);
  border-radius: 4px;
}

.fingerprint {
  flex: 1;
  font-family: var(--el-font-family-mono, monospace);
  font-size: 12px;
  word-break: break-all;
}
</style>
