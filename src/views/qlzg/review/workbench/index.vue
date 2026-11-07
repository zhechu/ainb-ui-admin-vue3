<template>
  <!--
    🔴 `title` 这个 prop **必须给**：ContentWrap 的 `<template v-if="title" #header>`
       把整个头部（连同 #header 插槽）一起 gate 在 title 上。不给 title 的后果不是
       「少了个标题」，而是下面那排按钮从 DOM 里消失 —— 而这一页不在左侧导航里、
       只能从报告作业台进来，少了「回报告作业台」就是一条死路
       （I4-g 的测算 / 结果确定 / 案例召回三页同时栽过这件事）
  -->
  <ContentWrap title="复核工作台">
    <template #header>
      <div class="flex items-center justify-end w-full">
        <!--
          🔴 没装 review 模块时**不留**「重新读取」：它是一次注定 404 的请求，
             而一个按了只会弹报错的按钮比没有按钮更贵（§11.9.2.0 理由①：
             用户每次都要去试一下、每次都失败一次）。「回报告作业台」照留 —— 出路不能一起收走
        -->
        <el-button v-if="reportId && !notInstalled" :loading="loading" @click="load">
          <Icon icon="ep:refresh" class="mr-5px" /> 重新读取
        </el-button>
        <el-button v-if="reportId" @click="goReport">
          <Icon icon="ep:back" class="mr-5px" /> 回报告作业台
        </el-button>
      </div>
    </template>

    <!--
      🔴 没有 reportId 时**不渲染任何面板**，而是把「为什么什么都没有」说清楚。
         这一页不在导航里，直接敲 URL 一定会落到这一支；此时渲染一个空表格
         会让人以为「复核功能坏了」，而实际上只是缺一个入参
    -->
    <el-alert v-if="!reportId" type="warning" :closable="false" show-icon>
      <template #title>这一页要从报告作业台进来</template>
      <div class="alert-text">
        复核工作台的入参<b>只有一个报告编号</b>：它读的是那一份报告上冻结的档位与
        那一次运行的全部明细行，没有筛选框也不能换报告。请回到「报告台账」，
        在某一行的操作里点「作业台」，再从作业台顶部点「复核工作台」。
      </div>
    </el-alert>

    <!--
      🔴 数据**还没回来**时既不能说「档位是关闭的」也不能说「没被复核过」：
         wb 为 null 时 reviewEntryVisible 与 latest 两个判据同时为假，
         少了这一支的话，加载中的那一瞬会先闪一条灰条再变成正常内容 ——
         而一条闪过又消失的「本机构已关闭机器复核」是会被截图发出去的
    -->
    <el-skeleton v-else-if="!loaded" :loading="true" animated :rows="6" />

    <!--
      🔴 「本部署**没装** review 模块」是第四种处境，必须单独一支，且排在 loadFailed 之前
         （REPORT_ONLY / REPORT_SIGN 形态下 REVIEW 整个不装配，那两个端点的 Controller
         压根不在容器里，请求回来的是 code=404「请求地址不存在」——本仓 404 的 HTTP
         状态码是 200）。并进 loadFailed 的产出是一句谎话：写着「请点重新读取再试一次」，
         用户点一次弹一次 404，而那份档案永远不会出现。
         更要紧的是它掩盖了一件法律上有意义的事：这个部署没有机器复核。
         正常情况下没人会落到这一支（报告作业台的入口已经按同一个判据藏掉了），
         留着它是为了直接敲 URL 的人
    -->
    <el-alert v-else-if="notInstalled" type="info" :closable="false" show-icon>
      <template #title>本部署没有安装机器复核模块</template>
      <div class="alert-text">
        这一套系统按<b>部署形态</b>装配模块，本机启用的形态里<b>不含</b>机器复核 ——
        所以这里没有 BLOCK 清单、没有命中明细、也没有可豁免的行，
        <b>不是「查过了没问题」，是这个功能不存在</b>。「重新读取」在这里永远不会有结果。
        签字之前请自行完成人工核查。
      </div>
    </el-alert>

    <!--
      🔴 读失败与「档位是关闭的」必须是**两支**，不能共用一支。
         后端读不到时 workbench 是 null，而 reviewEntryVisible(null) 也是 false ——
         合成一支的话，一次网络故障会显示成「本机构已关闭机器复核」，
         那是一句关于机构配置的假事实，而它出现在一份档案页上
    -->
    <el-alert v-else-if="loadFailed" type="error" :closable="false" show-icon>
      <template #title>读不到这一份的复核档案</template>
      <div class="alert-text">
        后端那句原文已经弹出来了。这一页的全部内容来自一次
        <span class="mono">/qlzg/review/run/workbench</span> 请求，
        它没回来之前，这里对档位、命中数、豁免状态<b>一个字都不能说</b> ——
        说什么都可能与库里的真相相反。请点右上角「重新读取」再试一次。
      </div>
    </el-alert>

    <!--
      🔴 OFF 档下入口本该是**隐藏**的（§11.9.2.6 第 8 条），所以落到这一支只有两种可能：
         直接敲的 URL，或者报告页那一份 reviewModeEffective 与工作台这一份不是同刻。
         两种都要如实说，别装作是一个正常页面
    -->
    <el-alert v-else-if="!entryVisible" type="info" :closable="false" show-icon>
      <template #title>这一份报告的机器复核是关闭的</template>
      <div class="alert-text">
        档位 <span class="mono">OFF</span> 的含义是<b>这个功能不在</b>：一条规则都没跑，
        所以这里没有 BLOCK 清单、没有命中明细、也没有可豁免的行 ——
        不是「查过了没问题」，是<b>压根没查</b>。 签字之前请自行完成人工核查。
      </div>
      <div class="alert-sub">
        出路是把档位改回来。机构级入口在「系统管理 → 机构内控配置」； 本项目 / 本报告级的入口需要
        <span class="mono">qlzg:review:config</span> 权限， 且报告级只对草稿开放 ——
        本报告级的入口就在<b>这一屏下面</b>。
      </div>
      <!--
        🔴 这里**刻意不再**放一个「查看变更记录」：那一个链接现在住在分支链之外的
           公共块里（见下面 modeBlockVisible 那一段），四支共用一处。
           两处都放的表现是同一屏上出现两个文案略不同的同一个链接，
           而「略不同」正是让人怀疑自己点错了哪一个的那种略不同
      -->
    </el-alert>

    <!--
      🔴 「从来没被复核过」与「查过了、0 条问题」必须是两句话：
         一份刚建出来还没点过定稿的 DRAFT 就是这样，而一行都没查的报告上
         显示「0 条」会被读成「查过了，没问题」（§11.9.2.6 第 3 条要防的正是这件事）
    -->
    <el-alert v-else-if="!wb?.latest" type="warning" :closable="false" show-icon>
      <template #title>这一份报告还没有被复核过</template>
      <div class="alert-text">
        机器复核<b>只在定稿那一刻跑一次</b>（闸 C 挂在 DRAFT → FINALIZED 这条边上），
        所以一份还没点过「定稿」的草稿在这里必然是空的。这不是故障。
      </div>
      <div class="alert-sub">
        要看到命中清单，请回报告作业台先点一次「成文」，再点「定稿」： 闸 C
        会在定稿那一刻跑完全部规则、把每条规则的结论逐行存进档案，
        然后才决定放不放行。被拦下来的话，这一页上就会出现可逐条豁免的清单。
      </div>
    </el-alert>

    <div v-else>
      <!-- ==================== 报告与那一次运行的上下文 ==================== -->
      <el-descriptions :column="3" border size="small" class="mb-12px">
        <el-descriptions-item label="报告号">
          <span class="mono">{{ wb.reportNo || '（空）' }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="状态">
          <el-tag :type="reportStatusTagType(wb.reportStatus)" size="small">
            {{ wb.reportStatusName || labelOf(REPORT_STATUS_OPTIONS, wb.reportStatus) || '（空）' }}
          </el-tag>
          <span class="run-meta">
            <template v-if="wb.versionNo">第 {{ wb.versionNo }} 版</template>
            <template v-else>还没有定过稿</template>
          </span>
        </el-descriptions-item>
        <el-descriptions-item label="交付物">
          {{ wb.reportTitle || '（没有标题）' }}
        </el-descriptions-item>
        <el-descriptions-item label="生效档位">
          <el-tag :type="reviewModeTagType(wb.reviewModeEffective)" size="small">
            {{ labelOf(REVIEW_MODE_OPTIONS, wb.reviewModeEffective) || '（空）' }}
          </el-tag>
          <el-tooltip
            content="这一档是报告创建时解析三级配置的结果，冻结在这一份报告上，之后不随机构或项目的配置变。要改它只能走「变更档位」，且会留下一行痕迹。"
            placement="top"
          >
            <Icon icon="ep:question-filled" class="ml-4px tip-icon" />
          </el-tooltip>
        </el-descriptions-item>
        <el-descriptions-item label="最近一次运行">
          <el-tag :type="reviewRunStatusTagType(wb.latest.runStatus)" size="small">
            {{ wb.latest.runStatusName || labelOf(REVIEW_RUN_STATUS_OPTIONS, wb.latest.runStatus) }}
          </el-tag>
          <span class="run-meta">
            {{ wb.latest.runNo || '（没有运行编号）' }}
            <template v-if="wb.latest.triggeredAt"
              >· {{ formatDate(wb.latest.triggeredAt) }}</template
            >
            <template v-if="wb.latest.triggeredByNickname">
              · 由 {{ wb.latest.triggeredByNickname }} 触发
            </template>
          </span>
        </el-descriptions-item>
        <el-descriptions-item label="闸 C 当时的档位">
          {{
            wb.latest.gateCModeName || labelOf(REVIEW_MODE_OPTIONS, wb.latest.gateCMode) || '（空）'
          }}
          <span v-if="wb.gateCBypassed" class="bypass-text">· 这一档下闸 C 被绕过</span>
        </el-descriptions-item>
      </el-descriptions>

      <!--
        🔴 红点只是**提示**，不是「不一样就拦住」的开关：
           30 年后调档的人要能看出「这一份的口径与今天不同」，如此而已。
           所以这里**不**把两个指纹的原文并排印出来给人比对 ——
           32 位十六进制的差集肉眼读不出任何东西
      -->
      <el-alert v-if="versionChanged" type="warning" :closable="false" show-icon class="mb-12px">
        <template #title>这一份是按另一批规则判的</template>
        <div class="alert-text">
          那次运行用的规则集与今天的<b>不是同一份</b>。可能是规则改过、加过、删过，
          也可能只是某一条的启用状态翻过一次 —— 停用一条规则等于此后少查一项，
          而档案里那些「未命中」的旧结论是按<b>查过它</b>得出的。
        </div>
        <div class="alert-sub">
          这不拦住任何操作。要按今天的规则重新判一次，只能重新定稿： 闸 C
          会在那一刻用今天的规则集重跑，并把新的指纹写进新的运行头。
        </div>
      </el-alert>

      <!--
        🔴 §11.9.2.5：ADVISORY 档下技术负责人看到的界面**反而要多一块东西** ——
           一份「机器发现但已放行」的清单。机器不拦了，人必须拦；
           责任转移必须伴随知情确认，否则就是甩锅。
           所以这一档下工作台比 ENFORCE 档**多**一个数，不是少一个
      -->
      <el-alert v-if="advisory" type="warning" :closable="false" show-icon class="mb-12px">
        <template #title>这一档下机器复核不拦人</template>
        <div class="alert-text">
          规则照跑、结论照存，只是不再挡住定稿。下面有
          <b>{{ releasedCount }}</b> 条 BLOCK 是机器发现了、而这一档直接放行的 ——
          签字人要自己逐条看过。
        </div>
        <div class="alert-sub">
          「机器不拦」不等于「机器没查」：这一份的
          <span class="mono">qlzg_review.passed</span> 照样记着当时的结论，
          豁免不改它，降档也不改它。
        </div>
      </el-alert>

      <!-- ==================== 汇总行 ==================== -->
      <!--
        🔴 runs 是**每条规则一行**，不只是命中的那些。
           「48 条里有 45 条没命中」与「只查了 3 条」是两件不同的事，
           而前者是这一屏上最该被看见的一句话 —— 所以它常驻在表格上面，
           下面的折叠开关怎么拨都不影响它
        🔴 errored 必须从 pass 里**分开**报：那几条压根没求出结果，
           并进「未命中」等于在一份要保存 30 年的档案上把
           「查过了没问题」与「没查出来」写成同一个数
      -->
      <div class="summary-row">
        <span>
          本次共判 <b>{{ summary.total }}</b> 条规则：命中
          <b class="hit-text">{{ summary.hit }}</b> 条、未命中 <b>{{ summary.pass }}</b> 条<template
            v-if="summary.errored"
          >
            、求值失败 <b class="unknown-text">{{ summary.errored }}</b> 条</template
          >；此刻还在拦定稿的有 <b class="hit-text">{{ summary.blocking }}</b> 条。
        </span>
        <el-checkbox v-model="onlyProblem" class="ml-12px">只看命中与求值失败</el-checkbox>
      </div>

      <!--
        🔴 规则名要 `qlzg:review:config` 才读得到，而工作台本身**只要登录**。
           没权限的人这里就只显示规则码，并把这件事说出来 ——
           一次 403 弹窗比一行说明贵得多，而它会在页面加载那一刻就弹
      -->
      <div class="rule-name-note">
        <template v-if="ruleNameLoaded">
          规则名<b>按今天的规则名显示</b>。明细行落库时存的是规则码，不是名字 ——
          一次改名不该静默重写一份归档 30 年的档案标题，所以名字是现查的、可能与当时不同。
        </template>
        <template v-else>
          这里只显示规则码。规则名要 <span class="mono">qlzg:review:config</span> 权限才读得到，
          而你当前没有；规则码本身才是档案的一部分，它不随改名变。
        </template>
      </div>

      <!-- ==================== 明细行 ==================== -->
      <el-table
        v-loading="loading"
        :data="visibleRuns"
        row-key="id"
        size="small"
        border
        class="mb-12px"
      >
        <el-table-column type="expand">
          <template #default="{ row }">
            <div class="detail-box">
              <div v-if="row.message" class="detail-block">
                <div class="field-label">机器给的提示（后端渲染好的原文，逐字显示）</div>
                <div class="verbatim">{{ row.message }}</div>
              </div>
              <div v-if="row.suggestion" class="detail-block">
                <div class="field-label">建议</div>
                <div class="verbatim">{{ row.suggestion }}</div>
              </div>

              <!--
                🔴 errored 那一行要有**它自己**的一段：那一条规则压根没求出结果，
                   我们不知道它过没过。灰色问号 + 这段原文，才是「这一条不知道」的如实表达；
                   渲染成绿勾是「假装查过了」，渲染成红叉是「假装查出了问题」，
                   两者都在一份要保存 30 年的档案上写了一句假话
              -->
              <div v-if="row.errored" class="detail-block">
                <div class="field-label">这一条没求出结果，原因是</div>
                <div class="verbatim error-text">{{ row.errorMsg || '（后端没给原因）' }}</div>
                <div class="alert-sub">
                  它<b>不算命中、也不算未命中</b>。上面那个汇总里它单列成「求值失败」，
                  就是为了不把「没查出来」混进「查过了没问题」。
                </div>
              </div>

              <div class="detail-block">
                <div class="field-label">定位</div>
                <div class="verbatim">
                  规则码 <span class="mono">{{ row.ruleCode }}</span>
                  <template v-if="row.sectionCode"
                    >· 节 <span class="mono">{{ row.sectionCode }}</span></template
                  >
                  <template v-if="row.fieldKey"
                    >· 格子 <span class="mono">{{ row.fieldKey }}</span></template
                  >
                  <template v-if="row.locatable === false">
                    · 这一条定位不到报告上的具体位置（后端标了 locatable = false）
                  </template>
                </div>
              </div>

              <!--
                🔴 waived 与 waivedProperly 可能不相等，而那是**要看见的**：
                   一行 waived = 1 而理由是空的坏行，界面上显示成已豁免、闸 C 却不认 ——
                   而「撤销豁免」正是修好它的唯一手段，所以那一行下面必然带着撤销按钮
              -->
              <div v-if="row.waived" class="detail-block">
                <div class="field-label">这一条被豁免过</div>
                <div class="verbatim">
                  <template v-if="row.waivedByNickname">{{ row.waivedByNickname }}</template>
                  <template v-else>（查不到豁免人）</template>
                  <template v-if="row.updateTime">· {{ formatDate(row.updateTime) }}</template>
                </div>
                <div class="verbatim reason-text">{{ waiverReasonSummary(row.waiveReason) }}</div>
                <div v-if="waiverBrokenOf(row)" class="alert-sub error-text">
                  这一行的豁免<b>不完整</b>：后端要求「已豁免 + 豁免人 + 理由」三者同时非空，
                  缺一个就不认。所以它在界面上看着像豁免过了，定稿时却照样被拦。
                  出路是点「撤销豁免」把它修回来 —— 撤销的判据是 waived 这一列，
                  所以那个按钮此刻必然在。
                </div>
                <div v-else class="alert-sub">
                  撤销豁免会<b>保留</b>豁免人与理由，只把 waived 置回 0：
                  清空那两列等于销毁一段留痕，而撤销恰恰是最该留下痕迹的动作之一。
                </div>
              </div>

              <!--
                🔴 hitDetail 展开时才 parse：runs 是每条规则一行，
                   加载时就全部 parse 一遍，代价花在几十行根本不会被展开的数据上；
                   更要紧的是一个坏值不该让整屏挂掉
              -->
              <div v-if="detailTextOf(row)" class="detail-block">
                <div class="field-label">求值细节（引擎当时写下的原文）</div>
                <pre class="detail-json">{{ detailTextOf(row) }}</pre>
              </div>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="结论" width="64" align="center">
          <template #default="{ row }">
            <el-tooltip :content="markTipOf(row)" placement="top">
              <Icon :icon="markIconOf(row)" :class="markClassOf(row)" class="mark-icon" />
            </el-tooltip>
          </template>
        </el-table-column>

        <el-table-column label="规则" min-width="210">
          <template #default="{ row }">
            <span class="mono">{{ row.ruleCode }}</span>
            <span v-if="ruleNameLoaded" class="rule-name">{{ ruleNameOf(row.ruleCode) }}</span>
          </template>
        </el-table-column>

        <el-table-column label="档位" width="76" align="center">
          <template #default="{ row }">
            <el-tag :type="ruleSeverityTagType(row.severity)" size="small">
              {{ row.severityName || labelOf(RULE_SEVERITY_OPTIONS, row.severity) || '（空）' }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="机器给的提示" min-width="280" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.errored" class="unknown-text">这一条没求出结果，展开看原因</span>
            <span v-else>{{ row.message || '（这一条没有提示文字）' }}</span>
          </template>
        </el-table-column>

        <el-table-column label="对定稿" width="112" align="center">
          <template #default="{ row }">
            <el-tag v-if="blocksFinalizeNow(row)" type="danger" size="small">拦着</el-tag>
            <el-tag v-else-if="waiverBrokenOf(row)" type="warning" size="small">
              豁免不完整
            </el-tag>
            <el-tag v-else-if="row.waived" type="info" size="small">已豁免</el-tag>
            <span v-else class="muted-text">不拦</span>
          </template>
        </el-table-column>

        <el-table-column label="操作" width="104" align="center" fixed="right">
          <template #default="{ row }">
            <!--
              🔴 未命中的行上**没有**豁免按钮，不是置灰的按钮：
                 WARN / INFO 本来就不拦定稿，给它们写一个 waived = 1
                 等于在档案里记一件没发生的事
            -->
            <el-button
              v-if="runRowWaivable(row)"
              v-hasPermi="['qlzg:review:waive']"
              link
              type="primary"
              @click="openWaive(row)"
            >
              豁免
            </el-button>
            <el-button
              v-if="runRowRevocable(row)"
              v-hasPermi="['qlzg:review:waive']"
              link
              type="danger"
              @click="revoke(row)"
            >
              撤销豁免
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <!-- ==================== 历次运行 ==================== -->
      <div class="field-label">历次运行</div>
      <div class="alert-sub mb-8px">
        复核只在定稿那一刻跑，所以这里的行数 = 这份报告被定稿过（或被闸拦下过）的次数。
        每一行的结论都是<b>当时的历史事实</b>，后来的豁免不改它。
      </div>
      <el-table :data="wb.history || []" size="small" border>
        <el-table-column label="运行编号" prop="runNo" min-width="130">
          <template #default="{ row }">
            <span class="mono">{{ row.runNo || '（空）' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="120" align="center">
          <template #default="{ row }">
            <el-tag :type="reviewRunStatusTagType(row.runStatus)" size="small">
              {{ row.runStatusName || labelOf(REVIEW_RUN_STATUS_OPTIONS, row.runStatus) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="闸 C 档位" width="104" align="center">
          <template #default="{ row }">
            <el-tag :type="reviewModeTagType(row.gateCMode)" size="small">
              {{ row.gateCModeName || labelOf(REVIEW_MODE_OPTIONS, row.gateCMode) || '（空）' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="判了几条" width="88" align="center">
          <template #default="{ row }">{{ row.totalRules ?? '—' }}</template>
        </el-table-column>
        <el-table-column label="BLOCK / WARN / INFO" width="150" align="center">
          <template #default="{ row }">
            {{ row.blockCount ?? 0 }} / {{ row.warnCount ?? 0 }} / {{ row.infoCount ?? 0 }}
          </template>
        </el-table-column>
        <el-table-column label="未清零" width="80" align="center">
          <template #default="{ row }">
            <b :class="{ 'hit-text': (row.blockCountUnwaived ?? 0) > 0 }">
              {{ row.blockCountUnwaived ?? 0 }}
            </b>
          </template>
        </el-table-column>
        <el-table-column label="当时结论" width="92" align="center">
          <template #default="{ row }">
            <!--
              🔴 passed = 0 在 ADVISORY 档下是**常态**，不是异常：
                 那一档的含义就是「照跑、只提示不拦截」，所以报告会带着 passed = 0
                 一路走到 FINALIZED。渲染成红叉的话，一个依法降档的机构
                 在自己的档案页上看起来像出了事故
            -->
            <span v-if="row.passed == null" class="muted-text">没有结论</span>
            <span v-else-if="row.passed === 1" class="pass-text">通过</span>
            <span v-else class="muted-text">未通过（当时的历史事实）</span>
          </template>
        </el-table-column>
        <el-table-column label="触发人" min-width="110">
          <template #default="{ row }">
            {{ row.triggeredByNickname || '（这个端点才补昵称）' }}
          </template>
        </el-table-column>
        <el-table-column label="时间" prop="triggeredAt" width="170" :formatter="dateFormatter" />
      </el-table>
    </div>

    <!-- ==================== 变更本报告的档位 ==================== -->
    <!--
      🔴 这一块刻意**放在四支之外**（不是嵌在「有数据」那一支里）。
         它要回答的三件事与「跑过没跑过复核」无关：
         ① 档位是 OFF 的那一支 —— 灰条告诉用户「出路是把档位改回来，本报告级的入口就在这一屏下面」，
            而那一支恰恰**没有** latest，嵌在 v-else 里就等于灰条指着一个不存在的东西；
         ② 空态（还没被复核过）—— 一份全新的草稿正是**唯一**既被允许、又真正需要改报告级档位的状态，
            嵌在 v-else 里的表现是「必须定稿过再退回修订才能改」，一条只有绕路才走得通的入口；
         ③ 已定稿 —— 查记录不是改配置，此时更该能回答「这一份当时是哪一档、谁改的」。
         实测后果：e2e 走查在空态上找不到这个按钮，报告级弹层永远打不开
      -->
    <!--
      🔴 只有 DRAFT 给入口（不是给了再报错）：已定稿的报告连着纸质件、
         qlzg_review.gate_c_mode 与那一版快照，放开改会让三处对不上且没有一处报错
         （REVIEW_MODE_REPORT_NOT_DRAFT）。一次必然被拒的提交除了
         让人以为「功能坏了」以外没有任何产出
      🔴 与 §11.9.2.6 第 1 条不冲突：那一条说的是**机构级**入口不放在报告页面
         （「变更档位是管理动作，要走到管理界面才能做，这个路程本身就是防护」）。
         报告级改的只是这一份，而且它要求 qlzg:review:config ——
         与机构级同一个权限点，承办评估师本来就没有
    -->
    <div v-if="modeBlockVisible" class="mt-16px flex items-center">
      <el-button v-if="canChangeReportMode" :loading="modeContextLoading" @click="openModeDialog">
        <Icon icon="ep:setting" class="mr-5px" /> 变更本报告的复核档位
      </el-button>
      <span v-if="canChangeReportMode" class="alert-sub ml-8px">
        只影响这一份报告，且会留下一行痕迹（谁、什么时候、什么理由）。
        承办评估师本人不得变更自己那份。
      </span>
      <!--
        🔴 这个链接**不按权限分支**：/config/waiver/chain 是「只要登录」，
           刻意就是为了让不能改配置的人也能看到举证。
           挂上权限点的表现是「一条写着档位被降过的事实，配一个打不开的入口」，
           比没有那条事实更坏。
        🔴 它也不受「只有草稿给变更入口」那一条约束：已定稿的报告更需要
           能回答「这一份当时是哪一档、谁改的」，而查记录不是改配置
      -->
      <el-button
        v-if="chainHasAny"
        link
        type="primary"
        :class="canChangeReportMode ? 'ml-12px' : ''"
        @click="openChain"
      >
        查看这一份的档位变更记录
      </el-button>
    </div>
  </ContentWrap>

  <!-- ==================== 豁免弹层 ==================== -->
  <Dialog v-model="waiveVisible" title="豁免这一条 BLOCK" width="680" :close-on-click-modal="false">
    <!--
      🔴 成功提示里**必须**有「要再定稿一次才生效」这句：本端点只改明细行，
         不动报告状态、也不改 qlzg_review.passed（那是上一次运行的历史事实）。
         不说这句的话用户会以为点完就过了，然后在下一次定稿失败时认为是系统坏了
    -->
    <el-alert type="warning" :closable="false" show-icon class="mb-12px">
      <div class="alert-text">
        豁免只改<b>这一行明细</b>，不动报告状态。豁免完还要<b>再定稿一次</b>才生效。
      </div>
      <div class="alert-sub">
        理由会<b>逐字</b>存进档案，保存 30 年。口头或线下审批不能代替它 —— 它是 30
        年后唯一能回答「谁决定放行这一条」的东西。
      </div>
    </el-alert>

    <el-descriptions :column="1" border size="small" class="mb-12px">
      <el-descriptions-item label="规则码">
        <span class="mono">{{ waiveTarget?.ruleCode }}</span>
        <span v-if="ruleNameLoaded" class="rule-name">
          {{ ruleNameOf(waiveTarget?.ruleCode) }}
        </span>
      </el-descriptions-item>
      <el-descriptions-item label="机器给的提示">
        <div class="verbatim">{{ waiveTarget?.message || '（这一条没有提示文字）' }}</div>
      </el-descriptions-item>
      <el-descriptions-item v-if="waiveTarget?.suggestion" label="建议">
        <div class="verbatim">{{ waiveTarget.suggestion }}</div>
      </el-descriptions-item>
    </el-descriptions>

    <div class="field-label">豁免理由</div>
    <el-input
      v-model="waiveReason"
      type="textarea"
      :rows="4"
      :maxlength="REVIEW_REASON_MAX_LENGTH"
      show-word-limit
      placeholder="写清为什么这一条可以放行：依据是什么、谁批准的、补正在哪一份文件里"
    />
    <!--
      🔴 少于 10 字是**橙色**提示、且**不禁用**提交；空白与超上限才是红色 + 禁用。
         差别不在字数，在「后端会不会为这次尝试写一行 rejected = 1 的留痕」：
         空白撞 @NotBlank、超上限撞 @Size(max = 500) 与 MySQL 列宽，
         两道都在进 Controller 之前就把请求打回去，那次尝试一个字都留不下来 —— 前端拦下不丢东西；
         而「少于 10 字」后端刻意放在 Service 里判，就是为了先留痕再抛异常。
         前端在这里禁用按钮，等于把「有人在赶稿时想放行一条 BLOCK」这条记录从档案里抹掉
         （判据见 reviewFlow 的 reviewReasonBlocksSubmit）
    -->
    <div v-if="waiveProblem" class="problem-line" :class="{ 'problem-line-warn': !waiveBlocks }">
      {{ waiveProblem }}
    </div>
    <div v-else class="hint-line">
      至少 {{ REVIEW_REASON_MIN_LENGTH }} 个字，最多 {{ REVIEW_REASON_MAX_LENGTH }} 个字符。
    </div>

    <template #footer>
      <el-button type="primary" :loading="waiving" :disabled="waiveBlocks" @click="submitWaive">
        确认豁免
      </el-button>
      <el-button :disabled="waiving" @click="waiveVisible = false">取消</el-button>
    </template>
  </Dialog>

  <ReviewModeChangeDialog ref="modeDialogRef" @success="onModeChanged" @rejected="onModeRejected" />
  <WaiverChainDrawer ref="chainDrawerRef" />
</template>
<script lang="ts" setup>
import { useRoute, useRouter } from 'vue-router'
import { QlzgProjectApi, type QlzgProjectVO } from '@/api/qlzg/project'
import { QlzgReviewConfigApi, type QlzgOrgReviewConfigVO } from '@/api/qlzg/reviewConfig'
import {
  QlzgReviewRunApi,
  type QlzgReviewRunVO,
  type QlzgReviewWorkbenchVO
} from '@/api/qlzg/reviewRun'
import { QlzgReviewRuleApi } from '@/api/qlzg/reviewRule'
import { dateFormatter, formatDate } from '@/utils/formatTime'
// 🔴 checkPermi **不在自动导入清单里**（自动导入只收 Vue/vue-router API、useI18n、
//    useMessage、useTable、useCrudSchemas、DICT_TYPE 与 src/components/** 下的组件），
//    漏掉这一行的表现是「ReferenceError」，而它只在页面加载那一刻才发生
import { checkPermi } from '@/utils/permission'
// 🔴 退化形态（REPORT_ONLY / REPORT_SIGN）下 review 模块压根没装，本页那三个端点的
//    Controller 也不在容器里。「没装」这个事实只能问后端 —— 菜单树是过滤后才发下来的，
//    少掉的那几项在前端从来不存在过。走共享快照，与报告作业台共用一次请求
import { isInstalled, loadModuleForm } from '@/views/qlzg/moduleForm'
import {
  REPORT_STATUS_OPTIONS,
  REVIEW_MODE_OPTIONS,
  REVIEW_REASON_MAX_LENGTH,
  REVIEW_REASON_MIN_LENGTH,
  REVIEW_RUN_STATUS_OPTIONS,
  RULE_SEVERITY_OPTIONS,
  labelOf,
  reportStatusTagType,
  reviewModeTagType,
  reviewRunStatusTagType,
  ruleSeverityTagType
} from '@/views/qlzg/constants'
import ReviewModeChangeDialog from '../ReviewModeChangeDialog.vue'
import WaiverChainDrawer from '../WaiverChainDrawer.vue'
import {
  advisoryReleasedCountOf,
  blocksFinalizeNow,
  hitDetailText,
  reviewEntryVisible,
  reviewReasonBlocksSubmit,
  reviewReasonProblem,
  ruleSetVersionChanged,
  runRowMarkOf,
  runRowRevocable,
  runRowSummaryOf,
  runRowWaivable,
  waiverBrokenOf,
  waiverReasonSummary
} from '../reviewFlow'

/**
 * 复核工作台（§11.9.2.6 第 8 条点名的「I5 手写页」）
 *
 * <h3>🔴 为什么是手写页，不是 CRUD 生成器出的那套</h3>
 * 它不是一个实体的台账：没有新建、没有分页、没有搜索表单，
 * 一屏上要同时回答「这次判了几条」「哪几条拦着定稿」「哪几条是机器发现了但这一档放行的」
 * 「哪几条压根没求出结果」四个问题，而这四个数的口径互不相同
 * （{@code blocking} 读后端算好的列、{@code errored} 要从 {@code pass} 里分出来）。
 * 生成器给的是「一行一个实体 + 操作列」，套上来的产物是一张看不出结论的表。
 *
 * <h3>🔴 整屏**一次**取全，不拆成三次请求</h3>
 * 报告页那条黄条上的「3 条 BLOCK 未清零」必须等于这里明细中
 * {@code blocksFinalizeNow = true} 的行数，而这些行必须属于同一次运行。
 * 三个请求就是三个时刻，中间插进一次定稿的话，用户看到的是
 * 「黄条说 3 条、清单里 5 行」，而无从判断哪一边错了。
 *
 * <h3>🔴 这一页对非超管也**不需要**任何权限点</h3>
 * {@code /qlzg/review/run/workbench} 与 {@code /latest} 一样是「只要登录」：
 * 看报告的人不一定持有复核权限点，而挂上权限点的表现是「点进去 403」——
 * 那正好是 §11.9.2.6 第 3 条要防的「关了就看不见」，只不过换成「没权限就看不见」。
 * 于是本页只有两处按权限分支，且都是**加东西**而不是**减东西**：
 * 规则名（要 {@code qlzg:review:config}）与逐条豁免按钮（要 {@code qlzg:review:waive}）。
 * 因为它一个权限点都不带，所以它**不能**建成 DB 菜单 ——
 * 路由写在 {@code router/modules/remaining.ts}（那里记了为什么）
 *
 * @author 走进新时代
 */
defineOptions({ name: 'QlzgReviewWorkbench' })

const route = useRoute()
const router = useRouter()
const message = useMessage()

/** 从 URL 取报告编号；🔴 与案例召回页同一条纪律：0 与 NaN 都不算合法编号 */
const reportId = computed(() => {
  const parsed = Number(
    Array.isArray(route.query.reportId) ? route.query.reportId[0] : route.query.reportId
  )
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
})

/** 从 URL 取项目编号，只为「变更本报告档位」那个弹层解析「跟随项目配置」用 */
const projectId = computed(() => {
  const parsed = Number(
    Array.isArray(route.query.projectId) ? route.query.projectId[0] : route.query.projectId
  )
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
})

const loading = ref(false)
const loaded = ref(false)
const loadFailed = ref(false)
const wb = ref<QlzgReviewWorkbenchVO | null>(null)
const chainHasAny = ref(false)

/**
 * 本部署压根**没装** review 模块（{@code REPORT_ONLY} / {@code REPORT_SIGN} 形态）
 *
 * <p>它与 {@link loadFailed} 是**两种**不同处境，界面上必须分开说：
 * 「装了、这次没读到」（刷新有用）与「没装」（刷新永远没用）。
 * 判据取自 {@code @/views/qlzg/moduleForm} 那份共享快照 —— 它是模块级 ref，
 * 报告作业台可能比本页先把它取回来，所以这里写成 computed 跟着快照自己翻，
 * 而不是一个由 {@link load} 赋值的 ref（那样头部那排按钮在快照落地前会先渲染一次）
 *
 * <p>⚠️ 取不到形态时 {@code isInstalled} 一律答 true，即本页**照常去读**。
 * 方向与 {@code QlzgMenuVisibilityCustomizer} 的「认不出归属当 CORE 处理」逐字一致：
 * 误藏的代价是「一个装着的、能用的功能从界面上消失了」，比多发一次注定失败的请求严重得多
 */
const notInstalled = computed(() => !isInstalled('review'))

const entryVisible = computed(() => reviewEntryVisible(wb.value))
const summary = computed(() => runRowSummaryOf(wb.value?.runs))
const onlyProblem = ref(false)

const visibleRuns = computed(() => {
  const runs = wb.value?.runs ?? []
  if (!onlyProblem.value) return runs
  return runs.filter((run) => runRowMarkOf(run) !== 'PASS')
})

/**
 * 红点的判据：那次运行用的规则集与今天的**不是同一份**
 *
 * 🔴 任一侧为空 ⇒ 不亮。「不知道」与「变了」是两件事：
 *    在每一份还没跑过复核的报告上都亮一个红点，红点会在三天内失去全部意义，
 *    而那时真正变了的那一次也没人会看
 */
const versionChanged = computed(() =>
  ruleSetVersionChanged(wb.value?.latest?.ruleSetVersion, wb.value?.currentRuleSetVersion)
)

/**
 * 这一档是不是 ADVISORY
 *
 * 🔴 判据用**那次运行冻结的** {@code gateCMode}，不用报告上的 {@code reviewModeEffective}：
 *    「机器发现但已放行」这个数说的是那一次运行当时的事，
 *    而报告级档位可以在草稿期被改（改完要重新定稿才会重跑）。
 *    用后者会出现「界面说已放行 3 条、而那次运行其实是 ENFORCE 档、
 *    那 3 条是被逐条豁免的」—— 两者的责任人不是同一个人
 */
const advisory = computed(() => wb.value?.latest?.gateCMode === 'ADVISORY')
const releasedCount = computed(() => advisoryReleasedCountOf(wb.value?.runs))

// ==================== 规则码 → 今天的规则名 ====================

const canConfig = checkPermi(['qlzg:review:config'])
const ruleNameLoaded = ref(false)
const ruleNameMap = ref<Record<string, string>>({})

const ruleNameOf = (ruleCode?: string | null): string => {
  if (!ruleCode) return ''
  return ruleNameMap.value[ruleCode] ?? '（今天的规则表里查不到这个码）'
}

/**
 * 🔴 这一份映射**只在持有 {@code qlzg:review:config} 时才去取**
 *
 * 工作台本身只要登录，而 {@code /qlzg/review/rule/list} 要那个权限点。
 * 无条件去取的表现是：每一个没有配置权限的人一打开这一页就吃一个 403 弹窗 ——
 * 而那个弹窗说的是一件他压根没做的事（他没想去改规则，他只是想看命中清单）。
 * 取不到就只显示规则码，并把这件事在表格上面说出来，别让它看起来像一个 bug
 */
const loadRuleNames = async () => {
  if (!canConfig || ruleNameLoaded.value) return
  try {
    const rules = await QlzgReviewRuleApi.getRuleList()
    const map: Record<string, string> = {}
    for (const rule of rules ?? []) {
      if (rule.ruleCode) map[rule.ruleCode] = rule.ruleName
    }
    ruleNameMap.value = map
    ruleNameLoaded.value = true
  } catch {
    // 取不到就只显示规则码。ruleNameLoaded 保持 false，
    // 于是表格上面那一行说明如实说「读不到规则名」，而不是显示一片「查不到这个码」
  }
}

// ==================== 明细行的三种图记 ====================

const markIconOf = (row: QlzgReviewRunVO): string => {
  const mark = runRowMarkOf(row)
  if (mark === 'HIT') return 'ep:circle-close-filled'
  if (mark === 'PASS') return 'ep:circle-check-filled'
  return 'ep:question-filled'
}

const markClassOf = (row: QlzgReviewRunVO): string => {
  const mark = runRowMarkOf(row)
  if (mark === 'HIT') return 'hit-text'
  if (mark === 'PASS') return 'pass-text'
  return 'unknown-text'
}

const markTipOf = (row: QlzgReviewRunVO): string => {
  const mark = runRowMarkOf(row)
  if (mark === 'HIT') return '命中：这一条规则判出了问题'
  if (mark === 'PASS') return '未命中：这一条查过了，没查出问题'
  return '求值失败：这一条压根没求出结果，我们不知道它过没过（展开看原因）'
}

/**
 * 🔴 展开时才 parse，且用一个**非响应式**的 Map 缓存
 *
 * 用 ref 缓存的话，赋值发生在渲染过程中，那是一次会触发重新渲染的副作用；
 * 而这里根本不需要响应式 —— 一段明细的 JSON 一旦落库就不会变，
 * 缓存的唯一目的是「同一行反复展开时不重复 parse」
 */
const detailCache = new Map<number, string>()
const detailTextOf = (row: QlzgReviewRunVO): string => {
  const cached = detailCache.get(row.id)
  if (cached !== undefined) return cached
  const text = hitDetailText(row.hitDetail)
  detailCache.set(row.id, text)
  return text
}

// ==================== 读取 ====================

const load = async () => {
  if (!reportId.value) return
  loading.value = true
  // 🔴 没装 review 模块时**一次请求都不发**（连带下面那两个也不发），而不是发了再 catch：
  //    退化形态下这三个端点的 Controller 压根不在容器里，回来的是 code=404
  //    「请求地址不存在」的业务错误体（HTTP 状态码仍是 200），
  //    而 axios 拦截器会为它弹一条报错 —— catch 得住 promise，catch 不住已经弹出去的 toast。
  //    用户每点一次「重新读取」就被弹一次，那条弹窗说的还是一件他无法处置的事
  // ⚠️ loadModuleForm() 带缓存，同一个会话里只有第一次真发请求
  await loadModuleForm()
  if (notInstalled.value) {
    wb.value = null
    loadFailed.value = false
    loading.value = false
    loaded.value = true
    return
  }
  try {
    wb.value = await QlzgReviewRunApi.getWorkbench(reportId.value)
    loadFailed.value = false
  } catch {
    // 🔴 报错原文已由 axios 拦截器弹出，这里不叠一句自己的。
    //    🔴 也不 rethrow —— 那会变成一次没人接的 promise 拒绝，
    //    而端到端走查正是靠控制台干不干净来判断页面有没有坏
    wb.value = null
    loadFailed.value = true
  } finally {
    loading.value = false
    loaded.value = true
  }
  await Promise.all([loadRuleNames(), loadChainHasAny()])
}

/**
 * 灰条与页脚那个「查看变更记录」链接**该不该出现**
 *
 * 🔴 {@code hasAny = false} 时链接本身就不出现：点进去是三个空面板，
 *    而旁边写着「本报告未经过机器复核（机构配置）」——
 *    两处对不上的表现是用户以为界面在胡说。
 *    这一步失败也不要紧，链接不出现就是了，所以 catch 里一律按「没有」处理：
 *    它是一处**举证入口**，缺了它页面照样能用，而一次 403 弹窗会把
 *    「这一页坏了」这个印象盖在真正的内容上
 */
const loadChainHasAny = async () => {
  if (!reportId.value) return
  try {
    const chain = await QlzgReviewConfigApi.getWaiverChain({
      reportId: reportId.value,
      projectId: projectId.value ?? undefined
    })
    chainHasAny.value = chain?.hasAny === true
  } catch {
    chainHasAny.value = false
  }
}

const goReport = () => {
  router.push({
    path: '/qlzg-report/workbench',
    query: reportId.value ? { reportId: String(reportId.value) } : undefined
  })
}

// ==================== 逐条豁免 ====================

const waiveVisible = ref(false)
const waiving = ref(false)
const waiveTarget = ref<QlzgReviewRunVO | null>(null)
const waiveReason = ref('')

const waiveProblem = computed(() => reviewReasonProblem(waiveReason.value))
const waiveBlocks = computed(() => reviewReasonBlocksSubmit(waiveReason.value))

const openWaive = (row: QlzgReviewRunVO) => {
  waiveTarget.value = row
  waiveReason.value = ''
  waiveVisible.value = true
}

const submitWaive = async () => {
  const target = waiveTarget.value
  if (!target || waiving.value) return
  waiving.value = true
  try {
    await QlzgReviewRunApi.waiveBlock({ runId: target.id, reason: waiveReason.value.trim() })
    waiveVisible.value = false
    message.success('已豁免这一条。要再定稿一次才生效：本操作只改这一行明细，不动报告状态')
    await load()
  } catch {
    // 🔴 报错原文必须由拦截器显示，尤其是 REVIEW_RUN_WAIVE_BY_APPRAISER ——
    //    那道校验排在字数校验**之前**（授权在前、输入在后），
    //    所以「按钮点得动、理由也写完了」才收到那句「你不能豁免自己那份」。
    //    这是**要**的顺序：反过来的话他要往返两次。
    //    界面上自己编一句「请检查理由」会把人导向完全错误的方向
  } finally {
    waiving.value = false
  }
}

const revoke = async (row: QlzgReviewRunVO) => {
  try {
    await message.confirm(
      '撤销豁免会把这一条 BLOCK 重新计回闸 C，此后它又拦住定稿了。' +
        '豁免人与当时的理由会保留在档案里（清空它们等于销毁一段留痕）。' +
        '如果这份报告已经定稿，撤销不会把那一版收回来：那一版已经交出去了。' +
        '出路是「退回修订 → 改 → 重新定稿」，重新定稿会重跑一次闸 C，' +
        '此时这一条已经重新计入。确定要撤销吗？'
    )
  } catch {
    return
  }
  try {
    await QlzgReviewRunApi.revokeWaiver(row.id)
    message.success('已撤销。这一条重新计回闸 C 了')
    await load()
  } catch {
    // 🔴 两个人同时点撤销的话，一个成功、一个收到 REVIEW_RUN_NOT_WAIVED。
    //    这不是 bug，**不要在这里重试** —— 重试只会把「另一个人已经撤销了」
    //    翻译成一次成功，而档案上那一行记的是他撤销的
  }
}

// ==================== 变更本报告的档位 ====================

const modeDialogRef = ref()
const chainDrawerRef = ref()
const modeContextLoading = ref(false)

/**
 * 🔴 两个条件缺一不可，而后端对两种不满足各有自己的报错
 *
 * 非草稿 ⇒ {@code REVIEW_MODE_REPORT_NOT_DRAFT}；没权限 ⇒ 403。
 * 两种都**不给入口**（不是给了再报错）：一次必然被拒的提交除了
 * 让人以为「功能坏了」以外没有任何产出
 */
const canChangeReportMode = computed(() => canConfig && wb.value?.reportStatus === 'DRAFT')

/**
 * 上面那一块**该不该出现在这一屏**
 *
 * 🔴 前三项是「这一页到底读没读到东西」，不是权限：没有 reportId 时这一页是一句提示，
 *    还没读完时是骨架屏，读失败时是一句「读不到这一份的复核档案」——
 *    在这三种情况下摆一个「变更本报告的复核档位」，用户点下去拿到的是
 *    一个 {@code reportId} 为 null 的请求，而弹层里那一栏「当前档位」也是空的
 * 🔴 后两项才是内容：能改（有权限 + 草稿），或者有记录可查（这一支**不看权限**，
 *    理由写在模板里那个链接上方）
 */
const modeBlockVisible = computed(
  () =>
    !!reportId.value &&
    loaded.value &&
    !loadFailed.value &&
    (canChangeReportMode.value || chainHasAny.value)
)

const openChain = () => {
  chainDrawerRef.value?.open({
    reportId: reportId.value ?? undefined,
    projectId: projectId.value ?? undefined
  })
}

/**
 * 弹层要的那一份上下文，**点开那一刻**才去取
 *
 * <h3>🔴 为什么不在页面加载时取</h3>
 * 绝大多数打开这一页的人是来看命中清单的评估师，而这两个请求他都不一定有权限：
 * {@code /config/org} 要 {@code qlzg:review:config}、项目详情要 {@code qlzg:project:query}
 * —— 是**两个不同的权限点**，别把它们当成一回事（旧版这里写的是「两个都要 review:config」）。
 * 加载时就取等于让每个人为一次可能压根不发生的变更付两次 403
 *
 * <h3>🔴 {@code statutory} 取**项目自己那一列**，不是 {@code org.statutory}</h3>
 * 后端 {@code QlzgReviewModeServiceImpl#changeReportMode} 判的是
 * {@code Boolean.TRUE.equals(project.getIsStatutory())}；
 * 而 {@code org.statutory} 是 {@code countStatutoryActive() > 0}，
 * 含义是「本机构名下**有**法定评估项目」—— 一个保守的超集。
 * 拿超集去判，一个非法定项目的报告会印出「本次变更涉及法定评估业务」并要求勾告知，
 * 后端却压根不校验那个勾（它那一边 statutory 是 false）。
 * 界面上多出来的那一段红字不会被任何一处拦下，
 * 而它说的是一件与这份报告无关的事 —— 用户读到的是「界面在胡说」
 *
 * <h3>🔴 {@code currentEffectiveMode} 传的是**解析后**的那一列</h3>
 * {@code review_mode_effective} 已经是三级解析的结果，直接用；
 * 而 {@code inheritResolvesTo}（选「跟随项目配置」会变成哪一档）后端没有端点给，
 * 只能自己拼：项目钉了就用项目那一档，没钉就落到机构那一档。
 * 拼不出来时传 null —— 弹层会如实说「这次没取到」，
 * 而 {@code statutoryAckRequired} 对「不知道」保守返回 true（需要勾选）
 */
const openModeDialog = async () => {
  if (!reportId.value || modeContextLoading.value) return
  modeContextLoading.value = true
  let org: QlzgOrgReviewConfigVO | null = null
  let project: QlzgProjectVO | null = null
  try {
    org = await QlzgReviewConfigApi.getOrgConfig()
    if (projectId.value) {
      project = await QlzgProjectApi.getProject(projectId.value)
    }
  } catch {
    // 报错原文已由拦截器弹出。org 为 null 时下面那几项一律传 null，
    // 弹层对「不知道」的处理是保守的（不拦「档位没变」、要求勾告知），
    // 所以继续开弹层比把它关掉更安全 —— 关掉的话用户只看到一个 403，
    // 而不知道自己想做的事其实还能做
  } finally {
    modeContextLoading.value = false
  }
  modeDialogRef.value?.open({
    level: 'REPORT',
    scopeLabel: '仅本报告',
    currentEffectiveMode: wb.value?.reviewModeEffective ?? null,
    // 🔴 项目读不到时才退回机构那个超集：那一边是「不知道」，
    //    而 {@code statutoryAckRequired} 对「不知道」保守地要求勾选 —— 方向是对的
    statutory: project ? (project.isStatutory ?? false) : (org?.statutory ?? null),
    noticeText: org?.noticeText ?? null,
    draftReportCount: null,
    inheritResolvesTo: project?.reviewMode || org?.reviewMode || null,
    reportId: reportId.value
  })
}

/**
 * 变更成功 / 被程序性拒绝，都要重新读一遍
 *
 * 🔴 「被拒绝」也要读：后端对「理由少于 10 字」「法定业务没勾告知」两类是
 *    **先写一行 {@code rejected = 1} 的留痕、再抛异常**的。
 *    只在成功时刷新的话，用户被拒一次、关掉弹层，变更记录里就少了刚写下的那一行 ——
 *    而那一行正是「有人在赶稿时想关掉复核」的记录
 */
const onModeChanged = async () => {
  await load()
}
const onModeRejected = async () => {
  await loadChainHasAny()
}

onMounted(() => {
  load()
})
</script>
<style lang="scss" scoped>
.alert-text {
  font-size: 13px;
  line-height: 1.7;
}

.alert-sub {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}

.mono {
  font-family: var(--el-font-family-mono, monospace);
}

.field-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-regular);
}

.run-meta {
  margin-left: 6px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.summary-row {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  margin-bottom: 8px;
  font-size: 13px;
  background: var(--el-fill-color-lighter);
  border-radius: 4px;
}

.rule-name-note {
  margin-bottom: 8px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}

.rule-name {
  margin-left: 6px;
  font-size: 12px;
  color: var(--el-text-color-regular);
}

.mark-icon {
  font-size: 16px;
}

.hit-text {
  color: var(--el-color-danger);
}

.pass-text {
  color: var(--el-color-success);
}

.unknown-text {
  color: var(--el-text-color-secondary);
}

.muted-text {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.error-text {
  color: var(--el-color-danger);
}

.bypass-text {
  margin-left: 4px;
  font-size: 12px;
  color: var(--el-color-warning);
}

.tip-icon {
  color: var(--el-text-color-secondary);
}

.detail-box {
  padding: 8px 16px 12px;
}

.detail-block {
  margin-bottom: 10px;
}

.verbatim {
  padding: 6px 8px;
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.7;

  /* 🔴 pre-wrap：后端渲染好的中文提示里可能带换行，压成一行会读不出停顿 */
  white-space: pre-wrap;
  background: var(--el-fill-color-lighter);
  border-radius: 4px;
}

.reason-text {
  margin-top: 4px;
}

.detail-json {
  padding: 8px;
  margin: 4px 0 0;
  overflow: auto;
  font-family: var(--el-font-family-mono, monospace);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre;
  background: var(--el-fill-color-lighter);
  border-radius: 4px;
}

.hint-line {
  margin-top: 6px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.problem-line {
  padding: 6px 8px;
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-color-danger);
  background: var(--el-color-danger-light-9);
  border-radius: 4px;
}

.problem-line-warn {
  color: var(--el-color-warning);
  background: var(--el-color-warning-light-9);
}
</style>
