<template>
  <!-- 资源配置四页签：授权列表 / 槽位映射 / 字段权限 / 子资源 -->
  <el-dialog v-model="dialogVisible" :title="panelTitle" width="900px" destroy-on-close>
    <el-descriptions :column="2" border size="small" class="mb-16px">
      <el-descriptions-item label="资源名称">{{ resource?.name }}</el-descriptions-item>
      <el-descriptions-item label="权限标识">
        <el-tag size="small" type="info">{{ resource?.permission || '（目录）' }}</el-tag>
      </el-descriptions-item>
      <el-descriptions-item label="类型">{{ formatResourceType(resource?.type) }}</el-descriptions-item>
      <el-descriptions-item label="默认效果">
        <el-tag size="small" :type="defaultEffectTagType(resource?.defaultEffect)">
          {{ formatDefaultEffect(resource?.defaultEffect) }}
        </el-tag>
      </el-descriptions-item>
    </el-descriptions>

    <el-tabs v-model="activeTab" class="resource-detail-tabs">

      <!-- 页签一：授权列表 -->
      <el-tab-pane label="授权列表" name="grants">
        <div class="mb-10px flex justify-end">
          <el-button v-hasPermi="['system:grant:create']" size="small" type="primary"
                     @click="openGrantAdd">新增授权</el-button>
        </div>
        <el-table :data="grants" border size="small" v-loading="grantLoading">
          <el-table-column label="主体类型" width="90" prop="subjectType" />
          <el-table-column label="主体ID/编码" width="100">
            <template #default="{ row }">{{ row.subjectRefId ?? row.subjectCode }}</template>
          </el-table-column>
          <el-table-column label="动作" width="80" prop="action" />
          <el-table-column label="效果" width="70" align="center">
            <template #default="{ row }">
              <el-tag size="small" :type="row.effect === 'ALLOW' ? 'success' : 'danger'">
                {{ row.effect === 'ALLOW' ? '允许' : '拒绝' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="规则" min-width="120">
            <template #default="{ row }">
              <span class="text-12px">{{ row.ruleName || '不过滤' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="到期" width="120">
            <template #default="{ row }">
              <el-tag v-if="row.expired" size="small" type="danger">已过期</el-tag>
              <span v-else-if="row.expireTime" class="text-12px">{{ formatDate(row.expireTime) }}</span>
              <span v-else class="text-gray-400 text-12px">永不过期</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="90" align="center">
            <template #default="{ row }">
              <el-button link type="danger" size="small" @click="deleteGrantRow(row.id)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-if="grants.length === 0 && !grantLoading" description="暂无授权" :image-size="50" />
      </el-tab-pane>

      <!-- 页签二：槽位映射 -->
      <el-tab-pane label="槽位映射" name="slots">
        <el-alert class="mb-12px" type="warning" :closable="false"
                  title="⚠️ 删掉槽位后，引用该槽位的规则会求值恒假（一行都看不到且不报错），请确认无引用后再删" />
        <div class="mb-10px flex justify-end">
          <el-button v-hasPermi="['system:slot-mapping:create']" size="small" type="primary"
                     @click="openSlotAdd">新增槽位</el-button>
        </div>
        <el-table :data="slots" border size="small" v-loading="slotLoading">
          <el-table-column label="槽位名称" prop="slot" width="130" />
          <el-table-column label="真实列名" prop="columnName" width="160" />
          <el-table-column label="说明" prop="description" min-width="160" show-overflow-tooltip />
          <el-table-column label="操作" width="130" align="center">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click="openSlotEdit(row)">编辑</el-button>
              <el-button link type="danger" size="small" @click="deleteSlotRow(row.id)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-if="slots.length === 0 && !slotLoading" description="暂无槽位映射" :image-size="50" />
      </el-tab-pane>

      <!-- 页签：记录分享策略（TODO #48）。只对数据集类资源有意义 -->
      <el-tab-pane label="记录分享" name="share">
        <el-alert class="mb-12px" type="info" :closable="false" show-icon
                  title="分享策略决定「谁可以把一条记录分享给别人」。">
          <template #default>
            <div class="text-12px leading-20px">
              <div>· <b>OWNER_ONLY</b>（默认）仅记录归属人可分享。
                ⚠️ 依赖 owner 槽位映射——没配槽位时读不到归属人，分享会一律被拒。</div>
              <div>· <b>ANY_VIEWER</b> 看得见这条记录的人都能分享。</div>
              <div>· <b>DISABLED</b> 完全禁止分享。</div>
              <div class="mt-6px text-orange-600">
                ⚠️ 「取消共享」不等于「禁止查看」：取消共享只是删掉那条共享记录，
                对方若通过创建人、本部门、角色授权等别的途径本来就看得见，取消后照样看得见。
                要真正挡住，需要在「授权列表」里加一条 DENY。
              </div>
            </div>
          </template>
        </el-alert>
        <el-form label-width="100px">
          <el-form-item label="分享策略">
            <el-select v-model="sharePolicy" class="!w-320px" clearable placeholder="未配置（回落到默认 OWNER_ONLY）">
              <el-option label="OWNER_ONLY 仅归属人可分享" value="OWNER_ONLY" />
              <el-option label="ANY_VIEWER 可见者均可分享" value="ANY_VIEWER" />
              <el-option label="DISABLED 禁止分享" value="DISABLED" />
            </el-select>
            <el-button class="ml-12px" type="primary" :loading="sharePolicySaving"
                       @click="saveSharePolicy">保 存</el-button>
          </el-form-item>
        </el-form>
      </el-tab-pane>

      <!-- 页签三：字段权限（COLUMN/FIELD 资源的子资源列表及其授权快览） -->
      <el-tab-pane label="字段权限" name="fields">
        <el-alert class="mb-12px" type="info" :closable="false"
                  title="字段权限管理：给 COLUMN/FIELD 类型的子资源配置 VISIBLE/READONLY/HIDDEN。通常只需对「敏感列」配置。" />
        <el-table :data="fieldResources" border size="small" v-loading="fieldLoading">
          <el-table-column label="字段名" min-width="160">
            <template #default="{ row }">
              <span>{{ row.name }}</span>
              <span class="ml-8px text-11px text-gray-400">{{ row.permission }}</span>
            </template>
          </el-table-column>
          <el-table-column label="类型" width="80">
            <template #default="{ row }">{{ formatResourceType(row.type) }}</template>
          </el-table-column>
          <el-table-column label="默认效果" width="90" align="center">
            <template #default="{ row }">
              <el-tag size="small" :type="defaultEffectTagType(row.defaultEffect)">
                {{ formatDefaultEffect(row.defaultEffect) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="90" align="center">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click="openSubResource(row)">配置授权</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-if="fieldResources.length === 0 && !fieldLoading"
                  description="无字段/列子资源（COLUMN/FIELD 类型）" :image-size="50" />
      </el-tab-pane>

      <!-- 页签四：子资源列表 -->
      <el-tab-pane label="子资源" name="children">
        <el-table :data="childResources" border size="small" v-loading="childLoading">
          <el-table-column label="资源名称" min-width="160">
            <template #default="{ row }">
              <span>{{ row.name }}</span>
              <span v-if="row.permission" class="ml-8px text-11px text-gray-400">{{ row.permission }}</span>
            </template>
          </el-table-column>
          <el-table-column label="类型" width="90">
            <template #default="{ row }">{{ formatResourceType(row.type) }}</template>
          </el-table-column>
          <el-table-column label="默认效果" width="90" align="center">
            <template #default="{ row }">
              <el-tag size="small" :type="defaultEffectTagType(row.defaultEffect)">
                {{ formatDefaultEffect(row.defaultEffect) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="90" align="center">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click="openSubResource(row)">详情</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-if="childResources.length === 0 && !childLoading"
                  description="无子资源" :image-size="50" />
      </el-tab-pane>
    </el-tabs>

    <template #footer>
      <el-button @click="dialogVisible = false">关 闭</el-button>
    </template>
  </el-dialog>

  <!-- 槽位编辑弹窗 -->
  <Dialog v-model="slotFormVisible" :title="slotFormTitle" width="440px">
    <el-form ref="slotFormRef" :model="slotForm" :rules="slotRules" label-width="90px">
      <el-form-item label="槽位名称" prop="slot">
        <el-input v-model="slotForm.slot" placeholder="如 owner / dept / status / bizKey"
                  :disabled="!!slotForm.id" />
        <div v-if="slotForm.id" class="text-11px text-gray-400 mt-2px">槽位名称一旦创建不能修改（规则里直接引用它）</div>
      </el-form-item>
      <el-form-item label="真实列名" prop="columnName">
        <el-input v-model="slotForm.columnName" placeholder="如 create_user_id" />
      </el-form-item>
      <el-form-item label="说明">
        <el-input v-model="slotForm.description" placeholder="如：记录创建者用户 id" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button :loading="slotSaving" type="primary" @click="submitSlotForm">确 定</el-button>
      <el-button @click="slotFormVisible = false">取 消</el-button>
    </template>
  </Dialog>

  <!-- 新增授权行弹窗（复用 GrantAssignForm 的单行模式） -->
  <Dialog v-model="grantAddVisible" title="新增授权" width="500px">
    <el-form ref="grantFormRef" :model="grantForm" :rules="grantRules" label-width="100px">
      <el-form-item label="主体类型" prop="subjectType">
        <el-select v-model="grantForm.subjectType" class="w-full">
          <el-option label="角色 (ROLE)" value="ROLE" />
          <el-option label="用户 (USER)" value="USER" />
          <el-option label="部门 (DEPT)" value="DEPT" />
          <el-option label="用户组 (GROUP)" value="GROUP" />
          <el-option label="所有登录用户 (ALL)" value="ALL" />
          <el-option label="系统身份 (SYSTEM)" value="SYSTEM" />
        </el-select>
      </el-form-item>
      <el-form-item label="主体ID" v-if="needsRefId">
        <el-input-number v-model="grantForm.subjectRefId" :min="1" class="w-full" />
      </el-form-item>
      <el-form-item label="主体编码" v-if="needsCode">
        <el-input v-model="grantForm.subjectCode" placeholder="如 all-users / bpm-engine" class="w-full" />
      </el-form-item>
      <el-form-item label="动作" prop="action">
        <el-select v-model="grantForm.action" class="w-full">
          <el-option label="* 全部动作" value="*" />
          <el-option label="VIEW 查看" value="VIEW" />
          <el-option label="CREATE 新增" value="CREATE" />
          <el-option label="UPDATE 修改" value="UPDATE" />
          <el-option label="DELETE 删除" value="DELETE" />
          <el-option label="EXPORT 导出" value="EXPORT" />
          <el-option label="START 发起" value="START" />
          <el-option label="DESIGN 设计" value="DESIGN" />
        </el-select>
      </el-form-item>
      <el-form-item label="效果" prop="effect">
        <el-radio-group v-model="grantForm.effect">
          <el-radio value="ALLOW">允许</el-radio>
          <el-radio value="DENY">拒绝</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="字段显示模式">
        <!-- ⚠️ value 必须与后端 FieldModeEnum 一致：EDITABLE / READONLY / HIDDEN。
             后端 parse 不出来的值会让【整行授权被过滤掉】，表现是「配了但完全不生效」 -->
        <el-select v-model="grantForm.fieldMode" class="w-full" clearable placeholder="不限制（仅对列/字段资源有意义）">
          <el-option label="可编辑 (EDITABLE)" value="EDITABLE" />
          <el-option label="只读 (READONLY)" value="READONLY" />
          <el-option label="隐藏 (HIDDEN)" value="HIDDEN" />
        </el-select>
      </el-form-item>
      <el-form-item label="行过滤规则">
        <el-select v-model="grantForm.ruleId" class="w-full" clearable placeholder="不限制行">
          <el-option v-for="r in ruleOptions" :key="r.id" :label="r.name" :value="r.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="到期时间">
        <el-date-picker v-model="grantForm.expireTime" type="datetime" class="w-full"
                        clearable value-format="YYYY-MM-DD HH:mm:ss" placeholder="永不过期" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button :loading="grantSaving" type="primary" @click="submitGrantForm">确 定</el-button>
      <el-button @click="grantAddVisible = false">取 消</el-button>
    </template>
  </Dialog>
</template>

<script lang="ts" setup>
import * as GrantApi from '@/api/system/grant'
import type { ResourceVO, GrantVO, SlotMappingVO } from '@/api/system/grant'
import { formatDate } from '@/utils/formatTime'
import { formatResourceType, formatDefaultEffect, defaultEffectTagType } from './constants'

defineOptions({ name: 'SystemResourceDetailPanel' })

const message = useMessage()

const dialogVisible = ref(false)
const activeTab = ref('grants')
const resource = ref<ResourceVO>()
const panelTitle = computed(() => `资源配置 — ${resource.value?.name ?? ''}`)

// -------- 授权列表 --------
const grants = ref<GrantVO[]>([])
const grantLoading = ref(false)

const loadGrants = async () => {
  if (!resource.value) return
  grantLoading.value = true
  try {
    grants.value = await GrantApi.getGrantListByResource(resource.value.id)
  } finally {
    grantLoading.value = false
  }
}

const deleteGrantRow = async (id: number) => {
  await message.confirm('确认删除该授权行？')
  await GrantApi.deleteGrant(id)
  message.success('删除成功')
  await loadGrants()
}

// 新增授权
// 行过滤规则下拉（只列启用的；停用的规则不该再被选中）
const ruleOptions = ref<{ id: number; name: string }[]>([])
const loadRules = async () => {
  ruleOptions.value = await GrantApi.getSimpleRuleList().catch(() => [])
}

const grantAddVisible = ref(false)
const grantSaving = ref(false)
const grantFormRef = ref()
const grantForm = ref({ subjectType: 'ROLE', subjectRefId: undefined as number | undefined,
  subjectCode: undefined as string | undefined, action: 'VIEW', effect: 'ALLOW',
  // TODO #18：字段权限必须能在资源侧配，否则只能写库（e2e 也只能靠夹具 SQL）
  fieldMode: undefined as string | undefined,
  ruleId: undefined as number | undefined,
  expireTime: undefined as string | undefined })
const grantRules = {
  subjectType: [{ required: true, message: '请选择主体类型', trigger: 'change' }],
  action: [{ required: true, message: '请选择动作', trigger: 'change' }],
  effect: [{ required: true, message: '请选择效果', trigger: 'change' }],
}
const needsRefId = computed(() => !['ALL', 'SYSTEM'].includes(grantForm.value.subjectType))
const needsCode = computed(() => ['ALL', 'SYSTEM'].includes(grantForm.value.subjectType))

const openGrantAdd = () => {
  Object.assign(grantForm.value, { subjectType: 'ROLE', subjectRefId: undefined,
    subjectCode: undefined, action: 'VIEW', effect: 'ALLOW',
    fieldMode: undefined, ruleId: undefined, expireTime: undefined })
  grantAddVisible.value = true
  nextTick(() => grantFormRef.value?.clearValidate())
}
const submitGrantForm = async () => {
  const ok = await grantFormRef.value?.validate().catch(() => false)
  if (!ok) return
  grantSaving.value = true
  try {
    await GrantApi.createGrant({ ...grantForm.value, resourceId: resource.value!.id })
    message.success('新增成功')
    grantAddVisible.value = false
    await loadGrants()
  } finally {
    grantSaving.value = false
  }
}

// -------- 槽位映射 --------
const slots = ref<SlotMappingVO[]>([])
const slotLoading = ref(false)

const loadSlots = async () => {
  if (!resource.value) return
  slotLoading.value = true
  try {
    slots.value = await GrantApi.getSlotMappingList(resource.value.id)
  } finally {
    slotLoading.value = false
  }
}

const slotFormVisible = ref(false)
const slotSaving = ref(false)
const slotFormRef = ref()
const slotFormTitle = computed(() => slotForm.value.id ? '编辑槽位' : '新增槽位')
const slotForm = ref<Partial<SlotMappingVO>>({})
const slotRules = {
  slot: [{ required: true, message: '槽位名称不能为空', trigger: 'blur' }],
  columnName: [{ required: true, message: '列名不能为空', trigger: 'blur' }],
}

const openSlotAdd = () => {
  slotForm.value = { resourceId: resource.value!.id }
  slotFormVisible.value = true
  nextTick(() => slotFormRef.value?.clearValidate())
}
const openSlotEdit = (row: SlotMappingVO) => {
  slotForm.value = { ...row }
  slotFormVisible.value = true
  nextTick(() => slotFormRef.value?.clearValidate())
}
const submitSlotForm = async () => {
  const ok = await slotFormRef.value?.validate().catch(() => false)
  if (!ok) return
  slotSaving.value = true
  try {
    if (slotForm.value.id) {
      await GrantApi.updateSlotMapping(slotForm.value as SlotMappingVO)
    } else {
      await GrantApi.createSlotMapping(slotForm.value as Omit<SlotMappingVO, 'id'>)
    }
    message.success('保存成功')
    slotFormVisible.value = false
    await loadSlots()
  } finally {
    slotSaving.value = false
  }
}
const deleteSlotRow = async (id: number) => {
  await message.confirm('确认删除该槽位？请确认无规则引用它，否则引用规则会变成恒假过滤。')
  await GrantApi.deleteSlotMapping(id)
  message.success('删除成功')
  await loadSlots()
}

// -------- 字段/列子资源 --------
const fieldResources = ref<ResourceVO[]>([])
const fieldLoading = ref(false)

const loadFieldResources = async () => {
  if (!resource.value) return
  fieldLoading.value = true
  try {
    const all = await GrantApi.getResourceList()
    fieldResources.value = all.filter(r =>
      r.parentId === resource.value!.id && ['COLUMN', 'FIELD'].includes(r.type))
  } finally {
    fieldLoading.value = false
  }
}

// -------- 子资源 --------
const childResources = ref<ResourceVO[]>([])
const childLoading = ref(false)

const loadChildResources = async () => {
  if (!resource.value) return
  childLoading.value = true
  try {
    const all = await GrantApi.getResourceList(undefined)
    // 包含 FIELD/COLUMN
    const allWithField = await GrantApi.getResourceList('FIELD').catch(() => [])
    const allWithCol = await GrantApi.getResourceList('COLUMN').catch(() => [])
    childResources.value = [...all, ...allWithField, ...allWithCol]
      .filter(r => r.parentId === resource.value!.id)
  } finally {
    childLoading.value = false
  }
}

// -------- 记录分享策略（TODO #48）--------
const sharePolicy = ref('')
const sharePolicySaving = ref(false)
const saveSharePolicy = async () => {
  sharePolicySaving.value = true
  try {
    await GrantApi.updateSharePolicy(resource.value!.id, sharePolicy.value)
    if (resource.value) resource.value.sharePolicy = sharePolicy.value
    message.success('分享策略已保存')
  } finally {
    sharePolicySaving.value = false
  }
}

// -------- 打开/关闭面板 --------
const open = async (res: ResourceVO) => {
  resource.value = res
  activeTab.value = 'grants'
  dialogVisible.value = true
  sharePolicy.value = res.sharePolicy ?? ''
  await Promise.all([loadGrants(), loadSlots(), loadFieldResources(), loadChildResources(),
                     loadRules()])
}

/** 从字段/子资源列表递归打开详情（用同一个组件） */
const openSubResource = (res: ResourceVO) => open(res)

defineExpose({ open })
</script>
