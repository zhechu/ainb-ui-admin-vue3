# 迭代七 · 第 04 轮 —— 执行生命周期：取消语义 · 摘要（B3-1 / B3-2 / B3-9）

> **这份文件为什么在仓里**：总账 §16.3 的 **G-9** 要求「证据与备份**落仓外** + **摘要入 git**」，
> 红线第 35 条要求「①入 git（**哪怕只是校验和清单 + 摘录**）**或** ②放在工作区之外的固定路径」—— 本轮**两个都做**。
> 🔴 **原始日志（40 份）不在仓里**，仓里只留**摘录 + 校验和 + 可复算命令**。落点见下表。
>
> 🔴 **这份摘要放在前端仓，不是放错了地方**：本轮后端一条提交、前端一条提交，
> 但两份规划文档（总账 + 分册）在 `C:\code\yudao`，而**那个目录不是 git 仓库** ⟹ 文档本身**任何仓都进不去**。
> 第 02 轮（`4958eda8c`）、第 03 轮已用过这个办法，本轮照做，让 `git log` 里查得到「这一轮干过、干了什么、证据在哪」。

| 项 | 值 |
|---|---|
| 执行权威（分册） | `C:/code/yudao/流程编排模块重构方案-迭代七-04-执行生命周期一取消语义.md` |
| 总账 | `C:/code/yudao/流程编排模块重构方案-迭代七.md` |
| 执行日期 | **2026-10-07**　08:25 ~ 09:37（首份日志 08:25，末份非活日志 09:37，归档两次刷新 09:21~09:27 / 09:40~09:44） |
| 证据归档区（**仓外**） | `C:/code/yudao_backups/iter7-round04/` —— **60 个文件 / 5.0 MB** |
| ↳ 索引 | `INDEX.md`（**393 行 / 37112 B**），sha256 = `133b49702a1d5eb14ab805e75fba77de2a26565b8af2de7184e10ce594521ee7` |
| ↳ 校验清单 | `MANIFEST.sha256`，**58 行**，sha256 = `2d593ca9a233da34400392849161f0630bc80bc4d6784541f4e93feeb9f0058e` |
| ↳ 原始日志 | `logs/`（**40** 份）· `probe/`（**7** 份，行为探针脚本与原始 SSE）· `probe-backup/`（**11** 份，变异前的源码快照与 numstat 基线） |
| 本仓副本 | 本文件 + `round04-执行生命周期一取消语义-MANIFEST.sha256`（= 仓外那份 `MANIFEST.sha256` 的逐字副本） |
| 校验结果 | `sha256sum -c MANIFEST.sha256` → **`VERIFY_EXIT=0`**，`OK = 58`，`FAILED = 0`（原始输出 `/c/Users/ling-/_r04_verify2.txt`；第一次刷新那轮的 `/c/Users/ling-/_r04_verify.txt` = `OK 47 / FAILED 0`，同样留存） |
| 两条自检 | ① `wc -l < MANIFEST.sha256` = **58** 且 `find logs probe probe-backup -type f \| wc -l` = **58**；② `awk '{print $2}' MANIFEST.sha256 \| sort \| uniq -d` = **空** |

🔴 **归档刷过两次**：第一次是 33 日志 / 7 备份 / 47 条清单；之后**自查出一个产品缺陷**（取消确认框退回单层措辞 = B3-10 回归，见 **§6 第 10 条**）并修掉，
新增 `logs/28`~`34` 与 4 份 `*2*` 备份，**重取活日志快照 → 重生成清单 → 复跑全部自检**。上表所有数字都是**第二次**（当前）口径。
🔴 重生成**之前**先对旧清单做了一次漂移扫描：`OK=46 FAILED=1`，唯一那条 FAILED 就是活日志 `logs/18-backend-boot.log`（它在长）——
与预期一致，这同时是「活日志确实还在动」的**反证**（原始输出 `/c/Users/ling-/_r04_drift2.txt`）。
🔴 重生成**之后**再跑一遍集合一致性 + 漂移：源侧 `_logs/r04/` = **40** 条目、归档侧 `logs/` = **40** 文件、`comm -23` 与 `comm -13` **均为空**、`SAME=39 DRIFT=1 NOSRC=0`，
唯一那份 DRIFT 仍是 `18-backend-boot.log`。

🔴 **本轮 `MANIFEST.sha256` 刻意不含 `INDEX.md`，与第 03 轮的口径不同**：`INDEX.md` 正是**记录校验结果**的那一份，
把它自己放进清单会自指（结果一写进去，它自己那条哈希立刻失效，永远收敛不了）。第 03 轮的绕法是把校验结果写在清单之外，
本轮改成「清单只覆盖 `logs/ probe/ probe-backup/`」并把这个理由写进 `INDEX.md` 文件头。
🔴 **`INDEX.md` 的完整性并没有因此丢失**：它的 sha256 由**本摘要**钉住，而本摘要在 git 里（与第 03 轮同法）。
🔴 **也不构成循环，依赖链是单向的**：本摘要 → `INDEX.md` → `MANIFEST.sha256` → `logs/ probe/ probe-backup/`。
`MANIFEST` **不覆盖** `INDEX.md`，所以 `INDEX.md` 里写 MANIFEST 的 sha256（§六 表格最后一行）**不会**让任何一条哈希失效；
反过来，MANIFEST 的 sha256 **只**出现在 `INDEX.md` 与本摘要里，而这两份都不被 MANIFEST 覆盖 —— 收敛得了。
🔴 真正的自指只会发生在「清单包含记录校验结果的那份文件」时，那正是本轮把 `INDEX.md` 排除掉的原因。

