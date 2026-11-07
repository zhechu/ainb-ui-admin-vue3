<template>
  <Dialog v-model="dialogVisible" :title="dialogTitle" width="1000" :close-on-click-modal="false">
    <el-steps :active="step" align-center finish-status="success" class="mb-20px">
      <el-step v-for="title in STEP_TITLES" :key="title" :title="title" />
    </el-steps>

    <div v-loading="formLoading">
      <!-- ==================== 屏 1：基本信息 ==================== -->
      <el-form v-show="step === 0" ref="formRef" :model="formData" label-width="118px">
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="案例库类型" required>
              <el-select v-model="formData.caseKind" placeholder="请选择" class="w-full">
                <el-option
                  v-for="item in caseKindOptions"
                  :key="item.code"
                  :label="item.name"
                  :value="item.code"
                />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="成交日期" required>
              <el-date-picker
                v-model="formData.transactionDate"
                type="date"
                value-format="YYYY-MM-DD"
                placeholder="请选择成交日期"
                class="!w-full"
              />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="成交价（元）" required>
              <el-input-number
                v-model="formData.transactionPrice"
                :precision="2"
                :min="0"
                :controls="false"
                placeholder="合同上的数，单位是元"
                class="!w-full"
              />
              <div class="form-hint">
                {{ wanYuanHint(formData.transactionPrice) }}
                <span v-if="!wanYuanHint(formData.transactionPrice)">
                  单位是【元】，不是万元
                </span>
              </div>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="建筑面积（㎡）" required>
              <el-input-number
                v-model="formData.buildingArea"
                :precision="2"
                :min="0"
                :controls="false"
                placeholder="产权证上的建筑面积"
                class="!w-full"
              />
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="单价（元/㎡）">
          <el-input-number
            v-model="formData.unitPrice"
            :precision="2"
            :min="0"
            :controls="false"
            :placeholder="autoUnitPricePlaceholder"
            class="!w-240px"
            @input="formData.unitPriceTouched = true"
          />
          <span class="ml-8px text-12px text-[var(--el-text-color-secondary)]">
            留空则由系统按「成交价 ÷ 建筑面积」自动算
          </span>
          <div v-if="!unitPriceOk" class="form-issue">
            填的单价与算出来的差 {{ unitPriceDeviation }}%（超过 5%）：填的是
            {{ formData.unitPrice }}，算出来的是 {{ computedPrice }}。
            多半是把万元当成元填了，或者面积/成交价有一处抄错。留空则不会拦。
          </div>
        </el-form-item>

        <el-divider content-position="left">
          <span class="text-13px text-[var(--el-text-color-secondary)]">
            坐落与行政归属 —— 这几项决定这条案例将来能不能被召回
          </span>
        </el-divider>

        <el-alert
          v-for="(note, idx) in advisories"
          :key="idx"
          :title="note"
          type="warning"
          :closable="false"
          show-icon
          class="mb-8px"
        />

        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="城市">
              <el-input v-model="formData.cityCode" placeholder="与标的属性里的「城市」填同一个字符串" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="区县">
              <el-input v-model="formData.districtCode" placeholder="与标的属性里的「区县」同一口径" />
            </el-form-item>
          </el-col>
        </el-row>
        <div class="form-hint -mt-8px mb-12px">
          这两栏是<b>文本</b>，不是行政区划码：标的侧那两项来自品类参数，也是文本框，
          而召回第 1 层按文本严格相等比。一边写「杭州市」另一边写「330100」，
          结果是这条案例一条都召回不到 —— 台账里看得见，没有任何一处报错。
        </div>

        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="小区名">
              <el-select
                v-model="formData.communityName"
                filterable
                remote
                allow-create
                default-first-option
                clearable
                reserve-keyword
                :remote-method="searchCommunities"
                :loading="communityLoading"
                placeholder="输入关键字补全，库里没有的可以直接打"
                class="w-full"
              >
                <el-option v-for="name in communityOptions" :key="name" :label="name" :value="name" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="坐落地址">
              <el-input v-model="formData.address" placeholder="门牌到号" clearable />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="房屋用途">
              <el-select
                v-model="formData.purpose"
                filterable
                allow-create
                default-first-option
                clearable
                placeholder="如 住宅"
                class="w-full"
              >
                <el-option
                  v-for="item in CASE_USAGE_SUGGESTIONS"
                  :key="item.value"
                  :label="item.label"
                  :value="item.value"
                />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="权利性质">
              <el-select
                v-model="formData.rightType"
                filterable
                allow-create
                default-first-option
                clearable
                placeholder="如 出让"
                class="w-full"
              >
                <el-option
                  v-for="item in CASE_RIGHT_TYPE_SUGGESTIONS"
                  :key="item.value"
                  :label="item.label"
                  :value="item.value"
                />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <div class="form-hint -mt-8px mb-12px">
          这里的「房屋用途」不是项目上那个「评估目的」（抵押 / 转让 / 清算）。
          两个字段在后端同名，用错一份的案例会永远召回不到。
        </div>

        <el-divider content-position="left">
          <span class="text-13px text-[var(--el-text-color-secondary)]">
            实物状况 —— 选填，但打分表里各有对应的一项
          </span>
        </el-divider>

        <el-row :gutter="16">
          <el-col :span="8">
            <el-form-item label="楼层">
              <el-input v-model="formData.floorInfo" placeholder="如 12/18" clearable />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="朝向">
              <el-select
                v-model="formData.orientation"
                filterable
                allow-create
                default-first-option
                clearable
                placeholder="请选择"
                class="w-full"
              >
                <el-option
                  v-for="item in CASE_ORIENTATION_SUGGESTIONS"
                  :key="item.value"
                  :label="item.label"
                  :value="item.value"
                />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="装修状况">
              <el-select
                v-model="formData.decoration"
                filterable
                allow-create
                default-first-option
                clearable
                placeholder="请选择"
                class="w-full"
              >
                <el-option
                  v-for="item in CASE_DECORATION_SUGGESTIONS"
                  :key="item.value"
                  :label="item.label"
                  :value="item.value"
                />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="16">
          <el-col :span="8">
            <el-form-item label="建成年份">
              <el-input-number
                v-model="formData.builtYear"
                :min="1900"
                :max="2100"
                :precision="0"
                :controls="false"
                placeholder="如 2009"
                class="!w-full"
              />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="建筑结构">
              <el-input v-model="formData.structure" placeholder="如 钢混" clearable />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="经度 / 纬度">
              <div class="flex gap-4px w-full">
                <el-input-number
                  v-model="formData.lng"
                  :precision="6"
                  :controls="false"
                  placeholder="经度"
                  class="!w-full"
                />
                <el-input-number
                  v-model="formData.lat"
                  :precision="6"
                  :controls="false"
                  placeholder="纬度"
                  class="!w-full"
                />
              </div>
            </el-form-item>
          </el-col>
        </el-row>
        <div class="form-hint -mt-8px mb-12px">
          经纬度要么两个都填、要么都不填。只填一个的话整组会被丢掉（不会补 0）——
          补 0 会把这条案例算到几内亚湾，而空间召回那一层把它当成一个真实坐标去比距离。
        </div>

        <el-form-item label="备注">
          <el-input v-model="formData.remark" type="textarea" :rows="2" placeholder="选填" />
        </el-form-item>
      </el-form>

      <!-- ==================== 屏 2：证据 ==================== -->
      <div v-show="step === 1">
        <el-alert type="info" :closable="false" show-icon class="mb-12px">
          <template #title>
            这一屏<b>不可跳过</b>：无证据的案例在质询时无法自证，等于没有。
          </template>
        </el-alert>

        <el-form :model="formData" label-width="118px">
          <el-form-item label="佐证材料" required>
            <el-upload
              :show-file-list="false"
              :http-request="doUpload"
              accept=".pdf,.jpg,.jpeg,.png,.bmp,.webp,.doc,.docx,.xls,.xlsx"
            >
              <el-button type="primary" plain :loading="uploading">
                <Icon icon="ep:upload" class="mr-5px" /> 选择文件并上传
              </el-button>
            </el-upload>
            <div v-if="formData.evidenceFileId" class="ml-12px">
              <Icon icon="ep:document-checked" class="text-[var(--el-color-success)] mr-4px" />
              {{ formData.evidenceFileName || `已上传（文件编号 ${formData.evidenceFileId}）` }}
              <el-button link type="danger" class="ml-8px" @click="clearEvidence">移除</el-button>
            </div>
            <div class="form-hint w-full">
              不动产权证 / 买卖合同 / 契税完税凭证 / 挂牌成交截图均可，单份不超过 10 MB
              （以服务端为准，超了会返回一条带具体数字的报错）。
              重新上传会替换掉当前这一份。
            </div>
          </el-form-item>

          <el-form-item label="佐证类型" required>
            <el-select v-model="formData.evidenceKind" placeholder="请选择" class="!w-240px">
              <el-option
                v-for="item in evidenceKindOptions"
                :key="item.code"
                :label="item.name"
                :value="item.code"
              />
            </el-select>
          </el-form-item>

          <el-form-item label="来源链接">
            <el-input v-model="formData.originUrl" placeholder="选填：公开披露页面的网址" clearable />
          </el-form-item>

          <el-divider content-position="left">
            <span class="text-13px text-[var(--el-text-color-secondary)]">还原登记</span>
          </el-divider>

          <el-form-item label="做过价格还原">
            <el-switch v-model="formData.priceRestoredFlag" />
            <span class="ml-8px text-12px text-[var(--el-text-color-secondary)]">
              合同价被做低（避税、内部交易等）时打开，填还原后的真实价与依据
            </span>
          </el-form-item>

          <template v-if="formData.priceRestoredFlag">
            <el-form-item label="还原后真实价（元）">
              <el-input-number
                v-model="formData.realPriceRestored"
                :precision="2"
                :min="0"
                :controls="false"
                placeholder="还原之后的真实成交价"
                class="!w-240px"
              />
              <span class="ml-8px text-12px text-[var(--el-text-color-secondary)]">
                {{ wanYuanHint(formData.realPriceRestored) }}
              </span>
            </el-form-item>
            <el-form-item label="还原理由与依据">
              <el-input
                v-model="formData.restoreReason"
                type="textarea"
                :rows="3"
                placeholder="如：按契税完税凭证还原做低部分，凭证编号 …"
              />
            </el-form-item>
            <div class="form-hint -mt-8px mb-12px">
              召回与测算用的是<b>还原后的价</b>，成交价那一栏只做留痕。
              两个框要么都填、要么都清空 —— 关掉开关会把两个值一起清掉。
            </div>
          </template>
        </el-form>
      </div>

      <!-- ==================== 屏 3：确认与复用 ==================== -->
      <div v-show="step === 2">
        <el-descriptions :column="2" border size="small" class="mb-16px">
          <el-descriptions-item label="案例库类型">
            {{ caseKindName(formData.caseKind) || '（未选）' }}
          </el-descriptions-item>
          <el-descriptions-item label="成交日期">
            {{ formData.transactionDate || '（未填）' }}
          </el-descriptions-item>
          <el-descriptions-item label="成交价">
            {{ formData.transactionPrice }} 元 {{ wanYuanHint(formData.transactionPrice) }}
          </el-descriptions-item>
          <el-descriptions-item label="生效价">
            <span v-if="formData.realPriceRestored" class="text-[var(--el-color-warning)]">
              {{ formData.realPriceRestored }} 元（已还原）
            </span>
            <span v-else>同成交价</span>
          </el-descriptions-item>
          <el-descriptions-item label="建筑面积">{{ formData.buildingArea }} ㎡</el-descriptions-item>
          <el-descriptions-item label="单价">
            {{ formData.unitPriceTouched ? formData.unitPrice : computedPrice }} 元/㎡
            <span v-if="!formData.unitPriceTouched" class="text-12px">（系统算）</span>
          </el-descriptions-item>
          <el-descriptions-item label="小区名">
            {{ formData.communityName || '（未填：拿不到「同小区 +40」那一项）' }}
          </el-descriptions-item>
          <el-descriptions-item label="坐落">{{ formData.address || '（未填）' }}</el-descriptions-item>
          <el-descriptions-item label="城市 / 区县">
            {{ formData.cityCode || '（未填）' }} / {{ formData.districtCode || '（未填）' }}
          </el-descriptions-item>
          <el-descriptions-item label="用途 / 权利性质">
            {{ formData.purpose || '（未填）' }} / {{ formData.rightType || '（未填）' }}
          </el-descriptions-item>
          <el-descriptions-item label="佐证材料" :span="2">
            {{ formData.evidenceFileName || `文件编号 ${formData.evidenceFileId}` }}
            <span class="ml-8px text-12px">（{{ evidenceKindName(formData.evidenceKind) }}）</span>
          </el-descriptions-item>
        </el-descriptions>

        <div class="mb-8px text-13px font-bold">这条案例写进报告时的来源披露文本</div>
        <el-alert v-if="disclosureLoading" type="info" :closable="false" title="正在生成…" />
        <el-alert
          v-else-if="disclosureText === null"
          type="info"
          :closable="false"
          show-icon
          title="这一类来源不生成人工录入披露文本（走闸 G-10 的署名文本）"
        />
        <el-alert
          v-else-if="disclosureText === ''"
          type="info"
          :closable="false"
          title="还没有生成：回到上一屏再点「下一步」即可重新生成"
        />
        <div v-else class="disclosure-box">{{ disclosureText }}</div>
        <div class="form-hint">
          这段文本由后端按 R47 生成，<b>保存之后就会出现在报告里</b>。
          现在看到的就是将来写出去的，措辞要改请在保存之前提出来。
        </div>

        <el-alert
          v-for="(issue, idx) in finalIssues"
          :key="idx"
          :title="issue"
          type="error"
          :closable="false"
          show-icon
          class="mt-8px"
        />
      </div>
    </div>

    <template #footer>
      <el-button v-if="step > 0" :disabled="saving" @click="goPrev">上一步</el-button>
      <el-tooltip
        v-if="step < STEP_COUNT - 1"
        :disabled="canNext"
        :content="nextBlockedHint"
        placement="top"
      >
        <span>
          <el-button type="primary" :disabled="!canNext" @click="goNext">下一步</el-button>
        </span>
      </el-tooltip>
      <template v-else>
        <el-button type="primary" :loading="saving" :disabled="finalIssues.length > 0" @click="submit(false)">
          保 存
        </el-button>
        <el-button
          type="success"
          :loading="saving"
          :disabled="finalIssues.length > 0 || formType !== 'create'"
          @click="submit(true)"
        >
          保存并继续录下一条
        </el-button>
      </template>
      <el-button :disabled="saving" @click="dialogVisible = false">取 消</el-button>
    </template>
  </Dialog>
