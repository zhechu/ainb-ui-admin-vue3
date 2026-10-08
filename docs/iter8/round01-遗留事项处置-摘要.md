# 迭代八 · 第 01 轮 · 遗留事项处置（U3 / U4 / U2 第 0 步 / §二·E）· 摘要

> **这份文件为什么在前端仓**：与迭代七各轮同理 —— 两份规划文档（总账 + 分册）在 `C:\code\yudao`，
> 而**那个目录不是 git 仓库** ⟹ 文档本身任何仓都进不去，只能把「这一轮干了什么、证据在哪」钉进 git。
> 执行权威：`C:/code/yudao/流程编排模块重构方案-迭代八-01-遗留事项与待裁定清单.md`（🔴 **本轮按约定没有回写它**）。
>
> 🔴 **本轮四条边界，先说清楚**：**没有**启动任何 e2e（T1 第 2 轮脚本仍写好未跑）、**没有**花任何厂商额度、
> **没有**删除或修改任何一行业务数据、**没有**动 `ai_model` / `ai_api_key` 任何一行。
> 只做了：3 个未提交文件落地（U4）、`_evidence/` 白名单扩到 33 条（U3 前端半边）、G1 清理面**备份**（U2 第 0 步）、
> `_logs/r10/` 归档到仓外 + 敏感面扫描（§二·E 的替代路径）。

| 项 | 值 |
|---|---|
| 执行时间 | **2026-10-08** 23:40 ~ 23:58（备份 23:55:22、归档第一遍 23:56:17、第二遍 23:57:57） |
| 本轮提交 | 后端 **1** 条（`0298422a04`）+ 前端 **4** 条（`04c2e931a` docs② / `9af7115ef` chore / `cb5f88561` docs③ / 本文件所在那条） |
| 仓外归档区①（DB 备份） | `C:/code/yudao_backups/iter8-g1-db/` —— **11 个文件 / 14,720,144 B**（`dumps/` 10 份 `.sql` + `MANIFEST.sha256`） |
| 仓外归档区②（r10 日志） | `C:/code/yudao_backups/r10/` —— **78 个文件 / 10,847,346 B**（`logs/` 75 + `MANIFEST.sha256` + `MANIFEST.pass1.sha256` + `_pass2.log`）🔴 后两样在清单之外，且 `_pass2.log` 是**活文件**，`du` 会继续长；`MANIFEST.sha256` 只钉 `logs/` 那 75 份 |
| 本仓副本 | 本文件 + `round01-G1数据库备份-MANIFEST.sha256`（**10** 行，sha256 = `f6aeca851a8be7fd66fb1ac057046fec6e873c8b63d29a498bebd0c69d08dd40`）+ `round01-r10日志归档-MANIFEST.sha256`（**75** 行，sha256 = `110763a4a1e6f10092efeb8351bdab93edb5d0563ea7840d9fe6dd3352587d68`）；两份都是仓外那份的**逐字副本**，当前工作树 `cmp` → **`CMP_EXIT=0`**。🔴 本仓 `core.autocrlf=true` 且无 `.gitattributes`，**重新 checkout 会把副本 smudge 成 CRLF、`cmp` 随之变红**（行尾差异，非内容差异）；与 checkout 历史无关的判据见 §6③ 的「CRLF 免疫版」（比 blob 的 sha256） |
| 原始日志（脚本 + 输出，全在仓外归档区②里） | `43-iter8-g1-backup.sh` / `.log` · `44-iter8-r10-archive.sh` / `.log` · `45-iter8-r10-archive-pass2.sh` · `_pass2.log` |

---

## 1. U2 第 0 步 · G1 清理面备份（**只读 + 落盘，清理本身没做**）

落点选 `C:/code/yudao_backups/`（工作区**外**）：`C:/code/yudao/_backups/` 已废弃 —— 那里 17 个文件在 2026-10-06 10:51 前后凭空消失过。

🔴 **备份了 10 张表，比方案里写的「5 张」多**：备份不挑，清理才挑。多备的几张也在清理面里（迭代八 §1.4 全表），
而且 `mysqldump --single-transaction` 是一致性快照、不锁表，多备没有代价。

