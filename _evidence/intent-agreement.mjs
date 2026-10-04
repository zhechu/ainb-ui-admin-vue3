// 一次性工具：A1/S7 的分型验收表。
// 把 T1（CHAT + 意图不限）与 T2（BUILD）两份报告里的**实测意图**，
// 与库里 agent_prompt_template_case.expect_intent 的**人工标定期望**逐条对齐，
// 产出方案 §9 要的那张「45 条一致性表」。
//
// 用法：node _evidence/intent-agreement.mjs <expect.tsv> <t1-report.md> <t2-report.md>
//   expect.tsv 每行： id<TAB>expect_intent(可为 NULL)<TAB>title
//
// 🔴 分母口径（P3-3 裁定，别再自己推一遍 —— 上一轮我就把 42 当成了「库内用例总数」）
//   库内用例            45 条（租户 1，未删）
//   非 BUILD            42 条 = T1 的全集（prompt-template-chat-matrix.spec.ts:808 那条用例名里的 42 就是它）
//   BUILD                3 条 = T2 的全集（id 55 / 57 / 59）
//   expect_intent 为 NULL 5 条（id 9 / 11 / 13 / 27 / 43）
//   ⟹ 一致率分母 = 「**有期望值 且 该轮实测到意图**」的条数，上限 45 − 5 = 40。
//      方案 §6 P3-3 写的「42 / 37」是**在 T1 那 42 条里**算的：42 − 5 = 37。两个数都对，
//      但它们不是同一个全集 —— 混着报就会看起来「分母在飘」。所以这里一次把四个数全印出来。
//
// 🔴 那 5 条 NULL **不补**。产品码把 NULL 定义成设计状态而不是漏填
//   （ErrorCodeConstants.AGENT_PROMPT_TEMPLATE_CASE_INTENT_INVALID 的 javadoc：
//    「留空的语义是『这条用例正处在问怎么做 / 让你去做的边界上，两种分型都算对』，不是『忘了填』」）。
//   为了把百分比的分母做大而改掉夹具的**语义**，与 §2-8「改夹具不改产品码」是同一条红线的反面。
//
// 🔴 覆盖缺口（_evidence/coverage-gap-cases.json，16 条）在这里**刻意不剔**。
//   分型不查手册 —— 分类器只看用户那句话要问答还是要变更，缺哪章资料都不影响它。
//   需要双分母的是 P2-1 的 expect_hint 满足率 / 拒答率，那边才分不清「模型不行」和「没给资料」。
import { readFileSync } from 'node:fs'

const [, , tsvPath, t1Path, t2Path] = process.argv

function parseReport(file, fallback) {
  const md = readFileSync(file, 'utf8')
  const out = new Map()
  for (const block of md.split(/\n---\n/)) {
    const h = block.match(/^## (\d+)\/\d+ · id=(\d+) · (.*)$/m)
    if (!h) continue
    const id = Number(h[2])
    // T1 逐条印「- 意图：CHAT/BUILD」；T2 不印这一行，但出了草稿卡就等于判成了 BUILD
    const m = block.match(/^- 意图：(CHAT|BUILD)/m)
    out.set(id, m ? m[1] : fallback)
  }
  return out
}

const observed = new Map()
for (const [id, v] of parseReport(t1Path, null)) observed.set(id, v ?? '未记录')
for (const [id, v] of parseReport(t2Path, 'BUILD')) if (!observed.has(id)) observed.set(id, v)

const expect = new Map()
for (const line of readFileSync(tsvPath, 'utf8').split(/\r?\n/)) {
  if (!line.trim()) continue
  const [id, intent, title] = line.split('\t')
  expect.set(Number(id), { intent: intent === 'NULL' ? null : intent, title })
}

const rows = [...expect.keys()].sort((a, b) => a - b)
const buckets = { agree: [], disagree: [], nullExpect: [], unobserved: [] }
for (const id of rows) {
  const exp = expect.get(id).intent
  const obs = observed.get(id)
  if (obs === undefined || obs === '未记录' || obs === null) buckets.unobserved.push(id)
  else if (exp === null) buckets.nullExpect.push({ id, obs })
  else if (exp === obs) buckets.agree.push(id)
  else buckets.disagree.push({ id, exp, obs })
}

const f = (a) => a.join(', ') || '（无）'
// 🔴 报告里有逐条块 ≠ 实测到了意图：红在别处的那几条压根没走到分型那一步，
//    把它们算进「实测到」会让分母虚高（上一版就印了「实测到 45 条」，其实只有 42）
const realObserved = [...observed.values()].filter((v) => v === 'CHAT' || v === 'BUILD').length
const nullTotal = rows.filter((id) => expect.get(id).intent === null).length
const buildTotal = rows.filter((id) => expect.get(id).intent === 'BUILD').length
console.log('分母台账（四个数一起看，别单看最后一个）')
console.log(`  ① 库内用例            ${rows.length} 条`)
console.log(`  ② BUILD ${buildTotal} 条 = T2 全集；非 BUILD ${rows.length - buildTotal} 条 = T1 全集（方案里那个「42」就是它）`)
console.log(`     T1 里带期望值的 ${rows.length - buildTotal - nullTotal} 条 = 方案里那个「37」；NULL ${nullTotal} 条（id ${f(rows.filter((id) => expect.get(id).intent === null))}）`)
console.log(`  ③ 本轮实测到意图      ${realObserved} 条`)
console.log(`  ④ 一致率分母          ${buckets.agree.length + buckets.disagree.length} 条 = 「有期望值 且 实测到」\n`)
console.log(`✅ 期望与实测一致：${buckets.agree.length} 条`)
console.log(`   ${f(buckets.agree)}`)
console.log(`\n🔴 期望与实测**不一致**：${buckets.disagree.length} 条`)
for (const d of buckets.disagree) {
  console.log(`   id=${String(d.id).padStart(2)}  期望 ${d.exp} → 实测 ${d.obs}   ${expect.get(d.id).title}`)
}
console.log(`\n⚪ expect_intent 为 NULL（P3-3 已裁定**不补**：产品码把留空定义成「两种分型都算对」的边界用例，不是漏填）：${buckets.nullExpect.length} 条`)
for (const n of buckets.nullExpect) {
  console.log(`   id=${String(n.id).padStart(2)}  实测 ${n.obs}   ${expect.get(n.id).title}`)
}
console.log(`\n⚠️ 本轮没实测到（那一轮红在别处、没走到分型那一步）：${buckets.unobserved.length} 条`)
console.log(`   ${f(buckets.unobserved)}`)

const comparable = buckets.agree.length + buckets.disagree.length
console.log(
  `\n分型一致率：${buckets.agree.length}/${comparable}` +
    ` = ${(100 * buckets.agree.length / Math.max(comparable, 1)).toFixed(1)}%`
)
console.log(
  `  分母 = ④「有期望值 且 本轮实测到意图」。NULL（${buckets.nullExpect.length} 条）与未实测（${buckets.unobserved.length} 条）都排除，` +
    `且两者的 id 已在上面逐条列出 —— 分母变了要能看出是哪些条变了，否则两次 run 不可比。`
)
console.log(`  🔴 这里**不**按覆盖缺口做双分母：分型不查手册。要双分母的是 P2-1 的 expect_hint 满足率，见 coverage-gap-cases.json。`)
