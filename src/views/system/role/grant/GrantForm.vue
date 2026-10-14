<template>
  <!--
    🔴 不加 append-to-body：EP 的 el-drawer 默认 appendToBody=false，
    加了之后抽屉会被 teleport 出本组件的 scoped 边界，下面那几条 :deep(.el-drawer__*)
    会**静默失效**（不报错，只是不生效）——header 那条 32px 下边距和两条分隔线都会回来，
    正文也会多一层滚动条。树高不受影响（它由 el-form 上的 h-full 保证，见下面那段注释）。

    ⚠️ 换成下面那个穿透模式（modal=false + modal-penetrable）也**不需要** append-to-body ——
    ElTeleport 的 disabled 只看 appendToBody，与 modal 无关。所以那几条 :deep() 一条没失效。
    （穿透通常要配 body 挂载，那种写法才会踩上面这个坑；EP 自带的
    `.el-modal-drawer.is-penetrable` 那两条 CSS 让这里不必如此。
    真需要挂到 body 上时，改用 ConversationGroupSide.vue 那套 modal-class + 全局 CSS，
    或者用 el-drawer 自带的 bodyClass / headerClass / footerClass 三个 prop）
  -->
  <!--
    🔴 非模态穿透：`:modal="false"` 与 `modal-penetrable` **必须成对**，少一个都不生效 ——
    EP 那边是 `penetrable = modalPenetrable && !modal`，成立才给 overlay 加上 is-penetrable，
    而 theme-chalk 里正是 `.el-modal-drawer.is-penetrable { pointer-events: none }` 配
    `.el-modal-drawer.is-penetrable .el-drawer { pointer-events: auto }` 这两条。

    效果是：后面的授权列表页**不变暗**（mask=false 时 overlay 不铺背景色）、**可以点**。
    一边配授权、一边回头查这个权限标识已经授过什么，是遮罩模式下做不到的 ——
    那时候抽屉盖住的地方一个事件都进不去。

    ⚠️ 代价在 index.vue 那边付：列表页可点之后，「编辑」「新增授权」「批量授权」
    会静默替换掉这里正在填的内容，「删除」「批量删除」会在授权进行中删行。
    那五个按钮由 index.vue 的 drawerOpen 在本抽屉开着期间禁用；
    搜索、重置、五个查询条件、翻页**保持可用**，那才是要够到的东西。

    ⚠️ 已知边界，不是 bug：抽屉仍被 EP 的 focus-trap 包着（`loop` + `trapped: visible`），
    所以鼠标能点后面的页面，**Tab 键不能** —— 键盘焦点仍锁在抽屉内。改它要动 EP 内部，不值当。

    ⚠️ 下面那个 `:close-on-click-modal="false"` 在穿透模式下**是惰性的**：
    它由绑在 overlay 上的 onModalClick 触发，而 overlay 已经 pointer-events: none，
    永远收不到点击。留着它是为了哪天把 modal 打开时，不会退回「误点遮罩毁掉一整份表单」。

    🔴 但 `:close-on-press-escape="false"` 在穿透模式下**一点都不惰性，必须显式关掉**。
    与遮罩点击不同，Esc 不是从 overlay 上收的：EP 的 focus-trap 走 useEscapeKeydown，
    那个 hook 把监听器挂在 **document** 上（`document.addEventListener('keydown', ...)`），
    链路是 document 上的 Esc → focus-trap emit release-requested → 抽屉的 onCloseRequested →
    `if (props.closeOnPressEscape) handleClose()`，而 closeOnPressEscape 的出厂默认是 true。
    于是「穿透」这件事把 Esc 变成了一个陷阱：操作者正在**后面那张列表页**上核对权限标识
    （这正是穿透要交付的能力），随手按一下 Esc —— 想关掉的是别的东西 ——
    抽屉连同填了一半的表单一起没了，没有草稿、没有撤销。
    与 Tab 那条「已知边界」的区别就在这里：Tab 锁焦点只是不方便，Esc 会**毁掉工作**，
    所以那条记下来忍了，这条必须关掉。关掉之后关抽屉仍然有两个入口：
    header 右上那个关闭图标（EP 的 show-close，默认就有）与底部「取消」按钮
  -->
  <!--
    `resizable` 让 EP 在抽屉左缘渲染一个 8px 宽的拖拽柄（hover 亮 3px 主题色条，cursor 是 ew-resize）。
    为什么必须有它：宽度写死是个常数，而它该是个变量 —— 同一块面板，
    资源多的时候嫌窄（树里 permission 串被截断）、要回头看列表的时候嫌宽（把列表全盖住）。
    下限由下面的 onDrawerResizeEnd 夹，EP 的 useResizable 只夹到 [4, 窗口宽]，没有下限。
  -->
  <el-drawer
    v-model="drawerVisible"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    :modal="false"
    :size="drawerSize"
    :title="drawerTitle"
    modal-penetrable
    resizable
    @closed="emit('closed')"
    @resize-end="onDrawerResizeEnd"
  >
    <!--
      🔴 <el-form> 必须包住**两列**，包括左列那个资源选择器。
      EP 的规则注册发生在 el-form-item 挂载时向 formItemContext 上报，
      picker 一旦被挪到 el-form 外面，`resourceId` 的 required 规则就根本没进表单，
      validate() 会放行 undefined —— 于是提交出 resourceId 为空的脏授权。
      buildEmptyForm 里那句「必须是 undefined 而不是 0」的注释正是为这个坑写的，
      规则一丢就白修了
    -->
    <!--
      🔴 class 里的 h-full 是承重的，别当成与 flex-1 重复而删掉。

      这个 <form> 是 .el-drawer__body 的**直接子元素**，而 body 的高度由 EP 自己确定
      （.el-drawer 是 height: 100% 的纵向 flex，body 是它 flex: 1 的子项），
      所以 height: 100% 一跳就解析成功 —— 不依赖下面那条 :deep(.el-drawer__body)。

      那条覆盖要生效，得让本组件的 scopeId 穿过 ElTeleport → Transition → ElOverlay
      三层落到 div.el-overlay 上；一旦没落上，body 保持 display: block，
      它下面所有 flex-1 全部变成空操作，高度一路退化成「由内容决定」，
      树最终停在 ResourceTreePicker#treeHeight 的 160px 下限
      —— 132 个根节点里只露约 6 个，而这件事**不报错**。
      反过来，那条 :deep() 真生效时（body 变成 flex column）起作用的是 flex-1，
      两者互不冲突，各覆盖一种可能
    -->
    <el-form
      ref="formRef"
      v-loading="formLoading"
      :model="formData"
      :rules="formRules"
      class="flex h-full min-h-0 flex-1 gap-16px"
      label-width="96px"
    >
      <!--
        左列：资源树。它才是这个抽屉的主体，所以由它吃掉全部剩余宽度。
        min-w-0 是必需的 —— 树行里的 permission 串很长，没有它 flex-1 会被内容顶开，
        右列那个固定宽就被挤走了。

        默认宽度下这一列约 604px（抽屉 1120 − body 左右内边距 40 − 两列间距 16 − 右列 460），
        拖到下限 760px 时约 244px。改抽屉宽度或右列宽度时这两个数要重新算一遍
      -->
      <div class="flex min-h-0 min-w-0 flex-1 flex-col">
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

      <!--
        右列：授权参数。五个短控件，给固定宽，把剩余宽度全留给左边那棵树 ——
        树才是这个抽屉的主体，反过来让字段列吃 flex-1 会使比例与内容体量倒挂。
        460px 的来源：日期选择器约 220px + label-width 96px，再留一点余量
      -->
      <div class="w-460px shrink-0 overflow-y-auto pr-4px">
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
          <!--
            🔴 :disabled 必须带 && !formData.ruleId：编辑一条 ruleId 挂在非 DATASET 资源上的
            历史行时，纯 !isDatasetResource 会让用户看得到却清不掉 —— 而列表页一直显示那个
            ruleName，看着像「配了个限制」，其实是死字段。
            与下面 fieldMode 那处的差别就在于此：fieldMode 是「无效值本就不该存在」，
            这里要留一条把既有的无效值摘掉的路
          -->
          <el-select
            v-model="formData.ruleId"
            :disabled="!isDatasetResource && !formData.ruleId"
            :placeholder="
              isDatasetResource ? '不绑定（该主体不受行限制）' : '仅对「数据集」类资源有效'
            "
            class="w-full"
            clearable
          >
            <el-option v-for="r in ruleOptions" :key="r.id" :label="r.name" :value="r.id">
              <span>{{ r.name }}</span>
              <span class="ml-8px text-11px text-gray-400">{{ r.description }}</span>
            </el-option>
          </el-select>
          <el-alert
            v-if="ruleWarning"
            :closable="false"
            :type="ruleWarning.type"
            class="mt-4px w-full !py-4px"
            show-icon
          >
            <div class="text-12px leading-snug">{{ ruleWarning.text }}</div>
          </el-alert>
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
        <!--
          不绑规则时说清楚它的含义，这一条直接决定多角色合并的结果。
          加 isDatasetResource 是因为「这张表」只有数据集才有 ——
          对着一个菜单资源说「可以看到这张表的全部行」是把行过滤的适用范围讲错了
        -->
        <el-alert
          v-if="!formData.ruleId && isDatasetResource && formData.effect === 'ALLOW'"
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
  isRowFilterableResource,
  reservedActionWarning
} from '@/views/system/resource/constants'
import GrantActionHelp from '@/views/system/resource/components/GrantActionHelp.vue'
import { useRuleTemplateMeta } from '@/views/system/rule/useRuleTemplateMeta'
import ResourceTreePicker from './ResourceTreePicker.vue'
import { useResourceCatalog } from './useResourceCatalog'
import { useSlotCoverage } from './useSlotCoverage'
import { resourceBreadcrumb } from './resourceTree'
import { computeRuleSlotCoverage, confirmPastExpireTime } from './batchGrant'