| 表 | 总行 | 存活 | 软删 | dump 字节 |
|---|---|---|---|---|
| `agent_workflow_def` | 182 | 32 | 150 | 761,914 |
| `agent_workflow_execution` | 38 | 36 | 2 | 485,478 |
| `agent_node_execution` | 100 | 98 | 2 | 608,841 |
| `agent_conversation` | 619 | 4 | 615 | 107,111 |
| `agent_message` | 1200 | 17 | 1183 | 10,473,799 |
| `agent_planner_adoption` | 31 | 31 | 0 | 180,137 |
| `agent_usage_log` | 1260 | 1260 | 0 | 850,760 |
| `infra_data_model` | 309 | 299 | 10 | 59,535 |
| `graph_thread` | 38 | —（无 `deleted` 列） | — | 4,143 |
| `graph_checkpoint` | 150 | —（无 `deleted` 列） | — | 1,187,542 |

🟢 这 10 行计数与迭代八 §1.4 那张快照表**逐项相符**（那次是 23:24，这次是 23:55，中间没有任何写入 ⟹ 侧面印证「数据库侧没有流程在跑」）。

**自检（全部实跑，`43-iter8-g1-backup.log`）**：10 份 dump 全部 `DUMP_EXIT=0`、`stderr 额外行=0`（只允许 mysqldump 那句「Using a password…」）；
每份都同时含 `CREATE TABLE` 与 `INSERT INTO`（🔴 加了 `--skip-dump-date`，为的是**可复跑逐字节相同**）；
`sha256sum -c` → **`CHECK_EXIT=0`、`OK=10`、`FAILED=0`**；清单 **10** 行 = `dumps/` 文件数 **10**。

**U2 第 1 步的进程查询证明（备份时点，23:55:22）**：`information_schema.processlist` 里非 `Sleep` 只有 2 条 ——
`event_scheduler`（Daemon，`Waiting on empty queue`）与我自己那条 SELECT ⟹ **数据库侧没有任何流程在跑**。
🔴 **这份不能顶替动手那天的证明**：U2 明确要求「动手当天重新证明一次」。

---

## 2. §二·E 替代路径 · `_logs/r10/` 归档到仓外（**没有加白名单进 git**）

走了方案里我提的那条路：整体归档到工作区外 + 生成 sha256 清单 + 清单副本入 git。跑了两遍：

| | 第一遍（`44-*.log`） | 第二遍（`_pass2.log`） |
|---|---|---|
| 清单行数 | 74 | **75** |
| `sha256sum -c` | `CHECK_EXIT=0`、`OK=74`、`FAILED=0` | **`CHECK_EXIT=0`、`OK=75`、`FAILED=0`** |
| 集合一致性（源 vs 归档） | 74 / 74，双向 `comm` 均空 | **75 / 75，双向 `comm` 均空** |
| 逐字节 `cmp` | `SAME=72 DIFF=2` | **`SAME=74 DIFF=1`** |
| 清单自身 sha256 | `4a443b3a6bc5adbe…`（已存为 `MANIFEST.pass1.sha256`） | **`110763a4a1e6f100…`**（= 本仓那份副本） |

**为什么要跑第二遍**：第一遍那 2 份 DIFF 是**活文件** —— `44-iter8-r10-archive.log`（正在被自己写）与
`36-backend-restart-3.log`（后端进程还在写）。第二遍重拷了这两份，并把 `45-*.sh` 自己也拷进归档，
于是集合一致性做到双向全空。🔴 **「只加不改」核过**：与第一遍清单逐行比 = 旧有新无 **2** / 新增 **3**，
变的那 2 行正是那两个活文件，新增的 3 行 = 它们重拷后的新哈希 + `45-*.sh`，**没有任何一行既有哈希被悄悄改掉**。

🔴 **仍剩 1 份 DIFF，如实记**：`36-backend-restart-3.log` 归档快照冻结在 **1,547,819 B**（mtime 23:57:54），
源侧此刻仍在长（后端 PID 13996 在跑）。与迭代七第 04 轮对 `logs/18-backend-boot.log` 的口径一致：**刻意不追**，
因为重拷只是把漂移点往后挪，而 `sha256sum -c` 校的是**归档副本对自己那条哈希**，两侧同为冻结字节 ⟹ 自洽性不依赖活源。

