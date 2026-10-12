<template>
  <!--
    🔴 不加 append-to-body：EP 的 el-drawer 默认 appendToBody=false，
    加了之后抽屉被 teleport 出本组件的 scoped 边界，下面那几条 :deep(.el-drawer__*)
    会**静默失效**（不报错，只是不生效）。
    换成下面那个穿透模式也**不需要** append-to-body —— ElTeleport 的 disabled 只看 appendToBody，
    与 modal 无关。理由与其余全部细节见 GrantForm.vue 模板顶部那三段注释，这里不重复
  -->
  <!--
    🔴 非模态穿透 + 可拖宽，与 GrantForm.vue 同口径（`:modal="false"` 与 `modal-penetrable`
    必须成对，少了任一个 is-penetrable 都不会加上，那两条 pointer-events 规则也就不生效）。

    ⚠️ 批量抽屉是这两个入口里**代价更大的一个**：后面列表页可点之后，
    一次「行内编辑」就能把这里已经勾好的几百个资源与那套「保留 / 覆盖」选择整个换掉，
    一次「批量删除」能在授权进行中删掉授权行。那五个按钮由 index.vue 的 drawerOpen 禁用；
    搜索、重置、五个查询条件、翻页保持可用 —— 那才是要够到的东西。

    ⚠️ 下面那个 `:close-on-click-modal="false"` 在穿透模式下是惰性的（overlay 已经
    pointer-events: none，永远收不到点击）。留着是为了哪天把 modal 打开时，
    不会退回「一次误点遮罩就毁掉几百个勾选」
  -->
  <el-drawer
    v-model="drawerVisible"
    :close-on-click-modal="false"
    :modal="false"
    :size="drawerSize"
    modal-penetrable
    resizable
    title="批量授权"
    @closed="emit('closed')"
    @resize-end="onDrawerResizeEnd"
  >
    <!--
      🔴 class 里的 h-full 是承重的，别当成与 flex-1 重复而删掉。
      理由与 GrantForm.vue 里那段完全相同：这个 <form> 是 .el-drawer__body 的直接子元素，
      body 的高度由 EP 自己确定（.el-drawer 是 height: 100% 的纵向 flex、body 是它 flex: 1 的子项），
      所以 height: 100% 一跳就解析成功，不依赖下面那条 :deep(.el-drawer__body)。
      那条覆盖一旦没生效，body 保持 display: block，它下面所有 flex-1 全变成空操作，
      树会停在 ResourceTreePicker#treeHeight 的 160px 下限 —— 而这件事不报错
    -->
    <el-form v-loading="formLoading" class="flex h-full min-h-0 flex-1 gap-16px" label-width="96px">
      <!--
        左列：资源多选 + 已选清单。它才是这个抽屉的主体，吃掉全部剩余宽度；
        min-w-0 是必需的 —— 树行里的 permission 串很长，没有它 flex-1 会被内容顶开。
        这一侧整体比单条那个抽屉宽 120px，为的是行尾那个两态按钮
        （「全选下级（N）」/「取消下级（N）」，约 90px）不至于把 permission 挤没。

        默认宽度下这一列约 724px（抽屉 1240 − body 左右内边距 40 − 两列间距 16 − 右列 460），
        拖到下限 760px 时约 244px。改抽屉宽度或右列宽度时这两个数要重新算一遍
      -->
      <div class="flex min-h-0 min-w-0 flex-1 flex-col">
        <ResourceTreePicker
          ref="pickerRef"
          :include-field-level="includeFieldLevel"
          :model-value="checkedIds"
          :tree="resourceTree"
          multiple
          @update:include-field-level="onIncludeFieldLevelChange"
          @update:model-value="onCheckedChange"
        />
        <!--
          已选清单。「全选下级」一次能勾上几百个资源，
          树上滚一遍根本数不清自己到底勾了什么 —— 这一带就是那个问题的答案，
          顺带给了逐个摘掉的入口（不用为了撤一个去树里翻）
        -->
        <div
          v-if="checkedIds.length"
          class="mt-8px max-h-120px shrink-0 overflow-y-auto rounded-4px border border-solid border-[var(--el-border-color-lighter)] p-6px"
        >
          <el-tag
            v-for="id in checkedIds"
            :key="id"
            :title="resourceById.get(id)?.permission"
            class="mb-4px mr-4px"
            closable
            size="small"
            @close="removeResource(id)"
          >
            {{ resourceById.get(id)?.name ?? `资源 #${id}` }}
          </el-tag>
        </div>
      </div>

      <!--
        右列：批量参数。三个短控件加一段行数提示，给固定宽，
        把剩余宽度全留给左边那棵树 —— 与 GrantForm.vue 同口径
      -->
      <div class="w-460px shrink-0 overflow-y-auto pr-4px">
        <!--
          🔴 这条压在最上面，因为它决定提交按钮能不能点。
          拿不到既有行 = 算不出 conflicts = 那个「保留还是覆盖」的弹窗不会出现，
          于是提交会静默走成「覆盖」。这与槽位覆盖度取不到时的处理**刻意相反**：
          那边只是建议（降级成「无法核对」，不拦提交），
          这边会让一次放权悄无声息地发生，所以必须拦住
        -->
        <el-alert v-if="existingLoadFailed" :closable="false" class="mb-8px" show-icon type="error">
          <div class="text-12px leading-snug">
            既有授权行读取失败，无法判断这次提交会不会抹掉已配好的 行过滤规则 /
            字段显示模式，提交已禁用。请关闭抽屉重试。
          </div>
        </el-alert>
        <el-form-item>
          <template #label>
            <span class="inline-flex items-center">动作<GrantActionHelp /></span>
          </template>
          <!--
            可选项是「已勾资源类型」的**交集**而不是并集：并集会在勾了菜单时把
            START / DESIGN / MANAGE / VIEW_ALL 也端出来，选中即产生「能保存但永不参与鉴权」
            的死行 —— 单条表单里那是一行，批量一次就是 N 行。
            交集**保留**预留动作（新增/修改/删除…）：「一次开 查看+新增+修改+删除」
            这个高频场景配的正是它们，裁掉等于砍掉批量授权的一半用途。
            分组展示 + 下面那条常驻警告照旧，与单条表单同一套机制
          -->
          <el-select
            v-model="selectedActions"
            class="w-full"
            collapse-tags
            collapse-tags-tooltip
            multiple
            placeholder="请选择动作（可多选）"
          >
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
          <el-alert
            v-if="actionWarning"
            :closable="false"
            class="mt-4px w-full !py-4px"
            show-icon
            type="warning"
          >
            <div class="whitespace-pre-line text-12px leading-snug">{{ actionWarning }}</div>
          </el-alert>
        </el-form-item>
        <el-form-item label="效果">
          <el-radio-group v-model="effect">
            <el-radio value="ALLOW">允许</el-radio>
            <el-radio value="DENY">拒绝</el-radio>
          </el-radio-group>
          <span class="ml-8px text-11px text-gray-400">对整批生效</span>
        </el-form-item>
        <el-form-item label="行过滤规则">
          <el-select
            v-model="ruleId"
            class="w-full"
            clearable
            placeholder="不绑定（该主体不受行限制）"
          >
            <el-option v-for="r in ruleList" :key="r.id" :label="r.name" :value="r.id">
              <span>{{ r.name }}</span>
              <span class="ml-8px text-11px text-gray-400">{{ r.description }}</span>
            </el-option>
          </el-select>
          <!--
            🔴 一条 alert 走完整个状态机，type 与文案都随覆盖度变。
            不在 460px 的右列里堆三四条 alert：那一列已经放了动作警告与行数提示，
            再叠几条会把「提交 N 行」那个最该看见的数字挤出首屏。
            沿用同文件里 actionWarning 的现成范式（单条 + whitespace-pre-line）
          -->
          <el-alert
            v-if="ruleHint"
            :closable="false"
            :type="ruleHint.type"
            class="mt-4px w-full !py-4px"
            show-icon
          >
            <div class="whitespace-pre-line text-12px leading-snug">{{ ruleHint.text }}</div>
          </el-alert>
        </el-form-item>
        <el-form-item label="到期时间">
          <el-date-picker
            v-model="expireTime"
            :default-time="defaultExpireTime"
            class="w-full"
            clearable
            placeholder="不填=永不过期（对整批生效）"
            type="datetime"
            value-format="YYYY-MM-DD HH:mm:ss"
          />
        </el-form-item>
        <!--
          提交前必须看得见「要授出多少行」：批量入口的风险不是点不动，
          而是一次点出几百行自己没数过的授权。超上限时转 error 并禁用提交按钮，
          而不是等后端 400 换回一句参数错误
        -->
        <el-alert :closable="false" :type="overLimit ? 'error' : 'info'" show-icon>
          <div class="text-12px leading-snug">
            将提交 {{ checkedIds.length }} 资源 × {{ selectedActions.length }} 动作 =
            <b>{{ totalRows }}</b> 行授权。
            <template v-if="overLimit">
              已超过单次 {{ GRANT_BATCH_MAX_ITEMS }} 条上限，请减少勾选或分几次提交。
            </template>
          </div>
        </el-alert>
      </div>
    </el-form>
    <template #footer>
      <div class="flex items-center justify-between">
        <span class="mr-12px text-12px text-[var(--el-text-color-secondary)]">
          已存在同「主体 + 资源 + 动作」的行会被<b>覆盖</b>，不会跳过、也不会产生重复行
          <template v-if="conflicts.rows">
            ；其中 <b>{{ conflicts.rows }}</b> 行已配置 {{ conflicts.fields.join('、') }}，
            提交时会先问你要不要保留
          </template>
        </span>
        <div>
          <el-button :disabled="formLoading || !canSubmit" type="primary" @click="submitForm">
            提 交（{{ totalRows }}）
          </el-button>
          <el-button @click="drawerVisible = false">取 消</el-button>
        </div>
      </div>
    </template>
  </el-drawer>
