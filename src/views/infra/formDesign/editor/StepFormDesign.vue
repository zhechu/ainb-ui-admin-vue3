<template>
  <div class="form-design-wrapper">
    <!-- 设计器主体。不加任何工具条，整块高度都留给画布 -->
    <div class="designer-area">
      <fc-designer ref="designer" :config="designerConfig" class="h-full" />
    </div>

    <!-- 收起态：只留一条竖边，未映射数量挂在角标上 -->
    <div v-if="mappingCollapsed" class="mapping-handle" @click="mappingCollapsed = false">
      <el-badge
        :hidden="unmappedCount === 0"
        :value="unmappedCount"
        type="danger"
        class="mapping-handle-badge"
      >
        <Icon icon="ep:d-arrow-left" />
      </el-badge>
      <span class="mapping-handle-text">字段映射</span>
    </div>

    <!-- 字段映射侧栏 -->
    <div v-else class="mapping-area">
      <div class="mapping-header">
        <span class="mapping-title">字段映射</span>
        <div>
          <el-button link type="primary" size="small" @click="handleRefreshFields">
            <Icon icon="ep:refresh" class="mr-3px" />
            刷新字段
          </el-button>
          <el-button link size="small" title="收起" @click="mappingCollapsed = true">
            <Icon icon="ep:d-arrow-right" />
          </el-button>
        </div>
      </div>

      <!--
        字段ID 已经能从物理列里直接选，选完映射会自动补上，所以这个面板平时用不到。
        留着是因为它仍是两件事的唯一入口：把自定义命名的字段绑到列上，
        以及看出哪些字段【没有】映射 —— 少了它，漏配会重新变成运行时才发现的静默失败。
      -->
      <el-alert
        v-if="unmappedCount > 0"
        :title="`有 ${unmappedCount} 个字段还没有映射到物理列，提交时这些字段不会入库`"
        type="warning"
        :closable="false"
        class="mb-10px"
      />

      <el-alert
        v-if="!modelData.mainTable"
        title="请先在「数据绑定」步骤选择主表"
        type="warning"
        :closable="false"
        class="mb-10px"
      />

      <!-- 一键生成。放在面板里而不是画布上方：常驻工具条要横占一整行，太吃高度 -->
      <el-button
        v-else
        type="primary"
        plain
        size="small"
        class="w-full mb-10px"
        @click="handleGenerateFromColumns"
      >
        <Icon icon="ep:magic-stick" class="mr-3px" />
        从 {{ modelData.mainTable }} 一键生成字段
      </el-button>

      <!-- 映射表。按归属分组：主表/副表字段一组，每张子表各一组 -->
      <div v-if="mappingGroups.length > 0" class="mapping-list">
        <div v-for="group in mappingGroups" :key="group.key" class="mapping-group">
          <div class="mapping-group-title">
            <span>{{ group.label }}</span>
            <span v-if="group.table" class="mapping-group-table">{{ group.table }}</span>
          </div>

          <el-alert
            v-if="group.owner && !group.table"
            title="该子表控件还没有在「数据绑定」步骤配置对应的明细表，字段无法映射"
            type="warning"
            :closable="false"
            class="mb-8px"
          />

          <div v-for="field in group.fields" :key="group.key + '::' + field.field" class="mapping-item">
            <div class="mapping-field">
              <span class="field-title">{{ field.title || field.field }}</span>
              <span class="field-name">{{ field.field }}</span>
            </div>
            <!-- 主表作用域下有副表时才显示表选择器；子表字段的表由控件归属决定，不给选 -->
            <el-select
              v-if="!group.owner && writableTables.length > 1"
              :model-value="mappingOf(group, field)?.table || modelData.mainTable"
              placeholder="选择表"
              size="small"
              class="mb-4px"
              @update:model-value="(t) => handleMappingTableChange(group, field, t)"
            >
              <el-option v-for="t in writableTables" :key="t.table" :label="t.label" :value="t.table" />
            </el-select>
            <el-select
              :model-value="mappingOf(group, field)?.column"
              :disabled="!!group.owner && !group.table"
              placeholder="选择物理列"
              clearable
              size="small"
              filterable
              @update:model-value="(c) => handleMappingColumnChange(group, field, c)"
            >
              <el-option
                v-for="col in mappableColumnsOf(mappingOf(group, field)?.table || group.table)"
                :key="col.columnName"
                :label="
                  col.columnComment ? `${col.columnName}（${col.columnComment}）` : col.columnName
                "
                :value="col.columnName"
              />
            </el-select>
          </div>

          <el-empty
            v-if="group.fields.length === 0"
            description="该子表控件内还没有字段"
            :image-size="40"
          />
        </div>
      </div>

      <el-empty v-else description="设计器中还没有字段，请先拖入控件" :image-size="60" />
    </div>
  </div>
</template>

<script lang="ts" setup>
import { useFormCreateDesigner, createDesignerConfig } from '@/components/FormCreate'
import { SUB_TABLE_WIDGET_TYPE } from '@/components/FormWidgets/contracts'
import { encodeConf, encodeFields, setConfAndFields } from '@/utils/formCreate'
import { useStepRestore } from './useStepRestore'
import { fieldNameOf } from './fieldNaming'
import * as FormDesignApi from '@/api/infra/formDesign'

