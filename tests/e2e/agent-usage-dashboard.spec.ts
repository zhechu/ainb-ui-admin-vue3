import { test, expect } from '@playwright/test'
import { login, gotoWithAuth } from './helpers/auth'

/**
 * AI 助手用量看板的端到端验证（P4 / 方案 §8、§14 判据「用量看板可按租户/用户/场景下钻」）
 *
 * 🔴 为什么非要走浏览器
 * 接口能返回数据，不等于看板能用。这一轮里已经踩到两次：
 *   ① 按 SCENE 下钻时后端 NPE，而按 USER 是好的 —— 只测一个维度就漏了；
 *   ② 菜单权限点挂错父节点，接口通但页面根本进不去。
 * 两者都只有在界面上真点一遍才会暴露。
 *
 * 前置：后端 48080 与前端 dev server 同时在跑，且 agent_usage_log 里有数据
 *（跑过几次助手对话即可）。
 */

// 登录与跳转走共用辅助：登录之后紧接着的一次 goto 会偶发被路由守卫弹回登录页，
// 不处理的话失败现象是「页面上什么都没有」，看起来像业务代码坏了。详见 helpers/auth.ts

test.describe('AI 助手用量看板', () => {
  test.setTimeout(120_000)

  test('四个维度都能下钻，且合计与明细都渲染得出来', async ({ page }) => {
    const failures: string[] = []
    // 任何一个维度返回非 0 业务码都要记下来 —— SCENE 那次 NPE 就是这么漏掉的
    page.on('response', async (resp) => {
      if (!resp.url().includes('/agent/usage/summary')) return
      try {
        const body = await resp.json()
        if (body?.code !== 0) {
          failures.push(`${resp.url()} -> code=${body?.code} msg=${body?.msg}`)
        }
      } catch {
        // 非 JSON 响应忽略
      }
    })

    await login(page)
    await gotoWithAuth(page, '/ai/agent/usage')

    // 1. 默认按场景下钻，表格要有数据。
    //    ⚠️ 必须限定到第一张表：页面下方还有「调用明细」表，
    //    不限定的话两张表的行会加在一起，汇总表为空也测不出来
    const summaryRows = page.locator('.el-table').first().locator('.el-table__body tr')
    await expect(page.getByText('调用次数').first()).toBeVisible({ timeout: 20000 })
    expect(await summaryRows.count()).toBeGreaterThan(0)

    // 2. 逐个切维度。每切一次都要重新有行 ——
    //    只看「不报错」是不够的，后端返回空数组时页面同样不报错
    //
    //    ⚠️ 点的是 .el-radio-button__inner 而不是 getByRole('radio')：
    //    Element Plus 真正的 <input type="radio"> 是隐藏的，点不到
    for (const label of ['按用户', '按模型', '按日期', '按场景']) {
      await page.locator('.el-radio-button__inner').filter({ hasText: label }).click()
      await page.waitForTimeout(1500)
      expect(await summaryRows.count(), `${label} 维度没有数据`).toBeGreaterThan(0)
    }

    // 3. 没有任何一个维度返回业务错误
    expect(failures, `下钻请求返回了错误：\n${failures.join('\n')}`).toHaveLength(0)

    // 4. 合计区要有非零的 token 数，否则等于看板是空的
    const totalText = await page.locator('.el-descriptions').first().innerText()
    expect(totalText).toMatch(/[1-9]/)
  })

  test('调用明细区渲染出输入原文', async ({ page }) => {
    await login(page)
    await gotoWithAuth(page, '/ai/agent/usage')
    // 超管有 agent:usage:detail，这一段应当可见
    await expect(page.getByText('最近的调用明细')).toBeVisible({ timeout: 20000 })
    await expect(page.getByText('输入原文')).toBeVisible()
  })
})
