import request from '@/config/axios'
import { exportExcelWithMeta } from '@/utils/exportExcel'

/**
 * 评估项目（I1）
 *
 * 与后端 {@code QlzgProjectController / QlzgProjectSaveReqVO / QlzgProjectRespVO} 一一对应。
 *
 * 🔴 **项目编号与状态都不接受前端写入**：
 *    `projectNo` 由服务端发号器生成（`PJ202610300001` 这种，机构内唯一、立项后不可改），
 *    `status` 由服务端状态机推进（收到第一份资料时 INIT → MATERIAL，见 QlzgMaterialServiceImpl）。
 *    写表单里不要放这两个字段，也**不要**做「改状态」的下拉 —— 后端没有那个接口，
 *    而「状态能随手改」本身就是要防的事：状态是闸口（G-01…G-08）的输入。
 *
 * 🔴 三个布尔（`isStatutory` / `isSecuritiesBusiness` / `isStateOwned`）后端都是 `@NotNull`，
 *    理由是「必须显式声明，不能留空」。所以表单上它们**不能有初值为 undefined 的时刻** ——
 *    用 el-radio-group 给「是/否」两个选项，不要用 el-switch（switch 的 undefined 与 false
 *    在界面上看不出区别，而这两个在后端是「没声明」与「声明了不是」的区别）。
 *
 * 🔴 作废（void）是**独立接口**且 `voidReason` 必填非空白。它是终态、不可逆，
 *    重复作废也抛错。界面上要与「删除」明确分开：删除只允许删空壳
 *    （有标的/资料时抛 PROJECT_NOT_EMPTY_FOR_DELETE），**建议引导用户改用作废**。
 */

/** 承办评估专业人员 —— 🔴 有序，顺序即报告署名顺序 */
export interface QlzgAppraiser {
  userId: number
  /**
   * 用户昵称
   *
   * 🔴 用户被删或当前用户无权看见时为 **null**，此时应显示「已离岗（2048）」这类占位，
   *    **不要跳过这一项** —— 占位不跳过，署名顺序才不会因为一个人离职就整体前移。
   */
  nickname?: string | null
}

