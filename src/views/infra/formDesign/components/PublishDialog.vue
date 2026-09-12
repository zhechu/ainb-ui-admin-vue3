<template>
  <Dialog v-model="dialogVisible" title="发布表单" width="560">
    <el-form ref="formRef" :model="formData" label-width="100px">
      <el-alert
        v-if="firstPublish"
        title="首次发布需要选择上级菜单，发布后会自动创建运行时菜单与按钮权限。"
        type="info"
        :closable="false"
        class="mb-15px"
      />
      <el-alert
        v-else
        title="该表单已发布过，本次发布只更新配置与版本，不会重建菜单。"
        type="info"
        :closable="false"
        class="mb-15px"
      />

      <el-form-item v-if="firstPublish" label="上级菜单" required>
        <el-tree-select
          v-model="formData.parentMenuId"
          :data="menuTree"
          :props="{ label: 'name', children: 'children' }"
          check-strictly
          node-key="id"
          placeholder="请选择上级菜单"
          class="w-full"
        />
      </el-form-item>

      <el-form-item v-if="firstPublish" label="菜单排序">
        <el-input-number v-model="formData.menuSort" :min="0" controls-position="right" />
      </el-form-item>

      <el-form-item label="变更说明">
        <el-input
          v-model="formData.changeSummary"
          :rows="3"
          placeholder="简述本次发布改了什么，会记入版本历史"
          type="textarea"
        />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button :disabled="publishLoading" type="primary" @click="handlePublish">
        确认发布
      </el-button>
      <el-button @click="dialogVisible = false">取 消</el-button>
    </template>
  </Dialog>
</template>

<script lang="ts" setup>
import * as FormDesignApi from '@/api/infra/formDesign'
import * as MenuApi from '@/api/system/menu'
import { handleTree } from '@/utils/tree'
import { CommonStatusEnum } from '@/utils/constants'

defineOptions({ name: 'FormDesignPublishDialog' })

const message = useMessage()
const emit = defineEmits(['success'])

const dialogVisible = ref(false)
const publishLoading = ref(false)
const firstPublish = ref(true)
const menuTree = ref<any[]>([])

const formData = ref({
  id: undefined as number | undefined,
  parentMenuId: undefined as number | undefined,
  menuSort: 0,
  changeSummary: ''
})

const open = async (row: FormDesignApi.FormDesignVO) => {
  formData.value = {
    id: row.id,
    parentMenuId: undefined,
    menuSort: row.sort ?? 0,
    changeSummary: ''
  }
  // menuId 为空说明从未发布过，需要建菜单
  firstPublish.value = !row.menuId
  dialogVisible.value = true
  if (firstPublish.value) {
    await loadMenuTree()
  }
}

defineExpose({ open })

const loadMenuTree = async () => {
  const data = await MenuApi.getSimpleMenusList()
  menuTree.value = handleTree(data)
}

/**
 * 发布：两步操作
 *
 * 1. 调后端 publish —— 校验配置、存版本快照、更新状态，返回建菜单所需配置
 * 2. 若需建菜单，拿配置调 /system/menu/create 建菜单与按钮权限，再回调 bind-menu 登记
 *
 * 之所以分两步：infra 模块不能反向依赖 system 模块（system 已依赖 infra），
 * 而直写 system_menu 表会绕过 MenuService 的 @CacheEvict 导致权限缓存不失效。
 *
 * 代价是不原子。第 1 步成功但第 2 步失败时，表单已是已发布状态但没有菜单，
 * 此时会明确提示用户，用户可以再点一次发布补建菜单（needCreateMenu 仍为 true）。
 */
const handlePublish = async () => {
  if (firstPublish.value && !formData.value.parentMenuId) {
    message.warning('请选择上级菜单')
    return
  }
  publishLoading.value = true
  try {
    // 第 1 步：后端发布
    const result = await FormDesignApi.publishFormDesign({
      id: formData.value.id!,
      changeSummary: formData.value.changeSummary,
      parentMenuId: formData.value.parentMenuId,
      menuSort: formData.value.menuSort
    })

    // 第 2 步：建菜单
    if (result.needCreateMenu && result.menuConfig) {
      try {
        await createMenus(formData.value.id!, result.menuConfig)
        message.success(`发布成功，已创建菜单与按钮权限（版本 v${result.version}）`)
      } catch (menuError) {
        // 发布已生效但菜单没建成，必须如实告知而不是报成功
        console.error('创建菜单失败', menuError)
        message.error(
          `表单已发布（版本 v${result.version}），但创建菜单失败。请重新点击发布以补建菜单。`
        )
        emit('success')
        dialogVisible.value = false
        return
      }
    } else {
      message.success(`发布成功（版本 v${result.version}）`)
    }

    emit('success')
    dialogVisible.value = false
  } finally {
    publishLoading.value = false
  }
}

/** 创建运行时菜单及其按钮权限 */
const createMenus = async (designId: number, config: FormDesignApi.PublishMenuConfigVO) => {
  // 建主菜单
  const menuId = await MenuApi.createMenu({
    name: config.name,
    permission: '',
    type: 2,
    sort: config.sort,
    parentId: config.parentId,
    path: config.path,
    icon: config.icon,
    component: config.component,
    componentName: config.componentName,
    status: CommonStatusEnum.ENABLE,
    visible: true,
    keepAlive: true,
    alwaysShow: true
  } as any)

  // 建按钮权限，挂在主菜单下
  const permissionMenuIds: number[] = []
  for (const perm of config.permissions) {
    const permId = await MenuApi.createMenu({
      name: perm.name,
      permission: perm.permission,
      type: 3,
      sort: perm.sort,
      parentId: menuId,
      path: '',
      icon: '',
      component: '',
      status: CommonStatusEnum.ENABLE,
      visible: true,
      keepAlive: true
    } as any)
    permissionMenuIds.push(permId as unknown as number)
  }

  // 回调登记，供下线时精确回收
  await FormDesignApi.bindMenu(designId, menuId as unknown as number, permissionMenuIds)
}
</script>
