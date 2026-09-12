<template>
  <el-form
    ref="formRef"
    :model="modelData"
    :rules="formRules"
    label-width="120px"
    class="mt-20px"
  >
    <el-form-item label="表单名称" prop="name">
      <el-input v-model="modelData.name" clearable placeholder="请输入表单名称" />
    </el-form-item>

    <el-form-item label="表单编码" prop="code">
      <el-input
        v-model="modelData.code"
        :disabled="codeDisabled"
        clearable
        placeholder="请输入表单编码，如 customer"
        @blur="handleCodeBlur"
      />
      <div class="form-tip">
        <span v-if="codeDisabled">
          表单已发布，编码不可修改 —— 运行时与菜单都通过它引用本表单。
        </span>
        <span v-else>只允许字母、数字、下划线，且以字母或下划线开头。发布后不可修改。</span>
      </div>
    </el-form-item>

    <el-form-item label="分类" prop="category">
      <el-select v-model="modelData.category" clearable placeholder="请选择分类">
        <el-option
          v-for="dict in getStrDictOptions(DICT_TYPE.INFRA_FORM_DESIGN_CATEGORY)"
          :key="dict.value"
          :label="dict.label"
          :value="dict.value"
        />
      </el-select>
    </el-form-item>

    <el-form-item label="表单类型" prop="formType">
      <el-radio-group v-model="modelData.formType">
        <el-radio :value="1">纯表单</el-radio>
        <el-radio :value="2">表单+列表</el-radio>
      </el-radio-group>
      <div class="form-tip">
        纯表单只有填写页；表单+列表会额外生成列表页，需要在「列表设计」步骤配置列与查询条件。
      </div>
    </el-form-item>

    <el-form-item label="排序" prop="sort">
      <el-input-number v-model="modelData.sort" :min="0" controls-position="right" />
    </el-form-item>

    <el-form-item label="备注" prop="remark">
      <el-input
        v-model="modelData.remark"
        :rows="3"
        placeholder="请输入备注"
        type="textarea"
      />
    </el-form-item>
  </el-form>
</template>

<script lang="ts" setup>
import { DICT_TYPE, getStrDictOptions } from '@/utils/dict'
import * as FormDesignApi from '@/api/infra/formDesign'

defineOptions({ name: 'FormDesignStepBasicInfo' })

const message = useMessage()

const modelData = defineModel<any>({ required: true })

/** 已发布的表单不允许改编码，与后端 FORM_DESIGN_CODE_CANNOT_UPDATE 校验对应 */
const codeDisabled = computed(() => !!modelData.value.id && modelData.value.status !== 0)

const formRef = ref()
const formRules = reactive({
  name: [{ required: true, message: '表单名称不能为空', trigger: 'blur' }],
  code: [
    { required: true, message: '表单编码不能为空', trigger: 'blur' },
    {
      pattern: /^[A-Za-z_][A-Za-z0-9_]*$/,
      message: '只允许字母、数字、下划线，且以字母或下划线开头',
      trigger: 'blur'
    }
  ],
  formType: [{ required: true, message: '请选择表单类型', trigger: 'change' }]
})

/** 失焦时做一次编码可用性校验，尽早暴露冲突而不是等到保存 */
const handleCodeBlur = async () => {
  const code = modelData.value.code
  if (!code || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(code)) {
    return
  }
  const available = await FormDesignApi.checkCode(code, modelData.value.id)
  if (!available) {
    message.warning(`表单编码「${code}」已被占用，请换一个`)
  }
}

/** 供父组件在切换步骤前调用 */
const validate = async () => {
  await formRef.value?.validate()
  return true
}

defineExpose({ validate })
</script>

<style lang="scss" scoped>
.form-tip {
  width: 100%;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}
</style>
