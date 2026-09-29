import { describe, expect, it } from 'vitest'
import { generateRoute } from './routerHelper'

/**
 * 动态路由生成的兜底校验
 *
 * 背景：vue-router 对根级路由记录的 path 是硬校验（必须以 / 开头），菜单表里一旦存了
 * 不带斜杠的顶级地址，addRoute 抛错会中断整棵路由装配——登录后永远停在登录页，
 * 只能改库修数据。generateRoute 是后端菜单数据进入路由器的唯一边界，兜底放这里。
 */
describe('generateRoute', () => {
  it('顶级菜单 path 不带斜杠时自动补 /', () => {
    const routes = generateRoute([
      {
        id: 1,
        parentId: 0,
        name: '坏数据目录',
        path: 'ux_root',
        children: [
          {
            id: 2,
            parentId: 1,
            name: '子菜单',
            path: 'child',
            component: 'system/menu/index'
          }
        ]
      }
    ] as any)
    expect(routes[0].path).toBe('/ux_root')
    // 子级是相对路径，vue-router 允许，不能被补斜杠
    expect(routes[0].children![0].path).toBe('child')
  })

  it('已带斜杠的顶级 path 原样保留', () => {
    const routes = generateRoute([
      {
        id: 1,
        parentId: 0,
        name: '正常目录',
        path: '/system',
        children: [
          {
            id: 2,
            parentId: 1,
            name: '子菜单',
            path: 'user',
            component: 'system/user/index'
          }
        ]
      }
    ] as any)
    expect(routes[0].path).toBe('/system')
  })
})
