<template>
  <ContentWrap v-if="loading">
    <el-skeleton :rows="6" animated />
  </ContentWrap>

  <template v-else-if="!config">
    <ContentWrap>
      <el-empty description="表单不存在或尚未发布" />
    </ContentWrap>
  </template>

  <template v-else>
    <!-- 表单+列表：列表在上，行操作唤起表单 -->
    <template v-if="config.formType === 2">
      <!--
        页内模式下整个列表区让位给表单

        用 v-if 而不是 v-show：列表里可能挂着几百行数据与一堆 el-table 的
        滚动监听，留在 DOM 里对着一张看不见的表格做布局计算纯属浪费。
      -->
      <template v-if="!inlineFormActive">
      <!-- 查询区 -->
      <ContentWrap v-if="searchItems.length > 0 || hasToolbar">
        <el-form :inline="true" class="-mb-15px" label-width="90px">
          <el-form-item
            v-for="(item, index) in visibleSearchItems"
            :key="`${item.field}#${index}`"
            :label="item.label"
          >
            <!-- 为空 / 不为空：条件本身就是全部信息，没有值要填 -->
            <span v-if="isValuelessOperator(item.operator)" class="text-13px text-gray-400">
              {{ item.operator === 'IS_NULL' ? '筛选为空的记录' : '筛选非空的记录' }}
            </span>

            <!-- 日期区间 -->
            <el-date-picker
              v-else-if="item.widget === 'DATE_RANGE'"
              v-model="searchValues[rangeKey(index)]"
              class="!w-240px"
              end-placeholder="结束日期"
              start-placeholder="开始日期"
              type="daterange"
              value-format="YYYY-MM-DD"
              @change="handleQuery"
            />

            <!-- 单个日期 -->
            <el-date-picker
              v-else-if="item.widget === 'DATE'"
              v-model="searchValues[valueKey(index)]"
              class="!w-160px"
              placeholder="选择日期"
              type="date"
              value-format="YYYY-MM-DD"
              @change="handleQuery"
            />

            <!-- 数字区间 -->
            <template v-else-if="item.widget === 'NUMBER_RANGE'">
              <el-input-number
                v-model="searchValues[startKey(index)]"
                class="!w-120px"
                controls-position="right"
                placeholder="最小值"
              />
              <span class="mx-5px">~</span>
              <el-input-number
                v-model="searchValues[endKey(index)]"
                class="!w-120px"
                controls-position="right"
                placeholder="最大值"
              />
            </template>

            <!-- 单个数字 -->
            <el-input-number
              v-else-if="item.widget === 'NUMBER'"
              v-model="searchValues[valueKey(index)]"
              class="!w-150px"
              controls-position="right"
              :placeholder="`请输入${item.label}`"
            />

            <!-- 字典下拉。IN 操作符时允许多选 -->
            <el-select
              v-else-if="item.widget === 'SELECT' && item.dictType"
              v-model="searchValues[valueKey(index)]"
              class="!w-180px"
              clearable
              filterable
              :multiple="item.operator === 'IN'"
              :placeholder="`请选择${item.label}`"
              @change="handleQuery"
            >
              <el-option
                v-for="opt in dictOptionsOf(item.dictType)"
                :key="opt.value"
                :label="opt.label"
                :value="opt.value"
              />
            </el-select>

            <!-- 是 / 否 -->
            <el-select
              v-else-if="item.widget === 'SWITCH'"
              v-model="searchValues[valueKey(index)]"
              class="!w-120px"
              clearable
              :placeholder="`请选择${item.label}`"
              @change="handleQuery"
            >
              <el-option label="是" value="1" />
              <el-option label="否" value="0" />
            </el-select>

            <!-- 文本区间：编号区间这类用法 -->
            <template v-else-if="item.operator === 'BETWEEN'">
              <el-input
                v-model="searchValues[startKey(index)]"
                class="!w-95px"
                clearable
                placeholder="起始值"
                @keyup.enter="handleQuery"
              />
              <span class="mx-5px">~</span>
              <el-input
                v-model="searchValues[endKey(index)]"
                class="!w-95px"
                clearable
                placeholder="结束值"
                @keyup.enter="handleQuery"
              />
            </template>

            <!-- 兜底：文本框。认不出的配置走这里，至少还能查 -->
            <el-input
              v-else
              v-model="searchValues[valueKey(index)]"
              class="!w-200px"
              clearable
              :placeholder="`请输入${item.label}`"
              @keyup.enter="handleQuery"
            />
          </el-form-item>
          <!--
            ⚠️ 这个 v-if 是新加的：没有查询项时 visibleSearchItems 为空、上面的 v-for 不产出任何项，
            不补它就会渲染出一个只有「搜索/重置」的空表单。原来整张卡片靠 searchItems.length > 0
            整体不渲染，这条分支从没暴露过；现在卡片还要为工具栏渲染，所以必须补上
          -->
          <el-form-item v-if="searchItems.length > 0">
            <el-button @click="handleQuery">
              <Icon class="mr-5px" icon="ep:search" />
              搜索
            </el-button>
            <el-button @click="resetQuery">
              <Icon class="mr-5px" icon="ep:refresh" />
              重置
            </el-button>
            <el-button
              v-if="searchItems.length > SEARCH_COLLAPSE_THRESHOLD"
              link
              type="primary"
              @click="searchCollapsed = !searchCollapsed"
            >
              {{ searchCollapsed ? `展开(${searchItems.length})` : '收起' }}
              <Icon
                class="ml-2px"
                :icon="searchCollapsed ? 'ep:arrow-down' : 'ep:arrow-up'"
              />
            </el-button>
          </el-form-item>
          <!--
            工具栏按钮搬进查询区（需求4）：与全站静态列表页同一排「搜索 > 重置 > 新增 > 批量删除」。
            按钮本身一字未改 —— 原来就已经是 plain + 按动作性质给色，批量按钮的 disabled
            与选中数角标也原样搬过来，只换了外层容器（div → el-form-item）。
          -->
          <el-form-item v-if="hasToolbar">
            <!--
              内置工具栏按钮。文案、图标、顺序都来自列表设计的按钮清单。

              颜色按动作的性质给，与系统里其它管理列表页（如租户管理）保持一致：
              主操作是主色、导出是成功色、批量删除是危险色。
              都用默认灰的话，「批量删除」看起来与「导出」一样人畜无害 ——
              而它是这一排里唯一不可撤销的动作。
            -->
            <el-button
              v-for="btn in builtinToolbarButtons"
              :key="btn.key"
              :disabled="isBatchButton(btn.key) && selectedRows.length === 0"
              plain
              :type="toolbarButtonType(btn.key)"
              @click="runBuiltinButton(btn.key)"
            >
              <Icon v-if="btn.icon" class="mr-5px" :icon="btn.icon" />
              {{ btn.label }}
              <span v-if="isBatchButton(btn.key) && selectedRows.length > 0">
                ({{ selectedRows.length }})
              </span>
            </el-button>
            <!--
              自定义按钮（工具栏）。⚠️ 这里【不】判可见条件 ——
              工具栏没有「当前记录」可以求值，见 customButton.ts 的说明
            -->
            <el-button
              v-for="btn in toolbarButtons"
              :key="btn.key"
              plain
              @click="runCustomButton(btn)"
            >
              <Icon v-if="btn.icon" class="mr-5px" :icon="btn.icon" />
              {{ btn.label }}
            </el-button>
          </el-form-item>
        </el-form>
      </ContentWrap>

      <!-- 主体区：有左侧树时左右分栏 -->
      <div :class="leftTree?.enabled ? 'list-with-tree' : ''">
        <!-- 左侧树筛选 -->
        <ContentWrap v-if="leftTree?.enabled" class="left-tree-panel">
          <div class="left-tree-title">{{ leftTree.title || '筛选' }}</div>
          <el-tree
            :current-node-key="currentTreeKey"
            :data="treeNodes"
            :expand-on-click-node="false"
            highlight-current
            node-key="value"
            :props="{ label: 'label' }"
            @node-click="handleTreeNodeClick"
          />
        </ContentWrap>

        <!-- 列表 -->
        <ContentWrap class="flex-1 min-w-0">
        <!-- 标签页筛选：切换等价于追加一个 EQ 条件 -->
        <el-tabs
          v-if="tabConfig?.enabled && tabConfig.field"
          v-model="activeTab"
          @tab-change="handleTabChange"
        >
          <el-tab-pane label="全部" name="__all__" />
          <el-tab-pane
            v-for="tab in tabConfig.tabs"
            :key="tab.value"
            :label="tab.label || tab.value"
            :name="tab.value"
          />
        </el-tabs>

        <!--
          列设置：它是「调整视图」而不是「对数据做事」，与查询区那排工具栏不同类 ——
          这条理由原来就写在工具栏那个 div 里，工具栏搬进查询区之后，留在列表卡片内
          反而更贴近它作用的对象（这张表的视图）。
          没跟着搬进 <el-form-item> 是搬不了：ml-auto 在 inline form 的 item 内不生效
          （item 宽度由内容决定，没有可分配的自由空间），而查询卡片没有 title、
          ContentWrap 的 #header 插槽也不渲染，找不到第二个可以右靠的位置。
        -->
        <div v-if="columnSettingEnabled" class="mb-10px flex justify-end">
          <ColumnSettingPanel
            :items="settingColumns"
            @reorder="handleColumnReorder"
            @reset="handleColumnReset"
            @resize="handleColumnResize"
            @toggle="handleColumnToggle"
          />
        </div>

        <el-table
          ref="tableRef"
          v-loading="listLoading"
          :border="gridBorderNeeded"
          class="runtime-table"
          :data="tableData"
          :default-sort="defaultSortProp"
          :row-class-name="rowClassName"
          :row-key="tableRowKey"
          :show-summary="showSummary"
          :span-method="spanMethod"
          :stripe="!gridBorderNeeded"
          :summary-method="getSummaries"
          :tree-props="{ children: 'children' }"
          @selection-change="handleSelectionChange"
          @sort-change="handleSortChange"
        >
          <!--
            多选列。只在配了批量按钮时出现 —— 无条件放一列勾选框，
            却没有任何批量操作可用，用户会一直找那个「然后呢」

            ⚠️ 明细展开模式下不放：一条主记录被摊平成多行，勾一行的语义不明确
            （是勾了这条主记录，还是只勾了这一条明细？）
          -->
          <el-table-column
            v-if="selectionEnabled"
            align="center"
            :reserve-selection="true"
            type="selection"
            width="46"
          />
          <!--
            序号列

            不用 type="index"：那个只会在当前页内从 1 数起，翻到第二页又变回 1。
            自己算的话能跨页连续，用户报「第 37 条有问题」时才对得上。
            树形与明细展开模式下不出现，理由见 indexColumnVisible。
          -->
          <el-table-column
            v-if="indexColumnVisible"
            align="center"
            :fixed="hasLeftFixedColumn ? 'left' : false"
            label="序号"
            width="64"
          >
            <template #default="scope">{{ rowIndexOf(scope.$index) }}</template>
          </el-table-column>
          <!-- 列。有复杂表头配置时，分组渲染成嵌套表头 -->
          <template v-for="(item, idx) in renderColumns" :key="idx">
            <el-table-column
              v-if="item.type === 'group'"
              :label="item.label"
              align="center"
            >
              <el-table-column
                v-for="col in item.cols"
                :key="col.field"
                :align="col.align || 'left'"
                :label="col.label"
                :prop="displayProp(col)"
                :show-overflow-tooltip="true"
                :sortable="col.sortable && !col.subField ? 'custom' : false"
                v-bind="col.widthType === 'fixed' ? { width: col.width || 140 } : { minWidth: col.width || 140 }"
              >
                <template #default="scope">
                  <GroupRowCell
                    v-if="isGroupRow(scope.row)"
                    :columns="columns"
                    :row="scope.row"
                    :show-count="rowGroup?.showCount !== false"
                    @toggle="toggleGroup"
                  />
                  <InlineEditCell
                    v-else-if="isEditingCell(scope.row, col)"
                    v-model="editingValues[col.field]"
                    :col="col"
                  />
                  <ListCell v-else :col="col" :value="scope.row[displayProp(col)]" />
                </template>
              </el-table-column>
            </el-table-column>

            <el-table-column
              v-else
              :align="item.col.align || 'left'"
              :fixed="item.col.fixed || false"
              :label="item.col.label"
              :prop="displayProp(item.col)"
              :show-overflow-tooltip="true"
              :sortable="item.col.sortable && !item.col.subField ? 'custom' : false"
              v-bind="item.col.widthType === 'fixed' ? { width: item.col.width || 140 } : { minWidth: item.col.width || 140 }"
            >
              <template #default="scope">
                <!--
                  分组行只渲染一个横跨整张表的单元格（colspan 由 span-method 给），
                  所以每一列的模板里都要判一次 —— 判漏了哪一列，
                  分组行落到那一列上时会渲染成一片空白
                -->
                <GroupRowCell
                  v-if="isGroupRow(scope.row)"
                  :columns="columns"
                  :row="scope.row"
                  :show-count="rowGroup?.showCount !== false"
                  @toggle="toggleGroup"
                />
                <InlineEditCell
                  v-else-if="isEditingCell(scope.row, item.col)"
                  v-model="editingValues[item.col.field]"
                  :col="item.col"
                />
                <ListCell v-else :col="item.col" :value="scope.row[displayProp(item.col)]" />
              </template>
            </el-table-column>
          </template>

          <el-table-column
            v-if="operationColumn.show && hasRowButtons"
            align="center"
            fixed="right"
            :label="operationColumn.label || '操作'"
            :width="operationColumn.width || 160"
          >
            <template #default="scope">
              <!--
                分组行上不放任何按钮。它不是一条记录 —— 放了按钮，
                点「删除」删的是谁？这正是「把分组塞进 children 当树父节点」
                那种做法要在每个分支里特判的东西，这里只需判这一处
              -->
              <template v-if="isGroupRow(scope.row)" />
              <!--
                行内编辑态：只留「保存 / 取消」。
                其余按钮在编辑态下都没有确定语义 —— 点「详情」是带着没存的改动过去，
                还是丢掉？不给这个选择比猜一个更好
              -->
              <template v-else-if="isEditingRow(scope.row)">
                <el-button
                  link
                  :loading="inlineSaving"
                  type="primary"
                  @click="saveInlineEdit(scope.row)"
                >
                  保存
                </el-button>
                <el-button link :disabled="inlineSaving" @click="cancelInlineEdit">
                  取消
                </el-button>
              </template>
              <!--
                行内按钮。文案、图标、顺序都来自列表设计的按钮清单；
                超过「按钮折叠阈值」的收进「更多」下拉（见 rowActionsOf）。

                ⚠️ 内置按钮与自定义按钮合在一张清单里算折叠，不是各折各的 ——
                用户看到的是一整排按钮，按来源分两次折叠会折出
                「三个 + 更多 + 两个 + 更多」这种没人能预期的结果
              -->
              <template v-else>
                <el-button
                  v-for="action in rowActionsOf(scope.row).inline"
                  :key="action.key"
                  link
                  :type="action.type"
                  @click="runRowAction(action, scope.row)"
                >
                  <Icon v-if="action.icon" class="mr-2px" :icon="action.icon" />
                  {{ action.label }}
                </el-button>
                <el-dropdown
                  v-if="rowActionsOf(scope.row).folded.length > 0"
                  class="ml-8px"
                  @command="(action: any) => runRowAction(action, scope.row)"
                >
                  <el-button link type="primary">
                    更多<Icon class="ml-2px" icon="ep:arrow-down" />
                  </el-button>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item
                        v-for="action in rowActionsOf(scope.row).folded"
                        :key="action.key"
                        :command="action"
                      >
                        <span :class="action.type === 'danger' ? 'text-[var(--el-color-danger)]' : ''">
                          {{ action.label }}
                        </span>
                      </el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </template>
            </template>
          </el-table-column>
        </el-table>

        <Pagination
          v-if="pagination"
          v-model:limit="queryParams.pageSize"
          v-model:page="queryParams.pageNo"
          :total="total"
          @pagination="loadList"
        />
        </ContentWrap>
      </div>
      </template>
    </template>

    <!-- 纯表单：直接渲染表单 -->
    <ContentWrap v-else>
      <form-create
        v-model="formValues"
        v-model:api="fApi"
        :option="formOption"
        :rule="formRule"
      />
      <div class="text-center mt-20px">
        <el-button :loading="submitLoading" type="primary" @click="handleSubmitStandalone">
          提 交
        </el-button>
        <el-button @click="resetStandalone">重 置</el-button>
      </div>
    </ContentWrap>

    <!--
      表单容器：居中弹窗 / 右侧抽屉 / 页内显示，由列表设计里的配置决定。
      三种模式装的是同一份内容，容器只负责「装在哪」
    -->
    <FormContainer v-model="dialogVisible" :mode="formViewMode" :title="dialogTitle">
      <!--
        详情页页签。只在详情态、且配了页签时才套一层 el-tabs ——
        新增/编辑态套上去会让表单凭空多一个页签头，而那时页签里的内容
        （变更记录）根本还不存在
      -->
      <el-tabs v-if="showDetailTabs" v-model="activeDetailTab">
        <el-tab-pane label="表单" name="__form__">
          <form-create
            v-model="formValues"
            v-model:api="fApi"
            :option="dialogFormOption"
            :rule="formRule"
          />
        </el-tab-pane>
        <el-tab-pane v-for="tab in detailTabs" :key="tab.key" :label="tab.label" :name="tab.key">
          <!-- 变更记录页签。与行操作里的那个入口共用同一份渲染 -->
          <template v-if="tab.type === 'CHANGE_LOG'">
            <el-empty v-if="!changeLogs.length" description="这条数据还没有被修改过" />
            <el-timeline v-else>
              <el-timeline-item
                v-for="log in changeLogs"
                :key="log.id"
                :timestamp="log.createTime"
                placement="top"
              >
                <div class="change-log-item">
                  <div class="change-log-operator">{{ log.creator || '未知用户' }}</div>
                  <div v-for="(change, index) in parseChanges(log.changes)" :key="index">
                    <span class="change-log-field">{{ change.title }}</span>
                    <span class="change-log-old">{{ change.oldValue || '（空）' }}</span>
                    <span class="change-log-arrow">→</span>
                    <span class="change-log-new">{{ change.newValue || '（空）' }}</span>
                  </div>
                </div>
              </el-timeline-item>
            </el-timeline>
          </template>

          <!--
            关联数据页签。调的是【目标表单】的分页接口，权限也按它算 ——
            没有 infra:form-design-run:{目标编码}:query 就是空的，这是对的
          -->
          <template v-else-if="tab.type === 'RELATION_LIST'">
            <el-alert
              v-if="relationErrors[tab.key]"
              type="warning"
              :closable="false"
              class="mb-8px"
              :title="relationErrors[tab.key]"
            />
            <el-empty
              v-else-if="!(relationRows[tab.key] ?? []).length"
              description="没有关联数据"
            />
            <el-table v-else :data="relationRows[tab.key]" border size="small" max-height="360">
              <el-table-column
                v-for="col in relationColumns[tab.key] ?? []"
                :key="col.field"
                :label="col.label"
                :prop="col.field"
                show-overflow-tooltip
                min-width="140"
              />
            </el-table>
          </template>
        </el-tab-pane>
      </el-tabs>
      <form-create
        v-else
        v-model="formValues"
        v-model:api="fApi"
        :option="dialogFormOption"
        :rule="formRule"
      />
      <template #footer>
        <!--
          自定义按钮（详情）。只在详情态出现 —— 新增态还没有记录，
          可见条件无从求值，跳转地址里的 {字段} 也插不出值
        -->
        <template v-if="dialogType === 'detail'">
          <!--
            打印。放在详情态而不是编辑态：编辑态的值还没落库，
            印出来的与库里的可能不一致，而单据是要拿去用的
          -->
          <el-button v-if="printEnabled" plain @click="handlePrint()">
            <Icon class="mr-5px" icon="ep:printer" />
            打印
          </el-button>
          <el-button
            v-for="btn in detailButtons"
            v-show="isButtonVisible(btn, formValues)"
            :key="btn.key"
            plain
            @click="runCustomButton(btn, formValues)"
          >
            <Icon v-if="btn.icon" class="mr-5px" :icon="btn.icon" />
            {{ btn.label }}
          </el-button>
        </template>
        <el-button
          v-if="dialogType !== 'detail'"
          :loading="submitLoading"
          type="primary"
          @click="handleSubmit"
        >
          确 定
        </el-button>
        <el-button @click="dialogVisible = false">
          {{ dialogType === 'detail' ? '关 闭' : '取 消' }}
        </el-button>
      </template>
    </FormContainer>

    <!--
      变更时间线
      单独一个弹窗而不是塞进详情弹窗的页签：详情弹窗是表单渲染器，
      往里加页签要动它的整个布局，而变更记录与表单本身没有耦合
    -->
    <Dialog v-model="changeLogVisible" title="变更记录" width="640px">
      <el-empty v-if="!changeLogs.length" description="这条数据还没有被修改过" />
      <el-timeline v-else>
        <el-timeline-item
          v-for="log in changeLogs"
          :key="log.id"
          :timestamp="log.createTime"
          placement="top"
        >
          <div class="change-log-item">
            <div class="change-log-operator">{{ log.creator || '未知用户' }}</div>
            <div v-for="(change, index) in parseChanges(log.changes)" :key="index">
              <span class="change-log-field">{{ change.title }}</span>
              <!-- 空值显示成「（空）」而不是留白：留白看不出是「改成了空」还是渲染坏了 -->
              <span class="change-log-old">{{ change.oldValue || '（空）' }}</span>
              <span class="change-log-arrow">→</span>
              <span class="change-log-new">{{ change.newValue || '（空）' }}</span>
            </div>
          </div>
        </el-timeline-item>
      </el-timeline>
    </Dialog>

    <!--
      导入向导

      放在这里而不是做成路由页：导入的上下文就是「这张列表」——
      它要用当前表单的字段定义、当前表单的权限点，离开这张列表就没有意义。
    -->
    <ImportDialog ref="importDialogRef" @success="handleImportSuccess" />

    <!--
      导出设置

      只放范围与合计行两项 —— 列、顺序、格式都由列表本身决定，
      不该让用户每次导出再选一遍
    -->
    <ExportDialog ref="exportDialogRef" />
  </template>
