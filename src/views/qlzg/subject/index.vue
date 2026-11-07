<template>
  <ContentWrap>
    <!-- 搜索工作栏 -->
    <el-form
      class="-mb-15px"
      :model="queryParams"
      ref="queryFormRef"
      :inline="true"
      label-width="88px"
    >
      <el-form-item label="标的名称" prop="subjectName">
        <el-input
          v-model="queryParams.subjectName"
          placeholder="请输入标的名称"
          clearable
          class="!w-240px"
          @keyup.enter="handleQuery"
        />
      </el-form-item>
      <el-form-item label="所属项目" prop="projectId">
        <el-select
          v-model="queryParams.projectId"
          filterable
          remote
          clearable
          reserve-keyword
          :remote-method="searchProjects"
          :loading="projectLoading"
          placeholder="输入项目名称搜索"
          class="!w-240px"
        >
          <el-option
            v-for="item in projectOptions"
            :key="item.id"
            :label="`${item.projectNo}　${item.projectName}`"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="标的类型" prop="subjectType">
        <el-select
          v-model="queryParams.subjectType"
          clearable
          placeholder="请选择标的类型"
          class="!w-240px"
        >
          <el-option
            v-for="item in SUBJECT_TYPE_OPTIONS"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="创建时间" prop="createTime">
        <el-date-picker
          v-model="queryParams.createTime"
          value-format="YYYY-MM-DD HH:mm:ss"
          type="daterange"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          :default-time="[new Date('1 00:00:00'), new Date('1 23:59:59')]"
          class="!w-240px"
        />
      </el-form-item>
      <el-form-item>
        <el-button @click="handleQuery"><Icon icon="ep:search" class="mr-5px" /> 搜索</el-button>
        <el-button @click="resetQuery"><Icon icon="ep:refresh" class="mr-5px" /> 重置</el-button>
        <el-button
          type="primary"
          plain
          @click="openForm('create')"
          v-hasPermi="['qlzg:subject:create']"
        >
          <Icon icon="ep:plus" class="mr-5px" /> 新增标的
        </el-button>
        <el-button type="success" plain @click="handleExport" v-hasPermi="['qlzg:subject:query']">
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
      <el-table-column label="标的名称" align="center" prop="subjectName" min-width="180" />
      <el-table-column label="标的类型" align="center" prop="subjectType" width="110">
        <template #default="scope">
          {{ scope.row.subjectTypeDescription || UNKNOWN_LABEL_FALLBACK }}
        </template>
      </el-table-column>
      <el-table-column label="所属项目" align="center" min-width="240">
        <template #default="scope">
          <el-link type="primary" :underline="false" @click="openMaterial(scope.row)">
            {{ scope.row.projectNo }}
          </el-link>
          <span class="ml-6px">{{ scope.row.projectName }}</span>
        </template>
      </el-table-column>
      <el-table-column label="账面价值（元）" align="center" prop="bookValue" width="140" />
      <el-table-column label="权属证明" align="center" width="110">
        <template #default="scope">
          <span v-if="!scope.row.ownershipFiles?.length">-</span>
          <el-tooltip
            v-else
            :content="ownershipSummary(scope.row)"
            placement="top"
            :disabled="!missingCountOf(scope.row)"
          >
            <el-tag :type="missingCountOf(scope.row) ? 'danger' : 'success'">
              {{ scope.row.ownershipFiles.length }} 份
              <template v-if="missingCountOf(scope.row)">
                （{{ missingCountOf(scope.row) }} 份已失效）
              </template>
            </el-tag>
          </el-tooltip>
        </template>
      </el-table-column>
      <el-table-column label="属性" align="center" width="80">
        <template #default="scope">
          <span>{{ scope.row.attrViews?.length ?? 0 }} 项</span>
        </template>
      </el-table-column>
      <el-table-column label="排序" align="center" prop="sort" width="70" />
      <el-table-column
        label="创建时间"
        align="center"
        prop="createTime"
        width="180"
        :formatter="dateFormatter"
      />
      <el-table-column label="操作" align="center" min-width="300" fixed="right">
        <template #default="scope">
          <el-button link type="primary" @click="openDetail(scope.row)">属性</el-button>
          <!--
            🔴 权限串挂的是 qlzg:case:query 而不是 qlzg:subject:query：
            这个按钮打开的是**案例召回**页，它只调 /qlzg/case/recall-preview。
            挂到 subject 那一族上，一个只被授了标的权限的人会看到一个
            点进去全是无权限红条的页面 —— 按钮在、功能不在，比不画这个按钮更难排查
            🔴 但 v-hasPermi **不足以**在退化形态下藏掉它：超管的权限集合是 `*:*:*`，
            什么权限点都拦不住他，于是 REPORT_ONLY 下这个按钮照画、
            点进去是 /qlzg-case/recall —— 那一页唯一的接口归 @QlzgModuleGate(CASE)，
            回 code=404「请求地址不存在」（本仓 404 的 HTTP 状态码是 200），
            用户拿到一个空白页。所以要再叠一个「模块装没装」的判据，见 caseInstalled
          -->
          <el-button
            v-if="caseInstalled"
            link
            type="primary"
            @click="goRecall(scope.row)"
            v-hasPermi="['qlzg:case:query']"
          >
            召回
          </el-button>
          <!--
            🔴 同理挂 qlzg:calculation:query 而不是 qlzg:subject:query：
            测算页调的是 /qlzg/calculation/list-by-subject 与 /qlzg/param/preview-confirmation，
            两个都在 calculation / param 那两族上。挂错族的表现与上面那条完全一样：
            按钮在、点进去是一片无权限红条。
            ⚠️ 「发起测算」那个按钮在测算页里另挂 qlzg:calculation:create，
               所以一个只被授了 :query 的人看得见这一页、看得见历史测算，
               但发不起新的 —— 这是有意的，读与写分开授
          -->
          <el-button
            v-if="calcInstalled"
            link
            type="primary"
            @click="goCalculation(scope.row)"
            v-hasPermi="['qlzg:calculation:query']"
          >
            测算
          </el-button>
          <!--
            🔴 挂 qlzg:calc-result:query：这一页调的是 /qlzg/calc-result/* 与
            /qlzg/calculation/list-by-subject 两个族。授权时两族都要给，
            只给一族的表现是「按钮在、点进去一片无权限红条」
            ⚠️ 页里「确定」那个按钮另挂 qlzg:calc-result:create，
               所以一个只被授了 :query 的人能预览、能看历史、能导计算成果表，
               但落不下一条新的确定 —— 与测算页同一条读写分开授的规矩
          -->
          <el-button
            v-if="calcInstalled"
            link
            type="primary"
            @click="goCalcResult(scope.row)"
            v-hasPermi="['qlzg:calc-result:query']"
          >
            定值
          </el-button>
          <el-button
            link
            type="primary"
            @click="openForm('update', scope.row.id)"
            v-hasPermi="['qlzg:subject:update']"
          >
            编辑
          </el-button>
          <el-button
            link
            type="danger"
            @click="handleDelete(scope.row)"
            v-hasPermi="['qlzg:subject:delete']"
          >
            删除
          </el-button>
        </template>
      </el-table-column>
    </el-table>
    <!-- 分页 -->
    <Pagination
      :total="total"
      v-model:page="queryParams.pageNo"
      v-model:limit="queryParams.pageSize"
      @pagination="getList"
    />
  </ContentWrap>

  <!-- 表单弹窗：添加/修改 -->
  <SubjectForm ref="formRef" @success="getList" />

  <!-- 导出弹窗 -->
  <LedgerExportForm ref="exportFormRef" />

  <!-- 属性详情弹窗 -->
  <Dialog v-model="detailVisible" :title="detailTitle" width="720">
    <el-descriptions v-if="detailRow" :column="1" border>
      <el-descriptions-item
        v-for="view in detailRow.attrViews ?? []"
        :key="view.key"
        :label="view.label"
      >
        <span>{{ view.valueText }}</span>
        <span v-if="view.unit" class="unit-hint">{{ view.unit }}</span>
        <el-tag v-if="view.type == null" type="warning" size="small" class="ml-8px">
          品类已不再定义此属性
        </el-tag>
      </el-descriptions-item>
      <el-descriptions-item v-if="!detailRow.attrViews?.length" label="标的属性">
        这个品类没有定义标的属性
      </el-descriptions-item>
    </el-descriptions>
    <template #footer>
      <el-button @click="detailVisible = false">关 闭</el-button>
    </template>
  </Dialog>
</template>
<script lang="ts" setup>
import { dateFormatter } from '@/utils/formatTime'
import { QlzgProjectApi, type QlzgProjectVO } from '@/api/qlzg/project'
import { QlzgSubjectApi, type QlzgSubjectVO } from '@/api/qlzg/subject'
import { SUBJECT_TYPE_OPTIONS, UNKNOWN_LABEL_FALLBACK } from '@/views/qlzg/constants'
import SubjectForm from './SubjectForm.vue'
import LedgerExportForm from '@/views/qlzg/components/LedgerExportForm.vue'
import { isInstalled, loadModuleForm } from '@/views/qlzg/moduleForm'

/**
 * 评估标的台账（跨项目）
 *
 * <h3>🔴 这一页是**跨项目**的台账，用 {@code /page}；项目详情页里那份用 {@code list-by-project}</h3>
 * 后者不分页、按 sort 升序返回**全部**标的。台账要翻页与筛选，所以走分页接口；
 * 但任何「把这个项目的标的都拿出来」的场景（详情、资料面板、清单汇编）都**不能**用
 * 这里的第一页当全部 —— 那种写法在两三套房子时是对的，多了就错，
 * 表现是「报告里少了一套房」，而少的那一套不会报错，只会在客户拿到报告之后被发现。
 *
 * <h3>🔴 属性区在列表里**只显示项数**，不显示值</h3>
 * {@code attrs} 是按品类定义的 JSON 列，跨品类的键集合还不一样，
 * 所以分页接口既不能按属性筛选、也没法在表格上摆出一列有意义的值。
 * 要看值点「属性」，那个弹窗渲染的是后端算好的 {@code attrViews[].valueText} ——
 * 🔴 **不在前端重算**：百分数项库里存的是分数（0.075 表示 7.5%），
 * 换算逻辑在服务端只有一份，前端再算一遍就会出现「两个页面同一个值差 100 倍」。
 *
 * <h3>🔴 权属证明那一列要标出「已失效」的份数</h3>
 * {@code ownershipFiles[].missing === true} 表示 {@code infra_file} 里已经查不到
 * （被删或不属于本机构）。后端**照样把它占位在数组里**，因为 R25 要求权属证明可追溯。
 * 这里也跟着显示，不 filter 掉：少显示一项会让用户以为材料齐了。
 */
