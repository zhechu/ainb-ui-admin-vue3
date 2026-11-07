<template>
  <Dialog v-model="dialogVisible" :title="dialogTitle" width="820">
    <el-form
      ref="formRef"
      v-loading="formLoading"
      :model="formData"
      :rules="formRules"
      label-width="140px"
    >
      <el-divider content-position="left">这条参数是什么</el-divider>

      <el-form-item label="品类" prop="categoryCode">
        <el-select
          v-model="formData.categoryCode"
          placeholder="请选择品类"
          class="w-full"
          @change="handleCategoryChange"
        >
          <!--
            🔴 「通用参数」是一个**有语义的选择**，不是「还没选」：
            库里 category_code 为 NULL 的行会被任意品类的测算命中
            （候选查询是 = ? OR IS NULL）。所以它要显式成为一项，
            而不是靠 clearable 清空——清空在界面上读作「漏了」，在库里读作「通用」
          -->
          <el-option label="通用参数（不绑品类，任何品类的测算都能命中它）" value="" />
          <el-option
            v-for="item in categories"
            :key="item.categoryCode"
            :label="item.categoryName"
            :value="item.categoryCode"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="参数键" prop="paramKey">
        <el-select
          v-model="formData.paramKey"
          placeholder="请选择参数键"
          filterable
          class="w-full"
          @change="handleParamKeyChange"
        >
          <el-option
            v-for="item in keyOptions"
            :key="item.key"
            :label="`${item.label}（${item.key}）`"
            :value="item.key"
          />
        </el-select>
        <div class="form-tip">
          只能从清单里选：参数键必须已在品类的参数 schema（scope=PARAM）里声明过，
          自由输入的键后端一律以「参数键未声明」拒回来，
          而那条报错在<b>新增和查询两侧</b>都会出现——录进去一个没声明的键，
          之后连打开这条参数的详情都会失败。清单由品类配置维护（I5）。
          <span v-if="!keyOptions.length">
            当前没有可选的键——{{
              formData.categoryCode
                ? '这个品类的参数 schema 里没有 PARAM 作用域的键'
                : '还没有任何品类声明过测算参数'
            }}。
          </span>
        </div>
      </el-form-item>

      <el-form-item label="参数名称" prop="paramName">
        <el-input v-model="formData.paramName" placeholder="如「杭州市住宅资本化率」" />
        <div class="form-tip">
          选完参数键会自动带出 schema 里的显示名，通常还要在前面加上辖区与版本，
          因为台账里同一个键会有好几行（全国的、省的、市的），只有名称能区分它们
        </div>
      </el-form-item>

      <el-form-item label="值" prop="value">
        <!-- 🔴 数值 -->
        <el-input-number
          v-if="kind === 'NUM'"
          v-model="formData.value"
          :precision="precision"
          :controls="false"
          class="!w-240px"
          :placeholder="schemaItem ? `按${typeLabel}填` : '请输入数值'"
        />
        <!-- 🔴 枚举：只给 schema 声明的那几个值 -->
        <el-select
          v-else-if="schemaItem?.type === 'ENUM'"
          v-model="formData.value"
          placeholder="请选择"
          class="!w-240px"
        >
          <el-option v-for="opt in schemaItem?.options ?? []" :key="opt" :label="opt" :value="opt" />
        </el-select>
        <!-- 🔴 日期：库里存的就是 YYYY-MM-DD 字符串 -->
        <el-date-picker
          v-else-if="schemaItem?.type === 'DATE'"
          v-model="formData.value"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="请选择日期"
          class="!w-240px"
        />
        <!--
          🔴 复合值：只读。PARAM 作用域的 14 个键（种子脚本 06 与 16）里没有一个是复合值，
          为一个不存在的形状造一个裸 JSON 文本域，得到的是后端**不校验**的自由输入
          （validateValueTypeMatchesSchema 对 GEO 直接 return）。
          ⚠️ 但「不给输入控件」不等于「这一行改不动了」：提交时 valueJson 原样带回，
          所以改个名称、改个依据照样能存
        -->
        <span v-else-if="kind === 'JSON'" class="text-12px">
          {{ formData.value ? JSON.stringify(formData.value) : '（空）' }}
          <span class="text-[var(--el-text-color-secondary)]">
            ——复合值参数本页只读，值会原样保留
          </span>
        </span>
        <!-- 🔴 文本 -->
        <el-input v-else v-model="formData.value" placeholder="请输入" class="!w-240px" />

        <span v-if="unitSuffix" class="ml-8px">{{ unitSuffix }}</span>

        <div v-if="rangeTip" class="form-tip">{{ rangeTip }}</div>
        <!--
          🔴 这句提示是这一页最值钱的一句话：
          unit='%' 的参数**库里存的是分数**（0.075 表示 7.5%），
          而这条约定在界面上是完全看不出来的。不说清楚的话，
          用户会填 0.075（照着库里的样子）或填 7.5（照着 % 的样子），
          两种都「能存进去」，而其中一种会让收益法的评估值差 100 倍——
          R06（金额自洽）比的是渲染值，照样自洽，所以它不会被任何规则抓到
        -->
        <div v-if="isPercent" class="form-tip form-tip-warn">
          这一项的单位是 %：界面上填 <b>7.5</b>，库里存的是 <b>0.075</b>（分数）。
          测算引擎按分数用它，所以<b>不要</b>在这里填 0.075——那会被当成 0.075%。
        </div>
        <!--
          🔴 刻意**不给** el-input-number 设 :min / :max：
          设了它会把超限的输入**静默夹到边界上**，用户填 40 存进去是 30，
          而他以为自己填的是 40。让它提交时被 validateFormModel 拦下来、
          并且把边界说出来，比悄悄改他的数字好
        -->
      </el-form-item>

      <el-form-item label="单位" prop="unit">
        <el-input
          v-model="formData.unit"
          :disabled="!!schemaItem"
          :placeholder="schemaItem ? '由品类 schema 决定' : '如 % / 元/㎡ / 年'"
          class="!w-240px"
        />
        <div v-if="schemaItem" class="form-tip">
          这一栏由品类的参数 schema 决定（当前是「{{ schemaItem.unit || '无' }}」），不能改：
          行上的 unit 与 schema 的 unit 分叉之后，「该不该按百分数换算」就有了两个答案
        </div>
      </el-form-item>

      <el-divider content-position="left">这条参数用在哪</el-divider>

      <el-form-item label="辖区码" prop="regionCode">
        <el-input
          v-model="formData.regionCode"
          placeholder="6 位国标行政区划码，全国填 000000"
          class="!w-240px"
        />
        <el-tag v-if="regionScope" class="ml-8px" size="small">{{ regionScope }}</el-tag>
        <div class="form-tip">
          必须是 6 位数字。填 5 位<b>不会报错</b>——后端只是把回退阶梯削成 ["000000"]，
          于是这条参数只能被「全国」那一级命中。表现是「录了西湖区的资本化率，
          测算却用了全国的」，而两个数都合法、报告上都会渲染、R36 还会判它「有依据」。
          全国级要<b>显式</b>填 000000，留空不是一档：
          region_code 为 NULL 的行是一条死行（候选查询是 IN (阶梯)，而 IN 对 NULL 恒为假）
        </div>
      </el-form-item>

      <!--
        🔴 刻意【没有】行业码输入框，而它确实是库里的一列
        行业维在 MVP **没有数据源**：唯一那个调用方（previewConfirmation）传的是硬编码 null，
        于是候选查询的条件是 (industry_code = null OR industry_code IS NULL)——
        前半句在 SQL 里恒为假，只有 IS NULL 的行能命中。
        所以填了行业码的行是一条**死行**：存得进去、台账里看得见、任何测算都用不到，且不报错。
        这与 region_code 为 NULL 的死行是同一类故障，只是方向相反。
        ⚠️ 已经带着行业码的行（脚本或 DBA 灌的）在这里**只读展示**并在提交时原样带回，
        不清掉它——清掉是一次没人要求的写操作，而那一列将来接通行业维之后是有意义的
      -->
      <el-form-item v-if="formData.industryCode" label="行业码">
        <el-tag type="warning" size="small">{{ formData.industryCode }}</el-tag>
        <div class="form-tip form-tip-warn">
          这一行带着行业码，而行业维在当前版本<b>还没有数据源</b>（查参时恒按「全行业」查），
          所以它<b>永远不会被任何测算命中</b>。提交时会原样保留，不会清掉
        </div>
      </el-form-item>

      <el-form-item label="生效日期" prop="effectiveFrom">
        <el-date-picker
          v-model="formData.effectiveFrom"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="留空 = 不限起始"
          class="!w-240px"
        />
        <div class="form-tip">
          留空是「不限起始」，不是一档没填：四维回退的条件是
          effective_from 为空<b>或</b> &lt;= 评估基准日。
          填了它的用途是版本切换——同一年的基准地价与上一年的版本共存时，
          靠这一列决定哪个基准日用哪一版
        </div>
      </el-form-item>

      <el-form-item label="长期有效" prop="longTermEffective">
        <el-switch v-model="formData.longTermEffective" @change="handleLongTermChange" />
        <span class="ml-8px text-12px text-[var(--el-text-color-secondary)]">
          打开后失效日期会写成 {{ EFFECTIVE_UNTIL_FOREVER }}
        </span>
      </el-form-item>

      <el-form-item label="失效日期" prop="effectiveUntil">
        <el-date-picker
          v-model="formData.effectiveUntil"
          type="date"
          value-format="YYYY-MM-DD"
          :disabled="formData.longTermEffective"
          :placeholder="formData.longTermEffective ? '长期有效，无需填写' : '请选择失效日期'"
          class="!w-240px"
        />
        <div class="form-tip">
          这一栏<b>必填</b>，长期有效请打开上面那个开关而不是留空。
          库里那一列虽然有 DEFAULT '9999-12-31'，但后端<b>刻意不靠它</b>：
          靠默认值的话「我没填」与「我判断它长期有效」在库里是同一个东西，
          而前者是漏了、后者是专业判断。
          政府发布类的参数尤其要填——基准地价三年一更，用错版本是常见退单原因
        </div>
      </el-form-item>

      <el-divider content-position="left">依据</el-divider>

      <el-form-item label="来源类型" prop="sourceType">
        <el-select v-model="formData.sourceType" placeholder="请选择来源类型" class="w-full">
          <el-option
            v-for="item in PARAM_SOURCE_TYPE_OPTIONS"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
        <div class="form-tip">
          这一栏决定「可作 BLOCK 级规则判据」：来源是<b>专家指引</b>时服务端强制为「不可以」
          （专家指引是建议性的，只能出 WARN，不能卡住出稿）。
          另外只有<b>机构内部</b>这一类的行是本机构私有的，其余四类通常是平台级
        </div>
      </el-form-item>

      <el-form-item label="可作 BLOCK 判据">
        <!--
          🔴 这里刻意**不是**一个开关：这一列由服务端按 source_type 派生，
          前端发不发它都会被覆盖（applyDerivedColumns）。
          做成开关的表现是「勾了、存进去是 0」——用户看到的是「开关不生效」，
          而实际发生的是服务端正确地执行了 §11.9.1 纪律 2。
          所以这里只**显示**派生结果，让人在选完来源类型之后立刻看见它的后果
        -->
        <el-tag :type="canBeBlockRule ? 'success' : 'info'" size="small">
          {{ canBeBlockRule ? '可以' : '不可以' }}
        </el-tag>
        <span class="ml-8px text-12px text-[var(--el-text-color-secondary)]">
          {{
            canBeBlockRuleLocked(formData.sourceType)
              ? '来源是「专家指引」，服务端强制为不可以'
              : '由服务端按来源类型派生，本页不接受修改'
          }}
        </span>
      </el-form-item>

      <el-form-item label="版本号" prop="versionNo">
        <el-input v-model="formData.versionNo" placeholder="如「杭政函〔2024〕15号」" />
      </el-form-item>

      <el-form-item label="发布机构" prop="publishedBy">
        <el-input v-model="formData.publishedBy" placeholder="如「杭州市人民政府」" />
      </el-form-item>

      <el-form-item label="取值依据" prop="basis">
        <el-input
          v-model="formData.basis"
          type="textarea"
          :rows="3"
          placeholder="写到能复核的粒度，如「杭政函〔2024〕15号 附件 2 第 3 页 表 4 第 3 行」"
        />
        <div class="form-tip">
          这一栏是 R36（「关键参数必须有依据」）的判定对象，也是三年后翻档案时
          唯一能回答「这个数哪来的」的东西。只写「政府文件」等于没写——
          而它在界面上看着是填了的
        </div>
      </el-form-item>

      <el-form-item label="依据文件">
        <!--
          🔴 I3 只读。上传与下载归 I6（V5 §15.1 把「参数依据文件」排在溯源那一批）：
          后端既没有这一列的上传端点，也没有读取通路——
          /infra/file/read-url 收的是 materialId，/infra/file/get 要 infra:file:query 权限，
          而 FileBizTypeEnum 的七个值里**没有** QLZG_PARAM_BASIS
          （所以就算传上去，存储账单里也归不了类，那一格会永远是 0 且不报错）。
          与 QlzgCalcResultDO.provenanceIds 留空是同一类处置：不造一个半截的通路
        -->
        <span v-if="formData.basisFileId" class="text-12px">
          已关联文件编号 {{ formData.basisFileId }}
          <span class="text-[var(--el-text-color-secondary)]">
            ——上传与下载在 I6（溯源）接通，本页暂不能替换或打开它
          </span>
        </span>
        <span v-else class="text-12px text-[var(--el-text-color-secondary)]">
          未关联。上传与下载在 I6（溯源）接通
        </span>
      </el-form-item>

      <el-divider content-position="left">状态</el-divider>

      <el-form-item label="状态" prop="status">
        <el-select v-model="formData.status" class="!w-240px">
          <el-option
            v-for="item in PARAM_STATUS_OPTIONS"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
        <div class="form-tip">
          停用之后四维回退就查不到它了（候选查询带 status = 启用），
          正在做的项目会落到「无参数 → 要求人工填写」那一档——
          那是设计内的行为，系统<b>绝不</b>静默用 0 或某个默认值顶上。
          已冻结的口径快照不受影响：快照存的是当时那个值的副本，不跟着活表变
        </div>
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button :disabled="formLoading" type="primary" @click="submitForm">确 定</el-button>
      <el-button @click="dialogVisible = false">取 消</el-button>
    </template>
  </Dialog>
