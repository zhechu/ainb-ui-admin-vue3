<template>
  <el-form ref="formRef" :model="modelData" :rules="rules" label-width="120px" class="mt-20px">
    <el-form-item label="表单类型" prop="formType" class="mb-20px">
      <el-radio-group v-model="modelData.formType">
        <el-radio
          v-for="dict in getIntDictOptions(DICT_TYPE.BPM_MODEL_FORM_TYPE)"
          :key="dict.value"
          :value="dict.value"
        >
          {{ dict.label }}
        </el-radio>
      </el-radio-group>
    </el-form-item>
    <el-form-item
      v-if="modelData.formType === BpmModelFormType.NORMAL"
      label="流程表单"
      prop="formId"
    >
      <el-select v-model="modelData.formId" clearable style="width: 100%">
        <el-option v-for="form in formList" :key="form.id" :label="form.name" :value="form.id" />
      </el-select>
    </el-form-item>
    <!-- 在线表单：即「表单设计」模块设计的表单 -->
    <el-form-item
      v-if="modelData.formType === BpmModelFormType.ONLINE"
      label="在线表单"
      prop="formDesignCode"
    >
      <el-select
        v-model="modelData.formDesignCode"
        clearable
        filterable
        style="width: 100%"
        placeholder="请选择「表单设计」中的表单"
        :loading="onlineFormLoading"
      >
        <el-option
          v-for="form in onlineFormList"
          :key="form.code"
          :label="form.name"
          :value="form.code"
          :disabled="!form.flowReady"
        >
          <div class="flex items-center justify-between">
            <span>
              {{ form.name }}
              <span class="text-#8492a6 text-12px ml-8px">{{ form.code }}</span>
            </span>
            <!-- 不可用原因原样展示，不要合并成「不可用」：用户需要据此知道去补哪一列 -->
            <el-tooltip v-if="!form.flowReady" :content="form.unavailableReason" placement="right">
              <span class="text-#f56c6c text-12px ml-12px">不可用</span>
            </el-tooltip>
            <span v-else-if="form.mainTable" class="text-#8492a6 text-12px ml-12px">
              {{ form.mainTable }}
            </span>
          </div>
        </el-option>
      </el-select>
      <div v-if="selectedOnlineForm" class="text-12px text-#8492a6 mt-4px">
        主表：{{ selectedOnlineForm.mainTable || '未绑定' }}
      </div>
      <el-alert
        v-if="unavailableOnlineFormCount > 0"
        class="mt-8px"
        type="info"
        :closable="false"
        show-icon
      >
        有 {{ unavailableOnlineFormCount }} 个表单暂不可用于流程（已置灰），鼠标悬停可查看原因。
        业务表需预先具备 process_instance_id（varchar 64）与 process_status（整数型）两列。
      </el-alert>
    </el-form-item>
    <el-form-item
      v-if="modelData.formType === BpmModelFormType.CUSTOM"
      label="表单提交路由"
      prop="formCustomCreatePath"
    >
      <el-input
        v-model="modelData.formCustomCreatePath"
        placeholder="请输入表单提交路由"
        style="width: 330px"
      />
      <el-tooltip
        class="item"
        content="自定义表单的提交路径，使用 Vue 的路由地址，例如说：bpm/oa/leave/create.vue"
        effect="light"
        placement="top"
      >
        <Icon icon="ep:question" class="ml-5px" />
      </el-tooltip>
    </el-form-item>
    <el-form-item
      v-if="modelData.formType === BpmModelFormType.CUSTOM"
      label="表单查看地址"
      prop="formCustomViewPath"
    >
      <el-input
        v-model="modelData.formCustomViewPath"
        placeholder="请输入表单查看的组件地址"
        style="width: 330px"
      />
      <el-tooltip
        class="item"
        content="自定义表单的查看组件地址，使用 Vue 的组件地址，例如说：bpm/oa/leave/detail.vue"
        effect="light"
        placement="top"
      >
        <Icon icon="ep:question" class="ml-5px" />
      </el-tooltip>
    </el-form-item>
    <!-- 表单预览。流程表单与在线表单都是 form-create 规则，可共用同一套预览 -->
    <div v-if="formPreview.rule.length > 0" class="mt-20px">
      <div class="flex items-center mb-15px">
        <div class="h-15px w-4px bg-[#1890ff] mr-10px"></div>
        <span class="text-15px font-bold">表单预览</span>
      </div>
      <form-create
        v-model="formPreview.formData"
        :rule="formPreview.rule"
        :option="formPreview.option"
      />
    </div>
  </el-form>