defineOptions({ name: 'FormDesignStepFormDesign' })

/**
 * 子表控件在 form-create 规则里的 type
 *
 * 它的内部规则挂在 props.rule 下，而不是布局容器那样的 children。
 * 取自控件契约（@/components/FormWidgets/contracts），前后端唯一来源 ——
 * 改造前这个字面量在前后端共有 6 处副本，靠注释互相提醒保持一致。
 */

const message = useMessage()
const modelData = defineModel<any>({ required: true })

/**
 * 设计器配置
 *
 * 与 bpm/form/editor 共用同一个配置工厂 —— 改造前两处各维护一份近乎相同的配置，
 * 已经出现漂移。场景差异（本模块关掉 AI 生成字段、字段ID 改为从物理列下拉选）
 * 通过参数表达，而不是各自复制一份基线。
 */
const designerConfig = ref(
  createDesignerConfig('formDesign', {
    // 字段ID 改为从物理列里下拉选择，见 buildBaseRule
    baseRule: (arg: any) => buildBaseRule(arg)
  })
)

const designer = ref()
useFormCreateDesigner(designer)

const columnList = ref<FormDesignApi.DbColumnVO[]>([])

/**
 * 设计器里的字段
 *
 * owner 为空表示字段属于主表作用域（可映射到主表或副表）；
 * owner 有值时是它所属的子表控件 field，该字段只能映射到那张明细表的列。
 */
interface DesignerField {
  field: string
  title?: string
  type?: string
  owner?: string
}

const designerFields = ref<DesignerField[]>([])

/**
 * 字段映射：作用域内的唯一键 → { table, column }
 *
 * 键不能直接用 field —— 主表有个 remark、某张子表内部也有个 remark 是很常见的，
 * 用裸 field 做键两者会互相覆盖。这里统一用 mappingKey() 生成
 * 「子表控件field::字段field」形式的复合键，序列化时再按作用域拆回去。
 */
const fieldMapping = ref<Record<string, { table?: string; column?: string }>>({})

/** 生成作用域内唯一的映射键 */
const mappingKey = (owner: string | undefined, field: string): string =>
  owner ? `${owner}::${field}` : field

/**
 * 映射面板是否收起
 *
 * 默认收起：字段ID 现在能直接从物理列里选，选完映射自动补上，
 * 常规流程根本不需要展开这个面板，让它长期占着 320px 不合适。
 *
 * 但不能删掉 —— 见模板里的说明。收起态用角标暴露「还有几个字段没映射」，
 * 否则漏配就藏起来了，那正是这个面板存在的意义。
 */
/**
 * 映射面板是否收起
 *
 * 默认收起且【不会】自动弹出：字段ID 能直接从物理列里选，选完映射自动补上，
 * 常规流程根本不需要展开。自动弹出会在用户正拖控件时突然抢走 320px，很打断操作。
 *
 * 但面板不能删 —— 见模板里的说明。漏配的可见性由两处兜住，都不依赖面板是否展开：
 * 顶部工具条的告警按钮（点一下直接展开去处理），以及收起态竖边上的角标。
 */
const mappingCollapsed = ref(true)

/** 还没映射到物理列的字段数。展示型控件没有 field，不会进 designerFields，不计入 */
const unmappedCount = computed(
  () =>
    designerFields.value.filter((f) => !fieldMapping.value[mappingKey(f.owner, f.field)]?.column)
      .length
)

/** 可写表（主表 + 副表）。子表不在其中，它由所属控件决定归属 */
const writableTables = ref<Array<{ table: string; label: string }>>([])
/** 子表控件 field → 明细表配置 */
const subTableList = ref<Array<{ field: string; table: string }>>([])
/** 各表的列缓存，key 为表名。含主表、副表与所有子表 */
const tableColumnsMap = ref<Record<string, FormDesignApi.DbColumnVO[]>>({})

/** 取某张表的列 */
const columnsOf = (table?: string): FormDesignApi.DbColumnVO[] => {
  if (!table) return []
  return tableColumnsMap.value[table] ?? []
}

/**
 * 加载可写表清单与各表的列
 *
 * 主表与副表构成「主表作用域」，字段可以在两者之间选；
 * 子表各自独立，字段归属由所在的子表控件决定，不参与选择。
 * 三类表的列都要拉回来 —— 少拉一类，那类的映射下拉就是空的。
 */
