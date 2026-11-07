<template>
  <!--
    🔴 `title` 这个 prop **必须给**：ContentWrap 的 `<template v-if="title" #header>`
       把整个头部（连同 #header 插槽）一起 gate 在 title 上。
       不给 title 的后果不是「少了个标题」，而是**下面那排按钮全部消失**，
       且没有任何报错 —— 页面看着是好的，只是回不去标的台账。
       标题文字由 ContentWrap 自己渲染，插槽里**不要**再写一遍。
  -->
  <ContentWrap title="结果确定">
    <template #header>
      <div class="flex items-center justify-end w-full">
        <el-button
          v-if="subjectId"
          type="primary"
          plain
          @click="goCalculation"
          v-hasPermi="['qlzg:calculation:query']"
        >
          <Icon icon="ep:data-analysis" class="mr-5px" /> 去测算
        </el-button>
        <el-button v-if="subjectId" :loading="loading" @click="reload">
          <Icon icon="ep:refresh" class="mr-5px" /> 刷新
        </el-button>
        <el-button @click="goBack">
          <Icon icon="ep:back" class="mr-5px" /> 回标的台账
        </el-button>
      </div>
    </template>

    <!--
      没有 subjectId 时不渲染表单。这个菜单是隐藏的、只能从标的台账那一行的「定值」进来，
      直接敲 URL 一定落到这一支；此时渲染一个空表单会让人以为「表单坏了」，
      而实际上只是缺一个入参。与测算页、案例召回页同一条纪律
    -->
    <el-alert v-if="!subjectId" type="warning" :closable="false" show-icon class="mb-12px">
      <template #title>这一页要从标的台账进来</template>
      <div>
        结果确定的入参<b>只有一个标的编号</b>：能挑哪些测算、单价按什么口径算，
        都取自这个标的与它所属的项目，不能单独指定。
        请回到「标的台账」，在某一行的操作里点「定值」。
      </div>
    </el-alert>

    <template v-if="subjectId">
      <el-alert
        v-if="loadError"
        type="error"
        :closable="false"
        show-icon
        :title="loadError"
        class="mb-12px"
      />

      <el-descriptions v-if="subject" :column="3" border size="small" class="mb-12px">
        <el-descriptions-item label="标的">{{ subject.subjectName }}</el-descriptions-item>
        <el-descriptions-item label="所属项目">
          {{ subject.projectNo || '—' }}　{{ subject.projectName || '' }}
        </el-descriptions-item>
        <el-descriptions-item label="项目上登记的价值类型">
          {{ labelOf(VALUE_TYPE_OPTIONS, project?.valueType) || '（项目上没填）' }}
        </el-descriptions-item>
      </el-descriptions>

      <!-- ==================== ① 参与测算 ==================== -->
      <div class="section-title mb-8px">① 挑哪几次测算参与综合</div>
      <div class="form-hint mb-8px">
        默认把<b>全部算成功的</b>测算都勾上了 —— 常见的做法就是「跑过的都参与」。
        灰掉的行勾不上，原因写在最后一列。清单的<b>顺序就是报告上的展示顺序</b>，
        这里按台账顺序排（不按你点击的先后）。
      </div>
      <el-table
        ref="tableRef"
        class="xpy-list-table mb-16px"
        stripe
        row-key="id"
        v-loading="loading"
        :data="calculations"
        :row-class-name="rowClassName"
        @selection-change="onSelectionChange"
      >
        <el-table-column type="selection" width="44" :selectable="usableForDetermination" />
        <el-table-column label="评估方法" width="140" align="center">
          <template #default="scope">
            {{ methodNameOf(scope.row.methodCode, scope.row.methodName) }}
          </template>
        </el-table-column>
        <el-table-column label="状态" width="120" align="center">
          <template #default="scope">
            <el-tag :type="calculationStatusTagType(scope.row.status)" size="small">
              {{ scope.row.statusDescription || scope.row.status }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="评估值（元）" width="150" align="right">
          <template #default="scope">
            <b v-if="scope.row.resultValue != null">{{ thousands(scope.row.resultValue) }}</b>
            <span v-else class="form-hint">—</span>
          </template>
        </el-table-column>
        <el-table-column label="单价（元/㎡）" width="120" align="right">
          <template #default="scope">{{ thousands(scope.row.unitPrice) || '—' }}</template>
        </el-table-column>
        <el-table-column
          label="测算时间"
          align="center"
          prop="createTime"
          width="170"
          :formatter="dateFormatter"
        />
        <el-table-column label="为什么这一行不能参与" min-width="260">
          <template #default="scope">
            <span v-if="unusableReason(scope.row)" class="form-hint">
              {{ unusableReason(scope.row) }}
            </span>
            <span v-else class="form-hint">—</span>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="这个标的还没有算成功的测算，没法确定结果">
            <el-button
              type="primary"
              plain
              @click="goCalculation"
              v-hasPermi="['qlzg:calculation:create']"
            >
              去发起测算
            </el-button>
          </el-empty>
        </template>
      </el-table>

      <!-- ==================== ② 综合方式 ==================== -->
      <div class="section-title mb-8px">② 综合方式</div>
      <el-radio-group v-model="form.combineType" class="mb-8px">
        <el-radio v-for="opt in COMBINE_TYPE_OPTIONS" :key="opt.value" :value="opt.value" border>
          {{ opt.label }}
        </el-radio>
      </el-radio-group>
      <div class="combine-hint pre-wrap">{{ COMBINE_TYPE_HINTS[form.combineType] }}</div>

      <!-- ==================== ③ 权重（只有加权档） ==================== -->
      <template v-if="combineTypeNeedsWeights(form.combineType)">
        <div class="section-title mt-16px mb-8px">③ 逐项给权重与理由</div>
        <div class="form-hint mb-8px">
          权重之和必须<b>正好是 1</b>，后端不会替你归一化，前端也<b>不会替你补齐最后一项</b>
          —— 权重分配是这次确定里最需要你负责的一步。三项等权要自己写
          0.3334 / 0.3333 / 0.3333。
        </div>
        <el-table :data="weightRows" size="small" border class="mb-8px">
          <el-table-column label="评估方法" min-width="140">
            <template #default="scope">{{ participantName(scope.row.calc) }}</template>
          </el-table-column>
          <el-table-column label="这次测算的结果值（元）" width="170" align="right">
            <template #default="scope">{{ thousands(scope.row.calc?.resultValue) || '—' }}</template>
          </el-table-column>
          <el-table-column label="权重" width="150" align="center">
            <template #default="scope">
              <!--
                🔴 不给 `:min`：给了 0 的话，用户敲一个负数会被**静默夹成 0**，
                   而 0 又会被后端按「不是正数」拒 —— 于是一个明明看见自己敲了 -0.5 的人
                   收到一句「权重是 0，必须是正数」。让它原样进来、由清单报出来才对得上。
                🔴 `:precision="4"` 与后端错误码文案自己教的那一档对齐
                   （0.3334 / 0.3333 / 0.3333）。再细的话，几个数在十进制下本来就凑不出正好 1
              -->
              <el-input-number
                v-model="scope.row.draft.weight"
                :precision="4"
                :step="0.0001"
                :controls="false"
                placeholder="还没填"
                class="weight-input"
              />
            </template>
          </el-table-column>
          <el-table-column label="这一档权重的理由" min-width="320">
            <template #default="scope">
              <!--
                🔴 不给 `maxlength`：500 是 `@Size` 的列宽，抄进模板就是第二份 schema 事实。
                   超了由后端那句原文说（它会说清上限是多少），比敲到第 501 个字打不动要好
              -->
              <el-input
                v-model="scope.row.draft.reason"
                type="textarea"
                :rows="2"
                resize="none"
                placeholder="为什么这一档是这个权重（必填，R08 会读它）"
              />
            </template>
          </el-table-column>
        </el-table>
        <div v-if="weightRows.length" class="weight-sum" :class="weightSumOk ? 'is-ok' : 'is-bad'">
          {{ weightSumText(scopedDrafts) }}
        </div>
      </template>

      <!-- ==================== ④ 最终评估值（只有区间 / 专业判断两档） ==================== -->
      <template v-if="combineTypeNeedsFinalValue(form.combineType)">
        <div class="section-title mt-16px mb-8px">③ 最终评估值由你给出</div>
        <el-form label-width="140px" class="mb-8px">
          <el-form-item label="最终评估值（元）">
            <el-input-number
              v-model="form.finalValue"
              :precision="2"
              :step="10000"
              :controls="false"
              placeholder="还没填"
              class="value-input"
            />
            <div class="form-hint mt-4px">
              单位是<b>元</b>，不是万元。把「万元」当成「元」填进来是实务里最常见的一个数量级错误，
              超出中文大写能表达的上限时后端会拦下来并提示这一点。
            </div>
            <div v-if="form.combineType === 'RANGE'" class="form-hint mt-4px">
              这一档要求它落在参与测算的最小值与最大值之间。要看这两个数，
              先把取舍理由写够再点「预览」—— 区间是后端算的，前端不抄一份。
            </div>
          </el-form-item>
        </el-form>
      </template>

      <!-- ==================== ⑤ 价值类型与取舍理由 ==================== -->
      <div class="section-title mt-16px mb-8px">
        {{ reasonStepNo }} 价值类型与取舍理由
      </div>
      <el-form label-width="140px">
        <el-form-item label="价值类型">
          <el-select v-model="form.valueType" clearable placeholder="（不填就留空）" class="value-input">
            <el-option
              v-for="opt in VALUE_TYPE_OPTIONS"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
          <div class="form-hint mt-4px">
            默认取项目上登记的那一个，可以改。选了非市场价值时 R24 要求写明理由与定义，
            那是出稿前的复核（I5），不在这里拦。
          </div>
        </el-form-item>
        <el-form-item label="取舍理由">
          <!--
            🔴 不给 `maxlength`，也不在界面上写「至少 N 个字」：
               那个 N 是 R08 的参数，后端已经有一份，而且后端的报错文案更完整
               （它会说「只有 32 个字，少于 R08 要求的 50 个字」）。
               I5 起这个数会变成机构可调的 —— 界面上写死一个数，届时它就开始说谎，
               而一句说「你写得不够」却给不出正确门槛的提示，比没有提示更让人反复试
          -->
          <el-input
            v-model="form.determinationReason"
            type="textarea"
            :rows="6"
            placeholder="为什么取这个值：几个方法各自的可信度、取舍的依据、以及有没有一种方法的假设不成立"
          />
          <div class="form-hint mt-4px">
            已写 {{ reasonCharCount(form.determinationReason) }} 个字（按去掉首尾空白之后算，
            与后端同一口径）。这一段是 R08 的判据，也是报告里「为什么取这个值」的出处；
            只有套话（例如「经综合分析」）会被拦下来。
          </div>
        </el-form-item>
      </el-form>

      <!-- ==================== 阻断项 ==================== -->
      <el-alert v-if="errors.length" type="error" :closable="false" show-icon class="mb-12px">
        <template #title>还差 {{ errors.length }} 项才能确定</template>
        <ol class="error-list">
          <li v-for="(text, idx) in errors" :key="idx">{{ text }}</li>
        </ol>
      </el-alert>

      <!--
        🔴 两个按钮**不置灰**：置灰的话，前端这份判定一旦有误（漏了一个档、多算了一条），
           用户就被永久锁在门外，而且界面上没有任何一条出路。
           现在点下去会先跑同一份判定、把清单亮出来，判不出问题时照样发给后端做最终裁决
      -->
      <div class="mt-16px">
        <el-button :loading="previewing" @click="onPreview" v-hasPermi="['qlzg:calc-result:query']">
          <Icon icon="ep:view" class="mr-5px" /> 预览（不写库）
        </el-button>
        <el-button
          type="primary"
          :loading="determining"
          @click="onDetermine"
          v-hasPermi="['qlzg:calc-result:create']"
        >
          <Icon icon="ep:select" class="mr-5px" /> 确定
        </el-button>
        <span class="form-hint ml-12px">
          预览跑的是与「确定」<b>完全同一套</b>校验（取舍理由没写够它也会拒），
          区别只有一个：预览一个字都不写库。
        </span>
      </div>

      <!-- ==================== 预览 / 刚确定下来的那一条 ==================== -->
      <div v-if="previewResult" class="mt-16px preview-block">
        <div class="section-title mb-8px">
          {{ previewResult.id == null ? '预览结果' : `#${previewResult.id} 已落库` }}
        </div>
        <ResultSummaryPanel :result="previewResult" />
      </div>

      <!-- ==================== 历史 ==================== -->
      <div class="section-title mt-24px mb-8px">
        这个标的已经确定过的结果（{{ history.length }} 条）
      </div>
      <div class="form-hint mb-8px">
        同一个标的可以确定多次（改主意了就再确定一次），<b>不会覆盖</b>；
        报告引用的是编号最大的那一条。
      </div>
      <el-table class="xpy-list-table" stripe v-loading="historyLoading" :data="history">
        <el-table-column label="编号" prop="id" width="80" align="center" />
        <el-table-column label="综合方式" width="110" align="center">
          <template #default="scope">
            {{
              scope.row.combineTypeDescription ||
              labelOf(COMBINE_TYPE_OPTIONS, scope.row.combineType)
            }}
          </template>
        </el-table-column>
        <el-table-column label="最终评估值（元）" width="150" align="right">
          <template #default="scope">
            <b>{{ thousands(scope.row.finalValue) }}</b>
          </template>
        </el-table-column>
        <el-table-column label="中文大写" min-width="220">
          <template #default="scope">{{ scope.row.finalValueInWords || '—' }}</template>
        </el-table-column>
        <el-table-column label="单价（元/㎡）" width="120" align="right">
          <template #default="scope">{{ thousands(scope.row.finalUnitPrice) || '—' }}</template>
        </el-table-column>
        <el-table-column label="离散度" width="90" align="center">
          <template #default="scope">
            <span :class="scope.row.deviationWarning ? 'is-bad' : ''">
              {{ scope.row.deviationRate ?? '—' }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="参与" width="70" align="center">
          <template #default="scope">{{ (scope.row.calculationIds ?? []).length }} 条</template>
        </el-table-column>
        <el-table-column
          label="确定时间"
          align="center"
          prop="createTime"
          width="170"
          :formatter="dateFormatter"
        />
        <el-table-column label="操作" width="170" align="center" fixed="right">
          <template #default="scope">
            <el-button link type="primary" @click="openDetail(scope.row)">明细</el-button>
            <el-button
              link
              type="primary"
              :loading="exportingId === scope.row.id"
              @click="onExport(scope.row)"
              v-hasPermi="['qlzg:calc-result:query']"
            >
              计算成果表
            </el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="这个标的还没有确定过结果" :image-size="60" />
        </template>
      </el-table>
    </template>
  </ContentWrap>

  <el-drawer v-model="detailVisible" title="结果确定明细" size="72%">
    <ResultSummaryPanel :result="detailResult" />
  </el-drawer>
</template>
<script lang="ts" setup>
import download from '@/utils/download'
import { dateFormatter } from '@/utils/formatTime'
import { buildExportFilename } from '@/utils/exportExcel'
import { QlzgSubjectApi, type QlzgSubjectVO } from '@/api/qlzg/subject'
import { QlzgProjectApi, type QlzgProjectVO } from '@/api/qlzg/project'
import { QlzgCalculationApi, type QlzgCalculationVO } from '@/api/qlzg/calculation'
import { QlzgCalcResultApi, type QlzgCalcResultVO } from '@/api/qlzg/calcResult'
import {
  COMBINE_TYPE_OPTIONS,
  VALUE_TYPE_OPTIONS,
  calculationStatusTagType,
  combineTypeNeedsFinalValue,
  labelOf,
  thousands
} from '@/views/qlzg/constants'
import { methodNameOf, unusableReason, usableForDetermination } from '@/views/qlzg/calculation/calcFlow'
import {
  COMBINE_TYPE_HINTS,
  buildDetermineVO,
  calcSheetFilenameBase,
  combineTypeNeedsWeights,
  determineErrors,
  draftsOfParticipants,
  loadWeightDrafts,
  participantName,
  reasonCharCount,
  weightSumIsOne,
  weightSumText,
  type WeightDraft
} from './resultFlow'
import ResultSummaryPanel from './ResultSummaryPanel.vue'

/**
 * 结果确定页 —— 五档综合 + 权重 + 取舍理由，一层薄壳
 *
 * <h3>🔴 这个菜单是**隐藏**的（`visible = false`），只能从标的台账那一行的「定值」进来</h3>
 * 入参只有标的编号：能挑哪些测算取自这个标的，单价口径取自它的建筑面积与项目。
 * 与测算页、案例召回页同一条纪律。
 *
 * <h3>🔴 全部判定都在 `resultFlow.ts` 里，本页只做取数、排版与发请求</h3>
 * 那份纯模块被同目录的 `resultFlow.spec.ts` 钉住，其中「权重之和」那组是
 * **全量枚举** IEEE-754 噪声的（三位百分比组合与四位小数组合各扫一遍）。
 * 把判定写在 `.vue` 里的后果是**测不了**：vitest 没有 jsdom，
 * 一个 import 了 `@/config/axios` 的模块在 collect 阶段就 `window is not defined` 死掉。
 *
 * <h3>🔴 三处刻意不做的前端校验（理由各不相同）</h3>
 * · **R08 的字数下限与禁语**：那个数在 R08 的参数里，I5 起机构可调，抄一份就会说谎。
 *   做法是把后端那句原文显示出来 —— 它比前端能拼的任何提示都完整。
 * · **R09 的离散度阈值**：`deviationWarning` 为 null 就是「没超」，前端不自己判。
 * · **RANGE 的区间上下界**：后端从参与测算的 `result_value` 上取 min/max **算**出来的
 *   （`qlzg_calc_result` 里没有存这两列），前端自己算一遍就是第二份口径。
 *
 * <h3>⚠️ 「方法数不少于两种」刻意**不做**成写时校验</h3>
 * 后端写时只查 `SINGLE` 的条数。R02 归 I5 的复核引擎：出稿前判、可豁免、要留豁免理由。
 * 做成写时校验的话，一个只跑得出一种方法的标的（没有可比案例、收益法又缺参数）
 * **连结果都定不了**，而 V5 要的是「定得下来、但复核时命中 R02 并走豁免」。
 *
 * <h3>为什么这一页不做分页</h3>
 * 一个标的的确定次数是个位数（改一次主意多一条），而「上一次定的是多少」要一眼看见。
 * 后端 `list-by-subject` 本来也不分页。
 */
defineOptions({ name: 'QlzgCalcResult' })

const route = useRoute()
const router = useRouter()
const message = useMessage()

const subjectId = computed(() => {
  const raw = route.query.subjectId
  const text = Array.isArray(raw) ? raw[0] : raw
  const parsed = Number(text)
  // 🔴 `Number('')` 是 0，会被当成一个合法的标的编号发出去，后端回一句「标的不存在」，
  //    用户看到的结论就成了「结果确定功能坏了」
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
})

const loading = ref(false)
const loadError = ref('')
const calculations = ref<QlzgCalculationVO[]>([])
const subject = ref<QlzgSubjectVO | null>(null)
const project = ref<QlzgProjectVO | null>(null)

const historyLoading = ref(false)
const history = ref<QlzgCalcResultVO[]>([])

const form = reactive({
  combineType: 'ARITHMETIC_MEAN',
  finalValue: null as number | null,
  valueType: '',
  determinationReason: ''
})

/** 已勾选的参与测算，**按台账顺序**（见 `onSelectionChange`） */
const participants = ref<QlzgCalculationVO[]>([])
const weightDrafts = ref<WeightDraft[]>([])

const tableRef = ref()

/** 灰掉不能参与的那几行（STALE / FAILED），并让原因列自己说话 */
const rowClassName = ({ row }: { row: QlzgCalculationVO }) =>
  unusableReason(row) ? 'row-unusable' : ''

/**
 * 权重表的数据：草稿对象**本身**（不是副本），所以 `v-model` 直接改到草稿上
 *
 * 🔴 走 `draftsOfParticipants` 而不是直接遍历 `weightDrafts`：
 *    用户取消勾选一条之后，那条的草稿仍留在数组里（删了的话再勾回来就要重填），
 *    直接遍历会把一个已经退出综合的权重行显示出来、还算进和里
 */
const weightRows = computed(() => {
  const byId = new Map(participants.value.map((row) => [row.id, row]))
  return draftsOfParticipants(participants.value, weightDrafts.value).map((draft) => ({
    draft,
    calc: byId.get(draft.calculationId)
  }))
})

const scopedDrafts = computed(() => draftsOfParticipants(participants.value, weightDrafts.value))
const weightSumOk = computed(() => weightSumIsOne(scopedDrafts.value))

/**
 * 「价值类型与取舍理由」那一段的序号
 *
 * ⚠️ 不能只看 `combineTypeNeedsFinalValue`：加权档多出来的是**权重表**那一段（③），
 *    区间 / 专业判断两档多出来的是**最终评估值**那一段（也是 ③）—— 两者互斥，
 *    所以判据是「前面有没有多出一段」，而不是「这一档要不要手填金额」。
 *    写错的表现是加权档下出现两个「③」，读的人会以为漏看了一段
 */
const reasonStepNo = computed(() =>
  combineTypeNeedsWeights(form.combineType) || combineTypeNeedsFinalValue(form.combineType)
    ? '④'
    : '③'
)

const errors = computed(() =>
  determineErrors({
    subjectId: subjectId.value,
    participants: participants.value,
    combineType: form.combineType,
    weights: weightDrafts.value,
    finalValue: form.finalValue,
    valueType: form.valueType,
    determinationReason: form.determinationReason
  })
)

/**
 * 勾选变化
 *
 * 🔴 **按台账顺序重排**，不按点击顺序：`el-table` 的 selection 数组是点击顺序，
 *    而后端不排序、`calculationIds` 的顺序「即报告上的展示顺序」。
 *    点击顺序用户自己既看不见也控制不了，落进档案就成了
 *    「同一批测算两次确定的展示顺序不一样」—— 而报告要撑 30 年
 */
const onSelectionChange = (rows: QlzgCalculationVO[]) => {
  const order = new Map(calculations.value.map((row, idx) => [row.id, idx]))
  participants.value = [...rows].sort(
    (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)
  )
}

/**
 * 勾选变化之后补草稿：**只补新增的，已有的原样留着**
 *
 * 🔴 取消勾选时**不删**草稿：删了的话再勾回来就要把权重与理由重填一遍，
 *    而那段理由是 R08 要读的专业判断，重填一次就是一次「照着上一次抄」的机会。
 *    残留的草稿不会发上去 —— `buildDetermineVO` 是从参与清单生成权重表的
 */
watch(participants, (rows) => {
  const existing = new Set(weightDrafts.value.map((item) => item.calculationId))
  const fresh = loadWeightDrafts(rows.filter((row) => !existing.has(row.id)))
  if (fresh.length) weightDrafts.value = [...weightDrafts.value, ...fresh]
})

/**
 * 综合方式变化时清掉不属于这一档的残留
 *
 * 🔴 后端对 `weights`（非 WEIGHTED 档）与 `finalValue`（非手填档）都是**忽略**而不是报错，
 *    所以留着残留不会失败 —— 但它也不落库，于是「我明明填了权重，怎么档案里没有」
 *    变成一次排查。切档就清，比让它发上去再被忽略诚实。
 * ⚠️ 权重草稿本身不清（见上面那条 watch）：切回来还要用
 */
watch(
  () => form.combineType,
  (combineType) => {
    if (!combineTypeNeedsFinalValue(combineType)) form.finalValue = null
  }
)

const loadAll = async () => {
  const id = subjectId.value
  if (!id) return
  loading.value = true
  loadError.value = ''
  try {
    const [calcResult, subjectResult, historyResult] = await Promise.allSettled([
      QlzgCalculationApi.listBySubject(id),
      QlzgSubjectApi.getSubject(id),
      QlzgCalcResultApi.listBySubject(id)
    ])
    if (calcResult.status === 'fulfilled') {
      calculations.value = calcResult.value
      await nextTick()
      // 🔴 默认全勾算成功的那几条。刷新会重建整张表（行对象都是新的），
      //    上一次的勾选留不住，所以每次加载都回到「全选」这个起点
      calculations.value
        .filter((row) => usableForDetermination(row))
        .forEach((row) => tableRef.value?.toggleRowSelection(row, true))
    } else {
      calculations.value = []
      participants.value = []
      loadError.value = calcResult.reason?.message || '测算列表加载失败'
    }
    // 标的与历史都失败得起：它们只是页眉那三格与下面那张表，表单本身照常能用
    subject.value = subjectResult.status === 'fulfilled' ? subjectResult.value : null
    history.value = historyResult.status === 'fulfilled' ? historyResult.value : []
    if (historyResult.status === 'rejected') {
      loadError.value = loadError.value || '历史确定记录加载失败'
    }
    await loadProject()
  } finally {
    loading.value = false
  }
}

/**
 * 取项目上登记的价值类型，作为表单里那一项的**默认值**
 *
 * 🔴 先有标的编号才能拿到 `projectId`，所以它排在 `loadAll` 的最后一步、单独一个请求。
 * ⚠️ 失败就留空：价值类型不是必填项，为它把整页拦住不值得
 */
const loadProject = async () => {
  const projectId = subject.value?.projectId
  if (!projectId) {
    project.value = null
    return
  }
  try {
    project.value = await QlzgProjectApi.getProject(projectId)
    // 🔴 只在用户**还没动过**这一项时预填：他手动清空过之后再刷一次页面，
    //    不该又被塞回一个值 —— 「我明明清掉了它又回来了」是拨不动的输入那一类
    if (!form.valueType) form.valueType = project.value?.valueType ?? ''
  } catch {
    project.value = null
  }
}

const reload = () => loadAll()

const previewing = ref(false)
const previewResult = ref<QlzgCalcResultVO | null>(null)
const determining = ref(false)

/**
 * 点「预览」/「确定」共用的前置
 *
 * @return 能不能发出去
 */
const guard = (action: string): boolean => {
  if (errors.value.length) {
    message.warning(`${action}之前还差 ${errors.value.length} 项，见上面那张清单`)
    return false
  }
  return true
}

const buildDraft = () => ({
  subjectId: subjectId.value,
  participants: participants.value,
  combineType: form.combineType,
  weights: weightDrafts.value,
  finalValue: form.finalValue,
  valueType: form.valueType,
  determinationReason: form.determinationReason
})

const onPreview = async () => {
  if (!guard('预览')) return
  previewing.value = true
  try {
    previewResult.value = await QlzgCalcResultApi.preview(buildDetermineVO(buildDraft()))
  } finally {
    previewing.value = false
  }
}

/**
 * 落一次结果确定
 *
 * 🔴 落完之后**再取一次** `/get`，把预览那块版面换成已落库的那一条：
 *    `determine` 只返回一个编号，而版面是共用的（`id` 从 null 变成一个数，
 *    「这是预览」那句自动消失）。这一步是给人看的确认，不是多余的请求 ——
 *    一次「确定」之后界面上什么都不变，用户会再点一次，于是档案里多出一条重复的确定
 * 🔴 不弹「是否确认」的二次确认框：这一页从头到尾都是在填这一件事，
 *    而 `determine` 可以重复调用、不覆盖旧的。一个多余的确认框只会训练人闭眼点「是」
 */
const onDetermine = async () => {
  if (!guard('确定')) return
  determining.value = true
  try {
    const id = await QlzgCalcResultApi.determine(buildDetermineVO(buildDraft()))
    message.success(`已确定，档案编号 #${id}`)
    previewResult.value = await QlzgCalcResultApi.getCalcResult(id)
    await loadHistory()
  } finally {
    determining.value = false
  }
}

const loadHistory = async () => {
  const id = subjectId.value
  if (!id) return
  historyLoading.value = true
  try {
    history.value = await QlzgCalcResultApi.listBySubject(id)
  } finally {
    historyLoading.value = false
  }
}

const detailVisible = ref(false)
const detailResult = ref<QlzgCalcResultVO | null>(null)

/**
 * 打开明细
 *
 * 🔴 直接用列表里那一行，不再 `/get` 一次：`list-by-subject` 返回的就是完整的
 *    `QlzgCalcResultRespVO`（含 `participants`、`combineFormulaText`、`deviationWarning`），
 *    再取一次是同一个事实的两个来源 —— 万一两次之间有人又确定了一次，
 *    抽屉里显示的与列表里那一行就不是同一条了
 */
const openDetail = (row: QlzgCalcResultVO) => {
  detailResult.value = row
  detailVisible.value = true
}

const exportingId = ref<number | null>(null)

/**
 * 导出计算成果表（三个 sheet：计算过程 / 参数口径 / 案例明细，sheet 之间是真公式）
 *
 * 🔴 文件名前端自己拼：`request.download` 的 blob 拦截器 `return response.data`，
 *    响应头在这一层就丢了。后端其实**发了** `Content-Disposition` ——
 *    `QlzgCalcSheetExporter#write` 是「先出完整字节、再设头、最后写体」，
 *    与 `ExcelUtils.write` 那个「先写流后设头」的顺序相反，只是这里读不到
 * 🔴 这一份**不走** `exportExcelWithMeta`：它是单条记录的三个 sheet，
 *    没有行数上限、也就没有 `X-Export-Truncated` 那个头可读。
 *    （它另有一个 `X-Export-File-Id`，值是导出件在 `infra_file` 里的行编号，
 *    用于把客户拿走的那一份与平台记录的 sha256 对上；界面今天不显示它）
 * 🔴 后面还要接一个 `#编号`：导出是**按一次确定**导的（`exportCalcSheet(id)`），
 *    而同一个标的可以确定多次。只带标的名的话，三次导出得到三个同名文件，
 *    浏览器自动补成 `(1)` `(2)` `(3)` —— 下载目录里没有任何线索说明哪一份是哪一次定的
 */
const onExport = async (row: QlzgCalcResultVO) => {
  if (row.id == null) return
  exportingId.value = row.id
  try {
    const blob = await QlzgCalcResultApi.exportCalcSheet(row.id)
    download.excel(
      blob,
      buildExportFilename(
        `${calcSheetFilenameBase(subject.value?.subjectName, subjectId.value)}-#${row.id}`,
        false,
        1,
        false
      )
    )
  } finally {
    exportingId.value = null
  }
}

const goCalculation = () => {
  if (!subjectId.value) return
  // 🔴 走 path 不走 name：菜单的 component_name 一旦没填，push({ name }) 是一次静默失败
  router.push({ path: '/qlzg/calculation', query: { subjectId: subjectId.value } })
}

const goBack = () => {
  router.push({ path: '/qlzg/subject' })
}

watch(
  subjectId,
  (id) => {
    if (id) {
      loadAll()
    } else {
      calculations.value = []
      participants.value = []
      history.value = []
      subject.value = null
      project.value = null
      previewResult.value = null
      loadError.value = ''
    }
  },
  { immediate: true }
)
</script>
<style lang="scss" scoped>
.section-title {
  font-size: 14px;
  font-weight: bold;
}

.form-hint {
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}

.pre-wrap {
  white-space: pre-wrap;
}

.combine-hint {
  padding: 8px 12px;
  margin-bottom: 8px;
  font-size: 12px;
  line-height: 1.8;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-lighter);
  border-radius: 4px;
}

.weight-input {
  width: 130px;
}

.value-input {
  width: 260px;
}

.weight-sum {
  padding: 8px 12px;
  font-size: 13px;
  border-radius: 4px;

  &.is-ok {
    color: var(--el-color-success);
    background: var(--el-color-success-light-9);
  }

  &.is-bad {
    color: var(--el-color-danger);
    background: var(--el-color-danger-light-9);
  }
}

.is-bad {
  color: var(--el-color-danger);
}

.error-list {
  padding-left: 18px;
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 1.8;
}

.preview-block {
  padding: 12px 16px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
}

:deep(.el-table .row-unusable) {
  --el-table-tr-bg-color: var(--el-fill-color-lighter);

  color: var(--el-text-color-secondary);
}
</style>
