import dayjs from 'dayjs'

/**
 * 授权表单共用的纯函数。
 *
 * 单独成一个模块而不是内联在 GrantForm.vue 里，是为了能被 vitest 直接测：
 * 弹窗组件要 mount 才测得到，而本仓的 vitest.config.ts 刻意不挂自动导入插件，
 * `useMessage` 这类全局在测试环境里是未定义的，组件测不起来
 */

/**
 * 到期时间填了过去的时间 = 保存即「已过期」，几乎一定是手误，先问一句。
 *
 * 抽出来是给单条表单与批量表单共用的：**两个入口必须是同一句文案**。
 * 同一个手误在两处得到不同提示，用户会以为是两回事
 *
 * @returns true 表示可以继续提交（没填到期时间、时间不在过去、或用户点了继续）
 */
export const confirmPastExpireTime = async (expireTime?: string): Promise<boolean> => {
  if (!expireTime || !dayjs(expireTime).isBefore(dayjs())) return true
  const message = useMessage()
  const ok = await message
    .confirm('到期时间早于当前时间，保存后该授权会立即处于「已过期」状态。是否继续？')
    .catch(() => false)
  return !!ok
}
