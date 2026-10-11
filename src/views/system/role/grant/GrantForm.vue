<template>
  <Dialog v-model="dialogVisible" :title="dialogTitle" width="640px">
    <el-form
      ref="formRef"
      v-loading="formLoading"
      :model="formData"
      :rules="formRules"
      label-width="110px"
    >
      <el-form-item label="资源" prop="resourceId">
        <!--
          ⚠️ 用 el-select + el-tree-v2，而不是 el-tree-select：
          资源有 800+ 个，el-tree-select 会全量渲染 DOM，输入过滤明显卡顿；
          el-tree-v2 是虚拟化树，只渲染可视区域节点（与 GrantAssignPanel 同款方案）
        -->
        <el-select
          v-model="formData.resourceId"
          class="w-full"
          clearable
          filterable
          :disabled="!!formData.id"
          :filter-method="onResourceFilter"
          placeholder="按名称或权限标识搜索"
          @visible-change="onResourceDropdownToggle"
        >
          <template #header>
            <el-checkbox v-model="includeFieldLevel" size="small" @change="reloadResourceTree">
              <span class="text-12px">显示字段级资源（列 / 字段）</span>
            </el-checkbox>
            <div class="mt-2px text-11px text-gray-400 leading-tight">
              字段权限（如手机号隐藏）要勾上这项才能选到对应资源
            </div>
          </template>
          <!-- 选中项的回显：el-select 需要一个 option 才能显示 label -->
          <el-option
            v-if="selectedResource"
            :key="selectedResource.id"
            :label="selectedResourceLabel"
            :value="selectedResource.id"
          />
          <template #empty>
            <div class="p-8px">
              <el-tree-v2
                ref="resourceTreeRef"
                :data="resourceTree"
                :props="{ label: 'name', children: 'children', value: 'id' }"
                :height="280"
                :filter-method="treeFilterMethod"
                :expand-on-click-node="false"
                highlight-current
                @node-click="onResourceNodeClick"
              >
                <template #default="{ node, data }">
                  <span class="flex items-center gap-6px overflow-hidden">
                    <span class="text-13px">{{ node.label }}</span>
                    <span v-if="data.permission" class="text-11px text-gray-400 truncate">
                      {{ data.permission }}
                    </span>
                  </span>
                </template>
              </el-tree-v2>
            </div>
          </template>
        </el-select>
      </el-form-item>
      <el-form-item label="动作" prop="action">
        <el-select v-model="formData.action" class="w-full" placeholder="请选择动作">
          <el-option
            v-for="a in GRANT_ACTION_OPTIONS"
            :key="a.value"
            :label="a.label"
            :value="a.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="效果" prop="effect">
        <el-radio-group v-model="formData.effect">
          <el-radio value="ALLOW">允许</el-radio>
          <el-radio value="DENY">拒绝</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="行过滤规则">
        <el-select
          v-model="formData.ruleId"
          class="w-full"
          clearable
          placeholder="不绑定（该主体不受行限制）"
        >
          <el-option v-for="r in ruleList" :key="r.id" :label="r.name" :value="r.id">
            <span>{{ r.name }}</span>
            <span class="ml-8px text-11px text-gray-400">{{ r.description }}</span>
          </el-option>
        </el-select>
      </el-form-item>
      <el-form-item label="字段显示模式">
        <el-select
          v-model="formData.fieldMode"
          class="w-full"
          clearable
          :disabled="!isFieldLevelResource"
          :placeholder="isFieldLevelResource ? '不限制' : '仅对「列/字段」类资源有效'"
        >
          <!-- ⚠️ value 必须与后端 FieldModeEnum 完全一致：EDITABLE / READONLY / HIDDEN，
               写成 VISIBLE 会被引擎整行过滤掉——「保存成功但不生效」 -->
          <el-option label="可编辑 (EDITABLE)" value="EDITABLE" />
          <el-option label="只读 (READONLY)" value="READONLY" />
          <el-option label="隐藏 (HIDDEN)" value="HIDDEN" />
        </el-select>
      </el-form-item>
      <el-form-item label="到期时间">
        <el-date-picker
          v-model="formData.expireTime"
          :default-time="defaultExpireTime"
          type="datetime"
          class="w-full"
          clearable
          placeholder="不填=永不过期；清空可取消到期时间"
          value-format="YYYY-MM-DD HH:mm:ss"
        />
      </el-form-item>
      <!-- 不绑规则时说清楚它的含义，这一条直接决定多角色合并的结果 -->
      <el-alert
        v-if="!formData.ruleId && formData.effect === 'ALLOW'"
        type="info"
        :closable="false"
        show-icon
      >
        未绑定行过滤规则 = 该主体可以看到这张表的<b>全部行</b>。
        用户拥有多个角色时，只要有一个角色是「不受限」，合并结果就是不受限。
      </el-alert>
    </el-form>
    <template #footer>
      <el-button :disabled="formLoading" type="primary" @click="submitForm">确 定</el-button>
      <el-button @click="dialogVisible = false">取 消</el-button>
    </template>
  </Dialog>
