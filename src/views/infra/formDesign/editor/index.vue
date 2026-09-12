<template>
  <ContentWrap class="form-design-editor-page">
    <div class="mx-auto">
      <!-- 头部导航栏 -->
      <div
        class="absolute top-0 left-0 right-0 h-50px bg-[var(--el-bg-color)] border-bottom border-[var(--el-border-color)] z-10 flex items-center px-20px"
      >
        <!-- 左侧标题。标题自带 truncate 与 title 提示，放不下时截断是它设计好的行为 -->
        <div class="w-240px flex-shrink-0 flex items-center overflow-hidden">
          <Icon icon="ep:arrow-left" class="cursor-pointer flex-shrink-0" @click="handleBack" />
          <span class="ml-10px text-16px truncate" :title="formData.name || '新建表单'">
            {{ formData.name || '新建表单' }}
          </span>
          <el-tag v-if="formData.id" :type="statusTagType" class="ml-8px" size="small">
            {{ statusLabel }}
          </el-tag>
        </div>

        <!--
          步骤条
          min-w-0 + overflow-hidden 不是可有可无的：没有它，flex 子项的最小尺寸是内容宽度，
          步骤条会把右侧按钮组顶出头部。窄屏时该让位的是步骤条 —— 它居中裁剪，
          当前步始终在可见范围内，而点不到保存按钮是没法将就的。
        -->
        <div class="flex-1 min-w-0 overflow-hidden flex items-center justify-center h-full">
          <div class="flex items-center justify-center h-full">
            <div
              v-for="(step, index) in visibleSteps"
              :key="step.key"
              class="flex items-center cursor-pointer mx-15px relative h-full"
              :class="[
                currentStep === index
                  ? 'text-[var(--el-color-primary)] border-[var(--el-color-primary)] border-b-2 border-b-solid'
                  : 'text-[var(--el-text-color-secondary)]'
              ]"
              @click="handleStepClick(index)"
            >
              <div
                class="w-28px h-28px rounded-full flex items-center justify-center mr-8px border-2 border-solid text-15px"
                :class="[
                  currentStep === index
                    ? 'bg-[var(--el-color-primary)] text-white border-[var(--el-color-primary)]'
                    : 'border-[var(--el-border-color)] bg-[var(--el-bg-color)] text-[var(--el-text-color-secondary)]'
                ]"
              >
                {{ index + 1 }}
              </div>
              <span class="text-16px font-bold whitespace-nowrap">{{ step.title }}</span>
            </div>
          </div>
        </div>

        <!--
          右侧按钮

          ⚠️ 不要给这里写死宽度。第三步起有四个按钮（体检 / 上一步 / 下一步 / 保存拆分按钮），
          原先的 w-300px 装不下：按钮向左溢出压到步骤条上，保存的下拉箭头被挤到第二行、
          整组戳出 50px 的头部，窄屏时保存干脆跑到可视区外。
          改成按内容取自然宽度 + 不收缩 + 不换行，让中间的步骤条去承担窄屏的挤压。
        -->
        <div class="flex-shrink-0 flex flex-nowrap items-center justify-end gap-2 whitespace-nowrap">
          <!--
            体检：把问题一次列全。放在保存旁边而不是发布对话框里 ——
            发布时才发现问题，用户已经配完一整张表单了
          -->
          <el-button
            v-if="formData.id"
            :loading="inspectLoading"
            plain
            @click="handleInspect"
          >
            体 检
          </el-button>
          <el-button v-if="currentStep > 0" @click="handlePrev"> 上一步 </el-button>
          <el-button
            v-if="currentStep < visibleSteps.length - 1"
            type="primary"
            plain
            @click="handleNext"
          >
            下一步
          </el-button>
          <el-dropdown split-button type="primary" :loading="saveLoading" @click="handleSave">
            保 存
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="handleSaveAndClose">保存并关闭</el-dropdown-item>
                <el-dropdown-item @click="handleSaveAndPublish">保存并发布</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>

      <!-- 主体内容 -->
      <div v-loading="loading" class="mt-50px">
        <!-- 基础设置 -->
        <div v-show="activeStepKey === 'basic'" class="mx-auto w-680px">
          <StepBasicInfo ref="stepBasicRef" v-model="formData" />
        </div>

        <!--
          第二步：数据绑定

          比其它步骤宽：这一步里的关联表清单有表名/类型/外键/主键/子表控件字段/
          关联主表列/操作七列，680px 装不下，会逼出一条横向滚动条 ——
          用户得先横向拖一段才能看到「操作」列里的编辑与删除。
          表单项本身仍限宽在 680px（见 StepTableBinding 内部的 .binding-form），
          只有关联表那一块铺满，避免整页的输入框被拉成一条长线。
        -->
        <div v-show="activeStepKey === 'binding'" class="mx-auto w-1080px max-w-full">
          <StepTableBinding ref="stepBindingRef" v-model="formData" />
        </div>

        <!-- 表单设计。设计器需要铺满宽度，不加 mx-auto 限制 -->
        <div v-show="activeStepKey === 'form'">
          <StepFormDesign ref="stepFormRef" v-model="formData" />
        </div>

        <!--
          逻辑与扩展。当前不在步骤条里（见 HIDDEN_STEP_KEYS），
          但仍要挂载 —— 它的 collect() 负责保住存量表单的联动与脚本配置
        -->
        <div v-show="activeStepKey === 'logic'">
          <StepLogic ref="stepLogicRef" v-model="formData" :form-fields="designerFields" />
        </div>

        <!-- 列表设计。仅表单+列表类型出现 -->
        <div v-show="activeStepKey === 'list'">
          <StepListDesign ref="stepListRef" :model-data="formData" :form-fields="designerFields" />
        </div>
      </div>
    </div>

    <!-- 发布对话框 -->
    <PublishDialog ref="publishDialogRef" @success="handlePublishSuccess" />

    <!-- 体检报告 -->
    <Dialog v-model="inspectVisible" title="设计期体检" width="720px">
      <el-result
        v-if="inspectProblems.length === 0"
        icon="success"
        title="没有发现问题"
        sub-title="体检与发布走的是同一份校验，所以这张表单现在一定发得出去"
      />
      <template v-else>
        <el-alert
          type="warning"
          :closable="false"
          class="mb-12px"
          :title="`发现 ${inspectProblems.length} 个问题，发布会被拒绝`"
        />
        <!--
          编号列出来，便于用户逐条核对改了几个。
          ⚠️ 不做「点一下跳到出问题的那一步」——问题来自各个步骤且定位粒度不一（有的是
          某个控件、有的是整份表绑定），做不准的跳转比没有跳转更让人烦
        -->
        <ol class="inspect-list">
          <li v-for="(problem, index) in inspectProblems" :key="index">{{ problem }}</li>
        </ol>
      </template>
      <template #footer>
        <el-button :loading="inspectLoading" type="primary" @click="handleInspect">
          重新体检
        </el-button>
        <el-button @click="inspectVisible = false">关 闭</el-button>
      </template>
    </Dialog>
  </ContentWrap>