</template>

<script lang="ts" setup>
import { DICT_TYPE, getIntDictOptions } from '@/utils/dict'
import * as FormApi from '@/api/bpm/form'
import * as OnlineFormApi from '@/api/bpm/onlineForm'
import { setConfAndFields2 } from '@/utils/formCreate'
import { BpmModelFormType } from '@/utils/constants'
import type { Rule } from '@form-create/element-ui'

defineProps<{
  formList: FormApi.FormVO[]
}>()

const formRef = ref()

// 创建本地数据副本
const modelData = defineModel<any>()

// 在线表单（即「表单设计」模块的表单）列表
const onlineFormList = ref<OnlineFormApi.OnlineFormVO[]>([])
const onlineFormLoading = ref(false)

/** 当前选中的在线表单 */
const selectedOnlineForm = computed(() =>
  onlineFormList.value.find((item) => item.code === modelData.value?.formDesignCode)
)

/** 不可用于流程的表单数量，用于给出整体提示 */
const unavailableOnlineFormCount = computed(
  () => onlineFormList.value.filter((item) => !item.flowReady).length
)

// 表单预览数据
const formPreview = ref({
  formData: {},
  rule: [] as Rule[],
  option: {
    submitBtn: false,
    resetBtn: false,
    formData: {}
  }
})

/** 把预览里的所有字段置为只读 */
const disablePreviewRule = () => {
  formPreview.value.rule.forEach((item) => {
    item.props = { ...item.props, disabled: true }
  })
}

/** 加载在线表单列表。作为主表单校验，因此 mainForm 传 true */
const loadOnlineFormList = async () => {
  if (onlineFormList.value.length > 0) {
    return
  }
  onlineFormLoading.value = true
  try {
    onlineFormList.value = await OnlineFormApi.getOnlineFormList(true)
  } finally {
    onlineFormLoading.value = false
  }
}

// 监听表单类型变化：切到在线表单时才去拉列表，避免不用该类型的流程也多一次请求
watch(
  () => modelData.value?.formType,
  async (formType) => {
    if (formType === BpmModelFormType.ONLINE) {
      await loadOnlineFormList()
    }
  },
  { immediate: true }
)

// 监听流程表单 ID 变化，加载表单数据
watch(
  () => modelData.value.formId,
  async (newFormId) => {
    if (newFormId && modelData.value.formType === BpmModelFormType.NORMAL) {
      const data = await FormApi.getForm(newFormId)
      setConfAndFields2(formPreview.value, data.conf, data.fields)
      disablePreviewRule()
    } else if (modelData.value.formType !== BpmModelFormType.ONLINE) {
      formPreview.value.rule = []
    }
  },
  { immediate: true }
)

// 监听在线表单编码变化，加载表单数据
// 在线表单与流程表单的 conf / fields 是同一套 form-create 约定，因此预览逻辑可以完全复用
watch(
  () => modelData.value?.formDesignCode,
  async (newCode) => {
    if (!newCode || modelData.value.formType !== BpmModelFormType.ONLINE) {
      if (modelData.value?.formType === BpmModelFormType.ONLINE) {
        formPreview.value.rule = []
      }
      return
    }
    const data = await OnlineFormApi.getOnlineForm(newCode)
    if (!data?.formConf || !data?.formFields?.length) {
      formPreview.value.rule = []
      return
    }
    setConfAndFields2(formPreview.value, data.formConf, data.formFields)
    disablePreviewRule()
  },
  { immediate: true }
)

const rules = {
  formType: [{ required: true, message: '表单类型不能为空', trigger: 'blur' }],
  formId: [{ required: true, message: '流程表单不能为空', trigger: 'blur' }],
  formDesignCode: [{ required: true, message: '在线表单不能为空', trigger: 'blur' }],
  formCustomCreatePath: [{ required: true, message: '表单提交路由不能为空', trigger: 'blur' }],
  formCustomViewPath: [{ required: true, message: '表单查看地址不能为空', trigger: 'blur' }]
}

/** 表单校验 */
const validate = async () => {
  await formRef.value?.validate()
  // 补一道前端校验：所选在线表单已被标记为不可用时直接拦下，
  // 否则用户要等到保存或部署才被后端的闸口②③ 挡回来，反馈链路太长
  if (modelData.value?.formType === BpmModelFormType.ONLINE) {
    const selected = selectedOnlineForm.value
    if (selected && !selected.flowReady) {
      throw new Error(`所选在线表单不可用：${selected.unavailableReason}`)
    }
  }
}

defineExpose({
  validate
})
</script>
