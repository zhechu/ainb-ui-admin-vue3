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
      <el-form-item label="参数键" prop="paramKey">
        <el-input
          v-model="queryParams.paramKey"
          placeholder="精确匹配，如 capitalization_rate"
          clearable
          class="!w-240px"
          @keyup.enter="handleQuery"
        />
      </el-form-item>
      <el-form-item label="参数名称" prop="paramName">
        <el-input
          v-model="queryParams.paramName"
          placeholder="模糊匹配，如 资本化率"
          clearable
          class="!w-240px"
          @keyup.enter="handleQuery"
        />
      </el-form-item>
      <el-form-item label="品类" prop="categoryCode">
        <el-select
          v-model="queryParams.categoryCode"
          placeholder="请选择品类"
          clearable
          class="!w-240px"
        >
          <el-option
            v-for="item in categoryList"
            :key="item.categoryCode"
            :label="item.categoryName"
            :value="item.categoryCode"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="辖区码" prop="regionCode">
        <el-input
          v-model="queryParams.regionCode"
          placeholder="6 位国标码，全国是 000000"
          clearable
          class="!w-240px"
          @keyup.enter="handleQuery"
        />
      </el-form-item>
      <el-form-item label="来源类型" prop="sourceType">
        <el-select
          v-model="queryParams.sourceType"
          placeholder="请选择来源类型"
          clearable
          class="!w-240px"
        >
          <el-option
            v-for="item in PARAM_SOURCE_TYPE_OPTIONS"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="归属" prop="platformLevel">
        <!--
          🔴 placeholder 写「全部」而不是「请选择」：三态里 undefined **就是**「全部」，
          所以「没选过」与「选了全部」在界面上必须长得一样。写成「请选择」的话，
          用户点完「全部」会看到框里变回一句请选择，以为没点上、再点一次
        -->
        <el-select
          v-model="queryParams.platformLevel"
          placeholder="全部（平台级与本机构都看）"
          class="!w-240px"
        >
          <el-option
            v-for="item in platformLevelOptions"
            :key="item.label"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="状态" prop="status">
        <el-select v-model="queryParams.status" placeholder="请选择" clearable class="!w-240px">
          <el-option
            v-for="item in PARAM_STATUS_OPTIONS"
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
          v-hasPermi="['qlzg:param:create']"
        >
          <Icon icon="ep:plus" class="mr-5px" /> 新增
        </el-button>
      </el-form-item>
    </el-form>
  </ContentWrap>

  <!-- 列表 -->
  <ContentWrap>
    <el-alert type="info" :closable="false" class="mb-10px">
      <template #title>
        <span class="text-12px">
          这一页维护的是<b>参数库</b>：测算时按「品类 → 行业 → 辖区 → 时点」四维回退查的就是这些行。
          标着「平台级」的行本机构改不了也删不了 —— 要另一套口径，
          请<b>新建一条来源为「机构内部」的参数</b>去覆盖它（回退时机构级优先于平台级）。
        </span>
      </template>
    </el-alert>
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
      <el-table-column label="参数键" align="center" prop="paramKey" min-width="170" />
      <el-table-column label="参数名称" align="center" prop="paramName" min-width="160" />
      <el-table-column label="品类" align="center" prop="categoryCode" min-width="150">
        <template #default="scope">
          <el-tag v-if="!scope.row.categoryCode" type="info">通用</el-tag>
          <span v-else>{{ categoryNameOf(scope.row.categoryCode) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="辖区" align="center" prop="regionCode" width="130">
        <template #default="scope">
          <div>{{ scope.row.regionCode }}</div>
          <el-tag
            v-if="regionScopeLabel(scope.row.regionCode)"
            size="small"
            :type="scope.row.regionCode === NATIONAL_REGION_CODE ? 'warning' : 'info'"
          >
            {{ regionScopeLabel(scope.row.regionCode) }}
          </el-tag>
          <!-- 🔴 非法码要看得出来：后端不报错，它只是把回退阶梯削成 ["000000"]，
               于是这条参数只能被全国那一级命中，而两个数都合法、报告上都会渲染 -->
          <el-tag v-else size="small" type="danger">不是 6 位国标码</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="值" align="center" min-width="120">
        <template #default="scope">
          <span class="font-bold">{{ valueTextOf(scope.row) }}</span>
          <span v-if="scope.row.unit" class="ml-2px text-12px">
            {{ scope.row.unit }}
          </span>
        </template>
      </el-table-column>
      <el-table-column label="有效期" align="center" min-width="190">
        <template #default="scope">
          <div>{{ effectiveRangeLabel(scope.row) }}</div>
          <!-- 🔴 「启用但不在有效期内」是一个真实状态：四维回退按 effective_from <= baseDate
               <= effective_until 过滤，所以这一行 status=1 也照样查不到，
               而不说出来的话台账上它看着完全正常 -->
          <el-tag
            v-if="effectiveState(scope.row) !== 'VALID'"
            size="small"
            :type="effectiveState(scope.row) === 'EXPIRED' ? 'danger' : 'warning'"
          >
            {{ effectiveStateLabel(effectiveState(scope.row)) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="版本号" align="center" prop="versionNo" min-width="140" />
      <el-table-column label="来源" align="center" prop="sourceType" width="120">
        <template #default="scope">
          <div>
            {{
              scope.row.sourceTypeDescription ||
              labelOf(PARAM_SOURCE_TYPE_OPTIONS, scope.row.sourceType)
            }}
          </div>
          <el-tag v-if="scope.row.platformLevel" size="small" type="warning">平台级</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="可作 BLOCK 判据" align="center" width="120">
        <template #default="scope">
          <el-tooltip
            :disabled="scope.row.canBeBlockRule"
            content="来源是「专家指引」的参数一律不能作为 BLOCK 级规则的判据（只能出 WARN），这一列由服务端强制"
            placement="top"
          >
            <el-tag :type="scope.row.canBeBlockRule ? 'success' : 'info'" size="small">
              {{ scope.row.canBeBlockRule ? '可以' : '不可以' }}
            </el-tag>
          </el-tooltip>
        </template>
      </el-table-column>
      <el-table-column
        label="取值依据"
        align="center"
        prop="basis"
        min-width="180"
        show-overflow-tooltip
      />
      <el-table-column label="状态" align="center" prop="status" width="80">
        <template #default="scope">
          <el-tag :type="paramStatusTagType(scope.row.status)" size="small">
            {{ labelOfNumber(PARAM_STATUS_OPTIONS, scope.row.status) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column
        label="创建时间"
        align="center"
        prop="createTime"
        width="180"
        :formatter="dateFormatter"
      />
      <el-table-column label="操作" align="center" min-width="170" fixed="right">
        <template #default="scope">
          <!--
            🔴 平台级行三个按钮一起灰，并且**说清为什么灰**：
            后端会以 PARAM_PLATFORM_ROW_IMMUTABLE 拒回来，让用户点完再报错是最坏的一种界面。
            而灰掉的按钮如果不给理由，用户会理解成「这功能坏了」
          -->
          <el-tooltip
            :disabled="!scope.row.platformLevel"
            :content="PLATFORM_ROW_HINT"
            placement="top"
          >
            <span>
              <el-button
                link
                type="primary"
                :disabled="scope.row.platformLevel"
                @click="openForm('update', scope.row.id)"
                v-hasPermi="['qlzg:param:update']"
              >
                编辑
              </el-button>
              <!-- 🔴 停用放在删除**前面**：已被口径快照引用的参数删不掉
                   （PARAM_REFERENCED_BY_SNAPSHOT），实务里要做的动作是停用 -->
              <el-button
                link
                :type="scope.row.status === 1 ? 'warning' : 'success'"
                :disabled="scope.row.platformLevel"
                @click="handleToggleStatus(scope.row)"
                v-hasPermi="['qlzg:param:update']"
              >
                {{ scope.row.status === 1 ? '停用' : '启用' }}
              </el-button>
              <el-button
                link
                type="danger"
                :disabled="scope.row.platformLevel"
                @click="handleDelete(scope.row)"
                v-hasPermi="['qlzg:param:delete']"
              >
                删除
              </el-button>
            </span>
          </el-tooltip>
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
  <ParamForm
    ref="formRef"
    :categories="categoryList"
    :param-keys-of="paramKeysOf"
    :schema-item-of="schemaItemOf"
    @success="getList"
  />
</template>
<script lang="ts" setup>
import { dateFormatter, formatDate } from '@/utils/formatTime'
import {
  PARAM_PLATFORM_LEVEL_OPTIONS,
  PARAM_SOURCE_TYPE_OPTIONS,
  PARAM_STATUS_OPTIONS,
  labelOf,
  labelOfNumber,
  paramStatusTagType
} from '@/views/qlzg/constants'
import {
  QlzgCategoryApi,
  paramSchemaOf,
  type QlzgCategorySimpleVO,
  type QlzgParamSchemaItem
} from '@/api/qlzg/category'
import { QlzgParamApi, type QlzgParamVO } from '@/api/qlzg/param'
import {
  NATIONAL_REGION_CODE,
  displayValueOf,
  effectiveRangeLabel,
  effectiveStateLabel,
  effectiveStateOf,
  loadFormModel,
  buildSaveVO,
  regionScopeLabel
} from './paramSchema'
import ParamForm from './ParamForm.vue'

/**
 * 参数库台账
 *
 * <h3>🔴 搜索栏里刻意【没有】「通用参数」这一档</h3>
 * 后端 {@code selectVisiblePage} 对 {@code categoryCode} / {@code industryCode} 是**精确**匹配，
 * 且**刻意不加** {@code OR col IS NULL}。理由写在它的注释里，而两边都对：
 * 四维回退的候选查询回答「这次测算会用到哪些参数」（通用参数会用到，所以要 OR），
 * 台账回答「表里有哪些行让我改」（筛品类就该只有这个品类的行）。
 * 台账里加 OR 的后果是这个筛选框**说谎** —— 选了住宅却混进一堆通用行。
 * 所以「只看通用参数」是靠**不传品类** + 看品类列（显示「通用」那个 tag）完成的，
 * 前端加一个 value 为空串的选项去「筛通用」，筛出来的永远是空集。
 *
 * <h3>🔴 刻意【没有】导出按钮</h3>
 * 后端 {@code QlzgParamController} 没有导出端点。本系统所有错误都是 HTTP 200、
 * 真码在 body 的 {@code code} 字段里，所以画一个按钮去调一个不存在的路径，
 * 看起来像「按钮没反应」，比不画它更难排查。
 * 四个宿主的台账（委托方 / 项目 / 标的 / 案例）有导出，是因为它们的 Controller 有那个端点 ——
 * 参数库没有，别照抄。
 *
 * <h3>🔴 为了显示百分数，这一页会**把可见品类的详情各拉一次**</h3>
 * {@code unit='%'} 的参数库里存的是**分数**（0.075 = 7.5%），而「该不该乘 100」
 * 只有品类的 {@code param_schema} 知道 —— 行上那个 {@code unit} 列是**用户填的**
 * （{@code applyDerivedColumns} 不派生它），拿它当判据的话，
 * 一条 unit 被写成 {@code %} 而值存了 7.5 的行会显示成 750%。
 *
 * <p>⚠️ 所以 {@link loadSchemas} 是按 simple-list **逐个** {@code /qlzg/category/get}。
 * 今天种子里只有 1 个品类（{@code REAL_ESTATE_MORTGAGE_RESIDENTIAL}），
 * 品类又是机构级基础数据、由实施人员维护，量级是个位数，所以这个代价可以接受。
 * 🔴 哪个机构真把品类堆到几十个，这里就该改成**后端给一个只返回 PARAM 作用域 schema 的端点**，
 * 而不是在前端加缓存层 —— 缓存层解决不了「品类改了 schema、这一页还拿着旧的」这件事。
 *
 * <h3>🔴 「停用 / 启用」是【读整行 → 改一列 → 写整行】，不是一个状态端点</h3>
 * 后端没有 {@code /update-status}，而 {@code QlzgParamDO} 的 11 个可空列挂了
 * {@code updateStrategy = ALWAYS}，所以 {@code updateById} 是**全行更新**：
 * 只发 {@code {id, status}} 会把那 11 列全部清成 NULL ——
 * 一条参数的品类、行业、生效日、依据会一起消失，而接口返回成功。
 * 所以这里先 {@code /get} 拿回整行，用 {@link loadFormModel} → {@link buildSaveVO} 走一遍
 * **同一份** schema 声明往返（两次用同一个 {@code schemaItem}，换算与反换算必然互逆，
 * 值原样回到库里），只把 {@code status} 换掉。
 */
defineOptions({ name: 'QlzgParam' })

const message = useMessage()
const { t } = useI18n()

/** 平台级行三个按钮的悬停说明。🔴 要给出路，不能只说「不行」 */
const PLATFORM_ROW_HINT =
  '平台级参数本机构不能改、不能删。要另一套口径，请新建一条来源为「机构内部」的参数去覆盖它——' +
  '四维回退里机构级优先于平台级，所以覆盖是生效的。'

/**
 * 「归属」筛选的三态选项
 *
 * 🔴 这一层 cast 只为过类型：{@code el-option} 的 {@code value} prop 在类型上不接受
 *    {@code undefined}（{@code EpPropMergeType<Boolean|Object|String|Number>}），
 *    而「全部」那一项**必须**是 {@code undefined}（理由见
 *    {@code PARAM_PLATFORM_LEVEL_OPTIONS} 自己的注释）。
 *    运行期是可行的：EP 按全等比选项值与 modelValue，而 {@code queryParams.platformLevel}
 *    的初值也是 undefined。
 * ⚠️ 不要为了绕开这个类型错把那一档改成 {@code null} 或 {@code ''}：
 *    那两个都会被当成一个**真实筛选值**发出去，表现是「选了全部却看不到平台级参数」，
 *    而平台级恰恰是基准地价、资本化率这些最常用的那批
 */
const platformLevelOptions = PARAM_PLATFORM_LEVEL_OPTIONS as { label: string; value: any }[]

const route = useRoute()
const loading = ref(true)
const total = ref(0)
const list = ref<QlzgParamVO[]>([])
const queryParams = reactive({
  pageNo: 1,
  pageSize: 20,
  paramKey: '',
  paramName: '',
  categoryCode: undefined as string | undefined,
  regionCode: '',
  sourceType: undefined as string | undefined,
  // 🔴 三态：undefined = 平台级与本机构都要。重置时必须设回 undefined，不要设成 ''
  platformLevel: undefined as boolean | undefined,
  status: undefined as number | undefined,
  createTime: [] as string[]
})
const queryFormRef = ref()

/**
 * 有效期那一列的参照日。🔴 台账没有项目上下文，拿不到评估基准日，只能用今天
 *
 * 🔴 用 {@code formatDate} 而不是 {@code new Date().toISOString().slice(0, 10)}：
 *    后者是 **UTC**，在东八区的 00:00–08:00 之间会得到**昨天**。
 *    表现是每天早上头八小时，一条「今天到期」的参数被标成「已过期」，
 *    而评估师照它去改了一条其实还在有效期内的参数 —— 两处都不报错
 */
const today = formatDate(new Date(), 'YYYY-MM-DD')

/**
 * 这一行在今天这个参照日上的有效期状态
 *
 * 🔴 模板里三处都走它，不要各自展开成 {@code effectiveStateOf(row.effectiveFrom, …)}：
 *    展开之后参照日就散在三个地方了，改一处漏两处的表现是
 *    「tag 说已过期、文字说尚未生效」—— 而两句话各自都对，只是参照日不同
 */
const effectiveState = (row: QlzgParamVO) =>
  effectiveStateOf(row.effectiveFrom, row.effectiveUntil, today)

// ==================== 品类 schema ====================

const categoryList = ref<QlzgCategorySimpleVO[]>([])
/** 品类码 → 该品类 PARAM 作用域的 schema，表单里选完品类就用它填参数键下拉 */
const schemaByCategory = ref<Map<string, QlzgParamSchemaItem[]>>(new Map())
/**
 * 参数键 → schema 声明，**跨品类**的并集（同键取第一个）
 *
 * 🔴 它是「通用品类」那一支的唯一依据：{@code categoryCode} 为空时，
 *    后端 {@code validateParamKeyDeclared} 的判据是「该键在**任意一个可见品类**的
 *    PARAM 作用域里被声明过」，所以前端也只能按并集来。
 *    没有它的话，通用参数就退化成自由输入 + 一个必然被后端拒的键。
 */
const schemaIndex = ref<Map<string, QlzgParamSchemaItem>>(new Map())

const categoryNameOf = (code?: string | null): string =>
  categoryList.value.find((item) => item.categoryCode === code)?.categoryName ?? (code || '')

/** 按（品类码, 参数键）取 schema 声明；品类为空时走跨品类并集 */
const schemaItemOf = (
  categoryCode?: string | null,
  paramKey?: string | null
): QlzgParamSchemaItem | undefined => {
  if (!paramKey) return undefined
  if (categoryCode) {
    return schemaByCategory.value.get(categoryCode)?.find((item) => item.key === paramKey)
  }
  return schemaIndex.value.get(paramKey)
}

/**
 * 表单里「参数键」下拉的选项
 *
 * 🔴 选了品类就是这个品类声明的那些键；选了「通用参数」就是**跨品类并集** ——
 *    后者不是前端的宽松，而是后端 {@code validateParamKeyDeclared} 在品类为空时的判据
 *    （「该键在任意一个可见品类的 PARAM 作用域里被声明过」）。两边同一口径。
 * 🔴 刻意**不开** {@code allow-create}：自由输入的键后端一律以
 *    {@code PARAM_KEY_NOT_DECLARED} 拒回来，而那条报错在**新增和查询两侧**都会出现 ——
 *    录进去一个没声明的键，之后连打开这条参数的详情都会失败。
 *    给一个必然被拒的输入框，比不给更坏。
 */
const paramKeysOf = (categoryCode?: string | null): QlzgParamSchemaItem[] => {
  if (categoryCode) return schemaByCategory.value.get(categoryCode) ?? []
  return [...schemaIndex.value.values()]
}

/**
 * 拉品类清单与它们的 PARAM 作用域 schema
 *
 * 🔴 用 {@code allSettled}：一个品类的详情拉不下来不该让整页瘫掉，
 *    瘫掉的表现是台账一个值都显示不出来（而不是「少一个品类的下拉项」）。
 *    失败的品类在 {@code schemaByCategory} 里就是缺席，那一行会走「没有 schema」那一支：
 *    值按**库里存的原样**显示，不做任何换算 —— 那是不猜的形状。
 */
const loadSchemas = async () => {
  try {
    categoryList.value = (await QlzgCategoryApi.getSimpleList()) ?? []
  } catch {
    categoryList.value = []
  }
  const details = await Promise.allSettled(
    categoryList.value.map((item) => QlzgCategoryApi.getCategory(item.categoryCode))
  )
  const byCategory = new Map<string, QlzgParamSchemaItem[]>()
  const index = new Map<string, QlzgParamSchemaItem>()
  details.forEach((result, i) => {
    if (result.status !== 'fulfilled') return
    const code = categoryList.value[i]?.categoryCode
    const items = paramSchemaOf(result.value)
    if (!code) return
    byCategory.set(code, items)
    for (const item of items) {
      // 🔴 同键取第一个：并集只是为了「这个键合不合法 / 它是什么类型」，
      //    不是为了在两个品类给了不同 type 时挑一个 —— 那种分歧本身就该在品类配置页解决
      if (!index.has(item.key)) index.set(item.key, item)
    }
  })
  schemaByCategory.value = byCategory
  schemaIndex.value = index
}

/** 台账那一格的值。🔴 百分数换算靠 schema，行上的 unit 列是用户填的，不能当判据 */
const valueTextOf = (row: QlzgParamVO): string =>
  displayValueOf(schemaItemOf(row.categoryCode, row.paramKey), row)

// ==================== 列表 ====================

/** 查询参数列表 */
const getList = async () => {
  loading.value = true
  try {
    const data = await QlzgParamApi.getParamPage(queryParams)
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
  // 🔴 resetFields 把 platformLevel 恢复成它的**初值**，而初值是 undefined ——
  //    这里再显式写一次是为了不让它依赖 el-form 的内部行为：
  //    一旦被设成 '' 或 false，「全部」就变成了「只看本机构」，
  //    而平台级恰恰是基准地价、资本化率这些最常用的那批
  queryParams.platformLevel = undefined
  handleQuery()
}

/** 添加/修改操作 */
const formRef = ref()
const openForm = (type: string, id?: number) => {
  formRef.value.open(type, id)
}

/** 停用 / 启用 */
const handleToggleStatus = async (row: QlzgParamVO) => {
  const next = row.status === 1 ? 0 : 1
  const action = next === 1 ? '启用' : '停用'
  try {
    await message.confirm(
      `确定要${action}参数「${row.paramName}」吗？` +
        (next === 0
          ? '停用之后四维回退就查不到它了（候选查询带 status = 启用），' +
            '正在做的项目会落到「无参数 → 要求人工填写」那一档。'
          : '') +
        '已被口径快照引用的历史测算不受影响——快照存的是当时那个值的副本，不跟着活表变。',
      `${action}参数`
    )
    // 🔴 读整行、改一列、写整行。理由见类注释：只发 {id, status} 会把 11 个可空列清成 NULL
    const full = await QlzgParamApi.getParam(row.id)
    const schemaItem = schemaItemOf(full.categoryCode, full.paramKey)
    const model = loadFormModel(full, schemaItem)
    model.status = next
    await QlzgParamApi.updateParam(buildSaveVO(model, schemaItem, full))
    message.success(`${action}成功`)
    await getList()
  } catch {}
}

/** 删除按钮操作 */
const handleDelete = async (row: QlzgParamVO) => {
  try {
    await message.delConfirm(
      `确定要删除参数「${row.paramName}」吗？` +
        '已被口径快照引用的参数删不掉（那是报告的口径依据，删掉它已出稿的报告就失去了依据链）——' +
        '要让一条参数不再被测算用到，请点「停用」，不要删。',
      '删除参数'
    )
    await QlzgParamApi.deleteParam(row.id)
    message.success(t('common.delSuccess'))
    await getList()
  } catch {}
}

/** 初始化 **/
onMounted(async () => {
  // 🔴 从测算页的「去参数库新建」跳过来时带上 paramKey，这里替用户把搜索框填好。
  //    不填的话他落在一张几十行的台账上，还要自己把 `development_tax_fee_rate`
  //    这种键名一个字一个字打对 —— 而打错一个字母就搜不到，看起来像「这个键不存在」
  const raw = route.query.paramKey
  const text = Array.isArray(raw) ? raw[0] : raw
  if (text) queryParams.paramKey = String(text)
  // 🔴 schema 要先于列表：值那一格的换算依赖它，反过来的话首屏会闪一次「原样显示」的值
  await loadSchemas()
  await getList()
})
</script>