const loadWritableTables = async () => {
  const mainTable = modelData.value.mainTable
  if (!mainTable) {
    writableTables.value = []
    subTableList.value = []
    return
  }
  const binding = parseBinding()
  const tables: Array<{ table: string; label: string }> = [
    { table: mainTable, label: `${mainTable}（主表）` }
  ]
  ;(binding.sideTables ?? []).forEach((s: any) => {
    if (s?.table) {
      tables.push({ table: s.table, label: `${s.table}（副表）` })
    }
  })
  writableTables.value = tables

  subTableList.value = (binding.subTables ?? [])
    .filter((s: any) => s?.field && s?.table)
    .map((s: any) => ({ field: s.field, table: s.table }))

  // 并行拉各表的列。表名去重，同一张表不重复请求
  const dsId = modelData.value.dataSourceConfigId ?? 0
  const allTables = Array.from(
    new Set([...tables.map((t) => t.table), ...subTableList.value.map((s) => s.table)])
  )
  const results = await Promise.all(
    allTables.map((table) =>
      FormDesignApi.getTableColumns(dsId, table).then((cols) => [table, cols] as const)
    )
  )
  tableColumnsMap.value = Object.fromEntries(results)
  // 主表的列同时给「一键生成」等既有逻辑用
  columnList.value = tableColumnsMap.value[mainTable] ?? []

  // 列变了，字段ID 的下拉选项要跟着重建
  rebuildFieldOptions()
}

/** 解析 tableBinding，解析失败返回空对象而不是让调用方崩掉 */
const parseBinding = (): any => {
  try {
    return modelData.value.tableBinding ? JSON.parse(modelData.value.tableBinding) : {}
  } catch {
    return {}
  }
}

/**
 * 映射侧栏的分组视图
 *
 * 主表作用域一组，每个子表控件各一组。分组是必要的而不只是好看 ——
 * 子表字段能选的列来自明细表，与主表的列完全不同，混在一个平铺列表里
 * 用户根本分不清哪个字段该配哪张表的列。
 */
const mappingGroups = computed(() => {
  const groups: Array<{
    key: string
    label: string
    owner?: string
    table?: string
    fields: DesignerField[]
  }> = []

  const mainFields = designerFields.value.filter((f) => !f.owner)
  if (mainFields.length > 0) {
    groups.push({
      key: '__main__',
      label: writableTables.value.length > 1 ? '主表 / 副表字段' : '主表字段',
      table: modelData.value.mainTable,
      fields: mainFields
    })
  }

  // 按设计器里出现的子表控件分组，而不是按配置里的子表 ——
  // 控件已删但配置还在的情况要能看出来，否则用户不知道配置成了孤儿
  const owners = Array.from(
    new Set(designerFields.value.filter((f) => f.owner).map((f) => f.owner as string))
  )
  owners.forEach((owner) => {
    const bound = subTableList.value.find((s) => s.field === owner)
    groups.push({
      key: owner,
      label: `子表：${owner}`,
      owner,
      table: bound?.table,
      fields: designerFields.value.filter((f) => f.owner === owner)
    })
  })
  return groups
})

/** 取某个分组内某字段的映射配置 */
const mappingOf = (group: { owner?: string }, field: DesignerField) =>
  fieldMapping.value[mappingKey(group.owner, field.field)]

/**
 * 构建「字段ID」下拉的可选项
 *
 * 设计器默认把字段ID渲染成自由输入框，手输列名极易拼错，而且错了要等到发布校验
 * 甚至运行时才报出来。这里改成从物理列里选。
 *
 * 选项随「当前正在编辑哪个控件」变化：编辑子表控件内部的字段时，只能选那张明细表的列；
 * 否则给主表与副表的列。混在一起给会让用户把明细字段配到主表列上。
 *
 * ⚠️ 直接原地改数组而不是整个替换，这样已经交给设计器的规则对象能保持同一个引用，
 * Vue 的响应式会把新选项推到面板上；重建规则会打断用户正在进行的编辑。
 */
/**
 * 字段ID 下拉的选项树
 *
 * 两层：第一层是表（不可选，只做分组），第二层是该表的物理列。
 * 之所以不用平铺列表：主表往往几十列，再加上几张副表，铺成一条长列表既看不出
 * 某一列属于哪张表，也没法把不关心的表折叠掉。
 *
 * ⚠️ 原地改数组而不是整个替换：规则对象已经交给设计器了，保持同一个引用
 * 才能让新选项被响应式推到面板上；重建规则会打断用户正在进行的编辑。
 */
interface FieldOptionNode {
  value: string
  label: string
  disabled?: boolean
  children?: FieldOptionNode[]
}

const fieldOptions = reactive<FieldOptionNode[]>([])

/** 表分组节点的 value 前缀，避免与任何列生成的字段名撞上 */
const TABLE_NODE_PREFIX = '__table__:'

/**
 * 「作用域内字段名 → 物理列」的全量索引，供选完自动补映射
 *
 * 覆盖所有作用域而不是只覆盖当前激活的那个：自动补映射是对整棵规则树做的，
 * 只留当前作用域会让另一侧的字段补不上，表现为「有时补有时不补」。
 * 键用 mappingKey，因为主表的 name 和某张明细表里的 name 是两个不同的东西。
 */
const fieldOptionMeta = new Map<string, { table: string; column: string }>()

/** 某张表在某个作用域下会生成的字段名 */
const fieldNameFor = (table: string, column: string, owner?: string) =>
  owner ? column : fieldNameOf(table, column, modelData.value.mainTable)

