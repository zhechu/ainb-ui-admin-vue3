<template>
  <!--
    🔴 不加 append-to-body：EP 的 el-drawer 默认 appendToBody=false，
    加了之后抽屉会被 teleport 出本组件的 scoped 边界，下面那几条 :deep(.el-drawer__*)
    会**静默失效**（不报错，只是不生效）——正文整体滚、树缩回 200px。
    真的需要挂到 body 上时，改用 ConversationGroupSide.vue 那套 modal-class + 全局 CSS
  -->
  <el-drawer
    v-model="drawerVisible"
    :close-on-click-modal="false"
    :title="drawerTitle"
    size="min(1000px, 92vw)"
  >
    <!--
      🔴 <el-form> 必须包住**两列**，包括左列那个资源选择器。
      EP 的规则注册发生在 el-form-item 挂载时向 formItemContext 上报，
      picker 一旦被挪到 el-form 外面，`resourceId` 的 required 规则就根本没进表单，
      validate() 会放行 undefined —— 于是提交出 resourceId 为空的脏授权。
      buildEmptyForm 里那句「必须是 undefined 而不是 0」的注释正是为这个坑写的，
      规则一丢就白修了
    -->
    <el-form
      ref="formRef"
      v-loading="formLoading"
      :model="formData"
      :rules="formRules"
      class="flex min-h-0 flex-1 gap-16px"
      label-width="96px"
    >
      <!-- 左列：资源树 -->
      <div class="flex min-h-0 w-420px shrink-0 flex-col">
        <el-form-item class="picker-item" label="资源" label-position="top" prop="resourceId">
          <ResourceTreePicker
            ref="pickerRef"
            :disabled="!!formData.id"
            :include-field-level="includeFieldLevel"
            :model-value="formData.resourceId"
            :tree="resourceTree"
            @update:include-field-level="onIncludeFieldLevelChange"
            @update:model-value="onResourceSelected"
          />
        </el-form-item>
        <!--
          选中项的完整层级。资源名严重重复（本库「角色管理」有 8 个），
          树里一行只有名称 + 权限串，看不出它长在哪一层；
          ResourceVO.path 是**权限串**的物化路径，拼不出人能读的名称层级，
          只能沿 parentId 走 resourceById 上溯
        -->
        <div
          v-if="selectedResource"
          class="shrink-0 border-t border-t-solid border-[var(--el-border-color-lighter)] pt-8px"
        >
          <div class="text-12px leading-relaxed text-[var(--el-text-color-regular)]">
            <template v-for="(item, index) in breadcrumb" :key="item.id">
              <span v-if="index" class="mx-3px text-gray-300">/</span>
              <span :class="index === breadcrumb.length - 1 ? 'font-bold' : ''">
                {{ item.name }}
              </span>
            </template>
          </div>
          <div class="mt-2px break-all text-11px text-gray-400">
            {{ selectedResource.permission || '（无权限标识）' }} ·
            {{ formatResourceType(selectedResource.type) }}
          </div>
        </div>
      </div>

      <!-- 右列：授权参数 -->
      <div class="min-w-0 flex-1 overflow-y-auto pr-4px">
        <el-form-item prop="action">
          <template #label>
            <span class="inline-flex items-center">动作<GrantActionHelp /></span>
          </template>
          <el-select v-model="formData.action" class="w-full" placeholder="请选择动作">
            <el-option-group :label="GRANT_ACTION_GROUP_LABELS.effective">
              <el-option
                v-for="a in actionGroups.effective"
                :key="a.value"
                :label="a.label"
                :value="a.value"
              />
            </el-option-group>
            <el-option-group
              v-if="actionGroups.reserved.length"
              :label="GRANT_ACTION_GROUP_LABELS.reserved"
            >
              <el-option
                v-for="a in actionGroups.reserved"
                :key="a.value"
                :label="a.label"
                :value="a.value"
              />
            </el-option-group>
          </el-select>
          <!--
            分组标题上那句「配了不生效」只在下拉展开时看得见，选完就收起来了。
            这条常驻警告补的就是那个空档：保存会成功、权限不会生效，
            点「确定」之前必须有一处地方一直提醒着
          -->
          <el-alert
            v-if="actionWarning"
            :closable="false"
            class="mt-4px w-full !py-4px"
            show-icon
            type="warning"
          >
            <div class="text-12px leading-snug">{{ actionWarning }}</div>
          </el-alert>
        </el-form-item>
        <el-form-item label="效果" prop="effect">
          <el-radio-group v-model="formData.effect">
            <el-radio value="ALLOW">允许</el-radio>
            <el-radio value="DENY">拒绝</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="行过滤规则">
          <el-select
            v-model="formData.ruleId"
            class="w-full"
            clearable
            placeholder="不绑定（该主体不受行限制）"
          >
            <el-option v-for="r in ruleList" :key="r.id" :label="r.name" :value="r.id">
              <span>{{ r.name }}</span>
              <span class="ml-8px text-11px text-gray-400">{{ r.description }}</span>
            </el-option>
          </el-select>
        </el-form-item>
        <el-form-item label="字段显示模式">
          <el-select
            v-model="formData.fieldMode"
            :disabled="!isFieldLevelResource"
            :placeholder="isFieldLevelResource ? '不限制' : '仅对「列/字段」类资源有效'"
            class="w-full"
            clearable
          >
            <!-- ⚠️ value 必须与后端 FieldModeEnum 完全一致：EDITABLE / READONLY / HIDDEN，
                 写成 VISIBLE 会被引擎整行过滤掉——「保存成功但不生效」 -->
            <el-option label="可编辑 (EDITABLE)" value="EDITABLE" />
            <el-option label="只读 (READONLY)" value="READONLY" />
            <el-option label="隐藏 (HIDDEN)" value="HIDDEN" />
          </el-select>
        </el-form-item>
        <el-form-item label="到期时间">
          <el-date-picker
            v-model="formData.expireTime"
            :default-time="defaultExpireTime"
            class="w-full"
            clearable
            placeholder="不填=永不过期；清空可取消到期时间"
            type="datetime"
            value-format="YYYY-MM-DD HH:mm:ss"
          />
        </el-form-item>
        <!-- 不绑规则时说清楚它的含义，这一条直接决定多角色合并的结果 -->
        <el-alert
          v-if="!formData.ruleId && formData.effect === 'ALLOW'"
          :closable="false"
          show-icon
          type="info"
        >
          未绑定行过滤规则 = 该主体可以看到这张表的<b>全部行</b>。
          用户拥有多个角色时，只要有一个角色是「不受限」，合并结果就是不受限。
        </el-alert>
      </div>
    </el-form>
    <template #footer>
      <el-button :disabled="formLoading" type="primary" @click="submitForm">确 定</el-button>
      <el-button @click="drawerVisible = false">取 消</el-button>
    </template>
  </el-drawer>
