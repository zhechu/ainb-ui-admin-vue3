import request from '@/config/axios'

/**
 * 一条复核规则 ← 后端 {@code QlzgReviewRuleRespVO}（表 {@code qlzg_review_rule}）
 *
 * <h3>🔴 {@code platform = true} 的行**整行只读**，而页面要**先说出来**</h3>
 * 改不了也删不了（{@code REVIEW_RULE_PLATFORM_IMMUTABLE}），
 * 但不要等用户填完一屏 expr 点了保存才收到那句报错 ——
 * 那一次的产出是「这个功能坏了」这个印象，而真相是「这一行本来就不给你改」。
 * 只读由**写**端点拦，不由**读**端点拦：{@code /get} 照样返回平台行，
 * 因为配置页要能把它的 {@code expr} 原文展示出来给人参考
 * （机构自建一条同口径的规则时，抄一遍比凭空写靠谱）。
 *
 * <h3>🔴 {@code severityCeiling} 是**灰掉非法档位**用的，不是保存后再报错用的</h3>
 * 它由法域算出来（{@code QlzgLawDomainEnum#maxSeverity()}）：
 * 「专家指引」的天花板是 WARN，因为建议性文件不能产生强制性拦截（优先级 5 永不升级）。
 * 而机构自建规则的法域一律被强制成 {@code ORG_INTERNAL}，它的天花板就是 BLOCK ——
 * 所以在**本模块的配置页上这一列恒为 BLOCK**，那个下拉三档都能选。
 * 它仍然要下发，是为了让界面在展示平台行时说清「这一条为什么最高只能到提示」。
 *
 * <h3>🔴 {@code exprParams} 是**原文字符串**，不是解析后的对象</h3>
 * 直接塞进 JSON 文本框。**解析再回传会产生一次假的内容变更**，
 * 而 {@code rule_set_version} 对它照实响应 —— 指纹变了、红点亮了，
 * 用户却什么都没改。这条与「MySQL 的 json 列会按键长重排、不保序」是同一家族
 * （见 {@code QlzgParamSnapshotVO.frozenValueJson} 那一份的处理）。
 *
 * <h3>🔴 {@code referencedFacts} 是后端从 {@code expr} 与两个模板列里扫出来的</h3>
 * 前端不要自己再扫一遍：扫描面是**三列**，而两个模板列只扫 {@code ${...}} 之内
 * （全角括号「（）」不在 {@code [A-Za-z0-9_$]} 里，
 * 于是「详见 ext_json 说明」这类散文不会被当成路径）。
 * 前端自己写一份正则的结果是「界面上说这条规则用了 3 个事实、引擎实际读了 5 个」，
 * 而两者都不报错。
 */
export interface QlzgReviewRuleVO {
  id: number
  /** 裸码，全局唯一（含平台行与本机构**已删除**的行 —— 唯一索引不含 deleted） */
  ruleCode: string
  ruleName: string
  description?: string | null
  lawDomain?: string | null
  lawDomainName?: string | null
  /** 本法域允许的天花板档位：EXPERT_GUIDE → WARN，其余 → BLOCK */
  severityCeiling?: string | null
  /** 准则条款依据，例如《资产评估执业准则——资产评估方法》第 X 条 */
  clauseRef?: string | null
  severity?: string | null
  severityName?: string | null
  /** aviator 表达式原文。沙箱锁死了特性集，见后端 {@code QlzgRuleExprSandbox} */
  expr?: string | null
  /** 🔴 原文字符串，不是对象；见上面那一段 */
  exprParams?: string | null
  targetKind?: string | null
  targetKindName?: string | null
  messageTemplate?: string | null
  suggestionTemplate?: string | null
  /** 0 / 1。含 0 的行照样下发，否则「停用」与「删除」在界面上无法区分 */
  enabled?: number
  /** 后端扫出来的事实名清单 */
  referencedFacts?: string[]
  sort?: number | null
  /** true = 平台预置，整行只读 */
  platform?: boolean
  /** LocalDateTime ⇒ epoch 毫秒 */
  createTime?: Date | null
}