defineOptions({ name: 'QlzgSubject' })

const message = useMessage()
const { t } = useI18n()
const { push } = useRouter()

const loading = ref(true)
const total = ref(0)
const list = ref<QlzgSubjectVO[]>([])
const queryParams = reactive({
  pageNo: 1,
  pageSize: 20,
  subjectName: '',
  projectId: undefined as number | undefined,
  subjectType: undefined as string | undefined,
  createTime: [] as string[]
})
const queryFormRef = ref()

const projectOptions = ref<QlzgProjectVO[]>([])
const projectLoading = ref(false)

/** 查询标的列表 */
const getList = async () => {
  loading.value = true
  try {
    const data = await QlzgSubjectApi.getSubjectPage(queryParams)
    list.value = data.list
    total.value = data.total
  } finally {
    loading.value = false
  }
}

/** 搜索按钮操作 */
const handleQuery = () => {
  queryParams.pageNo = 1
  getList()
}

/** 重置按钮操作 */
const resetQuery = () => {
  queryFormRef.value.resetFields()
  projectOptions.value = []
  handleQuery()
}

/**
 * 导出按钮操作
 *
 * 🔴 「标的属性」在导出里是**一列文本**，不是一列一个属性。理由写在
 *    `QlzgSubjectApi.exportExcel` 上：每一行的属性集合取决于它所属项目的品类，
 *    摊成 N 列的话表头会随「这次恰好导到了哪些品类」漂移，机构写好的公式与透视会静默错位。
 *    代价是这一列在 Excel 里没法排序筛选 —— 所以要按属性比对标的，走的是详情页与复核规则，
 *    不是把台账导出来再筛。这件事必须在弹窗里说出来，否则用户会以为导出漏了列
 */