/** 评估项目（读形态） */
export interface QlzgProjectVO {
  id: number
  /** 🔴 服务端发号，机构内唯一，立项后不可改 */
  projectNo: string
  projectName: string
  clientId: number
  /** 委托方名称，服务端解析好了，前端不用再查一次 */
  clientName?: string
  categoryCode: string
  /** 品类名称，服务端解析 */
  categoryName?: string
  /** 评估目的（字典项，如 MORTGAGE）。🔴 不是自由文本：国资 12 号令第 6 条的经济行为会触发闸口 G-05…G-08 */
  purpose?: string
  /** 价值类型（如 MARKET_VALUE，→ R24） */
  valueType?: string
  /** 🔴 评估基准日，必填（后端在 Service 里用 PROJECT_BASE_DATE_REQUIRED 把着） */
  baseDate?: string
  /** 报告日（→ R30） */
  reportDate?: string
  /** 🔴 是否法定评估 → G-02 签字资质、档案年限 15/30 */
  isStatutory?: boolean
  /** 🔴 是否证券业务 → 闸 G-01 */
  isSecuritiesBusiness?: boolean
  /** 🔴 是否涉国资 → 闸 G-05…G-08 */
  isStateOwned?: boolean
  /** 委托合同文件编号（弱引用 infra_file.id，文件删了也保留原值） */
  contractFileId?: number
  feeAmount?: number
  ownerDeptId?: number
  ownerUserId?: number
  /** 项目负责人姓名，服务端解析 */
  ownerUserName?: string
  /** 🔴 承办评估专业人员 ID 列表，**顺序即报告署名顺序**（后端是 List 不是 Set） */
  appraiserUserIds?: number[]
  /** 🔴 有序，与 appraiserUserIds 对位 */
  appraiserUsers?: QlzgAppraiser[]
  /** 项目状态，见 QlzgProjectStatusEnum */
  status: string
  /**
   * 状态中文描述，由后端枚举给出
   *
   * 🔴 **前端不要再为状态建一份字典/映射**：那份映射会与枚举分叉，
   *    表现是「列表里显示『资料收集』、点进去显示『MATERIAL』」。列表展示直接用这个字段。
   *    （筛选下拉仍需要本地选项，见 views/qlzg/constants.ts）
   */
  statusDescription?: string
  /** 🔴 程序是否受限（〔2018〕35 号第七条）；true 时 procedureLimitReason 必填 */
  procedureLimited?: boolean
  /** 受限情况、处理方式及对结论的影响 —— 🔴 三段都要写，→ R26 强制披露 */
  procedureLimitReason?: string
  /**
   * 🔴 项目级复核档位（如 ENFORCE），空 = 继承机构级配置
   *
   * <h3>🔴 只读：改它的唯一入口是 {@code PUT /qlzg/review/config/project}</h3>
   * 后端 {@code QlzgProjectSaveReqVO} **刻意不含**这一列（与 {@code projectNo} / {@code status} /
   * 作废三列同一条纪律），所以立项表单与编辑表单都提交不上去。
   * 那一列的唯一合法写入者 {@code QlzgReviewModeService#changeProjectMode} 在同一个事务里
   * 撤销旧留痕、写一行新留痕（含 ≥10 字的理由与法定评估告知勾选）、最后才 CAS 改列。
   *
   * <p>⚠️ 绕过它的后果不是「档案里少一行」，而是一条没有出口的巷子：项目被钉成 OFF 之后，
   *    其下每一份报告在**创建那一刻**就把 {@code reviewModeEffective} 冻结成 OFF，
   *    定稿时抛 {@code REVIEW_OFF_UNTRACED}（「无法回答谁在什么时候决定不跑」）——
   *    报错指着报告，出路却在项目上，而那份授权压根不存在、补不回来。
   *    由后端 {@code QlzgReviewModeWritePathGuardTest} 钉住，别把这一列加回 Save VO
   */
  reviewMode?: string
  /** 作废理由，仅 status=VOIDED 时非空 */
  voidReason?: string
  voidedAt?: Date
  voidedBy?: number
  voidedByName?: string
  /**
   * 机构自定义扩展字段的值（I29），键 = {@code qlzg_field_def.field_key}
   *
   * 🔴 **按「有没有字段定义」裁，不按 scene 裁**：后端 {@code QlzgExtFieldSupport} 装配 RespVO 时
   *    留下本机构启用中 + 停用的字段，剔掉别的机构的与 {@code ext_json} 里的孤儿键。
   *    ⚠️ 所以「出现位置 = 详情」的字段**也在这里**（详情页要显示它），
   *    而录入表单那一侧是按 scene 过滤的 —— 两边的键集合刻意不同，
   *    差集由后端 {@code carryOverReadOnly} 在写回时补齐，见 {@link QlzgProjectSaveVO.ext}。
   *
   * 🔴 「一个值都没存过」读出来是 **{@code {}}，不是 {@code null}**（那一列在库里是 SQL NULL，
   *    解析成空 Map）。所以 {@code data.ext ?? null} 这种写法拿到的是 {@code {}}，
   *    别把它当成「后端说不修改」。
   */
  ext?: Record<string, any> | null
  createTime?: Date
}

export interface QlzgProjectPageReqVO extends PageParam {
  /** 项目编号，模糊匹配 */
  projectNo?: string
  /** 项目名称，模糊匹配 */
  projectName?: string
  clientId?: number
  categoryCode?: string
  status?: string
  purpose?: string
  valueType?: string
  isStatutory?: boolean
  ownerUserId?: number
  ownerDeptId?: number
  /** 评估基准日区间，后端按 yyyy-MM-dd 解析 */
  baseDate?: string[]
  createTime?: string[]
}