</template>
<script lang="ts" setup>
import {
  CASE_DECORATION_SUGGESTIONS,
  CASE_ORIENTATION_SUGGESTIONS,
  CASE_RIGHT_TYPE_SUGGESTIONS,
  CASE_USAGE_SUGGESTIONS
} from '@/views/qlzg/constants'
import { QlzgCaseApi, type QlzgCaseImportConfigVO } from '@/api/qlzg/case'
import {
  STEP_COUNT,
  STEP_TITLES,
  canGoNextStep,
  carryOverForNextEntry,
  computedUnitPrice,
  emptyCaseForm,
  fromRespVO,
  saveIssues,
  step0Advisories,
  step0Issues,
  step1Issues,
  toSaveVO,
  unitPriceConsistent,
  unitPriceDeviationPercent,
  wanYuanHint,
  type QlzgCaseFormModel
} from './caseSchema'

defineOptions({ name: 'QlzgCaseForm' })

/**
 * 案例录入 / 编辑：三屏向导（V5 §11.2.2）
 *
 * <h3>🔴 全部判定逻辑都在 `caseSchema.ts`，这里只做装配</h3>
 * 单价 5%、还原价与理由的双向必填、屏 2 不可跳过、经纬度要么都填要么都不填 ——
 * 那些判定各有一条用例守着（`caseSchema.spec.ts`）。
 * 写在这个 `.vue` 里的话一条都测不了：本仓 vitest 跑在 node 环境，
 * 而 `.vue` 必然值导入 API 层，收集阶段就 `window is not defined`。
 * 所以规矩是**要测的逻辑搬进纯模块**，`.vue` 里只留装配与事件。
 *
 * <h3>🔴 三屏用 `v-show` 而不是 `v-if`</h3>
 * `v-if` 会把上一屏的表单整棵销毁，回来时 `el-form` 的校验状态与
 * `el-select` 的远程搜索结果全没了。D3 ① 的验收是「三屏填完 ≤ 30 秒」，
 * 每翻一屏重填一次就超了。
 *
 * <h3>🔴 「保存并继续录下一条」清掉佐证材料，且只在新增态出现</h3>
 * 编辑态那个按钮禁用：改完一条又「继续录下一条」在语义上说不通，
 * 而它会把表单换成一份新增态的空表单，用户以为还在改原来那条。
 * 清佐证的理由写在 `carryOverForNextEntry` 的注释里 ——
 * 不清的话第二条案例会挂着第一条的截图，而两行的披露文本各自引用自己的附件名，
 * 存进去之后「这条案例的证据是哪一份」就再也查不出来了，且没有一处报错。
 *
 * <h3>🔴 刻意**没有**品类属性（`attrs`）编辑区</h3>
 * 后端 `QlzgCaseDO#attrs` 的注释写得很死：那一列**没有事实源**（案例行上没有
 * `category_code`，而「案例库类型 → 品类」不是一个函数，反查会得到两份互相冲突的
 * schema），MVP 期**没有任何消费方**，且明确要求「不要给它加校验规则」。
 * 所以这里不渲染编辑器，只做两件事：新增时它是 `null`；
 * 编辑时由 `fromRespVO` 原样带过来、`toSaveVO` 原样发回去（别丢掉来源给的额外字段）。
 *
 * <h3>⚠️ 单价那一栏的占位符是「系统算出来的值」，不是真的值</h3>
 * 用户没碰过它时 `unitPriceTouched` 是 false，提交**不带** `unitPrice`，由后端算。
 * 把前端算的值传回去，等于要求两份舍入实现逐位相同 —— 差一分就是一句「单价不一致」，
 * 而用户填的正是系统自己显示给他的那个数。
 */