</template>
<script lang="ts" setup>
import {
  PARAM_SOURCE_TYPE_OPTIONS,
  PARAM_STATUS_OPTIONS,
  PARAM_TYPE_LABELS
} from '@/views/qlzg/constants'
import type { QlzgCategorySimpleVO, QlzgParamSchemaItem } from '@/api/qlzg/category'
import { QlzgParamApi, type QlzgParamVO } from '@/api/qlzg/param'
import { displayPrecision, displayRange, isPercentItem } from '@/views/qlzg/subject/attrSchema'
import {
  EFFECTIVE_UNTIL_FOREVER,
  buildSaveVO,
  canBeBlockRuleLocked,
  emptyFormModel,
  loadFormModel,
  regionScopeLabel,
  validateFormModel,
  valueKindOf,
  type ParamFormModel
} from './paramSchema'

defineOptions({ name: 'QlzgParamForm' })

/**
 * 参数表单
 *
 * <h3>🔴 编辑时**必须先 /get 拿整行**，改完整体回传</h3>
 * {@code QlzgParamDO} 的 11 个可空列挂了 {@code updateStrategy = ALWAYS}，
 * 所以 {@code updateById} 是**全行更新**：只发用户动过的那几个键，
 * 没发的会被**清成 NULL** —— 品类、行业、生效日、依据会一起消失，而接口返回成功。
 * 后端 {@code QlzgParamController#updateParam} 的注释里点名了这一页：
 * 「不能照抄委托方那一页的『只传改过的键』」。
 * 委托方那边是三态约定（留空 = 没碰过，因为身份证号**不允许清空**），
 * 这边恰好相反（生效日**必须能清空**，清空 = 不限起始）。两张表两种策略，各自对着自己那一列的语义。
 *
 * <h3>🔴 值只有**一个**输入框，控件形状由 schema 的 type 决定</h3>
 * 库里是 {@code valueNum} / {@code valueStr} / {@code valueJson} 三列，
 * 但界面上给三个框就是把「填错列」这个故障做成默认形状：
 * 放错列的行**能被四维回退命中**（命中只看 param_key 与四个维度），
 * 命中之后引擎按 type 读它认定的那一列 —— 读到 null。
 * 表现是「参数库明明有这个数，测算却说缺输入」，
 * 而 {@code PARAM_VALUE_REQUIRED} 拦不住它（那一行确实有值，只是在另一列）。
 *
 * <h3>🔴 刻意没有「依据文件上传」，也刻意没有 {@code canBeBlockRule} 开关</h3>
 * 两条理由都写在各自那段模板注释里，这里只记一句共同点：
 * 它们都是「前端做了也没用」的东西 —— 一个没有服务端通路，一个会被服务端覆盖。
 * 画出来的表现分别是「点了没反应」与「勾了没生效」，都比不画更难排查。
 */