const exportFormRef = ref()
const handleExport = () => {
  exportFormRef.value?.open({
    ledgerName: '标的台账',
    fetcher: QlzgSubjectApi.exportExcel,
    pageNo: queryParams.pageNo,
    pageSize: queryParams.pageSize,
    total: total.value,
    buildParams: () => ({ ...queryParams }),
    contentHints: [
      '标的类型导中文，账面价值保留可计算的真值。',
      '「标的属性」摊成一列文本（例：建筑面积：120㎡、楼层：7）——因为不同品类的属性集合不一样，摊成多列的话表头会随这次导到的品类漂移，机构写好的公式会静默错位。这一列在 Excel 里没法排序筛选，要按属性比对标的请走详情页。',
      '权属附件导文件名；已取不到的会标成「（已取不到，编号 N）」，不会静默少一项。'
    ]
  })
}

const searchProjects = async (keyword: string) => {
  if (!keyword) return
  projectLoading.value = true
  try {
    const data = await QlzgProjectApi.getProjectPage({
      pageNo: 1,
      pageSize: 20,
      projectName: keyword
    })
    projectOptions.value = data.list
  } finally {
    projectLoading.value = false
  }
}

// ==================== 权属证明 ====================

const missingCountOf = (row: QlzgSubjectVO): number =>
  (row.ownershipFiles ?? []).filter((file) => file.missing).length

