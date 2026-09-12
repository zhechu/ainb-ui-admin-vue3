<template>
  <div class="detail-tab-editor">
    <el-alert type="info" :closable="false" class="mb-12px">
      <template #title>
        详情页此前只有表单本体。<b>表单固定是第一个页签</b>，这里配的页签排在它后面。
        新增 / 编辑态不会套页签 —— 那时页签里的内容根本还不存在。
      </template>
    </el-alert>

    <!--
      与发布校验拦的是同一批配置，这里只提示不阻断：
      「列表设计」这一步没有必填校验，在这里抛错会让用户存不了一张还没配完的表单
    -->
    <el-alert
      v-if="issues.length > 0"
      type="warning"
      :closable="false"
      class="mb-12px"
      :title="`这些页签发布时会被拦下：${issues.join('；')}`"
    />

    <div v-if="tabs.length === 0" class="empty">
      还没有页签。不配的话详情弹窗就是原来那张表单，不会多出页签头。
    </div>

    <el-table v-else :data="tabs" border size="small" class="mb-12px">
      <el-table-column label="标识" min-width="160">
        <template #default="{ row }">
          <el-input
            v-model="row.key"
            placeholder="如 changeLog"
            size="small"
            @change="emitChange"
          />
        </template>
      </el-table-column>
      <el-table-column label="标题" min-width="160">
        <template #default="{ row }">
          <el-input
            v-model="row.label"
            placeholder="如 变更记录"
            size="small"
            @change="emitChange"
          />
        </template>
      </el-table-column>
      <el-table-column label="类型" min-width="180">
        <template #default="{ row }">
          <el-select v-model="row.type" size="small" @change="handleTypeChange(row)">
            <el-option label="变更记录（CHANGE_LOG）" value="CHANGE_LOG" />
            <el-option label="关联数据（RELATION_LIST）" value="RELATION_LIST" />
          </el-select>
        </template>
      </el-table-column>
      <el-table-column label="目标表单" min-width="200">
        <template #default="{ row }">
          <el-select
            v-if="row.type === 'RELATION_LIST'"
            v-model="row.targetFormCode"
            clearable
            filterable
            placeholder="选择表单"
            size="small"
            @change="handleTargetFormChange(row)"
          >
            <el-option
              v-for="f in publishedForms"
              :key="f.code"
              :label="`${f.name}（${f.code}）`"
              :value="f.code"
            />
          </el-select>
          <span v-else class="cell-na">—</span>
        </template>
      </el-table-column>
      <el-table-column label="关联字段" min-width="200">
        <template #default="{ row }">
          <el-select
            v-if="row.type === 'RELATION_LIST'"
            v-model="row.targetField"
            clearable
            filterable
            placeholder="目标表单上指向本记录的字段"
            size="small"
            :loading="fieldsLoading"
            @change="emitChange"
          >
            <el-option
              v-for="f in targetFieldsOf(row.targetFormCode)"
              :key="f.field"
              :label="`${f.title || f.field}（${f.field}）`"
              :value="f.field"
            />
          </el-select>
          <span v-else class="cell-na">—</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="70" align="center">
        <template #default="{ $index }">
          <el-button link type="danger" size="small" @click="removeTab($index)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-button plain type="primary" size="small" @click="addTab">
      <Icon icon="ep:plus" class="mr-3px" />
      添加页签
    </el-button>

    <div class="form-tip mt-8px">
      <b>关联数据</b>：运行时按「关联字段 = 本记录主键」去查<b>目标表单</b>的分页接口，
      用来列出「挂在这条记录下面的单据」。
      <br />
      ⚠️ 权限按<b>目标表单</b>算（<code>infra:form-design-run:{目标编码}:query</code>）——
      没有的话页签是空的。这是对的：不该因为「在另一张表单的详情页里」就绕过目标表单的权限。
      <br />
      ⚠️ 关联字段必须真的在目标表单上。写错的话运行时会<b>静默忽略</b>这个条件，
      页签里会列出目标表单的<b>全部</b>数据 —— 发布校验会拦住。
    </div>
  </div>
</template>

<script lang="ts" setup>
/**
 * 详情页页签编辑器
 *
 * ## 为什么现在才有
 *
 * 与自定义按钮一样：后端与运行时渲染在 B9 就做完了，但一直没有设计器入口，
 * 只能打接口配。见交接文档第十九节。
 *
 * ## 「配了变更记录页签却没开变更日志」是这里最值得拦的一条
 *
 * 两个开关分处两个步骤（页签在这里、变更日志在「数据绑定」），很容易只开一个，
 * 而那样页签会永远是空的 —— 不报错，用户只会以为这条数据没被改过。
 * 发布校验会拦，这里给即时反馈并直接告诉他该去哪一步打开。
 */
import type { DetailTab } from '@/components/FormWidgets/detailTab'
import * as FormDesignApi from '@/api/infra/formDesign'
import { decodeFields } from '@/utils/formCreate'
import { parseFormFields } from '@/components/FormCreate/src/utils'

defineOptions({ name: 'DetailTabEditor' })

const props = defineProps<{
  /**
   * 表单是否启用了数据变更日志
   *
   * 由调用方从 tableBinding 里解析后传进来 —— 本组件自己再解析一遍那份 JSON 的话，
   * 「变更日志开没开」就有了两个判据，而它们迟早会漂
   */
  changeLogEnabled: boolean
}>()

