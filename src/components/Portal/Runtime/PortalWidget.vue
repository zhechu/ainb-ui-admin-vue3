<template>
  <div
    class="portal-widget"
    :class="{
      'is-designer': designer,
      'is-selected': selectedId === item.id,
      'is-nested': nested
    }"
    @click.stop="handleDesignerSelect"
  >
    <div v-if="designer && nested" class="portal-widget__nested-actions">
      <el-button
        circle
        text
        size="small"
        title="复制控件"
        aria-label="复制控件"
        @click.stop="emit('duplicate', item.id)"
      >
        <Icon icon="ep:copy-document" />
      </el-button>
      <el-button
        circle
        text
        size="small"
        title="删除控件"
        aria-label="删除控件"
        @click.stop="emit('remove', item.id)"
      >
        <Icon icon="ep:delete" />
      </el-button>
    </div>

    <template v-if="item.type === 'card'">
      <PortalCardHeader v-bind="item.props" :designer="designer" />
      <div
        class="portal-widget__container-body"
        @dragover.prevent.stop
        @drop.stop="handleNestedDrop($event, item.id)"
      >
        <div v-if="designer || !item.props.children?.length" class="portal-widget__drop-tip">
          <span v-if="!item.props.children?.length">面板暂无内容</span>
          <PortalContainerAdd v-if="designer" @add="handleContainerAdd($event, item.id)" />
        </div>
        <PortalWidget
          v-for="child in item.props.children || []"
          :key="child.id"
          :item="child"
          :designer="designer"
          :nested="true"
          :selected-id="selectedId"
          @select="emit('select', $event)"
          @add-nested="handleContainerAdd"
          @remove="emit('remove', $event)"
          @duplicate="emit('duplicate', $event)"
        />
      </div>
    </template>

    <template v-else-if="item.type === 'tabs'">
      <div class="portal-widget__header">
        <span class="portal-widget__accent"></span>
        <span class="portal-widget__title">{{ item.props.title }}</span>
      </div>
      <el-tabs
        v-model="activeTab"
        :type="item.props.styleType === 'card' ? 'card' : undefined"
        :tab-position="item.props.tabPosition || 'top'"
        class="portal-widget__tabs"
      >
        <el-tab-pane v-for="tab in item.props.tabs || []" :key="tab.id" :name="tab.id">
          <template #label>
            <span class="portal-widget__tab-label">
              <Icon v-if="tab.icon" :icon="tab.icon" :size="14" />
              <span>{{ tab.label }}</span>
            </span>
          </template>
          <div
            class="portal-widget__tab-body"
            @dragover.prevent.stop
            @drop.stop="handleNestedDrop($event, item.id, tab.id)"
          >
            <div v-if="designer || !tab.items?.length" class="portal-widget__drop-tip">
              <span v-if="!tab.items?.length">标签页暂无内容</span>
              <PortalContainerAdd
                v-if="designer"
                @add="handleContainerAdd($event, item.id, tab.id)"
              />
            </div>
            <PortalWidget
              v-for="child in tab.items || []"
              :key="child.id"
              :item="child"
              :designer="designer"
              :nested="true"
              :selected-id="selectedId"
              @select="emit('select', $event)"
              @add-nested="handleContainerAdd"
              @remove="emit('remove', $event)"
              @duplicate="emit('duplicate', $event)"
            />
          </div>
        </el-tab-pane>
      </el-tabs>
    </template>

    <template v-else-if="item.type === 'text'">
      <PortalCardHeader v-bind="item.props" :designer="designer" />
      <component
        :is="textData.link && safeUrl(textData.link) ? 'a' : 'div'"
        class="portal-widget__text-link"
        :href="safeUrl(textData.link)"
        :target="item.props.linkTarget || '_self'"
        :rel="item.props.linkTarget === '_blank' ? 'noopener noreferrer' : undefined"
        @click="handleConfiguredLinkClick($event, textData.link, item.props.linkTarget)"
      >
        <div
          v-if="item.props.contentType !== 'rich' && item.props.textAutoplay"
          class="portal-widget__text-viewport"
        >
          <div
            class="portal-widget__text portal-widget__text--moving"
            :class="`is-${item.props.textAutoplayMode || 'left'}`"
            :style="textStyle"
          >
            {{ textData.content }}
          </div>
        </div>
        <div
          v-else-if="item.props.contentType === 'rich'"
          v-dompurify-html="textData.content || ''"
          class="portal-widget__text portal-widget__rich-text"
          :style="textStyle"
        ></div>
        <div v-else class="portal-widget__text" :style="textStyle">
          {{ textData.content }}
        </div>
      </component>
    </template>

    <div v-else-if="item.type === 'image'" class="portal-widget__image-wrapper">
      <PortalCardHeader v-bind="item.props" :designer="designer" />
      <a
        v-if="safeUrl(imageData.link)"
        class="portal-widget__image-link"
        :href="safeUrl(imageData.link)"
        :target="item.props.linkTarget || '_self'"
        :rel="item.props.linkTarget === '_blank' ? 'noopener noreferrer' : undefined"
        @click="handleConfiguredLinkClick($event, imageData.link, item.props.linkTarget)"
      >
        <img
          class="portal-widget__image"
          :src="safeUrl(imageData.src) || placeholderImage"
          :alt="imageData.alt || ''"
          :style="{
            objectFit: item.props.objectFit || 'cover',
            borderRadius: `${item.props.radius ?? 6}px`
          }"
        />
        <div
          v-if="imageData.caption"
          class="portal-widget__caption"
          :style="captionStyle(item.props)"
        >
          {{ imageData.caption }}
        </div>
      </a>
      <div v-else class="portal-widget__image-link">
        <img
          class="portal-widget__image"
          :src="safeUrl(imageData.src) || placeholderImage"
          :alt="imageData.alt || ''"
          :style="{
            objectFit: item.props.objectFit || 'cover',
            borderRadius: `${item.props.radius ?? 6}px`
          }"
        />
        <div
          v-if="imageData.caption"
          class="portal-widget__caption"
          :style="captionStyle(item.props)"
        >
          {{ imageData.caption }}
        </div>
      </div>
    </div>

    <div v-else-if="item.type === 'carousel'" class="portal-widget__carousel-wrapper">
      <PortalCardHeader v-bind="item.props" :designer="designer" />
      <el-carousel
        :direction="item.props.direction || 'horizontal'"
        :autoplay="item.props.autoplay !== false"
        :interval="Number(item.props.interval) || 4000"
        :indicator-position="item.props.indicator || 'outside'"
        :arrow="item.props.arrow || 'hover'"
        height="100%"
        class="portal-widget__carousel"
      >
        <el-carousel-item v-for="(image, index) in carouselData" :key="`${item.id}-${index}`">
          <div
            class="portal-widget__carousel-image"
            @click="handleConfiguredLinkClick($event, image.link, image.target)"
          >
            <img
              class="portal-widget__image"
              :src="safeUrl(image.src) || placeholderImage"
              :alt="image.title || ''"
              :style="{ objectFit: item.props.objectFit || 'cover' }"
            />
            <div
              v-if="image.title"
              class="portal-widget__caption"
              :style="captionStyle(item.props)"
            >
              {{ image.title }}
            </div>
          </div>
        </el-carousel-item>
      </el-carousel>
    </div>

    <div v-else-if="item.type === 'video'" class="portal-widget__media">
      <PortalCardHeader v-bind="item.props" :designer="designer" />
      <video
        v-if="safeUrl(videoData.src)"
        class="portal-widget__video"
        :src="safeUrl(videoData.src)"
        :poster="safeUrl(videoData.poster)"
        :autoplay="item.props.autoplay === true"
        :controls="item.props.controls !== false"
        :loop="item.props.loop === true"
        :muted="item.props.muted === true"
        ref="videoRef"
        @loadedmetadata="setVideoRate"
        playsinline
      ></video>
      <div v-else class="portal-widget__empty-media"
        ><Icon icon="ep:video-play" :size="30" />暂无视频</div
      >
    </div>

    <div v-else-if="item.type === 'iframe'" class="portal-widget__iframe-wrapper">
      <PortalCardHeader v-bind="item.props" :designer="designer" />
      <iframe
        class="portal-widget__iframe"
        :src="safeUrl(iframeUrl) || 'about:blank'"
        :title="item.props.frameTitle || item.props.title || '外部网页'"
        :allow="item.props.allow || 'fullscreen'"
        loading="lazy"
      ></iframe>
    </div>

    <template v-else-if="item.type === 'commonFunc'">
      <PortalCardHeader v-bind="item.props" :designer="designer" />
      <div
        class="portal-widget__shortcut-grid"
        :class="{ 'is-horizontal': item.props.iconPosition === 'left' }"
        :style="{
          gridTemplateColumns: `repeat(${item.props.columns || 4}, minmax(0, 1fr))`,
          '--portal-function-color': portalCssColor(
            item.props.labelFontColor,
            '#475467',
            '--portal-text-tertiary'
          ),
          '--portal-function-size': `${item.props.labelFontSize || 13}px`,
          '--portal-function-weight': item.props.labelFontWeight ? 700 : 400
        }"
      >
        <button
          v-for="shortcut in shortcutData"
          :key="shortcut.url + shortcut.label"
          type="button"
          :class="{ 'has-border': item.props.showBorder !== false }"
          @click="openConfiguredLink(shortcut.url, shortcut.target)"
        >
          <span
            class="portal-widget__shortcut-icon"
            :style="{
              color: portalCssColor(shortcut.color, '#3473ff', '--el-color-primary'),
              background: portalColorWithAlpha(shortcut.color, '#3473ff', '--el-color-primary')
            }"
          >
            <Icon :icon="shortcut.icon || 'ep:link'" :size="22" />
          </span>
          <span>{{ shortcut.label }}</span>
        </button>
      </div>
    </template>

    <template v-else-if="item.type === 'myTodo' || item.type === 'todo'">
      <PortalCardHeader v-bind="item.props" :designer="designer" />
      <div
        class="portal-widget__todo-summary"
        :style="{
          gridTemplateColumns: `repeat(${item.props.columns || 5}, minmax(0, 1fr))`
        }"
      >
        <button
          v-for="todo in todoSummaryData"
          :key="todo.id || todo.label"
          type="button"
          :class="{ 'has-border': item.props.showBorder === true }"
          @click="openShortcut(todo.url)"
        >
          <span
            class="portal-widget__todo-icon"
            :style="{
              color: portalCssColor(todo.color, '#3473ff', '--el-color-primary'),
              background: portalColorWithAlpha(todo.color, '#3473ff', '--el-color-primary')
            }"
          >
            <Icon :icon="todo.icon || 'ep:document'" :size="22" />
          </span>
          <strong
            :style="{
              color: portalCssColor(item.props.valueFontColor, '#303133', '--portal-text-primary'),
              fontSize: `${item.props.valueFontSize || 24}px`,
              fontWeight: item.props.valueFontWeight === false ? 400 : 700
            }"
          >
            {{ todo.value ?? 0 }}
          </strong>
          <span
            :style="{
              color: portalCssColor(
                item.props.labelFontColor,
                '#606266',
                '--portal-text-secondary'
              ),
              fontSize: `${item.props.labelFontSize || 14}px`,
              fontWeight: item.props.labelFontWeight ? 700 : 400
            }"
          >
            {{ todo.label }}
          </span>
        </button>
      </div>
    </template>

    <template v-else-if="item.type === 'todoList' || item.type === 'doingList'">
      <PortalCardHeader v-bind="item.props" :designer="designer" />
      <div class="portal-widget__task-list">
        <button
          v-for="task in taskData"
          :key="task.id || task.taskId || task.name"
          type="button"
          @click="openTask(task, item.type === 'doingList' ? 'doing' : 'todo')"
        >
          <span class="portal-widget__task-icon">
            <Icon :icon="item.type === 'doingList' ? 'ep:loading' : 'ep:finished'" />
          </span>
          <span class="portal-widget__task-content">
            <strong>{{ task.name || task.label || '未命名任务' }}</strong>
            <small>{{ task.processName || '流程任务' }}</small>
          </span>
          <time>{{ formatPortalDate(task.createTime || task.date) }}</time>
        </button>
        <div v-if="!taskData.length" class="portal-widget__empty">暂无数据</div>
      </div>
    </template>

    <template v-else-if="item.type === 'notice'">
      <PortalCardHeader v-bind="item.props" :designer="designer" />
      <div
        v-if="item.props.styleType === 'table' || !item.props.styleType"
        class="portal-widget__notice-table"
      >
        <el-table
          :data="noticeData"
          :border="item.props.border !== false"
          :show-header="item.props.tableShowHeader !== false"
          :row-style="noticeRowStyle"
          :header-cell-style="noticeHeaderStyle"
          :cell-style="noticeCellStyle"
          height="100%"
          size="small"
        >
          <el-table-column
            v-if="item.props.showIndex !== false"
            type="index"
            label="#"
            width="48"
          />
          <el-table-column
            v-for="(column, index) in noticeTableColumns"
            :key="`${column.key}-${index}`"
            :prop="column.key"
            :label="column.label"
            :min-width="column.key === 'title' ? 160 : 90"
          >
            <template #default="{ row }">
              <button
                v-if="column.key === 'title'"
                type="button"
                class="portal-widget__notice-title"
                @click="openNotice(row)"
              >
                {{ formatNoticeField(row, column.key) }}
              </button>
              <span
                v-else
                :class="{ 'is-wrap': item.props.showOverflow === false }"
                :title="
                  item.props.showOverflow !== false ? formatNoticeField(row, column.key) : undefined
                "
              >
                {{ formatNoticeField(row, column.key) }}
              </span>
            </template>
          </el-table-column>
        </el-table>
        <div v-if="!noticeData.length" class="portal-widget__empty">暂无公告</div>
      </div>
      <div v-else class="portal-widget__notice-list" :class="`is-${item.props.styleType}`">
        <button
          v-for="(notice, index) in noticeData"
          :key="notice.id || `${notice.title}-${index}`"
          type="button"
          :style="noticeItemStyle(index)"
          @click="openNotice(notice)"
        >
          <span v-if="item.props.showImage" class="portal-widget__notice-image">
            <Icon icon="ep:bell" />
          </span>
          <span class="portal-widget__notice-content">
            <span class="portal-widget__notice-meta">{{ notice.category || '其他' }}</span>
            <strong>{{ notice.title }}</strong>
            <small v-if="item.props.styleType === 'vertical' && notice.content">
              {{ notice.content }}
            </small>
          </span>
          <time>{{ formatPortalDate(notice.date || notice.time) }}</time>
        </button>
        <div v-if="!noticeData.length" class="portal-widget__empty">暂无公告</div>
      </div>
    </template>

    <template v-else-if="item.type === 'email'">
      <div class="portal-widget__header">
        <span class="portal-widget__accent"></span>
        <span class="portal-widget__title">{{ item.props.title }}</span>
      </div>
      <div class="portal-widget__notice-list">
        <div v-for="mail in emailData" :key="mail.subject + mail.date" class="portal-widget__mail">
          <span class="portal-widget__mail-icon"><Icon icon="ep:message" /></span>
          <span class="portal-widget__notice-content"
            ><strong :class="{ 'is-unread': mail.unread }">{{ mail.subject }}</strong
            ><small>{{ mail.sender }} · {{ mail.date }}</small></span
          >
          <span v-if="mail.unread" class="portal-widget__unread"></span>
        </div>
      </div>
    </template>

    <template v-else-if="item.type === 'dataBoard'">
      <PortalCardHeader v-bind="item.props" :designer="designer" />
      <div
        class="portal-widget__metric-grid"
        :style="{ '--portal-metric-columns': item.props.columns || 4 }"
      >
        <button
          v-for="metric in metricData"
          :key="metric.id || metric.label"
          type="button"
          class="portal-widget__metric"
          :class="{ 'has-border': item.props.showBorder === true }"
          @click="
            openConfiguredLink(
              metric.url || (item.props.jumpEnabled ? item.props.jumpUrl : ''),
              item.props.jumpTarget,
              metric
            )
          "
        >
          <span
            class="portal-widget__metric-icon"
            :style="{
              color: portalCssColor(metric.color, '#3473ff', '--el-color-primary'),
              background: portalColorWithAlpha(metric.color, '#3473ff', '--el-color-primary')
            }"
            ><Icon :icon="metric.icon || 'ep:data-line'"
          /></span>
          <span
            class="portal-widget__metric-label"
            :style="{
              color: portalCssColor(
                item.props.labelFontColor,
                '#667085',
                '--portal-text-secondary'
              ),
              fontSize: `${item.props.labelFontSize || 13}px`,
              fontWeight: item.props.labelFontWeight ? 700 : 400
            }"
            >{{ metric.label }}</span
          >
          <strong
            :style="{
              color: portalCssColor(item.props.valueFontColor, '#172033', '--portal-text-primary'),
              fontSize: `${item.props.valueFontSize || 22}px`,
              fontWeight: item.props.valueFontWeight === false ? 400 : 700
            }"
            >{{ metric.value }} <small>{{ metric.unit }}</small></strong
          >
        </button>
      </div>
    </template>

    <template v-else-if="item.type === 'tableList'">
      <PortalCardHeader v-bind="item.props" :designer="designer" />
      <el-table
        v-if="(item.props.tableStyleType || 1) === 1"
        :data="tableRows"
        :size="item.props.tableSize || 'small'"
        :border="item.props.tableBorder === true"
        :stripe="item.props.tableStripe !== false"
        :show-header="item.props.tableShowHeader !== false"
        :row-style="tableRowStyle"
        :header-cell-style="tableHeaderStyle"
        height="calc(100% - 34px)"
        @row-click="handleTableRowClick"
      >
        <el-table-column
          v-if="item.props.tableShowIndex !== false"
          type="index"
          label="#"
          width="48"
        />
        <el-table-column
          v-for="column in tableColumns"
          :key="column.key"
          :prop="column.key"
          :label="column.label"
          :width="column.width || undefined"
          :align="column.align || 'left'"
          min-width="100"
          show-overflow-tooltip
        />
      </el-table>
      <div
        v-else
        class="portal-widget__table-list"
        :class="`is-style-${item.props.tableStyleType || 2}`"
      >
        <button
          v-for="(row, rowIndex) in tableRows"
          :key="row.id || rowIndex"
          type="button"
          class="portal-widget__table-list-row"
          @click="handleTableRowClick(row)"
        >
          <span
            v-for="column in tableColumns"
            :key="column.key"
            class="portal-widget__table-list-cell"
          >
            <small>{{ column.label }}</small>
            <strong>{{ row[column.key] ?? '' }}</strong>
          </span>
        </button>
        <div v-if="!tableRows.length" class="portal-widget__empty">暂无数据</div>
      </div>
    </template>

    <template v-else-if="item.type === 'rankList'">
      <PortalCardHeader v-bind="item.props" :designer="designer" />
      <div class="portal-widget__rank-list" :class="`is-style-${item.props.styleType || 1}`">
        <button
          v-for="(rank, index) in rankData"
          :key="rank.label + index"
          type="button"
          class="portal-widget__rank-row"
          @click="
            openConfiguredLink(
              rank.url || (item.props.jumpEnabled ? item.props.jumpUrl : ''),
              item.props.jumpTarget,
              rank
            )
          "
        >
          <span
            v-if="item.props.showRankNumber !== false"
            class="portal-widget__rank-number"
            :class="`rank-${index + 1}`"
          >
            <Icon
              v-if="item.props.styleType > 1 && index < 3"
              :icon="index === 0 ? 'ep:trophy' : 'ep:medal'"
              :size="15"
            />
            <span v-else>{{ index + 1 }}</span>
          </span>
          <span class="portal-widget__rank-label">{{ rank.label }}</span>
          <strong
            v-if="item.props.showRankValue !== false"
            :style="{
              color: portalCssColor(item.props.valueColor, '#172033', '--portal-text-primary')
            }"
          >
            {{ rank.value }}{{ item.props.valueSuffix || '' }}
          </strong>
        </button>
      </div>
    </template>

    <template v-else-if="item.type === 'timeAxis'">
      <PortalCardHeader v-bind="item.props" :designer="designer" />
      <div
        class="portal-widget__timeline"
        :class="[
          `is-style-${item.props.styleType || 1}`,
          `is-layout-${item.props.timelineLayout || 'alternate'}`
        ]"
      >
        <div
          v-for="(event, index) in timeAxisData"
          :key="event.timestamp + event.content"
          class="portal-widget__timeline-row"
          @click="
            openConfiguredLink(
              event.url || (item.props.jumpEnabled ? item.props.jumpUrl : ''),
              item.props.jumpTarget,
              event
            )
          "
        >
          <span v-if="item.props.timelineShowTime !== false" class="portal-widget__timeline-time">{{
            event.timestamp
          }}</span>
          <span v-else class="portal-widget__timeline-time">{{
            item.props.timelineShowIndex ? index + 1 : ''
          }}</span>
          <span
            class="portal-widget__timeline-line"
            :style="{
              borderColor: portalCssColor(
                item.props.timelineLineColor,
                '#d5deeb',
                '--portal-border'
              )
            }"
            ><i
              :style="{
                background: portalCssColor(
                  item.props.timelineNodeColor,
                  '#3473ff',
                  '--el-color-primary'
                )
              }"
            ></i
          ></span>
          <span>{{ event.content }}</span>
        </div>
      </div>
    </template>

    <div v-else class="portal-widget__chart" @click="handleChartClick">
      <PortalCardHeader v-bind="item.props" :designer="designer" />
      <Echart :options="chartOptions" height="calc(100% - 34px)" />
    </div>
    <PortalNoticeDetail
      v-if="item.type === 'notice'"
      :visible="noticeDetailVisible"
      :notice="selectedNotice"
      @update:visible="noticeDetailVisible = $event"
    />
  </div>
