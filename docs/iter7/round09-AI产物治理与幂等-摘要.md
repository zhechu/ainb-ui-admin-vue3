# 迭代七 · 第 09 轮 —— AI 产物治理与幂等 · 摘要（B4-1 / B4-2 / B4-3 / B4-4 / B4-7 / E6）

> **这份文件为什么在仓里**：总账 §16.3 的 **G-9** 要求「证据与备份**落仓外** + **摘要入 git**」，
> 红线第 35 条要求「①入 git（**哪怕只是校验和清单 + 摘录**）**或** ②放在工作区之外的固定路径」—— 本轮**两个都做**。
> 🔴 **原始日志（51 份）与探针（4 份）不在仓里**，仓里只留**摘录 + 校验和 + 可复算命令**。落点见下表。
>
> 🔴 **这份摘要放在前端仓，不是放错了地方**：本轮后端 3 条提交、前端 2 条提交，
> 但两份规划文档（总账 + 分册）在 `C:\code\yudao`，而**那个目录不是 git 仓库** ⟹ 文档本身**任何仓都进不去**。
> 第 02 / 03 / 04 轮已用过这个办法，本轮照做，让 `git log` 里查得到「这一轮干过、干了什么、证据在哪」。
>
> 🟢 **本轮按用户指令【不回写方案文档】**（用户指令覆盖分册 §12/§13）：干完直接提交代码，然后等通知。
> 于是本轮**没有**总账 / 分册的回写条目、**没有**台账「未修→已修」的原文改写。
> 需要回写时，本文件第 1、2、7 节就是回写的取材处。

| 项 | 值 |
|---|---|
| 执行权威（分册） | `C:/code/yudao/流程编排模块重构方案-迭代七-09-AI产物治理与幂等.md` |
| 总账 | `C:/code/yudao/流程编排模块重构方案-迭代七.md` |
| 执行日期 | **2026-10-08**　13:21 ~ 15:35（首份日志 `compile1.done` 13:21，末份**非活**日志 `acceptance-11-eslint-4files.log` 15:35；`backend2.log` 是**活日志**，归档里存的是 15:18 的快照） |
| 点数 | **12 → 6**（B4 独占一轮） |
| 证据归档区（**仓外**） | `C:/code/yudao_backups/iter7-round09/` —— **57 个文件 / 3,148,197 B（3.1 MB）**（`du -sb`） |
| ↳ 索引 | `INDEX.md`（**66 行 / 5731 B**），sha256 = `57bd1568afd8d32b321dab3986711ef2a8b94968c2ad1875b0f3392865ebc08d` |
| ↳ 校验清单 | `MANIFEST.sha256`，**55 行**，sha256 = `8dafb161a9e26051e22cf304eccba3f6b7ce5390c028058df2f7dac8795dd2f0` |
| ↳ 原始日志 | `logs/`（**51** 份 = `acceptance-*` **15**（11 `.log` + 3 `.png` + 1 `.done`）+ 其余 `.done` 完成标记 **14** + 其余 `.log`/`.txt`/`.norm` **22**（全量 install ×2、双模块测试 ×5、两次后端启动、编译 ×6、ts:check 及其基线原件与归一化副本）。🔴 每个「跑完了没」只认 `.done` 里那行 `EXIT_CODE=`）· `probe/`（**4** 份 = E6 载荷、B4-3 载荷与驱动器、B4-7 的一次性 Playwright spec 源码副本） |
| 本仓副本 | 本文件 + `round09-AI产物治理与幂等-MANIFEST.sha256`（= 仓外那份 `MANIFEST.sha256` 的逐字副本，`cmp -s` → **一致**，副本 sha256 与上表**同值** `8dafb161…`） |
| 校验结果 | 在 `C:/code/yudao_backups/iter7-round09/` 下 `sha256sum -c` **入仓那份**清单 → **`VERIFY_EXIT=0`，`OK = 55`，`FAILED = 0`，非 OK 行 = 0** |
| **五项**清单自检 | ① `wc -l < MANIFEST.sha256` = **55** 且 `find logs probe -type f \| wc -l` = **55**（51 + 4）；② 重复路径 = **0**；③ 格式不合 `^[0-9a-f]{64} \*(logs\|probe)/` 的行 = **0**；④ 清单**不自指**（含 `MANIFEST.sha256`/`INDEX.md` 的行）= **0**；⑤ `find . -type f \| wc -l` = **57** = 55 + 清单 + 索引 |
| 提交 | **5 条**：后端 3（framework 1 / infra 1 / agent 1）+ 前端 2（feat 1 / docs 1，本条即 docs）。🔴 全部按**显式路径** `git add`，未用 `-A`/`.`；未 `--amend`、未 `--no-verify` |
| 环境 | 后端 48080（`Started YudaoServerApplication in 24.287 seconds`）· 前端 dev server 80 · 库 `ruoyi-vue-pro` · 租户 1 |

---

## 0. 一句话结论

