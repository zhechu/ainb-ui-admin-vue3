<template>
  <div
    v-if="projectId"
    class="h-[calc(100vh-var(--top-tool-height)-var(--tags-view-height)-2*var(--app-content-padding))]"
  >
    <MaterialPanel :project-id="projectId" />
  </div>
  <ContentWrap v-else>
    <el-empty :image-size="80">
      <template #description>
        <div class="text-14px">
          资料页要挂在某个项目下面 —— 「缺哪些」这句话只有对着一个具体的项目才有意义。
        </div>
        <div class="mt-4px text-12px text-[var(--el-text-color-secondary)]">
          请从项目台账里点开一个项目，再进它的资料页
        </div>
      </template>
      <el-button type="primary" @click="push('/qlzg/project')">去项目台账</el-button>
    </el-empty>
  </ContentWrap>
</template>

<script lang="ts" setup>
import MaterialPanel from './MaterialPanel.vue'

/**
 * 资料页（路由入口，薄壳）
 *
 * 🔴 真正的界面是 {@link MaterialPanel}，它按 `projectId` 复用、**不读路由**。
 *    I4 的作业台要把同一个面板嵌进「项目 → 标的 → 资料」的三栏布局里，
 *    如果面板自己读 `useRoute()`，作业台就得把整份逻辑抄一遍 ——
 *    而抄出来的那一份不会跟着这边一起改，两个界面对「什么算缺件」的答案会慢慢分岔。
 *    这一层存在的唯一理由就是把 `route.query.projectId` 翻译成一个 prop。
 */
defineOptions({ name: 'QlzgMaterial' })

const { push } = useRouter()
const route = useRoute()

/** ⚠️ query 里的值永远是字符串，`Number('')` 是 0 而不是 NaN，所以要先判空 */
const projectId = computed(() => {
  const raw = route.query.projectId
  const value = Number(Array.isArray(raw) ? raw[0] : raw)
  return Number.isFinite(value) && value > 0 ? value : undefined
})
</script>
