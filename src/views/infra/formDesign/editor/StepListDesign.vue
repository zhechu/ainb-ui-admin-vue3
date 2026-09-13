<template>
  <div ref="rootRef" class="step-list-design">
    <!--
      左侧配置区 + 右侧字段面板

      原先「添加列」是个弹窗：点开 → 在三列排布的复选框里找字段 → 确定 → 关闭，
      漏选一个就得把这四步再走一遍。字段名一长，三列的格子还会把名字截断，
      两个只差后缀的字段看起来一模一样。
      改成常驻的右侧面板之后，勾选即生效、取消即移除，不必反复开关弹窗。
    -->
    <div class="main-board">
      <el-tabs v-model="activeTab">
        <!-- 列配置 -->
        <el-tab-pane label="列配置" name="columns">
          <el-form class="mb-10px" inline label-width="100px">
            <el-form-item label="显示序号">
              <el-switch v-model="showIndexColumn" />
            </el-form-item>
            <el-form-item label="显示合计行">
              <el-switch v-model="showSummary" />
            </el-form-item>
            <el-form-item v-if="showSummary" label="合计列">
              <div class="summary-picker">
                <!--
                  ⚠️ 宽度必须写死

                  el-select 的默认宽度是 100%，而 inline 表单的 form-item 是
                  inline-flex —— 容器宽度由内容决定、内容宽度又取自容器，
                  这个循环的解是「塌到最小」。表现正是这个多选框被压成一条窄缝，
                  选进去两个列就只剩「+1」，看不出自己选了什么
                -->
                <el-select
                  v-model="summaryColumns"
                  class="!w-420px"
                  collapse-tags
                  collapse-tags-tooltip
                  :max-collapse-tags="3"
                  multiple
                  placeholder="选择需要合计的列"
                >
                  <el-option
                    v-for="col in summarizableColumns"
                    :key="columnKey(col)"
                    :label="col.label || col.field"
                    :value="columnKey(col)"
                  />
                </el-select>
                <div v-if="nonNumericSummaryLabels.length > 0" class="form-tip">
                  <strong>{{ nonNumericSummaryLabels.join('、') }}</strong>
                  看起来不是数值列，合计行会显示为「-」。
                </div>
              </div>
            </el-form-item>
          </el-form>

          <el-empty
            v-if="columns.length === 0"
            :image-size="60"
            description="还没有列。在右侧面板里勾选要显示的字段。"
          />
          <!--
            列很多时表格自己滚，不让整页跟着长

            列配置一张表能有几十行，页面级滚动会把上面那排开关与右侧字段面板
            一起滚出可视区 —— 用户勾一个字段就得往上翻一次。
            给表格一个高度上限，表头钉住，右侧面板也不再被拉长。
          -->
          <el-table
            v-else
            :key="columnTableKey"
            ref="columnTableRef"
            class="config-table"
            :data="columns"
            border
            :max-height="tableMaxHeight"
          >
            <el-table-column label="" width="46">
              <template #default>
                <span class="col-drag-handle" title="拖动调整列顺序">
                  <Icon icon="ep:rank" />
                </span>
              </template>
            </el-table-column>
            <!--
              字段改成只读展示：加哪些列由右侧面板决定，这里再放一个下拉
              等于同一件事有两个入口，而两处的「唯一标识」规则还不一样
              （面板按复合 key，下拉当初按裸 field），很容易配出指向不存在字段的列
            -->
            <el-table-column label="字段" min-width="180" show-overflow-tooltip>
              <template #default="{ row }">
                <span v-if="fieldTitleOf(columnKey(row))" class="field-name">
                  {{ fieldTitleOf(columnKey(row)) }}
                </span>
                <el-tag v-else size="small" type="danger">字段已不存在</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="列标题" width="160">
              <template #default="{ row }">
                <el-input v-model="row.label" placeholder="列标题" />
              </template>
            </el-table-column>
            <el-table-column label="宽度类型" width="130">
              <template #default="{ row }">
                <el-select v-model="row.widthType" size="small">
                  <el-option label="最小宽度" value="min" />
                  <el-option label="固定宽度" value="fixed" />
                </el-select>
              </template>
            </el-table-column>
            <el-table-column label="宽度" width="110">
              <template #default="{ row }">
                <el-input-number
                  v-model="row.width"
                  :min="80"
                  :step="10"
                  controls-position="right"
                  size="small"
                />
              </template>
            </el-table-column>
            <el-table-column label="对齐" width="120">
              <template #default="{ row }">
                <el-select v-model="row.align" size="small">
                  <el-option label="左对齐" value="left" />
                  <el-option label="居中" value="center" />
                  <el-option label="右对齐" value="right" />
                </el-select>
              </template>
            </el-table-column>
            <el-table-column label="固定" width="120">
              <template #default="{ row }">
                <el-select v-model="row.fixed" size="small">
                  <el-option label="不固定" :value="false" />
                  <el-option label="左固定" value="left" />
                  <el-option label="右固定" value="right" />
                </el-select>
              </template>
            </el-table-column>
            <!--
              格式化：按钮上印的是格式化方式的【名称】而不是内部枚举值

              原先印的是 `row.formatter.type`，也就是 DICT / DATETIME / PERCENT
              这些内部标识。配置的人认的是「字典翻译」「百分比」——
              让他对着一串英文大写去回想自己配的是什么，是把枚举值泄露到了界面上。
            -->
            <el-table-column label="格式化" width="130">
              <template #default="{ row }">
                <el-button link size="small" type="primary" @click="openFormatterDialog(row)">
                  {{ formatterLabel(row.formatter) }}
                </el-button>
              </template>
            </el-table-column>
            <el-table-column label="可排序" width="80">
              <template #default="{ row }">
                <el-switch v-model="row.sortable" size="small" />
              </template>
            </el-table-column>
            <!--
              同值合并。只在「合并模式可用」时出现 ——
              树形、明细展开、行内编辑下这一列是死的，摆在那里只会让人反复去点。
            -->
            <el-table-column v-if="mergeSameAvailable" label="同值合并" width="96">
              <template #default="{ row }">
                <el-tooltip
                  :content="mergeSameDisabledReason(row)"
                  :disabled="!mergeSameDisabledReason(row)"
                  placement="top"
                >
                  <span>
                    <el-switch
                      v-model="row.mergeSame"
                      :disabled="!!mergeSameDisabledReason(row)"
                      size="small"
                    />
                  </span>
                </el-tooltip>
              </template>
            </el-table-column>
            <el-table-column v-if="inlineEdit.enabled" label="可编辑" width="80">
              <template #default="{ row }">
                <el-switch
                  v-model="row.inlineEditable"
                  :disabled="!isInlineEditable(row)"
                  size="small"
                />
              </template>
            </el-table-column>
            <el-table-column label="操作" width="80">
              <template #default="{ $index }">
                <el-button link type="danger" @click="columns.splice($index, 1)">移除</el-button>
              </template>
            </el-table-column>
          </el-table>
          <div v-if="columns.length > 0" class="form-tip">
            列的显示顺序就是这张表的行序，拖左侧的把手可以调整。
          </div>
          <!--
            同值合并的两条提示都必须给，它们对应两种「配了但看起来没生效」：
            一是没排序导致同值不相邻，二是合并顺序取自列顺序而不是勾选顺序。
          -->
          <div v-if="mergeSameColumnLabels.length > 0" class="form-tip">
            已开启同值合并：<strong>{{ mergeSameColumnLabels.join(' → ') }}</strong
            >。合并按这个顺序级联 —— 前一列换值时后一列也重新开始合并，
            顺序就是上面这张表的行序。
          </div>
          <div v-if="mergeSameColumnLabels.length > 0 && !defaultSort.field" class="form-tip">
            ⚠️ 合并的是<strong>相邻</strong>的同值单元格，而现在没有配默认排序。
            同值的行不挨在一起时一格都合并不了，看起来像没生效 ——
            请到「分页设置」里配上排序字段。
          </div>
        </el-tab-pane>

        <!-- 查询条件 -->
        <el-tab-pane label="查询条件" name="search">
          <el-empty
            v-if="searchItems.length === 0"
            :image-size="60"
            description="还没有查询条件。在右侧面板里勾选要用来查询的字段。"
          />
          <!-- 与列配置同样让表格自己滚，理由见那边的说明 -->
          <el-table
            v-else
            :key="searchTableKey"
            ref="searchTableRef"
            class="config-table"
            :data="searchItems"
            border
            :max-height="tableMaxHeight"
          >
            <!-- 与列配置对齐：查询区的字段顺序也是拖出来的 -->
            <el-table-column label="" width="46">
              <template #default>
                <span class="col-drag-handle" title="拖动调整查询项顺序">
                  <Icon icon="ep:rank" />
                </span>
              </template>
            </el-table-column>
            <el-table-column label="字段" min-width="170" show-overflow-tooltip>
              <template #default="{ row }">
                <span v-if="fieldTitleOf(row.field)" class="field-name">
                  {{ fieldTitleOf(row.field) }}
                </span>
                <el-tag v-else size="small" type="danger">字段已不存在</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="查询标签" width="150">
              <template #default="{ row }">
                <el-input v-model="row.label" placeholder="查询标签" />
              </template>
            </el-table-column>
            <el-table-column label="查询控件" width="140">
              <template #default="{ row }">
                <el-select
                  v-model="row.widget"
                  size="small"
                  @change="(val) => handleSearchWidgetChange(val, row)"
                >
                  <el-option
                    v-for="w in SEARCH_WIDGETS"
                    :key="w.value"
                    :label="w.label"
                    :value="w.value"
                  />
                </el-select>
              </template>
            </el-table-column>
            <!--
              字典类型：树形选择 + 显示字典名称

              字典类型本身是树形的（分组节点只用来归拢、挂不了字典数据），
              用平铺下拉展示时「订单状态」会与它的分组节点并排成兄弟；
              而下拉里印的又是 system_xxx 这样的编码 ——
              配置的人认的是「订单状态」，让他对着拼音缩写去猜是把内部标识
              泄露到了界面上。两件事一起由 DictTypeSelect 解决。
            -->
            <el-table-column label="字典类型" width="230">
              <template #default="{ row }">
                <DictTypeSelect
                  v-if="row.widget === 'SELECT'"
                  v-model="row.dictType"
                  placeholder="选择数据字典"
                  size="small"
                />
                <span v-else class="text-12px text-gray-400">—</span>
              </template>
            </el-table-column>
            <el-table-column label="操作符" width="140">
              <template #default="{ row }">
                <el-select
                  v-model="row.operator"
                  :disabled="isRangeWidget(row.widget)"
                  size="small"
                >
                  <el-option
                    v-for="op in operatorsFor(row.widget)"
                    :key="op.value"
                    :label="op.label"
                    :value="op.value"
                  />
                </el-select>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="80">
              <template #default="{ $index }">
                <el-button link type="danger" @click="searchItems.splice($index, 1)">
                  移除
                </el-button>
              </template>
            </el-table-column>
          </el-table>
          <div v-if="searchItems.length > 0" class="form-tip">
            查询项的顺序就是查询区的排列顺序，拖左侧把手可以调整。
            查询控件决定渲染成什么：下拉字段渲染成字典下拉、日期字段渲染成日期区间。
            选字段时会自动推断，可以手工改。
          </div>
          <div v-if="searchItemsMissingDict.length > 0" class="form-tip">
            <strong>{{ searchItemsMissingDict.join('、') }}</strong>
            选了下拉查询但没配字典类型，查询区会退化成文本框。
          </div>
        </el-tab-pane>

        <!-- 分页设置 -->
        <el-tab-pane label="分页设置" name="pagination">
        <el-form class="config-form" label-width="120px">
          <el-form-item label="启用分页">
            <el-switch v-model="pagination.enabled" @change="handlePaginationToggle" />
            <div v-if="treeConfig.enabled" class="form-tip">
              树形列表已开启，分页不可用。要用分页请先关闭树形。
            </div>
          </el-form-item>
          <el-form-item v-if="pagination.enabled" label="每页条数">
            <el-input-number v-model="pagination.pageSize" :min="5" :max="100" :step="5" />
          </el-form-item>

          <el-divider content-position="left">默认排序</el-divider>

          <el-form-item label="排序字段">
            <el-select v-model="defaultSort.field" clearable filterable placeholder="选择排序字段">
              <el-option v-for="f in mainFields" :key="f.key" :label="f.title" :value="f.field" />
            </el-select>
          </el-form-item>
          <el-form-item v-if="defaultSort.field" label="排序方向">
            <el-radio-group v-model="defaultSort.order">
              <el-radio value="asc">升序</el-radio>
              <el-radio value="desc">降序</el-radio>
            </el-radio-group>
          </el-form-item>
        </el-form>
      </el-tab-pane>

      <!-- 操作列与按钮 -->
      <el-tab-pane label="按钮设置" name="operation">
        <el-form class="config-form" label-width="120px">
          <el-form-item label="显示操作列">
            <el-switch v-model="operationColumn.show" />
            <div class="form-tip">关掉之后行内按钮整列不显示，工具栏按钮不受影响。</div>
          </el-form-item>
          <template v-if="operationColumn.show">
            <el-form-item label="操作列标题">
              <el-input v-model="operationColumn.label" placeholder="默认为「操作」" />
            </el-form-item>
            <el-form-item label="操作列宽度">
              <el-input-number v-model="operationColumn.width" :min="80" :max="400" :step="10" />
            </el-form-item>
            <!--
              行内按钮太多时折叠成下拉

              行按钮一排开就会把操作列撑得很宽，而操作列是 fixed="right" 的 ——
              它挤掉的是数据列的可视宽度。配上「编辑/详情/变更记录/打印/删除」
              再加两个自定义按钮，一行七个按钮，表格能看的部分只剩一半。
              超出的收进「更多」下拉里，最常用的那几个仍然一眼可点。
            -->
            <el-form-item label="按钮折叠阈值">
              <div class="w-full">
                <el-input-number
                  v-model="operationColumn.maxInline"
                  :min="1"
                  :max="10"
                  :step="1"
                />
                <div class="form-tip">
                  行内按钮超过这个数量时，多出来的收进「更多」下拉。
                  <template v-if="inlineOverflowPreview">
                    当前配置下会直接显示
                    <strong>{{ inlineOverflowPreview.shown.join('、') }}</strong>
                    ，把
                    <strong>{{ inlineOverflowPreview.folded.join('、') }}</strong>
                    收进下拉。
                  </template>
                  <template v-else> 当前配置下的行内按钮还没超过阈值，不会出现下拉。 </template>
                </div>
              </div>
            </el-form-item>
          </template>
        </el-form>

        <el-divider content-position="left">按钮清单</el-divider>

        <el-table :key="buttonTableKey" ref="buttonTableRef" :data="buttonList" border size="small">
          <el-table-column label="" width="46">
            <template #default>
              <span class="col-drag-handle" title="拖动调整按钮顺序">
                <Icon icon="ep:rank" />
              </span>
            </template>
          </el-table-column>
          <el-table-column label="位置" width="90">
            <template #default="{ row }">
              {{ positionOf(row.key) === 'toolbar' ? '工具栏' : '行内' }}
            </template>
          </el-table-column>
          <el-table-column label="按钮" width="110">
            <template #default="{ row }">
              {{ builtinOf(row.key)?.label }}
            </template>
          </el-table-column>
          <el-table-column label="显示文案" min-width="160">
            <template #default="{ row }">
              <el-input v-model="row.label" size="small" :placeholder="builtinOf(row.key)?.label" />
            </template>
          </el-table-column>
          <el-table-column label="图标" min-width="150">
            <template #default="{ row }">
              <el-input v-model="row.icon" size="small" placeholder="如 ep:plus，可留空" />
            </template>
          </el-table-column>
          <el-table-column label="显示" width="80">
            <template #default="{ row }">
              <el-switch v-model="row.show" size="small" />
            </template>
          </el-table-column>
        </el-table>

        <div class="form-tip">
          顺序就是按钮的排列顺序，拖左侧把手可以调整。
          <strong>把「删除」放在「编辑」右边能明显降低误点率。</strong>
        </div>
        <div v-if="gatedButtonWarnings.length > 0" class="form-tip">
          <strong>{{ gatedButtonWarnings.join('；') }}</strong>
        </div>
      </el-tab-pane>

      <!-- 自定义按钮 -->
      <el-tab-pane label="自定义按钮" name="buttons">
        <CustomButtonEditor v-model="customButtons" :field-options="conditionFieldOptions" />
      </el-tab-pane>

      <!-- 详情页页签 -->
      <el-tab-pane label="详情页页签" name="detailTabs">
        <DetailTabEditor v-model="detailTabs" :change-log-enabled="changeLogEnabled" />
      </el-tab-pane>

      <!-- 打印模板 -->
      <el-tab-pane label="打印模板" name="print">
        <PrintTemplateEditor
          v-model="printTemplate"
          :fields="mainFields"
          :sub-tables="printSubTables"
        />
      </el-tab-pane>

      <!-- 高级功能 -->
      <el-tab-pane label="高级" name="advanced">
        <el-divider content-position="left">表单呈现方式</el-divider>

        <el-form class="config-form" label-width="120px">
          <el-form-item label="新增/编辑/详情">
            <div class="w-full">
              <el-radio-group v-model="formViewMode">
                <el-radio
                  v-for="mode in FORM_VIEW_MODES"
                  :key="mode.value"
                  :value="mode.value"
                >
                  {{ mode.label }}
                </el-radio>
              </el-radio-group>
              <div class="form-tip">{{ currentViewModeDesc }}</div>
              <!--
                行内编辑把「编辑」按钮接管掉了，这时呈现方式只对新增与详情生效。
                不说的话，用户会以为自己配的页内模式没起作用
              -->
              <div v-if="inlineEdit.enabled" class="form-tip">
                已启用行内编辑，「编辑」会就地改行、不再打开表单，
                这里的设置只影响「新增」与「详情」。
              </div>
            </div>
          </el-form-item>
        </el-form>

        <el-divider content-position="left">行内编辑</el-divider>

        <el-form class="config-form" label-width="120px">
          <el-form-item label="启用行内编辑">
            <el-switch
              v-model="inlineEdit.enabled"
              :disabled="hasSubColumns"
              @change="handleInlineEditToggle"
            />
            <div class="form-tip">
              开启后点「编辑」不再弹窗，而是就地把这一行变成可编辑控件，
              <strong>每行单独保存</strong>。适合「一屏改一批价格」这类场景。
            </div>
            <el-alert
              v-if="hasSubColumns"
              title="已配置明细列，行内编辑不可用：明细列要把一条主记录摊平成多行，改其中一行的主表值没有确定语义。二选一。"
              type="info"
              :closable="false"
              show-icon
              class="mt-8px"
            />
          </el-form-item>
          <el-form-item v-if="inlineEdit.enabled" label="可编辑的列">
            <div class="w-full">
              <div v-if="inlineEditableColumnLabels.length > 0">
                {{ inlineEditableColumnLabels.join('、') }}
              </div>
              <el-alert
                v-else
                title="还没有勾选任何可编辑的列 —— 行内编辑会没有任何效果。请到「列配置」页签里逐列勾选「可编辑」。"
                type="warning"
                :closable="false"
                show-icon
              />
              <div class="form-tip">
                图片、附件、超链接列不支持行内编辑（要专门的编辑器，单元格也放不下）。
              </div>
            </div>
          </el-form-item>
        </el-form>

        <el-divider content-position="left">标签页筛选</el-divider>

        <el-form class="config-form" label-width="120px">
          <el-form-item label="启用标签页">
            <el-switch v-model="tabConfig.enabled" />
            <div class="form-tip"> 按某字段的值生成标签页，切换标签等价于追加一个查询条件。 </div>
          </el-form-item>
          <template v-if="tabConfig.enabled">
            <el-form-item label="筛选字段" required>
              <el-select
                v-model="tabConfig.field"
                clearable
                filterable
                placeholder="选择用于筛选的字段"
              >
                <el-option v-for="f in mainFields" :key="f.key" :label="f.title" :value="f.field" />
              </el-select>
            </el-form-item>
            <el-form-item label="标签项">
              <div class="w-full">
                <el-button plain size="small" type="primary" class="mb-8px" @click="addTab">
                  添加标签
                </el-button>
                <el-table
                  v-if="tabConfig.tabs.length > 0"
                  :data="tabConfig.tabs"
                  border
                  size="small"
                >
                  <el-table-column label="标签名" min-width="140">
                    <template #default="{ row }">
                      <el-input v-model="row.label" placeholder="如 已启用" size="small" />
                    </template>
                  </el-table-column>
                  <el-table-column label="字段值" min-width="140">
                    <template #default="{ row }">
                      <el-input v-model="row.value" placeholder="如 1" size="small" />
                    </template>
                  </el-table-column>
                  <el-table-column label="操作" width="80">
                    <template #default="{ $index }">
                      <el-button
                        link
                        size="small"
                        type="danger"
                        @click="tabConfig.tabs.splice($index, 1)"
                      >
                        删除
                      </el-button>
                    </template>
                  </el-table-column>
                </el-table>
                <div class="form-tip">
                  运行时会自动在最前面加一个「全部」标签（不带筛选条件），无需手工添加。
                </div>
              </div>
            </el-form-item>
          </template>
        </el-form>

        <el-divider content-position="left">树形列表</el-divider>

        <el-form class="config-form" label-width="120px">
          <el-form-item label="启用树形">
            <el-switch
              v-model="treeConfig.enabled"
              :disabled="hasSubColumns"
              @change="handleTreeToggle"
            />
            <div class="form-tip">
              用于组织架构、分类管理等有层级的数据。
              <strong>开启后会自动关闭分页</strong>——分页会把父子行拆到不同页，子节点找不到父节点。
            </div>
            <el-alert
              v-if="hasSubColumns"
              title="已配置明细列，树形列表不可用：明细列要把一条主记录摊平成多行，树形要按 children 递归成层级，两种重排合不到一起。二选一。"
              type="info"
              :closable="false"
              show-icon
              class="mt-8px"
            />
          </el-form-item>
          <template v-if="treeConfig.enabled">
            <el-form-item label="父级字段" required>
              <el-select
                v-model="treeConfig.parentField"
                clearable
                filterable
                placeholder="存放父节点 ID 的字段"
              >
                <el-option v-for="f in mainFields" :key="f.key" :label="f.title" :value="f.field" />
              </el-select>
              <div class="form-tip">顶层节点的该字段应为空、0，或不指向任何存在的行。</div>
            </el-form-item>
            <el-form-item label="主键字段">
              <el-input v-model="treeConfig.rowKey" placeholder="默认为 id" />
              <div class="form-tip">用于建立父子关系，须与父级字段存放的值对应。</div>
            </el-form-item>
          </template>
        </el-form>

        <el-divider content-position="left">左侧树查询区</el-divider>

        <el-form class="config-form" label-width="120px">
          <el-form-item label="启用左侧树">
            <el-switch v-model="leftTree.enabled" />
            <div class="form-tip">
              在列表左侧显示一棵树，点击节点按对应字段筛选。适合按分类、状态、部门浏览数据。
            </div>
          </el-form-item>
          <template v-if="leftTree.enabled">
            <el-form-item label="数据源" required>
              <el-radio-group v-model="leftTree.dataSource">
                <el-radio value="DICT">字典</el-radio>
                <el-radio value="FIELD">表单字段</el-radio>
              </el-radio-group>
              <div class="form-tip">
                <strong>字典</strong
                >：节点取自字典项，顺序与文案可控，推荐用于状态、类型这类固定枚举。<br />
                <strong>表单字段</strong
                >：节点取自该列的实际去重值，适合部门、分类这类数据驱动的维度。
              </div>
            </el-form-item>

            <el-form-item v-if="leftTree.dataSource === 'DICT'" label="字典类型" required>
              <DictTypeSelect v-model="leftTree.dictType" placeholder="选择数据字典" />
            </el-form-item>

            <el-form-item label="筛选字段" required>
              <el-select
                v-model="leftTree.field"
                clearable
                filterable
                placeholder="点击节点时按该字段筛选"
              >
                <el-option v-for="f in mainFields" :key="f.key" :label="f.title" :value="f.field" />
              </el-select>
              <div v-if="leftTree.dataSource === 'FIELD'" class="form-tip">
                节点值也取自这个字段，最多加载 500 个去重值。
              </div>
            </el-form-item>

            <el-form-item label="树标题">
              <el-input v-model="leftTree.title" placeholder="默认为「筛选」" />
            </el-form-item>
          </template>
        </el-form>

        <el-divider content-position="left">列设置</el-divider>

        <el-form class="config-form" label-width="120px">
          <el-form-item label="允许调整列">
            <el-switch v-model="columnSetting.enabled" />
            <div class="form-tip">
              在列表工具栏右侧放一个齿轮，使用者可以自己隐藏列、拖动列序、改列宽。
              <strong>设置只存在使用者自己的浏览器里</strong>，不影响这里配的默认样子，
              也不会同步到别的机器 —— 界面上已经写明这一点。
              <br />
              固定列与明细列只能隐藏、不能改位置：前者的偏移量按列序算，
              后者按所属子表成组，任何一边错位都很难看出原因。
            </div>
          </el-form-item>
        </el-form>

        <el-divider content-position="left">行分组</el-divider>

        <el-form class="config-form" label-width="120px">
          <el-form-item label="启用行分组">
            <el-switch
              v-model="rowGroup.enabled"
              :disabled="!rowGroupAvailable"
              @change="handleRowGroupToggle"
            />
            <div class="form-tip">
              按某一列把行分成若干组，每组前面插一行写着组名、条数与小计的分组行，可折叠。
              <template v-if="!rowGroupAvailable">
                <br />
                <strong>{{ rowGroupUnavailableReason }}</strong>
              </template>
            </div>
          </el-form-item>

          <template v-if="rowGroup.enabled && rowGroupAvailable">
            <el-form-item label="分组字段" required>
              <el-select
                v-model="rowGroup.field"
                clearable
                filterable
                placeholder="按哪一列分组"
              >
                <el-option v-for="f in mainFields" :key="f.key" :label="f.title" :value="f.field" />
              </el-select>
              <div class="form-tip">
                按字段的<strong>原始值</strong>分组，分组行上显示的是该列格式化之后的值。
                不要求同值的行挨在一起，所以不依赖排序 —— 组的先后就是它在数据里第一次出现的先后。
              </div>
            </el-form-item>

            <el-form-item label="显示条数">
              <el-switch v-model="rowGroup.showCount" />
              <div class="form-tip">
                在组名后面显示「（N 条）」。
                <strong>⚠️ N 是当前页的条数</strong>，不是这一组的总条数 ——
                分组与小计都只在当前页的数据上做，与合计行同一个口径。
              </div>
            </el-form-item>

            <el-form-item label="组内小计">
              <el-select
                v-model="rowGroup.summaryFields"
                class="!w-420px"
                collapse-tags
                collapse-tags-tooltip
                :max-collapse-tags="3"
                multiple
                placeholder="选择要在分组行上出小计的列"
              >
                <el-option
                  v-for="col in groupSummarizableColumns"
                  :key="col.field"
                  :label="col.label || col.field"
                  :value="col.field"
                />
              </el-select>
              <div v-if="nonNumericGroupSumLabels.length > 0" class="form-tip">
                <strong>{{ nonNumericGroupSumLabels.join('、') }}</strong>
                看起来不是数值列，分组行上不会显示它们的小计。
              </div>
            </el-form-item>

            <el-form-item label="默认状态">
              <el-radio-group v-model="rowGroup.defaultExpand">
                <el-radio value="ALL">全部展开</el-radio>
                <el-radio value="NONE">全部折叠</el-radio>
              </el-radio-group>
            </el-form-item>
          </template>
        </el-form>

        <el-divider content-position="left">复杂表头</el-divider>
        <el-form class="config-form" label-width="120px">
          <el-form-item label="启用分组表头">
            <el-switch v-model="complexHeaderEnabled" />
            <div class="form-tip">
              把相邻的几列归到一个父表头下，用于报表类展示。
              <strong>固定列不能参与合并</strong>——Element Plus 的固定列计算会与合并冲突导致错位。
            </div>
          </el-form-item>

          <template v-if="complexHeaderEnabled">
            <el-form-item label="分组">
              <div class="w-full">
                <el-button plain size="small" type="primary" class="mb-8px" @click="addHeaderGroup">
                  添加分组
                </el-button>
                <el-table
                  v-if="complexHeaders.length > 0"
                  :data="complexHeaders"
                  border
                  size="small"
                >
                  <el-table-column label="分组名" width="160">
                    <template #default="{ row }">
                      <el-input v-model="row.label" placeholder="如 联系方式" size="small" />
                    </template>
                  </el-table-column>
                  <el-table-column label="包含的列" min-width="260">
                    <template #default="{ row }">
                      <el-select
                        v-model="row.children"
                        multiple
                        filterable
                        placeholder="选择要归入该分组的列"
                        size="small"
                      >
                        <el-option
                          v-for="col in groupableColumns"
                          :key="col.field"
                          :label="col.label || col.field"
                          :value="col.field"
                        />
                      </el-select>
                    </template>
                  </el-table-column>
                  <el-table-column label="操作" width="80">
                    <template #default="{ $index }">
                      <el-button
                        link
                        size="small"
                        type="danger"
                        @click="complexHeaders.splice($index, 1)"
                      >
                        删除
                      </el-button>
                    </template>
                  </el-table-column>
                </el-table>
                <div class="form-tip">
                  未归入任何分组的列按原样单独显示。同一列不要放进多个分组。
                </div>
              </div>
            </el-form-item>
          </template>
        </el-form>
      </el-tab-pane>
    </el-tabs>
    </div>

    <!--
      右侧字段面板

      只在「列配置」「查询条件」两个页签下出现 —— 其余页签配的是列表整体属性，
      与选哪些字段无关，常驻一块空面板只会白占三分之一的宽度。
    -->
    <div v-if="rightBoardVisible" class="right-board">
      <div class="right-board-head">
        {{ activeTab === 'columns' ? '列表字段' : '查询字段' }}
        <span class="right-board-count">
          已选 {{ activeTab === 'columns' ? columns.length : searchItems.length }} /
          {{ fieldPanelOptions.length }}
        </span>
      </div>

      <div class="right-board-filter">
        <el-input v-model="fieldKeyword" clearable placeholder="搜索字段" size="small">
          <template #prefix>
            <Icon icon="ep:search" :size="14" />
          </template>
        </el-input>
        <div class="right-board-actions">
          <el-button link size="small" @click="selectAllFields">全选</el-button>
          <el-button link size="small" @click="invertFields">反选</el-button>
          <el-button link size="small" @click="clearFields">清空</el-button>
        </div>
      </div>

      <div class="right-board-list">
        <el-empty
          v-if="filteredFieldOptions.length === 0"
          :image-size="50"
          description="没有匹配的字段"
        />
        <!--
          一行一个字段，不再分三列

          字段标题带着来源后缀（「订单金额 (明细-biz_order_item)」这种），
          三列排布时一格只有一百来像素，长名字要么被截断、要么换行挤成两层，
          两个只差后缀的字段看起来一模一样。整行铺开之后名字能完整显示，
          放不下的交给 tooltip。
        -->
        <label
          v-for="field in filteredFieldOptions"
          :key="field.key"
          class="field-row"
          :class="{ 'is-checked': isFieldSelected(field.key) }"
        >
          <el-checkbox
            :model-value="isFieldSelected(field.key)"
            @change="(checked) => toggleField(field, checked as boolean)"
          />
          <el-tooltip :content="field.title" :disabled="field.title.length <= 22" placement="left">
            <span class="field-row-title">{{ field.title }}</span>
          </el-tooltip>
        </label>
      </div>
    </div>

    <!-- 格式化器配置对话框 -->
    <el-dialog v-model="formatterDialogVisible" title="列格式化配置" width="500px">
      <el-form v-if="currentColumn" label-width="100px">
        <el-form-item label="格式化类型">
          <el-select v-model="currentFormatter.type" @change="handleFormatterTypeChange">
            <el-option
              v-for="f in CELL_FORMATTERS"
              :key="f.value"
              :label="f.label"
              :value="f.value"
            />
          </el-select>
        </el-form-item>

        <el-form-item
          v-if="currentFormatter.type === 'DICT' || currentFormatter.type === 'TAG'"
          label="字典类型"
        >
          <div class="w-full">
            <DictTypeSelect v-model="currentFormatter.dictType" placeholder="选择数据字典" />
            <div v-if="currentFormatter.type === 'TAG'" class="form-tip">
              标签上印的就是字典翻译后的文字。没配字典时按原值显示。
              颜色自动按值分配，同一个值每次颜色一致。
            </div>
          </div>
        </el-form-item>

        <template v-if="currentFormatter.type === 'NUMBER'">
          <el-form-item label="小数位数">
            <el-input-number v-model="currentFormatter.precision" :min="0" :max="10" />
          </el-form-item>
          <el-form-item label="千分位">
            <el-switch v-model="currentFormatter.thousands" />
          </el-form-item>
        </template>

        <template v-if="currentFormatter.type === 'PERCENT'">
          <el-form-item label="小数位数">
            <el-input-number v-model="currentFormatter.precision" :min="0" :max="10" />
          </el-form-item>
          <el-form-item label="库里已是百分数">
            <el-switch v-model="currentFormatter.alreadyScaled" />
            <div class="form-tip">
              关：库里存 0.15，显示 15.00%。开：库里存 15，显示 15.00%。选错会差 100 倍。
            </div>
          </el-form-item>
        </template>

        <el-form-item v-if="currentFormatter.type === 'LINK'" label="链接文案">
          <el-input v-model="currentFormatter.linkText" placeholder="留空则显示地址本身" />
          <div class="form-tip">
            该列的值应当是一个地址。只放行 http / https / mailto / tel 与相对地址，
            其余一律降级成纯文本。
          </div>
        </el-form-item>

        <div v-if="currentFormatter.type === 'IMAGE' || currentFormatter.type === 'FILE'" class="form-tip">
          该列的值应当来自上传类控件。一格里最多并排显示 3 个，多的折成计数。
        </div>
      </el-form>
      <template #footer>
        <el-button @click="formatterDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveFormatter">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import Sortable from 'sortablejs'
