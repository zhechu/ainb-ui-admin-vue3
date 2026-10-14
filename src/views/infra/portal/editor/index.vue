<template>
  <div class="portal-theme portal-editor">
    <header class="portal-editor__header">
      <div class="portal-editor__identity">
        <el-button circle title="返回" @click="handleBack"><Icon icon="ep:arrow-left" /></el-button>
        <div class="portal-editor__meta">
          <el-input v-model="meta.name" class="portal-editor__name" placeholder="门户名称" />
          <el-input
            v-model="meta.code"
            class="portal-editor__code"
            placeholder="门户编码"
            :disabled="!!meta.id"
          />
          <el-tag :type="statusType">{{ statusLabel }}</el-tag>
        </div>
      </div>
      <div class="portal-editor__actions">
        <div class="portal-editor__history">
          <el-tooltip content="撤销" placement="top">
            <el-button
              circle
              :disabled="!canUndo || saving"
              title="撤销"
              aria-label="撤销"
              @click="handleUndo"
            >
              <Icon icon="ep:refresh-left" />
            </el-button>
          </el-tooltip>
          <el-tooltip content="重做" placement="top">
            <el-button
              circle
              :disabled="!canRedo || saving"
              title="重做"
              aria-label="重做"
              @click="handleRedo"
            >
              <Icon icon="ep:refresh-right" />
            </el-button>
          </el-tooltip>
          <el-tooltip content="清空画布" placement="top">
            <el-button
              circle
              :disabled="!totalItemCount || saving"
              title="清空画布"
              aria-label="清空画布"
              @click="handleClear"
            >
              <Icon icon="ep:delete" />
            </el-button>
          </el-tooltip>
        </div>
        <span class="portal-editor__count"
          >{{ config.items.length }} / 50 个顶层控件 · {{ totalItemCount }} / 100 个控件</span
        >
        <el-tooltip content="预览" placement="top">
          <el-button
            circle
            :disabled="saving"
            title="预览"
            aria-label="预览"
            @click="previewVisible = true"
          >
            <Icon icon="ep:view" />
          </el-button>
        </el-tooltip>
        <el-button
          :loading="savingAction === 'publish'"
          :disabled="saving && savingAction !== 'publish'"
          type="primary"
          @click="handleSave('publish')"
          ><Icon icon="ep:promotion" class="mr-4px" />保存并发布</el-button
        >
        <el-button
          :loading="savingAction === 'save'"
          :disabled="saving && savingAction !== 'save'"
          @click="handleSave('save')"
          ><Icon icon="ep:finished" class="mr-4px" />保存</el-button
        >
        <el-button :disabled="saving" @click="handleBack">
          <Icon icon="ep:close" class="mr-4px" />关闭
        </el-button>
      </div>
    </header>

    <div v-loading="loading" class="portal-editor__body">
      <main class="portal-editor__main">
        <div class="portal-editor__toolbar">
          <PortalPalette @add="handleAdd" />
          <div class="portal-editor__settings">
            <span>画布背景</span>
            <el-color-picker v-model="config.background" show-alpha />
            <span class="portal-editor__settings-label">网格间距</span>
            <el-input-number
              v-model="config.gap"
              :min="0"
              :max="64"
              controls-position="right"
            />
            <span class="portal-editor__settings-label">行高</span>
            <el-input-number
              v-model="config.rowHeight"
              :min="4"
              :max="32"
              controls-position="right"
            />
          </div>
        </div>
        <PortalDesigner
          v-model="config"
          :selected-id="selectedId"
          @add="handleAdd"
          @add-nested="handleNestedAdd"
          @select="selectedId = $event"
          @update="handleUpdate"
          @layout="handleLayout"
          @remove="handleRemove"
          @duplicate="handleDuplicate"
        />
      </main>
      <PortalPropertyPanel
        :item="selectedItem"
        @update="handleUpdate"
        @add-nested="handleNestedAdd"
        @remove="handleRemove"
        @duplicate="handleDuplicate"
      />
    </div>

    <Dialog
      v-model="previewVisible"
      title="门户预览"
      width="92%"
      top="4vh"
      body-class="portal-preview-dialog__body"
    >
      <div class="portal-editor__preview"><PortalRuntime :portal="runtimePreview" /></div>
    </Dialog>
  </div>