const props = defineProps<{
  /** 品类精简清单，来自台账页已经拉好的那一份（不要再拉一次） */
  categories: QlzgCategorySimpleVO[]
  /** 参数键下拉的选项：给了品类就是该品类声明的键，通用则是跨品类并集 */
  paramKeysOf: (categoryCode?: string | null) => QlzgParamSchemaItem[]
  /** 按（品类码, 参数键）取 schema 声明 */
  schemaItemOf: (
    categoryCode?: string | null,
    paramKey?: string | null
  ) => QlzgParamSchemaItem | undefined
}>()

const { t } = useI18n()
const message = useMessage()

const dialogVisible = ref(false)
const dialogTitle = ref('')
const formLoading = ref(false)
const formType = ref('')
const formRef = ref()

const formData = ref<ParamFormModel>(emptyFormModel())
/**
 * 编辑时 /get 回来的**整行**
 *
 * 🔴 两个用途，都不能省：① 没有 schema 可依时，回落判「这一行的值本来在哪一列」
 * （不传的话一律按 NUM 处理，一条文本型参数会被写进 valueNum）；
 * ② 复合值原样带回。新建时是 null
 */
const original = ref<QlzgParamVO | null>(null)

const formRules = reactive({
  paramKey: [{ required: true, message: '参数键不能为空', trigger: 'change' }],
  paramName: [{ required: true, message: '参数名称不能为空', trigger: 'blur' }],
  regionCode: [{ required: true, message: '辖区码不能为空', trigger: 'blur' }],
  sourceType: [{ required: true, message: '来源类型不能为空', trigger: 'change' }]
})

