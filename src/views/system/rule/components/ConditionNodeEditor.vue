<!--
  条件树节点编辑器（递归组件）。

  - GROUP：逻辑（并且/或者）单选 + 子节点缩进列表 + [添加条件][添加条件组]（达 MAX_TREE_DEPTH 禁用）+ 删除
  - CONDITION：槽位 select + 操作符 select + 值区（随操作符形态变化）+ 删除

  值区规则（对齐后端 ConditionTreeEvaluator.resolveValue），统一为单个控件以保证一个条件一行：
    unary（为空/不为空）→ 无值；
    multiValue（属于/不属于）→ 仅【集合变量】下拉，存 :name（字面量会被求值器当单元素串，静默出错）；
    其余标量操作符 → 变量为下拉选项、字面量直接输入（allow-create），存 :name 或原文。

  ⚠️ 自引用：文件名 ConditionNodeEditor.vue 即可在模板里递归使用自己（Vue SFC 隐式自引用）。
  所有变更都以「emit 一个新节点」的不可变方式上抛，父级负责替换。
-->
<template>
  <div class="condition-node">
    <!-- ===== 条件组 ===== -->
    <template v-if="isGroup">
      <div class="group-header">
        <el-radio-group :model-value="groupNode.logic" size="small" @update:model-value="onLogicChange">
          <el-radio-button value="AND">并且</el-radio-button>
          <el-radio-button value="OR">或者</el-radio-button>
        </el-radio-group>
        <div class="group-actions">
          <el-button size="small" :disabled="atMaxDepth" @click="addChild('CONDITION')">
            + 条件
          </el-button>
          <el-button size="small" :disabled="atMaxDepth" @click="addChild('GROUP')">
            + 条件组
          </el-button>
          <el-button v-if="canDelete" size="small" type="danger" link @click="emit('remove')">
            删除
          </el-button>
        </div>
      </div>
      <div v-if="groupNode.children.length" class="group-children">
        <ConditionNodeEditor
          v-for="(child, idx) in groupNode.children"
          :key="idx"
          :node="child"
          :meta="meta"
          :depth="depth + 1"
          :can-delete="true"
          @update="(n) => replaceChild(idx, n)"
          @remove="removeChild(idx)"
        />
      </div>
      <div v-else class="empty-group">（空条件组，点上方「+ 条件」添加）</div>
    </template>

    <!-- ===== 单个条件 ===== -->
    <template v-else>
      <div class="condition-row">
        <el-select
          :model-value="leafNode.slot"
          placeholder="字段"
          filterable
          size="small"
          class="!w-140px"
          @update:model-value="(v: string) => patchLeaf({ slot: v })"
        >
          <el-option v-for="s in meta.slots" :key="s.slot" :label="s.slot" :value="s.slot">
            <span>{{ s.slot }}</span>
            <span class="ml-8px text-11px text-gray-400">{{ s.description }}</span>
          </el-option>
        </el-select>

        <el-select
          :model-value="leafNode.operator"
          placeholder="操作符"
          size="small"
          class="!w-140px"
          @update:model-value="onOperatorChange"
        >
          <el-option
            v-for="op in meta.operators"
            :key="op.code"
            :label="op.label"
            :value="op.code"
          />
        </el-select>

        <!-- 值区：随操作符形态切换；统一为单个控件以保证「一个条件一行」 -->
        <template v-if="!opMeta?.unary">
          <!-- IN / NOT_IN：仅集合变量（字面量会被求值器当单元素串，静默出错） -->
          <el-select
            v-if="opMeta?.multiValue"
            :model-value="leafNode.value"
            placeholder="选择集合变量"
            size="small"
            class="condition-value"
            @update:model-value="(v: string) => patchLeaf({ value: v })"
          >
            <el-option
              v-for="v in collectionVars"
              :key="v.name"
              :label="v.label"
              :value="':' + v.name"
            >
              <span>{{ v.label }}</span>
              <span class="ml-8px text-11px text-gray-400">{{ v.name }}</span>
            </el-option>
          </el-select>

          <!-- 标量操作符：变量为下拉选项，字面量直接输入（allow-create），存 :name 或原文 -->
          <el-select
            v-else
            :model-value="leafNode.value"
            placeholder="值或变量（可直接输入）"
            size="small"
            filterable
            allow-create
            default-first-option
            :reserve-keyword="false"
            class="condition-value"
            @update:model-value="(v: string) => patchLeaf({ value: v })"
          >
            <el-option v-for="v in meta.variables" :key="v.name" :label="v.label" :value="':' + v.name">
              <span>{{ v.label }}</span>
              <span class="ml-8px text-11px text-gray-400">{{ v.name }}</span>
            </el-option>
          </el-select>
        </template>

        <el-button v-if="canDelete" size="small" type="danger" link @click="emit('remove')">
          删除
        </el-button>
      </div>
    </template>
  </div>
