import { expect, test, type Page } from '@playwright/test'

/**
 * 权限资源页 · 真实使用场景下的布局验证
 *
 * 前两轮「修好了」但用户仍反馈底部空白，原因是我只在 Playwright 默认视口（1280×720）
 * 下测了默认状态。实际使用中至少有三个变量会让布局失准：
 *   ① 窗口尺寸不同（1080p / 1440p / 笔记本小屏）
 *   ② 内容量骤变（搜索后只剩几行 → 表格高度塌陷）
 *   ③ 头部高度变化（搜索区换行会把表格往下推）
 * 所以这里按真实操作路径逐个走一遍，每个断言都量实际像素。
 */

const VIEWPORTS = [
  { name: '1080p 全屏', width: 1920, height: 1080 },
  { name: '1440×900 笔记本', width: 1440, height: 900 },
  { name: '1280×720 小屏', width: 1280, height: 720 }
]

/** 内容区底部到视口底部的空隙 */
async function bottomGap(page: Page): Promise<number> {
  return await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.el-card')) as HTMLElement[]
    if (!cards.length) return 9999
    const last = cards[cards.length - 1].getBoundingClientRect()
    return Math.round(window.innerHeight - last.bottom)
  })
}

/** 页面是否出现了不该有的整页纵向滚动（内容撑爆视口） */
async function pageOverflow(page: Page): Promise<number> {
  return await page.evaluate(() =>
    Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
  )
}

async function login(page: Page) {
  await page.goto('/login')
  const f = page.locator('form.login-form').filter({ has: page.getByPlaceholder('请输入用户名') })
  await f.waitFor({ state: 'visible' })
  const t = f.getByPlaceholder('请输入租户名称')
  if (await t.count()) await t.fill('xpy')
  await f.getByPlaceholder('请输入用户名').fill('admin')
  await f.getByPlaceholder('请输入密码').fill('admin123')
  await f.getByRole('button', { name: /登\s*录/ }).first().click()
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30_000 })
}

test('二分定位：只做「搜索→重置→展开」', async ({ page }) => {
  page.on('crash', () => console.log('  [CRASH]'))
  await page.setViewportSize({ width: 1280, height: 720 })
  await login(page)
  await page.goto('/system/resource')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1500)
  console.log('  A 搜索')
  await page.getByPlaceholder('支持模糊搜索，如 system:user').fill('system:user:query')
  await page.getByRole('button', { name: /搜索/ }).click()
  await page.waitForTimeout(1500)
  console.log('  B 重置')
  await page.getByRole('button', { name: /重置/ }).click()
  await page.waitForTimeout(2000)
  console.log('  C 展开')
  await page.locator('.el-table__expand-icon').first().click()
  await page.waitForTimeout(2000)
  console.log('  D 完成 rows=' + (await page.locator('.el-table tbody tr').count()))
})

test('二分定位：加入「空结果」这一步', async ({ page }) => {
  page.on('crash', () => console.log('  [CRASH]'))
  await page.setViewportSize({ width: 1280, height: 720 })
  await login(page)
  await page.goto('/system/resource')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1500)
  const kw = page.getByPlaceholder('支持模糊搜索，如 system:user')
  const btn = page.getByRole('button', { name: /搜索/ })
  console.log('  A 搜索有结果')
  await kw.fill('system:user:query'); await btn.click(); await page.waitForTimeout(1500)
  console.log('  B 搜索空结果')
  await kw.fill('zzz_not_exist_zzz'); await btn.click(); await page.waitForTimeout(1500)
  console.log('  C 重置')
  await page.getByRole('button', { name: /重置/ }).click(); await page.waitForTimeout(2000)
  console.log('  D 展开前 DOM: ' + JSON.stringify(await page.evaluate(() => ({
    rows: document.querySelectorAll('.el-table tbody tr').length,
    icons: document.querySelectorAll('.el-table__expand-icon').length,
    allNodes: document.querySelectorAll('*').length
  }))))
  // 不点击，只观察：如果不点也崩，说明与点击无关
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(500)
    const n = await page.evaluate(() => document.querySelectorAll('*').length).catch(() => -1)
    console.log(`    t+${(i + 1) * 500}ms DOM节点=${n}`)
    if (n === -1) { console.log('    [已崩溃，未点击]'); break }
  }
  console.log('  D2 现在点击展开')
  await page.locator('.el-table__expand-icon').first().click(); await page.waitForTimeout(2000)
  console.log('  E 完成 rows=' + (await page.locator('.el-table tbody tr').count()))
})

test('二分定位：只做「搜索→展开」（不重置）', async ({ page }) => {
  page.on('crash', () => console.log('  [CRASH]'))
  await page.setViewportSize({ width: 1280, height: 720 })
  await login(page)
  await page.goto('/system/resource')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1500)
  await page.getByPlaceholder('支持模糊搜索，如 system:user').fill('system:user')
  await page.getByRole('button', { name: /搜索/ }).click()
  await page.waitForTimeout(2000)
  console.log('  搜索后 rows=' + (await page.locator('.el-table tbody tr').count()))
  const ic = page.locator('.el-table__expand-icon').first()
  if (await ic.count()) { await ic.click(); await page.waitForTimeout(2000) }
  console.log('  完成 rows=' + (await page.locator('.el-table tbody tr').count()))
})