// ==================== 派生 ====================

const schemaItem = computed(() =>
  props.schemaItemOf(formData.value.categoryCode, formData.value.paramKey)
)
const keyOptions = computed(() => props.paramKeysOf(formData.value.categoryCode))
const kind = computed(() => valueKindOf(schemaItem.value, original.value))
const isPercent = computed(() => !!schemaItem.value && isPercentItem(schemaItem.value))
const precision = computed(() => (schemaItem.value ? displayPrecision(schemaItem.value) : undefined))
const regionScope = computed(() => regionScopeLabel(formData.value.regionCode))
const typeLabel = computed(() =>
  schemaItem.value ? (PARAM_TYPE_LABELS[schemaItem.value.type] ?? schemaItem.value.type) : ''
)
/**
 * 🔴 服务端会按 source_type 派生这一列，这里只是**预测并显示**它
 * （{@code buildSaveVO} 压根不发这个字段，所以显示什么都不会被提交）
 */
const canBeBlockRule = computed(() => !canBeBlockRuleLocked(formData.value.sourceType))

const unitSuffix = computed(() => {
  if (kind.value !== 'NUM') return ''
  return schemaItem.value?.unit || formData.value.unit || ''
})

/** 允许范围，按**显示口径**说（库里的 [0.01, 0.30] 在这里是 1 ~ 30） */
const rangeTip = computed(() => {
  if (!schemaItem.value || kind.value !== 'NUM') return ''
  const { min, max } = displayRange(schemaItem.value)
  const unit = schemaItem.value.unit ?? ''
  if (min == null && max == null) return ''
  if (min != null && max != null) return `允许范围 ${min} ~ ${max}${unit}`
  return min != null ? `不能小于 ${min}${unit}` : `不能大于 ${max}${unit}`
})

