import type { QlzgReviewRunVO, QlzgReviewVO, QlzgReviewWorkbenchVO } from '@/api/qlzg/reviewRun'
import type { QlzgReviewWaiverChainVO, QlzgReviewWaiverVO } from '@/api/qlzg/reviewConfig'
import type { QlzgReviewRuleVO } from '@/api/qlzg/reviewRule'
import {
  REVIEW_INHERIT,
  REVIEW_REASON_MAX_LENGTH,
  REVIEW_REASON_MIN_LENGTH,
  RULE_SEVERITY_ORDER
} from '@/views/qlzg/constants'

/**
 * 复核域（I5）的**全部界面判定**（纯模块，被 `reviewFlow.spec.ts` 钉住）
 *
 * <h3>🔴 为什么这些判定要收进一个纯模块，而不是写在 .vue 里</h3>
 * 它们每一条都是「界面显示哪一种状态」的**分岔点**，而分岔错了不报错：
 * 报告页那条常驻黄条与灰条互斥、还允许「两条都不显示」，
 * 判据写歪的表现是「一份从来没被复核过的报告上挂着一条『0 条问题』的黄条」——
 * 用户读成「查过了，没问题」，而真相是一行都没查（§11.9.2.6 第 3 条要防的正是这件事）。
 * 这类判定在 .vue 里是没法测的（要挂载组件、要 mock axios），
 * 而它们又恰好是本迭代里**唯一**一批「错了也全程 200」的逻辑。
 *
 * <h3>⚠️ 这里**刻意抄了**两个数，与 `resultFlow.ts` 那条纪律不冲突</h3>
 * {@code REVIEW_REASON_MIN_LENGTH} / {@code MAX_LENGTH}（10 / 500）是抄的。
 * `resultFlow` 拒绝抄任何一个规则参数，理由是「I5 接通 {@code p.*} 之后那些数会变成机构可调」——
 * 而这两个数**不是**规则参数：10 是 §11.9.2.7 第 5 条写死的规格，500 是
 * {@code qlzg_review_waiver.reason} 的**列宽**。两者都不随机构变，
 * 且超上限的后果是 MySQL {@code Data too long}（用户看到「系统异常」），
 * 前端不拦就等于把一个 SQL 报错交给评估师读。
 * 后端那一道照样在，前端这一道只是让人在点提交之前就知道。
 *
 * <h3>🔴 除了这两个数，本模块**不预校验**任何实体规则</h3>
 * 尤其是 {@code expr} 能不能编译、事实名存不存在、{@code ruleCode} 撞不撞码 ——
 * 那三件都要读库才知道，前端猜的结果是「界面上说没问题、保存时被拒」，
 * 而后端的报错文案（{@code REVIEW_RULE_EXPR_INVALID} 会带上 aviator 那句原文）
 * 比前端能拼出来的任何提示都完整。本页的做法是：**不预校验，把后端那句原文显示出来**。
 */

// ==================== 报告页那条常驻横条 ====================

/**
 * 报告页顶部横条的四种形态
 *
 * 🔴 `NONE` **不是**「出错了」，是「这份报告从来没被复核过」——
 *    一份刚建出来还没点过定稿的 DRAFT 就是这样。此时既不显示黄条也不显示灰条
 * 🔴 `INCOMPLETE` 是第四种，2026-11-03 补的：上一次运行 `FAILED`
 *    （有规则求值失败，那几条既不算通过也不算命中）。
 *    在补它之前这种运行落到 `NONE`，于是「复核没跑完」与「复核跑完且清零」
 *    在报告页上**长得一模一样**，见 {@link reportReviewBannerOf}
 */
export type ReportReviewBanner = 'NONE' | 'YELLOW' | 'GREY' | 'INCOMPLETE'

/**
 * 报告页显示哪一种横条
 *
 * <h3>🔴 四条判据的**顺序**是有理由的，不要调换</h3>
 * ① `latest` 为 null ⇒ `NONE`。后端刻意返回 **null**（不是空对象、也不是 0 条）
 *    表示「这份报告从来没被复核过」。
 * ② `runStatus === 'SKIPPED'` ⇒ `GREY`。OFF 档下闸 C **照样**落一行运行头，
 *    所以灰条的判据是运行状态，**不是** `latest == null`。
 *    此时 `totalRules = 0`、`blockCountUnwaived = 0`，
 *    若把 ② 排在 ③ 之后也不会错——但把它排在前面才说得清「一行都没跑」这个更强的事实。
 * ③ `runStatus !== 'OK'` ⇒ `INCOMPLETE`（`SKIPPED` 已在 ② 分走），
 *    **排在 ④ 之前**，与后端闸 C 同序：
 *    {@code QlzgReviewGateServiceImpl} 先抛 {@code REVIEW_RUN_FAILED}、
 *    后抛 {@code GATE_C_BLOCKED}，所以用户在定稿那一刻收到的也是「没跑完」那句。
 *    横条若反过来先报 BLOCK 条数，报出来的是**按跑成的那几条数出来的**一个偏小的数 ——
 *    而它旁边没有任何一个字说「这个数不完整」。
 *    🔴 判据写成「不是 OK」而不是「等于 FAILED」，于是**认不出的码也算没跑完**，
 *    与 {@code constants.ts#reviewRunStatusTagType} 对坏值给黄同一个口径：
 *    一个坏值既不是「查完了」也不是「按配置没跑」，此时唯一诚实的说法是「结论未知」。
 *    反过来的写法（只认 FAILED）会让一个坏码落到 `NONE` ——
 *    又一次把「不知道」显示成「没问题」
 * ④ `blockCountUnwaived > 0` ⇒ `YELLOW`（§11.9.2.6 第 3 条）。
 *    🔴 这一条**不看档位**：ADVISORY 下它是「签字人将对此承担责任」，
 *    ENFORCE 下它是「清零之前定不了稿」。同一句话在两个档位下都成立，
 *    差别由旁边的档位标去说，不由横条去说。
 *
 * <h3>🔴 ③ 这一条是**补出来的**，而它此前的缺席是一个静默的谎</h3>
 * `constants.ts` 里 {@code REVIEW_RUN_STATUS_OPTIONS} 的注释早就写了
 * 「界面上要说清『这一次没查完』，不要显示成『查完了，有 N 条问题』」，
 * 而报告页此前只认 SKIPPED：一次 FAILED 的运行 {@code blockCountUnwaived} 是 0
 * （求值失败的行不是 BLOCK 命中），于是横条落到 `NONE`、定稿弹层那一格写着「0 条」。
 * 表现是「一份从来没被复核过的报告上挂着一条『0 条问题』的黄条」的**镜像**：
 * 一次没跑完的复核显示成一次干净的复核。而它会真实发生 ——
 * 2026-11-03 那次全系统定不了稿（装载器少供 2 个事实）就是 48 条规则全部求值失败，
 * 报告页上一条横条都没有。
 *
 * <h3>🔴 不要读 {@code passed}，也不要读 {@code blockCount}</h3>
 * {@code passed} 在 ADVISORY 档下为 0 是**常态**（机器不拦了，人必须拦），
 * 拿它当判据会让每一份 ADVISORY 报告都挂着黄条；
 * {@code blockCount} 是**历史事实**（那一次运行命中了几条 BLOCK），
 * 豁免只改明细行、不改运行头，于是它永远不减 ——
 * 技术负责人豁免完 12 条、黄条上仍写着 12。
 * 要的是 {@code blockCountUnwaived}，那个数是后端**现算**的。
 */
