<template>
  <Dialog v-model="dialogVisible" :title="dialogTitle">
    <el-form
      ref="formRef"
      v-loading="formLoading"
      :model="formData"
      :rules="formRules"
      label-width="100px"
    >
      <el-form-item label="上级分组" prop="parentId">
        <el-tree-select
          v-model="formData.parentId"
          :data="parentOptions"
          :props="{ label: 'name', value: 'id', children: 'children' }"
          check-strictly
          class="w-1/1"
          node-key="id"
          placeholder="不选表示放在根节点下"
        />
      </el-form-item>
      <el-form-item label="节点类型" prop="nodeType">
        <el-radio-group v-model="formData.nodeType" :disabled="isEdit">
          <el-radio :value="DictTypeNodeEnum.GROUP">分组</el-radio>
          <el-radio :value="DictTypeNodeEnum.DICT">字典</el-radio>
        </el-radio-group>
        <div class="form-tip">分组只用于归拢字典，本身不能挂字典数据</div>
      </el-form-item>
      <el-form-item :label="isGroup ? '分组名称' : '字典名称'" prop="name">
        <el-input v-model="formData.name" :placeholder="`请输入${isGroup ? '分组' : '字典'}名称`" />
      </el-form-item>
      <el-form-item :label="isGroup ? '分组编码' : '字典类型'" prop="type">
        <el-input v-model="formData.type" :disabled="isEdit" placeholder="请输入编码，保存后不可修改" />
      </el-form-item>
      <template v-if="!isGroup">
        <el-form-item label="树形字典" prop="treeEnable">
          <el-switch
            v-model="formData.treeEnable"
            :active-value="1"
            :disabled="isEdit"
            :inactive-value="0"
          />
          <div class="form-tip">
            开启后字典值可以有层级。<b>创建后不可切换</b>——改成平铺会让已有的子节点变成孤儿，
            确需调整请导出后重建
          </div>
        </el-form-item>
        <el-form-item label="缓存模式" prop="cacheMode">
          <el-radio-group v-model="formData.cacheMode">
            <el-radio :value="DictCacheModeEnum.FULL">全量下发</el-radio>
            <el-radio :value="DictCacheModeEnum.LAZY">按需懒加载</el-radio>
          </el-radio-group>
          <div class="form-tip">
            节点数很多（如行政区划）时选懒加载，该字典不进前端全量缓存，展开时才取子级
          </div>
        </el-form-item>
      </template>
      <el-form-item label="排序" prop="sort">
        <el-input-number v-model="formData.sort" :min="0" class="!w-180px" controls-position="right" />
      </el-form-item>
      <el-form-item label="状态" prop="status">
        <el-radio-group v-model="formData.status">
          <el-radio
            v-for="dict in getIntDictOptions(DICT_TYPE.COMMON_STATUS)"
            :key="dict.value"
            :value="dict.value"
          >
            {{ dict.label }}
          </el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="备注" prop="remark">
        <el-input v-model="formData.remark" placeholder="请输入内容" type="textarea" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button :disabled="formLoading" type="primary" @click="submitForm">确 定</el-button>
      <el-button @click="dialogVisible = false">取 消</el-button>
    </template>
  </Dialog>
</template>
<script lang="ts" setup>
import { DICT_TYPE, getIntDictOptions } from '@/utils/dict'
import { handleTree } from '@/utils/tree'
import * as DictTypeApi from '@/api/system/dict/dict.type'
import { DictCacheModeEnum, DictTypeNodeEnum } from '@/api/system/dict/dict.type'
import { CommonStatusEnum } from '@/utils/constants'

defineOptions({ name: 'SystemDictTypeForm' })

const { t } = useI18n() // 国际化
const message = useMessage() // 消息弹窗

const dialogVisible = ref(false) // 弹窗的是否展示
const dialogTitle = ref('') // 弹窗的标题
const formLoading = ref(false) // 表单的加载中：1）修改时的数据加载；2）提交的按钮禁用
const formType = ref('') // 表单的类型：create - 新增；update - 修改
const parentOptions = ref<any[]>([]) // 上级分组的可选项
const formData = ref<DictTypeApi.DictTypeVO>(buildDefaultForm())
const formRules = reactive({
  name: [{ required: true, message: '名称不能为空', trigger: 'blur' }],
  type: [{ required: true, message: '编码不能为空', trigger: 'blur' }],
  nodeType: [{ required: true, message: '节点类型不能为空', trigger: 'change' }],
  status: [{ required: true, message: '状态不能为空', trigger: 'change' }]
})
const formRef = ref() // 表单 Ref

