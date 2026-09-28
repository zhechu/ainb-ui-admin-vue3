<!--
  触发方式经典案例「单个案例」的展示组件（AI助手 流程编排优化 / Req 3）

  被两处复用，故抽成组件而不是各写一份：
   · WorkflowForm.vue  —— 新增/编辑弹窗里内联展示「当前触发方式」的案例（嵌在 Dialog 内，
                          🔴 刻意不再套一层 Dialog：项目 Dialog 会把 appendToBody 从透传属性里删掉，
                          嵌套弹窗会渲染在父弹窗 DOM 内、层级不可控）；
   · TriggerCaseDialog.vue —— 列表页「触发案例」按钮打开的独立弹窗，用 el-tabs 平铺五种。

  纯展示：只读 triggerCases.ts 的案例数据 + 用 buildStarterDsl 现算一份预览 DSL，不发请求、不改状态。
-->
<template>
  <div class="tcv">
    <div class="tcv__head">
      <el-tag size="small" type="primary" effect="plain">
        {{ triggerTypeLabel(caseData.triggerType) }}
      </el-tag>
      <span class="tcv__title">{{ caseData.title }}</span>
    </div>
    <p class="tcv__scenario">{{ caseData.scenario }}</p>

    <div class="tcv__row">
      <span class="tcv__k">流程走向</span>
      <code class="tcv__v tcv__v--mono">{{ caseData.flowText }}</code>
    </div>
    <div class="tcv__row">
      <span class="tcv__k">触发怎么填</span>
      <span class="tcv__v">{{ caseData.configSummary }}</span>
    </div>

    <div class="tcv__sub">要点</div>
    <ul class="tcv__hl">
      <li v-for="(h, i) in caseData.highlights" :key="i">{{ h }}</li>
    </ul>

    <el-collapse v-if="showDsl" class="tcv__collapse">
      <el-collapse-item :name="caseData.triggerType" :title="dslTitle">
        <CodeEditor :model-value="previewDsl" language="json" readonly height="300px" />
      </el-collapse-item>
    </el-collapse>
  </div>
</template>

<script lang="ts" setup>
import { buildStarterDsl, type WorkflowTriggerMeta } from '../starterDsl'
import { triggerTypeLabel, type TriggerCase } from '../triggerCases'

defineOptions({ name: 'TriggerCaseView' })

const props = withDefaults(
  defineProps<{
    caseData: TriggerCase
    /** 是否附带「查看起步 DSL」折叠区（弹窗里给全量，表单内联时从简） */
    showDsl?: boolean
    dslTitle?: string
  }>(),
  { showDsl: true, dslTitle: '查看这份案例的起步 DSL（选「经典案例」模板新建时生成的就是它）' }
)

/**
 * 现算一份预览 DSL：与真实新建走的是同一个 buildStarterDsl('case', …)，
 * 所以「看到的」与「建出来的」不可能不一致。触发配置用案例的建议值（agentId/formCode 因租户而异，留空）。
 */
const previewDsl = computed(() =>
  buildStarterDsl('case', {
    code: `demo_${props.caseData.triggerType}`,
    name: props.caseData.title,
    description: props.caseData.scenario,
    trigger: { type: props.caseData.triggerType, ...props.caseData.triggerDefaults } as WorkflowTriggerMeta
  })
)
</script>

<style lang="scss" scoped>
.tcv {
  font-size: 13px;
  line-height: 1.7;
  color: var(--el-text-color-regular);
}

.tcv__head {
  display: flex;
  gap: 8px;
  align-items: center;
}

.tcv__title {
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.tcv__scenario {
  margin: 6px 0 10px;
}

.tcv__row {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 6px 0;
  border-top: 1px dashed var(--el-border-color-lighter);
}

.tcv__k {
  flex: 0 0 76px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.tcv__v {
  flex: 1;
  min-width: 0;
}

.tcv__v--mono {
  font-family: var(--el-font-family-mono, Consolas, Monaco, 'Courier New', monospace);
  font-size: 12px;
  word-break: break-all;
}

.tcv__sub {
  margin: 10px 0 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
}

.tcv__hl {
  padding-left: 18px;
  margin: 0;
  list-style: disc;

  li {
    margin-bottom: 3px;
  }
}

.tcv__collapse {
  margin-top: 10px;
  border-top: none;

  :deep(.el-collapse-item__header) {
    height: 34px;
    font-size: 12px;
    line-height: 34px;
    color: var(--el-color-primary);
    border-bottom: none;
  }

  :deep(.el-collapse-item__wrap) {
    border-bottom: none;
  }
}
</style>