export const reportReviewBannerOf = (latest?: QlzgReviewVO | null): ReportReviewBanner => {
  if (latest == null) return 'NONE'
  if (latest.runStatus === 'SKIPPED') return 'GREY'
  if (latest.runStatus !== 'OK') return 'INCOMPLETE'
  if ((latest.blockCountUnwaived ?? 0) > 0) return 'YELLOW'
  return 'NONE'
}

/**
 * 黄条上那个整数
 *
 * 🔴 与 {@link reportReviewBannerOf} 用**同一列**，于是「黄条说 3 条」与
 *    工作台清单里 {@code blocksFinalizeNow = true} 的行数必然相等（后端保证）。
 *    前端**不要**自己数一遍 {@code runs}：一行 BLOCK 是坏的
 *    （{@code waived = 1} 而 {@code waiveReason} 为空 ⇒ {@code waivedProperly = false}）时，
 *    数出来的会与后端那个整数差 1，而两处都不报错
 */
export const unwaivedBlockCountOf = (latest?: QlzgReviewVO | null): number =>
  latest?.blockCountUnwaived ?? 0

/**
 * 「未清零 BLOCK」那一格写什么 —— 定稿弹层与报告作业台**共用**这一句
 *
 * <h3>🔴 四态，而**只有中间两态不写数字**</h3>
 * 运行状态不是 OK 时那个整数是按跑成的那几条数出来的，可能少算；
 * `SKIPPED` 时压根一行都没跑。两种都写「0 条」的话，
 * 用户读到的是「查过了，没问题」，而真相分别是「查了一半」与「一行没查」——
 * 与 {@link reportReviewBannerOf} 要防的是同一件事（§11.9.2.6 第 3 条）
 *
 * <h3>🔴 收进本模块而不是写在 .vue 里的三元表达式里</h3>
 * 它有**两个**调用点（作业台顶部那一格、定稿弹层那一格），
 * 两处各写一遍的结果是同一件事在两个地方说不同的话 ——
 * 而这一整段的注释正是「哪一态不许显示成数字」，它只该有一份
 */
export const unwaivedBlockTextOf = (latest?: QlzgReviewVO | null): string => {
  if (latest == null) return '还没被复核过'
  if (latest.runStatus === 'SKIPPED') return '未运行 —— 这一份的档位是关闭的'
  if (latest.runStatus !== 'OK') return '上一次没跑完，结论未知'
  return `${unwaivedBlockCountOf(latest)} 条`
}

/**
 * 报告页**实际**显示哪一种横条 —— {@link reportReviewBannerOf} 之上再叠一层档位判据
 *
 * <h3>🔴 为什么不能只用 {@link reportReviewBannerOf}</h3>
 * §11.9.2.6 第 4 条要求 OFF 档的灰条**常驻**，而那份报告在第一次点定稿之前
 * 压根没有 {@code qlzg_review} 行 —— {@code /latest} 返回 null ⇒ `NONE` ⇒ 什么都不显示。
 * 于是「三个月后没人记得这台机构关过什么」这句话，恰好在最该被拦住的那一刻成立：
 * 一份 OFF 档的 DRAFT 正在被写，而报告页上一个字都没提复核被关掉了。
 * 所以灰条的判据里必须有**档位**这一项，运行状态只是它的佐证。
 *
 * <h3>🔴 OFF 时灰条**压过**黄条与红条，三者不可能同时成立</h3>
 * OFF 档写的是**零行明细**（{@code QlzgReviewGateServiceImpl#persistSkipped}），
 * 于是 {@code blockCountUnwaived} 必然是 0、{@code runStatus} 必然是 SKIPPED。
 * 真读到「OFF 且有未清零 BLOCK」或「OFF 且 FAILED」的话，
 * 那是库里被绕过 Service 写坏了 —— 此时显示灰条是保守的那一侧：
 * 黄条与红条都会把人引向一个 OFF 档下**入口已隐藏**的工作台（第 8 条），点进去是 404
 */
export const reportReviewBarOf = (
  reviewModeEffective?: string | null,
  latest?: QlzgReviewVO | null
): ReportReviewBanner => {
  if (reviewModeEffective === 'OFF') return 'GREY'
  return reportReviewBannerOf(latest)
}

// ==================== 复核工作台的入口 ====================

/**
 * 复核工作台的入口**该不该出现**
 *
 * <h3>🔴 false 时是**隐藏**，不是置灰（§11.9.2.6 第 8 条）</h3>
 * OFF 档的语义是「这个功能不在」。一个点进去永远空白的页面比没有入口更贵 ——
 * 那是 §11.9.2.0 理由① 说的那种持续成本（用户每次都要去试一下、每次都失败一次）。
 * 置灰则会被理解成「功能坏了」，与法定评估项目那条（§11.9.2.6 第 6 条）
 * 是同一条 UI 纪律的两个方向：**要人做决定的地方不置灰，功能真的不在的地方不留残影**。
 *
 * <h3>🔴 工作台数据**还没回来**时也算 false，不是 true</h3>
 * 判据是严格等于 {@code true}。反过来写（`!== false`）的表现是：
 * 打开报告页 → 入口先出现 → 请求回来 → 入口消失。
 * 而一个「出现过又消失」的按钮是会被点到的，点到的那一次落到一个空白页
 */
export const reviewEntryVisible = (workbench?: QlzgReviewWorkbenchVO | null): boolean =>
  workbench?.workbenchVisible === true

