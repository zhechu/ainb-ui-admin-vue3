/**
 * 五种触发方式的「经典案例」（AI助手 流程编排优化 / Req 3）
 *
 * 新增流程时，非技术人员最大的障碍不是画布怎么拖，而是「这种触发方式到底该怎么配、配完能干什么」。
 * 本模块为 none/chat/form_event/schedule/webhook 各给一个**开箱即可通过后端双层校验**的完整案例：
 * 既有可直接落库的 variables/nodes/edges，也有讲清「为什么这么配」的场景说明与要点提示。
 *
 * 🔴 与 starterDsl 的分工（避免两处漂移）：
 *   · 本模块只产 **body**（variables/nodes/edges）——即「流程长什么样」；
 *   · `starterDsl.buildTriggerBlock` 独家负责 **trigger 块**——即「怎么被触发」。
 *   案例里的 `triggerDefaults` 只是给弹窗预填的**建议值**，最终写进 DSL 的 trigger 仍由 starterDsl 组装。
 *
 * 🔴 `body` 是**函数**不是常量：editorModel 的所有变更都是就地突变（mutate in place），
 *   若共享同一份字面量对象，第二次用案例时会拿到被上一次改脏的结构。每次调用都返回全新对象。
 *
 * 🔴 案例内容逐字对齐后端契约，绝不臆造：
 *   · 工具键与入参名取自 @AgentTool 实现（form_list.keyword / datamodel_list.keyword /
 *     data_interface_list.{keyword,limit} / form_data_get.{code,pk}），且**全部只用 READ_ONLY 工具**，
 *     案例跑起来不会产生任何副作用；
 *   · form_event 载荷 = {formCode, eventType, dataId}（FormDataChangedTriggerListener）；
 *     schedule 载荷 = {triggerType, scheduledFireTime, cron}（WorkflowScheduleTriggerScheduler）；
 *     webhook 载荷 = 请求体 JSON 的顶层键（非 JSON 对象则整段塞进 raw）（AgentWebhookTriggerServiceImpl）；
 *     三者都整包写进 state[inputVar]，inputVar 默认 "input"（WorkflowTriggerInvoker.invokeHeadless）；
 *   · condition.rule 的 branches[].target 是**路由键**（非节点 id），由条件边的 cases 映射到节点；
 *     conditions[].var 走 ctx.get(var)，**只读顶层变量**，取不到 input.amount 这类嵌套字段
 *     （RuleConditionNodeExecutor 类注释明示），故「script 提字段 → condition.rule 判」是固定套路。
 */

import type { WorkflowTriggerType } from './starterDsl'

/** 案例的图主体：直接铺进 DSL 的 variables/nodes/edges */
export interface TriggerCaseBody {
  variables: Record<string, any>[]
  nodes: Record<string, any>[]
  edges: Record<string, any>[]
}

/** 选中案例时给弹窗预填的触发配置建议值（用户仍可改；agentId/formCode 因租户而异，留空让用户自己选） */
export type TriggerDefaults = Partial<{
  agentId: string
  formCode: string
  eventType: string
  cron: string
  path: string
  authType: string
}>

export interface TriggerCase {
  triggerType: WorkflowTriggerType
  /** 案例名，如「产品手册问答助手」 */
  title: string
  /** 一句话场景：这个案例解决什么业务问题 */
  scenario: string
  /** 一行流程走向，如 START → 查表单 → 回答 → END，让人不点开也看得懂结构 */
  flowText: string
  /** 该触发方式在新增弹窗里该怎么填（人话，不写 config 键名） */
  configSummary: string
  /** 关键要点（面向非技术人员的中文提醒，尤其那些「配错了不报错但不生效」的坑） */
  highlights: string[]
  /** 弹窗预填建议值 */
  triggerDefaults: TriggerDefaults
  /** 图主体；每次调用返回全新对象（见文件头 🔴） */
  body: () => TriggerCaseBody
}

// ---------- 1. none：手动 / 接口触发 ----------

