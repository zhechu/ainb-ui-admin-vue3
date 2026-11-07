<template>
  <Dialog v-model="dialogVisible" :title="dialogTitle" width="760">
    <el-alert
      v-if="platformPreset"
      type="warning"
      :closable="false"
      show-icon
      class="mb-16px"
      title="这是平台预置的数据源"
      description="它的授权范围与强制署名文本是平台统一签的合同条款，机构改不了、也删不了。要用它就在案例上直接选它；要改条款请另建一个本机构自己的数据源。"
    />
    <el-form
      ref="formRef"
      v-loading="formLoading"
      :model="formData"
      :rules="formRules"
      label-width="150px"
    >
      <el-form-item label="来源码" prop="sourceCode">
        <el-input
          v-model="formData.sourceCode"
          :disabled="formType === 'update'"
          placeholder="例如 ALI_AUCTION"
          maxlength="64"
          show-word-limit
          @input="onSourceCodeInput"
        />
        <FieldHint
          :text="
            formType === 'update'
              ? '建了就不能改：导入模板的「数据源」列填的是这个码，改了码，已经发出去的模板会全部报「数据源不存在」。要换码请新建一个、把旧的停用。'
              : '只能用大写字母、数字与下划线。它就是导入模板「数据源」那一列要填的值，所以这里写的和模板里写的必须是同一个串。'
          "
        />
      </el-form-item>
      <el-form-item label="来源名称" prop="sourceName">
        <el-input
          v-model="formData.sourceName"
          placeholder="例如 阿里拍卖"
          maxlength="128"
          show-word-limit
        />
      </el-form-item>
      <el-form-item label="数据源性质" prop="sourceType">
        <el-select v-model="formData.sourceType" placeholder="请选择数据源性质" class="w-full">
          <el-option
            v-for="item in CASE_PROVIDER_TYPE_OPTIONS"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
        <FieldHint
          text="这一栏决定报告里那句署名怎么拼（闸 G-10），也决定 R47 认不认这条案例的出处。它与案例台账筛选里的「来源类型」是两个不同的枚举，取值也不一样。"
        />
      </el-form-item>

      <!--
        🔴 只有第三方接口这一支才渲染，而且**懒加载**接口清单：
        那个端点要 `infra:data-interface:query`，与本页的 `qlzg:case-source:*` 不是一个权限族。
        一进弹窗就拉的话，没有那个权限的人每次打开都会吃到一条与本页无关的无权限红条，
        而他可能压根不打算登记 API 源
      -->
      <el-form-item
        v-if="formData.sourceType === 'THIRD_PARTY_API'"
        label="数据接口"
        prop="apiInterfaceId"
      >
        <el-select
          v-if="!interfaceDenied"
          v-model="formData.apiInterfaceId"
          :loading="interfaceLoading"
          placeholder="请选择数据接口"
          class="w-full"
          filterable
          clearable
        >
          <el-option
            v-for="item in interfaceOptions"
            :key="item.id"
            :label="`${item.name}（${item.code}）`"
            :value="item.id"
          />
        </el-select>
        <el-input-number
          v-else
          v-model="formData.apiInterfaceId"
          :min="1"
          :controls="false"
          placeholder="直接填数据接口编号"
          class="!w-240px"
        />
        <FieldHint text="只列出「启用中 + 读取型」的接口，所以选到的一定能跑。没有它，同步任务不知道去哪儿拉数据，而这个源会一直显示「启用」却一条案例也进不来。" />
        <el-alert
          v-if="interfaceDenied"
          type="warning"
          :closable="false"
          show-icon
          class="mt-8px"
          title="读不到数据接口清单，改成手填编号"
        >
          <div class="text-12px leading-20px">
            那个清单要「基础设施 → 数据接口」的<b>查询</b>权限，与本页的权限不是一个族，
            所以有本页权限的人不一定有它。编号可以在「基础设施 → 数据接口」列表的第一列看到；
            要让下拉框出现，请找管理员补授那一个权限点。
          </div>
        </el-alert>
      </el-form-item>

      <el-form-item label="原始来源直链模板" prop="originUrlPattern">
        <el-input
          v-model="formData.originUrlPattern"
          placeholder="例如 https://sf.taobao.com/item_detail.htm?id={id}"
          maxlength="500"
          show-word-limit
        />
        <FieldHint
          text="用 {id} 这类占位标出可变的那一段。只存一个域名首页等于没存——被质询时要给得出具体那一页，而不是一句「数据来自某某网站」。"
        />
      </el-form-item>
      <el-form-item label="强制署名文本" prop="attributionRequired">
        <el-input
          v-model="formData.attributionRequired"
          type="textarea"
          :rows="2"
          placeholder="许可方要求的原文，可直接进报告，例如 Source: DealStats, ⟨year⟩ (Portland, OR: BVR, LLC)"
          maxlength="500"
          show-word-limit
        />
        <FieldHint
          text="存的是可直接进报告的成品文本，不是一个字段名。报告附件会自动带出它（闸 G-10 / R47）——靠评估师记得手写，第一次交付就会漏，而漏的后果是违约，不是不好看。"
        />
      </el-form-item>
      <el-form-item label="授权范围" prop="licenseScopeText">
        <!--
          🔴 占位符里的双引号写成 &quot; 而不是把整个属性换成单引号：
             `vue/html-quotes` 要求属性一律双引号，而 JSON 示例里必须有双引号。
             用 :placeholder="'…'" 绑定也躲不开 —— HTML 属性先解析，
             JS 字符串里那个 \" 的反斜杠在属性上下文里不是转义，照样把属性截断
        -->
        <el-input
          v-model="formData.licenseScopeText"
          type="textarea"
          :rows="4"
          placeholder="JSON 对象，例如 {&quot;sublicense&quot;: false, &quot;territory&quot;: &quot;中国大陆&quot;}"
        />
        <FieldHint
          text="留空或写 {} 都表示「这一项没有授权条款」，两者存进库里是同一个东西。顶层必须是对象：写一段中文字符串上去，后端那一列是 Map，整个请求会失败，而这一栏那时已经滚出视野了。"
        />
      </el-form-item>
      <el-form-item label="更新频率" prop="updateFrequency">
        <el-input
          v-model="formData.updateFrequency"
          placeholder="例如 DAILY"
          maxlength="32"
          show-word-limit
        />
        <FieldHint
          text="本迭代只存不判：判定「这个源多久没更新了」要先有真实的更新失败数据才写得准，所以现在填什么都不影响任何计算，也没有下拉可选——刻意不给，免得下一个人把它当成枚举。"
        />
      </el-form-item>
      <el-form-item label="状态" prop="status">
        <el-switch v-model="formData.status" :active-value="1" :inactive-value="0" />
        <span class="ml-8px text-12px text-[var(--el-text-color-secondary)]">
          停用不删行：已经引用了这个源的历史案例仍然要能显示出处，停用只是不再允许新案例挂上来
        </span>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button :disabled="formLoading || platformPreset" type="primary" @click="submitForm">
        确 定
      </el-button>
      <el-button @click="dialogVisible = false">取 消</el-button>
    </template>
  </Dialog>
