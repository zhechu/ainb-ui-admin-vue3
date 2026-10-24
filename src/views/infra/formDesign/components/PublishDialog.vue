<template>
  <Dialog v-model="dialogVisible" title="发布表单" width="560">
    <el-form ref="formRef" :model="formData" label-width="110px">
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

      <el-form-item label="发布到">
        <div class="flex items-center gap-16px">
          <!-- Web 端恒勾选：发布产物本来就是给 Web 运行时用的，取消它等于发布了一个没有入口的表单 -->
          <el-checkbox :model-value="true" disabled>Web 管理端</el-checkbox>
          <el-checkbox v-model="formData.publishToApp" :disabled="appNavUnavailable">
            App 移动端
          </el-checkbox>
        </div>
        <div v-if="appNavUnavailable" class="text-12px text-[var(--el-color-danger)] leading-18px">
          {{ appNavUnavailableReason }}
        </div>
        <div v-else class="text-12px text-gray-400 leading-18px">
          勾选后会在移动端导航树建一个入口，指向这张表单的运行页（列表 + 新增/编辑/查看）
        </div>
      </el-form-item>

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

      <template v-if="formData.publishToApp">
        <el-form-item v-if="firstAppPublish" label="App 上级分组" required>
          <el-tree-select
            v-model="formData.appParentNavNodeId"
            :data="navNodeTree"
            :props="{ label: 'name', children: 'children' }"
            check-strictly
            node-key="id"
            placeholder="请选择移动端导航的上级分组"
            class="w-full"
          />
          <div class="text-12px text-gray-400 leading-18px">
            移动端工作台按「分组 ▸ 子分组 ▸ 导航项」三层渲染，这里只能选到分组或子分组
          </div>
        </el-form-item>
        <el-form-item v-else label="App 入口">
          <div class="text-12px text-gray-400 leading-18px">
            已发布到 App 端（导航节点 #{{
              currentRow?.appNavNodeId
            }}），本次只同步名称与排序，不挪上级分组
          </div>
        </el-form-item>
        <el-form-item label="App 排序">
          <el-input-number v-model="formData.appMenuSort" :min="0" controls-position="right" />
        </el-form-item>
      </template>

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
import * as NavNodeApi from '@/api/system/navNode'
import { handleTree } from '@/utils/tree'
import { CommonStatusEnum } from '@/utils/constants'
import { checkPermi } from '@/utils/permission'
import { NAV_NODE_TYPE, NAV_TERMINAL } from '@/views/system/navNode/constants'

defineOptions({ name: 'FormDesignPublishDialog' })

const message = useMessage()
const emit = defineEmits(['success'])

const dialogVisible = ref(false)
const publishLoading = ref(false)
const firstPublish = ref(true)
/** 是否首次发布到 App 端。已发布过就只更新既有节点，不重新建、不挪父级 */
const firstAppPublish = ref(true)
const menuTree = ref<any[]>([])
const navNodeTree = ref<any[]>([])
const currentRow = ref<FormDesignApi.FormDesignVO>()

/** App 端发布不可用（无导航节点权限 / 导航树读不到）时置真，连带禁用勾选框 */
const appNavUnavailable = ref(false)
const appNavUnavailableReason = ref('')

const formData = ref({
  id: undefined as number | undefined,
  parentMenuId: undefined as number | undefined,
  menuSort: 0,
  publishToApp: false,
  appParentNavNodeId: undefined as number | undefined,
  appMenuSort: 0,
  changeSummary: ''
})

const open = async (row: FormDesignApi.FormDesignVO) => {
  currentRow.value = row
  appNavUnavailable.value = false
  appNavUnavailableReason.value = ''
  formData.value = {
    id: row.id,
    parentMenuId: undefined,
    menuSort: row.sort ?? 0,
    publishToApp: false,
    appParentNavNodeId: undefined,
    appMenuSort: row.sort ?? 0,
    changeSummary: ''
  }
  // menuId 为空说明从未发布过，需要建菜单
  firstPublish.value = !row.menuId
  firstAppPublish.value = !row.appNavNodeId
  dialogVisible.value = true
  if (firstPublish.value) {
    await loadMenuTree()
  }
  // 导航树与权限门要在校验之前备好：勾选框的默认值取决于「能不能读到 App 导航」
  if (await prepareAppNav()) {
    formData.value.publishToApp = !!row.appNavNodeId
  }
}

