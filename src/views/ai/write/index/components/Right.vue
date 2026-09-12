<template>
  <el-card class="my-card h-full">
    <template #header>
      <h3 class="m-0 px-7 shrink-0 flex items-center justify-between">
        <span>预览</span>
        <!-- 展示在右上角 -->
        <el-button color="#846af7" v-show="showCopy" @click="copyContent" size="small">
          <template #icon>
            <Icon icon="ph:copy-bold" />
          </template>
          复制
        </el-button>
      </h3>
    </template>

    <el-scrollbar ref="scrollbarRef" class="h-full box-border" view-class="h-full">
      <div class="w-full min-h-full relative flex-grow bg-white box-border p-3 sm:p-7">
        <!-- 终止生成内容的按钮 -->
        <el-button
          v-show="isWriting"
          class="absolute bottom-2 sm:bottom-5 left-1/2 -translate-x-1/2 z-36"
          @click="emits('stopStream')"
          size="small"
        >
          <template #icon>
            <Icon icon="material-symbols:stop" />
          </template>
          终止生成
        </el-button>
        <el-input
          id="inputId"
          type="textarea"
          v-model="compContent"
          autosize
          :input-style="{ boxShadow: 'none' }"
          resize="none"
          placeholder="生成的内容……"
        />
      </div>
    </el-scrollbar>
  </el-card>
</template>

<script setup lang="ts">
import { useClipboard } from '@vueuse/core'

const message = useMessage() // 消息弹窗
const { copied, copy } = useClipboard({ legacy: true }) // 粘贴板

const props = defineProps({
  content: {
    // 生成的结果
    type: String,
    default: ''
  },
  isWriting: {
    // 是否正在生成文章
    type: Boolean,
    default: false
  }
})

const emits = defineEmits(['update:content', 'stopStream'])

/** 通过计算属性，双向绑定，更改生成的内容，考虑到用户想要更改生成文章的情况 */
const compContent = computed({
  get() {
    return props.content
  },
  set(val) {
    emits('update:content', val)
  }
})

/** 滚动 */
const scrollbarRef = ref<any>()
// 生成过程中要一直贴着底部，滚动位置仍然操作原生元素
const contentRef = computed<any>(() => scrollbarRef.value?.wrapRef)
defineExpose({
  scrollToBottom() {
    contentRef.value?.scrollTo(0, contentRef.value?.scrollHeight)
  }
})

/** 点击复制的时候复制内容 */
const showCopy = computed(() => props.content && !props.isWriting) // 是否展示复制按钮，在生成内容完成的时候展示
const copyContent = () => {
  copy(props.content)
}

/** 复制成功的时候 copied.value 为 true */
watch(copied, (val) => {
  if (val) {
    message.success('复制成功')
  }
})
</script>

<style lang="scss" scoped>
.my-card {
  display: flex;
  flex-direction: column;

  :deep(.el-card__body) {
    padding: 0;
    overflow-y: auto;
    box-sizing: border-box;
    flex-grow: 1;
  }
}
</style>