defineOptions({ name: 'SystemRoleGrantForm' })

/**
 * `success` = 提交成功，index.vue 拿去刷新列表。
 *
 * `closed` = 抽屉收起动画**结束**，index.vue 拿去解禁那五个按钮
 * （穿透模式下列表页是可点的，见模板顶部那段注释）。
 * 🔴 转发的是 el-drawer 的 `closed` 而不是 `close`：后者在收起动画**开始**时就触发，
 * 那一刻抽屉还盖在列表页上，按钮提前活过来会让人点到看不见的东西。
 *
 * 声明放在最上面而不是「提交」那一段里，是因为模板里就引用了它
 */
const emit = defineEmits<{ success: []; closed: [] }>()

const message = useMessage()

/** 只选日期不选时间时，默认到当天 23:59:59 —— 「有效期到某天」的直觉是含当天全天 */
const defaultExpireTime = new Date(2000, 0, 1, 23, 59, 59)

const drawerVisible = ref(false)
const drawerTitle = ref('')
const formLoading = ref(false)
const formRef = ref()
const pickerRef = ref()

/**
 * 抽屉宽度。初值是响应式表达式，一旦被拖过就变成固定的 px（那是操作者自己挑的宽度，
 * 不该再跟着窗口变）。抽屉不加 destroy-on-close，所以拖出来的宽度会在一次页面停留内
 * 跨开关存活 —— 这是刻意的（记住偏好），刷新页面才回到初值
 */