/**
 * 平台资产盘点：串两个只读工具拿全量清单，再交给大模型汇总成报告。
 *
 * 选它当 none 的案例，是因为「多工具串联 + LLM 收口」是最基础的流程骨架，
 * 且不依赖任何租户数据（表单/数据表清单每个租户都有），谁点谁跑得通。
 */
const noneCase: TriggerCase = {
  triggerType: 'none',
  title: '平台资产盘点',
  scenario: '不配触发器，只在「执行历史」里手动点运行、或由外部接口调用。适合按需出报告、一次性巡检。',
  flowText: 'START → 查表单清单 → 查数据表清单 → 汇总成盘点报告 → END',
  configSummary: '不用填任何东西——选了「手动 / 接口」就没有额外配置项。',
  highlights: [
    '没有触发器 = 不会自动跑：只能手动运行，或由后端按流程编码调用 run 接口。',
    '两个工具都是只读的，反复跑不会改动任何数据，可以放心拿来练手。',
    '工具结果存进 formList / modelList 两个变量，下游用 {{$.formList}} 引用——这就是节点之间传值的方式。',
    '最后一个大模型节点把结果写进 report；想让聊天窗口回什么，就把它写进约定的 output 变量。'
  ],
  triggerDefaults: {},
  body: () => ({
    variables: [
      { key: 'formList', type: 'object', merge: 'replace' },
      { key: 'modelList', type: 'object', merge: 'replace' },
      { key: 'report', type: 'string', merge: 'replace' }
    ],
    nodes: [
      {
        id: 'list_forms',
        type: 'tool',
        name: '查表单清单',
        config: { toolId: 'form_list', args: { keyword: '' }, outputVar: 'formList' }
      },
      {
        id: 'list_models',
        type: 'tool',
        name: '查数据表清单',
        config: { toolId: 'datamodel_list', args: { keyword: '' }, outputVar: 'modelList' }
      },
      {
        id: 'summarize',
        type: 'llm',
        name: '汇总成盘点报告',
        config: {
          prompt:
            '下面是本租户的表单清单与数据表清单：\n\n' +
            '【表单】{{$.formList}}\n【数据表】{{$.modelList}}\n\n' +
            '请用中文输出一份简明盘点报告：\n' +
            '1. 各有多少个，其中已发布（published=true）的表单有多少；\n' +
            '2. 列出可能缺少配套数据表的表单、以及还没建表单的数据表（各最多 5 个，用名字）；\n' +
            '3. 给出 3 条最值得先做的治理建议。\n' +
            '只依据上面清单里真实存在的名字，不要编造。',
          outputVar: 'report'
        }
      }
    ],
    edges: [
      { from: 'START', to: 'list_forms' },
      { from: 'list_forms', to: 'list_models' },
      { from: 'list_models', to: 'summarize' },
      { from: 'summarize', to: 'END' }
    ]
  })
}

// ---------- 2. chat：对话驱动 Agent ----------

/**
 * 表单问答助手：用户每发一句话就跑一遍流程，先按这句话查库，再让大模型组织回答。
 *
 * 「先查再答」而不是直接把问题丢给模型，是为了示范 chat 流程最该有的形态——
 * 模型不知道这个租户有哪些表单，不查就只能猜编码然后失败。
 */