</template>

<script lang="ts" setup>
import type { EChartsOption } from 'echarts'
import dayjs from 'dayjs'
import china from '@/assets/map/json/china.json'
import {
  getPortalNotices,
  getPortalTaskSummary,
  getPortalTasks,
  invokePortalData
} from '@/api/infra/portal'
import type { PortalItem } from '@/api/infra/portal'
import PortalContainerAdd from '@/components/Portal/Designer/PortalContainerAdd.vue'
import PortalCardHeader from '@/components/Portal/Runtime/PortalCardHeader.vue'
import PortalNoticeDetail from '@/components/Portal/Runtime/PortalNoticeDetail.vue'
import Echart from '@/components/Echart/src/Echart.vue'
import echarts from '@/plugins/echarts'
import { useAppStore } from '@/store/modules/app'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

defineOptions({ name: 'PortalWidget' })

const props = defineProps<{
  item: PortalItem
  designer?: boolean
  nested?: boolean
  selectedId?: string
}>()
const emit = defineEmits<{
  select: [id: string]
  addNested: [type: string, parentId: string, tabId?: string]
  remove: [id: string]
  duplicate: [id: string]
}>()
const router = useRouter()
const appStore = useAppStore()
const isDark = computed(() => appStore.getIsDark)
const placeholderImage =
  'data:image/svg+xml,%3Csvg%20xmlns%3D%22%68%74%74%70%3A%2F%2F%77%33%2E%77%77%77%2E%77%33%2E%6F%72%67%2F%32%30%30%30%2F%73%76%67%22%20width%3D%22800%22%20height%3D%22400%22%20viewBox%3D%220%200%20800%20400%22%3E%3Crect%20width%3D%22800%22%20height%3D%22400%22%20fill%3D%22%23eef2f7%22%2F%3E%3Cpath%20d%3D%22M280%20245l92-92%2062%2062%2042-42%2096%2096H280z%22%20fill%3D%22%23cbd5e1%22%2F%3E%3Ccircle%20cx%3D%22512%22%20cy%3D%22135%22%20r%3D%2228%22%20fill%3D%22%23cbd5e1%22%2F%3E%3C%2Fsvg%3E'