const rebuildFieldOptions = () => {
  // 1) 全量索引：主表作用域 + 每张明细表
  fieldOptionMeta.clear()
  writableTables.value.forEach(({ table }) => {
    mappableColumnsOf(table).forEach((col) => {
      fieldOptionMeta.set(mappingKey(undefined, fieldNameFor(table, col.columnName)),
        { table, column: col.columnName })
    })
  })
  subTableList.value.forEach(({ field, table }) => {
    mappableColumnsOf(table).forEach((col) => {
      fieldOptionMeta.set(mappingKey(field, col.columnName), { table, column: col.columnName })
    })
  })

  // 2) 下拉只给当前作用域的列，并按表分组成两层树
  const owner = activeSubTableField.value
  const scoped: Array<{ table: string; label: string }> = owner
    ? subTableList.value
        .filter((s) => s.field === owner)
        .map((s) => ({ table: s.table, label: `${s.table}（明细）` }))
    : writableTables.value

  // 表节点带前缀，保证不会与任何列生成的字段名撞上 —— 撞上会让选中态错乱
  const next: FieldOptionNode[] = scoped.map(({ table, label: tableLabel }) => {
    const columns = mappableColumnsOf(table)
    return {
      value: `${TABLE_NODE_PREFIX}${table}`,
      label: `${tableLabel}（${columns.length} 列）`,
      // 表节点只是分组，不能被选中
      disabled: true,
      children: columns.map((col) => ({
        value: fieldNameFor(table, col.columnName, owner),
        label: col.columnComment ? `${col.columnName}（${col.columnComment}）` : col.columnName
      }))
    }
  })
  fieldOptions.splice(0, fieldOptions.length, ...next)
}

/**
 * 当前激活控件所属的子表控件 field
 *
 * undefined 表示它在主表作用域（顶层，或只是被栅格之类的布局容器包着）。
 */
const activeSubTableField = ref<string | undefined>(undefined)

/** 在规则树里定位某个控件，返回它所属的子表控件 field */
const findOwnerOf = (rules: any[], targetId: any, owner?: string): { hit: boolean; owner?: string } => {
  for (const rule of rules) {
    if (!rule || typeof rule !== 'object') continue
    if (rule._fc_id && rule._fc_id === targetId) {
      return { hit: true, owner }
    }
    if (Array.isArray(rule.children)) {
      const r = findOwnerOf(rule.children, targetId, owner)
      if (r.hit) return r
    }
    if (rule.type === SUB_TABLE_WIDGET_TYPE && Array.isArray(rule.props?.rule)) {
      const r = findOwnerOf(rule.props.rule, targetId, rule.field)
      if (r.hit) return r
    }
  }
  return { hit: false }
}

const syncActiveScope = () => {
  const active = designer.value?.activeRule
  if (!active?._fc_id) {
    activeSubTableField.value = undefined
  } else {
    activeSubTableField.value = findOwnerOf(designer.value?.getRule?.() || [], active._fc_id).owner
  }
  rebuildFieldOptions()
}

/**
 * 基础属性面板的规则
 *
 * 用设计器支持的 config.baseRule 钩子整体替换默认规则，只把「字段ID」从
 * FieldInput 换成下拉选择，其余项按默认样子重建。
 *
 * ⚠️ 这是对设计器默认基础规则的一份复刻（@form-create/designer 3.4.0）。
 * 该钩子只支持整体替换或前后追加，没有「只改其中一项」的模式，所以必须重建全部。
 * 升级设计器时如果默认基础项有增减，这里要跟着补 —— 少一项的后果是那个属性
 * 在面板上消失，界面上看得出来，不会静默出错。
 */
const buildBaseRule = ({ t }: any) => [
  {
    // 自带的 FieldInput 是自由输入框。DbFieldSelect 换成从物理列下拉选，
    // 但原样保留了它的三重校验（非空 / 字母开头 / 同作用域不重名）——
    // 重名那条尤其不能丢：form-create 按 field 取值，两个控件同名会互相覆盖且毫无提示
    type: 'DbFieldSelect',
    field: 'field',
    value: '',
    title: t('form.field'),
    warning: t('warning.field'),
    props: {
      options: fieldOptions,
      placeholder: '选择数据库字段，或输入自定义字段名'
    }
  },
  { type: 'LanguageInput', field: 'title', value: '', title: t('form.title') },
  { type: 'LanguageInput', field: 'info', value: '', title: t('form.info') },
  { type: 'SizeInput', field: 'formCreateWrap>labelWidth', value: '', title: t('form.labelWidth') },
  {
    type: 'Struct',
    field: '_control',
    name: 'control',
    value: [],
    title: t('form.control'),
    props: {
      defaultValue: [],
      validate(val: any) {
        if (!Array.isArray(val)) return false
        if (!val.length) return true
        return !val.some(({ rule }: any) => !Array.isArray(rule))
      }
    }
  }
]

/**
 * 保留列黑名单：不允许在字段映射里选择
 *
 * tenant_id：本模块 @TenantIgnore 不分租户，运行时不会自动填。让用户手填租户 ID
 * 会造成跨租户数据污染，风险太大，直接不给选。
 */
const RESERVED_COLUMNS = ['tenant_id']

