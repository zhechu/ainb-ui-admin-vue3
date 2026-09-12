<template>
  <div class="validate-rules-editor">
    <div v-if="!rules.length" class="empty-tip">
      未配置格式校验。填写内容的格式约束（如手机号、金额）配在这里，
      提交时服务端会用同一份正则再校验一遍。
    </div>

    <div v-for="(rule, index) in rules" :key="index" class="rule-item">
      <div class="rule-head">
        <el-radio-group v-model="rule.type" size="small" @change="onTypeChange(rule)">
          <el-radio-button value="BUILTIN">内置</el-radio-button>
          <el-radio-button value="REGEX">自定义</el-radio-button>
        </el-radio-group>
        <div class="rule-head-right">
          <!-- 停用而不是删除：用户常常想先关掉看看效果，删了就得重配 -->
          <el-switch
            v-model="rule.enabled"
            size="small"
            active-text="启用"
            inline-prompt
            @change="emitChange"
          />
          <el-button link type="danger" size="small" @click="removeRule(index)">删除</el-button>
        </div>
      </div>

      <el-select
        v-if="rule.type === 'BUILTIN'"
        v-model="rule.patternKey"
        placeholder="选择内置格式"
        size="small"
        clearable
        class="rule-field"
        @change="emitChange"
      >
        <el-option
          v-for="pattern in BUILTIN_PATTERNS"
          :key="pattern.key"
          :label="pattern.label"
          :value="pattern.key"
        >
          <span>{{ pattern.label }}</span>
          <span class="option-hint">{{ pattern.message }}</span>
        </el-option>
      </el-select>

      <el-input
        v-else
        v-model="rule.pattern"
        placeholder="自定义正则，如 ^AB[0-9]{4}$"
        size="small"
        class="rule-field"
        @change="emitChange"
      />

      <!-- 自定义正则必须能编译。语法错的正则在运行时会被放过（不能让用户的输入
           因为我们编译不了正则而被拒），所以这里必须当场提示，否则用户以为配好了 -->
      <div v-if="rule.type === 'REGEX' && regexError(rule)" class="rule-error">
        正则语法错误，这条校验不会生效
      </div>

      <el-input
        v-model="rule.message"
        :placeholder="messagePlaceholder(rule)"
        size="small"
        class="rule-field"
        @change="emitChange"
      />
    </div>

    <div class="editor-actions">
      <el-button link type="primary" size="small" @click="addRule">+ 添加规则</el-button>
    </div>

    <!-- 试值：正则最常见的问题是「配了但不知道对不对」。
         这里当场试一下，比发布后拿真实数据试错便宜得多 -->
    <div v-if="rules.length" class="try-box">
      <el-input v-model="tryValue" placeholder="输入一个值试试" size="small" clearable />
      <div v-if="tryValue" :class="tryPassed ? 'try-pass' : 'try-fail'">
        {{ tryPassed ? '通过' : tryMessage }}
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
/**
 * 字段格式校验的配置界面
 *
 * 产出的是 `props.validateRules` —— 我们自己的声明式模型，服务端读同一份。
 * 不直接产出 form-create 内核的 `validate`：那一套是 async-validator 全集
 * （含自定义函数、异步校验器），服务端只能实现其中一小部分，
 * 结果会是「配了但服务端不生效」，而这比没有校验更糟。
 */
import { BUILTIN_PATTERNS, compilePattern, getBuiltinPattern } from './patterns'
import { checkFieldValue } from './fieldRules'
import type { FieldValidationRule } from './types'

defineOptions({ name: 'ValidateRulesEditor' })

const props = defineProps<{
  modelValue?: FieldValidationRule[]
}>()
const emit = defineEmits<{
  (e: 'update:modelValue', value: FieldValidationRule[]): void
}>()

/**
 * 本地副本
 *
 * 直接改 props 里的数组在设计器里可以工作（对象引用相同），但一旦上游换成
 * 深拷贝就会静默失效。保持「本地改 + emit」的单向流，行为不依赖上游怎么传。
 */
const rules = ref<FieldValidationRule[]>([])

watch(
  () => props.modelValue,
  (value) => {
    rules.value = Array.isArray(value)
      ? value.map((item) => ({
          // 补上缺省值，否则 v-model 绑到 undefined 上，界面显示为「都没选」
          type: item.type ?? (item.patternKey ? 'BUILTIN' : 'REGEX'),
          enabled: item.enabled !== false,
          patternKey: item.patternKey,
          pattern: item.pattern,
          message: item.message
        }))
      : []
  },
  { immediate: true, deep: true }
)

const emitChange = () => {
  emit('update:modelValue', rules.value.map((item) => ({ ...item })))
}

const addRule = () => {
  rules.value.push({ type: 'BUILTIN', enabled: true })
  emitChange()
}

const removeRule = (index: number) => {
  rules.value.splice(index, 1)
  emitChange()
}

/**
 * 切换类型时不清掉另一种类型的配置
 *
 * 用户可能只是想对比一下内置与自定义的效果，切回来还要能看到原来填的。
 * 判定「用哪一个」看的是 type，留着不用的那份不会生效。
 */
const onTypeChange = (_rule: FieldValidationRule) => emitChange()

const regexError = (rule: FieldValidationRule): boolean =>
  !!rule.pattern && compilePattern(rule.pattern) === null

const messagePlaceholder = (rule: FieldValidationRule): string => {
  const builtin = getBuiltinPattern(rule.patternKey)
  return builtin?.message ? `错误提示（默认「${builtin.message}」）` : '错误提示'
}

// ==================== 试值 ====================

const tryValue = ref('')
const tryMessage = computed(() => checkFieldValue(rules.value, tryValue.value))
const tryPassed = computed(() => !tryMessage.value)
</script>

<style lang="scss" scoped>
.validate-rules-editor {
  .empty-tip {
    font-size: 12px;
    line-height: 1.6;
    color: var(--el-text-color-secondary);
  }

  .rule-item {
    padding: 8px;
    margin-bottom: 8px;
    background: var(--el-fill-color-light);
    border-radius: 4px;
  }

  .rule-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .rule-head-right {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .rule-field {
    margin-bottom: 6px;
  }

  .rule-error {
    margin-bottom: 6px;
    font-size: 12px;
    color: var(--el-color-danger);
  }

  .option-hint {
    float: right;
    margin-left: 12px;
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }

  .try-box {
    padding-top: 8px;
    margin-top: 4px;
    border-top: 1px solid var(--el-border-color-lighter);
  }

  .try-pass {
    margin-top: 4px;
    font-size: 12px;
    color: var(--el-color-success);
  }

  .try-fail {
    margin-top: 4px;
    font-size: 12px;
    color: var(--el-color-danger);
  }
}
</style>