const activeTab = ref(props.item.props.active || props.item.props.tabs?.[0]?.id)
const categories = ref<string[]>([])
const values = ref<number[]>([])
const remoteData = ref<any>()
const videoRef = ref<HTMLVideoElement>()
const noticeDetailVisible = ref(false)
const selectedNotice = ref<Record<string, any> | null>(null)

const isDefaultPortalColor = (value: unknown, lightDefault: string) =>
  !value || String(value).toLowerCase() === lightDefault.toLowerCase()

const portalCssColor = (value: unknown, lightDefault: string, variable: string) =>
  isDefaultPortalColor(value, lightDefault) ? `var(${variable})` : String(value)

const portalColorWithAlpha = (value: unknown, lightDefault: string, variable: string) => {
  if (isDefaultPortalColor(value, lightDefault)) {
    return `color-mix(in srgb, var(${variable}) 10%, transparent)`
  }
  const color = String(value)
  return color.startsWith('#') ? `${color}18` : `color-mix(in srgb, ${color} 10%, transparent)`
}

const chartTheme = computed(() =>
  isDark.value
    ? {
        primaryText: '#e5eaf3',
        regularText: '#cfd3dc',
        secondaryText: '#a3a6ad',
        mutedText: '#8d9095',
        splitLine: '#3a3d42',
        mapArea: '#253b61',
        mapBorder: '#526a94'
      }
    : {
        primaryText: '#303133',
        regularText: '#344054',
        secondaryText: '#667085',
        mutedText: '#98a2b3',
        splitLine: '#edf0f5',
        mapArea: '#eef4ff',
        mapBorder: '#9db7e8'
      }
)

const chartColor = (value: unknown, lightDefault: string, darkValue: string) =>
  isDefaultPortalColor(value, lightDefault) ? darkValue : String(value)

echarts.registerMap('china', china as any)

const handleDesignerSelect = () => {
  if (props.designer) emit('select', props.item.id)
}

const handleContainerAdd = (type: string, parentId: string, tabId?: string) => {
  emit('addNested', type, parentId, tabId)
}

const handleNestedDrop = (event: DragEvent, parentId: string, tabId?: string) => {
  const type = event.dataTransfer?.getData('portal/type')
  if (type) handleContainerAdd(type, parentId, tabId)
}

const safeUrl = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const url = value.trim()
  if (!url) return undefined
  if (url.startsWith('/') && !url.startsWith('//')) return url
  try {
    const protocol = new URL(url, window.location.origin).protocol
    return protocol === 'http:' || protocol === 'https:' ? url : undefined
  } catch {
    return undefined
  }
}

const readPath = (source: any, path: string, fallback?: any) => {
  if (!path) return fallback
  const value = path.split('.').reduce((current, part) => current?.[part], source)
  return value === undefined || value === null ? fallback : value
}

const unwrapData = (payload: any) => {
  let data = payload
  for (let index = 0; index < 3; index += 1) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) break
    if (
      Object.prototype.hasOwnProperty.call(data, 'data') &&
      (Object.prototype.hasOwnProperty.call(data, 'code') ||
        Object.keys(data).length === 1 ||
        'total' in data ||
        'totalCount' in data ||
        'pageNo' in data ||
        'pageSize' in data)
    ) {
      data = data.data
      continue
    }
    break
  }
  return data
}

const mappedValue = (entry: any, key: string, fallback: string, aliases: string[] = []) => {
  const mapping = (props.item.props.mappingConfig || []).find(
    (item: any) => item.key === key || item.field === key
  )
  const candidates = [mapping?.value, fallback, ...aliases].filter(Boolean)
  for (const candidate of candidates) {
    const value = readPath(entry, candidate)
    if (value !== undefined && value !== null && value !== '') return value
  }
  return undefined
}

const sourceArray = (payload: any, fallback: any[] = []) => {
  const data = unwrapData(payload)
  if (data === undefined || data === null) return fallback
  if (Array.isArray(data)) return data
  if (data && typeof data === 'object') {
    const arrayKeys = [
      'data',
      'items',
      'rows',
      'list',
      'records',
      'dataList',
      'metrics',
      'mapData',
      'images',
      'shortcuts'
    ]
    for (const key of arrayKeys) {
      if (Array.isArray(data[key])) return data[key]
    }
    if (
      'id' in data ||
      'name' in data ||
      'label' in data ||
      'title' in data ||
      'value' in data ||
      'src' in data ||
      'url' in data
    ) {
      return [data]
    }
  }
  return []
}

const normalizeData = (payload: any) => {
  const data = unwrapData(payload)
  if (data === undefined || data === null) return
  remoteData.value = data
  const chart = extractChartData(data)
  categories.value = chart.categories
  values.value = chart.values
  chartSeries.value = chart.series
}

const chartSeries = ref<any[]>([])

const extractChartData = (payload: any) => {
  const data = unwrapData(payload)
  const type = props.item.type
  if (Array.isArray(data)) {
    if (data.some((entry) => Array.isArray(entry?.data))) {
      const categoryCount = Math.max(
        0,
        ...data.map((entry: any) => (Array.isArray(entry?.data) ? entry.data.length : 0))
      )
      return {
        categories: Array.from({ length: categoryCount }, (_, index) => String(index + 1)),
        values: [],
        series: data.map((entry: any, index: number) => ({
          name: String(entry?.name || entry?.label || `系列${index + 1}`),
          type: entry?.type,
          data: entry.data.map((value: any) => Number(value) || 0)
        }))
      }
    }
    if (['chart.bar', 'chart.line', 'chart.pie', 'chart.radar'].includes(type)) {
      const rows = data.map((entry: any) => ({
        series: String(
          mappedValue(entry, 'series', 'type', ['seriesName']) || props.item.props.title || '数据'
        ),
        dimension: String(mappedValue(entry, 'dimension', 'name', ['label', 'category']) ?? ''),
        value: Number(mappedValue(entry, 'value', 'value', ['num', 'count'])) || 0,
        max: Number(mappedValue(entry, 'max', 'max')) || undefined
      }))
      const categories = Array.from(new Set(rows.map((entry) => entry.dimension).filter(Boolean)))
      const seriesNames = Array.from(new Set(rows.map((entry) => entry.series).filter(Boolean)))
      const names = seriesNames.length ? seriesNames : [props.item.props.title || '数据']
      if (type === 'chart.pie') {
        const pieValues = categories.map((name) =>
          rows
            .filter((entry) => entry.dimension === name)
            .reduce((sum, entry) => sum + entry.value, 0)
        )
        return { categories, values: pieValues, series: [] }
      }
      return {
        categories,
        values: rows.map((entry) => entry.value),
        series: names.map((name) => ({
          name,
          type: 'bar',
          data: categories.map(
            (category) =>
              rows.find((entry) => entry.series === name && entry.dimension === category)?.value ??
              0
          )
        }))
      }
    }
    return {
      categories: data.map((entry) => String(entry?.name ?? entry?.label ?? entry?.category ?? '')),
      values: data.map((entry) => Number(entry?.value ?? entry?.num ?? 0) || 0),
      series: []
    }
  }
  if (data && Array.isArray(data.series)) {
    const series = data.series.map((entry: any, index: number) => ({
      name: String(entry?.name || `系列${index + 1}`),
      type: entry?.type,
      data: Array.isArray(entry?.data) ? entry.data.map((value: any) => Number(value) || 0) : []
    }))
    return {
      categories: Array.isArray(data.categories) ? data.categories.map(String) : [],
      values: Array.isArray(data.values) ? data.values.map((value: any) => Number(value) || 0) : [],
      series
    }
  }
  if (data && Array.isArray(data.categories) && Array.isArray(data.values)) {
    return {
      categories: data.categories.map(String),
      values: data.values.map((entry: any) => Number(entry) || 0),
      series: []
    }
  }
  return { categories: [], values: [], series: [] }
}

const loadData = async () => {
  const staticData = extractChartData({
    categories: props.item.props.categories || [],
    values: props.item.props.values || [],
    series: props.item.props.series || []
  })
  const itemData = extractChartData(props.item.props.dataItems || [])
  categories.value = itemData.categories.length ? itemData.categories : staticData.categories
  values.value = itemData.values.length ? itemData.values : staticData.values
  chartSeries.value = itemData.series.length ? itemData.series : staticData.series
  remoteData.value = undefined
  if (props.designer) return
  try {
    if (props.item.props.interfaceCode && props.item.props.dataMode !== 'static') {
      let requestParams: Record<string, any> = {}
      try {
        const parsed = JSON.parse(props.item.props.requestParams || '{}')
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) requestParams = parsed
      } catch {
        // Invalid optional parameters do not block the widget from loading.
      }
      normalizeData(await invokePortalData(props.item.props.interfaceCode, requestParams))
      return
    }
    if (props.item.props.dataMode !== 'static') {
      if (props.item.type === 'myTodo' || props.item.type === 'todo') {
        normalizeData(await getPortalTaskSummary())
      } else if (props.item.type === 'todoList') {
        normalizeData(await getPortalTasks('todo', Number(props.item.props.pageSize) || 7))
      } else if (props.item.type === 'doingList') {
        normalizeData(await getPortalTasks('doing', Number(props.item.props.pageSize) || 7))
      } else if (props.item.type === 'notice') {
        normalizeData(await getPortalNotices(Number(props.item.props.count) || 5))
      }
    }
  } catch {
    // Optional portal data falls back to the configured sample data.
  }
}

let refreshTimer: number | undefined

