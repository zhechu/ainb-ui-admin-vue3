# 迭代七 · 第 04 轮 —— 执行生命周期：取消语义 · 摘要（B3-1 / B3-2 / B3-9）

> **这份文件为什么在仓里**：总账 §16.3 的 **G-9** 要求「证据与备份**落仓外** + **摘要入 git**」，
> 红线第 35 条要求「①入 git（**哪怕只是校验和清单 + 摘录**）**或** ②放在工作区之外的固定路径」—— 本轮**两个都做**。
> 🔴 **原始日志（48 份 `.log` + 1 份生成程序）不在仓里**，仓里只留**摘录 + 校验和 + 可复算命令**。落点见下表。
>
> 🔴 **这份摘要放在前端仓，不是放错了地方**：本轮后端一条提交、前端一条提交，
> 但两份规划文档（总账 + 分册）在 `C:\code\yudao`，而**那个目录不是 git 仓库** ⟹ 文档本身**任何仓都进不去**。
> 第 02 轮（`4958eda8c`）、第 03 轮已用过这个办法，本轮照做，让 `git log` 里查得到「这一轮干过、干了什么、证据在哪」。

| 项 | 值 |
|---|---|
| 执行权威（分册） | `C:/code/yudao/流程编排模块重构方案-迭代七-04-执行生命周期一取消语义.md` |
| 总账 | `C:/code/yudao/流程编排模块重构方案-迭代七.md` |
| 执行日期 | **2026-10-07**　08:25 ~ 11:07（首份日志 08:25，末份**非活**日志 11:07 = `logs/42`；归档五次刷新 09:21~09:27 / 09:40~09:44 / 09:56~10:00 / 10:44~10:49 / **11:09~12:04**） |
| 证据归档区（**仓外**） | `C:/code/yudao_backups/iter7-round04/` —— **69 个文件 / 5.26 MB**（`du -sb` = **5,515,273 B**，2026-10-08 本次提交前实测；🔴 `INDEX.md` 自记的 `5,508,247 B` 是它写完那行之前的值 —— `du` 把 `INDEX.md` 自己也算进去，属**自指**，两个数不可能同时成立） |
| ↳ 索引 | `INDEX.md`（**585 行 / 67703 B**），sha256 = `59437b8698fddac420d0fdab782789b6ecfaaa26f70b840064cf9f7f7b197dc3` |
| ↳ 校验清单 | `MANIFEST.sha256`，**67 行**，sha256 = `12abd37374e5e660b5f632e2379e7aa10dd35a03f4e2aee14aef2c59d548b7ff` |
| ↳ 原始日志 | `logs/`（**49** 份 = **48** 份 `.log` + **1** 份生成程序 `_r41-criteria-count.awk`）· `probe/`（**7** 份，行为探针脚本与原始 SSE）· `probe-backup/`（**11** 份，变异前的源码快照与 numstat 基线） |
| 本仓副本 | 本文件 + `round04-执行生命周期一取消语义-MANIFEST.sha256`（= 仓外那份 `MANIFEST.sha256` 的逐字副本，`cmp` → **`CMP_EXIT=0`**，副本 sha256 与上表**同值**）🔴 **本次提交前重新对齐过**：仓内那份一直挂在**第四次**（66 条），仓外已刷到**第五次**（67 条），差的那 1 行 = `logs/42-thread-pair-check.log`；已用仓外那份覆盖，**覆盖前先证过「旧 66 行一条没丢」**（`comm -23 prev new` = 0） |
| 校验结果 | `sha256sum -c MANIFEST.sha256` → **`CHECK_EXIT=0`**，`OK = 67`，`FAILED = 0`，`stderr 行 = 0`（原始输出 `/c/Users/ling-/_r04_verify6.txt`，🔴 **2026-10-08 本次提交前复跑**，不是沿用旧值；历次 `_r04_verify.txt` = `OK 47`、`_r04_verify2.txt` = `OK 58`、`_r04_verify3.txt` = `OK 61`、`_r04_verify4.txt` = `OK 66`、`/c/code/yudao_backups/_verify5.txt` = `OK 67`，`FAILED` 均为 **0**，同样留存） |
| **五条**自检 | ① `wc -l < MANIFEST.sha256` = **67** 且 `find logs probe probe-backup -type f \| wc -l` = **67**；② `awk '{print $2}' … \| sort \| uniq -d` = **空**；③ 格式（`-b`）异常行 = **0**；④ 清单**不自指**（含 `MANIFEST.sha256`/`INDEX.md` 的行）= **0**；⑤ 🔴 **只加不改**：对**第四次**那 66 行（`_MANIFEST.prev.r04b.tmp`）缺失 = **0**、新增 = **1**；对**已入 git 的那份**（`666461b88`，58 行）缺失 = **1**（活日志 `logs/18` 的旧快照哈希，理由见下）、新增 = **10** |

🔴 **归档刷过五次**：
- **第一次** 33 日志 / 7 备份 / **47** 条清单；
- **第二次**：自查出一个**产品缺陷**（取消确认框退回单层措辞 = B3-10 回归，见 **§6 第 10 条**）并修掉，新增 `logs/28`~`34` 与 4 份 `*2*` 备份 ⟹ 40 日志 / 11 备份 / **58** 条清单；
- **第三次**：为**台账回写**取证（红线第 32 条：「未修→已修」必须附 grep / 只读 SQL 实证，**不能只附 commit hash**），新增 `logs/35`~`37` ⟹ 43 日志 / 11 备份 / **61** 条清单；
- **第四次**：为**总账收尾回写**取证 —— 回写过程中又自纠出 **4 处**「我写下的数字/描述与原始日志不符」，每处都要留一份可复算的原始输出，
  新增 `logs/38`（`afterAll` 违规普查，🔴 **证伪了第 02 轮记的「5 spec / 6 处」**）· `logs/39`（`isFinal` 调用点：裸 grep **38** / 精确 **7** / `src/main` **0**）·
  `logs/40`（红线第 36 条要求的**编号连续性机械核对**，38 条）· `logs/41`（判据表**行数与 ✅/❌ 归因**的机械核对）+ **`_r41-criteria-count.awk`**（产出 `logs/41` 那些数字的程序）
  ⟹ **47 日志 + 1 程序 = 48** / 11 备份 / **66** 条清单。
