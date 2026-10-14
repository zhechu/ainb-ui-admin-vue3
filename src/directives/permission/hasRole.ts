import type { App } from 'vue'
import { CACHE_KEY, useCache } from '@/hooks/web/useCache'
import { HIDDEN_ATTR } from './hasPermi'

const { t } = useI18n() // 国际化

export function hasRole(app: App<Element>) {
  // 🔴 隐藏方式与 hasPermi 同一条口径（打标记 + CSS display:none），理由与实测数据
  //    写在 hasPermi.ts 的注释里，这里不重抄一遍：摘节点会让 vnode.el 指向一个已游离的
  //    元素，Vue 拿它当 insertBefore 锚点就抛 NotFoundError。
  //    ⚠️ 本指令目前全库 0 处使用，所以今天没有可复现的错误 —— 改它是拆地雷，不是修故障。
  //    两个指令是姊妹关系，下一个照抄 v-hasPermi 写 v-hasRole 的人不该继承同一个坑
  app.directive('hasRole', (el, binding) => {
    const { wsCache } = useCache()
    const { value } = binding
    const super_admin = 'super_admin'
    const userInfo = wsCache.get(CACHE_KEY.USER)
    const roles = userInfo?.roles || []

    if (value && value instanceof Array && value.length > 0) {
      const roleFlag = value

      const hasRole = roles.some((role: string) => {
        return super_admin === role || roleFlag.includes(role)
      })

      if (hasRole) {
        el.removeAttribute(HIDDEN_ATTR)
      } else {
        el.setAttribute(HIDDEN_ATTR, '')
      }
    } else {
      throw new Error(t('permission.hasRole'))
    }
  })
}
