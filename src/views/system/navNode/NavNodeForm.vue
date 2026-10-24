<template>
  <Dialog v-model="dialogVisible" :title="dialogTitle">
    <el-form
      ref="formRef"
      v-loading="formLoading"
      :model="formData"
      :rules="formRules"
      label-width="100px"
    >
      <el-form-item label="上级节点">
        <el-tree-select
          v-model="formData.parentId"
          :data="nodeTree"
          :default-expanded-keys="[0]"
          :props="defaultProps"
          check-strictly
          node-key="id"
        />
      </el-form-item>
      <el-form-item label="节点类型" prop="nodeType">
        <el-radio-group v-model="formData.nodeType">
          <el-radio-button
            v-for="opt in NAV_NODE_TYPE_OPTIONS"
            :key="opt.value"
            :disabled="!allowedNodeTypes.includes(opt.value)"
            :value="opt.value"
          >
            {{ opt.label }}
          </el-radio-button>
        </el-radio-group>
        <div class="text-12px text-gray-400 leading-18px">
          层级固定为 分组 ▸ 子分组 ▸ 导航项，类型随上级节点自动约束
        </div>
      </el-form-item>
      <el-form-item label="名称" prop="name">
        <el-input v-model="formData.name" clearable placeholder="请输入展示名称" />
      </el-form-item>

      <!-- 导航项专属字段 -->
      <template v-if="formData.nodeType === NAV_NODE_TYPE.ITEM">
        <el-form-item label="仅 PC 端">
          <template #label>
            <Tooltip message="勾选后移动端点击跳转「仅 PC」提示页，无需填写页面路径" title="仅 PC 端" />
          </template>
          <el-switch v-model="formData.onlyPc" />
        </el-form-item>
        <template v-if="!formData.onlyPc">
          <el-form-item label="页面路径" prop="route">
            <template #label>
              <Tooltip
                message="移动端页面路径，须命中 pages.json，如 /pages-system/user/index"
                title="页面路径"
              />
            </template>
            <el-input v-model="formData.route" clearable placeholder="如 /pages-system/user/index" />
          </el-form-item>
          <el-form-item label="页面参数">
            <template #label>
              <Tooltip message="跳转携带的 query，如 code=leave；多个用 & 连接" title="页面参数" />
            </template>
            <el-input v-model="formData.query" clearable placeholder="如 code=leave" />
          </el-form-item>
          <el-form-item label="tabbar 页">
            <template #label>
              <Tooltip
                message="登记为底部 tabbar 页；移动端实际以 pages.json 的 tabbar 配置为准"
                title="tabbar 页"
              />
            </template>
            <el-switch v-model="formData.isTabbar" />
          </el-form-item>
        </template>
        <el-form-item label="权限标识">
          <template #label>
            <Tooltip
              message="关联共享权限目录（system_menu 权限串）。留空＝所有登录用户可见；选择一个或多个＝拥有任一权限才可见。仅可从目录中选择，不可自由输入。"
              title="权限标识"
            />
          </template>
          <el-select
            v-model="permissionList"
            :loading="permLoading"
            class="!w-full"
            clearable
            filterable
            multiple
            placeholder="从权限目录中选择（留空则不设门槛）"
            reserve-keyword
          >
            <el-option v-for="p in permissionOptions" :key="p" :label="p" :value="p" />
          </el-select>
        </el-form-item>
        <el-form-item label="图标">
          <template #label>
            <Tooltip
              message="移动端 @wot-ui/ui 图标，点右侧按钮可视化选择（非 Web 图标）"
              title="图标"
            />
          </template>
          <WotIconSelect v-model="formData.icon" />
        </el-form-item>
        <el-form-item label="图标颜色">
          <el-color-picker v-model="formData.iconColor" />
        </el-form-item>
      </template>

      <!-- 通用字段 -->
      <el-form-item label="显示状态" prop="visible">
        <el-radio-group v-model="formData.visible">
          <el-radio :value="true" border>显示</el-radio>
          <el-radio :value="false" border>隐藏</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="显示排序" prop="sort">
        <el-input-number v-model="formData.sort" :min="0" controls-position="right" />
      </el-form-item>
      <el-form-item label="节点状态" prop="status">
        <el-radio-group v-model="formData.status">
          <el-radio
            v-for="dict in getIntDictOptions(DICT_TYPE.COMMON_STATUS)"
            :key="dict.label"
            :value="dict.value"
          >
            {{ dict.label }}
          </el-radio>
        </el-radio-group>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button :disabled="formLoading" type="primary" @click="submitForm">确 定</el-button>
      <el-button @click="dialogVisible = false">取 消</el-button>
    </template>
  </Dialog>
