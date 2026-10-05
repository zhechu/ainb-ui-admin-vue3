// 一次性工具：P2-1 的「expect_hint 满足率 / 拒答率」双分母台账。
//
// 🔴 它**不判** expect_hint 到底满不满足。报告里那一栏自己写着「人工评审用，本用例不机械断言」——
//   拿字符串去比对一份自然语言验收标准，只会产出一个看起来很硬、其实没人信的百分比。
//   这个脚本干的是**分账**：把每条实测正文分到「实答 / 拒答 / 没正文 / 厂商没答」四格，
//   再按「语料覆盖 vs 覆盖缺口」劈成两半，好让人工评审时知道哪一堆值得逐字读、哪一堆读了也白读。
//
// 🔴 为什么要双分母（这是 intent-agreement.mjs 明确拒做、留给这里做的那一半）
//   拒答的真因是「手册里没有覆盖这个问题」，也就是**知识库缺章**，不是提示词模板写得差。
//   45 条用例里有 16 条本身就落在已知覆盖缺口上（coverage-gap-cases.json 的 gapCaseIds）。
//   单分母（全部 42 条）算出来的拒答率，把这 16 条的「资料没给」和其余 26 条的「模型不行」
//   混成一个数 —— 数字涨了也不知道该补手册还是该改模板。
//   分母 A（全部实测到正文）看总体趋势，分母 B（只在语料覆盖的那一堆里）才是**模板**的成绩。
//   两个都印，谁也不替谁。
//
// 🔴 拒答判据不在这里重写一份。三个常量与占位文案都从 spec 源码里**正则抠出来**：
//   阈值改了而这里没跟着改，会静默算出一份和报告对不上的表 —— 那种错没人发现。
//   抠不到就直接 throw，别退化成一个猜的默认值。
//   外加一道对账：本脚本重算的「拒答 / 有效覆盖」必须与同一份报告 `## 汇总` 里印的数一致，
//   不一致就 throw。这样「判据被抠错了」与「块解析漏了条」都会当场露馅。
//
// 用法：node _evidence/hint-satisfaction.mjs <report.md> [more-report.md ...]
//   报告由 prompt-template-chat-matrix.spec.ts 逐条落盘在 _evidence/ 下。
//   BUILD 那 3 条（T2 的全集）会被跳过并印出来：它们走草稿卡、压根不产生问答正文，
//   混进来只会把分母做大。
import { readFileSync } from 'node:fs'

const SPEC = new URL('../tests/e2e/prompt-template-chat-matrix.spec.ts', import.meta.url)
const GAPS = new URL('./coverage-gap-cases.json', import.meta.url)
const reportPaths = process.argv.slice(2)
if (reportPaths.length === 0) {
  console.error('用法：node _evidence/hint-satisfaction.mjs <report.md> [more-report.md ...]')
  process.exit(2)
}

// ==================== 从 spec 源码抠判据（单一来源，抠不到就 throw） ====================

const specSrc = readFileSync(SPEC, 'utf8')

function specStr(name) {
  const m = specSrc.match(new RegExp(`^const ${name} = '([^']+)'\\s*$`, 'm'))
  if (!m) throw new Error(`没能从 spec 里抠出字符串常量 ${name} —— 它改名/换行/换成双引号了？别在这里填默认值，去改正则`)
  return m[1]
}

function specNum(name) {
  const m = specSrc.match(new RegExp(`^const ${name} = (\\d+)\\s*$`, 'm'))
  if (!m) throw new Error(`没能从 spec 里抠出数字常量 ${name}`)
  return Number(m[1])
}

/** 抠 `new Set([...])` 里的整数。同样不许有默认值：抠不到就 throw */
function specIdSet(name) {
  const m = specSrc.match(new RegExp(`^const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\)\\s*$`, 'm'))
  if (!m) throw new Error(`没能从 spec 里抠出 id 集合 ${name} —— 它改成数组/换写法了？改正则，别在这里硬编一份名单`)
  const ids = [...m[1].matchAll(/\d+/g)].map((x) => Number(x[0]))
  if (ids.length === 0) throw new Error(`${name} 抠出来是空的 —— 正则匹配到了壳、没匹配到内容`)
  return new Set(ids)
}

const REFUSAL_MARK = specStr('REFUSAL_MARK')
/**
 * 同一句拒答的另一种写法（「手册**中**没有覆盖这个问题」，2026-10-05 起因 run14 的 id=65 加进 spec）。
 * 🔴 spec 加了它，这里必须跟着加：两边分类一旦不一致，上面那道对账闸**查不出来** ——
 *    它只比「我算的 vs 报告印的」，不比「我算的 vs spec 算的」。
 */