**六条全闭合**（B4-1 / B4-2 / B4-3 / B4-4 / B4-7 / E6），三层验收都过、都有原始日志；
但 **T6 编号本身仍未解析**（方案自己已按红线第 9 条写明「从来没有 T6 的定义，也没有它的注册处」），
本轮**照方案的兜底指示办**：不猜 T6 是哪三个测试，改为把它点名的那个假绿形态正面钉死（见 §4 第 3 条）。
另有 **2 处设计留白**（source 不回填 / 指纹对存量行是空操作）如实记在 §5，
它们是取舍不是缺陷，但意味着「治理已全面生效」这句话对**存量数据不成立**。

---

## 1. 六条子项逐条销账

| 条目 | 干了什么 | 落在哪个提交 | 判据在哪 |
|---|---|---|---|
| **B4-1** | `infra_data_model` / `infra_form_design` 各加 4 列（`source` / `manual_edited_flag` / `schema_fingerprint` / `version`），**一次 DDL**；可重复执行（存储过程 + `information_schema` 判存在） | 后端 `87c8ee1603`（含 `sql/mysql/xpy-2026-10-08-agent-ai-artifact-governance.sql`） | ①`acceptance-1-columns.log` |
| **B4-2** | 改表执行任何 DDL **之前**复核指纹；不一致 → `DATA_MODEL_SCHEMA_DRIFT(1_001_202_039)`，**不执行任何 DDL**。指纹编码用**长度前缀**（天然单射），只让**结构字段**入指纹、按列名小写排序 | 后端 `87c8ee1603` | ②`DataModelGovernanceGuardTest` 20/20 |
| **B4-3** | 删列一律要 `confirmDropColumns=true`，**不看表里有没有数据**；缺失 → `DATA_MODEL_DROP_COLUMN_NEED_CONFIRM(1_001_202_040)`。**AI 路径一律拒删列且不许传这个标记** | 后端 `87c8ee1603`（infra 闸）+ `6178095b51`（agent 拒）+ 前端 `a64043a3e`（弹窗） | ②`acceptance-8-b43-two-logs.log`（两条运行时日志）③同 |
| **B4-4** | 注册 `OptimisticLockerInnerInterceptor`（此前**根本没注册**，`@Version` 是纯空操作）；两个 DO 打 `@Version`；**全部写路径普查后逐条带 version + 检查影响行数** | 后端 `ea4bd15afd`（framework）+ `87c8ee1603`（infra）+ `6178095b51`（agent）+ 前端 `a64043a3e`（回传） | ①`acceptance-4-update-paths.log` ②`ArtifactRecordOptimisticLockTest` 12/12 ③`acceptance-10-tombstone-columns.log` |
| **B4-7** | 删字段弹二次确认 + 确认过的字段名**常驻**显示在保存按钮旁；人工保存后 `manual_edited_flag` 落库为真（服务端按入口盖章，**AI 不能给自己盖章**） | 前端 `a64043a3e` + 后端 `87c8ee1603` | ③`acceptance-6-*`（3 张截图 + `EXIT_CODE=0`）+ `acceptance-10-tombstone-columns.log` |
| **E6** | `datamodel_create` 幂等：结构相符 → 返回「已存在，跳过」+ **原来那个模型编号**，`skipped=true`，**不执行任何 DDL**；结构不符 → **报错**（绝不冒充「已经有了」） | 后端 `6178095b51` | ②`DataModelCreateToolTest` 15/15 ③`acceptance-5-e6-replay.log` |

🔴 **写路径普查的账（B4-4 的真正交付物，「加注解只算 10%」）**：
**12 处** mapper 写调用点 / 共 **8 处**是 UPDATE 形（另 4 处 INSERT 不需要版本条件）。8 处里：
- **5 处带 version 条件**，覆盖 **7 条逻辑更新路径**：`FormDesignServiceImpl:190` / `:243` / `:342`、
  `FormDesignVersionServiceImpl:164`、`DataModelServiceImpl:274`。
  （`:243` 那一处被 publish(`:528`) / bindMenu(`:693`) / unpublish(`:732`) 三方共用，故算 3 条。）
  🔴 五处**都检查了影响行数**（`== 0` → 抛冲突）：拦截器冲突时**不抛异常**、只让 UPDATE 命中 0 行，
  不查行数的话并发覆盖是**静默**的。
- **3 处刻意不带**，各自在代码里写明了理由（不是漏掉的）：
  `FormDesignVersionServiceImpl:225`（`update(null, wrapper)`，拦截器结构上够不着；安全依据是与 `:164`
  同处一个 `@Transactional`、`:164` 已取排他锁持锁到提交；**代码里同时写明了那条顺序依赖**）、
  `DataModelServiceImpl:380` / `:399`（`@TableLogic` 的 `deleteById`；这里 `tableName` 不可变、
  `dropTable` 的判据是对**物理表实时**读的，加锁要改公开接口契约却换不到收益。
  ⚠️ 别把两侧「统一」成一种写法 —— 判据来源根本不是一回事）。
- 旁路核查：这两个 Mapper 类型在全仓主源码里只被 **infra 的 9 个文件**引用，没有跨模块旁路；
  对这两张表的**裸 SQL 写只有 1 处**（`FormDesignMapper:59` 的 `@Update`），它自带 version 条件。
- grep 原文与逐条汇总：`logs/acceptance-4-update-paths.log`。

---

## 2. 三层验收（🔴 红线第 21 条：单测全绿**不算**完成）

