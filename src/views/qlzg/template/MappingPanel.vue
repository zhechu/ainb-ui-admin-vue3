<template>
  <el-table class="xpy-list-table" stripe :data="rows" size="small" :row-class-name="rowClassName">
    <el-table-column label="序号" type="index" width="44" align="center" />
    <el-table-column label="占位符（原文）" min-width="200">
      <template #default="scope">
        <code class="placeholder-src">{{ scope.row.placeholder }}</code>
        <el-tag size="small" class="ml-6px">{{ signLabel(scope.row.sign) }}</el-tag>
        <el-tag v-if="(scope.row.occurrences ?? 0) > 1" size="small" type="warning" class="ml-6px">
          出现 {{ scope.row.occurrences }} 次
        </el-tag>
        <div class="form-hint">{{ scope.row.location }}</div>
      </template>
    </el-table-column>
    <el-table-column label="绑定字段" min-width="220">
      <template #default="scope">
        <el-select
          v-model="scope.row.fieldKey"
          placeholder="未映射"
          clearable
          filterable
          allow-create
          default-first-option
          :disabled="readonly"
          class="w-full"
        >
          <el-option-group
            v-for="group in fieldKeyGroups"
            :key="group.label"
            :label="group.label"
          >
            <el-option
              v-for="item in group.options"
              :key="item.key"
              :label="`${item.label}（${item.key}）`"
              :value="item.key"
            />
          </el-option-group>
        </el-select>
        <!--
          🔴 备选给的是**后端按相似度算出来**的那几个，点一下就绑上。
             未映射的行也有备选（后端刻意给的），所以「这一处该绑什么」
             大多数时候不用自己想
        -->
        <div v-if="(scope.row.candidates ?? []).length > 0" class="candidate-row">
          <span class="form-hint">备选：</span>
          <el-link
            v-for="cand in scope.row.candidates"
            :key="cand"
            type="primary"
            :underline="false"
            class="candidate-link"
            @click="pickCandidate(scope.row, cand)"
          >
            {{ labelOfKey(cand) }}
          </el-link>
        </div>
      </template>
    </el-table-column>
    <el-table-column label="怎么绑上的" width="150" align="center">
      <template #default="scope">
        <span>{{ scope.row.boundByDescription || scope.row.boundBy || '—' }}</span>
        <!--
          🔴 `needsConfirmation` 由后端按枚举判，前端不要自己比 boundBy。
             比的话就是第二份真相，而枚举哪天加一档，前端这一份不会跟着加
        -->
        <div v-if="scope.row.needsConfirmation">
          <el-tag v-if="scope.row.confirmed" type="success" size="small">已确认</el-tag>
          <el-button
            v-else
            link
            type="warning"
            size="small"
            :disabled="readonly"
            @click="toggleConfirm(scope.row)"
          >
            点一次确认
          </el-button>
        </div>
      </template>
    </el-table-column>
    <el-table-column label="未映射原因" min-width="200">
      <template #default="scope">
        <el-input
          v-model="scope.row.unmappedReason"
          type="textarea"
          :rows="2"
          maxlength="200"
          show-word-limit
          :disabled="readonly || !!scope.row.fieldKey"
          :placeholder="scope.row.fieldKey ? '已绑定，不需要原因' : '这一处为什么留空'"
        />
      </template>
    </el-table-column>
    <el-table-column label="渲染器" width="230">
      <template #default="scope">
        <el-tag v-if="scope.row.rendererVisible === false" type="danger" size="small">
          认不出来，会原样印在纸上
        </el-tag>
        <el-tag v-else type="success" size="small">认得</el-tag>
        <div v-for="d in scope.row.diagnostics ?? []" :key="d" class="diag">{{ d }}</div>
        <div v-if="scope.row.suggestion" class="form-hint">
          建议改成：<code class="placeholder-src">{{ scope.row.suggestion }}</code>
          <!--
            🔴 平台**不代改** docx，所以这里只给建议、不给「一键修复」。
               代改的话评估师手里那份 Word 与库里那份就不一致了，
               下一次他上传自己改过的版本会把平台的修改整个覆盖掉，
               而他不知道覆盖掉了什么
          -->
          <div>在 Word 里改这一处，然后重新上传（平台不代改文件）</div>
        </div>
      </template>
    </el-table-column>
    <template #empty>
      <el-empty description="这份 docx 里没有解析出占位符">
        <div class="form-hint">
          占位符要写成双花括号包住字段键（例如 building_area）。
          如果 Word 里确实一个都没有，那这份模板渲染出来会是一份纯静态文档，
          出报告时所有字段都不会自动填。
        </div>
      </el-empty>
    </template>
  </el-table>
</template>
<script lang="ts" setup>
import type { QlzgTemplateSuggestionVO } from '@/api/qlzg/template'
import { PARAM_SCOPE_OPTIONS, labelOf } from '@/views/qlzg/constants'
import { signLabel, type MappingBaseline } from './templateFlow'

