<!--
  五种触发方式的经典案例「参考手册」弹窗（AI助手 流程编排优化 / Req 3）

  从列表页工具栏「触发案例」打开：不新建、不落库，纯粹给人看——想知道「这种触发方式一般怎么用」
  时不必先建一条草稿再进去猜。五个页签对应五种触发方式，内容全部来自 triggerCases.ts。

  🔴 open(type?) 可指定初始页签：新增弹窗里点「查看全部案例」时，直接停在当前选的那种触发方式上。
-->
<template>
  <Dialog v-model="visible" title="触发方式经典案例" width="860px">
    <el-alert type="info" :closable="false" class="!mb-12px">
      <template #title>
        每种触发方式各一个可直接使用的完整案例。新增流程时把「起步模板」选为「经典案例」，
        建出来的就是当前触发方式对应的那一份，进设计器后可随意改。
      </template>
    </el-alert>

    <el-tabs v-model="activeTab" data-testid="trigger-case-tabs">
      <el-tab-pane
        v-for="c in cases"
        :key="c.triggerType"
        :name="c.triggerType"
        :label="triggerTypeLabel(c.triggerType)"
      >
        <TriggerCaseView :case-data="c" />
      </el-tab-pane>
    </el-tabs>

    <template #footer>
      <el-button @click="visible = false">关闭</el-button>
    </template>
  </Dialog>
</template>

<script lang="ts" setup>
import TriggerCaseView from './TriggerCaseView.vue'
import { TRIGGER_CASE_ORDER, TRIGGER_CASES, triggerTypeLabel } from '../triggerCases'
import type { WorkflowTriggerType } from '../starterDsl'

defineOptions({ name: 'TriggerCaseDialog' })

const visible = ref(false)
const activeTab = ref<WorkflowTriggerType>('none')

const cases = TRIGGER_CASE_ORDER.map((t) => TRIGGER_CASES[t])

const open = (type?: string | null) => {
  // 认不出的类型回到第一个页签，绝不留空白页
  activeTab.value = TRIGGER_CASE_ORDER.includes(type as WorkflowTriggerType)
    ? (type as WorkflowTriggerType)
    : TRIGGER_CASE_ORDER[0]
  visible.value = true
}
defineExpose({ open })
</script>