/**
 * 同上，但判据换成报告上那一列 {@code review_mode_effective} —— 给**报告页**用
 *
 * <h3>🔴 为什么报告页不读 {@code workbenchVisible}</h3>
 * 那一列只在 {@code /workbench} 上，而 {@code QlzgReviewRunApi.getLatestReview} 的注释
 * 点名了分开两个端点的理由是**调用频率**：黄条每打开一次报告就读一次，
 * 让它去调工作台的话每次刷新都要取回全部明细行连同每一行的 {@code hit_detail}
 * （一段任意 JSON），而它要显示的只是一个整数。
 * 为了决定一个按钮出不出现而付这个代价，正是那条注释要避免的事。
 *
 * <h3>🔴 与后端**逐字等价**，不是近似</h3>
 * {@code QlzgReviewQueryServiceImpl#fillReportContext} 写的是
 * {@code QlzgReviewModeEnum.of(mode).runsRules()}，而 {@code of()} 对认不出的取值
 * 回落 ENFORCE、{@code runsRules()} 就是「不是 OFF」。
 * 于是那个布尔为真 ⟺ {@code review_mode_effective} 这一列的字面值不等于 {@code 'OFF'} ——
 * 含 null / 空串 / 一个坏码三种情况，全都算「入口在」。
 * 🔴 所以这里**刻意不做**「认不出就当 OFF 藏起来」那种保守处理：
 * 藏错方向的代价是一个功能对所有人消失，而后端在同样这一列上选的是严的一侧回落
 * （ENFORCE），两边必须同向，否则界面上「入口不在」而闸 C 照样拦，用户找不到出路
 *
 * <h3>🔴 第二个入参：本部署**装没装** review 模块（§2.6.3）</h3>
 * {@code REPORT_ONLY} / {@code REPORT_SIGN} 形态下 REVIEW 整个模块不装配，
 * 报告的 {@code reviewModeEffective} 那一列是 null —— 按上面那条「null 算入口在」，
 * 按钮照常出现，点进去是 {@code /qlzg-review/workbench}：那一页的每一个接口都归
 * {@code @QlzgModuleGate(REVIEW)}，全部回 code=404「请求地址不存在」，
 * 而本仓 404 的 HTTP 状态码是 200 —— 用户看到一个空白页，后端日志一行都没有。
 * 这正是本节开头那条「一个点进去永远空白的页面比没有入口更贵」骂的现场，
 * 只是成因从「档位是 OFF」换成了「模块没装」。
 *
 * <p>⚠️ 默认值 {@code true} 与 {@code moduleForm#isInstalled} 取不到形态时答 true 同向：
 * 少给一个入参（漏改的调用点、形态请求失败）的产出是「退化部署下多一个 404 的入口」，
 * 而不是「标准部署下这个功能对所有人消失」。后者严重得多
 *
 * <p>🔴 **不能**改用 {@code v-hasPermi} 来隐藏它：库里没有 {@code qlzg:review:query}
 * 这个权限串（只有 {@code config} 与 {@code waive}），而 {@code /latest} 与 {@code /workbench}
 * 两个读端点是刻意不加 {@code @PreAuthorize} 的 —— 加了会让所有非超管静默失去读接口
 * （承载行的 {@code menu_id} 是 NULL 而 {@code default_effect = DENY}）。
 * 为隐藏一个按钮去造一个权限点，代价是授权树上多出一个谁也不知道是什么的勾
 */
export const reviewEntryVisibleByMode = (
  reviewModeEffective?: string | null,
  reviewInstalled = true
): boolean => reviewInstalled && reviewModeEffective !== 'OFF'

// ==================== 变更理由 ====================

/**
 * 变更理由（{@code reason} / {@code waiveReason}）够不够格提交；够格返回 `null`
 *
 * <h3>🔴 下限数**去空白后**的字数，上限数**原始**字数 —— 这个不对称是照抄后端的</h3>
 * 后端 {@code QlzgReviewWaiverRecord#proceduralViolation} 与
 * {@code QlzgReviewRunServiceImpl#validateReason} 都是先 {@code trim()} 再比
 * {@code REASON_MIN_LENGTH}；而 500 那一道是 VO 上的 {@code @Size(max = 500)}，
 * Bean Validation **不 trim**，量的是原串。
 * 于是「499 个字 + 一个尾随空格」这一份：下限过（499 ≥ 10）、上限也过（{@code @Size} 量到 500）。
 * 若把两道都改成量 trim 后的字数，501 个字符里带一个空格的输入会被前端放行、
 * 被 {@code @Size} 拒掉 —— 而 {@code @Size} 那句「不能超过 500 个字符」
 * 与用户眼前的字数对不上，他会认为界面在胡说。
 * 别把这个不对称「修」成对称的。
 *
 * <h3>🔴 空理由那句话刻意提到「口头 / 线下审批」</h3>
 * §11.9.2.7 第 5 条明确不接受它代替 {@code reason}。
 * 只写「请填写理由」的话，赶稿的人会认为「我已经口头请示过技术负责人了」就算填了 ——
 * 而这件事必须被写下来，因为它是 30 年后唯一能回答「谁决定的」的东西
 */
export const reviewReasonProblem = (reason?: string | null): string | null => {
  const raw = reason ?? ''
  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    return '请填写理由——口头或线下审批不能代替它，这一行是要保存 30 年的'
  }
  if (trimmed.length < REVIEW_REASON_MIN_LENGTH) {
    return (
      `理由至少 ${REVIEW_REASON_MIN_LENGTH} 个字，现在 ${trimmed.length} 个。` +
      '照样提交会被拒绝，并留下一行「已被程序性拒绝」的记录'
    )
  }
  if (raw.length > REVIEW_REASON_MAX_LENGTH) {
    return `理由不能超过 ${REVIEW_REASON_MAX_LENGTH} 个字符，现在 ${raw.length} 个`
  }
  return null
}

/**
 * 理由这一格**该不该禁用提交按钮**
 *
 * <h3>🔴🔴 判据只有一条：后端会不会为这次尝试写一行 {@code rejected = 1} 的留痕</h3>
 * 会 ⇒ 前端**不许**拦；不会 ⇒ 前端拦下只是省一次往返，不丢任何档案。
 * 于是两类被拦、一类被放行：
 * <ul>
 * <li><b>拦</b>：空白理由（{@code @NotBlank}）与超 500 字符（{@code @Size(max = 500)}）。
 *     这两道是 Bean Validation，在进 Controller **之前**就把请求打回去 ——
 *     那次尝试一个字都留不下来，前端替它拦掉不损失任何记录；
 *     而超上限那一道若放过去，撞的是 MySQL {@code Data too long}，
 *     用户读到的是「系统异常」。</li>
 * <li><b>放行</b>：1–9 个字。后端 {@code QlzgReviewModeSaveReqVO} 刻意
 *     **只**加 {@code @NotBlank}、不加 {@code @Size(min = 10)}，就是为了让这一类
 *     走到 Service、写一行 {@code rejected = 1}、再抛 {@code REVIEW_WAIVER_REASON_REQUIRED}。
 *     「有人在赶稿时想关掉复核」这条记录比一次成功的降级更值得看见 ——
 *     前端在这里禁用按钮，等于把这条记录从档案里**抹掉**，
 *     而抹掉之后没有任何一处会报错（后端那道校验永远轮不到，测试也照样绿）。</li>
 * </ul>
 *
 * <h3>⚠️ 所以「至少 10 个字」这句话在界面上是**橙色的提示**，不是红色的错误</h3>
 * 它说的是一件将要发生的事，不是一件已经不合格的事。
 * 把它做成红色 + 禁用按钮的话，本函数与 {@link reviewReasonProblem} 会看起来重复 ——
 * 而两者的差别正是这一整段注释
 *
 * <h3>🔴 同一条判据也管着法定告知那个勾选框</h3>
 * 「法定评估业务 + 目标不是 ENFORCE + 没勾」在后端同样走 {@code traceRejection}，
 * 所以那个勾选框**也不禁用提交**：不勾就提交会被拒并留痕，
 * 而那一行记的正是「有人想在没读告知的情况下关掉法定项目的机器复核」。
 * 见 {@link statutoryAckRequired}
 */
export const reviewReasonBlocksSubmit = (reason?: string | null): boolean => {
  const raw = reason ?? ''
  return raw.trim().length === 0 || raw.length > REVIEW_REASON_MAX_LENGTH
}

// ==================== 三级档位变更弹层 ====================

/**
 * 变更档位的作用域级别
 *
 * 🔴 三级**共用一个弹层**（{@code ReviewModeChangeDialog.vue}），
 *    而三级的差别只有两处：机构级没有「跟随上级」这一项、
 *    项目级 / 报告级要各自带上 {@code projectId} / {@code reportId}。
 *    写成三个弹层的话，§11.9.2.6 第 2 条那三句后果文案就会有三份拷贝，
 *    而它是「用户在选的那一刻看到的文字，才是唯一有效的告知」——
 *    三份拷贝里改掉一份，两个入口就开始对同一件事说不同的话
 */