/**
 * 占位符映射面板
 *
 * <h3>🔴 这个组件**直接改父组件传进来的那个数组的元素属性**&lt;/h3&gt;
 * 不是 `v-model`、也不做深拷贝。理由：
 * ① 一张四十页文档能解析出上百行、每行四五个可编辑单元，
 *    每次敲一个字就 `emit('update:modelValue', 深拷贝整张表)` 的代价是看得见的卡顿；
 * ② 深拷贝 + watch 同步是双向的，`baseline` 又要跟着刷新，
 *    三者互相触发的环路很难推理，而它坏掉的表现是「改一行、另一行自己变回去了」。
 * Vue 只禁止**重新赋值 prop 本身**，改它内部对象的属性是允许的、也是响应式的。
 * 🔴 代价是「谁改了这份数据」不明显，所以父组件必须自己持有
 *    `suggestions` 与 `baseline` 两个 ref，并且只在拿到新的解析结果时整体替换它们。
 *
 * <h3>🔴 `readonly` 不是权限判断，是「这一份不可编辑」&lt;/h3&gt;
 * 平台公共模板进设计器时是 readonly（后端对公共模板的上传抛
 * `TEMPLATE_PLATFORM_NOT_EDITABLE`），此时把每一格都 disable 掉
 * 比让人改完再报错好：改完点保存、后端 403、他以为是自己没权限，
 * 转去翻授权页，而真正该点的是台账上那个「复制为机构模板」。
 */
defineOptions({ name: 'QlzgTemplateMappingPanel' })

const props = defineProps<{
  rows: QlzgTemplateSuggestionVO[]
  baseline: MappingBaseline
  fieldKeyOptions: { key: string; label: string; scope: string }[]
  readonly?: boolean
}>()

/** 灰掉那些「现在这样一定过不了闸 B」的行，让人一眼看见要改哪几处 */
const rowClassName = ({ row }: { row: QlzgTemplateSuggestionVO }) => {
  if (row.rendererVisible === false) return 'row-broken'
  if (!row.fieldKey && !row.unmappedReason) return 'row-broken'
  if (row.needsConfirmation && row.confirmed !== true) return 'row-pending'
  return ''
}

const fieldKeyGroups = computed(() => {
  const byScope = new Map<string, { key: string; label: string }[]>()
  for (const item of props.fieldKeyOptions) {
    const scopeLabel = scopeLabelOf(item.scope)
    const bucket = byScope.get(scopeLabel) ?? []
    bucket.push({ key: item.key, label: item.label })
    byScope.set(scopeLabel, bucket)
  }
  return [...byScope.entries()].map(([label, options]) => ({ label, options }))
})

/**
 * 🔴 `SECTION` 那一档**不在** `PARAM_SCOPE_OPTIONS` 里，要单独认
 *
 * 它是 `mergeSectionFieldKeys` 追加进来的第四种来源（章节树声明的字段键），
 * 而 `PARAM_SCOPE_OPTIONS` 刻意由后端的 `QlzgParamScopeEnum` 派生 ——
 * 往那份里塞一个 `SECTION` 等于让参数库页面也多出一个根本不存在的「作用域」。
 * 落到 `'其他'` 也不对：那一组里装的是**有出处**的键，
 * 而「其他」读起来像「不知道是什么」，评估师会不敢选。
 */
const scopeLabelOf = (scope: string) => {
  if (scope === 'SECTION') return '章节字段'
  return labelOf(PARAM_SCOPE_OPTIONS, scope) || '其他'
}

const labelOfKey = (key: string) =>
  props.fieldKeyOptions.find((item) => item.key === key)?.label ?? key

const pickCandidate = (row: QlzgTemplateSuggestionVO, key: string) => {
  if (props.readonly) return
  row.fieldKey = key
}

/**
 * 确认 / 撤销确认
 *
 * 🔴 只翻 `confirmed` 这一个标记，**不动** `boundBy`。
 *    「我认可平台按相似度猜的这个绑定」与「这个绑定是我人工指定的」
 *    在档案里是两件事，§11.17.3 第 ① 条的自动映射率就是按后者算的。
 *    真正把它改写成 MANUAL 的动作是「换一个字段键」，那在绑定下拉里发生
 */
const toggleConfirm = (row: QlzgTemplateSuggestionVO) => {
  row.confirmed = row.confirmed !== true
}
</script>
<style lang="scss" scoped>
.placeholder-src {
  padding: 1px 4px;
  font-family: var(--el-font-family-mono, monospace);
  font-size: 12px;
  background: var(--el-fill-color-light);
  border-radius: 2px;
}

.form-hint {
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}

.candidate-row {
  margin-top: 4px;
  line-height: 1.8;
}

.candidate-link {
  margin-right: 10px;
  font-size: 12px;
}

.diag {
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-color-danger);
}

:deep(.el-table .row-broken) {
  --el-table-tr-bg-color: var(--el-color-danger-light-9);
}

:deep(.el-table .row-pending) {
  --el-table-tr-bg-color: var(--el-color-warning-light-9);
}
</style>
