<template>
  <Dialog v-model="dialogVisible" title="批量添加授权" width="780px">
    <el-form v-loading="formLoading" label-width="110px">
      <el-form-item label="资源">
        <div class="w-full">
          <div class="mb-6px flex w-full items-center gap-8px">
            <el-input
              v-model="filterText"
              class="!w-240px"
              clearable
              placeholder="按名称或权限标识过滤"
              @input="onResourceFilter"
            />
            <el-checkbox v-model="includeFieldLevel" @change="onIncludeFieldLevelChange">
              <span class="text-12px">显示字段级资源（列 / 字段）</span>
            </el-checkbox>
            <span class="ml-auto text-12px text-gray-400">
              已选 {{ checkedIds.length }} 个资源
            </span>
            <el-button :disabled="!checkedIds.length" link type="primary" @click="clearChecked">
              清空
            </el-button>
          </div>
          <div class="mb-4px text-11px leading-tight text-gray-400">
            勾选父节点<b>不会</b>自动勾选子节点 —— 菜单与其下的按钮是各自独立的权限点。
            要整片选，用节点行尾的「选子树」。
          </div>
          <div class="w-full rounded-4px border border-solid border-[var(--el-border-color)] p-4px">
            <!--
              🔴 check-strictly 必须开：父子联动的前提是「勾父蕴含子」，而这个权限模型里
              MENU 与其下的 ACTION / 按钮是**各自独立的 permission 串**，
              给父资源授权不隐含子资源。开着联动会导致「勾一个菜单，
              静默把它下面几十个按钮全授出去」—— 用户看不见自己授了什么。
              勾什么授什么，所见即所得。
              效率损失用显式操作补：行尾那个「选子树」。与联动的本质区别是——
              联动是隐式副作用，选子树是一次显式有意的批量选择，且结果全部以勾选态可见
            -->
            <el-tree-v2
              ref="treeRef"
              :data="resourceTree"
              :props="{ label: 'name', children: 'children', value: 'id' }"
              :height="340"
              :filter-method="treeFilterMethod"
              :expand-on-click-node="false"
              show-checkbox
              check-strictly
              @check="syncChecked"
            >
              <template #default="{ node, data }">
                <span class="flex items-center gap-6px overflow-hidden">
                  <span class="text-13px">{{ node.label }}</span>
                  <span v-if="data.permission" class="truncate text-11px text-gray-400">
                    {{ data.permission }}
                  </span>
                  <el-button
                    class="ml-auto"
                    link
                    size="small"
                    type="primary"
                    @click.stop="selectSubtree(data)"
                  >
                    选子树
                  </el-button>
                </span>
              </template>
            </el-tree-v2>
          </div>
        </div>
      </el-form-item>
      <el-form-item>
        <template #label>
          <span class="inline-flex items-center">动作<GrantActionHelp /></span>
        </template>
        <!--
          可选项是「已勾资源类型」的**交集**而不是并集：并集会在勾了菜单时把
          START / DESIGN / MANAGE / VIEW_ALL 也端出来，选中即产生「能保存但永不参与鉴权」
          的死行 —— 单条表单里那是一行，批量一次就是 N 行。
          交集**保留**预留动作（新增/修改/删除…）：「一次开 查看+新增+修改+删除」
          这个高频场景配的正是它们，裁掉等于砍掉批量添加的一半用途。
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
    </el-form>
    <!--
      提交前必须看得见「要授出多少行」：批量入口的风险不是点不动，
      而是一次点出几十行自己没数过的授权。超上限时转 error 并禁用提交按钮，
      而不是等后端 400 换回一句参数错误
    -->
    <el-alert :closable="false" :type="overLimit ? 'error' : 'info'" show-icon>
      <div class="text-12px leading-snug">
        将提交 {{ checkedIds.length }} 资源 × {{ selectedActions.length }} 动作 =
        <b>{{ totalRows }}</b> 行授权。已存在同「主体 + 资源 + 动作」的行会被<b>覆盖</b>，
        不会跳过、也不会产生重复行。
        <template v-if="overLimit">
          已超过单次 {{ GRANT_BATCH_MAX_ITEMS }} 条上限，请减少勾选或分几次提交。
        </template>
      </div>
    </el-alert>
    <template #footer>
      <el-button :disabled="formLoading || !canSubmit" type="primary" @click="submitForm">
        提 交（{{ totalRows }}）
      </el-button>
      <el-button @click="dialogVisible = false">取 消</el-button>
    </template>
  </Dialog>