**清单三条自检**：重复行 = **0** · 格式（`-b`）异常行 = **0** · 自指行（含 `MANIFEST` / `_pass2` / `INDEX`）= **0**。
🔴 `_pass2.log` 与 `MANIFEST.sha256` 刻意**写在归档根、不进清单**：它们正是**记录校验结果**的那两份，放进去会自指（结果一写进去，自己那条哈希立刻失效，永远收敛不了）。

---

## 3. 🔴 敏感面机械扫描：这就是「`_logs/r10/` 能不能加白名单进 git」的判据

`.gitignore:63` 写的理由是「`_logs` 里的后端日志原样含着【匿名 webhook 打进来的完整请求体】」。
方案里我说「可以逐个扫，但扫完的结论要你签字」—— **扫描做了，结论是：不能加白名单。** 命中计数如下（🔴 只给计数，不把内容抄进 git）：

| 模式 | 命中文件数 | 命中总行数 |
|---|---|---|
| `webhook` | 5 | **43** |
| `Authorization` | 9 | **101** |
| `Bearer ` | 6 | **7** |
| `password` | 20 | **112** |
| `tenant-id` | 7 | 20 |
| `AccessKey` | 1 | 2 |
| `secret` | 3 | 5 |
| `sk-[A-Za-z0-9]{16,}` / `api[_-]?key` | **0** | **0** |
| 单行 > 2000 字符（长 JSON 请求体迹象） | 2 | **30** |

命中最密的 5 个文件：`21-backend-restart-2.log` **737** 行 · `36-backend-restart-3.log` **48** · `19-agent-full-tests-4.log` **38** ·
`12-agent-full-tests-3.log` **38** · `10-agent-full-tests-2.log` **38**。

🔴 **两点必须说清楚，别把这张表读反**：
1. **没有扫出厂商密钥**（`sk-…` / `api_key` 命中 0）—— 与 `HardcodedVendorKeyBanTest` 那条守卫的口径一致，本轮也没往源码里写过密钥。
2. `password` 那 112 行**有很大一部分是我自己的脚本**：`43-*.sh` / `40-*.sh` / `39-*.sh` / `34-*.sh` 里的 `mysql -uroot -p123456`
   （本地开发库口令，明写在命令行上）。它不是厂商密钥，但**照样不该进 git** —— 而 `Authorization` / `Bearer` / `webhook` 那三类
   是**后端实时日志原样收进来的请求头与请求体**，无法靠「挑几行」安全地摘出来。
   ⟹ 所以走的是**「仓外归档 + 清单入 git」**，不是「加白名单」。要推翻这个结论、改成加白名单，得先人工逐份过那 5 个高密文件并签字。

---

## 4. U4 / U3 · 3 个未提交文件已落地，`_evidence/` 白名单 5 → 33

| 项 | 处置 | 提交 |
|---|---|---|
| 后端 `AiModelFailoverServiceImpl.java`（+9 行 INFO 日志） | 🔴 **先按实测改正注释里两个错数**（启用模型 `16 → 15`、剔除后 `6 → 13`），并写明「变少」的真实机制是 **60 秒冷却在按设计干活**（链首 77 / 79 接连失败被冷却），不是缺陷；`mvn -o -pl yudao-module-ai compile` → `EXIT_CODE=0` | `0298422a04` |
| 前端 `round04-…-摘要.md` + `round04-…-MANIFEST.sha256`（从第 04 轮挂到现在） | 补提交。🔴 **提交前先与仓外归档对齐**：仓内清单停在第四次（66 条），归档已刷到第五次（67 条，多 `logs/42-thread-pair-check.log`）；照原样提交会把「66 条 / 逐字副本 `cmp=0`」变成假话。已用仓外那份覆盖，**覆盖前证过「旧 66 行一条没丢」**，并重跑全部自检（`OK=67 FAILED=0`，`/c/Users/ling-/_r04_verify6.txt`） | `04c2e931a` |
| ↳ 顺带翻出的一句假话 | 摘要原写「第三、第四次刷新均已**追加 docs 提交**」—— `git log --oneline --all -- 摘要.md` 证明**从没发生过**（那两轮的重钉只做到工作树里，这正是它一直挂着的原因）。已改成实话并把查法写进摘要 | `cb5f88561` |
| 前端 `_evidence/`（33 个文件，原先只有 5 条白名单） | `.gitignore` 白名单 **5 → 33**，`git ls-files _evidence` 同步 5 → 33。🔴 **一个文件都没挪位置**：`hint-satisfaction.mjs` 里的 `SPEC` / `GAPS` 用**相对 URL**，一挪就断、且断得悄无声息。入仓前逐个扫过：无密钥、无 `Authorization` 头、无 webhook 请求体（33 文件 / 590,297 B）。仍**逐条**白名单、不整目录放开 | `9af7115ef` |
| `_tmp/`（前后端） | 本来就是 **0**，无需处置 | — |

