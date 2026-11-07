<template>
  <Dialog v-model="dialogVisible" :title="dialogTitle" width="640">
    <el-form
      ref="formRef"
      v-loading="formLoading"
      :model="formData"
      :rules="formRules"
      label-width="120px"
    >
      <el-form-item v-if="mode === 'copy'" label="源模板">
        <el-input :model-value="copySource?.templateName" disabled />
        <div class="form-hint">
          平台公共模板不能直接改（改它会影响所有机构）。复制会在本机构名下建一份新的，
          docx、占位符映射与已发布的版本行一起带过来，之后那份就是本机构自己的了。
        </div>
      </el-form-item>

      <el-form-item label="模板名称" prop="templateName">
        <el-input
          v-model="formData.templateName"
          placeholder="如 住宅抵押评估技术报告模板"
          maxlength="128"
          show-word-limit
        />
      </el-form-item>

      <el-form-item v-if="mode !== 'copy'" label="适用品类" prop="categoryCode">
        <el-select
          v-model="formData.categoryCode"
          placeholder="请选择品类"
          class="w-full"
          :disabled="mode === 'update'"
        >
          <el-option
            v-for="item in categoryList"
            :key="item.categoryCode"
            :label="item.categoryName"
            :value="item.categoryCode"
          />
        </el-select>
        <div v-if="mode === 'update'" class="form-hint">
          品类建好之后改不了：占位符映射是绑在品类字段清单上的，换品类等于换一份模板，
          要换请新建一份。
        </div>
        <div v-else class="form-hint">
          占位符能绑到哪些字段键，取决于这里选的品类。选错了要到设计器里才会发现
          （闸 B 会把每一处判成「映射到了品类字段清单之外的键」）。
        </div>
      </el-form-item>

      <el-form-item v-if="mode === 'create'" label="交付物类型" prop="reportType">
        <el-radio-group v-model="formData.reportType">
          <el-radio v-for="item in REPORT_TYPE_OPTIONS" :key="item.value" :value="item.value">
            {{ item.label }}
          </el-radio>
        </el-radio-group>
        <!--
          🔴 这一句必须写出来：闸 B ② 的必填字段集合是**按交付物类型分派**的。
             技术报告要 16 个必填字段全都有位置，结果报告只要 6 个（评估总价/单价/大写/
             基准日/报告日/有效期）。建的时候选错，之后发不出去，而报错只说
             「品类必填字段在模板里没有位置」，不会说是因为选错了交付物类型
        -->
        <div class="form-hint">
          技术报告是四十页的执业底稿，闸 B 要求品类那 16 个必填字段在模板里全都有位置；
          结果报告是给委托方的两页纸，只要求 6 个结论字段。建好之后改不了。
        </div>
      </el-form-item>
      <el-form-item v-else-if="mode === 'update'" label="交付物类型">
        <el-input
          :model-value="
            copySource?.reportTypeDescription ||
            labelOf(REPORT_TYPE_OPTIONS, copySource?.reportType)
          "
          disabled
        />
        <div class="form-hint">交付物类型建好之后改不了，它决定闸 B ② 要求哪些必填字段有位置。</div>
      </el-form-item>

      <el-form-item v-if="mode !== 'copy'" label="版本号文本" prop="versionNo">
        <el-input v-model="formData.versionNo" placeholder="可空，如 2026 版" maxlength="32" />
        <div class="form-hint">
          这是给人看的文本，与发布时系统自动递增的版本序号不是一回事。留空不影响发布。
        </div>
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button :disabled="formLoading" type="primary" @click="submitForm">确 定</el-button>
      <el-button @click="dialogVisible = false">取 消</el-button>
    </template>
  </Dialog>
</template>
<script lang="ts" setup>
import { QlzgCategoryApi, type QlzgCategorySimpleVO } from '@/api/qlzg/category'
import { QlzgTemplateApi, type QlzgTemplateVO } from '@/api/qlzg/template'
import { REPORT_TYPE_OPTIONS, labelOf } from '@/views/qlzg/constants'

