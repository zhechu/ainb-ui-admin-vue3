<template>
  <Dialog v-model="dialogVisible" :title="dialogTitle" width="700">
    <el-form
      ref="formRef"
      v-loading="formLoading"
      :model="formData"
      :rules="formRules"
      label-width="140px"
    >
      <el-form-item label="委托方名称" prop="clientName">
        <el-input v-model="formData.clientName" placeholder="请输入委托方名称" />
      </el-form-item>
      <el-form-item label="委托方类型" prop="clientType">
        <el-select v-model="formData.clientType" placeholder="请选择委托方类型" class="w-full">
          <el-option
            v-for="item in CLIENT_TYPE_OPTIONS"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="统一社会信用代码" prop="unifiedSocialCreditCode">
        <el-input
          v-model="formData.unifiedSocialCreditCode"
          placeholder="企业类型填这一项"
          clearable
        />
      </el-form-item>
      <el-form-item label="身份证号" prop="idCardNo">
        <el-input
          v-model="formData.idCardNo"
          :placeholder="idCardPlaceholder"
          clearable
          @input="secretTouched.idCardNo = true"
        />
      </el-form-item>
      <el-form-item label="联系人姓名" prop="contactName">
        <el-input v-model="formData.contactName" placeholder="请输入联系人姓名" clearable />
      </el-form-item>
      <el-form-item label="联系电话" prop="contactMobile">
        <el-input
          v-model="formData.contactMobile"
          :placeholder="mobilePlaceholder"
          clearable
          @input="secretTouched.contactMobile = true"
        />
      </el-form-item>
      <el-form-item label="联系地址" prop="address">
        <el-input v-model="formData.address" placeholder="请输入联系地址" clearable />
      </el-form-item>
      <el-form-item label="同为报告使用人" prop="isReportUser">
        <el-switch v-model="formData.isReportUser" />
        <span class="ml-8px text-12px text-[var(--el-text-color-secondary)]">
          报告除委托方外还要交给谁用，会影响披露口径
        </span>
      </el-form-item>
      <el-form-item label="备注" prop="remark">
        <el-input v-model="formData.remark" type="textarea" :rows="3" placeholder="请输入备注" />
      </el-form-item>
    </el-form>

    <!--
      🔴 刻意放在 </el-form> **外面**：form-create 自己会渲染一个 el-form，
      而 el-form 落到 DOM 上就是一个 <form>。套在里面是嵌套表单，
      浏览器对它的处置（哪个 submit 生效、回车提交给谁）是未定义的。
      本仓 15 处 form-create 用法没有一处嵌在 el-form 里，这里也不要开这个头。
    -->
    <ExtFieldSection
      ref="extRef"
      v-model="formData.ext"
      entity-type="QLZG_CLIENT"
      label-width="140px"
    />
    <template #footer>
      <el-button :disabled="formLoading" type="primary" @click="submitForm">确 定</el-button>
      <el-button @click="dialogVisible = false">取 消</el-button>
    </template>
  </Dialog>
</template>
<script lang="ts" setup>
import { CLIENT_TYPE_OPTIONS } from '@/views/qlzg/constants'
import { QlzgClientApi, type QlzgClientSaveVO } from '@/api/qlzg/client'
import ExtFieldSection from '@/views/qlzg/components/ExtFieldSection.vue'

defineOptions({ name: 'QlzgClientForm' })

/**
 * 委托方表单
 *
 * <h3>🔴 身份证号与联系电话是【三态】字段，靠「键在不在 JSON 里」区分</h3>
 * 后端 {@code QlzgClientSaveReqVO} 的约定是：不传键 = 不修改（保留库里原值）、
 * 传空串 = 明确清空、传非空值 = 覆盖。而这两列是**列级加密**存储的，
 * 读回来永远是脱敏形态（{@code 330106**********34}），**没有任何接口能取到明文**。
 *
 * <p>于是编辑表单只能是这个形状：输入框**留空**、placeholder 显示脱敏值 = 不动；
 * 用户主动清空并保存 = 发 {@code ''}。判定「动没动」用 {@link secretTouched}
 * （挂在 {@code @input} 上），提交时没碰过的那一项**用 delete 把键整个摘掉** ——
 * ⚠️ 不能靠赋 {@code undefined}：axios 序列化 JSON 时会直接丢掉值为 undefined 的键，
 * 看着像「摘掉了」，但同一个 undefined 也会出现在「用户清空了输入框」那一支，
 * 两件事就分不开了。想清空必须发 {@code ''}，不能发 {@code undefined} 也不能发 {@code null}。
 *
 * <p>⚠️ 因此**不能**把详情里的脱敏值回填进输入框：回填之后用户没改也会把
 * {@code 330106**********34} 当成新值发出去，库里那一列就从真号码变成了一串星号 ——
 * 而它不报错，等到要用身份证号做核验时才发现数据没了。
 *
 * <p>🔴 后端现在也会拦（{@code QlzgClientServiceImpl#validateSecretsNotMasked}，
 * 判据是「含 {@code *}」，错误码 {@code CLIENT_SECRET_IS_MASKED}）。
 * 但**不要因为有那道守卫就回填**：守卫拦下来的表现是「保存失败，提示身份证号不能是脱敏形态」，
 * 用户明明一个字都没改却存不进去，还得自己去把两个框清空 ——
 * 那是把一个前端的形状问题变成了用户的操作问题。守卫防的是别的调用方
 * （脚本按 {@code /get} 回写、移动端另写一份表单），不是给这里的偷懒兜底。
 *
 * <h3>🔴 扩展字段 {@code ext} 的三态与上面那两项**不一样**，别照抄</h3>
 * 身份证号 / 联系电话靠「把键从 JSON 里 delete 掉」表示不修改；
 * {@code ext} 则是发 {@code null}（后端判 {@code reqVO.getExt() != null}），
 * 而 {@code {}} 是**整列覆盖成空** —— 它不等于「不修改」。
 * 这两件事都由 {@code ExtFieldSection} 内部处理：载入成功才 emit，
 * 载入失败一个字都不发（宿主的 {@code ext} 保持从 {@code /get} 读来的原值，原样发回去即可）。
 * 所以这里**不要**再写一句「ext 没碰过就 delete」—— 那恰好会把「用户清空了全部扩展字段」
 * 变成「不修改」，而这两件事在委托方台账上是要分开的。
 */