const chatCase: TriggerCase = {
  triggerType: 'chat',
  title: '表单问答助手',
  scenario: '用户在绑定智能体的聊天窗口每发一句话，就跑一遍本流程，流程结果当作回复。',
  flowText: 'START → 按问题查表单 → 组织中文回答 → END',
  configSummary: '只需选一个「驱动 Agent」（已发布的智能体）；留空则本流程只能手动运行。',
  highlights: [
    '用户这句话会自动写进 input 变量，流程里用 {{$.input}} 取；本案例直接拿它当工具的关键字去查表单。',
    '聊天回复固定读 output 变量——想让智能体回什么，最后一个节点就把结果写进 output。',
    '「驱动 Agent」只能选已发布的智能体：草稿或已停用的在聊天入口本就选不到，绑了也不生效。',
    '不选智能体（留空）也没问题，流程照样能手动运行，只是没有聊天入口。',
    '想让回答带上平台产品手册的依据，把工具换成 doc_search（入参 query 填 {{$.input}}）即可。'
  ],
  triggerDefaults: {},
  body: () => ({
    variables: [
      { key: 'input', type: 'string', merge: 'replace', required: false },
      { key: 'forms', type: 'object', merge: 'replace' },
      { key: 'output', type: 'string', merge: 'replace' }
    ],
    nodes: [
      {
        id: 'lookup_forms',
        type: 'tool',
        name: '按问题查表单',
        config: { toolId: 'form_list', args: { keyword: '{{$.input}}' }, outputVar: 'forms' }
      },
      {
        id: 'answer',
        type: 'llm',
        name: '组织中文回答',
        config: {
          prompt:
            '用户的问题是：{{$.input}}\n\n' +
            '下面是按该问题检索到的表单清单（JSON）：\n{{$.forms}}\n\n' +
            '请基于这份清单用中文回答用户：\n' +
            '- 命中了哪些表单，逐个给出「名称（编码）」，并说明是否已发布；\n' +
            '- 清单为空时如实说明没找到，并建议用户换个更短的关键字再问，绝不猜测编码。\n' +
            '回答控制在 200 字以内。',
          outputVar: 'output'
        }
      }
    ],
    edges: [
      { from: 'START', to: 'lookup_forms' },
      { from: 'lookup_forms', to: 'answer' },
      { from: 'answer', to: 'END' }
    ]
  })
}

// ---------- 3. form_event：表单事件 ----------

/**
 * 数据新增后自动生成跟进建议：表单每新增一行就自动跑一遍，读回那行数据交给大模型出建议。
 *
 * 刻意选「读回刚变更的那行」而不是让调用方传数据，是为了示范 form_event 载荷里真正有什么
 * （只有 formCode/eventType/dataId，没有行内容），以及 {{$.input.字段}} 的嵌套取值写法。
 */
const formEventCase: TriggerCase = {
  triggerType: 'form_event',
  title: '新增数据后自动生成跟进建议',
  scenario: '指定表单发生新增/修改/删除时自动跑一遍。适合数据一进来就要做点什么（提醒、打分、生成建议）。',
  flowText: 'START → 读回刚变更的那行 → 生成跟进建议 → END',
  configSummary: '填「表单编码」（要监听哪张表单，可从表单管理页复制）+ 选「事件类型」（本案例建议：新增时 create）。',
  highlights: [
    '触发载荷只有三个字段：{formCode, eventType, dataId}，整包写进 input，所以用 {{$.input.dataId}} 取主键。',
    '载荷里没有行的内容，要用 form_data_get 按 code + pk 把那行读回来——这一步不能省。',
    '🔴 无头执行（后台自动跑，没有人在界面上等着）：「人工确认」节点会让这次执行一直停在「等待确认」，体检直接报错、发不出去。需要人把关请改用「BPM 审批」——它有承办人和待办列表，不依赖聊天窗口。',
    '「等待」节点分两种：等待方式填 duration（等一段时间）是可以的，到点由平台自动唤醒；填 event（等外部事件）就必须在该节点写明谁会来发那个事件，否则同样发不出去。',
    '表单编码和事件类型在发布时会 fail-close 校验，配错发不出去，别等到线上才发现。',
    '同一张表配多条流程时，每次数据变更会把它们全部触发一遍，注意别互相写同一张表。'
  ],
  triggerDefaults: { eventType: 'create' },
  body: () => ({
    variables: [
      { key: 'input', type: 'object', merge: 'replace', required: false },
      { key: 'row', type: 'object', merge: 'replace' },
      { key: 'output', type: 'string', merge: 'replace' }
    ],
    nodes: [
      {
        id: 'load_row',
        type: 'tool',
        name: '读回刚变更的那行',
        config: {
          toolId: 'form_data_get',
          args: { code: '{{$.input.formCode}}', pk: '{{$.input.dataId}}' },
          outputVar: 'row'
        }
      },
      {
        id: 'draft_advice',
        type: 'llm',
        name: '生成跟进建议',
        config: {
          prompt:
            '下面是一条刚发生数据变更的表单记录（JSON）：\n{{$.row}}\n\n' +
            '变更类型：{{$.input.eventType}}（create=新增 / update=修改 / delete=删除）\n\n' +
            '请用中文给出 3 条可执行的跟进建议，每条一行，格式为「建议：原因」。' +
            '只依据这条记录里真实存在的字段，不要编造字段或数值。',
          outputVar: 'output'
        }
      }
    ],
    edges: [
      { from: 'START', to: 'load_row' },
      { from: 'load_row', to: 'draft_advice' },
      { from: 'draft_advice', to: 'END' }
    ]
  })
}