</template>

<script lang="ts" setup>
import { decodeConf, decodeFieldsAsync } from '@/utils/formCreate'
import { createRemoteOptionRuntime } from '@/components/FormCreate/src/utils/remoteOptionRuntime'
import { parseFormFields } from '@/components/FormCreate/src/utils'
import {
  applyValidateRules,
  evaluateCrossFieldRules,
  parseCrossFieldRules
} from '@/components/FormValidation'
import type { CrossFieldRule } from '@/components/FormValidation'
import { useLogicRuntime } from '@/components/FormLogic/useLogicRuntime'
import type { LogicRule } from '@/components/FormLogic/types'
import { useFormulaRuntime } from '@/components/FormFormula/useFormulaRuntime'
import { useScriptRuntime } from '@/components/FormScript/useScriptRuntime'
import { filterRulesByScene } from '@/components/FormWidgets/renderScene'
import {
  parseFormViewMode,
  type FormViewMode
} from '@/components/FormWidgets/formViewMode'
import FormContainer from './FormContainer.vue'
import {
  collectCollapseGroups,
  filterRulesByCollapse,
  readCollapsed,
  writeCollapsed,
  type CollapseGroup
} from '@/components/FormWidgets/collapseGroup'
import { COLLAPSE_CONTROL } from '@/components/FormWidgets/collapseInject'
import { applyStepValidate } from '@/components/FormWidgets/stepValidate'
import { collectDefaultValues } from '@/components/FormWidgets/formDefaults'
import { parseDetailTabs, type DetailTab } from '@/components/FormWidgets/detailTab'
import { printHtml, resolvePrintHtml } from '@/components/FormWidgets/printTemplate'
import { formatCellText, formatSummaryValue } from '@/components/FormWidgets/listCell'
import { attachMergeSpans, mergeSpanOf } from '@/components/FormWidgets/cellMerge'
import {
  buildGroupedRows,
  initialCollapsedKeys,
  isGroupRow,
  isRowGroupUsable,
  toggleGroupKey,
  type RowGroupConfig
} from '@/components/FormWidgets/rowGroup'
import {
  buildHeaderRows,
  buildListPrintHtml,
  LIST_PRINT_STYLE,
  leafCountOf,
  type PrintCell,
  type PrintHeaderItem,
  type PrintRow
} from '@/components/FormWidgets/listPrint'
import {
  applyColumnPrefs,
  clearColumnPrefs,
  columnKeyOf,
  columnPrefKey,
  readColumnPrefs,
  toColumnPrefs,
  writeColumnPrefs,
  type ColumnPref
} from '@/components/FormWidgets/columnSetting'
import GroupRowCell from './GroupRowCell.vue'
import ImportDialog from './ImportDialog.vue'
import ExportDialog from './ExportDialog.vue'
import ColumnSettingPanel from './ColumnSettingPanel.vue'
import { useUserStore } from '@/store/modules/user'
import { collapseUploadValues } from '@/components/FormWidgets/uploadValue'
import { normalizeArrayValues } from '@/components/FormWidgets/arrayValue'
import { hasPermission } from '@/directives/permission/hasPermi'
import { applyStepsValidate } from '@/components/FormWidgets/formSteps'
import {
  buttonsAt,
  isButtonVisible,
  parseCustomButtons,
  resolveButtonUrl,
  type CustomButton
} from '@/components/FormWidgets/customButton'
import {
  buildSummarySuffix,
  checkSubTables,
  collectSubTables,
  toSubTableMessage,
  type SubTableMeta
} from '@/components/FormCreate/src/subtable/useSubTableRuntime'
import {
  applyThousandsFormat,
  buildAmountSuffix,
  collectAmountDisplayFields,
  resolveRelativeDefaults,
  type AmountDisplayField
} from '@/components/FormInput'
import * as RuntimeApi from '@/api/infra/formDesign/runtime'
import * as DataInterfaceApi from '@/api/infra/dataInterface'
import { applyPlainTextToggle } from '@/components/FormWidgets/plainText'
import { applyRelationSource } from '@/components/FormWidgets/relationSource'
import { getDictTree, getStrDictOptions } from '@/utils/dict'
import { isValuelessOperator } from '@/components/FormWidgets/searchWidget'
import {
  builtinOf,
  DEFAULT_MAX_INLINE_BUTTONS,
  needsSelection,
  normalizeButtons,
  normalizeMaxInline,
  splitInlineButtons,
  visibleButtons
} from '@/components/FormWidgets/listButton'
import ListCell from './ListCell.vue'
import InlineEditCell from './InlineEditCell.vue'
import {
  buildSubmitPayload,
  hasChanges,
  isInlineEditable,
  pickEditableValues
} from '@/components/FormWidgets/inlineEdit'

defineOptions({ name: 'FormDesignRender' })

const message = useMessage()
const route = useRoute()

/**
 * 表单编码
 *
 * 发布时生成的菜单 path 形如 form-design-run/{code}，
 * 所以优先从路由参数取，其次从 query 取（便于直接用 URL 预览）。
 */
const formCode = computed(() => {
  const fromParams = route.params.code as string
  if (fromParams) return fromParams
  const fromQuery = route.query.code as string
  if (fromQuery) return fromQuery
  // 从 path 末段兜底解析
  const segments = route.path.split('/').filter(Boolean)
  return segments[segments.length - 1]
})

const loading = ref(true)
const config = ref<RuntimeApi.FormRuntimeConfigVO>()

// ========== 列表相关 ==========
const listLoading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const queryParams = reactive({ pageNo: 1, pageSize: 20 })
const searchValues = ref<Record<string, any>>({})

// ==================== 列：设计期 / 用户偏好 / 生效 ====================
//
// 分三层，因为它们的生命周期不同：
//   * designColumns —— 设计者定的，来自 list_conf.columns，换表单才变
//   * columnPrefs   —— 使用者自己调的显隐/顺序/宽度，存在浏览器本地
//   * columns       —— 前两者合并后**真正要渲染**的列（隐藏的已经滤掉）
//
// 下游（合计、合并、分组、打印、导出）一律用 columns，不必关心偏好这回事。

/** 列配置，来自 list_conf.columns */
const designColumns = ref<any[]>([])

/** 用户的列偏好。换表单时重新读 */
const columnPrefs = ref<ColumnPref[]>([])

/** 列设置面板上的列（含被隐藏的那些，否则用户没法把它们再打开） */
const settingColumns = computed(() => applyColumnPrefs(designColumns.value, columnPrefs.value))

/** 真正渲染的列 */
const columns = computed<any[]>(() => settingColumns.value.filter((col) => !col.__hidden))

/** 列设置开关。默认关 —— 给每张已发布的列表凭空多一个按钮是一种意外 */
const columnSetting = ref<{ enabled?: boolean } | undefined>(undefined)
const columnSettingEnabled = computed(() => !!columnSetting.value?.enabled)

/** 偏好的存储键。带用户 id，换个人登录看不到上一个人的设置 */
const columnPrefStorageKey = computed(() =>
  columnPrefKey(formCode.value, useUserStore().getUser?.id)
)

const reloadColumnPrefs = () => {
  columnPrefs.value = columnSettingEnabled.value
    ? readColumnPrefs(columnPrefStorageKey.value)
    : []
}

/** 改完偏好立刻落盘 —— 用户不会去点一个「保存列设置」的按钮 */
const persistColumnPrefs = (next: ColumnPref[]) => {
  columnPrefs.value = next
  writeColumnPrefs(columnPrefStorageKey.value, next)
}

const handleColumnToggle = (key: string, hidden: boolean) => {
  persistColumnPrefs(
    toColumnPrefs(
      settingColumns.value.map((col) =>
        columnKeyOf(col) === key ? { ...col, __hidden: hidden } : col
      )
    )
  )
}

const handleColumnResize = (key: string, width: number) => {
  if (!width) return
  persistColumnPrefs(
    toColumnPrefs(
      settingColumns.value.map((col) =>
        columnKeyOf(col) === key ? { ...col, width } : col
      )
    )
  )
}

const handleColumnReorder = (from: number, to: number) => {
  const next = [...settingColumns.value]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  persistColumnPrefs(toColumnPrefs(next))
}

/** 恢复默认：把本地偏好整个清掉，回到设计期的样子 */
const handleColumnReset = () => {
  clearColumnPrefs(columnPrefStorageKey.value)
  columnPrefs.value = []
}
/** 查询条件配置，来自 list_conf.searchItems */
const searchItems = ref<any[]>([])

/**
 * 查询项的取值键
 *
 * 按下标而不是按字段名 —— 同一个字段配两个查询项（如「金额 ≥」与「金额 ≤」）
 * 是合理配置，按字段名存会让两项互相覆盖，且表现为「其中一个条件莫名不生效」。
 */
const valueKey = (index: number): string => `s${index}`
const startKey = (index: number): string => `s${index}_start`
const endKey = (index: number): string => `s${index}_end`
/** 日期区间由 el-date-picker 一次给出 [start, end]，单独一个键 */
const rangeKey = (index: number): string => `s${index}_range`

/** 查询项超过这个数量就默认折叠 */
const SEARCH_COLLAPSE_THRESHOLD = 3
const searchCollapsed = ref(true)

/**
 * 当前要渲染的查询项
 *
 * 折叠时只显示前几个。被折叠起来的项**仍然参与查询** ——
 * buildConditions 遍历的是完整的 searchItems，
 * 否则「收起之后筛选条件悄悄失效」会是个很难发现的问题。
 */
const visibleSearchItems = computed(() =>
  searchItems.value.length > SEARCH_COLLAPSE_THRESHOLD && searchCollapsed.value
    ? searchItems.value.slice(0, SEARCH_COLLAPSE_THRESHOLD)
    : searchItems.value
)

/**
 * 查询下拉的字典选项
 *
 * 按字典类型缓存：同一个字典可能被多个查询项引用，
 * 每次渲染都重新取会让下拉在每次列表刷新时闪一下。
 */
