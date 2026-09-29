<!--
  流程设计器 · 右栏属性面板（增量8 / P4，Phase C）

  从 WorkflowEditorCanvas.vue 拆出的 property panel 段：选中节点 → 结构化配置（nodeConfigSchema 驱动）
  + condition.rule/parallel 分支可视化 + 失败恢复与补偿（开发者模式）+ config JSON 兜底；选中连线 → 条件边
  case/default 可视化编辑；未选中 → 操作提示。本身不持有 DSL 状态，全部经 props.editor 读写。

  Phase E 将在此叠加「类型化输入/输出端口 + 上游变量引用选择器」，让非技术人员看懂前序节点产出、后序如何引用。
-->
<template>
  <aside class="wf-panel">
    <el-scrollbar class="wf-panel__scroll">
      <!-- 选中节点 -->
      <template v-if="selectedNode">
        <div class="wf-panel__title">
          节点配置
          <el-tag size="small" :type="nodeTypeTag(selectedNode.type)" effect="plain">
            {{ nodeTypeLabel(selectedNode.type) }}
          </el-tag>
        </div>
        <!-- 引用可达性提醒（🔴 黄色、不阻断保存/发布；与后端 validateReferenceReachability 同口径） -->
        <el-alert
          v-if="nodeRefWarnings.length"
          type="warning"
          :closable="false"
          show-icon
          class="mb-8px"
          data-testid="node-ref-warnings"
        >
          <template #title>引用提醒（不影响保存）</template>
          <ul class="wf-panel__warn-list">
            <li v-for="(w, i) in nodeRefWarnings" :key="i">{{ w.message }}</li>
          </ul>
        </el-alert>
        <el-form label-position="top" size="small" :disabled="readonly">
          <el-form-item label="节点 ID">
            <el-input :model-value="selectedNode.id" disabled />
          </el-form-item>
          <el-form-item label="名称">
            <el-input v-model="selectedNode.name" placeholder="节点显示名" @input="mutate" />
          </el-form-item>
          <!-- 结构化字段：由 nodeConfigSchema 按节点类型驱动（键逐字对齐后端执行器） -->
          <template v-for="f in visibleFields" :key="f.key">
            <el-form-item>
              <template #label>
                <span class="wf-field-label">
                  <span
                    v-if="canRefField(f.key)"
                    class="wf-dot"
                    :style="{ background: fieldColor(f.key) }"
                    :title="`这个输入接受「${fieldTypeLabel(f.key)}」类型的值`"
                  ></span>
                  <span>{{ f.label }}</span>
                  <span v-if="canRefField(f.key)" class="wf-field-type">{{ fieldTypeLabel(f.key) }}</span>
                  <span v-if="isRequiredField(f.key)" class="wf-req">*</span>
                </span>
              </template>
              <el-select
                v-if="f.kind === 'select'"
                v-model="selConfig[f.key]"
                filterable
                :allow-create="f.optionsFrom === 'tool' || f.optionsFrom === 'workflow'"
                :default-first-option="f.optionsFrom === 'tool' || f.optionsFrom === 'workflow'"
                clearable
                :placeholder="f.placeholder || '请选择'"
                class="w-full"
                @change="mutate"
              >
                <el-option
                  v-for="o in optionsFor(f)"
                  :key="String(o.value)"
                  :label="o.label"
                  :value="o.value"
                >
                  <span class="float-left">{{ o.label }}</span>
                  <span
                    v-if="o.desc"
                    class="float-right text-12px text-[var(--el-text-color-secondary)] ml-12px max-w-140px truncate"
                  >
                    {{ o.desc }}
                  </span>
                </el-option>
              </el-select>
              <el-input
                v-else-if="f.kind === 'textarea'"
                v-model="selConfig[f.key]"
                type="textarea"
                :rows="3"
                :placeholder="f.placeholder"
                @input="mutate"
              />
              <el-input-number
                v-else-if="f.kind === 'number'"
                v-model="selConfig[f.key]"
                :min="f.min"
                :max="f.max"
                :step="f.step"
                :controls-position="'right'"
                class="!w-full"
                @change="mutate"
              />
              <el-switch v-else-if="f.kind === 'switch'" v-model="selConfig[f.key]" @change="mutate" />
              <!-- 字符串数组 → 标签输入（condition.llm.choices / agent_loop.tools / iteration.body） -->
              <el-select
                v-else-if="f.kind === 'tags'"
                v-model="selConfig[f.key]"
                multiple
                filterable
                allow-create
                default-first-option
                :reserve-keyword="false"
                :placeholder="f.placeholder || '输入后按回车添加'"
                class="w-full"
                @change="mutate"
              >
                <el-option v-for="o in tagsOptionsFor(f)" :key="o" :label="o" :value="o" />
              </el-select>
              <!-- 对象键值对 → KeyValueEditor（tool.args / hitl.bpm_approval.formVars） -->
              <KeyValueEditor
                v-else-if="f.kind === 'kv'"
                v-model="selConfig[f.key]"
                @update:model-value="mutate"
              />
              <el-input v-else v-model="selConfig[f.key]" :placeholder="f.placeholder" @input="mutate" />
              <div v-if="f.hint" class="wf-panel__hint">{{ f.hint }}</div>
              <!-- 可引用上游的字段：挂「＋引用上游变量」入口，点选即写入（形态随字段：裸名 / {{$.var}}） -->
              <VariableRefPicker
                v-if="canRefField(f.key)"
                :upstream="upstreamVars"
                :form="pickFormFor(f.key)"
                :model-value="selConfig[f.key]"
                :insert-mode="f.kind === 'textarea' ? 'append' : 'replace'"
                :readonly="readonly"
                @update:model-value="onPickRef(f.key, $event)"
              />
            </el-form-item>
          </template>

          <!-- 本节点产出（Req5：后序节点如何引用我）——只有会产出变量的节点才显示 -->
          <template v-if="nodeOutputDocs.length">
            <el-divider content-position="left">本节点产出（供下游引用）</el-divider>
            <div class="wf-io">
              <div v-for="o in nodeOutputDocs" :key="o.varName" class="wf-io__row">
                <span class="wf-dot" :style="{ background: dataTypeColor(o.dataType) }"></span>
                <code class="wf-io__var">{{ o.varName }}</code>
                <el-tag size="small" effect="plain">{{ o.dataTypeLabel }}</el-tag>
                <span class="wf-io__label">{{ o.label }}</span>
              </div>
              <div class="wf-panel__hint">{{ outputExample }}</div>
            </div>
          </template>

          <!-- condition.rule 分支可视化：单层 AND 条件；conditionGroups 嵌套走底部 JSON -->
          <template v-if="selectedNode.type === 'condition.rule'">
            <el-divider content-position="left">分支（按顺序匹配，命中即走）</el-divider>
            <div v-for="(b, bi) in ruleBranches" :key="bi" class="wf-branch">
              <div class="wf-branch__head">
                <span class="wf-branch__name">分支 {{ bi + 1 }}</span>
                <el-button
                  v-if="!readonly"
                  size="small"
                  type="danger"
                  text
                  :disabled="branchUsesGroups(b)"
                  @click="onRemoveRuleBranch(bi)"
                >
                  删除
                </el-button>
              </div>
              <div v-if="branchUsesGroups(b)" class="wf-panel__warn">
                该分支使用 conditionGroups 嵌套写法，为避免破坏结构请在底部 DSL JSON 中编辑。
              </div>
              <template v-else>
                <el-form-item label="命中后走的路由键（target）" class="!mb-6px">
                  <el-input
                    :model-value="b.target"
                    placeholder="如 approved；需与该节点条件边的分支键一致"
                    @update:model-value="onBranchField(b, 'target', $event)"
                  />
                </el-form-item>
                <div class="wf-panel__sub">条件（多条同时满足才命中）：</div>
                <div v-for="(c, ci) in conditionsOf(b)" :key="ci" class="wf-cond">
                  <el-input
                    :model-value="c.var"
                    size="small"
                    placeholder="变量名"
                    class="!w-86px"
                    @update:model-value="onConditionField(b, ci, 'var', $event)"
                  />
                  <el-select
                    :model-value="c.op"
                    size="small"
                    class="!w-96px"
                    @update:model-value="onConditionField(b, ci, 'op', $event)"
                  >
                    <el-option v-for="op in RULE_OP_OPTIONS" :key="op.value" :label="op.label" :value="op.value" />
                  </el-select>
                  <el-input
                    v-if="needsValue(c.op)"
                    :model-value="toText(c.value)"
                    size="small"
                    placeholder="比较值"
                    class="flex-1"
                    @update:model-value="onConditionField(b, ci, 'value', $event)"
                  />
                  <el-button
                    v-if="!readonly"
                    size="small"
                    type="danger"
                    plain
                    circle
                    title="删除此条件"
                    @click="onRemoveRuleCondition(bi, ci)"
                  >
                    <Icon icon="ep:close" />
                  </el-button>
                </div>
                <el-button v-if="!readonly" size="small" text type="primary" @click="onAddRuleCondition(bi)">
                  <Icon icon="ep:plus" class="mr-2px" />添加条件（AND）
                </el-button>
              </template>
            </div>
            <el-button v-if="!readonly" size="small" plain @click="onAddRuleBranch">
              <Icon icon="ep:plus" class="mr-4px" />添加分支
            </el-button>
          </template>

          <!-- parallel 分支可视化：MVP 每条分支单节点；branches 是 string[][] -->
          <template v-else-if="selectedNode.type === 'parallel'">
            <el-divider content-position="left">并行分支</el-divider>
            <div class="wf-panel__sub">
              每行一条分支，选择分支要执行的节点（节点仍需先加入画布）。分支节点不要连进 edges，编译器自动接线。
            </div>
            <div v-for="(row, i) in parallelRows" :key="i" class="wf-cond">
              <el-select
                v-if="row.single"
                :model-value="row.value"
                filterable
                clearable
                placeholder="选择分支节点"
                size="small"
                class="flex-1"
                @update:model-value="onParallelRowChange(i, $event)"
              >
                <el-option v-for="o in branchNodeOptions" :key="o.value" :label="o.label" :value="o.value" />
              </el-select>
              <span v-else class="wf-panel__warn flex-1">多节点链分支，请在底部 DSL JSON 中编辑</span>
              <el-button
                v-if="!readonly"
                size="small"
                type="danger"
                plain
                circle
                title="删除此分支"
                @click="onParallelRemove(i)"
              >
                <Icon icon="ep:delete" />
              </el-button>
            </div>
            <el-button v-if="!readonly" size="small" text type="primary" @click="onParallelAdd">
              <Icon icon="ep:plus" class="mr-2px" />添加分支
            </el-button>
          </template>

          <!-- 失败恢复与补偿（Saga）：属高级项，默认藏在开发者模式后 -->
          <template v-if="devMode">
            <el-divider content-position="left">失败恢复与补偿</el-divider>
            <el-form-item v-if="nonCompensable" label="失败恢复">
              <el-tag size="small" type="info" data-testid="node-noncompensable-tag">不可补偿（固定向前恢复）</el-tag>
              <div class="wf-panel__hint">
                该节点类型的副作用不可逆（模型 token 已耗/检索无副作用），声明补偿不会生效；编排时请尽量后置。
              </div>
            </el-form-item>
            <template v-else>
              <el-form-item label="失败恢复（recovery）">
                <el-select
                  :model-value="nodeRecovery"
                  class="w-full"
                  data-testid="node-recovery-select"
                  @update:model-value="onRecoveryChange"
                >
                  <el-option label="跟随全局（默认 forward 断点续跑）" value="" />
                  <el-option label="forward — 失败后从断点续跑" value="forward" />
                  <el-option label="compensate — 失败时 Saga 逆序补偿" value="compensate" />
                </el-select>
              </el-form-item>
              <template v-if="nodeRecovery === 'compensate'">
                <el-form-item label="补偿动作工具（compensate_ref）">
                  <el-select
                    v-model="selComp.compensate_ref"
                    filterable
                    allow-create
                    default-first-option
                    clearable
                    placeholder="选择或输入工具键"
                    class="w-full"
                    data-testid="node-compensate-ref"
                    @change="mutate"
                  >
                    <el-option v-for="t in toolList" :key="t.name" :label="t.name" :value="t.name">
                      <span class="float-left">{{ t.name }}</span>
                      <span
                        v-if="t.description"
                        class="float-right text-12px text-[var(--el-text-color-secondary)] ml-12px max-w-140px truncate"
                      >
                        {{ t.description }}
                      </span>
                    </el-option>
                  </el-select>
                  <div class="wf-panel__hint">指向执行「语义反做」的工具键，如 form_data_delete 撤销 form_data_create。</div>
                </el-form-item>
                <el-form-item label="补偿前像（before_image，JSON 对象）">
                  <JsonCodeField
                    v-model="beforeImageText"
                    height="110px"
                    :readonly="readonly"
                    :placeholder="BEFORE_IMAGE_PLACEHOLDER"
                    test-id="node-before-image-status"
                    data-testid="node-before-image"
                  />
                  <el-button v-if="!readonly" size="small" class="mt-6px" @click="onBeforeImageChange">
                    应用到补偿前像
                  </el-button>
                  <div class="wf-panel__hint">
                    「参数名 → 模板」对象（模板形如双花括号包 $.变量路径）；补偿执行前把模板解析成工具入参。
                  </div>
                </el-form-item>
                <el-form-item label="幂等键（idempotency_key）">
                  <el-input
                    v-model="selComp.idempotency_key"
                    :placeholder="IDEMPOTENCY_KEY_PLACEHOLDER"
                    data-testid="node-idempotency-key"
                    @input="mutate"
                  />
                  <div class="wf-panel__hint">补偿重放时去重，防止重复反做。</div>
                </el-form-item>
              </template>
            </template>
          </template>

          <!-- config JSON 兜底：属高级项，默认藏在开发者模式后；condition.rule 已有可视化面板，不再摆裸 JSON 防双头编辑 -->
          <template v-if="devMode && selectedNode.type !== 'condition.rule'">
            <el-divider content-position="left">config</el-divider>
            <el-form-item label="完整 config（JSON）">
              <div v-if="jsonHint" class="wf-panel__hint mb-4px">{{ jsonHint }}</div>
              <JsonCodeField
                v-model="configText"
                height="150px"
                :readonly="readonly"
                placeholder="节点 config，JSON 对象"
                test-id="node-config-json-status"
              />
              <el-button v-if="!readonly" size="small" class="mt-6px" @click="applyConfig">
                应用到节点 config
              </el-button>
            </el-form-item>
          </template>
        </el-form>

        <!--
          Req4：删除节点从画布工具条搬到这里。
          🔴 它只作用于「当前选中节点」，放在选中项旁边才是就近操作；工具条上那个按钮无论选没选都在，
             既占地方又容易误点。Req2 取消了二次确认（顶栏撤销可兜底），所以按钮文案直接说明可找回。
        -->
        <el-button
          v-if="!readonly"
          size="small"
          type="danger"
          plain
          class="mt-10px w-full"
          data-testid="delete-node-btn"
          @click="deleteNode"
        >
          删除此节点（可用顶栏「撤销」找回）
        </el-button>
      </template>

      <!-- 选中连线 -->
      <template v-else-if="selectedEdge">
        <div class="wf-panel__title">连线</div>
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="起点">{{ selectedEdge.from }}</el-descriptions-item>
          <el-descriptions-item label="终点">{{ selectedEdge.to }}</el-descriptions-item>
          <el-descriptions-item label="类型">
            <el-tag v-if="!selectedEdgeIsConditional" size="small" type="info">普通顺序边</el-tag>
            <el-tag v-else size="small" type="warning">条件分支边</el-tag>
          </el-descriptions-item>
          <el-descriptions-item v-if="!selectedEdgeIsConditional && selectedEdge.route" label="分支">
            <el-tag size="small" type="warning">
              {{ selectedEdge.route === DEFAULT_ROUTE ? 'default' : selectedEdge.route }}
            </el-tag>
          </el-descriptions-item>
        </el-descriptions>

        <!-- 条件边可视化编辑：增改删 case 与 default -->
        <template v-if="selectedEdgeIsConditional">
          <el-divider content-position="left">分支走向</el-divider>
          <el-form label-position="top" size="small" :disabled="readonly">
            <div v-for="c in caseRows" :key="c.key" class="wf-cond mb-6px">
              <el-input
                :model-value="c.key"
                size="small"
                placeholder="分支名"
                class="!w-90px"
                @change="onCaseKeyChange(c.key, $event)"
              />
              <el-select
                :model-value="c.to"
                size="small"
                filterable
                clearable
                placeholder="目标节点"
                class="flex-1"
                @update:model-value="onCaseToChange(c.key, $event)"
              >
                <el-option v-for="o in nodeOptions" :key="o.value" :label="o.label" :value="o.value" />
              </el-select>
              <el-button
                v-if="!readonly"
                size="small"
                type="danger"
                plain
                circle
                title="删除此分支"
                @click="onCaseRemove(c.key)"
              >
                <Icon icon="ep:delete" />
              </el-button>
            </div>
            <div class="wf-cond mb-6px">
              <el-tag size="small" type="warning" class="!w-90px justify-center">默认分支</el-tag>
              <el-select
                :model-value="defaultTarget"
                size="small"
                filterable
                clearable
                placeholder="都不命中时走"
                class="flex-1"
                @update:model-value="onDefaultChange"
              >
                <el-option v-for="o in nodeOptions" :key="o.value" :label="o.label" :value="o.value" />
              </el-select>
            </div>
            <el-button v-if="!readonly" size="small" text type="primary" @click="onCaseAdd">
              <Icon icon="ep:plus" class="mr-2px" />添加分支
            </el-button>
            <div class="wf-panel__hint mt-4px">
              这里的分支名要和条件节点里设置的分支一致，否则流程永远走不到这条分支。
            </div>
          </el-form>
        </template>
        <el-button
          v-if="!readonly"
          size="small"
          type="danger"
          plain
          class="mt-10px w-full"
          data-testid="delete-edge-btn"
          @click="deleteEdge"
        >
          删除此连线（可用顶栏「撤销」找回）
        </el-button>
      </template>

      <!-- 未选中：流程信息（描述）+ 操作提示 -->
      <div v-else class="wf-panel__empty">
        <div class="wf-panel__title">流程信息</div>
        <el-form label-position="top" size="small" :disabled="readonly">
          <el-form-item label="描述">
            <el-input
              v-model="description"
              type="textarea"
              :rows="2"
              placeholder="这条流程做什么（选填）"
              maxlength="500"
              show-word-limit
            />
          </el-form-item>
        </el-form>
        <el-divider content-position="left">操作提示</el-divider>
        <ul class="wf-panel__empty-list">
          <li>左侧目录点击或拖拽新增节点</li>
          <li>鼠标移到节点上，点它右侧的「＋」可直接接一个下一步</li>
          <li>拖动节点调整位置（保存后记住布局）</li>
          <li>从节点右侧圆点拉到另一节点左侧圆点连线</li>
          <li>从条件节点拉线时，会让你选择走哪条分支</li>
          <li>单击节点/连线在此编辑或删除</li>
          <li>删错了不要紧：顶栏「撤销」能一步步回退</li>
        </ul>
      </div>
    </el-scrollbar>
  </aside>
