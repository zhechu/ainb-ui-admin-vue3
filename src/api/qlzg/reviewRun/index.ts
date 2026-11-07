import request from '@/config/axios'

/**
 * 一次复核运行的运行头 ← 后端 {@code QlzgReviewRespVO}（表 {@code qlzg_review}）
 *
 * <h3>🔴 {@code runStatus = 'SKIPPED'} 与 {@code blockCountUnwaived = 0} 是两件不同的事</h3>
 * 前者是「**一行规则都没跑**」（OFF 档下闸 C 照样落一行运行头），
 * 后者是「跑了、没有未豁免的 BLOCK」。
 * 报告页那条常驻灰条的判据是 {@code runStatus === 'SKIPPED'}，
 * 黄条的判据是 {@code blockCountUnwaived > 0} —— 两者互斥，
 * 而「既没有黄条也没有灰条」只对应一种情况：**这份报告从来没被复核过**（见 {@link
 * QlzgReviewRunApi.getLatestReview}）。
 *
 * <h3>🔴 {@code passed = 0} 在 ADVISORY 档下是**常态**，不是异常</h3>
 * ADVISORY 的含义是「机器复核照跑，只提示不拦截」，所以报告会带着 {@code passed = 0}
 * 一路走到 FINALIZED。界面上不要把它渲染成一个红叉 ——
 * 而 {@code qlzg_review.passed} 也**永远**是当时的历史事实，豁免不改它（豁免只改明细行）。
 * 测试 #29③ 钉的就是这件事：机构级降为 ADVISORY 之后 {@code passed} 仍然是 0。
 *
 * <h3>🔴 {@code blockCountUnwaived} 是**现算**的，不是库里那一列</h3>
 * 豁免只改 {@code qlzg_review_run} 的明细行、不改运行头，于是这个数必须逐次重算。
 * 前端读到它时**不要**自己用 {@code blockCount} 减去什么 ——
 * 后端算的那一份与明细里 {@code blocksFinalizeNow = true} 的行数必然相等，
 * 而前端自己算的那一份在「一行 BLOCK 是坏的（{@code waived = 1} 而理由是空的）」时就会偏。
 */
export interface QlzgReviewVO {
  id: number
  reportId: number
  reportVersionId?: number | null
  /** 同一份报告上的第几次运行，人看的编号 */
  runNo?: string | null
  /** 那一次运行用的规则集指纹（32 位十六进制） */
  ruleSetVersion?: string | null
  totalRules?: number
  blockCount?: number
  warnCount?: number
  infoCount?: number
  /** 未豁免的 BLOCK 条数，黄条上那个整数就是它 */
  blockCountUnwaived?: number
  /** 0 / 1，历史事实，豁免不改它 */
  passed?: number
  runStatus?: string | null
  /** 后端算好的中文，展示用它，不要用前端的 map */
  runStatusName?: string | null
  /** 那一次闸 C 生效的档位（ENFORCE / ADVISORY / OFF），冻结，不随配置变 */
  gateCMode?: string | null
  gateCModeName?: string | null
  durationMs?: number | null
  triggeredBy?: number | null
  /**
   * 🔴 **只有 {@code /workbench} 会补它**，{@code /latest} 刻意不补
   *
   * 黄条上没有人名，而 {@code /latest} 是报告页最热的一个请求
   * （评估师边写边改时反复刷新那一屏）。所以拿到 null 不代表「查不到这个人」，
   * 也可能只是「这个端点不补」。要在黄条上显示触发人，走 {@code /workbench}
   */
  triggeredByNickname?: string | null
  /** LocalDateTime ⇒ epoch 毫秒 */
  triggeredAt?: Date | null
}