</template>
<script lang="ts" setup>
import dayjs from 'dayjs'
import * as GrantApi from '@/api/system/grant'
import type { GrantVO, GrantSaveReqVO, RuleVO } from '@/api/system/grant'
import {
  GRANT_ACTION_GROUP_LABELS,
  formatResourceType,
  grantActionGroupsFor,
  isGrantActionAllowed,
  reservedActionWarning
} from '@/views/system/resource/constants'
import GrantActionHelp from '@/views/system/resource/components/GrantActionHelp.vue'
import ResourceTreePicker from './ResourceTreePicker.vue'
import { useResourceCatalog } from './useResourceCatalog'
import { resourceBreadcrumb } from './resourceTree'
import { confirmPastExpireTime } from './batchGrant'

defineOptions({ name: 'SystemRoleGrantForm' })

const message = useMessage()

/** 只选日期不选时间时，默认到当天 23:59:59 —— 「有效期到某天」的直觉是含当天全天 */
const defaultExpireTime = new Date(2000, 0, 1, 23, 59, 59)

const drawerVisible = ref(false)
const drawerTitle = ref('')
const formLoading = ref(false)
const formRef = ref()
const pickerRef = ref()

/** 主体固定由打开方传入（角色授权页 = ROLE + roleId） */
const subject = ref({ subjectType: 'ROLE', subjectRefId: undefined as number | undefined })

const buildEmptyForm = (): GrantSaveReqVO => ({
  subjectType: 'ROLE',
  subjectRefId: subject.value.subjectRefId,
  // ⚠️ 必须是 undefined 而不是 0：EP 的 required 校验把 0 当「已填」，
  // 用 0 做初值时不选资源也能通过校验，提交出 resourceId=0 的脏授权
  resourceId: undefined as unknown as number,
  action: 'VIEW',
  effect: 'ALLOW'
})

