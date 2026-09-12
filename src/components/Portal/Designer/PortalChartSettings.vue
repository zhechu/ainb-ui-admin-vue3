<template>
  <div class="portal-chart-settings">
    <template v-if="type === 'dataBoard'">
      <el-divider content-position="left">数据面板设置</el-divider>
      <PortalDataSourceFields
        :type="type"
        :model-value="modelValue"
        @update:model-value="updateValues"
      />
      <el-row :gutter="8">
        <el-col :span="12">
          <el-form-item label="每行数量">
            <el-input-number
              :model-value="modelValue.columns || 4"
              :min="1"
              :max="8"
              controls-position="right"
              class="w-full"
              @update:model-value="update('columns', $event)"
            />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="显示边框">
            <el-switch
              :model-value="modelValue.showBorder === true"
              @change="update('showBorder', $event)"
            />
          </el-form-item>
        </el-col>
      </el-row>
      <el-row :gutter="8">
        <el-col :span="12">
          <el-form-item label="名称字号">
            <el-input-number
              :model-value="modelValue.labelFontSize || 13"
              :min="10"
              :max="25"
              controls-position="right"
              class="w-full"
              @update:model-value="update('labelFontSize', $event)"
            />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="数值字号">
            <el-input-number
              :model-value="modelValue.valueFontSize || 22"
              :min="12"
              :max="40"
              controls-position="right"
              class="w-full"
              @update:model-value="update('valueFontSize', $event)"
            />
          </el-form-item>
        </el-col>
      </el-row>
      <el-row :gutter="8">
        <el-col :span="12">
          <el-form-item label="名称颜色">
            <el-color-picker
              :model-value="modelValue.labelFontColor || '#667085'"
              show-alpha
              @update:model-value="update('labelFontColor', $event)"
            />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="数值颜色">
            <el-color-picker
              :model-value="modelValue.valueFontColor || '#172033'"
              show-alpha
              @update:model-value="update('valueFontColor', $event)"
            />
          </el-form-item>
        </el-col>
      </el-row>
      <el-form-item v-if="modelValue.dataMode !== 'dynamic'" label="指标数据 JSON">
        <el-input v-model="dataText" type="textarea" :rows="10" @blur="syncArray('items')" />
      </el-form-item>
    </template>

    <template v-if="type === 'tableList'">
      <el-divider content-position="left">表格列表设置</el-divider>
      <PortalDataSourceFields
        :type="type"
        :model-value="modelValue"
        @update:model-value="updateValues"
      />
      <el-form-item label="展示样式">
        <el-select
          :model-value="modelValue.tableStyleType || 1"
          class="w-full"
          @change="update('tableStyleType', $event)"
        >
          <el-option label="表格" :value="1" />
          <el-option label="列表（横向）" :value="2" />
          <el-option label="列表（纵向）" :value="3" />
        </el-select>
      </el-form-item>
      <el-row :gutter="8">
        <el-col :span="12">
          <el-form-item label="表格尺寸">
            <el-select
              :model-value="modelValue.tableSize || 'small'"
              class="w-full"
              @change="update('tableSize', $event)"
            >
              <el-option label="大" value="large" />
              <el-option label="默认" value="default" />
              <el-option label="小" value="small" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="最大行数">
            <el-input-number
              :model-value="modelValue.tableMaxRows || 50"
              :min="1"
              :max="100"
              controls-position="right"
              class="w-full"
              @update:model-value="update('tableMaxRows', $event)"
            />
          </el-form-item>
        </el-col>
      </el-row>
      <el-row :gutter="8">
        <el-col :span="8">
          <el-form-item label="显示序号">
            <el-switch
              :model-value="modelValue.tableShowIndex !== false"
              @change="update('tableShowIndex', $event)"
            />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="表头颜色">
            <el-color-picker
              :model-value="modelValue.headerBackgroundColor || '#f3f6f9'"
              show-alpha
              @update:model-value="update('headerBackgroundColor', $event)"
            />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="行文字颜色">
            <el-color-picker
              :model-value="modelValue.rowFontColor || '#606266'"
              show-alpha
              @update:model-value="update('rowFontColor', $event)"
            />
          </el-form-item>
        </el-col>
      </el-row>
      <el-row :gutter="8">
        <el-col :span="8">
          <el-form-item label="表头">
            <el-switch
              :model-value="modelValue.tableShowHeader !== false"
              @change="update('tableShowHeader', $event)"
            />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="边框">
            <el-switch
              :model-value="modelValue.tableBorder === true"
              @change="update('tableBorder', $event)"
            />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="斑马纹">
            <el-switch
              :model-value="modelValue.tableStripe !== false"
              @change="update('tableStripe', $event)"
            />
          </el-form-item>
        </el-col>
      </el-row>
      <el-form-item label="列配置 JSON">
        <el-input v-model="columnsText" type="textarea" :rows="7" @blur="syncArray('columns')" />
      </el-form-item>
      <el-form-item v-if="modelValue.dataMode !== 'dynamic'" label="表格数据 JSON">
        <el-input v-model="dataText" type="textarea" :rows="9" @blur="syncArray('rows')" />
      </el-form-item>
    </template>

    <template v-if="standardChart">
      <el-divider content-position="left">{{ chartSettingsTitle }}</el-divider>
      <el-form-item label="风格类型">
        <el-select
          :model-value="modelValue.styleType || 1"
          class="w-full"
          @change="update('styleType', $event)"
        >
          <el-option
            v-for="option in styleOptions"
            :key="option.value"
            :label="option.label"
            :value="option.value"
          />
        </el-select>
      </el-form-item>
      <el-row v-if="type === 'chart.bar'" :gutter="8">
        <el-col :span="12">
          <el-form-item label="堆叠显示">
            <el-switch
              :model-value="modelValue.barStack === true"
              @change="update('barStack', $event)"
            />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="柱体间距">
            <el-input
              :model-value="modelValue.barGap || '30%'"
              @update:model-value="update('barGap', $event)"
            />
          </el-form-item>
        </el-col>
      </el-row>
      <el-divider v-if="type === 'chart.bar'" content-position="left">柱体设置</el-divider>
      <el-row v-if="type === 'chart.bar'" :gutter="8">
        <el-col :span="12">
          <el-form-item label="柱体宽度">
            <el-input-number
              :model-value="modelValue.barWidth || 28"
              :min="0"
              :max="100"
              controls-position="right"
              class="w-full"
              @update:model-value="update('barWidth', $event)"
            />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="柱体圆角">
            <el-input-number
              :model-value="modelValue.barRadius || 3"
              :min="0"
              :max="50"
              controls-position="right"
              class="w-full"
              @update:model-value="update('barRadius', $event)"
            />
          </el-form-item>
        </el-col>
      </el-row>
      <el-row v-if="type === 'chart.line'" :gutter="8">
        <el-col :span="12">
          <el-form-item label="线条宽度">
            <el-input-number
              :model-value="modelValue.lineWidth || 2"
              :min="1"
              :max="10"
              controls-position="right"
              class="w-full"
              @update:model-value="update('lineWidth', $event)"
            />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="平滑曲线">
            <el-switch
              :model-value="modelValue.lineSmooth !== false"
              @change="update('lineSmooth', $event)"
            />
          </el-form-item>
        </el-col>
      </el-row>
      <el-row v-if="type === 'chart.line'" :gutter="8">
        <el-col :span="12">
          <el-form-item label="显示面积">
            <el-switch
              :model-value="modelValue.lineArea === true"
              @change="update('lineArea', $event)"
            />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="标记大小">
            <el-input-number
              :model-value="modelValue.lineSymbolSize || 7"
              :min="0"
              :max="30"
              controls-position="right"
              class="w-full"
              @update:model-value="update('lineSymbolSize', $event)"
            />
          </el-form-item>
        </el-col>
      </el-row>
      <template v-if="type === 'chart.pie'">
        <el-row :gutter="8">
          <el-col :span="12">
            <el-form-item label="内半径">
              <el-input-number
                :model-value="modelValue.pieInnerRadius || 0"
                :min="0"
                :max="90"
                controls-position="right"
                class="w-full"
                @update:model-value="update('pieInnerRadius', $event)"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="外半径">
              <el-input-number
                :model-value="modelValue.pieOuterRadius || 68"
                :min="10"
                :max="95"
                controls-position="right"
                class="w-full"
                @update:model-value="update('pieOuterRadius', $event)"
              />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="8">
          <el-col :span="12">
            <el-form-item label="玫瑰图">
              <el-switch
                :model-value="modelValue.pieRose === true"
                @change="update('pieRose', $event)"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="标签位置">
              <el-select
                :model-value="modelValue.pieLabelPosition || 'outside'"
                class="w-full"
                @change="update('pieLabelPosition', $event)"
              >
                <el-option label="外部" value="outside" />
                <el-option label="内部" value="inside" />
                <el-option label="中心" value="center" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
      </template>
      <template v-if="type === 'chart.radar'">
        <el-row :gutter="8">
          <el-col :span="12">
            <el-form-item label="指标最大值">
              <el-input-number
                :model-value="modelValue.radarMax || 100"
                :min="1"
                :max="1000000"
                controls-position="right"
                class="w-full"
                @update:model-value="update('radarMax', $event)"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="图形形状">
              <el-select
                :model-value="modelValue.radarShape || 'polygon'"
                class="w-full"
                @change="update('radarShape', $event)"
              >
                <el-option label="多边形" value="polygon" />
                <el-option label="圆形" value="circle" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="区域透明度">
          <el-slider
            :model-value="Number(modelValue.radarAreaOpacity ?? 0.25)"
            :min="0"
            :max="1"
            :step="0.05"
            @update:model-value="update('radarAreaOpacity', $event)"
          />
        </el-form-item>
      </template>

      <template v-if="type === 'chart.pie' || type === 'chart.radar'">
        <el-divider content-position="left">中心坐标设置</el-divider>
        <el-row :gutter="8">
          <el-col :span="12">
            <el-form-item label="中心横向位置">
              <el-input-number
                :model-value="modelValue.centerX || 50"
                :min="0"
                :max="100"
                controls-position="right"
                class="w-full"
                @update:model-value="update('centerX', $event)"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="中心纵向位置">
              <el-input-number
                :model-value="modelValue.centerY || 50"
                :min="0"
                :max="100"
                controls-position="right"
                class="w-full"
                @update:model-value="update('centerY', $event)"
              />
            </el-form-item>
          </el-col>
        </el-row>
      </template>

      <el-divider content-position="left">图表标题设置</el-divider>
      <el-form-item label="主标题">
        <el-input
          :model-value="modelValue.chartTitle"
          placeholder="留空则使用卡片标题"
          @update:model-value="update('chartTitle', $event)"
        />
      </el-form-item>
      <el-row :gutter="8">
        <el-col :span="12">
          <el-form-item label="标题字号">
            <el-input-number
              :model-value="modelValue.chartTitleSize || 18"
              :min="12"
              :max="30"
              controls-position="right"
              class="w-full"
              @update:model-value="update('chartTitleSize', $event)"
            />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="标题位置">
            <el-select
              :model-value="modelValue.chartTitleAlign || 'center'"
              class="w-full"
              @change="update('chartTitleAlign', $event)"
            >
              <el-option label="左侧" value="left" />
              <el-option label="居中" value="center" />
              <el-option label="右侧" value="right" />
            </el-select>
          </el-form-item>
        </el-col>
      </el-row>
      <el-row :gutter="8">
        <el-col :span="12">
          <el-form-item label="标题颜色">
            <el-color-picker
              :model-value="modelValue.chartTitleColor || '#303133'"
              show-alpha
              @update:model-value="update('chartTitleColor', $event)"
            />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="标题加粗">
            <el-switch
              :model-value="modelValue.chartTitleWeight !== false"
              @change="update('chartTitleWeight', $event)"
            />
          </el-form-item>
        </el-col>
      </el-row>

      <el-divider content-position="left">图表副标题设置</el-divider>
      <el-form-item label="副标题">
        <el-input
          :model-value="modelValue.chartSubtitle"
          @update:model-value="update('chartSubtitle', $event)"
        />
      </el-form-item>
      <el-row :gutter="8">
        <el-col :span="12">
          <el-form-item label="副标题字号">
            <el-input-number
              :model-value="modelValue.chartSubtitleSize || 12"
              :min="10"
              :max="24"
              controls-position="right"
              class="w-full"
              @update:model-value="update('chartSubtitleSize', $event)"
            />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="副标题颜色">
            <el-color-picker
              :model-value="modelValue.chartSubtitleColor || '#667085'"
              show-alpha
              @update:model-value="update('chartSubtitleColor', $event)"
            />
          </el-form-item>
        </el-col>
      </el-row>

      <template v-if="axisChart">
        <el-divider content-position="left">X 轴设置</el-divider>
        <el-row :gutter="8">
          <el-col :span="12">
            <el-form-item label="显示 X 轴">
              <el-switch
                :model-value="modelValue.xAxisShow !== false"
                @change="update('xAxisShow', $event)"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="标签旋转角度">
              <el-input-number
                :model-value="modelValue.xAxisLabelRotate || 0"
                :min="-90"
                :max="90"
                controls-position="right"
                class="w-full"
                @update:model-value="update('xAxisLabelRotate', $event)"
              />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="X 轴名称">
          <el-input
            :model-value="modelValue.xAxisName"
            @update:model-value="update('xAxisName', $event)"
          />
        </el-form-item>
        <el-row :gutter="8">
          <el-col :span="12">
            <el-form-item label="标签字号">
              <el-input-number
                :model-value="modelValue.xAxisLabelSize || 12"
                :min="10"
                :max="24"
                controls-position="right"
                class="w-full"
                @update:model-value="update('xAxisLabelSize', $event)"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="显示网格线">
              <el-switch
                :model-value="modelValue.xAxisSplitLineShow === true"
                @change="update('xAxisSplitLineShow', $event)"
              />
            </el-form-item>
          </el-col>
        </el-row>

        <el-divider content-position="left">Y 轴设置</el-divider>
        <el-row :gutter="8">
          <el-col :span="12">
            <el-form-item label="显示 Y 轴">
              <el-switch
                :model-value="modelValue.yAxisShow !== false"
                @change="update('yAxisShow', $event)"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="反向显示">
              <el-switch
                :model-value="modelValue.yAxisInverse === true"
                @change="update('yAxisInverse', $event)"
              />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="Y 轴名称">
          <el-input
            :model-value="modelValue.yAxisName"
            @update:model-value="update('yAxisName', $event)"
          />
        </el-form-item>
        <el-row :gutter="8">
          <el-col :span="12">
            <el-form-item label="标签字号">
              <el-input-number
                :model-value="modelValue.yAxisLabelSize || 12"
                :min="10"
                :max="24"
                controls-position="right"
                class="w-full"
                @update:model-value="update('yAxisLabelSize', $event)"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="显示网格线">
              <el-switch
                :model-value="modelValue.yAxisSplitLineShow !== false"
                @change="update('yAxisSplitLineShow', $event)"
              />
            </el-form-item>
          </el-col>
        </el-row>
      </template>

      <el-divider content-position="left">数值设置</el-divider>
      <el-row :gutter="8">
        <el-col :span="12">
          <el-form-item label="显示数值">
            <el-switch
              :model-value="modelValue.valueShow !== false"
              @change="update('valueShow', $event)"
            />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="数值位置">
            <el-select
              :model-value="modelValue.valuePosition || 'top'"
              class="w-full"
              @change="update('valuePosition', $event)"
            >
              <el-option label="顶部" value="top" />
              <el-option label="内部" value="inside" />
              <el-option label="外部" value="outside" />
            </el-select>
          </el-form-item>
        </el-col>
      </el-row>
      <el-row :gutter="8">
        <el-col :span="12">
          <el-form-item label="数值字号">
            <el-input-number
              :model-value="modelValue.valueSize || 12"
              :min="10"
              :max="30"
              controls-position="right"
              class="w-full"
              @update:model-value="update('valueSize', $event)"
            />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="数值颜色">
            <el-color-picker
              :model-value="modelValue.valueColor || '#303133'"
              show-alpha
              @update:model-value="update('valueColor', $event)"
            />
          </el-form-item>
        </el-col>
      </el-row>

      <el-divider content-position="left">提示语设置</el-divider>
      <el-row :gutter="8">
        <el-col :span="12">
          <el-form-item label="显示提示语">
            <el-switch
              :model-value="modelValue.tooltipShow !== false"
              @change="update('tooltipShow', $event)"
            />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="触发方式">
            <el-select
              :model-value="modelValue.tooltipTrigger || (type === 'chart.pie' ? 'item' : 'axis')"
              class="w-full"
              @change="update('tooltipTrigger', $event)"
            >
              <el-option label="坐标轴" value="axis" />
              <el-option label="数据项" value="item" />
            </el-select>
          </el-form-item>
        </el-col>
      </el-row>
      <el-row :gutter="8">
        <el-col :span="12">
          <el-form-item label="字号">
            <el-input-number
              :model-value="modelValue.tooltipSize || 12"
              :min="10"
              :max="30"
              controls-position="right"
              class="w-full"
              @update:model-value="update('tooltipSize', $event)"
            />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="文字颜色">
            <el-color-picker
              :model-value="modelValue.tooltipColor || '#ffffff'"
              show-alpha
              @update:model-value="update('tooltipColor', $event)"
            />
          </el-form-item>
        </el-col>
      </el-row>

      <el-divider v-if="axisChart" content-position="left">坐标轴边距设置</el-divider>
      <el-row v-if="axisChart" :gutter="8">
        <el-col v-for="field in marginFields" :key="field.key" :span="12">
          <el-form-item :label="field.label">
            <el-input-number
              :model-value="modelValue[field.key] || field.defaultValue"
              :min="0"
              :max="400"
              controls-position="right"
              class="w-full"
              @update:model-value="update(field.key, $event)"
            />
          </el-form-item>
        </el-col>
      </el-row>

      <el-divider content-position="left">图例设置</el-divider>
      <el-row :gutter="8">
        <el-col :span="8">
          <el-form-item label="显示图例">
            <el-switch
              :model-value="modelValue.legendShow !== false"
              @change="update('legendShow', $event)"
            />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="布局方向">
            <el-select
              :model-value="modelValue.legendOrient || 'horizontal'"
              class="w-full"
              @change="update('legendOrient', $event)"
            >
              <el-option label="水平" value="horizontal" />
              <el-option label="垂直" value="vertical" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="字号">
            <el-input-number
              :model-value="modelValue.legendSize || 12"
              :min="10"
              :max="30"
              controls-position="right"
              class="w-full"
              @update:model-value="update('legendSize', $event)"
            />
          </el-form-item>
        </el-col>
      </el-row>

      <el-divider content-position="left">自定义配色设置</el-divider>
      <el-form-item label="配色 JSON">
        <el-input
          v-model="colorsText"
          type="textarea"
          :rows="4"
          :placeholder="`例如：[&quot;#3473ff&quot;, &quot;#16a085&quot;]`"
          @blur="syncArray('colors')"
        />
      </el-form-item>

      <el-divider content-position="left">数据设置</el-divider>
      <PortalDataSourceFields
        :type="type"
        :model-value="modelValue"
        @update:model-value="updateValues"
      />
      <el-form-item v-if="modelValue.dataMode !== 'dynamic'" label="分类数据（逗号分隔）">
        <el-input
          :model-value="(modelValue.categories || []).join(',')"
          @update:model-value="updateChartData('categories', splitText($event))"
        />
      </el-form-item>
      <el-form-item v-if="modelValue.dataMode !== 'dynamic'" label="数值数据（逗号分隔）">
        <el-input
          :model-value="(modelValue.values || []).join(',')"
          @update:model-value="updateChartData('values', numberList($event))"
        />
      </el-form-item>
      <el-form-item v-if="modelValue.dataMode !== 'dynamic'" label="数据项 JSON">
        <el-input v-model="dataText" type="textarea" :rows="9" @blur="syncArray('dataItems')" />
      </el-form-item>
    </template>

    <template v-if="type === 'rankList'">
      <el-divider content-position="left">排行榜设置</el-divider>
      <el-form-item label="风格类型">
        <el-select
          :model-value="modelValue.styleType || 1"
          class="w-full"
          @change="update('styleType', $event)"
        >
          <el-option label="基础" :value="1" />
          <el-option label="勋章" :value="2" />
          <el-option label="奖杯" :value="3" />
          <el-option label="奖牌" :value="4" />
        </el-select>
      </el-form-item>
      <el-row :gutter="8">
        <el-col :span="12">
          <el-form-item label="显示条数">
            <el-input-number
              :model-value="modelValue.rankLimit || 10"
              :min="1"
              :max="50"
              controls-position="right"
              class="w-full"
              @update:model-value="update('rankLimit', $event)"
            />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="显示名次">
            <el-switch
              :model-value="modelValue.showRankNumber !== false"
              @change="update('showRankNumber', $event)"
            />
          </el-form-item>
        </el-col>
      </el-row>
      <el-form-item label="数值后缀">
        <el-input
          :model-value="modelValue.valueSuffix"
          @update:model-value="update('valueSuffix', $event)"
        />
      </el-form-item>
      <el-divider content-position="left">数据设置</el-divider>
      <PortalDataSourceFields
        :type="type"
        :model-value="modelValue"
        @update:model-value="updateValues"
      />
      <el-form-item v-if="modelValue.dataMode !== 'dynamic'" label="排行榜数据 JSON">
        <el-input v-model="dataText" type="textarea" :rows="9" @blur="syncArray('items')" />
      </el-form-item>
    </template>

    <template v-if="type === 'timeAxis'">
      <el-divider content-position="left">时间轴设置</el-divider>
      <el-form-item label="风格类型">
        <el-select
          :model-value="modelValue.styleType || 1"
          class="w-full"
          @change="update('styleType', $event)"
        >
          <el-option label="基础" :value="1" />
          <el-option label="卡片" :value="2" />
        </el-select>
      </el-form-item>
      <el-row :gutter="8">
        <el-col :span="12">
          <el-form-item label="布局方式">
            <el-select
              :model-value="modelValue.timelineLayout || 'alternate'"
              class="w-full"
              @change="update('timelineLayout', $event)"
            >
              <el-option label="左右交错" value="alternate" />
              <el-option label="时间在左" value="left" />
              <el-option label="时间在右" value="right" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="排序方式">
            <el-select
              :model-value="modelValue.timelineSort || 'asc'"
              class="w-full"
              @change="update('timelineSort', $event)"
            >
              <el-option label="正序" value="asc" />
              <el-option label="倒序" value="desc" />
            </el-select>
          </el-form-item>
        </el-col>
      </el-row>
      <el-form-item label="显示条数">
        <el-input-number
          :model-value="modelValue.timelineLimit || 50"
          :min="1"
          :max="200"
          controls-position="right"
          class="w-full"
          @update:model-value="update('timelineLimit', $event)"
        />
      </el-form-item>
      <el-row :gutter="8">
        <el-col :span="12">
          <el-form-item label="显示时间">
            <el-switch
              :model-value="modelValue.timelineShowTime !== false"
              @change="update('timelineShowTime', $event)"
            />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="显示序号">
            <el-switch
              :model-value="modelValue.timelineShowIndex === true"
              @change="update('timelineShowIndex', $event)"
            />
          </el-form-item>
        </el-col>
      </el-row>
      <el-row :gutter="8">
        <el-col :span="12">
          <el-form-item label="节点颜色">
            <el-color-picker
              :model-value="modelValue.timelineNodeColor || '#3473ff'"
              show-alpha
              @update:model-value="update('timelineNodeColor', $event)"
            />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="连线颜色">
            <el-color-picker
              :model-value="modelValue.timelineLineColor || '#d5deeb'"
              show-alpha
              @update:model-value="update('timelineLineColor', $event)"
            />
          </el-form-item>
        </el-col>
      </el-row>
      <el-divider content-position="left">数据设置</el-divider>
      <PortalDataSourceFields
        :type="type"
        :model-value="modelValue"
        @update:model-value="updateValues"
      />
      <el-form-item v-if="modelValue.dataMode !== 'dynamic'" label="时间轴数据 JSON">
        <el-input v-model="dataText" type="textarea" :rows="9" @blur="syncArray('items')" />
      </el-form-item>
    </template>

    <template v-if="type === 'mapChart'">
      <el-divider content-position="left">地图设置</el-divider>
      <el-form-item label="展示类型">
        <el-select
          :model-value="modelValue.mapStyleType || 'region'"
          class="w-full"
          @change="update('mapStyleType', $event)"
        >
          <el-option label="区域" value="region" />
          <el-option label="散点" value="scatter" />
          <el-option label="热力" value="heatmap" />
          <el-option label="柱形" value="bar" />
          <el-option label="排名" value="rank" />
        </el-select>
      </el-form-item>
      <el-form-item label="地图名称">
        <el-input
          :model-value="modelValue.mapName || 'china'"
          placeholder="当前内置 china，也支持已注册的地图名称"
          @update:model-value="update('mapName', $event)"
        />
      </el-form-item>
      <el-row :gutter="8">
        <el-col :span="12">
          <el-form-item label="允许缩放">
            <el-switch
              :model-value="modelValue.mapRoam !== false"
              @change="update('mapRoam', $event)"
            />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="缩放比例">
            <el-input-number
              :model-value="modelValue.mapScale || 1"
              :min="0.5"
              :max="3"
              :step="0.1"
              controls-position="right"
              class="w-full"
              @update:model-value="update('mapScale', $event)"
            />
          </el-form-item>
        </el-col>
      </el-row>
      <el-row :gutter="8">
        <el-col :span="12">
          <el-form-item label="允许下钻">
            <el-switch
              :model-value="modelValue.mapDrillDown === true"
              @change="update('mapDrillDown', $event)"
            />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="视觉映射">
            <el-select
              :model-value="modelValue.mapVisualMapType || 'continuous'"
              class="w-full"
              @change="update('mapVisualMapType', $event)"
            >
              <el-option label="连续" value="continuous" />
              <el-option label="分段" value="piecewise" />
            </el-select>
          </el-form-item>
        </el-col>
      </el-row>
      <el-row
        v-if="modelValue.mapStyleType === 'scatter' || modelValue.mapStyleType === 'heatmap'"
        :gutter="8"
      >
        <el-col :span="8">
          <el-form-item label="点大小">
            <el-input-number
              :model-value="modelValue.mapPointSize || 8"
              :min="2"
              :max="30"
              controls-position="right"
              class="w-full"
              @update:model-value="update('mapPointSize', $event)"
            />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="模糊大小">
            <el-input-number
              :model-value="modelValue.mapBlurSize || 20"
              :min="0"
              :max="100"
              controls-position="right"
              class="w-full"
              @update:model-value="update('mapBlurSize', $event)"
            />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="透明度">
            <el-slider
              :model-value="Number(modelValue.mapPointOpacity ?? 1)"
              :min="0"
              :max="1"
              :step="0.1"
              @update:model-value="update('mapPointOpacity', $event)"
            />
          </el-form-item>
        </el-col>
      </el-row>
      <el-form-item v-if="modelValue.mapStyleType === 'bar'" label="柱形宽度">
        <el-input-number
          :model-value="modelValue.mapBarWidth || 10"
          :min="1"
          :max="60"
          controls-position="right"
          class="w-full"
          @update:model-value="update('mapBarWidth', $event)"
        />
      </el-form-item>
      <template v-if="modelValue.mapStyleType === 'rank'">
        <el-divider content-position="left">地图排名设置</el-divider>
        <el-row :gutter="8">
          <el-col :span="12">
            <el-form-item label="排名条数">
              <el-input-number
                :model-value="modelValue.mapRankLimit || 8"
                :min="1"
                :max="50"
                controls-position="right"
                class="w-full"
                @update:model-value="update('mapRankLimit', $event)"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="排名标题">
              <el-input
                :model-value="modelValue.mapRankTitle || '数据统计排名'"
                @update:model-value="update('mapRankTitle', $event)"
              />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="8">
          <el-col :span="8">
            <el-form-item label="标题字号">
              <el-input-number
                :model-value="modelValue.mapRankTitleSize || 14"
                :min="10"
                :max="30"
                controls-position="right"
                class="w-full"
                @update:model-value="update('mapRankTitleSize', $event)"
              />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="标题颜色">
              <el-color-picker
                :model-value="modelValue.mapRankTitleColor || '#303133'"
                show-alpha
                @update:model-value="update('mapRankTitleColor', $event)"
              />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="右侧边距">
              <el-input-number
                :model-value="modelValue.mapRankGridRight || 16"
                :min="0"
                :max="200"
                controls-position="right"
                class="w-full"
                @update:model-value="update('mapRankGridRight', $event)"
              />
            </el-form-item>
          </el-col>
        </el-row>
      </template>
      <el-row :gutter="8">
        <el-col :span="12">
          <el-form-item label="区域颜色">
            <el-color-picker
              :model-value="modelValue.mapAreaColor || '#eef4ff'"
              show-alpha
              @update:model-value="update('mapAreaColor', $event)"
            />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="描边颜色">
            <el-color-picker
              :model-value="modelValue.mapBorderColor || '#9db7e8'"
              show-alpha
              @update:model-value="update('mapBorderColor', $event)"
            />
          </el-form-item>
        </el-col>
      </el-row>
      <el-row :gutter="8">
        <el-col :span="12">
          <el-form-item label="显示区域名称">
            <el-switch
              :model-value="modelValue.mapLabelShow === true"
              @change="update('mapLabelShow', $event)"
            />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="显示视觉映射">
            <el-switch
              :model-value="modelValue.mapShowVisualMap !== false"
              @change="update('mapShowVisualMap', $event)"
            />
          </el-form-item>
        </el-col>
      </el-row>
      <el-row :gutter="8">
        <el-col :span="12">
          <el-form-item label="中心横向位置">
            <el-input-number
              :model-value="modelValue.mapCenterX || 50"
              :min="0"
              :max="100"
              controls-position="right"
              class="w-full"
              @update:model-value="update('mapCenterX', $event)"
            />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="中心纵向位置">
            <el-input-number
              :model-value="modelValue.mapCenterY || 52"
              :min="0"
              :max="100"
              controls-position="right"
              class="w-full"
              @update:model-value="update('mapCenterY', $event)"
            />
          </el-form-item>
        </el-col>
      </el-row>
      <el-divider content-position="left">图表标题设置</el-divider>
      <el-form-item label="主标题">
        <el-input
          :model-value="modelValue.chartTitle"
          placeholder="留空则使用卡片标题"
          @update:model-value="update('chartTitle', $event)"
        />
      </el-form-item>
      <el-divider content-position="left">图表副标题设置</el-divider>
      <el-form-item label="副标题">
        <el-input
          :model-value="modelValue.chartSubtitle"
          @update:model-value="update('chartSubtitle', $event)"
        />
      </el-form-item>
      <el-divider content-position="left">提示语设置</el-divider>
      <el-row :gutter="8">
        <el-col :span="12">
          <el-form-item label="显示提示语">
            <el-switch
              :model-value="modelValue.tooltipShow !== false"
              @change="update('tooltipShow', $event)"
            />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="提示字号">
            <el-input-number
              :model-value="modelValue.tooltipSize || 12"
              :min="10"
              :max="30"
              controls-position="right"
              class="w-full"
              @update:model-value="update('tooltipSize', $event)"
            />
          </el-form-item>
        </el-col>
      </el-row>
      <el-divider content-position="left">中心坐标设置</el-divider>
      <el-row :gutter="8">
        <el-col :span="12">
          <el-form-item label="中心横向位置">
            <el-input-number
              :model-value="modelValue.centerX || 50"
              :min="0"
              :max="100"
              controls-position="right"
              class="w-full"
              @update:model-value="update('centerX', $event)"
            />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="中心纵向位置">
            <el-input-number
              :model-value="modelValue.centerY || 50"
              :min="0"
              :max="100"
              controls-position="right"
              class="w-full"
              @update:model-value="update('centerY', $event)"
            />
          </el-form-item>
        </el-col>
      </el-row>
      <el-divider content-position="left">数据设置</el-divider>
      <PortalDataSourceFields
        :type="type"
        :model-value="modelValue"
        @update:model-value="updateValues"
      />
      <el-form-item v-if="modelValue.dataMode !== 'dynamic'" label="地图数据 JSON">
        <el-input v-model="dataText" type="textarea" :rows="9" @blur="syncArray('mapData')" />
      </el-form-item>
    </template>

    <template v-if="type === 'customEcharts'">
      <el-divider content-position="left">自定义设置</el-divider>
      <PortalDataSourceFields
        :type="type"
        :model-value="modelValue"
        @update:model-value="updateValues"
      />
      <el-form-item v-if="modelValue.dataMode !== 'dynamic'" label="ECharts 配置 JSON">
        <el-input
          v-model="customText"
          type="textarea"
          :rows="18"
          placeholder="请输入合法的 ECharts option JSON"
          @blur="syncObject('customOption')"
        />
      </el-form-item>
    </template>

    <template v-if="jumpTypes.includes(type)">
      <el-divider content-position="left">跳转设置</el-divider>
      <el-switch
        :model-value="modelValue.jumpEnabled === true"
        active-text="启用控件跳转"
        @change="update('jumpEnabled', $event)"
      />
      <el-form-item v-if="modelValue.jumpEnabled" label="跳转地址">
        <el-input
          :model-value="modelValue.jumpUrl"
          placeholder="支持站内路径、http(s) 地址和 {{key}} 占位符"
          @update:model-value="update('jumpUrl', $event)"
        />
      </el-form-item>
      <el-form-item v-if="modelValue.jumpEnabled" label="打开方式">
        <el-radio-group
          :model-value="modelValue.jumpTarget || '_self'"
          size="small"
          @change="update('jumpTarget', $event)"
        >
          <el-radio-button label="_self">当前窗口</el-radio-button>
          <el-radio-button label="_blank">新窗口</el-radio-button>
        </el-radio-group>
      </el-form-item>
    </template>
  </div>