</template>
<script lang="ts" setup>
import dayjs from 'dayjs'
import * as GrantApi from '@/api/system/grant'
import type { GrantVO, RuleVO } from '@/api/system/grant'
import {
  GRANT_ACTION_GROUP_LABELS,
  reservedActionWarning,
  splitGrantActionOptions
} from '@/views/system/resource/constants'
import GrantActionHelp from '@/views/system/resource/components/GrantActionHelp.vue'
import { useRuleTemplateMeta } from '@/views/system/rule/useRuleTemplateMeta'
import ResourceTreePicker from './ResourceTreePicker.vue'
import { useResourceCatalog } from './useResourceCatalog'
import { useSlotCoverage } from './useSlotCoverage'
import {
  GRANT_BATCH_MAX_ITEMS,
  computeRuleSlotCoverage,
  confirmPastExpireTime,
  expandGrantBatch,
  findUnspecifiedConflicts,
  grantRowKey,
  intersectGrantActionOptions,
  type GrantBatchInput,
  type GrantMergeSource
} from './batchGrant'

defineOptions({ name: 'SystemRoleGrantBatchForm' })

/**
 * `success` = 提交成功，index.vue 拿去刷新列表；`closed` = 抽屉收起动画**结束**，
 * index.vue 拿去解禁那五个按钮。两条的语义与「为什么是 closed 不是 close」
 * 见 GrantForm.vue 里同一处声明的注释。声明放在最上面是因为模板里就引用了它
 */