import { useStepRestore } from './useStepRestore'
import PrintTemplateEditor from '@/components/FormPrint/PrintTemplateEditor.vue'
import CustomButtonEditor from '@/components/FormButton/CustomButtonEditor.vue'
import DetailTabEditor from '@/components/FormTab/DetailTabEditor.vue'
import DictTypeSelect from '@/components/FormWidgets/DictTypeSelect.vue'
import type { CustomButton } from '@/components/FormWidgets/customButton'
import type { DetailTab } from '@/components/FormWidgets/detailTab'
import {
  backfillSearchWidget,
  coerceOperator,
  inferSearchWidget,
  isRangeWidget,
  operatorsFor,
  SEARCH_WIDGETS,
  type SearchWidgetType
} from '@/components/FormWidgets/searchWidget'
import { CELL_FORMATTERS } from '@/components/FormWidgets/listCell'
import {
  FORM_VIEW_MODES,
  parseFormViewMode,
  type FormViewMode
} from '@/components/FormWidgets/formViewMode'
import {
  builtinOf,
  defaultButtons,
  DEFAULT_MAX_INLINE_BUTTONS,
  normalizeButtons,
  normalizeMaxInline,
  positionOf,
  splitInlineButtons,
  visibleButtons,
  type ListButton
} from '@/components/FormWidgets/listButton'
import { editableColumns, isInlineEditable } from '@/components/FormWidgets/inlineEdit'