/**
 * 新建 / 改名 / 从平台公共模板复制 —— 一个对话框三种模式
 *
 * <h3>为什么三种模式挤在一个组件里</h3>
 * 它们改的是同一批字段，而差别全在「哪几项可编辑」上。拆成三个组件的话，
 * 三份 `formRules` 迟早会漂开 —— 而这个表单的规则里有一条是
 * 「品类与交付物类型建好之后改不了」，漂开的表现是某一个组件忘了 disable，
 * 于是改成功了、映射全废了，而界面显示「保存成功」。
 *
 * <h3>🔴 改名模式下 `copySource` 同时充当「只读展示的数据源」</h3>
 * 名字有点误导（它字面意思是「复制的源」），但两种模式下要展示的都是
 * 「一份已存在的模板的不可改属性」，为它再开一个 ref 只会让 open() 里多一条分支。
 *
 * <h3>🔴 这里**没有**「支持的作业档位」这一项&lt;/h3>
 * `supportsMode`（M0/M1/M2）在 UpdateReqVO 里有，但 MVP 只交付 M0，
 * 而 `createReport` 刻意**不校验**它（见 I4-b 的遗留项）。
 * 画一个改了也不生效的下拉，比不画更坏 —— 评估师会以为
 * 「这份模板不支持 M1」是它算不出来的原因。等 I8/I9 真上了 M1/M2 再加。
 */
defineOptions({ name: 'QlzgTemplateForm' })

type Mode = 'create' | 'update' | 'copy'

const message = useMessage()
const emit = defineEmits(['success'])

const dialogVisible = ref(false)
const formLoading = ref(false)
const mode = ref<Mode>('create')
const categoryList = ref<QlzgCategorySimpleVO[]>([])
const copySource = ref<QlzgTemplateVO | null>(null)
const editingId = ref<number | null>(null)

const formData = ref({
  templateName: '',
  categoryCode: '',
  reportType: 'TECHNICAL',
  versionNo: ''
})

const formRules = computed(() => ({
  templateName: [{ required: true, message: '模板名称不能为空', trigger: 'blur' }],
  categoryCode:
    mode.value === 'create' ? [{ required: true, message: '适用品类不能为空', trigger: 'change' }] : [],
  reportType:
    mode.value === 'create' ? [{ required: true, message: '交付物类型不能为空', trigger: 'change' }] : []
}))

const dialogTitle = computed(() => {
  if (mode.value === 'create') return '新建报告模板'
  if (mode.value === 'copy') return '复制为机构模板'
  return '修改报告模板'
})

const formRef = ref()

const loadCategories = async () => {
  if (categoryList.value.length > 0) return
  try {
    categoryList.value = (await QlzgCategoryApi.getSimpleList()) ?? []
  } catch {
    categoryList.value = []
  }
}

/** 新建 */
const open = async (id?: number) => {
  await loadCategories()
  if (id) {
    mode.value = 'update'
    editingId.value = id
    formLoading.value = true
    dialogVisible.value = true
    try {
      const detail = await QlzgTemplateApi.getTemplate(id)
      copySource.value = detail
      formData.value = {
        templateName: detail.templateName ?? '',
        categoryCode: detail.categoryCode ?? '',
        reportType: detail.reportType ?? 'TECHNICAL',
        versionNo: detail.versionNo ?? ''
      }
    } finally {
      formLoading.value = false
    }
    return
  }
  mode.value = 'create'
  editingId.value = null
  copySource.value = null
  formData.value = { templateName: '', categoryCode: '', reportType: 'TECHNICAL', versionNo: '' }
  dialogVisible.value = true
}

/** 从平台公共模板复制一份成为本机构自有的 */
const openCopy = async (source: QlzgTemplateVO) => {
  await loadCategories()
  mode.value = 'copy'
  editingId.value = null
  copySource.value = source
  formData.value = {
    templateName: `${source.templateName}（本机构）`,
    categoryCode: source.categoryCode ?? '',
    reportType: source.reportType ?? 'TECHNICAL',
    versionNo: ''
  }
  dialogVisible.value = true
}
defineExpose({ open, openCopy })

const submitForm = async () => {
  await formRef.value?.validate()
  formLoading.value = true
  try {
    if (mode.value === 'create') {
      const id = await QlzgTemplateApi.createTemplate({
        templateName: formData.value.templateName.trim(),
        categoryCode: formData.value.categoryCode,
        reportType: formData.value.reportType,
        versionNo: formData.value.versionNo.trim() || null
      })
      message.success('模板已建好，下一步去「设计」上传 docx')
      dialogVisible.value = false
      emit('success', id)
      return
    }
    if (mode.value === 'copy') {
      const id = await QlzgTemplateApi.copyTemplate(
        copySource.value!.id,
        formData.value.templateName.trim()
      )
      message.success('已复制到本机构，现在可以改它了')
      dialogVisible.value = false
      emit('success', id)
      return
    }
    await QlzgTemplateApi.updateTemplate({
      id: editingId.value!,
      templateName: formData.value.templateName.trim(),
      versionNo: formData.value.versionNo.trim() || null
    })
    message.success('修改成功')
    dialogVisible.value = false
    emit('success')
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
</style>