</template>

<script lang="ts" setup>
import KeyValueEditor from '../../components/KeyValueEditor.vue'
import JsonCodeField from './JsonCodeField.vue'
import VariableRefPicker from './VariableRefPicker.vue'
import type { WorkflowEditorContext } from '../useWorkflowEditor'

defineOptions({ name: 'WorkflowPropertyPanel' })

/** 流程元信息（描述）双向绑定：由页面 v-model 下发，编辑即回写 formData（页面 watch 标脏） */
const description = defineModel<string>('description')

const props = defineProps<{ editor: WorkflowEditorContext; readonly: boolean }>()
const {
  selectedNode,
  selectedEdge,
  selConfig,
  visibleFields,
  optionsFor,
  tagsOptionsFor,
  mutate,
  nodeTypeLabel,
  nodeTypeTag,
  // Phase E：类型化 I/O 端口 + 上游引用
  upstreamVars,
  nodeOutputDocs,
  nodeRefWarnings,
  outputExample,
  pickFormFor,
  canRefField,
  isRequiredField,
  fieldColor,
  fieldTypeLabel,
  onPickRef,
  dataTypeColor,
  ruleBranches,
  branchUsesGroups,
  conditionsOf,
  onBranchField,
  onConditionField,
  onAddRuleBranch,
  onRemoveRuleBranch,
  onAddRuleCondition,
  onRemoveRuleCondition,
  RULE_OP_OPTIONS,
  needsValue,
  toText,
  parallelRows,
  branchNodeOptions,
  onParallelRowChange,
  onParallelAdd,
  onParallelRemove,
  devMode,
  nonCompensable,
  nodeRecovery,
  onRecoveryChange,
  selComp,
  beforeImageText,
  onBeforeImageChange,
  toolList,
  BEFORE_IMAGE_PLACEHOLDER,
  IDEMPOTENCY_KEY_PLACEHOLDER,
  configText,
  applyConfig,
  jsonHint,
  selectedEdgeIsConditional,
  caseRows,
  defaultTarget,
  nodeOptions,
  onCaseKeyChange,
  onCaseToChange,
  onCaseRemove,
  onDefaultChange,
  onCaseAdd,
  deleteNode,
  deleteEdge,
  DEFAULT_ROUTE
} = props.editor
</script>