const clearRefreshTimer = () => {
  if (refreshTimer) {
    window.clearInterval(refreshTimer)
    refreshTimer = undefined
  }
}

onBeforeUnmount(clearRefreshTimer)

const scheduleRefresh = () => {
  clearRefreshTimer()
  if (
    props.designer ||
    props.item.props.dataMode === 'static' ||
    !props.item.props.interfaceCode ||
    props.item.props.refreshEnabled !== true
  ) {
    return
  }
  const interval = Math.max(10, Number(props.item.props.refreshInterval) || 300) * 1000
  refreshTimer = window.setInterval(loadData, interval)
}

watch(
  () => [
    props.item.type,
    props.item.props.interfaceCode,
    props.item.props.pageSize,
    props.item.props.count,
    props.item.props.categories,
    props.item.props.values,
    props.item.props.dataItems,
    props.item.props.series,
    props.item.props.dataMode,
    props.item.props.requestParams,
    props.item.props.mappingConfig,
    props.item.props.items,
    props.item.props.rows,
    props.item.props.mapData
  ],
  loadData,
  { immediate: true, deep: true }
)
watch(
  () => [
    props.item.props.dataMode,
    props.item.props.interfaceCode,
    props.item.props.refreshEnabled,
    props.item.props.refreshInterval
  ],
  scheduleRefresh,
  { immediate: true }
)
watch(
  () => props.item.props.active,
  (value) => {
    activeTab.value = value
  }
)

const hasRemoteData = computed(() => remoteData.value !== undefined)
const mappingField = (key: string) => {
  const mapping = (props.item.props.mappingConfig || []).find(
    (entry: any) => entry.key === key || entry.field === key
  )
  return typeof mapping?.value === 'string' ? mapping.value : ''
}
const mappedOr = (entry: any, key: string, fallback: any, aliases: string[] = []) => {
  const value = mappedValue(entry, key, key, aliases)
  return value === undefined ? fallback : value
}
const stringValue = (value: any, fallback = '') =>
  value === undefined || value === null ? fallback : String(value)
const booleanValue = (value: any, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  return ['true', '1', 'yes', 'y', '是', '已读'].includes(String(value).toLowerCase())
}

const listData = computed<any[]>(() => {
  const fallback = Array.isArray(props.item.props.items) ? props.item.props.items : []
  if (!hasRemoteData.value) return fallback
  const data = unwrapData(remoteData.value)
  if (props.item.type === 'dataBoard' && data && !Array.isArray(data)) {
    const arrayData = sourceArray(data, [])
    if (arrayData.length) return arrayData
    return fallback.map((entry: any) => ({
      ...entry,
      value: readPath(data, mappingField('value') || entry.dataField || entry.id, entry.value)
    }))
  }
  return sourceArray(remoteData.value, [])
})

const textData = computed(() => {
  if (!hasRemoteData.value) {
    return { content: props.item.props.content || '', link: props.item.props.link || '' }
  }
  const data = unwrapData(remoteData.value)
  if (typeof data !== 'object' || data === null) {
    return { content: stringValue(data), link: props.item.props.link || '' }
  }
  const entry = Array.isArray(data) ? data[0] : data
  return {
    content: stringValue(
      mappedOr(entry, 'content', props.item.props.content, [
        'data',
        'text',
        'value',
        'label',
        'name'
      ])
    ),
    link: stringValue(mappedOr(entry, 'link', props.item.props.link, ['url', 'href']))
  }
})

const imageData = computed(() => {
  const fallback = {
    src: props.item.props.src || '',
    alt: props.item.props.alt || '',
    caption: props.item.props.caption || '',
    link: props.item.props.link || ''
  }
  if (!hasRemoteData.value) return fallback
  const data = unwrapData(remoteData.value)
  if (typeof data !== 'object' || data === null) return { ...fallback, src: stringValue(data) }
  const entry = Array.isArray(data) ? data[0] : data
  return {
    src: stringValue(mappedOr(entry, 'src', fallback.src, ['data', 'url', 'image', 'cover'])),
    alt: stringValue(mappedOr(entry, 'alt', fallback.alt, ['name', 'title'])),
    caption: stringValue(mappedOr(entry, 'caption', fallback.caption, ['title', 'name'])),
    link: stringValue(mappedOr(entry, 'link', fallback.link, ['url', 'href']))
  }
})

const carouselData = computed<any[]>(() => {
  const fallback = Array.isArray(props.item.props.images) ? props.item.props.images : []
  const source = hasRemoteData.value ? sourceArray(remoteData.value, []) : fallback
  return source.map((entry: any, index: number) => {
    const defaultValue = fallback[index] || {}
    if (typeof entry !== 'object' || entry === null) {
      return { ...defaultValue, src: stringValue(entry) }
    }
    return {
      ...defaultValue,
      ...entry,
      src: stringValue(mappedOr(entry, 'src', defaultValue.src, ['url', 'image', 'cover'])),
      title: stringValue(mappedOr(entry, 'title', defaultValue.title, ['name', 'caption'])),
      link: stringValue(mappedOr(entry, 'link', defaultValue.link, ['url', 'href'])),
      target: entry.target === '_blank' ? '_blank' : defaultValue.target || '_self'
    }
  })
})

const videoData = computed(() => {
  const fallback = { src: props.item.props.src || '', poster: props.item.props.poster || '' }
  if (!hasRemoteData.value) return fallback
  const data = unwrapData(remoteData.value)
  if (typeof data !== 'object' || data === null) return { ...fallback, src: stringValue(data) }
  const entry = Array.isArray(data) ? data[0] : data
  return {
    src: stringValue(mappedOr(entry, 'src', fallback.src, ['data', 'url', 'video', 'videoUrl'])),
    poster: stringValue(mappedOr(entry, 'poster', fallback.poster, ['cover', 'image', 'posterUrl']))
  }
})

const iframeUrl = computed(() => {
  if (!hasRemoteData.value) return props.item.props.url || ''
  const data = unwrapData(remoteData.value)
  if (typeof data !== 'object' || data === null) return stringValue(data)
  const entry = Array.isArray(data) ? data[0] : data
  return stringValue(mappedOr(entry, 'url', props.item.props.url, ['data', 'href', 'src']))
})

const shortcutData = computed<any[]>(() => {
  const fallback = Array.isArray(props.item.props.items) ? props.item.props.items : []
  const source = hasRemoteData.value ? sourceArray(remoteData.value, []) : fallback
  return source.map((entry: any, index: number) => {
    const defaultValue = fallback[index] || {}
    if (typeof entry !== 'object' || entry === null) {
      return { ...defaultValue, label: stringValue(entry) }
    }
    return {
      ...defaultValue,
      ...entry,
      label: stringValue(mappedOr(entry, 'label', defaultValue.label, ['name', 'title'])),
      icon: stringValue(mappedOr(entry, 'icon', defaultValue.icon, ['iconName'])),
      color: stringValue(mappedOr(entry, 'color', defaultValue.color, ['colorValue'])),
      url: stringValue(mappedOr(entry, 'url', defaultValue.url, ['link', 'href'])),
      target: entry.target === '_blank' ? '_blank' : defaultValue.target || '_self'
    }
  })
})

const todoSummaryData = computed<any[]>(() => {
  const fallback = Array.isArray(props.item.props.items) ? props.item.props.items : []
  if (!hasRemoteData.value) return fallback.filter((entry: any) => entry.hidden !== true)
  const data = unwrapData(remoteData.value)
  const arrayData = sourceArray(data, [])
  if (arrayData.length) {
    return arrayData
      .map((entry: any, index: number) => {
        const defaultValue = fallback[index] || {}
        if (typeof entry !== 'object' || entry === null) {
          return { ...defaultValue, value: entry }
        }
        return {
          ...defaultValue,
          ...entry,
          label: stringValue(mappedOr(entry, 'label', defaultValue.label, ['name', 'title'])),
          value: mappedOr(entry, 'value', defaultValue.value ?? 0, ['count', 'num']),
          hidden: entry.hidden === true
        }
      })
      .filter((entry: any) => entry.hidden !== true)
  }
  if (data && typeof data === 'object') {
    return fallback
      .filter((entry: any) => entry.hidden !== true)
      .map((entry: any) => ({
        ...entry,
        value: readPath(data, mappingField('value') || entry.dataField || entry.id, entry.value)
      }))
  }
  return []
})

const metricData = computed<any[]>(() => {
  const fallback = Array.isArray(props.item.props.items) ? props.item.props.items : []
  return listData.value.map((entry: any, index: number) => {
    const defaultValue = fallback[index] || {}
    if (typeof entry !== 'object' || entry === null) {
      return { ...defaultValue, value: entry }
    }
    return {
      ...defaultValue,
      ...entry,
      label: stringValue(mappedOr(entry, 'label', defaultValue.label, ['name', 'title'])),
      value: mappedOr(entry, 'value', defaultValue.value ?? 0, ['count', 'num']),
      unit: stringValue(mappedOr(entry, 'unit', defaultValue.unit, ['suffix'])),
      url: stringValue(mappedOr(entry, 'url', defaultValue.url, ['link', 'href']))
    }
  })
})

const taskData = computed<any[]>(() =>
  listData.value.map((entry: any) => ({
    ...entry,
    name: stringValue(
      mappedOr(entry, 'name', entry?.label || entry?.title || '', ['label', 'title'])
    ),
    processName: stringValue(
      mappedOr(entry, 'processName', entry?.process || '流程任务', ['process', 'workflowName'])
    ),
    createTime: mappedOr(entry, 'createTime', entry?.date || entry?.time || '', ['date', 'time']),
    url: stringValue(mappedOr(entry, 'url', entry?.link || '', ['link', 'href']))
  }))
)

const resolveUnread = (entry: any) => {
  const mapped = mappedValue(entry, 'unread', 'unread')
  if (mapped !== undefined) return booleanValue(mapped)
  const read = readPath(entry, 'read') ?? readPath(entry, 'isRead')
  if (read !== undefined) return !booleanValue(read)
  return booleanValue(entry?.unread, false)
}

const emailData = computed<any[]>(() =>
  listData.value.map((entry: any) => ({
    ...entry,
    subject: stringValue(mappedOr(entry, 'subject', entry?.title || '', ['title', 'name'])),
    sender: stringValue(mappedOr(entry, 'sender', entry?.from || '', ['from', 'author'])),
    date: stringValue(
      mappedOr(entry, 'date', entry?.time || entry?.createTime || '', ['time', 'createTime'])
    ),
    unread: resolveUnread(entry)
  }))
)
const noticeUrl = (notice: any) => {
  if (typeof notice.url === 'string' && notice.url.trim()) return notice.url
  const id = notice.id ?? notice.noticeId
  return id === undefined || id === null || id === ''
    ? '/system/notice'
    : `/system/notice?id=${encodeURIComponent(String(id))}`
}
const noticeData = computed<any[]>(() =>
  listData.value.slice(0, Math.min(50, Number(props.item.props.count) || 5)).map((entry: any) => ({
    ...entry,
    title: stringValue(mappedOr(entry, 'title', entry?.fullName || '', ['fullName', 'name'])),
    category: stringValue(mappedOr(entry, 'category', entry?.type || '', ['type'])),
    content: stringValue(mappedOr(entry, 'content', entry?.excerpt || '', ['excerpt', 'summary'])),
    date: mappedOr(entry, 'time', entry?.date || entry?.time || entry?.createTime || '', [
      'date',
      'createTime'
    ]),
    time: mappedOr(entry, 'time', entry?.time || entry?.date || entry?.createTime || '', [
      'date',
      'createTime'
    ]),
    url: stringValue(mappedOr(entry, 'url', entry?.url || noticeUrl(entry), ['link', 'href']))
  }))
)
const noticeTableColumns = computed<any[]>(() => {
  const columns = (props.item.props.columns || []).filter((column: any) => column.visible !== false)
  return columns.length ? columns : [{ key: 'title', label: '标题' }]
})
const tableRows = computed<any[]>(() => {
  const rows = sourceArray(remoteData.value, hasRemoteData.value ? [] : props.item.props.rows)
  return Array.isArray(rows) ? rows.slice(0, Number(props.item.props.tableMaxRows) || 50) : []
})