/**
 * 可供映射的物理列（按表）
 *
 * 过滤掉两类列：
 * 1. 黑名单列（tenant_id）
 * 2. 已配置为「系统自动填充」的审计列 —— 后端会写它，表单再映射一次会导致
 *    同一列在 INSERT 里出现两次，MySQL 直接报错。发布校验也会拦，
 *    但在下拉里就不给选，比发布时才报错体验好。
 *
 * 审计列只在主表上过滤 —— autoFill 配置是主表的。
 */
const mappableColumnsOf = (table?: string): FormDesignApi.DbColumnVO[] => {
  const cols = columnsOf(table || modelData.value.mainTable)
  const isMainTable = !table || table === modelData.value.mainTable
  const autoColumns = isMainTable ? resolveAutoFillColumns() : []
  return cols.filter(
    (col) => !RESERVED_COLUMNS.includes(col.columnName) && !autoColumns.includes(col.columnName)
  )
}

/** 切换某字段映射到哪张表。换表后原来的列不再有效，清掉 */
const handleMappingTableChange = (
  group: { owner?: string },
  field: DesignerField,
  table: string
) => {
  fieldMapping.value[mappingKey(group.owner, field.field)] = { table, column: undefined }
}

/** 选择某字段映射到哪一列 */
const handleMappingColumnChange = (
  group: { owner?: string; table?: string },
  field: DesignerField,
  column?: string
) => {
  const key = mappingKey(group.owner, field.field)
  // 子表字段的表由控件归属固定；主表作用域下沿用已选的表，默认主表
  const table = group.owner
    ? group.table
    : fieldMapping.value[key]?.table || modelData.value.mainTable
  fieldMapping.value[key] = { table, column }
}

/**
 * 从 tableBinding 里取出「系统自动填充」模式的审计列
 *
 * mode 缺失时按 AUTO 处理，与后端 AutoFillModeEnum.parse 的回退保持一致。
 */
const resolveAutoFillColumns = (): string[] => {
  const af = parseBinding().autoFill
  if (!af) return []
  const pairs: [string, string][] = [
    [af.creatorColumn, af.creatorMode],
    [af.createTimeColumn, af.createTimeMode],
    [af.updaterColumn, af.updaterMode],
    [af.updateTimeColumn, af.updateTimeMode]
  ]
  return pairs
    .filter(([column, mode]) => column && (mode ?? 'AUTO') === 'AUTO')
    .map(([column]) => column)
}

/** 读取设计器当前的字段列表 */
const handleRefreshFields = () => {
  const rules = designer.value?.getRule?.() || []
  designerFields.value = flattenRules(rules)
  autoFillMappingFromFieldName()
}

/**
 * 字段ID 选自物理列时，顺带把映射也补上
 *
 * 不这么做的话用户要录两遍：先在设计器里选一次列，再到右侧映射侧栏把同一列
 * 又选一次。既然字段ID 已经明确指向某一列，映射就没有第二种合理答案。
 *
 * 只补空缺，不覆盖已有映射 —— 用户可能刻意把字段映射到了另一列。
 */
const autoFillMappingFromFieldName = () => {
  designerFields.value.forEach((f) => {
    const key = mappingKey(f.owner, f.field)
    if (fieldMapping.value[key]?.column) return
    const meta = fieldOptionMeta.get(key)
    if (!meta) return
    fieldMapping.value[key] = { table: meta.table, column: meta.column }
  })
}

/**
 * 递归展开规则树
 *
 * 两类嵌套要分别处理：
 * 1. 布局控件（栅格 / 标签页 / 折叠面板）把子控件放在 children 里，
 *    它们与外层控件同属一个作用域，字段归属不变
 * 2. 子表控件（type = group）把内部规则放在 props.rule 里，
 *    这些字段属于明细表，作用域是【该控件本身】
 *
 * 漏掉第 2 条正是子表明细读写不通的根因：子表内部字段扫不出来，
 * 就永远配不上物理列，后端拿到的 fieldMapping 是空的，
 * 明细字段既存不进去也查不出来 —— 而且全程不报错。
 */
const flattenRules = (rules: any[]): DesignerField[] => {
  const result: DesignerField[] = []
  const walk = (list: any[], owner?: string) => {
    list.forEach((rule) => {
      if (!rule || typeof rule !== 'object') return
      const innerRules = rule.props?.rule
      const isSubTable = rule.type === SUB_TABLE_WIDGET_TYPE && Array.isArray(innerRules)

      // 子表控件自身是个容器，它的 field 用来定位整段明细数据，不映射到某一列
      if (rule.field && !isSubTable) {
        result.push({ field: rule.field, title: rule.title, type: rule.type, owner })
      }
      if (Array.isArray(rule.children)) {
        walk(rule.children, owner)
      }
      if (isSubTable && rule.field) {
        // 嵌套子表（子表里再放子表）后端不支持，只取第一层，避免生成配不上的字段
        if (owner) {
          console.warn(`子表控件 ${rule.field} 嵌套在子表 ${owner} 内，本模块不支持多级明细，已忽略`)
          return
        }
        walk(innerRules, rule.field)
      }
    })
  }
  walk(rules)
  return result
}