<style lang="scss" scoped>
/* Req4：字号一律走 --wf-fs-* 令牌（定义在 .wf-editor 上，见 editor/index.vue），不再各处硬编码 */
.wf-panel {
  display: flex;
  width: 320px;
  flex-shrink: 0;
  flex-direction: column;
  border-left: 1px solid var(--el-border-color-light);
  background: var(--el-bg-color);
}

.wf-panel__scroll {
  min-height: 0;
  flex: 1;
  padding: 10px 12px;
}

/* 表单标签与分组标题统一：原来标签是 Element 默认 14px、分组标题 12px，同一列里两种字号看着跳 */
.wf-panel :deep(.el-form-item__label) {
  font-size: var(--wf-fs-sm, 12px);
  font-weight: 500;
  line-height: 18px;
}

.wf-panel :deep(.el-divider__text) {
  font-size: var(--wf-fs-sm, 12px);
  font-weight: 600;
  color: var(--el-text-color-secondary);
}

.wf-panel__title {
  display: flex;
  margin-bottom: 8px;
  font-size: var(--wf-fs-md, 13px);
  font-weight: 600;
  align-items: center;
  gap: 6px;
}

.wf-panel__hint {
  margin-top: 2px;
  font-size: var(--wf-fs-xs, 11px);
  line-height: 16px;
  color: var(--el-text-color-placeholder);
}