/**
 * 一条规则的求值结果 ← 后端 {@code QlzgReviewRunRespVO}（表 {@code qlzg_review_run}）
 *
 * <h3>🔴 这里**没有** {@code ruleName} / {@code lawDomain} / {@code clauseRef} 三列，是刻意的</h3>
 * 一行明细是**自解释的快照**，而 {@code rule_code} 是一列裸 varchar，
 * 正是为了让后来的一次改名 / 停用 / 删除影响不到它。
 * 去 join 今天的规则行，等于用一次改名静默重写一份归档 30 年的档案标题，
 * 而版本记录里没有任何一行说明这件事。
 * 要显示规则名的话，从 {@code QlzgReviewRuleApi.getRuleList} 拿一份
 * {@code ruleCode → ruleName} 的映射，并在界面上**标明「按今天的规则名显示」**。
 *
 * <h3>🔴 {@code errored = true} 要渲染成**灰色问号**，不是绿勾也不是红叉</h3>
 * 那一条规则压根没求出结果，我们不知道它过没过。
 * 渲染成绿勾是「假装查过了」，渲染成红叉是「假装查出了问题」，
 * 两者都在一份要保存 30 年的档案上写了一句假话。
 * 灰色问号配上 {@code errorMsg} 展开，才是「这一条不知道」的如实表达。
 *
 * <h3>🔴 {@code waived} 与 {@code waivedProperly} 可能不相等，而那是**要看见的**</h3>
 * 后端要求 {@code waived} / {@code waivedBy} / {@code waiveReason} 三者同时非空才算
 * {@code waivedProperly}。一行 {@code waived = 1} 而理由是空的**坏行**，
 * 在界面上显示成已豁免、闸 C 却不认 ——
 * 而「撤销豁免」正是修好它的唯一手段（撤销的判据是 {@code waived = 1}，不是
 * {@code waivedProperly}）。所以这一列不一致时要显式提示，别静默按已豁免显示。
 */
export interface QlzgReviewRunVO {
  id: number
  /** 裸码，不是名字。要显示名字见上面那一段 */
  ruleCode: string
  severity?: string | null
  severityName?: string | null
  hit?: boolean
  errored?: boolean
  errorMsg?: string | null
  /** 一段任意 JSON（字符串形态），展开时才 parse */
  hitDetail?: string | null
  sectionCode?: string | null
  fieldKey?: string | null
  /** false 时「定位到报告」那个按钮**不该出现**，而不是置灰 */
  locatable?: boolean
  /** 后端渲染好的中文提示，逐字显示，不要自己拼 */
  message?: string | null
  suggestion?: string | null
  waived?: boolean
  waivedProperly?: boolean
  waivedBy?: number | null
  waivedByNickname?: string | null
  waiveReason?: string | null
  /** 这一行此刻**是否还在拦定稿**。黄条上那个整数 = 本列为 true 的行数 */
  blocksFinalizeNow?: boolean
  /** LocalDateTime ⇒ epoch 毫秒 */
  updateTime?: Date | null
}

/**
 * 复核工作台（整屏一次取全）← 后端 {@code QlzgReviewWorkbenchRespVO}
 *
 * <h3>🔴 一次返回全部内容，前端**不要**拆成三次请求</h3>
 * 黄条上那句「3 条 BLOCK 未清零」必须等于明细里 {@code blocksFinalizeNow = true} 的行数，
 * 而这些行必须属于那一次运行。三个请求就是三个时刻，
 * 中间插进一次定稿的话，用户看到的是「黄条说 3 条、清单里 5 行」，
 * 而无从判断哪一边错了。
 *
 * <h3>🔴 {@code workbenchVisible = false} 时前端要**隐藏**入口，不是置灰</h3>
 * OFF 档的含义是「这个功能不在」（§11.9.2.6 第 8 条）。
 * 一个点进去永远空白的页面比没有入口更贵 —— 那是 §11.9.2.0 理由① 说的那种持续成本。
 * 置灰会被理解成「功能坏了」，与法定评估项目那条（§11.9.2.6 第 6 条）
 * 是同一条 UI 纪律的两个方向：**要人做决定的地方不置灰，功能真的不在的地方不留残影**。
 *
 * <h3>🔴 {@code runs} 是**每条规则一行**，不只是命中的那些</h3>
 * 前端不要把 {@code hit = false} 的行静默折叠掉：
 * 「48 条里有 45 条没命中」与「只查了 3 条」是两件不同的事，
 * 而前者是复核工作台上最该被看见的一句话。
 * 要折叠就折叠成一行明写着「45 条未命中」的汇总，别让它消失。
 */
