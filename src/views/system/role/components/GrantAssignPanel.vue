<template>
  <Dialog v-model="dialogVisible" title="资源授权配置" width="860px">
    <div v-loading="formLoading" class="grant-assign-form">
      <!-- 主体信息 -->
      <el-descriptions :column="2" border size="small" class="mb-16px">
        <el-descriptions-item label="主体类型">
          <el-tag>{{ subjectTypeLabel }}</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="主体名称">
          <el-tag type="info">{{ subjectName }}</el-tag>
        </el-descriptions-item>
      </el-descriptions>

      <!-- 授权列表 -->
      <div class="mb-12px flex items-center justify-between">
        <span class="text-14px text-gray-600">已配置授权（{{ grantList.length }} 条）</span>
        <el-button type="primary" size="small" @click="openAddRow">
          <Icon icon="ep:plus" class="mr-4px" />新增授权
        </el-button>
      </div>

      <el-table :data="grantList" size="small" border>
        <el-table-column label="资源" min-width="180">
          <template #default="{ row }">
            <div class="text-13px">{{ row.resourceName || row.resourcePermission }}</div>
            <div class="text-11px text-gray-400">{{ row.resourcePermission }}</div>
          </template>
        </el-table-column>
        <el-table-column label="动作" width="90" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="row.action === '*' ? 'warning' : 'info'">{{ row.action }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="效果" width="80" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="row.effect === 'ALLOW' ? 'success' : 'danger'">
              {{ row.effect === 'ALLOW' ? '允许' : '拒绝' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="行过滤规则" min-width="120">
          <template #default="{ row }">
            <span v-if="row.ruleName" class="text-13px">{{ row.ruleName }}</span>
            <span v-else class="text-gray-400 text-12px">不过滤</span>
          </template>
        </el-table-column>
        <el-table-column label="字段模式" width="90" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.fieldMode" size="small" :type="(fieldModeTagType(row.fieldMode) as any)">
              {{ fieldModeLabel(row.fieldMode) }}
            </el-tag>
            <span v-else class="text-gray-400 text-12px">-</span>
          </template>
        </el-table-column>
        <el-table-column label="到期时间" width="140" align="center">
          <template #default="{ row }">
            <template v-if="row.expireTime">
              <el-tag v-if="row.expired" size="small" type="danger">已过期</el-tag>
              <span v-else class="text-12px">{{ formatDate(row.expireTime) }}</span>
            </template>
            <span v-else class="text-gray-400 text-12px">永不过期</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="100" align="center">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openEditRow(row)">编辑</el-button>
            <el-button link type="danger" size="small" @click="handleDeleteRow(row.id)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <!-- 空状态 -->
      <el-empty v-if="grantList.length === 0 && !formLoading" description="暂无授权配置" :image-size="60" />
    </div>

    <template #footer>
      <el-button @click="dialogVisible = false">关 闭</el-button>
    </template>
  </Dialog>

  <!-- 新增/编辑授权行弹窗 -->
  <Dialog v-model="rowDialogVisible" :title="rowDialogTitle" width="520px">
    <el-form ref="rowFormRef" :model="rowForm" :rules="rowFormRules" label-width="100px">
      <el-form-item label="资源" prop="resourceId">
        <el-tree-select
          v-model="rowForm.resourceId"
          :data="resourceTree"
          :props="{ label: 'name', children: 'children' }"
          :value-key="'id'"
          filterable
          check-strictly
          class="w-full"
          placeholder="请选择资源"
          :render-after-expand="false"
        >
          <template #default="{ data }">
            <span>{{ data.name }}</span>
            <span v-if="data.permission" class="ml-8px text-11px text-gray-400">{{ data.permission }}</span>
          </template>
        </el-tree-select>
      </el-form-item>
      <el-form-item label="动作" prop="action">
        <el-select v-model="rowForm.action" class="w-full" placeholder="请选择动作">
          <el-option v-for="a in ACTIONS" :key="a.value" :label="a.label" :value="a.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="效果" prop="effect">
        <el-radio-group v-model="rowForm.effect">
          <el-radio value="ALLOW">允许 (ALLOW)</el-radio>
          <el-radio value="DENY">拒绝 (DENY)</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="行过滤规则">
        <el-select v-model="rowForm.ruleId" class="w-full" clearable placeholder="不绑定规则（不过滤）">
          <el-option v-for="r in ruleList" :key="r.id" :label="r.name" :value="r.id">
            <span>{{ r.name }}</span>
            <span class="ml-8px text-11px text-gray-400">{{ r.description }}</span>
          </el-option>
        </el-select>
      </el-form-item>
      <el-form-item label="字段显示模式">
        <el-select v-model="rowForm.fieldMode" class="w-full" clearable placeholder="不限制">
          <!-- ⚠️ value 必须与后端 FieldModeEnum 完全一致：EDITABLE / READONLY / HIDDEN。
               这里原先写的是 VISIBLE —— 后端 FieldModeEnum.parse("VISIBLE") 返回 null，
               而引擎会把 parse 不出来的授权行【整行过滤掉】，
               表现是「选了可见、保存成功、列表也显示可见，但判定时完全不生效」 -->
          <el-option label="可编辑 (EDITABLE)" value="EDITABLE" />
          <el-option label="只读 (READONLY)" value="READONLY" />
          <el-option label="隐藏 (HIDDEN)" value="HIDDEN" />
        </el-select>
      </el-form-item>
      <el-form-item label="到期时间">
        <el-date-picker
          v-model="rowForm.expireTime"
          type="datetime"
          class="w-full"
          clearable
          placeholder="不填表示永不过期"
          value-format="YYYY-MM-DD HH:mm:ss"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button :loading="rowSaving" type="primary" @click="submitRowForm">确 定</el-button>
      <el-button @click="rowDialogVisible = false">取 消</el-button>
    </template>
  </Dialog>
</template>

<script lang="ts" setup>
import * as GrantApi from '@/api/system/grant'
import type { GrantVO, GrantSaveReqVO, RuleVO } from '@/api/system/grant'
import { handleTree } from '@/utils/tree'
import { formatDate } from '@/utils/formatTime'

defineOptions({ name: 'SystemGrantAssignForm' })

const message = useMessage()

const dialogVisible = ref(false)
const formLoading = ref(false)

// 当前主体
const subjectType = ref('')
const subjectRefId = ref<number | undefined>()
const subjectCode = ref<string | undefined>()
const subjectName = ref('')

const subjectTypeLabel = computed(() => {
  const MAP: Record<string, string> = {
    ROLE: '角色', USER: '用户', DEPT: '部门',
    POST: '岗位', GROUP: '用户组', SYSTEM: '系统身份', ALL: '全部用户'
  }
  return MAP[subjectType.value] ?? subjectType.value
})

// 授权列表
const grantList = ref<GrantVO[]>([])

// 资源树（用于选择资源）
const resourceTree = ref<any[]>([])
// 规则列表
const ruleList = ref<RuleVO[]>([])

// 动作选项
const ACTIONS = [
  { label: '* 全部动作', value: '*' },
  { label: 'VIEW 查看', value: 'VIEW' },
  { label: 'CREATE 新增', value: 'CREATE' },
  { label: 'UPDATE 修改', value: 'UPDATE' },
  { label: 'DELETE 删除', value: 'DELETE' },
  { label: 'EXPORT 导出', value: 'EXPORT' },
  { label: 'IMPORT 导入', value: 'IMPORT' },
  { label: 'PRINT 打印', value: 'PRINT' },
  { label: 'START 发起', value: 'START' },
  { label: 'DESIGN 设计', value: 'DESIGN' },
  { label: 'MANAGE 管理', value: 'MANAGE' },
  { label: 'VIEW_ALL 查看全部', value: 'VIEW_ALL' },
  { label: 'REFERENCE 被引用查询', value: 'REFERENCE' },
]

/** 打开弹窗 */
const open = async (params: {
  subjectType: string
  subjectRefId?: number
  subjectCode?: string
  name: string
}) => {
  dialogVisible.value = true
  formLoading.value = true
  subjectType.value = params.subjectType
  subjectRefId.value = params.subjectRefId
  subjectCode.value = params.subjectCode
  subjectName.value = params.name
  try {
    const [grants, resources, rules] = await Promise.all([
      GrantApi.getGrantListBySubject(params.subjectType, params.subjectRefId, params.subjectCode),
      GrantApi.getResourceList(),
      GrantApi.getSimpleRuleList(),
    ])
    grantList.value = grants
    resourceTree.value = handleTree(resources, 'id', 'parentId')
    ruleList.value = rules
  } finally {
    formLoading.value = false
  }
}
defineExpose({ open })

// -------- 新增/编辑授权行 --------

const rowDialogVisible = ref(false)
const rowDialogTitle = ref('新增授权')
const rowSaving = ref(false)
const rowFormRef = ref()
const rowForm = ref<GrantSaveReqVO>({
  subjectType: '',
  resourceId: 0,
  action: 'VIEW',
  effect: 'ALLOW',
})
const rowFormRules = {
  resourceId: [{ required: true, message: '请选择资源', trigger: 'change' }],
  action: [{ required: true, message: '请选择动作', trigger: 'change' }],
  effect: [{ required: true, message: '请选择效果', trigger: 'change' }],
}

const openAddRow = () => {
  rowDialogTitle.value = '新增授权'
  rowForm.value = {
    subjectType: subjectType.value,
    subjectRefId: subjectRefId.value,
    subjectCode: subjectCode.value,
    resourceId: 0,
    action: 'VIEW',
    effect: 'ALLOW',
  }
  rowDialogVisible.value = true
  nextTick(() => rowFormRef.value?.clearValidate())
}

const openEditRow = (row: GrantVO) => {
  rowDialogTitle.value = '编辑授权'
  rowForm.value = {
    id: row.id,
    subjectType: row.subjectType,
    subjectRefId: row.subjectRefId,
    subjectCode: row.subjectCode,
    resourceId: row.resourceId,
    contextResourceId: row.contextResourceId,
    action: row.action,
    effect: row.effect,
    ruleId: row.ruleId,
    fieldMode: row.fieldMode,
    expireTime: row.expireTime,
  }
  rowDialogVisible.value = true
  nextTick(() => rowFormRef.value?.clearValidate())
}

const submitRowForm = async () => {
  const valid = await rowFormRef.value?.validate().catch(() => false)
  if (!valid) return
  rowSaving.value = true
  try {
    if (rowForm.value.id) {
      await GrantApi.updateGrant(rowForm.value)
      message.success('修改成功')
    } else {
      await GrantApi.createGrant(rowForm.value)
      message.success('新增成功')
    }
    rowDialogVisible.value = false
    // 刷新列表
    grantList.value = await GrantApi.getGrantListBySubject(
      subjectType.value, subjectRefId.value, subjectCode.value
    )
  } finally {
    rowSaving.value = false
  }
}

const handleDeleteRow = async (id: number) => {
  await message.confirm('确认删除该授权行？删除后立即生效。')
  await GrantApi.deleteGrant(id)
  message.success('删除成功')
  grantList.value = grantList.value.filter(g => g.id !== id)
}

// -------- 辅助展示 --------

const fieldModeLabel = (mode: string) => {
  return { EDITABLE: '可编辑', READONLY: '只读', HIDDEN: '隐藏' }[mode] ?? mode
}
const fieldModeTagType = (mode: string) => {
  return { EDITABLE: 'success', READONLY: 'warning', HIDDEN: 'danger' }[mode] ?? ''
}
</script>
