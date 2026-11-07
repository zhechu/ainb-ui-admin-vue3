<template>
  <el-drawer v-model="visible" title="expr 可引用的事实词表" size="620">
    <div v-loading="loading">
      <div class="lede">
        这是引擎在求值时<b>唯一</b>能读到的一批名字。写进 <span class="mono">expr</span>
        的任何其它变量都求值为 nil，而 nil 参与的比较<b>不报错</b>——
        规则会恒过，配置页上看不出任何异常。
      </div>

      <!--
        🔴 available = false 的行**照样列出**、且把 note 印出来。
           它们解释了「为什么库里那 20 条平台规则出厂就是停用的」。
           藏掉之后技术负责人看到的是一片没有理由的灰色 ——
           而「不知道原因」的下一步通常是「那就当它坏了，别用这个功能」
      -->
      <el-alert v-if="unavailableCount > 0" type="warning" :closable="false" show-icon>
        <div class="alert-text">
          有 <b>{{ unavailableCount }}</b> 个事实这一版算不出来，下面单独列了一段。
        </div>
        <div class="alert-sub">
          它们<b>不是</b>写错了的名字，而是本版本还没有数据源。 把它们写进
          <span class="mono">expr</span>，<b>保存时就会被拒</b>；
          库里那一批引用了它们的平台规则也因此出厂即停用。
        </div>
      </el-alert>

      <el-input v-model="keyword" placeholder="按名字或说明筛选" clearable class="mt-12px mb-8px" />

      <div v-for="group in groupedAvailable" :key="group.root" class="fact-group">
        <div class="fact-root mono">{{ group.root }}</div>
        <div v-for="fact in group.facts" :key="fact.key" class="fact-row">
          <div class="fact-main">
            <span class="mono fact-key">{{ fact.key }}</span>
            <el-tag v-if="fact.kind" size="small" type="info">{{ fact.kind }}</el-tag>
            <el-button v-if="selectable" link type="primary" size="small" @click="pick(fact.key)">
              插入
            </el-button>
          </div>
          <div v-if="fact.note" class="fact-note">{{ fact.note }}</div>
        </div>
      </div>

      <div v-if="unavailable.length > 0" class="fact-group fact-group-off">
        <div class="fact-root mono">这一版算不出来的</div>
        <div v-for="fact in unavailable" :key="fact.key" class="fact-row">
          <div class="fact-main">
            <span class="mono fact-key">{{ fact.key }}</span>
            <el-tag v-if="fact.kind" size="small" type="info">{{ fact.kind }}</el-tag>
            <!--
              🔴 不可用的事实**不给**「插入」按钮，而不是给一个置灰的：
                 置灰会被理解成「这功能坏了」，与 §11.9.2.6 第 6 条同一条 UI 纪律。
                 而插入一个恒为 nil 的名字，产物是一条恒过的规则 —— 全程 200 无异常
            -->
          </div>
          <div class="fact-note">{{ fact.note || '（后端没有给原因）' }}</div>
        </div>
      </div>

      <!--
        🔴 p.* **不在**这份词表里，也不要试图把它列出来：
           它不是事实，是这条规则自己那一列 expr_params 的键
      -->
      <div class="hint-line mt-12px">
        <span class="mono">p.xxx</span> 不在这份词表里 —— 它不是事实，
        是这条规则自己「阈值参数」那一格里的键。
      </div>
    </div>
  </el-drawer>
</template>
<script lang="ts" setup>
import { QlzgReviewRuleApi, type QlzgRuleFactVO } from '@/api/qlzg/reviewRule'