/**
 * 评估项目（写形态，create + update 共用）
 *
 * ⚠️ 刻意**没有** `projectNo` / `status` / `voidReason` / `voidedAt` / `voidedBy` ——
 *    前两个是服务端主权字段，后三个只能走 `/void`。
 *
 * 🔴 同样刻意**没有** `reviewMode`，而这一条的理由与上面五个不同、也更硬：
 *    它不是「服务端算得出来」，而是「改它必须留下一行 {@code qlzg_review_waiver}」。
 *    后端 `QlzgReviewModeService#changeProjectMode` 在同一个事务里撤销旧留痕、
 *    写新留痕（含 ≥10 字的理由与法定评估告知勾选）、最后才 CAS 改列；
 *    走本 VO 的话 `BeanUtils.toBean` 会把这一列直接抄进 DO ——
 *    不留痕、不要理由、不勾告知，连带绕过「承办评估师本人不得变更自己那份」。
 *    改档位一律走 `QlzgReviewConfigApi.changeProjectMode`（入口在项目台账那一行的「复核档位」）。
 *    ⚠️ 这一列在 I1 时确实在本 VO 里（当时注明「只存不用」），
 *    I5 让它生效之后才变成绕过闸的写路径 —— 别按「以前一直有」把它加回来。
 */
export interface QlzgProjectSaveVO {
  /** 编号，修改时必填 */
  id?: number
  projectName: string
  clientId?: number
  categoryCode: string
  purpose?: string
  valueType?: string
  /** yyyy-MM-dd */
  baseDate?: string
  /** yyyy-MM-dd */
  reportDate?: string
  isStatutory?: boolean
  isSecuritiesBusiness?: boolean
  isStateOwned?: boolean
  /**
   * 是否已阅读并确认「本部署未安装机器复核模块，承接法定评估业务」的告知（D17 ⑦）
   *
   * 🔴 **只在退化形态下有意义**：部署没有装配 `review` 模块（{@code REPORT_ONLY} / {@code REPORT_SIGN}）
   *    且本次把项目声明成法定评估业务时，它必须为 `true`，否则后端抛
   *    {@code REVIEW_WAIVER_ACK_REQUIRED}。标准形态下后端**直接忽略**这一列 ——
   *    那时法定项目的告知发生在「改复核档位」那一刻（{@code QlzgReviewConfigApi.changeProjectMode}），
   *    立项这一步再要一次勾选，用户会在两份长得几乎一样的告知之间连点两次「我确认」，
   *    而**一个被训练成条件反射的勾选框等于没有勾选框**。
   *
   * 🔴 **要不要送 `true` 由后端说，不由前端推**：先 {@link QlzgProjectApi.getStatutoryNotice}，
   *    `required === true` 才渲染警示区与勾选框。让前端按形态自己判的话判据就有两份，
   *    而分叉的表现是静默的（前端不弹、用户没勾、提交上来被拦下）。
   *
   * ⚠️ **告知文案本身不在这里传**：`ack_text` 由后端从 {@code QlzgReviewNoticeText} 取逐字快照，
   *    本 VO 里**没有** `ackText` 这个字段，别加 —— 接受前端回传文案就等于让
   *    「落库内容与当时界面文案逐字相等」这条断言（测试 #34④）失去可验证性。
   */
  statutoryAcknowledged?: boolean
  contractFileId?: number
  feeAmount?: number
  /** 归属部门，留空后端取当前用户部门 */
  ownerDeptId?: number
  /** 项目负责人，留空后端取当前用户 */
  ownerUserId?: number
  /** 🔴 顺序即署名顺序；后端要求**去重后 ≥ 2 人**，否则抛 PROJECT_APPRAISER_TOO_FEW */
  appraiserUserIds?: number[]
  procedureLimited?: boolean
  procedureLimitReason?: string
  /**
   * 机构自定义扩展字段的值（I29）
   *
   * 🔴 三态，判据是**键在不在 JSON 里**，与身份证号那套约定同一条纪律：
   *    不传键 / {@code null} = **不修改**（Service 层一句 {@code if (reqVO.getExt() != null)} 把着，
   *    MyBatis-Plus 的 NOT_NULL 策略随即跳过这一列）、非空对象 = **整列覆盖**。
   *    所以「删掉一个扩展字段的值」是靠 {@code compactExt} 把空值键摘掉、
   *    再把剩下的整包发上去实现的 —— ⚠️ 不要指望发 {@code {fieldKey: null}} 能删掉某一项，
   *    那会被后端按值校验拦下（{@code EXT_FIELD_VALUE_INVALID}）。
   *
   * 🔴 但「整列覆盖」**不等于**「没发过去的键一律被删」。后端
   *    {@code QlzgExtFieldValidator#carryOverReadOnly} 会从库里现值补回三类键：
   *    ① 停用的字段；② {@code scene} 不覆盖 FORM 的字段（录入表单渲染不出它，
   *    payload 结构上不可能带它）；③ 没有字段定义的孤儿键。
   *    这三类前端**刻意不带**（{@code loadExtModel} 按 scene 过滤）：
   *    后端是唯一能看见库里现值的一方，前端手里只有 {@code /get} 那一刻的快照。
   *
   * ⚠️ 与 {@code QlzgMaterialApi.updateExt} **相反**：那个端点的 {@code null} / {@code {}} 是「清空」。
   *    两处语义不同是后端既成事实，别在这里「统一」它们。
   */
  ext?: Record<string, any> | null
}