</template>

<script lang="ts" setup>
import { useTagsViewStore } from '@/store/modules/tagsView'
import * as FormDesignApi from '@/api/infra/formDesign'
import StepBasicInfo from './StepBasicInfo.vue'
import StepTableBinding from './StepTableBinding.vue'
import StepFormDesign from './StepFormDesign.vue'
import StepListDesign from './StepListDesign.vue'
import StepLogic from './StepLogic.vue'
import { decodeFields } from '@/utils/formCreate'
import PublishDialog from '../components/PublishDialog.vue'

defineOptions({ name: 'InfraFormDesignEditor' })

const message = useMessage()
const route = useRoute()
const { push } = useRouter()
const { delView } = useTagsViewStore()
const { currentRoute } = useRouter()

/**
 * 全部步骤。列表设计仅在「表单+列表」类型下出现，
 * 因此步骤数量是动态的，用 key 而非下标来判断当前步骤更稳。
 */
const ALL_STEPS = [
  { key: 'basic', title: '基础设置' },
  { key: 'binding', title: '数据绑定' },
  { key: 'form', title: '表单设计' },
  // 放在表单设计之后：配联动要先有字段可选
  { key: 'logic', title: '逻辑与扩展' },
  { key: 'list', title: '列表设计' }
]

/**
 * 暂不开放的步骤
 *
 * 「逻辑与扩展」的联动规则、跨字段校验、前端脚本三块还没打磨完，
 * 先从步骤条里摘掉，等完善后把这里清空即可恢复，不必改别处。
 *
 * ⚠️ 只是不让用户走到它，组件本身仍然挂载（下面用的是 v-show 而非 v-if）——
 * collect() 照常把已有的 logicRules / validateRules / formScript 收回去。
 * 改成不挂载的话，存量表单只要在设计器里点一次保存，这三份配置就被清空了。
 */
