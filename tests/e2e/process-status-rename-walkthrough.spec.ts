import { expect, test, type Page } from '@playwright/test'

/**
 * 一次性验证：在线表单流程系统列 status → process_status 改名后真实可用
 * 截图输出到 tests/e2e/.verify-shots/ps-*.png
 */

const SHOTS = 'tests/e2e/.verify-shots'

async function login(page: Page): Promise<void> {
  await page.goto('/login')
  const form = page.locator('form.login-form').filter({ has: page.getByPlaceholder('请输入用户名') })
  await form.waitFor({ state: 'visible' })
  const tenant = form.getByPlaceholder('请输入租户名称')
  if (await tenant.count()) await tenant.fill('xpy')
  await form.getByPlaceholder('请输入用户名').fill('admin')
  await form.getByPlaceholder('请输入密码').fill('admin123')
  const p = page.waitForResponse(
    (r) => r.url().includes('/system/auth/login') && r.request().method() === 'POST'
  )
  await form.getByRole('button', { name: /登\s*录/ }).first().click()
  expect((await p).ok()).toBeTruthy()
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30_000 })
}

test('数据建模流程字段预置生成 process_status', async ({ page }) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))

  await login(page)

  const ts = Date.now()
  const tableName = `verify_ps_${ts}`

  await page.goto('/infra/data-manage/data-model')
  await page.waitForLoadState('networkidle')

  // 打开新建模型表单
  await page.getByRole('button', { name: /新建模型/ }).first().click()
  await expect(page.locator('input[placeholder="如 biz_order"]')).toBeVisible({ timeout: 15_000 })

  // 填写表头
  await page.locator('input[placeholder="如 biz_order"]').fill(tableName)
  await page.locator('input[placeholder="如 订单表"]').fill('流程状态改名验证表')
  await page.locator('input[placeholder="如 订单模型"]').fill('流程状态改名验证模型')

  // 快速添加 → 流程字段
  await page.getByRole('button', { name: /快速添加/ }).first().click()
  await page
    .locator('.el-dropdown-menu__item')
    .filter({ hasText: '流程字段（process_instance_id + process_status）' })
    .first()
    .click()
  await page.waitForTimeout(400)

  // 断言：字段列表出现 process_instance_id 与 process_status（展示名「流程状态」）
  // 注：Vue 通过 property 绑定 input.value，DOM 属性选择器 [value=...] 不生效，改读实际值
  const colValues = async (): Promise<string[]> =>
    page.locator('.column-table').first().evaluate((el) =>
      Array.from(el.querySelectorAll('input')).map((i) => (i as HTMLInputElement).value)
    )

  let vals = await colValues()
  expect(vals).toContain('process_instance_id')
  expect(vals).toContain('process_status')
  // 展示名（comment）应为「流程状态」
  expect(vals).toContain('流程状态')
  await page.screenshot({ path: `${SHOTS}/ps-01-preset.png`, fullPage: true })

  // 🔍 探针：再添加业务「状态」(status) 常用字段 —— 改名后应与 process_status 共存不冲突
  await page.getByRole('button', { name: /快速添加/ }).first().click()
  await page.locator('.el-dropdown-menu__item').filter({ hasText: /状态（status）/ }).first().click()
  await page.waitForTimeout(400)
  vals = await colValues()
  expect(vals).toContain('status')
  expect(vals).toContain('process_status')
  await page.screenshot({ path: `${SHOTS}/ps-02-coexist.png`, fullPage: true })

  // 🔍 探针：预览 DDL —— 走后端 SQL 构建，确认生成的建表语句同时含 status 与 process_status 两列
  let ddlText = ''
  const ddlResp = page.waitForResponse(
    (r) => r.url().includes('/infra/data-model/preview-ddl') && r.request().method() === 'POST',
    { timeout: 20_000 }
  )
  await page.getByRole('button', { name: /预览 DDL/ }).first().click()
  const resp = await ddlResp
  expect(resp.ok()).toBeTruthy()
  const body = await resp.json()
  ddlText = JSON.stringify(body?.data ?? body)
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${SHOTS}/ps-03-ddl.png`, fullPage: true })

  console.log('=== DDL preview response ===')
  console.log(ddlText)

  expect(ddlText).toContain('process_status')
  expect(ddlText).toContain('process_instance_id')
  // 业务 status 独立成列（DDL 中应出现 `status` 反引号列定义）
  expect(ddlText).toMatch(/`status`/)

  if (errors.length) {
    console.log('=== page errors ===')
    console.log(errors.join('\n'))
  }
  expect(errors, errors.join('\n')).toHaveLength(0)
})

test('流程实例详情页流程状态展示正常', async ({ page }) => {
  test.setTimeout(120_000)
  // 上一步 step2_flow.py 真实发起并审批通过的流程实例（process_status 已回写为 2）
  const PI_ID = process.env.VERIFY_PI_ID || ''
  test.skip(!PI_ID, '需通过 VERIFY_PI_ID 传入已审批的流程实例编号')

  await login(page)
  await page.goto(`/bpm/process-instance/detail?id=${PI_ID}`)
  await page.waitForLoadState('networkidle')

  // 详情页头部以字典标签展示流程状态，审批通过后应为「审批通过」
  const statusTag = page
    .locator('.el-tag, .dict-tag, span')
    .filter({ hasText: /^审批通过$/ })
    .first()
  await expect(statusTag).toBeVisible({ timeout: 20_000 })
  await page.screenshot({ path: `${SHOTS}/ps-04-detail.png`, fullPage: true })
})