---

## 0. 一句话结论

🟢 **B3-1 / B3-2 / B3-9 三条全部落地，点数 34 → 31。**
🟢 **三层验收全过，每层都有实测证据**（§3）；后端模块全量 **`Tests run: 1747, Failures: 0, Errors: 0, Skipped: 0` + `EXIT_CODE=0`**（三次）；
前端 vitest **52 files / 1065 tests 全过 `EXIT_CODE=0`**、e2e **`1 passed` `EXIT_CODE=0`**（**四次**）。
🟢 **本轮 AI 厂商调用 = 0 次、烧 0 token** —— seed 的流程五个节点全只读（`data_interface_list` + `hitl.confirm`），
两条分支都只读，这是**刻意**的：只有这样才敢在真库上把取消点到底。

🔴 **但「三层全绿」不等于「这一轮干净」**：本轮自己撞出 / 自纠出 **10 处**问题（**§6**，其中第 10 条是一个**差点提交出去的产品缺陷**），
量出方案文档与实测**不符 4 处**（**§7**），并如实标注 **2 项证据缺口**（**§8**）。
🔴 **最重要的一条实测**：`buildEventFlux` 从**零覆盖**变成**有真跑图夹具**。总账记着一条历史结论 ——
删掉 `.onErrorResume` 之后 **1574** 条测试**全绿**；本轮的探针 C 是它的**精确补集**：**同一处删除现在变红**（§4）。

🔴 **本轮不用「绿的比红的多」这种算法**，也不用「提交标题写了就算做了」。
下面每个数字后面都跟着**它从哪份日志、用哪条命令量出来**；量不出来的**一律标 ⚠️ 不可复算**，不给它编出处。

---

## 1. 三条子项逐条销账

| 子项 | 交付 | 提交 | 规模 |
|---|---|---|---|
| **B3-1** | 「取消」不再写成 FAILED：`.doOnCancel` 改落 **CANCELLED** + reason「用户中断」，**不触发 Saga 反做、不进失败告警面**。三层错（数据/行为/告警）一次消除 | 后端 `f38e629ada` | 见下 |
| **B3-2** | 枚举加 **CANCELLED** 并入 `isFinal()`；新增 `POST /agent/workflow/cancel` + 权限 `agent:workflow:cancel`；`casToCancelled` / `updateByIdUnlessCancelled` 一对并发闸；RespVO 只读派生 `getCancellable()` | 后端 `f38e629ada` | 同上 |
| **B3-9** | 前端执行历史抽屉加**取消**按钮（看服务端派生的 `row.cancellable`）+ CANCELLED 的标签/文案分支 + 「取消不是撤销」确认框（🔴 含**三档**「它停在哪」措辞，见 **§6 第 10 条**） | 前端 `9322e73cc` | 见下 |
| （硬前置） | 🔴 **`AgentWorkflowExecutionServiceImplEventFluxRuntimeTest`**：真编译器、真跑图、`StepVerifier` 逐事件断言的夹具，4 条 | 后端 `f38e629ada` | 同上 |

后端提交 `f38e629ada`：**11 files，+1391 / −16**（命令：`git show --numstat f38e629ada`）。
其中 6 个主源文件 + 1 个既有测试 + 1 份增量 SQL + 3 个新测试类。
前端提交 `9322e73cc`：**3 files，+510 / −2**（`src/api/agent/workflow/index.ts` **+36 / −1**、
`src/views/agent/workflow/components/ExecutionHistoryDrawer.vue` **+127 / −1**、
`tests/e2e/agent-workflow-cancel.spec.ts` 新增 **347** 行）。
🔴 抽屉那份从 `+108 / −1` 长到 `+127 / −1`，多出的 19 行几乎全是确认框改成三档措辞后的分支与「为什么必须分三档」那段注释（**§6 第 10 条**）；
命令：`git show --numstat 9322e73cc`。
🔴 本摘要与它的 sha256 清单是**另起一条 `docs（agent）：` 提交**，不混进 `feat` 那条 —— 与第 02 / 03 轮同法（`4958eda8c` / `e59a74803`）。
🔴 分册 §11.4 还有一条约束：「若夹具与产品改动分开提交，夹具那条提交**不许挂 B3-x 的条目号**」。本轮夹具**与后端产品改动同处一条提交**（`f38e629ada`），
所以那条约束**不适用**；本 `docs` 提交同样**没有**挂 B3-x（标题只写「摘要与 sha256 清单入仓」）。

🔴 **B3-1 的实现取向值得单记一句**：不是在 FAILED 分支里加 `if` 把取消排除掉，而是**把取消升成独立终态**。
后者每新增一个消费 FAILED 的分支都要记得再排除一次，漏一次就把用户想停的动作又跑一遍；
升成独立状态之后，`settle` 里补偿与告警两个分支**一行都不用改** —— 它们本来就只认 FAILED，取消自然绕开。
证据：`git show f38e629ada -- .../AgentWorkflowExecutionServiceImpl.java` 里那个 `if (FAILED.equals(status))` 的
**判断条件本身没被改过**，改的是它上游写进去的状态值。