// ==================== 联动 ====================

/** 换品类：参数键清单跟着变，所以已选的键与已填的值都要清掉 */
const handleCategoryChange = () => {
  formData.value.paramKey = ''
  formData.value.value = undefined
  // 🔴 单位也清掉：它由 schema 决定，留着上一个品类的单位会让「该不该按百分数换算」有两个答案
  formData.value.unit = null
}

/**
 * 换参数键：带出 schema 的显示名与单位
 *
 * 🔴 只在**名称为空或还是上一个键带出来的那个**时才覆盖名称：
 *    用户已经手改过的名称（「杭州市住宅资本化率」）不该被一次换键抹掉。
 *    判据用「等不等于上一个键的 label」而不是「等不等于空」，
 *    因为自动带出之后它就非空了，此后每一次换键都该继续跟着走
 */
const lastAutoName = ref('')
const handleParamKeyChange = (key: string) => {
  const item = props.schemaItemOf(formData.value.categoryCode, key)
  formData.value.value = undefined
  if (!item) return
  formData.value.unit = item.unit ?? null
  const current = formData.value.paramName
  if (!current || current === lastAutoName.value) {
    formData.value.paramName = item.label || key
    lastAutoName.value = formData.value.paramName
  }
}

/** 打开「长期有效」时把日期框清掉，否则它会留着一个用户没填过的日期 */
const handleLongTermChange = (on: boolean | string | number) => {
  if (on) formData.value.effectiveUntil = null
}