const ownershipSummary = (row: QlzgSubjectVO): string => {
  const missing = (row.ownershipFiles ?? []).filter((file) => file.missing)
  if (!missing.length) return ''
  return (
    `有 ${missing.length} 份指向的文件在文件表里已经查不到了（编号 ` +
    `${missing.map((file) => file.fileId).join('、')}），编辑这个标的时必须先移除`
  )
}

// ==================== 表单与详情 ====================

const formRef = ref()
const openForm = (type: string, id?: number) => {
  formRef.value.open(type, id)
}

const openMaterial = (row: QlzgSubjectVO) => {
  push({ path: '/qlzg/material', query: { projectId: row.projectId } })
}

const detailVisible = ref(false)
const detailRow = ref<QlzgSubjectVO | null>(null)
const detailTitle = computed(() =>
  detailRow.value ? `标的属性 · ${detailRow.value.subjectName}` : '标的属性'
)

/**
 * 打开属性详情
 *
 * ⚠️ 这里刻意**重取一次详情**，不直接用列表行：分页接口出于体积考虑不保证带上
 *    {@code attrViews} 与 {@code ownershipFiles} 这两个渲染好的视图，
 *    而「详情弹窗里一片空白」与「这个标的真的没有属性」在界面上分不出来。
 */
const openDetail = async (row: QlzgSubjectVO) => {
  detailRow.value = await QlzgSubjectApi.getSubject(row.id)
  detailVisible.value = true
}

/**
 * 台账上那三个跨模块按钮各自**画不画**
 *
 * <p>🔴 为什么不能只靠它们已经挂着的 {@code v-hasPermi}：超管的权限集合是 {@code *:*:*}，
 * 什么权限点都拦不住他 —— 于是在 REPORT_ONLY 形态下，这三格对超管**照画**，
 * 点进去分别是 {@code /qlzg-case/recall}（静态路由，页在、接口全 404）、
 * {@code /qlzg/calculation} 与 {@code /qlzg/calc-result}（DB 菜单被
 * {@code QlzgMenuVisibilityCustomizer} 过滤 ⟹ 路由没注册 ⟹ 404 页）。
 * 而**本仓 404 的 HTTP 状态码是 200**，浏览器控制台与后端日志都干净，
 * 用户拿到的是一个空白页 —— 与报告作业台上「复核工作台」那个入口是同一类缺陷。
 * 所以这里再叠一个「模块装没装」的判据，与权限点是两件不同的事
 *
 * <p>⚠️ 取不到形态时 {@code isInstalled} 一律答 true（理由写在 {@code moduleForm.ts} 的文件头），
 * 即三个按钮**照常出现**。方向与 {@code reviewNotInstalled} / {@code notInstalled} 逐字一致：
 * 漏画的代价是「多一个点进去 404 的入口」，误画的代价是
 * 「一个装着的功能从台账上消失了」，后者严重得多
 *
 * <p>⚠️ 用 computed 而不是 ref：形态快照是**异步**到的（{@code loadModuleForm} 在
 * {@code onMounted} 里刻意不 await），取回来之后这两个值自己就翻了，
 * 不需要在任何回调里手工赋值 —— 少一处「忘了赋值于是按钮永远在」的可能
 */