---

## 2. 🔴 一个必须一直说清的边界：取消是**记账**，不是「把线程掐断」

`runGraph` 由 `Schedulers.boundedElastic().schedule(...)` 派发，那个 `Disposable` **被丢弃**、内部阻塞在 `blockLast()`。
所以取消**停得住事件投递、停不住已经在跑的那个节点** —— 它会自然跑完，只是收尾时被
`AgentWorkflowExecutionMapper#updateByIdUnlessCancelled` 挡住、不许覆盖 CANCELLED。

**这不是推断，是行为层实测到的**（`logs/18-backend-boot.log`，行号可复算：`grep -an '执行(152)' logs/18-backend-boot.log`）：

| 行号 | 时间 | 线程 | 内容 |
|---|---|---|---|
| 3337 | 09:08:57.333 | `http-nio-48080-exec-3` | `[cancel][中止 Workflow executionId(152) 原状态(RUNNING) → CANCELLED，不补偿不告警]` |
| 3346 | 09:08:57.556 | `boundedElastic-1` | `[execute][tool 节点(list) 执行(152) 工具(data_interface_list)]` ← 🔴 **取消之后节点仍在跑** |
| 3347 | 09:08:58.025 | `boundedElastic-1` | `[settle][执行(152) 已被取消，本次收尾（INTERRUPTED）不覆盖 CANCELLED，也不补偿不告警]` |

3346 → 3347 跨线程（`http-nio` 取消 vs `boundedElastic-1` 收尾）证明了那道 SQL 守卫**在生产里真的挡住了**迟到的收尾，
而不是只在单测的 mock 上挡住。这条边界同时写进了：枚举 javadoc、`cancel` 的接口 javadoc、夹具里 `SlowExecutor` 的 javadoc、
以及**前端确认框的正文**（`⚠️ 这不是「掐断线程」：后端停不下正在执行的那个节点…`）—— 运维点下去之前就该知道。

---

## 3. 三层验收（🔴 红线第 21 条：单测全绿**不算**完成）

### ① 静态

| 判据 | 实测 | 命令 / 日志 |
|---|---|---|
| 🔴 `cancel` **真注册进 OpenAPI** | `POST /admin-api/agent/workflow/cancel`，`operationId=AgentWorkflow_cancelExecution`，`summary=中止 Workflow 执行（落终态 CANCELLED，不反做、不告警）`，`executionId` 为 `required:true` | `jq` 于 `logs/20-apidocs-all.json`（1,226,286 B）；摘录见 `logs/20-apidocs.log` |
| 权限真落库 | `agent:workflow:cancel \| 中止执行 \| type=3 \| sort=6 \| parent=agent:workflow:query（流程编排）\| granted_roles=1 \| run_granted_roles=1`（两列相等 = 授权面就是 run 的持有者） | `logs/17-sql-perm.log`，`APPLY_EXIT_CODE=0` |
| 枚举有 CANCELLED 且 `isFinal()` 被钉 | `WorkflowExecutionStatusEnumTest` **6** 条全绿：含 CANCELLED、**刻意不含 FAILED**、白名单分类表、null 安全 | `logs/08-cancel-tests4.log`（`Tests run: 6, Failures: 0`） |

🔴 **这一层必须附一句诚实说明**：`isFinal()` 在生产代码里**零调用方**（实测：
`grep -rn "isFinal" yudao-module-agent/src/main --include=*.java` 只命中枚举自身定义处与注释/javadoc）。
所以「把 CANCELLED 加进 `isFinal()`」**今天不改变任何生产行为**，它**不是** bug 修复，
只是给第 05 轮（B3-4：把 FAILED 也纳入）先把口径与单测钉住。

### ② 测试

| 判据 | 实测 | 日志 |
|---|---|---|
| 🔴 夹具**先红**（证明它真在测东西） | 取消语义未改时 **4/4 全红**（`Tests run: 4, Failures: 4`，`EXIT_CODE=1`）；改完 **33 条全绿**（6+9+14+4，`EXIT_CODE=0`） | `logs/01-fixture-redfirst.log`、`logs/02`、`logs/04`、`logs/08-cancel-tests4.log` |
| 后端模块全量 | **1747 / 0 / 0 / 0**，`EXIT_CODE=0`，**三次**（改动落地后、探针还原后、最后一次纯注释修订后） | `logs/09-fullmodule.log`(4327 行)、`logs/13-fullmodule.log`(4335)、`logs/27-fullmodule-final.log`(4327) |
| 前端 vitest | `Test Files 52 passed (52)`、`Tests 1065 passed (1065)`、`EXIT_CODE=0` | `logs/19-fe-unit.log` |
| 前端 prettier / eslint | 产品源码 2 文件：`PRETTIER_EXIT_CODE=0`、`ESLINT_EXIT_CODE=0`。🔴 新 e2e spec **第一次 prettier 不过**（`=1`），`--write` 后复查双双为 0 | `logs/15-prettier-eslint.log`、`logs/22-e2e-lint.log` |
| 前端 `ts:check` | **79** 条诊断（= 基线数），`EXIT_CODE=2`（**基线本就是 2，不是本轮回归**）；🔴 用了**全新** tsBuildInfoFile（`r04-1791334672.tsbuildinfo (fresh)`，复用旧的会假报 0 条）；**本轮改动的 3 个文件命中 0 行**。**跑了两次**，措辞修订后又跑一次（🔴 又是全新 `r04b-*.tsbuildinfo (fresh)`），仍是 79 / 命中 0 | `logs/14-tscheck.log`、`logs/33-tscheck-final.log` |
| e2e | `1 passed`，`EXIT_CODE=0`，**四次**（首过 09:13 / 探针 D 还原后 09:14 / 确认框三档措辞 + 判据 3 加强后 09:34 / 探针 E 还原后 09:35） | `logs/23-e2e-cancel.log`、`logs/25-e2e-cancel-green.log`、`logs/29-e2e-cancel-after-dialog-fix.log`、`logs/32-e2e-cancel-green-final.log` |
| 🔴 确认框措辞修订后的 lint | `PRETTIER_EXIT_CODE=0`、`ESLINT_EXIT_CODE=0` | `logs/28-dialog-suspendnode.log` |