defineExpose({ open })

const loadMenuTree = async () => {
  const data = await MenuApi.getSimpleMenusList()
  menuTree.value = handleTree(data)
}

/**
 * 备妥 App 端发布所需的导航树，返回「本次能不能发布到 App」
 *
 * 🔴 权限门要在**发请求之前**用本地权限集判，不能等 403：
 * axios 拦截器对业务错误码是 ElNotification 全局弹一条，用户会先看到一个
 * 与「发布表单」无关的红色通知，才看到勾选框被禁用 —— 顺序反了等于没说清原因。
 *
 * 发布表单的人通常只有 infra:form-design:*，未必有 system:nav-node:*；
 * 这时要明示缺什么权限，而不是静默把 App 端选项藏掉。
 */
const prepareAppNav = async (): Promise<boolean> => {
  if (!checkPermi(['system:nav-node:query'])) {
    appNavUnavailable.value = true
    appNavUnavailableReason.value =
      '当前账号没有移动端导航的查看权限（system:nav-node:query），本次只能发布到 Web 端。' +
      '需要发布到 App 端请先向管理员申请该权限（建节点还需 system:nav-node:create）'
    return false
  }
  try {
    const data = await NavNodeApi.getNavNodeList({ terminal: NAV_TERMINAL })
    // 导航项（叶子）不能当父级：移动端只渲染三层，叶子下面挂不出东西
    const parents = (data || []).filter((node) => node.nodeType !== NAV_NODE_TYPE.ITEM)
    navNodeTree.value = handleTree(parents)
    return true
  } catch (error) {
    console.error('读取移动端导航节点失败', error)
    appNavUnavailable.value = true
    appNavUnavailableReason.value =
      '移动端导航节点读取失败，本次只能发布到 Web 端。可稍后重试，或到「系统管理 ▸ 移动端导航」确认节点数据'
    return false
  }
}

/**
 * 发布：三步操作
 *
 * 1. 调后端 publish —— 校验配置、存版本快照、更新状态，返回建菜单/建导航节点所需配置
 * 2. 若需建 Web 菜单，拿配置调 /system/menu/create 建菜单与按钮权限，再回调 bind-menu 登记
 * 3. 若勾选了 App 端，调 /system/nav-node/create（或 update）落地导航节点，
 *    新建的要回调 bind-app-nav 登记编号，供下线时精确回收
 *
 * 之所以分三步：infra 模块不能反向依赖 system 模块（system 已依赖 infra），
 * 而直写 system_menu / system_nav_node 会绕过各自 Service 的缓存失效与校验。
 *
 * 代价是不原子。任一步失败时表单已是已发布状态，此处会如实说明「哪一段没成」，
 * 用户可以再点一次发布补建（needCreateMenu / needCreateNavNode 仍为 true）——
 * 🔴 绝不能在这种情况下报「发布成功」。
 */
