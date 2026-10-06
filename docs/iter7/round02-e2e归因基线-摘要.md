# 迭代七 · 第 02 轮 —— e2e 归因基线 · 摘要（F2 + F4 复跑）

> **这份文件为什么在仓里**：分册 §5 判据① 要求「报告文件**在仓外**存在，且**摘要 + sha256 清单已提交进 git**，`git log` 里查得到」，
> 红线第 35 条要求「①入 git（**哪怕只是校验和清单 + 摘录**）**或** ②放在工作区之外的固定路径」—— 本轮**两个都做**。
> 🔴 **报告本体与 48 份原始日志不在仓里**（它们是每轮重跑的产物，仓里只留摘录 + 校验和），落点见下。

| 项 | 值 |
|---|---|
| 执行权威（分册） | `C:/code/yudao/流程编排模块重构方案-迭代七-02-e2e归因基线.md` |
| 执行日期 / 开窗 | 2026-10-06　18:16 ~ 18:40（e2e 实跑窗口 **18:21:05 ~ 18:34:22**，墙钟 **13m17s**） |
| 报告本体（**仓外**） | `C:/code/yudao_backups/iter02-e2e-attribution/REPORT.md`（485 行 / 41763 B） |
| `REPORT.md` sha256 | `842a8d8fb28c7b234c6d222a81a0cdcfa6b26effb7c3a94673e30e6f899f9fb0` |
| 原始日志（**仓外**，46 份） | `C:/code/yudao_backups/iter02-e2e-attribution/logs/` |
| 跑批器（**仓外**，2 份） | 同目录 `run-one.sh` · `drive-14.sh` |
| sha256 清单 | 同目录 `MANIFEST.sha256`，**48 行**（= 46 日志 + 2 跑批器）；本仓副本 = `round02-e2e归因基线-MANIFEST.sha256` |
| `MANIFEST.sha256` sha256 | `5f82445d0df5414a170401b310f5a172d459f87a370bdb5bb77c88ff2e5c317d` |

🔴 **`REPORT.md` 本身不在 `MANIFEST.sha256` 里** —— 它是派生叙述，若清单哈希它、它又记清单的 hash，就构成循环。
清单只覆盖**不可变的原始证据**（日志 + 跑批器）。

---

## 0. 一句话结论

🟢 **17 条 `agent-workflow-*` e2e 全部实跑、全部绿、逐条归因完毕，三层验收判据全过。**
**F2 从未修 → 已闭合**；**F4 的绿灯实证已复跑拿到 → 从「只剩代码层证据」升回「已验」**。**点数 40 → 39。**

🔴 **一轮 0 红不等于 0 产出**：另外挖出 **2 颗给第 10 轮的跨轮地雷**、**1 处终态口径分岔**、**1 类 `afterAll` 无守卫**（见 §5）。

🔴 **本轮没有用「绿的比红的多」这种算法** —— 分册 §5 明写那样**不算通过**。交付物是**逐条归因**。
🟢 **本轮 AI 厂商调用 = 0 次**（红线第 6 条 / G-11）：17 条 spec 全部自述「0 LLM token」，逐个核过；
DSL 里 `type:'llm'` 只出现 2 次且都在**静态夹具**里（`io-contract` 的空 prompt、`publish-gate` 那条注明「勿执行」且只调 `/validate`）。

---

## 1. 🔴 归因表（分册 §5 判据②：**恰好 17 行**）

> 每行的 `EXIT_CODE=` 都是**从那条日志里 `grep -m1 '^EXIT_CODE='` 取出的原文**（红线第 14 条：只认这一行，绝不信后台通知）。
> 原始汇总：`logs/_attribution-raw-20261006-183559.txt`
> **归因取值口径**：分册 §4-5 写「只允许 新红 / 已知红」，那是**针对红**的；总账 §16.2 迭代 2 写的是「新红 / 已知红 / **绿**」⟹ **本轮按总账口径记「绿」**，两处不冲突。
> 🟢 **本轮 0 红 ⟹「新红」与「已知红」两栏均为空集。**