/**
 * 新建 / 修改一条机构自建规则 ← 后端 {@code QlzgReviewRuleSaveReqVO}
 *
 * <h3>🔴 法域**只能是** {@code ORG_INTERNAL}</h3>
 * 传 LAW / STANDARD 这类会被拒（{@code REVIEW_RULE_LAW_DOMAIN_FORCED}）——
 * 那等于让一条机构私规在 30 年档案里宣称自己有法律授权。
 * 而 ORG_INTERNAL **照样可以配 BLOCK**。
 * 所以表单里这一项应当是**固定显示「机构内部制度」**，不是一个能选的下拉：
 * 一个只有一项可选的下拉，产出的是「为什么选不了法律」这个疑问，
 * 而答案（不能宣称）比疑问更该被看见。
 *
 * <h3>🔴 本 VO **不收** {@code enabled}</h3>
 * 新建的规则一律是启用的，改的时候传了也不生效 ——
 * 「先建一条停用的」在本模块没有意义，因为**没有开关这个概念**（§11.9.2.7 第 1 条：
 * 48 条规则的开关组合是 2⁴⁸ 种状态，出事后无法举证当时的规则集是什么）。
 * 要放行单条误报，走复核工作台的**逐条豁免**（带 {@code waiveReason}、只有技术负责人能操作）。
 *
 * <h3>🔴 修改时 {@code ruleCode} **不可改**，界面上要灰掉 + tooltip，不是隐藏</h3>
 * {@code qlzg_review_run.rule_code} 是裸 varchar，改码会让已经落库的那一批命中明细
 * 指向一个不再存在的码，而档案里那一行从此无法归属
 * （{@code REVIEW_RULE_CODE_IMMUTABLE}，且这道判在内容校验**之前**）。
 * 隐藏会被理解成「这功能坏了」，与法定评估项目那条（§11.9.2.6 第 6 条）同一条 UI 纪律。
 */
export interface QlzgReviewRuleSaveVO {
  id?: number
  ruleCode: string
  ruleName: string
  description?: string | null
  lawDomain?: string | null
  clauseRef?: string | null
  severity: string
  expr: string
  /** 🔴 原文字符串，原样回传 */
  exprParams?: string | null
  targetKind?: string | null
  messageTemplate?: string | null
  suggestionTemplate?: string | null
  sort?: number | null
}

/**
 * 一个 {@code expr} 可引用的事实名 ← 后端 {@code QlzgRuleFactRespVO}
 *
 * <h3>🔴 {@code available = false} 的行**照样下发**，也**照样列出**</h3>
 * 它们解释了「为什么库里那 20 条平台规则出厂就是停用的」。
 * 藏掉之后技术负责人看到的是一片没有理由的灰色 ——
 * 而「不知道原因」的下一步通常是「那就当它坏了，别用这个功能」。
 * 界面上把它们与可用的分开展示、把 {@link note} 印出来，
 * 不要用一个 disabled 的选择项糊过去。
 *
 * <h3>🔴 {@code note} 是**用户文案**，原样渲染纯文本</h3>
 * 不要 v-html，也不要再加工。它由后端 {@code QlzgUserFacingTextGuardTest} 守着
 * 不带 🔴 / {@code <b>} 这类源码标记 —— 那个守卫存在的全部理由，
 * 就是让前端可以闭着眼睛把它印出来。
 *
 * <h3>🔴 {@code key} 里的章节事实第二段是 **env 码**，不是真章节码</h3>
 * 库里存 {@code S07-1}，expr 里只能写 {@code sections.S07_1}（aviator 解析不了连字符）。
 * 选择器要按 {@code key} 填进 expr，**不要**拿库里的章节码去拼 ——
 * 拼出来的那一支在引擎里恒为 nil，规则恒过，而配置页上看不出任何异常。
 *
 * <p>⚠️ {@code p.*} 不在这份词表里：它不是事实，是这条规则自己那一列
 *    {@code expr_params} 的键。选择器不要试图把它列出来
 */
export interface QlzgRuleFactVO {
  /** expr 里要写的那一个名字，例如 {@code report.status} / {@code sections.S07_1} */
  key: string
  /** 16 个根之一，用于分组显示 */
  root?: string | null
  /** 值类型（NUMBER / STRING / BOOLEAN / …），用于提示「这一支能不能做算术」 */
  kind?: string | null
  available?: boolean
  note?: string | null
}

