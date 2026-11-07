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
      <el-form-item label="来源码" prop="sourceCode">
        <el-input
          v-model="queryParams.sourceCode"
          placeholder="请输入来源码"
          clearable
          class="!w-240px"
        />
      </el-form-item>
      <el-form-item label="来源名称" prop="sourceName">
        <el-input
          v-model="queryParams.sourceName"
          placeholder="请输入来源名称"
          clearable
          class="!w-240px"
        />
      </el-form-item>
      <el-form-item label="数据源性质" prop="sourceType">
        <el-select
          v-model="queryParams.sourceType"
          placeholder="请选择数据源性质"
          clearable
          class="!w-240px"
        >
          <el-option
            v-for="item in CASE_PROVIDER_TYPE_OPTIONS"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="状态" prop="status">
        <el-select v-model="queryParams.status" placeholder="请选择状态" clearable class="!w-240px">
          <el-option
            v-for="item in CASE_SOURCE_STATUS_OPTIONS"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item>
        <!--
          🔴 这里刻意没有「搜索」按钮：筛选是一个 computed，边敲边生效，
          下面那行「共 N 个 / 筛选出 M 个」就是它的回执。
          放一个什么都不做的「搜索」，用户点完看不出区别，会以为筛选坏了、再点一次；
          而把它接到 getList() 上又是在暗示「条件发到服务端去了」—— 实际没有，
          后端只有 /list，既没有 /page 也不收任何查询参数
        -->
        <el-button @click="getList"><Icon icon="ep:refresh" class="mr-5px" /> 刷新</el-button>
        <el-button @click="resetQuery">
          <Icon icon="ep:close" class="mr-5px" /> 清空筛选
        </el-button>
        <el-button
          type="primary"
          plain
          @click="openForm('create')"
          v-hasPermi="['qlzg:case-source:create']"
        >
          <Icon icon="ep:plus" class="mr-5px" /> 新增
        </el-button>
      </el-form-item>
    </el-form>
  </ContentWrap>

  <!-- 列表 -->
  <ContentWrap>
    <el-alert type="info" :closable="false" show-icon class="mb-12px">
      <div class="text-12px leading-20px">
        这一页列的是<b>本机构自建的 + 平台预置的</b>数据源。平台预置行看得见、选得到，但改不了也删不了
        —— 它的授权范围与强制署名文本是平台统一签的合同条款，改一处就是替全平台改合同。
        停用的源也照样列出来：已经引用了它的历史案例仍然要能显示出处。
      </div>
    </el-alert>
    <el-table class="xpy-list-table" stripe v-loading="loading" :data="filteredList">
      <el-table-column label="来源码" prop="sourceCode" min-width="150" show-overflow-tooltip />
      <el-table-column label="来源名称" prop="sourceName" min-width="160" show-overflow-tooltip />
      <el-table-column label="数据源性质" align="center" prop="sourceType" width="140">
        <template #default="scope">
          {{
            scope.row.sourceTypeDescription ||
            labelOf(CASE_PROVIDER_TYPE_OPTIONS, scope.row.sourceType)
          }}
        </template>
      </el-table-column>
      <el-table-column label="数据接口" align="center" prop="apiInterfaceId" width="100">
        <template #default="scope">
          <span v-if="scope.row.apiInterfaceId">#{{ scope.row.apiInterfaceId }}</span>
          <span v-else class="text-[var(--el-text-color-placeholder)]">—</span>
        </template>
      </el-table-column>
      <el-table-column label="强制署名" prop="attributionRequired" min-width="200">
        <template #default="scope">
          <el-tooltip
            v-if="scope.row.attributionRequired"
            :content="scope.row.attributionRequired"
            placement="top"
          >
            <span class="attribution-cell">{{ scope.row.attributionRequired }}</span>
          </el-tooltip>
          <el-tag v-else type="warning" size="small">没有署名条款</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="授权范围" align="center" prop="licenseScope" width="100">
        <template #default="scope">
          <el-tooltip
            v-if="scope.row.licenseScope && Object.keys(scope.row.licenseScope).length"
            :content="JSON.stringify(scope.row.licenseScope, null, 2)"
            placement="top"
          >
            <el-tag type="primary" size="small">有条款</el-tag>
          </el-tooltip>
          <span v-else class="text-[var(--el-text-color-placeholder)]">—</span>
        </template>
      </el-table-column>
      <el-table-column label="更新频率" align="center" prop="updateFrequency" width="100">
        <template #default="scope">
          {{ scope.row.updateFrequency || '—' }}
        </template>
      </el-table-column>
      <el-table-column label="库范围" align="center" width="110">
        <template #default="scope">
          <el-tag :type="scope.row.platformPreset ? 'info' : 'primary'" size="small">
            {{ scope.row.platformPreset ? '平台预置' : '本机构' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="状态" align="center" prop="status" width="80">
        <template #default="scope">
          <el-tag :type="caseSourceStatusTagType(scope.row.status)" size="small">
            {{ labelOfNumber(CASE_SOURCE_STATUS_OPTIONS, scope.row.status) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" align="center" min-width="180" fixed="right">
        <template #default="scope">
          <!--
            🔴 平台预置行三个动作全部灰掉，而不是等后端拒：
            后端拦得住，但拦截器对平台预置行的效果是「查不到」，
            万一哪天有人把那道 Service 判定改没了，update/delete 会**影响 0 行且不抛异常** ——
            用户点完看到「操作成功」，刷新之后一切照旧
          -->
          <el-tooltip
            :disabled="isWritable(scope.row)"
            content="平台预置行改不了：要改条款请另建一个本机构自己的数据源"
            placement="top"
          >
            <span>
              <el-button
                link
                type="primary"
                :disabled="!isWritable(scope.row)"
                @click="openForm('update', scope.row)"
                v-hasPermi="['qlzg:case-source:update']"
              >
                编辑
              </el-button>
              <el-button
                link
                :type="scope.row.status === 1 ? 'warning' : 'success'"
                :disabled="!isWritable(scope.row)"
                @click="handleToggleStatus(scope.row)"
                v-hasPermi="['qlzg:case-source:update']"
              >
                {{ scope.row.status === 1 ? '停用' : '启用' }}
              </el-button>
              <el-button
                link
                type="danger"
                :disabled="!isWritable(scope.row)"
                @click="handleDelete(scope.row)"
                v-hasPermi="['qlzg:case-source:delete']"
              >
                删除
              </el-button>
            </span>
          </el-tooltip>
        </template>
      </el-table-column>
    </el-table>
    <div
      v-if="!loading && filteredList.length !== list.length"
      class="mt-8px text-12px text-[var(--el-text-color-secondary)]"
    >
      共 {{ list.length }} 个数据源，当前筛选出 {{ filteredList.length }} 个
    </div>
  </ContentWrap>

  <!-- 表单弹窗：添加/修改 -->
  <CaseSourceForm ref="formRef" @success="getList" />
</template>
<script lang="ts" setup>
import {
  QlzgCaseSourceApi,
  type QlzgCaseSourceVO
} from '@/api/qlzg/caseSource'
import {
  CASE_PROVIDER_TYPE_OPTIONS,
  CASE_SOURCE_STATUS_OPTIONS,
  caseSourceStatusTagType,
  labelOf,
  labelOfNumber
} from '@/views/qlzg/constants'
import { isWritable } from './sourceSchema'
import CaseSourceForm from './CaseSourceForm.vue'

/**
 * 案例数据来源管理
 *
 * <h3>🔴 这一页<b>没有分页</b>，筛选是<b>前端</b>做的</h3>
 * 后端刻意只有 {@code /list}、没有 {@code /page}：一家机构的取证渠道就政府发布、公开披露、
 * 第三方接口那么几个口径，几十行量级。分页会把「管理页要翻页才看得全」与
 * 「导入向导的下拉框不能翻页」拆成两条路径，而两条一定会漂 ——
 * 漂了的表现是「向导里能选到管理页上看不见的那个」。
 * 所以筛选也只能在前端做：没有 {@code /page} 就没有服务端的 {@code WHERE}。
 * ⚠️ 这条成立的前提是「几十行」。哪天真的涨到上千行，要改的是<b>后端加 /page</b>，
 * 而不是在前端悄悄加一个「只取前 100 条」——那会让筛选结果静默不完整。
 *
 * <h3>🔴 停用的源<b>照样列出来</b>，不在这里过滤掉</h3>
 * {@code /list} 刻意不过滤 {@code status}：导入向导要「启用的」，
 * 而案例详情页要「启用的 + 停用的」（停用的源，历史案例的出处仍要显示）。
 * 由调用方自己筛。管理页是「看得见全部」的那一侧，所以默认不过滤、只灰掉。
 *
 * <h3>🔴 刻意没有「导出」，也没有「批量删除」</h3>
 * 后端两个端点都不存在。导出这一页没有意义（几十行、且授权条款是合同文本，
 * 摊进一个 Excel 到处传正是要避免的事）；批量删除的结果只能是
 * 「一部分成功、一部分失败」——名下挂着案例的源删不掉，
 * 而用户拿到的却是一句「已删除」。本系统所有错误都是 HTTP 200、真码在 body 的 code 字段里，
 * 点了不存在的端点看起来像「按钮没反应」，比不画这个按钮更难排查。
 *
 * <h3>🔴 三个写动作的权限串只有 {@code create} / {@code update} / {@code delete}</h3>
 * <b>没有</b> {@code qlzg:case-source:query}：{@code /list} 只要登录即可，
 * 因为它同时喂 {@code qlzg:case-source:*} 与 {@code qlzg:case:*} 两个权限族的界面
 * （导入向导的下拉框也用它）。挂在其中任何一个族上，另一个族的界面就会
 * 「下拉框空着 + 一条与本页无关的无权限红条」。
 * 所以建菜单时这一族<b>只建三个按钮</b>，多建一个 {@code :query} 的话，
 * {@code PermissionScanRunner} 会为它建出一条 {@code menu_id = NULL} 的承载行，
 * 而 {@code default_effect = DENY} —— 结果是所有非超管静默少一个权限点。
 */
defineOptions({ name: 'QlzgCaseSource' })

const message = useMessage()
const { t } = useI18n()

const loading = ref(true)
const list = ref<QlzgCaseSourceVO[]>([])
const queryParams = reactive({
  sourceCode: '',
  sourceName: '',
  sourceType: undefined as string | undefined,
  status: undefined as number | undefined
})
const queryFormRef = ref()

/**
 * 🔴 来源码这一栏刻意**大小写不敏感**：库里存的一律是大写
 * （后端 {@code normalizeCode} 转的），而用户从导入模板上抄过来的可能是小写。
 * 用全等比的话，搜「ali_auction」一条也搜不到，
 * 而列表里明明有一行「ALI_AUCTION」—— 用户得到的结论是「这个源没登记过」
 */
const filteredList = computed(() => {
  const code = queryParams.sourceCode.trim().toUpperCase()
  const name = queryParams.sourceName.trim()
  return list.value.filter((row) => {
    if (code && !row.sourceCode?.toUpperCase().includes(code)) return false
    if (name && !row.sourceName?.includes(name)) return false
    if (queryParams.sourceType && row.sourceType !== queryParams.sourceType) return false
    // 🔴 全等比数字，不用 ==：status 是 0 / 1，`0 == false` 为真会把「停用」判成没选
    if (queryParams.status !== undefined && row.status !== queryParams.status) return false
    return true
  })
})

/** 查询数据源列表 */
const getList = async () => {
  loading.value = true
  try {
    list.value = await QlzgCaseSourceApi.getCaseSourceList()
  } finally {
    loading.value = false
  }
}

/** 清空筛选。🔴 只调 {@code resetFields()}，不再逐列手赋一遍 */
const resetQuery = () => {
  // el-form 的 resetFields() 复位的是 prop 绑定的那四个字段的**初始值**。
  // 初值来自上面 reactive({...}) 那份字面量，所以这里再手写一遍
  // 就是同一个事实的第二份拷贝 —— 哪天加一个筛选条件只改了初始值，
  // 「清空筛选」就会留着上一轮的值，而表现是「清空了却还是筛掉了那几行」
  queryFormRef.value.resetFields()
}

/** 添加/修改操作 */
const formRef = ref()
const openForm = (type: string, row?: QlzgCaseSourceVO) => {
  // 🔴 编辑态把**整行**传进去，不是传 id：后端没有 /get，理由见类注释
  formRef.value.open(type, row)
}

/** 启用 / 停用 */
const handleToggleStatus = async (row: QlzgCaseSourceVO) => {
  const next = row.status === 1 ? 0 : 1
  const action = next === 1 ? '启用' : '停用'
  try {
    await message.confirm(
      `确定要${action}数据源「${row.sourceName}」吗？` +
        (next === 0
          ? '停用不删行：已经引用了它的历史案例仍然会显示出处，只是不再允许新案例挂上来。'
          : ''),
      `${action}数据源`
    )
    await QlzgCaseSourceApi.updateCaseSourceStatus(row.id, next)
    message.success(`${action}成功`)
    await getList()
  } catch {}
}

/** 删除按钮操作 */
const handleDelete = async (row: QlzgCaseSourceVO) => {
  try {
    await message.delConfirm(
      `确定要删除数据源「${row.sourceName}」吗？` +
        '名下还挂着案例时删不掉，而且那个计数是【跨租户】的——' +
        '占着它的可能是别的机构。删不掉时请改用「停用」。',
      '删除数据源'
    )
    await QlzgCaseSourceApi.deleteCaseSource(row.id)
    message.success(t('common.delSuccess'))
    await getList()
  } catch {}
}

/** 初始化 **/
onMounted(async () => {
  await getList()
})
</script>
<style lang="scss" scoped>
.attribution-cell {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
}
</style>
