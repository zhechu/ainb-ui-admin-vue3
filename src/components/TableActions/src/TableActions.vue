<script lang="ts" setup>
import { checkPermi } from '@/utils/permission'
import {
  resolveRowValue,
  resolveVisibleButtons,
  splitButtons,
  type TableActionButton
} from './actions'

defineOptions({ name: 'TableActions' })

const props = withDefaults(
  defineProps<{
    row: any
    /**
     * ⚠️ 必须是页面 setup 层的 const，不是每行调一次的工厂函数。
     * 写成 :buttons="makeButtons(scope.row)" 会每行每次渲染都新建数组，
     * 且下面 computed 的依赖追踪会退化。行级差异靠配置里的 show / RowValue 函数表达，
     * 它们在渲染时被调用，读到的 ref 自然被追踪。
     */
    buttons: readonly TableActionButton[]
    maxInline?: number
    /** 权限资源页的操作按钮是 size="small" */
    size?: 'large' | 'default' | 'small'
    moreLabel?: string
    moreIcon?: string
    /** 一行按钮全被权限滤掉时显示什么。fixed="right" 的操作列出现空单元格看起来像渲染 bug */
    emptyText?: string
  }>(),
  {
    maxInline: 3,
    size: 'default',
    moreLabel: '更多',
    moreIcon: 'ep:arrow-down',
    emptyText: '-'
  }
)

// ❗ 刻意不定义任何 emits：动作走配置里的 onClick 回调，
//    这样各页就不用再维护一套「command 字符串 → handler」的 handleCommand switch
const visible = computed(() => resolveVisibleButtons(props.buttons, props.row, checkPermi))
const split = computed(() => splitButtons(visible.value, props.maxInline))
const inline = computed(() => split.value.inline)
const folded = computed(() => split.value.folded)

const labelOf = (button: TableActionButton) => resolveRowValue<string>(button.label, props.row, '')
const disabledOf = (button: TableActionButton) => resolveRowValue(button.disabled, props.row, false)
const loadingOf = (button: TableActionButton) => resolveRowValue(button.loading, props.row, false)

const invoke = (command: string | number | object) => {
  folded.value[Number(command)]?.onClick(props.row)
}
</script>

<template>
  <div class="table-actions">
    <span v-if="visible.length === 0" class="table-actions__empty">{{ emptyText }}</span>
    <template v-else>
      <el-button
        v-for="button in inline"
        :key="button.key"
        link
        :size="size"
        :type="button.type ?? 'primary'"
        :disabled="disabledOf(button)"
        :loading="loadingOf(button)"
        @click="button.onClick(row)"
      >
        {{ labelOf(button) }}
      </el-button>

      <!--
        与标杆页 infra/formDesign 的「更多」逐字对齐：EP 默认的 hover 触发、
        触发器是 link primary 的「更多 + ep:arrow-down」、下拉项是纯文字（无图标、不染红），
        只在删除项上挂 divided。样式差异会让全站出现两种「更多」，所以这里不做任何加料。
      -->
      <el-dropdown v-if="folded.length > 0" @command="invoke">
        <el-button link :size="size" type="primary">
          {{ moreLabel }}<Icon :icon="moreIcon" class="ml-2px" />
        </el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item
              v-for="(button, index) in folded"
              :key="button.key"
              :command="index"
              :divided="!!button.divided"
              :disabled="disabledOf(button)"
            >
              {{ labelOf(button) }}
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </template>
  </div>
</template>
