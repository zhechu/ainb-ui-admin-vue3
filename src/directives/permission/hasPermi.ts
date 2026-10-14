import type { App } from 'vue'
import { useUserStore } from '@/store/modules/user'

const { t } = useI18n() // 国际化

/**
 * 被判定为「无权限」的元素统一挂这个标记，配套的 CSS 在 `src/styles/index.scss` 末尾。
 *
 * 🔴 两处字符串必须同时改：SCSS 读不到 TS 的常量，只能靠这条注释把它们钉在一起。
 * 导出它是为了 hasRole 共用同一个标记 —— 两个指令的隐藏机制与那条归位 CSS 是同一套，
 * 各自起一个属性名就得在 SCSS 里写两份选择器，漂移只是时间问题
 */
export const HIDDEN_ATTR = 'data-permission-hidden'

/**
 * 判断权限的指令 directive
 *
 * 🔴 **隐藏方式是「打标记 + CSS display:none」，不是把节点从 DOM 里摘掉。**
 * 上一版写的是 `el.parentNode.removeChild(el)`，它在真实使用中是会炸的：
 *
 * 摘节点只动了 DOM，**没有动 Vue 的 vnode 树** —— `vnode.el` 仍然指向那个已经不在
 * 父容器里的元素。于是页面留下一批「Vue 以为还在、实际已游离」的兄弟节点。
 * Vue 打补丁时靠兄弟节点当 `insertBefore` 的参照锚点，锚点不是容器的子节点，
 * DOM 就抛 `NotFoundError: Failed to execute 'insertBefore' on 'Node'`，
 * 紧接着还会连锁出 `Cannot read properties of null (reading 'emitsOptions')`。
 *
 * 实测（无 `system:grant:create` 的账号，角色资源授权页）：
 * 那一栏按钮来回切两次视图 = **29 条 JS 错误**；超管（有权限，指令不摘节点）= **0 条**。
 * 也就是说这个缺陷**只有没权限的人踩得到** —— 恰恰是最没有能力自救、
 * 也最不容易被开发者复现的那批用户。这是把它从「不优雅」升级成「必须修」的理由。
 *
 * ⚠️ 常驻元素才踩得到：随 `v-if` 整块装卸的元素不会留下游离锚点
 * （整块卸载时 Vue 自己知道它们没了）。所以「切一次视图就炸」的两个按钮
 * 正是两种模式下都常驻的【新增授权】【批量授权】。
 *
 * 🔴 **为什么不改成写 `el.style.display = 'none'`**：`style` 与 `class` 都是 Vue 管的 prop，
 * 元素上只要有 `:style` / `:class` 绑定，下一次 patch 时 `patchStyle` / `patchClass`
 * 会把它自己算出来的值整体写回去，我们塞的 display 被静默抹掉 ——
 * 而且是**偶发**地抹掉（只在带这两个绑定的元素上），比不修更难查。
 * `data-*` 属性不出现在 vnode 的 props 里，`patchProp` 永远不会碰它。
 *
 * ⚠️ display:none 的元素**仍然是 CSS 兄弟**（`+` 组合器匹配的是文档树，不是渲染树），
 * 所以 Element Plus 那条不带作用域的 `.el-button+.el-button{margin-left:12px}`
 * 会让第一个**看得见**的按钮白拿 12px 左缩进。归位规则见 index.scss，别只改这一半。
 */
export function hasPermi(app: App<Element>) {
  app.directive('hasPermi', (el, binding) => {
    const { value } = binding

    if (value && value instanceof Array && value.length > 0) {
      const hasPermissions = hasPermission(value)

      // 🔴 有权限这一支必须显式 removeAttribute，不能只写「无权限就 set」。
      //    函数式指令在 mounted 与 updated 时都会被调用，而 userStore.permissions
      //    是整体重新赋值的 Set（见 store/modules/user.ts）：换账号、或权限被改过之后
      //    组件重新渲染，这个元素要能被放回来。只写一半就是一个「一旦隐藏就永久隐藏」的单向阀
      if (hasPermissions) {
        el.removeAttribute(HIDDEN_ATTR)
      } else {
        el.setAttribute(HIDDEN_ATTR, '')
      }
    } else {
      throw new Error(t('permission.hasPermission'))
    }
  })
}

/** 判断权限的方法 function */
const userStore = useUserStore()
const all_permission = '*:*:*'
export const hasPermission = (permission: string[]) => {
  return (
    userStore.permissions.has(all_permission) ||
    permission.some((permission) => userStore.permissions.has(permission))
  )
}