const formData = ref<GrantSaveReqVO>(buildEmptyForm())
const formRules = {
  resourceId: [{ required: true, message: '请选择资源', trigger: 'change' }],
  action: [{ required: true, message: '请选择动作', trigger: 'change' }],
  effect: [{ required: true, message: '请选择效果', trigger: 'change' }]
}

/** 打开抽屉：type = create / update；row 仅 update 时传 */
const open = async (type: 'create' | 'update', subjectRefId: number, row?: GrantVO) => {
  subject.value = { subjectType: 'ROLE', subjectRefId }
  drawerTitle.value = type === 'create' ? '新增授权' : '编辑授权'
  drawerVisible.value = true
  formLoading.value = true
  try {
    if (type === 'create') {
      formData.value = buildEmptyForm()
    } else if (row) {
      formData.value = {
        id: row.id,
        subjectType: row.subjectType,
        subjectRefId: row.subjectRefId,
        subjectCode: row.subjectCode,
        resourceId: row.resourceId,
        contextResourceId: row.contextResourceId,
        action: row.action,
        effect: row.effect,
        ruleId: row.ruleId,
        fieldMode: row.fieldMode,
        // 后端返回毫秒数，date-picker 带 value-format 时只认格式化字符串，直接塞数字会回显空白
        expireTime: row.expireTime ? dayjs(row.expireTime).format('YYYY-MM-DD HH:mm:ss') : undefined
      }
    }
    await Promise.all([ensureLoaded(), loadRules()])
    // ⚠️ 抽屉不加 destroy-on-close（见 useResourceCatalog 的注释），useResourceCatalog
    // 与它那份 includeFieldLevel 常驻在 setup 里，跨开关存活。
    // 上一次编辑字段级资源会把开关打开，新增时得复位，否则树里全是列/字段噪声
    if (type === 'create' && includeFieldLevel.value) {
      includeFieldLevel.value = false
      await reloadResourceTree()
    }
    // 编辑时如果绑的是字段级资源，自动把字段级资源加载进来，否则树里找不到、回显不了
    if (formData.value.resourceId && !resourceById.value.has(formData.value.resourceId)) {
      includeFieldLevel.value = true
      await reloadResourceTree()
    }
    // 数据到位之后才收/展树：reloadResourceTree 换掉 resourceTree.value 的身份会触发
    // el-tree-v2 的 watch(props.data) → setData + setExpandedKeys([])，
    // 在它之前做的任何展开都会被冲掉
    await nextTick()
    // reset() 在 reveal() 之前：reset 全收，reveal 只展开回显那一条路径
    pickerRef.value?.reset()
    if (formData.value.resourceId) {
      await pickerRef.value?.reveal(formData.value.resourceId)
    }
    nextTick(() => formRef.value?.clearValidate())
  } finally {
    formLoading.value = false
  }
}
defineExpose({ open })

// -------- 资源树 / 规则列表（与主体无关，一次页面停留只拉一次） --------

// 数据层与批量授权抽屉共用一份，见 useResourceCatalog 的注释
const { resourceTree, includeFieldLevel, resourceById, ensureLoaded, reloadResourceTree } =
  useResourceCatalog()

const ruleList = ref<RuleVO[]>([])
const rulesLoaded = ref(false)
const loadRules = async () => {
  if (rulesLoaded.value) return
  ruleList.value = await GrantApi.getSimpleRuleList()
  rulesLoaded.value = true
}

const onIncludeFieldLevelChange = async (value: boolean) => {
  includeFieldLevel.value = value
  await reloadResourceTree()
  // 过滤态与勾选态由 ResourceTreePicker 自己那条 watch(props.tree) 兜住；
  // 这里只需要补一件它管不了的事：换数据源会重置展开度，
  // 编辑态下那条回显路径得重新展开一次，否则用户切个开关就把高亮弄丢了
  await nextTick()
  if (formData.value.resourceId) {
    await pickerRef.value?.reveal(formData.value.resourceId)
  }
}

// -------- 资源选中 --------

const selectedResource = computed(() =>
  formData.value.resourceId ? resourceById.value.get(formData.value.resourceId) : undefined
)
const breadcrumb = computed(() =>
  selectedResource.value ? resourceBreadcrumb(selectedResource.value, resourceById.value) : []
)
/** fieldMode 只对 COLUMN/FIELD 资源有意义，配到 ACTION 上属于无效配置，直接禁掉 */
const isFieldLevelResource = computed(() => {
  const r = selectedResource.value
  return !!r && ['COLUMN', 'FIELD'].includes(r.type)
})
/** 动作下拉的可选项随资源类型变：流程专属动作只在流程/分类上开放 */
const actionGroups = computed(() =>
  grantActionGroupsFor(selectedResource.value?.type, formData.value.action)
)
/** 选了不生效的动作时给一句常驻警告，见 reservedActionWarning */
const actionWarning = computed(() => reservedActionWarning(formData.value.action))