### ③ 行为（🔴 真跑 → 真取消 → **只读 SQL** 验收）

`logs/21-behavior-probe.log`，全程 `EXIT_CODE=0`，11 段。关键数字：

| 判据 | 实测 |
|---|---|
| 🔴 非空断言守卫 | seed 的流程 `recovery=compensate`（库里核对过：`def: 530 ... PUBLISHED`）。**这步不能省** —— 否则「无补偿痕迹」是恒绿的空断言 |
| 真跑挂起 | `executionId=151 status=INTERRUPTED`；cancel 前快照 `current_node=list / suspend_node=gate / duration_ms=723` |
| 🔴 真发 HTTP cancel | `{"code":0,"msg":"","data":true}` |
| 🔴 **是 CANCELLED 不是 FAILED** | `status=CANCELLED`、`error_msg=用户中断`、`end_time_is_null=NO`、`duration_ms_is_null=NO`（1157ms） |
| 🔴 **无补偿痕迹** | `compensation_touched=NO`（状态没落进 COMPENSATING/COMPENSATED/COMPENSATION_FAILED）；节点 trace 只有 `list tool SUCCESS data_interface_list 48`，**没有反做行**；`compensate_log_lines=0` |
| 🔴 重复取消 | `{"code":1041006003,"msg":"Workflow 执行实例当前状态（CANCELLED）不允许该操作"}` —— msg 报的是**真状态**，证明 CAS 失败后那次**刻意重读**生效（否则会说 INTERRUPTED） |
| 派生标志翻转 | `cancellable`：`INTERRUPTED → true`、`CANCELLED → false` |
| 🔴 RUNNING 中途取消 | `executionId=152`，`duration_ms=256`，随后 0.7s 那次迟到收尾被拒（见 §2） |
| 🔴 浏览器真点 | e2e 判据 1~7 全过：四个按钮渲染 / 操作列不被裁（量 `scrollWidth-clientWidth<=1`）/ **确认框措辞**（判据 3，🔴 已加强：对挂起行必须 `toContain('正挂在闸口「gate」上')` **且** `toContain('最后跑完的节点是「list」')` **且** `not.toContain('说不清')` **且** `not.toContain('**')`）/ 落「已取消」+ **列表自动刷新** / 已取消行上三个动作**计数全为 0** / tag 含 `el-tag--info` 且**不含** `el-tag--danger` / 页面上**零个**裸串 `CANCELLED` |
| 🔴 判据 3 的**非空守卫** | `runUntilSuspended` 里断言 `suspendNode === 'gate'` **且** `currentNode === 'list'`。本轮 seed 的形状是 `START → list(tool) → gate(hitl.confirm)`，故两者**必然不同**。**没有这条守卫**，字段缺失时判据 3 会退化成 `toContain('正挂在闸口「undefined」上')` —— 只要文案里也印出 undefined 就能过，是**恒绿的空断言** |

**残留判据**（`logs/26-residue.log` 首查 + `logs/34-residue-final.log` 终查，🔴 红线第 23/24 条：判据是**集合不变**，不是「probe 行 = 0」）：
本轮造的 **8** 个流程（`530 wf_cancel_probe_*`、`531`~`537 wf_cancel_e2e_*`）**全部 DISABLED**，`live_probe_defs=0`；
`menu_count=7`（含本轮新增的 `cancel`，🔴 与首查同值 = **集合不变**），逐行列出；
执行行 `CANCELLED 7` + `INTERRUPTED 2`（153、158）。
🔴 **那 2 条 INTERRUPTED 是惰性的，且这一点是实测的、不是推断**（`logs/34-residue-final.log`）：两行（153 / 158，`suspend_node=gate`）的 `resume_at` **均为 NULL**，
本轮残留里「`resume_at` 非 NULL」的行数 = **0**，全库「将来会被唤醒」的行数 = **0** ⟹ 等待唤醒的调度器捞不到它们；
加上它们所属的两个流程本身已 DISABLED，双重惰性。

---

## 4. 🔴 五条变异探针（不变红的探针证明不了任何东西）+ 探针 H 闭环