- **第五次**（当前）：为**分册 §12 收尾报告**取证 —— 写 §12.5 那条「取消是记账、不是掐断线程」时，发现**本摘要 §2 那句话与它自己上方三行处的表格直接矛盾**
  （即 **§6 第 19 处自纠**，正文已改），新增 `logs/42-thread-pair-check.log`（逐字段机械提取 3337 / 3346 / 3347 三行的**线程 / 时间 / 类名**，
  顺带量出 logback 把 level 右补空格 ⟹ awk `$5` 是空字段、类名在 `$6` 这个坑）
  ⟹ **48 日志 + 1 程序 = 49** / 11 备份 / **67** 条清单。🔴 这是本轮**第 19 处自纠**，也是**唯一一处由「写收尾报告」这个动作本身产出的证据**。
  🔴 这五次里的**后三次都只取证、不改产品**：后端与前端的产品源码**一行未动**，所以**没有**新增 `probe-backup/`，也**不需要**重跑任何测试；
  🔴 **也没动任何已归档日志的正文**（五次刷新都只**加**、不改旧份）。
  🔴 **归档 `_r41-criteria-count.awk` 这个动作本身是刻意的**：只归档输出，下次改了表就没法重跑，那份输出立刻退化成「一句无法核对的话」。

前三次都是**重取活日志快照 → 重生成清单 → 复跑全部自检**；🔴 **第四、第五次刻意【没有】重取活日志快照，这是一次口径变更**：
`logs/18-backend-boot.log` 冻结在第三次那份（**1,941,971 B**，mtime 10:00:15）；源侧第四次时长到 **2,694,865 B**（mtime 10:45:52）、第五次时 **3,097,400 B**（mtime 11:10:14），
🔴 **2026-10-08 本次提交前实测已是 4,897,670 B**（mtime 2026-10-07 12:59，此后不再长 —— 那个后端进程已停）。
理由：① 本轮产品活已收工，此后新增的只是一个**空转后端**的日志，**不含任何被引用的证据**（被引用的是行 **3318 / 3337 / 3346 / 3347**，全在冻结快照内，且都在 09:08:58 之前写入；
🔴 **第五次新增的 `logs/42` 引的正是 3337 / 3346 / 3347 这三行** ⟹ 它的结论可复算，不受「活日志没重拷」影响）；
② 重拷只是把漂移点往后挪；③ `sha256sum -c` 校的是**归档副本对自己那条哈希**，两侧同为冻结字节 ⟹ **67 条全 `OK`**，自洽性不依赖活源。
🔴 **代价如实记**：源侧 10:00:15 之后那部分日志**没有归档**（第四次时量到 **752,894 B**、第五次时 **1,155,429 B**、**现在是 2,955,699 B**），
而 `_logs/` 被 gitignore ⟹ **一旦 `_logs/` 被清就永久丢失**。判断是**可接受**（那段不含证据），但这是判断不是事实。

上表所有数字都是**第五次**（当前）口径。
🔴 历次「重生成前对旧清单做的漂移扫描」逐次记下（这些是一次性的时点测量，删了就不可复算）：第二次前 `OK=46 FAILED=1`（`_r04_drift2.txt`）·
第四次前（对旧 61 条）`SAME=42 DRIFT=1 NOSRC=0`（`_r04_drift4.txt`）· **第五次之后**（含新增 1 份）`SAME=48 DRIFT=1 NOSRC=0`（`_r04_drift5.txt`）。
唯一那条 DRIFT 一直是活日志 `logs/18-backend-boot.log` —— 与预期一致，这同时是「活日志确实还在动」的**反证**。
🔴 第四次新增的 5 份逐份 `sha256sum` 源 vs 归档比对（前 16 位，**五个全 SAME**）：
`38` = `860b36113033b87b…`、`39` = `5b3f4f585f91f9d7…`、`40` = `4da653aa9fb505d0…`、`41` = `48eb6cd05127bce8…`、`_r41-criteria-count.awk` = `9d57adaeb59817d0…`
（🟢 这五个值**仍可从当前清单逐条复核** —— 第五次刷新没改动任何一条既有哈希）；第五次新增那 1 份同样 `SAME`：`logs/42` = `2bd2ba1018f49ca2…`。
🔴 **集合一致性现在有一处已知不齐，如实记**（2026-10-08 本次提交前实测）：源侧 `_logs/r04/` = **50** 条目、归档侧 `logs/` = **49** 文件，
`comm -23`（源有归档无）= **1 行** = `18-backend-boot.done`（内容只有 `finished` 一个词，是那个后台任务的**完成标记**，2026-10-07 12:59 出现，**晚于第五次刷新**），`comm -13` = **空**。
判断是**不归档**（它不含任何被引用的证据，与「活日志不重拷」同类），但这是判断不是事实；清单 `/c/Users/ling-/_r04_src6.txt` / `_r04_dst6.txt`。
（第四次刷新时这一项是 48 / 48 全等、两个 `comm` 均空，清单 `_r04_src4.txt` / `_r04_dst4.txt`；第五次是 49 / 49 全等。）

🔴 **「向上冒一层」的副作用，第三、第四、第五次各发生一次，都如实记下**：`MANIFEST.sha256` 自身哈希 `2d593ca9…`（58 条）→ `c2940530…`（61 条）→ `d3602dca…`（66 条）→ **`12abd373…`（67 条，当前）**，
`INDEX.md` 因此也跟着变 `133b4970…` → `7014218e…` → `91d3356c…` → **`59437b86…`（当前）**，而这两个值**正是本摘要表头钉的** ⟹ 已提交的那份摘要（`666461b88`）钉的是**第二次**口径。
依赖链是**单向**的（本摘要 → `INDEX.md` → `MANIFEST.sha256` → `logs/ probe/ probe-backup/`），所以只能**自下而上**重钉，
不能反过来。第三、第四、第五次均按「清单 → INDEX → 摘要」的顺序做了。🔴 **但第三、第四次那两轮所谓「已追加 docs 提交」是假话** ——
重钉只做到**工作树**里就停住了，一直挂到迭代八（这正是迭代八 U4 记的「第 04 轮遗留的两个未提交文件」）；真正落地的是 **`04c2e931a`**（docs②），
一次覆盖**第三 + 第四 + 第五次**口径（仍不是修改 `666461b88`，红线第 11 条：绝不 `--amend`）。
🔴 **假话的成因与查法都记下**：写那句时并没有回头跑 `git log --all -- <路径>` 核。这次就是靠它翻出来的 ——
`git log --oneline --all -- 摘要.md` 在 `04c2e931a` 之前**只有 1 条**（`666461b88`），而按当时写下那句话的口径**该有 2 条**（第三次刷新那轮就该多出一条）。
🔴 本句所在的这次修正 = **docs③**（只改这两处话，不动任何数字口径），同样另起一条、不 `--amend`。
🔴 **一条会被误读成「漏改」的说明**：`MANIFEST.sha256` **不含** `INDEX.md`，所以改 `INDEX.md` **不会**让清单里任何一条哈希失效 ⟹ 上面那串哈希变动**只由「新增文件」引起**（第四次 +5、第五次 +1），不是连锁失效。


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