const tableColumns = computed<any[]>(() => {
  const columns = (props.item.props.columns || []).filter((column: any) => column.visible !== false)
  return columns.length ? columns : [{ key: 'name', label: '名称', align: 'left' }]
})

const rankData = computed<any[]>(() =>
  listData.value.slice(0, Number(props.item.props.rankLimit) || 10).map((entry: any) => ({
    ...entry,
    label:
      mappedValue(entry, 'label', props.item.props.rankLabelField || 'label', ['name', 'title']) ??
      entry.label ??
      entry.name ??
      '',
    value:
      mappedValue(entry, 'value', props.item.props.rankValueField || 'value', ['num', 'count']) ??
      entry.value ??
      entry.num ??
      0,
    url: stringValue(mappedValue(entry, 'url', 'url', ['link', 'href']) ?? entry.url ?? '')
  }))
)

const mapData = computed<any[]>(() => {
  const source = sourceArray(remoteData.value, hasRemoteData.value ? [] : props.item.props.mapData)
  return source.map((entry: any) => ({
    name: String(mappedValue(entry, 'name', 'name', ['label', 'category']) ?? ''),
    value: Number(mappedValue(entry, 'value', 'value', ['num', 'count'])) || 0,
    longitude: Number(mappedValue(entry, 'longitude', 'longitude', ['long', 'lng'])) || undefined,
    latitude: Number(mappedValue(entry, 'latitude', 'latitude', ['lat'])) || undefined,
    url: typeof entry?.url === 'string' ? entry.url : ''
  }))
})

const timeAxisData = computed<any[]>(() => {
  const result = listData.value
    .slice(0, Number(props.item.props.timelineLimit) || 50)
    .map((entry: any) => ({
      ...entry,
      timestamp: mappedValue(entry, 'timestamp', 'timestamp', ['time', 'date']) ?? '',
      content: mappedValue(entry, 'content', 'content', ['title', 'label']) ?? ''
    }))
  return props.item.props.timelineSort === 'desc' ? result.reverse() : result
})

const chartSeriesData = computed<any[]>(() => {
  if (chartSeries.value.length) return chartSeries.value
  return [{ name: props.item.props.title || '数据', data: values.value }]
})

const parseCustomOption = (value: unknown): Record<string, any> => {
  if (value && typeof value === 'object' && !Array.isArray(value))
    return value as Record<string, any>
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    } catch {
      // Invalid custom configuration renders an empty chart instead of breaking the portal.
    }
  }
  return {}
}

const chartTitleOption = () => {
  const title = props.item.props.chartTitle || ''
  const subtitle = props.item.props.chartSubtitle || ''
  if (!title && !subtitle) return undefined
  return {
    text: title,
    subtext: subtitle,
    left: props.item.props.chartTitleAlign || 'center',
    backgroundColor: props.item.props.chartTitleBackground || undefined,
    textStyle: {
      color: chartColor(props.item.props.chartTitleColor, '#303133', chartTheme.value.primaryText),
      fontSize: Number(props.item.props.chartTitleSize) || 18,
      fontWeight: props.item.props.chartTitleWeight === false ? 400 : 700
    },
    subtextStyle: {
      color: chartColor(
        props.item.props.chartSubtitleColor,
        '#667085',
        chartTheme.value.secondaryText
      ),
      fontSize: Number(props.item.props.chartSubtitleSize) || 12,
      fontWeight: props.item.props.chartSubtitleWeight ? 700 : 400
    }
  }
}

const chartColors = computed(() => {
  const colors = Array.isArray(props.item.props.colors)
    ? props.item.props.colors.filter((color: any) => typeof color === 'string' && color)
    : []
  return colors.length ? colors : [chartColor(props.item.props.color, '#3473ff', '#409eff')]
})