const emit = defineEmits<{ success: []; closed: [] }>()

const message = useMessage()

/** 只选日期不选时间时默认到当天 23:59:59 —— 与单条表单同口径 */
const defaultExpireTime = new Date(2000, 0, 1, 23, 59, 59)

const drawerVisible = ref(false)
const formLoading = ref(false)
const pickerRef = ref()

/**
 * 抽屉宽度与它的拖拽下限，与 GrantForm.vue 同一套机制，只差默认值：
 * 这里比单条那个宽 120px，理由见模板里左列那段注释（行尾那个两态按钮约 90px）。
 *
 * 🔴 下限为什么夹在 resize-end 里而不是写一条 CSS min-width、以及「拖到下限以下松手才弹回」
 * 这个副作用为什么是正确行为，GrantForm.vue#onDrawerResizeEnd 上那段注释已经写全了，
 * 这里不重复 —— 两份注释各说一半，是下一个人踩坑的标准起点
 */
const DRAWER_MIN_WIDTH = 760
const drawerSize = ref('min(1240px, 86vw)')
const onDrawerResizeEnd = (_evt: MouseEvent, size: number) => {
  drawerSize.value = `${Math.max(Math.min(DRAWER_MIN_WIDTH, window.innerWidth), size)}px`
}

/** 主体固定由打开方传入（角色授权页 = ROLE + roleId），批量抽屉不提供主体选择 */
const subjectRefId = ref<number>()

