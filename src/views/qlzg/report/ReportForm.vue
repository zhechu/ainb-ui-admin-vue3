<template>
  <Dialog v-model="dialogVisible" title="新建报告" width="680">
    <el-form
      ref="formRef"
      v-loading="formLoading"
      :model="formData"
      :rules="formRules"
      label-width="110px"
    >
      <el-form-item label="所属项目">
        <el-input :model-value="projectLabel" disabled />
        <div class="form-hint">
          报告是按<b>标的</b>出的（法定报告的抬头是标的），但清单是按<b>项目</b>列的：
          一个项目下可以有多个标的，每个标的可以出多份报告。
        </div>
      </el-form-item>

      <el-form-item label="标的" prop="subjectId">
        <el-select v-model="formData.subjectId" placeholder="请选择标的" filterable class="w-full">
          <el-option
            v-for="item in subjectList"
            :key="item.id"
            :label="item.subjectName"
            :value="item.id"
          />
        </el-select>
        <div v-if="!subjectLoading && subjectList.length === 0" class="form-hint warn-text">
          这个项目下还没有标的。报告必须挂在一个标的上，请先到「标的台账」建一个。
        </div>
      </el-form-item>

      <el-form-item label="报告模板" prop="templateId">
        <el-select
          v-model="formData.templateId"
          placeholder="请选择已发布的模板"
          filterable
          class="w-full"
        >
          <el-option
            v-for="item in templateList"
            :key="item.id"
            :label="templateLabel(item)"
            :value="item.id"
          />
        </el-select>
        <!--
          🔴 这一句必须写出来：`/list?onlyPublished=true` 是刻意收窄的清单。
             一份没发布过的模板解析不出 template_version_id，选了它报告建不出来 ——
             而后端那句报错是「模板没有已发布的版本」，不会告诉他「去发布」这个动作
        -->
        <div v-if="!templateLoading && templateList.length === 0" class="form-hint warn-text">
          这个品类下还没有<b>已发布</b>的模板。草稿期的模板建不出报告，
          请到「报告模板」页上传 docx 并点一次「发布」。
        </div>
        <div v-else class="form-hint">
          这里只列<b>已发布</b>的模板。报告创建那一刻后端会把模板的当前已发布版
          <b>钉</b>在这份报告上，之后模板再发新版，这份在制报告的版式也不动。
        </div>
      </el-form-item>

      <el-form-item label="交付物类型">
        <el-input :model-value="reportTypeLabel" disabled />
        <!--
          🔴 这一栏**不给选**，由模板决定：后端 validateTemplateReportType 要求两者相同。
             给一个自由下拉的后果是「拿技术报告的模板出结果报告」，
             而委托方收到的会是四十页 —— 一份内容全对、类型全错的交付物，
             复核规则一条都不会拦它。前端把它做成只读，那个报错就永远不会出现
        -->
        <div class="form-hint">
          由所选模板决定，不能单独指定。技术报告是四十页的执业底稿，
          结果报告是给委托方的两页纸。
        </div>
      </el-form-item>

      <el-form-item label="报告标题" prop="title">
        <el-input
          v-model="formData.title"
          placeholder="可空，留空时由后端按项目 + 标的 + 交付物类型拼一个"
          maxlength="255"
          show-word-limit
        />
      </el-form-item>

      <el-alert type="info" :closable="false" show-icon class="mt-8px">
        <template #title>建好之后是草稿，作业档位恒为 M0（零 AI）</template>
        <div>
          MVP 只交付 M0：整份报告不调用任何大模型，token 成本恒为 0.000000。
          建好之后要在作业台里逐格填值、成文、补齐残留占位符，才能定稿。
        </div>
      </el-alert>
    </el-form>

    <template #footer>
      <el-button :disabled="formLoading" type="primary" @click="submitForm">建 好</el-button>
      <el-button @click="dialogVisible = false">取 消</el-button>
    </template>
  </Dialog>
</template>
<script lang="ts" setup>
import { QlzgSubjectApi, type QlzgSubjectVO } from '@/api/qlzg/subject'
import { QlzgTemplateApi, type QlzgTemplateVO } from '@/api/qlzg/template'
import { QlzgReportApi } from '@/api/qlzg/report'
import { QlzgProjectApi, type QlzgProjectVO } from '@/api/qlzg/project'
import { REPORT_TYPE_OPTIONS, labelOf } from '@/views/qlzg/constants'

/**
 * 新建报告 —— 三个入参，其中一个是**推导**出来的
 *
 * <h3>🔴 交付物类型由模板决定，界面上是只读的</h3>
 * 后端 {@code validateTemplateReportType} 要求两者相同，而它守的是一件很贵的事：
 * 拿技术报告的模板出结果报告，全链条不报错，委托方收到的却是四十页。
 * 做成只读之后那个报错永远不会出现 —— 比做一套「选了 A 模板就禁用 B 类型」的
 * 前端联动可靠得多，而那份联动迟早会与后端漂开。
 *
 * <h3>🔴 模板清单用 {@code onlyPublished = true} 那一份</h3>
 * 没发布过的模板解析不出 {@code template_version_id}，报告建不出来。
 * 清单为空时要把「去发布」这个动作说出来，而不是留一个空下拉。
 *
 * <h3>🔴 标的与模板两个清单**各自 try**</h3>
 * 模板清单挂了不该把已经拿到的标的清单一起丢掉 ——
 * 两件事彼此无关，而一次失败就清空整个表单的话，
 * 用户会以为「这个项目下没有标的」。
 */