| # | spec | 结果 | 用例 | `EXIT_CODE=` 原文 | 归因 | 原始日志（`logs/` 下） |
|---|---|---|---|---|---|---|
| 1 | `agent-workflow-chat-route.spec.ts` | 🟢 绿 | 1 passed (12.4s) | `EXIT_CODE=0` | **绿** —— 工作流驱动的 Agent 走桥接路径（tool 输出，0 token）。留 def 507 `e2e_wfd_flow_82095581`(DISABLED) + exec 146 + node 408 | `e2e-agent-workflow-chat-route-20261006-182133.log` |
| 2 | `agent-workflow-copy.spec.ts` | 🟢 绿 | 9 passed (3.2m) | `EXIT_CODE=0` | **绿** —— 复制改写器 `WorkflowCopyRewriter` 逐规则。留 def 524/526/527/528(软删) + **525 `wf_cp_pub_e2e`(PUBLISHED, alive)** | `e2e-agent-workflow-copy-20261006-182959.log` |
| 3 | `agent-workflow-display-name.spec.ts` | 🟢 绿 | 5 passed (1.2m) | `EXIT_CODE=0` | **绿** —— 显示名链路（**刻意不跑 BUILD 意图**，其头注释明写「真跑要 8 分钟且烧 token」⟹ 与红线第 6 条一致）。留 def 529(软删) | `e2e-agent-workflow-display-name-20261006-183311.log` |
| 4 | `agent-workflow-editor.spec.ts` | 🟢 绿 | 1 passed (19.8s) | `EXIT_CODE=0` | **绿** —— 建草稿 + 跳设计器。**全自净**：def 511 已软删，0 alive | `e2e-agent-workflow-editor-20261006-182346.log` |
| 5 | `agent-workflow-editor-readonly.spec.ts` | 🟢 绿 | 5 passed (1.3m) | `EXIT_CODE=0` | **绿** —— 只读态 + 后端下发的「为什么不能改」原文逐字上屏。留 def 518/520(软删) + **519 `wf_ro_pub_e2e`(PUBLISHED, alive)** | `e2e-agent-workflow-editor-readonly-20261006-182631.log` |
| 6 | `agent-workflow-form.spec.ts` | 🟢 绿 | 1 passed (14.9s) | `EXIT_CODE=0` | **绿** —— 表单侧。**全自净**：def 512 已软删，0 alive | `e2e-agent-workflow-form-20261006-182329.log` |
| 7 | `agent-workflow-hitl-chat.spec.ts` | 🟢 绿 | 1 passed (13.4s) | `EXIT_CODE=0` | **绿** —— hitl 在对话侧挂起/确认。留 def 510 `e2e_hitlc_flow_82195962`(DISABLED) + exec 147 + node 409,410 | `e2e-agent-workflow-hitl-chat-20261006-182313.log` |
| 8 | `agent-workflow-io-contract.spec.ts` | 🟢 绿 | 2 passed (33.0s) | `EXIT_CODE=0` | **绿** —— 节点 IO 契约与变量引用器。**全自净**：def 516/517 已软删，0 alive | `e2e-agent-workflow-io-contract-20261006-182456.log` |
| 9 | `agent-workflow-manage.spec.ts` | 🟢 绿 | 6 passed (57.8s) | `EXIT_CODE=0` | **绿** —— 管理页 + 只读画布 + 执行历史抽屉。头注释明写「**纯只读，不新增/不发布/不停用/不删除，跑完不留痕**」⟹ **实测 def 增量 0，与自述一致** | `e2e-agent-workflow-manage-20261006-182531.log` |
| 10 | **`agent-workflow-manifest.spec.ts`** | 🟢 绿 | **4 passed (39.1s)** | **`EXIT_CODE=0`** | 🟢 **绿 —— 这就是 F4 的复跑实证**（详见 §2）。**全自净**：def 523 `e2e_mf_82560471` 已软删，0 alive | `e2e-agent-workflow-manifest-20261006-182917.log` |
| 11 | `agent-workflow-publish-gate.spec.ts` | 🟢 绿 | 6 passed (1.0m) | `EXIT_CODE=0` | **绿** —— S4b 发布闸门（`/validate` 含最多 15 s infra/bpm **只读**干跑）。**全自净**：def 522 已软删，0 alive | `e2e-agent-workflow-publish-gate-20261006-182814.log` |
| 12 | `agent-workflow-publish-live-version.spec.ts` | 🟢 绿 | 2 passed (21.5s) | `EXIT_CODE=0` | **绿** —— B6/S16「发布 ≠ 生效」的用户可见半。🔴 **分支二复用了泄漏探针 503**（造 def 515 同 code DRAFT 再软删）⟹ **alive 增量 0，如它自己承诺的**，但埋下第 10 轮的地雷（§5-1） | `e2e-agent-workflow-publish-live-version-20261006-182432.log` |
| 13 | `agent-workflow-replay.spec.ts` | 🟢 绿 | 2 passed (22.7s) | `EXIT_CODE=0` | **绿** —— 含第 01 轮新加的「节点 trace 落库三列」钉子。留 def 513 `wf_replay_e2e_muwj7ak1`(DISABLED) + exec 148 + node 411 | `e2e-agent-workflow-replay-20261006-182408.log` |
| 14 | `agent-workflow-resume.spec.ts` | 🟢 绿 | 1 passed (19.3s) | `EXIT_CODE=0` | **绿** —— S4 形状：hitl 挂起 → 拒绝/同意两分支各自 resume 跑通。留 def 521 `wf_hitl_e2e_muwjc4de`(DISABLED) + exec **149,150** + node **412~419**（8 行，本轮单条 spec 的最大足迹） | `e2e-agent-workflow-resume-20261006-182753.log` |
| 15 | `agent-workflow-sandbox.spec.ts` | 🟢 绿 | 1 passed (17.6s) | `EXIT_CODE=0` | **绿** —— 沙箱：只读工具真跑、写工具被 mock、逐节点时间线。**全自净**：def 508 已软删，0 alive | `e2e-agent-workflow-sandbox-20261006-182147.log` |
| 16 | `agent-workflow-version.spec.ts` | 🟢 绿 | 1 passed (14.9s) | `EXIT_CODE=0` | **绿** —— 版本抽屉 + 主版本徽标 + `v-hasPermi` 门控按钮对 admin 可见。留 def **505,506**（同 code `wf_ver_e2e_muwj3m46` 的两个已发布版本，均 DISABLED） | `e2e-agent-workflow-version-20261006-182105.log` |
| 17 | `agent-workflow-webhook-auth.spec.ts` | 🟢 绿 | 1 passed (13.1s) | `EXIT_CODE=0` | **绿** —— webhook 鉴权（#72 起 `authType` 只能 hmac/token 且 secret 必填，落库前就拒）。**全自净**：def 509 已软删，0 alive | `e2e-agent-workflow-webhook-auth-20261006-182258.log` |

