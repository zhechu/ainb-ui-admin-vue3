import { expect, test, type Page } from '@playwright/test'

/**
 * 属性面板的回归用例（格式校验 / 数据脱敏）
 *
 * ## 它守的是两个都会静默失效的 bug
 *
 * **一、注册被覆盖**
 * 设计器的 `setComponentRuleConfig(name, ...)` 对同一控件调用两次，后一次会
 * 覆盖前一次且不报错。`useValidateRule` 给 input / textarea / password /
 * inputNumber 注册「格式校验」之后，`useInputEnhanceRule` 又给同一批控件注册
 * 「出现场景」—— 结果是四个文本输入控件的「格式校验」入口整个消失。
 * 现在两者都走 `appendComponentProps` 注册表合并，本用例断言两项同时在。
 *
 * **二、读写了错误的对象**
 * 属性面板项的 `field` 决定它读写 `activeRule.props` 上的哪个键。曾经这里用的是
 * 一个 `field: '__validateRules__'` 的桥接组件，内部想通过 `formCreateInject.rule`
 * 够到当前控件 —— 但注入进来的 `rule` 是**属性项自己**，于是读永远是空、
 * 写也只落在临时对象上。本用例断言库里已有的规则能在面板里回显出来。
 *
 * 两个 bug 的共同特征：控制台没有任何报错，运行时校验也照常生效
 * （服务端读的是同一份 props.validateRules），只有设计器里看不见 ——
 * 看起来就像「这个功能没做」。所以只能靠界面用例守。
 *
 * ## 「数据脱敏」共用同一套判据
 *
 * 脱敏项（`useMaskRule`）落在同一批控件上，是第三个往这些控件追加属性的模块，
 * 因此同样可能被覆盖、也同样会「运行时生效但面板里看不见」——
 * 服务端读的是 `props.maskRule`，它在没有入口的那段时间里一直是好的。
 */

const API_BASE_URL = process.env.E2E_API_BASE_URL || 'http://127.0.0.1:48080/admin-api'
const TENANT_ID = process.env.E2E_TENANT_ID || '1'

/** 校验示例 1，邮箱字段上配了内置正则 EMAIL */
const FORM_CODE = 'test_demo_verify_format'

async function login(page: Page): Promise<string> {
  await page.goto('/login')
  const form = page
    .locator('form.login-form')
    .filter({ has: page.locator('input[type="password"]') })
    .filter({ has: page.locator('input[type="checkbox"]') })
    .first()
  await expect(form).toBeVisible()
  const inputs = form.locator('input:visible')
  const count = await inputs.count()
  if (count >= 3) await inputs.nth(0).fill('xpy')
  await inputs.nth(count - 2).fill('admin')
  await inputs.nth(count - 1).fill('admin123')
  const loginPromise = page.waitForResponse(
    (r) => r.url().includes('/system/auth/login') && r.request().method() === 'POST'
  )
  await form.locator('button').last().click()
  const response = await loginPromise
  expect(response.ok()).toBeTruthy()
  const body = (await response.json()) as { data?: { accessToken?: string } }
  // 首屏要现编译一大批模块，超时给足
  await expect(page.locator('.v-setting')).toBeVisible({ timeout: 60_000 })
  return body.data?.accessToken as string
}

/** 按 code 找表单设计的编号。分页接口的 pageSize 上限是 100，必须翻页 */
async function findDesignId(page: Page, token: string, code: string): Promise<number> {
  const headers = { Authorization: `Bearer ${token}`, 'tenant-id': TENANT_ID }
  for (let pageNo = 1; pageNo <= 10; pageNo++) {
    const resp = await page.request.get(
      `${API_BASE_URL}/infra/form-design/page?pageNo=${pageNo}&pageSize=100`,
      { headers }
    )
    const body = (await resp.json()) as any
    const list = body?.data?.list || []
    const hit = list.find((item: any) => item.code === code)
    if (hit) return hit.id
    if (list.length < 100) break
  }
  throw new Error(`没找到编码为 ${code} 的表单设计，先跑 script/form-demo/demo11_verify_format.py`)
}

/**
 * 走到设计器的第 3 步「表单设计」。步骤条本身点不动，用「下一步」推
 *
 * @param anchorLabel 画布上必然存在的一个字段标题，用来确认渲染完成 ——
 *                    渲染没完就去点控件会点空，表现为属性面板一直是空的
 */