export interface QlzgReviewWorkbenchVO {
  reportId: number
  reportNo?: string | null
  reportTitle?: string | null
  reportStatus?: string | null
  reportStatusName?: string | null
  versionNo?: number | null
  /** 这份报告**创建时**解析三级配置的结果，之后永不随配置变 */
  reviewModeEffective?: string | null
  reviewModeEffectiveName?: string | null
  workbenchVisible?: boolean
  /** ADVISORY 档下闸 C 被绕过 = true；此时 {@link gateCBypassedRunId} 指向那次运行 */
  gateCBypassed?: boolean
  gateCBypassedRunId?: number | null
  /** 最新一次运行的运行头；null = 这份报告从来没被复核过 */
  latest?: QlzgReviewVO | null
  runs?: QlzgReviewRunVO[]
  /** 历次运行头（不含明细），供「上次是几点跑的」这类追问 */
  history?: QlzgReviewVO[]
  /** 今天的规则集指纹 */
  currentRuleSetVersion?: string | null
  /** true = 那次运行用的规则集与今天的不同 ⇒ 版本红标 */
  ruleSetVersionChanged?: boolean
}

/**
 * 豁免一条 BLOCK 命中 ← 后端 {@code QlzgReviewRunWaiveReqVO}
 *
 * <h3>🔴 本 VO **不收** {@code waivedBy}，那一列由服务端从登录上下文取</h3>
 * 它是责任落点，接受入参就等于允许替别人签一个字。
 *
 * <h3>🔴 {@code reason} 上**一个**校验注解都没有，这是后端全部的设计</h3>
 * 直觉的写法是 {@code @NotBlank @Size(min = 10, max = 500)}，而它会推翻
 * {@code QlzgReviewRunServiceImpl} 里那条「**授权在前、输入在后**」的顺序：
 * 承办评估师本人不得豁免自己那份报告上的命中（{@code REVIEW_RUN_WAIVE_BY_APPRAISER}，
 * §11.9.1 纪律 4），而权限点拦不住这件事 ——
 * 一个人可以同时是技术负责人与承办评估师。
 * 让 Bean Validation 先跑的话，他要**往返两次**才看到那句他改不动的话：
 * 第一次「理由太短」，补完第二次「你不能豁免自己」。
 * 所以前端那道 ≥10 字校验放在提交之前是对的，但要清楚它拦不住绕过它的人。
 */
export interface QlzgReviewRunWaiveVO {
  runId: number
  reason: string
}