export type ReviewModeLevel = 'ORG' | 'PROJECT' | 'REPORT'

/**
 * 这一级的下拉里**有没有**「跟随上级配置」这一项
 *
 * <h3>🔴 机构级没有，因为机构级没有上一级</h3>
 * {@code qlzg_org_review_config.review_mode} 是 {@code NOT NULL DEFAULT 'ADVISORY'}。
 * 在机构级传 {@code INHERIT} 的后果与传任何一个错字相同：
 * {@code QlzgReviewModeEnum#of} 按「配置坏了」回落 **ENFORCE**，
 * 于是档位被改成最严的一档、留痕如实记下 {@code to_mode = 'ENFORCE'} ——
 * 那是**要**的失败方式（响亮、且落在严的一侧），但没必要让用户去踩它
 *
 * <h3>🔴 那一项的文案是「跟随机构配置」，**不是**「清除」</h3>
 * 「清除」听起来像撤销，而它实际是一次**控制放松**：
 * 机构是 OFF、本项目原来钉着 ENFORCE 的话，清空之后本项目就跟着变成 OFF。
 * 所以它同样要留痕，也要在选中时把「跟随之后会变成哪一档」写出来
 */
export const reviewInheritAvailable = (level?: ReviewModeLevel | null): boolean =>
  level === 'PROJECT' || level === 'REPORT'

/**
 * 下拉里选中的那个值**解析成**哪一档
 *
 * <h3>🔴 选中「跟随上级」时返回的是**上一级说的那一档**，不是 {@code INHERIT}</h3>
 * 后端两件事都用解析后的值：{@code assertChanged} 比的是它（于是「已经是继承、
 * 又提交一次 INHERIT」不会被判成一次变更），留痕行的 {@code to_mode} 写的也是它
 * （档案里不该出现一个谁也解释不了的第四种取值）。
 * 前端要预判这两件事，就必须先做同一次解析
 *
 * <h3>⚠️ {@code inheritResolvesTo} 缺值时返回 null，**不**回落到某一档</h3>
 * 调用方没把上一级的档位查回来（项目级弹层可以读 {@code /config/org}，
 * 它本来就要求 {@code qlzg:review:config}，不多要一次权限）。
 * 返回 null 的下游后果全是**保守**的那一侧：
 * {@link reviewModeUnchanged} 判不出「没变」⇒ 提交按钮可用 ⇒ 由后端决定；
 * {@link statutoryAckRequired} 按「不知道 ⇒ 需要勾选」返回 true。
 * 回落到 ENFORCE 的话，一个「跟随机构配置」的选择会在界面上显示成
 * 「你正在把本项目改成最严的一档」—— 而机构可能恰恰是 OFF
 */
export const resolvedTargetModeOf = (
  selected?: string | null,
  inheritResolvesTo?: string | null
): string | null => {
  if (selected == null || selected === '') return null
  return selected === REVIEW_INHERIT ? (inheritResolvesTo ?? null) : selected
}

/**
 * 目标档位与当前档位**是不是同一档**（后端会判 {@code REVIEW_MODE_UNCHANGED}）
 *
 * <h3>🔴 这一条**可以**在前端拦，与理由那一格相反</h3>
 * 后端 {@code assertChanged} 排在 {@code assertProcedurallyCompleteAndTrace} **之前**，
 * 所以「档位没变」这一次尝试**压根不留痕**。前端拦下它不丢任何档案，
 * 而放过它的产出是一次必然失败的往返 + 一句「功能坏了」的印象
 *
 * <h3>🔴 {@code currentEffectiveMode} 必须是**解析后**的当前档位</h3>
 * 机构级就是 {@code /config/org} 的 {@code reviewMode}（后端已经过了 {@code of()}）；
 * 项目级 / 报告级是 {@code review_mode_effective} 那一类**解析结果**，
 * 不是 {@code qlzg_project.review_mode} 那一列的字面值 ——
 * 那一列可空，空值的含义是「跟着机构走」，按字面值比会把
 * 「已经是继承、又提交一次 INHERIT」判成一次变更，正是后端注释里点名要避免的那件事
 *
 * <h3>⚠️ 任一侧为 null ⇒ false（不拦）</h3>
 * 「不知道当前是哪一档」与「知道、且相同」是两件事。
 * 前者放过去由后端判，后者才是这里要拦的
 */
export const reviewModeUnchanged = (
  currentEffectiveMode?: string | null,
  resolvedTargetMode?: string | null
): boolean =>
  currentEffectiveMode != null &&
  resolvedTargetMode != null &&
  currentEffectiveMode === resolvedTargetMode

// ==================== 法定评估的红色警示区 ====================

/**
 * 这一次变更**要不要**勾选法定评估告知（§11.9.2.6 第 6 条）
 *
 * <h3>🔴 与后端 {@code QlzgReviewWaiverRecord#requiresAck()} 逐字同判据</h3>
 * 「法定评估业务」**且**「变更后不再强制」两条同时成立。
 * 后半条不可省：{@code OFF → ENFORCE} 是一次**恢复**，它没有放弃任何控制，
 * 要求勾选一份写着「关闭机器复核不改变贵机构义务」的告知是一句自相矛盾的话 ——
 * 而用户会照着勾，于是档案里留下一行「他确认了关闭告知」的 {@code ack_text}，
 * 配的却是 {@code to_mode = 'ENFORCE'}。30 年后念这一行的人会读出相反的意思。
 *
 * <h3>🔴 {@code resolvedTargetMode} 必须是**解析后**的档位，不是下拉里那个原值</h3>
 * 选了「跟随机构配置」（{@code INHERIT}）时，后端解析的是**上一级说的那个档位**，
 * 而留痕行的 {@code to_mode} 记的也是它。所以调用方要么把解析结果传进来
 * （项目级弹层可以读 {@code /config/org} 拿到机构档位——它本来就要求
 * {@code qlzg:review:config}，不多要一次权限），要么传 {@code undefined}：
 * 此时本函数按「不知道 ⇒ 需要勾选」保守返回 true。
 *
 * <p>⚠️ 保守那一支是**可证明无害**的：后端只在 {@code requiresAck()} 为真时
 *    才把告知文案快照进 {@code ack_text}，所以多送一个 {@code statutoryAcknowledged = true}
 *    不会在档案里凭空多出一行「他确认了关闭告知」。
 *    而 {@code ack_text} 非空 ⟺ 这是一次**法定评估业务**的知情降级 —— 这个等价关系
 *    让 {@code ack_text} 本身成了可检索的判据，不能被一个多余的勾选破坏
 *
 * <h3>🔴 法定评估业务的入口**不置灰**，改成红色警示区 + 勾选</h3>
 * 置灰会被理解成「功能坏了」，勾选确认才是「你决定、你担责」。
 * 所以本函数返回 false 的含义是「这次不需要勾」，**不是**「这次不许改」——
 * V4 那个实体性拒绝（{@code REVIEW_MODE_LOCKED_STATUTORY}）在 V5 已整条撤回
 */
export const statutoryAckRequired = (
  statutory?: boolean | null,
  resolvedTargetMode?: string | null
): boolean => statutory === true && resolvedTargetMode !== 'ENFORCE'