| 探针 | 变异手法 | 红成什么样 | 日志 | `EXIT_CODE` |
|---|---|---|---|---|
| **A** | 调换 `buildEventFlux` 里 META 与首个 NODE 的发射顺序 | `expected: <META> but was: <NODE>` | `logs/10-mutationA.log` | `1` |
| **B** | 🔴 把 `.doOnCancel` **改回写 FAILED**（退回本轮之前的行为） | `expected: <CANCELLED> but was: <FAILED>` | `logs/11-mutationB.log` | `1` |
| **C** | 🔴 **删掉 `.onErrorResume`** | `ReactiveException: TimeoutException: Did not observe any item or terminal signal within 1000ms in 'source(FluxConcatArray)' (and no fallback has been configured)` | `logs/12-mutationC.log` | `1` |
| **D** | 前端把 CANCELLED 的 tag 从 `info` 改成 `danger` | `Error: CANCELLED 的 tag 应当是 info（灰）：el-tag el-tag--danger el-tag--small el-tag--light`；`1 failed` | `logs/24-e2e-mutation-tagcolor.log` | `1` |
| **E** | 🔴 **把取消确认框的「它停在哪」退回单层措辞**（只说 `最后跑完的节点是「list」`，不点名闸口）—— 即本轮**自查出来并修掉**的那个 B3-10 回归（**§6 第 10 条**） | `Expected substring: "正挂在闸口「gate」上"`，`Received string:` 里只有 `它最后跑完的节点是「list」`；`1 failed`。🔴 这条探针**同时**是「改之前那版真有缺陷」的实证 —— 不是「我猜它会错」，是**它真的红了** | `logs/30-mutationE-dialog-node.log` | `1` |

🔴 **探针 E 的还原核对**（四条机械检查全过）在 `logs/31-mutationE-restore.log`；还原后 e2e 复跑 `1 passed (13.9s)` / `EXIT_CODE=0` 在 `logs/32-e2e-cancel-green-final.log`。
🔴 **探针 E 只改前端**（`ExecutionHistoryDrawer.vue`），且出现在最后一次后端全量（`logs/27`，09:16）**之后**（09:34）—— 所以后端 1747 不受它影响，
**没有也不需要**「E 还原后再跑一次后端全量」。

### 🔴 探针 C 就是总账那条历史结论（探针 H）的**精确补集** —— 本轮最重要的一条实测

总账（`流程编排模块重构方案-迭代七.md` 第 **924-926、942** 行）记着：
> 删掉 `.onErrorResume` 之后 **1574** 条测试**全绿** ⟹ `buildEventFlux` 那段**零覆盖**，「不变红的探针证明不了任何东西」。

本轮 `logs/12-mutationC.log` 量到的是：**同一处删除，现在变红了**（`EXIT_CODE=1`，报的就是那句 `no fallback has been configured`）。

🔴 **计数差必须写明，不能糊过去**：`1574 → 1747`。差值 **173** 条**不是**本轮一次跳上去的 ——
本轮自己只贡献 **33** 条（枚举 6 + Cancel 9 + CompensateTrigger 14 + EventFluxRuntime 4），其余来自第 03 轮之后的各轮新增。

🔴 **还原核对按红线第 31 条**：Windows 上 `sed -i` 会把 CRLF 归一成 LF，**不得**拿 `sha256sum` 单独当「已还原」的判据。
每份被变异的文件各做**四条机械核对**：① `cmp` 与 `probe-backup/*.orig` 字节相同；② sha256 与 `*-before.txt` 一致；
③ `git diff --numstat` 回基线（后端 `90 8` / 前端 **D** `108 1` / 前端 **E** `127 1`）；④ 加 `--ignore-all-space` 后 numstat **与③相同**
（若不同即说明差异只在空白 ⟹ 被 sed 动过行尾）。基线数字的原件在 `probe-backup/numstat-*.txt`（E 的那两份是 `numstat-drawer-before2*.txt`，**均为 `127 1`**）。
🔴 前端基线从 `108 1` 长到 `127 1`，是因为确认框改成了三档措辞（**§6 第 10 条**）—— 多出来的 19 行几乎全是那段「为什么分三档」的注释与三档分支本身。

---

## 5. 本轮**不做**的事（分册 §10，逐条对账）

- **A-Ⅰ**：只做 B3-1 的最小面 ——「CANCELLED 不可 resume」。**没有**做「取消转可恢复」。
  钉子 = e2e 判据 5（已取消行上「恢复」按钮**计数为 0**）。
- **N16**：可点击深链，未做。
- **B3-6**：删掉那个 error consumer，**未做** —— 分册要求「有了夹具之后单独评估」。
  🔴 本轮的探针 C 恰好给出了评估依据：**删 `.onErrorResume` 现在会红**，
  说明它承担的是「超时/异常 → 单条 error 事件 + FAILED 收尾」这条**唯一**路径，**不能删**。
- **B3-4**：把 `FAILED` 纳入 `isFinal()`，**未做**，属第 05 轮。
  本轮只把 CANCELLED 放进去，并由 `WorkflowExecutionStatusEnumTest` 钉住「含 CANCELLED、**不含** FAILED」这个**中间态**。

---

## 6. 本轮自己撞出 / 自纠出的 10 处（🔴 都记下来，包括自己写错的那几处）

