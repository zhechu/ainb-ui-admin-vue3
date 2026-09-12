<template>
  <div class="system-value">
    <span v-if="displayText" class="value-text">{{ displayText }}</span>
    <span v-else class="value-empty">{{ emptyHint }}</span>
    <el-tooltip :content="sourceHint" placement="top">
      <Icon icon="ep:lock" class="value-icon" />
    </el-tooltip>
  </div>
</template>

<script lang="ts" setup>
import { useUserStore } from '@/store/modules/user'
import { formatDate } from '@/utils/formatTime'
import * as DeptApi from '@/api/system/dept'

defineOptions({ name: 'SystemValue' })

/**
 * 系统值控件（只读展示）
 *
 * 展示创建人、创建时间、当前登录人这类由系统决定的值。
 *
 * ## 它自己不落库
 *
 * 创建人这类值由后端按登录上下文写入（AutoFillConfig），本控件只做展示；
 * 提交时服务端会把这个字段从提交数据里【直接删掉】（SystemValueGuard）。
 *
 * 这与「拖 6 个可提交控件」的做法本质不同 —— 后者每个都是普通字段，
 * 前端提交什么就存什么，创建人可被随意伪造。而创建人往往是数据权限、
 * 审批流转、责任追溯的依据。
 *
 * 界面上用一个锁图标明示「这个值不是你能填的」，避免用户对着一个
 * 点不动的输入框困惑。
 */
const props = withDefaults(
  defineProps<{
    /** 已有数据里的值。新建时为空，编辑时是后端写入的值 */
    modelValue?: any
    /** 取值来源 */
    source?:
      | 'CREATOR'
      | 'CREATE_TIME'
      | 'UPDATER'
      | 'UPDATE_TIME'
      | 'CURRENT_USER'
      | 'CURRENT_DEPT'
      | 'CURRENT_POST'
      | 'NOW'
    /** 日期类来源的格式 */
    dateFormat?: string
  }>(),
  {
    source: 'CREATOR',
    dateFormat: 'YYYY-MM-DD HH:mm:ss'
  }
)

const userStore = useUserStore()

/**
 * 当前部门名称
 *
 * 用户 store 里只存 deptId，没有部门名。按需查一次部门精简列表再匹配 ——
 * 只在来源确实是「当前部门」时才查，别的来源不该为此付一次请求
 */
const currentDeptName = ref('')

const loadCurrentDeptName = async () => {
  const deptId = userStore.getUser?.deptId
  if (!deptId) return
  try {
    const list = await DeptApi.getSimpleDeptList()
    currentDeptName.value = list.find((d: any) => d.id === deptId)?.name ?? ''
  } catch (e) {
    // 查不到就留空，不打断表单渲染
    console.error('[SystemValue] 查询当前部门名称失败', e)
  }
}

onMounted(() => {
  if (props.source === 'CURRENT_DEPT') loadCurrentDeptName()
})

const SOURCE_LABELS: Record<string, string> = {
  CREATOR: '创建人',
  CREATE_TIME: '创建时间',
  UPDATER: '更新人',
  UPDATE_TIME: '更新时间',
  CURRENT_USER: '当前登录人',
  CURRENT_DEPT: '当前部门',
  CURRENT_POST: '当前岗位',
  NOW: '当前时间'
}

/** 落库型来源：值来自已保存的数据，新建时还没有 */
const PERSISTED_SOURCES = ['CREATOR', 'CREATE_TIME', 'UPDATER', 'UPDATE_TIME']

const displayText = computed(() => {
  const source = props.source ?? 'CREATOR'

  // 展示型来源：从当前登录上下文直接取，不依赖已保存的数据
  if (source === 'CURRENT_USER') {
    return userStore.getUser?.nickname ?? ''
  }
  if (source === 'CURRENT_DEPT') {
    // 用户 store 里只有 deptId，没有部门名 —— 名称要另外查（见 currentDeptName）
    return currentDeptName.value
  }
  if (source === 'CURRENT_POST') {
    // 岗位不在用户 store 里，交由后端在读取时回填；新建时先留空
    return props.modelValue ? String(props.modelValue) : ''
  }
  if (source === 'NOW') {
    return formatDate(new Date(), props.dateFormat)
  }

  // 落库型来源：显示已保存的值
  if (props.modelValue === null || props.modelValue === undefined || props.modelValue === '') {
    return ''
  }
  if (source === 'CREATE_TIME' || source === 'UPDATE_TIME') {
    return formatDate(props.modelValue, props.dateFormat) || String(props.modelValue)
  }
  return String(props.modelValue)
})

/**
 * 空值时的提示
 *
 * 落库型来源在新建时本来就没有值，写「保存后自动生成」比留一片空白清楚 ——
 * 后者会让用户以为是自己漏填了
 */
const emptyHint = computed(() =>
  PERSISTED_SOURCES.includes(props.source ?? '') ? '保存后自动生成' : '—'
)

const sourceHint = computed(
  () => `${SOURCE_LABELS[props.source ?? ''] ?? '系统值'}，由系统自动填写，不可编辑`
)
</script>

<style lang="scss" scoped>
.system-value {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
}

.value-text {
  color: var(--el-text-color-regular);
}

.value-empty {
  font-size: 13px;
  color: var(--el-text-color-placeholder);
}

.value-icon {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  cursor: help;
}
</style>