// ==================== 变更留痕的三种行 ====================

/**
 * 一行留痕此刻的状态
 *
 * 🔴 `REJECTED` 与 `REVOKED` 都**照样显示**，不要过滤掉：
 *    前者记的是「有人在赶稿时想关掉复核」（{@code /waiver/org-list} 刻意不过滤），
 *    后者记的是「关掉过、后来改回来了」—— 而 {@code revokedBy} / {@code waiveReason}
 *    在撤销时**保留**，清空那两列等于销毁一段留痕
 */
export type WaiverRowState = 'REJECTED' | 'REVOKED' | 'EFFECTIVE'

/**
 * 一行留痕是「生效中」还是「已被改回」还是「压根没生效」
 *
 * 🔴 判据是 {@code effectiveTo} 有没有值，不是 {@code revokedAt}：
 *    两者由 {@code QlzgReviewWaiverMapper#revoke} 在同一条 UPDATE 里写、通常同值，
 *    但 {@code effectiveTo} 为 NULL 在 DDL 里的原话是**长期有效**
 *    （后端 {@code QlzgReviewWaiverDO#stillEffective} 因此写成
 *    {@code effectiveTo == null || !now.isAfter(effectiveTo)}）。
 *    前端自己按 {@code revokedAt} 判的话，两份判据会在「同值」这一点上恒等，
 *    于是看不出差别 —— 直到有一天 {@code revoke} 的调用方给了一个不同于 {@code now()} 的
 *    {@code effectiveTo}（那个参数本来就允许，注释写了「与恢复行的时间戳共用同一个值」）
 * 🔴 {@code REJECTED} 排在最前：一行被程序性拒绝的尝试**没有**生效过，
 *    也就谈不上被撤销，两件事不能同时成立
 */
export const waiverRowStateOf = (row?: QlzgReviewWaiverVO | null): WaiverRowState => {
  if (row == null) return 'REJECTED'
  if (row.rejected === true) return 'REJECTED'
  if (row.effectiveTo != null) return 'REVOKED'
  return 'EFFECTIVE'
}

/** {@link waiverRowStateOf} 的 tag 颜色：生效中红、已改回灰、被拒橙 */
export const waiverRowTagType = (state: WaiverRowState): 'danger' | 'info' | 'warning' => {
  if (state === 'EFFECTIVE') return 'danger' // 一次**正在生效**的控制放松，是这一列里最该跳出来的
  if (state === 'REVOKED') return 'info'
  return 'warning' // 被程序性拒绝：没生效，但「有人试过」这件事值得看见
}

/**
 * 历史列表里**正在生效**的那一行（即「当前档位是这么来的」）
 *
 * <h3>🔴 至多一行，所以这个 {@code find} 与列表顺序**无关**</h3>
 * 后端 {@code revokeInEffect} 在插新行**之前**会把本作用域下所有生效行
 * 回填 {@code effective_to}，于是一次成功变更之后恰好剩一行 {@code EFFECTIVE}。
 * 前端**不要**再排一次序（{@code /waiver/org-list} 已经是
 * {@code create_time DESC, id DESC}），也不要写成「取第一行」——
 * 第一行可能是一次 {@code rejected = 1} 的尝试，它从来没有生效过，
 * 而它的 {@code to_mode} 照样写着 OFF
 *
 * <h3>🔴 返回 null 的两种含义要分开说，见 {@link modeTraceStateOf}</h3>
 * 「本机构从来没配过」与「配了、但没有一条生效中的留痕」在档案上是两件相反的事：
 * 后者意味着有人绕过 Service 直接改了 {@code review_mode} 那一列
 */
export const currentEffectiveWaiverOf = (
  rows?: QlzgReviewWaiverVO[] | null
): QlzgReviewWaiverVO | null => {
  if (rows == null) return null
  return rows.find((row) => waiverRowStateOf(row) === 'EFFECTIVE') ?? null
}

/**
 * 灰条上那句「本机构已关闭机器复核（张三，2026-03-14，理由摘要）」里的**那个人**
 *
 * <h3>🔴 三段的优先级是报告 → 项目 → 机构，与后端 {@code requireTraced} 同序</h3>
 * {@code QlzgReviewWaiverService#requireTraced} 找的就是这三处：
 * ① 报告自己 {@code review_waiver_id} 指的那一行、② 项目级当前生效的 OFF 行、
 * ③ 机构级当前生效的 OFF 行。②③ 存在的理由是 OFF 可以从上级**继承**来，
 * 而灰条要回答的正是「这一份的 OFF 是谁授权的」——
 * 答成机构级那一位，而真相是本项目自己钉过一行，就是把责任落点挪到了另一个人身上。
 * 一行留痕上写着名字，而这个名字是要在质询现场被念出来的。
 *
 * <h3>⚠️ 返回 null 是**允许的**，此时灰条照显示、只是不写人名</h3>
 * 两种情况：一是链上一行都没有（{@code hasAny = false}，那个「查看变更记录」链接
 * 本身就不该出现），二是有人绕过 Service 直接改了配置列 ——
 * 后者在定稿那一刻会撞 {@code REVIEW_OFF_UNTRACED}。
 * 🔴 两种都**不要**退回去读配置行上的 {@code updatedByNickname}：
 * {@code QlzgOrgReviewConfigMapper#casReviewMode} 的注释原话是
 * 「本表只有一行、会被反复覆盖，而『谁在什么时候关的』这个问题的答案在留痕表里，
 * 不在这里 —— 所以别把这一列当成责任落点来读」。
 * 灰条上写不出人名时，如实写「查不到授权这一档的留痕」比写一个可能错的名字好
 */
export const effectiveOffWaiverOf = (
  chain?: QlzgReviewWaiverChainVO | null
): QlzgReviewWaiverVO | null => {
  if (chain == null) return null
  return (
    currentEffectiveWaiverOf(chain.reportLevel) ??
    currentEffectiveWaiverOf(chain.projectLevel) ??
    currentEffectiveWaiverOf(chain.orgLevel)
  )
}

/**
 * 理由的**摘要**（列表与横条上用，展开处逐字显示全文）
 *
 * <h3>🔴 截断之后必须让人看出「这不是全文」</h3>
 * 只截不加标记的话，一段 500 字的理由在列表里显示成前 40 个字，
 * 而它读起来是一句完整的话 —— 展开之后才发现后面还有 460 字，
 * 其中可能正是「但本项目例外」那半句。档案页上不允许有这种截断
 *
 * <h3>🔴 空理由要写成「这一行没有理由」，不是空串、也不是「—」</h3>
 * {@code reason} 在后端是 {@code @NotBlank}，正常路径下不可能为空 ——
 * 读到空说明这一行是绕过 Service 写进去的，而那正是档案页上最该被看见的一件事。
 * 一个破折号会被读成「这一格没有内容」，一句「这一行没有理由」才会被读成「这行不对劲」
 *
 * <h3>🔴 截断处的措辞**不许**承诺一个界面上没有的动作</h3>
 * 所以这里只写「共 N 字」，不写「展开看全文」——
 * 调用方可能是一行表格（有展开），也可能是一条横条（没有）。
 * 在一个没有展开控件的地方写「展开看全文」，用户会去找那个不存在的控件
 */