</template>
<script lang="ts" setup>
import * as MenuApi from '@/api/system/menu'
import * as NavNodeApi from '@/api/system/navNode'
import { CommonStatusEnum } from '@/utils/constants'
import { DICT_TYPE, getIntDictOptions } from '@/utils/dict'
import { defaultProps, handleTree } from '@/utils/tree'
import WotIconSelect from './WotIconSelect.vue'
import { NAV_NODE_TYPE, NAV_NODE_TYPE_OPTIONS, NAV_TERMINAL } from './constants'

defineOptions({ name: 'SystemNavNodeForm' })

const { t } = useI18n() // 国际化
const message = useMessage() // 消息弹窗

const dialogVisible = ref(false) // 弹窗是否展示
const dialogTitle = ref('') // 弹窗标题
const formLoading = ref(false) // 加载中：修改数据加载 / 提交按钮禁用
const formType = ref('') // create - 新增；update - 修改
const formData = ref<any>({
  id: undefined,
  terminal: NAV_TERMINAL,
  parentId: 0,
  nodeType: NAV_NODE_TYPE.GROUP,
  name: '',
  route: '',
  permissions: '',
  menuRefId: undefined,
  icon: '',
  iconColor: '',
  isTabbar: false,
  onlyPc: false,
  query: '',
  sort: 0,
  visible: true,
  status: CommonStatusEnum.ENABLE
})
const formRules = reactive({
  name: [{ required: true, message: '名称不能为空', trigger: 'blur' }],
  nodeType: [{ required: true, message: '节点类型不能为空', trigger: 'change' }],
  sort: [{ required: true, message: '排序不能为空', trigger: 'blur' }],
  status: [{ required: true, message: '状态不能为空', trigger: 'change' }]
})
const formRef = ref() // 表单 Ref

/** 权限标识：以字符串数组编辑，提交时 join(',')；仅可从权限目录选，禁自由输入 */
const permissionList = ref<string[]>([])
const permissionOptions = ref<string[]>([])
const permLoading = ref(false)

/** 上级节点树（仅分组/子分组可选，导航项是叶子不作父节点） */
const nodeTree = ref<any[]>([])
/** 全量扁平节点，用于按 parentId 查父节点类型 */
const allNodes = ref<NavNodeApi.NavNodeVO[]>([])
const nodeMap = computed(() => new Map(allNodes.value.map((node) => [node.id, node])))

/**
 * 当前上级节点允许的子节点类型
 *
 * 与移动端三层渲染严格对齐：根→分组；分组→子分组/导航项；子分组→导航项。
 * 父节点未知（数据尚未就绪）时不设限，避免打开弹窗瞬间误改已加载的节点类型。
 */
const allowedNodeTypes = computed<number[]>(() => {
  const pid = formData.value.parentId
  if (!pid || pid === 0) {
    return [NAV_NODE_TYPE.GROUP]
  }
  const parent = nodeMap.value.get(pid)
  if (!parent) {
    return [NAV_NODE_TYPE.GROUP, NAV_NODE_TYPE.SUB_GROUP, NAV_NODE_TYPE.ITEM]
  }
  if (parent.nodeType === NAV_NODE_TYPE.GROUP) {
    return [NAV_NODE_TYPE.SUB_GROUP, NAV_NODE_TYPE.ITEM]
  }
  return [NAV_NODE_TYPE.ITEM]
})