const chartOptions = computed<EChartsOption>(() => {
  const type = props.item.type
  if (type === 'customEcharts') {
    const remoteOption = remoteData.value?.option || remoteData.value?.options || remoteData.value
    return parseCustomOption(
      remoteOption && typeof remoteOption === 'object'
        ? remoteOption
        : props.item.props.customOption
    ) as EChartsOption
  }

  const tooltipTrigger = (props.item.props.tooltipTrigger ||
    (type === 'chart.pie' ? 'item' : 'axis')) as 'item' | 'axis'
  const base: EChartsOption = {
    title: chartTitleOption(),
    color: chartColors.value,
    tooltip: {
      show: props.item.props.tooltipShow !== false,
      trigger: tooltipTrigger,
      backgroundColor: props.item.props.tooltipBackground || 'rgb(17 24 39 / 92%)',
      textStyle: {
        color: chartColor(props.item.props.tooltipColor, '#ffffff', '#f4f4f5'),
        fontSize: Number(props.item.props.tooltipSize) || 12,
        fontWeight: props.item.props.tooltipWeight ? 700 : 400
      }
    }
  }

  if (type === 'mapChart') {
    const mapType = props.item.props.mapStyleType || 'region'
    const coordinateData = mapData.value
      .filter((entry) => Number.isFinite(entry.longitude) && Number.isFinite(entry.latitude))
      .map((entry) => ({
        name: entry.name,
        value: [entry.longitude, entry.latitude, entry.value],
        itemStyle: { color: chartColors.value[0] }
      }))
    const mapSeries =
      mapType === 'region'
        ? {
            type: 'map',
            map: props.item.props.mapName || 'china',
            geoIndex: 0,
            data: mapData.value,
            emphasis: { label: { show: true } }
          }
        : mapType === 'heatmap'
          ? {
              type: 'heatmap',
              coordinateSystem: 'geo',
              pointSize: Number(props.item.props.mapPointSize) || 8,
              blurSize: Number(props.item.props.mapBlurSize) || 20,
              maxOpacity: Number(props.item.props.mapPointOpacity ?? 1),
              data: coordinateData
            }
          : mapType === 'bar'
            ? {
                type: 'bar',
                coordinateSystem: 'geo',
                barWidth: Number(props.item.props.mapBarWidth) || 10,
                data: coordinateData
              }
            : mapType === 'scatter'
              ? {
                  type: 'effectScatter',
                  coordinateSystem: 'geo',
                  showEffectOn: 'render',
                  rippleEffect: { brushType: 'stroke' },
                  symbolSize: Number(props.item.props.mapPointSize) || 8,
                  itemStyle: { opacity: Number(props.item.props.mapPointOpacity ?? 1) },
                  data: coordinateData
                }
              : {
                  type: 'effectScatter',
                  coordinateSystem: 'geo',
                  showEffectOn: 'render',
                  rippleEffect: { brushType: 'stroke' },
                  symbolSize: (value: any) =>
                    Math.max(
                      Number(props.item.props.mapPointSize) || 8,
                      Math.min(32, (Number(value?.[2]) || 0) / 8)
                    ),
                  itemStyle: { opacity: Number(props.item.props.mapPointOpacity ?? 1) },
                  data: coordinateData.sort(
                    (left, right) => Number(right.value?.[2] || 0) - Number(left.value?.[2] || 0)
                  )
                }
    const geoOption = {
      map: props.item.props.mapName || 'china',
      roam: props.item.props.mapRoam !== false,
      zoom: Number(props.item.props.mapScale) || 1,
      layoutCenter: [
        `${props.item.props.mapCenterX || 50}%`,
        `${props.item.props.mapCenterY || 52}%`
      ],
      layoutSize: '100%',
      itemStyle: {
        areaColor: chartColor(props.item.props.mapAreaColor, '#eef4ff', chartTheme.value.mapArea),
        borderColor: chartColor(
          props.item.props.mapBorderColor,
          '#9db7e8',
          chartTheme.value.mapBorder
        ),
        borderWidth: Number(props.item.props.mapBorderWidth) || 0
      },
      label: {
        show: props.item.props.mapLabelShow === true,
        color: chartColor(props.item.props.mapLabelColor, '#344054', chartTheme.value.regularText),
        fontSize: Number(props.item.props.mapLabelSize) || 11,
        fontWeight: props.item.props.mapLabelWeight ? 700 : 400
      }
    }
    if (mapType === 'rank') {
      const ranked = mapData.value
        .slice()
        .sort((left, right) => right.value - left.value)
        .slice(0, Number(props.item.props.mapRankLimit) || 8)
      const rankTitle = props.item.props.mapRankTitle || '数据统计排名'
      const chartTitle = chartTitleOption()
      const rankTitleOption = {
        text: rankTitle,
        left: '66%',
        top: Number(props.item.props.mapRankGridTop) || 35,
        textStyle: {
          color: chartColor(
            props.item.props.mapRankTitleColor,
            '#303133',
            chartTheme.value.primaryText
          ),
          fontSize: Number(props.item.props.mapRankTitleSize) || 14,
          fontWeight: 700
        }
      }
      return {
        ...base,
        title: chartTitle ? [chartTitle, rankTitleOption] : rankTitleOption,
        geo: geoOption,
        visualMap:
          props.item.props.mapShowVisualMap !== false
            ? {
                type: props.item.props.mapVisualMapType || 'continuous',
                min: Number(props.item.props.mapVisualMin) || 0,
                max: Number(props.item.props.mapVisualMax) || 200,
                left: 10,
                bottom: 10,
                calculable: true,
                textStyle: { color: chartTheme.value.secondaryText }
              }
            : undefined,
        grid: {
          left: '62%',
          right: Number(props.item.props.mapRankGridRight) || 16,
          top: Number(props.item.props.mapRankGridTop) || 35,
          bottom: Number(props.item.props.mapRankGridBottom) || 24,
          containLabel: true
        },
        xAxis: { type: 'value', show: false },
        yAxis: {
          type: 'category',
          inverse: true,
          data: ranked.map((entry) => entry.name),
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: chartTheme.value.regularText, fontSize: 12 }
        },
        series: [
          {
            type: 'map',
            map: props.item.props.mapName || 'china',
            geoIndex: 0,
            data: mapData.value,
            emphasis: { label: { show: true } }
          },
          {
            type: 'bar',
            data: ranked.map((entry) => entry.value),
            barMaxWidth: 18,
            itemStyle: { color: chartColors.value[0], borderRadius: [0, 4, 4, 0] },
            label: { show: true, position: 'right', color: chartTheme.value.regularText }
          }
        ]
      } as EChartsOption
    }
    return {
      ...base,
      geo: geoOption,
      visualMap:
        props.item.props.mapShowVisualMap !== false
          ? {
              type: props.item.props.mapVisualMapType || 'continuous',
              min: Number(props.item.props.mapVisualMin) || 0,
              max: Number(props.item.props.mapVisualMax) || 200,
              left: 10,
              bottom: 10,
              calculable: true,
              textStyle: { color: chartTheme.value.secondaryText }
            }
          : undefined,
      series: [mapSeries]
    } as EChartsOption
  }

  const grid = {
    left: Number(props.item.props.marginLeft) || 16,
    top: Number(props.item.props.marginTop) || 48,
    right: Number(props.item.props.marginRight) || 16,
    bottom: Number(props.item.props.marginBottom) || 28,
    containLabel: true
  }
  const legend = {
    show: props.item.props.legendShow !== false,
    orient: props.item.props.legendOrient || 'horizontal',
    left: props.item.props.legendLeft || 'center',
    top: props.item.props.legendTop || 'bottom',
    type: 'scroll',
    textStyle: {
      color: chartColor(props.item.props.legendColor, '#667085', chartTheme.value.secondaryText),
      fontSize: Number(props.item.props.legendSize) || 12,
      fontWeight: props.item.props.legendWeight ? 700 : 400
    }
  }

  if (type === 'chart.pie')
    return {
      ...base,
      legend,
      series: [
        {
          type: 'pie',
          center: [`${props.item.props.centerX || 50}%`, `${props.item.props.centerY || 50}%`],
          radius: [
            `${props.item.props.styleType === 2 ? props.item.props.pieInnerRadius || 42 : props.item.props.pieInnerRadius || 0}%`,
            `${props.item.props.pieOuterRadius || 68}%`
          ],
          roseType: props.item.props.pieRose ? 'radius' : undefined,
          label: {
            show: props.item.props.valueShow !== false,
            position: props.item.props.pieLabelPosition || 'outside',
            color: chartColor(props.item.props.valueColor, '#303133', chartTheme.value.primaryText),
            fontSize: Number(props.item.props.valueSize) || 12,
            fontWeight: props.item.props.valueWeight ? 700 : 400,
            formatter: props.item.props.pieShowPercent === false ? '{b}: {c}' : '{b}: {d}%'
          },
          data: categories.value.map((name, index) => ({ name, value: values.value[index] ?? 0 }))
        }
      ]
    }
  if (type === 'chart.radar') {
    const max = Number(props.item.props.radarMax) || Math.max(...values.value, 100)
    return {
      ...base,
      legend,
      radar: {
        center: [`${props.item.props.centerX || 50}%`, `${props.item.props.centerY || 50}%`],
        radius: `${props.item.props.radarRadius || 62}%`,
        shape:
          props.item.props.styleType === 2 ? 'circle' : props.item.props.radarShape || 'polygon',
        indicator: categories.value.map((name) => ({ name, max })),
        axisName: {
          color: chartColor(props.item.props.valueColor, '#667085', chartTheme.value.secondaryText),
          fontSize: Number(props.item.props.valueSize) || 12
        }
      },
      series: [
        {
          type: 'radar',
          data: chartSeriesData.value.map((series: any, index: number) => ({
            name: series.name,
            value: series.data,
            lineStyle: { width: Number(props.item.props.lineWidth) || 2 },
            areaStyle: { opacity: Number(props.item.props.radarAreaOpacity) || 0.25 },
            itemStyle: { color: chartColors.value[index % chartColors.value.length] }
          }))
        }
      ]
    }
  }

  const styleType = Number(props.item.props.styleType) || 1
  const isBar = type === 'chart.bar'
  const isLine = type === 'chart.line'
  const lineStyleType = isLine ? styleType : 0
  const useStack = isBar
    ? styleType === 2 || props.item.props.barStack === true
    : isLine
      ? styleType === 4
      : false

  return {
    ...base,
    grid,
    legend,
    xAxis: {
      type: 'category',
      show: props.item.props.xAxisShow !== false,
      name: props.item.props.xAxisName || '',
      data: categories.value,
      inverse: props.item.props.xAxisInverse === true,
      nameTextStyle: {
        color: chartColor(
          props.item.props.xAxisNameColor,
          '#667085',
          chartTheme.value.secondaryText
        ),
        fontSize: Number(props.item.props.xAxisNameSize) || 12,
        fontWeight: props.item.props.xAxisNameWeight ? 700 : 400
      },
      axisLabel: {
        color: chartColor(
          props.item.props.xAxisLabelColor,
          '#667085',
          chartTheme.value.secondaryText
        ),
        fontSize: Number(props.item.props.xAxisLabelSize) || 12,
        fontWeight: props.item.props.xAxisLabelWeight ? 700 : 400,
        rotate: Number(props.item.props.xAxisLabelRotate) || 0
      },
      splitLine: {
        show: props.item.props.xAxisSplitLineShow === true,
        lineStyle: {
          color: chartColor(
            props.item.props.xAxisSplitLineColor,
            '#edf0f5',
            chartTheme.value.splitLine
          )
        }
      }
    },
    yAxis: {
      type: 'value',
      show: props.item.props.yAxisShow !== false,
      name: props.item.props.yAxisName || '',
      inverse: props.item.props.yAxisInverse === true,
      nameTextStyle: {
        color: chartColor(
          props.item.props.yAxisNameColor,
          '#667085',
          chartTheme.value.secondaryText
        ),
        fontSize: Number(props.item.props.yAxisNameSize) || 12,
        fontWeight: props.item.props.yAxisNameWeight ? 700 : 400
      },
      axisLabel: {
        color: chartColor(
          props.item.props.yAxisLabelColor,
          '#667085',
          chartTheme.value.secondaryText
        ),
        fontSize: Number(props.item.props.yAxisLabelSize) || 12,
        fontWeight: props.item.props.yAxisLabelWeight ? 700 : 400
      },
      splitLine: {
        show: props.item.props.yAxisSplitLineShow !== false,
        lineStyle: {
          color: chartColor(
            props.item.props.yAxisSplitLineColor,
            '#edf0f5',
            chartTheme.value.splitLine
          )
        }
      }
    },
    series: chartSeriesData.value.map((series: any, index: number) => ({
      name: series.name,
      type:
        isBar && styleType === 7
          ? series.type === 'line'
            ? 'line'
            : 'bar'
          : isLine
            ? 'line'
            : 'bar',
      smooth: isLine
        ? lineStyleType === 2 || (lineStyleType === 1 && props.item.props.lineSmooth !== false)
        : undefined,
      step: isLine && lineStyleType === 3 ? 'middle' : undefined,
      showBackground: isBar && styleType === 4,
      backgroundStyle: isBar && styleType === 4 ? { color: 'rgb(52 115 255 / 10%)' } : undefined,
      barWidth: isBar ? Number(props.item.props.barWidth) || undefined : undefined,
      barGap: isBar ? props.item.props.barGap || '30%' : undefined,
      stack: useStack ? 'total' : undefined,
      symbol: isLine ? props.item.props.lineSymbol || 'circle' : undefined,
      symbolSize: isLine ? Number(props.item.props.lineSymbolSize) || 7 : undefined,
      lineStyle: isLine ? { width: Number(props.item.props.lineWidth) || 2 } : undefined,
      areaStyle: isLine && props.item.props.lineArea ? { opacity: 0.12 } : undefined,
      itemStyle: {
        color: chartColors.value[index % chartColors.value.length],
        borderRadius: isBar ? Number(props.item.props.barRadius) || 0 : undefined
      },
      label: {
        show: props.item.props.valueShow !== false,
        position: props.item.props.valuePosition || 'top',
        color: chartColor(props.item.props.valueColor, '#303133', chartTheme.value.primaryText),
        fontSize: Number(props.item.props.valueSize) || 12,
        fontWeight: props.item.props.valueWeight ? 700 : 400,
        backgroundColor: props.item.props.valueBackground || undefined
      },
      data: Array.isArray(series.data) ? series.data : []
    }))
  }
})

const openShortcut = (url: string) => {
  openConfiguredLink(url, '_self')
}

const openNotice = (notice: Record<string, any>) => {
  if (props.designer) return
  const url = typeof notice.url === 'string' ? notice.url.trim() : ''
  if (url && !url.startsWith('/system/notice')) {
    openShortcut(url)
    return
  }
  selectedNotice.value = notice
  noticeDetailVisible.value = true
}

const openTask = (task: any, view: 'todo' | 'doing') => {
  if (task.url) {
    openShortcut(task.url)
    return
  }
  if (props.designer || !task.processInstanceId) return
  router.push({
    name: 'BpmProcessInstanceDetail',
    query: {
      id: task.processInstanceId,
      ...(view === 'todo' && task.taskId ? { taskId: task.taskId } : {})
    }
  })
}

const resolveConfiguredUrl = (url: unknown, context?: Record<string, any>) => {
  if (typeof url !== 'string') return ''
  return url.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key: string) => {
    const value = key.split('.').reduce((current, part) => current?.[part], context)
    return value === undefined || value === null ? '' : String(value)
  })
}

const handleTableRowClick = (row: Record<string, any>) => {
  const url = row.url || (props.item.props.jumpEnabled ? props.item.props.jumpUrl : '')
  openConfiguredLink(url, props.item.props.jumpTarget, row)
}

const handleChartClick = () => {
  if (props.item.props.jumpEnabled === true) {
    openConfiguredLink(props.item.props.jumpUrl, props.item.props.jumpTarget)
  }
}

const formatPortalDate = (value: unknown) => {
  if (!value) return ''
  const text = String(value)
  const date = dayjs(text)
  return date.isValid() && text.includes('T') ? date.format('YYYY-MM-DD HH:mm') : text
}

const formatNoticeField = (notice: any, key: string) => {
  if (key === 'time') return formatPortalDate(notice.date || notice.time)
  return notice[key] || ''
}

const noticeRowStyle = ({ rowIndex }: { rowIndex: number }) => ({
  backgroundColor:
    rowIndex % 2 === 0
      ? props.item.props.oddRowColor || props.item.props.rowBackgroundColor || undefined
      : props.item.props.evenRowColor || props.item.props.rowBackgroundColor || undefined
})

const noticeHeaderStyle = () => ({
  background: portalCssColor(
    props.item.props.headerBackgroundColor,
    '#f3f6f9',
    '--portal-surface-muted'
  ),
  color: portalCssColor(props.item.props.headerFontColor, '#303133', '--portal-text-primary'),
  fontSize: `${props.item.props.headerFontSize || 14}px`,
  fontWeight: props.item.props.headerFontWeight ? 700 : 400,
  textAlign: props.item.props.headerAlign || 'center'
})

const noticeCellStyle = ({ column }: { column: { property?: string } }) => {
  const setting = (props.item.props.columns || []).find(
    (entry: any) => entry.key === column.property
  )
  return {
    color: portalCssColor(
      setting?.color || props.item.props.rowFontColor,
      '#606266',
      '--portal-text-regular'
    ),
    fontSize: `${setting?.fontSize || props.item.props.rowFontSize || 14}px`,
    fontWeight: setting?.fontWeight ? 700 : 400
  }
}