export const waiverReasonSummary = (reason?: string | null, limit = 40): string => {
  const text = reason ?? ''
  if (text.length === 0) return '（这一行没有理由）'
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}…（共 ${text.length} 字）`
}

/**
 * 配置行与留痕行**对不对得上**
 *
 * <h3>🔴 {@code NOT_CONFIGURED} 必须是独立的一档，不能并进 {@code NO_TRACE}</h3>
 * {@code configured = false} 时后端下发的 {@code reviewMode} 是**平台默认值** ADVISORY，
 * 而留痕表里一行都没有 —— 这是**正常**状态（这个机构从来没做过这个决定）。
 * 把它报成「没有留痕」等于在新机构的第一次访问上挂一条警告，
 * 而一条在健康页面上恒红的提示会被下一个人直接删掉，连同它守的那条规则一起
 *
 * <h3>🔴 {@code NO_TRACE} 与 {@code MISMATCH} 都是「有人绕过 Service 改了库」的证据</h3>
 * 写路径只有 {@code QlzgReviewModeService} 一个（{@code QlzgOrgReviewConfigMapper}
 * 刻意只有 {@code casReviewMode} 一个写方法，理由就是不给绕过留痕留口子）。
 * 所以配置行存在、却找不到一条生效中的留痕（或找到的那条 {@code to_mode}
 * 与配置行不同），只有两种可能：有人直接 {@code UPDATE} 了那一列，
 * 或者事务在两步之间被打断过。两种都要在页面上说出来 ——
 * 而 OFF 档下没有留痕的后果是实的：{@code requireTraced} 找不到授权行，
 * 这个机构的每一份 OFF 报告都定不了稿，报错说「没有留痕」，明明配置页写着 OFF
 *
 * <h3>⚠️ 比的是**原串**，两侧都不过 {@code of()}</h3>
 * {@code reviewMode} 后端已经过了 {@code of()}（认不出的取值回落 ENFORCE），
 * {@code toMode} 刻意**没**过（过了就会把「这一行被写坏了」显示成
 * 「本机构改成了最严的一档」）。所以一列坏数据在这里表现为 {@code MISMATCH} ——
 * 正是想要的结果
 */
export type ModeTraceState = 'NOT_CONFIGURED' | 'MATCH' | 'MISMATCH' | 'NO_TRACE'

export const modeTraceStateOf = (
  config?: { configured?: boolean | null; reviewMode?: string | null } | null,
  effectiveRow?: QlzgReviewWaiverVO | null
): ModeTraceState => {
  if (config == null || config.configured !== true) return 'NOT_CONFIGURED'
  if (effectiveRow == null) return 'NO_TRACE'
  return effectiveRow.toMode === config.reviewMode ? 'MATCH' : 'MISMATCH'
}

// ==================== 规则配置页 ====================

/**
 * 一条规则行是不是**整行只读**
 *
 * 🔴 平台预置行改不了也删不了（{@code REVIEW_RULE_PLATFORM_IMMUTABLE}），
 *    而页面要**先说出来**：不要等人填完一屏 expr 点了保存才收到那句报错 ——
 *    那一次的产出是「这个功能坏了」这个印象，而真相是「这一行本来就不给你改」
 * 🔴 只读由**写**端点拦，不由**读**端点拦：{@code /get} 照样返回平台行，
 *    因为配置页要能把它的 {@code expr} 原文展示出来给人参考
 *    （机构自建一条同口径的规则时，抄一遍比凭空写靠谱）
 * 🔴 {@code platform} 缺值时按**只读**处理：那是「不知道这行能不能改」，
 *    而猜错的方向里，「让一条平台行被改掉」远比「多灰一行」贵
 * 🔴 但 {@code rule} 本身为 null 时返回 **false**：那是**新建**表单，
 *    压根没有既存行需要保护。这一支若也按只读处理，新建规则表单会整屏灰掉 ——
 *    看起来像功能坏了，而 §11.9.2.6 第 6 条那条纪律说的正是这种误解
 */
export const ruleRowReadOnly = (rule?: QlzgReviewRuleVO | null): boolean =>
  rule != null && rule.platform !== false

/**
 * {@code ruleCode} 这一格能不能编辑 —— 即「这是新建表单还是修改表单」
 *
 * <h3>🔴 修改时**灰掉 + tooltip**，不是隐藏</h3>
 * {@code qlzg_review_run.rule_code} 是裸 varchar，改码会让已经落库的那一批命中明细
 * 指向一个不再存在的码，而档案里那一行从此无法归属
 * （{@code REVIEW_RULE_CODE_IMMUTABLE}，且这道判在内容校验**之前**）。
 * 隐藏会被理解成「这功能坏了」——与 §11.9.2.6 第 6 条、§11.20.5 的
 * {@code field_key} 同一条 UI 纪律：**不可改的东西要看得见它不可改**。
 *
 * <h3>🔴 它**只**回答「新建还是修改」，不回答「这行能不能改」</h3>
 * 后者是 {@link ruleRowReadOnly} 的事，两份判据刻意分开：
 * 平台行连表单都进不去，而一条自建行的修改表单是「能改，但码不能改」——
 * 把两件事合成一个函数的话，「灰掉码」与「整行只读」在界面上就成了同一种表现，
 * 而它们的出路完全不同（前者是「新建一条同码的」，后者是「抄它的 expr 去新建」）
 *
 * <h3>🔴 码在软删之后**仍然被占着**</h3>
 * 唯一索引不含 {@code deleted}，所以「删掉再建一条同码的」会报
 * {@code REVIEW_RULE_CODE_DUPLICATE}。这是刻意的：历史命中记录按裸码引用规则，
 * 编号可复用等于让档案里的 R08 在某一天开始指另一件事。
 * 新建表单上要把这句写出来，别等撞了再报错
 */
export const ruleCodeEditable = (existing?: QlzgReviewRuleVO | null): boolean =>
  existing == null || existing.id == null

/**
 * 这一档严重度在**这个天花板**之下合不合法
 *
 * <h3>🔴 它是给界面**灰掉非法档位**用的，不是保存后再报错用的</h3>
 * 「专家指引」的天花板是 WARN，因为建议性文件不能产生强制性拦截（优先级 5 永不升级），
 * 后端的码是 {@code REVIEW_RULE_SEVERITY_NOT_ALLOWED}。
 * 一个能选中、点了保存才被拒的下拉，产出的是「为什么选不了」这个疑问 ——
 * 灰掉并把天花板印在旁边，才是把答案放在决策点上（与 §11.9.2.6 第 2 条同一条纪律）。
 *
 * <h3>🔴 认不出的码一律 false，**不**回落到 true</h3>
 * {@link RULE_SEVERITY_ORDER} 里 {@code indexOf} 返回 −1，而 −1 比任何下标都小，
 * 于是「一个坏码 ≤ BLOCK」恒成立 —— 那就是「拨得动、存不下、也不报错」。
 * 所以这里先要求两个入参**都在**三档之内，任一不在就 false。
 * 后端 {@code QlzgRuleSeverityEnum#ofStrict} 对认不出的取值返回 null，
 * 本函数与它同向
 *
 * <h3>⚠️ 天花板缺值时按 BLOCK 处理</h3>
 * 机构自建规则的法域一律被强制成 {@code ORG_INTERNAL}，它的天花板就是 BLOCK，
 * 所以本模块的配置页上这一列恒为 BLOCK、三档都能选。
 * 缺值回落到 BLOCK 而不是回落到「什么都不许选」，是因为后者会把一个正常的新建表单
 * 变成三档全灰 —— 那看起来像功能坏了。
 * 🔴 「缺值」含 {@code null} / {@code undefined} / **空串**三种，
 * 与 {@code labelOf} 那句 {@code value == null || value === ''} 同一个口径：
 * 只写 {@code ?? 'BLOCK'} 的话，一个空串会落到 {@code indexOf('') = -1} 那一支，
 * 于是「后端把这一列发成了空串」与「后端发了一个坏码」得到同一个答案（三档全灰），
 * 而前者的正确回答是「按 BLOCK」
 */
export const severityWithinCeiling = (
  severity?: string | null,
  ceiling?: string | null
): boolean => {
  const severityIndex = RULE_SEVERITY_ORDER.indexOf(severity ?? '')
  if (severityIndex < 0) return false
  const effectiveCeiling = ceiling == null || ceiling === '' ? 'BLOCK' : ceiling
  const ceilingIndex = RULE_SEVERITY_ORDER.indexOf(effectiveCeiling)
  if (ceilingIndex < 0) return false
  return severityIndex <= ceilingIndex
}

/**
 * 规则集指纹**变没变**（红点的判据）
 *
 * <h3>🔴 任一侧为空 ⇒ false，不是 true</h3>
 * 「不知道」与「变了」是两件事。红点亮起来的含义是
 * 「这一份报告是按另一批规则判的」，而一份还没跑过复核的报告
 * （{@code ruleSetVersion} 为 null）没有这个含义 ——
 * 在每一份新报告上都亮一个红点，红点就在三天内失去全部意义，
 * 而那时真正变了的那一次也没人会看
 *
 * <h3>🔴 它只是**提示**，不是「不一样就拦住」的开关</h3>
 * 30 年后调档的人要能看出「这一份的口径与今天不同」，如此而已。
 * 也不要在页面上把两个指纹的原文并排印出来给人比对 ——
 * 32 位十六进制的差集肉眼读不出任何东西，要显示就显示「变了 / 没变」
 */
export const ruleSetVersionChanged = (
  runVersion?: string | null,
  currentVersion?: string | null
): boolean => {
  if (runVersion == null || runVersion === '') return false
  if (currentVersion == null || currentVersion === '') return false
  return runVersion !== currentVersion
}

// ==================== 工作台明细行 ====================

/**
 * 一条明细行**此刻是否还在拦定稿**
 *
 * 🔴 一律读后端算好的 {@code blocksFinalizeNow}，前端**不要**自己按
 *    {@code severity === 'BLOCK' && hit && !waived} 拼一个。
 *    拼出来的那一份在「一行 BLOCK 是坏的」（{@code waived = 1} 而
 *    {@code waiveReason} 为空 ⇒ {@code waivedProperly = false}，闸 C 不认这次豁免）时
 *    会与后端差 1，而两处都不报错 ——
 *    表现是「黄条说 3 条、清单里数出 2 条」，用户无从判断哪一边错了
 */
export const blocksFinalizeNow = (run?: { blocksFinalizeNow?: boolean | null } | null): boolean =>
  run?.blocksFinalizeNow === true

/**
 * 明细行那个图标记号显示成什么
 *
 * <h3>🔴 {@code errored = true} ⇒ `UNKNOWN`（灰色问号），不是绿勾也不是红叉</h3>
 * 那一条规则压根没求出结果，我们不知道它过没过。
 * 渲染成绿勾是「假装查过了」，渲染成红叉是「假装查出了问题」，
 * 两者都在一份要保存 30 年的档案上写了一句假话。
 * 灰色问号配上 {@code errorMsg} 展开，才是「这一条不知道」的如实表达
 *
 * <h3>🔴 这一列**不是** hit 的同义词</h3>
 * {@code runs} 是**每条规则一行**，不只是命中的那些 ——
 * 「48 条里有 45 条没命中」与「只查了 3 条」是两件不同的事，
 * 所以 `PASS`（绿勾）要如实显示，不要折叠掉
 */
export type RunRowMark = 'UNKNOWN' | 'HIT' | 'PASS'

export const runRowMarkOf = (
  run?: {
    errored?: boolean | null
    hit?: boolean | null
  } | null
): RunRowMark => {
  if (run == null) return 'UNKNOWN'
  if (run.errored === true) return 'UNKNOWN'
  return run.hit === true ? 'HIT' : 'PASS'
}

/**
 * 这一行**能不能**豁免
 *
 * <h3>🔴 三个条件缺一不可，而后端对三种不满足各有自己的报错</h3>
 * {@code REVIEW_RUN_NOT_HIT} / {@code REVIEW_RUN_WAIVE_NOT_BLOCK} /
 * {@code REVIEW_RUN_ALREADY_WAIVED}。未命中的行在工作台上是一条绿勾，
 * 它上面**没有**豁免按钮（不是置灰的按钮）；
 * WARN / INFO 本来就不拦定稿，给它们写一个 {@code waived = 1}
 * 等于在档案里记一件没发生的事
 *
 * <h3>🔴 这里**不判**「是不是承办评估师本人」</h3>
 * 那道校验（{@code REVIEW_RUN_WAIVE_BY_APPRAISER}，§11.9.1 纪律 4）
 * 权限点拦不住，因为一个人可以同时是技术负责人与承办评估师 ——
 * 而前端更拦不住，它不知道这份报告的承办人是谁。
 * 后端把它排在字数校验**之前**（授权在前、输入在后），
 * 于是按钮点得动、理由也写完了，才收到那句「你不能豁免自己那份」。
 * 这是**要**的顺序：反过来的话他要往返两次
 */
export const runRowWaivable = (
  run?: {
    hit?: boolean | null
    severity?: string | null
    waived?: boolean | null
  } | null
): boolean => run != null && run.hit === true && run.severity === 'BLOCK' && run.waived !== true

/**
 * 这一行**能不能**撤销豁免
 *
 * 🔴 判据是 {@code waived === true}，**不是** {@code waivedProperly}：
 *    一行 {@code waived = 1} 而理由是空的**坏行**按后者判「不算豁免」，
 *    于是它在界面上显示成已豁免、闸 C 却不认，
 *    而**撤销正是修好它的唯一手段**（后端的判据同样是 {@code waived = 1}）
 * 🔴 本端点**不做**承办评估师那道校验：撤销是把闸收紧，
 *    与「放行自己做的东西」是相反方向的动作，拦它只会挡住一次合法的自我纠正
 * 🔴 报告已 FINALIZED 时**照样**能撤销，且不改报告状态：那一版已经交出去了，
 *    撤销不会把它收回来。出路是 reopenForRevision → 改 → 重新定稿，
 *    而重新定稿会重跑一次闸 C、此时那条 BLOCK 已经重新计入。
 *    确认弹层要把这条出路写出来
 */
export const runRowRevocable = (run?: { waived?: boolean | null } | null): boolean =>
  run?.waived === true

/**
 * 这一行是不是一条**坏掉的豁免**（{@code waived = 1} 而三件套不全）
 *
 * <h3>🔴 它必须被显式提示出来，不能静默按已豁免显示</h3>
 * 后端要求 {@code waived} / {@code waivedBy} / {@code waiveReason} 三者同时非空
 * 才算 {@code waivedProperly}，而闸 C 认的是后者。于是这一行在界面上显示成已豁免、
 * 定稿时却照样被拦 —— 而用户看到的是「我明明豁免过了」。
 * 更要紧的是：**撤销豁免正是修好它的唯一手段**，而 {@link runRowRevocable} 的判据
 * 是 {@code waived = 1}（不是 {@code waivedProperly}），所以那个按钮此时**必然在**。
 * 把这一列的不一致藏起来，等于把唯一的出路也一起藏起来
 *
 * <h3>⚠️ {@code waived} 为假时一律 false</h3>
 * 「没豁免过」与「豁免得不合法」是两件事，前者不该带任何警告
 */
export const waiverBrokenOf = (
  run?: {
    waived?: boolean | null
    waivedProperly?: boolean | null
  } | null
): boolean => run?.waived === true && run.waivedProperly !== true

/** 工作台那一行汇总：{@code runs} 是**每条规则一行**，这四个数因此都要如实报 */
export interface RunRowSummary {
  /** 那一次运行判了几条规则。OFF 档下是 0（一行都没跑），不是「查过了没问题」 */
  total: number
  hit: number
  /** 没命中的条数。§「48 条里有 45 条没命中」这句话的右项就是它 */
  pass: number
  /** 求值失败的条数（灰色问号）。它与 pass 必须分开报，见 {@link runRowMarkOf} */
  errored: number
  /** 此刻还在拦定稿的条数，与黄条上那个整数同源（{@link blocksFinalizeNow}） */
  blocking: number
}

/**
 * 数一遍明细行，供工作台顶上那一行汇总用
 *
 * <h3>🔴 {@code errored} 必须从 {@code pass} 里分出来，不能并进去</h3>
 * {@link runRowMarkOf} 把求值失败判成 `UNKNOWN` 而不是 `PASS`，
 * 汇总若跟着并进去，那一行就会写成「45 条未命中、0 条不知道」——
 * 而真相是「这 3 条我们压根没求出结果」。
 * 一份要保存 30 年的档案上，「查过了没问题」与「没查出来」不能是同一个数
 *
 * <h3>🔴 {@code blocking} 用 {@link blocksFinalizeNow}，与黄条同源</h3>
 * 于是「黄条说 3 条」与这一行汇总里的 3 必然相等。
 * 反过来自己按 {@code severity === 'BLOCK' && hit && !waived} 拼一份的话，
 * 遇到一条坏豁免就会与后端差 1，而两处都不报错
 */
export const runRowSummaryOf = (runs?: QlzgReviewRunVO[] | null): RunRowSummary => {
  const summary: RunRowSummary = { total: 0, hit: 0, pass: 0, errored: 0, blocking: 0 }
  if (runs == null) return summary
  for (const run of runs) {
    summary.total++
    const mark = runRowMarkOf(run)
    if (mark === 'HIT') summary.hit++
    else if (mark === 'PASS') summary.pass++
    else summary.errored++
    if (blocksFinalizeNow(run)) summary.blocking++
  }
  return summary
}

/**
 * 「机器发现了、但这一档下不拦人」的 BLOCK 条数 —— ADVISORY 档专属的那一份清单
 *
 * <h3>🔴 这一份清单只在 ADVISORY 档下显示，而它**不是**多余的</h3>
 * §11.9.2.5 的原话：「ADVISORY 模式下，技术负责人看到的审核界面**反而要多一块东西**：
 * 一份『机器发现但已放行』的清单……机器不拦了，**人必须拦**。
 * 这是把责任从代码转移到签字人的唯一合法方式：责任转移必须伴随知情确认，否则就是甩锅。」
 * 于是 ADVISORY 档下工作台要比 ENFORCE 档**多**一个数，不是少一个。
 *
 * <h3>🔴 与 {@link runRowSummaryOf} 的 {@code blocking} 互斥，两者相加 = 命中的 BLOCK 总数</h3>
 * {@code blocking} 读的是后端算好的 {@code blocksFinalizeNow}（ADVISORY 档下恒为 false），
 * 本函数数的是同一批行里「是 BLOCK 且命中了、而此刻不拦」的那一部分。
 * 所以 ENFORCE 档下本函数**必然为 0**（拦着的那些走 blocking，
 * 已豁免的那些不拦但也不是「这一档放行的」—— 那是逐条豁免的产物，界面上另有其位）。
 * 于是它必须与档位一起判：脱离 ADVISORY 单独显示这个数，
 * 会把「技术负责人逐条豁免过」读成「机构把拦截关了」，而两者的责任人不是同一个人。
 *
 * <h3>⚠️ 逐条勾选确认（§11.9.2.5 的后半句）随 L2 一起归 I30，本迭代不做</h3>
 * 那半句要的是「勾选确认才能通过 L2」，而 L2 是三级审核的中间一级，
 * 整个三级审核在 §11.10 被移出 MVP。这里只做**看得见**这一半。
 */
export const advisoryReleasedCountOf = (runs?: QlzgReviewRunVO[] | null): number => {
  if (runs == null) return 0
  let count = 0
  for (const run of runs) {
    if (run.hit === true && run.severity === 'BLOCK' && !blocksFinalizeNow(run)) count++
  }
  return count
}

/**
 * 展开一行明细时，{@code hitDetail} 那段任意 JSON 显示成什么
 *
 * <h3>🔴 **展开时才 parse**，不在列表加载时批量 parse</h3>
 * {@code runs} 是每条规则一行（48 条起），而 {@code hit_detail} 是一段任意 JSON。
 * 加载时就全部 parse 一遍，代价花在 45 行根本不会被展开的数据上；
 * 更要紧的是 parse 失败的那一行**不该让整屏挂掉** —— 一次批量 parse 里的
 * 一个坏值会让整个工作台的 Promise 落到 catch，用户看到的是「复核功能坏了」，
 * 而真相是有一条明细的 JSON 写坏了
 *
 * <h3>🔴 parse 失败 ⇒ 原样显示那段字符串，**不**显示「解析失败」</h3>
 * 那一列的约定是「一段任意 JSON（字符串形态）」，而约定不是约束：
 * 引擎写进去的是它自己拼的串，将来某个规则写进一段非 JSON 的诊断文本是完全可能的。
 * 此时用户要的是**那段文本**，不是一句关于格式的元信息 ——
 * 显示「解析失败」等于把唯一有用的内容藏起来，只留下一个关于它的坏消息
 *
 * <h3>⚠️ 标量（{@code 123} / {@code "abc"} / {@code true}）也原样显示，不做美化</h3>
 * {@code JSON.stringify(123, null, 2)} 就是 {@code '123'}，缩进对标量没有意义；
 * 判据用「是不是对象或数组」，为的是不把 {@code null} 印成字符串 {@code 'null'}
 * 与「这一行没留下细节」混在一起
 */
export const hitDetailText = (detail?: string | null): string => {
  const raw = detail == null ? '' : String(detail).trim()
  if (raw.length === 0) return ''
  try {
    const parsed = JSON.parse(raw)
    if (parsed == null || typeof parsed !== 'object') return raw
    return JSON.stringify(parsed, null, 2)
  } catch {
    return raw
  }
}
