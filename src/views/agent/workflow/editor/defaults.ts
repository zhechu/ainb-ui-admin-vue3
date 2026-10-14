/**
 * 流程编排设计器的共享常量（AI助手 UX 修复：从 WorkflowDefFormDialog 抽出，整页编辑器与画布空状态引导共用）
 */

/** 流程编码校验：小写字母开头，仅含小写字母/数字/下划线，长度 2~64（对齐后端 AgentWorkflowDefSaveReqVO） */
export const CODE_PATTERN = /^[a-z][a-z0-9_]{1,63}$/

/**
 * 新建时的最小骨架：START→tool→END，开箱即可通过后端双层校验，降低「从零手写 JSON」的门槛。
 * 🔴 tool 节点用只读工具 data_interface_list（已注册）+ 声明好 outputVar 对应的变量，
 * 这样深层干跑（buildStateGraph）能建图成功、且不产 warning——用户点「校验」直接看到「校验通过」。
 * trigger 用 trigger.chat（与既有已发布定义同构），createDef 落库时 WorkflowTriggerExtractor 能正常投影。
 *
 * 🔴 「工作流驱动的 Agent」两个约定：
 *  ① trigger.chat.config.agentId：填要驱动的 Agent 的<b>编码 code</b>（非数字 id）。发布后，用户在该 Agent 的
 *     聊天窗口每发一句话，都会把这句话写进 input 变量、跑一遍本流程，而不是走直连大模型。
 *     <b>留空 = 仅手动运行</b>（不绑定任何 Agent）。
 *  ② output 变量：流程跑完后，聊天回复取 state 里的 `output`（约定键，与固定的输入键 `input` 对称）。
 *     想让 Agent 在聊天里回什么，就把最终文本写进 `output`。
 *
 * 🔴 webhook 触发器：把 trigger 换成
 *     { type: 'trigger.webhook', config: { path: 'order_hook', authType: 'hmac', secret: '<随机密钥>' } }
 *    发布后入站地址为 POST /admin-api/agent/webhook/{path}，调用方须带标准 tenant-id 头；
 *    authType <b>只能是 hmac/token</b>（平台已无「不鉴权」这一档），secret 无条件必填。
 *    校验发生在 createDef/updateDef <b>落库前</b>（不是发布时）：WorkflowTriggerExtractor 直接抛
 *    WORKFLOW_TRIGGER_CONFIG_INVALID；入站时 AgentWebhookTriggerServiceImpl 再验一次签。
 */
export const DEFAULT_DSL = JSON.stringify(
  {
    dslVersion: '1.0',
    id: 'wf_demo',
    name: '示例流程',
    description: '请按需修改节点与连线',
    // agentId 留空=仅手动运行；填某个已发布 Agent 的 code，则该 Agent 的聊天由本流程驱动（见上方注释①）
    trigger: { type: 'trigger.chat', config: { inputVar: 'input', agentId: '' } },
    variables: [
      { key: 'input', type: 'string', merge: 'replace', required: false },
      { key: 'listOut', type: 'object', merge: 'replace' },
      // 聊天回复约定键：把流程最终要回给用户的文本写进 output（见上方注释②）
      { key: 'output', type: 'string', merge: 'replace' }
    ],
    nodes: [
      {
        id: 'step_1',
        type: 'tool',
        name: '示例工具节点',
        config: { toolId: 'data_interface_list', args: { keyword: 'demo', limit: 10 }, outputVar: 'listOut' }
      }
    ],
    edges: [
      { from: 'START', to: 'step_1' },
      { from: 'step_1', to: 'END' }
    ],
    settings: { recovery: 'forward', executionTimeoutSeconds: 120 }
  },
  null,
  2
)