</template>

<script lang="ts" setup>
import * as PortalApi from '@/api/infra/portal'
import PortalRuntime from '@/components/Portal/Runtime/PortalRuntime.vue'
import {
  createDefaultPortalConfig,
  countPortalItems,
  createPortalItem,
  parsePortalConfig,
  stringifyPortalConfig
} from '@/components/Portal/helper/componentRegistry'
import PortalDesigner from '@/components/Portal/Designer/PortalDesigner.vue'
import PortalPalette from '@/components/Portal/Designer/PortalPalette.vue'
import PortalPropertyPanel from '@/components/Portal/Designer/PortalPropertyPanel.vue'
import { useTagsViewStore } from '@/store/modules/tagsView'
import { cloneDeep } from 'lodash-es'

defineOptions({ name: 'InfraPortalEditor' })

const message = useMessage()
const route = useRoute()
const { push, currentRoute } = useRouter()
const { delView } = useTagsViewStore()
const loading = ref(false)
const saving = ref(false)
const savingAction = ref<'publish' | 'save'>()
const previewVisible = ref(false)
const selectedId = ref<string>()
const config = ref(createDefaultPortalConfig())
const historyPast = ref<PortalApi.PortalConfig[]>([])
const historyFuture = ref<PortalApi.PortalConfig[]>([])
const historyReady = ref(false)
const historyApplying = ref(false)
const meta = reactive<{
  id?: number
  name: string
  code: string
  description?: string
  isDefault: boolean
  enabled: boolean
  status: number
}>({ name: '', code: '', description: '', isDefault: false, enabled: true, status: 0 })

const statusLabels: Record<number, string> = { 0: '草稿', 1: '已发布', 2: '已发布有改动' }
const statusLabel = computed(() => statusLabels[meta.status] || '草稿')
const statusType = computed(() =>
  meta.status === 1 ? 'success' : meta.status === 2 ? 'warning' : 'info'
)
const totalItemCount = computed(() => countPortalItems(config.value.items))
const canUndo = computed(() => historyPast.value.length > 1)
const canRedo = computed(() => historyFuture.value.length > 0)
const findItem = (items: PortalApi.PortalItem[], id?: string): PortalApi.PortalItem | undefined => {
  if (!id) return undefined
  for (const item of items) {
    if (item.id === id) return item
    const children = Array.isArray(item.props?.children) ? item.props.children : []
    const child = findItem(children, id)
    if (child) return child
    const tabs = Array.isArray(item.props?.tabs) ? item.props.tabs : []
    for (const tab of tabs) {
      const tabItem = findItem(Array.isArray(tab.items) ? tab.items : [], id)
      if (tabItem) return tabItem
    }
  }
  return undefined
}

const replaceItem = (
  items: PortalApi.PortalItem[],
  id: string,
  replacement?: PortalApi.PortalItem
): { items: PortalApi.PortalItem[]; found: boolean } => {
  let found = false
  const nextItems = items
    .filter((item) => {
      if (item.id === id) {
        found = true
        return replacement
      }
      return true
    })
    .map((item) => {
      if (item.id === id) return replacement!
      let nextItem = item
      const children = Array.isArray(item.props?.children) ? item.props.children : []
      if (children.length) {
        const result = replaceItem(children, id, replacement)
        if (result.found) {
          found = true
          nextItem = { ...nextItem, props: { ...nextItem.props, children: result.items } }
        }
      }
      const tabs = Array.isArray(nextItem.props?.tabs) ? nextItem.props.tabs : []
      if (tabs.length) {
        let tabsFound = false
        const nextTabs = tabs.map((tab: any) => {
          const result = replaceItem(Array.isArray(tab.items) ? tab.items : [], id, replacement)
          if (!result.found) return tab
          found = true
          tabsFound = true
          return { ...tab, items: result.items }
        })
        if (tabsFound) nextItem = { ...nextItem, props: { ...nextItem.props, tabs: nextTabs } }
      }
      return nextItem
    })
  return { items: nextItems, found }
}