/**
 * 从物理列一键生成表单字段
 *
 * 覆盖主表与所有副表：按列类型推荐控件，主键与审计列自动跳过。
 *
 * 字段命名遵循 fieldNaming 的约定 —— 主表字段直接用列名（后端 SELECT 不加 AS，
 * 结果 key 天然就是 field），副表字段用 yd_表名_yd_列名（后端 AS 还原），
 * 这样主副表的同名列不会互相覆盖。
 *
 * ⚠️ 已有的子表控件会原样保留：它们的内部规则是用户手工设计的，
 * 而本功能只能从主表/副表的列推断字段。原实现直接 setRule 全量覆盖，
 * 用户配好子表后点一下「一键生成」，整个子表控件连同映射一起消失。
 */
const handleGenerateFromColumns = async () => {
  if (writableTables.value.length === 0) {
    await loadWritableTables()
  }
  if (writableTables.value.length === 0) {
    message.warning('请先在上一步绑定主表')
    return
  }
  const skipColumns = ['creator', 'create_time', 'updater', 'update_time', 'deleted', 'tenant_id']
  const mainTable = modelData.value.mainTable

  // 先摘出已有的子表控件，生成完再接回去
  const existingRules: any[] = designer.value?.getRule?.() || []
  const keptSubTableRules = collectSubTableRules(existingRules)

  const rules: any[] = []
  const mapping: Record<string, { table?: string; column?: string }> = {}

  writableTables.value.forEach(({ table }) => {
    columnsOf(table)
      .filter((col) => !col.primaryKey && !skipColumns.includes(col.columnName))
      // 副表的外键由后端自动填，不该出现在表单里
      .filter((col) => !isSideForeignKey(table, col.columnName))
      .forEach((col) => {
        const field = fieldNameOf(table, col.columnName, mainTable)
        rules.push(buildRuleFromColumn(col, field, table === mainTable ? '' : table))
        mapping[field] = { table, column: col.columnName }
      })
  })

  if (rules.length === 0 && keptSubTableRules.length === 0) {
    message.warning('没有可生成的列')
    return
  }

  // 保留子表字段原有的映射，只重置主表作用域的
  Object.entries(fieldMapping.value).forEach(([key, cfg]) => {
    if (key.includes('::')) {
      mapping[key] = cfg
    }
  })

  designer.value?.setRule?.([...rules, ...keptSubTableRules])
  fieldMapping.value = mapping
  handleRefreshFields()
  const keptTip = keptSubTableRules.length > 0 ? `，保留了 ${keptSubTableRules.length} 个子表控件` : ''
  message.success(`已生成 ${rules.length} 个字段${keptTip}`)
}

/** 从规则树里摘出顶层的子表控件，用于「一键生成」时保留 */
const collectSubTableRules = (rules: any[]): any[] => {
  const result: any[] = []
  const walk = (list: any[]) => {
    list.forEach((rule) => {
      if (!rule || typeof rule !== 'object') return
      if (rule.type === SUB_TABLE_WIDGET_TYPE && Array.isArray(rule.props?.rule)) {
        result.push(rule)
        return // 不再深入，整棵子表控件原样保留
      }
      if (Array.isArray(rule.children)) {
        walk(rule.children)
      }
    })
  }
  walk(rules)
  return result
}

/** 判断某列是否为副表的外键（外键由后端填，不进表单） */
const isSideForeignKey = (table: string, column: string): boolean =>
  (parseBinding().sideTables ?? []).some(
    (s: any) => s?.table === table && s?.foreignKey === column
  )

/**
 * 按列的 Java 类型推荐控件
 *
 * @param field      表单字段名。主表为列名，副表为 yd_表名_yd_列名
 * @param tableLabel 副表时在标题后标注表名，便于用户区分同名列
 */
const buildRuleFromColumn = (col: FormDesignApi.DbColumnVO, field: string, tableLabel = '') => {
  const title = (col.columnComment || col.columnName) + (tableLabel ? `（${tableLabel}）` : '')
  const base = { field, title, $required: !col.nullable }
  switch (col.javaType) {
    case 'Integer':
    case 'Long':
    case 'BigDecimal':
      return { ...base, type: 'inputNumber' }
    case 'LocalDateTime':
    case 'Date':
      return { ...base, type: 'datePicker', props: { type: 'datetime' } }
    case 'Boolean':
      return { ...base, type: 'switch' }
    default:
      return { ...base, type: 'input' }
  }
}

/** 供父组件保存前调用：把设计器产物写回 modelData */
const collect = () => {
  if (!designer.value) return
  modelData.value.formConf = encodeConf(designer)
  modelData.value.formFields = encodeFields(designer)
  // 必须先同步字段清单：映射是按设计器当前字段逐个落盘的，
  // 用户拖完控件直接点下一步（没点「刷新字段」）时，清单是旧的，新字段的映射会漏写
  handleRefreshFields()
  // 字段映射写进 tableBinding，不污染 form-create 的 rule
  mergeFieldMappingIntoBinding()
}