const dictOptionsCache = new Map<string, any[]>()
const dictOptionsOf = (dictType: string): any[] => {
  if (!dictOptionsCache.has(dictType)) {
    dictOptionsCache.set(dictType, getStrDictOptions(dictType))
  }
  return dictOptionsCache.get(dictType) ?? []
}
const pagination = ref(true)
/** 默认排序，来自 list_conf.defaultSort */
const defaultSort = ref<{ field: string; order: string } | undefined>(undefined)
/** 操作列配置，来自 list_conf.operationColumn */
const operationColumn = ref({
  show: true,
  label: '操作',
  width: 160,
  /** 行内按钮超过这个数量时，多出来的收进「更多」下拉 */
  maxInline: DEFAULT_MAX_INLINE_BUTTONS,
  buttons: ['edit', 'detail', 'delete'] as any
})
/**
 * 导出行数上限
 *
 * 由表单设计者在列表设计里配（listConf.exportMaxRows），默认 2 万。
 * 前端只用它在导出弹窗上提示「会被截断」—— 真正的约束在服务端，
 * 前端拦不住也不该拦（用户可以直接调接口）。
 */
const DEFAULT_EXPORT_MAX_ROWS = 20000
const exportMaxRows = ref(DEFAULT_EXPORT_MAX_ROWS)

/** 合计行配置 */
const showSummary = ref(false)
const summaryColumns = ref<string[]>([])

/** 是否显示序号列，来自 list_conf.showIndexColumn */
const showIndexColumn = ref(true)

/** 表单呈现方式，来自 list_conf.formViewMode */
const formViewMode = ref<FormViewMode>('DIALOG')

/**
 * 序号列到底显不显示
 *
 * 两种模式下强制不显示，不是「配了也没用」而是「显示出来是错的」：
 *
 * - 树形：行是递归嵌套的，第几行这个说法本身不成立（子节点收起来时它还算不算一行？）
 * - 明细展开：一条主记录被摊平成多行，按行编号会数出比实际记录数多得多的数字，
 *   而主表列又是跨行合并的，序号列跟着合并还是不合并都不对
 */
const indexColumnVisible = computed(
  () =>
    showIndexColumn.value &&
    !treeConfig.value?.enabled &&
    !expandSubRows.value &&
    // 分组行也是一行，序号会把它一起数进去 —— 用户看到的是
    // 「1 分组行 / 2 第一条数据」，第几条与第几行从此对不上
    !isRowGroupUsable(rowGroup.value)
)

/**
 * 行序号
 *
 * 跨页连续：第二页第一行接着第一页往下数，而不是重新从 1 开始。
 * 重新开始的话，「第 37 条那条」在页与页之间根本对不上号。
 * 关了分页时就是纯粹的行号。
 */
const rowIndexOf = (rowIndex: number): number => {
  if (!pagination.value) return rowIndex + 1
  return (queryParams.pageNo - 1) * queryParams.pageSize + rowIndex + 1
}

/**
 * 有没有左固定列
 *
 * 有的话序号列也得跟着固定。否则横向滚动时序号会滑到固定列底下 ——
 * 表现是「序号这一列被左边的列吃掉了半截」。
 */
const hasLeftFixedColumn = computed(() =>
  columns.value.some((col: any) => col.fixed === 'left')
)

/** 标签页筛选配置 */
const tabConfig = ref<
  { enabled: boolean; field: string; tabs: Array<{ label: string; value: string }> } | undefined
>(undefined)
/** 当前选中的标签。__all__ 表示不加筛选条件 */
const activeTab = ref('__all__')

const handleTabChange = () => {
  queryParams.pageNo = 1
  loadList()
}

/** 树形列表配置 */
const treeConfig = ref<
  { enabled: boolean; parentField: string; rowKey?: string } | undefined
>(undefined)

/**
 * 树形模式的单次加载条数
 *
 * 与后端的 MAX_PAGE_SIZE 保持一致（FormDesignRuntimeServiceImpl 里是 200）。
 * 树形要一次拿全量才能建立父子关系，超出这个量的数据会被截断，
 * 因此加载后会检查 total 并提示用户缩小范围。
 */
const TREE_MODE_PAGE_SIZE = 200

/** 左侧树筛选配置 */
const leftTree = ref<
  | {
      enabled: boolean
      dataSource: 'DICT' | 'FIELD'
      dictType?: string
      field: string
      title?: string
    }
  | undefined
>(undefined)

/** 左侧树的节点。第一项固定是「全部」 */
interface LeftTreeNode {
  label: string
  value: string
  children?: LeftTreeNode[]
}

const treeNodes = ref<LeftTreeNode[]>([])
/** 当前选中的树节点值。空串表示「全部」 */
const currentTreeKey = ref('')
/**
 * 当前筛选要匹配的值集合
 *
 * 点父节点时是「它自己 + 全部后代」。只按父节点自身的值筛的话，
 * 挂在子节点上的数据一条都不会出现 —— 用户看到的是「点了华东，
 * 结果一个人都没有」，而华东下面明明有三个省。
 */
const currentTreeValues = ref<string[]>([])

/**
 * 加载左侧树节点
 *
 * 字典源直接读本地字典缓存；字段源调后端的 distinct 接口 ——
 * 不能从当前页数据提取，那样第二页才出现的值在树里会缺失。
 *
 * ⚠️ 字典源要走 getDictTree 而不是 getStrDictOptions：后者是平铺的，
 * 字典本身是树形时，父节点与子节点会并排成兄弟、顺序还是乱的 ——
 * 一个叫「左侧树」的东西渲染成一串平铺节点，配的人只会以为自己配错了。
 * 平铺字典走 getDictTree 会得到一棵全是根节点的树，是合理的退化。
 */
const loadTreeNodes = async () => {
  const cfg = leftTree.value
  if (!cfg?.enabled || !cfg.field) {
    treeNodes.value = []
    return
  }
  const nodes: LeftTreeNode[] = [{ label: '全部', value: '' }]
  try {
    if (cfg.dataSource === 'DICT') {
      if (cfg.dictType) {
        nodes.push(...getDictTree(cfg.dictType).map(toLeftTreeNode))
      }
    } else {
      // 字段源是「该列的实际去重值」，天然没有层级
      const values = await RuntimeApi.getDistinctValues(formCode.value, cfg.field)
      values
        .filter((v) => v !== null && v !== undefined && v !== '')
        .forEach((v) => nodes.push({ label: String(v), value: String(v) }))
    }
  } catch (e) {
    console.warn('左侧树节点加载失败', e)
  }
  treeNodes.value = nodes
}

/** 字典树节点 → 左侧树节点 */
const toLeftTreeNode = (node: any): LeftTreeNode => {
  const converted: LeftTreeNode = { label: node.label, value: String(node.value) }
  if (Array.isArray(node.children) && node.children.length > 0) {
    converted.children = node.children.map(toLeftTreeNode)
  }
  return converted
}

/** 节点自身 + 全部后代的值 */
const collectTreeValues = (node: LeftTreeNode): string[] => {
  const values = [node.value]
  ;(node.children ?? []).forEach((child) => values.push(...collectTreeValues(child)))
  return values
}

const handleTreeNodeClick = (node: LeftTreeNode) => {
  currentTreeKey.value = node.value
  // 「全部」不带条件
  currentTreeValues.value = node.value === '' ? [] : collectTreeValues(node)
  queryParams.pageNo = 1
  loadList()
}

/** 复杂表头分组配置 */
const complexHeaders = ref<Array<{ label: string; children: string[] }>>([])

/**
 * 按复杂表头配置重排列
 *
 * 输出统一结构：group 项渲染成带子列的嵌套表头，plain 项渲染成普通列。
 * 分组插在它第一个成员列原来的位置上，这样列的相对顺序不会因为分组而跳动。
 *
 * 固定列不参与分组（设计器已过滤），这里再兜一层 ——
 * Element Plus 的 fixed 偏移量计算不考虑多级表头，两者并用会错位。
 */
const renderColumns = computed(() => {
  const groups = complexHeaders.value.filter((g) => g.label && g.children?.length)
  if (groups.length === 0) {
    return columns.value.map((col) => ({ type: 'plain' as const, col }))
  }

  // 列名 → 所属分组，固定列强制排除
  const groupOfField = new Map<string, { label: string; children: string[] }>()
  groups.forEach((g) => {
    g.children.forEach((field) => {
      const col = columns.value.find((c) => c.field === field)
      if (col && !col.fixed) {
        groupOfField.set(field, g)
      }
    })
  })

  const result: Array<
    | { type: 'plain'; col: any }
    | { type: 'group'; label: string; cols: any[] }
  > = []
  const emitted = new Set<{ label: string; children: string[] }>()

  columns.value.forEach((col) => {
    const group = groupOfField.get(col.field)
    if (!group) {
      result.push({ type: 'plain', col })
      return
    }
    // 分组只在首个成员处输出一次，成员按配置里的顺序排列
    if (emitted.has(group)) return
    emitted.add(group)
    const cols = group.children
      .map((f) => columns.value.find((c) => c.field === f))
      .filter((c) => c && !c.fixed)
    result.push({ type: 'group', label: group.label, cols })
  })
  return result
})

/**
 * 明细列的显示键前缀
 *
 * 展开后的行同时装着主表字段与当前明细行的字段，两边同名（比如都有 remark）
 * 直接平铺会互相覆盖。明细值统一挂在带前缀的键上，彼此隔离。
 * span-method 也靠这个前缀区分「该不该合并这一列」，不依赖列的下标 ——
 * 有复杂表头时传进来的是叶子列，下标与 columns 配置早就对不上了。
 */
const SUB_PROP_PREFIX = '__sub__'

/** 某一列在表格里实际取值的键 */
const displayProp = (col: any): string =>
  col?.subField ? `${SUB_PROP_PREFIX}${col.subField}__${col.field}` : col.field

/** 列表里引用到的子表控件 field */
const subTableFields = computed(() =>
  Array.from(new Set(columns.value.filter((c) => c.subField).map((c) => c.subField)))
)

/**
 * 是否要把主记录展开成多行
 *
 * 树形模式下不展开：两者都在重排行结构，同时开会互相打架 ——
 * 树靠 children 递归渲染，展开靠平铺加合并，合起来的结果没有确定语义。
 * 设计器那边树形与明细列互斥，这里再兜一层。
 */
const expandSubRows = computed(
  () => subTableFields.value.length > 0 && !treeConfig.value?.enabled
)

/**
 * 开了同值合并的列，按配置顺序
 *
 * 顺序即级联优先级 —— 前面的列换段会打断后面的列，见 cellMerge.ts 里那张错位图。
 *
 * ⚠️ 明细列（有 subField）一律排除。明细行本来就是逐行独立的，
 * 把它们按同值合并会把不同主记录下的明细粘在一起。设计器里已经禁用了，
 * 这里再兜一层 —— 存量配置可能是在禁用之前配出来的。
 */
const mergeSameColumns = computed(() =>
  columns.value.filter((c: any) => c.mergeSame && !c.subField)
)

/**
 * 同值合并是否生效
 *
 * 与树形、明细展开互斥：三者都在重排行结构，同时开没有确定语义 ——
 * 树按 children 递归、展开按主记录摊平、同值合并按相邻值分段，
 * 合起来的结果解释不了。设计器里是互斥开关，这里兜底。
 */
const mergeSameEnabled = computed(
  () =>
    mergeSameColumns.value.length > 0 &&
    !treeConfig.value?.enabled &&
    !expandSubRows.value &&
    !isRowGroupUsable(rowGroup.value)
)

/** 参与合并的列在行数据上的取值键，顺序即级联优先级 */
const mergeSameColumnProps = computed(() =>
  mergeSameColumns.value.map((c: any) => displayProp(c))
)

/**
 * 表格数据。五种形态：树形、主子表展开、行分组、同值合并、普通平铺
 *
 * 后端返回的始终是「主表行 + 嵌套明细数组」，重排在前端做 ——
 * 这样后端不用关心展示形态，分页的 total 也始终是主记录数。
 * 若让后端直接返回展开后的行，total 与实际行数就对不上，分页器立刻错乱。
 */
const tableData = computed(() => {
  if (treeConfig.value?.enabled && treeConfig.value.parentField) {
    return buildTree(list.value, treeConfig.value.rowKey || 'id', treeConfig.value.parentField)
  }
  if (expandSubRows.value) {
    return flattenWithDetails(list.value)
  }
  if (rowGroupEnabled.value) {
    return buildGroupedRows(
      list.value,
      rowGroup.value!,
      groupLabelOf,
      collapsedGroupKeys.value
    )
  }
  if (mergeSameEnabled.value) {
    // 合并只在当前页内做 —— list 就是当前页。跨页合并没有确定语义
    return attachMergeSpans(
      list.value,
      mergeSameColumnProps.value
    )
  }
  return list.value
})

// ==================== 行分组 ====================

const rowGroup = ref<RowGroupConfig | undefined>(undefined)
const collapsedGroupKeys = ref<Set<string>>(new Set())

/**
 * 行分组是否生效
 *
 * 与树形、明细展开、同值合并互斥 —— 四者都在重排行结构。
 * 设计器里是互斥开关，这里兜底防手工改过的配置。
 */
const rowGroupEnabled = computed(
  () =>
    isRowGroupUsable(rowGroup.value) &&
    !treeConfig.value?.enabled &&
    !expandSubRows.value
)

/**
 * 分组标题
 *
 * 走分组列自己的格式化 —— 分组字段多半是个字典列，不格式化的话
 * 分组行上印的是 `SOFT` 而不是「软件开发」。
 */
const groupLabelOf = (value: any): string => {
  const col = columns.value.find(
    (c: any) => c.field === rowGroup.value?.field && !c.subField
  )
  return formatCellText(value, col?.formatter)
}

/** 点分组行切换折叠 */
const toggleGroup = (key: string) => {
  collapsedGroupKeys.value = toggleGroupKey(collapsedGroupKeys.value, key)
}

/**
 * 分组行的行样式
 *
 * 给它一个底色，好让它与数据行一眼分得开 —— 不给的话，
 * 分组行看起来就是「一条只有第一列有字的记录」。
 */
const rowClassName = ({ row }: any) => (isGroupRow(row) ? 'grid-group-tr' : '')

/**
 * 数据回来后重算默认折叠
 *
 * ⚠️ 必须每页都算。「默认折叠」的语义是「打开时看到的是一排组名」，
 * 翻到第二页却全是展开的，用户会以为折叠状态被翻页弄丢了。
 */
watch(list, (rows) => {
  if (!rowGroupEnabled.value) return
  collapsedGroupKeys.value = initialCollapsedKeys(rows, rowGroup.value!)
})

/**
 * 分组行要横跨的列数
 *
 * 数的是**叶子列**：分组表头下的子列各算一列，父表头不算。
 * 少数一列的话，分组行右边会空出一格；多数一列则会把表格挤出一条横向滚动条。
 */
const leafColumnCount = computed(() => {
  let count = renderColumns.value.reduce(
    (sum, item: any) => sum + (item.type === 'group' ? item.cols.length : 1),
    0
  )
  if (selectionEnabled.value) count += 1
  if (indexColumnVisible.value) count += 1
  if (operationColumn.value.show && hasRowButtons.value) count += 1
  return count
})

/**
 * 把「主行 + 明细数组」摊平成表格行
 *
 * 一条主记录占 max(明细行数, 1) 行：没有明细的主记录仍要占一行，
 * 否则它会整条从列表里消失 —— 用户会以为数据丢了。
 *
 * 每组的首行带上 __span（rowspan），其余行 __span = 0，
 * 供 span-method 把主表列合并成一个跨行单元格。
 */
const flattenWithDetails = (mainRows: any[]): any[] => {
  const result: any[] = []
  mainRows.forEach((mainRow) => {
    // 各子表的明细行数可能不同，取最大值，短的那张表在多出来的行里留空
    const detailCounts = subTableFields.value.map(
      (f) => (Array.isArray(mainRow[f!]) ? mainRow[f!].length : 0)
    )
    const rowCount = Math.max(1, ...detailCounts)

    for (let i = 0; i < rowCount; i++) {
      const row: any = { ...mainRow, __span: i === 0 ? rowCount : 0 }
      subTableFields.value.forEach((subField) => {
        const details = Array.isArray(mainRow[subField!]) ? mainRow[subField!] : []
        const detail = details[i]
        if (!detail) return
        Object.entries(detail).forEach(([key, value]) => {
          row[`${SUB_PROP_PREFIX}${subField}__${key}`] = value
        })
      })
      result.push(row)
    }
  })
  return result
}