**行数核对（四路独立计数，全部 = 17）**：归因表 **17** 行 · `logs/e2e-agent-workflow-*.log` **17** 个 ·
含 `EXIT_CODE=` 行的 **17** 个 · `EXIT_CODE=0` 的 **17** 个 · `EXIT_CODE≠0` 的 **0** 个 · `.log.done` 标记 **17** 个。
🟢 **旁证**：17 个 `.log.done` 标记文件的内容**全是 `0\n`**，故它们在 `MANIFEST.sha256` 里**共享同一个 sha256**
（`9a271f2a…ab86aa` = `printf '0\n' | sha256sum` 的输出）—— 与「17/17 `EXIT_CODE=0`」互相印证。
**用例合计 49 passed / 0 failed。**

### 1.1 🔴 双向集合断言（分册 §5 判据②第 2 行）

> 原始日志：`logs/_set-assert-FIXED-20261006-183633.txt`

| 断言 | 内容 | 结果 |
|---|---|---|
| ① `A \ B` | `ls` 出的 17 个里有、归因表里没有的（= **漏跑的**） | **空** ✅ |
| ② `B \ A` | 归因表里有、`ls` 里没有的（= **编出来的**） | **空** ✅ |
| ③ `A == B` | 逐字 `diff` | ✅ **完全相同，各 17 行** |

🔴 **一份作废的假红，如实记账**：第一次比对（`logs/_set-assert-20261006-183618.txt`）报「集合不同 / 17 行全不一样」——
**是我自己的比对脚本错了，不是产品错了**：`run-one.sh` 用 `basename "$SPEC" .spec.ts` 命名日志，
故 B 侧反推出的名字**天生不带 `.spec.ts` 后缀**，而 A 侧带 ⟹ 两边逐字必然不等。
该文件**已作废但保留在 `logs/` 里不删**，作为「仪器本身也会坏」的样本；修正版补回后缀后三方对账全过。
🟢 这正是分册 §10「集合类断言要双向」那条方法论**反向咬到我自己**的一次：单向断言抓不到「多返回了东西」，
而**写错的双向断言会制造一场不存在的失败**。判据没错，错在仪器 ⟹ **仪器也要被核。**

---

## 2. 🟢 F4 的绿灯实证（分册 §12-2 要的原文）

```
日志: C:/code/yudao_backups/iter02-e2e-attribution/logs/e2e-agent-workflow-manifest-20261006-182917.log
开始时刻  : 2026-10-06 18:29:17
  ok 1 tests\e2e\agent-workflow-manifest.spec.ts › … （4 条逐条 ok）
  4 passed (39.1s)
结束时刻  : 2026-10-06 18:29:58
EXIT_CODE=0
```

**修复提交（代码层证据，本轮已复核存在）**：前端 `7352562ec`
`fix（agent）：#86 路径 A 删除体检干跑 warning 死代码，manifest e2e 改钉 error 体检未通过`
—— 改动 2 文件：`src/views/agent/workflow/editor/index.vue` 与 `tests/e2e/agent-workflow-manifest.spec.ts`
（**spec 侧与产品侧同时改**，与分册 §2 F4 的描述一致）。

🟢 **⟹ F4 从「只剩代码层证据」正式升回「已验」**：run9~run14 那批丢失的日志，由本轮这份**在仓外、有 sha256、可复算**的日志替代。

---

## 3. 🟢 集合不变核对表（分册 §12-3 · 红线第 24 条 / N22）

🔴 **判据是「集合不变」，不是「= 0」，也不是「行数不变」**（e2e 会新造行，行数一定变）。

### 3.1 alive `wf_plan_%`：**逐字相同** ✅

```
跑前 alive wf_plan_% = 416,417,418,503     （logs/baseline-pre-20261006-181822.log）
跑后 alive wf_plan_% = 416,417,418,503     （logs/baseline-post-20261006-183656.log）
```

| id | `code` | 状态 | 创建时间 | 前后 |
|---|---|---|---|---|
| 416 | `wf_plan_musb3wbk_1` | PUBLISHED | 2026-10-03 19:26:31 | 不变 |
| 417 | `wf_plan_musbuxrn_2` | PUBLISHED | 2026-10-03 19:47:32 | 不变 |
| 418 | `wf_plan_musbxpih_3` | PUBLISHED | 2026-10-03 19:49:42 | 不变 |
| 503 | `wf_plan_muw4s5uf_1` | PUBLISHED | 2026-10-06 11:40:30 | 不变 |