</template>
<script lang="ts" setup>
import * as GrantApi from '@/api/system/grant'
import type { GrantVO, GrantSaveReqVO, RuleVO } from '@/api/system/grant'
import { handleTree } from '@/utils/tree'
import { GRANT_ACTION_OPTIONS } from '@/views/system/resource/constants'
import dayjs from 'dayjs'

defineOptions({ name: 'SystemRoleGrantForm' })

const message = useMessage()

/** 只选日期不选时间时，默认到当天 23:59:59 —— 「有效期到某天」的直觉是含当天全天 */
const defaultExpireTime = new Date(2000, 0, 1, 23, 59, 59)

const dialogVisible = ref(false)
const dialogTitle = ref('')
const formLoading = ref(false)
const formRef = ref()

/** 主体固定由打开方传入（角色授权页 = ROLE + roleId） */
const subject = ref({ subjectType: 'ROLE', subjectRefId: undefined as number | undefined })

const buildEmptyForm = (): GrantSaveReqVO => ({
  subjectType: 'ROLE',
  subjectRefId: subject.value.subjectRefId,
  // ⚠️ 必须是 undefined 而不是 0：EP 的 required 校验把 0 当「已填」，
  // 用 0 做初值时不选资源也能通过校验，提交出 resourceId=0 的脏授权
  resourceId: undefined as unknown as number,
  action: 'VIEW',
  effect: 'ALLOW'
})

const formData = ref<GrantSaveReqVO>(buildEmptyForm())
const formRules = {
  resourceId: [{ required: true, message: '请选择资源', trigger: 'change' }],
  action: [{ required: true, message: '请选择动作', trigger: 'change' }],
  effect: [{ required: true, message: '请选择效果', trigger: 'change' }]
}

/** 打开弹窗：type = create / update；row 仅 update 时传 */
const open = async (type: 'create' | 'update', subjectRefId: number, row?: GrantVO) => {
  subject.value = { subjectType: 'ROLE', subjectRefId }
  dialogTitle.value = type === 'create' ? '新增授权' : '编辑授权'
  dialogVisible.value = true
  formLoading.value = true
  try {
    if (type === 'create') {
      formData.value = buildEmptyForm()
    } else if (row) {
      formData.value = {
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
        // 后端返回毫秒数，date-picker 带 value-format 时只认格式化字符串，直接塞数字会回显空白
        expireTime: row.expireTime ? dayjs(row.expireTime).format('YYYY-MM-DD HH:mm:ss') : undefined
      }
    }
    await loadStatic()
    // 编辑时如果绑的是字段级资源，自动把字段级资源加载进来，否则树里找不到、回显不了
    if (formData.value.resourceId && !resourceById.value.has(formData.value.resourceId)) {
      includeFieldLevel.value = true
      await reloadResourceTree()
    }
    nextTick(() => formRef.value?.clearValidate())
  } finally {
    formLoading.value = false
  }
}
defineExpose({ open })