/**
 * 单元格合并
 *
 * 三种来源，彼此互斥（见 mergeSameEnabled / rowGroupEnabled 的说明）：
 *
 * 0. **分组行** —— 整行合成一格，横跨全部叶子列
 * 1. **明细展开** —— 主表列跨明细行合并，明细列逐行独立。
 *    操作列没有 property，会落进「主表列」分支一起合并 —— 正是想要的效果，
 *    一条主记录只出现一组编辑/删除按钮。
 * 2. **同值合并** —— 只合并配了 mergeSame 的那几列，其余列逐行独立。
 *    ⚠️ 这里与上一种相反：**不能**让没有 property 的操作列跟着合并。
 *    同值合并是按显示值分段的，一段里是若干条**不同的记录**，
 *    合并掉操作列的话，那一组按钮点下去只能作用于段首那条 —— 其余记录
 *    就再也删不掉、改不了了，而界面上看不出任何异常。
 */
const spanMethod = ({ row, column, columnIndex }: any) => {
  // 分组行横跨整张表。它不属于任何一种「列的合并」，所以放在最前面判 ——
  // 分组行落到别的分支里会被当成数据行，那一行就只剩第一列有内容
  if (isGroupRow(row)) {
    return columnIndex === 0
      ? { rowspan: 1, colspan: leafColumnCount.value }
      : { rowspan: 0, colspan: 0 }
  }

  if (expandSubRows.value) {
    // 明细列不合并
    if (column?.property?.startsWith(SUB_PROP_PREFIX)) return
    const span = row?.__span ?? 1
    // rowspan/colspan 同时为 0 时 Element Plus 不渲染这个单元格
    return span === 0 ? { rowspan: 0, colspan: 0 } : { rowspan: span, colspan: 1 }
  }

  if (mergeSameEnabled.value) {
    // 没有 property 的是序号列、多选列、操作列 —— 一律逐行独立
    if (!column?.property) return
    const span = mergeSpanOf(row, column.property)
    return span === 0 ? { rowspan: 0, colspan: 0 } : { rowspan: span, colspan: 1 }
  }
}

/**
 * 平铺数组转树
 *
 * 无法归位的行（父节点不在结果集里）当作顶层节点返回，而不是丢弃 ——
 * 数据被筛选或父行被删除时，丢弃会让用户以为数据没了。
 */
const buildTree = (rows: any[], rowKey: string, parentField: string): any[] => {
  if (rows.length === 0) return []

  const nodeMap = new Map<any, any>()
  rows.forEach((row) => {
    nodeMap.set(row[rowKey], { ...row })
  })

  const roots: any[] = []
  nodeMap.forEach((node) => {
    const parentId = node[parentField]
    const parent = parentId == null || parentId === '' || parentId === 0
      ? undefined
      : nodeMap.get(parentId)
    // 自引用行（parent 指向自己）也当顶层，否则会造成死循环
    if (parent && parent !== node) {
      parent.children = parent.children ?? []
      parent.children.push(node)
    } else {
      roots.push(node)
    }
  })
  return roots
}

/** 操作列是否有可显示的按钮（edit/detail/delete） */
/** 站内跳转用它 —— 整页刷新会丢掉已加载的菜单与权限缓存 */
const { push } = useRouter()

/**
 * 详情页页签
 *
 * 表单本体是固定的第一个页签，其余按 type 分发渲染。
 * 类型不认识的页签仍会画出页签头但内容为空 —— 发布校验已经拦住了这种配置，
 * 这里不再额外过滤：过滤掉的话，一个手改过配置的表单会「页签凭空少了一个」，
 * 比一个空页签更难查。
 */
const detailTabs = computed<DetailTab[]>(() => parseDetailTabs(config.value?.detailTabs))
const activeDetailTab = ref('__form__')
/** 只在详情态、且真的配了页签时才套页签 */
const showDetailTabs = computed(() => dialogType.value === 'detail' && detailTabs.value.length > 0)

/**
 * 自定义按钮。按 position 分发到工具栏 / 行内 / 详情三处
 *
 * ⚠️ 权限用 hasPermission 在这里过滤掉，【不要】给按钮挂 v-hasPermi ——
 * 那个指令在 value 为空数组时会直接 throw（见 directives/permission/hasPermi.ts），
 * 而「没配权限点」恰恰是最常见的情形。它抛出来的后果不只是少一个按钮：
 * 报错发生在指令钩子里，整张表格的渲染会一起中止 —— 表现是列表变成一片空白，
 * 而控制台只有一句 permission.hasPermission。这个坑是 e2e 抓到的。
 */
const customButtons = computed(() =>
  parseCustomButtons(config.value?.customButtons).filter(
    (btn) => !btn.permission || hasPermission([btn.permission])
  )
)
const toolbarButtons = computed(() => buttonsAt(customButtons.value, 'TOOLBAR'))
const rowButtons = computed(() => buttonsAt(customButtons.value, 'ROW'))
const detailButtons = computed(() => buttonsAt(customButtons.value, 'DETAIL'))

/**
 * 执行一个自定义按钮
 *
 * 目前只有跳转。地址算不出来（模板为空、或插值后协议不在白名单里）时
 * 提示而不是静默 —— 静默的话用户会以为按钮坏了，而实际是地址配错了。
 */
const runCustomButton = async (btn: CustomButton, row?: Record<string, any>) => {
  if (btn.action?.type === 'INVOKE') {
    await runInvokeButton(btn, row)
    return
  }
  const url = resolveButtonUrl(btn, row)
  if (!url) {
    message.error(`按钮「${btn.label}」的跳转地址无效或使用了不被允许的协议`)
    return
  }
  if (btn.action?.target === '_self') {
    // 站内路由用 router.push，整页刷新会丢掉已加载的菜单与权限缓存
    if (url.startsWith('/')) {
      push(url)
    } else {
      window.location.href = url
    }
    return
  }
  window.open(url, '_blank')
}

/**
 * 「调数据接口」动作
 *
 * ⚠️ 只把【按钮标识】发给服务端，不发接口编码，也不发入参 —— 两者都由服务端
 * 从已发布的表单配置里读。发接口编码的话，那个端点就变成「任何对某张表单有
 * update 权限的人都能调任意写型数据接口」；发入参则等于让前端自由构造接口参数。
 *
 * 成功后刷新列表：这类动作（作废、审批）几乎都会改这条记录的状态，
 * 不刷的话用户点完看到的还是旧值，会以为没生效而再点一次。
 */
const runInvokeButton = async (btn: CustomButton, row?: Record<string, any>) => {
  const pkField = config.value?.pkField ?? 'id'
  const pk = row?.[pkField] ?? currentPk.value
  try {
    await RuntimeApi.invokeButton(formCode.value, btn.key, pk)
  } catch (e: any) {
    // 服务端的报错原样给出去。吞掉的话用户只看到「按钮没反应」，
    // 而真正的原因（接口停用了、入参不对）在控制台里
    message.error(e?.msg || e?.message || `按钮「${btn.label}」执行失败`)
    return
  }
  message.success(btn.action?.successMessage || `「${btn.label}」执行成功`)
  if (config.value?.formType === 2) {
    await loadList()
  }
  // 详情弹窗里点的：关掉它。里面的值已经过时了，留着比刷新更误导
  if (dialogVisible.value) {
    dialogVisible.value = false
  }
}

/**
 * 是否启用了变更日志。决定行操作里要不要放「变更记录」入口
 *
 * 声明在 hasRowButtons 之前：那个 computed 引用它。虽然 computed 惰性求值、
 * 放在后面运行时也能跑，但读代码的人会以为这里有个 TDZ 问题
 */
const changeLogEnabled = computed(() => config.value?.changeLogEnabled === true)

// ==================== 详情页页签：关联数据 ====================
//
// 后端不需要任何新东西：调的是【目标表单】的分页接口，而它本来就支持 conditions。

/** 页签 key -> 行数据 */
const relationRows = ref<Record<string, any[]>>({})
/** 页签 key -> 列定义 */
const relationColumns = ref<Record<string, Array<{ field: string; label: string }>>>({})
/** 页签 key -> 出错说明。权限不足是最常见的一种，要说人话 */
const relationErrors = ref<Record<string, string>>({})

/**
 * 拉所有关联数据页签
 *
 * ⚠️ 与变更记录一样，在打开详情时就拉，不等切到那个页签 ——
 * el-tab-pane 默认懒渲染，而「没有关联数据」与「还没拉」在界面上长得一样（都是空白），
 * 用户会以为这条记录下面确实没挂东西。
 *
 * 几个页签并发拉：它们打的是不同表单的接口，串行的话页签一多就要等好几个来回。
 */
const loadRelationTabs = async () => {
  const tabs = detailTabs.value.filter((tab) => tab.type === 'RELATION_LIST')
  if (tabs.length === 0 || currentPk.value === undefined || currentPk.value === null) {
    return
  }
  await Promise.all(tabs.map((tab) => loadRelationTab(tab)))
}

const loadRelationTab = async (tab: DetailTab) => {
  if (!tab.targetFormCode || !tab.targetField) {
    // 发布校验已经拦过这种配置。这里再挡一次是为了「手改过配置」的表单：
    // 不挡的话会发一个不带条件的分页请求，把目标表单的全部数据列出来
    relationErrors.value[tab.key] = '这个页签没配齐目标表单与关联字段'
    return
  }
  try {
    const [page, config] = await Promise.all([
      RuntimeApi.getDataPage(tab.targetFormCode, {
        pageNo: 1,
        pageSize: RELATION_PAGE_SIZE,
        conditions: [{ field: tab.targetField, operator: 'EQ', value: currentPk.value }]
      } as any),
      // 列定义从目标表单的运行时配置来 —— 自己按行数据的键去猜的话，
      // 列名会是字段 ID 而不是用户看得懂的标题
      loadRelationColumns(tab.targetFormCode)
    ])
    relationRows.value[tab.key] = (page as any)?.list ?? []
    relationColumns.value[tab.key] = config
    delete relationErrors.value[tab.key]
  } catch (e: any) {
    // 权限不足是最常见的一种：调的是目标表单的接口，要它的 query 权限。
    // 直接把「加载失败」四个字放出去，用户不知道该找谁开权限
    relationErrors.value[tab.key] =
      e?.msg || e?.message || `读取「${tab.targetFormCode}」的数据失败，可能是没有该表单的查看权限`
    relationRows.value[tab.key] = []
  }
}

/**
 * 目标表单的列定义
 *
 * 优先用它自己配的列表列（那是设计者挑过、排过序的）；没配列表列的纯表单
 * 就退回按表单字段来。两者都拿不到时返回空数组 —— 表格会只剩表头，
 * 而那比把字段 ID 当列名列出来更容易看出「这里没配好」
 */
const loadRelationColumns = async (
  targetCode: string
): Promise<Array<{ field: string; label: string }>> => {
  const config = await RuntimeApi.getRenderConfig(targetCode)
  try {
    const listConf = config.listConf ? JSON.parse(config.listConf) : null
    const columns = (listConf?.columns ?? [])
      .filter((col: any) => col?.field && !col.subField)
      .map((col: any) => ({ field: col.field, label: col.label || col.field }))
    if (columns.length > 0) return columns
  } catch {
    // 坏掉的 listConf 不该让页签打不开，往下走按字段来
  }
  const rules = await decodeFieldsAsync(config.formFields ?? [])
  const collected: Array<Record<string, any>> = []
  for (const rule of rules) parseFormFields(rule as any, collected)
  return collected
    .filter((f) => f.field && !f.subTableField)
    .map((f) => ({ field: f.field as string, label: (f.title as string) || (f.field as string) }))
}

/**
 * 关联数据的条数上限
 *
 * 这是详情弹窗里的一块，不是列表页 —— 不给它翻页控件：几十条已经超出「看一眼
 * 挂了哪些单据」的用途，真要逐条处理应当去目标表单自己的列表页。
 * 取 50 而不是不限：目标表单可能有上万行，一个配错的关联字段就会把它们全拉过来
 */
const RELATION_PAGE_SIZE = 50

/**
 * 是否配了打印模板。决定行操作与详情里要不要放「打印」入口
 *
 * 模板为空时不放按钮 —— 无条件放的话，点开是一张空白的打印预览，
 * 用户第一反应是「打印功能坏了」。
 *
 * 声明位置同 changeLogEnabled：在 hasRowButtons 之前，那个 computed 引用它。
 */
const printEnabled = computed(() => !!config.value?.printTemplate)

/**
 * 打印一条记录
 *
 * ## 重新拉一次详情，不用列表行
 *
 * 列表只查了配置的那几列（`renderColumns`），模板里引用的字段很可能不在其中 ——
 * 直接用行数据的表现是「单据上有几格是空的」，而那几格恰恰是印得出来的。
 * openForm 里已经有同样的注释与同样的做法。
 *
 * ## 值一律做 HTML 转义
 *
 * `resolvePrintHtml` 里做。不转义的话，某条记录备注里的 `<script>` 会在
 * 打印预览里执行 —— 值来自库里的字段，不比用户输入更可信。
 * 模板那一侧由服务端落库前清洗（`RichContentGuard`），两段各管一半。
 */
const handlePrint = async (row?: Record<string, any>) => {
  const template = config.value?.printTemplate
  if (!template) return
  let data = row
  const pkField = config.value?.pkField ?? 'id'
  const pk = row?.[pkField] ?? currentPk.value
  if (pk !== undefined && pk !== null) {
    data = await RuntimeApi.getData(formCode.value, pk)
  }
  const html = resolvePrintHtml(template, data)
  printHtml(html, config.value?.name ?? '打印')
}

/**
 * 内置按钮清单
 *
 * normalizeButtons 同时吃旧的字符串数组与新的对象清单 ——
 * 线上已发布的表单存的都是旧形态，读不上来的后果是操作列整列变空，
 * 而用户看不出原因。
 */
const builtinButtons = computed(() => normalizeButtons(operationColumn.value.buttons))

/** 工具栏上要渲染的内置按钮，保持配置里的顺序 */
const builtinToolbarButtons = computed(() =>
  visibleButtons(builtinButtons.value, 'toolbar').filter((b) => isToolbarButtonAvailable(b.key))
)

/**
 * 查询区卡片要不要为了工具栏而渲染
 *
 * ⚠️ 不含 columnSettingEnabled：列设置留在列表卡片内，不参与这个判断。
 * 把它算进来的话，一张「没有查询项、没有工具栏、只开了列设置」的表单会渲染出
 * 一个只装着搜索按钮的空查询卡片 —— 而搜索按钮自己另有 searchItems.length > 0 的门。
 */
const hasToolbar = computed(
  () => !!(builtinToolbarButtons.value.length || toolbarButtons.value.length)
)

/** 操作列里要渲染的内置按钮 */
const builtinRowButtons = computed(() => visibleButtons(builtinButtons.value, 'row'))

/**
 * 某个行内按钮此刻是否真的可用
 *
 * 勾了显示还不够：打印要有模板、变更记录要开日志。
 * 这一层兜底在运行时而不是发布校验，因为这两个配置分散在不同步骤，
 * 用户完全可能先勾按钮、之后才去配模板。
 */
const isRowButtonAvailable = (key: string): boolean => {
  const gate = builtinOf(key)?.gated
  if (gate === 'print') return printEnabled.value
  if (gate === 'changeLog') return changeLogEnabled.value
  return true
}

const isToolbarButtonAvailable = (key: string): boolean => {
  const gate = builtinOf(key)?.gated
  if (gate === 'print') return printEnabled.value
  return true
}

/** 危险操作给红色，主操作给主色，其余用默认 */
const rowButtonType = (key: string): any => {
  if (key === 'delete') return 'danger'
  if (key === 'edit') return 'primary'
  return undefined
}

/**
 * 要不要画网格线
 *
 * 默认不画 —— 系统里其它管理列表页（租户管理那一类）都是无竖线的，
 * 只有这张表满屏格子，看起来比别处重得多，像一张电子表格而不是列表页。
 *
 * 两种情况例外，这时候竖线是**承载信息**的，去掉会看不懂：
 * - 分组表头：没有竖线就分不出「联系方式」这个父表头到底罩着哪几列
 * - 明细展开：主表列是跨行合并的，没有竖线看不出哪几行属于同一条主记录
 *
 * 隔行浅色与竖线二选一：两个一起上会让表格显得更花。
 */