const REFUSAL_MARK_ALT = specStr('REFUSAL_MARK_ALT')
const REFUSAL_MARK_MAX_OFFSET = specNum('REFUSAL_MARK_MAX_OFFSET')
const REFUSAL_MAX_LENGTH = specNum('REFUSAL_MAX_LENGTH')
const MARK_PROVIDER_FAILURE = specStr('MARK_PROVIDER_FAILURE')
/**
 * ⑧ 棘轮的白名单。这里要它，是为了把「语料覆盖区却拒答」再劈成**已知 / 新增**两半 ——
 * 不劈的话，id=17 这种早在名单里、真因也早记过的条，会被当成新发现印成 🔴，
 * 读的人去查一遍才发现是旧的。名单外的那一半才是真信号（与 spec 的 newRefusals 同义）。
 */
const KNOWN_REFUSED_IDS = specIdSet('KNOWN_REFUSED_IDS')

// 占位文案也从 spec 抠：它是「这条压根没走到问答气泡」的唯一判据，
// 手抄一份的话，spec 改个字这里就静默把占位符当成真答案去算长度
const NO_TEXT = (() => {
  const m = specSrc.match(/\|\| '(_（正文没取到[^']*)'/)
  if (!m) throw new Error('没能从 spec 里抠出「正文没取到」的占位文案')
  return m[1]
})()

/** 与 spec 的 isRefusal 逐字同构（那边是 TS，这边是 mjs，没法 import，只能同构 + 上面那道对账兜底） */
function isRefusal(text) {
  const body = (text ?? '').trim()
  if (body.length === 0 || body.length > REFUSAL_MAX_LENGTH) return false
  // 两种写法共用同一对阈值，比的是**最早**出现的那个位置（同 spec 的 matchedRefusalMark）
  const at = Math.min(
    ...[REFUSAL_MARK, REFUSAL_MARK_ALT].map((mark) => {
      const i = body.indexOf(mark)
      return i < 0 ? Number.MAX_SAFE_INTEGER : i
    })
  )
  return at <= REFUSAL_MARK_MAX_OFFSET
}

// ==================== 报告块解析 ====================

const gapsJson = JSON.parse(readFileSync(GAPS, 'utf8'))
const gapIds = new Set(gapsJson.gapCaseIds)
const buildIds = new Set(gapsJson.totals['BUILD 的 id'])

/** 从 `**提问**` / `**验收标准…** / `**模型正文**` 三个小标题之间切段 */
function section(block, fromTitle, toTitle) {
  const start = block.indexOf(fromTitle)
  if (start < 0) return null
  const bodyStart = start + fromTitle.length
  const end = toTitle ? block.indexOf(toTitle, bodyStart) : -1
  return (end < 0 ? block.slice(bodyStart) : block.slice(bodyStart, end)).trim()
}

const HINT_TITLE = '**验收标准（expect_hint · 人工评审用，本用例不机械断言）**'
const cases = new Map() // id -> record，后一份报告覆盖前一份（同一条被跑两次时以最新为准）
const summaryBlocks = []

for (const p of reportPaths) {
  const md = readFileSync(p, 'utf8')
  for (const block of md.split(/\n---\n/)) {
    const h = block.match(/^## (\d+)\/(\d+) · id=(\d+) · (.*)$/m)
    if (!h) {
      if (/^## 汇总$/m.test(block)) summaryBlocks.push({ path: p, block })
      continue
    }
    const id = Number(h[3])
    const [, , total, title] = h
    if (buildIds.has(id)) continue // 见文件头：BUILD 走草稿卡，没有问答正文

    const head = block.slice(0, block.indexOf('**提问**'))
    const detail = head.split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2))
    const text = section(block, '**模型正文**', null)
    const hint = section(block, HINT_TITLE, '**模型正文**')
    const question = section(block, '**提问**', HINT_TITLE)

    // 🔴 分类顺序照抄 spec 的分流顺序：厂商没答 > 没正文 > 拒答 > 实答。
    //    顺序错了后果不一样：把「厂商没答」当「没正文」，本轮作废的真因就看不见了；
    //    把拒答排在实答之后，一条 138 字的拒答会被算进模板的成绩里。
    const providerFailed = detail.some((d) => d.includes(MARK_PROVIDER_FAILURE))
    const noText = text == null || text.length === 0 || text === NO_TEXT
    const failed = detail.some((d) => d.startsWith('❌'))
    const cls = providerFailed
      ? 'provider_failure'
      : noText
        ? 'no_text'
        : isRefusal(text)
          ? 'refusal'
          : 'answered'

    cases.set(id, {
      id,
      title: h[4],
      seq: Number(h[1]),
      total: Number(total),
      gap: gapIds.has(id),
      cls,
      failed,
      len: text?.length ?? 0,
      hintLen: hint?.length ?? 0,
      question: question ?? '',
      hint: hint ?? '',
      text: text ?? '',
      detail,
      from: p
    })
  }
}