---

## 5. 🔴 本轮【没有做】的事，以及各卡在哪

| 项 | 为什么没做 |
|---|---|
| **U1 / A8**：T1 第 2 轮 | 棘轮目标数**未定**（22 是在 76 上量的、76 已停用；23 是在 75 上量的、75 也已停用；链子现在落在 **80**，80 上是多少没人量过）。卡在 **§二·A** 的裁定；`_logs/r10/38-run-t1-round2.sh` 仍**写好未跑**。🔴 也没动 `KNOWN_REFUSAL_COUNT` / `KNOWN_REFUSED_IDS` 一个字符 |
| **U2 第 2 步**：真接口清理（清 `416/417/418/503`、保留 `519/525`，再走强删档） | **不可逆**、且动的是共享库。备份已就位（§1），但删之前要①动手当天重新做进程证明、②拿到明确放行。本轮**一行没删** |
| **U5**：spec 里那句「用例体实测跑了 45.6 分钟」 | 方案明写「拿到 §二·A 裁定之前不要动这个注释」，且 🔴 e2e 在跑的时候不许改 spec |
| **`ai_model` / `ai_api_key`** | §二·A / B / D 全都需要裁定（重新启用 76？停用必坏的 77 / 79 / 86 / 88 / 89？钉不钉 D-1？）。「不擅自启用第三方付费账号上的模型、不改 `ai_model.status`」这条红线仍然有效 |
| **U6 末尾那条建议**（给 `ai_model` / `ai_api_key` 补变更审计） | 是**新功能**、不是遗留处置，且要先定「记到哪张表、记哪些字段」。本轮只把它记在这里，没动代码 |

---

## 6. 复算入口