defineOptions({ name: 'StepListDesign' })

const props = defineProps<{
  modelData: any
  formFields: any[]
}>()

const activeTab = ref('columns')

/**
 * 配置表格的高度上限
 *
 * ## 为什么不能写成一个常数
 *
 * 列配置与查询条件都可能有几十行。不给上限的话，页面级滚动会把上面那排开关
 * 与右侧的字段面板一起滚出可视区 —— 勾一个字段就要往上翻一次。
 *
 * 但写死一个数（原先是 440）同样不对，而且两头都错：
 * 笔记本上表格会**戳出视口底部**，最后几行要靠页面滚动才够得着；
 * 大屏上表格只占中间一截，**底下空出几百像素**，右侧的字段面板却是按
 * 视口高度铺满的，两边高度对不上，看着就是没做完。
 *
 * 所以按实测的表格顶边到视口底部的距离算，并跟着窗口尺寸与页签切换重算。
 * 量的是表格自己的位置而不是照着别的元素推算 —— 上面那排开关在不同页签下
 * 有没有、有几行都不一样，推算迟早会偏。
 */
const tableMaxHeight = ref(360)

/** 表格底部要留出的空隙：底下那行说明文字 + 页面留白 */
const TABLE_BOTTOM_GAP = 76
/** 再矮就没法用了，宁可让它戳出去一点 */
const TABLE_MIN_HEIGHT = 220

