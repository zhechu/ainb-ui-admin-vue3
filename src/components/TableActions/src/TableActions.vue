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
const tooltipOf = (button: TableActionButton) =>
  resolveRowValue<string>(button.tooltip, props.row, '')

const invoke = (command: string | number | object) => {
  folded.value[Number(command)]?.onClick(props.row)
}
</script>

<template>
  <div class="table-actions">
    <span v-if="visible.length === 0" class="table-actions__empty">{{ emptyText }}</span>
    <template v-else>
      <!--
        有 tooltip 的按钮包一层 span：原生 disabled 的 <button> 浏览器不派发鼠标事件，
        loading 态的 el-button 更是 CSS pointer-events:none，两种情况 tooltip 都挂不上按钮本身。
        span 一插进按钮序列，全局 .el-button + .el-button / .el-button + .el-dropdown 的
        12px 间距就在 span 两侧各断一次，由文件末尾两条 scoped 规则补回；
        没配 tooltip 的页面渲染结构与原来逐字相同，不受影响。
      -->
      <template v-for="button in inline" :key="button.key">
        <el-tooltip v-if="tooltipOf(button)" :content="tooltipOf(button)" placement="top">
          <span class="table-actions__tip">
            <el-button
              link
              :size="size"
              :type="button.type ?? 'primary'"
              :disabled="disabledOf(button)"
              :loading="loadingOf(button)"
              @click="button.onClick(row)"
            >
              {{ labelOf(button) }}
            </el-button>
          </span>
        </el-tooltip>
        <el-button
          v-else
          link
          :size="size"
          :type="button.type ?? 'primary'"
          :disabled="disabledOf(button)"
          :loading="loadingOf(button)"
          @click="button.onClick(row)"
        >
          {{ labelOf(button) }}
        </el-button>
      </template>

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
              <!--
                折叠不能把禁用理由折没：EP 的 is-disabled 只挡点击、不挡 hover，
                tooltip 照旧能弹（它挡 hover 的是禁用的 el-button，那边才需要 span 兜一层）
              -->
              <el-tooltip v-if="tooltipOf(button)" :content="tooltipOf(button)" placement="left">
                <span class="table-actions__folded-tip">{{ labelOf(button) }}</span>
              </el-tooltip>
              <template v-else>{{ labelOf(button) }}</template>
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </template>
  </div>
</template>

<style lang="scss" scoped>
/*
  tooltip 的 span 包装插进按钮序列后，全局间距规则（styles/index.scss 的
  .el-button + .el-button / .el-button + .el-dropdown）在 span 两侧各断一次，
  这里补回同一个 12px。只有配了 tooltip 的行才会出现 .table-actions__tip，
  其余页面的渲染结构与间距来源和原来完全一致。
*/
.table-actions__tip {
  display: inline-block;
  vertical-align: middle;
}
.el-button + .table-actions__tip,
.el-dropdown + .table-actions__tip {
  margin-left: 12px;
}
.table-actions__tip + .el-button,
.table-actions__tip + .el-dropdown {
  margin-left: 12px;
}
/*
  「更多」的 li 是 flex，宽度由最长的那一项决定，而 tooltip 的触发器只是包住文字的 span：
  不撑满的话鼠标停在同一行的空白处弹不出理由——恰恰是「删除」这两个字最短、
  最需要理由的那一项吃亏。scoped 选择器带 data-v 属性，跟着 span 一起被 teleport 到
  body 的下拉里照样命中。
*/
.table-actions__folded-tip {
  display: flex;
  flex: 1;
  align-items: center;
  align-self: stretch;
}
</style>