### ① 静态

| 判据 | 实测 | 原始日志 |
|---|---|---|
| 两张表 4 列都在 | 8 行（2 表 × 4 列），类型 `varchar(16)` / `bit(1)` / `varchar(64)` / `int` | `acceptance-1-columns.log`、`acceptance-10-tombstone-columns.log` |
| 🔴 **DDL 前后存量行数逐字相同** | `infra_data_model` **307** 总 / **299** 活；`infra_form_design` **5932** 总 / **47** 活 | `acceptance-1-columns.log` |
| 写路径普查报成「N 处 / 共 M 处」+ grep 原文 | **12 处调用点 / 共 8 处 UPDATE 形 / 5 处带 version（覆盖 7 条逻辑路径）/ 3 处刻意不带** | `acceptance-4-update-paths.log`（含 5 条 grep 命令的原文输出） |
| 前端 ts:check **冷跑** | `EXIT_CODE=2`、**78 条**，与基线**逐条相同**（归一化后 `DIFF_EXIT=0`） | `acceptance-2-tscheck.log`、`tscheck.log`、`b.norm` / `n.norm`、基线原件 `tscheck-baseline-r06b-raw.log` |
| 前端 4 个改动文件 eslint | `EXIT_CODE=0`，无输出（§7 没要求，顺手量的） | `acceptance-11-eslint-4files.log` |

### ② 测试（🔴 判完成只认 `.done` 里那行 `EXIT_CODE=`）

| 跑什么 | 结果 | 原始日志 |
|---|---|---|
| 全量 `mvn install -DskipTests`（第一次） | `EXIT_CODE=0` | `install-full.log` / `.done` |
| 全量 `mvn install -DskipTests`（修完静态顺序后） | `EXIT_CODE=0` | `install2.log` / `.done` |
| **infra 全量** | `EXIT_CODE=0`，**Tests run: 1570, Failures: 0, Errors: 0, Skipped: 10** | `test-infra2.log` / `.done`；补注释后再跑 `test-infra3.log` / `.done`（同为 1570/0/0/10） |
| **agent 全量** | `EXIT_CODE=0`，**Tests run: 1888, Failures: 0, Errors: 0, Skipped: 0** | `test-agent2.log` / `.done` |
| 🔴 **乐观锁并发负控（真跑，不是 mock）** | `ArtifactRecordOptimisticLockTest` **12/12**（`BaseDbUnitTest` 真库）。其中「**真并发：两个线程同时保存同一张表单 → 恰好一个成功、恰好一个版本冲突**」用 `CountDownLatch(2)` + `CountDownLatch(1)` + `Executors.newFixedThreadPool(2)` 真起两个线程（该文件 320-342 行） | `test-infra3.log`（类级汇总行 `Tests run: 12 …`） |
| 🔴 **乐观锁「失效形态」反向对照** | 同类里「**version 为 null 时拦截器静默跳过 —— 写成功、版本不推进、别人的改动被盖掉**」。它证明的是**不判空会发生什么**，不是断言我们判了 | 同上 |
| 🔴 **B4-2 一个字符的指纹负对照** | `DataModelGovernanceGuardTest` **20/20**；含「长度前缀编码是单射的 —— 分隔符拼接会撞的那一对，指纹必须不同」，**测试内部先把「拼接真的会撞」断言出来**（`naiveJoin`）再断言指纹不同 | `guard-fix.log` / `.done`（`EXIT_CODE=0`）、`test-infra3.log` |
| 🔴 **B4-3 两条日志（缺失被拒 / 置真放行）** | 缺失 → `code=1001202040`；置真 → `code=0`；清理 → `code=0`；`DRIVER_EXIT_CODE=0` | `acceptance-8-b43-two-logs.log` |
| E6 幂等单测 | `DataModelCreateToolTest` **15/15**（新建），含「连着调两次：只建一张表，第二次是跳过」= §7③ 的单测版 | `test-agent2.log` |
| §6 点名的「并发后写 → 版本冲突」 | `FormUpdateToolTest` **17 → 21**，新增 4 条里就有这一条。🔴 **改前不存在** | `test-agent2.log` |
| 其余 | `DataModelUpdateValidatorTest` **8 → 14**、`DataModelParamResolverTest` **15 → 19**、`DataModelApiImplTest` **15**、`ErrorCodeConstantsUniquenessTest` **5**（6 个新错误码过全仓唯一性守卫）、`DataModelServiceImplTest` **3** | `test-infra3.log` / `test-agent2.log` |

### ③ 行为（🔴 真跑，只读 SQL 验收，探针走真接口清理）