// 数据层与单条授权抽屉共用一份，见 useResourceCatalog 的注释
const { resourceTree, includeFieldLevel, resourceById, ensureLoaded, reloadResourceTree } =
  useResourceCatalog()

const checkedIds = ref<number[]>([])
const selectedActions = ref<string[]>(['VIEW'])
const effect = ref('ALLOW')
const expireTime = ref<string>()
const ruleId = ref<number>()

/** 规则下拉的数据源。与 GrantForm 那份同口径：后端只返启用的规则 */
const ruleList = ref<RuleVO[]>([])
const rulesLoaded = ref(false)
const loadRules = async () => {
  if (rulesLoaded.value) return
  ruleList.value = await GrantApi.getSimpleRuleList()
  rulesLoaded.value = true
}

/**
 * 这个主体**当前**的授权行，用来算「这次提交会抹掉什么」。
 *
 * 🔴 每次 open() 都重拉，**不加 loaded 标记**：它的价值全在于「此刻库里的状态」，
 * 缓存一份上一次打开时的快照，算出来的 conflicts 就是过期的 ——
 * 而 conflicts 决定那个「保留还是覆盖」的弹窗出不出现。
 * 与资源目录、规则列表、槽位映射那三份（都是「一次页面停留只拉一次」）刻意不同口径
 */
const existingRows = ref<GrantVO[]>([])
const existingLoadFailed = ref(false)
const loadExisting = async () => {
  existingLoadFailed.value = false
  if (subjectRefId.value == null) {
    existingLoadFailed.value = true
    return
  }
  try {
    existingRows.value = (await GrantApi.getGrantListBySubject('ROLE', subjectRefId.value)) ?? []
  } catch {
    // 🔴 只置标记，**不抛**：抛出去会让 open() 的 try 中断，抽屉停在半初始化状态。
    // 拦住提交这件事由 existingLoadFailed 负责（它进了 canSubmit），比抛异常更明确
    existingRows.value = []
    existingLoadFailed.value = true
  }
}

/**
 * 既有行按「资源 + 上下文 + 动作」建索引，形状即 GrantMergeSource。
 *
 * ⚠️ expireTime 必须格式化：后端把 LocalDateTime 序列化成**毫秒数**，
 * 直接塞回 expandGrantBatch 会让提交出去的 expireTime 是个数字串，
 * 与单条表单里 date-picker 的 value-format 不同口径（GrantForm#open 有同一处转换）
 */