🔴 **但「三层全绿」不等于「这一轮干净」**：本轮自己撞出 / 自纠出 **19 处**问题（**§6**，其中第 10 条是一个**差点提交出去的产品缺陷**；
第 **11~14** 条是**台账取证阶段**自己量错又自己抓出来的四处，第 **15~18** 条是**总账收尾回写阶段**又抓出来的四处，
第 **19** 条是**写分册 §12 收尾报告时**抓出来的 —— 🔴 它与自己上方三行处的那张表**直接矛盾**，说明「同一份文档里相邻两处」也不会自动互相校验），
量出方案文档与实测**不符 6 处**（**§7**），并如实标注 **3 项证据缺口**（**§8**）。
🔴 **且分册 §12 那 10 条验收判据是 6 过 / 4 未过**（3 条属 **1b**〔`afterAll` 返回码校验，**本轮未交付、顺延第 05 轮**〕、1 条属**第 02 轮那 17 条 e2e 棘轮未重拉**）。
🔴 **这与「三层全绿」不矛盾**：三层验收核的是 **B3-1 / B3-2 / B3-9 这三条产品改动本身**，而那 4 条未过全属**验收面欠账**，一条都不是产品缺陷 ——
但 🔴 **点数 34 → 31 照记**，欠账**不减点、也不藏**，且 1b 的 2~4h **没花掉**（🔴 债主换成第 05 轮，合计不减，见总账 §16.4）。
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

🔴 **这里原本写的是「3346 → 3347 跨线程（`http-nio` 取消 vs `boundedElastic-1` 收尾）证明了那道 SQL 守卫在生产里真的挡住了迟到的收尾」——那句是错的**：
3346 与 3347 **同为 `boundedElastic-1`**（机械核：`awk '{print $3}'` 三行分别是 `[http-nio-48080-exec-3]` / `[boundedElastic-1]` / `[boundedElastic-1]`），**这一对根本不跨线程**。
🟢 **正确的是两对，各自证明两件不同的事，不许合并成一句**（📄 `logs/42-thread-pair-check.log`）：
- **3337 → 3347【跨线程】**（`http-nio-48080-exec-3` 的 `cancel`（`AgentWorkflowExecutionServiceImpl:231`）vs `boundedElastic-1` 的 `settle`（`:522`），相隔 **0.692s**）
  ⟹ 证明那道 SQL 守卫**在生产里真的挡住了**迟到的收尾，而不是只在单测的 mock 上挡住。
- **3337 → 3346【取消之后节点仍在跑】**（09:08:57.333 取消 → 09:08:57.556 该节点还在 `execute`（`ToolNodeExecutor:74`），相隔 **0.223s**）
  ⟹ 证明「取消**停得住事件投递、停不住已经在跑的那个节点**」。
  🔴 而 3346/3347 这对**同线程**的，只能用来讲「同一个节点跑完之后，**它自己的**收尾被拒」—— 把它写成「跨线程」会**同时讲坏两件事**。

这条边界同时写进了：枚举 javadoc、`cancel` 的接口 javadoc、夹具里 `SlowExecutor` 的 javadoc、
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

🔴 **两条提交正文里的探针数【对不上】，这里说清，别当成漏跑了一条**（实测，`git log -1 --format='%b'`）：
后端 `f38e629ad` 正文写「**4 条**变异探针全部变红：META/NODE 发射顺序〔A〕、`.doOnCancel` 退回 FAILED〔B〕、删 `.onErrorResume`〔C〕、**前端 tag 改 danger**〔D〕」；
前端 `9322e73cc` 正文写「变异探针**两条**，都变红：**D** tag 改 danger / **E** 确认框退回单层措辞」。
⟹ **4 + 2 = 6，而实际只有 5 条**：**探针 D 被两侧各数了一次**（它是**前端**变异，但由**后端**那条提交一并汇报，因为它的判据来自后端派生的 `cancellable`/状态标签口径）。
🔴 **这不是笔误也不是重复跑**，是「按仓库分提交」与「按判据分探针」两个口径交叉造成的**双计**；🔴 **去重后 = 本表这 5 行，一行不多一行不少**。
（前端 docs 提交 `666461b88` 的正文已按去重口径写「**五条**变异探针全红」，与本表一致。）

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

## 6. 本轮自己撞出 / 自纠出的 **19** 处（🔴 都记下来，包括自己写错的那几处）