const fitTableHeight = async () => {
  await nextTick()
  const ref_ = activeTab.value === 'search' ? searchTableRef : columnTableRef
  const el = ref_.value?.$el as HTMLElement | undefined
  // 页签没在显示时 top 是 0，照它算会得到一个超大的高度
  if (!el || !el.offsetParent) return
  const top = el.getBoundingClientRect().top
  if (top <= 0) return
  const next = Math.max(
    TABLE_MIN_HEIGHT,
    Math.round(window.innerHeight - top - TABLE_BOTTOM_GAP)
  )
  // ⚠️ 一像素的抖动不写回去
  //
  // 下面用 ResizeObserver 盯着根元素，而改表格高度会改变根元素的高度 ——
  // 无条件写回就是一个自激的循环。算出来的值只取决于表格顶边的位置
  //（那是由上面那排开关决定的，与表格自己多高无关），所以第二次必然算出同一个数，
  // 这个判断一挡，循环就停在第二轮。
  if (Math.abs(next - tableMaxHeight.value) < 2) return
  tableMaxHeight.value = next
}

/**
 * 根元素。用来盯尺寸变化
 *
 * 本组件被父组件用 v-show 控制：挂载时它是隐藏的（那会儿在第一步），
 * 量不到任何位置。而「切到列表设计这一步」既不会触发 activeTab 的 watch，
 * 也不会触发数据的 watch —— 少了这一环，表格高度会一直停在初始值上，
 * 表现正是「换了台大显示器，表格还是那么高，底下空一大片」。
 * 盯根元素的尺寸能把「从隐藏变可见」「窗口缩放」「布局变化」一次覆盖掉。
 */
const rootRef = ref<HTMLElement>()
let rootResizeObserver: ResizeObserver | null = null

const columns = ref<any[]>([])

/**
 * 列顺序拖拽
 *
 * ## 为什么要 key 强制重挂 el-table
 *
 * Sortable 拖完会把 DOM 节点搬到新位置，而 Vue 并不知道这件事 ——
 * 接着按新数组重渲染时，真实 DOM 与虚拟 DOM 对不上，
 * 表现为「拖一次之后某一行的输入框内容串到别的行上去」。
 * 拖完顺手把 key 加一，让 el-table 整个重挂，两边重新对齐。
 * 这张表只有几行到几十行，重挂的代价可以忽略。
 */
const columnTableRef = ref()
const columnTableKey = ref(0)
let columnSortable: any = null

const initColumnSortable = async () => {
  await nextTick()
  const tbody = columnTableRef.value?.$el?.querySelector('.el-table__body-wrapper tbody')
  if (!tbody) return
  columnSortable?.destroy?.()
  columnSortable = Sortable.create(tbody, {
    handle: '.col-drag-handle',
    animation: 150,
    onEnd: ({ oldIndex, newIndex }: { oldIndex?: number; newIndex?: number }) => {
      if (oldIndex === undefined || newIndex === undefined || oldIndex === newIndex) return
      const moved = columns.value.splice(oldIndex, 1)[0]
      columns.value.splice(newIndex, 0, moved)
      columnTableKey.value += 1
      initColumnSortable()
    }
  })
}

onMounted(() => {
  initColumnSortable()
  initSearchSortable()
  initButtonSortable()
  fitTableHeight()
  window.addEventListener('resize', fitTableHeight)
  if (typeof ResizeObserver !== 'undefined' && rootRef.value) {
    rootResizeObserver = new ResizeObserver(() => {
      void fitTableHeight()
    })
    rootResizeObserver.observe(rootRef.value)
  }
})

onBeforeUnmount(() => {
  columnSortable?.destroy?.()
  columnSortable = null
  searchSortable?.destroy?.()
  searchSortable = null
  buttonSortable?.destroy?.()
  buttonSortable = null
  window.removeEventListener('resize', fitTableHeight)
  rootResizeObserver?.disconnect()
  rootResizeObserver = null
})

// 挂载时列表可能还是空的，那时 tbody 里没有可拖的行。
// 等第一批列真正进来再挂一次，否则「刚加完列就拖」会拖不动
watch(
  () => columns.value.length,
  (len) => {
    if (len > 0 && !columnSortable) initColumnSortable()
  }
)

const searchItems = ref<any[]>([])

/**
 * 查询项顺序拖拽
 *
 * 与列配置同一套做法（理由见 initColumnSortable）。查询区的字段顺序同样重要 ——
 * 最常用的条件排在第一个，用户就不必每次都去点「展开」。
 */
const searchTableRef = ref()
const searchTableKey = ref(0)
let searchSortable: any = null

const initSearchSortable = async () => {
  await nextTick()
  const tbody = searchTableRef.value?.$el?.querySelector('.el-table__body-wrapper tbody')
  if (!tbody) return
  searchSortable?.destroy?.()
  searchSortable = Sortable.create(tbody, {
    handle: '.col-drag-handle',
    animation: 150,
    onEnd: ({ oldIndex, newIndex }: { oldIndex?: number; newIndex?: number }) => {
      if (oldIndex === undefined || newIndex === undefined || oldIndex === newIndex) return
      const moved = searchItems.value.splice(oldIndex, 1)[0]
      searchItems.value.splice(newIndex, 0, moved)
      searchTableKey.value += 1
      initSearchSortable()
    }
  })
}

watch(
  () => searchItems.value.length,
  (len) => {
    if (len > 0 && !searchSortable) initSearchSortable()
  }
)

/**
 * 什么时候要重算表格高度
 *
 * - 切页签：两张表上面顶着的东西不一样（列配置上面多一排开关），顶边位置会变
 * - 从空态变成有数据：空态渲染的是 el-empty，表格那会儿根本不在 DOM 里，量不到
 * - 本组件被父级 v-show 控制，回显数据到达时也要重量一次（见 restore）
 */
watch(activeTab, fitTableHeight)
watch([() => columns.value.length > 0, () => searchItems.value.length > 0], fitTableHeight)

const pagination = ref({ enabled: true, pageSize: 20 })
const defaultSort = ref({ field: '', order: 'asc' })
const operationColumn = ref({
  show: true,
  label: '操作',
  width: 160,
  /** 行内按钮超过这个数量时，多出来的收进「更多」下拉。见按钮设置页签里的说明 */
  maxInline: DEFAULT_MAX_INLINE_BUTTONS
})

/**
 * 按钮清单
 *
 * 与 operationColumn 分开存：操作列的标题宽度只管行内按钮那一列，
 * 而清单里还有工具栏按钮 —— 挂在 operationColumn 下面会让
 * 「关掉操作列，工具栏按钮也跟着没了」这种事看起来理所当然。
 */
const buttonList = ref<ListButton[]>(defaultButtons())

/** 按钮顺序拖拽。做法与列顺序一致，理由见 initColumnSortable 上的说明 */
const buttonTableRef = ref()
const buttonTableKey = ref(0)
let buttonSortable: any = null

const initButtonSortable = async () => {
  await nextTick()
  const tbody = buttonTableRef.value?.$el?.querySelector('.el-table__body-wrapper tbody')
  if (!tbody) return
  buttonSortable?.destroy?.()
  buttonSortable = Sortable.create(tbody, {
    handle: '.col-drag-handle',
    animation: 150,
    onEnd: ({ oldIndex, newIndex }: { oldIndex?: number; newIndex?: number }) => {
      if (oldIndex === undefined || newIndex === undefined || oldIndex === newIndex) return
      const moved = buttonList.value.splice(oldIndex, 1)[0]
      buttonList.value.splice(newIndex, 0, moved)
      buttonTableKey.value += 1
      initButtonSortable()
    }
  })
}

/**
 * 勾了显示、但被别的配置挡住的按钮
 *
 * 打印没配模板时点开是一张空白纸，变更记录没开日志时点开永远是空的 ——
 * 运行时会兜底不渲染，但设计期什么都不说的话，用户会以为自己配错了。
 */
const gatedButtonWarnings = computed(() => {
  const warnings: string[] = []
  const shown = (key: string) => buttonList.value.some((b) => b.key === key && b.show)
  if (!printConfigured.value && (shown('print') || shown('batchPrint'))) {
    warnings.push('勾了打印相关按钮但还没配打印模板，运行时不会显示它们')
  }
  if (!changeLogEnabled.value && shown('changeLog')) {
    warnings.push('勾了「变更记录」但数据绑定那一步没开变更日志，运行时不会显示它')
  }
  return warnings
})

