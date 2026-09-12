<template>
  <Dialog v-model="dialogVisible" :title="dialogTitle">
    <el-form
      ref="formRef"
      v-loading="formLoading"
      :model="formData"
      :rules="formRules"
      label-width="80px"
    >
      <el-form-item label="字典类型" prop="type">
        <el-input
          v-model="formData.dictType"
          :disabled="typeof formData.id !== 'undefined'"
          placeholder="请输入参数名称"
        />
      </el-form-item>
      <el-form-item v-if="treeEnabled" label="上级节点" prop="parentId">
        <el-tree-select
          v-model="formData.parentId"
          :data="parentOptions"
          :props="{ label: 'label', value: 'id', children: 'children' }"
          check-strictly
          class="w-1/1"
          node-key="id"
          placeholder="不选表示作为顶层节点"
        />
      </el-form-item>
      <el-form-item label="数据标签" prop="label">
        <el-input v-model="formData.label" placeholder="请输入数据标签" />
      </el-form-item>
      <el-form-item label="数据键值" prop="value">
        <el-input v-model="formData.value" placeholder="请输入数据键值" />
      </el-form-item>
      <el-form-item label="显示排序" prop="sort">
        <el-input-number v-model="formData.sort" :min="0" controls-position="right" />
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
      <el-form-item label="颜色类型" prop="colorType">
        <el-select v-model="formData.colorType">
          <el-option
            v-for="item in colorTypeOptions"
            :key="item.value"
            :label="item.label + '(' + item.value + ')'"
            :value="item.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="CSS Class" prop="cssClass">
        <el-input v-model="formData.cssClass" placeholder="请输入 CSS Class" />
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
import * as DictDataApi from '@/api/system/dict/dict.data'
import { CommonStatusEnum } from '@/utils/constants'

defineOptions({ name: 'SystemDictDataForm' })

const { t } = useI18n() // 国际化
const message = useMessage() // 消息弹窗

const dialogVisible = ref(false) // 弹窗的是否展示
const dialogTitle = ref('') // 弹窗的标题
const formLoading = ref(false) // 表单的加载中：1）修改时的数据加载；2）提交的按钮禁用
const formType = ref('') // 表单的类型：create - 新增；update - 修改
const treeEnabled = ref(false) // 当前字典是否树形
const parentOptions = ref<any[]>([]) // 上级节点的可选项
const formData = ref<DictDataApi.DictDataVO>({
  id: undefined,
  parentId: 0,
  sort: 0,
  label: '',
  value: '',
  dictType: '',
  status: CommonStatusEnum.ENABLE,
  colorType: '',
  cssClass: '',
  remark: ''
})
const formRules = reactive({
  label: [{ required: true, message: '数据标签不能为空', trigger: 'blur' }],
  value: [{ required: true, message: '数据键值不能为空', trigger: 'blur' }],
  sort: [{ required: true, message: '数据顺序不能为空', trigger: 'blur' }],
  status: [{ required: true, message: '状态不能为空', trigger: 'change' }]
})
const formRef = ref() // 表单 Ref

// 数据标签回显样式
const colorTypeOptions = readonly([
  {
    value: 'default',
    label: '默认'
  },
  {
    value: 'primary',
    label: '主要'
  },
  {
    value: 'success',
    label: '成功'
  },
  {
    value: 'info',
    label: '信息'
  },
  {
    value: 'warning',
    label: '警告'
  },
  {
    value: 'danger',
    label: '危险'
  }
])

/** 打开弹窗 */
const open = async (
  type: string,
  id?: number,
  dictType?: string,
  options?: { treeEnabled?: boolean; parentId?: number }
) => {
  dialogVisible.value = true
  dialogTitle.value = t('action.' + type)
  formType.value = type
  resetForm()
  treeEnabled.value = !!options?.treeEnabled
  if (dictType) {
    formData.value.dictType = dictType
  }
  formLoading.value = true
  try {
    if (treeEnabled.value && dictType) {
      await loadParentOptions(dictType, id)
    }
    // 修改时，设置数据
    if (id) {
      formData.value = await DictDataApi.getDictData(id)
    } else if (options?.parentId) {
      formData.value.parentId = options.parentId
    }
  } finally {
    formLoading.value = false
  }
}

/**
 * 加载「上级节点」的可选项
 *
 * 修改时要把自己和自己的子孙剔掉，否则选中它们会形成环。后端也会拦，
 * 但让一个明知非法的选项出现在下拉里，用户只会觉得是系统出错了
 */
const loadParentOptions = async (dictType: string, selfId?: number) => {
  const list = await DictDataApi.getDictDataTreeList(dictType)
  let candidates = list
  if (selfId) {
    const excluded = collectSelfAndDescendantIds(list, selfId)
    candidates = list.filter((item) => !excluded.has(item.id!))
  }
  parentOptions.value = handleTree(candidates.map((item) => ({ ...item })))
}

/**
 * 收集自身及全部子孙的编号
 *
 * 一次自顶向下扫描搞定，而不是对每个节点各自向上回溯——后者在大字典上是 O(n²)。
 * 列表本身按「父节点 → 同级排序」排列，父节点一定排在子节点之前，所以单趟即可；
 * 万一顺序被打乱，外层的重复扫描会兜住。
 */
const collectSelfAndDescendantIds = (list: DictDataApi.DictDataVO[], selfId: number) => {
  const result = new Set<number>([selfId])
  let changed = true
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
    const data = formData.value
    if (formType.value === 'create') {
      await DictDataApi.createDictData(data)
      message.success(t('common.createSuccess'))
    } else {
      await DictDataApi.updateDictData(data)
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
  formData.value = {
    id: undefined,
    parentId: 0,
    sort: 0,
    label: '',
    value: '',
    dictType: '',
    status: CommonStatusEnum.ENABLE,
    colorType: '',
    cssClass: '',
    remark: ''
  }
  parentOptions.value = []
  formRef.value?.resetFields()
}
</script>