const { t } = useI18n()
const message = useMessage()

const dialogVisible = ref(false)
const dialogTitle = ref('')
const formLoading = ref(false)
const saving = ref(false)
const formType = ref('')
const formRef = ref()
const step = ref(0)

const formData = ref<QlzgCaseFormModel>(emptyCaseForm())

/** 选项来自 `/get-import-config`，由台账页传进来（不在前端写死，机构停用一个品类它就少一项） */
const importConfig = ref<QlzgCaseImportConfigVO>({})
const caseKindOptions = computed(() => importConfig.value.caseKinds ?? [])
const evidenceKindOptions = computed(() => importConfig.value.evidenceKinds ?? [])
const caseKindName = (code?: string) =>
  caseKindOptions.value.find((item) => item.code === code)?.name ?? code ?? ''
const evidenceKindName = (code?: string) =>
  evidenceKindOptions.value.find((item) => item.code === code)?.name ?? code ?? '未标注'

// ==================== 屏 1 ====================

const advisories = computed(() => step0Advisories(formData.value))
const step0 = computed(() => step0Issues(formData.value))

const computedPrice = computed(() =>
  computedUnitPrice(formData.value.transactionPrice, formData.value.buildingArea)
)
const autoUnitPricePlaceholder = computed(() =>
  computedPrice.value === null ? '填了成交价与面积后自动算' : `自动算出 ${computedPrice.value}`
)
const unitPriceOk = computed(() =>
  unitPriceConsistent(
    formData.value.unitPriceTouched ? formData.value.unitPrice : null,
    computedPrice.value
  )
)
const unitPriceDeviation = computed(() =>
  unitPriceDeviationPercent(formData.value.unitPrice, computedPrice.value)
)