/**
 * 折叠阈值的即时预演
 *
 * 「超过 N 个折叠成下拉」这条配置的效果在运行时才看得到，而设计期改的是一个数字 ——
 * 不预演的话用户只能存一次、发布一次、打开列表看一眼，再回来调。
 * 这里直接按当前的按钮清单算出「哪几个直接显示、哪几个进下拉」。
 *
 * ⚠️ 只算内置行内按钮。自定义按钮的可见条件要按【某一行的数据】求值，
 * 设计期没有行可用，算出来的会是一个看着确定、实际不准的数字。
 */
const inlineOverflowPreview = computed(() => {
  // 与运行时同一道闸：没配打印模板 / 没开变更日志时，那两个按钮压根不渲染，
  // 算进预演里会让用户以为自己已经超了阈值
  const shownButtons = visibleButtons(buttonList.value, 'row').filter((btn) => {
    const gate = builtinOf(btn.key)?.gated
    if (gate === 'print') return printConfigured.value
    if (gate === 'changeLog') return changeLogEnabled.value
    return true
  })
  const { inline, folded } = splitInlineButtons(shownButtons, operationColumn.value.maxInline)
  if (folded.length === 0) return undefined
  return {
    shown: inline.map((b) => b.label),
    folded: folded.map((b) => b.label)
  }
})
const showSummary = ref(false)
const summaryColumns = ref<string[]>([])

/**
 * 序号列
 *
 * 默认开。序号是列表的默认预期 —— 用户报「第 37 条那条有问题」时，
 * 没有序号就只能一行行数。要关掉才是需要特意配的那一边。
 */
const showIndexColumn = ref(true)

/** 新增 / 编辑 / 详情 的呈现方式 */
const formViewMode = ref<FormViewMode>('DIALOG')

const currentViewModeDesc = computed(
  () => FORM_VIEW_MODES.find((m) => m.value === formViewMode.value)?.desc ?? ''
)

/**
 * 标签页筛选配置
 *
 * 切换标签等价于追加一个 EQ 查询条件，比让用户每次手动选下拉更快。
 * 「全部」标签由运行时自动加在最前面，不存在配置里。
 */
const tabConfig = ref<{
  enabled: boolean
  field: string
  tabs: Array<{ label: string; value: string }>
}>({
  enabled: false,
  field: '',
  tabs: []
})

const addTab = () => {
  tabConfig.value.tabs.push({ label: '', value: '' })
}

/**
 * 树形列表配置
 *
 * 与分页互斥：分页按行数截断，会把父行留在上一页、子行推到下一页，
 * 子行找不到父节点就会从树里消失。所以开启树形时强制关掉分页。
 */
const treeConfig = ref({
  enabled: false,
  parentField: '',
  rowKey: 'id'
})

/** 列配置里是否存在明细列 */
const hasSubColumns = computed(() => columns.value.some((c: any) => c.subField))

/**
 * 行内编辑配置
 *
 * 与明细列互斥：明细列要把一条主记录摊平成多行，
 * 改其中一行的主表值没有确定语义（改的是这条主记录，还是这一条明细？）。
 */
const inlineEdit = ref({ enabled: false })

/**
 * 关掉行内编辑时，把列上的可编辑标记一并清掉
 *
 * 留着的话，配置里会残留一批「开关关着但标记还在」的列 ——
 * 下次再打开行内编辑，用户会看到一批自己没勾过的列是可编辑的。
 */
const handleInlineEditToggle = (enabled: any) => {
  if (!enabled) {
    columns.value.forEach((col: any) => {
      col.inlineEditable = undefined
    })
  }
}

/** 已勾选且合规的可编辑列标题，用于在高级页签里回显 */
const inlineEditableColumnLabels = computed(() =>
  editableColumns(columns.value).map((c: any) => c.label || c.field)
)

/**
 * 行分组配置
 *
 * ⚠️ 这个 ref 必须声明在「同值合并」那一段**之前**
 *
 * 同值合并的 `watch(mergeSameAvailable, ...)` 在 setup 阶段就会求一次源值，
 * 而 `mergeSameAvailable` 里读了 `rowGroup.value`（两者互斥）。
 * 声明在后面的话，那次求值撞上 const 的暂时性死区，抛 ReferenceError ——
 * 整个设计器页白屏，而报错信息完全指不到「行分组」这个新功能上。
 * （这是实测踩到的：加完行分组之后，列表设计这一步整步点不开。）
 *
 * 具体字段的说明见下面「行分组」那一段。
 */
/**
 * 运行时列设置
 *
 * 默认关。给每张已发布的列表凭空多一个按钮是一种意外 ——
 * 设计者没配过它，用户却发现工具栏变了。
 */
const columnSetting = ref({ enabled: false })

const rowGroup = ref({
  enabled: false,
  field: '',
  showCount: true,
  summaryFields: [] as string[],
  defaultExpand: 'ALL' as 'ALL' | 'NONE'
})

// ==================== 同值合并 ====================
//
// 相邻几行在某一列上取值相同时合并成一格。算法在 cellMerge.ts，
// 这里只负责「什么时候允许配」与「配了之后提示什么」。

/**
 * 「同值合并」这一列在不在
 *
 * 三种模式下整列隐藏，因为它在这些模式下配了也不会生效：
 *
 * - **树形** —— 树按 children 递归渲染，行与行不是平铺关系，没有「相邻」可言
 * - **明细展开** —— 主表列已经在按主记录跨行合并了，再叠一层「相邻主记录也合并」
 *   没有确定语义：合并后的那一格对应哪条主记录？操作列怎么办？
 * - **行内编辑** —— 编辑的是「这一行」，而合并后的一格横跨若干行
 *
 * 隐藏而不是置灰：置灰的开关摆在那里，用户会反复去点它并怀疑是不是坏了。
 */
const mergeSameAvailable = computed(
  () =>
    !treeConfig.value.enabled &&
    !hasSubColumns.value &&
    !inlineEdit.value.enabled &&
    // 行分组也在重排行结构：它会往行序列里插进分组行，
    // 而合并是按「相邻行同值」算的 —— 中间插了一行不是数据的行，
    // 合并块会被从中劈开，看起来像合并时灵时不灵
    !rowGroup.value.enabled
)

/**
 * 某一列不能开同值合并的原因，能开时返回空串
 *
 * 返回原因而不是布尔值：禁用的开关必须说明为什么，否则用户只会觉得它坏了。
 */
const mergeSameDisabledReason = (col: any): string => {
  if (col?.subField) {
    return '明细列不能合并 —— 明细行本来就是逐行独立的，' +
      '按同值合并会把不同主记录下的明细粘在一起'
  }
  return ''
}

/** 已开启同值合并的列标题，按列顺序 —— 这个顺序就是级联的优先级 */
const mergeSameColumnLabels = computed(() =>
  columns.value
    .filter((c: any) => c.mergeSame && !c.subField)
    .map((c: any) => c.label || c.field)
)

/**
 * 关掉合并模式时，把列上的合并标记一并清掉
 *
 * 与 handleInlineEditToggle 同一个道理：留着的话配置里会残留一批
 * 「模式关着但标记还在」的列，下次切回来会看到一批自己没勾过的列开着合并。
 */
watch(mergeSameAvailable, (available) => {
  if (available) return
  columns.value.forEach((col: any) => {
    col.mergeSame = undefined
  })
})

// ==================== 行分组 ====================
//
// 按某一列把行分成若干组，每组前插一行分组行。编排算法在 rowGroup.ts，
// 这里负责「什么时候允许配」与「配了之后提示什么」。

/**
 * 不能开行分组的原因，能开时返回空串
 *
 * 三者都在重排行结构，与行分组合不到一起：
 * 树按 children 递归、明细展开按主记录摊平、行内编辑改的是「这一行」，
 * 而分组会往行序列里插进一批不是记录的行。
 */
const rowGroupUnavailableReason = computed((): string => {
  if (treeConfig.value.enabled) return '树形列表已开启，两者都在重排行结构，不能同时用'
  if (hasSubColumns.value) return '列表里有明细列，明细展开与行分组不能同时用'
  if (inlineEdit.value.enabled) return '行内编辑已开启，与行分组不能同时用'
  return ''
})

const rowGroupAvailable = computed(() => !rowGroupUnavailableReason.value)

/** 关掉分组时把字段与小计一并清掉，免得下次打开看到一批自己没配过的东西 */
const handleRowGroupToggle = (enabled: any) => {
  if (enabled) return
  rowGroup.value.field = ''
  rowGroup.value.summaryFields = []
}

/** 一旦切到互斥的模式，行分组自动关掉 —— 留着开关开着但不生效最费解 */
watch(rowGroupAvailable, (available) => {
  if (!available) rowGroup.value.enabled = false
})

/** 可以出组内小计的列。明细列不行 —— 分组是主记录级的，明细行不在这一层 */
const groupSummarizableColumns = computed(() =>
  columns.value.filter((c: any) => c.field && !c.subField)
)

/** 已选为组内小计、但看起来不是数值的那些列 */
const nonNumericGroupSumLabels = computed(() =>
  groupSummarizableColumns.value
    .filter(
      (c: any) => rowGroup.value.summaryFields.includes(c.field) && !isNumericColumn(c)
    )
    .map((c: any) => c.label || c.field)
)

const handleTreeToggle = (enabled: any) => {
  if (enabled) {
    pagination.value.enabled = false
  }
}

/** 开分页时关掉树形，两者互斥 */
const handlePaginationToggle = (enabled: any) => {
  if (enabled) {
    treeConfig.value.enabled = false
  }
}

/**
 * 左侧树查询区配置
 *
 * 只做字典与表单字段两种数据源。
 * 配置项 20+ 个，收益不匹配复杂度。
 */
const leftTree = ref({
  enabled: false,
  dataSource: 'DICT' as 'DICT' | 'FIELD',
  dictType: '',
  field: '',
  title: ''
})

/**
 * 复杂表头（多级表头合并）
 *
 * 结构是 [{ label: '联系方式', children: ['phone', 'email'] }]，
 * 运行时渲染成嵌套的 el-table-column。
 */
const complexHeaderEnabled = ref(false)
const complexHeaders = ref<Array<{ label: string; children: string[] }>>([])

/**
 * 可参与分组的列
 *
 * 固定列排除在外：Element Plus 计算 fixed 列的偏移量时不考虑多级表头，
 * 两者并用会让固定列的位置错位。
 */
const groupableColumns = computed(() => columns.value.filter((c) => c.field && !c.fixed))

const addHeaderGroup = () => {
  complexHeaders.value.push({ label: '', children: [] })
}

/** 格式化器配置对话框 */
const formatterDialogVisible = ref(false)
const currentColumn = ref<any>(null)
const currentFormatter = ref<any>({ type: 'NONE' })

/**
 * 格式化方式的显示名称
 *
 * 表格里印名称而不是 `formatter.type` 那个内部枚举值 ——
 * 配置的人认的是「字典翻译」，不是 DICT。认不出来的类型原样印出来，
 * 那说明配置是手工改过的，把它藏掉只会更难查。
 */
const formatterLabel = (formatter: any): string => {
  const type = formatter?.type
  if (!type || type === 'NONE') return '无'
  return CELL_FORMATTERS.find((item) => item.value === type)?.label ?? type
}