const gridBorderNeeded = computed(
  () => complexHeaders.value.some((g) => g.label && g.children?.length) || expandSubRows.value
)

/**
 * 工具栏按钮的颜色
 *
 * 与系统里其它管理列表页（如租户管理）对齐：主操作主色、导出成功色、
 * 批量删除危险色。都用默认灰的话，「批量删除」看起来与「导出」一样人畜无害 ——
 * 而它是这一排里唯一不可撤销的动作。
 */
const toolbarButtonType = (key: string): any => {
  if (key === 'create') return 'primary'
  if (key === 'export') return 'success'
  // 导入与导出同为数据进出口，但导入会**改数据** —— 用 warning 与导出区分开，
  // 两个都用成功色的话，用户点错的概率明显更高
  if (key === 'import') return 'warning'
  if (key === 'batchDelete') return 'danger'
  return undefined
}

/**
 * 一行上最终要显示的操作
 *
 * 内置按钮与自定义按钮合成一张清单再按阈值折叠 —— 用户看到的是一整排按钮，
 * 按来源分两次折叠会折出「三个 + 更多 + 两个 + 更多」这种没人能预期的结果。
 *
 * 自定义按钮的可见条件要按【这一行】的数据求值，所以只能是函数而不是 computed。
 */
interface RowAction {
  /** 模板里的 key，同时用作 dropdown 的 command */
  key: string
  label: string
  icon?: string
  type?: any
  /** 内置按钮走 runBuiltinRowButton，自定义按钮走 runCustomButton */
  builtinKey?: string
  custom?: CustomButton
}

const buildRowActions = (row: any): { inline: RowAction[]; folded: RowAction[] } => {
  const actions: RowAction[] = []
  for (const btn of builtinRowButtons.value) {
    if (!isRowButtonAvailable(btn.key)) continue
    actions.push({
      key: `builtin:${btn.key}`,
      label: btn.label,
      icon: btn.icon,
      type: rowButtonType(btn.key),
      builtinKey: btn.key
    })
  }
  for (const btn of rowButtons.value) {
    if (!isButtonVisible(btn, row)) continue
    actions.push({ key: `custom:${btn.key}`, label: btn.label, icon: btn.icon, custom: btn })
  }
  return splitInlineButtons(actions, operationColumn.value.maxInline)
}

/**
 * 按行缓存
 *
 * 模板里一行要问三次（直接显示的那几个、要不要出下拉、下拉里有哪几个）。
 * 不缓存的话，自定义按钮的可见条件会在每一行上被求值三遍 ——
 * 200 行的列表就是 600 次表达式求值，而结果完全一样。
 *
 * 用 WeakMap 按行对象缓存：列表重新加载时行对象整批换新，缓存自然失效，
 * 不需要手工清理。树形模式下的子节点不在 tableData 里，也照样能进缓存。
 */
const rowActionsCache = new WeakMap<object, { inline: RowAction[]; folded: RowAction[] }>()

const rowActionsOf = (row: any): { inline: RowAction[]; folded: RowAction[] } => {
  if (!row || typeof row !== 'object') return buildRowActions(row)
  const cached = rowActionsCache.get(row)
  if (cached) return cached
  const actions = buildRowActions(row)
  rowActionsCache.set(row, actions)
  return actions
}

const runRowAction = (action: RowAction, row: any) => {
  if (action.builtinKey) return runBuiltinRowButton(action.builtinKey, row)
  if (action.custom) return runCustomButton(action.custom, row)
}

const hasRowButtons = computed(() =>
  builtinRowButtons.value.some((b) => isRowButtonAvailable(b.key)) || rowButtons.value.length > 0
)

/** 需要勾选行的按钮 */
const isBatchButton = (key: string): boolean => key === 'batchDelete' || key === 'batchPrint'

/**
 * 要不要放多选列
 *
 * ⚠️ 明细展开模式下一律不放：一条主记录被摊平成多行，勾一行的语义不明确
 * ——是勾了这条主记录，还是只勾了这一条明细？猜错的后果是批量删除
 * 删掉了用户没想删的主记录。
 */
const selectionEnabled = computed(
  () =>
    needsSelection(builtinButtons.value) &&
    !expandSubRows.value &&
    // 分组行上的那个勾选框选中的是什么？不给这个选择比猜一个更好
    !isRowGroupUsable(rowGroup.value)
)

/** 表格行的唯一键。多选的跨页保留依赖它 */
const tableRowKey = computed(() =>
  treeConfig.value?.enabled ? treeConfig.value.rowKey || 'id' : (config.value?.pkField ?? 'id')
)

const selectedRows = ref<any[]>([])

/** el-table 实例。批量删除后要调它的 clearSelection 清掉跨页保留的选中态 */
const tableRef = ref()

const handleSelectionChange = (rows: any[]) => {
  selectedRows.value = rows
}

/** 分发内置工具栏按钮 */
const runBuiltinButton = (key: string) => {
  switch (key) {
    case 'create':
      return openForm('create')
    case 'import':
      return handleImport()
    case 'export':
      return handleExport()
    case 'batchDelete':
      return handleBatchDelete()
    case 'batchPrint':
      return handleBatchPrint()
    case 'printList':
      return handlePrintList()
  }
}

/** 分发内置行内按钮 */
const runBuiltinRowButton = (key: string, row: any) => {
  switch (key) {
    case 'edit':
      // 开了行内编辑就不弹窗，就地把这一行变成可编辑控件
      return inlineEditEnabled.value ? startInlineEdit(row) : openForm('update', row)
    case 'detail':
      return openForm('detail', row)
    case 'delete':
      return handleDelete(row)
    case 'changeLog':
      return openChangeLogs(row)
    case 'print':
      return handlePrint(row)
  }
}

// ==================== 行内编辑 ====================
//
// 逐行保存：每行一次 PUT，走的是与弹窗编辑【同一条】提交流水线，
// 所以联动复校验、公式重算、格式校验、乐观并发锁全都照常生效，
// 服务端一行代码都没改。

/** 行内编辑配置，来自 list_conf.inlineEdit */
const inlineEdit = ref<{ enabled: boolean } | undefined>(undefined)

/**
 * 行内编辑此刻能不能用
 *
 * 明细展开模式下一律关掉：一条主记录被摊平成多行，
 * 改其中一行的主表值没有确定语义。设计器那边已经互斥，这里再兜一层。
 */
const inlineEditEnabled = computed(
  () => inlineEdit.value?.enabled === true && !expandSubRows.value
)

/** 正在编辑的那一行的主键。同一时刻只允许编辑一行 */
const editingPk = ref<any>(undefined)
/** 编辑中的值，只含可编辑列 */
const editingValues = ref<Record<string, any>>({})
/**
 * 进入编辑态时读回来的完整记录
 *
 * ⚠️ 它有两个不可替代的作用，少了任何一个都会出事：
 * 1. 提交时以它打底 —— 列表行只有配出来的那几列，直接拿去提交，
 *    没配成列的字段全是 undefined，服务端那条流水线会把它们当成「清空」。
 *    用户改了个价格，顺手把备注、附件全抹了。
 * 2. 它带着乐观锁的版本号，而版本号必须在【开始编辑】的那一刻取。
 *    等到点保存时才读，读回来的必然是最新版本，冲突永远检测不到。
 */
const editingRecord = ref<Record<string, any>>({})
const inlineSaving = ref(false)

const rowPkOf = (row: any): any => row?.[config.value?.pkField ?? 'id']

const isEditingRow = (row: any): boolean =>
  inlineEditEnabled.value && editingPk.value !== undefined && rowPkOf(row) === editingPk.value

const isEditingCell = (row: any, col: any): boolean =>
  isEditingRow(row) && !!col?.inlineEditable && isInlineEditable(col)

const startInlineEdit = async (row: any) => {
  const pk = rowPkOf(row)
  if (pk === undefined || pk === null) return
  try {
    const full = await RuntimeApi.getData(formCode.value, pk)
    editingRecord.value = full ?? {}
    editingValues.value = pickEditableValues(editingRecord.value, columns.value)
    editingPk.value = pk
  } catch {
    // 读不回来就不进编辑态：进去了也存不回去，还会让用户以为改动生效了
    message.error('读取该行数据失败，无法进入编辑')
  }
}

const cancelInlineEdit = () => {
  editingPk.value = undefined
  editingValues.value = {}
  editingRecord.value = {}
}

const saveInlineEdit = async (row: any) => {
  const pk = rowPkOf(row)
  if (pk === undefined || pk === null) return

  // 没改动就直接退出，不发请求 —— 空提交一样会推高乐观锁版本号
  // 并写一条变更日志，让「谁在什么时候改了什么」混进噪音
  if (!hasChanges(editingRecord.value, editingValues.value)) {
    cancelInlineEdit()
    return
  }

  inlineSaving.value = true
  try {
    await RuntimeApi.updateData(
      formCode.value,
      pk,
      buildSubmitPayload(editingRecord.value, editingValues.value)
    )
    message.success('保存成功')
    cancelInlineEdit()
    await loadList()
  } finally {
    // 失败时【不】退出编辑态：服务端的校验错误已经弹出来了，
    // 退出会把用户刚填的内容一起丢掉，他得从头再改一遍
    inlineSaving.value = false
  }
}

/**
 * 批量删除
 *
 * 走批量接口而不是前端循环单删：整批在服务端一个事务里，
 * 删到一半失败不会留下「删了三条、还剩两条」的中间状态。
 */
const handleBatchDelete = async () => {
  const pkField = config.value?.pkField ?? 'id'
  const ids = selectedRows.value.map((row) => row[pkField]).filter((id) => id != null)
  if (ids.length === 0) return
  try {
    await message.delConfirm(`确认删除选中的 ${ids.length} 条数据吗？`)
  } catch {
    return
  }
  await RuntimeApi.deleteDataBatch(formCode.value, ids)
  message.success('删除成功')
  // 清掉选中态：跨页保留开着，不清的话删掉的行还留在选中集里，
  // 下次点批量删除会去删已经不存在的主键
  selectedRows.value = []
  tableRef.value?.clearSelection?.()
  await loadList()
}

/**
 * 批量打印
 *
 * 逐条取详情再拼成一份文档，中间用分页符隔开 ——
 * 一次打印任务出 N 页，比让用户点 N 次打印实际得多。
 */
/**
 * 列表打印：把当前看到的这张表原样印出来
 *
 * 与「批量打印」是两件事 —— 那个是「勾中的每条记录各印一页单据」，走打印模板；
 * 这个是「把这张报表印成一张表」，与模板无关。
 *
 * ## 从渲染用的同一套结构出发，而不是克隆页面上的 table
 *
 * 克隆 DOM 会把 el-table 的固定列（同一份数据渲染两遍）、排序图标、
 * 操作列里的按钮一起复制进去 —— 印出来的纸上会出现两遍相同的前两列，
 * 还带着「编辑 / 删除」两个按钮。从数据重新生成反而更可控。
 *
 * ## 印的是「看到的这一页」
 *
 * 不去后端重拉全量。列表打印的语义是「把屏幕上这张表印出来」——
 * 用户刚筛完、刚排完序、刚折叠了两个分组，他要的就是这个样子。
 * 要全量导出有「导出」按钮，那是另一件事。页脚会写明印了多少条、共多少条，
 * 免得用户以为印的是全部。
 */
const handlePrintList = () => {
  // 表头：与屏幕上的 renderColumns 同一套结构，所以分组表头天然带过去
  const headerItems: PrintHeaderItem[] = renderColumns.value.map((item: any) =>
    item.type === 'group'
      ? { type: 'group', label: item.label, children: item.cols.map((c: any) => c.label) }
      : { type: 'plain', label: item.col.label }
  )
  const headerRows = buildHeaderRows(headerItems)
  const leafCount = leafCountOf(headerRows)

  // 叶子列，顺序与表头一致 —— 两者错位的话整张表会串列
  const leafColumns: any[] = renderColumns.value.flatMap((item: any) =>
    item.type === 'group' ? item.cols : [item.col]
  )

  const rows: PrintRow[] = tableData.value.map((row: any) => {
    if (isGroupRow(row)) {
      // 分组行：把组名、条数、小计拼成一句话 —— 纸上没有 flex 布局可用
      const sums = Object.entries(row.__groupSums ?? {})
        .map(([field, value]) => {
          const col = columns.value.find((c: any) => c.field === field && !c.subField)
          return `${col?.label || field}：${formatSummaryValue(value as number, col?.formatter)}`
        })
        .join('   ')
      const count = rowGroup.value?.showCount !== false ? `（${row.__groupCount} 条）` : ''
      return { group: `${row.__groupLabel}${count}${sums ? '   ' + sums : ''}` }
    }
    const cells: PrintCell[] = leafColumns.map((col: any) => {
      const prop = displayProp(col)
      return {
        text: formatCellText(row[prop], col.formatter),
        align: col.align || 'left',
        // 合并状态直接沿用屏幕上的那一份，两处各算一遍必然漂移
        rowspan: expandSubRows.value
          ? (col.subField ? 1 : (row.__span ?? 1))
          : mergeSpanOf(row, prop)
      }
    })
    return { cells }
  })

  // 合计行。第一格放「合计」二字，与屏幕上的位置一致
  let summary: string[] | undefined
  if (showSummary.value) {
    summary = leafColumns.map((col: any, index: number) => {
      if (index === 0) return '合计'
      if (!isSummaryColumn(col)) return '-'
      const values = expandSubRows.value
        ? summarySource(col).map((item: any) => Number(item[col.field]))
        : list.value.map((item: any) => Number(item[displayProp(col)]))
      if (values.length === 0 || values.some((v: number) => isNaN(v))) return '-'
      return formatSummaryValue(
        values.reduce((a: number, b: number) => a + b, 0),
        col.formatter
      )
    })
    // 叶子列数与合计格数必须一致，否则合计行会与表体错位
    while (summary.length < leafCount) summary.push('')
  }

  const html = buildListPrintHtml({
    title: config.value?.name ?? '列表',
    headerRows,
    rows,
    summary,
    footnote: pagination.value
      ? `本次打印 ${list.value.length} 条，共 ${total.value} 条（列表打印印的是当前这一页）`
      : `共 ${list.value.length} 条`
  })
  printHtml(html, config.value?.name ?? '列表', LIST_PRINT_STYLE)
}

const handleBatchPrint = async () => {
  const template = config.value?.printTemplate
  if (!template) return
  const pkField = config.value?.pkField ?? 'id'
  const ids = selectedRows.value.map((row) => row[pkField]).filter((id) => id != null)
  if (ids.length === 0) return

  const pages: string[] = []
  for (const id of ids) {
    const data = await RuntimeApi.getData(formCode.value, id)
    pages.push(resolvePrintHtml(template, data))
  }
  // page-break-after 是打印时才生效的样式，屏幕预览上看不出来
  const html = pages
    .map((page, index) =>
      index === pages.length - 1
        ? page
        : `<div style="page-break-after: always">${page}</div>`
    )
    .join('')
  printHtml(html, config.value?.name ?? '打印')
}

/**
 * 合计行方法
 *
 * 用 property 判断列身份而不是索引 —— 有复杂表头时 Element Plus 传进来的是叶子列，
 * 索引与 columns 配置不再一一对应。
 *
 * 主子表展开后取值来源要分开：主表列必须按【主记录】累加，
 * 直接对展开后的行求和会把跨了 N 行明细的主表值重复算 N 次；
 * 明细列则要把所有主记录下的明细摊平了一起累加。
 */