const existingByKey = computed(() => {
  const map = new Map<string, GrantMergeSource>()
  for (const row of existingRows.value) {
    map.set(grantRowKey(row.resourceId, row.contextResourceId, row.action), {
      ruleId: row.ruleId,
      fieldMode: row.fieldMode,
      expireTime: row.expireTime ? dayjs(row.expireTime).format('YYYY-MM-DD HH:mm:ss') : undefined
    })
  }
  return map
})

// 槽位映射与规则模板元数据：覆盖度检查的两份输入，见 useSlotCoverage / useRuleTemplateMeta
const { slotMappings, state: slotState, ensureLoaded: ensureSlotsLoaded } = useSlotCoverage()
const { templateMap, load: loadRuleTemplateMeta } = useRuleTemplateMeta()

// -------- 资源勾选 --------

/**
 * picker 的 modelValue 是 `number | number[]` 联合（单/多选同一个组件），
 * 这里只吃数组那一支。写成显式赋值而不是 v-model，是为了让 vue-tsc 能查：
 * v-model 会把联合类型直接赋给 `number[]`，类型对不上
 */
const onCheckedChange = (value: number | number[] | undefined) => {
  checkedIds.value = Array.isArray(value) ? value : []
}

const removeResource = (id: number) => {
  checkedIds.value = checkedIds.value.filter((item) => item !== id)
}

/**
 * 切换「显示字段级资源」会整体换掉树的数据源。
 *
 * 开关只是视野切换，不该让用户已经勾好的几十个节点白勾，所以重载后把
 * **仍存在于新树里**的勾选留下（被移出去的那些确实没法保留，节点都不在了）。
 * 树自己那份内部勾选态与过滤态由 ResourceTreePicker 的 watch(props.tree) 对齐，
 * 那边有它非做不可的理由，别在这里重复一遍
 */
const onIncludeFieldLevelChange = async (value: boolean) => {
  const before = checkedIds.value
  includeFieldLevel.value = value
  await reloadResourceTree()
  await nextTick()
  checkedIds.value = before.filter((id) => resourceById.value.has(id))
}

// -------- 动作选项（随已勾资源类型收窄） --------

const selectedTypes = computed(() => checkedIds.value.map((id) => resourceById.value.get(id)?.type))
const batchActionOptions = computed(() => intersectGrantActionOptions(selectedTypes.value))
const actionGroups = computed(() => splitGrantActionOptions(batchActionOptions.value))

/**
 * 选项收窄后必须主动剔除已选的、掉出选项集的动作。
 *
 * 🔴 不剔就会提交出死行：先勾 PROCESS 选了 START，再勾一个 MENU，
 * START 掉出选项集但它**仍是 GrantActionEnum 里的合法值**，
 * 后端 @InEnum 拦不住 —— 校验只管「是不是枚举内的码」，
 * 管不了「这个码在这种资源上有没有意义」
 */
watch(batchActionOptions, (options) => {
  const allowed = new Set(options.map((item) => item.value))
  const kept = selectedActions.value.filter((action) => allowed.has(action))
  if (kept.length !== selectedActions.value.length) {
    selectedActions.value = kept
  }
})

/**
 * 预留动作的常驻警告，逐条拼接。
 *
 * 刻意复用单条表单那个 `reservedActionWarning` 而不是另写一句合并版：
 * 文案一旦有两份，「配了不生效」这种关键提示就会在两个入口说出不同的话
 */
const actionWarning = computed(() => {
  const warnings = selectedActions.value
    .map((action) => reservedActionWarning(action))
    .filter((w): w is string => !!w)
  return warnings.length ? warnings.join('\n') : undefined
})

// -------- 行过滤规则：覆盖度提示 --------

const selectedRule = computed(() => ruleList.value.find((item) => item.id === ruleId.value))

const coverage = computed(() =>
  computeRuleSlotCoverage({
    slotState: slotState.value,
    slotMappings: slotMappings.value,
    resourceIds: checkedIds.value,
    resourceById: resourceById.value,
    rule: selectedRule.value,
    templateMeta: templateMap.value
  })
)