| 判据 | 实测 | 原始日志 |
|---|---|---|
| **E6 重放两次 → 只有一张表** | 同一份载荷（`probe/e6-payload.json`，两次**逐字节相同**）连调两次 `POST /agent/diagnostic/tool-execute?tool=datamodel_create`（走完整网关、不经大模型）。第 1 次 `code=0`、`id=334`；第 2 次 `code=0`、**`skipped=true`**、`id` 仍是 **334**；物理表 **1 张**、登记行 **1 条**、`source=AI` | `acceptance-5-e6-replay.log` |
| **前端真手改 → `manual_edited_flag` 落库为真** | 一次性 Playwright 探针在真浏览器里改字段并保存，`EXIT_CODE=0`；只读 SQL 复核 id 334：`mef` 由 0 → **1**、`version` 0 → **1**、指纹由 `edce01b5d739` → **`8a934814f6b5`**（重记） | `acceptance-6-b47.log` / `.done`、`acceptance-10-tombstone-columns.log` |
| **后端自己打出的那条 UPDATE SQL** | `UPDATE infra_data_model SET … manual_edited_flag = ?, schema_fingerprint = ?, version = ? … WHERE id = ? AND version = ? AND deleted = 0 AND tenant_id = 1`，参数含 `true(Boolean)` / `8a934814f6b5…` / `1(Integer)` / `334(Long)` / **`0(Integer)`**，`<== Updates: 1`。🔴 这一条同时钉住 B4-4（version 真进了 WHERE，且是**运行中的后端**打的，不是 mock）、B4-7（flag=true）、B4-2（指纹重记） | `acceptance-10-tombstone-columns.log`（内附 `backend2.log` 第 3452-3455 行原文） |
| **删列二次确认弹窗真的出现** | 截图 `acceptance-6-drop-confirm-dialog.png`，文案含 `DROP COLUMN` / `永久丢失` / 字段名；点「取消」后字段仍在、**没有**「将删除字段」红 tag（`acceptance-6-after-cancel.png`）；人工保存后回列表页（`acceptance-6-after-save.png`） | 同上 3 张 png + `acceptance-6-b47.log` |
| **B4-3 运行时被拒 / 放行** | `PUT /admin-api/infra/data-model/update` 不带 `confirmDropColumns` → `1001202040`；带 `true` → `code=0` | `acceptance-8-b43-two-logs.log` |
| **后端真启动**（🔴 单测测不出静态初始化炸） | `Started YudaoServerApplication in 24.287 seconds`（15:02:26 起） | `backend2.log`（15:18 快照） |
| **探针清理走真接口**（红线第 26 条：不裸 SQL 清探针） | 两张探针表都用 `DELETE /infra/data-model/delete?…&dropTable=true&riskConfirmed=true` 删除，`code=0`；物理表 **0** 张 | `acceptance-7-probe-cleanup.log`、`acceptance-9-residue-recheck.log` |
| **残留判据 = alive 的 `wf_plan_%` 集合不变** | 开工 `{416,417,418,503,567}`（`acceptance-3-prekill-proof.log`）→ 收尾 `{416,417,418,503,567}`；执行史**非终态行 0** | `acceptance-3-prekill-proof.log`、`acceptance-9-residue-recheck.log` |
| 收尾行数复核 | `infra_data_model` **309** 总 / **299** 活（307 + 2 条墓碑 id 334/335）；`infra_form_design` **5932** / **47** 与开工前逐条一致 | `acceptance-9-residue-recheck.log` |

---

## 3. 本轮撞出 / 自纠出的 **9** 处（🔴 都记下来，包括我自己写错的那几处）

1. **后端起不来，而 `install` 全绿** —— `FormUpdateTool` 把 `version` 加进 `NON_PATCHABLE_FIELDS` 时，
   那个 `static final Set` 声明在 `PATCHABLE_FIELDS` **之后**，而后者的初值来自 `patchableFields()`、
   那个方法要读这份名单。Java 静态字段按**声明顺序**初始化 ⟹ 读到 null ⟹ NPE ⟹
   `ExceptionInInitializerError` ⟹ bean 建不出来 ⟹ **启动失败**；
   而 `mvn install -DskipTests` 全绿、27 个单测（`FormUpdateToolTest` 21 + `ToolChangeExtractorCoverageTest` 6）
   报的都是同一个根因。修法是把声明顺序调过来 + 注释写明为什么不能反。
   ⚠️ 这类坑**单测测不出来**（表现为 27 个 error 而不是 1 个启动失败），只能靠真启动一次。
   证据：`backend-restart.log`（失败）vs `backend2.log`（`Started … in 24.287 seconds`）；
   `test-agent.log`（`EXIT_CODE=1`，27 错误）vs `test-agent2.log`（`EXIT_CODE=0`）。
2. 🔴 **我自己写的测试前提是假的** —— `testCanonicalizeIsInjectiveWhereDelimiterJoinWouldCollide`
   原先拿 `(name=ab, type=c)` vs `(name=a, type=bc)` 当「分隔符拼接会撞的一对」，
   实际拼出来是 `ab|c` vs `a|bc`，**根本不同** ⟹ 那条 `assertEquals` 恒失败、
   而修好之后那条 `assertNotEquals` **恒真、什么都没证明**。
   改成一对**真能撞**的例子（一列的 `defaultValue` 里伪造出第二列：`config=VARCHAR default 'on|note|TEXT|'`
   vs `config=VARCHAR default 'on'` + `note=TEXT default ''`，朴素拼接同为 `config|VARCHAR|on|note|TEXT||`），
   并**在测试内部先用 `naiveJoin` 把「前提成立」断言出来**，前提不成立就直接红给你看。
   证据：`test-infra.log`（`EXIT_CODE=1`，`expected: <ab|c> but was: <a|bc>`）→ `guard-fix.log`（`EXIT_CODE=0`，20/20）。