/** 作废项目 */
export interface QlzgProjectVoidVO {
  id: number
  /** 🔴 必填非空白，后端 @NotBlank */
  voidReason: string
}

/**
 * 「声明为法定评估业务需不需要先勾选告知」← 后端 {@code QlzgStatutoryNoticeRespVO}
 * （{@code GET /qlzg/project/statutory-notice}）
 *
 * <h3>🔴 为什么这是一个端点，而不是前端按 {@code GET /qlzg/module/current} 的形态自己判</h3>
 * 让前端判的话判据就有两份：后端一份（{@code QlzgProjectServiceImpl#degradedStatutoryAckNeeded}，
 * 问的是 {@code QlzgReviewModeResolver} 这个 Bean 在不在）、前端一份（{@code if (form === 'REPORT_ONLY')}）。
 * 两份会漂开，而漂开的表现是**静默**的 —— 前端不弹、用户没勾、提交上来被后端拦下，
 * 用户看到一个「我什么都没做却报错」的表单。更要紧的是前端那份判据写的是**形态名**，
 * 而形态名不是判据：判据是「这个部署有没有装配机器复核模块」，
 * 客户完全可以要一个预设之外的组合（§2.6.1：形态不是枚举，是模块集合）。
 */
export interface QlzgStatutoryNoticeVO {
  /**
   * 🔴 是不是必须先勾选告知。**false 时前端【不该】渲染警示区与勾选框**，
   *    而且此时 {@link noticeText} 恒为 null（后端刻意只在 required 时发文案：
   *    不 required 却发一段下去，前端多渲染一块没人要看的红框，
   *    用户会学会「这块东西可以无视」—— 那正是它真需要被看的时候的预演）
   */
  required: boolean
  /**
   * 告知文案原文。
   *
   * 🔴 **逐字渲染**（按 {@code white-space: pre-wrap} 显示，换行是文案的一部分），
   *    不得改写、不得翻译、不得加自己的话，也**不用 v-html**：
   *    这段文本会被后端从同一个常量（{@code QlzgReviewNoticeText.DEGRADED_STATUTORY_ACK_TEXT}）
   *    快照进 {@code qlzg_review_waiver.ack_text}，而测试 #32② 的断言是
   *    「落库内容与当时界面文案逐字相等」—— 这个断言只有在文案只有一个来源时才可验证。
   *    前端改一个字就等于让它在真机上不成立，而这件事没有任何一处会报错
   */
  noticeText?: string | null
}

