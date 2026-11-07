<template>
  <div v-if="result">
    <!--
      🔴 「这是预览」那一句必须自己说：`preview` 与 `determine` 返回的是**同一个类**，
         界面上这块版面也一模一样，唯一的差别是 `id` 为 null、库里没有这一行。
         不说清楚的话，用户点完「预览」会以为已经定下来了 ——
         而「已经定下来」与「看过了」在档案上是两件事
    -->
    <el-alert v-if="isPreview" type="info" :closable="false" show-icon class="mb-12px">
      <template #title>这是预览，库里没有这一行</template>
      <div>
        预览与「确定」跑的是<b>同一套算法</b>（离散度、区间、单价、中文大写、综合算式都在里面），
        但它一个字都不写库。核对无误之后点「确定」才会留下一条档案。
      </div>
    </el-alert>

    <!-- ==================== R09 离散度 ==================== -->
    <!--
      🔴 `deviationWarning` 照原样渲染：它已经把百分数、离散度原值与 R09 的阈值
         全拼进去了（「各方法结果相差 25.00%（离散度 0.2500），超过 R09 的阈值 0.2000：…」）。
         前端再算一遍百分数就是第二份口径，而 I5 起阈值是机构可调的 ——
         届时后端那句跟着机构走、前端这份留在原地，警示就开始说谎
    -->
    <el-alert
      v-if="result.deviationWarning"
      type="warning"
      :closable="false"
      show-icon
      class="mb-12px"
    >
      <template #title>各方法结果相差得有点多</template>
      <div class="pre-wrap">{{ result.deviationWarning }}</div>
    </el-alert>
    <el-alert v-else type="success" :closable="false" show-icon class="mb-12px">
      <template #title>各方法结果的离散度没有超过 R09 的阈值</template>
      <div>
        这一条由后端判定，前端不抄阈值。复核不会因为离散度打 WARN ——
        但离散度小只说明几个方法<b>算得近</b>，不说明它们<b>都对</b>。
      </div>
    </el-alert>

    <!-- ==================== 最终评估值 ==================== -->
    <div class="final-value-row">
      <div>
        <div class="section-title">最终评估值（元）</div>
        <div class="final-value">{{ thousands(result.finalValue) || '—' }}</div>
      </div>
      <div class="in-words">
        <div class="section-title">中文大写</div>
        <!--
          🔴 后端算的，前端**一个字都不拼**。中文大写有「零」的读法规则
             （壹佰零贰万 vs 壹佰贰拾万），自己拼一份就会与报告正文、
             与 R07（大写与数字一致性）各说一套
        -->
        <div class="pre-wrap">{{ result.finalValueInWords || '—' }}</div>
      </div>
    </div>

    <!-- ==================== 其余口径 ==================== -->
    <el-descriptions :column="3" border size="small" class="mb-12px">
      <el-descriptions-item label="综合方式">
        {{ result.combineTypeDescription || labelOf(COMBINE_TYPE_OPTIONS, result.combineType) }}
      </el-descriptions-item>
      <el-descriptions-item label="价值类型">
        {{ labelOf(VALUE_TYPE_OPTIONS, result.valueType) || '（未填）' }}
      </el-descriptions-item>
      <el-descriptions-item v-if="!isPreview" label="确定时间">
        {{ formatNullableDate(result.createTime) }}
      </el-descriptions-item>

      <el-descriptions-item label="单价（元/㎡）">
        <template v-if="result.finalUnitPrice != null">
          <b>{{ thousands(result.finalUnitPrice) }}</b>
        </template>
        <!--
          🔴 单价算不出来时**不能留空**：一个空白格会被读成「单价是 0」，
             而后端专门给了 `unitPriceReason` 就是为了把这两件事分开
        -->
        <template v-else>
          <span class="form-hint">算不出来</span>
          <div v-if="result.unitPriceReason" class="form-hint">
            {{ result.unitPriceReason }}
          </div>
        </template>
      </el-descriptions-item>
      <!--
        🔴 `unitPriceBasis` 是**一整句中文**（「单价 = 还原价 / 建筑面积」这类），
           由后端各法的 `RatioCalculator` 调用方自己声明，不是码。
           前端建一份「码 → 中文」的映射会把这句话拆成两半再拼一次，
           而拼出来的措辞必然与后端漂（见 `constants.ts` 里那段
           「刻意没有 UNIT_PRICE_BASIS_OPTIONS」）
      -->
      <el-descriptions-item label="单价口径" :span="2">
        {{ result.unitPriceBasis || '—' }}
      </el-descriptions-item>

      <el-descriptions-item label="参与测算的结果区间">
        <template v-if="result.rangeLower != null && result.rangeUpper != null">
          {{ thousands(result.rangeLower) }} ～ {{ thousands(result.rangeUpper) }}
        </template>
        <span v-else class="form-hint">—</span>
        <!--
          ⚠️ 这个区间是后端从参与测算的 `result_value` 上取 min/max **算**出来的，
             `qlzg_calc_result` 里没有存它的两列。RANGE 档要填的最终值就落在这中间
        -->
        <div v-if="result.combineType === 'RANGE'" class="form-hint">
          「区间」档的最终值必须落在这两个数之间，超出会被拦下
        </div>
      </el-descriptions-item>
      <el-descriptions-item label="离散度（R09）" :span="2">
        <!--
          🔴 显示的是**比率原值**，不乘 100。百分数只在后端那句
             `deviationWarning` 里出现一次；这里再乘一遍就会出现
             「上面说 25.00%、下面说 0.2500」两个数并排、而没有一个字解释它们相同
        -->
        {{ result.deviationRate == null ? '—' : result.deviationRate }}
        <span class="form-hint ml-4px">
          （比率，不是百分数：0.2500 就是相差 25%。它由 |最高 − 最低| / 最高 算出来）
        </span>
      </el-descriptions-item>
    </el-descriptions>

    <!-- ==================== 综合算式 ==================== -->
    <div v-if="result.combineFormulaText" class="formula">
      <div class="section-title">综合算式</div>
      <!--
        🔴 后端读时算的，与计算成果表 Excel 里那一句是同一份。
           前端照原样渲染，不要自己拼算式 —— 拼出来的措辞会与 Excel 里那句不一致，
           而报告要撑 30 年档案，两份措辞会被当成两次不同的确定
      -->
      <div class="pre-wrap formula-text">{{ result.combineFormulaText }}</div>
    </div>

    <!-- ==================== 参与测算 ==================== -->
    <div class="section-title mb-8px">
      参与综合的测算（{{ (result.participants ?? []).length }} 条）
    </div>
    <el-table :data="result.participants ?? []" size="small" border class="mb-12px">
      <el-table-column label="序号" type="index" width="50" align="center" />
      <el-table-column label="评估方法" min-width="140">
        <template #default="scope">{{ participantName(scope.row) }}</template>
      </el-table-column>
      <el-table-column label="测算编号" width="100" align="center">
        <template #default="scope">{{ scope.row.calculationId }}</template>
      </el-table-column>
      <el-table-column label="结果值（元）" width="140" align="right">
        <template #default="scope">{{ thousands(scope.row.resultValue) || '—' }}</template>
      </el-table-column>
      <el-table-column v-if="isWeighted" label="权重" width="90" align="right">
        <template #default="scope">{{ scope.row.weight ?? '—' }}</template>
      </el-table-column>
      <el-table-column v-if="isWeighted" label="权重的理由" min-width="240">
        <template #default="scope">
          <span class="pre-wrap">{{ scope.row.weightReason || '—' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="状态" min-width="200">
        <template #default="scope">
          <!--
            🔴 `Participant` 刻意带 `status`：本行存下来之后那次测算**仍可能**被标 STALE
               （参数或案例集一变引擎就自动标）。R11（`calc.staleCount == 0`，BLOCK）判的就是这件事，
               而评估师在这里看到「依据里有一次是待重算的」才知道要回去重跑。
            🔴 这一份没有 `statusDescription`，只能按码查表 ——
               与本模块其余各处的「一律显示后端给的中文」不同，这里后端确实没给
          -->
          <el-tag :type="calculationStatusTagType(scope.row.status)" size="small">
            {{ labelOf(CALCULATION_STATUS_OPTIONS, scope.row.status) || scope.row.status }}
          </el-tag>
          <div v-if="unusableReason(scope.row)" class="form-hint mt-4px">
            {{ unusableReason(scope.row) }}
          </div>
        </template>
      </el-table-column>
      <template #empty>
        <el-empty description="这一条没有参与测算清单" :image-size="60" />
      </template>
    </el-table>

    <!-- ==================== 取舍理由 ==================== -->
    <div class="section-title">取舍理由（R08）</div>
    <div class="reason pre-wrap">{{ result.determinationReason || '—' }}</div>
  </div>

  <el-empty v-else description="还没有可显示的结果" :image-size="60" />
</template>
<script lang="ts" setup>
import { formatNullableDate } from '@/utils/formatTime'
import type { QlzgCalcResultVO } from '@/api/qlzg/calcResult'
import {
  CALCULATION_STATUS_OPTIONS,
  COMBINE_TYPE_OPTIONS,
  VALUE_TYPE_OPTIONS,
  calculationStatusTagType,
  labelOf,
  thousands
} from '@/views/qlzg/constants'
import { unusableReason } from '@/views/qlzg/calculation/calcFlow'
import { participantName } from './resultFlow'

/**
 * 一条结果确定的**只读版面** —— 预览与历史明细共用这一份
 *
 * <h3>🔴 为什么共用：后端就是共用的</h3>
 * `QlzgCalcResultRespVO` 的类注释写了「预览与读取共用这一份，靠 `id` 是否为 null 区分」，
 * 理由是「18 个字段维护两份迟早漂，漂的表现是预览时对、存下来之后少一个字段，而 HTTP 全程 200」。
 * 前端要是给预览和历史各写一个组件，就是把那个漂移**搬到自己这边再来一次**。
 *
 * <h3>🔴 这个组件不发请求，只吃一个 `result` prop</h3>
 * 取数在父页面：预览那一份来自 `/preview` 的返回体，历史那一份来自 `/get`。
 * 让它自己取数的话就得再传一个「取哪一种」的开关 —— 那是把同一个二义性
 * （`id == null`）在两个地方各判一次。
 *
 * <h3>🔴 五处文案照原样渲染，一个字都不改、也不自己算</h3>
 * `finalValueInWords`（中文大写，R07）、`unitPriceBasis`（一整句中文口径，不是码）、
 * `unitPriceReason`（单价算不出来的原因）、`combineFormulaText`（综合算式，与计算成果表 Excel 同一份）、
 * `deviationWarning`（R09 的完整结论，阈值已经拼在里面）。
 * 这五样在后端各只有一份，前端拼第二份就会与报告正文对不上，而对不上的表现
 * 是「界面上一个数、导出的 Excel 里另一个数」，全程没有任何报错。
 *
 * <h3>🔴 刻意不渲染的两栏：`reportId` 与 `weights`</h3>
 * `reportId` 在 I3 恒为 null（报告的写入路径在 I4），一个恒为空的栏会让人以为数据丢了。
 * `weights` 那个 JSON 对象**已经**被后端摊平到 `participants[].weight` / `.weightReason` 上了
 * （`QlzgCalcResultServiceImpl#toParticipants`）：再按同一个键查一遍就是同一个事实的第二条取值路径，
 * 而且 MySQL 的 json 列会按键长重排对象的键，遍历顺序与参与顺序**不一致** ——
 * 要按参与顺序渲染只有 `participants` 这一个数组可用。
 */
const props = defineProps<{ result?: QlzgCalcResultVO | null }>()

/** 🔴 `id == null` ⇒ 这是 `preview` 的结果，没有落库（后端约定的唯一判据） */
const isPreview = computed(() => props.result?.id == null)

/** 只有加权档才有「权重」这一列；其余四档整列都是空的，而一整列的 `—` 是噪音 */
const isWeighted = computed(() => props.result?.combineType === 'WEIGHTED')
</script>
<style lang="scss" scoped>
.section-title {
  font-size: 13px;
  font-weight: bold;
}

.form-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.pre-wrap {
  white-space: pre-wrap;
}

.final-value-row {
  display: flex;
  gap: 32px;
  align-items: flex-start;
  padding: 12px 16px;
  margin-bottom: 12px;
  background: var(--el-fill-color-lighter);
  border-radius: 4px;
}

.final-value {
  font-size: 26px;
  font-weight: bold;
  line-height: 1.4;
  color: var(--el-color-primary);
}

.in-words {
  flex: 1;
  font-size: 14px;
  line-height: 1.9;
}

.formula {
  padding: 12px 16px;
  margin-bottom: 12px;
  background: var(--el-fill-color-lighter);
  border-radius: 4px;
}

.formula-text {
  margin-top: 6px;
  font-size: 13px;
  line-height: 1.9;
}

.reason {
  padding: 12px 16px;
  font-size: 13px;
  line-height: 1.9;
  background: var(--el-fill-color-lighter);
  border-radius: 4px;
}
</style>