const communityOptions = ref<string[]>([])
const communityLoading = ref(false)
const searchCommunities = async (keyword: string) => {
  if (!keyword?.trim()) {
    communityOptions.value = []
    return
  }
  communityLoading.value = true
  try {
    communityOptions.value = await QlzgCaseApi.suggestCommunityNames(keyword.trim(), 20)
  } catch {
    communityOptions.value = []
  } finally {
    communityLoading.value = false
  }
}

// ==================== 屏 2 ====================

const uploading = ref(false)

/**
 * `el-upload` 的自定义上传：走 `/qlzg/case/upload-evidence`，不走 `/infra/file/upload`
 *
 * 🔴 区别在于**拿不拿得到文件编号**：`evidenceFileId` 是屏 2 的必填项，
 *    而 `/infra/file/upload` 只返回一个 URL 字符串。走 presign + `/infra/file/create`
 *    能拿到编号，却落不下 `biz_type` —— 存储账单里「案例佐证」会永远是 0 且不报错。
 * 🔴 服务端把 `bizType` 写死，**不接受任何来自请求的值**：让客户端指定的话，
 *    任何人都能写 `QLZG_SEAL`，把一份文件塞进那个免鉴权的中转下载白名单里。
 */
const doUpload = async (options: any) => {
  uploading.value = true
  try {
    const res = await QlzgCaseApi.uploadEvidence(options.file as File)
    formData.value.evidenceFileId = res.fileId
    formData.value.evidenceFileName = res.fileName
    message.success('佐证材料已上传')
  } catch {
    // 全局拦截器已经把后端那句文案弹出来了（它带着文件名、实际大小与上限）
  } finally {
    uploading.value = false
  }
}