> 第 1~10 条产生于**改代码与验收**阶段；第 **11~14** 条产生于其后的**台账取证**阶段
> （红线第 32 条要求「未修→已修」必须附 grep / 只读 SQL 实证），落在 `logs/35`~`37`；
> 第 **15~18** 条产生于再往后的**总账收尾回写**阶段，落在 `logs/38`~`41`；
> 第 **19** 条产生于最后的**写分册 §12 收尾报告**阶段，落在 `logs/42`。
> 🔴 全部**保留错误原文 + 紧跟补正段**，不删不改写 —— 因为「哪一次 grep / 哪一条 SQL 证明不了东西」本身就是证据的一部分。
> 🔴 **11~19 这九条同属一类**：「我写下的数字 / 描述与原始日志不符」。共同成因是**凭印象、或按「这条该证明什么」倒推**，而不是去**读**那份日志 —— 第 16 条把这个成因说得最直白。

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
| 11 | 🔴 **假阴性 grep**：为台账取证时用 `FAILED.equals` 去搜 `settle` 的失败分支，得 `GREP2_EXIT=1`，差点据此写成「该分支未被本轮改动」 | 自己复核时发现那个**字面量在源码里根本不存在** —— 真实写法是 `WorkflowExecutionStatusEnum.FAILED.getStatus().equals(status)` ⟹ `EXIT=1` **什么也没证明** | 换正确模式重跑（`GREP2B_EXIT=0`）并逐行比对，得到**两个都不是原 grep 能给的**结论：① 分支内**可执行行一行未改**（只动了一行注释）；② 但它的**上游**新增了 `rows == 0` 提前返回。补正段就写在原 grep 之后（`logs/35` ②补正） |
| 12 | 非空前提那条 SQL select 了 `def_id`，实测 `ERROR 1054 Unknown column 'def_id'` | 报错本身（`logs/37` ③ 段原样留着） | 真列名是 `workflow_def_id`。改完顺带发现执行表**自带** `recovery` 列 ⟹ 非空前提可以**直接在这 7 行上量**，不必关联 def（`logs/37` ③补正） |
| 13 | 🔴 行文写「这 7 行的 recovery 实测全是 `'compensate'`」—— **字面值大小写写错了** | 按红线第 29 条改用 `REGEXP_LIKE(col,pat,'c')` + `BINARY` 重测：`strict_lower=0 / strict_upper=7 / binary_lower=0 / binary_upper=7`，该列 collation = `utf8mb4_unicode_ci` | 库里存的是**大写 `COMPENSATE`**；`='compensate'` 能数出 7 **纯粹是 `_ci` 排序规则替我兜的**。🔴 **可复用教训**：在 `_ci` 列上用 `='小写字面量'` 做实证，**数对了也可能只是排序规则兜的**；台账凡引用「某列的字面取值」，必须另跑一次 `BINARY` / `REGEXP_LIKE(...,'c')` 才算实测到该值（`logs/37` ⑦补正） |
| 14 | 🔴 对照查询用 `JSON_EXTRACT(d.dsl,'$.recovery')`，6 行**全返回 NULL**，差点被读成「这些流程没配 recovery」 | 把「错路径」与「真路径」并排列出：`$.recovery` = NULL，`$.settings.recovery` = `compensate`（6/6） | recovery 嵌在 `settings` 下 ⟹ 那些 NULL 是**路径写错的产物**。这与 e2e 的两处代码完全一致（seed 写 `settings:{recovery:'compensate',…}`、守卫读 `seededDsl?.settings?.recovery`）。🔴 **可复用教训**：`JSON_EXTRACT` 返回 NULL **不能**读成「这一格没配」，先确认路径，否则会把「我查错了地方」写成「产品没这个配置」（`logs/37` ⑧补正） |
| 15 | 🔴 **`afterAll` 违规普查「少数了」**：第 02 轮分册 `-02` §13.4-4 记的「**5 条会造数据的 spec，`afterAll` 全都不校验**」（并被总账 §16.2 迭代 4 判据①第 3 行原样引用）**是少数**。精确重测：**A 类**（清理调用被 `.catch` 吞掉）grep 命中 **9 处 / 8 spec**，其中 `publish-live-version:109` 是**吞成对象后紧跟 `expect(r?.code).toBe(0)`** ⟹ 合规，故 **A 类实际违规 8 处 / 7 spec**（含 🔴 **本轮亲手新写的** `agent-workflow-cancel.spec.ts:186`）；**B 类**（裸 `await request.post/delete` 打清理接口）另命中 **13 处 / 8 spec**，🔴 **但 grep 分不出后面有没有跟 `expect`** ⟹ 只逐点核了 5 处（合规 2 / 违规 2），**其余 9 处 ⚠️ 本轮未测全 ⟹ B 类违规下界 2、上界 13，确切值不猜**（见 §8 第 3 条） | 回写台账时为验证判据①第 3 行而做的精确重测 | 🔴 **原句错在口径**：它只数了「会造数据的 spec」这一族，而违规面**比这一族宽**。改判据表那一行 + 记成本节的 f 行（§7）。🟢 **顺带一条好消息**：仓里**已有模范实现**（`publish-live-version` 的 `afterAll`，注释里明写「删除失败也要**出声**」）⟹ 第 05 轮做守卫**照抄即可，不必发明写法**；守卫的静态判据 = 「**A 类命中且其后 3 行内无 `expect`**」即报（`logs/38` A/B/C/D 四段） |
| 16 | 🔴 **变异探针 A 的「变异内容」被我写错**：判据表里写成「把**终态那一路**的事件顺序改坏」，实际是「**调换 `buildEventFlux` 里 META 与首个 NODE 的发射顺序**」，红点是 `run_happyPath_…:315`、报文 `expected: <META> but was: <NODE>` | `INDEX.md` 探针表第 101 行与 `logs/10` 里的 surefire 报文都指向后者 ⟹ 我写的那句**在日志里没有对应物** | 按日志逐字重写（探针 A/B/C 的变异内容、失败方法名、行号、断言文本全部对齐）。🔴 **写错的方向很典型、值得记下来**：我按「这条探针**应该**证明什么」去**倒推**它的变异内容，而不是去**读**那份日志 —— 🔴 倒推出来的描述**永远自洽**，所以自己看不出来（`logs/10`·`11`·`12`） |
| 17 | 🔴 「裸 grep `isFinal` 全仓命中 **35** 行」—— 实测是 **38** 行 | `logs/39-isfinal-callsites.log` §2 的原始输出 = **38**；那个 35 是**凭前一次搜索的印象**写的 | 改用 **38**，并同时写清**两个数不许混用**：**38** 是含注释、含 JDK `Modifier.isFinal` 干扰项的**裸命中**，**7** 才是**精确**调用点（且**全在 `src/test`**，`src/main` = **0**，`GREP_C_EXIT=1` 即 0 命中）。🔴 **这条自纠本身比数字重要**：它差一点把「`isFinal()` 零生产调用方」这个**第 05 轮 B3-4 的硬闸门**建立在一个错的分母上（`logs/39`） |
| 18 | 🔴 **判据表上方那句汇总的四个数字全错**：我写成「**11** 条判据里 6 过 / **5** 未过（其中 **4** 条属 1b）」 | 机械核对后是「**10** 条 / 6 过 / **4** 未过（其中 **3** 条属 1b、**1** 条属 17 条 e2e 棘轮）」 | 错因之一**可复算**：「`afterAll` 加固」与「那条 grep」**在表里是同一行**，被我当成两处 ⟹ 1b 从 4 降到 3；「11」的成因 ⚠️ **不明**（🔴 **不编**）。已改总账三处（3321 / 3350 / 3352），并**刻意保留**一处旧数字当反面记录。🔴 **由此生出一条纪律**：汇总句里的 N/X/Y 与表格里的行是**两处独立书写**，只要有一处是手数的就会漂，**而且漂了看不出来** ⟹ 以后一律用 `_r41-criteria-count.awk` 机械产出（含 `NF==6` 前提自证 + 两条自洽校验，`logs/41`） |
| 19 | 🔴 **§2 那句话与它自己上方三行的表格【直接矛盾】**：表格给了 3337 / 3346 / 3347 三行（3346 的线程列明明写着 `boundedElastic-1`），表格下面却写「**3346 → 3347 跨线程**（`http-nio` 取消 vs `boundedElastic-1` 收尾）证明了那道 SQL 守卫…」⟹ **这一对根本不跨线程**，而真正跨线程的那对（3337 → 3347）**没被点到** | 写分册 §12.5 要引用这条实测时，逐字段机械核对：`awk '{print $3}'` 三行 = `[http-nio-48080-exec-3]` / `[boundedElastic-1]` / `[boundedElastic-1]` ⟹ `SAME_THREAD=YES`（3346 vs 3347）、`CROSS=YES`（3337 vs 3347） | 拆成**两对、各证一件事**，不许合并：**3337 → 3347【跨线程】**（`cancel` 于 `AgentWorkflowExecutionServiceImpl:231` vs `settle` 于 `:522`，相隔 **0.692s**）证明**守卫在生产里真挡住了**迟到的收尾；**3337 → 3346**（相隔 **0.223s**，`ToolNodeExecutor:74` 还在 `execute`）证明**停不住已经在跑的那个节点**。🔴 3346/3347 这对**同线程**的只能讲「同一个节点跑完后**它自己的**收尾被拒」，写成「跨线程」会**同时讲坏两件事**（`logs/42`）。🔴 **顺带量出一个 awk 坑**：logback 的 level 字段**右补空格到 5 字符**（`INFO ` 后还有一个分隔空格）⟹ 连续两个空格被 awk 当成**一个空字段**，类名在 `$6` 不是 `$5`；**按列号取字段前必须先打印一次 `NF` 与逐列值** |