🟢 **本轮当次快照 = `{416,417,418,503}`**，与第 01 轮 §11.6-1 的跨轮更正一致
（🔴 **已按那条提醒把 503 纳入基线**，**没有**照抄红线第 24 条正文里写死的旧快照 `{416,417,418}`）。
🔴 **这 4 行一行都没删** —— 存量 PUBLISHED 泄漏探针，走真接口删不掉，统一等**第 10 轮的 D3**（分册 §3、R-09 ⑤）。

🟢 **这个判据本轮是被「真的考过一次」的，不是空过**：`publish-live-version` 分支二对 **503** 走了 `/rollback`，
造出 def **515**（code 同为 `wf_plan_muw4s5uf_1`、DRAFT），再由 `afterAll` 软删（实测 `deleted=1`）⟹
**若那次 `afterAll` 失手，alive 集合就会多出一个 id、判据当场判失败。**

### 3.2 执行史终态情况 ✅

| 口径 | 跑前 | 跑后 | 判定 |
|---|---|---|---|
| **语义口径**（`CREATED/RUNNING/INTERRUPTED/COMPENSATING`） | 0 | **0** | 🟢 **✅ 判据用这个口径**（红线第 25 条要的是「没有在跑的流程」的证明） |
| 代码口径（`WorkflowExecutionStatusEnum.isFinal()` 之外） | 3 | 3（仍是 exec 140/141/144，**全是跑前存量**，本轮一行未增） | ⚠️ 记为 **B3-4 行为半**（第 05 轮），见 §5-3 |

执行表：总 **7 → 12**（+5），status 分布 `SUCCEEDED 4→9` / `FAILED 3→3`，max id **145 → 150**。
🟢 **新增 5 行全部 SUCCEEDED，没有任何一行卡在非终态。**

### 3.3 `agent_node_execution` 增量**逐条**归因 ✅（🔴 归不上去的增量 = 泄漏 = 本轮判失败）

**行数 40 → 52（+12），max id 407 → 419，id 连续无缺口。12/12 全部归得上：**

| spec | 新执行 | 新 node_exec | 行号 | 业务 `node_id` / `node_type` |
|---|---|---|---|---|
| `chat-route` | 146 | **1** | 408 | `step_1` / tool |
| `hitl-chat` | 147 | **2** | 409,410 | `hitl_1` / hitl.confirm；`step_tool` / tool |
| `replay` | 148 | **1** | 411 | `step_1` / tool |
| `resume` | 149,150 | **8** | 412~419 | `list`·`gate`·`check`·`no` / `list`·`gate`·`check`·`yes`（两次 resume 各 4 行） |
| 其余 **13** 条 | — | **0** | 它们只造 DRAFT / 只走 `/validate` / 纯只读，**本来就不该产生执行行** |
| **合计** | **+5** | **+12** | 408~419 | **归不上去的 = 0 ⟹ 无泄漏** |

🟢 **归属用两把独立的钥匙交叉验证**：① `def.code` 前缀 → spec（4 个非 `wf_` 前缀逐个 `grep -l` 反查坐实：
`e2e_wfd_flow_`→chat-route · `e2e_hitlc_flow_`→hitl-chat · `e2e_mf_`→manifest · `e2e_dn_flow_`→display-name）；
② `create_time` 落在该 spec 日志的 `开始时刻`~`结束时刻` 窗口内（逐条对过，**无一越窗**）。
逐行明细（12 行 × 8 列）见 `REPORT.md` §6.3 / `logs/increment-attribution-20261006-183737.log`。

**附带把第 01 轮没重测的两项补齐了**（`logs/graph-attribution-20261006-183940.log`）：

| 表 | 跑前 | 跑后 | 增量 | 归因 |
|---|---|---|---|---|
| `graph_thread` | 7 | **12** | **+5** | `t1:146`~`t1:150` —— **一行一个新执行，逐条对上** |
| `graph_checkpoint` | 48 | **68** | **+20** | 按 thread 分组 = 2+4+2+6+6 = **20，恰好等于增量** |

🟢 **悬挂 checkpoint（`thread_id` 在 `graph_thread` 里找不到）= 0 行。**
🔴 **顺带一份 B3-5 的活证据**：`thread_name` 实测形状 = **`t1:146`**，即 `"t" + tenantId + ":" + executionId`，
正是总账 §7.2 B3-5 说「今天仍硬编码在 `AgentWorkflowExecutionServiceImpl`」的那个格式。
**它是 checkpoint 的唯一键，格式一漂就是跨租户撞 checkpoint**（第 04 / 06 轮的活，本轮只记账不动）。

### 3.4 🟢 三列非空的实证面从 1 行扩到 13 行（第 01 轮命门的加固）

