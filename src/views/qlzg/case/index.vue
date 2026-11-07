<template>
  <ContentWrap>
    <!-- 搜索工作栏 -->
    <el-form
      class="-mb-15px"
      :model="queryParams"
      ref="queryFormRef"
      :inline="true"
      label-width="96px"
    >
      <el-form-item label="案例库类型" prop="caseKind">
        <el-select
          v-model="queryParams.caseKind"
          placeholder="全部类型"
          clearable
          class="!w-240px"
        >
          <el-option
            v-for="item in caseKindOptions"
            :key="item.code"
            :label="item.name"
            :value="item.code"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="库范围" prop="tenantScope">
        <el-select
          v-model="queryParams.tenantScope"
          placeholder="全部（私有 + 共享）"
          clearable
          class="!w-240px"
        >
          <el-option
            v-for="item in CASE_TENANT_SCOPE_OPTIONS"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="来源类型" prop="sourceType">
        <el-select
          v-model="queryParams.sourceType"
          placeholder="全部来源"
          clearable
          class="!w-240px"
        >
          <el-option
            v-for="item in CASE_SOURCE_TYPE_OPTIONS"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="小区名" prop="communityName">
        <el-input
          v-model="queryParams.communityName"
          placeholder="请输入小区名"
          clearable
          class="!w-240px"
          @keyup.enter="handleQuery"
        />
      </el-form-item>
      <el-form-item label="坐落" prop="address">
        <el-input
          v-model="queryParams.address"
          placeholder="请输入坐落地址"
          clearable
          class="!w-240px"
          @keyup.enter="handleQuery"
        />
      </el-form-item>
      <el-form-item label="城市" prop="cityCode">
        <el-input
          v-model="queryParams.cityCode"
          placeholder="与标的属性同一口径"
          clearable
          class="!w-180px"
          @keyup.enter="handleQuery"
        />
      </el-form-item>
      <el-form-item label="用途" prop="purpose">
        <el-input
          v-model="queryParams.purpose"
          placeholder="如 住宅"
          clearable
          class="!w-140px"
          @keyup.enter="handleQuery"
        />
      </el-form-item>
      <el-form-item label="权利性质" prop="rightType">
        <el-input
          v-model="queryParams.rightType"
          placeholder="如 出让"
          clearable
          class="!w-140px"
          @keyup.enter="handleQuery"
        />
      </el-form-item>
      <el-form-item label="已核实" prop="isVerified">
        <el-select v-model="queryParams.isVerified" placeholder="全部" clearable class="!w-120px">
          <el-option label="是" :value="true" />
          <el-option label="否" :value="false" />
        </el-select>
      </el-form-item>
      <el-form-item label="成交日期" prop="transactionDate">
        <el-date-picker
          v-model="queryParams.transactionDate"
          value-format="YYYY-MM-DD"
          type="daterange"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          class="!w-240px"
        />
      </el-form-item>
      <el-form-item>
        <el-button @click="handleQuery"><Icon icon="ep:search" class="mr-5px" /> 搜索</el-button>
        <el-button @click="resetQuery"><Icon icon="ep:refresh" class="mr-5px" /> 重置</el-button>
        <el-button type="primary" plain @click="openForm('create')" v-hasPermi="['qlzg:case:create']">
          <Icon icon="ep:plus" class="mr-5px" /> 录入案例
        </el-button>
        <el-button type="warning" plain @click="openImport" v-hasPermi="['qlzg:case:create']">
          <Icon icon="ep:upload" class="mr-5px" /> 批量导入
        </el-button>
        <el-button type="success" plain @click="handleExport" v-hasPermi="['qlzg:case:query']">
          <Icon icon="ep:download" class="mr-5px" /> 导出
        </el-button>
      </el-form-item>
    </el-form>
  </ContentWrap>

  <!-- 列表 -->
  <ContentWrap>
    <el-table class="xpy-list-table" stripe v-loading="loading" :data="list">
      <el-table-column
        label="序号"
        type="index"
        width="44"
        align="center"
        :index="indexMethod(queryParams)"
        class-name="col-index"
        label-class-name="col-index"
      />
      <el-table-column label="案例库类型" align="center" prop="caseKind" width="120">
        <template #default="scope">{{ caseKindName(scope.row.caseKind) }}</template>
      </el-table-column>
      <el-table-column label="小区名" align="center" prop="communityName" min-width="140">
        <template #default="scope">
          <span v-if="scope.row.communityName">{{ scope.row.communityName }}</span>
          <el-tooltip v-else content="留空 ⇒ 打分表里权重最高的「同小区 +40」拿不到">
            <span class="text-[var(--el-text-color-placeholder)]">（未填）</span>
          </el-tooltip>
        </template>
      </el-table-column>
      <el-table-column label="坐落" align="center" prop="address" min-width="200" show-overflow-tooltip />
      <el-table-column label="用途" align="center" prop="purpose" width="80" />
      <el-table-column label="权利性质" align="center" prop="rightType" width="90" />
      <el-table-column label="成交日期" align="center" prop="transactionDate" width="110" />
      <el-table-column label="成交价（元）" align="right" prop="transactionPrice" width="130">
        <template #default="scope">
          <span v-if="scope.row.realPriceRestored" class="line-through text-[var(--el-text-color-placeholder)]">
            {{ thousands(scope.row.transactionPrice) }}
          </span>
          <span v-else>{{ thousands(scope.row.transactionPrice) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="生效价（元）" align="right" width="130">
        <template #default="scope">
          <el-tooltip
            v-if="scope.row.realPriceRestored"
            :content="scope.row.restoreReason || '已做还原登记，但未写还原理由'"
            placement="top"
          >
            <span class="text-[var(--el-color-warning)]">
              {{ thousands(scope.row.realPriceRestored) }}
            </span>
          </el-tooltip>
          <span v-else class="text-[var(--el-text-color-placeholder)]">—</span>
        </template>
      </el-table-column>
      <el-table-column label="面积（㎡）" align="right" prop="buildingArea" width="100" />
      <el-table-column label="单价（元/㎡）" align="right" prop="unitPrice" width="120">
        <template #default="scope">{{ thousands(scope.row.unitPrice) }}</template>
      </el-table-column>
      <el-table-column label="来源" align="center" prop="sourceTypeDescription" width="100">
        <template #default="scope">
          <el-tooltip
            v-if="scope.row.disclosureText"
            :content="scope.row.disclosureText"
            placement="top"
          >
            <span class="cursor-help">{{ scope.row.sourceTypeDescription }}</span>
          </el-tooltip>
          <span v-else>{{ scope.row.sourceTypeDescription }}</span>
          <div v-if="scope.row.sourceName" class="text-12px text-[var(--el-text-color-secondary)]">
            {{ scope.row.sourceName }}
          </div>
        </template>
      </el-table-column>
      <el-table-column label="库范围" align="center" prop="tenantScope" width="110">
        <template #default="scope">
          <el-tag :type="caseTenantScopeTagType(scope.row.tenantScope)" size="small">
            {{ scope.row.tenantScopeDescription }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="已核实" align="center" prop="isVerified" width="80">
        <template #default="scope">
          <el-tag v-if="scope.row.isVerified" type="success" size="small">是</el-tag>
          <span v-else class="text-[var(--el-text-color-placeholder)]">否</span>
        </template>
      </el-table-column>
      <el-table-column label="佐证" align="center" width="70">
        <template #default="scope">
          <el-tooltip
            v-if="scope.row.evidenceFileId"
            :content="`佐证类型：${scope.row.evidenceKindDescription || '未标注'}`"
          >
            <Icon icon="ep:document-checked" class="text-[var(--el-color-success)]" />
          </el-tooltip>
          <el-tooltip v-else content="没有佐证材料的案例在质询时无法自证，等于没有">
            <Icon icon="ep:warning" class="text-[var(--el-color-danger)]" />
          </el-tooltip>
        </template>
      </el-table-column>
      <el-table-column label="录入人" align="center" prop="enteredByNickname" width="100" />
      <el-table-column
        label="录入时间"
        align="center"
        prop="enteredAt"
        width="170"
        :formatter="dateFormatter"
      />
      <el-table-column label="操作" align="center" min-width="130" fixed="right">
        <template #default="scope">
          <!--
            🔴 共享库的行（tenant_id IS NULL）**看得见但改不了**，所以这里直接不画按钮，
               而不是画出来等后端拒：后端那道判定是对的，但用户点下去才知道
               「原来这一行不是我的」，而界面上没有任何一处事先说明。
               `editable` 就是后端给的这个判据。
          -->
          <template v-if="scope.row.editable !== false">
            <el-button
              link
              type="primary"
              @click="openForm('update', scope.row.id)"
              v-hasPermi="['qlzg:case:update']"
            >
              编辑
            </el-button>
            <el-button
              link
              type="danger"
              @click="handleDelete(scope.row)"
              v-hasPermi="['qlzg:case:delete']"
            >
              删除
            </el-button>
          </template>
          <el-tooltip v-else content="平台共享库的案例：本机构可读、可召回，不可修改或删除">
            <span class="text-12px text-[var(--el-text-color-placeholder)]">共享库只读</span>
          </el-tooltip>
        </template>
      </el-table-column>
    </el-table>
    <Pagination
      :total="total"
      v-model:page="queryParams.pageNo"
      v-model:limit="queryParams.pageSize"
      @pagination="getList"
    />
  </ContentWrap>

  <!-- 录入 / 编辑（三屏向导） -->
  <CaseForm ref="formRef" @success="getList" />

  <!-- 批量导入向导 -->
  <CaseImportForm ref="importFormRef" @success="getList" />

  <!-- 导出弹窗 -->
  <LedgerExportForm ref="exportFormRef" />
</template>
<script lang="ts" setup>
import { dateFormatter } from '@/utils/formatTime'
import {
  CASE_SOURCE_TYPE_OPTIONS,
  CASE_TENANT_SCOPE_OPTIONS,
  caseTenantScopeTagType,
  thousands
} from '@/views/qlzg/constants'
import {
  QlzgCaseApi,
  type QlzgCaseImportConfigVO,
  type QlzgCaseVO
} from '@/api/qlzg/case'
import CaseForm from './CaseForm.vue'
import CaseImportForm from './CaseImportForm.vue'
import LedgerExportForm from '@/views/qlzg/components/LedgerExportForm.vue'

/**
 * 案例台账
 *
 * <h3>🔴 「库范围」那一栏是**再收窄**，不是可见性开关</h3>
 * 留空时后端默认跨「本机构私有库」与「平台共享库」一起查。所以把它当成
 * 「只看我自己的」来用是错的 —— 要看自己的得显式选「本机构私有库」。
 * 共享库的行 `editable` 为 false，界面上直接不画编辑与删除。
 *
 * <h3>🔴 「成交价」与「生效价」是两列，做过还原登记的案例两列都有值</h3>
 * 做过还原时成交价画删除线、生效价用告警色，鼠标停在生效价上显示还原理由。
 * 只画一列的话，用户看不出这个价是「合同上的数」还是「还原之后的数」，
 * 而两者的差就是做低那部分 —— 那正是评估师要向质询方交代的东西。
 *
 * <h3>🔴 「城市」「用途」「权利性质」三栏是**文本**输入，不是下拉</h3>
 * 这三列在案例侧是自由文本（各地不动产登记口径不一致，V5 刻意不做成枚举），
 * 而在标的侧它们是品类参数 `city_code` / `usage` / `right_type`，也是文本框。
 * 召回第 1、2、3 层是**硬过滤，按文本严格相等比**，所以两侧必须填同一个字符串：
 * 一边写「杭州市」另一边写「330100」，结果是**一条都召回不到，且没有任何一处报错**。
 * ⚠️ 这里刻意**不**换成行政区划选择器：换了只会让案例侧单方面变成码，
 *    与标的侧的文本口径彻底分家。要做就两侧一起做（连同 `qlzg_category.param_schema`
 *    里那三个 STRING 参数的控件类型），那是另一个迭代的活。
 *
 * <h3>🔴 没有「批量删除」</h3>
 * 后端没有这个端点。已被召回结果引用的案例删不掉（`CASE_REFERENCED_BY_MATCH`），
 * 批量的结果只能是「一部分成功、一部分失败」，而用户拿到的是一句「已删除」。
 *
 * <h3>⚠️ 「录入案例」与「批量导入」用的是同一个权限点 `qlzg:case:create`</h3>
 * 后端 `/import-execute` 上挂的就是它，本控制器刻意没有新造 `:import`。
 * 新权限串没有对应的按钮菜单时，`PermissionScanRunner` 只建出一条 `menu_id` 为 NULL 的
 * 承载行，于是**非超管静默失去这个能力**（授权照授、URL 照通、就是按钮看不见）。
 */
defineOptions({ name: 'QlzgCase' })

const message = useMessage()
const { t } = useI18n()

const loading = ref(true)
const total = ref(0)
const list = ref<QlzgCaseVO[]>([])
const queryParams = reactive({
  pageNo: 1,
  pageSize: 20,
  caseKind: undefined as string | undefined,
  tenantScope: undefined as string | undefined,
  sourceType: undefined as string | undefined,
  communityName: '',
  address: '',
  cityCode: '',
  purpose: '',
  rightType: '',
  isVerified: undefined as boolean | undefined,
  transactionDate: [] as string[]
})
const queryFormRef = ref()

/**
 * 案例库类型的选项来自 `/get-import-config`，**不在前端写死**
 *
 * 🔴 它是按 `qlzg_category.case_kind` 分组算出来的，机构停用一个品类它就少一项。
 *    前端抄一份的话，停用之后这里还列着，选中它去搜得到的是空列表 —— 看着像「案例都没了」
 */
const importConfig = ref<QlzgCaseImportConfigVO>({})
const caseKindOptions = computed(() => importConfig.value.caseKinds ?? [])
const caseKindName = (code?: string) =>
  caseKindOptions.value.find((item) => item.code === code)?.name ?? code ?? ''

const getList = async () => {
  loading.value = true
  try {
    const data = await QlzgCaseApi.getCasePage(queryParams)
    list.value = data.list
    total.value = data.total
  } finally {
    loading.value = false
  }
}

const handleQuery = () => {
  queryParams.pageNo = 1
  getList()
}

const resetQuery = () => {
  queryFormRef.value.resetFields()
  handleQuery()
}

const exportFormRef = ref()
const handleExport = () => {
  exportFormRef.value?.open({
    ledgerName: '案例台账',
    fetcher: QlzgCaseApi.exportExcel,
    pageNo: queryParams.pageNo,
    pageSize: queryParams.pageSize,
    total: total.value,
    buildParams: () => ({ ...queryParams }),
    contentHints: [
      '导出的是当前搜索条件下的案例，含平台共享库的行。',
      '成交价、生效价、单价的单位都是【元】，不是万元。',
      '做过还原登记的案例，成交价与还原后的真实价两列都会导出。'
    ]
  })
}

const formRef = ref()
const openForm = (type: string, id?: number) => {
  // 🔴 把配置一起传进去：表单要的是同一份 `caseKinds` 与 `evidenceKinds`。
  //    让它自己再取一次就是同一个接口打两遍，而两份结果可能不一致
  //    （机构刚停用一个品类），于是台账下拉里有、表单下拉里没有
  formRef.value.open(type, id, importConfig.value)
}

const importFormRef = ref()
const openImport = () => {
  importFormRef.value.open(importConfig.value)
}

const handleDelete = async (row: QlzgCaseVO) => {
  try {
    await message.delConfirm(
      `确定要删除案例「${row.communityName || row.address || row.id}」吗？` +
        '已被召回结果引用的案例删不掉 —— 那份测算的依据不能凭空消失，' +
        '要改请用「编辑」。',
      '删除案例'
    )
    await QlzgCaseApi.deleteCase(row.id)
    message.success(t('common.delSuccess'))
    await getList()
  } catch {}
}

onMounted(async () => {
  // 🔴 两个请求并发发出去：配置只用于填下拉与解释文案，
  //    它失败了也不该让台账空白（所以刻意不 await 在一起）
  getList()
  try {
    importConfig.value = await QlzgCaseApi.getImportConfig()
  } catch {
    // 拿不到配置时「案例库类型」下拉是空的，但台账照常能用
  }
})
</script>
