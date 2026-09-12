<template>
  <div class="formula-editor">
    <el-input
      v-model="expression"
      type="textarea"
      :rows="4"
      placeholder="例：SUM({明细.金额}) * 0.06&#10;字段用 {字段ID} 引用，子表字段用 {子表字段.明细字段}"
      class="expression-input"
      @input="onInput"
    />

    <!-- 解析结果：错了报错并定位，对了给预览 -->
    <div v-if="parseError" class="parse-error">
      <Icon icon="ep:circle-close-filled" class="mr-4px" />
      <span>{{ parseError }}</span>
      <span v-if="errorPosition !== undefined" class="error-pos">（第 {{ errorPosition + 1 }} 个字符附近）</span>
    </div>
    <div v-else-if="expression && expression.trim()" class="parse-ok">
      <Icon icon="ep:circle-check-filled" class="mr-4px" />
      <span>公式可用</span>
      <span v-if="referencedFields.length > 0" class="refs">
        引用字段：{{ referencedFields.join('、') }}
      </span>
    </div>

    <!-- 可用字段与函数，点一下插入 -->
    <div class="insert-panel">
      <div class="panel-section">
        <div class="panel-title">字段（点击插入）</div>
        <div class="chip-list">
          <el-tag
            v-for="opt in fieldOptions"
            :key="opt.value"
            size="small"
            class="chip"
            @click="insert(`{${opt.value}}`)"
          >
            {{ opt.label }}
          </el-tag>
          <span v-if="fieldOptions.length === 0" class="panel-empty">还没有可引用的字段</span>
        </div>
      </div>

      <div class="panel-section">
        <div class="panel-title">
          函数
          <span class="panel-hint">聚合函数的参数必须是子表字段</span>
        </div>
        <div class="chip-list">
          <el-tag
            v-for="fn in FUNCTION_NAMES"
            :key="fn"
            size="small"
            type="info"
            class="chip"
            @click="insert(`${fn}()`)"
          >
            {{ fn }}
          </el-tag>
        </div>
      </div>
    </div>

    <el-form label-width="80px" size="small" class="mt-10px">
      <el-form-item label="小数位">
        <el-input-number v-model="precision" :min="0" :max="10" controls-position="right" />
      </el-form-item>
      <el-form-item label="舍入方式">
        <el-radio-group v-model="rounding">
          <el-radio-button value="HALF_UP">四舍五入</el-radio-button>
          <el-radio-button value="CEIL">进一</el-radio-button>
          <el-radio-button value="FLOOR">舍去</el-radio-button>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="千分位">
        <el-switch v-model="thousands" />
      </el-form-item>
    </el-form>

    <el-alert type="info" :closable="false" class="mt-6px">
      <template #title>
        公式结果在提交时由服务端重新计算，前端显示的值仅供参考 ——
        这样即便有人绕过界面直接提交，入库的也是服务端算出的结果。
      </template>
    </el-alert>
  </div>
</template>

<script lang="ts" setup>
import { FUNCTION_NAMES, parseFormula } from './parser'

defineOptions({ name: 'FormulaEditor' })

/**
 * 公式表达式编辑器
 *
 * 解析在这里做一次，产出的 AST 存进控件规则；两端运行时都只求值不解析。
 * 解析错误当场报出来并给字符位置 —— 保存时才报错的话，用户对着一长串公式
 * 不知道该改哪里。
 */
const props = defineProps<{
  /** 可引用的字段 */
  fieldOptions: Array<{ label: string; value: string }>
}>()

const expression = defineModel<string>('expression', { default: '' })
/** 解析出的 AST，存进规则供两端求值 */
const ast = defineModel<any>('ast')
const precision = defineModel<number>('precision', { default: 2 })
const rounding = defineModel<string>('rounding', { default: 'HALF_UP' })
const thousands = defineModel<boolean>('thousands', { default: false })

const parseError = ref('')
const errorPosition = ref<number | undefined>()
const referencedFields = ref<string[]>([])

/**
 * 解析并把 AST 写回规则
 *
 * 解析失败时把 ast 置空 —— 留着上一次的 AST 会造成「界面报错但公式照样在算」，
 * 用户以为改坏了却还在生效，比直接不算更让人困惑
 */
const onInput = () => {
  const result = parseFormula(expression.value)
  if (result.ok) {
    parseError.value = ''
    errorPosition.value = undefined
    ast.value = result.ast ?? null
    referencedFields.value = [...result.fields, ...result.subFields]
  } else {
    parseError.value = result.error ?? '公式格式不对'
    errorPosition.value = result.position
    ast.value = null
    referencedFields.value = []
  }
}

/** 点击标签插入到表达式末尾 */
const insert = (text: string) => {
  expression.value = `${expression.value ?? ''}${text}`
  onInput()
}

watch(() => expression.value, onInput, { immediate: true })

/** 供父组件在保存前校验 */
const isValid = () => !parseError.value
defineExpose({ isValid, parseError })
</script>

<style lang="scss" scoped>
.expression-input :deep(.el-textarea__inner) {
  font-family: Consolas, Monaco, 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.6;
}

.parse-error {
  display: flex;
  align-items: center;
  padding: 6px 8px;
  margin-top: 6px;
  font-size: 12px;
  color: var(--el-color-danger);
  background: var(--el-color-danger-light-9);
  border-radius: 4px;
}

.error-pos {
  margin-left: 4px;
  color: var(--el-text-color-secondary);
}

.parse-ok {
  display: flex;
  align-items: center;
  padding: 6px 8px;
  margin-top: 6px;
  font-size: 12px;
  color: var(--el-color-success);
  background: var(--el-color-success-light-9);
  border-radius: 4px;
}

.refs {
  margin-left: 8px;
  color: var(--el-text-color-secondary);
}

.insert-panel {
  padding: 8px;
  margin-top: 10px;
  background: var(--el-fill-color-lighter);
  border-radius: 4px;
}

.panel-section {
  margin-bottom: 8px;

  &:last-child {
    margin-bottom: 0;
  }
}

.panel-title {
  margin-bottom: 4px;
  font-size: 12px;
  font-weight: 600;
}

.panel-hint {
  margin-left: 6px;
  font-weight: 400;
  color: var(--el-text-color-secondary);
}

.chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.chip {
  cursor: pointer;
}

.panel-empty {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