/**
 * 规则下拉底下那**一条** alert 的全部内容（type + 文案）。
 *
 * 状态机的顺序是承重的，别随意调换：
 * - 「没勾资源」排在覆盖度之前 —— 0 个资源时 `datasetIds` 也是空，
 *   不先拦住就会对着一个还没开始的操作报「这些资源里没有数据集」；
 * - loading / failed 排在 undecidable 与 uncovered 之前 —— 数据没到手时
 *   `computeRuleSlotCoverage` 一律返回空的 uncoveredIds，那几条分支本来也进不去，
 *   但文案必须由这里给，不能让界面在那一瞬间什么都不说（沉默会被读成「没问题」）；
 * - 🔴 uncovered 排在 success 之前，且它是唯一的 error 态。
 *   缺槽位的后果是**整张业务表一行都查不出来**，比不绑规则更严，
 *   这件事必须比「规则将作用于 N 个数据集」那句好消息更显眼
 */
const ruleHint = computed<
  { type: 'info' | 'success' | 'warning' | 'error'; text: string } | undefined
>(() => {
  if (ruleId.value == null) {
    return {
      type: 'info',
      text: '未绑定行过滤规则 = 该主体可以看到这些表的全部行。用户拥有多个角色时，只要有一个角色是「不受限」，合并结果就是不受限。'
    }
  }
  if (!checkedIds.value.length) {
    return {
      type: 'info',
      text: '勾选资源后，这里会告诉你该规则实际会作用于其中哪些数据集（绑在菜单/按钮上的规则不会被任何查询读到）。'
    }
  }
  const c = coverage.value
  if (c.state === 'loading') {
    return { type: 'info', text: '正在核对该规则要求的语义槽位…' }
  }
  if (c.state === 'failed') {
    return {
      type: 'warning',
      text: '无法核对槽位覆盖度（当前账号可能没有 system:slot-mapping:query 权限）。缺槽位的数据集绑上规则后会一行都查不出来，请自行确认后再提交。'
    }
  }
  if (!c.datasetIds.length) {
    return {
      type: 'warning',
      text: `已勾的 ${checkedIds.value.length} 个资源里没有数据集，这个规则不会被任何查询读到 —— 行过滤是按物理表名反查 DATASET 资源的，绑在菜单/按钮/字段上都是死字段。`
    }
  }
  if (c.undecidable) {
    return {
      type: 'warning',
      text: `该规则依赖的槽位写在它自己的参数里，无法预先核对。请自行确认这 ${c.datasetIds.length} 个数据集都配了对应槽位 —— 缺槽位不是「规则不生效」，是整张表一行都查不出来。`
    }
  }
  if (c.uncoveredIds.length) {
    const names = c.uncoveredIds
      .slice(0, 5)
      .map((id) => resourceById.value.get(id)?.name ?? `资源 #${id}`)
    const rest = c.uncoveredIds.length - names.length
    return {
      type: 'error',
      text: `其中 ${c.uncoveredIds.length} 个数据集没配「${c.missingSlots.join('、')}」槽位：${names.join('、')}${
        rest > 0 ? ` 等 ${rest} 个` : ''
      }。绑上后这些业务表会一行都查不出来（后端对求不出条件的规则按恒假处理），比不绑更严。`
    }
  }
  const skipped = checkedIds.value.length - c.datasetIds.length
  return {
    type: 'success',
    text: `该规则将作用于 ${c.datasetIds.length} 个数据集${
      skipped > 0 ? `；其余 ${skipped} 个资源不写 ruleId（写了也不会被读到）` : ''
    }。`
  }
})

// -------- 提交 --------

/**
 * 组装 expandGrantBatch 的入参。
 *
 * 抽成函数是因为**同一份入参要被算两次**：一次给 conflicts（决定弹窗出不出现、报几行），
 * 一次给真正的提交。两处各写一遍的话，弹窗报的数与实际覆盖的行数就不是同一个数了
 */