| # | 问题 | 怎么发现 | 怎么修 |
|---|---|---|---|
| 1 | 🔴 **真 bug**：`FAILED` 能穿过 `!isFinal(status)` 那道准入闸 —— 预检放过去了、UPDATE 影响 0 行 | 写 `…CancelTest` 时 | 改成**白名单** `isCancellable`（`CREATED/RUNNING/INTERRUPTED`），并与 `casToCancelled` 的 SQL `IN` 同源 |
| 2 | 🔴 **真 bug**：`List.of(...).contains(null)` **抛 NPE**，而 `Arrays.asList(...)` 的同名方法返回 false，两者对 null 行为**相反** | `WorkflowExecutionStatusEnumTest#unknownStatusMatchesNoRuler` 以 NPE 报红 | `isCancellable` 显式加 `status != null &&`（入参是从库里读的 status，某行 NULL 就会把一次「取消」变成 500） |
| 3 | 🔴 **夹具 4 条一起红，全是 `实际：[]`** —— 看着像接线断了 | `logs/01-fixture-redfirst.log` | 根因：**Mockito 不执行 `default` 接口方法** ⟹ 未桩的 `updateByIdUnlessCancelled` 恒返回 0 ⟹ settle 以为「本行已被取消」提前 return。补桩 `→ 1`。同一条坑也在既有 `…CompensateTriggerTest` 里补了桩并写明理由 |
| 4 | 🔴 **行为探针第一次直接 500**：`create -> {"code":500,"msg":"系统异常"}` | `logs/21-behavior-probe.attempt1-failed.log`；根因在后端日志里：`JsonParseException: Invalid UTF-8 start byte 0xb5` | **Windows 编码坑**：中文放进 `node -e '<程序文本>'`，命令行是按 ANSI 代码页（GBK）传的。改成**文件→文件**（`probe/dsl-template.json` + `probe/build-body.js`），并把这条坑写进两个文件的头部 |
| 5 | 自查 SQL 报 `ERROR 1054 Unknown column 'tenant_id'` | `logs/17-sql-perm.log` 第一段 | `system_menu` 是**全局表**（无 `tenant_id`），`system_role_menu` **有**（实测 = 1）。是我那条临时查询写错了，增量 SQL 脚本本身是对的 |
| 6 | 🔴 查接口注册**查错了文档组**：`/v3/api-docs/agent` 只有 **45** 字节 | `logs/20-apidocs-agent.json` | 该组不存在（只有 ai/all/bpm/infra/system），且它返回 **HTTP 200 + `{"code":500}`** —— 光看状态码会误判。改用 `/v3/api-docs/all`，且文档 key **带 `/admin-api` 前缀** |
| 7 | e2e 第一次失败：`Expected: "COMPENSATE" Received: undefined` | 对话记录（🔴 **无日志文件**，见 §8） | `AgentWorkflowExecutionRespVO` **没有** `recovery` 字段（实测）。把非空断言守卫挪到 `beforeAll`、改读**已发布流程的 DSL**。🔴 **刻意没有**给 VO 加 `recovery` —— 那超出 B3-1/B3-2/B3-9 的范围 |
| 8 | 确认框里写了 `且**不会**触发补偿反做` | 自查 | `ElMessageBox` 是**纯文本**，markdown 星号会原样显示。去掉星号，并在 e2e 判据 3 里加 `not.toContain('**')` 钉住 |
| 9 | service impl 里一段**过期注释**仍把「用户中断」列成第三条 FAILED 路径，与同文件另一处矛盾 | 自查 `git diff` | 改写成「只剩两条」，并写明「不是新增判断把它们挡掉，而是取消从此不满足这个 `equals(FAILED)`」。🔴 这是**纯注释**修订，改完仍复跑了一次模块全量（`logs/27-fullmodule-final.log`，1747 / `EXIT_CODE=0`） |
| 10 | 🔴 **差点提交出去的产品缺陷（B3-10 回归）**：新写的 `onCancel` 确认框，「它停在哪」只有**一档**措辞 —— `它最后跑完的节点是「${row.currentNode}」`。对 `INTERRUPTED` 行这是**错的**：`current_node` 只在**节点跑完**时写，真正挂起的那道闸口在它后面（`suspend_node`）⟹ 运维在取消一个挂起执行时，被支去查一个**早就跑完**的节点 | 自查：与隔壁 `onResume` 逐句对照，发现它照着**旧版** `onResume` 写 —— 而旧版那个缺陷正是迭代六 **B3-10**、commit `87ae32d9d` 刚拆掉的。新动作把修掉的东西又带回来了 | 改成**三档**：`INTERRUPTED`+有 `suspendNode` → **点名闸口**（取消掉的就是这道等待）+ 附带 `currentNode`；`INTERRUPTED`+无 → 直说「说不清」，🔴 **不许**改口说「停在 currentNode」；其余档（`CREATED`/`RUNNING`）→ 此时没有闸口可言，`currentNode` 才是对的位置。同时把 e2e 判据 3 加强（点名闸口 + 两半都在 + `not.toContain('说不清')`）并加**非空守卫**。**并用探针 E 把它变异回单层措辞，实测确实变红**（`logs/30-mutationE-dialog-node.log`，`EXIT_CODE=1`）—— 这条探针同时证明了「加强后的断言非空」与「改之前那版真有缺陷」两件事 |