async function gotoFormDesignStep(page: Page, designId: number, anchorLabel: string) {
  await page.goto(`/infra/form-design/editor?id=${designId}`)
  await expect(page.getByRole('button', { name: '下一步' })).toBeVisible({ timeout: 30_000 })
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: '下一步' }).click()
    await page.waitForTimeout(1500)
  }
  // 画布渲染完才有控件可点
  await expect(
    page.locator('.el-form-item__label').filter({ hasText: new RegExp(`^${anchorLabel}$`) })
  ).toHaveCount(1, { timeout: 30_000 })
}

/** 选中画布上的某个字段，让右侧属性面板切到它 */
async function selectField(page: Page, label: string) {
  await page
    .locator('.el-form-item__label')
    .filter({ hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) })
    .first()
    .click({ force: true })
  await page.waitForTimeout(1500)
}

/**
 * 读属性面板上某一项的当前值
 *
 * ⚠️ 下拉项不能只读 `input.value`。Element Plus 的 el-select 把**选中项的文案**
 * 渲染成文本节点，input 里往往是空的 —— 只读 input 会得到空串，
 * 看起来像「配了值却没回显」，而实际上界面上明明白白显示着。
 * 所以两者都取：input 有值用 input，否则退回整块文本。
 */
async function readPanelValue(page: Page, label: string): Promise<string> {
  return page.evaluate((text) => {
    const labels = Array.from(document.querySelectorAll('.el-form-item__label'))
    const target = labels.find((el) => (el.textContent || '').trim() === text)
    if (!target) return '__NOT_FOUND__'
    const item = target.closest('.el-form-item') as HTMLElement | null
    item?.scrollIntoView({ block: 'center' })
    const input = item?.querySelector('input') as HTMLInputElement | null
    if (input && input.value) return input.value
    const content = item?.querySelector('.el-form-item__content') as HTMLElement | null
    return content?.innerText?.trim() || ''
  }, label)
}

/** 属性面板上按标签精确定位一项。只比标签文本，避免 hasText 命中祖先容器 */
const panelItem = (page: Page, label: string) =>
  page
    .locator('.el-form-item')
    .filter({
      has: page.locator('.el-form-item__label', {
        hasText: new RegExp(`^\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`)
      })
    })
    .first()

/** 属性面板上所有项的标题 */
async function panelLabels(page: Page): Promise<string[]> {
  return page
    .locator('.el-form-item__label')
    .allTextContents()
    .then((list) => list.map((t) => t.trim()))
}

/** 读「格式校验」那一项的内容文本 */
async function readValidateItem(page: Page): Promise<string> {
  return page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll('.el-form-item__label'))
    const target = labels.find((el) => (el.textContent || '').trim() === '格式校验')
    if (!target) return '__NOT_FOUND__'
    const item = target.closest('.el-form-item') as HTMLElement | null
    item?.scrollIntoView({ block: 'center' })
    return (item?.querySelector('.el-form-item__content') as HTMLElement)?.innerText || ''
  })
}

test.describe('属性面板 · 格式校验', () => {
  test('「格式校验」与「出现场景」必须同时出现，且已配规则要回显', async ({ page }) => {
    const token = await login(page)
    const designId = await findDesignId(page, token, FORM_CODE)
    await gotoFormDesignStep(page, designId, '邮箱')

    // 选中邮箱字段
    await selectField(page, '邮箱')

    const labels = await panelLabels(page)

    // bug 一：两项都要在。少任何一项都说明注册又被覆盖了
    expect(labels, '「格式校验」不见了 —— 多半是同一控件被注册了两次，后一次覆盖前一次').toContain(
      '格式校验'
    )
    expect(labels, '「出现场景」不见了 —— 同上，只是这次被覆盖的是 useInputEnhanceRule').toContain(
      '出现场景'
    )

    // bug 二：库里存的 EMAIL 规则要回显出来
    const content = await readValidateItem(page)
    expect(content).not.toBe('__NOT_FOUND__')
    expect(
      content,
      '面板显示「未配置」，但库里这个字段是配了 EMAIL 的 —— ' +
        '多半是属性项的 field 又写成了占位名，读写落到了属性项自己身上'
    ).not.toContain('未配置格式校验')
  })

  test('在面板里改动格式校验，能写回控件的 props', async ({ page }) => {
    const token = await login(page)
    const designId = await findDesignId(page, token, FORM_CODE)
    await gotoFormDesignStep(page, designId, '邮箱')

    // 选一个原本没配格式校验的字段：样本名称
    await selectField(page, '样本名称')

    const before = await readValidateItem(page)
    expect(before).toContain('未配置格式校验')

    // 点「添加规则」，面板应立刻出现一条规则行
    await page.getByRole('button', { name: /添加规则/ }).first().click()
    await page.waitForTimeout(800)

    const after = await readValidateItem(page)
    expect(
      after,
      '点了「添加规则」面板却没变化 —— 说明写回没有落到控件的 props 上'
    ).not.toContain('未配置格式校验')
  })
})