// ==================== 对账：重算的数必须等于报告 `## 汇总` 里印的数 ====================

if (summaryBlocks.length === 0) {
  throw new Error(
    `${reportPaths.join(', ')} 里没有「## 汇总」块 —— 要么这一轮没跑完（汇总是最后才写的），` +
      `要么给错了文件。没有汇总就没法对账，宁可不算，也不印一份对不上号的表。`
  )
}
for (const { path, block } of summaryBlocks) {
  const refusal = block.match(/^- 知识库拒答：(\d+) 条$/m)
  const answered = block.match(/^- \*\*有效覆盖：(\d+)\/(\d+) 条\*\*/m)
  // 🔴 汇总块在、这两行却不在 = spec 改了汇总的措辞。此时**必须 throw**：
  //    悄悄跳过对账的话，判据被抠错、或块解析漏了条，都不会再有人发现 —— 表照印，数照错。
  if (!refusal || !answered) {
    throw new Error(
      `${path} 的「## 汇总」块里找不到${!refusal ? '「知识库拒答：N 条」' : ''}${!refusal && !answered ? ' 和 ' : ''}${!answered ? '「有效覆盖：N/M 条」' : ''}那一行 —— spec 改了措辞？改正则，别把对账关掉`
    )
  }
  const mine = [...cases.values()].filter((c) => c.from === path)
  {
    const theirs = Number(refusal[1])
    // 汇总数的是**这一轮跑过的全部**（含 BUILD 那几条被本脚本跳过的），故只允许「它的 ≥ 我的」
    // 🔴 已知的**唯一**合法触发场景：喂进来的报告是 2026-10-05 口径变更**之前**跑的 ——
    //    那时 spec 只认「手册**里**没有覆盖这个问题」，而 run14 的 id=65 逐字是「手册**中**没有覆盖这个问题。」，
    //    报告因此少算一条拒答（印 21、真值 22），本脚本按新口径重算就会**多于**它。
    //    这种报告的汇总数天生偏小，处置是**重跑 T1 拿新口径报告**，不是放宽这道闸：
    //    判据只会越认越宽（同一条正文只可能从「非拒答」翻成「拒答」，不会反向），
    //    所以在**同期**报告上，「我的 > 它的」永远意味着判据或解析至少错了一处。
    const myRefusals = mine.filter((c) => c.cls === 'refusal').length
    if (myRefusals > theirs) {
      throw new Error(`拒答数对不上：${path} 汇总印 ${theirs} 条，本脚本重算 ${myRefusals} 条（还更多）—— 判据或解析至少错了一处`)
    }
    console.log(`对账 · ${path}\n  汇总印「知识库拒答 ${theirs} 条」，本脚本重算 ${myRefusals} 条（差额 = 被跳过的 BUILD 条 + 没落盘正文的条）`)
  }
  {
    const theirs = Number(answered[1])
    const mineAnswered = mine.filter((c) => c.cls === 'answered').length
    if (mineAnswered > theirs) {
      throw new Error(`有效覆盖对不上：${path} 汇总印 ${theirs} 条，本脚本重算 ${mineAnswered} 条（还更多）—— 同上`)
    }
    console.log(`  汇总印「有效覆盖 ${theirs}/${answered[2]} 条」，本脚本重算 ${mineAnswered} 条\n`)
  }
}

// ==================== 分账 ====================

const all = [...cases.values()].sort((a, b) => a.id - b.id)
const CLS = ['answered', 'refusal', 'no_text', 'provider_failure']
const LABEL = {
  answered: '实答（有正文、不是拒答）',
  refusal: '拒答（手册没覆盖）',
  no_text: '没正文（没走到问答气泡，或红在 ①~⑥）',
  provider_failure: '厂商没答（本轮作废的那一类）'
}
const cell = (rows, cls) => rows.filter((c) => c.cls === cls)
const fmt = (rows) => rows.map((c) => c.id).join(', ') || '（无）'

const nonGap = all.filter((c) => !c.gap)
const gap = all.filter((c) => c.gap)

console.log(`分母台账（P2-1 · 双分母）`)
console.log(`  库内用例 ${gapsJson.totals['库内用例']} 条；覆盖缺口 ${gapIds.size} 条；语料覆盖 ${gapsJson.totals['语料覆盖']} 条`)
console.log(`  本次解析到正文块 ${all.length} 条（已剔 BUILD ${[...buildIds].join(',')}）`)
console.log(`  其中：语料覆盖 ${nonGap.length} 条 / 覆盖缺口 ${gap.length} 条\n`)