</template>
<script lang="ts" setup>
import { getReadOnlySimpleList, type DataInterfaceSimpleVO } from '@/api/infra/dataInterface'
import {
  QlzgCaseSourceApi,
  type QlzgCaseSourceSaveVO,
  type QlzgCaseSourceVO
} from '@/api/qlzg/caseSource'
import { CASE_PROVIDER_TYPE_OPTIONS } from '@/views/qlzg/constants'
import FieldHint from '@/views/qlzg/components/FieldHint.vue'
import {
  emptySourceForm,
  fromVO,
  normalizeSourceCode,
  parseLicenseScope,
  saveIssues,
  sourceCodeIssue,
  toSaveVO,
  type QlzgCaseSourceFormModel
} from './sourceSchema'

defineOptions({ name: 'QlzgCaseSourceForm' })

/**
 * 数据来源表单
 *
 * <h3>🔴 编辑态的数据来自**列表里的那一行**，不再打一次接口</h3>
 * 后端刻意<b>没有</b> {@code /get}：这份数据只有几十行，{@code /list} 已经把整行发下来了。
 * 再开一个 {@code /get} 就是同一条数据的第二条读路径 —— 两条路径里有一条忘了
 * {@code OR tenant_id IS NULL} 的话，表现是「列表里看得见、点编辑说不存在」，
 * 而真实原因是「这是平台预置行」。
 *
 * <h3>🔴 判定逻辑一律在 {@code sourceSchema.ts}，这里只做渲染</h3>
 * 本仓 vitest 是 {@code environment: 'node'}，{@code .vue} 文件一个测试都跑不了。
 * 所以 el-form 的 validator 全部<b>委托</b>给那个纯模块，而不是在这里重写一遍 ——
 * 重写一遍的结果是「界面上能提交、纯模块的测试全绿」，两边各说一套。
 *
 * <h3>🔴 {@code saveIssues} 在 submit 里又跑了一次，不是不信任 el-form</h3>
 * el-form 的 rules 是<b>逐栏</b>的，而「性质改成第三方接口就必须选接口编号」这一条
 * 挂在 {@code apiInterfaceId} 那一栏上；性质刚改过来、那一栏还没失焦时，
 * el-form 不一定会重跑它。所以最后过一遍整表的闸门，
 * 拦住了就用 message 说清是哪几条 —— 与案例录入向导的 {@code finalIssues} 同一条纪律。
 */

const { t } = useI18n()
const message = useMessage()

const dialogVisible = ref(false)
const dialogTitle = ref('')
const formLoading = ref(false)
const formType = ref('create')
const formRef = ref()