| | 跑前 | 跑后 | 本轮新增 12 行 |
|---|---|---|---|
| `COUNT(*)` | 40 | **52** | 12 |
| `COUNT(node_name)` | 1 | **13** | **12 / 12 = 100%** |
| `COUNT(parent_node_id)` | 0 | **0** | 0 / 12（🟡 **预期不是缺陷**：本轮无一条跑嵌套） |
| `COUNT(tool_id)` | 1 | **8** | **7 / 7 = 100%**（12 行里 tool 节点正好 7 个） |

🟢 **D2 + B5-1 那三列不再是「只有一行孤证」**，且 `tool_id` **恰好且只**落在 7 个 `type='tool'` 行上
（3 个 `hitl.confirm` + 2 个 `condition.rule` 为 NULL，**符合语义**）。
🟢 **`node_name ≠ node_id` 的区分力也在**：411 是 `node_id=step_1` / `node_name=list`，408 是 `step_1` / `列数据接口` ⟹ **不是把 id 又抄一遍。**

---

## 4. 残留分类（🔴 分册 §6 明确要求「把这两类分开写」）

**def 表：总 88 → 113（+25）· 软删 83 → 100（+17）· alive 5 → 13（+8）**　🟢 **25 = 17 + 8，账对得上**；
**def id 505~529 连续无缺口 ⟹ 25 行逐行都能指到某一条 spec。**

| 类 | 行数 | 说明 |
|---|---|---|
| 🔴 **泄漏**（本该清掉却没清） | **0** | 🟢 **本轮 0 泄漏** —— 25 行新建里 17 行已软删，剩下 8 行**每一行都有 spec 内的书面理由** |
| 🟡 **by-design · 有界**（固定 code + 有就复用） | **2** | **519** `wf_ro_pub_e2e`(PUBLISHED, `editor-readonly`) · **525** `wf_cp_pub_e2e`(PUBLISHED, `copy`)。`copy` 的注释：「afterAll **故意不停用它**：停用等于把样本作废，下一轮只能走 `/rollback` 造新版本再发布，而版本本身也是行 ⟹ **又退回无界增长**」⟹ **重复跑不增长，是设计上的稳态** |
| 🟡 **by-design · 🔴 无界增长**（时间戳 code，PUBLISHED 不可删 ⟹ 只能停用） | **6** | 505,506(`version`，同 code 两个已发布版本) · 507(`chat-route`) · 510(`hitl-chat`) · 513(`replay`) · 521(`resume`)，**全 DISABLED**。🔴 **根因是 D3**（总账 §8.1「PUBLISHED / DISABLED 的流程删不掉」，第 10 轮） |
| 🟢 **全自净的 spec** | **10 条** | `editor`(511) · `form`(512) · `sandbox`(508) · `webhook-auth`(509) · `io-contract`(516,517) · `publish-gate`(522) · `manifest`(523) · `display-name`(529) · `publish-live-version`(514,515) —— 造的 def 全部软删、alive 增量 0；外加 `manage`（**纯只读，def 增量本来就是 0**，实测印证其自述） |

🔴 **增长速率（实测推算）**：这 6 行来自 **5 条 spec**（`version` 一条占 2 行）⟹ **每完整跑一轮 17 条 ≈ +6 行 alive DISABLED**。
**这不是本轮的失败**（分册 §3 + N22 已把判据从「= 0」改成「集合不变」，正是为了不让这类行把每一轮都判死），
🔴 **但它给第 10 轮的 G1 定了一个下界：G1 之前每多跑一轮 e2e，清理面就多 6 行。**

🔴 **对分册 §6 那句「自净在起作用」的再校正**（分册自己已降过一档，本轮实测后**升回一档**）：
自净**对 10 条 spec 完全成立**、**对 5 条 spec 只在「DRAFT 可删」的那一半成立**（那 6 行是它们发布的样本，API 层删不掉）、
**对 2 条 spec 是「刻意不做」**（且这是**正确的设计**，不是缺陷）。
🟢 **本轮 0 泄漏、所有残留都有书面理由 ⟹ 这句可以升回一档**；
🔴 **但它仍然不等于「残留 = 0」** —— 那 8 行要到第 10 轮 D3 + G1 才走得掉。

---

## 5. 🔴 本轮的发现（**0 红，但不是 0 产出**）

### 5-1 跨轮地雷①：`publish-live-version` 分支二**吃的是泄漏探针 503**

**实测链**：① 该 spec 头注释逐字写着「分支二**复用库里已有的『已发布且钉着主版本』的流程**，不自己 seed 一个…
**发现不到就 skip 并喊出声**」；② 它跑的窗口 **18:24:32~18:24:56** 内新建的 def 只有 **514**（它自己的 DRAFT）与 **515**；
③ **515 的 `code` = `wf_plan_muw4s5uf_1`**，与 alive 的 **503** 逐字相同，`status=DRAFT`、`deleted=1`；
④ 日志里分支二是 **`ok 2 … (9.9s)`**，🟢 **真跑通了、没有 skip**；
⑤ 当时 PUBLISHED 候选只有 `{416,417,418,503}`（504 是 DISABLED；519/525 分别在 18:26:34 / 18:30:02 才出现）⟹ **它挑中的必然是 503**。