const handlePublish = async () => {
  if (firstPublish.value && !formData.value.parentMenuId) {
    message.warning('请选择上级菜单')
    return
  }
  if (formData.value.publishToApp && firstAppPublish.value && !formData.value.appParentNavNodeId) {
    message.warning('请选择 App 端的上级分组')
    return
  }
  publishLoading.value = true
  try {
    // 第 1 步：后端发布
    const toApp = formData.value.publishToApp
    const result = await FormDesignApi.publishFormDesign({
      id: formData.value.id!,
      changeSummary: formData.value.changeSummary,
      parentMenuId: formData.value.parentMenuId,
      menuSort: formData.value.menuSort,
      publishToApp: toApp,
      appParentNavNodeId: toApp ? formData.value.appParentNavNodeId : undefined,
      appMenuSort: toApp ? formData.value.appMenuSort : undefined
    })

    // 第 2 步：建 Web 菜单
    let createdMenuId: number | undefined
    if (result.needCreateMenu && result.menuConfig) {
      try {
        createdMenuId = await createMenus(formData.value.id!, result.menuConfig)
      } catch (menuError) {
        // 发布已生效但菜单没建成，必须如实告知而不是报成功
        console.error('创建菜单失败', menuError)
        message.error(
          `表单已发布（版本 v${result.version}），但创建菜单失败。请重新点击发布以补建菜单。`
        )
        finish()
        return
      }
    }

    // 第 3 步：建/更新 App 端导航节点
    let appNavDone: 'created' | 'updated' | 'skipped' = 'skipped'
    if (toApp && result.navNodeConfig) {
      try {
        appNavDone = await syncAppNavNode(
          formData.value.id!,
          result,
          createdMenuId ?? currentRow.value?.menuId
        )
      } catch (navError) {
        console.error('同步 App 端导航节点失败', navError)
        const action = result.needCreateNavNode ? '创建' : '更新'
        message.error(
          `表单已发布（版本 v${result.version}），但 App 端入口${action}失败：` +
            `${navError instanceof Error ? navError.message : navError}。` +
            `请重新点击发布以补建 App 入口。`
        )
        finish()
        return
      }
    }

    const parts = [`版本 v${result.version}`]
    if (createdMenuId) {
      parts.push('已创建 Web 菜单与按钮权限')
    }
    if (appNavDone === 'created') {
      parts.push('已创建 App 端入口')
    } else if (appNavDone === 'updated') {
      parts.push('已同步 App 端入口')
    }
    message.success(`发布成功（${parts.join('，')}）`)
    finish()
  } finally {
    publishLoading.value = false
  }
}

const finish = () => {
  emit('success')
  dialogVisible.value = false
}

/** 创建运行时菜单及其按钮权限，返回主菜单编号（App 节点的 menuRefId 要用它） */
const createMenus = async (
  designId: number,
  config: FormDesignApi.PublishMenuConfigVO
): Promise<number> => {
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
  return menuId as unknown as number
}

/**
 * 建或更新 App 端导航节点
 *
 * 更新分支只动「跟着表单走」的字段（名称/路由/参数/权限/图标/排序）：
 * parentId 是用户在首次发布时选的，再次发布时后端不再下发（reqVO 里被忽略），
 * 拿 config.parentId 覆盖会把节点挪到 null 上去。
 */
const syncAppNavNode = async (
  designId: number,
  result: FormDesignApi.FormDesignPublishRespVO,
  menuRefId?: number
): Promise<'created' | 'updated' | 'skipped'> => {
  const config = result.navNodeConfig!

  if (result.needCreateNavNode) {
    const navNodeId = (await NavNodeApi.createNavNode({
      terminal: NAV_TERMINAL,
      parentId: config.parentId,
      nodeType: config.nodeType ?? NAV_NODE_TYPE.ITEM,
      name: config.name,
      route: config.route,
      query: config.query,
      permissions: config.permissions,
      menuRefId,
      icon: config.icon,
      iconColor: config.iconColor,
      isTabbar: false,
      onlyPc: false,
      sort: config.sort ?? 0,
      visible: true,
      status: CommonStatusEnum.ENABLE
    } as NavNodeApi.NavNodeVO)) as unknown as number
    // 回调登记，下线时才知道要回收哪个节点
    await FormDesignApi.bindAppNav(designId, navNodeId)
    return 'created'
  }

  const existingId = currentRow.value?.appNavNodeId
  if (!existingId) {
    // 后端说不用建，但前端手里又没有节点编号 —— 数据不一致，不能装作成功
    throw new Error('后端未下发新建标记，但表单上也没有已登记的 App 导航节点编号')
  }
  const existing = await NavNodeApi.getNavNode(existingId).catch(() => undefined)
  if (!existing) {
    throw new Error(
      `已登记的 App 导航节点 #${existingId} 不存在（可能被人工删除）。` +
        `请先对这张表单执行「下线」，再重新发布以重建 App 入口`
    )
  }
  await NavNodeApi.updateNavNode({
    ...existing,
    name: config.name,
    route: config.route,
    query: config.query,
    permissions: config.permissions,
    icon: config.icon || existing.icon,
    iconColor: config.iconColor ?? existing.iconColor,
    sort: config.sort ?? existing.sort,
    menuRefId: existing.menuRefId ?? menuRefId
  } as NavNodeApi.NavNodeVO)
  return 'updated'
}
</script>