// ---------- 4. schedule：定时 ----------

/**
 * 每日凌晨数据接口巡检：定时拉全量接口目录，让大模型出一份治理摘要。
 *
 * 定时触发最典型的形态就是「周期性巡检 + 汇总」，且 data_interface_list 是只读的，
 * 案例可以放心按 cron 真跑，不会半夜改坏数据。
 */
const scheduleCase: TriggerCase = {
  triggerType: 'schedule',
  title: '每日凌晨数据接口巡检',
  scenario: '按 Cron 定时自动跑。适合日报、周期巡检、定时同步这类没人触发也要发生的事。',
  flowText: 'START → 拉取接口目录 → 生成巡检摘要 → END',
  configSummary: '只需填「Cron 表达式」，本案例建议 0 0 2 * * ?（每天凌晨 2 点跑一次）。',
  highlights: [
    '🔴 Cron 是 Spring 的 6 段格式（秒 分 时 日 月 周），不是 Quartz 的 7 段，也不支持 L/W/# 这些符号。',
    '每天凌晨 2 点 = 0 0 2 * * ?；每小时整点 = 0 0 * * * ?。发布时会校验 cron 合法性，写错发不出去。',
    '触发载荷是 {triggerType, scheduledFireTime, cron}，整包写进 input，用 {{$.input.scheduledFireTime}} 取本次到点时刻。',
    '🔴 同样是无头执行：「人工确认」节点发不出去，要人把关请改用「BPM 审批」（走待办、有承办人）；「等待」只在等待方式为 duration 时可用，为 event 时必须写明谁来发那个事件。',
    '定时任务先 CAS 认领再触发，多实例部署也不会同一到点被跑两遍。'
  ],
  triggerDefaults: { cron: '0 0 2 * * ?' },
  body: () => ({
    variables: [
      { key: 'input', type: 'object', merge: 'replace', required: false },
      { key: 'interfaces', type: 'object', merge: 'replace' },
      { key: 'report', type: 'string', merge: 'replace' }
    ],
    nodes: [
      {
        id: 'probe',
        type: 'tool',
        name: '拉取数据接口目录',
        config: { toolId: 'data_interface_list', args: { keyword: '', limit: 50 }, outputVar: 'interfaces' }
      },
      {
        id: 'digest',
        type: 'llm',
        name: '生成巡检摘要',
        config: {
          prompt:
            '本次定时巡检时间：{{$.input.scheduledFireTime}}\n\n' +
            '下面是平台的数据接口目录（JSON）：\n{{$.interfaces}}\n\n' +
            '请用中文输出一份巡检摘要：\n' +
            '1. 一共多少个接口，按类型（SQL 查询 / HTTP 转发 / 静态 JSON）分别多少个；\n' +
            '2. 列出命名不规范或看起来可能重复的最多 5 个；\n' +
            '3. 给出 2 条治理建议。\n' +
            '不要编造目录里没有的接口。',
          outputVar: 'report'
        }
      }
    ],
    edges: [
      { from: 'START', to: 'probe' },
      { from: 'probe', to: 'digest' },
      { from: 'digest', to: 'END' }
    ]
  })
}