3. 🔴 **我上一段会话说过「`deleteDataModel` 那两处不加锁已有书面理由」，磁盘上并没有**。
   补写了 `DataModelServiceImpl:344` 起的 javadoc，而不是把那句话留着。
4. 🔴 **上一段会话记的写路径清单是过期的** —— 行号（`:353` / `:372` / `:404` 之类）与
   「7/7 update 全部带锁」的说法都与实测不符。按 grep 原文**重数**，得到 §1 那份账
   （12 / 8 / 5 覆盖 7 条 / 3 处刻意不带）。证据：`acceptance-4-update-paths.log`。
5. **`acceptance-7` 里的 308 是中间读数** —— 那是只有**第一条**墓碑（id 334）时查的；
   清掉第二张探针表后收尾复测是 **309**。两处都留着并标明哪个是哪个，
   免得后来人拿 308 去对 309 以为丢了数据。
6. **`bit(1)` 在 `mysql -N -B` 下输出一个不可见字节** —— 第一次读墓碑行的 `manual_edited_flag`
   看着像「空 / 没打标」，差点写成「B4-7 没落库」。加 `CAST(… AS UNSIGNED)` 才是 **1**。
   这条写进了 `acceptance-10-tombstone-columns.log` 的开头，因为它是**会重复踩**的读法陷阱。
7. **清理探针时那条 SQL 写错** —— 查了 `infra_data_model` 的 `code` 列 ⟹ `Unknown column 'code'`
   （`code` 只在 `infra_form_design` 上；「墓碑 code」是表单那侧的概念）。重查，
   错误原文留在 `acceptance-7-probe-cleanup.log` 里没有抹掉。
8. **Windows 上 Python 默认 GBK** —— 探针驱动器读 UTF-8 载荷直接 `UnicodeDecodeError`。
   修法是 `open(..., encoding="utf-8")` + `PYTHONIOENCODING=utf-8`。
9. **B4-7 的 Playwright 探针第一次跑失败** —— `.column-table` 外壳先可见、异步的列行后填 ⟹
   报「没在列编辑表格里找到字段「probe_amount」（共 0 行）」，而**失败截图里行全在**。
   修法：等第一个「字段名」输入框出现 + `columnRow` 30 秒重试 + 用 `xpath=ancestor::tr[1]` 定位整行。
   第二次 `EXIT_CODE=0`。

---

## 4. 🔴 方案文档与实测不符的 **5** 处（如实报告，**不改方案原文**）

1. **§6 第 1 条说 `DataModelServiceImplTest` 有「两条」，实测 3 条**
   （`getDataModel：id 存在时原样返回 DO` / `id 不存在时抛「数据模型不存在」` /
   `四个「按 id 读」的方法对同一个不存在的 id 给同一个错`）。
   本轮**未改**这个文件；它 3/3 绿（`test-infra3.log`）。
   ⚠️ 更要紧的是：**这 3 条都是 C5 的「按 id 读」，与本轮任何一条治理逻辑无关** ⟹
   §6 第 1 条「改完必须仍绿」虽然绿了，但它**证明不了本轮任何东西**。
   真正钉住治理的是本轮新写的 `DataModelGovernanceGuardTest`(20) /
   `ArtifactRecordOptimisticLockTest`(12) / `DataModelCreateToolTest`(15) /
   `FormUpdateToolTest` 新增 4 条。
2. **§6 第 2 条要求的 `FormUpdateToolTest`「并发后写 → 版本冲突」改前不存在**
   （改前 17 条 `@DisplayName` 里没有这一条）。本轮新写 4 条（17 → 21），其中就是它。
   ⟹ §6 把它列进「**既有**验证（改完必须仍绿）」是不成立的：它不是既有的，是本轮的交付物。
3. **T6-⑥⑦⑧ 仍然解析不出来**。方案自己已按红线第 9 条写明「现有材料里只有 `T6-③④`、`T6-⑤`、
   `T6-⑥⑦⑧` 三处引用和一句「→ T6 验收」，**从来没有 T6 本身的定义，也没有它的注册处**」。
   本轮**照方案的兜底指示办**：不猜 T6 是哪三个测试，改为把它点名的那个假绿形态
   （「**乐观锁加了但既有更新路径没带 `version`**」）正面钉死 ——
   ① `ArtifactRecordOptimisticLockTest:314`「真并发：两个线程同时保存同一张表单 →
   恰好一个成功、恰好一个版本冲突」（真跑，`BaseDbUnitTest` + `CountDownLatch`/`Executors`，**不是 mock**）；
   ② §7① 的写路径普查（`acceptance-4-update-paths.log`，12 / 8 / 5 / 3 逐条落地）。
   🔴 **T6 编号本身仍未闭合**，按红线第 9 条记为缺口，留给后续（见 §5 第 1 条）。
