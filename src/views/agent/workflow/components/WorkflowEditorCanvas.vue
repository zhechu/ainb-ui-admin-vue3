<!--
  Workflow 可视化编辑画布（AI助手 UX 修复 / 问题4 主体）

  从 WorkflowEditorDialog 迁出的三栏主体（目录 / 画布 / 配置面板 + DSL JSON 兜底），无 dialog 外壳，
  由整页设计器 editor/index.vue 内嵌。相对旧 dialog 的增强：
    - 节点卡片两行式：中文类型徽标 + 名称 + 一句话摘要 + 必填缺口红点（nodeSummary.ts 驱动）；
    - 左侧目录按分组展示全部 13 种类型，支持点击新增与拖拽落点（screenToFlowCoordinate）；
    - 工具条补齐缩放（放大/缩小/适配画布，useVueFlow API，不引 @vue-flow/controls 新依赖）；
    - 条件边可视化：从 condition.* 节点拉线时输入路由键写 cases；选中条件边可增改删 case 与 default；
    - condition.rule 分支、parallel 分支、tool.args/formVars（KeyValueEditor）、choices/tools/body（tags）
      均有结构化编辑，裸 JSON 兜底仅剩 conditionGroups 嵌套等长尾场景；
    - 空画布时覆盖三步中文引导 + 「插入示例骨架」。

  🔴 纪律与旧 dialog 一致：事实源是 DSL 对象（内部 inner 克隆自 props.dsl），Vue Flow 图只是派生视图；
     所有增删改走 editorModel 纯函数就地改 DSL，再 buildFlow() 重算——绝不「从图反推 DSL」。
  🔴 坐标：打开时读节点顶层 position（readPositionsFromDsl），拖动记入 positions，
     页面保存时经 getDslText()（内部 applyPositionsToDsl）写回 DSL 持久化。
  🔴 VueFlow 容器必须有显式高度（本组件 h-full，由页面给定高度父容器）。