const formData = ref<QlzgCaseSourceFormModel>(emptySourceForm())
/** 库里的原码，只用来判「有没有改码」 */
const originalCode = ref<string | undefined>(undefined)
/** 平台预置行：整张表单只读，确定键灰掉 */
const platformPreset = ref(false)

const formRules = reactive({
  sourceCode: [
    {
      validator: (_rule: any, value: string, callback: (error?: Error) => void) => {
        const issue = sourceCodeIssue(value, originalCode.value)
        callback(issue ? new Error(issue) : undefined)
      },
      trigger: 'blur'
    }
  ],
  sourceName: [{ required: true, message: '来源名称不能为空', trigger: 'blur' }],
  sourceType: [{ required: true, message: '数据源性质不能为空', trigger: 'change' }],
  apiInterfaceId: [
    {
      validator: (_rule: any, value: number | null, callback: (error?: Error) => void) => {
        const needed = formData.value.sourceType === 'THIRD_PARTY_API' && !value
        callback(needed ? new Error('必须选一个数据接口，或者直接填它的编号') : undefined)
      },
      trigger: 'change'
    }
  ],
  licenseScopeText: [
    {
      validator: (_rule: any, value: string, callback: (error?: Error) => void) => {
        const issue = parseLicenseScope(value).issue
        callback(issue ? new Error(issue) : undefined)
      },
      trigger: 'blur'
    }
  ]
})

/**
 * 边敲边转大写
 *
 * 🔴 用 {@link normalizeSourceCode} 而不是 {@code value.toUpperCase()}：
 *    后者在土耳其语浏览器上会把 {@code i} 变成带点的 {@code İ}，
 *    存进去就是一个匹配不上的码，而报错只会说「数据源不存在」。
 *    纯模块里那一支有测试钉着，这里直接调它
 */
const onSourceCodeInput = (value: string) => {
  formData.value.sourceCode = normalizeSourceCode(value)
}

/** 数据接口清单：懒加载 + 跨权限族降级 */
const interfaceOptions = ref<DataInterfaceSimpleVO[]>([])
const interfaceLoading = ref(false)
const interfaceDenied = ref(false)
const interfaceLoaded = ref(false)

const loadInterfaces = async () => {
  // 🔴 两个守卫都要：`interfaceLoaded` 只在请求**结束之后**才置上，
  //    而 open() 与 sourceType 的 watch 可能在同一轮里各调一次 ——
  //    少了 in-flight 这一半就会打出两个并发请求
  if (interfaceLoaded.value || interfaceLoading.value) return
  interfaceLoading.value = true
  try {
    interfaceOptions.value = await getReadOnlySimpleList()
  } catch {
    // 🔴 这个端点要 `infra:data-interface:query`，与本页的 `qlzg:case-source:*` 不是一个权限族。
    //    axios 拦截器已经把「无权限」弹成红条了，这里再补一个**留在界面上**的降级：
    //    红条三秒就消失，而用户接下来要面对的是一个空下拉框 —— 空的框不会解释自己为什么空
    interfaceDenied.value = true
  } finally {
    // 🔴 不管成败都置成已加载：失败之后每改一次性质就再打一次、再弹一次红条，
    //    而结果不会因为多打几次就变
    interfaceLoaded.value = true
    interfaceLoading.value = false
  }
}

watch(
  () => formData.value.sourceType,
  (type) => {
    if (type === 'THIRD_PARTY_API') {
      loadInterfaces()
      return
    }
    // 🔴 换成别的性质就把编号清掉：后端也会清（validateSourceType 的返回值），
    //    但界面上得先让用户看见「这一栏没了」，而不是提交之后才发现库里被改了什么
    formData.value.apiInterfaceId = null
  }
)

/** 打开弹窗 */
const open = (type: string, row?: QlzgCaseSourceVO) => {
  dialogVisible.value = true
  dialogTitle.value = t('action.' + type)
  formType.value = type
  resetForm()
  if (row) {
    formData.value = fromVO(row)
    originalCode.value = row.sourceCode
    platformPreset.value = row.platformPreset === true
  }
  if (formData.value.sourceType === 'THIRD_PARTY_API') loadInterfaces()
  formRef.value?.clearValidate()
}
defineExpose({ open })

/** 提交表单 */
const emit = defineEmits(['success'])
const submitForm = async () => {
  if (!formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return
  const issues = saveIssues(formData.value)
  if (issues.length > 0) {
    message.error(issues.join('；'))
    return
  }
  formLoading.value = true
  try {
    const data: QlzgCaseSourceSaveVO = toSaveVO(formData.value)
    if (formType.value === 'create') {
      await QlzgCaseSourceApi.createCaseSource(data)
      message.success(t('common.createSuccess'))
    } else {
      await QlzgCaseSourceApi.updateCaseSource(data)
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
  formData.value = emptySourceForm()
  originalCode.value = undefined
  platformPreset.value = false
  interfaceOptions.value = []
  interfaceDenied.value = false
  interfaceLoaded.value = false
  interfaceLoading.value = false
}
</script>