export const QlzgReviewRuleApi = {
  /**
   * 本机构可见的全部复核规则（平台预置 + 本机构自建，**含停用的**）
   * ← {@code QlzgReviewRuleController#getRuleList}
   *
   * 🔴 排序是 {@code (sort, id)} 升序，前端**不要再排一次**：
   *    sort 相同的平台行之间靠 id 定序，前端按名称重排会让「执行顺序」这一列
   *    与工作台上的实际排列对不上，而用户看不出差别在哪
   * 🔴 权限点 {@code qlzg:review:config}（**不是** {@code qlzg:review:rule}）：
   *    本控制器七个端点全是这一个权限串。新权限串没有对应按钮菜单时，
   *    非超管会**静默**失去能力（全程 200 无异常）
   */
  getRuleList: (): Promise<QlzgReviewRuleVO[]> =>
    request.get({ url: '/qlzg/review/rule/list' }),

  /**
   * 一条规则的详情 ← {@code QlzgReviewRuleController#getRule}
   *
   * 🔴 可见范围是「平台 + 本机构」，读到别家机构的行会报 {@code REVIEW_RULE_NOT_EXISTS}。
   *    本端点**不收** {@code tenantId} 入参，归属一律从登录上下文取
   */
  getRule: (id: number): Promise<QlzgReviewRuleVO> =>
    request.get({ url: '/qlzg/review/rule/get', params: { id } }),

  /**
   * {@code expr} 可引用的全部事实名（词表，**含本版本算不出来的**）
   * ← {@code QlzgReviewRuleController#getFactList}
   *
   * 🔴 这是配置页那个「可用事实」选择器的唯一数据源，前端**不要**自己维护一份事实清单
   */
  getFactList: (): Promise<QlzgRuleFactVO[]> =>
    request.get({ url: '/qlzg/review/rule/fact/list' }),

  /**
   * 「现在跑一次复核会用到」的规则集指纹（32 位十六进制）
   * ← {@code QlzgReviewRuleController#getRuleSetVersion}
   *
   * 🔴 与某份报告档案里的 {@code qlzg_review.ruleSetVersion} **可以直接比**：
   *    行集与算法都是引擎用的那一套（平台 + 本机构、{@code enabled = 1}）。
   *    不等就说明「这份报告是按另一批规则判的」⇒ 亮红点
   * 🔴 「翻一次 enabled」也会让红点亮起来，那是对的：停用一条规则等于此后少查一项，
   *    而档案里那些「未命中」的旧结论是按查过它得出的
   * 🔴 **不要**把它当成「不一样就拦住」的开关，它只是一个提示：
   *    30 年后调档的人要能看出「这一份的口径与今天不同」
   * 🔴 也不要把两个指纹的原文并排印出来给人比对 ——
   *    32 位十六进制的差集肉眼读不出任何东西，要显示就显示「变了 / 没变」
   */
  getRuleSetVersion: (): Promise<string> =>
    request.get({ url: '/qlzg/review/rule/rule-set-version' }),

  /**
   * 新建一条机构自建规则 ← {@code QlzgReviewRuleController#createRule}
   *
   * 🔴 规则码撞上会报 {@code REVIEW_RULE_CODE_DUPLICATE}，**含本机构已删除的行**
   *    （唯一索引不含 deleted）。这是刻意的：编号可复用等于让档案里的 R08
   *    在某一天开始指另一件事。不要求以 R 开头，机构自建用 {@code ORG-01} 这类码更好 ——
   *    R49 会让人以为它是平台的第 49 条
   * 🔴 {@code expr} / {@code exprParams} / 两个模板列在保存期就要过一整条校验链，
   *    任一步不过都被拒。存下一条坏规则的真实后果是**这个机构的每一份报告都定不了稿**，
   *    而报错指着引擎 —— 所以这条校验链宁可在保存时就啰嗦
   */
  createRule: (data: QlzgReviewRuleSaveVO): Promise<number> =>
    request.post({ url: '/qlzg/review/rule/create', data }),

  /**
   * 修改一条机构自建规则 ← {@code QlzgReviewRuleController#updateRule}
   *
   * 🔴 {@code ruleCode} 必须**原样回传**（灰掉、不可编辑）：与库里的不等即拒
   * 🔴 校验链与 {@link createRule} 是**同一份代码**，只是少了「查重」与「码形状」两步
   */
  updateRule: (data: QlzgReviewRuleSaveVO): Promise<boolean> =>
    request.put({ url: '/qlzg/review/rule/update', data }),

  /**
   * 软删一条机构自建规则 ← {@code QlzgReviewRuleController#deleteRule}
   *
   * 🔴 删掉一条正在跑的规则，会让此后每一次复核少查一项，
   *    而档案里**看不出**少查了什么 —— 只有 {@code rule_set_version} 会变。
   *    所以确认弹层应当把「当前指纹将变成什么」说清楚，
   *    而不是一句「确定删除吗」
   * 🔴 软删之后那个 {@code ruleCode} **仍然被占着**，
   *    「删掉再建一条同码的」会报 {@code REVIEW_RULE_CODE_DUPLICATE}
   */
  deleteRule: (id: number): Promise<boolean> =>
    request.delete({ url: '/qlzg/review/rule/delete', params: { id } })
}
