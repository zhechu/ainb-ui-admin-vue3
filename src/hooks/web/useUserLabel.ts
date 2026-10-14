import * as UserApi from '@/api/system/user'

/**
 * 把「存着 system_users.id 的列」翻译成「昵称（用户名）」
 *
 * 库里 `creator` / `updater` 是 BaseDO 的字符串字段，业务表的 `user_id` 是 bigint，
 * 三者装的都是用户编号。直接展示是一串数字，管理员认不出是谁，
 * 所以列表页普遍需要一张 id → 用户 的映射表。
 *
 * 走 `/system/user/simple-list`：它没有 `@PreAuthorize`，任何登录用户都能调，
 * 不会因为某个角色没被授予「用户查询」就让整个列表页 403。
 * 代价是它只返回**启用状态**的用户 —— 停用的人查不到，见 formatter 的兜底。
 *
 * @param columnName 加载失败时提示用的列名，例如「更新者」「调用人」「取号人」
 */
export const useUserLabel = (columnName = '用户') => {
  const message = useMessage()

  const userList = ref<UserApi.UserVO[]>([])
  const userMap = computed(() => new Map(userList.value.map((user) => [String(user.id), user])))

  /**
   * 拉用户列表
   *
   * 失败只降级不抛出：它只影响这一列好不好看（查不到就原样显示编号），
   * 不该因为它失败就让整个列表页空白。调用方若要和其它请求并发，
   * 可以自己 await 这个函数，不必依赖下面的 onMounted
   */
  const loadUsers = async () => {
    try {
      userList.value = await UserApi.getSimpleUserList()
    } catch {
      userList.value = []
      message.warning(`用户列表加载失败，「${columnName}」列将显示用户编号`)
    }
  }

  /**
   * id → 「昵称（用户名）」
   *
   * 兜底策略：查不到就把原始值显示出来，而不是显示空白。查不到有两种正常情况 ——
   * 用户被删除，或用户被停用（simple-list 只返回启用的）；历史行上的 id 仍然有效，
   * 显示数字至少能让人拿去库里查出是谁，显示空白等于把线索抹掉
   */
  const userLabel = (id: number | string | null | undefined) => {
    const key = id == null ? '' : String(id)
    if (!key) {
      return '-'
    }
    const user = userMap.value.get(key)
    const nickname = user?.nickname
    const username = user?.username
    if (nickname && username) {
      return `${nickname}（${username}）`
    }
    return nickname || username || key
  }

  /**
   * el-table-column 的 `:formatter`，等价于 `userLabel(cellValue)`
   *
   * 需要给空值单独上色（例如渲染成灰色的 `-`）时别用 formatter ——
   * 它只能返回字符串，改用 `<template #default>` 配 userLabel
   */
  const userFormatter = (_row: any, _column: any, cellValue: any) => userLabel(cellValue)

  onMounted(loadUsers)

  return { userList, userMap, loadUsers, userLabel, userFormatter }
}