const openFormatterDialog = (column: any) => {
  currentColumn.value = column
  currentFormatter.value = column.formatter
    ? { ...column.formatter }
    : { type: 'NONE', dictType: '', precision: 2, thousands: false }
  formatterDialogVisible.value = true
}

const handleFormatterTypeChange = () => {
  // 切换类型时补上该类型需要的配置项，避免面板里出现空的输入框
  const type = currentFormatter.value.type
  if (type === 'DICT' || type === 'TAG') {
    currentFormatter.value.dictType = currentFormatter.value.dictType || ''
  } else if (type === 'NUMBER') {
    currentFormatter.value.precision = currentFormatter.value.precision ?? 2
    currentFormatter.value.thousands = currentFormatter.value.thousands ?? false
  } else if (type === 'PERCENT') {
    currentFormatter.value.precision = currentFormatter.value.precision ?? 2
    currentFormatter.value.alreadyScaled = currentFormatter.value.alreadyScaled ?? false
  }
}

const saveFormatter = () => {
  if (!currentColumn.value) return
  if (currentFormatter.value.type === 'NONE') {
    currentColumn.value.formatter = undefined
  } else {
    currentColumn.value.formatter = { ...currentFormatter.value }
  }
  formatterDialogVisible.value = false
}

/**
 * 可用字段列表：聚合五个来源
 *
 * 每项的 key 才是唯一标识，field 不是 —— 主表有个 remark、明细表里也有个 remark
 * 是很常见的，用 field 去重会把其中一个吃掉。子表字段的 key 带控件前缀。
 */
const availableFields = computed(() => {
  const fields: Array<{
    key: string
    field: string
    title: string
    source: string
    subField?: string
  }> = []

  /** 主表作用域的字段：key 就是 field */
  const pushMain = (field: string, title: string, source: string) => {
    fields.push({ key: field, field, title, source })
  }

  // 1. 表单字段：form-create 控件映射的列
  if (props.formFields?.length) {
    props.formFields
      .filter((rule: any) => rule.field)
      .forEach((rule: any) => {
        pushMain(rule.field, `${rule.title || rule.field} (表单)`, 'form')
      })
  }

  // 2. 关联列：joinTables 带回的其它表字段（需求 2 落地后才有数据）
  let binding: any = {}
  try {
    binding = props.modelData.tableBinding ? JSON.parse(props.modelData.tableBinding) : {}
  } catch {
    binding = {}
  }

  // 2. 关联列：joinTables 带回的只读列。
  //    field 用 AS 后的别名 —— 后端 SELECT 就是 AS 成它，返回数据的 key 也是它
  if (binding.joinTables?.length) {
    binding.joinTables.forEach((join: any) => {
      ;(join.selectColumns ?? []).forEach((sc: any) => {
        // selectColumns 是 { column, as } 对象数组，不是字符串
        const col = typeof sc === 'string' ? sc : sc?.column
        if (!col) return
        const alias = (typeof sc === 'object' && sc?.as) || col
        pushMain(alias, `${col} (关联-${join.alias || join.table})`, 'join')
      })
    })
  }

  // 3. 副表列：sideTables 的字段。field 已是 yd_表名_yd_列名，
  //    后端 SELECT 时 AS 成它，与表单侧命名一致
  if (binding.sideTables?.length) {
    binding.sideTables.forEach((side: any) => {
      Object.entries(side.fieldMapping ?? {}).forEach(([field, cfg]: [string, any]) => {
        // 已在「表单字段」里出现过的不重复添加
        if (fields.some((f) => f.key === field)) return
        pushMain(field, `${cfg?.column || field} (副表-${side.table})`, 'side')
      })
    })
  }

  // 3.5 子表明细列：一条主记录对应多行明细，列表里主表列会纵向合并、明细列逐行展开。
  //     带 subField 标记，后端据此决定要不要批量回查这张明细表
  if (binding.subTables?.length) {
    binding.subTables.forEach((sub: any) => {
      if (!sub?.field || !sub?.table) return
      Object.entries(sub.fieldMapping ?? {}).forEach(([field, cfg]: [string, any]) => {
        fields.push({
          key: `${sub.field}::${field}`,
          field,
          title: `${cfg?.column || field} (明细-${sub.table})`,
          source: 'sub',
          subField: sub.field
        })
      })
    })
  }

  // 4. 审计列：creator / create_time / updater / update_time，用户常需展示创建人
  const auditColumns = [
    { field: 'creator', title: '创建人' },
    { field: 'create_time', title: '创建时间' },
    { field: 'updater', title: '更新人' },
    { field: 'update_time', title: '更新时间' }
  ]
  if (binding.autoFill) {
    const af = binding.autoFill
    const mapping: Record<string, string> = {
      creator: af.creatorColumn,
      create_time: af.createTimeColumn,
      updater: af.updaterColumn,
      update_time: af.updateTimeColumn
    }
    auditColumns.forEach(({ field, title }) => {
      const realColumn = mapping[field]
      if (realColumn) {
        pushMain(realColumn, `${title} (审计)`, 'audit')
      }
    })
  }

  return fields
})

/** 列在可用字段里的唯一标识，与 availableFields 的 key 规则一致 */
const columnKey = (col: { field?: string; subField?: string }): string =>
  col.subField ? `${col.subField}::${col.field}` : (col.field ?? '')

/**
 * 主表作用域的可选字段
 *
 * 查询条件、排序、标签页、树形父级、左侧树只能用这些字段：
 * 它们最终都会变成主表查询上的 WHERE / ORDER BY，
 * 而明细字段在主表查询里根本不存在，选了会被后端静默忽略。
 */
const mainFields = computed(() => availableFields.value.filter((f) => f.source !== 'sub'))

/**
 * 可以在打印模板里循环的子表，连同它们的列
 *
 * 取自**表绑定**里配的 subTables，而不是从规则树里找 group 控件 ——
 * 发布校验判的就是表绑定（`validatePrintLoops`），两处依据必须是同一份。
 * 按规则树来的话，会出现「设计器里列得出来、发布说子表不存在」。
 *
 * 列名取自子表的 fieldMapping 的键：那正是运行时读回明细行时用的键。
 */
const printSubTables = computed(() => {
  let binding: any = {}
  try {
    binding = props.modelData.tableBinding ? JSON.parse(props.modelData.tableBinding) : {}
  } catch {
    return []
  }
  const subs = Array.isArray(binding.subTables) ? binding.subTables : []
  return subs
    .filter((sub: any) => sub?.field)
    .map((sub: any) => {
      // 标题优先用子表控件在表单里的标题，取不到时退回字段名 ——
      // 退回表名会让用户对不上号（表名是 test_demo_grid_cost，控件叫「费用明细」）
      const rule = findRule(props.formFields ?? [], sub.field)
      const title = rule?.title || sub.field
      const columns = Object.keys(sub.fieldMapping ?? {}).map((field) => {
        const inner = findRule(props.formFields ?? [], field, sub.field)
        return { field, title: inner?.title || field }
      })
      return { field: sub.field, title, columns }
    })
})

/**
 * 打印模板
 *
 * ## 为什么不走 collect / restore
 *
 * 它不是 listConf 的一部分 —— 是 infra_form_design 上单独一列（理由同
 * custom_buttons / detail_tabs：listConf 承载「列表怎么显示」）。
 * 直接读写 modelData 上的那个键，不必进 collect 的那份 JSON，
 * 也不必在 restore 里补一行 —— 而 restore 里那个 `if (!listConf) return`
 * 会让新建表单的模板回显不上，是一个很容易埋进去的坑。
 *
 * ## 为什么配在「列表设计」这一步
 *
 * 「打印」按钮只出现在列表行与详情弹窗上，而这两处都只有「表单+列表」类型才有
 * （纯表单是一张独立提交页，没有记录列表也没有详情态）。
 * 放在别的步骤会让纯表单也能配一份永远印不出来的模板。
 *
 * 空串归一成 undefined：编辑器清空后留下的是 `<p><br></p>` 之类的空壳，
 * 那会让运行时以为「配了模板」而放出打印按钮，点开是一张空白纸。
 */
const printTemplate = computed<string | undefined>({
  get: () => props.modelData.printTemplate ?? '',
  set: (value) => {
    props.modelData.printTemplate = isBlankHtml(value) ? undefined : value
  }
})

/** 配没配打印模板。判据与运行时放不放打印按钮是同一条 */
const printConfigured = computed(() => !isBlankHtml(props.modelData.printTemplate))

/** 只剩空标签的 HTML 视为没配 */
const isBlankHtml = (html?: string): boolean => {
  if (!html) return true
  // 只有一张图（印章、抬头）也是有内容的模板。只看文本的话它会被当成空的，
  // 表现是「配了图片模板，保存后打印按钮不出现」
  if (/<(img|table|hr|video)\b/i.test(html)) return false
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, '').trim() === ''
}

// ==================== 自定义按钮 / 详情页页签 ====================
//
// 这两项与打印模板一样，是 infra_form_design 上单独的列，不是 listConf 的一部分，
// 所以同样直接读写 modelData 上的键，不进 collect / restore（理由见 printTemplate）。
//
// ⚠️ 它们的后端与运行时渲染在 B9 就做完了，但一直没有设计器入口 —— 只能打接口配。
// 补在这一步是因为三个按钮位置（工具栏 / 行内 / 详情）与详情页签都只有
// 「表单+列表」类型才有，而纯表单会跳过这一步。见交接文档第十九节。

/** 解析后的表绑定。availableFields 里也解析了一份，那份是局部的，这里给页签用 */
const parsedBinding = computed<any>(() => {
  try {
    return props.modelData.tableBinding ? JSON.parse(props.modelData.tableBinding) : {}
  } catch {
    return {}
  }
})

/**
 * 变更日志开没开
 *
 * 从 tableBinding 里读，不另存一份 —— 开关在「数据绑定」步骤，
 * 这里只是拿来判断「配了变更记录页签却没开日志」那条最值得拦的错配
 */
const changeLogEnabled = computed(() => parsedBinding.value.changeLog?.enabled === true)

/** 条件编辑器要的字段下拉，格式与 StepLogic 的 fieldOptions 一致 */
const conditionFieldOptions = computed(() =>
  mainFields.value.map((f) => ({ label: `${f.title || f.field}（${f.field}）`, value: f.field }))
)

const customButtons = computed<CustomButton[]>({
  get: () => parseJsonArray<CustomButton>(props.modelData.customButtons),
  set: (value) => {
    // 空数组存成 undefined 而不是 '[]'：运行时对两者的行为一样，
    // 但库里留一个 '[]' 会让「这张表单配过按钮吗」看不出来
    props.modelData.customButtons = value.length > 0 ? JSON.stringify(value) : undefined
  }
})

const detailTabs = computed<DetailTab[]>({
  get: () => parseJsonArray<DetailTab>(props.modelData.detailTabs),
  set: (value) => {
    props.modelData.detailTabs = value.length > 0 ? JSON.stringify(value) : undefined
  }
})

/** 解析失败返回空数组：一段坏掉的 JSON 不该让整个步骤打不开 */
function parseJsonArray<T>(raw?: string | null): T[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}


/**
 * 在规则树里找到某个字段的控件定义
 *
 * 两类嵌套要分开走：布局容器的子控件在 children 里，与外层同作用域；
 * 子表控件（type = group）的内部规则在 props.rule 里，属于明细表。
 * 不递归的话明细列推断不出格式化方式，字典列会原样显示成编码值。
 *
 * @param subField 有值时只在该子表控件内部找，避免与同名的主表字段撞上
 */
