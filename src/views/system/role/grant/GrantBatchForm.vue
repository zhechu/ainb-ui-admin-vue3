<template>
  <!--
    🔴 不加 append-to-body：EP 的 el-drawer 默认 appendToBody=false，
    加了之后抽屉被 teleport 出本组件的 scoped 边界，下面那几条 :deep(.el-drawer__*)
    会**静默失效**（不报错，只是不生效）。
    :close-on-click-modal 必须显式关掉 —— 它默认是 true，
    而批量抽屉正是一次误点遮罩就毁掉几百个勾选的地方
  -->
  <el-drawer
    v-model="drawerVisible"
    :close-on-click-modal="false"
    size="min(1480px, 96vw)"
    title="批量授权"
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
        （「全选下级（N）」/「取消下级（N）」，约 90px）不至于把 permission 挤没
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
        <span class="text-12px text-[var(--el-text-color-secondary)]">
          已存在同「主体 + 资源 + 动作」的行会被<b>覆盖</b>，不会跳过、也不会产生重复行
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
import * as GrantApi from '@/api/system/grant'
import {
  GRANT_ACTION_GROUP_LABELS,
  reservedActionWarning,
  splitGrantActionOptions
} from '@/views/system/resource/constants'
import GrantActionHelp from '@/views/system/resource/components/GrantActionHelp.vue'
import ResourceTreePicker from './ResourceTreePicker.vue'
import { useResourceCatalog } from './useResourceCatalog'
import {
  GRANT_BATCH_MAX_ITEMS,
  confirmPastExpireTime,
  expandGrantBatch,
  intersectGrantActionOptions
} from './batchGrant'

defineOptions({ name: 'SystemRoleGrantBatchForm' })

const message = useMessage()

/** 只选日期不选时间时默认到当天 23:59:59 —— 与单条表单同口径 */
const defaultExpireTime = new Date(2000, 0, 1, 23, 59, 59)

const drawerVisible = ref(false)
const formLoading = ref(false)
const pickerRef = ref()
/** 主体固定由打开方传入（角色授权页 = ROLE + roleId），批量抽屉不提供主体选择 */
const subjectRefId = ref<number>()

// 数据层与单条授权抽屉共用一份，见 useResourceCatalog 的注释
const { resourceTree, includeFieldLevel, resourceById, ensureLoaded, reloadResourceTree } =
  useResourceCatalog()

const checkedIds = ref<number[]>([])
const selectedActions = ref<string[]>(['VIEW'])
const effect = ref('ALLOW')
const expireTime = ref<string>()

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

// -------- 提交 --------

const totalRows = computed(() => checkedIds.value.length * selectedActions.value.length)
const overLimit = computed(() => totalRows.value > GRANT_BATCH_MAX_ITEMS)
const canSubmit = computed(
  () => checkedIds.value.length > 0 && selectedActions.value.length > 0 && !overLimit.value
)

const emit = defineEmits<{ success: [] }>()

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
    await ensureLoaded()
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

const submitForm = async () => {
  if (!canSubmit.value) return
  if (!(await confirmPastExpireTime(expireTime.value))) return
  formLoading.value = true
  try {
    const res = await GrantApi.createGrantList(
      expandGrantBatch({
        subjectType: 'ROLE',
        subjectRefId: subjectRefId.value,
        resourceIds: checkedIds.value,
        actions: selectedActions.value,
        effect: effect.value,
        expireTime: expireTime.value
      })
    )
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