4. **残留集合的快照值又漂了一格**。方案正文（第 69 / 199 / 843 行）记的「当前快照」是
   `{416, 417, 418, 503}`（2026-10-06 实测），红线第 24 条正文里写死的是 `{416,417,418}`（更旧，
   方案自己已注明是旧快照）。本轮开工当天重测 = **`{416,417,418,503,567}`**，收尾复测**仍是**它 ⟹
   **判据「集合不变」成立**。多出的 `567` = `wf_plan_muyf6s9l_4`（DISABLED），
   开工前就在（`acceptance-3-prekill-proof.log`），**不是本轮建的**（本轮探针只碰 datamodel / form 工具）。
   ⟹ 方案里那两个快照值**都已过期**，但它自己写明了「快照值只作对照用，判据永远是集合不变」，
   所以这是**值过期**、不是**判据错误**。
5. **§5 / §7① 提到的「28 行」** —— 方案自己已更正（那是 `agent_node_execution` 的旧快照）。
   本轮按方案要求重测并记录当次快照：`infra_data_model` **307 / 299**、`infra_form_design` **5932 / 47**
   （`acceptance-1-columns.log`），DDL 前后**逐字相同**。收尾（含 2 条墓碑）**309 / 299** 与 **5932 / 47**。

---

## 5. ⚠️ 证据缺口与设计留白（🔴 红线第 35 条：写不出日志位置就标不可复算）

1. **T6 编号未闭合** —— 缺的信息是「T6 ①②⑤ 的原文，以及 T6 这个编号在哪里注册」。
   ⚠️ **不可复算**：本轮没有任何日志能证明「T6-⑥⑦⑧ 就是这三个测试」，
   因为连 T6 是什么都不知道。本轮只做了 §4 第 3 条那两件事作为替代。
2. **B4-7 的一次性 Playwright spec 原件已删**（探针不进仓，跑完即删）。
   断言内容只能从 `probe/zz-r09-b47-probe.spec.ts` 看 —— 那是**从会话记录逐字还原的副本**
   （Write 的原文 + 那一次修竞态的 Edit 重放）。
   ⚠️ **这份还原副本不可复算**（无法再跑一次证明它逐字等于原件）。
   **可复算**的是：`acceptance-6-b47.log` 的 `EXIT_CODE=0` 与那条测试名、3 张截图、
   以及 `acceptance-10-tombstone-columns.log` 里后端自己打出的 UPDATE 原文。
3. 🔴 **`source` 不回填 ⟹ 存量行一律 `'MANUAL'`，真实来源未知**。
   判据必须是硬的才叫回填：`agent_workflow_def` 那次能回填，是因为 `code LIKE 'wf_plan_%'`
   是自动生成的命名约定；这两张表没有这种约定 —— 本次实测 `agent_message` 里提到
   `datamodel_create` 的记录 **0 条**，`creator` 记的是用户 id 而 AI 跑在真人令牌下，同样区分不了。
   没有判据还要填，填进去的就是一个**假的**来源，后面所有按它做的治理动作都在错的基础上跑。
   ⟹ **「按 `source` 统计 AI 产物」对存量 307 + 5932 行必然少算**（只统计得到本轮之后新建的）。
4. 🔴 **B4-2 那道闸对存量行是空操作，直到它们各自第一次改表**。
   `schema_fingerprint` 刻意可空且**不给默认值**：NULL = 「还没记录过基线」，'' = 「记录过、且结构是空的」；
   两者一旦合并，存量模型第一次改表就会被误判成「结构被人绕过平台改过」而**永远改不动**。
   于是 NULL 时按设计放行、并在改完后记下基线。
   ⟹ **「改表前一律复核指纹」这句话对存量数据现在不成立**，成立的是「改过一次之后就成立」。
5. **B4-3 的 §7② 那两条日志是在 infra 管理端接口上验的，不是 AI 工具路径**
   （AI 那条路现在一律拒删列，压根到不了那道闸）。
   ⟹ 「AI 传 `confirmDropColumns=true` 会怎样」这个组合**本轮没有行为层实证**，
   只有 `DataModelUpdateValidatorTest`(14) 的单测。这是刻意的：让 AI 能开那道闸本身就是要拒的事。
6. **`ts:check` 未归一化时有 2 行不同**（`acceptance-2-tscheck.log` 已逐条写明：
   一行是 `src/views/agent/workflow/index.vue` 的行号漂移 108→121、该文件本轮未改；
   一行是 `data/index.vue(142,19)` 同一处 TS2339 的内联对象类型渲染改口）。
   归一化后 `DIFF_EXIT=0`。⚠️ **「归一化规则」本身是我定的**（忽略行号与 ` on type …` 尾串），
   换一个更严的规则可能得出不同结论 —— 两份 sorted 原件（`tscheck-baseline-sorted.txt` /
   `tscheck-now-sorted.txt`）与归一化副本（`b.norm` / `n.norm`）都在归档里，**可复算**。
7. **`test-agent.log`（修复前那轮）没有 `[INFO]` 级的模块汇总行**，只有
   `[ERROR] Tests run: 1888, Failures: 0, Errors: 27`；27 的分布（21 + 6）是从
   `[ERROR]   XxxTest` 行**数**出来的，不是汇总行给的。**可复算**（`grep -c`）。
8. **`backend2.log` 是活日志的快照**（15:18 采集，原件随运行中的后端继续增长）。
   快照里已含本轮全部关键行，已用 `grep -c` 逐一核过：启动完成行 **1**、
   带 version 条件的那条形如 `WHERE id = ? AND version = ? AND deleted = 0 AND tenant_id = 1` 的 UPDATE **2**、
   两张探针表名各出现 **5** 次。⚠️ 但**快照之后**的运行期日志不在归档里。