const selectedItem = computed(() => findItem(config.value.items, selectedId.value))
const runtimePreview = computed<PortalApi.PortalRuntimeVO>(() => ({
  id: meta.id || 0,
  name: meta.name || '门户预览',
  code: meta.code || 'preview',
  version: 0,
  content: stringifyPortalConfig(config.value),
  schemaVersion: config.value.schemaVersion
}))

const overlaps = (
  first: Pick<PortalApi.PortalItem, 'x' | 'y' | 'w' | 'h'>,
  second: Pick<PortalApi.PortalItem, 'x' | 'y' | 'w' | 'h'>
) =>
  first.x < second.x + second.w &&
  first.x + first.w > second.x &&
  first.y < second.y + second.h &&
  first.y + first.h > second.y

const findFreePosition = (item: PortalApi.PortalItem) => {
  const maxY = Math.max(0, ...config.value.items.map((entry) => Math.max(0, entry.y + entry.h)))
  for (let y = 0; y <= maxY + item.h; y++) {
    for (let x = 0; x <= config.value.columns - item.w; x++) {
      const candidate = { ...item, x, y }
      if (!config.value.items.some((entry) => overlaps(candidate, entry))) {
        return { x, y }
      }
    }
  }
  return { x: 0, y: maxY + 1 }
}

const loadData = async () => {
  const id = Number(route.query.id)
  if (!id) return
  loading.value = true
  try {
    const data = await PortalApi.getPortal(id)
    Object.assign(meta, {
      id: data.id,
      name: data.name,
      code: data.code,
      description: data.description,
      isDefault: data.isDefault,
      enabled: data.enabled,
      status: data.status
    })
    config.value = parsePortalConfig(data.content)
  } finally {
    loading.value = false
  }
}

const snapshotConfig = () => cloneDeep(config.value)

const resetHistory = () => {
  historyPast.value = [snapshotConfig()]
  historyFuture.value = []
  historyReady.value = true
}

watch(
  config,
  () => {
    if (!historyReady.value || historyApplying.value) return
    const next = snapshotConfig()
    const previous = historyPast.value[historyPast.value.length - 1]
    if (previous && JSON.stringify(previous) === JSON.stringify(next)) return
    historyPast.value.push(next)
    if (historyPast.value.length > 100) historyPast.value.shift()
    historyFuture.value = []
  },
  { deep: true, flush: 'post' }
)

const applyHistorySnapshot = (snapshot: PortalApi.PortalConfig) => {
  historyApplying.value = true
  config.value = cloneDeep(snapshot)
  if (selectedId.value && !findItem(config.value.items, selectedId.value)) {
    selectedId.value = undefined
  }
  nextTick(() => {
    historyApplying.value = false
  })
}

const handleUndo = () => {
  if (!canUndo.value) return
  const current = historyPast.value.pop()
  if (current) historyFuture.value.push(current)
  const previous = historyPast.value[historyPast.value.length - 1]
  if (previous) applyHistorySnapshot(previous)
}

const handleRedo = () => {
  if (!canRedo.value) return
  const next = historyFuture.value.pop()
  if (!next) return
  historyPast.value.push(next)
  applyHistorySnapshot(next)
}

const handleClear = async () => {
  try {
    await message.confirm('确认清空当前画布上的全部控件吗？')
    config.value = { ...config.value, items: [] }
    selectedId.value = undefined
  } catch {
    return
  }
}

const handleAdd = (type: string, position?: { x: number; y: number }) => {
  if (config.value.items.length >= 50) {
    message.warning('最多只能添加 50 个顶层控件')
    return
  }
  if (totalItemCount.value >= 100) {
    message.warning('门户控件总数不能超过 100 个')
    return
  }
  const item = createPortalItem(type, config.value.items.length)
  if (position) {
    item.x = Math.min(position.x, config.value.columns - item.w)
    item.y = position.y
  } else {
    const freePosition = findFreePosition(item)
    item.x = freePosition.x
    item.y = freePosition.y
  }
  config.value.items.push(item)
  selectedId.value = item.id
}

