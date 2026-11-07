<template>
  <ContentWrap>
    <el-form class="-mb-15px" :inline="true" label-width="112px">
      <el-form-item label="业务对象">
        <el-select v-model="entityType" class="!w-240px" @change="getList">
          <el-option
            v-for="item in ENTITY_TYPE_OPTIONS"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="显示名称">
        <el-input v-model="keyword" placeholder="按显示名称或字段标识过滤" clearable class="!w-240px" />
      </el-form-item>
      <el-form-item>
        <el-button
          type="primary"
          plain
          @click="openForm('create')"
          v-hasPermi="['qlzg:field-def:create']"
        >
          <Icon icon="ep:plus" class="mr-5px" /> 新增字段
        </el-button>
      </el-form-item>
    </el-form>
  </ContentWrap>

  <ContentWrap>
    <el-alert type="info" :closable="false" class="mb-12px">
      <div class="text-12px leading-20px">
        这里加的字段<b>不需要发版</b>，加完立刻出现在「{{ entityLabel }}」的录入表单与详情页里，
        也会跟着台账一起导出到 Excel。
        字段<b>只能停用、不能删除</b>：30 年档案里的报告可能引用了它，删掉定义之后那些报告上的字段就成了没有名字的值。
      </div>
    </el-alert>

    <el-table class="xpy-list-table" stripe v-loading="loading" :data="filteredList">
      <el-table-column
        label="序号"
        type="index"
        width="44"
        align="center"
        class-name="col-index"
        label-class-name="col-index"
      />
      <el-table-column label="显示名称" align="center" prop="fieldLabel" min-width="150">
        <template #default="scope">
          <span>{{ scope.row.fieldLabel }}</span>
          <el-tag v-if="!scope.row.enabled" type="info" size="small" class="ml-6px">已停用</el-tag>
          <el-tag v-if="scope.row.platform" type="warning" size="small" class="ml-6px">
            平台预置
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="字段标识" align="center" prop="fieldKey" min-width="150">
        <template #default="scope">
          <span class="font-mono text-12px">{{ scope.row.fieldKey }}</span>
        </template>
      </el-table-column>
      <el-table-column label="控件" align="center" prop="widgetType" width="120">
        <template #default="scope">
          {{ scope.row.widgetLabel || widgetLabelOf(scope.row.widgetType) }}
        </template>
      </el-table-column>
      <el-table-column label="必填" align="center" prop="required" width="70">
        <template #default="scope">
          <el-tag v-if="scope.row.required" type="danger" size="small">必填</el-tag>
          <span v-else>—</span>
        </template>
      </el-table-column>
      <el-table-column label="出现位置" align="center" prop="scene" width="110">
        <template #default="scope">{{ sceneLabel(scope.row.scene) }}</template>
      </el-table-column>
      <el-table-column label="进导出" align="center" prop="exportable" width="80">
        <template #default="scope">
          <span v-if="scope.row.exportable">是</span>
          <span v-else>否</span>
        </template>
      </el-table-column>
      <el-table-column label="排序" align="center" prop="sort" width="70" />
      <el-table-column label="操作" align="center" min-width="150" fixed="right">
        <template #default="scope">
          <el-button
            link
            type="primary"
            :disabled="scope.row.platform"
            @click="openForm('update', scope.row.id)"
            v-hasPermi="['qlzg:field-def:update']"
          >
            编辑
          </el-button>
          <el-button
            link
            :type="scope.row.enabled ? 'warning' : 'success'"
            :disabled="scope.row.platform"
            @click="handleToggleEnabled(scope.row)"
            v-hasPermi="['qlzg:field-def:update']"
          >
            {{ scope.row.enabled ? '停用' : '启用' }}
          </el-button>
        </template>
      </el-table-column>
      <template #empty>
        <div class="py-24px text-13px text-[var(--el-text-color-secondary)]">
          「{{ entityLabel }}」上还没有自定义字段。点上面的「新增字段」加一个，不需要发版。
        </div>
      </template>
    </el-table>
  </ContentWrap>

  <FieldDefForm ref="formRef" @success="getList" />
</template>

<script lang="ts" setup>
import {
  QlzgFieldDefApi,
  type QlzgEntityType,
  type QlzgFieldDefVO
} from '@/api/qlzg/fieldDef'
import { getWidgetContract } from '@/components/FormWidgets/contracts'
import { EXT_FIELD_SCENES } from '@/views/qlzg/components/extFieldRule'
import { ENTITY_TYPE_OPTIONS, labelOf } from '@/views/qlzg/constants'
import FieldDefForm from './FieldDefForm.vue'