</template>

<script lang="ts" setup>
import { cloneDeep } from 'lodash-es'
import PortalDataSourceFields from './PortalDataSourceFields.vue'

defineOptions({ name: 'PortalChartSettings' })

const props = defineProps<{
  type: string
  modelValue: Record<string, any>
}>()
const emit = defineEmits<{ 'update:modelValue': [value: Record<string, any>] }>()
const message = useMessage()
const dataText = ref('[]')
const columnsText = ref('[]')
const colorsText = ref('[]')
const customText = ref('{}')

const standardChartTypes = ['chart.bar', 'chart.line', 'chart.pie', 'chart.radar']
const standardChart = computed(() => standardChartTypes.includes(props.type))
const axisChart = computed(() => props.type === 'chart.bar' || props.type === 'chart.line')
const styleOptions = computed(() => {
  if (props.type === 'chart.bar') {
    return [
      { label: '基础', value: 1 },
      { label: '堆叠', value: 2 },
      { label: '背景', value: 4 },
      { label: '对比', value: 5 },
      { label: '正负条', value: 6 },
      { label: '折柱图', value: 7 }
    ]
  }
  if (props.type === 'chart.line') {
    return [
      { label: '基础', value: 1 },
      { label: '平滑', value: 2 },
      { label: '阶梯', value: 3 },
      { label: '堆叠', value: 4 }
    ]
  }
  if (props.type === 'chart.pie') {
    return [
      { label: '饼图', value: 1 },
      { label: '环形', value: 2 }
    ]
  }
  return [
    { label: '基础', value: 1 },
    { label: '圆形', value: 2 }
  ]
})
const jumpTypes = [
  'tableList',
  'chart.bar',
  'chart.line',
  'chart.pie',
  'chart.radar',
  'rankList',
  'timeAxis',
  'mapChart'
]
const chartSettingsTitle = computed(() => {
  const titles: Record<string, string> = {
    'chart.bar': '柱状图设置',
    'chart.line': '折线图设置',
    'chart.pie': '饼图设置',
    'chart.radar': '雷达图设置'
  }
  return titles[props.type] || '图表设置'
})
const marginFields = [
  { key: 'marginLeft', label: '左边距', defaultValue: 16 },
  { key: 'marginTop', label: '上边距', defaultValue: 48 },
  { key: 'marginRight', label: '右边距', defaultValue: 16 },
  { key: 'marginBottom', label: '下边距', defaultValue: 28 }
]