const findItemDepth = (
  items: PortalApi.PortalItem[],
  id: string,
  depth = 0
): number | undefined => {
  for (const item of items) {
    if (item.id === id) return depth
    const children = Array.isArray(item.props?.children) ? item.props.children : []
    const childDepth = findItemDepth(children, id, depth + 1)
    if (childDepth !== undefined) return childDepth
    const tabs = Array.isArray(item.props?.tabs) ? item.props.tabs : []
    for (const tab of tabs) {
      const tabDepth = findItemDepth(Array.isArray(tab.items) ? tab.items : [], id, depth + 1)
      if (tabDepth !== undefined) return tabDepth
    }
  }
  return undefined
}

const appendNestedItem = (
  items: PortalApi.PortalItem[],
  parentId: string,
  child: PortalApi.PortalItem,
  tabId?: string
): { items: PortalApi.PortalItem[]; found: boolean } => {
  let found = false
  const nextItems = items.map((item) => {
    if (item.id === parentId) {
      if (item.type === 'card') {
        found = true
        return {
          ...item,
          props: {
            ...item.props,
            children: [...(Array.isArray(item.props.children) ? item.props.children : []), child]
          }
        }
      }
      if (item.type === 'tabs') {
        const tabs = cloneDeep(Array.isArray(item.props.tabs) ? item.props.tabs : [])
        const target =
          tabs.find((tab: any) => tab.id === tabId) ||
          tabs.find((tab: any) => tab.id === item.props.active) ||
          tabs[0]
        if (target) {
          target.items = [...(Array.isArray(target.items) ? target.items : []), child]
          found = true
          return { ...item, props: { ...item.props, tabs } }
        }
      }
      return item
    }

    const children = Array.isArray(item.props?.children) ? item.props.children : []
    if (children.length) {
      const result = appendNestedItem(children, parentId, child, tabId)
      if (result.found) {
        found = true
        return { ...item, props: { ...item.props, children: result.items } }
      }
    }

    const tabs = Array.isArray(item.props?.tabs) ? item.props.tabs : []
    for (let index = 0; index < tabs.length; index++) {
      const tabItems = Array.isArray(tabs[index].items) ? tabs[index].items : []
      const result = appendNestedItem(tabItems, parentId, child, tabId)
      if (result.found) {
        const nextTabs = [...tabs]
        nextTabs[index] = { ...tabs[index], items: result.items }
        found = true
        return { ...item, props: { ...item.props, tabs: nextTabs } }
      }
    }
    return item
  })
  return { items: nextItems, found }
}

const handleNestedAdd = (type: string, parentId: string, tabId?: string) => {
  if (totalItemCount.value >= 100) {
    message.warning('门户控件总数不能超过 100 个')
    return
  }
  const parentDepth = findItemDepth(config.value.items, parentId)
  if (parentDepth === undefined) return
  if (parentDepth >= 4) {
    message.warning('组件嵌套层级不能超过 4 层')
    return
  }
  const child = createPortalItem(type, totalItemCount.value, true)
  const result = appendNestedItem(config.value.items, parentId, child, tabId)
  if (!result.found) return
  config.value.items = result.items
  selectedId.value = child.id
}

const handleUpdate = (item: PortalApi.PortalItem) => {
  const result = replaceItem(config.value.items, item.id, item)
  if (!result.found) return
  if (countPortalItems(result.items) > 100) {
    message.warning('门户控件总数不能超过 100 个')
    return
  }
  config.value.items = result.items
}

const handleLayout = (items: Array<{ id: string; x: number; y: number; w: number; h: number }>) => {
  const positions = new Map(items.map((item) => [item.id, item]))
  config.value.items.forEach((item) => {
    const next = positions.get(item.id)
    if (!next) return
    if (item.x === next.x && item.y === next.y && item.w === next.w && item.h === next.h) return
    Object.assign(item, next)
  })
}

