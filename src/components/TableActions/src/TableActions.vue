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
        <Icon v-if="button.icon" :icon="button.icon" class="mr-2px" />
        {{ labelOf(button) }}
      </el-button>

      <!--
        trigger="click"：三处手写实现都用 EP 默认的 hover，鼠标扫过密集表格会误弹，且触屏没有 hover
        触发图标统一到 ep:arrow-down（原来全站分成 arrow-down 和 d-arrow-right 两派）
      -->
      <el-dropdown v-if="folded.length > 0" trigger="click" @command="invoke">
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
              <!--
                染红的类挂在 slot 里的 span 上，不挂在 el-dropdown-item 上：
                下拉面板是 teleport 到 body 的，而 EP 的 dropdown-item 根节点是
                el-roving-focus-item、class 被 mergeProps 转发给内层 impl，
                父组件的 scoped 属性到不了那一层。slot 内容在本组件作用域里编译，span 一定带得上。
                禁用时不染色，让 EP 的 is-disabled 灰色生效。
              -->
              <span
                :class="{
                  'table-actions__danger': button.type === 'danger' && !disabledOf(button)
                }"
              >
                <Icon v-if="button.icon" :icon="button.icon" class="mr-4px" />
                {{ labelOf(button) }}
              </span>
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </template>
  </div>
</template>

<style lang="scss" scoped>
.table-actions__danger {
  color: var(--el-color-danger);
}
</style>