export const QlzgProjectApi = {
  /** 项目分页 */
  getProjectPage: (params: QlzgProjectPageReqVO): Promise<PageResult<QlzgProjectVO[]>> =>
    request.get({ url: '/qlzg/project/page', params }),

  /** 项目详情 */
  getProject: (id: number): Promise<QlzgProjectVO> =>
    request.get({ url: '/qlzg/project/get', params: { id } }),

  /**
   * 「声明为法定评估业务」的告知（D17 ⑦）
   *
   * 🔴 权限点是**三个已有的**（{@code qlzg:project:create} / {@code :update} / {@code :query}），
   *    后端刻意**没有**新造 {@code qlzg:project:notice}：一个新权限串没有对应的按钮菜单时，
   *    {@code PermissionScanRunner} 只建出一条 {@code menu_id = NULL} 的承载行，
   *    而 {@code GrantDecisionService} 一句 {@code if (r.getMenuId() == null) continue;}
   *    会把它挡在导航集合外 —— 表现是**所有非超管静默拿不到告知文案**，全程 200 无异常。
   *
   * @param projectId 留空表示新建；非空表示编辑。
   *                  ⚠️ 编辑一个**已经**声明为法定的项目时返回 {@code required = false}：
   *                  知情确认在 {@code is_statutory} 从 0 变成 1 的那一刻已经写过了，
   *                  此后每改一次委托方就要再勾一次，只会把勾选框训练成条件反射。
   *                  所以前端的可见性判据必须是 {@code required && formData.isStatutory === true}
   */
  getStatutoryNotice: (projectId?: number): Promise<QlzgStatutoryNoticeVO> =>
    request.get({ url: '/qlzg/project/statutory-notice', params: { projectId } }),

  /** 立项：项目编号由服务端发号，初始状态恒为 INIT */
  createProject: (data: QlzgProjectSaveVO): Promise<number> =>
    request.post({ url: '/qlzg/project/create', data }),

  /**
   * 更新项目
   *
   * ⚠️ 不写项目编号与状态；项目已作废时抛 PROJECT_VOIDED；
   *    **已有标的或资料时不允许改品类** —— 品类决定了标的类型与资料清单，
   *    改了会让已收进来的资料对不上新清单，而那不会报错。
   */
  updateProject: (data: QlzgProjectSaveVO): Promise<boolean> =>
    request.put({ url: '/qlzg/project/update', data }),

  /** 🔴 作废：终态且不可逆，重复作废也抛错 */
  voidProject: (data: QlzgProjectVoidVO): Promise<boolean> =>
    request.put({ url: '/qlzg/project/void', data }),

  /**
   * 删除项目
   *
   * ⚠️ 只允许删**空壳**（没有标的也没有资料），否则抛 PROJECT_NOT_EMPTY_FOR_DELETE。
   *    确认框里要说清这一点并建议改用作废 —— 用户想「删掉这个做废了的单子」时，
   *    他要的其实是作废，而删除会让他以为档案也一起没了。
   */
  deleteProject: (id: number): Promise<boolean> =>
    request.delete({ url: '/qlzg/project/delete', params: { id } }),

  /**
   * 导出项目台账
   *
   * 🔴 **不走 `request.download`**：那个封装最终只把 Blob 交出来、响应头拿不到，
   *    而「这次有没有被上限截断」正是走 `X-Export-Truncated` 传的。理由全文在
   *    `@/utils/exportExcel` 的 `exportExcelWithMeta` 上，那里是全仓唯一一份。
   *
   * @param currentPage true-只导当前页 / false-按当前条件导全部（受上限约束）
   */
  exportExcel: (params: any, currentPage: boolean) =>
    exportExcelWithMeta('/qlzg/project/export-excel', { ...params, currentPage })
}