// ---------- 5. webhook：外部回调 ----------

/**
 * 外部下单回调按金额分流：外部系统 POST 进来，先用 script 把嵌套字段提到顶层，
 * 再用 condition.rule 按金额走两条不同的大模型分支。
 *
 * 它是五个案例里唯一带**条件分支**的，因为 webhook 的真实用途几乎都是「外面发生了一件事，
 * 按内容分流处理」。同时它示范了那条绕不过去的固定套路：condition.rule 的条件只能读顶层变量，
 * 要判 input.amount 这种嵌套字段，必须先用 script 节点把它提成一个顶层变量。
 *
 * 🔴 重构 S4a-i / #72 补的要点，都是「照抄就撞墙」那一类：
 *   · webhook 也是**无头**触发，而本案例此前是五个里唯一没写这条的 —— form_event 与 schedule
 *     都写了，读者会以为只有那两个有约束。
 *   · 「鉴权选『无』则只靠 path 不可猜」这句话是**假的**：path 是作者手填的一格
 *     （{@code WorkflowForm.vue} 一个普通输入框、默认空串），两个仓库里都没有任何随机串生成，
 *     而且它会进日志、进前端 URL、进浏览器历史与代理缓存。详见 V15 的类注释
 *     （{@code WorkflowDslValidator#validateWebhookAuth}）。
 *     ✅ #72 已裁定并落地：**「无」这一档整个删掉**，不是「保留但自动生成不可猜 path」——
 *     后者的前提同样是假的（自动生成的 path 一样会进日志/URL/历史），只是把假话换了个说法。
 *     设计器下拉、后端落库白名单、入站验签三处同改，故本案例的 authType 只能是 hmac/token。
 *   · 🔴 {@code triggerDefaults} 刻意**不预填 secret**：密钥是凭据，预填一个字面量进表单
 *     等于鼓励所有租户共用一个弱密钥，还会明文显示在界面上。留空 + 提交前必填校验，
 *     逼作者自己生成一条，才是对的。
 */