</template>

<script lang="ts" setup>
import type { RuleTemplateMetaVO } from '@/api/system/grant'
import { MAX_TREE_DEPTH } from './ruleParams'
import type { ConditionNodeModel, ConditionGroupModel, ConditionLeafModel } from './ruleParams'

defineOptions({ name: 'ConditionNodeEditor' })

const props = defineProps<{
  node: ConditionNodeModel
  meta: RuleTemplateMetaVO
  depth: number
  canDelete: boolean
}>()
const emit = defineEmits<{
  update: [ConditionNodeModel]
  remove: []
}>()

const isGroup = computed(() => props.node.type === 'GROUP')
const groupNode = computed(() => props.node as ConditionGroupModel)
const leafNode = computed(() => props.node as ConditionLeafModel)

const atMaxDepth = computed(() => props.depth >= MAX_TREE_DEPTH)

const opMeta = computed(() => props.meta.operators.find((o) => o.code === leafNode.value.operator))
const collectionVars = computed(() => props.meta.variables.filter((v) => v.collection))

const emitGroup = (patch: Partial<ConditionGroupModel>) =>
  emit('update', { ...groupNode.value, ...patch } as ConditionGroupModel)
const patchLeaf = (patch: Partial<ConditionLeafModel>) =>
  emit('update', { ...leafNode.value, ...patch } as ConditionLeafModel)

const onLogicChange = (logic: 'AND' | 'OR') => emitGroup({ logic })

const addChild = (kind: 'CONDITION' | 'GROUP') => {
  const child: ConditionNodeModel =
    kind === 'GROUP'
      ? { type: 'GROUP', logic: 'AND', children: [] }
      : { type: 'CONDITION', slot: '', operator: '' }
  emitGroup({ children: [...groupNode.value.children, child] })
}
const replaceChild = (idx: number, n: ConditionNodeModel) => {
  const children = groupNode.value.children.slice()
  children[idx] = n
  emitGroup({ children })
}
const removeChild = (idx: number) => {
  const children = groupNode.value.children.slice()
  children.splice(idx, 1)
  emitGroup({ children })
}

/** 操作符变了：形态可能变，清掉旧值（一元无值；其余重新选值） */
const onOperatorChange = (operator: string) => {
  const op = props.meta.operators.find((o) => o.code === operator)
  if (op?.unary) {
    const next = { ...leafNode.value, operator }
    delete next.value
    emit('update', next)
    return
  }
  patchLeaf({ operator, value: '' })
}
</script>

<style scoped>
.condition-node {
  width: 100%;
}
.group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 0;
}
.group-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}
.group-children {
  margin: 4px 0 4px 16px;
  padding-left: 12px;
  border-left: 1px dashed var(--el-border-color);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.empty-group {
  margin-left: 16px;
  padding: 4px 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.condition-row {
  display: flex;
  align-items: center;
  /* 一个条件必须保持单行：不换行，值控件弹性伸缩吸收剩余宽度 */
  flex-wrap: nowrap;
  gap: 6px;
  padding: 2px 0;
}
.condition-value {
  flex: 1 1 140px;
  min-width: 120px;
}
</style>