🔴 **第 13 / 14 条合起来还澄清了一处「看着像不一致、其实两侧各自正确」的地方**（别当 bug 去修）：
DSL 声明侧（前端 / e2e seed 写入）= **小写 `compensate`**；落库侧（后端按枚举写 `agent_workflow_execution.recovery`）= **大写 `COMPENSATE`**。
⟹ 跨两侧的比对必须大小写不敏感或先归一；只查单侧时按单侧字面值写。e2e 的守卫只读 DSL 侧，所以 `.toBe('compensate')` 是对的。

🔴 **第 10 条值得单拎出来讲一句方法论**：它是在**三层验收已经全绿、后端已提交、只等前端提交**的时候被自查拦下来的。
「验收全绿」完全没挡住它 —— 🔴 原因是**当时的判据 3 根本没管「它停在哪」**：它只断言三句 ⚠️ 后果
（`停不下正在执行的那个节点` / `不会触发补偿反做` / `不可恢复`）加一条 `not.toContain('**')`，
对位置措辞**零断言** ⟹ 单层措辞照样全绿。这一点是**实测的**，不是推断：`logs/23-e2e-cancel.log`（09:13）与
`logs/25-e2e-cancel-green.log`（09:14）两次 `1 passed / EXIT_CODE=0`，跑的正是**带缺陷的那版措辞**。
拦住它的是「新写的确认框必须与隔壁 `onResume` 同一条纪律逐句对照」这个动作，不是测试。
所以本轮补的不只是措辞，还有**让判据 3 从此管得住位置**的那四条断言（点名闸口 / 两半都在 / 不走「说不清」那档 / 无字面星号），
以及**让它变不成空断言**的非空守卫（`suspendNode==='gate'` 且 `currentNode==='list'`，两者必然不同 ⟹ 点名闸口那半不可能靠 `current_node` 蒙对）。

---

## 7. 🔴 方案文档与实测不符的 **6** 处（如实报告，**不改方案原文**）

🔴 **原本记的是 5 处，第四次刷新时补了第 6 处（f 行）**：它来自「回写台账时为验证判据①第 3 行而做的精确重测」（即 §6 第 15 条），
🔴 **而这次重测同时证伪了第 02 轮分册 `-02` §13.4-4 记的那个数**。