const HIDDEN_STEP_KEYS = ['logic']

const loading = ref(false)
const saveLoading = ref(false)
const currentStep = ref(0)
const publishDialogRef = ref()

/**
 * 新建表单的初始值
 *
 * 做成函数而不是一个共享对象：loadData 每次都要拿一份**干净的**默认值来打底，
 * 复用同一个对象的话，上一次加载留下的键会跟着进来（理由见 loadData）。
 */
const defaultFormData = () => ({
  id: undefined,
  name: '',
  code: '',
  category: undefined,
  formType: 2,
  status: 0,
  formConf: undefined,
  formFields: [],
  listConf: undefined,
  dataSourceConfigId: 0,
  mainTable: undefined,
  mainPk: 'id',
  // 默认雪花：自增主键在分库分表、数据迁移、多环境同步时会冲突。与后端 TableBinding 的默认值保持一致
  pkStrategy: 'SNOWFLAKE',
  tableBinding: undefined,
  sort: 0,
  remark: undefined
})

const formData = ref<any>(defaultFormData())

const stepBasicRef = ref()
const stepBindingRef = ref()
const stepFormRef = ref()
const stepListRef = ref()
const stepLogicRef = ref()

/**
 * 表单字段列表，供列表设计器选择列与查询字段
 *
 * 从已保存的 formFields 解码得到。之所以不直接读设计器实例，
 * 是因为切到第四步时第三步的设计器已被 v-show 隐藏，读它不稳。
 */
const designerFields = computed(() => {
  if (!formData.value.formFields?.length) return []
  try {
    return decodeFields(formData.value.formFields)
  } catch {
    return []
  }
})

/** 纯表单不需要列表设计步骤；暂未开放的步骤一并摘掉 */
const visibleSteps = computed(() =>
  ALL_STEPS.filter((s) => {
    if (HIDDEN_STEP_KEYS.includes(s.key)) return false
    return !(s.key === 'list' && formData.value.formType === 1)
  })
)

const activeStepKey = computed(() => visibleSteps.value[currentStep.value]?.key)

const statusLabel = computed(() => {
  const map: Record<number, string> = { 0: '草稿', 1: '已发布', 2: '已发布有改动' }
  return map[formData.value.status] ?? '草稿'
})

const statusTagType = computed(() => {
  if (formData.value.status === 1) return 'success'
  if (formData.value.status === 2) return 'warning'
  return 'info'
})

/**
 * 收集所有步骤的产物到 formData
 *
 * 各步骤组件的 collect() 是幂等的：组件未挂载时 ref 为空，可选链会跳过。
 */
const collectAll = () => {
  stepFormRef.value?.collect?.()
  stepLogicRef.value?.collect?.()
  stepListRef.value?.collect?.()
}

/** 校验当前步骤。校验不通过时抛错，由调用方拦截 */
const validateCurrentStep = async () => {
  if (activeStepKey.value === 'basic') {
    await stepBasicRef.value?.validate()
  } else if (activeStepKey.value === 'binding') {
    await stepBindingRef.value?.validate()
  } else if (activeStepKey.value === 'form') {
    await stepFormRef.value?.validate()
  } else if (activeStepKey.value === 'logic') {
    await stepLogicRef.value?.validate()
  } else if (activeStepKey.value === 'list') {
    // 列表设计没有必填校验，只收集配置
    stepListRef.value?.collect()
  }
}