const drawerSize = ref('min(1120px, 86vw)')

/**
 * 拖拽柄的宽度下限：右列 460 + 两列间距 16 + body 左右内边距 40 + 树至少 244。
 *
 * 🔴 EP 的 useResizable 只把尺寸夹在 [4, 窗口宽]，**没有下限** —— 一路往右拖能把抽屉收成
 * 4px 的一条线：header 的关闭按钮与 footer 的「取消」都点不到，右列那个 w-460px shrink-0
 * 还会让整块横向溢出。剩下能救自己的只有 ESC 与那个 8px 的拖拽柄。
 *
 * 🔴 为什么在 resize-end 里夹、而不是写一条 CSS min-width：min-width 得打在 .el-drawer 上，
 * 而 scoped 样式的 scopeId 只保证落到子组件的**根节点** —— 这里是 ElTeleport → Transition →
 * ElOverlay 三层之后的 div.el-overlay，还能不能再穿到 .el-drawer 取决于 EP 的内部结构
 * （模板顶部那段注释正是在为这件事兜底）。宽度下限是拖拽的安全网，不该建在那个不确定性上。
 *
 * ⚠️ 副作用：拖动过程中能拖到下限以下，**松手才弹回** 760px。
 * 改 props.size 会让 useResizable 复位它自己的拖拽状态（hasStartedDragging / startSize / offset），
 * 所以下一次拖动是从弹回后的真实宽度起算的，不会累积漂移。
 *
 * 上限那道 `window.innerWidth` 不是防御性冗余：EP 夹的是它自己算出来的尺寸，
 * 而这里写回的是 props.size，在比 760px 还窄的窗口上不做这道就会写出一个比视口还宽的抽屉
 */
