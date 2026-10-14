<template>
  <div class="step-table-binding mt-20px">
    <!--
      说明入口。原先每个表单项下面都挂着一段静态说明，配一张表要从上往下
      读完三屏文字，而那些规则绝大多数只在第一次配的时候有用。
      现在页面上只留动态提示（按真实列类型算出来的那些），规则说明按需打开。
    -->
    <div class="binding-toolbar">
      <span class="binding-toolbar-hint">
        只绑定已有的物理表，不建表也不改表结构。配置规则见右侧文档。
      </span>
      <el-button link type="primary" @click="openDoc()">
        <Icon class="mr-3px" icon="ep:document" />
        查看文档
      </el-button>
    </div>

    <el-form ref="formRef" :model="modelData" label-width="140px" class="binding-form">
      <el-form-item label="数据源" prop="dataSourceConfigId">
        <el-select
          v-model="modelData.dataSourceConfigId"
          placeholder="请选择数据源"
          @change="handleDataSourceChange"
        >
          <el-option :value="0" label="主库（默认）" />
          <el-option
            v-for="ds in dataSourceList"
            :key="ds.id"
            :label="ds.name"
            :value="ds.id"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="主表" prop="mainTable">
        <div class="table-field">
          <el-select
            v-model="modelData.mainTable"
            filterable
            remote
            :remote-method="handleTableSearch"
            :loading="tableLoading"
            placeholder="请选择主表"
            class="table-field-select"
            @change="handleMainTableChange"
          >
            <el-option
              v-for="table in tableList"
              :key="table.name"
              :label="table.comment ? `${table.name}（${table.comment}）` : table.name"
              :value="table.name"
              :disabled="table.frameworkTable"
            >
              <span>{{ table.name }}</span>
              <span v-if="table.comment" style="color: var(--el-text-color-secondary); margin-left: 8px">
                {{ table.comment }}
              </span>
              <el-tag v-if="table.frameworkTable" type="danger" size="small" style="margin-left: 8px">
                系统表
              </el-tag>
            </el-option>
          </el-select>
          <TableQuickActions :table="modelData.mainTable" />
        </div>
      </el-form-item>

      <el-form-item label="主键列名" prop="mainPk">
        <el-input v-model="modelData.mainPk" placeholder="请输入主键列名，如 id" />
      </el-form-item>

      <el-form-item prop="pkStrategy">
        <template #label>
          <DocLabel text="主键策略" @doc="openDoc('pk')" />
        </template>
        <el-radio-group v-model="modelData.pkStrategy">
          <el-radio value="SNOWFLAKE">雪花算法</el-radio>
          <el-radio value="AUTO">数据库自增</el-radio>
          <el-radio value="UUID">UUID</el-radio>
        </el-radio-group>
        <!-- 按主键列的真实类型算出来的，不是静态说明，留在页面上 -->
        <el-alert
          v-if="pkTypeWarning"
          :title="pkTypeWarning"
          type="warning"
          :closable="false"
          show-icon
          class="mt-8px"
        />
      </el-form-item>

      <el-divider content-position="left">逻辑删除（可选）</el-divider>

      <el-form-item>
        <template #label>
          <DocLabel text="启用逻辑删除" @doc="openDoc('logic-delete')" />
        </template>
        <el-switch v-model="logicDeleteEnabled" />
      </el-form-item>

      <template v-if="logicDeleteEnabled">
        <el-form-item label="逻辑删除列名">
          <el-select
            v-model="logicDelete.column"
            filterable
            allow-create
            placeholder="如 deleted"
            @change="handleLogicDeleteColumnChange"
          >
            <el-option
              v-for="col in mainTableColumns"
              :key="col.columnName"
              :label="col.columnComment ? `${col.columnName}（${col.columnComment}）` : col.columnName"
              :value="col.columnName"
            />
          </el-select>
          <!-- 按真实列类型推断出来的，动态信息，留下 -->
          <div class="form-tip" v-if="logicDeleteColumnType">
            该列类型为 {{ logicDeleteColumnType }}，已自动推断值类型为「{{ valueTypeLabel }}」。
          </div>
        </el-form-item>
        <el-form-item label="值类型">
          <el-radio-group v-model="logicDelete.valueType">
            <el-radio value="NUMBER">数字</el-radio>
            <el-radio value="BOOLEAN">布尔</el-radio>
            <el-radio value="STRING">字符串</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="已删除值">
          <el-input v-model="logicDelete.deletedValue" placeholder="如 1" />
        </el-form-item>
        <el-form-item label="未删除值">
          <el-input v-model="logicDelete.normalValue" placeholder="如 0" />
        </el-form-item>
      </template>

      <el-divider content-position="left">乐观并发锁（可选）</el-divider>

      <el-form-item>
        <template #label>
          <DocLabel text="启用乐观锁" @doc="openDoc('lock')" />
        </template>
        <el-switch v-model="optimisticLockEnabled" />
      </el-form-item>

      <template v-if="optimisticLockEnabled">
        <el-form-item label="版本列名">
          <el-select v-model="optimisticLock.column" filterable allow-create placeholder="如 version">
            <el-option
              v-for="col in integerColumns"
              :key="col.columnName"
              :label="col.columnComment ? `${col.columnName}（${col.columnComment}）` : col.columnName"
              :value="col.columnName"
            />
          </el-select>
        </el-form-item>
      </template>

      <el-divider content-position="left">数据变更日志（可选）</el-divider>

      <el-form-item>
        <template #label>
          <DocLabel text="记录变更日志" @doc="openDoc('change-log')" />
        </template>
        <el-switch v-model="changeLogEnabled" />
      </el-form-item>

      <el-divider content-position="left">系统字段自动填充（可选）</el-divider>

      <el-form-item>
        <template #label>
          <DocLabel text="手动指定列名" @doc="openDoc('auto-fill')" />
        </template>
        <el-switch v-model="autoFillManualColumn" />
      </el-form-item>

      <el-table :data="auditRows" size="small" border class="mb-20px audit-table">
        <el-table-column label="系统字段" width="110">
          <template #default="{ row }">{{ row.label }}</template>
        </el-table-column>
        <el-table-column label="物理列" min-width="200">
          <template #default="{ row }">
            <el-select
              v-if="autoFillManualColumn"
              v-model="autoFill[row.columnKey]"
              filterable
              clearable
              allow-create
              size="small"
              placeholder="选择或输入列名"
            >
              <el-option
                v-for="col in mainTableColumns"
                :key="col.columnName"
                :label="col.columnComment ? `${col.columnName}（${col.columnComment}）` : col.columnName"
                :value="col.columnName"
              />
            </el-select>
            <!-- 自动探测模式下只读展示：列名由规范决定，不该让用户拼错 -->
            <template v-else>
              <span v-if="autoFill[row.columnKey]" class="audit-column-name">
                {{ autoFill[row.columnKey] }}
              </span>
              <span v-else class="audit-column-missing">该表无此列，将跳过填充</span>
            </template>
          </template>
        </el-table-column>
        <el-table-column label="填充方式" width="330">
          <template #default="{ row }">
            <el-radio-group
              v-model="autoFill[row.modeKey]"
              size="small"
              :disabled="!autoFill[row.columnKey]"
            >
              <el-radio-button value="AUTO">系统填充</el-radio-button>
              <el-radio-button value="MANUAL">表单填写</el-radio-button>
              <el-radio-button value="NONE">不填充</el-radio-button>
            </el-radio-group>
          </template>
        </el-table-column>
      </el-table>
    </el-form>

    <!--
      关联表铺满整个步骤宽度，不跟着上面的表单限宽

      七列固定宽合计约 900px，塞进 680px 的表单区会逼出一条横向滚动条 ——
      用户得先横向拖一段才能看见「操作」列里的编辑与删除按钮。
    -->
    <el-divider content-position="left">关联表（可选）</el-divider>

    <div class="relation-toolbar">
      <el-button
        plain
        size="small"
        type="primary"
        :disabled="!modelData.mainTable"
        @click="openRelationDialog()"
      >
        添加关联表
      </el-button>
      <span v-if="!modelData.mainTable" class="form-tip ml-10px">请先选择主表</span>
      <el-button class="ml-auto" link type="primary" @click="openDoc('relation')">
        <Icon class="mr-3px" icon="ep:document" />
        三类关联表怎么选
      </el-button>
    </div>

    <el-table v-if="relationTables.length > 0" :data="relationTables" border size="small">
      <el-table-column label="表名" min-width="220" show-overflow-tooltip>
        <template #default="{ row }">
          <div class="table-field">
            <span class="table-field-name">{{ row.table }}</span>
            <TableQuickActions :table="row.table" />
          </div>
        </template>
      </el-table-column>
      <el-table-column label="类型" width="110">
        <template #default="{ row }">
          <el-tag :type="RELATION_TYPE_TAG[row.type]" size="small">
            {{ RELATION_TYPE_LABELS[row.type] }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="外键列" min-width="130" prop="foreignKey" show-overflow-tooltip />
      <el-table-column label="主键列" min-width="110">
        <template #default="{ row }">
          <span v-if="row.type === 'JOIN'">-</span>
          <span v-else>{{ row.pk || 'id' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="子表控件字段" min-width="130" show-overflow-tooltip>
        <template #default="{ row }">
          <span v-if="row.type !== 'SUB'">-</span>
          <span v-else-if="row.field">{{ row.field }}</span>
          <el-tag v-else type="danger" size="small">未配置</el-tag>
        </template>
      </el-table-column>
      <el-table-column
        label="关联主表列"
        min-width="120"
        prop="relationField"
        show-overflow-tooltip
      />
      <el-table-column label="操作" width="110" fixed="right">
        <template #default="{ row, $index }">
          <el-button link size="small" type="primary" @click="openRelationDialog(row, $index)">
            编辑
          </el-button>
          <el-button link size="small" type="danger" @click="relationTables.splice($index, 1)">
            删除
          </el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-empty v-else :image-size="60" description="还没有关联表。只有一张主表时不必配。" />

    <!-- 关联表配置弹窗 -->
    <el-dialog v-model="relationDialogVisible" :title="relationDialogTitle" width="600px" append-to-body>
      <el-form ref="relationFormRef" :model="relationForm" label-width="120px">
        <el-form-item label="关联类型" required>
          <el-radio-group v-model="relationForm.type" @change="handleRelationTypeChange">
            <el-radio value="SIDE">一对一副表</el-radio>
            <el-radio value="SUB">一对多明细</el-radio>
            <el-radio value="JOIN">只读关联</el-radio>
          </el-radio-group>
        </el-form-item>

        <el-form-item label="表名" required>
          <el-select
            v-model="relationForm.table"
            filterable
            remote
            :remote-method="handleRelationTableSearch"
            :loading="relationTableLoading"
            placeholder="请选择表"
            @change="handleRelationTableChange"
          >
            <el-option
              v-for="t in relationTableList"
              :key="t.name"
              :label="t.comment ? `${t.name}（${t.comment}）` : t.name"
              :value="t.name"
              :disabled="relationForm.type !== 'JOIN' && t.frameworkTable"
            >
              <span>{{ t.name }}</span>
              <!--
                🔴 表的中文注释必须写进这个自定义插槽，只留在上面的 :label 里等于没写。
                el-option 一旦给了默认插槽，:label 就【只】用于选中后回显在输入框里，
                下拉列表渲染的是插槽内容 —— 本文件上面「选择主表」那个下拉就是这么写的，
                而这里原先漏了，于是关联表候选列表里只剩一串英文表名。
                这个库有两百多张表、其中大部分带中文注释；而本下拉的候选里还有相当一部分
                是被上面那条 :disabled 灰掉的系统表 —— 灰掉的和能选的都只是一串英文表名，
                注释恰恰是唯一能认出「这张表是干什么的」的东西。
              -->
              <span v-if="t.comment" class="ml-8px text-[var(--el-text-color-secondary)]">
                {{ t.comment }}
              </span>
              <el-tag v-if="t.frameworkTable" type="danger" size="small" class="ml-8px">系统表</el-tag>
            </el-option>
          </el-select>
        </el-form-item>

        <el-form-item label="外键列" required>
          <el-select
            v-model="relationForm.foreignKey"
            filterable
            allow-create
            placeholder="该表中指向主表的列"
          >
            <el-option
              v-for="c in relationColumns"
              :key="c.columnName"
              :label="c.columnComment ? `${c.columnName}（${c.columnComment}）` : c.columnName"
              :value="c.columnName"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="关联主表列">
          <el-select v-model="relationForm.relationField" filterable placeholder="默认为主表主键">
            <el-option
              v-for="c in mainTableColumns"
              :key="c.columnName"
              :label="c.columnComment ? `${c.columnName}（${c.columnComment}）` : c.columnName"
              :value="c.columnName"
            />
          </el-select>
        </el-form-item>

        <el-form-item v-if="relationForm.type !== 'JOIN'" label="该表主键列" required>
          <el-select
            v-model="relationForm.pk"
            filterable
            allow-create
            placeholder="默认为 id"
          >
            <el-option
              v-for="c in relationColumns"
              :key="c.columnName"
              :label="c.columnComment ? `${c.columnName}（${c.columnComment}）` : c.columnName"
              :value="c.columnName"
            />
          </el-select>
        </el-form-item>

        <el-form-item v-if="relationForm.type !== 'JOIN'" label="主键策略">
          <el-radio-group v-model="relationForm.pkStrategy">
            <el-radio value="AUTO">数据库自增</el-radio>
            <el-radio value="SNOWFLAKE">雪花算法</el-radio>
            <el-radio value="UUID">UUID</el-radio>
          </el-radio-group>
        </el-form-item>

        <el-form-item v-if="relationForm.type === 'SUB'" label="子表控件字段" required>
          <el-input v-model="relationForm.field" placeholder="表单里子表控件的 field" />
        </el-form-item>

        <template v-if="relationForm.type === 'JOIN'">
          <el-form-item label="表别名">
            <el-input v-model="relationForm.alias" placeholder="如 u，用于 SQL 限定列" />
          </el-form-item>
          <el-form-item label="展示列">
            <el-select v-model="relationForm.selectColumns" multiple filterable placeholder="选择要在列表展示的列">
              <el-option
                v-for="c in relationColumns"
                :key="c.columnName"
                :label="c.columnComment ? `${c.columnName}（${c.columnComment}）` : c.columnName"
                :value="c.columnName"
              />
            </el-select>
          </el-form-item>
        </template>
      </el-form>
      <template #footer>
        <!-- el-dialog 的页脚是右对齐的文本流，要让说明入口靠左得自己开一层 flex -->
        <div class="relation-dialog-footer">
          <el-button link type="primary" @click="openDoc('relation')">查看字段说明</el-button>
          <div>
            <el-button @click="relationDialogVisible = false">取消</el-button>
            <el-button type="primary" @click="saveRelationTable">确定</el-button>
          </div>
        </div>
      </template>
    </el-dialog>

    <BindingDocDrawer ref="docDrawerRef" />
  </div>
</template>

<script lang="ts" setup>
import { computed, reactive, ref, onMounted } from 'vue'
import * as FormDesignApi from '@/api/infra/formDesign'
import { useStepRestore } from './useStepRestore'
import BindingDocDrawer from './BindingDocDrawer.vue'
import DocLabel from './DocLabel.vue'
import TableQuickActions from './TableQuickActions.vue'

defineOptions({ name: 'FormDesignStepTableBinding' })

const message = useMessage()
const modelData = defineModel<any>({ required: true })

/** 说明文档抽屉。带上小节标识时直接定位到那一节 */
const docDrawerRef = ref()
const openDoc = (sectionId?: string) => docDrawerRef.value?.open(sectionId)

/**
 * 去掉列名的表名/别名前缀
 *
 * ON 条件存的是 "biz_customer.owner_id" 或 "u.id"，界面上只展示列名。
 * 与后端 FormDesignSqlBuilder.stripQualifier 逻辑一致。
 */
const stripQualifier = (qualified?: string): string | undefined => {
  if (!qualified) return undefined
  const idx = qualified.lastIndexOf('.')
  return idx >= 0 ? qualified.substring(idx + 1) : qualified
}

const dataSourceList = ref<FormDesignApi.DataSourceConfigVO[]>([])
const tableList = ref<FormDesignApi.DbTableVO[]>([])
const tableLoading = ref(false)

/** 主表的列信息，用于逻辑删除列选择与审计列自动探测 */
const mainTableColumns = ref<FormDesignApi.DbColumnVO[]>([])

/**
 * 主键策略与主键列类型的匹配提示
 *
 * 后端发布校验会硬拦（FORM_DESIGN_PK_TYPE_MISMATCH），这里提前提示，
 * 免得用户配到最后一步才被拒。雪花是 19 位 Long，int 列会溢出。
 */
const pkTypeWarning = computed(() => {
  const strategy = modelData.value.pkStrategy
  if (!strategy || strategy === 'AUTO') return ''
  const pkName = modelData.value.mainPk || 'id'
  const pkCol = mainTableColumns.value.find((c) => c.columnName === pkName)
  if (!pkCol?.jdbcType) return ''
  const t = pkCol.jdbcType.toUpperCase()

  if (strategy === 'SNOWFLAKE' && !(t.includes('BIGINT') || t === 'DECIMAL' || t === 'NUMERIC')) {
    return `主键列 ${pkName} 的类型是 ${pkCol.jdbcType}，装不下 19 位的雪花 ID。请改用 bigint 列，或把主键策略换成「数据库自增」。`
  }
  if (strategy === 'UUID' && !(t.includes('CHAR') || t.includes('TEXT'))) {
    return `主键列 ${pkName} 的类型是 ${pkCol.jdbcType}，无法存放 32 位 UUID 字符串。请改用 varchar(32) 及以上的列，或更换主键策略。`
  }
  return ''
})

/** 逻辑删除配置，初始从 modelData.tableBinding 反序列化 */
const logicDeleteEnabled = ref(false)
const logicDelete = reactive({
  column: 'deleted',
  deletedValue: '1',
  normalValue: '0',
  valueType: 'NUMBER'
})

const VALUE_TYPE_LABELS: Record<string, string> = {
  NUMBER: '数字',
  BOOLEAN: '布尔',
  STRING: '字符串'
}

/**
 * 乐观并发锁配置
 *
 * 与逻辑删除并列：都是「绑定的已有表上某一列的约定」，都得按表配。
 * 版本列必须是整数列，且不能被表单字段映射 —— 两条都由发布校验强制。
 */
const optimisticLockEnabled = ref(false)
const optimisticLock = reactive({ column: 'version' })

/** 数据变更日志开关。与逻辑删除、乐观锁并列放在 tableBinding 里 */
const changeLogEnabled = ref(false)

/** 主表里可以当版本列的整数列 */
const integerColumns = computed(() =>
  mainTableColumns.value.filter((col) => {
    const type = (col.jdbcType ?? '').toUpperCase()
    return type.includes('INT')
  })
)

const valueTypeLabel = computed(() => VALUE_TYPE_LABELS[logicDelete.valueType] ?? logicDelete.valueType)

/** 逻辑删除列的真实数据库类型 */
const logicDeleteColumnType = computed(() => {
  const col = mainTableColumns.value.find((c) => c.columnName === logicDelete.column)
  return col?.jdbcType
})

/**
 * 按列的 jdbcType 推断值类型
 *
 * 存在的原因：配置里的删除值是字符串，但物理列可能是 bit / tinyint。
 * 把字符串 '0' 绑给 bit(1) 列，MySQL 报 Data truncation: Data too long for column。
 * 让用户自己判断该选哪个类型不现实，所以选完列就自动推断，用户仍可手工改。
 */
const inferValueType = (jdbcType?: string): string => {
  if (!jdbcType) return 'NUMBER'
  const t = jdbcType.toUpperCase()
  if (t === 'BIT' || t === 'BOOLEAN') return 'NUMBER' // bit(1) 收数字 0/1 兼容面最广
  if (t.includes('CHAR') || t === 'TEXT') return 'STRING'
  return 'NUMBER'
}

const handleLogicDeleteColumnChange = () => {
  logicDelete.valueType = inferValueType(logicDeleteColumnType.value)
}

/**
 * 自动填充配置
 *
 * 列名由自动探测填入（见 detectAuditColumns），mode 决定由谁写入该列。
 * mode 缺省 AUTO，与后端 AutoFillModeEnum.parse 的回退保持一致。
 */
const autoFill = reactive<Record<string, string>>({
  creatorColumn: '',
  creatorMode: 'AUTO',
  createTimeColumn: '',
  createTimeMode: 'AUTO',
  updaterColumn: '',
  updaterMode: 'AUTO',
  updateTimeColumn: '',
  updateTimeMode: 'AUTO'
})

/** 是否手工指定审计列名。默认关闭，走自动探测 */
const autoFillManualColumn = ref(false)

/** 审计字段表格的行定义 */
const auditRows = [
  { label: '创建人', columnKey: 'creatorColumn', modeKey: 'creatorMode' },
  { label: '创建时间', columnKey: 'createTimeColumn', modeKey: 'createTimeMode' },
  { label: '更新人', columnKey: 'updaterColumn', modeKey: 'updaterMode' },
  { label: '更新时间', columnKey: 'updateTimeColumn', modeKey: 'updateTimeMode' }
]

// ==================== 关联表 ====================

/**
 * 关联表的统一视图模型
 *
 * 后端把三类表分开存（sideTables / subTables / joinTables），语义清晰但配置界面
 * 分三个列表会很啰嗦。这里用扁平结构 + type 字段统一编辑，序列化时再按 type 分流。
 */
const relationTables = ref<any[]>([])

const RELATION_TYPE_LABELS: Record<string, string> = {
  SIDE: '一对一副表',
  SUB: '一对多明细',
  JOIN: '只读关联'
}

const RELATION_TYPE_TAG: Record<string, 'primary' | 'success' | 'info'> = {
  SIDE: 'primary',
  SUB: 'success',
  JOIN: 'info'
}

const relationDialogVisible = ref(false)
const relationEditIndex = ref(-1)
const relationTableList = ref<FormDesignApi.DbTableVO[]>([])
const relationTableLoading = ref(false)
/** 弹窗里所选表的列，供外键与展示列选择 */
const relationColumns = ref<FormDesignApi.DbColumnVO[]>([])

const relationForm = reactive<any>({
  type: 'SIDE',
  table: '',
  pk: 'id',
  pkStrategy: 'AUTO',
  foreignKey: '',
  relationField: '',
  field: '',
  alias: '',
  selectColumns: []
})

const relationDialogTitle = computed(() =>
  relationEditIndex.value >= 0 ? '编辑关联表' : '添加关联表'
)

const openRelationDialog = (row?: any, index?: number) => {
  relationEditIndex.value = index ?? -1
  Object.assign(relationForm, {
    type: row?.type ?? 'SIDE',
    table: row?.table ?? '',
    pk: row?.pk ?? 'id',
    pkStrategy: row?.pkStrategy ?? 'AUTO',
    foreignKey: row?.foreignKey ?? '',
    // 默认关联到主表主键
    relationField: row?.relationField ?? modelData.value.mainPk ?? 'id',
    field: row?.field ?? '',
    alias: row?.alias ?? '',
    selectColumns: row?.selectColumns ? [...row.selectColumns] : []
  })
  relationColumns.value = []
  relationTableList.value = []
  if (relationForm.table) {
    loadRelationColumns()
  }
  handleRelationTableSearch('')
  relationDialogVisible.value = true
}

const handleRelationTypeChange = () => {
  // 只读关联允许系统表，切换类型后已选的表可能不再合法，清掉让用户重选
  if (relationForm.table) {
    const selected = relationTableList.value.find((t) => t.name === relationForm.table)
    if (relationForm.type !== 'JOIN' && selected?.frameworkTable) {
      relationForm.table = ''
      relationForm.foreignKey = ''
      relationColumns.value = []
    }
  }
}

const handleRelationTableSearch = async (query: string) => {
  const dsId = modelData.value.dataSourceConfigId
  if (dsId == null) return
  relationTableLoading.value = true
  try {
    relationTableList.value = await FormDesignApi.getDbTables(dsId, query)
  } finally {
    relationTableLoading.value = false
  }
}

const handleRelationTableChange = () => {
  relationForm.foreignKey = ''
  relationForm.selectColumns = []
  loadRelationColumns().then(() => {
    // 按新表的真实主键回填。多数表叫 id，但绑老表时未必
    const pkCol = relationColumns.value.find((c) => c.primaryKey)
    relationForm.pk = pkCol?.columnName ?? 'id'
  })
}

const loadRelationColumns = async () => {
  const dsId = modelData.value.dataSourceConfigId
  if (dsId == null || !relationForm.table) {
    relationColumns.value = []
    return
  }
  relationColumns.value = await FormDesignApi.getTableColumns(dsId, relationForm.table)
}

const saveRelationTable = () => {
  if (!relationForm.table) {
    message.warning('请选择表')
    return
  }
  if (!relationForm.foreignKey) {
    message.warning('请选择外键列')
    return
  }
  if (relationForm.type !== 'JOIN' && !relationForm.pk) {
    message.warning('副表与明细表必须指定主键列')
    return
  }
  if (relationForm.type === 'SUB' && !relationForm.field) {
    message.warning('一对多明细必须填写子表控件字段')
    return
  }
  // 外键不能同时是主键：写入时两者会各写一次同一列，生成非法 SQL
  if (relationForm.type !== 'JOIN' && relationForm.pk === relationForm.foreignKey) {
    message.warning('主键列与外键列不能是同一列')
    return
  }
  // 自关联：只读的关联表放开（部门树、物料 BOM 就靠它显示上级名称），
  // 写入型的副表/明细表仍然禁止 —— 它们要往那张表写数据，而那张表就是主表，
  // 一次提交会对同一张表发两条互不知情的写入
  const isSelfJoin = relationForm.table === modelData.value.mainTable
  if (isSelfJoin) {
    if (relationForm.type !== 'JOIN') {
      message.warning('主表只能作为「只读关联」自关联；副表与明细表不支持自关联')
      return
    }
    // ⚠️ 别名是自关联的前提：没有它，SQL 拼出来是 FROM t LEFT JOIN t，
    // 数据库直接报 Not unique table/alias
    if (!relationForm.alias) {
      message.warning('自关联必须填别名，否则 SQL 里两个同名表无法区分')
      return
    }
    if (relationForm.alias === modelData.value.mainTable) {
      message.warning('别名不能与主表名相同，等于没起别名')
      return
    }
  }
  // 同一张表只能出现一次 —— 但自关联时按别名判重：
  // 同一张表 JOIN 两次（上级 + 上上级）是合理的
  const duplicated = relationTables.value.some((r, i) => {
    if (i === relationEditIndex.value) return false
    return relationForm.alias || r.alias
      ? r.table === relationForm.table && (r.alias || '') === (relationForm.alias || '')
      : r.table === relationForm.table
  })
  if (duplicated) {
    message.warning(
      `表 ${relationForm.table}${relationForm.alias ? `（别名 ${relationForm.alias}）` : ''} 已配置过，请勿重复添加`
    )
    return
  }
  // 子表控件字段也必须唯一，两个子表指向同一个控件会互相覆盖明细
  const fieldDuplicated =
    relationForm.type === 'SUB' &&
    relationTables.value.some(
      (r, i) => r.type === 'SUB' && r.field === relationForm.field && i !== relationEditIndex.value
    )
  if (fieldDuplicated) {
    message.warning(`子表控件字段 ${relationForm.field} 已被其它明细表占用`)
    return
  }

  const row = {
    type: relationForm.type,
    table: relationForm.table,
    pk: relationForm.pk || 'id',
    pkStrategy: relationForm.pkStrategy || 'AUTO',
    foreignKey: relationForm.foreignKey,
    relationField: relationForm.relationField || modelData.value.mainPk || 'id',
    field: relationForm.field,
    alias: relationForm.alias,
    selectColumns: [...relationForm.selectColumns]
  }
  if (relationEditIndex.value >= 0) {
    relationTables.value[relationEditIndex.value] = row
  } else {
    relationTables.value.push(row)
  }
  relationDialogVisible.value = false
}

/**
 * 审计列的约定名模式
 *
 * 按顺序匹配，第一个命中的胜出。覆盖 yudao 自身约定（creator/create_time）、
 * 常见的 create_by/created_at，以及阿里系的 gmt_create。
 */
const AUDIT_COLUMN_PATTERNS: Record<string, string[]> = {
  creatorColumn: ['creator', 'create_by', 'created_by'],
  createTimeColumn: ['create_time', 'created_at', 'gmt_create'],
  updaterColumn: ['updater', 'update_by', 'updated_by'],
  updateTimeColumn: ['update_time', 'updated_at', 'gmt_modified']
}

/**
 * 自动探测审计列
 *
 * 原本要用户手工输入四个列名，容易拼错，且拼错要等到运行时才报错。
 * 改为绑定主表后按约定名匹配真实列，匹配不到就置空（表示该表没有这一列，跳过填充）。
 * 手动指定模式下不覆盖用户的选择。
 */
const detectAuditColumns = () => {
  if (autoFillManualColumn.value) return
  const realColumns = mainTableColumns.value.map((c) => c.columnName)
  Object.entries(AUDIT_COLUMN_PATTERNS).forEach(([key, patterns]) => {
    autoFill[key] = patterns.find((p) => realColumns.includes(p)) ?? ''
  })
}

const loadDataSources = async () => {
  dataSourceList.value = await FormDesignApi.getDataSourceList()
}

const handleDataSourceChange = () => {
  // 切换数据源时清空已选的表
  modelData.value.mainTable = undefined
  tableList.value = []
}

const handleTableSearch = async (query: string) => {
  if (modelData.value.dataSourceConfigId == null) return
  tableLoading.value = true
  try {
    tableList.value = await FormDesignApi.getDbTables(modelData.value.dataSourceConfigId, query)
  } finally {
    tableLoading.value = false
  }
}

/**
 * 加载主表列信息
 *
 * 逻辑删除列选择、值类型推断、审计列自动探测都依赖它。
 */
const loadMainTableColumns = async () => {
  const dsId = modelData.value.dataSourceConfigId
  const table = modelData.value.mainTable
  if (dsId == null || !table) {
    mainTableColumns.value = []
    return
  }
  mainTableColumns.value = await FormDesignApi.getTableColumns(dsId, table)
}

const handleMainTableChange = async () => {
  await loadMainTableColumns()

  // 自动探测并开启 deleted 字段
  autoDetectDeletedColumn()

  // 主表变了，逻辑删除的值类型要跟着新表的列类型重算
  if (logicDeleteEnabled.value) {
    handleLogicDeleteColumnChange()
  }
  // 审计列按新表的真实列重新探测
  detectAuditColumns()
}

/**
 * 自动探测 deleted 字段
 *
 * 主表选中后，检查是否存在 deleted 列（约定命名），
 * 有则自动开启逻辑删除并填入默认配置，减少用户操作步骤。
 */
const autoDetectDeletedColumn = () => {
  // 已经手动配置过逻辑删除，不覆盖用户选择
  if (logicDeleteEnabled.value) return

  const deletedCol = mainTableColumns.value.find((c) => c.columnName === 'deleted')
  if (!deletedCol) return

  // 找到 deleted 列，自动开启并填入默认配置
  logicDeleteEnabled.value = true
  logicDelete.column = 'deleted'
  logicDelete.deletedValue = '1'
  logicDelete.normalValue = '0'
  logicDelete.valueType = inferValueType(deletedCol.jdbcType)
}

/** 序列化 tableBinding */
const serializeTableBinding = () => {
  const binding: any = {
    mainTable: modelData.value.mainTable,
    mainPk: modelData.value.mainPk || 'id',
    pkStrategy: modelData.value.pkStrategy || 'SNOWFLAKE',
    logicDelete: logicDeleteEnabled.value
      ? {
          enabled: true,
          column: logicDelete.column,
          deletedValue: logicDelete.deletedValue,
          normalValue: logicDelete.normalValue,
          valueType: logicDelete.valueType
        }
      : { enabled: false },
    optimisticLock: optimisticLockEnabled.value
      ? { enabled: true, column: optimisticLock.column }
      : { enabled: false },
    changeLog: { enabled: changeLogEnabled.value },
    autoFill: {
      creatorColumn: autoFill.creatorColumn,
      creatorMode: autoFill.creatorMode,
      createTimeColumn: autoFill.createTimeColumn,
      createTimeMode: autoFill.createTimeMode,
      updaterColumn: autoFill.updaterColumn,
      updaterMode: autoFill.updaterMode,
      updateTimeColumn: autoFill.updateTimeColumn,
      updateTimeMode: autoFill.updateTimeMode
    },
    fieldMapping: {},
    sideTables: [],
    joinTables: [],
    subTables: []
  }

  // 字段映射由「表单设计」步骤合并进来，这里不能覆盖掉已有的
  // （serializeTableBinding 会在每次离开本步骤时执行）
  let existing: any = null
  try {
    existing = modelData.value.tableBinding ? JSON.parse(modelData.value.tableBinding) : null
  } catch {
    // 解析不了就当没有历史配置，不阻断保存
  }
  if (existing) {
    binding.fieldMapping = existing.fieldMapping ?? {}
  }

  // 关联表按 type 分流成后端的三个数组。
  // 各表的 fieldMapping 由「表单设计」步骤维护，这里按表名找回来，
  // 否则用户回到本步骤改一下配置，已配好的字段映射就被清空了
  const findExisting = (list: any[], table: string) =>
    (list ?? []).find((t: any) => t?.table === table)

  relationTables.value.forEach((r) => {
    if (r.type === 'SIDE') {
      binding.sideTables.push({
        table: r.table,
        pk: r.pk || 'id',
        pkStrategy: r.pkStrategy || 'AUTO',
        foreignKey: r.foreignKey,
        relationField: r.relationField,
        fieldMapping: findExisting(existing?.sideTables, r.table)?.fieldMapping ?? {}
      })
    } else if (r.type === 'SUB') {
      const prev = findExisting(existing?.subTables, r.table)
      binding.subTables.push({
        field: r.field,
        table: r.table,
        pk: r.pk || 'id',
        pkStrategy: r.pkStrategy || 'AUTO',
        foreignKey: r.foreignKey,
        fieldMapping: prev?.fieldMapping ?? {},
        // 审计列配置同样由「表单设计」步骤按明细表的真实列探测，这里原样保留
        autoFill: prev?.autoFill
      })
    } else if (r.type === 'JOIN') {
      binding.joinTables.push({
        table: r.table,
        alias: r.alias || undefined,
        joinType: 'LEFT',
        // ON 条件：主表的关联列 = 关联表的外键列
        on: [
          {
            left: `${modelData.value.mainTable}.${r.relationField}`,
            right: `${r.alias || r.table}.${r.foreignKey}`
          }
        ],
        // 展示列的别名默认与列名相同，前端按别名取值。
        // ⚠️ 自关联例外：关联的是同一张表，`parent.name AS name` 会与主表自己的 name
        // 在 SELECT 里撞名，而 queryForList 的 Map 只会留下一个 —— 表现是
        // 「上级名称显示成本级自己的名字」，SQL 与页面都不报错。所以自关联时给别名加前缀
        selectColumns: (r.selectColumns ?? []).map((col: string) => ({
          column: col,
          as: r.table === modelData.value.mainTable ? `${r.alias}_${col}` : col
        }))
      })
    }
  })

  modelData.value.tableBinding = JSON.stringify(binding)
}

/** 反序列化 tableBinding，回显已保存的配置 */
const deserializeTableBinding = () => {
  if (!modelData.value.tableBinding) return
  try {
    const binding = JSON.parse(modelData.value.tableBinding)
    if (binding.logicDelete?.enabled) {
      logicDeleteEnabled.value = true
      logicDelete.column = binding.logicDelete.column ?? 'deleted'
      logicDelete.deletedValue = binding.logicDelete.deletedValue ?? '1'
      logicDelete.normalValue = binding.logicDelete.normalValue ?? '0'
      // 历史配置没有 valueType 字段，回退到 NUMBER（与后端 parse() 的默认值一致）
      logicDelete.valueType = binding.logicDelete.valueType ?? 'NUMBER'
    }
    if (binding.optimisticLock?.enabled) {
      optimisticLockEnabled.value = true
      optimisticLock.column = binding.optimisticLock.column ?? 'version'
    }
    changeLogEnabled.value = binding.changeLog?.enabled === true
    if (binding.autoFill) {
      // 逐字段合并，mode 缺失时回退 AUTO（与后端 AutoFillModeEnum.parse 一致）
      auditRows.forEach(({ columnKey, modeKey }) => {
        autoFill[columnKey] = binding.autoFill[columnKey] ?? ''
        autoFill[modeKey] = binding.autoFill[modeKey] ?? 'AUTO'
      })
      // 已保存过列名说明用户当时可能手工指定过，保持列名不被自动探测覆盖
      autoFillManualColumn.value = auditRows.some(
        ({ columnKey }) => autoFill[columnKey] && !isConventionalName(columnKey, autoFill[columnKey])
      )
    }

    // 三类表合并回扁平的 relationTables 供界面编辑
    relationTables.value = [
      ...(binding.sideTables ?? []).map((s: any) => ({
        type: 'SIDE',
        table: s.table,
        pk: s.pk ?? 'id',
        pkStrategy: s.pkStrategy ?? 'AUTO',
        foreignKey: s.foreignKey,
        relationField: s.relationField ?? binding.mainPk ?? 'id',
        field: '',
        alias: '',
        selectColumns: []
      })),
      ...(binding.subTables ?? []).map((s: any) => ({
        type: 'SUB',
        table: s.table,
        pk: s.pk ?? 'id',
        pkStrategy: s.pkStrategy ?? 'AUTO',
        foreignKey: s.foreignKey,
        // 子表没有 relationField 概念，写入时外键固定填主表主键
        relationField: binding.mainPk ?? 'id',
        field: s.field ?? '',
        alias: '',
        selectColumns: []
      })),
      ...(binding.joinTables ?? []).map((j: any) => ({
        type: 'JOIN',
        table: j.table,
        pk: 'id',
        pkStrategy: 'AUTO',
        // ON 条件里右侧是关联表的列，取列名部分还原成外键
        foreignKey: stripQualifier(j.on?.[0]?.right) ?? '',
        relationField: stripQualifier(j.on?.[0]?.left) ?? binding.mainPk ?? 'id',
        field: '',
        alias: j.alias ?? '',
        selectColumns: (j.selectColumns ?? []).map((sc: any) => sc.column).filter(Boolean)
      }))
    ]
  } catch (e) {
    console.warn('Failed to parse tableBinding', e)
  }
  // 回显后补加载列信息，逻辑删除列下拉与审计列探测都要用
  loadMainTableColumns().then(() => {
    // 没有已保存的列名时才探测，避免覆盖用户配置
    if (auditRows.every(({ columnKey }) => !autoFill[columnKey])) {
      detectAuditColumns()
    }
  })
}

/** 判断列名是否属于该审计字段的约定名之一 */
const isConventionalName = (columnKey: string, columnName: string) =>
  (AUDIT_COLUMN_PATTERNS[columnKey] ?? []).includes(columnName)

const validate = async () => {
  if (!modelData.value.mainTable) {
    throw new Error('请选择主表')
  }
  serializeTableBinding()
  return true
}

defineExpose({ validate })

/**
 * 回显时机
 *
 * 不能放在 onMounted —— 本组件被父组件 v-show 控制，父组件挂载时它就一起挂载了，
 * 那时父组件的异步 loadData() 还没返回，tableBinding 是空的。
 */
useStepRestore(modelData, deserializeTableBinding, (data) => [data.tableBinding])

onMounted(() => {
  loadDataSources()
  // 预加载表列表
  if (modelData.value.dataSourceConfigId != null) {
    handleTableSearch('')
  }
})
</script>

<style lang="scss" scoped>
/*
  表单项限宽，关联表铺满

  这一步的容器比别的步骤宽（见 editor/index.vue），为的是让关联表那七列
  不必横向滚动。但整页的输入框跟着拉到 1080px 会变成一条条长线，
  所以把表单单独收回 680px。
*/
.binding-form,
.audit-table {
  max-width: 680px;
}

/*
  表名 + 快捷按钮一行排开

  宽度用 flex 三值而不是 UnoCSS 的 w-XXXpx：Element Plus 的 .el-select 自带
  width:100%，与单类的 .w-XXXpx 优先级相同、靠加载顺序决胜，实测会把选择器
  撑满并把旁边的按钮挤没。详见 tests/e2e/form-design-editor-layout.spec.ts
*/
.table-field {
  display: flex;
  gap: 4px;
  align-items: center;
  width: 100%;
}

.table-field-select {
  flex: 1 1 auto;
  min-width: 0;
}

.table-field-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.binding-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  margin-bottom: 16px;
  background-color: var(--el-fill-color-lighter);
  border-radius: 4px;
}

.binding-toolbar-hint {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.relation-toolbar {
  display: flex;
  align-items: center;
  margin-bottom: 10px;
}

.relation-dialog-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.form-tip {
  width: 100%;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
  margin-top: 4px;
}

/* 自动探测到的列名：只读展示，用等宽字体便于核对 */
.audit-column-name {
  font-family: var(--el-font-family-monospace, monospace);
  color: var(--el-text-color-primary);
}

/* 表里没有这一列时的提示 */
.audit-column-missing {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}
</style>