.wf-panel__sub {
  margin-bottom: 4px;
  font-size: var(--wf-fs-xs, 11px);
  line-height: 16px;
  color: var(--el-text-color-placeholder);
}

.wf-panel__warn {
  font-size: var(--wf-fs-xs, 11px);
  line-height: 16px;
  color: var(--el-color-warning);
}

.wf-panel__warn-list {
  margin: 0;
  padding-left: 16px;
  font-size: var(--wf-fs-sm, 12px);
  line-height: 18px;
}

/* Phase E：字段标签的类型色点 / 类型名 / 必填星号 */
.wf-field-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.wf-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.wf-field-type {
  padding: 0 4px;
  border-radius: 3px;
  background: var(--el-fill-color);
  // 10px 在 1080p 下几乎看不清，统一到最小档 11px
  font-size: var(--wf-fs-xs, 11px);
  line-height: 16px;
  color: var(--el-text-color-secondary);
}

.wf-req {
  color: var(--el-color-danger);
}

/* Phase E：本节点产出（供下游引用）区 */
.wf-io {
  margin-bottom: 8px;
}

.wf-io__row {
  display: flex;
  margin-bottom: 4px;
  align-items: center;
  gap: 6px;
  font-size: var(--wf-fs-sm, 12px);
}

.wf-io__var {
  padding: 1px 5px;
  border-radius: 3px;
  background: var(--el-fill-color-light);
  font-family: var(--wf-mono, monospace);
  font-size: var(--wf-fs-xs, 11px);
}

.wf-io__label {
  color: var(--el-text-color-secondary);
}

.wf-branch {
  margin-bottom: 8px;
  padding: 8px;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
}

.wf-branch__head {
  display: flex;
  margin-bottom: 6px;
  align-items: center;
  justify-content: space-between;
}

.wf-branch__name {
  font-size: var(--wf-fs-sm, 12px);
  font-weight: 600;
}

.wf-cond {
  display: flex;
  margin-bottom: 4px;
  align-items: center;
  gap: 4px;
}

.wf-panel__empty {
  font-size: var(--wf-fs-sm, 12px);
  line-height: 20px;
  color: var(--el-text-color-secondary);
}

.wf-panel__empty-title {
  margin-bottom: 6px;
  font-weight: 600;
}

.wf-panel__empty-list {
  margin: 0;
  padding-left: 16px;
}
</style>
