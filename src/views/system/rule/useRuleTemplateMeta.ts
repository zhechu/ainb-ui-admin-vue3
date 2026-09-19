/**
 * 规则模板元数据的模块级单例缓存。
 *
 * 后端 /system/rule/template-meta 是纯静态枚举组装，一次会话内不会变，所以：
 *   - 首次 load() 拉取并缓存，之后所有组件复用同一份；
 *   - 并发调用用 inflight 去重，避免同时打开多个编辑器时打多次请求。
 *
 * meta / loading 是跨组件共享的同一个 ref，任何一个视图触发 load 都会让所有视图更新。
 */
import { ref, computed } from 'vue'
import * as GrantApi from '@/api/system/grant'
import type { RuleTemplateMetaVO, RuleTemplateMetaItemVO, TemplateGroup } from '@/api/system/grant'

/** 空元数据骨架：meta 尚未加载时占位，避免组件里到处判空 */
const EMPTY_META: RuleTemplateMetaVO = {
  templates: [],
  slots: [],
  operators: [],
  variables: []
}

const GROUP_LABELS: Record<TemplateGroup, string> = {
  basic: '基础模板',
  derived: '派生可见性',
  advanced: '高级'
}
const GROUP_ORDER: TemplateGroup[] = ['basic', 'derived', 'advanced']

// ===== 模块级单例状态（跨组件共享）=====
const meta = ref<RuleTemplateMetaVO>(EMPTY_META)
const loading = ref(false)
const loaded = ref(false)
let inflight: Promise<void> | null = null

/**
 * 拉取并缓存元数据。已加载则直接返回；进行中则复用同一个 Promise。
 */
async function load(force = false): Promise<void> {
  if (loaded.value && !force) return
  if (inflight) return inflight
  loading.value = true
  inflight = (async () => {
    try {
      meta.value = await GrantApi.getRuleTemplateMeta()
      loaded.value = true
    } finally {
      loading.value = false
      inflight = null
    }
  })()
  return inflight
}

export function useRuleTemplateMeta() {
  /** code → 模板元数据 */
  const templateMap = computed(() => {
    const m = new Map<string, RuleTemplateMetaItemVO>()
    for (const t of meta.value.templates) m.set(t.code, t)
    return m
  })

  /** 取模板显示名，未命中回退为 code 本身 */
  const getTemplateLabel = (code?: string) => {
    if (!code) return ''
    return templateMap.value.get(code)?.displayName ?? code
  }

  /** 按 basic → derived → advanced 分组，供 el-option-group 渲染 */
  const groupedTemplates = computed(() => {
    const groups: { label: string; options: RuleTemplateMetaItemVO[] }[] = []
    for (const g of GROUP_ORDER) {
      const options = meta.value.templates.filter((t) => t.group === g)
      if (options.length) groups.push({ label: GROUP_LABELS[g], options })
    }
    return groups
  })

  return {
    meta,
    loading,
    loaded,
    load,
    templateMap,
    getTemplateLabel,
    groupedTemplates
  }
}