🔴 **为什么是地雷**：**第 10 轮的 D3 会把 416/417/418/503 一起清掉。** 清完之后分支二**再也找不到被测对象** ⟹
按它自己的设计**转为 skip 并喊出声**。那**不是产品坏了，是夹具失去了被测对象**，
但它会让第 10 轮的 e2e 面上凭空多出一条「非绿」，且这笔账会被误算到 D3 头上。
**⟹ 给第 10 轮的硬要求**：D3 动手**之前**，先给分支二**另备一个**「已发布且钉着主版本」的样本（或把它的 skip 明确记为**预期**）。

### 5-2 跨轮地雷②：`manage` 的第一条用例**要求库里至少有一行手动添加的流程**

`agent-workflow-manage.spec.ts` 里两条断言：`expect(await rows.count()).toBeGreaterThan(0)` 与
`await expect(rows.filter({ hasText: '手动添加' }).first()).toBeVisible()`；头注释也明写前置是「库里已有若干流程定义（真实数据即可）」。
🔴 **第 10 轮 G1 若把 5 张表清空，这条会立刻变红**，且红得**看起来像产品缺陷**（「菜单点开是空白页」正是它要抓的那个缺陷形态）。
**⟹ 给第 10 轮的硬要求**：G1 之后要么留至少一行手动添加的 def，要么在这条 spec 里显式造一行
（**但它现在的自述是「纯只读、不留痕」，改了就得连残留核账一起改**）。

### 5-3 终态口径分岔（= **B3-4 的「行为半」**，第 05 轮）

`WorkflowExecutionStatusEnum.isFinal()` = `{SUCCEEDED, COMPENSATED, COMPENSATION_FAILED}`，**不含 FAILED**；
而**同一个文件**的 `FAILED` javadoc 明写「**FAILED 就是终态，没有任何自动续跑**」，
`isResumable()` 的注释也明写「本方法返回 false 的执行，**一个都恢复不了**，不存在『另一条路』」。
**实测影响**：库里 3 行 FAILED（exec 140/141/144）语义上早已结束，但**任何直接调 `isFinal()` 的代码都会把它们判成「还没完」**。
本轮**没有**因此出错（判据取语义口径，且这 3 行是跑前存量、本轮一行未增），
🔴 **但它是一颗装在清理逻辑里的雷**：第 10 轮 G1 若用 `isFinal()` 当「可以清了」的闸门，**这 3 行会永远清不掉**。
**⟹ 第 05 轮做 B3-4 行为半时，请把「G1 的闸门会读它」这一条写进理由。**

### 5-4 ⚠️ `afterAll` 的清理调用**一律不校验返回码**（与分册 §10 最后一条方法论不符）

分册 §10 逐字要求：「🔴 **`afterAll` 里每个 delete 都要过返回码校验**：不验返回码时，token 过期 / 状态不许删都会**静默失败**，
而计数器照样 `++` ⟹ 得出「清理干净了」的**假结论**。」**实测 5 条 spec 的 `afterAll` 全都不校验**：

| spec | `afterAll` 写法 | 问题 |
|---|---|---|
| `version` | `for (const id of ids) await api('/agent/workflow-def/disable?id='+id,'POST').catch(() => {})` | 🔴 `.catch(()=>{})` **吞掉一切异常** |
| `resume` | `if (wfId) await api('…/disable?id='+wfId,'POST').catch(() => {})` | 🔴 同上 |
| `replay` | `if (wfId) await api('…/disable?id='+wfId,'POST').catch(() => {})` | 🔴 同上 |
| `chat-route` | `await request.post('…/disable?id='+wfId, {headers})` | 🔴 **不看响应码/响应体** |
| `hitl-chat` | 同上（两处 disable） | 🔴 同上 |

🟢 **本轮没有产生假结论** —— 那 6 行**实测确实都是 `DISABLED`**（§4 逐行可查），即 disable **真的成功了**。
🔴 **但机制是无守卫的**：一旦某轮 token 过期（分册 §8 明写 **token TTL = 1800 s**，本轮整窗 13m17s 已逼近一半），
这些 `afterAll` 会**静默失败、spec 照样绿、残留照样留**，而报告会写「清理干净了」。
**⟹ 这是一条真实缺陷，但属 F1 的收尾、不在本轮 41 条内。建议并入第 04 轮的「夹具」硬前置**（那一轮本来就要动夹具）。

### 5-5 🟢 一处对分册字面的**正向**更正：`wf_plan_` 前缀并非「与本轮无关」