/**
 * 把字段映射合并进 tableBinding
 *
 * 映射关系单独存放，避免污染 form-create 的 rule 结构（升级易冲突）。
 * 三个去处，缺一不可：
 * - 主表字段 → 顶层 fieldMapping
 * - 副表字段 → 对应 sideTables[].fieldMapping
 * - 子表字段 → 对应 subTables[].fieldMapping
 *
 * 最后一条原来完全没写，是「发布后子表数据后端未返回」的根因：
 * subTables[].fieldMapping 永远是空对象，后端读写两侧都只剩主键与外键。
 */
const mergeFieldMappingIntoBinding = () => {
  const binding = parseBinding()
  const mainTable = modelData.value.mainTable

  const mainMapping: Record<string, any> = {}
  // 副表映射按表名归集，子表映射按控件 field 归集
  const sideMappings: Record<string, Record<string, any>> = {}
  const subMappings: Record<string, Record<string, any>> = {}

  designerFields.value.forEach((f) => {
    const cfg = fieldMapping.value[mappingKey(f.owner, f.field)]
    if (!cfg?.column) return

    if (f.owner) {
      // 子表字段：表由控件归属决定，忽略 cfg.table 里可能残留的旧值
      const bound = subTableList.value.find((s) => s.field === f.owner)
      if (!bound) return // 控件还没绑定明细表，跳过
      subMappings[f.owner] = subMappings[f.owner] ?? {}
      subMappings[f.owner][f.field] = buildMappingEntry(bound.table, cfg.column)
      return
    }

    const table = cfg.table || mainTable
    const entry = buildMappingEntry(table, cfg.column)
    if (table === mainTable) {
      mainMapping[f.field] = entry
    } else {
      sideMappings[table] = sideMappings[table] ?? {}
      sideMappings[table][f.field] = entry
    }
  })

  binding.fieldMapping = mainMapping
  if (Array.isArray(binding.sideTables)) {
    binding.sideTables = binding.sideTables.map((s: any) => ({
      ...s,
      fieldMapping: sideMappings[s.table] ?? {}
    }))
  }
  if (Array.isArray(binding.subTables)) {
    binding.subTables = binding.subTables.map((s: any) => {
      const mapping = subMappings[s.field] ?? {}
      return {
        ...s,
        fieldMapping: mapping,
        // 明细行的审计列自动探测，与主表同一套约定名。
        // 排除已被表单映射占用的列，否则 INSERT 会把同一列拼两次
        autoFill: detectAutoFillFor(s.table, Object.values(mapping).map((m: any) => m?.column))
      }
    })
  }
  modelData.value.tableBinding = JSON.stringify(binding)
}

/** 组装一条映射记录，带上 jdbcType 供后端绑参用 */
const buildMappingEntry = (table: string, column: string) => {
  const col = columnsOf(table).find((c) => c.columnName === column)
  return { table, column, jdbcType: col?.jdbcType }
}

/**
 * 为明细表探测审计列
 *
 * 明细行原本从不填 creator / create_time，查明细「谁什么时候加的」无从追溯。
 * 按与主表相同的约定名匹配真实列，匹配不到就留空（该表没有这一列，跳过填充）。
 *
 * @param mappedColumns 已被表单字段占用的列，要排除 ——
 *                      同一列既自动填充又在表单里映射，INSERT 会拼两次导致 SQL 报错
 */
const detectAutoFillFor = (table: string, mappedColumns: Array<string | undefined>) => {
  const real = columnsOf(table).map((c) => c.columnName)
  const taken = new Set(mappedColumns.filter(Boolean) as string[])
  const pick = (patterns: string[]) =>
    patterns.find((p) => real.includes(p) && !taken.has(p)) ?? ''
  return {
    creatorColumn: pick(AUDIT_COLUMN_PATTERNS.creatorColumn),
    creatorMode: 'AUTO',
    createTimeColumn: pick(AUDIT_COLUMN_PATTERNS.createTimeColumn),
    createTimeMode: 'AUTO',
    updaterColumn: pick(AUDIT_COLUMN_PATTERNS.updaterColumn),
    updaterMode: 'AUTO',
    updateTimeColumn: pick(AUDIT_COLUMN_PATTERNS.updateTimeColumn),
    updateTimeMode: 'AUTO'
  }
}

/**
 * 审计列的约定名模式
 *
 * 与「数据绑定」步骤的主表探测共用同一套约定，两处必须一致 ——
 * 主子表用不同的规则会让用户困惑于「为什么主表填了明细没填」。
 */
const AUDIT_COLUMN_PATTERNS: Record<string, string[]> = {
  creatorColumn: ['creator', 'create_by', 'created_by'],
  createTimeColumn: ['create_time', 'created_at', 'gmt_create'],
  updaterColumn: ['updater', 'update_by', 'updated_by'],
  updateTimeColumn: ['update_time', 'updated_at', 'gmt_modified']
}