const { t } = useI18n()
const message = useMessage()

const dialogVisible = ref(false)
const dialogTitle = ref('')
const formLoading = ref(false)
const formType = ref('')
const formRef = ref()

const emptyForm = () => ({
  id: undefined as number | undefined,
  clientName: '',
  clientType: '',
  unifiedSocialCreditCode: '',
  idCardNo: '',
  contactName: '',
  contactMobile: '',
  address: '',
  isReportUser: false,
  remark: '',
  ext: null as Record<string, any> | null
})

const formData = ref(emptyForm())
const formRules = reactive({
  clientName: [{ required: true, message: '委托方名称不能为空', trigger: 'blur' }],
  clientType: [{ required: true, message: '委托方类型不能为空', trigger: 'change' }]
})

/** 用户碰过哪几个加密列 —— 只有碰过的才把键发出去 */
const secretTouched = reactive({ idCardNo: false, contactMobile: false })
/** 库里的脱敏值，只作 placeholder 用，绝不回填进输入框 */
const masked = reactive({ idCardNo: '', contactMobile: '' })

const idCardPlaceholder = computed(() =>
  masked.idCardNo ? `已存 ${masked.idCardNo}，留空表示不修改` : '个人类型填这一项'
)
const mobilePlaceholder = computed(() =>
  masked.contactMobile ? `已存 ${masked.contactMobile}，留空表示不修改` : '请输入联系电话'
)

/** 打开弹窗 */
const open = async (type: string, id?: number) => {
  dialogVisible.value = true
  dialogTitle.value = t('action.' + type)
  formType.value = type
  resetForm()
  if (!id) return
  formLoading.value = true
  try {
    const data = await QlzgClientApi.getClient(id)
    formData.value = {
      id: data.id,
      clientName: data.clientName ?? '',
      clientType: data.clientType ?? '',
      unifiedSocialCreditCode: data.unifiedSocialCreditCode ?? '',
      // 🔴 这两项刻意不回填，见类注释
      idCardNo: '',
      contactName: data.contactName ?? '',
      contactMobile: '',
      address: data.address ?? '',
      isReportUser: data.isReportUser ?? false,
      remark: data.remark ?? '',
      // 🔴 这一项**要**回填（与上面那两项相反）：ext 是「读出来什么就能改什么」的普通值，
      //    后端已经把孤儿键裁掉了，原样发回去不会把库里的东西改坏
      ext: data.ext ?? null
    }
    masked.idCardNo = data.idCardNo ?? ''
    masked.contactMobile = data.contactMobile ?? ''
  } finally {
    formLoading.value = false
  }
}
defineExpose({ open })

/** 提交表单 */
const emit = defineEmits(['success'])
const extRef = ref()
const submitForm = async () => {
  if (!formRef.value) return
  const valid = await formRef.value.validate()
  if (!valid) return
  // 🔴 扩展字段是**另一个** form-create 实例，上面那句 validate 管不到它。
  //    漏掉这一句的表现是：必填的扩展字段没填也能点「确定」，然后被服务端拒收，
  //    用户看到的是一句后端文案而不是输入框下面那行红字
  if (!(await extRef.value?.validate())) return
  formLoading.value = true
  try {
    const data: QlzgClientSaveVO = { ...formData.value }
    // 🔴 没碰过的加密列要把键整个摘掉（= 不修改），不是发空串（= 清空）
    if (!secretTouched.idCardNo) delete data.idCardNo
    if (!secretTouched.contactMobile) delete data.contactMobile
    if (formType.value === 'create') {
      await QlzgClientApi.createClient(data)
      message.success(t('common.createSuccess'))
    } else {
      await QlzgClientApi.updateClient(data)
      message.success(t('common.updateSuccess'))
    }
    dialogVisible.value = false
    emit('success')
  } finally {
    formLoading.value = false
  }
}

/** 重置表单 */
const resetForm = () => {
  formData.value = emptyForm()
  secretTouched.idCardNo = false
  secretTouched.contactMobile = false
  masked.idCardNo = ''
  masked.contactMobile = ''
  formRef.value?.resetFields()
}
</script>