</template>
<script lang="ts" setup>
import * as GrantApi from '@/api/system/grant'
import {
  GRANT_ACTION_GROUP_LABELS,
  reservedActionWarning,
  splitGrantActionOptions
} from '@/views/system/resource/constants'
import GrantActionHelp from '@/views/system/resource/components/GrantActionHelp.vue'
import { useResourceTreePicker } from './useResourceTreePicker'
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

const dialogVisible = ref(false)
const formLoading = ref(false)
/** 主体固定由打开方传入（角色授权页 = ROLE + roleId），批量弹窗不提供主体选择 */
const subjectRefId = ref<number>()

const treeRef = ref()
const {
  resourceTree,
  includeFieldLevel,
  ensureLoaded,
  reloadResourceTree,
  resourceById,
  treeFilterMethod,
  onResourceFilter,
  resetTreeFilter
} = useResourceTreePicker(treeRef)

const filterText = ref('')
const checkedIds = ref<number[]>([])
const selectedActions = ref<string[]>(['VIEW'])
const effect = ref('ALLOW')
const expireTime = ref<string>()

// -------- 资源勾选 --------

// el-tree-v2 的 CheckedInfo.checkedKeys 是 TreeKey[]（string | number），
// 而这里的节点 key 恒为资源 id（:props 里 value: 'id'），统一收成 number 再往下传
const syncChecked = (_data: any, checkedInfo: { checkedKeys: (string | number)[] }) => {
  checkedIds.value = checkedInfo.checkedKeys.map(Number)
}

/**
 * 把「该节点 + 全部后代」并入已勾集合。
 *
 * 这是 check-strictly 的效率补偿：与父子联动的区别在于它是**显式**的一次批量选择，
 * 结果全部以勾选态呈现，不是勾一个父节点就静默带出几十个看不见的子授权
 */
const selectSubtree = (data: any) => {
  const ids: number[] = []
  const walk = (n: any) => {
    ids.push(n.id)
    n.children?.forEach(walk)
  }
  walk(data)
  checkedIds.value = [...new Set([...checkedIds.value, ...ids])]
  // setCheckedKeys 不会触发 @check，所以要自己把 checkedIds 与树的勾选态一起写
  nextTick(() => treeRef.value?.setCheckedKeys(checkedIds.value))
}

const clearChecked = () => {
  checkedIds.value = []
  treeRef.value?.setCheckedKeys([])
}

/**
 * 切换「显示字段级资源」会整体换掉树的数据源，而 el-tree-v2 的 useCheck 里有一条
 * `watch([tree, defaultCheckedKeys])` → `_setCheckedKeys(defaultCheckedKeys)`：
 * 数据源一变就把勾选重置成 defaultCheckedKeys（我们没传，等于清空）。
 * 开关只是视野切换，不该让用户已经勾好的几十个节点白勾，所以重载后把
 * **仍存在于新树里**的勾选写回去（被移出去的那些确实没法保留，节点都不在了）
 */
const onIncludeFieldLevelChange = async () => {
  const before = checkedIds.value
  await reloadResourceTree()
  await nextTick()
  const kept = before.filter((id) => resourceById.value.has(id))
  checkedIds.value = kept
  treeRef.value?.setCheckedKeys(kept)
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
  dialogVisible.value = true
  formLoading.value = true
  try {
    // 每次打开都回到初值：上一次的选择是上一次的意图，带过来容易在没注意时一起提交出去
    checkedIds.value = []
    selectedActions.value = ['VIEW']
    effect.value = 'ALLOW'
    expireTime.value = undefined
    filterText.value = ''
    await ensureLoaded()
    await nextTick()
    treeRef.value?.setCheckedKeys([])
    resetTreeFilter()
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
    dialogVisible.value = false
    emit('success')
  } finally {
    formLoading.value = false
  }
}
</script>