const handleStepClick = async (index: number) => {
  if (index === currentStep.value) return
  // 往后跳需要先过当前步骤的校验；往前跳不校验，方便用户回头改
  if (index > currentStep.value) {
    try {
      await validateCurrentStep()
    } catch {
      return
    }
  }
  currentStep.value = index
}

const handlePrev = () => {
  if (currentStep.value > 0) currentStep.value--
}

const handleNext = async () => {
  try {
    await validateCurrentStep()
  } catch {
    return
  }
  if (currentStep.value < visibleSteps.value.length - 1) currentStep.value++
}

const handleSave = async () => {
  try {
    await validateCurrentStep()
  } catch {
    return
  }
  // 保存前统一收集所有步骤的产物。
  // 只收集当前步骤是不够的：用户可能在第四步配好列表后切回第三步再点保存，
  // 那样第四步的配置不会被写回 formData，静默丢失。
  collectAll()
  saveLoading.value = true
  try {
    const data = { ...formData.value } as FormDesignApi.FormDesignSaveReqVO
    if (formData.value.id) {
      await FormDesignApi.updateFormDesign(data)
      message.success('保存成功')
    } else {
      const id = await FormDesignApi.createFormDesign(data)
      formData.value.id = id
      message.success('创建成功')
    }
    // 重新拉一次，让 status 等由后端维护的字段保持最新
    await loadData(formData.value.id)
  } finally {
    saveLoading.value = false
  }
}

/** 保存并关闭：保存成功后关闭当前 tab 返回列表页 */
const handleSaveAndClose = async () => {
  await handleSave()
  // handleSave 内部失败会设 saveLoading=false 但不会抛出，用 id 是否存在来判断是否成功
  if (formData.value.id) {
    handleBack()
  }
}

/** 保存并发布：保存成功后打开发布对话框 */
const handleSaveAndPublish = async () => {
  await handleSave()
  if (formData.value.id) {
    publishDialogRef.value?.open(formData.value)
  }
}

// ==================== 设计期体检 ====================

const inspectVisible = ref(false)
const inspectLoading = ref(false)
const inspectProblems = ref<string[]>([])

/**
 * 体检
 *
 * ⚠️ 先保存再体检。体检读的是**库里那一份**，不是画布上这一刻的状态 ——
 * 不保存的话，用户刚改完的东西没被检到，而报告看起来却像是最新的。
 */
const handleInspect = async () => {
  if (!formData.value.id) return
  inspectLoading.value = true
  try {
    collectAll()
    await FormDesignApi.updateFormDesign({ ...formData.value } as FormDesignApi.FormDesignSaveReqVO)
    inspectProblems.value = await FormDesignApi.inspectFormDesign(formData.value.id)
    inspectVisible.value = true
  } finally {
    inspectLoading.value = false
  }
}

const loadData = async (id?: number) => {
  if (!id) return
  loading.value = true
  try {
    const data = await FormDesignApi.getFormDesign(id)
    //
    // ⚠️ 以【默认值】打底，不是以上一次的 formData 打底
    //
    // 服务端的 JSON 序列化是 NON_NULL 的 —— 一个字段被清空之后，
    // 响应里根本不会出现那个键。用 `{...formData.value, ...data}` 合并的话，
    // 被清掉的配置会从上一次的内存副本里原样活下来：
    // 用户把详情页页签一条条删完、保存、界面上又全回来了，
    // 而库里其实已经是空的 —— 排查时会以为是后端没存。
    formData.value = { ...defaultFormData(), ...data }
  } finally {
    loading.value = false
  }
}

const handleBack = () => {
  delView(unref(currentRoute))
  push({ name: 'InfraFormDesign' })
}

/** 发布成功后重新加载数据，刷新 status 标签 */
const handlePublishSuccess = async () => {
  await loadData(formData.value.id)
}

onMounted(async () => {
  const id = route.query.id
  if (id) {
    await loadData(Number(id))
  }
})
</script>

<style lang="scss" scoped>
.inspect-list {
  margin: 0;
  padding-left: 20px;

  li {
    margin-bottom: 8px;
    font-size: 13px;
    line-height: 1.7;
    color: var(--el-text-color-regular);
  }
}
</style>
