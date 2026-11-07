import request from '@/config/axios'

/**
 * 机构级复核配置 ← 后端 {@code QlzgOrgReviewConfigRespVO}
 *
 * <h3>🔴 {@code configured = false} 时 {@code reviewMode} **不是**空，是平台默认值 ADVISORY</h3>
 * 两者的档案含义不同：前者说明「这个机构从来没做过这个决定」，
 * 后者说明「这个机构决定过、决定的是提示档」。
 * 配置页上要把这两件事分开说 —— 只渲染 {@code reviewMode} 的话，
 * 一个从没配过内控的机构看起来与一个主动选了 ADVISORY 的机构一模一样，
 * 而监管问的恰恰是「你们做过这个决定吗」。
 *
 * <h3>🔴 {@code draftReportCount} 与 {@code reviewMode} 必须来自**同一次**请求</h3>
 * 弹层那句「仅对之后新建的报告生效，已在编制的 N 份报告不受影响」（§11.9.2.6 第 7 条）里的 N
 * 要实时查。后端刻意把两件事放进一个端点：拆成两个请求的话 N 与当前档位来自两个时刻，
 * 中间插进一次建报告，用户看到的就是「档位说 ADVISORY、N 说 3」而清单里只有 2 份 ——
 * 两处对不上时用户会认为界面在胡说，而这句话是弹层里唯一能让人停下来想一想的东西。
 *
 * <h3>🔴 {@code noticeText} **逐字渲染**，不得改写、不得用 v-html</h3>
 * 它来自后端 {@code QlzgReviewNoticeText#STATUTORY_ACK_TEXT} 那一个常量，
 * 而同一份文本会被逐字快照进 {@code qlzg_review_waiver.ack_text} —— 一份要保存 30 年的档案。
 * 测试 #34④ 断言「落库内容与当时界面文案逐字相等」，
 * 前端改一个字就等于让那条断言在真机上不成立。
 * 渲染用 {@code white-space: pre-wrap} 的纯文本，理由与「不得 v-html」是同一件事的两面：
 * 这段文案是**我方**定义的，但它的呈现方式一旦被前端接管，
 * 「他当时看到的到底是什么」就再也没有唯一答案了。
 */
export interface QlzgOrgReviewConfigVO {
  /** false = 本机构从来没配过；此时 {@link reviewMode} 仍是平台默认值 */
  configured: boolean
  reviewMode: string
  /** 平台默认档位，用于在界面上说清「不配就是这个」 */
  platformDefault?: string | null
  /** LocalDateTime ⇒ epoch 毫秒 */
  statutoryLockNoticeAt?: Date | null
  /** 本机构是否涉及法定评估业务（决定红色警示区可不可见） */
  statutory?: boolean
  noticeText?: string | null
  /** 已在编制、不受本次变更影响的报告份数 */
  draftReportCount?: number
  updatedBy?: number | null
  /** 查不到用户时为 null，**不会**退回工号字符串 */
  updatedByNickname?: string | null
}

/**
 * 变更机构级复核档位 ← 后端 {@code QlzgReviewModeSaveReqVO}
 *
 * <h3>🔴 本 VO **没有** {@code ackText}，也不会有</h3>
 * 「他勾了没有」是一个事实，「他看到的文字是什么」由我方定义。
 * 收上来的话，任何调用方都能塞一段「本平台对此不承担任何责任」进去，
 * 而 {@code ack_text} 那一行是我方在质询现场唯一能念出来的东西。
 * 客户端只提交 {@link statutoryAcknowledged} 这个**布尔**。
 *
 * <h3>🔴 {@code reason} 少于 10 字会留下一行 {@code rejected = 1} 的拒绝留痕</h3>
 * 后端刻意**只**加 {@code @NotBlank} 与 {@code @Size(max = 500)}，没有 {@code @Size(min = 10)}：
 * Bean Validation 在进 Controller 之前就把请求打回去，那次**尝试**一个字都不会留下，
 * 而「有人在赶稿时想关掉复核」这条记录，比一次成功的降级更值得看见。
 * 所以前端那道 ≥10 字的校验是**体验**（让人在点提交之前就知道），
 * 不是**替代** —— 绕过它照样能打出请求，照样会被记下。
 * 别为了「省一次往返」把上限 500 也交给前端判完就算了。
 *
 * <h3>🔴 机构级**不接受** {@code INHERIT}</h3>
 * 机构级的 {@code review_mode} 是 {@code NOT NULL DEFAULT 'ADVISORY'}，它没有「上一级」可继承。
 * 传它的后果与传任何一个错字相同：{@code QlzgReviewModeEnum#of} 按「配置坏了」回落 **ENFORCE**，
 * 于是档位被改成最严的一档、留痕如实记下 {@code to_mode = 'ENFORCE'}，
 * 而配置页一读回来就能看出这不是用户想要的那个动作。
 * 这是**要**的失败方式：它响亮、且落在严的一侧。
 * 所以机构级弹层的下拉里**只有三档**，没有「继承」这一项。
 */
export interface QlzgReviewModeSaveVO {
  reviewMode: string
  reason: string
  statutoryAcknowledged: boolean
}