/**
 * {@code expr} 可引用的事实词表浏览器
 *
 * <h3>🔴 数据只从 {@code /fact/list} 来，前端**不自己维护**一份事实清单</h3>
 * 那一份清单是引擎 {@code RuleFactLoader} 装载的 16 个根的投影，
 * 而它会随版本变（I6 会把 {@code cases.selectedUntraceableCount} 打开）。
 * 前端抄一份的结果是「词表里有、引擎里恒为 nil」——
 * 一条恒过的规则，全程 200 无异常，配置页上看不出任何异常
 *
 * <h3>🔴 按 {@code key} 插入，不按库里的章节码拼</h3>
 * 章节事实的第二段是 **env 码**：库里存 {@code S07-1}，expr 里只能写
 * {@code sections.S07_1}（aviator 解析不了连字符）。
 * 自己拼的那一支在引擎里恒为 nil，规则恒过
 *
 * <h3>🔴 {@code note} 原样渲染纯文本，不 v-html、不再加工</h3>
 * 它由后端 {@code QlzgUserFacingTextGuardTest} 守着不带源码标记 ——
 * 那个守卫存在的全部理由，就是让前端可以闭着眼睛把它印出来
 *
 * @author 走进新时代
 */
defineOptions({ name: 'QlzgReviewFactListDrawer' })

defineProps<{
  /** true = 每一行给一个「插入」按钮，点了 emit('pick', key)；false = 只浏览 */
  selectable?: boolean
}>()

const emit = defineEmits(['pick'])

const visible = ref(false)
const loading = ref(false)
const keyword = ref('')
const facts = ref<QlzgRuleFactVO[]>([])
/** 词表只在第一次打开时读一次；「刷新」由外层页面负责（它会重建整个组件） */
let loaded = false

const matched = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (kw === '') return facts.value
  return facts.value.filter(
    (f) =>
      f.key.toLowerCase().includes(kw) ||
      (f.note ?? '').toLowerCase().includes(kw) ||
      (f.root ?? '').toLowerCase().includes(kw)
  )
})

const available = computed(() => matched.value.filter((f) => f.available !== false))
const unavailable = computed(() => matched.value.filter((f) => f.available === false))
const unavailableCount = computed(() => facts.value.filter((f) => f.available === false).length)

/**
 * 按 {@code root} 分组
 *
 * 🔴 顺序取自**词表本身**第一次出现的位置，不排序、不用字典序：
 *    后端那一份是按「16 个根」的装载顺序下发的，而它对应的是
 *    「报告 → 项目 → 测算 → 案例」这条阅读顺序。
 *    按字母排会把 {@code calc.*} 顶到最前面，而配置一条规则时最先要找的是 {@code report.*}
 */
const groupedAvailable = computed(() => {
  const order: string[] = []
  const byRoot = new Map<string, QlzgRuleFactVO[]>()
  for (const fact of available.value) {
    const root = fact.root ?? '（后端没有给根名）'
    if (!byRoot.has(root)) {
      byRoot.set(root, [])
      order.push(root)
    }
    byRoot.get(root)!.push(fact)
  }
  return order.map((root) => ({ root, facts: byRoot.get(root)! }))
})

const pick = (key: string) => {
  emit('pick', key)
  visible.value = false
}

const open = async () => {
  visible.value = true
  if (loaded) return
  loading.value = true
  try {
    facts.value = await QlzgReviewRuleApi.getFactList()
    loaded = true
  } finally {
    loading.value = false
  }
}
defineExpose({ open })
</script>
<style lang="scss" scoped>
.lede {
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.8;
  color: var(--el-text-color-regular);
  background: var(--el-fill-color-lighter);
  border-radius: 4px;
}

.alert-text {
  font-size: 13px;
  line-height: 1.7;
}

.alert-sub {
  margin-top: 2px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}

.fact-group {
  margin-top: 14px;
}

.fact-group-off {
  padding: 10px 12px;
  background: var(--el-fill-color-lighter);
  border-radius: 4px;
}

.fact-root {
  padding-bottom: 4px;
  margin-bottom: 4px;
  font-size: 12px;
  font-weight: bold;
  color: var(--el-text-color-secondary);
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.fact-row {
  padding: 4px 0;
}

.fact-main {
  display: flex;
  gap: 8px;
  align-items: center;
}

.fact-key {
  font-size: 13px;
}

.fact-note {
  margin-top: 2px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}

.hint-line {
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}

.mono {
  font-family: var(--el-font-family-mono, monospace);
}
</style>