const webhookCase: TriggerCase = {
  triggerType: 'webhook',
  title: '外部下单回调按金额分流',
  scenario: '外部系统 POST 入站地址即触发，请求体就是流程输入。适合对接第三方回调、跨系统联动。',
  flowText: 'START → 取出金额 → 按金额分流 →（大额单 / 小额单）→ END',
  configSummary:
    '填「入站 Path」（本案例建议 order_callback，发布后地址即 /admin-api/agent/webhook/order_callback）+ 选「鉴权方式」（只能 hmac 或 token）+ 填验签密钥。',
  highlights: [
    '发布后入站地址是 POST /admin-api/agent/webhook/{path}，调用方必须带标准 tenant-id 头。',
    '请求体 JSON 的顶层键原样写进 input，所以 {"amount":12000} 用 {{$.input.amount}} 取；不是 JSON 对象时整段落在 {{$.input.raw}}。',
    '🔴 条件判断只能读顶层变量，读不到 input.amount 这种嵌套字段。固定套路：先用「脚本」节点把字段提成顶层变量 amount，再用「规则条件」判它。',
    '🔴 无头执行：回调打进来时没有人在界面上等着，「人工确认」节点会让这次执行一直停在「等待确认」、体检直接报错。要人把关请改用「BPM 审批」（走待办、有承办人）；「等待」只在等待方式为 duration 时可用，为 event 时必须写明谁来发那个事件。',
    '「规则条件」分支里的 target 是**路由键**（本案例是 big / small），不是节点 id；节点 id 在连线的 cases 里映射。',
    '🔴 鉴权方式只能选 hmac 或 token，并且必须填验签密钥（保存时就会校验，不用等到发布）。「不鉴权」这一档已经从平台删掉了：入站地址是免登录的，而「安全全靠 path 不可猜」这个前提在本平台**不成立**——path 是作者手填的一格、没有任何随机串生成，还会进日志和前端 URL，知道 path 的人就能用发布者的权限把这条流程跑完。'
  ],
  triggerDefaults: { path: 'order_callback', authType: 'hmac' },
  body: () => ({
    variables: [
      { key: 'input', type: 'object', merge: 'replace', required: false },
      { key: 'amount', type: 'number', merge: 'replace' },
      { key: 'output', type: 'string', merge: 'replace' }
    ],
    nodes: [
      {
        id: 'extract_amount',
        type: 'script',
        name: '取出金额',
        config: {
          code: 'return Number(state.input && state.input.amount) || 0;',
          language: 'javascript',
          timeoutMs: 2000,
          outputVar: 'amount'
        }
      },
      {
        id: 'route_by_amount',
        type: 'condition.rule',
        name: '按金额分流',
        config: {
          branches: [{ target: 'big', conditions: [{ var: 'amount', op: 'gt', value: 10000 }] }],
          default: 'small'
        }
      },
      {
        id: 'big_order',
        type: 'llm',
        name: '大额单转人工复核',
        config: {
          prompt:
            '收到一笔大额订单回调，金额 {{$.amount}}，原始报文：{{$.input}}\n\n' +
            '请用中文输出一张人工复核工单，包含：金额、下单方、需要人工确认的 3 个要点、建议处理时限。' +
            '只使用报文里真实存在的字段，缺失的写「报文未提供」。',
          outputVar: 'output'
        }
      },
      {
        id: 'small_order',
        type: 'llm',
        name: '小额单自动确认',
        config: {
          prompt:
            '收到一笔小额订单回调，金额 {{$.amount}}，原始报文：{{$.input}}\n\n' +
            '请用中文输出一句自动确认话术，说明订单已进入自动处理队列、预计多久完成。控制在 80 字以内。',
          outputVar: 'output'
        }
      }
    ],
    edges: [
      { from: 'START', to: 'extract_amount' },
      { from: 'extract_amount', to: 'route_by_amount' },
      {
        from: 'route_by_amount',
        type: 'conditional',
        cases: { big: 'big_order', small: 'small_order' },
        default: 'small_order'
      },
      { from: 'big_order', to: 'END' },
      { from: 'small_order', to: 'END' }
    ]
  })
}

/** 触发方式 → 经典案例。五种触发方式各一个，一个都不缺（有单测守着） */
export const TRIGGER_CASES: Record<WorkflowTriggerType, TriggerCase> = {
  none: noneCase,
  chat: chatCase,
  form_event: formEventCase,
  schedule: scheduleCase,
  webhook: webhookCase
}

/** 五种触发方式的展示顺序（与 WorkflowForm 的 TRIGGER_OPTIONS 同序，避免两处顺序不一致看着别扭） */
export const TRIGGER_CASE_ORDER: WorkflowTriggerType[] = ['none', 'chat', 'form_event', 'schedule', 'webhook']

/**
 * 触发方式的中文短名——**唯一来源**。
 *
 * 🔴 原先「新增弹窗的下拉」「列表页的触发方式列」「案例参考页」各存一份中文映射，改一处忘两处就会
 *    出现同一个 triggerType 在不同页面叫不同名字。统一收在这里，三处都引它。
 */
export const TRIGGER_TYPE_LABELS: Record<WorkflowTriggerType, string> = {
  none: '手动 / 接口',
  chat: '对话驱动 Agent',
  form_event: '表单事件',
  schedule: '定时',
  webhook: 'Webhook'
}

/** 取某触发方式的中文短名；认不出的类型原样返回，绝不返回 undefined 让页面渲染出空白 */
export const triggerTypeLabel = (type?: string | null): string =>
  TRIGGER_TYPE_LABELS[(type ?? '') as WorkflowTriggerType] ?? (type || '未配置')

/** 取某触发方式的案例；认不出的类型返回 undefined（调用方自行退化，绝不抛错挡住新建） */
export const triggerCaseOf = (type?: string | null): TriggerCase | undefined =>
  TRIGGER_CASES[(type ?? '') as WorkflowTriggerType]
