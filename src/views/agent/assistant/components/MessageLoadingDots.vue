<!-- 等待首个字符时的占位 -->
<template>
  <div class="flex items-center gap-4px h-22px">
    <span v-for="i in 3" :key="i" class="dot" :style="{ animationDelay: `${(i - 1) * 0.16}s` }"></span>
  </div>
</template>

<script setup lang="ts">
/**
 * 为什么需要这个占位
 *
 * RAG 问答实测首字延迟 7~22 秒（要先向量检索、再把 5 段手册塞进 prompt）。
 * 这段时间里若助手气泡是空的，用户会以为点击没生效而反复点发送 ——
 * 每点一次都是一次真实的模型调用，既花钱又把对话搞乱。
 */
</script>

<style scoped>
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--el-text-color-secondary);
  animation: blink 1.2s infinite ease-in-out;
}

@keyframes blink {
  0%,
  80%,
  100% {
    opacity: 0.25;
  }
  40% {
    opacity: 1;
  }
}
</style>