// -------- 资源树 / 规则列表（与主体无关，弹窗生命周期内只拉一次） --------

const resourceTree = ref<any[]>([])
const ruleList = ref<RuleVO[]>([])
const staticLoaded = ref(false)
/** 资源树是否包含 COLUMN/FIELD 级资源。默认关，打开才加载 */
const includeFieldLevel = ref(false)

const loadStatic = async () => {
  if (staticLoaded.value) return
  const [resources, rules] = await Promise.all([
    GrantApi.getResourceList(undefined, includeFieldLevel.value),
    GrantApi.getSimpleRuleList()
  ])
  resourceTree.value = handleTree(resources, 'id', 'parentId')
  ruleList.value = rules
  staticLoaded.value = true
}

const reloadResourceTree = async () => {
  const resources = await GrantApi.getResourceList(undefined, includeFieldLevel.value)
  resourceTree.value = handleTree(resources, 'id', 'parentId')
  nextTick(() => resourceTreeRef.value?.filter(''))
}

// -------- 资源选择（虚拟化树） --------

const resourceTreeRef = ref()
const resourceById = computed(() => {
  const map = new Map<number, any>()
  const walk = (ns: any[]) =>
    ns.forEach((n) => {
      map.set(n.id, n)
      if (n.children?.length) walk(n.children)
    })
  walk(resourceTree.value)
  return map
})
const selectedResource = computed(() =>
  formData.value.resourceId ? resourceById.value.get(formData.value.resourceId) : undefined
)
/** fieldMode 只对 COLUMN/FIELD 资源有意义，配到 ACTION 上属于无效配置，直接禁掉 */
const isFieldLevelResource = computed(() => {
  const r = selectedResource.value
  return !!r && ['COLUMN', 'FIELD'].includes(r.type)
})
const selectedResourceLabel = computed(() => {
  const r = selectedResource.value
  if (!r) return ''
  return r.permission ? `${r.name}（${r.permission}）` : r.name
})

const treeFilterMethod = (value: string, data: any) => {
  if (!value) return true
  const kw = value.toLowerCase()
  return (
    (data.name ?? '').toLowerCase().includes(kw) ||
    (data.permission ?? '').toLowerCase().includes(kw)
  )
}

// el-select 输入转发给树过滤，150ms 防抖：不防抖每敲一个字符都触发全量重算
let filterTimer: any = null
const onResourceFilter = (value: string) => {
  if (filterTimer) clearTimeout(filterTimer)
  filterTimer = setTimeout(() => resourceTreeRef.value?.filter(value), 150)
}
const onResourceDropdownToggle = (visible: boolean) => {
  if (visible) nextTick(() => resourceTreeRef.value?.filter(''))
}
const onResourceNodeClick = (data: any) => {
  // 换到非字段级资源时清掉 fieldMode，避免上次的残留被提交上去
  if (!['COLUMN', 'FIELD'].includes(data.type)) {
    formData.value.fieldMode = undefined
  }
  formData.value.resourceId = data.id
}

// -------- 提交 --------

const emit = defineEmits<{ success: [] }>()

const submitForm = async () => {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  // 到期时间填了过去的时间 = 保存即「已过期」，几乎一定是手误，先问一句
  if (formData.value.expireTime && dayjs(formData.value.expireTime).isBefore(dayjs())) {
    const ok = await message
      .confirm('到期时间早于当前时间，保存后该授权会立即处于「已过期」状态。是否继续？')
      .catch(() => false)
    if (!ok) return
  }
  formLoading.value = true
  try {
    if (formData.value.id) {
      await GrantApi.updateGrant(formData.value)
      message.success('修改成功')
    } else {
      await GrantApi.createGrant(formData.value)
      message.success('新增成功')
    }
    dialogVisible.value = false
    emit('success')
  } finally {
    formLoading.value = false
  }
}
</script>
