/**
 * 变异探针跑手：把 helper 改坏一处 → 跑构造样本 → 记下哪几条红了 → 还原
 *
 * 判据（与 conversation-ownership.spec.ts 头注释里那五条同一个口径）：
 * 探针**必须**让它指名的那条用例红在指名的那处断言上；只红不退、或红在别的地方，都算探针无效。
 */
const { execSync } = require('node:child_process')
const fs = require('node:fs')

const TARGET = 'tests/e2e/helpers/workflow-def-cleanup.ts'
const PRISTINE = fs.readFileSync(TARGET, 'utf8')

const PROBES = [
  {
    name: 'P1 恢复「不在基线里的 DRAFT 全删」',
    expectRed: '①',
    from: `    } else if (d.source === 'AUTO') {
      orphans.push(d)
      deleteTargets.push(d)
    } else {
      foreignDrafts.push(d)
    }`,
    to: `    } else {
      deleteTargets.push(d)
    }`
  },
  {
    name: 'P2 恢复「只删 DRAFT、别的不管」',
    expectRed: '②',
    from: `    if (d.status !== 'DRAFT') {
      selfPublished.push(d)
    } else if (claimed.has(d.id)) {`,
    to: `    if (d.status !== 'DRAFT') {
      // probe: 非草稿的一律放过
    } else if (claimed.has(d.id)) {`
  },
  {
    name: 'P3 leftover 换回**条数差**口径',
    expectRed: '⑦',
    from: `    leftoverOwned = deleteTargets.map((d) => d.id).filter((id) => !deletedSet.has(id) && stillThere.has(id))`,
    to: `    void stillThere
    leftoverOwned = new Array(Math.max(0, after.length - baseline.size)).fill(-1)`
  },
  {
    name: 'P4 让 call 把失败**抛出去**（恢复 expectOk 口径）',
    expectRed: '⑥',
    // 🔴 锚点必须把整个 try/catch 一起换掉。第一版只把 `failures.push` 那三行改成 `throw`，
    //    而那个 throw **就在同一个 try 里面** ⟹ 被下面的 catch 原样吞掉、记成一条 failures，
    //    行为一模一样 ⟹ 探针报告「7 passed」，看着像判据很结实，其实是**探针自己没打进去**。
    //    这与被测代码的毛病同形：一个恒绿的检查比没有检查更坏。
    from: `    try {
      const body = await run()
      if (body?.code !== 0) {
        failures.push(\`\${what}失败（code=\${body?.code}）：\${body?.msg ?? ''}\`)
        return null
      }
      return body
    } catch (e: any) {
      failures.push(\`\${what}抛异常：\${e?.message ?? String(e)}\`)
      return null
    }`,
    to: `    const body = await run()
    if (body?.code !== 0) {
      throw new Error(\`\${what}失败（code=\${body?.code}）：\${body?.msg ?? ''}\`)
    }
    return body`
  },
  {
    name: 'P5 去掉取消之后的那次回读',
    expectRed: '⑤',
    from: `    for (const row of await listExecutions(d.id)) {
      leftoverExecutions.push({ defId: d.id, execId: row.id, status: row.status })
    }`,
    to: `    // probe: 不回读了，请求发出去就算清过了`
  }
]

let bad = 0
for (const p of PROBES) {
  if (!PRISTINE.includes(p.from)) {
    console.log(`❌ ${p.name}：锚点没匹配上，探针**没打进去**（等于没验）`)
    bad++
    continue
  }
  fs.writeFileSync(TARGET, PRISTINE.replace(p.from, p.to), 'utf8')
  let out = ''
  try {
    // 🔴 必须 shell:true —— Windows 上 npx 是个 .cmd 壳，execFileSync('npx', …) 直接 ENOENT，
    //    而 catch 里拿到的 stdout/stderr 是空的 ⟹ 五个探针全部报「没有红」，看着像判据很结实，
    //    其实是**一个都没打进去**。第一版就是这么假绿的
    out = execSync('npx playwright test tests/e2e/workflow-def-cleanup.spec.ts --reporter=list', {
      encoding: 'utf8',
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
  } catch (e) {
    out = (e.stdout ?? '') + (e.stderr ?? '')
  }
  fs.writeFileSync(TARGET, PRISTINE, 'utf8')

  const reds = [...out.matchAll(/^\s+(?:\S+)?\s*(\d+)\s+tests\\e2e\\workflow-def-cleanup\.spec\.ts.*$/gm)]
  const failedLines = out
    .split(/\r?\n/)
    .filter((l) => /^\s+\d+\)\s/.test(l) || /failed|passed/.test(l))
    .join('\n')
  const hit = out.split(/\r?\n/).some((l) => /^\s+\d+\)\s/.test(l) && l.includes(p.expectRed))
  console.log(`\n===== ${p.name} =====`)
  console.log(failedLines.trim() || '(没有汇总行)')
  console.log(hit ? `✅ 探针有效：${p.expectRed} 红了` : `❌ 探针无效：${p.expectRed} **没有**红`)
  if (!hit) bad++
  void reds
}

const restored = fs.readFileSync(TARGET, 'utf8') === PRISTINE
console.log(`\n还原校验：${restored ? '✅ 逐字节还原' : '❌ 没还原干净'}`)
process.exit(bad || !restored ? 1 : 0)