const findRule = (rules: any[], field: string, subField?: string): any => {
  for (const rule of rules) {
    if (!rule || typeof rule !== 'object') continue
    const innerRules = Array.isArray(rule.props?.rule) ? rule.props.rule : null

    if (subField) {
      // 只认这个子表控件里的字段
      if (rule.field === subField && innerRules) {
        return findRule(innerRules, field)
      }
    } else if (rule.field === field && !innerRules) {
      return rule
    }

    if (Array.isArray(rule.children)) {
      const hit = findRule(rule.children, field, subField)
      if (hit) return hit
    }
  }
  return undefined
}

/**
 * 可参与合计的列
 *
 * 明细列也允许合计（运行时会把所有主记录下的明细摊平了累加），
 * 所以这里不按 source 过滤，只要求列已经选了字段。
 */
const summarizableColumns = computed(() => columns.value.filter((c) => c.field))

/**
 * 值一定是数值的控件
 *
 * ⚠️ 这里漏一个，对应的列就会被误报成「看起来不是数值列」，而它明明合得出来。
 * 公式列是最容易漏的一个 —— 金额合计十有八九合的就是公式算出来的那一列。
 */
const NUMERIC_WIDGET_TYPES = ['inputNumber', 'Formula', 'slider', 'rate']

/**
 * 某一列看起来是不是数值列
 *
 * 判据有两个：列自己配了 NUMBER 格式化，或者它对应的控件的值一定是数值。
 * 关联列 / 副表列 / 审计列在规则树里没有对应控件，一律判为「看不出来」（返回 true），
 * 否则会对一堆其实能合计的列误报。
 */
const isNumericColumn = (col: any): boolean => {
  if (col?.formatter?.type === 'NUMBER') return true
  const rule = findRule(props.formFields ?? [], col?.field, col?.subField)
  // 规则树里找不到 → 不是表单控件映射出来的列，无从判断，不误报
  if (!rule) return true
  return NUMERIC_WIDGET_TYPES.includes(rule.type)
}

/**
 * 已选为合计列、但看起来不是数值的那些列的标题
 *
 * 只提示、不拦截：判据本身是启发式的，拦掉会让「其实能合计」的列配不上。
 * 但必须提示 —— 合计行对非数值列显示成「-」，不说的话用户会以为合计功能坏了。
 */
const nonNumericSummaryLabels = computed(() =>
  summarizableColumns.value
    .filter((c) => summaryColumns.value.includes(columnKey(c)) && !isNumericColumn(c))
    .map((c) => c.label || c.field)
)

// ==================== 右侧字段面板 ====================
//
// 取代原来的「添加列」弹窗。弹窗的问题不在于长得丑，而在于它是一次性的：
// 打开 → 找字段 → 确定 → 关闭，漏选一个就得把这四步重走一遍；
// 而字段是边配边想起来的，漏选几乎是常态。
// 常驻面板把「选字段」变成随时可改的状态，勾上即加入、取消即移除。

/** 字段面板只在这两个页签下出现，其余页签配的是列表整体属性 */
const rightBoardVisible = computed(
  () => activeTab.value === 'columns' || activeTab.value === 'search'
)

const fieldKeyword = ref('')

// 切页签时清掉关键字：两个页签的候选集不同，
// 留着上一个页签的关键字会让面板看起来「一个字段都没有」
watch(activeTab, () => {
  fieldKeyword.value = ''
})

type FieldOption = { key: string; field: string; title: string; subField?: string }

/**
 * 面板的候选字段
 *
 * 列配置能用全部字段；查询条件只能用主表作用域的那些 ——
 * 明细字段在主表查询里根本不存在，选了会被后端静默忽略。
 */
const fieldPanelOptions = computed<FieldOption[]>(() =>
  activeTab.value === 'search' ? mainFields.value : availableFields.value
)

const filteredFieldOptions = computed(() => {
  const keyword = fieldKeyword.value.trim().toLowerCase()
  if (!keyword) return fieldPanelOptions.value
  // 字段名也参与匹配：中文标题想不起来时，按库里的列名找更快
  return fieldPanelOptions.value.filter(
    (f) => f.title.toLowerCase().includes(keyword) || f.field.toLowerCase().includes(keyword)
  )
})

/**
 * 已选字段
 *
 * 列按复合 key（明细列是 `子表控件::字段`），查询项按 field ——
 * 查询项只来自主表作用域，那里 key 与 field 本来就相等。
 */
const selectedFieldKeys = computed(() => {
  if (activeTab.value === 'search') {
    return new Set(searchItems.value.map((s) => s.field).filter(Boolean))
  }
  return new Set(columns.value.map(columnKey).filter(Boolean))
})

const isFieldSelected = (key: string) => selectedFieldKeys.value.has(key)

/**
 * 字段 key → 显示标题
 *
 * 左侧表格的「字段」列只读展示时用。查不到说明这一列指向的字段已经被删了
 * （表单改过、明细表撤了），表格那边会亮一个「字段已不存在」的红标。
 */
const fieldTitleOf = (key?: string): string =>
  key ? (availableFields.value.find((f) => f.key === key)?.title ?? '') : ''

const toggleField = (field: FieldOption, checked: boolean) => {
  if (activeTab.value === 'search') {
    if (checked) addSearchItem(field)
    else searchItems.value = searchItems.value.filter((s) => s.field !== field.key)
    return
  }
  if (checked) addColumn(field)
  else columns.value = columns.value.filter((c) => columnKey(c) !== field.key)
}

/**
 * 批量操作
 *
 * 只作用于【当前筛选出来的】字段，不是全部 —— 搜了「金额」再点全选，
 * 预期是把这几个金额字段加上，而不是连带把另外八十个字段也塞进来。
 *
 * 先快照再改：isFieldSelected 读的是 computed，边遍历边增删会让它在中途重算，
 * 反选做到一半就开始拿新状态判断，结果是「反选了个寂寞」。
 */
const snapshotFields = () =>
  filteredFieldOptions.value.map((field) => ({ field, selected: isFieldSelected(field.key) }))

const selectAllFields = () => {
  snapshotFields().forEach(({ field, selected }) => {
    if (!selected) toggleField(field, true)
  })
}

const clearFields = () => {
  snapshotFields().forEach(({ field, selected }) => {
    if (selected) toggleField(field, false)
  })
}

const invertFields = () => {
  snapshotFields().forEach(({ field, selected }) => toggleField(field, !selected))
}

/**
 * 加一列
 *
 * 自动填入字段注释作为列标题，并按控件类型推断格式化方式，省掉两步手工配置。
 */
const addColumn = (fieldMeta: FieldOption) => {
  // 去掉 "(表单)" / "(关联-xxx)" / "(副表-xxx)" / "(明细-xxx)" / "(审计)" 等来源后缀
  const label = fieldMeta.title.replace(/\s*\([^)]+\)\s*$/, '')
  columns.value.push({
    field: fieldMeta.field,
    // 明细列带上所属子表控件，后端据此批量回查、前端据此展开成多行
    subField: fieldMeta.subField,
    label,
    width: 140,
    widthType: 'min',
    align: 'left',
    fixed: false,
    // 明细列不支持排序：排序作用在主表查询上，按明细值排主记录没有确定语义
    sortable: false,
    formatter: inferFormatter(fieldMeta.field, fieldMeta.subField)
  })
}

/**
 * 根据表单字段控件类型推断格式化方式
 *
 * 推断只是省事，用户随时可以在格式化对话框里改。
 * 推断不出来时不设格式化 —— 猜错比不猜更麻烦（比如把金额猜成百分比，值会差 100 倍）。
 */
const inferFormatter = (fieldName: string, subField?: string): any => {
  const formField = findRule(props.formFields ?? [], fieldName, subField)
  if (!formField) return undefined

  const controlType = formField.type
  const props_ = formField.props || {}

  // 上传类：图片与附件的渲染方式不同，按控件分开
  if (['UploadImg', 'UploadImgs', 'Signature'].includes(controlType)) {
    return { type: 'IMAGE' }
  }
  if (controlType === 'UploadFile') {
    return { type: 'FILE' }
  }

  // 字典类控件：select / radio / checkbox / DictSelect
  if (['select', 'radio', 'checkbox', 'DictSelect'].includes(controlType)) {
    // 尝试从控件配置里提取字典类型（dictType / __config__.dictType 等）
    const dictType = formField.dictType || formField.__config__?.dictType || props_.dictType
    if (dictType) {
      return { type: 'DICT', dictType }
    }
    // 没配字典类型时也标记为 DICT，用户后续手动填
    return { type: 'DICT', dictType: '' }
  }

  // 日期选择器
  if (controlType === 'datePicker') {
    const pickerType = props_.type || 'date'
    if (pickerType === 'datetime') {
      return { type: 'DATETIME' }
    }
    return { type: 'DATE' }
  }

  // 时间选择器（只有时间没日期，用 DATETIME 格式化会丢信息，暂不自动设置）
  // if (controlType === 'timePicker') {
  //   return { type: 'TIME' }
  // }

  // 开关
  if (controlType === 'switch') {
    return { type: 'BOOLEAN' }
  }

  // 数字输入。评分与滑块也是数字，但它们的取值范围小，不需要千分位
  if (controlType === 'inputNumber') {
    return { type: 'NUMBER', precision: 2, thousands: false }
  }
  if (['rate', 'slider'].includes(controlType)) {
    return { type: 'NUMBER', precision: 0, thousands: false }
  }

  // 其它控件不自动设置格式化
  return undefined
}

/**
 * 加一个查询项
 *
 * 标签取字段的中文名，查询控件与操作符按控件类型推断 ——
 * 推断在设计期做、结果写进配置，运行时不再读规则树。
 * 两处各推断一次的话，改了一边忘了另一边就会出现
 * 「设计器里配的是下拉、发布出去是文本框」这种查不出原因的漂移。
 *
 * 关联列 / 副表列 / 审计列在规则树里没有对应控件，findRule 返回 undefined，
 * inferSearchWidget 会回落到文本框 —— 对这些列正是想要的行为。
 */
const addSearchItem = (fieldMeta: FieldOption) => {
  const rule = findRule(props.formFields ?? [], fieldMeta.field)
  const { widget, dictType } = inferSearchWidget(rule)
  searchItems.value.push({
    field: fieldMeta.field,
    label: fieldMeta.title.replace(/\s*\([^)]+\)\s*$/, ''),
    widget,
    dictType,
    operator: coerceOperator(widget, 'LIKE')
  })
}

/**
 * 选了下拉查询却没配字典类型的查询项
 *
 * 这种配置运行时会退化成文本框（没有字典就没有选项可渲染），
 * 属于典型的「配了但不生效」，必须在设计期就说出来。
 */
const searchItemsMissingDict = computed(() =>
  searchItems.value
    .filter((s) => s.field && s.widget === 'SELECT' && !s.dictType)
    .map((s) => s.label || s.field)
)

/**
 * 切换查询控件类型
 *
 * 操作符要跟着归一：留着一个该控件下不成立的操作符（比如日期区间 + 包含），
 * 是配得出来但永远查不到东西的组合。
 * 不是下拉了就把字典类型清掉，免得配置里留一个没人用的键。
 */
const handleSearchWidgetChange = (widget: SearchWidgetType, row: any) => {
  row.operator = coerceOperator(widget, row.operator)
  if (widget !== 'SELECT') {
    row.dictType = undefined
  }
}