-->
<template>
  <div class="h-full flex flex-col">
    <el-alert
      v-if="parseError"
      :title="parseError"
      type="error"
      :closable="false"
      show-icon
      class="mb-8px flex-shrink-0"
    />
    <el-alert
      v-else-if="readonly"
      title="当前流程不是草稿状态，画布仅供查看；如需修改请在列表页「版本」中回滚生成新草稿。"
      type="info"
      :closable="false"
      show-icon
      class="mb-8px flex-shrink-0"
    />

    <div v-if="!parseError" class="flex-1 min-h-0 flex gap-10px">
      <!-- 左：节点目录（分组 + 点击新增 + 拖拽落点） -->
      <div
        v-if="!readonly"
        class="w-150px flex-shrink-0 border border-solid border-[var(--el-border-color)] rounded-6px p-8px overflow-auto"
      >
        <div class="text-12px font-600 text-[var(--el-text-color-secondary)] mb-8px">节点目录</div>
        <template v-for="g in paletteGroups" :key="g.name">
          <div class="text-11px font-600 text-[var(--el-text-color-placeholder)] mt-6px mb-4px">
            {{ g.name }}
          </div>
          <el-tooltip
            v-for="item in g.items"
            :key="item.value"
            :content="item.description"
            placement="right"
            :show-after="300"
          >
            <div
              class="palette-item mb-4px px-8px py-5px rounded-4px border border-solid border-[var(--el-border-color)] cursor-pointer flex items-center hover:border-[var(--el-color-primary)]"
              draggable="true"
              @dragstart="onPaletteDragStart($event, item.value)"
              @click="onAddNode(item.value)"
            >
              <el-tag size="small" :type="item.tagType" effect="plain" class="!text-11px !px-4px flex-shrink-0">
                {{ item.label }}
              </el-tag>
            </div>
          </el-tooltip>
        </template>
        <div class="text-11px text-[var(--el-text-color-placeholder)] leading-16px mt-6px">
          点击即加入画布；也可拖到画布指定位置。
        </div>
      </div>

      <!-- 中：画布 + 工具条 -->
      <div class="flex-1 min-w-0 flex flex-col">
        <div class="flex items-center gap-6px mb-6px flex-shrink-0">
          <el-button size="small" @click="onRelayout">
            <Icon icon="ep:refresh" class="mr-3px" />重新布局
          </el-button>
          <el-button size="small" circle title="放大" @click="zoomIn()">
            <Icon icon="ep:zoom-in" />
          </el-button>
          <el-button size="small" circle title="缩小" @click="zoomOut()">
            <Icon icon="ep:zoom-out" />
          </el-button>
          <el-button size="small" circle title="适配画布" @click="fitView({ padding: 0.2 })">
            <Icon icon="ep:full-screen" />
          </el-button>
          <template v-if="!readonly">
            <el-button size="small" type="danger" plain :disabled="!selectedNodeId" @click="onDeleteNode">
              <Icon icon="ep:delete" class="mr-3px" />删除节点
            </el-button>
            <el-button size="small" type="danger" plain :disabled="!selectedEdge" @click="onDeleteEdge">
              <Icon icon="ep:delete" class="mr-3px" />删除连线
            </el-button>
          </template>
          <span class="text-11px text-[var(--el-text-color-placeholder)] ml-auto">
            从节点右侧圆点拉线到另一节点左侧圆点即连线<template v-if="!readonly">；条件节点拉线会询问分支路由键</template>
          </span>
        </div>
        <div
          class="relative flex-1 min-h-0 border border-solid border-[var(--el-border-color)] rounded-6px overflow-hidden"
          @dragover.prevent="onDragOver"
          @drop.prevent="onDrop"
        >
          <VueFlow
            :id="flowId"
            :nodes="flowNodes"
            :edges="flowEdges"
            :nodes-draggable="!readonly"
            :nodes-connectable="!readonly"
            :elements-selectable="true"
            :edges-updatable="false"
            :zoom-on-double-click="false"
            :fit-view-on-init="true"
            :min-zoom="0.2"
            :default-edge-options="{ type: 'default', markerEnd: MarkerType.ArrowClosed }"
            class="w-full h-full"
            @connect="onConnect"
            @node-drag-stop="onNodeDragStop"
            @node-click="onNodeClick"
            @edge-click="onEdgeClick"
            @pane-click="onPaneClick"
          >
            <Background :gap="16" pattern-color="#dcdfe6" />
            <template #node-dsl="{ data, selected }">
              <div
                class="dsl-node px-10px py-8px rounded-6px bg-[var(--el-bg-color)] shadow-sm flex flex-col items-start gap-3px min-w-160px max-w-240px"
                :class="selected ? 'editor-node--selected' : 'editor-node'"
              >
                <Handle v-if="!data.isStart" type="target" :position="Position.Left" />
                <div class="flex items-center gap-4px w-full">
                  <el-tag
                    v-if="data.typeLabel"
                    size="small"
                    :type="data.tagType"
                    effect="plain"
                    class="!text-11px !px-4px flex-shrink-0"
                  >
                    {{ data.typeLabel }}
                  </el-tag>
                  <span class="text-13px font-600 truncate">{{ data.label }}</span>
                  <el-tooltip v-if="data.hasGap" content="必填配置缺失，请单击节点在右侧面板补全" placement="top">
                    <span class="gap-dot ml-auto flex-shrink-0"></span>
                  </el-tooltip>
                </div>
                <div
                  v-if="data.summary"
                  class="text-11px text-[var(--el-text-color-secondary)] leading-15px w-full summary-clamp"
                >
                  {{ data.summary }}
                </div>
                <Handle v-if="!data.isEnd" type="source" :position="Position.Right" />
              </div>
            </template>
          </VueFlow>

          <!-- 空画布引导层：三步中文指引 + 插入示例骨架 -->
          <div
            v-if="!readonly && !(inner.nodes ?? []).length"
            class="absolute inset-0 z-10 flex items-center justify-center bg-[var(--el-bg-color-overlay)] bg-opacity-90"
          >
            <div class="text-center max-w-360px px-20px">
              <div class="text-15px font-600 mb-10px">三步搭出一条流程</div>
              <ol class="text-12px text-[var(--el-text-color-secondary)] leading-22px text-left pl-18px mb-14px">
                <li>从左侧「节点目录」点击或拖入节点（如工具、大模型）</li>
                <li>从节点右侧圆点拉线到下一节点左侧圆点，串起执行顺序</li>
                <li>单击节点，在右侧面板填写它要做什么（红点 = 还缺必填项）</li>
              </ol>
              <el-button type="primary" plain size="small" @click="onInsertSample">
                <Icon icon="ep:magic-stick" class="mr-4px" />插入示例骨架
              </el-button>
            </div>
          </div>
        </div>
      </div>

      <!-- 右：配置面板 -->
      <div
        class="w-320px flex-shrink-0 border border-solid border-[var(--el-border-color)] rounded-6px p-10px overflow-auto"
      >
        <!-- 选中节点 -->
        <template v-if="selectedNode">
          <div class="text-12px font-600 mb-8px flex items-center gap-6px">
            节点配置
            <el-tag size="small" :type="nodeTypeTag(selectedNode.type)" effect="plain" class="!text-11px">
              {{ nodeTypeLabel(selectedNode.type) }}
            </el-tag>
          </div>
          <el-form label-position="top" size="small" :disabled="readonly">
            <el-form-item label="节点 ID">
              <el-input :model-value="selectedNode.id" disabled />
            </el-form-item>
            <el-form-item label="名称">
              <el-input v-model="selectedNode.name" placeholder="节点显示名" @input="mutate" />
            </el-form-item>
            <!-- 结构化字段：由 nodeConfigSchema 按节点类型驱动（键逐字对齐后端执行器） -->
            <template v-for="f in visibleFields" :key="f.key">
              <el-form-item :label="f.label">
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
                <div v-if="f.hint" class="text-11px text-[var(--el-text-color-placeholder)] leading-16px mt-2px">
                  {{ f.hint }}
                </div>
              </el-form-item>
            </template>

            <!-- condition.rule 分支可视化（问题4-③）：单层 AND 条件；conditionGroups 嵌套走底部 JSON -->
            <template v-if="selectedNode.type === 'condition.rule'">
              <el-divider content-position="left">分支（按顺序匹配，命中即走）</el-divider>
              <div
                v-for="(b, bi) in ruleBranches"
                :key="bi"
                class="branch-card mb-8px p-8px rounded-4px border border-solid border-[var(--el-border-color)]"
              >
                <div class="flex items-center justify-between mb-6px">
                  <span class="text-12px font-600">分支 {{ bi + 1 }}</span>
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
                <div v-if="branchUsesGroups(b)" class="text-11px text-[var(--el-color-warning)] leading-16px">
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
                  <div class="text-11px text-[var(--el-text-color-placeholder)] mb-4px">
                    条件（多条同时满足才命中）：
                  </div>
                  <div
                    v-for="(c, ci) in conditionsOf(b)"
                    :key="ci"
                    class="flex items-center gap-4px mb-4px"
                  >
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

            <!-- parallel 分支可视化（问题4-③）：MVP 每条分支单节点；branches 是 string[][] -->
            <template v-else-if="selectedNode.type === 'parallel'">
              <el-divider content-position="left">并行分支</el-divider>
              <div class="text-11px text-[var(--el-text-color-placeholder)] leading-16px mb-6px">
                每行一条分支，选择分支要执行的节点（节点仍需先加入画布）。分支节点不要连进 edges，编译器自动接线。
              </div>
              <div v-for="(row, i) in parallelRows" :key="i" class="flex items-center gap-4px mb-4px">
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
                <span v-else class="text-12px text-[var(--el-color-warning)] flex-1">
                  多节点链分支，请在底部 DSL JSON 中编辑
                </span>
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

            <!-- 失败恢复与补偿（Saga）：recovery/compensation 是节点顶层字段，不走 nodeConfigSchema -->
            <el-divider content-position="left">失败恢复与补偿</el-divider>
            <el-form-item v-if="nonCompensable" label="失败恢复">
              <el-tag size="small" type="info" data-testid="node-noncompensable-tag">不可补偿（固定向前恢复）</el-tag>
              <div class="text-11px text-[var(--el-text-color-placeholder)] leading-16px mt-2px">
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
                  <div class="text-11px text-[var(--el-text-color-placeholder)] leading-16px mt-2px">
                    指向执行「语义反做」的工具键，如 form_data_delete 撤销 form_data_create。
                  </div>
                </el-form-item>
                <el-form-item label="补偿前像（before_image，JSON 对象）">
                  <el-input
                    v-model="beforeImageText"
                    type="textarea"
                    :rows="3"
                    class="editor-json"
                    :placeholder="BEFORE_IMAGE_PLACEHOLDER"
                    data-testid="node-before-image"
                    @change="onBeforeImageChange"
                  />
                  <div class="text-11px text-[var(--el-text-color-placeholder)] leading-16px mt-2px">
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
                  <div class="text-11px text-[var(--el-text-color-placeholder)] leading-16px mt-2px">
                    补偿重放时去重，防止重复反做。
                  </div>
                </el-form-item>
              </template>
            </template>

            <!-- config JSON 兜底：condition.rule 的 branches 已有可视化面板，不再摆裸 JSON 防双头编辑 -->
            <template v-if="selectedNode.type !== 'condition.rule'">
              <el-divider content-position="left">config</el-divider>
              <el-form-item label="完整 config（JSON）">
                <div v-if="jsonHint" class="text-11px text-[var(--el-text-color-placeholder)] leading-16px mb-4px">
                  {{ jsonHint }}
                </div>
                <el-input
                  v-model="configText"
                  type="textarea"
                  :rows="6"
                  class="editor-json"
                  placeholder="节点 config，JSON 对象"
                />
                <el-button v-if="!readonly" size="small" class="mt-6px" @click="onApplyConfig">
                  应用到节点 config
                </el-button>
              </el-form-item>
            </template>
          </el-form>
        </template>

        <!-- 选中连线 -->
        <template v-else-if="selectedEdge">
          <div class="text-12px font-600 mb-8px">连线</div>
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

          <!-- 条件边可视化编辑（问题4-②）：增改删 case 与 default -->
          <template v-if="selectedEdgeIsConditional">
            <el-divider content-position="left">分支路由</el-divider>
            <el-form label-position="top" size="small" :disabled="readonly">
              <div v-for="c in caseRows" :key="c.key" class="flex items-center gap-4px mb-6px">
                <el-input
                  :model-value="c.key"
                  size="small"
                  placeholder="路由键"
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
              <div class="flex items-center gap-4px mb-6px">
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
                <Icon icon="ep:plus" class="mr-2px" />添加分支路由
              </el-button>
              <div class="text-11px text-[var(--el-text-color-placeholder)] leading-16px mt-4px">
                路由键需与条件节点配置里的分支（condition.rule 的 target / condition.llm 的 choices）一致，否则永远不会走到。
              </div>
            </el-form>
          </template>
          <el-button
            v-if="!readonly"
            size="small"
            type="danger"
            plain
            class="mt-10px w-full"
            @click="onDeleteEdge"
          >
            删除此连线
          </el-button>
        </template>

        <!-- 未选中 -->
        <div v-else class="text-12px text-[var(--el-text-color-secondary)] leading-20px">
          <div class="font-600 mb-6px">操作提示</div>
          <ul class="pl-16px mb-0">
            <li>左侧目录点击或拖拽新增节点</li>
            <li>拖动节点调整位置（保存后记住布局）</li>
            <li>从节点右侧圆点拉到另一节点左侧圆点连线</li>
            <li>条件节点拉线时会询问分支路由键</li>
            <li>单击节点/连线在此编辑或删除</li>
          </ul>
        </div>
      </div>
    </div>

    <!-- 底部：DSL JSON 兜底编辑（trigger、variables、conditionGroups 等非画布可编辑项走这里） -->
    <div v-if="!parseError" class="mt-10px flex-shrink-0">
      <div class="flex items-center justify-between mb-6px">
        <span class="text-12px text-[var(--el-text-color-secondary)]">
          DSL JSON（事实源）。画布改动实时同步到此；也可直接改 JSON 后「应用到画布」。
        </span>
        <el-button v-if="!readonly" size="small" @click="onApplyJson">
          <Icon icon="ep:refresh-right" class="mr-4px" />应用到画布
        </el-button>
      </div>
      <el-input
        v-model="dslText"
        type="textarea"
        :rows="6"
        class="editor-json"
        spellcheck="false"
        :readonly="readonly"
      />
    </div>
  </div>