const buildInput = (mergeFrom?: ReadonlyMap<string, GrantMergeSource>): GrantBatchInput => ({
  subjectType: 'ROLE',
  subjectRefId: subjectRefId.value,
  resourceIds: checkedIds.value,
  actions: selectedActions.value,
  effect: effect.value,
  expireTime: expireTime.value,
  ruleId: ruleId.value,
  resourceById: resourceById.value,
  mergeFrom
})

/** 「本次没填、但既有行上有值」的行 —— 也就是选「覆盖」会被抹掉的东西 */
const conflicts = computed(() => findUnspecifiedConflicts(buildInput(), existingByKey.value))

const totalRows = computed(() => checkedIds.value.length * selectedActions.value.length)
const overLimit = computed(() => totalRows.value > GRANT_BATCH_MAX_ITEMS)
const canSubmit = computed(
  () =>
    checkedIds.value.length > 0 &&
    selectedActions.value.length > 0 &&
    !overLimit.value &&
    // 🔴 读不到既有行就不能提交：那样 conflicts 恒为 0、弹窗不出现，
    // 提交会静默走成「覆盖」，把已配好的规则/字段模式抹成 NULL
    !existingLoadFailed.value
)

const open = async (refId: number) => {
  subjectRefId.value = refId
  drawerVisible.value = true
  formLoading.value = true
  try {
    // 每次打开都回到初值：上一次的选择是上一次的意图，带过来容易在没注意时一起提交出去
    checkedIds.value = []
    selectedActions.value = ['VIEW']
    effect.value = 'ALLOW'
    expireTime.value = undefined
    ruleId.value = undefined
    existingRows.value = []
    // 🔴 五件事并行，其中槽位映射与模板元数据**必须在这里拉、不能放进 watch(ruleId)**：
    // 全量槽位与「选了哪个规则」无关，eagerly 拉一次之后，快速切换规则的请求竞态
    // 从「要处理」变成「结构上不存在」（详见 useSlotCoverage 的注释）。
    // 顺带避免了「选完规则那一刻才开始拉、提示先闪一下绿色」
    await Promise.all([
      ensureLoaded(),
      loadRules(),
      loadExisting(),
      ensureSlotsLoaded(),
      loadRuleTemplateMeta()
    ])
    // ⚠️ includeFieldLevel 也要归位。抽屉不加 destroy-on-close，useResourceCatalog
    // 常驻在 setup 里，所以「打开 → 勾上显示字段级 → 关掉 → 再打开」开关还是勾着的。
    // 这个漏在改成抽屉之前就在（那时也常驻），顺手一起修
    if (includeFieldLevel.value) {
      includeFieldLevel.value = false
      await reloadResourceTree()
    }
    await nextTick()
    // 收掉上一次留下的搜索词、展开度与树的内部勾选态（见 ResourceTreePicker#reset）
    pickerRef.value?.reset()
  } finally {
    formLoading.value = false
  }
}
defineExpose({ open })

/**
 * 「保留既有配置 / 按本次填写覆盖 / 放弃提交」三态。
 *
 * 🔴 用 ElMessageBox 而不是 `useMessage().confirm`：后者把两个按钮的文案写死成「确定 / 取消」，
 * 也不支持 `distinguishCancelAndClose`。而这里**三个出口必须是三个意思**，
 * 且确认按钮得是安全的那一个 —— 沿用「确定 = 继续提交」的直觉，
 * 操作者会一路点过去把自己已配好的行过滤规则清空，而那是放权方向的数据丢失。
 * 所以「放弃」被放到关闭（X / ESC）上：不选就不提交，什么都不发生
 */