const update = (field: string, value: any) => {
  emit('update:modelValue', { ...props.modelValue, [field]: value })
}

const updateValues = (values: Record<string, any>) => {
  emit('update:modelValue', { ...props.modelValue, ...values })
}

const updateChartData = (field: 'categories' | 'values', value: string[] | number[]) => {
  const categories = field === 'categories' ? value : props.modelValue.categories || []
  const values = field === 'values' ? value : props.modelValue.values || []
  emit('update:modelValue', {
    ...props.modelValue,
    [field]: value,
    dataItems: categories.map((name: any, index: number) => ({
      name: String(name),
      value: Number(values[index]) || 0
    }))
  })
}

const resetTexts = () => {
  const value = props.modelValue || {}
  if (props.type === 'tableList') {
    dataText.value = JSON.stringify(value.rows || [], null, 2)
    columnsText.value = JSON.stringify(value.columns || [], null, 2)
  } else if (props.type === 'dataBoard' || props.type === 'rankList' || props.type === 'timeAxis') {
    dataText.value = JSON.stringify(value.items || [], null, 2)
  } else if (standardChartTypes.includes(props.type)) {
    dataText.value = JSON.stringify(value.dataItems || [], null, 2)
    colorsText.value = JSON.stringify(value.colors || [], null, 2)
  } else if (props.type === 'mapChart') {
    dataText.value = JSON.stringify(value.mapData || [], null, 2)
  } else if (props.type === 'customEcharts') {
    customText.value = JSON.stringify(value.customOption || {}, null, 2)
  }
}