const clearEvidence = () => {
  formData.value.evidenceFileId = null
  formData.value.evidenceFileName = ''
}

/**
 * 🔴 关掉开关时**必须把两个值一起清掉**
 *
 * 判据是「值」不是这个开关（见 `restorePairIssue`）。只把开关拨回去而留着值，
 * 用户看到的是「两个框都消失了」+「下一步点不动」，
 * 而拦住他的那句「填了还原价就必须写理由」在界面上没有任何一处显示得出来
 */
watch(
  () => formData.value.priceRestoredFlag,
  (on) => {
    if (!on) {
      formData.value.realPriceRestored = null
      formData.value.restoreReason = ''
    }
  }
)

// ==================== 屏 3 ====================

const step1 = computed(() => step1Issues(formData.value))
const finalIssues = computed(() => saveIssues(formData.value))

const disclosureText = ref<string | null>('')
const disclosureLoading = ref(false)
const loadDisclosure = async () => {
  disclosureLoading.value = true
  try {
    disclosureText.value = await QlzgCaseApi.previewDisclosure(toSaveVO(formData.value))
  } catch {
    // 🔴 失败时置成 `''`（还没生成），**不是** `null`：
    //    `null` 是后端明确回答「这一类来源不生成人工录入披露文本」，
    //    把一次网络失败显示成那个结论，等于替后端撒了一个关于来源类型的谎。
    //    预览失败也不拦保存 —— 保存时后端还会再算一次，那次才是写进报告的那一份
    disclosureText.value = ''
  } finally {
    disclosureLoading.value = false
  }
}