console.log('┌─ 四格分账（每格印 id，分母变了要能看出是哪些条变了）')
for (const cls of CLS) {
  console.log(`│ ${LABEL[cls]}`)
  console.log(`│   语料覆盖 ${String(cell(nonGap, cls).length).padStart(2)} 条：${fmt(cell(nonGap, cls))}`)
  console.log(`│   覆盖缺口 ${String(cell(gap, cls).length).padStart(2)} 条：${fmt(cell(gap, cls))}`)
}
console.log('└─\n')

// 🔴 分母只算「实测到正文」的条：实答 + 拒答。
//    没正文 / 厂商没答 一律排除 —— 它们是「没测到」，不是「测到了且没拒答」，
//    算进去会把拒答率稀释成一个好看但没意义的数（spec 里 ⑧ 棘轮那条「分母缩水」的告警就是同一个坑）
const denA = [...cell(all, 'answered'), ...cell(all, 'refusal')]
const denB = [...cell(nonGap, 'answered'), ...cell(nonGap, 'refusal')]
// 🔴 分母为 0 时**绝不**印百分比：`0/0 = 0.0%` 会被读成「一条都没拒答，模板挺好」，
//    而真相是「一条都没测到」。子集跑（TPL_MATRIX_ONLY）就会这样 —— 挑的那几条全在覆盖缺口里，
//    语料覆盖区一条没跑，分母 B 就是 0。这正是 spec 里 ⑧ 棘轮「分母缩水就是空过」的同一个坑。
const pct = (n, d) =>
  d === 0 ? `${n}/${d} = 🔴 无可比条（不是 0%，是**没测到**，别当结论用）` : `${n}/${d} = ${((100 * n) / d).toFixed(1)}%`

console.log('拒答率（两个分母一起看，只报一个就是在藏真因）')
console.log(`  分母 A 全部实测到正文 ${denA.length} 条：${pct(cell(all, 'refusal').length, denA.length)}`)
console.log(`  分母 B 仅语料覆盖      ${denB.length} 条：${pct(cell(nonGap, 'refusal').length, denB.length)}　← 这一个才是**模板**的成绩`)
const gapRefusals = cell(gap, 'refusal')
const nonGapRefusals = cell(nonGap, 'refusal')
const known = (rows) => rows.filter((c) => KNOWN_REFUSED_IDS.has(c.id))
const fresh = (rows) => rows.filter((c) => !KNOWN_REFUSED_IDS.has(c.id))
console.log(
  `  差额解读：拒答 ${cell(all, 'refusal').length} 条里，落在已知覆盖缺口的 ${gapRefusals.length} 条（真因是手册少一章，补知识库），` +
    `落在语料覆盖区的 ${nonGapRefusals.length} 条（🔴 手册里**有**资料却说没覆盖 —— 该查检索/查模板，别当成「少一章」放过）`
)
// 🔴 两半都再按棘轮白名单劈一次「已知 / 名单外新增」。不劈的话 id=17 这种早就在名单里、
//    真因也早记过的条会被印成新发现，读的人白查一遍；而真正要动手的是「名单外」那一小堆。
for (const [label, rows] of [
  ['覆盖缺口区', gapRefusals],
  ['语料覆盖区', nonGapRefusals]
]) {
  if (rows.length === 0) continue
  // 🔴 空集别再套一层括号：`fmt` 已经印「（无）」，外面再包会成「0（（无））」
  const ids = (rows) => (rows.length ? `（${fmt(rows)}）` : '')
  console.log(`    ${label}拒答 ${rows.length} 条：白名单内 ${known(rows).length}${ids(known(rows))}` +
    `，🔴 名单外新增 ${fresh(rows).length}${ids(fresh(rows))}`)
  for (const c of fresh(rows)) console.log(`      - 新增 id=${c.id} ${c.title}（${c.len} 字）`)
}
console.log('')

console.log('expect_hint 满足率：🔴 **本脚本不出这个数**')
console.log(`  有正文可评审的 ${denA.length} 条（验收标准合计 ${denA.reduce((s, c) => s + c.hintLen, 0)} 字），`)
console.log(`  其中「正文比验收标准还短」的 ${denA.filter((c) => c.len < c.hintLen).length} 条 —— 这一条 spec 已经机械断言过了（⑦），这里只复核不重判。`)
console.log(`  满不满足要人读：逐条的**验收标准**与**模型正文**都在报告里，按上面「语料覆盖 + 实答」那一格挑着读。`)
console.log(`  拒答的那些条 expect_hint **根本没被检验**，评审时不要当成「答得不好」。`)
console.log('')

const failedAnswered = denA.filter((c) => c.failed)
console.log(`机械断言红但仍有正文（要单独看，红的可能是 ⑤⑥⑦ 而不是分型）：${failedAnswered.length} 条 ${fmt(failedAnswered)}`)
const dropped = all.filter((c) => c.cls === 'no_text' || c.cls === 'provider_failure')
console.log(`没测到（不进任何分母）：${dropped.length} 条 ${fmt(dropped)}`)