// ==================== 打开与提交 ====================

/** 打开弹窗 */
const open = async (type: string, id?: number) => {
  dialogVisible.value = true
  dialogTitle.value = t('action.' + type)
  formType.value = type
  resetForm()
  if (!id) return
  formLoading.value = true
  try {
    // 🔴 必须 /get：列表那一行是 RespVO，字段是齐的，但走一遍 loadFormModel 才拿得到
    //    「值换算到显示口径 + 长期有效落成 null」这套模型形状；
    //    而且提交时要原样带回整行，所以这一份必须是**服务端当前的**那一份，
    //    不能是列表缓存里的（可能已经过期，而全行更新会把过期的那一份写回去）
    const data = await QlzgParamApi.getParam(id)
    original.value = data
    formData.value = loadFormModel(data, props.schemaItemOf(data.categoryCode, data.paramKey))
    lastAutoName.value = ''
  } finally {
    formLoading.value = false
  }
}
defineExpose({ open })

const emit = defineEmits(['success'])

const submitForm = async () => {
  if (!formRef.value) return
  const valid = await formRef.value.validate()
  if (!valid) return
  // 🔴 formRules 只管四个「不能为空」，其余判据（辖区码形状、长期有效与日期互斥、
  //    range、ENUM 可选值）都在这里。它们不放 formRules 是因为那些规则要**说清后果**，
  //    而一行红字放不下——例如「填 5 位不会报错，但这条参数只能被全国那一级命中」
  const problem = validateFormModel(formData.value, schemaItem.value, original.value)
  if (problem) {
    message.error(problem)
    return
  }
  formLoading.value = true
  try {
    const data = buildSaveVO(formData.value, schemaItem.value, original.value)
    if (formType.value === 'create') {
      await QlzgParamApi.createParam(data)
      message.success(t('common.createSuccess'))
    } else {
      await QlzgParamApi.updateParam(data)
      message.success(t('common.updateSuccess'))
    }
    dialogVisible.value = false
    emit('success')
  } finally {
    formLoading.value = false
  }
}

/** 重置表单 */
const resetForm = () => {
  formData.value = emptyFormModel()
  original.value = null
  lastAutoName.value = ''
  formRef.value?.resetFields()
}
</script>
<style lang="scss" scoped>
.form-tip {
  width: 100%;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}

.form-tip-warn {
  color: var(--el-color-warning);
}
</style>
