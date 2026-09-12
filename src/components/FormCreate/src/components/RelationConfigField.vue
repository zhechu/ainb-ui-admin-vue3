<template>
  <div class="relation-config">
    <el-form label-width="90px" size="small">
      <el-form-item label="关联表单">
        <el-select
          v-model="targetFormCode"
          placeholder="选择一张已发布的表单"
          filterable
          clearable
          class="w-1/1"
          @change="onTargetChange"
        >
          <el-option
            v-for="f in selectableForms"
            :key="f.code"
            :label="`${f.name}（${f.code}）`"
            :value="f.code"
          />
        </el-select>
        <div class="tip">
          只列出已发布的表单 —— 未发布的没有可查询的数据，选了它发布时会被拒绝
        </div>
      </el-form-item>

      <el-form-item label="显示字段">
        <el-select
          v-model="displayField"
          placeholder="选中后输入框展示哪个字段"
          filterable
          clearable
          class="w-1/1"
          :disabled="!targetFormCode"
        >
          <el-option
            v-for="f in targetFields"
            :key="f.field"
            :label="`${f.title || f.field}（${f.field}）`"
            :value="f.field"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="展示形态">
        <el-radio-group v-model="mode">
          <el-radio-button value="select">下拉选择</el-radio-button>
          <el-radio-button value="popup">弹窗表格</el-radio-button>
        </el-radio-group>
      </el-form-item>
    </el-form>

    <!-- 带出字段映射表 -->
    <div class="mapping-section">
      <div class="mapping-head">
        <div>
          <span class="mapping-title">带出字段</span>
          <span class="tip">
            选中一条记录后，把它的字段抄到当前表单。提交时服务端会重新读一遍并覆盖，
            所以改不了
          </span>
        </div>
        <el-button
          link
          type="primary"
          size="small"
          :disabled="!targetFormCode"
          @click="addMapping"
        >
          <Icon icon="ep:plus" class="mr-3px" />
          添加
        </el-button>
      </div>

      <div v-if="mappings.length === 0" class="mapping-empty">
        {{ targetFormCode ? '还没有配置带出字段' : '请先选择关联表单' }}
      </div>

      <div v-for="(m, idx) in mappings" :key="idx" class="mapping-row">
        <el-select
          :model-value="m.sourceField"
          placeholder="来源字段"
          filterable
          size="small"
          class="flex-1"
          @update:model-value="(v) => patchMapping(idx, { sourceField: v })"
        >
          <el-option
            v-for="f in targetFields"
            :key="f.field"
            :label="`${f.title || f.field}`"
            :value="f.field"
          />
        </el-select>

        <Icon icon="ep:right" class="mapping-arrow" />

        <el-select
          :model-value="m.targetField"
          placeholder="填入本表单的"
          filterable
          size="small"
          class="flex-1"
          @update:model-value="(v) => patchMapping(idx, { targetField: v })"
        >
          <el-option
            v-for="opt in ownFieldOptions"
            :key="opt.value"
            :label="opt.label"
            :value="opt.value"
          />
        </el-select>

        <el-select
          :model-value="m.updateMode || 'ALWAYS'"
          size="small"
          @update:model-value="(v) => patchMapping(idx, { updateMode: v })"
        >
          <el-option label="每次覆盖" value="ALWAYS" />
          <el-option label="仅首次带出" value="ONCE" />
        </el-select>

        <el-button link type="danger" size="small" @click="removeMapping(idx)">
          <Icon icon="ep:delete" />
        </el-button>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import * as FormDesignApi from '@/api/infra/formDesign'
import { decodeFields } from '@/utils/formCreate'
import { collectFormFieldOptions, parseFormFields } from '@/components/FormCreate/src/utils'

defineOptions({ name: 'RelationConfigField' })

/**
 * 关联表单的配置面板
 *
 * 带出映射表在这里配，而不是让用户为每个带出字段再拖一个「关联属性」控件。
 * 后者的问题：一个带出 5 个字段的关联要拖 6 个控件、做 6 次反向绑定，
 * 而且删掉宿主之后那些属性控件会变成指向不存在控件的孤儿。
 */
const props = defineProps<{
  formCreateInject?: any
}>()

const rule = computed(() => props.formCreateInject?.rule ?? {})
const ruleProps = computed(() => {
  if (!rule.value.props) rule.value.props = {}
  return rule.value.props
})

const makeModel = <T,>(key: string, fallback: T) =>
  computed<T>({
    get: () => ruleProps.value[key] ?? fallback,
    set: (v) => (ruleProps.value[key] = v)
  })