const isEdit = computed(() => formType.value === 'update')
const isGroup = computed(() => formData.value.nodeType === DictTypeNodeEnum.GROUP)

function buildDefaultForm(): DictTypeApi.DictTypeVO {
  return {
    id: undefined,
    parentId: 0,
    nodeType: DictTypeNodeEnum.DICT,
    name: '',
    type: '',
    sort: 0,
    treeEnable: 0,
    cacheMode: DictCacheModeEnum.FULL,
    status: CommonStatusEnum.ENABLE,
    remark: ''
  }
}

/**
 * 加载「上级分组」的可选项
 *
 * 只列分组：字典节点底下挂的是字典数据，不能再挂分类。
 * 修改时还要把自己和自己的子孙剔掉，否则选中它们会形成环（后端也会拦，但不该让用户走到那一步）
 */
const loadParentOptions = async (selfId?: number) => {
  const list = await DictTypeApi.getDictTypeList()
  let groups = list.filter((item) => item.nodeType === DictTypeNodeEnum.GROUP)
  if (selfId) {
    const excluded = collectSelfAndDescendantIds(list, selfId)
    groups = groups.filter((item) => !excluded.has(item.id!))
  }
  parentOptions.value = handleTree(groups.map((item) => ({ ...item })))
}

/** 收集自身及全部子孙的编号 */
const collectSelfAndDescendantIds = (list: DictTypeApi.DictTypeVO[], selfId: number) => {
  const result = new Set<number>([selfId])
  let changed = true
  // 分类是扁平列表且只有 parentId，用「反复扫描直到不再新增」代替递归，
  // 数据被改坏形成环时也不会栈溢出
  while (changed) {
    changed = false
    list.forEach((item) => {
      if (item.parentId != null && result.has(item.parentId) && !result.has(item.id!)) {
        result.add(item.id!)
        changed = true
      }
    })
  }
  return result
}

/** 打开弹窗 */
const open = async (type: string, id?: number, presets?: Partial<DictTypeApi.DictTypeVO>) => {
  dialogVisible.value = true
  dialogTitle.value = t('action.' + type)
  formType.value = type
  resetForm()
  formLoading.value = true
  try {
    await loadParentOptions(id)
    if (id) {
      formData.value = await DictTypeApi.getDictType(id)
    } else if (presets) {
      formData.value = { ...formData.value, ...presets }
    }
  } finally {
    formLoading.value = false
  }
}
defineExpose({ open }) // 提供 open 方法，用于打开弹窗

/** 提交表单 */
const emit = defineEmits(['success']) // 定义 success 事件，用于操作成功后的回调
const submitForm = async () => {
  // 校验表单
  if (!formRef) return
  const valid = await formRef.value.validate()
  if (!valid) return
  // 提交请求
  formLoading.value = true
  try {
    const data = { ...formData.value }
    // 分组不承载字典数据，这两个开关对它没有意义，统一落成默认值
    if (data.nodeType === DictTypeNodeEnum.GROUP) {
      data.treeEnable = 0
      data.cacheMode = DictCacheModeEnum.FULL
    }
    if (formType.value === 'create') {
      await DictTypeApi.createDictType(data)
      message.success(t('common.createSuccess'))
    } else {
      await DictTypeApi.updateDictType(data)
      message.success(t('common.updateSuccess'))
    }
    dialogVisible.value = false
    // 发送操作成功的事件
    emit('success')
  } finally {
    formLoading.value = false
  }
}

/** 重置表单 */
const resetForm = () => {
  formData.value = buildDefaultForm()
  formRef.value?.resetFields()
}
</script>

<style lang="scss" scoped>
.form-tip {
  font-size: 12px;
  line-height: 1.5;
  color: var(--el-text-color-secondary);
}
</style>
