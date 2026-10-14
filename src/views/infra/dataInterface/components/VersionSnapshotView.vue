<template>
  <div v-if="parsed" class="version-snapshot">
    <el-descriptions :column="2" border size="small">
      <el-descriptions-item label="接口名称">{{ parsed.name || '-' }}</el-descriptions-item>
      <el-descriptions-item label="接口编码">{{ parsed.code || '-' }}</el-descriptions-item>
      <el-descriptions-item label="责任人">{{ parsed.owner || '-' }}</el-descriptions-item>
      <el-descriptions-item label="来源">{{ categoryLabel }}</el-descriptions-item>
      <el-descriptions-item label="类型">{{ typeLabel }}</el-descriptions-item>
      <el-descriptions-item label="动作类型">{{ statementLabel }}</el-descriptions-item>
      <el-descriptions-item label="是否分页">{{ parsed.hasPage === 1 ? '是' : '否' }}</el-descriptions-item>
      <el-descriptions-item label="记录日志">{{ parsed.logEnabled === 0 ? '否' : '是' }}</el-descriptions-item>
      <el-descriptions-item label="数据源编号">{{ parsed.dataSourceConfigId ?? '-' }}</el-descriptions-item>
      <el-descriptions-item label="版本号">v{{ parsed.version ?? '-' }}</el-descriptions-item>
      <el-descriptions-item label="备注" :span="2">{{ parsed.remark || '-' }}</el-descriptions-item>
    </el-descriptions>

    <template v-if="paramList.length">
      <div class="mt-12px mb-6px font-bold">入参定义</div>
      <el-table :data="paramList" size="small" border>
        <el-table-column label="参数名" prop="name" width="140" />
        <el-table-column label="标签" prop="label" width="120" />
        <el-table-column label="类型" prop="type" width="100" />
        <el-table-column label="必填" width="70" align="center">
          <template #default="{ row }">{{ row.required ? '是' : '否' }}</template>
        </el-table-column>
        <el-table-column label="默认值" prop="defaultValue" :show-overflow-tooltip="true" />
      </el-table>
    </template>

    <template v-if="parsed.config">
      <div class="mt-12px mb-6px font-bold">{{ configTitle }}</div>
      <pre class="code-block">{{ prettyConfig }}</pre>
    </template>

    <template v-if="parsed.countSql">
      <div class="mt-12px mb-6px font-bold">COUNT SQL</div>
      <pre class="code-block">{{ parsed.countSql }}</pre>
    </template>

    <template v-if="parsed.script">
      <div class="mt-12px mb-6px font-bold">后处理脚本</div>
      <pre class="code-block">{{ parsed.script }}</pre>
    </template>

    <el-collapse class="mt-12px">
      <el-collapse-item title="查看原始 JSON" name="raw">
        <pre class="code-block">{{ rawPretty }}</pre>
      </el-collapse-item>
    </el-collapse>
  </div>
  <pre v-else class="code-block">{{ snapshot || '（无内容）' }}</pre>
</template>

<script lang="ts" setup>
import type { ParamDefinitionVO } from '@/api/infra/dataInterface'
import { DICT_TYPE, getStrDictOptions } from '@/utils/dict'

/** 版本快照可视化
 *
 * 把版本里存的整份配置 JSON 拆成人能一眼看懂的结构（基本信息 + 入参 + SQL/脚本），
 * 便于判断「这个版本当时是怎么配的、要不要回滚」，而不是丢一坨裸 JSON。
 * 解析失败时回退展示原文，保证任何情况下都不白屏。
 */
defineOptions({ name: 'VersionSnapshotView' })

const props = defineProps<{ snapshot?: string }>()

const TYPE_LABELS: Record<number, string> = {
  1: 'SQL',
  2: '静态 JSON',
  3: 'HTTP 转发'
}
const STATEMENT_LABELS: Record<string, string> = {
  SELECT: '查询',
  INSERT: '新增',
  UPDATE: '修改',
  DELETE: '删除'
}

const parsed = computed<any>(() => {
  if (!props.snapshot) {
    return null
  }
  try {
    const obj = JSON.parse(props.snapshot)
    return obj && typeof obj === 'object' ? obj : null
  } catch {
    return null
  }
})

const typeLabel = computed(() =>
  parsed.value ? TYPE_LABELS[parsed.value.type] ?? String(parsed.value.type ?? '-') : '-'
)
const statementLabel = computed(() => {
  const st = parsed.value?.sqlStatementType
  if (!st) {
    return '-'
  }
  return STATEMENT_LABELS[st] ?? st
})

/**
 * 来源（代码里叫 category）：把 internal / external 翻成字典里的「内部 / 外部」
 *
 * 原来直接显示 parsed.category，用户在版本快照里看到的是一串英文码。
 * 刻意不用 dict-tag 而用文本查表：快照是<b>历史</b>数据，管理员日后从字典里删掉某一项后，
 * dict-tag 会渲染成空白（它遍历的是字典项而不是传入值），
 * 而这里查不到就退回显示原始值 —— 版本历史的职责是「当时配的是什么」，宁可显示码也不要显示空
 */
const categoryLabel = computed(() => {
  const value = parsed.value?.category
  if (!value) {
    return '-'
  }
  const dict = getStrDictOptions(DICT_TYPE.INFRA_FORM_TYPE).find((item) => item.value === value)
  return dict?.label ?? value
})

const configTitle = computed(() => {
  const type = parsed.value?.type
  if (type === 1) {
    return 'SQL 配置'
  }
  if (type === 3) {
    return 'HTTP 配置'
  }
  return '静态数据'
})

/** config 对 SQL 类型是纯文本，对静态/HTTP 是 JSON —— 能解析就美化，否则原样 */
const prettyConfig = computed(() => {
  const config = parsed.value?.config
  if (!config) {
    return ''
  }
  if (parsed.value?.type === 1) {
    return config
  }
  try {
    return JSON.stringify(JSON.parse(config), null, 2)
  } catch {
    return config
  }
})

const paramList = computed<ParamDefinitionVO[]>(() => {
  const raw = parsed.value?.params
  if (!raw) {
    return []
  }
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
})

const rawPretty = computed(() => {
  if (!props.snapshot) {
    return '（无内容）'
  }
  try {
    return JSON.stringify(JSON.parse(props.snapshot), null, 2)
  } catch {
    return props.snapshot
  }
})
</script>

<style lang="scss" scoped>
.code-block {
  padding: 10px;
  margin: 0;
  font-family: Consolas, Monaco, monospace;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--el-text-color-regular);
  background-color: var(--el-fill-color-light);
  border-radius: 4px;
}
</style>