---

## 6. 本轮**不做**的事（逐条对账）

| 不做的 | 为什么 / 依据 |
|---|---|
| **N10、N4、B4-5、B4-6** | 方案明确「本轮不做」 |
| 🔴 **不改 `WorkflowDslValidator.foldDryRunRejections`** | **P2 反合流**：E6 与「把 `executedCount` 降档」不许写进同一个提交。已核：`git diff --stat` 对该文件**为空**（可复算，见 §8） |
| **不回写方案文档 §12/§13** | 🟢 **用户本轮指令覆盖**：「干完就直接提交代码，不用回写文档，然后等我通知」 |
| **不回填 `source` / 不建索引 / 不动任何已有列** | 见 §5 第 3 条与 DDL 脚本末尾「刻意不做的事」 |
| **不开 `OptimisticLockerInnerInterceptor.setException`** | 那是单例级、跨全仓的开关，且共享的异常实例堆栈指向 bean 构造处、日志会把人引到错的地方。改由使用方在自己的 Service 里显式判 version 非空、用各自的错误码报 |
| **前端 `docs/iter7/round04-*` 那两份存量已修改文件** | 本轮**没碰**（`git add` 一律显式路径，未用 `-A`/`.`）。它们仍是工作区里的未提交改动 |
| **`_tmp/iter7-round09/token.txt`** | 访问令牌，**刻意不入归档**（归档 55 项里没有它） |

---

## 7. 提交清单（🔴 两仓分别提交，全角括号，显式路径）

| # | 仓 | 分支 | hash | 标题 |
|---|---|---|---|---|
| 1 | `ruoyi-vue-pro` | `master-jdk17` | `ea4bd15afd` | `feat（framework）：注册 MyBatis-Plus 乐观锁插件——@Version 此前是纯空操作（迭代七第 09 轮 B4-4 前置）` |
| 2 | `ruoyi-vue-pro` | `master-jdk17` | `87c8ee1603` | `feat（infra）：AI 产物治理四列 + 改表前指纹复核 + 删列显式确认 + 记录级乐观锁（迭代七第 09 轮 B4-1/B4-2/B4-3/B4-4 的 infra 一侧）` |
| 3 | `ruoyi-vue-pro` | `master-jdk17` | `6178095b51` | `feat（agent）：datamodel_create 幂等 + AI 路径一律拒删列 + 两个 update 工具带上乐观锁版本（迭代七第 09 轮 E6 / B4-3 / B4-4 的 agent 一侧）` |
| 4 | `yudao-ui-admin-vue3` | `feat/vendor-form-create` | `a64043a3e` | `feat（infra）：数据建模删字段改成二次确认弹窗、保存时回传乐观锁版本与结构指纹（迭代七第 09 轮 B4-7，附 B4-2/B4-3/B4-4 的前端一侧）` |
| 5 | `yudao-ui-admin-vue3` | `feat/vendor-form-create` | *本条* | `docs（infra）：迭代七第 09 轮 AI 产物治理与幂等的摘要与 sha256 清单入仓` |

改动量：后端 **1 + 29 + 9 = 39 个文件**（framework `+21`；infra `+2454 / -21`；agent `+1085 / -42`）；
前端 **4 个产品文件**（`+215 / -15`）+ 本条 docs **2 个文件**。

🔴 **为什么 B4-4 拆成 3 条提交**：它跨 3 个模块，而提交标题挂的模块必须与实际交付范围一致（G-10）。
拦截器注册在 `yudao-framework`（不注册，另两条的工作全是假的）、
写路径带 version 在 `yudao-module-infra`、工具回传 version 在 `yudao-module-agent`。
🔴 **合流对是排期单位不是交付单位**（红线第 32 条）：B4 独占一轮，但交付按模块拆。

---

## 8. 复算入口（照着跑就能重出本轮全部判据）