// ==================== 闸门 ====================

const canNext = computed(() => canGoNextStep(step.value, formData.value))
const nextBlockedHint = computed(() => {
  const issues = step.value === 0 ? step0.value : step1.value
  return issues.length === 0 ? '' : issues.join('；')
})

const goNext = () => {
  if (!canNext.value) return
  step.value++
  if (step.value === STEP_COUNT - 1) loadDisclosure()
}
const goPrev = () => {
  if (step.value > 0) step.value--
}

// ==================== 打开 / 提交 ====================

const open = async (type: string, id?: number, config?: QlzgCaseImportConfigVO) => {
  dialogVisible.value = true
  dialogTitle.value = type === 'create' ? '录入案例' : '修改案例'
  formType.value = type
  step.value = 0
  resetForm()
  if (config) importConfig.value = config
  else if (!importConfig.value.caseKinds) {
    // 台账页没传（例如从别处直接打开）时自己取一次
    try {
      importConfig.value = await QlzgCaseApi.getImportConfig()
    } catch {}
  }
  if (!id) return
  formLoading.value = true
  try {
    const row = await QlzgCaseApi.getCase(id)
    // 🔴 逐列填满：`updateCase` 是**整行替换**，漏一列就会把那一列清空，
    //    而界面上是一个正常的编辑弹窗加一句「修改成功」。
    //    这条由 caseSchema.spec.ts 里那条穷尽性用例守着
    formData.value = fromRespVO(row)
  } finally {
    formLoading.value = false
  }
}
defineExpose({ open })

const emit = defineEmits(['success'])

const submit = async (keepEntering: boolean) => {
  if (finalIssues.value.length > 0) {
    message.error(finalIssues.value.join('；'))
    // 🔴 跳回第一个有问题的屏：编辑态是直接进来的，没走过闸门，
    //    缺的东西可能在屏 1 也可能在屏 2，停在屏 3 用户不知道去哪改
    step.value = step0.value.length > 0 ? 0 : 1
    return
  }
  saving.value = true
  try {
    const payload = toSaveVO(formData.value)
    if (formType.value === 'create') {
      await QlzgCaseApi.createCase(payload)
      message.success(t('common.createSuccess'))
    } else {
      await QlzgCaseApi.updateCase(payload)
      message.success(t('common.updateSuccess'))
    }
    emit('success')
    if (keepEntering) {
      formData.value = carryOverForNextEntry(formData.value)
      step.value = 0
      disclosureText.value = ''
      communityOptions.value = []
    } else {
      dialogVisible.value = false
    }
  } finally {
    saving.value = false
  }
}

const resetForm = () => {
  formData.value = emptyCaseForm()
  disclosureText.value = ''
  communityOptions.value = []
  formRef.value?.clearValidate()
}
</script>
<style lang="scss" scoped>
.form-hint {
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}

.form-issue {
  width: 100%;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-color-danger);
}

.disclosure-box {
  padding: 12px;
  font-size: 13px;
  line-height: 1.8;
  white-space: pre-wrap;
  background: var(--el-fill-color-light);
  border-left: 3px solid var(--el-color-primary);
  border-radius: 4px;
}
</style>