const caseInstalled = computed(() => isInstalled('case'))
const calcInstalled = computed(() => isInstalled('calc'))

/**
 * 跳案例召回页
 *
 * <p>🔴 这一页的路由在 {@code router/modules/remaining.ts} 里，**不是 DB 菜单**。
 * 所以这个 path 改动要同步改那一份，而不是去菜单管理里改。
 * 为什么它不能是菜单，那一条注释写得很细（一句话版：非超管的导航集合是从
 * {@code sys_resource} 反查 {@code menu_id} 得来的，而召回页不持有任何权限点，
 * 没有任何资源行指向它 ⟹ 路由压根不会注册 ⟹ 点这个按钮落到 404，且不报错）。
 *
 * <p>🔴 走 path 不走 name：{@code push({ name })} 在名字打错时是一次静默失败
 * （vue-router 只在控制台 warn，界面停在原地）。本页跳资料页用的也是 path，同一条纪律。
 *
 * <p>🔴 只带 {@code subjectId} 一个参数：品类码与评估基准日都取自标的所属的项目，
 * 由后端自己解析。前端多带一个「基准日」看着是省事，实际是让召回结果
 * 每次点开都可能不同（V5 D5 的确定性要求就此破功），
 * 而后端在项目没有基准日时会直接报 CASE_RECALL_BASE_DATE_REQUIRED、不回落成今天。
 */
const goRecall = (row: QlzgSubjectVO) => {
  push({ path: '/qlzg-case/recall', query: { subjectId: row.id } })
}

/**
 * 跳测算页
 *
 * <p>🔴 与 {@link goRecall} 完全同一条纪律：走 path、只带 {@code subjectId}。
 * 品类码、评估基准日、可实现的评估方法（{@code method_codes.allowed}）都取自项目，
 * 由后端自己解析。前端多带一个「方法」看着是省事，实际是造出了
 * 「用收益法的参数去跑比较法」这种在界面上完全看不出来的错。
 *
 * <p>⚠️ 召回与测算是**两页**、不是一页里的两个 tab：召回一个字都不写库
 * （`qlzg_case_match` 与 `procedure_limited` 都由测算那一次写），
 * 而测算写三处。把「只读的预览」与「落库的动作」摆在同一个页面上，
 * 用户会以为点召回就已经把终选存下来了
 */
const goCalculation = (row: QlzgSubjectVO) => {
  push({ path: '/qlzg/calculation', query: { subjectId: row.id } })
}

/**
 * 跳结果确定页
 *
 * <p>🔴 同一条纪律第三次：走 path、只带 {@code subjectId}。
 * 能挑哪些测算取自这个标的（`list-by-subject`），单价口径取自它的建筑面积与项目，
 * 价值类型的默认值取自项目。多带一个「用哪几条测算」看着省事，
 * 实际是把「哪一次算成功了」这个判据从后端挪到前端来复制一份。
 *
 * <p>⚠️ 挂的是 {@code qlzg:calc-result:query} 而不是 {@code qlzg:calculation:query}：
 * 这一页调的是 {@code /qlzg/calc-result/*} 与 {@code /qlzg/calculation/list-by-subject}，
 * 两个族都要有。只授了测算权限的人会看到一个点进去全是无权限红条的页面。
 */
const goCalcResult = (row: QlzgSubjectVO) => {
  push({ path: '/qlzg/calc-result', query: { subjectId: row.id } })
}

/** 删除按钮操作 */
const handleDelete = async (row: QlzgSubjectVO) => {
  try {
    await message.delConfirm(
      `确定要删除标的「${row.subjectName}」吗？` +
        '名下还挂着资料时删不掉——资料行是证据，不能随标的一起蒸发。',
      '删除标的'
    )
    await QlzgSubjectApi.deleteSubject(row.id)
    message.success(t('common.delSuccess'))
    await getList()
  } catch {}
}

/** 初始化 **/
onMounted(async () => {
  // 🔴 形态快照**不等** getList：它只决定那三个按钮画不画，失败得起
  //    （取不到就按「装了」处理），而台账那一屏才是这一页的主体
  loadModuleForm()
  await getList()
})
</script>
<style lang="scss" scoped>
.unit-hint {
  margin-left: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