const chooseMergeStrategy = async (
  rows: number,
  fields: string[]
): Promise<'preserve' | 'overwrite' | 'abort'> => {
  const list = fields.join('、')
  try {
    await ElMessageBox.confirm(
      `这次提交会更新 ${rows} 行既有授权，它们已配置 ${list}，而本次表单里这几项是空的。` +
        `选「保留既有配置」= 空的字段沿用旧值，只更新你这次填了的；` +
        `选「按本次填写覆盖」= 把旧的 ${list} 一并清空` +
        `（行过滤会放开成「全部行可见」、被隐藏的字段会重新露出来）。`,
      '既有配置要怎么处理？',
      {
        distinguishCancelAndClose: true,
        confirmButtonText: '保留既有配置',
        cancelButtonText: '按本次填写覆盖',
        type: 'warning'
      }
    )
    return 'preserve'
  } catch (action) {
    // distinguishCancelAndClose 下 EP 分别 reject 'cancel'（点了取消按钮）与 'close'（X / ESC）
    return action === 'cancel' ? 'overwrite' : 'abort'
  }
}

const submitForm = async () => {
  if (!canSubmit.value) return

  // ① 覆盖既有配置的选择：保留 → 传 mergeFrom；覆盖 → 不传；放弃 → 直接 return
  let mergeFrom: ReadonlyMap<string, GrantMergeSource> | undefined
  const { rows, fields } = conflicts.value
  if (rows) {
    const strategy = await chooseMergeStrategy(rows, fields)
    if (strategy === 'abort') return
    if (strategy === 'preserve') mergeFrom = existingByKey.value
  }

  // ② 缺槽位。后果是「整张业务表一行都查不出来」，比不绑规则更严，所以要单独再问一次；
  //    刻意**不禁用提交按钮** —— 覆盖度是建议性的，操作者可能比前端更清楚那张表的实际情况
  const c = coverage.value
  if (c.uncoveredIds.length) {
    const ok = await message
      .confirm(
        `有 ${c.uncoveredIds.length} 个数据集没配「${c.missingSlots.join('、')}」槽位，` +
          `绑上这个规则后这些业务表会一行都查不出来（后端对求不出条件的规则按恒假处理）。仍要继续？`
      )
      .catch(() => false)
    if (!ok) return
  }

  // ③ 到期时间填了过去的时间 = 保存即「已过期」
  if (!(await confirmPastExpireTime(expireTime.value))) return

  formLoading.value = true
  try {
    const res = await GrantApi.createGrantList(expandGrantBatch(buildInput(mergeFrom)))
    // 计数必须回显：upsert 语义下「重复提交同一批」与「首次提交」看起来一模一样，
    // 不报「覆盖了几条」的话操作者无从判断自己是不是点重了
    let text = `授权完成：新增 ${res.insertedCount} 条、覆盖 ${res.updatedCount} 条`
    if (res.convergedCount > 0) {
      text += `，并收敛了 ${res.convergedCount} 行历史同键重复行`
    }
    message.success(text)
    drawerVisible.value = false
    emit('success')
  } finally {
    formLoading.value = false
  }
}
</script>
<style lang="scss" scoped>
// 🔴 这三条 :deep() 只在**没有** append-to-body 时生效，理由与 GrantForm 那份完全相同。
// 两份 CSS 是重复的，但抽成共用文件意味着要么放进全局样式（污染所有抽屉），
// 要么用 modal-class 走非 scoped 的路子 —— 两个调用点还不值当
//
// 这三条都**不承重**：树高由模板里 el-form 的 h-full 保证，
// 失效了只是少两条分隔线、正文可能多一层滚动条。
// overflow: hidden 是一道保险 —— 滚动只该发生在右列与树自己内部，
// 而滚动条一出现就会改 body 的内容宽度，整块布局跟着抖一下
:deep(.el-drawer__body) {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

:deep(.el-drawer__header) {
  padding-bottom: 12px;
  margin-bottom: 0;
  border-bottom: 1px solid var(--el-border-color);
}

:deep(.el-drawer__footer) {
  border-top: 1px solid var(--el-border-color);
}
</style>