// 上级节点变化后，若当前类型不再合法，自动纠正为允许的首个类型
watch(
  () => formData.value.parentId,
  () => {
    const allowed = allowedNodeTypes.value
    if (allowed.length > 0 && !allowed.includes(formData.value.nodeType)) {
      formData.value.nodeType = allowed[0]
    }
  }
)

/** 加载权限目录：system_menu 的全部非空 permission 去重排序 */
const loadPermissionOptions = async () => {
  permLoading.value = true
  try {
    const menus = await MenuApi.getSimpleMenusList()
    const set = new Set<string>()
    for (const menu of menus || []) {
      const code = (menu.permission || '').trim()
      if (code) {
        set.add(code)
      }
    }
    permissionOptions.value = Array.from(set).sort()
  } finally {
    permLoading.value = false
  }
}

/** 加载上级节点树（过滤掉导航项） */
const getNodeTree = async () => {
  const res = await NavNodeApi.getNavNodeList({ terminal: NAV_TERMINAL })
  allNodes.value = res || []
  const parents = allNodes.value.filter((node) => node.nodeType !== NAV_NODE_TYPE.ITEM)
  nodeTree.value = [{ id: 0, name: '主类目（根）', children: handleTree(parents) }]
}

/** 打开弹窗 */
const open = async (type: string, id?: number, parentId?: number) => {
  dialogVisible.value = true
  dialogTitle.value = t('action.' + type)
  formType.value = type
  resetForm()
  // 先备好节点树与权限目录，再回填 parentId / 表单，保证类型约束的 watch 能读到父节点
  await Promise.all([getNodeTree(), loadPermissionOptions()])
  if (parentId !== undefined && parentId !== null) {
    formData.value.parentId = parentId
  }
  if (id) {
    formLoading.value = true
    try {
      const data = await NavNodeApi.getNavNode(id)
      formData.value = { ...formData.value, ...data }
      permissionList.value = data.permissions
        ? String(data.permissions)
            .split(',')
            .map((code) => code.trim())
            .filter(Boolean)
        : []
    } finally {
      formLoading.value = false
    }
  }
}
defineExpose({ open }) // 提供 open 方法，用于打开弹窗

/** 提交表单 */
const emit = defineEmits(['success']) // success 事件，用于操作成功后的回调
const submitForm = async () => {
  if (!formRef.value) {
    return
  }
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) {
    return
  }
  // 导航项且非「仅 PC」时，必须填写页面路径
  if (
    formData.value.nodeType === NAV_NODE_TYPE.ITEM &&
    !formData.value.onlyPc &&
    !formData.value.route
  ) {
    message.error('导航项需填写页面路径，或勾选「仅 PC 端」')
    return
  }
  formLoading.value = true
  try {
    const data = {
      ...formData.value,
      terminal: NAV_TERMINAL,
      permissions: (permissionList.value || []).join(',')
    } as NavNodeApi.NavNodeVO
    if (formType.value === 'create') {
      await NavNodeApi.createNavNode(data)
      message.success(t('common.createSuccess'))
    } else {
      await NavNodeApi.updateNavNode(data)
      message.success(t('common.updateSuccess'))
    }
    dialogVisible.value = false
    emit('success')
  } finally {
    formLoading.value = false
  }
}

/** 重置表单 */
const resetForm = () => {
  formData.value = {
    id: undefined,
    terminal: NAV_TERMINAL,
    parentId: 0,
    nodeType: NAV_NODE_TYPE.GROUP,
    name: '',
    route: '',
    permissions: '',
    menuRefId: undefined,
    icon: '',
    iconColor: '',
    isTabbar: false,
    onlyPc: false,
    query: '',
    sort: 0,
    visible: true,
    status: CommonStatusEnum.ENABLE
  }
  permissionList.value = []
  formRef.value?.resetFields()
}
</script>