/** 变更项目级复核档位 ← 后端 {@code QlzgProjectReviewModeSaveReqVO} */
export interface QlzgProjectReviewModeSaveVO extends QlzgReviewModeSaveVO {
  projectId: number
}

/**
 * 变更报告级复核档位 ← 后端 {@code QlzgReportReviewModeSaveReqVO}
 *
 * 🔴 三级里唯一会重算 {@code review_mode_effective} 的一级（改的就是这一份报告自己），
 *    也是唯一有「只有 DRAFT 能改」这道限制的一级（{@code REVIEW_MODE_REPORT_NOT_DRAFT}）：
 *    已定稿的报告连着纸质件、{@code qlzg_review.gate_c_mode} 与那一版快照，
 *    放开改会让三处对不上且没有一处报错。
 * 🔴 承办评估师本人不得变更（{@code REVIEW_MODE_CHANGE_BY_APPRAISER}）：
 *    自己关自己那份 = 自己给自己签发。这道校验权限点拦不住，
 *    因为一个人可以同时是技术负责人与承办评估师。
 */
export interface QlzgReportReviewModeSaveVO extends QlzgReviewModeSaveVO {
  reportId: number
}

/**
 * 一行档位变更留痕 ← 后端 {@code QlzgReviewWaiverRespVO}
 *
 * <h3>🔴 {@code rejected = true} 的行**照样下发**，前端也**照样显示**</h3>
 * {@code /waiver/org-list} 刻意不过滤它们。一行被程序性拒绝的尝试
 * （理由短于 10 字、法定业务没勾告知）记录的正是「有人在赶稿时想关掉复核」，
 * 而历史列表是它唯一会被看见的地方。
 * 界面上要把它与成功的变更区分开（一行红的、写明「已被程序性拒绝，未生效」），
 * 但**不要**把它折叠进「更多」里 —— 折叠掉等于回到过滤掉。
 *
 * <h3>🔴 {@code fromMode} / {@code toMode} 下发的是**列里的原串**</h3>
 * 后端刻意不过 {@code QlzgReviewModeEnum#of}：那一支对认不出的取值回落 ENFORCE，
 * 于是「这一行被写坏了」在界面上会显示成「本机构改成了最严的一档」—— 一个档案页上的假事实。
 * 所以这两个字段可能是**任何**字符串（包括 {@code INHERIT}？不会 ——
 * 留痕行记的是解析后的档位，见 {@link QlzgReviewModeSaveVO}）。
 * 前端认不出的取值要**原样显示**，不要翻成「未知」：
 * 这一屏正是发现「这行留痕被写坏了」的唯一场合。
 *
 * <h3>🔴 {@code ackText} 是**当时那一刻**的告知文案，不是今天这份</h3>
 * 它与 {@code GET /config/notice} 返回的文本可能不同（常量改过就会不同），
 * 而两者都对。展示留痕时读 {@code ackText}，别去拿今天的文案顶上去 ——
 * 「他当时看到的是什么」这个问题只有这一列能回答。
 */
export interface QlzgReviewWaiverVO {
  id: number
  waiveScope: string
  /** 后端算好的中文作用域；认不出的取值时下发**原串**，不是回落值 */
  waiveScopeName?: string | null
  scopeRefId?: number | null
  reportId?: number | null
  projectId?: number | null
  fromMode?: string | null
  toMode?: string | null
  reason?: string | null
  waivedBy?: number | null
  /** 查不到用户时为 null，**不会**退回工号字符串 */
  waivedByNickname?: string | null
  waivedByRole?: string | null
  statutoryAcknowledged?: boolean
  ackText?: string | null
  /** true = 这次尝试被程序性拒绝、**未生效**，但留痕照样写下来了 */
  rejected?: boolean
  /** LocalDateTime ⇒ epoch 毫秒 */
  effectiveFrom?: Date | null
  effectiveTo?: Date | null
  revokedBy?: number | null
  revokedByNickname?: string | null
  revokedAt?: Date | null
  createTime?: Date
}

/**
 * 一整条档位变更链，**分三段** ← 后端 {@code QlzgReviewWaiverChainRespVO}
 *
 * 🔴 三段**分开展示**，前端不要合并成一个时间线：
 *    {@code create_time} 的精度是秒，而「撤销旧的 + 插入恢复行」两步落在同一秒内，
 *    合并排序会偶尔把机构级那行排到项目级之后，
 *    读者无从判断那是排序错了还是真有人反着改过。
 * 🔴 {@code hasAny = false} 时那个「查看变更记录」链接本身就**不该出现** ——
 *    点进去是三个空面板，而旁边的灰条写着「本机构已关闭机器复核」，
 *    两处对不上的表现是用户以为界面在胡说。
 */
export interface QlzgReviewWaiverChainVO {
  hasAny: boolean
  reportLevel: QlzgReviewWaiverVO[]
  projectLevel: QlzgReviewWaiverVO[]
  orgLevel: QlzgReviewWaiverVO[]
}

