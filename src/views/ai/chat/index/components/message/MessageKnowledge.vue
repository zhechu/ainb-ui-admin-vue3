<!-- 知识引用组件 -->
<template>
  <!-- 知识引用列表 -->
  <div v-if="segments && segments.length > 0" class="mt-10px p-10px rounded-8px bg-[#f5f5f5]">
    <div class="text-14px text-[#666] mb-8px flex items-center">
      <Icon icon="ep:document" class="mr-5px" /> 知识引用
    </div>
    <div class="flex flex-wrap gap-8px">
      <div
        v-for="(doc, index) in documentList"
        :key="index"
        class="p-8px px-12px bg-white rounded-6px cursor-pointer transition-all hover:bg-[#e6f4ff]"
        @click="handleClick(doc)"
      >
        <div class="text-14px text-[#333] mb-4px">
          <!-- 🔴 只有过了 isManualDocUrl 的地址才渲染成 <a>；其余降级成纯文本。
               死链 / 站外链比没有链接更坏，故宁可少一个可点的东西 -->
          <a
            v-if="doc.url"
            :href="doc.url"
            target="_blank"
            rel="noopener noreferrer"
            class="text-[var(--el-color-primary)] no-underline hover:underline"
            @click.stop
          >
            {{ doc.title }}
          </a>
          <template v-else>{{ doc.title }}</template>
          <span class="text-12px text-[#999] ml-4px">（{{ doc.segments.length }} 条）</span>
        </div>
        <!-- 文档名是相对路径（也是幂等键），与标题不是一回事：标题给人读，路径给人核对是哪一页 -->
        <div v-if="doc.name && doc.name !== doc.title" class="text-12px text-[#999]">
          {{ doc.name }}
        </div>
      </div>
    </div>
  </div>

  <!-- 知识引用详情弹窗 -->
  <el-popover
    v-model:visible="dialogVisible"
    :width="600"
    trigger="click"
    placement="top-start"
    :offset="55"
    popper-class="knowledge-popover"
  >
    <template #reference>
      <div ref="documentRef"></div>
    </template>
    <template #default>
      <div class="text-16px font-bold mb-12px">
        {{ document?.title }}
        <a
          v-if="document?.url"
          :href="document.url"
          target="_blank"
          rel="noopener noreferrer"
          class="ml-8px text-12px font-normal text-[var(--el-color-primary)] no-underline hover:underline"
        >
          打开手册页
        </a>
      </div>
      <el-scrollbar max-height="60vh">
        <div
          v-for="(segment, index) in document?.segments"
          :key="index"
          class="p-12px border-b-solid border-b-[#eee] last:border-b-0"
        >
          <div
            class="block mb-8px px-8px py-2px bg-[#f5f5f5] rounded-4px text-12px text-[#666] w-fit"
          >
            分段 {{ segment.id }}
          </div>
          <div class="text-14px leading-[1.6] text-[#333] mt-[10px]">
            {{ segment.content }}
          </div>
        </div>
      </el-scrollbar>
    </template>
  </el-popover>
</template>

<script setup lang="ts">
import { isManualDocUrl } from '@/utils/url'

const props = defineProps<{
  segments: {
    id: number
    documentId: number
    documentName: string
    documentUrl?: string
    documentTitle?: string
    content: string
  }[]
}>()

const document = ref<{
  id: number
  title: string
  name: string
  url?: string
  segments: {
    id: number
    content: string
  }[]
} | null>(null) // 知识库文档列表
const dialogVisible = ref(false) // 知识引用详情弹窗

/** 按照 document 聚合 segments */
const documentList = computed(() => {
  if (!props.segments) return []

  const docMap = new Map()
  props.segments.forEach((segment) => {
    if (!docMap.has(segment.documentId)) {
      docMap.set(segment.documentId, {
        id: segment.documentId,
        // 标题优先用后端现算的 H1（「用户管理 ★」），退回文档名（相对路径）
        title: segment.documentTitle || segment.documentName,
        name: segment.documentName,
        // 🔴 白名单校验放在聚合处、只算一次：模板里就不用每条都判，也不会漏判
        url: isManualDocUrl(segment.documentUrl) ? segment.documentUrl : undefined,
        segments: []
      })
    }
    docMap.get(segment.documentId).segments.push({
      id: segment.id,
      content: segment.content
    })
  })
  return Array.from(docMap.values())
})

/** 点击 document 处理 */
const handleClick = (doc: any) => {
  document.value = doc
  dialogVisible.value = true
}
</script>