const getSummaries = (param: any) => {
  // 只取列定义。行数据一律用 `list`（当前页的原始记录）——
  // param.data 是重排之后的表格行，理由见下面取 values 那一段
  const { columns: tableCols } = param
  const sums: string[] = []
  //
  // 「合计」这两个字放在哪一列
  //
  // 默认是第一列，而第一列常常是多选框（46px）或序号列（64px）——
  // 两个字在那点宽度里会竖着折成「合 / 计」两行，把整个合计行撑高一倍，
  // 看着像是渲染坏了。挪到第一个有宽度的数据列上，它至少有 140px。
  // 一列数据列都没有时（理论上不会）退回第一列，总比不显示好。
  //
  const labelIndex = Math.max(
    0,
    tableCols.findIndex((column: any) => !!column.property)
  )
  tableCols.forEach((column: any, index: number) => {
    const prop = column.property
    if (index === labelIndex) {
      sums[index] = '合计'
      return
    }
    if (!prop) {
      sums[index] = ''
      return
    }
    const col = columns.value.find((c) => displayProp(c) === prop)
    if (!col || !isSummaryColumn(col)) {
      sums[index] = '-'
      return
    }

    // 展开模式下按各自的来源取值；其余一律取 `list`（当前页的原始数据行），
    // 而不是 el-table 传进来的 `data`。
    //
    // ⚠️ `data` 是重排之后的表格行，三种模式下都不是想要的取数集合：
    //
    // - **树形**：`data` 只有根节点，子节点挂在 children 里。按它求和得到的是
    //   「三个根节点之和」—— 而中间节点的工时多半是空的，合计于是恒为 0。
    //   现象是「开了合计行却一直显示 0」，看起来像合计坏了
    // - **行分组**：`data` 里混着分组行，它身上没有业务字段，
    //   Number(undefined) 得到 NaN，整列会退化成一排 `-`
    // - **普通平铺**：`data` 与 `list` 本来就相等，取哪个都一样
    //
    // 取 `list` 一次把三种情况都收口 —— 它就是「当前页的那些记录」，
    // 与合计行「这一页的总计」的语义严丝合缝。
    const values: number[] = expandSubRows.value
      ? summarySource(col).map((item: any) => Number(item[col.field]))
      : list.value.map((item: any) => Number(item[prop]))

    if (values.length > 0 && values.every((val: number) => !isNaN(val))) {
      // 与数据行共用一条格式化路径：列配了千分位/小数位，合计行也跟着
      sums[index] = formatSummaryValue(
        values.reduce((prev: number, curr: number) => prev + curr, 0),
        col.formatter
      )
    } else {
      sums[index] = '-'
    }
  })
  return sums
}

/**
 * 这一列要不要合计
 *
 * 配置里存的是复合 key（明细列为 `子表控件::字段`），与设计器的 columnKey 同规则。
 * 早期配置存的是裸 field，那时主表的 amount 与明细表的 amount 区分不开 ——
 * 兼容读法只认主表列，明细列不吃这条，否则会把「配给主表」的合计算到明细上去。
 */
const isSummaryColumn = (col: any): boolean => {
  const keys = summaryColumns.value
  if (keys.includes(columnIdentity(col))) return true
  return !col.subField && keys.includes(col.field)
}

/** 列身份标识，与设计器 StepListDesign 的 columnKey 保持同一规则 */
const columnIdentity = (col: any): string =>
  col?.subField ? `${col.subField}::${col.field}` : (col?.field ?? '')

/**
 * 合计取数的来源集合
 *
 * 主表列取主记录本身（每条只算一次），明细列取全部明细行。
 */
const summarySource = (col: any): any[] => {
  if (!col.subField) {
    return list.value
  }
  return list.value.flatMap((row: any) =>
    Array.isArray(row[col.subField]) ? row[col.subField] : []
  )
}

/** el-table 的 default-sort 绑定格式 */
const defaultSortProp = computed(() => {
  if (!defaultSort.value?.field) return undefined
  return {
    prop: defaultSort.value.field,
    order: defaultSort.value.order === 'asc' ? ('ascending' as const) : ('descending' as const)
  }
})

/** 当前排序状态（用户手动排序后会覆盖默认排序） */
const currentSort = ref<{ field: string; order: string } | undefined>(undefined)

const handleSortChange = ({ prop, order }: any) => {
  if (!order) {
    currentSort.value = undefined
  } else {
    currentSort.value = {
      field: prop,
      order: order === 'ascending' ? 'asc' : 'desc'
    }
  }
  loadList()
}

// ========== 表单相关 ==========
const fApi = ref()
/**
 * 完整的规则树（未按场景过滤）
 *
 * 各种后置加工（格式校验、千分位、合计）都作用在这棵树上，
 * 场景过滤只在往 form-create 交付时做一次。
 */
const allRules = ref<any[]>([])

/**
 * 控件的出厂默认值
 *
 * 在规则树刚解码出来、还没被写过值的那一刻抓一份（见 collectDefaultValues 的说明）。
 * 新增时用它把表单恢复成「一张新表单」的样子 —— 既清掉上一次编辑留下的残留，
 * 又保住设计器里配的默认值。
 */
const pristineDefaults = ref<Record<string, any>>({})

/**
 * 当前场景下真正渲染的规则树
 *
 * 按「出现场景」过滤：配了只在详情出现的字段，新增/编辑时**根本不在树里**。
 * 不用「标 hidden」是因为那样联动的 SHOW 动作能把它重新显示出来 ——
 * 场景开关表达的是「这个场景里没有这个字段」，比任何运行时规则都更靠前。
 */
const formRule = ref<any[]>([])

/**
 * 按当前场景重算要渲染的规则树
 *
 * ⚠️ 这里刻意**不用 computed**。form-create 会把规则树深度响应化，而
 * `filterRulesByScene` 要读每个节点的 `props.scenes` —— 放在 computed 里就等于
 * 订阅了整棵树的所有 props。之后内核每改一次内部状态（填个值就会改），
 * computed 就失效重算、产出一个新数组，`:rule` 变化又触发整表重建：
 * 表现为「公式算出来了、内核里也有值，但控件上一直显示旧值」。
 *
 * 场景只在「加载完配置」和「切换新增/详情」这两个时刻变，显式调用即可。
 */
const applyScene = () => {
  const byScene = filterRulesByScene(
    allRules.value,
    dialogType.value === 'detail' ? 'detail' : 'form'
  )
  // 折叠在场景之后做：场景决定「有没有这个字段」，折叠决定「这会儿显不显示」
  formRule.value = filterRulesByCollapse(byScene, collapsedGroups.value)
}

// ========== 分组标题折叠 ==========

/** 表单里的可折叠分组 */
const collapseGroups = ref<CollapseGroup[]>([])
/** 当前折叠着的分组 key */
const collapsedGroups = ref<Set<string>>(new Set())

/**
 * 给标题挂上折叠开关
 *
 * 开关做成标题规则的 suffix（与金额大写、子表合计同一套机制）。
 * 直接写进【完整树】而不是过滤后的树 —— 过滤会重建数组，写在那上面会被下一次
 * 过滤丢掉。
 */
const applyCollapseToggles = () => {
  const byKey = new Map(collapseGroups.value.map((g) => [g.key, g]))
  const walk = (list: any[] | undefined) => {
    if (!Array.isArray(list)) return
    for (const rule of list) {
      if (!rule || typeof rule !== 'object') continue
      if (byKey.has(rule.field)) {
        rule.suffix = { type: 'CollapseToggle', props: { groupKey: rule.field } }
      }
      walk(rule.children)
      walk(rule.props?.rule)
    }
  }
  walk(allRules.value)
}

/**
 * 折叠控制。通过 provide 交给标题上的开关组件
 *
 * 用 provide/inject 而不是 form-create 的注入：suffix 规则渲染出来的组件能不能拿到
 * `formCreateInject` 并不确定，而 provide/inject 只要在同一棵组件树里就一定通。
 */
provide(COLLAPSE_CONTROL, {
  isCollapsed: (groupKey: string) => collapsedGroups.value.has(groupKey),
  toggle: (groupKey: string) => {
    const next = new Set(collapsedGroups.value)
    if (next.has(groupKey)) {
      next.delete(groupKey)
    } else {
      next.add(groupKey)
    }
    collapsedGroups.value = next
    writeCollapsed(formCode.value, groupKey, next.has(groupKey))
    // 折叠改变的是「渲染哪些控件」，要重算规则树
    applyScene()
  }
})
const formValues = ref<Record<string, any>>({})
const dialogVisible = ref(false)

/**
 * 页内模式下表单是否正占着页面
 *
 * 只有这一种模式需要让列表整块退场 —— 弹窗与抽屉都浮在列表之上，
 * 底下的列表该留着（关掉之后用户看回的还是原来那一页，不用重新找位置）。
 */
const inlineFormActive = computed(() => formViewMode.value === 'INLINE' && dialogVisible.value)
const dialogType = ref<'create' | 'update' | 'detail'>('create')
const submitLoading = ref(false)
const currentPk = ref<string | number>()
/**
 * 乐观锁：当前编辑的这条记录被读出来时的版本号
 *
 * 单独放一个 ref 而不是塞进 formValues：版本列不是表单字段，
 * form-create 的 setValue / formData 都不认它，跟着表单值走一定会丢。
 */
const currentVersion = ref<any>()
/** 版本字段名。由运行时配置下发，为空表示未启用乐观锁 */
const versionField = computed(() => config.value?.versionField)

const changeLogVisible = ref(false)
const changeLogs = ref<RuntimeApi.FormDataChangeLogVO[]>([])

/**
 * 打开某一行的变更时间线
 *
 * 每次点开都重新拉：变更记录是别人也会写的东西，缓存住会让人看到过期的历史。
 */
const openChangeLogs = async (row: any) => {
  const pkField = config.value?.pkField ?? 'id'
  changeLogs.value = await RuntimeApi.getDataChangeLogs(formCode.value, row[pkField])
  changeLogVisible.value = true
}

/**
 * 解析一条日志里的变更清单
 *
 * 解析失败时返回空数组而不是抛异常：一条脏日志不该让整个时间线打不开。
 */
