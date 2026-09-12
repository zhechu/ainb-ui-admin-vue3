<template>
  <!-- 标签 -->
  <el-tag v-if="kind === 'TAG'" :type="tagType" disable-transitions size="small">
    {{ text }}
  </el-tag>

  <!-- 超链接。地址不安全时上面的 resolveCellLink 不给 url，这里就降级成纯文本 -->
  <template v-else-if="kind === 'LINK'">
    <el-link v-if="link.url" :href="link.url" target="_blank" type="primary">
      {{ link.text }}
    </el-link>
    <span v-else>{{ link.text || EMPTY_CELL }}</span>
  </template>

  <!-- 图片。多图时并排显示，超过上限只显示数量，避免一行被撑爆 -->
  <template v-else-if="kind === 'IMAGE'">
    <span v-if="files.length === 0">{{ EMPTY_CELL }}</span>
    <div v-else class="list-cell-images">
      <el-image
        v-for="(file, index) in visibleFiles"
        :key="`${file.url}#${index}`"
        fit="cover"
        :initial-index="index"
        :preview-src-list="previewUrls"
        preview-teleported
        :src="file.url"
      />
      <span v-if="overflowCount > 0" class="list-cell-more">+{{ overflowCount }}</span>
    </div>
  </template>

  <!--
    附件。显示原文件名而不是哈希路径，点击是**下载**而不是在新窗口里打开。

    以前是 `<el-link :href target="_blank">` —— 对 txt / 图片 / pdf 这类
    浏览器能自己渲染的类型，点一下弹出一个新窗口把内容显示出来，
    而用户点附件列的意图几乎总是「把这个文件拿下来」。
  -->
  <template v-else-if="kind === 'FILE'">
    <span v-if="files.length === 0">{{ EMPTY_CELL }}</span>
    <div v-else class="list-cell-files">
      <el-link
        v-for="(file, index) in visibleFiles"
        :key="`${file.url}#${index}`"
        :download="file.name"
        :href="file.url"
        :title="`下载 ${file.name}`"
        type="primary"
        @click.prevent="handleDownload(file)"
      >
        <Icon class="mr-2px" icon="ep:paperclip" :size="13" />
        {{ file.name }}
      </el-link>
      <span v-if="overflowCount > 0" class="list-cell-more">等 {{ files.length }} 个</span>
    </div>
  </template>

  <!-- 文本 -->
  <span v-else>{{ text }}</span>
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import {
  cellRenderKind,
  EMPTY_CELL,
  formatCellText,
  parseCellFiles,
  resolveCellLink,
  tagTypeOf,
  type CellFileItem
} from '@/components/FormWidgets/listCell'
import { downloadFileByUrl } from '@/components/FormWidgets/fileDownload'

defineOptions({ name: 'ListCell' })

/**
 * 列表单元格
 *
 * 单元格原本是直接插值的，只能显示文字。图片、附件、超链接、标签这四种
 * 要渲染成元素，所以统一收到这个组件里 —— 插值分支也一起收进来，
 * 免得「有的列走组件、有的列走插值」时样式对不齐。
 */
const props = defineProps<{
  /** 单元格的原始值 */
  value: any
  /** 列配置，格式化配置在 col.formatter 上 */
  col: any
}>()

/** 一格里最多并排显示几个图片 / 附件，多的折成计数 */
const MAX_INLINE_FILES = 3

const formatter = computed(() => props.col?.formatter)
const kind = computed(() => cellRenderKind(formatter.value))
const text = computed(() => formatCellText(props.value, formatter.value))
const tagType = computed(() => tagTypeOf(props.value, formatter.value))
const link = computed(() => resolveCellLink(props.value, formatter.value))
const files = computed(() => parseCellFiles(props.value))
const visibleFiles = computed(() => files.value.slice(0, MAX_INLINE_FILES))
const overflowCount = computed(() => Math.max(0, files.value.length - MAX_INLINE_FILES))
/** 预览要能翻到全部图片，不只是并排显示的那几张 */
const previewUrls = computed(() => files.value.map((f) => f.url))

/**
 * 点附件即下载
 *
 * 保留 a 标签的 href 是有意的：右键「链接另存为」、中键新开标签这些
 * 浏览器原生行为仍然可用，只是左键点击改成走下载。
 */
const handleDownload = (file: CellFileItem) => {
  void downloadFileByUrl(file.url, file.name)
}
</script>

<style lang="scss" scoped>
.list-cell-images {
  display: flex;
  align-items: center;
  gap: 4px;

  :deep(.el-image) {
    width: 32px;
    height: 32px;
    border-radius: 4px;
    cursor: pointer;
  }
}

.list-cell-files {
  display: flex;
  align-items: center;
  gap: 8px;
}

.list-cell-more {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
</style>
