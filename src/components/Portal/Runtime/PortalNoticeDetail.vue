<template>
  <Dialog
    :model-value="visible"
    class="portal-theme"
    title="公告详情"
    width="680px"
    @update:model-value="emit('update:visible', $event)"
  >
    <article class="portal-notice-detail">
      <h2>{{ notice?.title || '公告详情' }}</h2>
      <div class="portal-notice-detail__meta">
        <span>{{ notice?.category || '其他' }}</span>
        <span>{{ formatDate(notice?.date || notice?.time) }}</span>
        <span v-if="notice?.creator">{{ notice.creator }}</span>
      </div>
      <p v-if="notice?.excerpt" class="portal-notice-detail__excerpt">{{ notice.excerpt }}</p>
      <div
        v-if="notice?.content"
        v-dompurify-html="notice.content"
        class="portal-notice-detail__content"
      ></div>
      <el-empty v-else description="暂无公告内容" :image-size="70" />
    </article>
  </Dialog>
</template>

<script lang="ts" setup>
import dayjs from 'dayjs'

defineOptions({ name: 'PortalNoticeDetail' })

defineProps<{
  visible: boolean
  notice?: Record<string, any> | null
}>()
const emit = defineEmits<{ 'update:visible': [value: boolean] }>()

const formatDate = (value: unknown) => {
  if (!value) return ''
  const text = String(value)
  const date = dayjs(text)
  return date.isValid() && text.includes('T') ? date.format('YYYY-MM-DD HH:mm') : text
}
</script>

<style lang="scss" scoped>
.portal-notice-detail h2 {
  margin: 0;
  color: var(--portal-text-primary);
  font-size: 20px;
  font-weight: 650;
  line-height: 1.4;
  text-align: center;
}

.portal-notice-detail__meta {
  display: flex;
  justify-content: center;
  gap: 16px;
  margin-top: 10px;
  padding-bottom: 12px;
  color: var(--portal-text-muted);
  font-size: 12px;
  border-bottom: 1px solid var(--portal-border-light);
}

.portal-notice-detail__excerpt {
  margin: 16px 0 0;
  color: var(--portal-text-secondary);
  line-height: 1.7;
}

.portal-notice-detail__content {
  min-height: 180px;
  margin-top: 16px;
  color: var(--portal-text-regular);
  line-height: 1.8;
  overflow-wrap: anywhere;
}

@media (width <= 600px) {
  .portal-notice-detail__meta {
    flex-wrap: wrap;
    gap: 4px 12px;
  }
}
</style>