🔴 **第 10 条值得单拎出来讲一句方法论**：它是在**三层验收已经全绿、后端已提交、只等前端提交**的时候被自查拦下来的。
「验收全绿」完全没挡住它 —— 🔴 原因是**当时的判据 3 根本没管「它停在哪」**：它只断言三句 ⚠️ 后果
（`停不下正在执行的那个节点` / `不会触发补偿反做` / `不可恢复`）加一条 `not.toContain('**')`，
对位置措辞**零断言** ⟹ 单层措辞照样全绿。这一点是**实测的**，不是推断：`logs/23-e2e-cancel.log`（09:13）与
`logs/25-e2e-cancel-green.log`（09:14）两次 `1 passed / EXIT_CODE=0`，跑的正是**带缺陷的那版措辞**。
拦住它的是「新写的确认框必须与隔壁 `onResume` 同一条纪律逐句对照」这个动作，不是测试。
所以本轮补的不只是措辞，还有**让判据 3 从此管得住位置**的那四条断言（点名闸口 / 两半都在 / 不走「说不清」那档 / 无字面星号），
以及**让它变不成空断言**的非空守卫（`suspendNode==='gate'` 且 `currentNode==='list'`，两者必然不同 ⟹ 点名闸口那半不可能靠 `current_node` 蒙对）。

---

## 7. 🔴 方案文档与实测不符的 4 处（如实报告，**不改方案原文**）

| # | 方案怎么写 | 实测是什么 | 证据 |
|---|---|---|---|
| a | §6 提到 `AgentWorkflowExecutionServiceTest` | **该文件不存在**。且 `git grep -E "doOnCancel\|CANCELLED\|用户中断" HEAD -- yudao-module-agent/src/test` **为空**（`grep_exit=1`）⟹ 改之前**没有任何**既有断言钉住「取消 → FAILED」，本轮也**没有**把任何一条既有断言从红改绿 | 于 HEAD 复算，见后端提交前的复核 |
| b | §5① 用 `/v3/api-docs/agent` 验接口注册 | **该组不存在**；返回 HTTP 200 + `{"code":500,"msg":"系统异常"}`，45 字节。正确 = `/v3/api-docs/all` + key `/admin-api/agent/workflow/cancel` | `logs/20-apidocs-agent.json`、`logs/20-apidocs.log` |
| c | §7 的只读 SQL 模板 select 了 `reason` 列 | `agent_workflow_execution` **没有 `reason` 列**，取消原因的载体是 **`error_msg`** | `logs/21-behavior-probe.log` 第 4 段 |
| d | §7-4 写的 PID 是 13400 / 12448 | 已失效。实测当时是 **4052**（后端）/ **12332**（maven）；本轮重启后端之后是 **22368** | `logs/18-backend-boot.log` |

---

## 8. ⚠️ 两项证据缺口（🔴 红线第 35 条：写不出日志位置就标不可复算）

1. ⚠️ **e2e 第一次失败（09:12）的输出没有落地成日志文件**。`logs/` 里只有
   `21-behavior-probe.attempt1-failed.log` 一份 attempt1 留档，属**行为探针**、不属 e2e。
   §6 第 7 行那条根因（`Received: undefined`）**只有对话记录 ⟹ 标 ⚠️ 不可复算**。
   🔴 可复算的只有「exec 153 由 `wf_cancel_e2e_muxex4gs` 那轮产生」这半：
   `grep -an 'executionId(153)' logs/18-backend-boot.log` → 第 **3615** 行
   `09:12:04.929 [run][启动 Workflow code(wf_cancel_e2e_muxex4gs) defId(531) v(1) executionId(153) thread(t1:153)]`。
2. ⚠️ **`ts:check` 那 79 条没有与一份「改前基线」做逐条集合 diff**（那需要 stash 改动重跑一次）。
   本轮实测到的是两件事：① 条数 = **79**，与红线第 34 条记的基线数相同；
   ② `grep -aE 'src/api/agent/workflow/index\.ts|ExecutionHistoryDrawer\.vue|agent-workflow-cancel\.spec\.ts' logs/14-tscheck.log`
   **命中 0 行**。②才是决定性判据，它是实测的；「逐条集合相同」这半**未做**。
   🔴 措辞修订之后又跑了一次（`logs/33-tscheck-final.log`，🔴 全新 `r04b-*.tsbuildinfo (fresh)`）：仍是 **79** 条、本轮 3 个改动文件**命中 0 行**、`EXIT_CODE=2`。
   🔴 附一条容易看错的地方：`src/views/agent/workflow/` 下**另有 2 条**既有诊断
   （`editor/useWorkflowEditor.ts:541`、`index.vue:108`），**都不是本轮改的文件**。

---

## 9. 交棒给第 05 / 06 / 07 轮

1. `WorkflowExecutionStatusEnum` 现在**有** `CANCELLED`，且 `isFinal()` **已含** CANCELLED、**仍不含** FAILED。
   🔴 第 05 轮（B3-4）把 FAILED 加进 `isFinal()` 时，`WorkflowExecutionStatusEnumTest` 里那条
   「不含 FAILED」的断言会**按设计变红** —— 那是预期，改断言即可，别当成回归。
2. 🔴 `isFinal()` 目前**零生产调用方**（实测，见 §3①）。第 05 轮要先找出「本该用 `isFinal` 却在手写状态集合」的地方，
   否则把 FAILED 加进去同样**不改变任何行为**，那一轮就会重演「配了但不生效且无提示」。
