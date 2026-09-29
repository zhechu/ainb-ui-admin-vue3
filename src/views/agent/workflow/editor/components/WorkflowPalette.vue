<!--
  流程设计器 · 左栏节点目录（增量8 / P4，Phase C）

  从 WorkflowEditorCanvas.vue 拆出的 palette 段：按分组展示全部 13 种节点类型，支持点击新增与拖拽落点。
  本身不持有状态，全部经 props.editor（useWorkflowEditor）读写；拖拽落点坐标换算在 Designer 里做。
-->
<template>
  <aside class="wf-palette">
    <div class="wf-palette__title">节点目录</div>
    <el-scrollbar class="wf-palette__scroll">
      <template v-for="g in paletteGroups" :key="g.name">
        <div class="wf-palette__group">{{ g.name }}</div>
        <el-tooltip
          v-for="item in g.items"
          :key="item.value"
          :content="item.description"
          placement="right"
          :show-after="300"
        >
          <div
            class="wf-palette__item"
            draggable="true"
            @dragstart="onPaletteDragStart($event, item.value)"
            @click="addNodeByClick(item.value)"
          >
            <Icon icon="ep:rank" class="wf-palette__grip" />
            <el-tag size="small" :type="item.tagType" effect="plain" class="wf-palette__tag">
              {{ item.label }}
            </el-tag>
          </div>
        </el-tooltip>
      </template>
      <div class="wf-palette__hint">
        点击即加入画布；也可拖到画布指定位置。<br />
        想接在某一步后面？把鼠标移到那个节点上，点它右侧的「＋」更快。
      </div>
    </el-scrollbar>
  </aside>
</template>

<script lang="ts" setup>
import type { WorkflowEditorContext } from '../useWorkflowEditor'

defineOptions({ name: 'WorkflowPalette' })

const props = defineProps<{ editor: WorkflowEditorContext }>()
const { paletteGroups, onPaletteDragStart, addNodeByClick } = props.editor
</script>

<style lang="scss" scoped>
/*
  Req4：字号走 --wf-fs-* 令牌（全局值定义在 :root 上，见 editor/index.vue）。

  🔴 Req4 二次加大（2026-09-29）：11/12/13px 的侧栏在 1080p 下仍偏小，但直接改 :root 会连带把
     画布节点卡、沙箱面板一起放大——那些地方宽度是算死的，容易挤爆。故只在本侧栏根元素上
     【覆盖】同名令牌：CSS 自定义属性按 DOM 继承，本组件内所有子元素（含 el-tag / el-scrollbar 内部）
     都会拿到加大后的值，而画布与其它面板不受影响。宽度同步 +18px 容纳变大的字。
*/
.wf-palette {
  --wf-fs-xs: 12px;
  --wf-fs-sm: 13px;
  --wf-fs-md: 14px;
  --wf-fs-lg: 16px;

  display: flex;
  width: 186px;
  flex-shrink: 0;
  flex-direction: column;
  border-right: 1px solid var(--el-border-color-light);
  background: var(--el-bg-color);
}

.wf-palette__title {
  padding: 10px 12px 6px;
  font-size: var(--wf-fs-md, 14px);
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.wf-palette__scroll {
  min-height: 0;
  flex: 1;
  padding: 0 8px 8px;
}

.wf-palette__group {
  margin: 8px 4px 4px;
  font-size: var(--wf-fs-xs, 12px);
  font-weight: 600;
  color: var(--el-text-color-placeholder);
}

.wf-palette__item {
  display: flex;
  margin-bottom: 4px;
  padding: 6px 8px;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  cursor: pointer;
  align-items: center;
  gap: 6px;
  transition: all 0.15s;

  &:hover {
    border-color: var(--el-color-primary);
    background: var(--el-color-primary-light-9);
  }
}

.wf-palette__grip {
  flex-shrink: 0;
  color: var(--el-text-color-placeholder);
}

.wf-palette__tag {
  min-width: 0;
  flex: 1;
  justify-content: center;
  /* 🔴 el-tag size="small" 的字号是 Element 写死的 12px、不吃 --wf-fs-* 令牌，
     不单独提上来的话「标题变大了、节点名反而更小」，比原来更参差 */
  font-size: var(--wf-fs-sm, 13px);
}

.wf-palette__hint {
  margin-top: 8px;
  padding: 0 4px;
  font-size: var(--wf-fs-xs, 12px);
  line-height: 18px;
  color: var(--el-text-color-placeholder);
}
</style>