const handleRemove = (id: string) => {
  const result = replaceItem(config.value.items, id)
  if (result.found) config.value.items = result.items
  if (selectedId.value === id) selectedId.value = undefined
}

const duplicateItem = (
  items: PortalApi.PortalItem[],
  id: string,
  copyId: string,
  nested = false
): { items: PortalApi.PortalItem[]; found: boolean } => {
  for (let index = 0; index < items.length; index++) {
    const item = items[index]
    if (item.id === id) {
      const copy = cloneDeep(item)
      regenerateItemIds(copy, copyId)
      if (!nested) {
        copy.x = Math.min(item.x + 1, config.value.columns - item.w)
        copy.y = item.y + item.h + 1
      }
      items.splice(index + 1, 0, copy)
      return { items, found: true }
    }

    const children = Array.isArray(item.props?.children) ? item.props.children : []
    if (children.length) {
      const result = duplicateItem(children, id, copyId, true)
      if (result.found) {
        items[index] = { ...item, props: { ...item.props, children: result.items } }
        return { items, found: true }
      }
    }

    const tabs = Array.isArray(item.props?.tabs) ? item.props.tabs : []
    for (let tabIndex = 0; tabIndex < tabs.length; tabIndex++) {
      const tab = tabs[tabIndex]
      const tabItems = Array.isArray(tab.items) ? tab.items : []
      const result = duplicateItem(tabItems, id, copyId, true)
      if (result.found) {
        const nextTabs = [...tabs]
        nextTabs[tabIndex] = { ...tab, items: result.items }
        items[index] = { ...item, props: { ...item.props, tabs: nextTabs } }
        return { items, found: true }
      }
    }
  }
  return { items, found: false }
}

const regenerateItemIds = (item: PortalApi.PortalItem, id?: string) => {
  item.id = id || `portal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const children = Array.isArray(item.props?.children) ? item.props.children : []
  children.forEach((child: PortalApi.PortalItem) => regenerateItemIds(child))
  const tabs = Array.isArray(item.props?.tabs) ? item.props.tabs : []
  tabs.forEach((tab: any) => {
    const tabItems = Array.isArray(tab.items) ? tab.items : []
    tabItems.forEach((child: PortalApi.PortalItem) => regenerateItemIds(child))
  })
}

const handleDuplicate = (id: string) => {
  const isTopLevel = config.value.items.some((item) => item.id === id)
  if (isTopLevel && config.value.items.length >= 50) {
    message.warning('最多只能添加 50 个顶层控件')
    return
  }
  if (totalItemCount.value >= 100) {
    message.warning('门户控件总数不能超过 100 个')
    return
  }
  const source = findItem(config.value.items, id)
  if (!source) return
  const copyId = `portal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const result = duplicateItem(config.value.items, id, copyId)
  if (!result.found) return
  if (countPortalItems(result.items) > 100) {
    message.warning('门户控件总数不能超过 100 个')
    return
  }
  config.value.items = result.items
  selectedId.value = copyId
}

const validateMeta = () => {
  if (!meta.name.trim()) {
    message.warning('请输入门户名称')
    return false
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(meta.code)) {
    message.warning('请输入合法的门户编码')
    return false
  }
  return true
}

type SaveAction = 'publish' | 'save'

const handleSave = async (action: SaveAction = 'save') => {
  if (!validateMeta()) return
  const isCreate = !meta.id
  saving.value = true
  savingAction.value = action
  try {
    const data: PortalApi.PortalSaveReqVO = {
      id: meta.id,
      name: meta.name,
      code: meta.code,
      description: meta.description,
      content: stringifyPortalConfig(config.value),
      isDefault: meta.isDefault,
      enabled: meta.enabled
    }
    if (meta.id) {
      await PortalApi.updatePortal(data)
    } else {
      meta.id = await PortalApi.createPortal(data)
    }
    const portalId = meta.id
    if (!portalId) return
    const savedPortal = await PortalApi.getPortal(portalId)
    meta.status = savedPortal.status
    if (action === 'publish') {
      const result = await message.prompt('请输入发布说明（可选）', '发布门户')
      await PortalApi.publishPortal({ id: portalId, publishRemark: result.value })
      meta.status = (await PortalApi.getPortal(portalId)).status
      message.success('保存并发布成功')
    } else {
      message.success(isCreate ? '创建成功' : '保存成功')
    }
  } catch {
    return
  } finally {
    saving.value = false
    savingAction.value = undefined
  }
}