分册 §6 的口径是「`504` 不匹配 `wf_plan_%`，所以不影响集合不变判据」—— **这句本身没错**。
但本轮实测出一件分册没写的事：🔴 **17 条 spec 里没有一条自己 seed `wf_plan_` 前缀**（逐个 grep 过：seed 前缀是
`wf_ver_e2e_` / `wf_cp_*` / `wf_ro_*` / `wf_e2e_*` / `wf_io_*` / `wf_iomode_` / `wf_s4b_e2e_` / `wf_b6_e2e_` /
`wf_replay_e2e_` / `wf_hitl_e2e_` / `wf_sbx_` / `e2e_wfd_flow_` / `e2e_hitlc_flow_` / `e2e_mf_` / `e2e_dn_flow_`），
**可是 `wf_plan_` 的 code 仍然被碰了一次** —— 由 `publish-live-version` 的 `/rollback` 间接产生（§5-1）。
🟢 **正面含义**：「集合不变」**不是结构性免疫、空过一轮**，它**真的被考了一次并且过了**。
🔴 **负面含义**：它也**真的可能被打破** —— 只要哪一轮 `publish-live-version` 的 `afterAll` 失手（§5-4 的无守卫问题），
alive 集合就会多出一个 id。**这两件事是同一枚硬币的两面，第 10 轮 D3 清掉 503 之前，这个风险一直在。**

---

## 6. 验收判据逐条对照（分册 §5，**三层，缺一层不算过**）

| 层 | 判据 | 通过标准 | 实测 | 判定 |
|---|---|---|---|---|
| **①** | 报告在**仓外**存在 + 摘要与 sha256 清单**已提交进 git** | `git log` 里查得到 | 报告 = `C:/code/yudao_backups/iter02-e2e-attribution/REPORT.md`（**工作区之外**，R-09 ②）；`MANIFEST.sha256` 覆盖 **48** 个证据文件；**摘要 + 清单 = 本文件与同目录 `round02-e2e归因基线-MANIFEST.sha256`，已提交**（commit hash 记分册 §13.1） | 🟢 **✅** |
| **②** | 归因表**恰好 17 行**，每行含 spec 名 / 结果 / **`EXIT_CODE=` 那一行的原文** / 归因 | 17 行齐 | §1 表 **17 行**、四栏齐；`EXIT_CODE=` 全部由 `grep -m1 '^EXIT_CODE='` 从各自日志取出，**17/17 = `EXIT_CODE=0`** | 🟢 **✅** |
| **②** | 归因表 spec 名 vs `ls` 输出**两个集合完全相同**（🔴 **双向**） | 不许漏跑、不许编造 | §1.1：`A\B` 空 · `B\A` 空 · `diff` 逐字相同 · 各 **17** 行 | 🟢 **✅** |
| **③** | **集合不变**：alive `wf_plan_%` 与**跑前那次实测**逐字相同 | 逐字相同 | §3.1：跑前 `416,417,418,503` = 跑后 `416,417,418,503`（**当次快照，非照抄文档**） | 🟢 **✅** |
| **③** | `agent_workflow_execution` **无非终态行** | 0 行 | §3.2：语义口径 **0**（跑前跑后都是 0；新增 5 行全 SUCCEEDED）。⚠️ 代码口径 3 是跑前存量 FAILED，**记为 B3-4 行为半**，不影响本判据 | 🟢 **✅** |
| **③** | `agent_node_execution` 增量能**逐条**归到那 17 条 spec 上 | 归不上去的增量 = 泄漏 = **本轮判失败** | §3.3：**+12 行，12/12 全部归上**（chat-route 1 · hitl-chat 2 · replay 1 · resume 8），id 408~419 连续无缺口；**归不上去的 = 0** | 🟢 **✅** |

**顺带把分册 §4 的 7 个动作逐条销账**：① 前置已确认 · ② 跑前三个数已量并写进报告 · ③ 17 条 `ls` 原样贴出 ·
④ 金丝雀先跑（`GATE=GO`）· ⑤ 逐条跑逐条归因 · ⑥ 跑后再量 + 集合不变核对 + 增量逐条归因 · ⑦ 报告一次性落仓外 + 摘要与 sha256 入 git。
（逐项的实测细节见 `REPORT.md` §1~§10。）

🔴 **分册 §4 末两条纪律都守住了**：超 10 分钟的跑**完全 detached**（`nohup` + `disown`，PID 17190）+ **轮询标记文件**
（`_drive14.done` / 每条 `.log.done`）—— 红线第 15 条；
**报告在 18:34:22 全部跑完之后才动笔**（跑期间未改前端源码、未重建/重启后端、未删库、未写报告文件）—— 红线第 17 条。
🔴 **红线第 19 条**：全程 `npx playwright test tests/e2e/<名>.spec.ts`、从仓库根目录跑，**没有**用过 `pnpm test:e2e -- xxx`。
🔴 **红线第 16 条**：`workers: 1` + **串行**驱动（14 条一个接一个），**全程无并发**。
🔴 **红线第 11 条**：本次提交**按显式路径 stage**（两个新文件），**没有** `git add -A` / `git add .`。

---

## 7. 点数核销与下一轮

- **消耗：40 → 39**（本轮闭合 **F2**，含 **F4 复跑**，合流对⑥）。十轮总账 **41 → 40 → 39**。
- **下一轮：第 03 轮 · 安全面：无头入口收口（B2-1 ~ B2-5，5 条，中风险，10~14h）。**

### 给第 10 轮的交接（🔴 请务必写进那一册）