/** 收集配置，由父组件调用 */
const collect = () => {
  // 存之前再归一一次：用户可能先开树形、再从别的页签绕回来开分页
  normalizeTreeAndPagination()
  const listConf = {
    columns: columns.value.filter((c) => c.field),
    searchItems: searchItems.value.filter((s) => s.field),
    pagination: pagination.value,
    defaultSort: defaultSort.value.field ? defaultSort.value : undefined,
    // 按钮清单存进 operationColumn.buttons：键名沿用旧的那个，
    // 让「装了新前端、后端还是旧的」与反过来的组合都不至于把按钮配置弄丢
    operationColumn: { ...operationColumn.value, buttons: buttonList.value },
    showSummary: showSummary.value,
    summaryColumns: summaryColumns.value,
    showIndexColumn: showIndexColumn.value,
    formViewMode: formViewMode.value,
    // 未启用或没配字段时不写进配置，避免运行时渲染空标签栏
    tabConfig: tabConfig.value.enabled && tabConfig.value.field ? tabConfig.value : undefined,
    // 同理，没配父级字段的树形配置是无效的
    treeConfig:
      treeConfig.value.enabled && treeConfig.value.parentField ? treeConfig.value : undefined,
    // 字典源要有 dictType，字段源只要有 field
    leftTree: isLeftTreeValid() ? leftTree.value : undefined,
    // 只保留填了名字且选了列的分组，空分组会渲染出一个空表头
    complexHeaders: complexHeaderEnabled.value
      ? complexHeaders.value.filter((g) => g.label && g.children.length > 0)
      : undefined,
    // 一列都没勾时不写进配置：开着开关却没有可编辑的列，运行时会多出一套
    // 进得去出不来的编辑态按钮
    inlineEdit:
      inlineEdit.value.enabled && editableColumns(columns.value).length > 0
        ? inlineEdit.value
        : undefined,
    // 没选分组字段的配置是无效的，不写进去 —— 运行时会把它当没开，
    // 但存着一份「开了却没字段」的配置会让下次打开设计器时显示成已启用
    rowGroup:
      rowGroup.value.enabled && rowGroup.value.field && rowGroupAvailable.value
        ? rowGroup.value
        : undefined,
    // 没开时不写进配置，存量表单的 listConf 里也就不会多出一个恒为 false 的键
    columnSetting: columnSetting.value.enabled ? columnSetting.value : undefined
  }
  props.modelData.listConf = JSON.stringify(listConf)
}

/** 左侧树配置是否完整可用 */
const isLeftTreeValid = () => {
  if (!leftTree.value.enabled || !leftTree.value.field) return false
  return leftTree.value.dataSource !== 'DICT' || !!leftTree.value.dictType
}

/** 回显，由父组件调用 */
const restore = () => {
  if (!props.modelData.listConf) return
  try {
    const conf = JSON.parse(props.modelData.listConf)
    columns.value = conf.columns || []
    searchItems.value = migrateSearchItems(conf.searchItems || [])
    initSearchSortable()
    pagination.value = conf.pagination || { enabled: true, pageSize: 20 }
    defaultSort.value = conf.defaultSort || { field: '', order: 'asc' }
    const stored = conf.operationColumn || {}
    operationColumn.value = {
      show: stored.show !== false,
      label: stored.label || '操作',
      width: stored.width || 160,
      // 存量配置里没有这个键。回落到默认阈值而不是「不折叠」——
      // 折叠只是把多出来的按钮换个位置，不会让任何按钮消失
      maxInline: normalizeMaxInline(stored.maxInline)
    }
    // normalizeButtons 同时吃旧的字符串数组与新的对象清单，
    // 并保证结果一定含全部内置按钮 —— 少一项会让它在设计器里整个消失
    buttonList.value = normalizeButtons(stored.buttons)
    initButtonSortable()
    showSummary.value = conf.showSummary || false
    summaryColumns.value = migrateSummaryColumns(conf.summaryColumns || [])
    // 存量配置里没有这两个键：序号缺省显示，呈现方式缺省居中弹窗 ——
    // 后者是改造前的唯一行为，回落到它不会让已发布的表单看起来变了样
    showIndexColumn.value = conf.showIndexColumn !== false
    formViewMode.value = parseFormViewMode(conf.formViewMode)
    tabConfig.value = conf.tabConfig || { enabled: false, field: '', tabs: [] }
    treeConfig.value = conf.treeConfig || { enabled: false, parentField: '', rowKey: 'id' }
    columnSetting.value = { enabled: !!conf.columnSetting?.enabled }
    rowGroup.value = {
      enabled: !!conf.rowGroup?.enabled,
      field: conf.rowGroup?.field || '',
      // 存量配置里没有这个键。缺省显示条数 —— 分组行上只有组名没有条数，
      // 用户第一件想知道的事就没了
      showCount: conf.rowGroup?.showCount !== false,
      summaryFields: Array.isArray(conf.rowGroup?.summaryFields)
        ? conf.rowGroup.summaryFields
        : [],
      defaultExpand: conf.rowGroup?.defaultExpand === 'NONE' ? 'NONE' : 'ALL'
    }
    leftTree.value = conf.leftTree || {
      enabled: false,
      dataSource: 'DICT',
      dictType: '',
      field: '',
      title: ''
    }
    complexHeaders.value = conf.complexHeaders || []
    complexHeaderEnabled.value = complexHeaders.value.length > 0
    inlineEdit.value = conf.inlineEdit || { enabled: false }
    normalizeTreeAndPagination()
    // 回显之后表格才第一次真的渲染出来（之前是 el-empty），这时候才量得到位置
    fitTableHeight()
  } catch (e) {
    console.warn('list_conf 解析失败', e)
  }
}

/**
 * 查询项的旧配置迁移：补上 widget
 *
 * 查询区改造前，查询项只有 `{field, label, operator}`，运行时一律渲染成文本框。
 * 这里按字段控件类型补出查询控件，但**保住原有语义** ——
 * 推断出区间控件而旧操作符不是 BETWEEN 时降级成单值，
 * 否则一次「完善」会把已发布表单的查询结果改掉。
 */
const migrateSearchItems = (stored: any[]): any[] =>
  stored.map((item) => {
    if (item.widget) return item
    const rule = findRule(props.formFields ?? [], item.field)
    return { ...item, ...backfillSearchWidget(item, rule) }
  })

/**
 * 合计列的旧配置迁移：裸 field → 复合 key
 *
 * 早期存的是裸 field，主表的 amount 与明细表的 amount 在配置里长得一模一样。
 * 能唯一对上某一列就补成复合 key，对上多列时保持原样 ——
 * 猜错会让合计悄悄算到另一列上，比不迁移更糟。
 */
const migrateSummaryColumns = (stored: string[]): string[] =>
  stored.map((value) => {
    if (columns.value.some((c) => columnKey(c) === value)) return value
    const hits = columns.value.filter((c) => c.field === value)
    return hits.length === 1 ? columnKey(hits[0]) : value
  })

/**
 * 树形与分页的互斥归一
 *
 * 两个开关的回调各自关掉对方，但那只在用户点开关时生效。
 * 历史配置、或直接改过 JSON 的配置可能两者同时为 true，
 * 而运行时对「既分页又树形」没有确定行为 —— 分页会把父行留在上一页、
 * 子行推到下一页，子行于是从树里整个消失，且不报错。
 * 以树形为准：它是更强的结构性要求，配了树形的人一定是想看层级。
 */
const normalizeTreeAndPagination = () => {
  if (treeConfig.value.enabled && pagination.value.enabled) {
    pagination.value.enabled = false
  }
}

defineExpose({ collect, restore })

/**
 * 回显时机
 *
 * 不能用 onMounted —— 本组件被父组件 v-show 控制，父组件挂载时它就一起挂载了，
 * 那时父组件的异步 loadData() 还没返回，listConf 是空的，restore() 什么都做不了。
 * 必须监听数据真正到达的时刻。
 */
useStepRestore(
  computed(() => props.modelData),
  restore,
  (data) => [data.listConf]
)
</script>

<style lang="scss" scoped>
.step-list-design {
  position: relative;
  display: flex;
  gap: 12px;
  align-items: flex-start;
  color: var(--el-text-color-regular);
}

.main-board {
  flex: 1;
  /*
    没有它，flex 子项的最小尺寸是内容宽度 —— 列配置那张表有十来列，
    会把右侧面板整个挤出容器
  */
  min-width: 0;
}

.right-board {
  flex-shrink: 0;
  width: 300px;
  /* 与左侧页签头对齐，不然面板会比表格高出一个页签条 */
  margin-top: 4px;
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 190px);
  background-color: var(--el-fill-color-blank);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
  overflow: hidden;
}

.right-board-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  font-size: 14px;
  font-weight: 500;
  color: var(--el-text-color-primary);
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.right-board-count {
  font-size: 12px;
  font-weight: 400;
  color: var(--el-text-color-secondary);
}

.right-board-filter {
  padding: 10px 12px 6px;
}

.right-board-actions {
  display: flex;
  gap: 10px;
  margin-top: 6px;
}

.right-board-list {
  flex: 1;
  min-height: 120px;
  overflow-y: auto;
  padding: 4px 0 8px;
}

/*
  一行一个字段

  原先是 33% 宽的三列。字段标题带着来源后缀（「订单金额 (明细-biz_order_item)」），
  一格只有一百来像素，长名字被截断之后，两个只差后缀的字段看起来一模一样。
*/
.field-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 12px;
  cursor: pointer;
  font-weight: 400;

  &:hover {
    background-color: var(--el-fill-color-light);
  }

  &.is-checked {
    background-color: var(--el-color-primary-light-9);
  }
}

.field-row-title {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: var(--el-text-color-regular);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 左侧表格里只读展示的字段名 */
.field-name {
  font-size: 13px;
  color: var(--el-text-color-regular);
}

.form-tip {
  width: 100%;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
  margin-top: 4px;
}

/*
  配置表单限宽

  这几个页签里的表单是铺满主板的，而主板要给「列配置」那张十来列的表格留宽度 ——
  于是「排序字段」这种只会选一个字段的下拉被拉成了 900px 的一条长线，
  与它右边一大片空白一起显得很散。限到 760px，与「数据绑定」那一步的观感对齐。
*/
.config-form {
  max-width: 760px;
}

.col-drag-handle {
  color: var(--el-text-color-secondary);
  cursor: move;
}

/*
  合计列那一格

  它套在 inline 表单的 form-item 里，而 form-item 是 inline-flex —— 不给
  外层一个确定宽度，里面的提示文字会把整格撑成一条长线，挤掉右边的表单项。
*/
.summary-picker {
  width: 420px;
}

/*
  配置表格的行高

  这几张表里全是 small 尺寸的输入框与下拉，没有任何一格会把行撑开，
  于是整张表挤成一叠细线，逐行核对时容易串行。补上下内边距拉开密度。
*/
.config-table :deep(.el-table__cell) {
  padding: 8px 0;
}

.config-table :deep(.el-table__header-wrapper th) {
  background-color: var(--el-fill-color-light);
}

/*
  兜底：inline 表单里的下拉不许塌成窄缝

  el-select 默认 width:100%，而 inline 表单的 form-item 宽度由内容决定 ——
  这个循环的解是「塌到最小」。上面几处都写了确定宽度，这一条是给
  以后新加的表单项兜底，免得同一个坑再踩一次。
*/
.step-list-design :deep(.el-form--inline .el-form-item__content .el-select) {
  min-width: 200px;
}
</style>