| # | 方案怎么写 | 实测是什么 | 证据 |
|---|---|---|---|
| a | §6 提到 `AgentWorkflowExecutionServiceTest` | **该文件不存在**。且 `git grep -E "doOnCancel\|CANCELLED\|用户中断" HEAD -- yudao-module-agent/src/test` **为空**（`grep_exit=1`）⟹ 改之前**没有任何**既有断言钉住「取消 → FAILED」，本轮也**没有**把任何一条既有断言从红改绿 | 于 HEAD 复算，见后端提交前的复核 |
| b | §5① 用 `/v3/api-docs/agent` 验接口注册 | **该组不存在**；返回 HTTP 200 + `{"code":500,"msg":"系统异常"}`，45 字节。正确 = `/v3/api-docs/all` + key `/admin-api/agent/workflow/cancel` | `logs/20-apidocs-agent.json`、`logs/20-apidocs.log` |
| c | §7 的只读 SQL 模板 select 了 `reason` 列 | `agent_workflow_execution` **没有 `reason` 列**，取消原因的载体是 **`error_msg`** | `logs/21-behavior-probe.log` 第 4 段 |
| d | §7-4 写的 PID 是 13400 / 12448 | 已失效。实测当时是 **4052**（后端）/ **12332**（maven）；本轮重启后端之后是 **22368** | `logs/18-backend-boot.log` |
| e | 🔴 **总账 §7.2 的 B3-9 行**，「核实到的实况」列写「该文件里仍是 `throw err`；无 CANCELLED 分支」 | **前半句记错了条目**：`ExecutionHistoryDrawer.vue` 里那处 `throw err` **不属于 B3-9**，它在 `onResume` 的 `fetchEventSource` `onerror` 回调里，是**刻意的防无限重连守卫**（同处已先写 `detail = '连接中断，恢复结果未知——请先刷新列表看这条执行的最新状态，不要直接再点一次'`，注释也写明「不抛异常 fetchEventSource 就会无限重连，把同一次恢复反复打后端」）。B3-8 说的三处 `throw err` 在 `AssistantChat.vue`（实测路径 = `src/views/agent/assistant/components/AssistantChat.vue`，`grep -c "throw err"` = **3**，本轮未动）。🔴 **所以照总账那句去「修」B3-9 = 引入缺陷**：删掉它会让一次恢复失败变成无限重连。后半句「无 CANCELLED 分支」为真，已修 | `logs/36-ledger-writeback-grep-fe.log` 第 ⑩ / ⑨补正 段 |
| f | 🔴 **第 02 轮分册 `-02` §13.4-4**（并被总账 §16.2 迭代 4 判据①第 3 行原样引用）：「**5 条会造数据的 spec，`afterAll` 全都不校验**」 | **少数了。** 精确重测：**A 类**（清理调用被 `.catch` 吞掉）grep 命中 **9 处 / 8 spec**，其中 `publish-live-version:109` 是**吞成对象后紧跟 `expect(r?.code).toBe(0)`** ⟹ 合规，故 **A 类实际违规 8 处 / 7 spec**（`cancel:186`〔🔴 **本轮亲手新写的**〕· `copy:237` · `copy:244` · `editor-readonly:167` · `replay:115` · `resume:199` · `version:106` · `prompt-template-case:319`）。**B 类**（裸 `await request.post/delete` 打清理接口）另命中 **13 处 / 8 spec**，🔴 **但 grep 分不出后面有没有跟 `expect`** ⟹ 只逐点核了 5 处（合规 2：`webhook-auth:56`/`:138`；违规 2：`chat-route:101`/`hitl-chat:99`），**其余 9 处 ⚠️ 未测全 ⟹ B 类违规下界 2、上界 13，确切值不猜**。🔴 **原句错在口径**：它只数了「会造数据的 spec」这一族，而违规面**比这一族宽** | `logs/38-afterall-census.log`（A/B 两类逐处清单 + C1~C6 逐点上下文 + D 结论段） |

---

## 8. ⚠️ 三项证据缺口（🔴 红线第 35 条：写不出日志位置就标不可复算）

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
3. ⚠️ **B 类 `afterAll` 的 13 处里，只逐点核了 5 处，其余 9 处本轮未测全**（§6 第 15 条 / §7 f 行）。
   🔴 **grep 给不出这个结论**：B 类的形状是裸 `await request.post/delete` 打清理接口，
   **后面有没有跟 `expect`** 必须逐点读上下文才知道，不是模式匹配能判的 ⟹ 这 9 处只能标 ⚠️ **未测全**，
   违规数**只给区间（下界 2、上界 13），确切值不猜**（红线第 9 条：允许写「⚠️ 无法判定」，但必须写清缺什么信息）。
   缺的就是**这 9 处的逐点上下文**；读法已写进 `logs/38-afterall-census.log` 的 C 段（C1~C6 是已核那 5 处的样板），
   🔴 **第 05 轮做 1b 时开工第一件事就是把这 9 处补核完**（见 §9 第 6 条）。

---

## 9. 交棒给第 05 / 06 / 07 轮

1. `WorkflowExecutionStatusEnum` 现在**有** `CANCELLED`，且 `isFinal()` **已含** CANCELLED、**仍不含** FAILED。
   🔴 第 05 轮（B3-4）把 FAILED 加进 `isFinal()` 时，`WorkflowExecutionStatusEnumTest` 里那条
   「不含 FAILED」的断言会**按设计变红** —— 那是预期，改断言即可，别当成回归。
2. 🔴 `isFinal()` 目前**零生产调用方**（实测，📄 `logs/39-isfinal-callsites.log`：裸 grep 全仓命中 **38** 行，**精确**口径真调用 **7** 处、**全在 `src/test`**，`src/main` = **0**，`GREP_C_EXIT=1`）。
   🔴 **两个数不许混用**：**38** 是含注释、含 JDK `Modifier.isFinal` 干扰项的**裸命中**，**7** 才是调用点（§6 第 17 条就是这两个数被我混成 35 的自纠）。
   第 05 轮要先找出「本该用 `isFinal` 却在手写状态集合」的地方，
   否则把 FAILED 加进去同样**不改变任何行为**，那一轮就会重演「配了但不生效且无提示」。
   🔴 **硬闸门**：B3-4 收工时**重跑一次 `logs/39` §4 那条**（`src/main` 命中数），**若仍是 0，B3-4 就是纸面修复、判据不算过**。
3. 🔴 **第 07 轮（告警面）必须显式排除 `CANCELLED`**。本轮已让「取消」不再走
   `AgentWorkflowExecutionServiceImpl` 里那个 `if (FAILED.equals(status))` 分支（它同时管补偿与告警），
   但那是**因为状态不再等于 FAILED**，**不是**新增了排除判断。第 07 轮若把告警条件重写成
   「非成功即告警」之类的形态，会把 CANCELLED 重新卷进告警面 —— 正是本轮消除的第三层错。
   🔴 **所以第 07 轮的判据必须是「grep 到那句显式排除」+「一条把 CANCELLED 塞进告警条件的变异探针真变红」**，
   不能是「跑一遍没告警」—— 后者今天**作为副产品已经成立**，证明不了任何新增的守卫（`COMPENSATED` 同理）。
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
7. 🔴🔴 **1b（`afterAll` 返回码校验）第 04 轮【未交付】，顺延第 05 轮，且【不许再顺延】**（它已经被推过一次）。三条现成的料，别重新发明：
   · **范围**：精确重测后 **A 类违规 8 处 / 7 spec**（比第 02 轮记的「5 条 / 6 处」**多**，见 §7 f 行），**B 类违规下界 2 / 上界 13、⚠️ 未测全**（§8 第 3 条）⟹ 第 05 轮开工先把 B 类那 9 处补核完（📄 `logs/38` C 段有逐点上下文的读法）。
   · **模范实现仓里已有**：`tests/e2e/agent-workflow-publish-live-version.spec.ts` 的 `afterAll`（吞成对象后紧跟 `expect(r?.code, '…应成功，实际 ${JSON.stringify(r)}').toBe(0)`，注释里明写「删除失败也要**出声**」）⟹ **照抄即可**。
   · **守卫的静态判据**：「**A 类命中且其后 3 行内无 `expect`**」即报（📄 `logs/38` D 段）。
   🔴 **本轮的实证是：没有守卫，纪律就会当场被写下它的人自己破掉** —— 新写的 `agent-workflow-cancel.spec.ts:186` 就是 `.catch(() => {})`。
