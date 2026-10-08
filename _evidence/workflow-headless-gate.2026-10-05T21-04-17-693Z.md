# A4-d · 无头流程的人工闸口

- 生成时间：2026-10-05T21:04:17.981Z
- 基线：会话 1 条、流程 def 3 条

> 🔴 本用例**只出草稿**，不点「确认并运行」、不调 /publish。建表 IRREVERSIBLE，只允许在开发库跑。

---

## ① 前置阳性对照

- 空 DSL → passed=false，errors 2 条 ✅

## ⑧ 构造样本（V11 的 error 分支）

- passed=false
- errors：
  - 节点(id=create_table) 的工具「datamodel_create」声明风险是「不可逆」，但它的上游没有人工闸口。本流程由定时任务触发、跑起来时没有人在场，而不可逆动作执行了就回不去（DDL 没有事务，DdlExecutor 的类注释写得很直白：不假装能回滚）。请在它前面加一个 hitl.bpm_approval 节点，让人看清将发生什么再放行；或把这个动作换成可逆的（如先存草稿、由人确认后再发布）

## ②~⑦ 真发

- 提问：

```
我要建一张新表「xpy_e2e_gate_probe」，用来记录设备巡检结果，
字段有：巡检人、巡检时间、设备编号、巡检结论、备注。这张表现在不存在，需要你新建。

请把它做成一个每天早上 8 点自动执行的流程，到点自己跑起来，不需要我守着。

先出草稿给我看，不要自己发布。
```

- 耗时：31666ms
- 规划进度条出现过：是（确实走进了 BUILD 路径）
- 草稿卡：待确认，节点 7 个
- 新造 def：#502「设备巡检表创建流程」状态 DRAFT
- 触发器：DSL 内=schedule，def 行=schedule
- 体检（收敛后原样）：passed=true，errors 0 条，warnings 1 条
- manifest：riskLevel=IRREVERSIBLE，kinds=[PROCESS_DEPLOY, TABLE_CREATE]
- 节点类型：[check_table:tool, judge_exists:script, route_check:condition.rule, deploy_approval_flow:tool, bpm_gate:hitl.bpm_approval, create_table:tool, summarize:llm]
- ✅ 「不可逆 → 上游有 BPM 闸口」这一格**被本轮真跑检验到了**（bpm_approval 1 个）

### ⑥⑦ 变异探针（只改插入节点的 type，其余一字不动）

- 插 hitl.confirm → passed=false，errors 1 条
- 插 hitl.bpm_approval → passed=false，errors 1 条
- 插 confirm 时的 errors：
  - 节点(id=e2e_gate_probe_node) 是 hitl.confirm，但本流程由定时任务触发、跑起来时没有人在场：它会推一张聊天确认卡然后挂起，而这次执行既没有聊天窗口可点、resume_at 与 event_key 也都是空的，没有任何唤醒方，会一直停在 INTERRUPTED。无头流程的人工介入请改用 hitl.bpm_approval（走 BPM 待办唤醒，有承办人、不依赖聊天窗口）

---

## 残留核账（方案 §6.2）

- 会话：跑前 1 条 → 删除本轮新建 1 条 → 跑后多出 0 条
- 流程 def：跑前 3 条 → 删除本轮新建 1 条 → 跑后多出 0 条
- 物理表：**本用例不建表**（只出草稿 + 只读体检），故不核表数