defineOptions({ name: 'QlzgReportForm' })

const message = useMessage()
const emit = defineEmits(['success'])

const dialogVisible = ref(false)
const formLoading = ref(false)
const subjectLoading = ref(false)
const templateLoading = ref(false)
const projectId = ref<number | null>(null)
const project = ref<QlzgProjectVO | null>(null)
const subjectList = ref<QlzgSubjectVO[]>([])
const templateList = ref<QlzgTemplateVO[]>([])

const formData = ref({
  subjectId: undefined as number | undefined,
  templateId: undefined as number | undefined,
  title: ''
})

const formRules = {
  subjectId: [{ required: true, message: '标的不能为空', trigger: 'change' }],
  templateId: [{ required: true, message: '报告模板不能为空', trigger: 'change' }]
}

const formRef = ref()

const projectLabel = computed(() => {
  const p = project.value
  if (!p) return projectId.value ? `项目 ${projectId.value}` : '—'
  return `${p.projectNo}　${p.projectName}`
})

const selectedTemplate = computed(
  () => templateList.value.find((item) => item.id === formData.value.templateId) ?? null
)

const reportTypeLabel = computed(() => {
  const t = selectedTemplate.value
  if (!t) return '（选定模板后自动带出）'
  return t.reportTypeDescription || labelOf(REPORT_TYPE_OPTIONS, t.reportType) || t.reportType
})

/**
 * 模板下拉上显示的那一句
 *
 * 🔴 必须把交付物类型带上：同一个品类下技术报告与结果报告的模板**并列**，
 *    而两者的名字都可能叫「住宅抵押评估模板」。只显示名字的话，
 *    选错的那一次要到定稿之后委托方收到四十页纸时才发现
 */
const templateLabel = (item: QlzgTemplateVO): string => {
  const parts = [
    item.templateName,
    item.reportTypeDescription || labelOf(REPORT_TYPE_OPTIONS, item.reportType),
    item.versionNo ? `版本 ${item.versionNo}` : '',
    item.platform ? '平台公共' : ''
  ]
  return parts.filter((part) => !!part).join(' · ')
}

const open = async (id: number, detail?: QlzgProjectVO | null) => {
  projectId.value = id
  project.value = detail ?? null
  formData.value = { subjectId: undefined, templateId: undefined, title: '' }
  subjectList.value = []
  templateList.value = []
  dialogVisible.value = true
  formLoading.value = true
  try {
    if (!project.value) {
      try {
        project.value = await QlzgProjectApi.getProject(id)
      } catch {
        project.value = null
      }
    }
    subjectLoading.value = true
    templateLoading.value = true
    const categoryCode = project.value?.categoryCode ?? null
    const [subjectResult, templateResult] = await Promise.allSettled([
      QlzgSubjectApi.getSubjectListByProject(id),
      categoryCode ? QlzgTemplateApi.getTemplateList(categoryCode, true) : Promise.resolve([])
    ])
    subjectList.value = subjectResult.status === 'fulfilled' ? subjectResult.value ?? [] : []
    templateList.value = templateResult.status === 'fulfilled' ? templateResult.value ?? [] : []
    if (subjectResult.status === 'rejected' || templateResult.status === 'rejected') {
      const reason =
        subjectResult.status === 'rejected'
          ? subjectResult.reason
          : (templateResult as PromiseRejectedResult).reason
      message.warning(reason?.message || '标的或模板清单加载失败，请关掉对话框重试一次')
    }
  } finally {
    subjectLoading.value = false
    templateLoading.value = false
    formLoading.value = false
  }
}
defineExpose({ open })

const submitForm = async () => {
  await formRef.value?.validate()
  const template = selectedTemplate.value
  if (!template?.reportType) {
    message.error('所选模板没有交付物类型，请换一份模板')
    return
  }
  formLoading.value = true
  try {
    const reportId = await QlzgReportApi.createReport({
      subjectId: formData.value.subjectId!,
      templateId: formData.value.templateId!,
      // 🔴 从模板上取，不从表单上取：这一栏在界面上是只读的，
      //    formData 里也就刻意没有 reportType 这一项，
      //    免得下一个人加一个下拉把它变成可选的
      reportType: template.reportType,
      title: formData.value.title.trim() || null
    })
    message.success('报告已建好，是草稿。下一步进作业台逐格填值')
    dialogVisible.value = false
    emit('success', reportId)
  } finally {
    formLoading.value = false
  }
}
</script>
<style lang="scss" scoped>
.form-hint {
  width: 100%;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}

.warn-text {
  color: var(--el-color-warning);
}
</style>