test('隔离验证：直接进页面展开子节点（不经过搜索/重置）', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await login(page)
  await page.goto('/system/resource')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1500)
  const icon = page.locator('.el-table__expand-icon').first()
  await icon.click()
  await page.waitForTimeout(2000)
  const rows = await page.locator('.el-table tbody tr').count()
  console.log(`  [isolated] 展开后行数=${rows}`)
  expect(rows).toBeGreaterThan(100)
})

for (const vp of VIEWPORTS) {
  test(`权限资源页 @ ${vp.name}：真实操作全程无大片空白`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => { errors.push(String(e)); console.log('  [pageerror] ' + String(e).slice(0, 200)) })
    page.on('console', (m) => {
      if (m.type() === 'error') console.log('  [console.error] ' + m.text().slice(0, 200))
    })
    page.on('crash', () => console.log('  [CRASH] 渲染进程崩溃'))

    await page.setViewportSize({ width: vp.width, height: vp.height })
    await login(page)
    await page.goto('/system/resource')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)

    const steps: { label: string; gap: number; overflow: number; rows: number }[] = []
    const snap = async (label: string) => {
      console.log(`  [step] ${label} ...`)
      const rows = await page.locator('.el-table tbody tr').count()
      steps.push({ label, gap: await bottomGap(page), overflow: await pageOverflow(page), rows })
      console.log(`  [step] ${label} done rows=${rows}`)
    }

    // ① 刚进页面
    await snap('默认')

    // ② 搜索 → 行数骤减（最容易塌陷的场景）
    await page.getByPlaceholder('支持模糊搜索，如 system:user').fill('system:user:query')
    await page.getByRole('button', { name: /搜索/ }).click()
    await page.waitForTimeout(1500)
    await snap('搜索后少量行')

    // ③ 搜一个不存在的 → 空结果
    await page.getByPlaceholder('支持模糊搜索，如 system:user').fill('zzz_not_exist_zzz')
    await page.getByRole('button', { name: /搜索/ }).click()
    await page.waitForTimeout(1200)
    await snap('空结果')

    // ④ 重置回默认
    await page.getByRole('button', { name: /重置/ }).click()
    await page.waitForTimeout(1500)
    await snap('重置后')

    // ⑤ 展开一个节点（懒加载）
    const icon = page.locator('.el-table__expand-icon').first()
    if (await icon.count()) {
      const reqs: string[] = []
      page.on('request', (r) => {
        if (r.url().includes('list-children')) reqs.push(r.url())
      })
      // 崩溃前先把状态打出来
      const pre = await page.evaluate(() => ({
        icons: document.querySelectorAll('.el-table__expand-icon').length,
        rows: document.querySelectorAll('.el-table tbody tr').length,
        tableKey: (document.querySelector('.el-table') as HTMLElement)?.getAttribute('data-v-key') || 'n/a'
      }))
      console.log(`  [pre-click] ${JSON.stringify(pre)}`)
      await icon.scrollIntoViewIfNeeded().catch(() => {})
      await page.waitForTimeout(300)
      await icon.click()
      await page.waitForTimeout(500)
      console.log(`  [expand] 触发请求 ${reqs.length} 次: ${reqs.slice(0, 5).join(' | ')}`)
      await page.waitForTimeout(1000)
      await snap('展开子节点')
    }

    console.log(`\n=== ${vp.name}（${vp.width}×${vp.height}）===`)
    for (const s of steps) {
      console.log(`  ${s.label.padEnd(12)} 行数=${String(s.rows).padStart(4)}  底部空隙=${String(s.gap).padStart(4)}px  整页溢出=${s.overflow}px`)
    }

    for (const s of steps) {
      expect(s.gap, `${vp.name} / ${s.label}：底部空白 ${s.gap}px`).toBeLessThan(120)
      expect(s.gap, `${vp.name} / ${s.label}：内容超出视口 ${-s.gap}px`).toBeGreaterThan(-40)
      expect(s.overflow, `${vp.name} / ${s.label}：整页溢出 ${s.overflow}px，出现了长滚动条`).toBeLessThan(120)
    }
    expect(errors, `页面抛了 JS 异常：${errors.join(' | ')}`).toHaveLength(0)
  })
}

test('规则管理页 @ 1080p：搜索前后都不塌陷', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  await login(page)
  await page.goto('/system/rule')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1200)

  const g1 = await bottomGap(page)
  await page.getByPlaceholder('请输入规则名称').fill('仅自己的数据')
  await page.getByRole('button', { name: /搜索/ }).first().click()
  await page.waitForTimeout(1000)
  const g2 = await bottomGap(page)

  console.log(`\n=== 规则管理 1920×1080 ===\n  默认 底部空隙=${g1}px\n  搜索后 底部空隙=${g2}px`)
  expect(g1, `规则页默认底部空白 ${g1}px`).toBeLessThan(120)
  expect(g2, `规则页搜索后底部空白 ${g2}px`).toBeLessThan(120)
})