const tableRowStyle = ({ rowIndex }: { rowIndex: number }) => ({
  backgroundColor:
    rowIndex % 2 === 0
      ? props.item.props.oddRowColor || props.item.props.rowBackgroundColor || undefined
      : props.item.props.evenRowColor || props.item.props.rowBackgroundColor || undefined,
  color: portalCssColor(props.item.props.rowFontColor, '#606266', '--portal-text-regular'),
  fontSize: `${props.item.props.rowFontSize || 14}px`,
  fontWeight: props.item.props.rowFontWeight ? 700 : 400
})

const tableHeaderStyle = () => ({
  background: portalCssColor(
    props.item.props.headerBackgroundColor,
    '#f3f6f9',
    '--portal-surface-muted'
  ),
  color: portalCssColor(props.item.props.headerFontColor, '#303133', '--portal-text-primary'),
  fontSize: `${props.item.props.headerFontSize || 14}px`,
  fontWeight: props.item.props.headerFontWeight ? 700 : 400,
  textAlign: props.item.props.headerAlign || 'center'
})

const noticeItemStyle = (index: number) => ({
  backgroundColor:
    index % 2 === 0
      ? props.item.props.oddRowColor || undefined
      : props.item.props.evenRowColor || undefined
})

const openConfiguredLink = (url: unknown, openTarget = '_self', context?: Record<string, any>) => {
  const target = safeUrl(resolveConfiguredUrl(url, context))
  if (!target || props.designer) return
  if (target.startsWith('/')) {
    router.push(target)
  } else if (openTarget === '_blank') {
    window.open(target, '_blank', 'noopener,noreferrer')
  } else {
    window.location.assign(target)
  }
}

const handleConfiguredLinkClick = (event: MouseEvent, url: string, openTarget = '_self') => {
  if (!safeUrl(url)) return
  event.preventDefault()
  event.stopPropagation()
  openConfiguredLink(url, openTarget)
}

const setVideoRate = () => {
  if (videoRef.value) videoRef.value.playbackRate = Number(props.item.props.playbackRate) || 1
}

const textStyle = computed(() => ({
  textAlign: props.item.props.align || 'left',
  color: portalCssColor(props.item.props.color, '#1f2937', '--portal-text-strong'),
  fontSize: `${props.item.props.fontSize || 14}px`,
  fontWeight: props.item.props.fontWeight ? 700 : 400,
  fontStyle: props.item.props.fontStyle ? 'italic' : 'normal',
  textDecoration: props.item.props.underline ? 'underline' : 'none',
  background: portalCssColor(props.item.props.background, '#ffffff', '--portal-surface'),
  animationDuration: `${props.item.props.textAutoplaySpeed || 20}s`
}))

const captionStyle = (values: Record<string, any>) => ({
  color: portalCssColor(values.captionColor, '#ffffff', '--portal-text-on-strong'),
  fontSize: `${values.captionFontSize || 13}px`,
  fontWeight: values.captionFontWeight ? 700 : 400,
  textAlign: values.captionAlign || 'left',
  background: values.captionBackground || 'rgb(0 0 0 / 48%)'
})

watch(() => props.item.props.playbackRate, setVideoRate)
onMounted(setVideoRate)
</script>

<style lang="scss" scoped>
.portal-widget {
  position: relative;
  display: flex;
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 12px;
  overflow: hidden;
  background: var(--portal-surface);
  border: 1px solid var(--portal-border);
  border-radius: 8px;
  box-shadow: 0 4px 14px rgb(31 41 55 / 4%);
  flex-direction: column;
}

.portal-widget.is-designer {
  cursor: pointer;
}

.portal-widget.is-designer.is-selected {
  border-color: var(--el-color-primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--el-color-primary) 16%, transparent);
}

.portal-widget.is-designer :deep(a),
.portal-widget.is-designer :deep(button),
.portal-widget.is-designer :deep(video),
.portal-widget.is-designer :deep(iframe) {
  pointer-events: none;
}
.portal-widget.is-designer :deep(.portal-container-add),
.portal-widget.is-designer :deep(.portal-container-add *) {
  pointer-events: auto;
}

.portal-widget__nested-actions {
  position: absolute;
  top: 4px;
  right: 4px;
  z-index: 5;
  display: none;
  padding: 2px;
  background: color-mix(in srgb, var(--portal-surface) 94%, transparent);
  border: 1px solid var(--portal-border);
  border-radius: 5px;
  box-shadow: 0 2px 8px rgb(31 41 55 / 10%);
  gap: 2px;
  align-items: center;
}

.portal-widget.is-designer:hover > .portal-widget__nested-actions,
.portal-widget.is-designer.is-selected > .portal-widget__nested-actions {
  display: flex;
}

.portal-widget.is-designer > .portal-widget__nested-actions,
.portal-widget.is-designer > .portal-widget__nested-actions :deep(.el-button),
.portal-widget.is-designer > .portal-widget__nested-actions :deep(button) {
  pointer-events: auto;
}

.portal-widget__nested-actions :deep(.el-button) {
  width: 24px;
  height: 24px;
  min-height: 24px;
  padding: 0;
  margin-left: 0;
  color: var(--portal-text-secondary);
}