const targetFormCode = makeModel<string>('targetFormCode', '')
const displayField = makeModel<string>('displayField', '')
const mode = makeModel<string>('mode', 'select')
const mappings = computed<any[]>(() => ruleProps.value.fieldMappings ?? [])

// ==================== 可选的关联表单 ====================

const allForms = ref<FormDesignApi.FormDesignSimpleVO[]>([])
const currentFormCode = computed(() => props.formCreateInject?.formCode ?? '')

/**
 * 可选表单
 *
 * 两条过滤：
 * - 已发布的。用 status 判断而不是 publishedVersion —— 精简列表接口只返回 status，
 *   而 status 已经够了：1 是已发布，2 是已发布有改动（线上仍有可查数据）。
 *   0 是草稿，没有运行时数据表可查，选了它发布时会被拒绝
 * - 排除自己。自引用会在带出时形成环，发布校验也会拒绝，在这里就过滤掉比让用户选完再报错好
 */
const selectableForms = computed(() =>
  allForms.value.filter(
    (f) => (f.status === 1 || f.status === 2) && f.code !== currentFormCode.value
  )
)

/** 被关联表单的字段。选了表单才去拉 */
const targetFields = ref<Array<{ field: string; title?: string }>>([])

const onTargetChange = async () => {
  // 换了关联表单，旧的显示字段与映射就都失效了 —— 它们指向另一张表单的字段
  displayField.value = ''
  ruleProps.value.fieldMappings = []
  await loadTargetFields()
}

const loadTargetFields = async () => {
  targetFields.value = []
  if (!targetFormCode.value) return
  const form = allForms.value.find((f) => f.code === targetFormCode.value)
  if (!form?.id) return
  try {
    const detail = await FormDesignApi.getFormDesign(form.id)
    const rules = decodeFields(detail.formFields ?? [])
    const collected: Array<Record<string, any>> = []
    for (const r of rules) parseFormFields(r as any, collected)
    targetFields.value = collected
      .filter((f) => f.field && !f.subTableField)
      .map((f) => ({ field: f.field, title: f.title }))
  } catch (e) {
    // 拉不到就给空列表，用户能直接看出问题；不抛出去打断属性面板
    console.error('[RelationConfigField] 拉取被关联表单的字段失败', e)
  }
}

/** 当前表单里可作为带出目标的字段。排除自己 —— 带出到自己身上没有意义 */
const ownFieldOptions = computed(() =>
  collectFormFieldOptions(
    props.formCreateInject?.designer ? { value: props.formCreateInject.designer } : undefined,
    rule.value.field
  )
)

// ==================== 映射表操作 ====================

const write = (next: any[]) => {
  ruleProps.value.fieldMappings = next
}

const addMapping = () =>
  write([...mappings.value, { sourceField: '', targetField: '', updateMode: 'ALWAYS' }])

const removeMapping = (index: number) => {
  const next = [...mappings.value]
  next.splice(index, 1)
  write(next)
}

const patchMapping = (index: number, patch: Record<string, any>) => {
  const next = [...mappings.value]
  next[index] = { ...next[index], ...patch }
  write(next)
}

onMounted(async () => {
  try {
    allForms.value = await FormDesignApi.getFormDesignSimpleList()
  } catch (e) {
    console.error('[RelationConfigField] 拉取表单列表失败', e)
  }
  await loadTargetFields()
})
</script>

<style lang="scss" scoped>
.tip {
  margin-top: 2px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--el-text-color-secondary);
}

.mapping-section {
  padding: 10px;
  margin-top: 6px;
  background: var(--el-fill-color-lighter);
  border-radius: 4px;
}

.mapping-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 8px;
}

.mapping-title {
  font-size: 13px;
  font-weight: 600;
}

.mapping-empty {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.mapping-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  margin-bottom: 8px;
}

/**
 * 三个下拉给出最小可读宽度，放不下就换行
 *
 * 这一行是渲染在 form-create 的属性面板里的，实测面板只有 260px 宽：
 * 原先两个 flex-1 的字段选择器被挤到 34px —— 框还在，但选中的字段名一个字都看不见，
 * 用户没法确认自己配的是哪一对字段。
 * 用 `flex: 1 1 140px` 给一个最小基准，窄面板下自动折成多行，宽面板下仍是一行。
 */
.mapping-row .el-select {
  flex: 1 1 140px;
  min-width: 0;
}

.mapping-arrow {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