export const QlzgReviewRunApi = {
  /**
   * 报告页那条常驻黄条 / 灰条的数据 ← {@code QlzgReviewRunController#getLatestReview}
   *
   * 🔴 **只要登录**，没有 {@code @PreAuthorize}：黄条在报告页上常驻，
   *    而看报告的人不一定持有复核权限点。挂上权限点的表现是「黄条不出现」——
   *    那正好是 §11.9.2.6 第 3 条要防的「关了就看不见」，只不过换成「没权限就看不见」
   * 🔴 返回 **null**（不是空对象、也不是 0 条）表示这份报告从来没被复核过：
   *    一份刚建出来还没点过定稿的 DRAFT 就是这样。
   *    此时前端**既不**显示黄条**也不**显示灰条 ——
   *    一条写着「0 条问题」的黄条会被读成「查过了，没问题」，而真相是一行都没查
   * 🔴 与 {@link getWorkbench} 分开是为了**调用频率**：黄条每打开一次报告就读一次，
   *    让它去调工作台的话，每次刷新都要取回 48 行明细连同每一行的 {@code hit_detail}
   *    （一段任意 JSON），而它要显示的只是「3 条 BLOCK 未清零」这一个整数
   */
  getLatestReview: (reportId: number): Promise<QlzgReviewVO | null> =>
    request.get({ url: '/qlzg/review/run/latest', params: { reportId } }),

  /**
   * 一份报告的复核工作台（整屏一次取全）← {@code QlzgReviewRunController#getWorkbench}
   *
   * 🔴 **只要登录**，理由与 {@link getLatestReview} 同一条
   * 🔴 只有这一个端点会补齐昵称（明细的豁免人 + 最新一次与历次的触发人），
   *    一次 {@code getUserMap} 补完三处
   */
  getWorkbench: (reportId: number): Promise<QlzgReviewWorkbenchVO> =>
    request.get({ url: '/qlzg/review/run/workbench', params: { reportId } }),

  /**
   * 豁免一条 BLOCK，让它不再拦**这一份**报告的定稿 ← {@code QlzgReviewRunController#waiveBlock}
   *
   * 🔴 只有**命中**且 **BLOCK 级**且**尚未豁免**的行能豁免，三种情况各有自己的报错：
   *    {@code REVIEW_RUN_NOT_HIT} / {@code REVIEW_RUN_WAIVE_NOT_BLOCK} /
   *    {@code REVIEW_RUN_ALREADY_WAIVED}。未命中的行在工作台上是一条绿勾，
   *    它上面**没有**豁免按钮；WARN / INFO 本来就不拦定稿，
   *    给它们写一个 {@code waived = 1} 等于在档案里记一件没发生的事
   * 🔴 权限点 {@code qlzg:review:waive}
   * 🔴 **豁免之后要再定稿一次才生效**：本端点只改明细行，不动报告状态，
   *    也不改 {@code qlzg_review.passed}（那是上一次运行的历史事实）。
   *    成功提示里要把这句话说出来，否则用户会以为点完就过了，
   *    然后在下一次定稿失败时认为是系统坏了
   */
  waiveBlock: (data: QlzgReviewRunWaiveVO): Promise<boolean> =>
    request.put({ url: '/qlzg/review/run/waive', data }),

  /**
   * 撤销一次豁免，把那条 BLOCK 重新计回闸 C ← {@code QlzgReviewRunController#revokeWaiver}
   *
   * 🔴 撤销**保留** {@code waivedBy} 与 {@code waiveReason}，只把 {@code waived} 置回 0：
   *    清空那两列等于销毁一段留痕，而撤销豁免恰恰是最该留下痕迹的动作之一。
   *    所以撤销之后界面上那一行**仍然显示**「曾被谁以什么理由豁免过」，
   *    那是如实的，不是残留
   * 🔴 报告已 FINALIZED 时**照样允许**撤销，且不改报告状态：那一版已经交出去了，
   *    撤销不会把它收回来。出路是 reopenForRevision → 改 → 重新定稿，
   *    而重新定稿会重跑一次闸 C、此时那条 BLOCK 已经重新计入。
   *    确认弹层要把这条出路写出来
   * 🔴 本端点**不做**承办评估师那道校验：撤销是把闸收紧，
   *    与「放行自己做的东西」是相反方向的动作，拦它只会挡住一次合法的自我纠正
   * 🔴 两个人同时点撤销的话，一个成功、一个收到 {@code REVIEW_RUN_NOT_WAIVED}。
   *    这不是 bug，不要在前端重试 —— 重试只会把「另一个人已经撤销了」翻译成一次成功
   */
  revokeWaiver: (runId: number): Promise<boolean> =>
    request.put({ url: '/qlzg/review/run/revoke-waiver', params: { runId } })
}