.portal-widget__nested-actions :deep(.el-button:hover) {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.portal-widget__nested-actions :deep(.el-button:last-child:hover) {
  color: var(--el-color-danger);
  background: var(--el-color-danger-light-9);
}

.portal-widget__header {
  display: flex;
  min-height: 24px;
  align-items: center;
  gap: 8px;
}
.portal-widget__card-header {
  min-height: 32px;
  margin: -16px -16px 8px;
  padding: 8px 16px;
  justify-content: space-between;
}
.portal-widget__card-heading {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 7px;
  flex: 1;
}
.portal-widget__card-heading .portal-widget__title {
  margin-bottom: 0;
}
.portal-widget__card-action {
  max-width: 35%;
  margin-left: 12px;
  overflow: hidden;
  color: var(--el-color-primary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.portal-widget__accent {
  display: inline-block;
  width: 3px;
  height: 16px;
  background: var(--el-color-primary);
  border-radius: 2px;
}
.portal-widget__title {
  min-width: 0;
  margin-bottom: 8px;
  overflow: hidden;
  font-size: 16px;
  font-weight: 650;
  color: var(--portal-text-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.portal-widget__header .portal-widget__title {
  margin-bottom: 0;
}
.portal-widget__text {
  font-size: 14px;
  line-height: 1.75;
  color: var(--portal-text-secondary);
  white-space: pre-wrap;
}
.portal-widget__image-link,
.portal-widget__carousel-wrapper,
.portal-widget__carousel,
.portal-widget__chart,
.portal-widget__media,
.portal-widget__iframe-wrapper {
  display: block;
  width: 100%;
  height: 100%;
  min-height: 0;
}
.portal-widget__image-link,
.portal-widget__carousel-wrapper,
.portal-widget__media,
.portal-widget__iframe-wrapper {
  display: flex;
  flex-direction: column;
}
.portal-widget__image-wrapper {
  display: flex;
  width: 100%;
  height: 100%;
  min-height: 0;
  flex-direction: column;
}
.portal-widget__image-link {
  position: relative;
  min-height: 0;
  color: inherit;
  text-decoration: none;
  flex: 1;
}
.portal-widget__image-link .portal-widget__image {
  min-height: 0;
  height: auto;
  flex: 1;
}
.portal-widget__text-link {
  display: block;
  min-height: 0;
  overflow: hidden;
  color: inherit;
  text-decoration: none;
}
.portal-widget__text-viewport {
  min-height: 0;
  overflow: hidden;
}
.portal-widget__text--moving {
  display: inline-block;
  min-width: 100%;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
  animation-name: portal-text-left;
}
.portal-widget__text--moving.is-up {
  display: block;
  animation-name: portal-text-up;
}
.portal-widget__rich-text :deep(img) {
  max-width: 100%;
}
.portal-widget__rich-text :deep(p) {
  margin: 0 0 8px;
}
.portal-widget__carousel-wrapper {
  overflow: hidden;
}
.portal-widget__carousel {
  min-height: 0;
  flex: 1;
}
.portal-widget__carousel-image {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
.portal-widget__image {
  display: block;
  width: 100%;
  height: 100%;
  object-position: center;
}
.portal-widget__caption {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  padding: 8px 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.portal-widget__iframe-wrapper {
  overflow: hidden;
}
.portal-widget__iframe {
  width: 100%;
  height: 100%;
  min-height: 0;
  border: 0;
  border-radius: 4px;
  flex: 1;
}
.portal-widget__video {
  width: 100%;
  min-height: 0;
  height: auto;
  object-fit: contain;
  background: var(--el-bg-color-page);
  flex: 1;
}
.portal-widget__empty-media,
.portal-widget__drop-tip {
  display: flex;
  min-height: 54px;
  color: var(--portal-text-muted);
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.portal-widget__empty-media {
  flex: 1;
}
.portal-widget__container-body {
  display: flex;
  min-height: 0;
  padding-top: 4px;
  overflow: auto;
  flex: 1;
  flex-direction: column;
  gap: 8px;
}
.portal-widget__container-body > .portal-widget {
  min-height: 120px;
  flex: 1;
}
.portal-widget__tabs {
  min-height: 0;
  flex: 1;
}
.portal-widget__tab-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.portal-widget__tabs :deep(.el-tabs__content),
.portal-widget__tab-body {
  height: 100%;
}
.portal-widget__tab-body {
  display: flex;
  min-height: 54px;
  overflow: auto;
  flex-direction: column;
  gap: 8px;
}
.portal-widget__shortcut-grid {
  display: grid;
  min-height: 0;
  align-content: start;
  gap: 10px;
}
.portal-widget__shortcut-grid button {
  display: flex;
  min-width: 0;
  min-height: 70px;
  padding: 10px 6px;
  color: var(--portal-function-color, #475467);
  font-size: var(--portal-function-size, 13px);
  font-weight: var(--portal-function-weight, 400);
  cursor: pointer;
  background: var(--portal-surface-muted);
  border: 1px solid transparent;
  border-radius: 6px;
  flex-direction: column;
  align-items: center;
  gap: 7px;
}
.portal-widget__shortcut-grid button.has-border {
  border-color: var(--portal-border);
}
.portal-widget__shortcut-grid.is-horizontal button {
  min-height: 48px;
  flex-direction: row;
  justify-content: flex-start;
  gap: 8px;
}
.portal-widget__shortcut-grid.is-horizontal .portal-widget__shortcut-icon {
  width: 32px;
  height: 32px;
}
.portal-widget__shortcut-grid button:hover {
  background: var(--portal-surface-accent);
}
.portal-widget__shortcut-grid button > span:last-child {
  max-width: 100%;
  overflow: hidden;
  font-size: inherit;
  font-weight: inherit;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.portal-widget__shortcut-icon {
  display: grid;
  width: 38px;
  height: 38px;
  border-radius: 10px;
  place-items: center;
}
.portal-widget__shortcut-icon :deep(svg) {
  color: currentcolor;
  filter: brightness(1.1);
}
.portal-widget__todo-summary,
.portal-widget__task-list,
.portal-widget__notice-table,
.portal-widget__notice-list,
.portal-widget__rank-list,
.portal-widget__timeline {
  min-height: 0;
  overflow: auto;
}
.portal-widget__todo-summary {
  display: grid;
  align-content: start;
  gap: 10px;
}
.portal-widget__todo-summary button {
  display: flex;
  min-width: 0;
  min-height: 112px;
  padding: 12px 8px;
  color: var(--portal-text-regular);
  text-align: center;
  cursor: pointer;
  background: var(--portal-surface-soft);
  border: 1px solid transparent;
  border-radius: 6px;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 7px;
}
.portal-widget__todo-summary button.has-border {
  border-color: var(--portal-border);
}
.portal-widget__todo-summary button:hover {
  background: var(--portal-surface-accent);
  border-color: var(--el-color-primary-light-5);
}
.portal-widget__todo-summary button strong,
.portal-widget__todo-summary button > span:last-child {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.portal-widget__todo-summary button > span:last-child {
  line-height: 1.3;
}
.portal-widget__task-list {
  display: flex;
  flex-direction: column;
}
.portal-widget__task-list button,
.portal-widget__notice-list button {
  display: flex;
  width: 100%;
  min-height: 48px;
  padding: 7px 0;
  color: var(--portal-text-regular);
  text-align: left;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-bottom: 1px solid var(--portal-border-muted);
  align-items: center;
  gap: 10px;
}
.portal-widget__task-list button:hover,
.portal-widget__notice-list button:hover {
  background: var(--portal-surface-hover);
}
.portal-widget__task-icon {
  display: grid;
  width: 32px;
  height: 32px;
  color: var(--el-color-primary);
  background: var(--portal-surface-accent);
  border-radius: 8px;
  flex: none;
  place-items: center;
}
.portal-widget__task-content {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 3px;
}
.portal-widget__task-content strong,
.portal-widget__task-content small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.portal-widget__task-content strong {
  color: var(--portal-text-regular);
  font-size: 13px;
  font-weight: 500;
}
.portal-widget__task-content small,
.portal-widget__task-list time,
.portal-widget__notice-list time {
  color: var(--portal-text-muted);
  font-size: 12px;
}
.portal-widget__task-list time,
.portal-widget__notice-list time {
  flex: none;
}
.portal-widget__empty {
  display: grid;
  min-height: 100px;
  color: var(--portal-text-muted);
  place-items: center;
}
.portal-widget__todo-icon,
.portal-widget__metric-icon,
.portal-widget__mail-icon {
  display: grid;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  flex: none;
  place-items: center;
}
.portal-widget__todo-label,
.portal-widget__notice-content {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.portal-widget__todo-list strong {
  font-size: 18px;
  color: var(--portal-text-primary);
}
.portal-widget__arrow {
  color: var(--portal-text-muted);
}
.portal-widget__notice-content {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.portal-widget__notice-content strong {
  overflow: hidden;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.portal-widget__notice-content strong.is-unread {
  font-weight: 700;
}
.portal-widget__notice-content small {
  overflow: hidden;
  color: var(--portal-text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.portal-widget__notice-content {
  flex: 1;
}
.portal-widget__notice-meta {
  overflow: hidden;
  color: var(--el-color-primary);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.portal-widget__notice-title {
  max-width: 100%;
  padding: 0;
  overflow: hidden;
  color: var(--el-color-primary);
  font-size: inherit;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
  background: transparent;
  border: 0;
}
.portal-widget__notice-title:hover {
  color: var(--el-color-primary-dark-2);
}
.portal-widget__notice-table .is-wrap {
  white-space: normal;
  word-break: break-word;
}
.portal-widget__notice-image {
  display: grid;
  width: 32px;
  height: 32px;
  color: var(--el-color-primary);
  background: var(--portal-surface-accent);
  border-radius: 50%;
  flex: none;
  place-items: center;
}
.portal-widget__notice-list.is-horizontal button {
  min-height: 42px;
}
.portal-widget__notice-list.is-vertical button {
  align-items: flex-start;
}
.portal-widget__notice-list.is-vertical .portal-widget__notice-content {
  gap: 4px;
}
.portal-widget__notice-list.is-vertical .portal-widget__notice-content small {
  overflow: hidden;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.portal-widget__notice-table {
  display: flex;
  flex: 1;
  flex-direction: column;
}
.portal-widget__notice-table :deep(.el-table) {
  min-height: 0;
  flex: 1;
}
.portal-widget__notice-table :deep(.el-table__cell) {
  padding: 7px 0;
}
.portal-widget__notice-dot {
  width: 7px;
  height: 7px;
  background: var(--el-color-primary);
  border-radius: 50%;
  flex: none;
}
.portal-widget__mail {
  display: flex;
  min-height: 50px;
  padding: 7px 0;
  border-bottom: 1px solid var(--portal-border-muted);
  align-items: center;
  gap: 10px;
}
.portal-widget__mail-icon {
  color: var(--el-color-primary);
  background: var(--portal-surface-accent);
}
.portal-widget__unread {
  width: 6px;
  height: 6px;
  background: #ef4444;
  border-radius: 50%;
  flex: none;
}
.portal-widget__metric-grid {
  display: grid;
  min-height: 0;
  grid-template-columns: repeat(var(--portal-metric-columns, 4), minmax(0, 1fr));
  gap: 10px;
}
.portal-widget__metric {
  display: grid;
  min-width: 0;
  width: 100%;
  padding: 10px;
  color: inherit;
  text-align: left;
  cursor: pointer;
  background: var(--portal-surface-soft);
  border: 1px solid transparent;
  border-radius: 6px;
  grid-template-columns: auto 1fr;
  align-items: center;
  column-gap: 8px;
}
.portal-widget__metric.has-border {
  border-color: var(--portal-border);
}
.portal-widget__metric:hover {
  background: var(--portal-surface-accent);
  border-color: var(--el-color-primary-light-5);
}
.portal-widget__metric-label {
  overflow: hidden;
  color: var(--portal-text-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.portal-widget__metric strong {
  grid-column: 2;
  font-size: 20px;
  color: var(--portal-text-primary);
}
.portal-widget__metric strong small {
  font-size: 11px;
  font-weight: 400;
  color: var(--portal-text-muted);
}
.portal-widget__table-list {
  display: flex;
  min-height: 0;
  overflow: auto;
  flex-direction: column;
  gap: 8px;
}
.portal-widget__table-list-row {
  display: grid;
  min-width: 0;
  padding: 9px 10px;
  color: var(--portal-text-regular);
  text-align: left;
  cursor: pointer;
  background: var(--portal-surface-soft);
  border: 1px solid var(--portal-border);
  border-radius: 6px;
  gap: 6px 12px;
}
.portal-widget__table-list-row:hover {
  background: var(--portal-surface-accent);
  border-color: var(--el-color-primary-light-5);
}
.portal-widget__table-list-row.is-style-2 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.portal-widget__table-list-row.is-style-3 {
  grid-template-columns: minmax(0, 1fr);
}
.portal-widget__table-list-cell {
  display: flex;
  min-width: 0;
  justify-content: space-between;
  gap: 8px;
}
.portal-widget__table-list-cell small {
  color: var(--portal-text-muted);
}
.portal-widget__table-list-cell strong {
  overflow: hidden;
  color: var(--portal-text-tertiary);
  font-size: 13px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.portal-widget__rank-row {
  display: flex;
  width: 100%;
  min-height: 34px;
  padding: 0;
  color: inherit;
  text-align: left;
  cursor: pointer;
  background: transparent;
  border: 0;
  align-items: center;
  gap: 10px;
}
.portal-widget__rank-row:hover {
  background: var(--portal-surface-hover);
}
.portal-widget__rank-number {
  display: grid;
  width: 20px;
  height: 20px;
  color: var(--portal-text-secondary);
  background: var(--portal-surface-muted);
  border-radius: 50%;
  place-items: center;
  font-size: 11px;
}
.portal-widget__rank-number.rank-1 {
  color: #fff;
  background: #ef4444;
}
.portal-widget__rank-number.rank-2 {
  color: #fff;
  background: #f59e0b;
}
.portal-widget__rank-number.rank-3 {
  color: #fff;
  background: #3473ff;
}
.portal-widget__rank-label {
  overflow: hidden;
  color: var(--portal-text-tertiary);
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.portal-widget__rank-row strong {
  color: var(--portal-text-primary);
}
.portal-widget__rank-list.is-style-2 .portal-widget__rank-number,
.portal-widget__rank-list.is-style-3 .portal-widget__rank-number,
.portal-widget__rank-list.is-style-4 .portal-widget__rank-number {
  width: 24px;
  height: 24px;
  border-radius: 6px;
}
.portal-widget__rank-list.is-style-3 .portal-widget__rank-row:nth-child(-n + 3),
.portal-widget__rank-list.is-style-4 .portal-widget__rank-row:nth-child(-n + 3) {
  padding: 5px 6px;
  background: var(--portal-rank-highlight);
  border-radius: 6px;
}
.portal-widget__timeline-row {
  display: grid;
  min-height: 42px;
  color: var(--portal-text-tertiary);
  cursor: pointer;
  grid-template-columns: 52px 18px minmax(0, 1fr);
  align-items: start;
  gap: 8px;
}
.portal-widget__timeline-row:hover {
  color: var(--el-color-primary-dark-2);
  background: var(--portal-surface-hover);
}
.portal-widget__timeline-time {
  padding-top: 2px;
  color: var(--portal-text-muted);
  font-size: 12px;
}
.portal-widget__timeline-line {
  position: relative;
  height: 100%;
  border-left: 1px solid var(--portal-border);
}
.portal-widget__timeline-line i {
  position: absolute;
  top: 4px;
  left: -5px;
  width: 9px;
  height: 9px;
  background: var(--el-color-primary);
  border: 2px solid var(--portal-surface-accent);
  border-radius: 50%;
}
.portal-widget__timeline.is-style-2 .portal-widget__timeline-row {
  padding: 7px 8px;
  margin-bottom: 6px;
  background: var(--portal-surface-soft);
  border: 1px solid var(--portal-border);
  border-radius: 6px;
}
.portal-widget__timeline.is-layout-left .portal-widget__timeline-row {
  grid-template-columns: 52px 18px minmax(0, 1fr);
}
.portal-widget__timeline.is-layout-right .portal-widget__timeline-row {
  grid-template-columns: minmax(0, 1fr) 18px 52px;
}
.portal-widget__timeline.is-layout-right .portal-widget__timeline-time {
  grid-column: 3;
}
.portal-widget__timeline.is-layout-right .portal-widget__timeline-line {
  grid-column: 2;
  grid-row: 1;
}
.portal-widget__timeline.is-layout-right .portal-widget__timeline-row > span:last-child {
  grid-column: 1;
  grid-row: 1;
}
@media (width <= 768px) {
  .portal-widget__metric-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .portal-widget {
    padding: 12px;
  }
  .portal-widget__card-header {
    margin: -12px -12px 8px;
    padding: 8px 12px;
  }
}

@keyframes portal-text-left {
  0% {
    transform: translateX(100%);
  }

  100% {
    transform: translateX(-100%);
  }
}

@keyframes portal-text-up {
  0% {
    transform: translateY(100%);
  }

  100% {
    transform: translateY(-100%);
  }
}
</style>
