<template>
  <section class="portal-link-frame">
    <div class="portal-link-frame__bar">
      <span class="portal-link-frame__name">{{ portal.name }}</span>
      <el-button link type="primary" @click="openInNewTab">
        <Icon icon="ep:top-right" class="mr-3px" />新标签页打开
      </el-button>
    </div>
    <iframe
      v-if="frameSrc"
      :src="frameSrc"
      class="portal-link-frame__iframe"
      frameborder="0"
      allowfullscreen
    ></iframe>
    <el-empty v-else description="链接地址无效，请联系管理员检查门户配置" />
  </section>
</template>

<script lang="ts" setup>
import { useRouter } from 'vue-router'
import type { PortalRuntimeVO } from '@/api/infra/portal'

defineOptions({ name: 'PortalLinkFrame' })

const props = defineProps<{ portal: PortalRuntimeVO }>()
const router = useRouter()

// 外链可能被对方 X-Frame-Options/CSP 拒绝内嵌，且无法可靠地程序化探测，
// 因此工具条上的「新标签页打开」按钮常显作为兜底
const frameSrc = computed(() => {
  const url = (props.portal.linkUrl || '').trim()
  if (!url) return ''
  if (props.portal.linkType === 1) {
    return /^https?:\/\//i.test(url) ? url : ''
  }
  if (!url.startsWith('/')) return ''
  try {
    return window.location.origin + router.resolve(url).href
  } catch {
    return ''
  }
})

const openInNewTab = () => {
  if (frameSrc.value) {
    window.open(frameSrc.value, '_blank', 'noopener')
  }
}
</script>

<style lang="scss" scoped>
.portal-link-frame {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: calc(100vh - 150px);
  min-height: 480px;
  overflow: hidden;
  background: var(--el-bg-color);
  border-radius: 8px;
}

.portal-link-frame__bar {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  height: 40px;
  padding: 0 12px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.portal-link-frame__name {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.portal-link-frame__iframe {
  flex: 1;
  width: 100%;
  min-height: 0;
  border: 0;
}
</style>