const onResourceSelected = (value: number | number[] | undefined) => {
  const id = typeof value === 'number' ? value : undefined
  formData.value.resourceId = id as number
  const node = id ? resourceById.value.get(id) : undefined
  if (!node) return
  // 换到非字段级资源时清掉 fieldMode，避免上次的残留被提交上去
  if (!['COLUMN', 'FIELD'].includes(node.type)) {
    formData.value.fieldMode = undefined
  }
  // 动作同理：换资源之后原来那个动作可能在新资源上不开放（从流程切到菜单，START 就没意义了）。
  // 这里重置是安全的 —— 是用户主动换的资源，不是在回显一条既有授权行
  if (!isGrantActionAllowed(formData.value.action, node.type)) {
    formData.value.action = 'VIEW'
  }
  // 🔴 el-select 一走，change 校验就没人触发了：EP 的 trigger:'change' 是各输入组件自己调
  // formItem.validate('change')（见 useSelect 里那条 watch(modelValue)），
  // el-form-item 自己不监听值。不补这一句，「不选资源点确定」出来的那行红字
  // 在选中之后**不会消失**，看着像校验坏了
  //
  // ⚠️ 不要改成 watch(() => formData.value.resourceId)：它在 open('update') 回显时也会触发，
  // 正好把上面那句 clearValidate() 想压掉的噪声放回来。
  // 先例见 ChannelMessageSendForm#handleReceiverUserChange
  formRef.value?.validateField('resourceId')
}

// -------- 提交 --------

const emit = defineEmits<{ success: [] }>()

const submitForm = async () => {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  // 到期时间填了过去的时间 = 保存即「已过期」，几乎一定是手误，先问一句
  if (!(await confirmPastExpireTime(formData.value.expireTime))) return
  formLoading.value = true
  try {
    if (formData.value.id) {
      await GrantApi.updateGrant(formData.value)
      message.success('修改成功')
    } else {
      await GrantApi.createGrant(formData.value)
      // ⚠️ 不写「新增成功」：/create 已经是 upsert 语义，撞上同「主体+资源+动作+上下文」
      // 的既有行时会覆盖它而不是插新行，说「新增」是在对操作者撒谎
      message.success('保存成功')
    }
    drawerVisible.value = false
    emit('success')
  } finally {
    formLoading.value = false
  }
}
</script>
<style lang="scss" scoped>
// 🔴 下面三条 :deep() 只在**没有** append-to-body 时生效。
// 加了 append-to-body，抽屉被 teleport 出 scoped 边界，这三条会静默失效（不报错）
//
// 正文默认是 flex:1 + overflow:auto：整块会跟着内容一起滚，滚动条一出现，
// 虚拟化树量到的高度就跟着漂。改成纵向 flex 且 overflow:hidden，
// 滚动分别交给右列（overflow-y-auto）与树自己（el-tree-v2 内部那个虚拟列表）
:deep(.el-drawer__body) {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

// EP 默认给 header 32px 下边距，那是给「一屏放得下的说明文」留的呼吸；
// 这里每一像素都要让给树
:deep(.el-drawer__header) {
  padding-bottom: 12px;
  margin-bottom: 0;
  border-bottom: 1px solid var(--el-border-color);
}

// footer 默认没有分隔线，共用的 Dialog 壳是有的，补上让两个入口观感一致
:deep(.el-drawer__footer) {
  border-top: 1px solid var(--el-border-color);
}

// label-position="top" 会把 form-item 变成 display:block（EP 的 .el-form-item--label-top）。
// 这里要它撑满左列高度，就得改回纵向 flex，并把 content 的换行关掉（下面 flex-flow 里的 nowrap）——
// 会换行的容器里，子项拿到的高度不再是「这一列剩下的全部」，picker 的测高也就测不到东西
.picker-item {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  margin-bottom: 0;

  :deep(.el-form-item__content) {
    display: flex;
    flex: 1;
    flex-flow: column nowrap;
    min-height: 0;
    // EP 默认 32px，会把面包屑那行的行高顶歪
    line-height: normal;
  }
}
</style>