const parseChanges = (changes: string): RuntimeApi.FormFieldChangeVO[] => {
  try {
    const parsed = JSON.parse(changes || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const dialogTitle = computed(() => {
  const map = { create: '新增', update: '编辑', detail: '详情' }
  return `${map[dialogType.value]}${config.value?.name ?? ''}`
})

const formOption = ref<any>({ submitBtn: false, resetBtn: false })

/**
 * 跨字段校验规则
 *
 * 前端校验是体验，服务端复校验才是约束 —— 这里拦下来只是为了让用户不用
 * 提交一次才知道日期填反了。绕过前端直接构造请求仍会被服务端拦住。
 */
const crossFieldRules = ref<CrossFieldRule[]>([])

/**
 * 需要在控件后面显示金额信息（千分位 / 大写）的字段
 *
 * 数字输入框的千分位也走这里 —— el-input-number 没有 formatter prop，
 * 原地格式化做不到。
 */
const amountDisplayFields = ref<AmountDisplayField[]>([])

/** 表单里的子表（合计配置、行数区间、明细列） */
const subTables = ref<SubTableMeta[]>([])

/**
 * 刷新子表的合计行
 *
 * 与金额大写同一套做法：合计文本挂在子表规则的 suffix 上，明细一变就重挂。
 * 显示的是上一次的合计比不显示更危险 —— 用户会照着一个过期的数字去核对。
 */
const refreshSubTableSummary = () => {
  if (!subTables.value.length) return
  for (const meta of subTables.value) {
    const rows = formValues.value?.[meta.field]
    const suffix = buildSummarySuffix(meta, Array.isArray(rows) ? rows : [])
    try {
      fApi.value?.updateRule?.(meta.field, { suffix })
    } catch {
      // 合计只是辅助展示，挂不上不该影响填表
    }
  }
}

/**
 * 提交前的子表校验
 *
 * 前端这份是即时反馈，服务端 SubTableGuard 那份才是不可绕过的关口 ——
 * 这里放过的（比如构造请求绕开界面）照样会被服务端拦下。
 */
const checkSubTableRules = (values: Record<string, any>): boolean => {
  if (!subTables.value.length) return true
  const text = toSubTableMessage(checkSubTables(subTables.value, values))
  if (!text) return true
  message.error(text)
  return false
}

/** 联动规则 */
const logicRules = ref<LogicRule[]>([])

/** 前端脚本：钩子名 → 脚本文本 */
const formScripts = ref<Record<string, string>>({})
/** 扩展模式。缺省按 1（前端脚本）—— 与建表默认值一致 */
const extensionMode = ref<number>(1)
/** beforeSubmit 超时动作。缺省按 1（阻断）—— 与建表默认值一致 */
const submitTimeoutAction = ref<number>(1)

/**
 * 联动与公式的运行时
 *
 * ⚠️ 这两处接线是补上来的。B1/B2 交付了双端求值器、设计器 UI 与单测，
 * 但运行时渲染页从来没调过它们 —— 联动与公式只在「设计器里能配」和
 * 「提交时服务端会算」两端存在，用户填表时看不到任何反馈。
 *
 * 详情态不跑联动：所有字段已经置为禁用，再改一堆状态是白费。
 * 公式在详情态仍然要算 —— 详情看到的合计必须与列表一致。
 */
const logicRuntime = useLogicRuntime({
  rules: () => logicRules.value,
  formRule: () => formRule.value,
  formData: () => formValues.value,
  api: () => fApi.value,
  enabled: () => dialogType.value !== 'detail'
})

useFormulaRuntime(
  () => formRule.value,
  () => formValues.value,
  // 把算出来的值推回 form-create。少了这一步，数据里有值而界面上一直是 0 ——
  // 内核维护着自己的一份值，直接改外层对象它不跟
  (changed) => {
    const patch: Record<string, any> = {}
    for (const field of changed) patch[field] = formValues.value?.[field]
    try {
      fApi.value?.setValue?.(patch)
    } catch (e) {
      console.warn('[FormRender] 回写公式结果失败', e)
    }
  }
)

/**
 * 前端脚本运行时
 *
 * ⚠️ 这一处接线的缺失比联动那处更严重：extension_mode 的默认值就是「前端脚本」，
 * 也就是说在补上之前，**默认模式下用户写的脚本一次都不会执行**，
 * 而设计器里能写、能静态检查、能保存 —— 没有任何迹象表明它没生效。
 */
const scriptRuntime = useScriptRuntime({
  scripts: () => formScripts.value,
  extensionMode: () => extensionMode.value,
  timeoutAction: () => submitTimeoutAction.value,
  formData: () => formValues.value,
  api: () => fApi.value,
  message: {
    success: (text) => message.success(text),
    warning: (text) => message.warning(text),
    error: (text) => message.error(text),
    confirm: (text) => message.confirm(text)
  },
  // 脚本里的 callDataInterface 由这里落地。走 fetchOptions 而不是 invoke：
  // 前者只需登录态且服务端强制只读，填单人不会有数据接口的管理权限
  invokeDataInterface: (code, args) => DataInterfaceApi.fetchOptions(code, args)
})

/**
 * 字段变化：驱动脚本的 onFieldChange
 *
 * 挂在 form-create 的 option.onChange 上，而不是对 formData 做 deep watch ——
 * 内核本来就告诉了我们「哪个字段变了」，deep watch 既拿不到这个信息，
 * 又要在每次输入时遍历整棵数据树。
 */
const handleFieldChange = (field: string) => {
  scriptRuntime.runOnFieldChange(field)
}

/**
 * 刷新金额大写的展示
 *
 * 大写文本挂在规则的 suffix 上（form-create 的 suffix 本身也是一条规则，
 * 渲染在控件之后）。值一变就要重挂一次 —— 大写是给人核对金额的，
 * 显示的是上一次的值比不显示更危险。
 *
 * 取不到 updateRule 时静默跳过：大写只是辅助展示，
 * 为它让整个表单报错不值当。
 */
const refreshChineseAmount = (values: Record<string, any>) => {
  if (!amountDisplayFields.value.length) return
  for (const config of amountDisplayFields.value) {
    const suffix = buildAmountSuffix(config, values?.[config.field])
    try {
      fApi.value?.updateRule?.(config.field, { suffix })
    } catch {
      // 见上：辅助展示失败不该影响填表
    }
  }
}

/**
 * 盯住金额字段的值变化，重挂大写
 *
 * ⚠️ 只侦听这几个字段的值，不对 formValues 做 deep watch。
 * 大表单上的 deep watch 会在每次输入时遍历整棵数据树 ——
 * B0 移除设计器里那个 deep watch 的理由，在这里同样成立。
 */
watch(
  () => amountDisplayFields.value.map((config) => formValues.value?.[config.field]),
  () => refreshChineseAmount(formValues.value)
)

/**
 * 盯住明细行的变化，重算合计
 *
 * 侦听的是每个子表的数组内容（序列化后比对），不是整个 formValues ——
 * 明细行的字段值变化必须被感知到（改一行的单价，合计要跟着变），
 * 而对整棵数据树做 deep watch 的代价在大表单上是可感的。
 */
watch(
  () => subTables.value.map((meta) => JSON.stringify(formValues.value?.[meta.field] ?? null)),
  () => refreshSubTableSummary()
)

/**
 * 相对日期默认值
 *
 * 只在【新增】时填：编辑既有记录时，默认值绝不能盖掉用户存过的日期。
 * resolveRelativeDefaults 本身也会跳过已有值的字段，这里的 create 判断是第二道。
 */
const applyRelativeDefaults = (): Record<string, any> => {
  // now 显式传入：解析函数不自己取当前时间，这样跨月跨年的边界能在测试里复现
  return resolveRelativeDefaults(formRule.value, new Date(), formValues.value)
}

/**
 * 跑一遍跨字段校验，不通过则提示并返回 false
 *
 * 放在提交前而不是每次值变化：跨字段的约束在表单填一半时几乎必然不满足
 * （「结束日期 ≥ 开始日期」在只填了开始日期时判不了），
 * 边填边报错会让用户一路看着红字。求值器本身也做了同样的取舍 ——
 * 断言里有还没填的操作数时整条规则跳过。
 */
const checkCrossFieldRules = (values: Record<string, any>): boolean => {
  const violations = evaluateCrossFieldRules(crossFieldRules.value, values)
  if (!violations.length) return true
  // 一次性把所有问题列出来，而不是报第一条 ——
  // 用户改完一处再提交又被拦下一处，来回好几轮
  message.error(violations.map((item) => item.message).join('；'))
  return false
}

/** 详情态把所有字段置为禁用 */
const dialogFormOption = computed(() => {
  if (dialogType.value !== 'detail') return formOption.value
  return { ...formOption.value, disabled: true }
})

/**
 * 纯表单模式还等着跑 LOAD 时机
 *
 * ⚠️ 不能在 loadConfig 里直接跑：那时 `loading` 还是 true，
 * `<form-create>` 根本没渲染，`fApi` 是 undefined —— 所有 api 调用都成了空操作，
 * 表现为「纯表单上联动、公式、脚本全都不生效」，而且不报任何错。
 * 这是运行时 e2e 抓到的第一个真问题。
 */
const standalonePending = ref(false)

/**
 * 等表单实例就绪后再跑纯表单的 LOAD 时机
 *
 * fApi 由 `<form-create v-model:api>` 在挂载时写入，它有值就说明表单已经渲染好了。
 */
watch([fApi, standalonePending], async ([api, pending]) => {
  if (!api || !pending) return
  standalonePending.value = false
  // 相对日期默认值：纯表单打开即是新增
  Object.assign(
    formValues.value,
    resolveRelativeDefaults(formRule.value, new Date(), formValues.value)
  )
  await nextTick()
  api.setValue?.(formValues.value)
  refreshChineseAmount(formValues.value)
  refreshSubTableSummary()
  logicRuntime.runOnLoad()
  scriptRuntime.runOnLoad()
})

const loadConfig = async () => {
  loading.value = true
  try {
    const data = await RuntimeApi.getRenderConfig(formCode.value)
    config.value = data

    // 解码 form-create 配置
    if (data.formConf) {
      formOption.value = { ...decodeConf(data.formConf), submitBtn: false, resetBtn: false }
    }
    // onChange 单独挂，不放在上面的 if 里 —— 没配 formConf 的表单
    // 同样要能触发脚本的 onFieldChange
    formOption.value = { ...formOption.value, onChange: handleFieldChange }
    if (data.formFields?.length) {
      const rules = await decodeFieldsAsync(data.formFields)
      // 把控件的 props.validateRules 派生成内核的 validate，失焦即时提示。
      // 必须在赋给 formRule 之前做完 —— 之后再改规则树，form-create 已经建好了
      // 表单项，新增的校验规则不会被它拾取
      // 传入唯一性检查上下文：查重要发请求，而请求需要表单编码与
      // 「当前编辑的是哪条记录」（编辑时要把自己排除掉，否则改备注也会说重复）
      // 千分位：给数字输入框装上 formatter / parser。
      // 必须在赋给 formRule 之前 —— 之后 form-create 已经建好了控件实例
      applyThousandsFormat(rules)
      // 关联控件要知道自己长在哪张表单上 —— 它取候选数据走的是 REFERENCE 接口，
      // 入参是「源表单 + 控件字段」而不是「目标表单 + 字段列表」。
      // 不注入的话下拉框取不到数，且界面上只是空着、不报错
      applyRelationSource(rules, formCode.value)
      // 分步校验：标签页切走之前校验当前页的字段。
      // 校验函数在这里注入 —— stepValidate 模块不认识 form-create 的 api
      const validateStepFields = async (fields: string[]) => {
        try {
          await fApi.value?.validateField?.(fields)
          return true
        } catch {
          // validateField 校验不过时是 reject。拦住切换，用户就停在有错的那一页，
          // 错误提示也已经由内核标出来了
          return false
        }
      }
      applyStepValidate(rules, validateStepFields)
      // 出厂默认值必须在这里抓 —— 规则树刚解码出来、还没被任何人写过值。
      // 晚一步就来不及了：setValue / coverValue 会把值写进 rule.value 本身，
      // 打开过一条记录之后，那条记录的值就「长」在规则树上了
      pristineDefaults.value = collectDefaultValues(rules)
      // 步骤条容器走同一个校验函数。它与标签页上的分步校验并存 ——
      // 两边共用一个实现，语义才不会漂
      applyStepsValidate(rules, validateStepFields)
      applyValidateRules(rules, {
        check: (field, value) =>
          RuntimeApi.checkFieldUnique(formCode.value, field, value, currentPk.value)
      })
      // 脱敏字段的「查看明文」按钮。只在编辑态挂 —— 新增时没有已存的值，
      // 详情态是只读的，两种情况下这个按钮都没有意义
      applyPlainTextToggle(rules, {
        pk: () => currentPk.value,
        fetch: (field) =>
          RuntimeApi.getPlainField(formCode.value, currentPk.value, field),
        setValue: (field, value) => {
          fApi.value?.setValue?.(field, value)
        },
        notify: (type, text) =>
          type === 'success' ? message.success(text) : message.error(text)
      })
      allRules.value = rules
      // 折叠分组要在挂开关与算规则树之前先收集出来
      collapseGroups.value = collectCollapseGroups(allRules.value)
      collapsedGroups.value = new Set(
        collapseGroups.value
          .filter((group) => readCollapsed(formCode.value, group))
          .map((group) => group.key)
      )
      applyCollapseToggles()
      applyScene()
      // 数据接口选项的运行时重取。建在【完整树】上：
      // 场景过滤会重建数组但保留规则对象本身，写回选项仍然作用到同一批对象上
      remoteOptionRuntime.value = createRemoteOptionRuntime(
        allRules.value,
        (field) => fApi.value?.getValue?.(field) ?? formValues.value?.[field]
      )
    }
    crossFieldRules.value = parseCrossFieldRules(data.validateRules)
    // 这两个从【完整树】收集：它们按字段名操作 suffix，
    // 从过滤后的树收集会让「只在详情出现」的字段在详情态拿不到合计与大写
    amountDisplayFields.value = collectAmountDisplayFields(allRules.value)
    subTables.value = collectSubTables(allRules.value)
    logicRules.value = parseLogicRules(data.logicRules)
    extensionMode.value = data.extensionMode ?? 1
    submitTimeoutAction.value = data.submitHookTimeoutAction ?? 1
    formScripts.value = parseScripts(data.formScript)

    // 纯表单模式没有弹窗、不走 openForm，LOAD 时机改由 fApi 就绪时触发（见下面的 watch）。
    // 漏掉它的表现是「纯表单上联动完全不生效」，而表单+列表模式又是好的 ——
    // 这种「只有一种表单类型出问题」的差异极难被发现
    standalonePending.value = data.formType === 1

    // 解析列表配置
    if (data.formType === 2 && data.listConf) {
      parseListConf(data.listConf)
      // 树节点与列表并行加载，树失败不该阻塞列表
      await Promise.all([loadTreeNodes(), loadList()])
    }
  } catch (e) {
    console.error('加载渲染配置失败', e)
    config.value = undefined
  } finally {
    loading.value = false
  }
}

/**
 * 解析联动规则
 *
 * 解析失败返回空数组：规则可能是旧版本写的或被手工改过，
 * 让整张表单打不开的代价远大于少生效一批联动。服务端提交时照样会拦。
 */
const parseLogicRules = (raw: string | undefined): LogicRule[] => {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch (e) {
    console.warn('[FormRender] 联动规则解析失败，本次将不做前端联动', e)
    return []
  }
}

/**
 * 解析前端脚本
 *
 * 解析失败返回空对象：一段坏掉的脚本配置不该让整张表单打不开。
 */
const parseScripts = (raw: string | undefined): Record<string, string> => {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (e) {
    console.warn('[FormRender] 前端脚本解析失败，本次不执行任何脚本', e)
    return {}
  }
}

/** 解析 list_conf。解析失败时降级为空配置而不是让整页崩掉 */
const parseListConf = (listConf: string) => {
  try {
    const conf = JSON.parse(listConf)
    designColumns.value = Array.isArray(conf.columns) ? conf.columns : []
    columnSetting.value = conf.columnSetting
    reloadColumnPrefs()
    searchItems.value = Array.isArray(conf.searchItems) ? conf.searchItems : []
    pagination.value = conf.pagination?.enabled !== false
    if (conf.pagination?.pageSize) {
      queryParams.pageSize = conf.pagination.pageSize
    }
    defaultSort.value = conf.defaultSort
    const storedOperation = conf.operationColumn || {}
    operationColumn.value = {
      show: storedOperation.show !== false,
      label: storedOperation.label || '操作',
      width: storedOperation.width || 160,
      // 存量配置里没有这个键 —— 回落到默认阈值而不是「不折叠」，
      // 折叠只是把多出来的按钮换个位置，不会让任何按钮消失
      maxInline: normalizeMaxInline(storedOperation.maxInline),
      buttons: storedOperation.buttons ?? ['edit', 'detail', 'delete']
    }
    exportMaxRows.value =
      typeof conf.exportMaxRows === 'number' && conf.exportMaxRows > 0
        ? conf.exportMaxRows
        : DEFAULT_EXPORT_MAX_ROWS
    showSummary.value = conf.showSummary || false
    summaryColumns.value = conf.summaryColumns || []
    // 存量表单的配置里没有这个键，缺省按「显示」——序号是列表的默认预期，
    // 不显示才是需要特意配的那一边
    showIndexColumn.value = conf.showIndexColumn !== false
    formViewMode.value = parseFormViewMode(conf.formViewMode)
    tabConfig.value = conf.tabConfig
    activeTab.value = '__all__'
    treeConfig.value = conf.treeConfig
    // 树形与分页互斥。设计器已强制，这里兜底防止手工改过的配置把两者都打开
    if (treeConfig.value?.enabled) {
      pagination.value = false
    }
    leftTree.value = conf.leftTree
    currentTreeKey.value = ''
    currentTreeValues.value = []
    complexHeaders.value = Array.isArray(conf.complexHeaders) ? conf.complexHeaders : []
    inlineEdit.value = conf.inlineEdit
    rowGroup.value = conf.rowGroup
    collapsedGroupKeys.value = new Set()
    cancelInlineEdit()
  } catch (e) {
    console.warn('list_conf 解析失败，降级为空列表配置', e)
    designColumns.value = []
    columnSetting.value = undefined
    columnPrefs.value = []
    searchItems.value = []
    defaultSort.value = undefined
    showSummary.value = false
    summaryColumns.value = []
    exportMaxRows.value = DEFAULT_EXPORT_MAX_ROWS
    showIndexColumn.value = true
    formViewMode.value = 'DIALOG'
    tabConfig.value = undefined
    treeConfig.value = undefined
    leftTree.value = undefined
    complexHeaders.value = []
    inlineEdit.value = undefined
    rowGroup.value = undefined
    collapsedGroupKeys.value = new Set()
    cancelInlineEdit()
  }
}

const loadList = async () => {
  if (!config.value) return
  listLoading.value = true
  try {
    const conditions = buildConditions()
    // 排序：用户手动排序优先，否则用默认排序
    const sort = currentSort.value || defaultSort.value
    // 树形模式要一次拿全量才能建树，但后端有 200 条硬上限（MAX_PAGE_SIZE）
    const isTree = treeConfig.value?.enabled && treeConfig.value.parentField
    const data = await RuntimeApi.getDataPage(formCode.value, {
      pageNo: isTree ? 1 : queryParams.pageNo,
      pageSize: isTree ? TREE_MODE_PAGE_SIZE : queryParams.pageSize,
      conditions,
      sortField: sort?.field,
      sortOrder: sort?.order
    })
    list.value = data.list ?? []
    total.value = data.total ?? 0
    // 数据被上限截断时必须告知用户 —— 树里静默少几个节点比报错更难排查
    if (isTree && total.value > TREE_MODE_PAGE_SIZE) {
      message.warning(
        `树形列表单次最多加载 ${TREE_MODE_PAGE_SIZE} 条，当前共 ${total.value} 条，` +
          `未加载的行及其子节点不会显示。请用查询条件缩小范围。`
      )
    }
  } finally {
    listLoading.value = false
  }
}

/**
 * 查询值算不算「没填」
 *
 * ⚠️ 数字 0 与布尔 false 都是有效的查询值，不能当空处理 ——
 * 否则「数量等于 0」这个条件会被悄悄丢掉，列表返回全量数据，
 * 用户看到的是「筛选没生效」。多选下拉的空数组才是真的没填。
 */
const isBlankSearchValue = (value: any): boolean => {
  if (value === undefined || value === null || value === '') return true
  return Array.isArray(value) && value.length === 0
}

/**
 * 把搜索框的值转成结构化查询条件
 *
 * 遍历完整的 searchItems 而不是 visibleSearchItems ——
 * 折叠只影响显示，已经填过的条件不能因为收起就失效。
 */
const buildConditions = (): RuntimeApi.RuntimeConditionVO[] => {
  const conditions: RuntimeApi.RuntimeConditionVO[] = []
  searchItems.value.forEach((item, index) => {
    // 为空 / 不为空：条件本身就是全部信息，不取值
    if (isValuelessOperator(item.operator)) {
      conditions.push({ field: item.field, operator: item.operator })
      return
    }

    if (item.widget === 'DATE_RANGE') {
      // el-date-picker 的区间是一个二元数组，清空时是 null
      const range = searchValues.value[rangeKey(index)]
      if (!Array.isArray(range) || range.length !== 2) return
      const [start, end] = range
      if (!start && !end) return
      conditions.push({ field: item.field, operator: 'BETWEEN', value: start, value2: end })
      return
    }

    if (item.operator === 'BETWEEN') {
      // 文本区间与数字区间：两个独立输入框。
      // 后端 QueryCondition 用 value / value2 两个字段接区间，不是数组
      const startValue = searchValues.value[startKey(index)]
      const endValue = searchValues.value[endKey(index)]
      if (isBlankSearchValue(startValue) && isBlankSearchValue(endValue)) return
      conditions.push({
        field: item.field,
        operator: 'BETWEEN',
        value: startValue,
        value2: endValue
      })
      return
    }

    const value = searchValues.value[valueKey(index)]
    if (isBlankSearchValue(value)) return
    conditions.push({
      field: item.field,
      operator: item.operator || 'LIKE',
      value
    })
  })

  // 标签页筛选：选中非「全部」时追加一个等值条件
  if (tabConfig.value?.enabled && tabConfig.value.field && activeTab.value !== '__all__') {
    conditions.push({
      field: tabConfig.value.field,
      operator: 'EQ',
      value: activeTab.value
    })
  }

  // 左侧树筛选：选中非「全部」节点时追加等值条件
  // 左侧树筛选：选中非「全部」节点时追加条件。
  // 点父节点时要连它的后代一起匹配 —— 只按父节点自身的值筛，
  // 挂在子节点上的数据一条都不会出现
  if (leftTree.value?.enabled && leftTree.value.field && currentTreeValues.value.length > 0) {
    const values = currentTreeValues.value
    conditions.push(
      values.length === 1
        ? { field: leftTree.value.field, operator: 'EQ', value: values[0] }
        : { field: leftTree.value.field, operator: 'IN', value: values }
    )
  }
  return conditions
}

const handleQuery = () => {
  queryParams.pageNo = 1
  loadList()
}

const resetQuery = () => {
  searchValues.value = {}
  // 标签页也归位到「全部」，否则用户点了重置却发现列表还被标签筛着
  activeTab.value = '__all__'
  // 左侧树同理
  currentTreeKey.value = ''
  currentTreeValues.value = []
  handleQuery()
}


const openForm = async (type: 'create' | 'update' | 'detail', row?: any) => {
  dialogType.value = type
  // 场景可能变了（详情态与新增态的字段集不同），重算规则树
  applyScene()
  currentPk.value = undefined

  //
  // ⚠️ 这一趟要填进表单的值，攒在**局部变量**里，不要边算边写 formValues
  //
  // formValues 是 form-create 的 v-model，双向的：往它写一个空对象之后，
  // 表单里还留着上一条记录的值，内核会把那份值同步回来 ——
  // 等走到下面真正 setValue 的地方，formValues 已经又变回上一条记录了。
  // 这正是「先点编辑、再点新增，新增页带着刚才那条记录的全部内容」的成因，
  // 而且因为值确实在表单里，看起来完全像是「新增页就该长这样」。
  //
  let nextValues: Record<string, any> = {}

  if (type !== 'create' && row) {
    const pkField = config.value?.pkField ?? 'id'
    currentPk.value = row[pkField]
    // 重新拉详情：列表返回的字段可能不全，且需要子表明细
    const detail = await RuntimeApi.getData(formCode.value, currentPk.value!)
    // 上传字段收敛回 URL 形态。⚠️ 库里存的是 [{name,url,size,type}]（服务端提交时补的），
    // 而共享的三个上传组件只认 URL 字符串 —— 不收敛的话附件列表整个渲染不出来。
    // 做成运行时的值变换而不是同名组件顶替全局注册：后者等于改了那 80 个调用方
    nextValues = collapseUploadValues(detail, allRules.value)
    // 多值字段在库里是 NULL 时读回来就是 null，而穿梭框这类控件会在
    // null.includes(...) 上崩掉 —— 异常发生在渲染期，后果是整个弹窗打不开。
    // 新增态碰不到（那时走控件默认值），所以表现成「新增好用、编辑就坏」
    nextValues = normalizeArrayValues(nextValues, allRules.value)
    // 乐观锁：把版本号单独存一份。
    // ⚠️ 不能指望它跟着表单值走 —— 版本列不是表单字段，setValue 会忽略它，
    // 提交时 fApi.formData() 里也没有它。丢了版本号服务端会直接拒绝提交
    currentVersion.value = versionField.value ? detail?.[versionField.value] : undefined
  }
  if (type === 'create') {
    // 出厂默认值打底，再盖上相对日期这类运行时算出来的默认值。
    // pristineDefaults 是规则树刚解码出来时抓的那一份，不会被上一条记录污染
    nextValues = { ...pristineDefaults.value, ...applyRelativeDefaults() }
  }
  formValues.value = nextValues
  // 详情页配了变更记录页签时，顺手把时间线拉出来。
  // ⚠️ 放在这里而不是「切到那个页签时才拉」：el-tab-pane 默认是懒渲染的，
  // 但内容为空与「还没拉」在界面上长得一样（都是空白），
  // 用户会以为这条数据没被改过
  activeDetailTab.value = '__form__'
  if (type === 'detail' && detailTabs.value.some((tab) => tab.type === 'CHANGE_LOG')) {
    changeLogs.value = await RuntimeApi.getDataChangeLogs(formCode.value, currentPk.value!)
  }
  if (type === 'detail') {
    await loadRelationTabs()
  }
  dialogVisible.value = true
  await nextTick()
  //
  // ⚠️ 不能只 setValue
  //
  // setValue 只写入传进去的那些键，没提到的字段会**原封不动留在表单里** ——
  // 而三种模式共用同一个 form-create 实例。于是「先点编辑、再点新增」时，
  // 新增页带着上一条记录的全部内容；「先编辑、再点详情」同理。
  //
  // 新增与编辑要分开处理，两者对「没有值的字段」的期望不一样：
  // - 新增：回到控件的出厂默认值（见 pristineDefaults）
  // - 编辑/详情：严格等于这条记录（不在数据里的字段一并清空）
  //
  // ⚠️ 这里不能用 form-create 自己的 resetFields：它恢复的是 ctx.defaultValue，
  // 而 ctx 在规则树被重建时（场景过滤、折叠分组都会重建）是按**当时**的
  // rule.value 重新捕获的 —— 也就是上一条记录的值，等于没恢复。
  //
  // 写进去的是上面攒的 nextValues，不是 formValues.value：后者是 v-model，
  // 这会儿可能已经被内核用表单里的旧值同步回去了（理由见函数开头）。
  //
  // 清校验状态也要做：上一次没填必填项留下的红字会跟到这一次
  fApi.value?.coverValue?.(nextValues)
  fApi.value?.clearValidateState?.()
  // coverValue 之后把 formValues 对齐到同一份，免得下面几个消费者
  //（金额大写、子表合计、联动）读到的是被同步回来的旧值
  formValues.value = { ...nextValues }
  // 接口入参绑了表单字段的下拉，要带着当前值再取一次选项。
  // ⚠️ 加载表单那一次是没有表单值的，绑了字段的入参在那时一律为空 ——
  // 不补这一下，那些下拉从头到尾一个选项都没有（详情态还会因此显示成空白）
  await remoteOptionRuntime.value?.resolveDependent()
  refreshChineseAmount(formValues.value)
  refreshSubTableSummary()
  // 联动的 LOAD 时机：必须在 setValue 之后 —— 规则要基于表单的真实数据求值，
  // 在数据填进去之前跑，条件读到的全是空值
  logicRuntime.runOnLoad()
  // 脚本的 onLoad 排在联动之后：脚本看到的应当是联动算完之后的表单状态，
  // 否则它刚设好的显隐会被紧接着跑的联动覆盖掉
  scriptRuntime.runOnLoad()
}

/**
 * 数据接口选项的运行时重取
 *
 * 见 remoteOptionRuntime.ts：设计器支持把接口入参绑到表单字段，
 * 但运行时只在加载时解析过一次、且没带表单值 —— 绑了字段的入参永远是空的。
 */
const remoteOptionRuntime = ref<ReturnType<typeof createRemoteOptionRuntime>>()

/**
 * 依赖字段变了就重取选项，并清掉被重取字段的已选值
 *
 * ⚠️ 清值只在这里做，不在 resolveDependent 里做：
 * 打开一条已有记录时也会重取一次，那次是为了把已保存值对应的选项加载出来，
 * 清掉等于一打开详情就把人员字段抹了。
 */
watch(
  () => {
    const fields = remoteOptionRuntime.value?.dependentFields ?? []
    if (fields.length === 0) return ''
    // 拼成字符串而不是数组：watch 对数组要开 deep 才比得出来，
    // 而这里只关心「值有没有变」
    return fields.map((field) => `${field}=${formValues.value?.[field] ?? ''}`).join('&')
  },
  async (now, before) => {
    if (!remoteOptionRuntime.value || before === undefined || now === before) return
    const changed = diffDependentFields(before, now)
    if (changed.length === 0) return
    const refreshed = await remoteOptionRuntime.value.refreshByFields(changed)
    // 换了部门，原来选的那个人多半不在新部门里。留着会存进一条
    // 「部门是市场部、人员是研发部某人」的数据，而且不报错
    refreshed.forEach((field) => fApi.value?.setValue?.({ [field]: undefined }))
  }
)

/** 从两次拼接结果里找出值变了的字段 */
const diffDependentFields = (before: string, now: string): string[] => {
  const parse = (raw: string) =>
    new Map(raw.split('&').filter(Boolean).map((pair) => {
      const index = pair.indexOf('=')
      return [pair.slice(0, index), pair.slice(index + 1)] as [string, string]
    }))
  const previous = parse(before)
  const changed: string[] = []
  parse(now).forEach((value, field) => {
    if (previous.get(field) !== value) changed.push(field)
  })
  return changed
}

const handleSubmit = async () => {
  try {
    await fApi.value?.validate?.()
  } catch {
    return
  }
  const values = fApi.value?.formData?.() ?? formValues.value
  if (!checkCrossFieldRules(values)) return
  if (!checkSubTableRules(values)) return
  // 脚本的 beforeSubmit 排在最后一道前端校验之后：让它看到的是已经通过
  // 格式与跨字段校验的数据。返回 false / reject / 超时（按表单属性）都阻断提交
  if (!(await scriptRuntime.runBeforeSubmit())) return
  submitLoading.value = true
  try {
    if (dialogType.value === 'create') {
      await RuntimeApi.createData(formCode.value, values)
      message.success('新增成功')
    } else {
      // 带上版本号：它不是表单字段，要单独并进提交数据。
      // 服务端用它作为更新条件，别人在此期间改过就会被拦下（而不是静默覆盖）
      const payload =
        versionField.value && currentVersion.value !== undefined
          ? { ...values, [versionField.value]: currentVersion.value }
          : values
      await RuntimeApi.updateData(formCode.value, currentPk.value!, payload)
      message.success('修改成功')
    }
    // afterSubmit 只在真的写库成功之后跑。放在 try 外面或 finally 里，
    // 会让提交失败时也执行「提交成功」的提示脚本
    scriptRuntime.runAfterSubmit()
    dialogVisible.value = false
    await loadList()
  } finally {
    submitLoading.value = false
  }
}

/** 纯表单模式的提交 */
const handleSubmitStandalone = async () => {
  try {
    await fApi.value?.validate?.()
  } catch {
    return
  }
  const values = fApi.value?.formData?.() ?? formValues.value
  if (!checkCrossFieldRules(values)) return
  if (!checkSubTableRules(values)) return
  if (!(await scriptRuntime.runBeforeSubmit())) return
  submitLoading.value = true
  try {
    await RuntimeApi.createData(formCode.value, values)
    message.success('提交成功')
    scriptRuntime.runAfterSubmit()
    resetStandalone()
  } finally {
    submitLoading.value = false
  }
}

const resetStandalone = () => {
  formValues.value = {}
  fApi.value?.resetFields?.()
}

const handleDelete = async (row: any) => {
  try {
    await message.delConfirm()
    const pkField = config.value?.pkField ?? 'id'
    await RuntimeApi.deleteData(formCode.value, row[pkField])
    message.success('删除成功')
    await loadList()
  } catch {}
}

/** 导入数据 */
const importDialogRef = ref()

const handleImport = () => {
  importDialogRef.value?.open(formCode.value, config.value?.name || formCode.value)
}

/**
 * 导入完成
 *
 * 无条件刷新列表，不管导了几条 —— 用户刚在向导里看到「成功 95 条」，
 * 关掉弹窗却发现列表还是老样子，会以为没真的导进去。
 */
const handleImportSuccess = async () => {
  queryParams.pageNo = 1
  await loadList()
}

/** 导出设置弹窗。真正的下载在它里面做 */
const exportDialogRef = ref()

/**
 * 导出
 *
 * 不直接下载，而是先开一个设置弹窗 —— 范围（当前页 / 全部）与合计行
 * 这两件事同一张列表的不同次导出可能不同，得让用户选。
 *
 * 列、顺序、格式一概不在弹窗里 —— 它们由列表本身决定（所见即所得）。
 */
const handleExport = () => {
  const visibleKeys = columns.value.map((col) => columnKeyOf(col))
  exportDialogRef.value?.open({
    code: formCode.value,
    name: config.value?.name || formCode.value,
    pageNo: queryParams.pageNo,
    pageSize: queryParams.pageSize,
    total: total.value,
    maxRows: exportMaxRows.value,
    columnCount: visibleKeys.length,
    // 设计期有多少列、现在显示多少列，差额就是用户自己隐藏掉的
    hiddenCount: Math.max(designColumns.value.length - visibleKeys.length, 0),
    hasSummary: showSummary.value && summaryColumns.value.length > 0,
    buildRequest: () => {
      const sort = currentSort.value || defaultSort.value
      return {
        conditions: buildConditions(),
        sortField: sort?.field,
        sortOrder: sort?.order,
        // ⚠️ 传当前【真正渲染出来的】列，而不是设计期的列 ——
        // 用户在列设置里隐藏掉的列不该出现在导出文件里
        visibleFields: visibleKeys
      }
    }
  })
}


onMounted(() => {
  loadConfig()
})
</script>

<style lang="scss" scoped>
/*
  列表的行高与表头

  向租户管理那一类管理列表页看齐。默认状态下这张表是最密的一档
  （ContentWrap 给所有列表页定了单元格 4px 内边距，行高只有 32px），
  而它的单元格里装的是标签、缩略图、附件链接这些比纯文本更高的东西，
  挤在一起时一行的上下几乎贴着边框。

  ⚠️ 选择器要压过 ContentWrap

  ContentWrap 那条是 `.content-wrap[data-v-x] .el-table--default .el-table__cell`，
  权重 (0,4,0)。写成 `.runtime-table :deep(.el-table__cell)` 只有 (0,3,0)，
  会被它整条盖掉、一点效果都没有。重复一次类名抬到 (0,5,0)，
  比 !important 更容易在 DevTools 里看明白是谁盖了谁。

  只改本模块、不动 ContentWrap：那条规则作用于系统里每一个列表页。
*/
.runtime-table.runtime-table.el-table--default :deep(.el-table__cell) {
  padding-top: 12px;
  padding-bottom: 12px;
}

.runtime-table :deep(.el-table__header-wrapper th) {
  font-weight: 600;
  color: var(--el-text-color-primary);
  background-color: var(--el-fill-color-light);
}

/* 合计行与数据区拉开，否则最后一行数据看起来像是合计的一部分 */
.runtime-table :deep(.el-table__footer-wrapper td) {
  font-weight: 600;
  background-color: var(--el-fill-color-light);
}

/* 操作列里的 link 按钮连成一串时很难点准，拉开一点 */
.runtime-table :deep(.el-table__body .el-button + .el-button),
.runtime-table :deep(.el-table__body .el-button + .el-dropdown) {
  margin-left: 10px;
}

/*
  分组行

  给一个底色，好让它与数据行一眼分得开 —— 不给的话，分组行看起来就是
  「一条只有第一列有字的记录」。

  ⚠️ hover 态要跟着盖掉：el-table 的行悬浮色优先级更高，不盖的话
  鼠标划过分组行时它会变成和数据行一样的颜色，看起来像是能点进详情。
*/
.runtime-table :deep(.el-table__body tr.grid-group-tr > td),
.runtime-table :deep(.el-table__body tr.grid-group-tr:hover > td) {
  background-color: var(--el-fill-color);
}

.change-log-item {
  font-size: 13px;
  line-height: 22px;
}

.change-log-operator {
  margin-bottom: 2px;
  font-weight: 600;
}

.change-log-field {
  margin-right: 6px;
  color: var(--el-text-color-secondary);
}

.change-log-old {
  color: var(--el-text-color-secondary);
  text-decoration: line-through;
}

.change-log-arrow {
  margin: 0 6px;
  color: var(--el-text-color-placeholder);
}

.change-log-new {
  color: var(--el-color-primary);
}

/*
 * 金额大写与子表合计
 *
 * 用 :deep —— 这两块是通过 form-create 规则的 suffix 渲染的，
 * 不在本组件的模板里，scoped 的属性选择器加不到它们身上。
 */
:deep(.form-chinese-amount) {
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}

:deep(.form-subtable-summary) {
  padding: 6px 12px;
  margin-top: 4px;
  font-size: 13px;
  color: var(--el-text-color-regular);
  text-align: right;
  background: var(--el-fill-color-light);
  border-radius: 4px;
}

/* 左侧树 + 列表的分栏布局 */
.list-with-tree {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}

.left-tree-panel {
  flex: 0 0 220px;
  /* 树很长时自己滚动，不把列表推下去 */
  max-height: calc(100vh - 200px);
  overflow-y: auto;
}

.left-tree-title {
  margin-bottom: 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
</style>
