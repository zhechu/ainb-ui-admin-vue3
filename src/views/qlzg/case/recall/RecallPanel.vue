<template>
  <div v-loading="loading">
    <!-- 🔴 后端那句文案要**原样显示**：`CASE_RECALL_BASE_DATE_REQUIRED` 说的是
         「去项目上补评估基准日」，吞成「召回失败」用户就不知道该改哪里 -->
    <el-alert
      v-if="errorText"
      type="error"
      :closable="false"
      show-icon
      :title="errorText"
      class="mb-12px"
    />

    <template v-if="data">
      <!-- ==================== 标的与结论 ==================== -->
      <el-card shadow="never" class="mb-12px">
        <el-descriptions :column="3" border size="small">
          <el-descriptions-item label="标的">
            {{ data.subjectName || `#${data.subjectId}` }}
          </el-descriptions-item>
          <el-descriptions-item label="所属项目">
            {{ data.projectNo || '—' }}　{{ data.projectName || '' }}
          </el-descriptions-item>
          <el-descriptions-item label="品类">
            {{ data.categoryName || data.categoryCode || '—' }}
          </el-descriptions-item>
          <el-descriptions-item label="案例库类型">
            {{ data.caseKindName || data.caseKind || '—' }}
            <span class="form-hint ml-4px">（取自项目，不可覆盖）</span>
          </el-descriptions-item>
          <el-descriptions-item label="评估基准日">
            {{ data.baseDate || '—' }}
            <span class="form-hint ml-4px">（取自项目）</span>
          </el-descriptions-item>
          <el-descriptions-item label="复核规则">
            {{ data.reviewRuleCode || '—' }}
          </el-descriptions-item>
        </el-descriptions>

        <div class="disposition-row">
          <el-tag :type="caseDispositionTagType(data.dispositionCode)" size="large" effect="dark">
            {{ data.dispositionDescription || data.dispositionCode }}
          </el-tag>
          <!--
            🔴 `dispositionText` 照原样渲染，**一个字都不改**：
               它是后端按 R48 拼的完整结论（含处置建议与那个「3 条」阈值），
               前端再翻一遍就会出现「面板说充足、规则说不足」这种两份文案打架的局面
          -->
          <div class="disposition-text">{{ data.dispositionText }}</div>
        </div>

        <el-alert
          v-if="data.comparisonMethodAllowed === false"
          type="error"
          :closable="false"
          show-icon
          :title="data.comparisonMethodBlockReason || '比较法不可用'"
          class="mt-8px"
        />
        <el-alert
          v-if="data.procedureLimitedRequired"
          type="warning"
          :closable="false"
          show-icon
          class="mt-8px"
        >
          <template #title>这一份测算需要「程序受限」标记</template>
          <div>
            本接口<b>一个字都不写库</b>：标记是在 I3 落测算那一次写进项目的。
            现在看到它只是预告，项目上那一列此刻还是空的。
          </div>
        </el-alert>
      </el-card>

      <!-- ==================== 漏斗与缺事实 ==================== -->
      <el-card shadow="never" class="mb-12px">
        <template #header>
          <span class="card-title">候选漏斗</span>
        </template>
        <div class="funnel">
          <span>初筛 {{ data.rawCandidateCount ?? 0 }} 条</span>
          <Icon icon="ep:right" />
          <span>去重后 {{ data.dedupedCount ?? 0 }} 条</span>
          <Icon icon="ep:right" />
          <span>打分 {{ data.candidateCount ?? 0 }} 条</span>
          <span class="form-hint">（单次上限 {{ data.candidateLimit ?? '—' }} 条）</span>
        </div>
        <el-alert v-if="data.truncated" type="warning" :closable="false" show-icon class="mt-8px">
          <template #title>候选被上限截断了</template>
          <div>
            命中的案例比上限多，这里只显示排在前面的一批。收窄搜索范围（补全小区名、
            缩小成交日期区间）之后重跑，才能看到完整的一批。
          </div>
        </el-alert>
        <el-alert
          v-if="(data.missingFacts ?? []).length"
          type="info"
          :closable="false"
          show-icon
          class="mt-8px"
        >
          <template #title>标的缺了这几项事实，对应的打分项不计入分母</template>
          <div>
            {{ (data.missingFacts ?? []).join('、') }}
            <span class="form-hint ml-4px">
              —— 缺事实<b>不是报错</b>，只是那一层不生效；补上标的属性再重跑，分数会变
            </span>
          </div>
        </el-alert>
      </el-card>

      <!-- ==================== 六层过滤 ==================== -->
      <el-card shadow="never" class="mb-12px">
        <template #header>
          <span class="card-title">六层召回：这一次各层到底生效了没有</span>
        </template>
        <el-table :data="data.layers ?? []" size="small" border>
          <el-table-column label="层" prop="layer" width="60" align="center" />
          <el-table-column label="字段" prop="field" width="130" />
          <el-table-column label="判定" width="130" align="center">
            <template #default="scope">
              <!-- 🔴 展示 `opDescription`，不在前端翻 `op` -->
              {{ scope.row.opDescription || scope.row.op }}
            </template>
          </el-table-column>
          <el-table-column label="性质" width="90" align="center">
            <template #default="scope">
              <el-tag v-if="scope.row.hard" type="danger" size="small">硬过滤</el-tag>
              <el-tag v-else type="info" size="small">打分项</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="阈值" prop="threshold" width="90" align="center">
            <template #default="scope">{{ scope.row.threshold ?? '—' }}</template>
          </el-table-column>
          <el-table-column label="本次生效" width="90" align="center">
            <template #default="scope">
              <el-tag v-if="scope.row.applied" type="success" size="small">生效</el-tag>
              <el-tooltip v-else content="标的缺这一项事实，所以这一层这次没参与筛选">
                <el-tag type="info" size="small">未生效</el-tag>
              </el-tooltip>
            </template>
          </el-table-column>
          <el-table-column label="说明" prop="note" min-width="240" />
        </el-table>
      </el-card>

      <!-- ==================== 候选清单 ==================== -->
      <el-card shadow="never">
        <template #header>
          <span class="card-title">
            可比案例（{{ (data.candidates ?? []).length }} 条）
          </span>
          <span class="form-hint ml-8px">
            这里只做<b>预选</b>：勾选与落库都在测算那一步，本接口不写任何东西
          </span>
        </template>

        <el-table :data="data.candidates ?? []" size="small" border row-key="rank">
          <el-table-column type="expand">
            <template #default="scope">
              <div class="score-detail">
                <div class="card-title mb-8px">
                  打分明细 —— 满分 {{ scope.row.scoreDetail?.total_max ?? '—' }}
                  <span class="form-hint ml-8px">
                    这个满分是<b>这一条</b>的（缺事实的项不计入分母），
                    与上面那个全局满分不是一回事，别拿它去除这一条的分
                  </span>
                </div>
                <el-table :data="scope.row.scoreDetail?.items ?? []" size="small" border>
                  <el-table-column label="打分项" prop="label" min-width="140">
                    <template #default="s">{{ s.row.label || s.row.item }}</template>
                  </el-table-column>
                  <el-table-column label="档位" prop="tier" width="100" align="center">
                    <template #default="s">{{ s.row.tier ?? '—' }}</template>
                  </el-table-column>
                  <el-table-column label="得分" prop="score" width="90" align="right">
                    <template #default="s">{{ s.row.score ?? '—' }}</template>
                  </el-table-column>
                  <el-table-column label="理由" min-width="280">
                    <template #default="s">{{ s.row.reason || s.row.note || '—' }}</template>
                  </el-table-column>
                </el-table>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="名次" prop="rank" width="66" align="center" />
          <el-table-column label="得分" width="110" align="center">
            <template #default="scope">
              {{ scope.row.score ?? '—' }}
              <span class="form-hint">/ {{ scope.row.scoreDetail?.total_max ?? data.totalMax ?? '—' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="小区名" min-width="130">
            <template #default="scope">{{ scope.row.caseInfo?.communityName || '（未填）' }}</template>
          </el-table-column>
          <el-table-column label="坐落" min-width="200" show-overflow-tooltip>
            <template #default="scope">{{ scope.row.caseInfo?.address || '—' }}</template>
          </el-table-column>
          <el-table-column label="成交日期" width="106" align="center">
            <template #default="scope">{{ scope.row.caseInfo?.transactionDate || '—' }}</template>
          </el-table-column>
          <el-table-column label="生效价（元）" width="130" align="right">
            <template #default="scope">
              <el-tooltip
                v-if="scope.row.priceRestored"
                :content="`合同价 ${scope.row.caseInfo?.transactionPrice}，已按还原登记取还原价`"
              >
                <span class="text-[var(--el-color-warning)]">
                  {{ thousands(scope.row.effectiveTransactionPrice) }}
                </span>
              </el-tooltip>
              <span v-else>{{ thousands(scope.row.effectiveTransactionPrice) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="生效单价" width="110" align="right">
            <template #default="scope">{{ thousands(scope.row.effectiveUnitPrice) }}</template>
          </el-table-column>
          <el-table-column label="时点差" width="100" align="center">
            <template #default="scope">
              <el-tooltip
                v-if="scope.row.dealDateDiffDays === null || scope.row.dealDateDiffDays === undefined"
                content="算不出来：项目没有评估基准日，或这条案例没有成交日期"
              >
                <span class="text-[var(--el-text-color-placeholder)]">—</span>
              </el-tooltip>
              <span v-else>{{ scope.row.dealDateDiffDays }} 天</span>
            </template>
          </el-table-column>
          <el-table-column label="预选警示" min-width="280">
            <template #default="scope">
              <!--
                🔴 R32 的预选警示落在这里（I2-e 的改判）：D4④ 的字面形状是
                   「导入那一刻给行打 R32 标记」，但导入是**库级**的、不收项目上下文，
                   而 `qlzg_case` 上没有 `base_date` —— 导入那一刻根本不存在「基准日」可比。
                   所以判据落在**召回面板的每条候选**上：这里才有基准日。
                🔴 `reviewWarnings` 后端保证非 null（空列表不是 null），不要为它做 null 判断
              -->
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
          <el-table-column label="命中层" width="120" align="center">
            <template #default="scope">
              <el-tag
                v-for="layer in scope.row.recallLayerHits ?? []"
                :key="layer"
                size="small"
                class="mr-2px"
              >
                {{ layer }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="来源" width="110" align="center">
            <template #default="scope">
              {{ scope.row.caseInfo?.sourceTypeDescription || '—' }}
            </template>
          </el-table-column>
        </el-table>

        <el-empty v-if="!(data.candidates ?? []).length" description="没有召回任何案例" />
      </el-card>
    </template>

    <el-empty v-else-if="!loading && !errorText" description="还没有召回结果" />
  </div>
</template>
<script lang="ts" setup>
import { caseDispositionTagType, thousands } from '@/views/qlzg/constants'
import { QlzgCaseApi, type QlzgCaseRecallVO } from '@/api/qlzg/case'

/**
 * 召回面板（V5 §11.2.1）。**只吃 `subjectId` 一个 prop，不读路由**
 *
 * <h3>🔴 入参只有 subjectId 一条路径</h3>
 * 品类码取自项目、基准日取自项目，两个都**不可覆盖** ——
 * 让调用方传品类的话，就出现「用住宅的案例去测算一个商业标的」这种
 * 在界面上完全看不出来的错。所以这里刻意没有任何筛选框。
 *
 * <h3>🔴 这个接口一个字都不写库</h3>
 * `qlzg_case_match` 由 I3 落测算那一次写，`qlzg_project.procedure_limited` 也是。
 * 所以「预选」在这里只是看一眼：关掉页面什么都不留。
 * 面板上凡是提到「程序受限」的地方都要说清「此刻还没写」。
 *
 * <h3>🔴 三处文案照原样渲染，不要在前端翻</h3>
 * `dispositionText`（R48 的完整结论）、`opDescription`（每层的判定）、
 * `statusName` 那一类。qlzg 没有任何 `system_dict_data` 支撑，
 * 前端再翻一份就一定会与后端漂 —— 而漂的表现是「面板说充足、规则说不足」。
 *
 * <h3>为什么单独一个组件而不是直接写在路由页里</h3>
 * 路由页只做一件事：从 `route.query.subjectId` 取编号传进来。
 * 这样标的台账将来可以在抽屉里直接嵌这个面板，不必跳路由。
 */
const props = defineProps<{ subjectId?: number | null }>()

const loading = ref(false)
const data = ref<QlzgCaseRecallVO | null>(null)
const errorText = ref('')

const load = async (subjectId: number) => {
  loading.value = true
  errorText.value = ''
  data.value = null
  try {
    data.value = await QlzgCaseApi.recallPreview(subjectId)
  } catch (error: any) {
    // 🔴 后端那句文案原样留着（它说的是「去项目上补基准日」这种可行动的结论），
    //    全局拦截器已经弹过一次，这里再显示一遍是因为弹窗会自动消失
    errorText.value = error?.message || '召回失败'
  } finally {
    loading.value = false
  }
}

watch(
  () => props.subjectId,
  (id) => {
    if (id) load(id)
    else {
      data.value = null
      errorText.value = ''
    }
  },
  { immediate: true }
)
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

.disposition-row {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  margin-top: 12px;
}

.disposition-text {
  flex: 1;
  font-size: 13px;
  line-height: 1.8;
  white-space: pre-wrap;
}

.funnel {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 13px;
}

.warning-line {
  display: flex;
  align-items: flex-start;
  font-size: 12px;
  line-height: 1.7;
}

.score-detail {
  padding: 8px 16px;
}
</style>