</template>

<script lang="ts" setup>
import { VueFlow, Handle, Position, MarkerType, useVueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import type { Edge, Node } from '@vue-flow/core'
import { ElMessageBox } from 'element-plus'
import { getToolList, type AgentToolVO } from '@/api/agent/config'
import { ModelApi, type ModelVO } from '@/api/ai/model/model'
import { KnowledgeApi, type KnowledgeVO } from '@/api/ai/knowledge/knowledge'
import { AgentWorkflowApi } from '@/api/agent/workflow'
import { layoutDsl } from '../layout'
import {
  NODE_TYPE_OPTIONS,
  DEFAULT_ROUTE,
  RULE_OPS,
  nodeTypeLabel,
  nodeTypeTag,
  addNode,
  removeNode,
  addEdge,
  removeEdge,
  setEdgeCase,
  setEdgeDefault,
  addRuleBranch,
  removeRuleBranch,
  addRuleCondition,
  removeRuleCondition,
  branchUsesGroups,
  applyPositionsToDsl,
  readPositionsFromDsl,
  isNonCompensableType,
  getNodeRecovery,
  setNodeRecovery,
  ensureCompensation,
  type EditorDsl,
  type EditorDslEdge,
  type EditorDslNode
} from '../editorModel'
import { NODE_TYPE_META, NODE_TYPE_GROUPS } from '../nodeSummary'
import { fieldsFor, jsonHintFor, isFieldVisible, type ConfigField } from '../nodeConfigSchema'
import KeyValueEditor from './KeyValueEditor.vue'

defineOptions({ name: 'WorkflowEditorCanvas' })

const props = withDefaults(defineProps<{ dsl: EditorDsl; readonly?: boolean }>(), { readonly: false })
const emit = defineEmits<{
  /** 任一就地突变后触发（页面标记 dirty） */
  (e: 'change'): void
  /** JSON 兜底整体替换 DSL 后触发（新对象引用，页面应把它作为新事实源） */
  (e: 'replace', dsl: EditorDsl): void
}>()

const message = useMessage()

/** layout.ts 内部用的合成端点视觉 id / DSL 保留字（此处复刻，layout.ts 未导出这几个常量） */
const START_VISUAL_ID = '__start__'
const END_VISUAL_ID = '__end__'
const START_KEYWORD = 'START'
const END_KEYWORD = 'END'

/** 拖拽落点的 dataTransfer 类型（自定义 MIME，避免与文件拖入等冲突） */
const DND_MIME = 'application/x-workflow-node'

/**
 * 补偿字段的占位示例。放 script 常量而非写死在模板属性里：
 * 内容含字面「双花括号 + $.路径」模板，写进模板属性会被 vue 编译器当成插值表达式解析报错。
 */
const BEFORE_IMAGE_PLACEHOLDER = '{"recordId": "{{$.create_out.id}}"}'
const IDEMPOTENCY_KEY_PLACEHOLDER = '如 {{$.execution.id}}:create_order'

/** 独立 store id：一个页面只有一个画布实例，useVueFlow({id}) 拿到缩放/坐标换算 API */
const flowId = `wf-editor-${Math.random().toString(36).slice(2, 8)}`
const { zoomIn, zoomOut, fitView, screenToFlowCoordinate } = useVueFlow(flowId)

const parseError = ref('')
/** 事实源：已解析的 DSL 对象（克隆自 props，画布/JSON 都是它的视图） */
const inner = ref<EditorDsl>({ nodes: [], edges: [] })
/** 编辑会话内的坐标（视觉 id → 位置），保存时经 getDslText 写回 DSL 各节点 position */
const positions = ref<Record<string, { x: number; y: number }>>({})
const flowNodes = ref<Node[]>([])
const flowEdges = ref<Edge[]>([])
const selectedNodeId = ref<string | null>(null)
const selectedEdge = ref<{ from: string; to: string; route?: string } | null>(null)
const dslText = ref('')
const configText = ref('{}')
const toolList = ref<AgentToolVO[]>([])
const modelList = ref<ModelVO[]>([])
const kbList = ref<KnowledgeVO[]>([])
const workflowList = ref<{ label: string; value: string }[]>([])

/** 归一化：保证 nodes/edges 是数组、每个节点有 config 对象（配置面板 v-model 依赖它非空） */
const normalize = (parsed: any): EditorDsl => {
  const d: EditorDsl = parsed && typeof parsed === 'object' ? parsed : {}
  if (!Array.isArray(d.nodes)) d.nodes = []
  if (!Array.isArray(d.edges)) d.edges = []
  for (const n of d.nodes) {
    if (n && (!n.config || typeof n.config !== 'object')) n.config = {}
  }
  return d
}

// 🔴 props.dsl 的初始化 watch 刻意放到本文件靠后处（buildFlow/mutate 定义之后）注册，见下方「初始化 watch」。
//    immediate:true 的回调在注册那一刻同步执行，会调用 buildFlow → toVisual/syncDslText；
//    这些都是 const 箭头函数，若在它们定义之前注册 watch，回调会撞上 TDZ 抛
//    「Cannot access 'buildFlow' before initialization」，整块画布静默不渲染（页面只剩顶栏）。

// ---------- 左侧目录 ----------

const paletteGroups = computed(() =>
  NODE_TYPE_GROUPS.map((name) => ({
    name,
    items: NODE_TYPE_OPTIONS.filter((o) => NODE_TYPE_META[o.value]?.group === name).map((o) => ({
      ...o,
      description: NODE_TYPE_META[o.value]?.description ?? ''
    }))
  })).filter((g) => g.items.length)
)

const onPaletteDragStart = (event: DragEvent, type: string) => {
  event.dataTransfer?.setData(DND_MIME, type)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

const onDragOver = (event: DragEvent) => {
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
}

/** 拖拽落点（问题4-①）：screenToFlowCoordinate 把屏幕坐标换算成画布坐标，节点直接落在松手处 */
const onDrop = (event: DragEvent) => {
  if (props.readonly) return
  const type = event.dataTransfer?.getData(DND_MIME)
  if (!type) return
  const pos = screenToFlowCoordinate({ x: event.clientX, y: event.clientY })
  const id = addNode(inner.value, type)
  positions.value[id] = { x: pos.x, y: pos.y }
  selectedNodeId.value = id
  selectedEdge.value = null
  buildFlow()
  emit('change')
}

const onAddNode = (type: string) => {
  if (props.readonly) return
  const id = addNode(inner.value, type)
  buildFlow()
  selectedNodeId.value = id
  selectedEdge.value = null
  emit('change')
}

/** 空画布引导：插入「检索资料 → 大模型总结 → 人工确认 →（拒绝则重写）」示例骨架 */
const onInsertSample = () => {
  const kr = addNode(inner.value, 'knowledge_retrieval')
  inner.value.nodes!.find((n) => n.id === kr)!.name = '检索资料'
  const llm = addNode(inner.value, 'llm')
  inner.value.nodes!.find((n) => n.id === llm)!.name = '生成总结'
  const hitl = addNode(inner.value, 'hitl.confirm')
  inner.value.nodes!.find((n) => n.id === hitl)!.name = '人工确认'
  const cond = addNode(inner.value, 'condition.rule')
  inner.value.nodes!.find((n) => n.id === cond)!.name = '确认结果判断'
  inner.value.edges = [
    { from: START_KEYWORD, to: kr },
    { from: kr, to: llm },
    { from: llm, to: hitl },
    { from: hitl, to: cond },
    { from: cond, type: 'conditional', cases: { approved: END_KEYWORD, rejected: llm } }
  ]
  selectedNodeId.value = null
  selectedEdge.value = null
  buildFlow()
  emit('change')
}

// ---------- 画布视图 ----------

const selectedNode = computed(() =>
  selectedNodeId.value ? (inner.value.nodes ?? []).find((n) => n.id === selectedNodeId.value) : undefined
)

/** 视觉 id ⇄ DSL 保留字/节点 id 的双向映射 */
const toVisual = (ref: string): string =>
  ref === START_KEYWORD ? START_VISUAL_ID : ref === END_KEYWORD ? END_VISUAL_ID : ref
const toDsl = (visualId: string): string =>
  visualId === START_VISUAL_ID ? START_KEYWORD : visualId === END_VISUAL_ID ? END_KEYWORD : visualId

const isConditionalEdge = (e: EditorDslEdge): boolean =>
  (e.type ?? '').toLowerCase() === 'conditional' || (!!e.cases && Object.keys(e.cases).length > 0)

const syncDslText = () => {
  dslText.value = JSON.stringify(inner.value, null, 2)
}

/**
 * 由 DSL 重算画布视图：layoutDsl 出节点坐标（持久化 position 优先）→ 覆盖会话内已拖动位置 →
 * 按 dsl.edges 自建带 data(from/to/route) 的边（条件边展开成多条带 label 的虚线边）。
 * 🔴 边不复用 layoutDsl 产出的（那批不带原始 from/to/route，删边时无法反查 DSL）。
 */
const buildFlow = () => {
  // EditorDsl 是 DslGraph 的超集，layoutDsl 只防御性读取少数字段，as any 跨过结构差异
  const { nodes } = layoutDsl(inner.value as any)
  for (const n of nodes) {
    const isStart = n.id === START_VISUAL_ID
    const isEnd = n.id === END_VISUAL_ID
    n.data = { ...(n.data ?? {}), dslId: isStart || isEnd ? null : n.id, isStart, isEnd }
    const stored = positions.value[n.id]
    if (stored) n.position = { x: stored.x, y: stored.y }
  }

  const nodeIds = new Set(nodes.map((n) => n.id))
  const edges: Edge[] = []
  let seq = 0
  const push = (fromRef: string, toRef: string, route?: string, label?: string) => {
    const source = toVisual(fromRef)
    const target = toVisual(toRef)
    if (!nodeIds.has(source) || !nodeIds.has(target)) return
    edges.push({
      id: `e-${seq++}-${route ?? 'main'}`,
      source,
      target,
      label: label || undefined,
      type: 'default',
      markerEnd: MarkerType.ArrowClosed,
      style: label ? { strokeDasharray: '4 3' } : undefined,
      data: { from: fromRef, to: toRef, route }
    })
  }
  for (const e of inner.value.edges ?? []) {
    if (!e) continue
    if (isConditionalEdge(e)) {
      for (const [routeKey, tgt] of Object.entries(e.cases ?? {})) {
        if (tgt) push(e.from, tgt, routeKey, routeKey)
      }
      if (e.default) push(e.from, e.default, DEFAULT_ROUTE, 'default')
    } else if (e.to) {
      push(e.from, e.to, undefined, undefined)
    }
  }

  flowNodes.value = nodes
  flowEdges.value = edges
  syncDslText()
}

/** 就地突变后的统一收口：重算视图 + 通知页面 dirty */
const mutate = () => {
  buildFlow()
  emit('change')
}

/**
 * 初始化 watch：props.dsl 首次挂载与后续换新引用（页面加载/重建）时重算画布。
 * 🔴 必须定义在 buildFlow/mutate 之后——immediate 回调同步执行会调用 buildFlow，
 *    放在前面会撞 TDZ（详见文件前部 normalize 处的说明）。
 */
watch(
  () => props.dsl,
  (v) => {
    parseError.value = ''
    selectedNodeId.value = null
    selectedEdge.value = null
    inner.value = normalize(JSON.parse(JSON.stringify(v ?? {})))
    positions.value = readPositionsFromDsl(inner.value)
    buildFlow()
  },
  { immediate: true, deep: false }
)

const onConnect = async (params: any) => {
  const from = toDsl(params.source)
  const to = toDsl(params.target)
  if (!from || !to || from === to) return
  // 条件节点拉线（问题4-②）：询问路由键，写进该 from 的 conditional 边 cases
  const src = (inner.value.nodes ?? []).find((n) => n.id === from)
  if (src && (src.type ?? '').startsWith('condition.')) {
    const candidates = routeKeyCandidates(src)
    let routeKey: string
    try {
      const res = await ElMessageBox.prompt(
        candidates.length
          ? `这条连线代表哪个分支？请输入路由键（候选：${candidates.join('、')}）`
          : '这条连线代表哪个分支？请输入路由键（需与条件节点配置里的分支一致）',
        '条件分支路由键',
        {
          confirmButtonText: '确定',
          cancelButtonText: '取消',
          inputPlaceholder: '如 approved',
          inputValidator: (v: string) => (v && v.trim() ? true : '路由键不能为空')
        }
      )
      routeKey = (res.value ?? '').trim()
    } catch {
      return // 取消 = 不连线
    }
    if (!routeKey) return
    setEdgeCase(inner.value, from, routeKey, to)
    mutate()
    return
  }
  addEdge(inner.value, from, to)
  mutate()
}

/** 条件节点的候选路由键：condition.llm 取 choices；condition.rule 取 branches[].target + default */
const routeKeyCandidates = (node: EditorDslNode): string[] => {
  const config = node.config ?? {}
  if (node.type === 'condition.llm') {
    const keys = Array.isArray(config.choices) ? config.choices.map((c: any) => String(c)).filter(Boolean) : []
    return config.default ? [...keys, String(config.default)] : keys
  }
  if (node.type === 'condition.rule') {
    const keys = Array.isArray(config.branches)
      ? config.branches.map((b: any) => (b && typeof b === 'object' ? String(b.target ?? '') : '')).filter(Boolean)
      : []
    return config.default ? [...keys, String(config.default)] : keys
  }
  return []
}

const onNodeDragStop = (payload: any) => {
  const node = payload?.node
  if (node?.id) positions.value[node.id] = { x: node.position.x, y: node.position.y }
}

const onNodeClick = (payload: any) => {
  selectedEdge.value = null
  selectedNodeId.value = payload?.node?.data?.dslId ?? null
}

const onEdgeClick = (payload: any) => {
  const d = payload?.edge?.data
  selectedNodeId.value = null
  selectedEdge.value = d ? { from: d.from, to: d.to, route: d.route } : null
}

const onPaneClick = () => {
  selectedNodeId.value = null
  selectedEdge.value = null
}

const onDeleteNode = async () => {
  if (!selectedNodeId.value || props.readonly) return
  const node = selectedNode.value
  try {
    await message.delConfirm(`确认删除节点「${node?.name || node?.id}」？指向它的连线会一并清理。`)
  } catch {
    return
  }
  removeNode(inner.value, selectedNodeId.value)
  delete positions.value[selectedNodeId.value]
  selectedNodeId.value = null
  mutate()
}

const onDeleteEdge = async () => {
  if (!selectedEdge.value || props.readonly) return
  const { from, to, route } = selectedEdge.value
  try {
    await message.delConfirm(
      route
        ? `确认删除分支「${route === DEFAULT_ROUTE ? 'default' : route}」的连线？`
        : `确认删除连线「${from} → ${to}」？`
    )
  } catch {
    return
  }
  removeEdge(inner.value, from, to, route)
  selectedEdge.value = null
  mutate()
}

const onRelayout = () => {
  positions.value = {}
  buildFlow()
}

// ---------- 右侧面板：节点 ----------

/**
 * 选中节点的 config，恒为对象。getter 返回 DSL 里那个真实 config 对象引用，
 * 故模板 v-model 写 selConfig.xxx 即写回 DSL（与旧 dialog 同款「真实引用」手法）。
 */
const selConfig = computed<Record<string, any>>(() => selectedNode.value?.config ?? {})

const nonCompensable = computed(() => isNonCompensableType(selectedNode.value?.type))

const nodeRecovery = computed(() =>
  selectedNode.value ? getNodeRecovery(selectedNode.value as EditorDslNode) : ''
)

const selComp = computed<Record<string, any>>(() => {
  const n = selectedNode.value as EditorDslNode | undefined
  if (!n) return {}
  return n.recovery === 'compensate'
    ? ensureCompensation(n)
    : n.compensation && typeof n.compensation === 'object' && !Array.isArray(n.compensation)
      ? n.compensation
      : {}
})

const beforeImageText = ref('')

const onRecoveryChange = (value: '' | 'forward' | 'compensate') => {
  const n = selectedNode.value as EditorDslNode | undefined
  if (!n) return
  setNodeRecovery(n, value)
  if (value === 'compensate') {
    beforeImageText.value = n.compensation?.before_image
      ? JSON.stringify(n.compensation.before_image, null, 2)
      : ''
  }
  mutate()
}

const onBeforeImageChange = () => {
  const text = beforeImageText.value.trim()
  if (!text) {
    delete selComp.value.before_image
    mutate()
    return
  }
  try {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('before_image 必须是 JSON 对象（参数名 → 模板）')
    }
    selComp.value.before_image = parsed
    mutate()
  } catch (e: any) {
    message.error(`before_image 解析失败：${e?.message ?? '格式不合法'}`)
  }
}

const visibleFields = computed<ConfigField[]>(() =>
  fieldsFor(selectedNode.value?.type).filter((f) => isFieldVisible(f, selConfig.value))
)

const jsonHint = computed(() => jsonHintFor(selectedNode.value?.type))

/**
 * 一个 select 字段的可选项。动态来源（tool/model/kb/workflow）映射已加载的目录，静态来源用 f.options。
 * value 逐字对齐后端读取的类型：toolId=工具键(string)、modelId/knowledgeBaseId=数字 id、workflowId=流程 code(string)。
 */
const optionsFor = (f: ConfigField): { label: string; value: string | number | boolean; desc?: string }[] => {
  if (f.optionsFrom === 'tool') {
    return toolList.value.map((t) => ({ label: t.name, value: t.name, desc: t.description }))
  }
  if (f.optionsFrom === 'model') {
    return modelList.value.map((m) => ({ label: m.name, value: m.id, desc: m.model }))
  }
  if (f.optionsFrom === 'kb') {
    return kbList.value.map((k) => ({ label: k.name, value: k.id }))
  }
  if (f.optionsFrom === 'workflow') {
    return workflowList.value
  }
  return f.options ?? []
}

/** tags 字段的可选项：iteration.body / agent_loop.tools 给节点 id / 工具键候选，choices 无候选纯手输 */
const tagsOptionsFor = (f: ConfigField): string[] => {
  if (f.key === 'body') return (inner.value.nodes ?? []).map((n) => n.id)
  if (f.key === 'tools') return toolList.value.map((t) => t.name)
  return []
}

const onApplyConfig = () => {
  if (!selectedNode.value || props.readonly) return
  try {
    const parsed = JSON.parse(configText.value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('config 必须是 JSON 对象')
    }
    selectedNode.value.config = parsed
    mutate()
    message.success('已应用节点 config')
  } catch (e: any) {
    message.error(`config 解析失败：${e?.message ?? '格式不合法'}`)
  }
}

/** 选中节点变化时，把它的 config / before_image 同步到面板的两个 JSON 文本框 */
watch(selectedNodeId, () => {
  configText.value = selectedNode.value?.config ? JSON.stringify(selectedNode.value.config, null, 2) : '{}'
  const bi = (selectedNode.value as EditorDslNode | undefined)?.compensation?.before_image
  beforeImageText.value = bi ? JSON.stringify(bi, null, 2) : ''
})

// ---------- 右侧面板：condition.rule 分支 ----------

const RULE_OP_OPTIONS = [
  { value: 'eq', label: '等于 (eq)' },
  { value: 'ne', label: '不等于 (ne)' },
  { value: 'gt', label: '大于 (gt)' },
  { value: 'ge', label: '大于等于 (ge)' },
  { value: 'lt', label: '小于 (lt)' },
  { value: 'le', label: '小于等于 (le)' },
  { value: 'contains', label: '包含 (contains)' },
  { value: 'exists', label: '存在 (exists)' },
  { value: 'is_true', label: '为真 (is_true)' },
  { value: 'is_false', label: '为假 (is_false)' }
]
// 对齐 editorModel.RULE_OPS（防止两处目录漂移）
if (RULE_OP_OPTIONS.map((o) => o.value).join() !== RULE_OPS.join()) {
  console.warn('[WorkflowEditorCanvas] RULE_OP_OPTIONS 与 editorModel.RULE_OPS 不一致，请同步')
}

/** exists/is_true/is_false 不需要比较值 */
const needsValue = (op?: string): boolean => !['exists', 'is_true', 'is_false'].includes(op ?? '')

const toText = (v: any): string => {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

const ruleBranches = computed<any[]>(() => {
  const b = selConfig.value.branches
  return Array.isArray(b) ? b : []
})

/** 某分支的条件数组（显式 any[] 返回类型：模板 v-for 的下标才是 number，不被 any ?? [] 拓宽成 string|number） */
const conditionsOf = (branch: any): any[] =>
  Array.isArray(branch?.conditions) ? branch.conditions : []

const onBranchField = (branch: any, key: string, value: any) => {
  branch[key] = value
  mutate()
}

const onConditionField = (branch: any, condIndex: number, key: string, value: any) => {
  const c = branch?.conditions?.[condIndex]
  if (!c) return
  c[key] = value
  mutate()
}

const onAddRuleBranch = () => {
  addRuleBranch(selConfig.value)
  mutate()
}

const onRemoveRuleBranch = (index: number) => {
  removeRuleBranch(selConfig.value, index)
  mutate()
}

const onAddRuleCondition = (branchIndex: number) => {
  addRuleCondition(selConfig.value, branchIndex)
  mutate()
}

const onRemoveRuleCondition = (branchIndex: number, condIndex: number) => {
  removeRuleCondition(selConfig.value, branchIndex, condIndex)
  mutate()
}

// ---------- 右侧面板：parallel 分支 ----------

/** 画布上可选的分支/路由目标节点（不含 parallel 自身，防自环） */
const branchNodeOptions = computed(() =>
  (inner.value.nodes ?? [])
    .filter((n) => n.id !== selectedNodeId.value)
    .map((n) => ({ value: n.id, label: n.name ? `${n.name}（${n.id}）` : n.id }))
)

/** 条件边 case/default 的目标节点选项：含 START/END 保留字（分支可指向结束） */
const nodeOptions = computed(() => [
  { value: START_KEYWORD, label: '开始（START）' },
  ...branchNodeOptions.value,
  { value: END_KEYWORD, label: '结束（END）' }
])

interface ParallelRow {
  /** 单节点分支（MVP 主形态）→ 渲染下拉；多节点链 → 只读提示走 JSON */
  single: boolean
  value: string
}

const parallelRows = computed<ParallelRow[]>(() => {
  const raw = selConfig.value.branches
  if (!Array.isArray(raw)) return []
  return raw.map((b) =>
    Array.isArray(b) && b.length === 1 && typeof b[0] === 'string'
      ? { single: true, value: b[0] }
      : { single: false, value: toText(b) }
  )
})

const ensureParallelBranches = (): any[] => {
  if (!Array.isArray(selConfig.value.branches)) selConfig.value.branches = []
  return selConfig.value.branches
}

const onParallelRowChange = (index: number, value: any) => {
  const arr = ensureParallelBranches()
  if (!value) arr.splice(index, 1)
  else arr[index] = [String(value)]
  mutate()
}

const onParallelAdd = () => {
  ensureParallelBranches().push([])
  mutate()
}

const onParallelRemove = (index: number) => {
  ensureParallelBranches().splice(index, 1)
  mutate()
}

// ---------- 右侧面板：连线 ----------

/** 选中连线对应的 DSL 边（按 from + route/to 反查；条件边 route=某 case 键或 DEFAULT_ROUTE） */
const selectedDslEdge = computed<EditorDslEdge | undefined>(() => {
  const sel = selectedEdge.value
  if (!sel) return undefined
  return (inner.value.edges ?? []).find((e) => {
    if (e.from !== sel.from) return false
    if (sel.route === DEFAULT_ROUTE) return isConditionalEdge(e) && e.default === sel.to
    if (sel.route) return isConditionalEdge(e) && e.cases?.[sel.route] === sel.to
    return !isConditionalEdge(e) && e.to === sel.to
  })
})

const selectedEdgeIsConditional = computed(() => !!selectedDslEdge.value && isConditionalEdge(selectedDslEdge.value))

const caseRows = computed(() => Object.entries(selectedDslEdge.value?.cases ?? {}).map(([key, to]) => ({ key, to })))

const defaultTarget = computed(() => selectedDslEdge.value?.default ?? '')

const onCaseKeyChange = (oldKey: string, newKey: string) => {
  const e = selectedDslEdge.value
  const key = (newKey ?? '').trim()
  if (!e?.cases || !key || key === oldKey) {
    buildFlow() // 还原输入框显示
    return
  }
  const cases: Record<string, string> = {}
  for (const [k, v] of Object.entries(e.cases)) {
    cases[k === oldKey ? key : k] = v
  }
  e.cases = cases
  selectedEdge.value = { from: e.from, to: cases[key], route: key }
  mutate()
}

const onCaseToChange = (routeKey: string, to: any) => {
  const e = selectedDslEdge.value
  if (!e?.cases) return
  if (to) {
    e.cases[routeKey] = String(to)
    selectedEdge.value = { from: e.from, to: String(to), route: routeKey }
    mutate()
  } else {
    // 清空目标 = 删除该 case（与 removeEdge 语义一致）
    setEdgeCase(inner.value, e.from, routeKey, '')
    selectedEdge.value = null
    mutate()
  }
}

const onCaseRemove = (routeKey: string) => {
  const e = selectedDslEdge.value
  if (!e) return
  setEdgeCase(inner.value, e.from, routeKey, '')
  selectedEdge.value = null
  mutate()
}

const onDefaultChange = (to: any) => {
  const e = selectedDslEdge.value
  if (!e) return
  setEdgeDefault(inner.value, e.from, to ? String(to) : '')
  selectedEdge.value = to ? { from: e.from, to: String(to), route: DEFAULT_ROUTE } : null
  mutate()
}

const onCaseAdd = async () => {
  const e = selectedDslEdge.value
  if (!e) return
  const src = (inner.value.nodes ?? []).find((n) => n.id === e.from)
  const candidates = src ? routeKeyCandidates(src) : []
  let routeKey: string
  try {
    const res = await ElMessageBox.prompt(
      candidates.length
        ? `新分支的路由键（候选：${candidates.join('、')}）：`
        : '新分支的路由键（需与条件节点配置里的分支一致）：',
      '添加分支路由',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        inputPlaceholder: '如 approved',
        inputValidator: (v: string) => (v && v.trim() ? true : '路由键不能为空')
      }
    )
    routeKey = (res.value ?? '').trim()
  } catch {
    return
  }
  if (!routeKey || e.cases?.[routeKey]) return
  // 先占位空目标（buildFlow 会跳过无目标的 case），用户在行内下拉里选目标
  setEdgeCase(inner.value, e.from, routeKey, '')
  e.cases![routeKey] = ''
  mutate()
}

// ---------- DSL JSON 兜底 ----------

const onApplyJson = () => {
  if (props.readonly) return
  try {
    const parsed = JSON.parse(dslText.value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('顶层必须是 JSON 对象')
    }
    inner.value = normalize(parsed)
    positions.value = readPositionsFromDsl(inner.value)
    selectedNodeId.value = null
    selectedEdge.value = null
    buildFlow()
    emit('replace', inner.value)
    message.success('已应用 JSON 到画布')
  } catch (e: any) {
    message.error(`JSON 解析失败：${e?.message ?? '格式不合法'}`)
  }
}

// ---------- 目录数据（fail-soft + 缓存，与旧 dialog 一致） ----------

onMounted(async () => {
  const [tools, models, kbs, page] = await Promise.all([
    getToolList().catch(() => []),
    ModelApi.getModelSimpleList(1).catch(() => []),
    KnowledgeApi.getSimpleKnowledgeList().catch(() => []),
    AgentWorkflowApi.getDefPage({ pageNo: 1, pageSize: 100, status: 'PUBLISHED' }).catch(() => null)
  ])
  toolList.value = (tools as AgentToolVO[]) ?? []
  modelList.value = (models as ModelVO[]) ?? []
  kbList.value = (kbs as KnowledgeVO[]) ?? []
  workflowList.value = ((page as any)?.list ?? []).map((w: any) => ({
    value: w.code,
    label: w.name ? `${w.name}（${w.code}）` : w.code
  }))
})

// ---------- 对页面暴露 ----------

/** 页面保存时取 DSL 原文：先把编辑会话内的坐标写回各节点 position（持久化布局），再序列化 */
const getDslText = (): string => {
  applyPositionsToDsl(inner.value, positions.value)
  return JSON.stringify(inner.value, null, 2)
}

defineExpose({ getDslText })
</script>

<style scoped>
/* 画布节点描边：默认浅灰，选中态用主色高亮（VueFlow 传 selected 到 slot） */
.editor-node {
  border: 1px solid var(--el-border-color);
}
.editor-node--selected {
  border: 2px solid var(--el-color-primary);
}
/* 节点摘要两行截断 */
.summary-clamp {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
}
/* 必填缺口红点 */
.gap-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--el-color-danger);
  display: inline-block;
}
/* JSON/config 文本框用等宽字体，便于读写缩进 */
.editor-json :deep(textarea) {
  font-family: 'JetBrains Mono', 'Fira Code', Consolas, Monaco, monospace;
  font-size: 12px;
  line-height: 1.5;
}
/* VueFlow 连接桩（handle）稍微放大，方便点击拉线 */
:deep(.vue-flow__handle) {
  width: 10px;
  height: 10px;
  background: var(--el-color-primary);
  border-radius: 50%;
}
</style>