/**
 * 机构自定义扩展字段（I29-e）
 *
 * <h3>🔴 这一页**没有删除**，也**没有分页**，两者都不是漏做</h3>
 * 删除：后端一律抛 {@code FIELD_DEF_DELETE_FORBIDDEN}（§11.20.5，30 年档案里的报告
 * 可能引用了这个字段）。API 层连 {@code deleteFieldDef()} 都没建，
 * 所以这里也一个删除按钮都不画 —— 画一个「按下去必定失败」的按钮，
 * 下一个人会以为删除是支持的、只是这里没接。
 * 分页：{@code /qlzg/field-def/list} 返回的是**清单**不是分页。一个机构在一个宿主上
 * 配几十个字段已经很多了，而 {@code ext_json} 的键顺序、导出的列顺序都要靠
 * {@code sort} 全局排序，分页会把「排第几」这件事拆成两页各自 numbering。
 *
 * <h3>🔴 过滤是**本地**的，不是把 keyword 发给后端</h3>
 * 后端 {@code /list} 只认 {@code entityType} 与 {@code scene} 两个参数。
 * 前端把 {@code keyword} 也发过去的话，那一个查询条件会被静默忽略 ——
 * 表现是「搜了没用，还是全都在」，与本仓其它页面栽过的那一类坑同源。
 *
 * <h3>🔴 平台预置行的两个按钮是**灰掉**的，不是隐藏的</h3>
 * 隐藏会被理解成「这功能坏了」（§11.20.5 的 UI 纪律）。
 * 灰掉之后用户看得见这一行存在、也看得见自己动不了它，配合 {@code FieldDefForm}
 * 里那个「整行只读」的 alert，理由就说全了。
 * ⚠️ 现在库里平台预置行数是 **0**（理由写在 {@code QlzgFieldDefDO} 的类注释里），
 * 所以这一支当前走不到 —— 但它是为将来留的形状，别当死代码删掉。
 */
defineOptions({ name: 'QlzgFieldDef' })

const message = useMessage()

const loading = ref(false)
const list = ref<QlzgFieldDefVO[]>([])
const entityType = ref<QlzgEntityType>('QLZG_PROJECT')
const keyword = ref('')

const entityLabel = computed(() => labelOf(ENTITY_TYPE_OPTIONS, entityType.value))

/** 本地过滤：显示名称或字段标识，大小写不敏感 */
const filteredList = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) {
    return list.value
  }
  return list.value.filter(
    (item) =>
      item.fieldLabel?.toLowerCase().includes(kw) || item.fieldKey?.toLowerCase().includes(kw)
  )
})

const widgetLabelOf = (type: string): string => getWidgetContract(type)?.label ?? type

const sceneLabel = (scene?: string): string =>
  EXT_FIELD_SCENES.find((item) => item.value === scene)?.label ?? (scene || '表单与详情')

/** 查询字段定义清单 */
const getList = async () => {
  loading.value = true
  try {
    // 🔴 不传 scene：字段管理页要看**全部**行，含只在详情出现的
    list.value = (await QlzgFieldDefApi.getList(entityType.value)) ?? []
  } finally {
    loading.value = false
  }
}

/** 添加/修改操作 */
const formRef = ref()
const openForm = (type: string, id?: number) => {
  formRef.value.open(type, id)
}

/**
 * 启用 / 停用
 *
 * 🔴 停用的确认文案必须说清「不是删除」：管理员点「停用」时想的多半是「这个字段不要了」，
 * 而实际发生的是「表单里不再出现，但历史值还在、详情页还显示、导出还带」。
 * 不说清楚，他会以为数据被清掉了，然后来问「值怎么还在」。
 *
 * <p>⚠️ 停用一个**正被兄弟字段的校验规则引用着**的字段会被后端拒
 * （{@code FIELD_DEF_DISABLE_REFERENCED}），那句报错会说清是被谁引用的。
 * 🔴 所以这里**不预查**：预查要把全部字段的 validateRule 都摊开比对，
 * 而那份比对逻辑与后端 {@code collectRuleReferences} 会漂 ——
 * 漂了的表现是「界面说不能停、后端说能停」，或反过来。
 */
const handleToggleEnabled = async (row: QlzgFieldDefVO) => {
  const enabling = !row.enabled
  try {
    if (!enabling) {
      await message.confirm(
        `确定要停用字段「${row.fieldLabel}」吗？` +
          '停用不是删除：录入表单里不再出现，但已经填过的值仍留在库里、详情页仍显示（标注「已停用字段」）、' +
          '导出的 Excel 里也仍有这一列。停用之后不能再写新值。',
        '停用字段'
      )
    }
    await QlzgFieldDefApi.updateEnabled(row.id, enabling)
    message.success(enabling ? '已启用' : '已停用')
    await getList()
  } catch {}
}

onMounted(getList)
</script>