3. 🔴 **第 07 轮（告警面）必须显式排除 `CANCELLED`**。本轮已让「取消」不再走
   `AgentWorkflowExecutionServiceImpl` 里那个 `if (FAILED.equals(status))` 分支（它同时管补偿与告警），
   但那是**因为状态不再等于 FAILED**，**不是**新增了排除判断。第 07 轮若把告警条件重写成
   「非成功即告警」之类的形态，会把 CANCELLED 重新卷进告警面 —— 正是本轮消除的第三层错。
4. 🔴 「可取消状态集合」的**唯一出处**是 `WorkflowExecutionStatusEnum.CANCELLABLE`
   （`CREATED / RUNNING / INTERRUPTED`），它同时喂 Java 准入闸（`isCancellable`）与 `casToCancelled` 的 SQL `IN`。
   **别在任何一侧另抄一份集合**（含前端 —— 前端看服务端派生的 `row.cancellable`，`v-hasPermi` 只管权限）。
5. 探针 C 已给出 **B3-6 的评估结论**：`.onErrorResume` 是「超时/异常 → 单条 error 事件 + FAILED 收尾」的唯一路径，**不能删**。
   第 06 轮若仍想动它，得先说清那条路径改由谁承担。
6. 🔴 **给后续每一轮的前端纪律**（本轮踩了一次，**§6 第 10 条**）：凡是确认框里要说「它停在哪」，**必须分三档**，不许只用 `currentNode` 一档 ——
   `INTERRUPTED` 行的真实位置是 `suspendNode`（闸口），`currentNode` 是**上一个已跑完**的节点；`suspendNode` 缺失时**必须直说「说不清」**，不许改口。
   `onResume` / `onCancel` 现在都是这个形状。新增任何动作（重试、跳过、人工改状态…）都要照抄，
   且 e2e 判据要**同时**钉住「点名闸口」+「两半都在」+「不走说不清那档」，并配一条**非空守卫**
   （`suspendNode` / `currentNode` 必须是本轮 seed 形状下的已知值且**互不相同**），否则会退化成 `toContain('「undefined」')` 那种**恒绿的空断言**。

---

## 10. 复算入口（一条命令看懂本轮全部判据）

```bash
# 归档区自校（🔴 当前口径 58 条）
cd /c/code/yudao_backups/iter7-round04 && pwd
sha256sum -c MANIFEST.sha256 | grep -c ': OK$'      # 58
sha256sum -c MANIFEST.sha256 | grep -c 'FAILED'     # 0
sha256sum -c MANIFEST.sha256 > /dev/null 2>&1; echo "VERIFY_EXIT=$?"   # 0
wc -l < MANIFEST.sha256                             # 58（自检 1 上）
find logs probe probe-backup -type f | wc -l        # 58（自检 1 下，必须相等）
awk '{print $2}' MANIFEST.sha256 | sort | uniq -d   # 空（自检 2）

# 集合一致性 + 漂移扫描（🔴 唯一那份 DRIFT 必然是活日志 18-backend-boot.log）
cd /c/code/yudao/ruoyi-vue-pro/_logs/r04 && pwd
A=/c/code/yudao_backups/iter7-round04
ls -1 | wc -l                                        # 40（源侧）
find "$A/logs" -maxdepth 1 -type f | wc -l           # 40（归档侧）
ls -1 | sort > /c/Users/ling-/_r04_src.txt
find "$A/logs" -maxdepth 1 -type f -printf '%f\n' | sort > /c/Users/ling-/_r04_dst.txt
comm -23 /c/Users/ling-/_r04_src.txt /c/Users/ling-/_r04_dst.txt   # 空
comm -13 /c/Users/ling-/_r04_src.txt /c/Users/ling-/_r04_dst.txt   # 空

# 三层验收的关键行
grep -a 'EXIT_CODE' logs/*.log                       # 每份日志的判据行
grep -a 'Tests run: 1747' logs/*fullmodule*.log      # 后端全量三次
grep -an '\[cancel\]\|已被取消' logs/18-backend-boot.log   # 🔴 实测 8 行 = 7 条 [cancel]（执行 151/152/154/155/156/157/159）+ 1 条 [settle]…已被取消（152 的迟到收尾）
                                                          # 7 条 [cancel] 与残留里 CANCELLED=7 对得上；两条 INTERRUPTED（153/158）来自两次**中途失败**的 e2e，没点到「仍要取消」
grep -ac '\[compensate\]' logs/18-backend-boot.log   # 0 ⟹ 取消确实没触发反做
grep -a '1 passed' logs/23*.log logs/25*.log logs/29*.log logs/32*.log   # e2e 四次全绿
grep -a 'EXIT_CODE=1' logs/10*.log logs/11*.log logs/12*.log logs/24*.log logs/30*.log  # 五条变异探针全红

# 三条提交（后端 1 + 前端 2；🔴 前端 docs 那条另起，不混进 feat）
cd /c/code/yudao/ruoyi-vue-pro       && git show --numstat f38e629ada   # 后端：11 文件 +1391/−16
cd /c/code/yudao/yudao-ui-admin-vue3 && git show --numstat 9322e73cc    # 前端 feat：3 文件 +510/−2
cd /c/code/yudao/yudao-ui-admin-vue3 && git log --oneline -4            # 最上面那条 = 本 docs 提交
```