watch(
  () => [
    props.type,
    props.modelValue.items,
    props.modelValue.rows,
    props.modelValue.columns,
    props.modelValue.dataItems,
    props.modelValue.colors,
    props.modelValue.mapData,
    props.modelValue.customOption
  ],
  resetTexts,
  { immediate: true, deep: true }
)

const parseJson = (text: string, expected: 'array' | 'object') => {
  try {
    const parsed = JSON.parse(text)
    if (
      (expected === 'array' && Array.isArray(parsed)) ||
      (expected === 'object' && parsed && typeof parsed === 'object' && !Array.isArray(parsed))
    ) {
      return parsed
    }
  } catch {
    // Keep the last valid value when the editor contains invalid JSON.
  }
  message.warning(`请输入合法的 JSON ${expected === 'array' ? '数组' : '对象'}`)
  return undefined
}

const syncArray = (field: string) => {
  const source =
    field === 'columns' ? columnsText.value : field === 'colors' ? colorsText.value : dataText.value
  const parsed = parseJson(source, 'array')
  if (parsed) update(field, cloneDeep(parsed))
}

const syncObject = (field: string) => {
  const parsed = parseJson(customText.value, 'object')
  if (parsed) update(field, cloneDeep(parsed))
}

const splitText = (value: unknown) =>
  String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)

const numberList = (value: unknown) =>
  String(value || '')
    .split(',')
    .map((entry) => Number(entry.trim()) || 0)
</script>

<style lang="scss" scoped>
.portal-chart-settings :deep(.el-divider) {
  margin: 16px 0 12px;
}

.portal-chart-settings :deep(.el-divider__text) {
  padding: 0 8px 0 0;
  font-size: 12px;
  font-weight: 650;
  color: var(--portal-text-secondary);
}

.portal-chart-settings :deep(.el-color-picker) {
  vertical-align: middle;
}

.portal-chart-settings :deep(.el-switch) {
  margin-bottom: 8px;
}

.w-full {
  width: 100%;
}
</style>
