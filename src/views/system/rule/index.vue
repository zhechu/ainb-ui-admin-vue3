<template>
  <ContentWrap>
    <div class="mb-12px flex items-center justify-between">
      <span class="text-16px font-medium">行过滤规则管理</span>
      <el-button v-hasPermi="['system:rule:create']" type="primary" @click="openForm()">
        <Icon icon="ep:plus" class="mr-4px" />新增规则
      </el-button>
    </div>

    <el-table :data="list" v-loading="loading" border size="small">
      <el-table-column label="规则名称" min-width="160" prop="name" />
      <el-table-column label="模板" min-width="200">
        <template #default="{ row }">
          <el-tag size="small" :type="row.template.startsWith('BUILT_IN_') ? 'info' : 'warning'">
            {{ row.template.startsWith('BUILT_IN_') ? '内置' : '自定义' }}
          </el-tag>
          <span class="ml-8px text-12px text-gray-600">{{ templateLabel(row.template) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="参数" min-width="160">
        <template #default="{ row }">
          <el-tooltip v-if="row.params" :content="row.params" placement="top">
            <span class="text-12px text-gray-500 cursor-pointer truncate block max-w-150px">{{ row.params }}</span>
          </el-tooltip>
          <span v-else class="text-12px text-gray-400">-</span>
        </template>
      </el-table-column>
      <el-table-column label="描述" min-width="200" prop="description" show-overflow-tooltip />
      <el-table-column label="状态" width="80" align="center">
        <template #default="{ row }">
          <dict-tag :type="DICT_TYPE.COMMON_STATUS" :value="row.status" />
        </template>
      </el-table-column>
      <el-table-column label="操作" width="130" align="center">
        <template #default="{ row }">
          <el-button v-hasPermi="['system:rule:update']" link type="primary"
                     size="small" @click="openForm(row)">编辑</el-button>
          <el-button v-hasPermi="['system:rule:delete']" link type="danger"
                     size="small" :disabled="isBuiltIn(row)"
                     :title="isBuiltIn(row) ? '内置规则不能删除，可将其停用' : ''"
                     @click="handleDelete(row.id)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-empty v-if="list.length === 0 && !loading" description="暂无规则" :image-size="60" />
  </ContentWrap>

  <RuleForm ref="formRef" @success="loadList" />
</template>

<script lang="ts" setup>
import { DICT_TYPE } from '@/utils/dict'
import * as GrantApi from '@/api/system/grant'
import type { RuleVO } from '@/api/system/grant'
import RuleForm from './RuleForm.vue'

defineOptions({ name: 'SystemRuleIndex' })

const message = useMessage()
const loading = ref(false)
const list = ref<RuleVO[]>([])

const loadList = async () => {
  loading.value = true
  try {
    list.value = await GrantApi.getRuleList()
  } finally {
    loading.value = false
  }
}

const TEMPLATE_LABELS: Record<string, string> = {
  BUILT_IN_OWNER_ONLY: '仅自己的数据',
  BUILT_IN_DEPT_ONLY: '本部门数据',
  BUILT_IN_DEPT_AND_CHILDREN: '本部门及下级',
  BUILT_IN_STATUS_IN: '指定状态可见',
  BUILT_IN_OWNER_OR_DEPT: '自己或本部门',
  BUILT_IN_BPM_PARTICIPANT: '流程参与者可见',
  BUILT_IN_RECORD_SHARED: '共享给我的记录',
  BUILT_IN_FIELD_EQUALS: '指定字段等于',
  BUILT_IN_CUSTOM_TREE: '自定义条件树',
}
const templateLabel = (t: string) => TEMPLATE_LABELS[t] ?? t
const isBuiltIn = (row: RuleVO) => row.template?.startsWith('BUILT_IN_')

const formRef = ref()
const openForm = (row?: RuleVO) => formRef.value?.open(row)

const handleDelete = async (id: number) => {
  await message.confirm('确认删除该规则？删除后引用它的授权行将失去行过滤效果。')
  await GrantApi.deleteRule(id)
  message.success('删除成功')
  await loadList()
}

onMounted(loadList)
</script>