/** 回显已保存的设计产物与映射 */
const restore = async () => {
  if (modelData.value.formConf && modelData.value.formFields?.length) {
    setConfAndFields(designer, modelData.value.formConf, modelData.value.formFields)
  }
  // 先加载表与列，再回显映射 —— mappingGroups 要靠 subTableList 判断字段归属
  await loadWritableTables()
  // 等设计器把规则渲染进去，否则 getRule 拿到的还是空数组
  await nextTick()
  handleRefreshFields()

  const binding = parseBinding()
  const mapping: Record<string, any> = {}
  // 主表映射
  Object.entries(binding.fieldMapping || {}).forEach(([field, cfg]: [string, any]) => {
    mapping[field] = { table: cfg?.table || modelData.value.mainTable, column: cfg?.column }
  })
  // 副表映射
  ;(binding.sideTables ?? []).forEach((s: any) => {
    Object.entries(s.fieldMapping || {}).forEach(([field, cfg]: [string, any]) => {
      mapping[field] = { table: s.table, column: cfg?.column }
    })
  })
  // 子表映射：键要带控件前缀，与 mappingKey() 保持一致
  ;(binding.subTables ?? []).forEach((s: any) => {
    if (!s?.field) return
    Object.entries(s.fieldMapping || {}).forEach(([field, cfg]: [string, any]) => {
      mapping[mappingKey(s.field, field)] = { table: s.table, column: cfg?.column }
    })
  })
  fieldMapping.value = mapping
}

const validate = async () => {
  collect()
  return true
}

defineExpose({ validate, collect })

/**
 * 回显时机
 *
 * 不能放在 onMounted —— 本组件被父组件 v-show 控制，父组件挂载时它就一起挂载了，
 * 那时父组件的异步 loadData() 还没返回，formConf 是 undefined，设计区会一片空白。
 * 统一用 useStepRestore 监听数据到达的时刻，三个步骤组件保持一致。
 */
useStepRestore(modelData, restore, (data) => [data.formConf])

/**
 * 表绑定变化时重新加载表与列
 *
 * 四个步骤是被父组件用 v-show 控制的，本组件在页面挂载时就已经 onMounted 过了 ——
 * 那时用户还没走到「数据绑定」步骤，主表与子表都是空的。
 * 不监听的话，用户配完子表切过来，映射侧栏里根本不会出现子表分组。
 *
 * 只对「表的构成」求签名，不监听整个 tableBinding：
 * mergeFieldMappingIntoBinding 每次收集都会重写 tableBinding，
 * 监听全量会造成「保存映射 → 重新拉列 → 再次触发」的循环。
 */
const bindingSignature = computed(() => {
  const binding = parseBinding()
  const tables = [
    modelData.value.mainTable,
    ...(binding.sideTables ?? []).map((s: any) => s?.table),
    ...(binding.subTables ?? []).map((s: any) => `${s?.field}:${s?.table}`)
  ]
  return `${modelData.value.dataSourceConfigId ?? 0}|${tables.join(',')}`
})

watch(bindingSignature, () => {
  loadWritableTables()
})

/**
 * 跟随当前选中的控件切换字段ID 下拉的作用域
 *
 * 选中子表控件内部的字段时，只该给那张明细表的列；选中顶层字段时给主表与副表的列。
 * 不跟随的话，用户在子表里选字段会看到一堆主表的列，配上去就是错的。
 */
watch(
  () => designer.value?.activeRule?._fc_id,
  () => syncActiveScope()
)

onMounted(async () => {
  // 加载主表、副表与子表的列，字段映射侧栏与字段ID 下拉都要用
  await loadWritableTables()
})
</script>

<style lang="scss" scoped>
.form-design-wrapper {
  display: flex;
  height: calc(100vh - 180px);
  gap: 10px;
  color: var(--el-text-color-regular);
  background-color: var(--el-bg-color-page);
}

.designer-area {
  flex: 1;
  min-width: 0;
  background-color: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
}

.mapping-area {
  width: 320px;
  flex-shrink: 0;
  padding: 12px;
  overflow-y: auto;
  background-color: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
}

/* 收起态：一条可点击的竖边，把宽度还给设计器 */
.mapping-handle {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  gap: 12px;
  align-items: center;
  width: 36px;
  padding-top: 12px;
  cursor: pointer;
  background-color: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);

  &:hover {
    color: var(--el-color-primary);
    background-color: var(--el-fill-color-light);
  }
}

/* 竖排文字，窄边里放得下 */
.mapping-handle-text {
  font-size: 13px;
  line-height: 1.2;
  writing-mode: vertical-rl;
  letter-spacing: 2px;
}

/* 角标默认会把图标挤出容器，收窄一点 */
.mapping-handle-badge :deep(.el-badge__content) {
  transform: translateY(-50%) translateX(60%);
}

.mapping-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.mapping-title {
  font-size: 15px;
  font-weight: bold;
}

.mapping-item {
  padding: 8px 0;
  border-bottom: 1px solid var(--el-border-color-extra-light);
}

/* 按归属分组：主表/副表一组，每张子表一组 */
.mapping-group + .mapping-group {
  margin-top: 16px;
}

.mapping-group-title {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 6px 8px;
  margin-bottom: 4px;
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  background-color: var(--el-fill-color-light);
  border-radius: 4px;
}

.mapping-group-table {
  font-family: var(--el-font-family-monospace, monospace);
  font-size: 12px;
  font-weight: normal;
  color: var(--el-text-color-secondary);
}

.mapping-field {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 4px;
}

.field-title {
  font-size: 13px;
}

.field-name {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