8. 🔴 **开工先重拉第 02 轮那 17 条 e2e 棘轮当基线**：第 04 轮**没拉**（`logs/` 里 4 条 e2e 全是单条 `agent-workflow-cancel.spec.ts`），
   这是本轮 10 条判据里**唯一**那条不属 1b 的未过项。
   第 05 轮要动 `isFinal()`，会**按设计**让 `WorkflowExecutionStatusEnumTest` 那条「不含 FAILED」的断言变红 ⟹ **先有 17 绿基线，才分得清「预期红」与「新红」**。
9. 🟢 **一条本轮付了学费才拿到的写报告纪律**：**「汇总句里的数字」与「表格里的行」是两处独立书写，只要有一处是手数的就会漂，而且漂了看不出来**（§6 第 18 条：把「10 条 / 6 过 / 4 未过」写成「11 / 6 / 5」，还把同一行拆成两处算进归因）。
   ⟹ 以后凡写「N 条判据里 X 过 / Y 未过」，**N/X/Y 一律用程序产出**，且**程序本身要一起归档**（`logs/_r41-criteria-count.awk`）—— 🔴 只归档输出的话，下次改了表就没法重跑，那份输出立刻退化成「一句无法核对的话」。
   📄 用法与「`START` 行号会漂、每次必须重新 grep」的告戒见归档 `INDEX.md` §十二。

---

## 10. 复算入口（一条命令看懂本轮全部判据）

