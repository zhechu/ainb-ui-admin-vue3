<template>
  <ContentWrap title="话术库">
    <template #header>
      <div class="flex items-center justify-end w-full">
        <el-button type="primary" plain @click="openForm()" v-hasPermi="['qlzg:phrase:create']">
          <Icon icon="ep:plus" class="mr-5px" /> 新建话术
        </el-button>
        <el-button :loading="loading" @click="getList">
          <Icon icon="ep:refresh" class="mr-5px" /> 刷新
        </el-button>
      </div>
    </template>

    <el-form class="-mb-15px" :model="queryParams" :inline="true" label-width="88px">
      <el-form-item label="品类">
        <el-select
          v-model="queryParams.categoryCode"
          placeholder="全部品类"
          clearable
          class="!w-240px"
          @change="getList"
        >
          <el-option
            v-for="item in categoryList"
            :key="item.categoryCode"
            :label="item.categoryName"
            :value="item.categoryCode"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="章节码">
        <el-input
          v-model="queryParams.sectionCode"
          placeholder="精确匹配，如 S03"
          clearable
          class="!w-200px"
          @keyup.enter="getList"
        />
      </el-form-item>
      <el-form-item label="审核状态">
        <el-select v-model="queryParams.reviewStatus" placeholder="全部" clearable class="!w-160px">
          <el-option
            v-for="item in PHRASE_REVIEW_STATUS_OPTIONS"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="只看平台">
        <el-switch v-model="queryParams.onlyPlatform" />
      </el-form-item>
    </el-form>

    <!--
      🔴 这一段必须写在页面上：56 条平台种子目前是 DRAFT，
         而报告作业台的候选清单只返回 APPROVED。
         不说清楚的话，管理员在这里看见 56 条、评估师在作业台看见 0 条，
         两个人会各自得出一个结论——一个以为库坏了，一个以为平台没给货
    -->
    <el-alert type="info" :closable="false" show-icon class="mt-12px mb-12px">
      <template #title>话术在这里审过之后，才会出现在报告作业台的候选清单里</template>
      <div>
        候选清单只返回「已通过」的话术，草稿与驳回的都不出现。
        平台预置的那 56 条目前是<b>草稿</b>状态 ——
        准则条款的措辞要由本机构的持证人员读过之后才算数，平台不会替机构背书。
        所以一个还没审过话术的机构，作业台右栏是空的，那不是故障。
      </div>
    </el-alert>

    <el-table class="xpy-list-table" stripe v-loading="loading" :data="filteredList">
      <el-table-column label="序号" type="index" width="44" align="center" />
      <el-table-column label="话术名称" min-width="200" show-overflow-tooltip>
        <template #default="scope">
          <el-link type="primary" :underline="false" @click="openContent(scope.row)">
            {{ scope.row.phraseName }}
          </el-link>
          <el-tag v-if="scope.row.platform" type="info" size="small" class="ml-6px">平台</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="品类" width="160" align="center">
        <template #default="scope">
          {{ scope.row.categoryName || scope.row.categoryCode || '通用' }}
        </template>
      </el-table-column>
      <el-table-column label="章节" width="160" align="center">
        <template #default="scope">
          {{ scope.row.sectionTitle || scope.row.sectionCode || '不限章节' }}
        </template>
      </el-table-column>
      <el-table-column label="触发条件" min-width="200">
        <template #default="scope">
          <span v-if="triggerText(scope.row)">{{ triggerText(scope.row) }}</span>
          <span v-else class="form-hint">无条件（任何标的都命中）</span>
        </template>
      </el-table-column>
      <el-table-column label="准则条款" width="180" align="center" show-overflow-tooltip>
        <template #default="scope">{{ scope.row.clauseRef || '—' }}</template>
      </el-table-column>
      <el-table-column label="基础分" width="80" align="center">
        <template #default="scope">{{ scope.row.scoreBase ?? 0 }}</template>
      </el-table-column>
      <el-table-column label="审核状态" width="110" align="center">
        <template #default="scope">
          <el-tag :type="phraseReviewStatusTagType(scope.row.reviewStatus)" size="small">
            {{ scope.row.reviewStatusLabel || labelOf(PHRASE_REVIEW_STATUS_OPTIONS, scope.row.reviewStatus) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="被用过" width="90" align="center">
        <template #default="scope">{{ scope.row.usageCount ?? 0 }}</template>
      </el-table-column>
      <el-table-column label="来源" width="120" align="center">
        <template #default="scope">
          {{ scope.row.sourceLabel || labelOf(PHRASE_SOURCE_OPTIONS, scope.row.source) }}
        </template>
      </el-table-column>
      <el-table-column
        label="创建时间"
        align="center"
        prop="createTime"
        width="170"
        :formatter="dateFormatter"
      />
      <el-table-column label="操作" width="270" align="center" fixed="right">
        <template #default="scope">
          <!--
            🔴 平台公共话术上**不画**编辑 / 审核 / 删除，只画「复制为机构话术」。
               后端对公共话术的改写抛 PHRASE_PLATFORM_NOT_EDITABLE，
               而平台**结构上不能**自我审核（没有 tenant_id = 0 那一行租户）——
               画一个点了必然报错的按钮，比不画更坏
          -->
          <template v-if="!scope.row.platform">
            <el-button
              link
              type="primary"
              @click="openForm(scope.row.id)"
              v-hasPermi="['qlzg:phrase:update']"
            >
              编辑
            </el-button>
            <el-button
              v-if="scope.row.reviewStatus !== 'APPROVED'"
              link
              type="success"
              @click="handleReview(scope.row, 'APPROVED')"
              v-hasPermi="['qlzg:phrase:update']"
            >
              审核通过
            </el-button>
            <el-button
              v-if="scope.row.reviewStatus === 'APPROVED'"
              link
              type="warning"
              @click="handleReview(scope.row, 'REJECTED')"
              v-hasPermi="['qlzg:phrase:update']"
            >
              驳回
            </el-button>
            <el-button
              link
              type="danger"
              @click="handleDelete(scope.row)"
              v-hasPermi="['qlzg:phrase:update']"
            >
              删除
            </el-button>
          </template>
          <el-button v-else link type="primary" @click="handleCopy(scope.row)">
            复制为机构话术
          </el-button>
        </template>
      </el-table-column>
      <template #empty>
        <el-empty description="没有符合条件的话术">
          <el-button type="primary" plain @click="openForm()" v-hasPermi="['qlzg:phrase:create']">
            新建第一条话术
          </el-button>
        </el-empty>
      </template>
    </el-table>
  </ContentWrap>

  <PhraseForm ref="formRef" @success="getList" />

  <!-- 正文抽屉：占位符原文 + 触发条件 + 审核轨迹 -->
  <el-drawer v-model="contentVisible" title="话术正文" size="52%">
    <div v-if="current">
      <el-descriptions :column="2" border size="small" class="mb-12px">
        <el-descriptions-item label="名称">{{ current.phraseName }}</el-descriptions-item>
        <el-descriptions-item label="章节">
          {{ current.sectionTitle || current.sectionCode || '不限章节' }}
        </el-descriptions-item>
        <el-descriptions-item label="准则条款">{{ current.clauseRef || '—' }}</el-descriptions-item>
        <el-descriptions-item label="审核状态">
          {{
            current.reviewStatusLabel ||
            labelOf(PHRASE_REVIEW_STATUS_OPTIONS, current.reviewStatus)
          }}
        </el-descriptions-item>
        <el-descriptions-item label="审核时间">
          {{ current.reviewedAt ? formatDate(current.reviewedAt) : '—' }}
        </el-descriptions-item>
        <el-descriptions-item label="被几份报告用过">
          {{ current.usageCount ?? 0 }}
        </el-descriptions-item>
      </el-descriptions>
      <div class="content-block">{{ current.content }}</div>
      <div class="mt-12px">
        <b>正文里的占位符（{{ (current.placeholders ?? []).length }} 个）</b>
        <div class="form-hint">
          这些键在插入报告的那一刻会被替换成当前标的的字段值。
          取不到值的话插入会<b>直接失败</b>，不会留一个空格 ——
          一处被静默清空的空格在一份法定报告里读起来像「这一项本来就没有」。
        </div>
        <div class="placeholder-row">
          <el-tag v-for="p in current.placeholders ?? []" :key="p" size="small" class="mr-6px mb-4px">
            {{ p }}
          </el-tag>
          <span v-if="(current.placeholders ?? []).length === 0" class="form-hint">
            这一段是固定措辞，不含占位符
          </span>
        </div>
      </div>
      <div v-if="triggerText(current)" class="mt-12px">
        <b>触发条件</b>
        <div class="form-hint">
          全部相等才算命中；不命中时这一条<b>不会</b>从候选里消失，只是不加分、
          并且会标出「触发条件未全部命中」—— 排序要说得清为什么，
          否则评估师无从判断该不该用它。
        </div>
        <div>{{ triggerText(current) }}</div>
      </div>
    </div>
  </el-drawer>
</template>
<script lang="ts" setup>
import { dateFormatter, formatDate } from '@/utils/formatTime'
import { QlzgCategoryApi, type QlzgCategorySimpleVO } from '@/api/qlzg/category'
import { QlzgPhraseApi, type QlzgPhraseVO } from '@/api/qlzg/phrase'
import {
  PHRASE_REVIEW_STATUS_OPTIONS,
  PHRASE_SOURCE_OPTIONS,
  labelOf,
  phraseReviewStatusTagType
} from '@/views/qlzg/constants'
import PhraseForm from './PhraseForm.vue'

/**
 * 话术库台账
 *
 * <h3>为什么这一页不分页&lt;/h3&gt;
 * 平台种子 56 条 + 机构自建的几十条，量级是百条以内，而 `/library-list` 后端也不分页。
 * 分页会把「还没审的那一批」翻到后面去，而它恰恰是这一页存在的理由：
 * 管理员进这一页要回答的第一个问题就是「还有几条等着我审」。
 *
 * <h3>🔴 审核状态与「只看平台」两个筛选是**前端**做的&lt;/h3&gt;
 * `/library-list` 只收 `categoryCode` 与 `sectionCode` 两个参数。
 * 前端筛的代价是「筛掉的那些仍然被下载了一次」，在百条量级上无所谓；
 * 真要后端筛的话得加参数，而那属于 I5 的事，不在这里顺手改接口。
 *
 * <h3>🔴 审核的权限点是 `qlzg:phrase:update`，不是新造的 `:review`&lt;/h3&gt;
 * 新权限串没有对应按钮菜单时，`PermissionScanRunner` 只建出一条
 * `menu_id = NULL` 的承载行，而 `default_effect = DENY` ——
 * 结果是所有非超管静默失去审核能力，全程 200 无异常。
 * 所以「审核通过 / 驳回」两个按钮挂的是 `:update`。
 */
defineOptions({ name: 'QlzgPhrase' })

const message = useMessage()

const loading = ref(false)
const list = ref<QlzgPhraseVO[]>([])
const categoryList = ref<QlzgCategorySimpleVO[]>([])
const queryParams = reactive({
  categoryCode: null as string | null,
  sectionCode: '',
  reviewStatus: '' as string,
  onlyPlatform: false
})

const filteredList = computed(() =>
  list.value.filter((row) => {
    if (queryParams.reviewStatus && row.reviewStatus !== queryParams.reviewStatus) return false
    if (queryParams.onlyPlatform && row.platform !== true) return false
    return true
  })
)

/**
 * 触发条件的人话
 *
 * 🔴 只显示键值对，不显示 JSON：`{"right_type":"ALLOCATION","purpose":"MORTGAGE"}`
 *    对评估师没有意义，而 `权利类型 = 划拨 · 评估目的 = 抵押` 是。
 * ⚠️ 这里刻意**不**把值翻译成中文（`ALLOCATION` → `划拨`）：
 *    触发条件的键是标的属性的 field_key、值是字面量，
 *    而字面量的取值范围由品类的 param_schema 决定，前端拿不到那份 ENUM options。
 *    翻错一个值比不翻更坏 —— 评估师会以为这条话术是为另一种权利类型写的
 */
const triggerText = (row?: QlzgPhraseVO | null): string => {
  const expr = row?.triggerExpr
  if (!expr || typeof expr !== 'object') return ''
  const parts = Object.entries(expr)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${k} = ${v}`)
  return parts.join(' · ')
}

const getList = async () => {
  loading.value = true
  try {
    list.value =
      (await QlzgPhraseApi.getLibraryList(
        queryParams.categoryCode,
        queryParams.sectionCode.trim() || null
      )) ?? []
  } catch {
    list.value = []
  } finally {
    loading.value = false
  }
}

const formRef = ref()
const openForm = (id?: number) => formRef.value?.open(id)

const contentVisible = ref(false)
const current = ref<QlzgPhraseVO | null>(null)
const openContent = (row: QlzgPhraseVO) => {
  current.value = row
  contentVisible.value = true
}

const handleReview = async (row: QlzgPhraseVO, reviewStatus: string) => {
  const approving = reviewStatus === 'APPROVED'
  const tip = approving
    ? `确定让「${row.phraseName}」通过审核吗？通过之后它会出现在报告作业台的候选清单里，` +
      `评估师可以把它一键插进法定报告的正文。请确认这段措辞与它引用的准则条款是本机构认可的。`
    : `确定驳回「${row.phraseName}」吗？驳回之后它不再出现在候选清单里，` +
      `但已经插进报告的那些值不受影响（插入那一刻正文已经落到报告字段上了）。`
  try {
    await message.confirm(tip)
  } catch {
    return
  }
  await QlzgPhraseApi.reviewPhrase(row.id, reviewStatus)
  message.success(approving ? '已通过审核' : '已驳回')
  await getList()
}

const handleCopy = async (row: QlzgPhraseVO) => {
  try {
    await message.confirm(
      `把平台话术「${row.phraseName}」复制一份到本机构吗？` +
        `复制出来的那一份是草稿状态，要走本机构自己的审核 —— 平台不会替机构背书。` +
        `之后要改措辞就改本机构那一份，平台那一份不动。`
    )
  } catch {
    return
  }
  await QlzgPhraseApi.copyToOrg(row.id)
  message.success('已复制到本机构，现在可以改它、也可以审它了')
  await getList()
}

const handleDelete = async (row: QlzgPhraseVO) => {
  try {
    await message.delConfirm(`确定删除话术「${row.phraseName}」吗？`)
  } catch {
    return
  }
  await QlzgPhraseApi.deletePhrase(row.id)
  message.success('删除成功')
  await getList()
}

onMounted(async () => {
  await getList()
  try {
    categoryList.value = (await QlzgCategoryApi.getSimpleList()) ?? []
  } catch {
    categoryList.value = []
  }
})
</script>
<style lang="scss" scoped>
.form-hint {
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}

.content-block {
  padding: 12px;
  font-size: 14px;
  line-height: 1.9;
  white-space: pre-wrap;
  background: var(--el-fill-color-lighter);
  border-radius: 4px;
}

.placeholder-row {
  margin-top: 6px;
}
</style>