```bash
# ---------- 归档自校（仓外那份 vs 入仓那份） ----------
cd /c/code/yudao_backups/iter7-round09 && pwd
wc -l < MANIFEST.sha256                                  # 55
find logs probe -type f | wc -l                          # 55
find . -type f | wc -l                                   # 57
sha256sum -c MANIFEST.sha256 | grep -c ': OK$'           # 55
sha256sum -c MANIFEST.sha256 | grep -cv ': OK$'          # 0
awk '{print $2}' MANIFEST.sha256 | sort | uniq -d | wc -l # 0（无重复路径）
grep -cE 'MANIFEST|INDEX' MANIFEST.sha256                # 0（清单不自指）
cmp -s MANIFEST.sha256 "/c/code/yudao/yudao-ui-admin-vue3/docs/iter7/round09-AI产物治理与幂等-MANIFEST.sha256" && echo 一致
sha256sum -b MANIFEST.sha256                             # 8dafb161…（与本文件表头同值）

# ---------- 三层验收的关键行 ----------
cd /c/code/yudao_backups/iter7-round09/logs && pwd
cat acceptance-1-columns.log | tail -3                   # 307/299 与 5932/47
cat acceptance-9-residue-recheck.log                     # 309/299、物理表 0、{416,417,418,503,567}、非终态 0
cat acceptance-10-tombstone-columns.log                  # 4 列类型 + 墓碑行 mef=1/version=1 + UPDATE 原文
sed -n '/汇总/,$p' acceptance-4-update-paths.log          # 12 / 8 / 5（覆盖 7 条）/ 3
cat acceptance-5-e6-replay.log                           # 第 2 次 skipped=true、仍 1 张表 / id 334
cat acceptance-8-b43-two-logs.log                        # 1001202040 → code 0
for f in *.done; do printf '%-24s %s\n' "$f" "$(cat $f)"; done   # 每个 EXIT_CODE=
grep -A6 '^\[INFO\] Results:' test-infra3.log | grep 'Tests run:' | tail -1   # 1570/0/0/10
grep -A6 '^\[INFO\] Results:' test-agent2.log | grep 'Tests run:' | tail -1   # 1888/0/0/0
grep -c 'error TS' tscheck-baseline-r06b-raw.log b.norm n.norm               # 78 / 78 / 78
diff b.norm n.norm; echo DIFF_EXIT=$?                     # 0
grep -o 'Started YudaoServerApplication in [0-9.]* seconds' backend2.log     # 24.287

# ---------- P2 反合流：foldDryRunRejections 本轮未改 ----------
cd /c/code/yudao/ruoyi-vue-pro && pwd
git diff --stat ea4bd15afd~1..6178095b51 -- \
  yudao-module-agent/src/main/java/cn/iocoder/yudao/module/agent/framework/agent/core/validate/WorkflowDslValidator.java
# 输出为空 = 未修改

# ---------- 写路径普查（重跑一遍，应与 acceptance-4 逐条相同） ----------
cd /c/code/yudao/ruoyi-vue-pro && pwd
grep -rn -E '(formDesignMapper|dataModelMapper)\.\w+\(' yudao-module-infra/src/main/java
grep -rln -E 'FormDesignMapper|DataModelMapper' --include=*.java */src/main/java
grep -rni -E '(UPDATE|INSERT INTO|DELETE FROM)[[:space:]]+infra_(form_design|data_model)\b' -r */src/main

# ---------- 只读 SQL 复核（库 ruoyi-vue-pro，租户 1，deleted 是 bit(1)） ----------
export MYSQL_PWD=123456
q(){ "/c/Program Files/MySQL/MySQL Server 8.0/bin/mysql" -h127.0.0.1 -uroot \
      --default-character-set=utf8mb4 ruoyi-vue-pro -N -B -e "$1"; }
q "SELECT COUNT(*), SUM(CAST(deleted AS UNSIGNED)=0) FROM infra_data_model"     # 309  299
q "SELECT COUNT(*), SUM(CAST(deleted AS UNSIGNED)=0) FROM infra_form_design"    # 5932  47
# 🔴 bit(1) 必须 CAST，否则真值输出成一个不可见字节、看着像「没打标」
q "SELECT id, table_name, source, CAST(manual_edited_flag AS UNSIGNED), LEFT(schema_fingerprint,12), version
     FROM infra_data_model WHERE table_name LIKE 'biz\\_%probe\\_r09%'"          # 334/335 均 AI,1,…,1
q "SELECT id FROM agent_workflow_def WHERE code LIKE 'wf\\_plan\\_%' AND CAST(deleted AS UNSIGNED)=0 ORDER BY id"
```

---

## 9. 交棒给后续轮次

1. 🔴 **T6 的定义与注册处仍缺**（§5 第 1 条）。谁接手 B4 系列之前，先把 T6 是哪几个测试问清楚 ——
   否则 §6 第 3 条既无法执行也无法验收，而「连要跑哪三个都不知道」比全绿更糟。
2. 🔴 **`source` 与 `schema_fingerprint` 的存量留白**（§5 第 3、4 条）。
   真要给存量行补 `source`，得先造出一个**硬判据**；在那之前，任何「按 source 统计 / 按 source 清理」
   的治理动作都必须**显式声明它只看得到本轮之后新建的行**，否则清单会少一半且不报错。
3. **B4-5 / B4-6 未做**，与 B4-2/B4-3 的闸是同一批语义，接手时注意别把「AI 能开 confirmDropColumns」
   这条口子在别的工具上重新开出来（`DataModelUpdateValidator.validateNoConfirmDropColumns` 是唯一那道）。
4. **`OptimisticLockerInnerInterceptor` 现在是全仓生效的**。往后任何 DO 打上 `@Version` 就立刻有锁 ——
   但那三件「它不会替你做」的事（冲突不抛异常、version 为 null 静默跳过、够不着手写 SQL 与
   `update(null, wrapper)`）依然成立，代码注释里写着，别以为注册完就安全了。
5. **两套乐观锁版本号在同一张表单上并存**：`infra_form_design.version`（本轮加的，记录级）与
   `TableBinding.versionColumn`（既有的，业务数据行级）。
   错误码已刻意分开命名（`FORM_DESIGN_RECORD_VERSION_CONFLICT` vs `FORM_DESIGN_VERSION_CONFLICT`），
   但**前端与文案里仍容易混**，接手表单那块时留意。