```bash
# ① G1 数据库备份自校（🔴 期望值全部是 2026-10-08 23:55 那次实跑的输出）
cd /c/code/yudao_backups/iter8-g1-db && pwd
wc -l < MANIFEST.sha256                                  # 10
find dumps -type f | wc -l                               # 10（必须与上行相等）
( cd dumps && sha256sum -c ../MANIFEST.sha256 >/dev/null 2>&1; echo "CHECK_EXIT=$?" )   # 0
sha256sum MANIFEST.sha256                                # f6aeca851a8be7fd66fb1ac057046fec6e873c8b63d29a498bebd0c69d08dd40
du -sb .                                                 # 14720144
grep -c 'CREATE TABLE' dumps/*.sql                       # 每份都必须 ≥1（结构 + 数据都在，不是空壳）

# ② r10 日志归档自校（🔴 期望值是 23:57:57 第二遍的输出）
cd /c/code/yudao_backups/r10 && pwd
wc -l < MANIFEST.sha256                                  # 75
find logs -type f | wc -l                                # 75
( cd logs && sha256sum -c ../MANIFEST.sha256 >/dev/null 2>&1; echo "CHECK_EXIT=$?" )     # 0
( cd logs && sha256sum -c ../MANIFEST.sha256 2>/dev/null | grep -c ': OK$' )             # 75
sha256sum MANIFEST.sha256                                # 110763a4a1e6f10092efeb8351bdab93edb5d0563ea7840d9fe6dd3352587d68
awk '{print $2}' MANIFEST.sha256 | sort | uniq -d        # 空
grep -c -E 'MANIFEST|_pass2|INDEX' MANIFEST.sha256       # 0（清单不自指）
# 集合一致性：文件名集合【双向全等】（75/75）。漂移只在**内容**上，且只允许是活日志 36-backend-restart-3.log（见 §2）
diff <( cd /c/code/yudao/ruoyi-vue-pro/_logs/r10 && ls -1 | LC_ALL=C sort ) <( cd logs && ls -1 | LC_ALL=C sort ); echo "NAME_DIFF_EXIT=$?"   # 空输出 + 0

# ③ 本仓那两份副本与仓外那两份逐字节相同
#    🔴 `cmp` 只在【没有被 git 重新 checkout 过的工作树】上成立：本仓 `core.autocrlf=true` 且这两份
#       没有 `.gitattributes`（`git ls-files --eol` = `i/lf w/lf attr/`），所以**重新 clone / checkout
#       会把它们 smudge 成 CRLF**，届时 `cmp` 会红 —— 那是行尾差异，不是清单内容变了。
#       要一条**与 checkout 历史无关**的判据，用下面那两行比 blob 的 sha256（blob 里存的永远是 LF）。
cmp /c/code/yudao_backups/iter8-g1-db/MANIFEST.sha256 "/c/code/yudao/yudao-ui-admin-vue3/docs/iter8/round01-G1数据库备份-MANIFEST.sha256"; echo "CMP_EXIT=$?"   # 0（当前工作树）
cmp /c/code/yudao_backups/r10/MANIFEST.sha256        "/c/code/yudao/yudao-ui-admin-vue3/docs/iter8/round01-r10日志归档-MANIFEST.sha256"; echo "CMP_EXIT=$?"   # 0（当前工作树）
# CRLF 免疫版（两两必须相等）：
( cd /c/code/yudao/yudao-ui-admin-vue3 && git show "HEAD:docs/iter8/round01-G1数据库备份-MANIFEST.sha256" | sha256sum )   # f6aeca85…
sha256sum /c/code/yudao_backups/iter8-g1-db/MANIFEST.sha256                                                              # f6aeca85…
( cd /c/code/yudao/yudao-ui-admin-vue3 && git show "HEAD:docs/iter8/round01-r10日志归档-MANIFEST.sha256" | sha256sum )    # 110763a4…
sha256sum /c/code/yudao_backups/r10/MANIFEST.sha256                                                                      # 110763a4…

# ④ 本轮的前端提交 + 一条后端提交
#    🔴 【本摘要自身入仓】的那几条哈希无法写进自己正文（自指），一律用最后一行现取
cd /c/code/yudao/ruoyi-vue-pro       && git show --numstat 0298422a04   # 后端：1 文件 +10（含改正后的注释）
cd /c/code/yudao/yudao-ui-admin-vue3 && git show --numstat 04c2e931a    # 前端 docs②：2 文件 +243/−86
cd /c/code/yudao/yudao-ui-admin-vue3 && git show --numstat cb5f88561    # 前端 docs③：1 文件（把那句假话改成实话）
cd /c/code/yudao/yudao-ui-admin-vue3 && git show --numstat 9af7115ef    # 前端 chore：29 文件（.gitignore + 28 份证据入仓）
cd /c/code/yudao/yudao-ui-admin-vue3 && git ls-files _evidence | wc -l  # 33（U3 之前是 5）
cd /c/code/yudao/yudao-ui-admin-vue3 && git log --oneline -- docs/iter8/   # 前端 docs④（3 文件入仓）及其后的每次重钉；最上面那条 = 最近一次

# ⑤ 重跑备份 / 归档本身（🔴 都是只读 + 落盘，不动业务数据；DB 口令在脚本里明写，所以脚本不入 git）
bash /c/code/yudao/ruoyi-vue-pro/_logs/r10/43-iter8-g1-backup.sh
bash /c/code/yudao/ruoyi-vue-pro/_logs/r10/45-iter8-r10-archive-pass2.sh
```