test.describe('属性面板 · 数据脱敏', () => {
  /** 校验示例 4。五个字段分别配了 NAME / MOBILE / EMAIL / ID_CARD / BANK_CARD */
  const MASK_FORM_CODE = 'test_demo_verify_supplier'
  /** 配了 MOBILE 的字段，标题里带全角括号 */
  const MOBILE_FIELD = '联系手机（MOBILE）'

  /** 在「数据脱敏」下拉里选一个策略 */
  async function pickMask(page: Page, optionText: string) {
    await panelItem(page, '数据脱敏').locator('.el-select').first().click()
    await page.waitForTimeout(400)
    await page
      .locator('.el-select-dropdown:visible .el-select-dropdown__item')
      .filter({ hasText: new RegExp(`^\\s*${optionText}`) })
      .first()
      .click()
    await page.waitForTimeout(800)
  }

  test('脱敏项要和格式校验、出现场景同时出现，且已配策略要回显', async ({ page }) => {
    const token = await login(page)
    const designId = await findDesignId(page, token, MASK_FORM_CODE)
    await gotoFormDesignStep(page, designId, '供应商名称')

    await selectField(page, MOBILE_FIELD)

    const labels = await panelLabels(page)
    // 三个模块都往 input 上追加属性，缺谁都说明注册表的合并又失效了
    expect(labels, '「数据脱敏」不见了 —— 多半是又有人直接调了 setComponentRuleConfig').toContain(
      '数据脱敏'
    )
    expect(labels, '「格式校验」不见了 —— 脱敏项把它顶掉了').toContain('格式校验')
    expect(labels, '「出现场景」不见了 —— 脱敏项把它顶掉了').toContain('出现场景')

    // 这个字段库里配的是 MOBILE，面板要读得出来。
    // 读不出来的典型原因还是 field 写错，值落在了属性项自己身上
    const value = await readPanelValue(page, '数据脱敏')
    expect(value).not.toBe('__NOT_FOUND__')
    expect(
      value,
      '库里这个字段的 props.maskRule 是 MOBILE，面板却没回显 —— 检查属性项的 field 是不是真的是 maskRule'
    ).toContain('手机号')
  })

  test('选「自定义」才展开保留位数，选内置策略只展开补位符', async ({ page }) => {
    const token = await login(page)
    const designId = await findDesignId(page, token, MASK_FORM_CODE)
    await gotoFormDesignStep(page, designId, '供应商名称')

    // 开户行原本没配脱敏，用它验证从零配起的路径
    await selectField(page, '开户行')
    const initial = await readPanelValue(page, '数据脱敏')
    expect(
      initial,
      '这个字段本来没配脱敏，面板上却显示了某个策略'
    ).not.toMatch(/手机号|身份证|银行卡|姓名|邮箱|自定义/)

    // 没选策略时，三个附属项一个都不该在 —— 否则空面板上会凭空多出三行
    let labels = await panelLabels(page)
    expect(labels).not.toContain('补位符')
    expect(labels).not.toContain('保留前几位')

    // 选「自定义」：补位符与前后保留位数一起出现
    await pickMask(page, '自定义')
    labels = await panelLabels(page)
    expect(labels, '选了自定义却没展开补位符').toContain('补位符')
    expect(labels, '选了自定义却没展开保留位数 —— control 的分支没生效').toContain('保留前几位')
    expect(labels).toContain('保留后几位')

    // 改成内置策略「姓名」：保留位数要收起来。
    // 内置策略的保留位数由后端枚举定死，留在界面上会让人以为改了有用
    await pickMask(page, '姓名')
    labels = await panelLabels(page)
    expect(labels, '内置策略下补位符仍然该可配').toContain('补位符')
    expect(labels, '换成内置策略后「保留前几位」没收起来').not.toContain('保留前几位')
  })
})
