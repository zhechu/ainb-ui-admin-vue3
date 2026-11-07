import { describe, expect, it } from 'vitest'
import type { DataModelTablePrefixVO } from '@/api/infra/dataModel'
import { validateNewTableName } from './tablePrefixRule'

/**
 * 新建表名校验的守卫（V5 §5.9.1 F2 / §19.3 测试 #33 ④）
 *
 * 这几条断言钉的都是**静默坏掉**的形状：
 *
 * - 前缀写死成 `^biz_` → 后端放开了 `qlzg_app_`，前端照样拦，保存按钮永远点不动，
 *   界面上没有任何提示说为什么。这就是被修掉的那个原 bug，`testAnyWhitelistedPrefix` 钉它；
 * - `tablePrefixEnforced` 读反 → 运维关掉强制（存量库接入的正规姿势）之后前端比后端还严，
 *   老库一张表也导不进来；
 * - 只报第一个前缀 → 用户以为另一个不合法，而那个恰恰是刚放开的。
 *
 * 后端的对应守卫是 `enlev-module-infra` 的 `LowCodePrefixAndTenantGuardTest`（#33）。
 * 🔴 两边**刻意各测一份**、不共享 fixture：这个函数的全部意义是「前端不再自己攒一份规则」，
 * 而它读的名单来自接口，接口返回什么由后端决定 —— 所以这里喂的是**接口形状**，
 * 断言的是「给定这份名单，前端拦不拦」。共享 fixture 只会把两边绑成同义反复。
 */
describe('新建表名校验', () => {
  const rules = (
    businessPrefixes: string[],
    tablePrefixEnforced = true
  ): DataModelTablePrefixVO => ({
    businessPrefixes,
    tablePrefixEnforced,
    dropForbiddenPrefixes: ['qlzg_app_']
  })

  describe('F2 前缀是多值白名单', () => {
    it('名单里任意一项都算合规，不只有第一项', () => {
      const multi = rules(['qlzg_app_', 'biz_'])
      expect(validateNewTableName('qlzg_app_survey', multi)).toBeNull()
      expect(validateNewTableName('biz_order', multi)).toBeNull()
    })

    it('🔴 原 bug：只认 biz_ 的实现会把 qlzg_app_ 的表拦死', () => {
      // 这条是「仍能抓到原 bug」的自检：F2 之前前端等价于只拿 ['biz_'] 比，
      // 于是机构自建台账的表名一律过不了。把实现改回单值，本条立刻红
      expect(validateNewTableName('qlzg_app_survey', rules(['biz_']))).toContain('biz_')
      expect(validateNewTableName('qlzg_app_survey', rules(['qlzg_app_', 'biz_']))).toBeNull()
    })

    it('名单外的表名被拒，且错误文案列出【全部】合法前缀', () => {
      const error = validateNewTableName('xyz_foo', rules(['qlzg_app_', 'biz_']))
      expect(error).not.toBeNull()
      expect(error).toContain('qlzg_app_')
      expect(error).toContain('biz_')
    })

    it('名单里的空白项按「没配」处理，不是「谁都不许建」', () => {
      expect(validateNewTableName('xyz_foo', rules(['', '  ']))).toBeNull()
      expect(validateNewTableName('xyz_foo', rules([]))).toBeNull()
    })
  })

  describe('开关与降级', () => {
    it('🔴 关掉强制后一律放行 —— 否则存量库根本接不进来', () => {
      expect(validateNewTableName('anything_at_all_1', rules(['biz_'], false))).toBeNull()
    })

    it('🔴 接口没回来时也放行前缀那一半，把判断交给后端', () => {
      // 反过来（拉不到就一律拦）会把一次接口抖动放大成「谁都建不了表」，
      // 而后端日志干干净净 —— 那是最难查的一种坏法
      expect(validateNewTableName('xyz_foo', null)).toBeNull()
      expect(validateNewTableName('xyz_foo', undefined)).toBeNull()
    })

    it('🔴 但命名规范那一半【不受开关影响】', () => {
      // 关掉的是「必须带业务前缀」这条建模规范，不是标识符合法性。
      // 后者在后端 SqlSafeGuard 里硬编码不可关（它防的是把库搞坏，不是搞乱）
      for (const enforced of [true, false]) {
        expect(validateNewTableName('MyTable', rules(['biz_'], enforced))).toContain('小写字母')
        expect(validateNewTableName('biz_order_', rules(['biz_'], enforced))).toContain('小写字母')
        expect(validateNewTableName('1abc', rules(['biz_'], enforced))).toContain('小写字母')
      }
    })
  })

  describe('命名规范', () => {
    it('合法：小写字母开头、字母或数字结尾', () => {
      const multi = rules(['biz_'])
      expect(validateNewTableName('biz_order', multi)).toBeNull()
      expect(validateNewTableName('biz_order_item_2', multi)).toBeNull()
    })

    it('拒绝：驼峰、大写、下划线结尾、单字符、空值', () => {
      const multi = rules(['biz_'])
      for (const name of ['biz_Order', 'BIZ_ORDER', 'biz_order_', 'b', '', '  ', null]) {
        expect(validateNewTableName(name as string, multi), `应当拒绝：${name}`).toContain(
          '小写字母'
        )
      }
    })

    it('前后空白被 trim 掉，与后端 StrUtil.trimToEmpty 一致', () => {
      expect(validateNewTableName('  biz_order  ', rules(['biz_']))).toBeNull()
    })
  })
})