const model = defineModel<DetailTab[]>({ default: () => [] })

/** 本地副本 + emit，与其它规则编辑器一致 */
const tabs = ref<DetailTab[]>([])

watch(
  model,
  (value) => {
    tabs.value = (value ?? []).map((tab) => ({ ...tab }))
  },
  { immediate: true, deep: true }
)

const emitChange = () => {
  model.value = tabs.value.map((tab) => ({ ...tab }))
}

const addTab = () => {
  tabs.value.push({ key: '', label: '', type: 'CHANGE_LOG' })
  emitChange()
}

// ==================== 关联数据：选表单 + 选字段 ====================
//
// 复用 RelationConfigField.vue 那套做法（表单简单列表 + 按 id 拉详情再解字段），
// 不另起一套 —— 「目标表单有哪些字段」有两个判据的话，两处迟早会漂

const publishedForms = ref<FormDesignApi.FormDesignSimpleVO[]>([])
const fieldsLoading = ref(false)
/** 表单编码 -> 字段清单。拉过的缓存住，切来切去不用重复请求 */
const targetFieldsCache = ref<Record<string, Array<{ field: string; title?: string }>>>({})

const targetFieldsOf = (code?: string) => (code ? (targetFieldsCache.value[code] ?? []) : [])

/**
 * 拉目标表单的字段
 *
 * 只要主表字段：关联条件最终落在目标表单的主表查询上，明细字段在那条 SQL 里
 * 根本不存在，选了会被后端静默忽略。
 *
 * 拉不到就给空清单，不抛出去打断整个步骤 —— 与 RelationConfigField 的处理一致
 */
const loadTargetFields = async (code?: string) => {
  if (!code || targetFieldsCache.value[code]) return
  const form = publishedForms.value.find((f) => f.code === code)
  if (!form?.id) return
  fieldsLoading.value = true
  try {
    const detail = await FormDesignApi.getFormDesign(form.id)
    const rules = decodeFields(detail.formFields ?? [])
    const collected: Array<Record<string, any>> = []
    for (const rule of rules) parseFormFields(rule as any, collected)
    targetFieldsCache.value[code] = collected
      .filter((f) => f.field && !f.subTableField)
      .map((f) => ({ field: f.field as string, title: f.title as string }))
  } catch (e) {
    console.error('[DetailTabEditor] 拉取目标表单字段失败', e)
    targetFieldsCache.value[code] = []
  } finally {
    fieldsLoading.value = false
  }
}

/** 换了目标表单，之前选的字段一定不适用了，清掉 —— 留着会指向另一张表上的同名字段 */
const handleTargetFormChange = async (row: DetailTab) => {
  row.targetField = undefined
  emitChange()
  await loadTargetFields(row.targetFormCode)
}

/** 切走 RELATION_LIST 时把它专属的两个键清掉，别在配置里留下用不上的残值 */
const handleTypeChange = (row: DetailTab) => {
  if (row.type !== 'RELATION_LIST') {
    row.targetFormCode = undefined
    row.targetField = undefined
  }
  emitChange()
}

onMounted(async () => {
  try {
    // ⚠️ 这个清单含草稿。发布校验会拦住「目标表单尚未发布」，
    // 但设计期不过滤 —— 用户常常是先建好两张表单再回来配关联的
    publishedForms.value = await FormDesignApi.getFormDesignSimpleList()
  } catch (e) {
    console.error('[DetailTabEditor] 拉取表单列表失败', e)
  }
  // 回显：把已配的目标表单字段预拉一遍，否则打开时「关联字段」是空下拉
  for (const tab of tabs.value) {
    await loadTargetFields(tab.targetFormCode)
  }
})

const removeTab = (index: number) => {
  tabs.value.splice(index, 1)
  emitChange()
}

/**
 * 发布时会被拦下的配置
 *
 * 与 `FormDesignPublishValidator#validateDetailTabs` 逐条对应。
 */
const issues = computed(() => {
  const result: string[] = []
  const seen = new Set<string>()
  tabs.value.forEach((tab, index) => {
    const label = tab.label || tab.key || `第 ${index + 1} 个`
    if (!tab.key?.trim()) {
      result.push(`「${label}」没填标识`)
    } else if (seen.has(tab.key.trim())) {
      // 前端按它做 el-tabs 的 name，重复会让切换错乱：点第二个页签显示第三个的内容
      result.push(`标识「${tab.key.trim()}」重复`)
    } else {
      seen.add(tab.key.trim())
    }
    if (tab.type === 'CHANGE_LOG' && !props.changeLogEnabled) {
      result.push(`「${label}」要求先在「数据绑定」步骤打开「记录变更日志」，否则页签永远是空的`)
    }
    if (tab.type === 'RELATION_LIST' && (!tab.targetFormCode || !tab.targetField)) {
      // 缺任何一个，页签里都只会是一片空白
      result.push(`「${label}」是关联数据，但没配齐目标表单与关联字段`)
    }
  })
  return result
})

defineExpose({ issues })
</script>

<style lang="scss" scoped>
.detail-tab-editor {
  .empty {
    padding: 16px 0;
    font-size: 13px;
    line-height: 1.7;
    color: var(--el-text-color-secondary);
  }

  .cell-na {
    color: var(--el-text-color-placeholder);
  }

  .form-tip {
    font-size: 12px;
    line-height: 1.7;
    color: var(--el-text-color-secondary);
  }
}
</style>