```bash
# 归档区自校（🔴 当前口径 67 条 = 第五次刷新；下面每个期望值都是 2026-10-08 本次提交前**实跑**出来的）
cd /c/code/yudao_backups/iter7-round04 && pwd
sha256sum -c MANIFEST.sha256 | grep -c ': OK$'      # 67
sha256sum -c MANIFEST.sha256 | grep -c 'FAILED'     # 0
sha256sum -c MANIFEST.sha256 > /dev/null 2>&1; echo "CHECK_EXIT=$?"   # 0
wc -l < MANIFEST.sha256                             # 67（自检 1 上）
find logs probe probe-backup -type f | wc -l        # 67（自检 1 下，必须相等）
awk '{print $2}' MANIFEST.sha256 | sort | uniq -d   # 空（自检 2）
awk '{ if (substr($2,1,1) != "*") c++ } END{print c+0}' MANIFEST.sha256   # 0（自检 3：-b 格式）
grep -c 'MANIFEST.sha256\|INDEX.md' MANIFEST.sha256 # 0（自检 4：不得自指）
sha256sum MANIFEST.sha256                           # 12abd37374e5e660b5f632e2379e7aa10dd35a03f4e2aee14aef2c59d548b7ff
sha256sum INDEX.md                                  # 59437b8698fddac420d0fdab782789b6ecfaaa26f70b840064cf9f7f7b197dc3
find . -type f | wc -l                              # 69（= 67 + INDEX.md + MANIFEST 自身）
du -sb .                                            # 5515273（🔴 含 INDEX.md 自身，与 INDEX 里自记的值必然差一点）
awk '{print $2}' MANIFEST.sha256 | sed 's#^\*##; s#/.*##' | LC_ALL=C sort | uniq -c   # logs 49 · probe 7 · probe-backup 11
                                                    # 🔴 中间那个 `sort` 不能省：清单不是按目录排版的，省了就得到一串交错的碎片计数

# 🔴 自检 5（第四次新加）：刷新只许「加」，不许改任何一条既有哈希
LC_ALL=C sort /c/code/yudao_backups/_MANIFEST.prev.r04b.tmp > /tmp/prev.sorted   # 第五次刷新前的那份 = 66 行
LC_ALL=C sort MANIFEST.sha256 > /tmp/new.sorted
comm -23 /tmp/prev.sorted /tmp/new.sorted | wc -l   # 0（旧 66 行一条都没丢/没变）
comm -13 /tmp/prev.sorted /tmp/new.sorted | wc -l   # 1（第五次只新增 logs/42-thread-pair-check.log）
comm -13 /tmp/prev.sorted /tmp/new.sorted           # 逐行列出那 1 条
# 🔴 自检 5b（本次提交前新加）：与**已入 git** 的那份（`666461b88`，58 行）比 —— 跨三次刷新看「只加不改」是否仍成立
cd /c/code/yudao/yudao-ui-admin-vue3 && git show "HEAD:docs/iter7/round04-执行生命周期一取消语义-MANIFEST.sha256" | LC_ALL=C sort > /tmp/head.sorted
comm -23 /tmp/head.sorted /tmp/new.sorted | wc -l   # 1（🔴 唯一那条 = 活日志 logs/18 的【旧快照】哈希 ff296d91…，第四次刷新时重取过快照）
comm -13 /tmp/head.sorted /tmp/new.sorted | wc -l   # 10（= 新快照哈希 1 + logs/35~42 共 8 + awk 程序 1）

# 集合一致性 + 漂移扫描（🔴 唯一那份 DRIFT 必然是活日志 18-backend-boot.log）
cd /c/code/yudao/ruoyi-vue-pro/_logs/r04 && pwd
A=/c/code/yudao_backups/iter7-round04
ls -1 | wc -l                                        # 50（源侧；🔴 比归档多 1 = 18-backend-boot.done，见「§1 集合一致性」那段）
find "$A/logs" -maxdepth 1 -type f | wc -l           # 49（归档侧）
ls -1 | LC_ALL=C sort > /c/Users/ling-/_r04_src6.txt
find "$A/logs" -maxdepth 1 -type f -printf '%f\n' | LC_ALL=C sort > /c/Users/ling-/_r04_dst6.txt
comm -23 /c/Users/ling-/_r04_src6.txt /c/Users/ling-/_r04_dst6.txt   # 1 行：18-backend-boot.done（内容只有 `finished`，完成标记，晚于第五次刷新）
comm -13 /c/Users/ling-/_r04_src6.txt /c/Users/ling-/_r04_dst6.txt   # 空

# 三层验收的关键行
grep -a 'EXIT_CODE' logs/*.log                       # 每份日志的判据行
grep -a 'Tests run: 1747' logs/*fullmodule*.log      # 后端全量三次
grep -an '\[cancel\]\|已被取消' logs/18-backend-boot.log   # 🔴 实测 8 行 = 7 条 [cancel]（执行 151/152/154/155/156/157/159）+ 1 条 [settle]…已被取消（152 的迟到收尾）
                                                          # 7 条 [cancel] 与残留里 CANCELLED=7 对得上；两条 INTERRUPTED（153/158）来自两次**中途失败**的 e2e，没点到「仍要取消」
grep -ac '\[compensate\]' logs/18-backend-boot.log   # 0 ⟹ 取消确实没触发反做
grep -a '1 passed' logs/23*.log logs/25*.log logs/29*.log logs/32*.log   # e2e 四次全绿
grep -a 'EXIT_CODE=1' logs/10*.log logs/11*.log logs/12*.log logs/24*.log logs/30*.log  # 五条变异探针全红

# 🔴 台账回写的实证（红线第 32 条：「未修→已修」不许只附 commit hash）
grep -n 'CANCELLED' logs/35-ledger-writeback-grep.log        # ① .doOnCancel 现落 CANCELLED
grep -n '假阴性\|一行未改\|rows == 0' logs/35-ledger-writeback-grep.log   # ② FAILED 分支的**准确**结论 + 那次错 grep 的补正
grep -n 'isFinal' logs/35-ledger-writeback-grep.log          # ④ 🔴 isFinal( 在 src/main **零调用方**
grep -n 'throw err' logs/36-ledger-writeback-grep-fe.log     # ⑩ 改判：它属 onResume 的防重连守卫，**不是** B3-9 的缺陷
grep -n 'CANCELLED\|用户中断' logs/37-ledger-writeback-sql.log           # ①② 库里真有 CANCELLED=7，且反证「用户中断 但 FAILED」=0
grep -n '补正' logs/37-ledger-writeback-sql.log              # ③⑦⑧ 三次量测错误就地补正（列名 / 大小写 / JSON 路径）

# 🔴 收尾回写阶段的实证（第四次刷新新增；对应 INDEX.md「十二」与另外 4 处自纠）
sed -n '/=== D) 结论/,/^$/p' logs/38-afterall-census.log    # A 类实际违规 8 处 / 7 spec；B 类下界 2 上界 13 ⚠️ 未测全
sed -n '/--- C1)/,/--- C2)/p' logs/38-afterall-census.log    # 🔴 仓里【已有模范实现】= publish-live-version 的 afterAll，第 05 轮照抄即可
sed -n '/--- 2)/,/--- 3)/p' logs/39-isfinal-callsites.log    # 裸 grep = 38（🔴 不是 35）
sed -n '/--- 4)/,/--- 5)/p' logs/39-isfinal-callsites.log    # src/main = 0（GREP_C_EXIT=1 即 0 命中）⟹ B3-4 的硬闸门
grep -n '判据' logs/40-redline-numbering-check.log           # 红线第 36 条要求的 4 项机械核对，全过（38 条 / 17 小节）
grep -n '11 条\|10 条' logs/41-criteria-count.log            # 那个写错的汇总句 + 机械重数的结果
cd /c/code/yudao && grep -n '实测结果（2026-10-07）' 流程编排模块重构方案-迭代七.md   # 🔴 取 START：两个同形表头（迭代3 / 迭代4），只数后者
LC_ALL=C awk -v START=<上行取到的迭代4表头行号> \
     -f ruoyi-vue-pro/_logs/r04/_r41-criteria-count.awk \
     流程编排模块重构方案-迭代七.md                          # 数据行 10 · ✅ 6 · ❌ 4 · 1b=3 / 棘轮=1 · 两条自洽校验 YES

# 🔴 第五次刷新新增：§2「跨线程」那处自纠的实证（对应 §6 第 19 条）
sed -n '/SAME_THREAD/,$p' logs/42-thread-pair-check.log   # 两对结论：3346/3347 同线程（SAME_THREAD=YES）、3337/3347 跨线程（CROSS=YES）
grep -n 'NF=' logs/42-thread-pair-check.log               # 🔴 awk 字段坑：logback 把 level 右补空格 ⟹ NF=13、$5 是空字段、类名在 $6

# 提交清单（后端 1 + 前端 3；🔴 docs 各自另起，不混进 feat，也不 amend 前一条）
cd /c/code/yudao/ruoyi-vue-pro       && git show --numstat f38e629ada   # 后端：11 文件 +1391/−16（生产 +417 / 测试 +974）
cd /c/code/yudao/yudao-ui-admin-vue3 && git show --numstat 9322e73cc    # 前端 feat：3 文件 +510/−2（其中 e2e spec +347）
cd /c/code/yudao/yudao-ui-admin-vue3 && git show --numstat 666461b88    # 前端 docs①（🔴 钉的是**第二次**口径）：2 文件 +379
cd /c/code/yudao/yudao-ui-admin-vue3 && git show --numstat 04c2e931a    # 前端 docs②（一次覆盖**第三 + 第四 + 第五次**口径重钉 + §2 那处自纠的正文改正）：2 文件 +243/−86
cd /c/code/yudao/yudao-ui-admin-vue3 && git log --oneline --all -- "docs/iter7/round04-执行生命周期一取消语义-摘要.md"
    # 🔴 这条命令本身就是「第三、第四次那轮所谓已追加提交＝假话」的实证：它逐条列出本文件真被提交过几次（最上面那条 = docs③ = 本次修正）
cd /c/code/yudao/yudao-ui-admin-vue3 && git show --numstat 9af7115ef    # 迭代八 U3：_evidence/ 33 个文件逐条入白名单（29 文件 = .gitignore + 28 份新入仓证据）
```