const DRAWER_MIN_WIDTH = 760
const onDrawerResizeEnd = (_evt: MouseEvent, size: number) => {
  drawerSize.value = `${Math.max(Math.min(DRAWER_MIN_WIDTH, window.innerWidth), size)}px`
}

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
    // 每次打开都归位：抽屉不加 destroy-on-close，这个 ref 跨开关存活，
    // 上一次编辑的规则名会被下一次带过去（见 editingRuleName 的注释）
    editingRuleName.value = undefined
    if (type === 'create') {
      formData.value = buildEmptyForm()
    } else if (row) {
      editingRuleName.value = row.ruleName
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
    // 四件事并行，彼此无依赖：资源树、启用规则列表、槽位映射全量、规则模板元数据。
    // 槽位与模板都是「一次页面停留只拉一次」（见 useSlotCoverage / useRuleTemplateMeta），
    // 且**与选了哪个规则无关** —— 放在这里而不是 watch(ruleId) 里，
    // 快速切换规则时的请求竞态就从「要处理」变成「结构上不存在」
    await Promise.all([ensureLoaded(), loadRules(), ensureSlotsLoaded(), loadRuleTemplateMeta()])
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

/**
 * 编辑态回显用的规则名，来自 GrantVO#ruleName（后端在 enrichment 时填的快照）。
 *
 * 存在的原因：getSimpleRuleList 只返**启用**规则（后端 RuleAdminController#getSimpleRuleList
 * 带 .eq(RuleDO::getStatus, 0)），所以一条授权行绑的规则一旦被停用或被删，
 * 它就不在 ruleList 里，而 el-select 找不到匹配 option 时会把 value **原样渲染成裸数字 id**，
 * 看着像控件坏了。先例与理由同 constants.ts#grantActionGroupsFor 的「补选项而不是改成 VIEW」：
 * 静默改值等于篡改一条已存在的授权
 */
const editingRuleName = ref<string>()

const ruleOptions = computed<RuleVO[]>(() => {
  const id = formData.value.ruleId
  if (id == null || ruleList.value.some((item) => item.id === id)) return ruleList.value
  return [
    ...ruleList.value,
    {
      id,
      name: `${editingRuleName.value ?? `规则 #${id}`}（已停用或已删除）`,
      // template / status 只是补满 RuleVO 的必填字段；这个占位项永远选不中（下拉里点它等于没变）
      template: '',
      status: 1
    }
  ]
})

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
  // 行过滤规则同理，而且这里的残留**更危险**：绑在非数据集资源上的 ruleId 是死字段，
  // 但列表页照样把它渲染成 ruleName，等于给操作者看了一个其实不存在的限制。
  //
  // 🔴 这段不会在 open('update') 回显时误触发：ResourceTreePicker#onNodeClick 开头是
  // if (props.multiple || props.disabled) return，而编辑态下 picker 是 :disabled="!!formData.id"
  if (!isRowFilterableResource(node.type)) {
    formData.value.ruleId = undefined
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

// -------- 行过滤规则：适用性 + 槽位覆盖度 --------

/** 行过滤规则只对 DATASET 资源有意义，判据与失效方向见 isRowFilterableResource */
const isDatasetResource = computed(() => isRowFilterableResource(selectedResource.value?.type))

const selectedRule = computed(() =>
  formData.value.ruleId == null
    ? undefined
    : ruleList.value.find((item) => item.id === formData.value.ruleId)
)

// 数据层与批量授权抽屉同一套，但**不共用实例** —— 两个抽屉各自 setup 一份，
// 与 useResourceCatalog 的口径一致（一次页面停留只拉一次，不做模块级缓存）
const { slotMappings, state: slotState, ensureLoaded: ensureSlotsLoaded } = useSlotCoverage()
const { templateMap, load: loadRuleTemplateMeta } = useRuleTemplateMeta()

const coverage = computed(() =>
  computeRuleSlotCoverage({
    slotState: slotState.value,
    slotMappings: slotMappings.value,
    resourceIds: formData.value.resourceId ? [formData.value.resourceId] : [],
    resourceById: resourceById.value,
    rule: selectedRule.value,
    templateMeta: templateMap.value
  })
)

/**
 * 规则下拉底下那一条警告。与批量抽屉那份 ruleHint 同一套判据，
 * 但少了「已勾 N 个资源里没有数据集」「将作用于 D 个数据集」这类只在多选下成立的分支，
 * 也**不弹二次确认** —— 单条只影响一行，代价与批量差三个数量级，
 * 为它拦一道弹窗换来的确定性不值这个摩擦。缺槽位照样报 error，红字本身就是告知。
 *
 * 返回 undefined 时那条 alert 整体不渲染，此时底下那条「未绑定 = 全部行可见」的 info
 * 才可能出现（它的 v-if 里有 !formData.ruleId，两者天然互斥，不会叠成两条）
 */
const ruleWarning = computed<{ type: 'warning' | 'error'; text: string } | undefined>(() => {
  if (formData.value.ruleId == null) return undefined
  if (!isDatasetResource.value) {
    const typeName = selectedResource.value ? formatResourceType(selectedResource.value.type) : ''
    return {
      type: 'warning',
      text:
        `行过滤规则绑在${typeName ? `「${typeName}」类` : '非数据集类'}资源上不会被任何查询读到 —— ` +
        '后端是按物理表名反查 DATASET 资源的（见 ResourceMapper#selectListByDatasetTable），' +
        '也不沿资源树上溯。这一行能存进去，但它只是个死字段，列表页却会把它显示成一个其实不存在的限制。'
    }
  }
  const c = coverage.value
  if (c.state === 'loading') return undefined
  if (c.state === 'failed') {
    return {
      type: 'warning',
      text:
        '无法核对槽位覆盖度（当前账号可能没有 system:slot-mapping:query 权限）。' +
        '缺槽位的数据集绑上规则后会一行都查不出来，请自行确认后再保存。'
    }
  }
  if (!selectedRule.value) {
    return {
      type: 'warning',
      text: '该规则不在启用规则列表里（已停用或已删除），拿不到它的模板，无法核对槽位覆盖度。'
    }
  }
  if (c.undecidable) {
    return {
      type: 'warning',
      text:
        '该规则依赖的槽位写在它自己的参数里，无法预先核对。' +
        '请确认这个数据集配了对应槽位 —— 缺槽位不是「规则不生效」，是整张表一行都查不出来。'
    }
  }
  if (c.uncoveredIds.length) {
    return {
      type: 'error',
      text:
        `这个数据集没配「${c.missingSlots.join('、')}」槽位。绑上该规则后条件求不出来，` +
        '后端按恒假处理 —— 整张业务表一行都查不出来，而且不报错，比不绑规则更严。'
    }
  }
  return undefined
})

// -------- 提交 --------

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
// 🔴 这三条 :deep() 只在**没有** append-to-body 时生效（加了会被 teleport 出 scoped 边界，
// 静默失效、不报错）。但它们都**不承重**：树高由模板里 el-form 的 h-full 保证，
// 这三条失效了只是少两条分隔线、正文可能多一层滚动条
//
// overflow: hidden 是一道保险 —— 滚动应该只发生在右列（overflow-y-auto）与树自己
// （el-tree-v2 内部那个虚拟列表）里。body 再叠一层滚动没有意义，
// 而且滚动条一出现就会改 body 的内容宽度，整块布局跟着抖一下。
// display: flex 那两行是给 el-form 上那个 flex-1 兜底的，理由见模板里那段注释
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