1. **D3 动手前先给 `publish-live-version` 分支二另备样本**（§5-1）—— 否则清掉 503 会让一条绿变成一条 skip，且这笔账会被误算到 D3 头上。
2. **G1 清库前先处理 `manage` 的「至少一行手动添加」前置**（§5-2）—— 否则 G1 之后它会红得像产品缺陷。
3. **G1 的「可以清了」闸门不要用 `isFinal()`**（§5-3）—— 它会把 3 行 FAILED 永远挡在门外；这是 B3-4 行为半（第 05 轮）的活。
4. **G1 的清理面下界要按「每轮 +6 行 alive DISABLED」重算**（§4）—— 分册 §6 那个 `3+4+28+4+32=71` 的算式**已作废**。
   本轮实测的五项是 **alive def 13 / 执行 12 / node 52 / thread 12 / checkpoint 68**
   （🔴 **五项同为 2026-10-06 18:36~18:39 一次实测，口径一致、可以相加 = 157 行**；分册旧算式那五项跨了三个时刻，**不许相加**）。
5. **`afterAll` 的返回码校验**（§5-4）建议并入**第 04 轮的「夹具」硬前置**。

---

## 8. 可复算性（🔴 红线第 35 条：每个数字旁边都要写「原始日志在哪」）

日志根 = `C:/code/yudao_backups/iter02-e2e-attribution/logs/`（**46 份**，逐个 sha256 见同目录 `MANIFEST.sha256`）。

| 摘要里的数 | 原始日志 |
|---|---|
| jar mtime / size / JVM uptime / classpath / 两仓 git 状态 / 端口与 PID | `prereq-20261006-181657.log` |
| 跑前三个数（`{416,417,418,503}` / 执行 7 行 / node 40 行 `1 0 1`）+ def 88/83/5 + graph 7/48 | `baseline-pre-20261006-181822.log` |
| 17 条 spec 清单 + 每条字节/行数/`test()` 数 | `spec-list-20261006-181841.log` |
| 每条 spec 的 `EXIT_CODE=` / passed 行 / 起止时刻 | `e2e-agent-workflow-<名>-<时间戳>.log`（**17**）+ `.log.done`（**17**） |
| 14 条的驱动顺序与逐条 rc | `_drive14-summary.txt` + `_drive14.done` + `_drive14-nohup.out`（**0 字节 = 驱动器自身无 stderr，符合预期**） |
| 17 条 `EXIT_CODE=` 的汇总与四路计数核对 | `_attribution-raw-20261006-183559.txt` |
| 双向集合断言（**修正版**） | `_set-assert-FIXED-20261006-183633.txt` |
| 🔴 双向集合断言（**作废的假红版，刻意保留**） | `_set-assert-20261006-183618.txt` |
| 跑后三个数 + alive def 13 行明细 | `baseline-post-20261006-183656.log` |
| def 505~529 逐行 / exec 146~150 逐行 / node 408~419 逐行 / 按 code 分组 / 三列非空增量 | `increment-attribution-20261006-183737.log` |
| `graph_thread` 12 行逐行 / `graph_checkpoint` 按 thread 分组 / 悬挂 0 | `graph-attribution-20261006-183940.log` |
| 跑批器本体（**复跑本轮就用这两个**） | `../run-one.sh` · `../drive-14.sh` |

🔴 **依红线第 31 条：Windows 上 sha256 只当旁证**，不单独作「内容相同」的判据。
🔴 **依红线第 35 条：没有任何一个数只存在于临时目录。** `C:/code/yudao/_tmp/` 本轮**只**用作两个集合比对的中间文件
（`_set_ls.txt` / `_set_log.txt`，**内容均已原样贴进 `_set-assert-FIXED-*.txt`**，故丢了也能复算）。
🔴 **依红线第 36 条：本文件引用的红线号全部逐字核对过总账 §11**（第 6 / 11 / 14 / 15 / 16 / 17 / 19 / 24 / 25 / 31 / 35 / 36 条）。

**`MANIFEST.sha256` 的生成命令（可逐字复算）**：

```bash
cd "C:/code/yudao_backups/iter02-e2e-attribution"; pwd
{ for f in $(ls -1 logs | sort); do echo "logs/$f"; done; echo run-one.sh; echo drive-14.sh; } \
  | sort -u | xargs sha256sum > MANIFEST.sha256
wc -l < MANIFEST.sha256                      # 必须是 48
awk '{print $2}' MANIFEST.sha256 | uniq -d   # 必须无输出（= 无重复行）
```

🔴 **一处仪器自纠（记账，不掩饰）**：清单的**第一版有 47 行、其中 `logs/_drive14-summary.txt` 重复了一次**
（生成时把同一路径传了两遍）⟹ 那个「47」是**行数**不是**文件数**，`logs/` 的真实文件数是 **46**。
已重生成并去重、同时把两个跑批器纳入 ⟹ **48**。上面那两行自检因此**成为清单生成的一部分，不是可选项**。
这与 §1.1 那次假红同源：**都是「仪器自己写错了」**，不是被测对象的问题。
