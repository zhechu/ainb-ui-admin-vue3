import { test, expect, type Page } from '@playwright/test'
import path from 'node:path'
import fs from 'node:fs'

const SHOTS = path.join(__dirname, '.verify-shots')
fs.mkdirSync(SHOTS, { recursive: true })

const login = async (page: Page) => {
  await page.goto('/login')
  const form = page.locator('form.login-form').filter({ has: page.getByPlaceholder('请输入用户名') })
  await form.getByPlaceholder('请输入租户').fill('xpy')
  await form.getByPlaceholder('请输入用户名').fill('admin')
  await form.getByPlaceholder('请输入密码').fill('admin123')
  const resp = page.waitForResponse((r) => r.url().includes('/system/auth/login') && r.request().method() === 'POST')
  await form.getByRole('button', { name: /登\s*录|Login/ }).click()
  await resp
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 15_000 })
}

test('成员页部门筛选 + 弹窗布局走查', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))

  await login(page)
  await page.goto('/system/role/member?roleId=2')
  await expect(page.locator('.xpy-list-table .el-table__row').first()).toBeVisible({ timeout: 15_000 })

  // ===== 1. 成员页：部门树筛选存在（el-tree-select 的 input role=combobox，accessible name 来自 form-item label）=====
  const deptSelect = page.locator('.el-form').first().locator('.el-select').filter({ has: page.getByRole('combobox', { name: '部门' }) }).first()
  await expect(deptSelect).toBeVisible({ timeout: 5_000 })
  console.log('===PAGE_DEPT_SELECT=== visible')

  // 打开部门下拉：点 wrapper 而不是 input——EP 的 placeholder 覆盖层会拦截对 readonly input 的点击
  await deptSelect.locator('.el-select__wrapper').click()
  await page.waitForTimeout(600)
  const deptDropdown = page.locator('.el-select__popper').filter({ has: page.locator('.el-tree') }).last()
  await expect(deptDropdown.locator('.el-tree-node').first()).toBeVisible({ timeout: 5_000 })
  const firstDeptName = await deptDropdown.locator('.el-tree-node__content').first().innerText()
  console.log('===DEPT_TREE_FIRST===', firstDeptName)
  await deptDropdown.locator('.el-tree-node__content').first().click()
  await page.waitForTimeout(400)
  // 点搜索
  const pageResp = page.waitForResponse((r) => r.url().includes('/system/user/page') && r.url().includes('deptId='), { timeout: 10_000 })
  await page.getByRole('button', { name: '搜索' }).first().click()
  expect((await pageResp).ok()).toBeTruthy()
  await page.waitForTimeout(1200)
  const filteredTotal = await page.locator('.el-pagination__total').first().innerText()
  console.log('===PAGE_DEPT_FILTER_TOTAL===', filteredTotal)
  await page.screenshot({ path: path.join(SHOTS, 'mem-page-dept.png') })

  // 重置
  await page.getByRole('button', { name: '重置' }).first().click()
  await page.waitForTimeout(1200)

  // ===== 2. 添加成员弹窗 =====
  await page.getByRole('button', { name: '添加成员' }).click()
  const addDialog = page.locator('.el-dialog').filter({ hasText: '添加成员' }).last()
  await expect(addDialog).toBeVisible({ timeout: 10_000 })
  await page.waitForTimeout(800)

  // 弹窗内部门树筛选存在（无 form-item label，用占位文本定位）
  const dialogDeptSelect = addDialog.locator('.el-select').filter({ hasText: '按部门筛选' }).first()
  await expect(dialogDeptSelect).toBeVisible({ timeout: 5_000 })
  console.log('===DIALOG_DEPT_SELECT=== visible')

  // footer 按钮右对齐：检查 footer 容器的 text-align 或按钮位置
  const footer = addDialog.locator('.el-dialog__footer').first()
  const footerBox = await footer.boundingBox()
  const cancelBtn = addDialog.getByRole('button', { name: /取\s*消/ }).first()
  const cancelBox = await cancelBtn.boundingBox()
  const addBtn = addDialog.getByRole('button', { name: /添加（已选/ }).first()
  const addBox = await addBtn.boundingBox()
  // 右对齐：按钮右边缘应接近 footer 右边缘（留 padding）
  const footerRight = footerBox!.x + footerBox!.width
  const addRight = addBox!.x + addBox!.width
  const gap = footerRight - addRight
  console.log('===FOOTER_ALIGN===', { footerRight, addRight, gap })
  expect(gap).toBeLessThan(60) // 右对齐时 gap 应该很小（仅 padding）
  expect(gap).toBeGreaterThan(0)

  // 分页栏错位检查：pagination 应在 dialog body 内、footer 之上，不重叠
  const pagination = addDialog.locator('.el-pagination').first()
  const pagBox = await pagination.boundingBox()
  const footerTop = footerBox!.y
  const pagBottom = pagBox!.y + pagBox!.height
  console.log('===PAGINATION_POS===', { pagBottom, footerTop, noOverlap: pagBottom <= footerTop + 2 })
  expect(pagBottom).toBeLessThanOrEqual(footerTop + 2)

  await page.screenshot({ path: path.join(SHOTS, 'mem-add-dialog.png'), fullPage: false })

  // 弹窗内部门筛选可用
  await dialogDeptSelect.locator('.el-select__wrapper').click()
  await page.waitForTimeout(600)
  const dialogDeptDropdown = page.locator('.el-select__popper').filter({ has: page.locator('.el-tree') }).last()
  await expect(dialogDeptDropdown.locator('.el-tree-node').first()).toBeVisible({ timeout: 5_000 })
  await dialogDeptDropdown.locator('.el-tree-node__content').first().click()
  await page.waitForTimeout(400)
  const dialogResp = page.waitForResponse((r) => r.url().includes('/system/user/page') && r.url().includes('deptId='), { timeout: 10_000 })
  await addDialog.getByRole('button', { name: '搜索' }).click()
  expect((await dialogResp).ok()).toBeTruthy()
  await page.waitForTimeout(1200)
  const dialogFilteredTotal = await addDialog.locator('.el-pagination__total').first().innerText()
  console.log('===DIALOG_DEPT_FILTER_TOTAL===', dialogFilteredTotal)

  // 重置
  await addDialog.getByRole('button', { name: '重置' }).click()
  await page.waitForTimeout(1000)

  // 关闭弹窗
  await page.keyboard.press('Escape')
  await expect(addDialog).not.toBeVisible({ timeout: 5_000 })

  console.log('===ERRORS===', errors)
  expect(errors).toEqual([])
})