export const QlzgReviewConfigApi = {
  /**
   * 机构级配置（配置页 + 变更弹层一次读完）← {@code QlzgReviewConfigController#getOrgConfig}
   *
   * 🔴 权限点 {@code qlzg:review:config}。这一个端点同时供两处使用，理由写在
   *    {@link QlzgOrgReviewConfigVO} 的 {@code draftReportCount} 那一段
   */
  getOrgConfig: (): Promise<QlzgOrgReviewConfigVO> =>
    request.get({ url: '/qlzg/review/config/org' }),

  /**
   * 变更机构级档位 ← {@code QlzgReviewConfigController#changeOrgMode}
   *
   * 🔴 返回的是**新写进去的那一行留痕的 id**，不是配置本身 ——
   *    要刷新界面就再调一次 {@link getOrgConfig}（那个数与档位必须同刻，见上）
   * 🔴 只对**之后新建**的报告生效，已在编制的报告档位是冻结的。
   *    弹层必须把这件事说出来，否则用户会以为「关掉就能让我手上这份过」
   */
  changeOrgMode: (data: QlzgReviewModeSaveVO): Promise<number> =>
    request.put({ url: '/qlzg/review/config/org', data }),

  /**
   * 法定评估告知文案（弹层里逐字渲染）← {@code QlzgReviewConfigController#getNoticeText}
   *
   * 🔴 **只要登录**，没有 {@code @PreAuthorize}：项目级 / 报告级那两个弹层也要用，
   *    而它们的读者不一定持有 {@code qlzg:review:config}。
   *    给这个端点挂权限点的后果是「弹层里那段告知文案空白」，
   *    而空白会被当成「这台机构不涉及法定评估」——一个静默的责任转移
   * 🔴 与 {@link getOrgConfig} 里的 {@code noticeText} 是同一个常量，
   *    单独开一个端点是不让那两个弹层为了拿一段文案去读整个机构配置
   */
  getNoticeText: (): Promise<string> => request.get({ url: '/qlzg/review/config/notice' }),

  /**
   * 本机构的档位变更历史 ← {@code QlzgReviewConfigController#getOrgWaiverList}
   *
   * 🔴 含 {@code rejected = 1} 的行（**不过滤**），理由见 {@link QlzgReviewWaiverVO}
   * 🔴 本端点**不接受** {@code tenantId} 入参，{@code scope_ref_id} 由服务端从租户上下文取：
   *    接受了就等于允许 {@code ?tenantId=0} 读别家机构「张三决定关闭复核」那一行
   */
  getOrgWaiverList: (): Promise<QlzgReviewWaiverVO[]> =>
    request.get({ url: '/qlzg/review/config/waiver/org-list' }),

  /**
   * 变更项目级档位 ← {@code QlzgReviewConfigController#changeProjectMode}
   *
   * 🔴 {@code reviewMode} 传 {@code INHERIT} = 清空本级配置、回到继承机构级。
   *    那**不是**无事发生：机构是 OFF、本项目原来钉着 ENFORCE 的话，
   *    清空之后本项目就跟着变成 OFF，是一次实际的控制放松，所以同样要留痕。
   *    前端要把这一项写成「跟随机构配置」，不要写成「清除」——
   *    「清除」听起来像撤销，而它实际是**放松**
   * 🔴 只影响之后新建的报告，本项目已在编制的报告不受影响
   */
  changeProjectMode: (data: QlzgProjectReviewModeSaveVO): Promise<number> =>
    request.put({ url: '/qlzg/review/config/project', data }),

  /**
   * 变更报告级档位 ← {@code QlzgReviewConfigController#changeReportMode}
   *
   * 🔴 只有 DRAFT 能改，界面上对已定稿的报告要**不给入口**（不是给了再报错）：
   *    一次必然被拒的提交除了让人以为「功能坏了」以外没有任何产出
   * 🔴 留痕记的是**解析后的生效档位**的前后值：「项目已经是 OFF、再把本报告钉成 OFF」
   *    会被判 {@code REVIEW_MODE_UNCHANGED}。而「钉住以求免疫于将来的项目级恢复」这个意图
   *    不需要表达 —— 项目级变更本来就不追溯已存在的报告
   */
  changeReportMode: (data: QlzgReportReviewModeSaveVO): Promise<number> =>
    request.put({ url: '/qlzg/review/config/report', data }),

  /**
   * 一份报告 / 一个项目的整条档位变更链 ← {@code QlzgReviewConfigController#getWaiverChain}
   *
   * 🔴 **只要登录**，没有 {@code @PreAuthorize}：它供 OFF 档报告页那条常驻灰条上的
   *    「查看变更记录」用（§11.9.2.6 第 4 条），而看报告的人不一定能改配置。
   *    挂上权限点的表现是「灰条在、链接点了 403」——
   *    一条写着「本机构已关闭机器复核」的灰条，配一个打不开的举证入口，
   *    比没有那条灰条更坏
   * 🔴 两个入参都可为空：项目页只传 {@code projectId}，机构页两个都不传（只回 ORG 段）
   */
  getWaiverChain: (params: {
    reportId?: number
    projectId?: number
  }): Promise<QlzgReviewWaiverChainVO> =>
    request.get({ url: '/qlzg/review/config/waiver/chain', params })
}