const handleBack = () => {
  delView(unref(currentRoute))
  push({ name: 'InfraPortal' })
}

onMounted(async () => {
  await loadData()
  resetHistory()
})
</script>

<style lang="scss" scoped>
.portal-editor {
  display: flex;
  height: calc(
    100vh - var(--top-tool-height) - var(--tags-view-height) - var(--app-content-padding) * 2
  );
  min-height: 720px;
  flex-direction: column;
  overflow: hidden;
  color: var(--portal-text-regular);
  background: var(--portal-page-bg);
}

.portal-editor__header {
  display: flex;
  min-height: 52px;
  padding: 6px 14px;
  background: var(--portal-surface);
  border-bottom: 1px solid var(--portal-border-light);
  align-items: center;
  gap: 12px;
  justify-content: space-between;
}

.portal-editor__identity,
.portal-editor__actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.portal-editor__identity {
  min-width: 0;
  flex: 1;
}

.portal-editor__actions {
  flex: 0 0 auto;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.portal-editor__history {
  display: flex;
  align-items: center;
  gap: 4px;
}

.portal-editor__history :deep(.el-button),
.portal-editor__actions > :deep(.el-tooltip) .el-button {
  margin-left: 0;
}

.portal-editor__meta {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}

.portal-editor__name {
  width: 180px;
}

.portal-editor__code {
  width: 170px;
}

.portal-editor__name :deep(.el-input__wrapper),
.portal-editor__code :deep(.el-input__wrapper) {
  padding: 0;
  box-shadow: none;
}

.portal-editor__name :deep(input) {
  font-size: 15px;
  font-weight: 650;
  color: var(--portal-text-primary);
}

.portal-editor__code :deep(input) {
  font-size: 12px;
  color: var(--portal-text-muted);
}

.portal-editor__count,
.portal-editor__settings-label {
  font-size: 12px;
  color: var(--portal-text-secondary);
}

.portal-editor__body {
  display: grid;
  min-height: 0;
  flex: 1;
  grid-template-columns: minmax(0, 1fr) 300px;
  overflow: hidden;
}

.portal-editor__main {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
}

.portal-editor__toolbar {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  background: var(--portal-surface);
  border-bottom: 1px solid var(--portal-border-light);
}

.portal-editor__settings {
  display: flex;
  flex: 0 0 auto;
  padding: 0 16px 0 0;
  font-size: 12px;
  color: var(--portal-text-secondary);
  align-items: center;
  gap: 8px;
}

.portal-editor__settings :deep(.el-input-number) {
  width: 100px;
}

.portal-editor__preview {
  max-height: calc(100vh - 150px);
  overflow: auto;
}

.portal-editor__preview :deep(.portal-runtime) {
  min-height: 600px;
}

:global(.com-dialog .portal-preview-dialog__body) {
  padding: 0 !important;
}

@media (width <= 1100px) {
  .portal-editor__body {
    grid-template-columns: minmax(0, 1fr);
  }

  .portal-properties {
    display: none;
  }
}

@media (width <= 700px) {
  .portal-editor {
    height: auto;
    min-height: 720px;
    overflow: visible;
  }

  .portal-editor__header {
    align-items: flex-start;
    flex-direction: column;
    gap: 10px;
  }

  .portal-editor__identity {
    width: 100%;
  }

  .portal-editor__meta {
    flex: 1;
  }

  .portal-editor__body {
    display: block;
    overflow: visible;
  }

  .portal-editor__toolbar {
    flex-wrap: wrap;
  }

  .portal-editor__settings {
    width: 100%;
    padding: 0 16px 8px;
  }

  .portal-editor__actions {
    width: 100%;
    justify-content: flex-start;
  }
}
</style>
