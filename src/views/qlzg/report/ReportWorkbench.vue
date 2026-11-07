<template>
  <ContentWrap title="报告作业台">
    <template #header>
      <div class="flex items-center justify-end w-full">
        <el-button
          type="primary"
          :loading="composing"
          :disabled="!report?.id || !editable"
          @click="compose"
          v-hasPermi="['qlzg:report:compose']"
        >
          <Icon icon="ep:document-checked" class="mr-5px" /> {{ composeButtonLabel(report) }}
        </el-button>
        <el-button
          :disabled="!report?.wordFileId"
          @click="download"
          v-hasPermi="['qlzg:report:query']"
        >
          <Icon icon="ep:download" class="mr-5px" /> 下载成稿
        </el-button>
        <!--
          🔴 入口挂在**作业台**上而不是台账上：要看红标的人此刻正站在某一版报告里，
             而台账那一行已经挤了七八个操作。它读的是 qlzg:report:query，
             与后端那两个端点同一个权限点（本仓的既有口径是复用它，不新造 :export 那一类串：
             新权限串没有对应的按钮菜单时，承载行的 menu_id 是 NULL，
             于是所有非超管会**静默**失去这个入口，全程 200 无异常）
        -->
        <el-button :disabled="!report?.id" @click="openVersions" v-hasPermi="['qlzg:report:query']">
          <Icon icon="ep:clock" class="mr-5px" /> 历史版本与红标
        </el-button>
        <!--
          🔴 OFF 档下这个入口是**隐藏**，不是置灰（§11.9.2.6 第 8 条）：
             OFF 的语义是「这个功能不在」，而一个点进去永远空白的页面比没有入口更贵。
             置灰会被理解成「功能坏了」。
             判据是 showReviewEntry：档位那一条 + 「本部署装了 review 模块」那一条，
             两条理由都写在 reviewFlow 的 reviewEntryVisibleByMode 上
        -->
        <el-button v-if="showReviewEntry" @click="openReviewWorkbench">
          <Icon icon="ep:view" class="mr-5px" /> 复核工作台
        </el-button>
        <el-button
          v-if="report?.status === 'DRAFT'"
          type="success"
          plain
          :disabled="!report?.id"
          @click="openFinalize"
          v-hasPermi="['qlzg:report:finalize']"
        >
          <Icon icon="ep:circle-check" class="mr-5px" /> 定稿
        </el-button>
        <!--
          🔴 措辞是「退回修订」，不是「撤销定稿」：这一条边**不**再写一行版本快照、
             **不**清 finalizedAt、**不**清 currentVersionId。已定稿的那一版是法定档案，
             退回修订只是让当前草稿可写。说成「撤销定稿」是在宣称系统做了一件它没做的事
        -->
        <el-button
          v-if="report?.status === 'FINALIZED'"
          type="warning"
          plain
          @click="reopen"
          v-hasPermi="['qlzg:report:finalize']"
        >
          <Icon icon="ep:refresh-left" class="mr-5px" /> 退回修订
        </el-button>
        <el-button
          v-if="report?.status !== 'VOIDED'"
          type="danger"
          plain
          @click="openVoid"
          v-hasPermi="['qlzg:report:void']"
        >
          <Icon icon="ep:circle-close" class="mr-5px" /> 作废
        </el-button>
        <el-button :loading="loading" @click="reloadAll">
          <Icon icon="ep:refresh" class="mr-5px" /> 刷新
        </el-button>
        <el-button @click="goBack"> <Icon icon="ep:back" class="mr-5px" /> 回报告台账 </el-button>
      </div>
    </template>

    <el-alert v-if="!reportId" type="warning" :closable="false" show-icon class="mb-12px">
      <template #title>这一页要从报告台账进来</template>
      <div>作业台的入参只有一个报告编号。请到「报告台账」，在某一行的操作里点「作业台」。</div>
    </el-alert>

    <template v-if="reportId">
      <el-alert
        v-if="loadError"
        type="error"
        :closable="false"
        show-icon
        :title="loadError"
        class="mb-12px"
      />

      <el-descriptions v-if="report" :column="4" border size="small" class="mb-12px">
        <el-descriptions-item label="报告号">{{ report.reportNo }}</el-descriptions-item>
        <el-descriptions-item label="标题">
          {{ reportTitleOf(report, report.reportTypeDescription) }}
        </el-descriptions-item>
        <el-descriptions-item label="状态">
          <el-tag :type="reportStatusTagType(report.status)" size="small">
            {{ report.statusDescription || labelOf(REPORT_STATUS_OPTIONS, report.status) }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="本报告版本"
          >第 {{ report.versionNo ?? 1 }} 版</el-descriptions-item
        >
        <el-descriptions-item label="成稿">
          <el-tag :type="composeStateTagType(report)" size="small">
            {{ composeStateText(report) }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="残留占位符">
          <span :class="(report.placeholderRemaining ?? 0) > 0 ? 'warn-text' : ''">
            {{ placeholderRemainingText(report) }}
          </span>
        </el-descriptions-item>
        <!--
          🔴 与「残留占位符」**分成两格**，也分成两条黄条，理由写在 reportFlow 的
             valueMissingText 上：两个数都表现为「定不了稿」，而出路完全相反
             （一个是改模板、一个是填值）。合成一格的话用户会去改模板，
             改完发现数没动，然后认为这个工具坏了
        -->
        <el-descriptions-item label="缺值格子">
          <span :class="(report.valueMissingCount ?? 0) > 0 ? 'warn-text' : ''">
            {{ valueMissingText(report) }}
          </span>
        </el-descriptions-item>
        <el-descriptions-item label="作业档位">
          {{ labelOf(WORK_MODE_OPTIONS, report.mode) || report.mode || '—' }}
        </el-descriptions-item>
        <el-descriptions-item label="token 成本">
          <span class="mono">{{ tokenCostText(report.tokenCost) }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="复核档位（创建时定）">
          {{
            labelOf(REVIEW_MODE_OPTIONS, report.reviewModeEffective) ||
            report.reviewModeEffective ||
            '—'
          }}
        </el-descriptions-item>
        <el-descriptions-item label="机器复核">
          <!--
            🔴 这一格的存在理由是**横条的缺席是 ambiguous 的**：
               没有黄条既可能是「从来没跑过」，也可能是「跑完了、清零了」。
               两者对评估师的意义相反（前者是「还没查」，后者是「查过了」），
               而界面上此前没有任何一处区分它们 —— 只有点进定稿弹层才看得见。
               判据与文案都在 reviewFlow#unwaivedBlockTextOf，与定稿弹层**共用一份**；
               本组件再叠一层「这次请求失败了」，见 reviewStateText
          -->
          {{ reviewStateText }}
        </el-descriptions-item>
        <el-descriptions-item label="定稿时间">
          {{ report.finalizedAt ? formatDate(report.finalizedAt) : '—' }}
        </el-descriptions-item>
        <el-descriptions-item label="模板版本编号">
          {{ report.templateVersionId ?? '—' }}
        </el-descriptions-item>
        <el-descriptions-item v-if="report.status === 'VOIDED'" label="作废">
          {{ voidedByText(report)
          }}<span v-if="report.voidReason">　理由：{{ report.voidReason }}</span>
        </el-descriptions-item>
      </el-descriptions>

      <!--
        🔴 editable 由服务端落定，前端**不要**自己按 status 再判一次。
           自己判的后果是「按钮亮着、点下去报错」，而一个只会报错的按钮
           比没有按钮更让人怀疑工具
      -->
      <el-alert v-if="report && !editable" type="info" :closable="false" show-icon class="mb-12px">
        <template #title>这一份现在是只读的</template>
        <div>
          <span v-if="report.status === 'FINALIZED'">
            已定稿。要改就先点「退回修订」—— 退回之后当前草稿重新可写，
            而定稿的那一版仍留在档案里，不会被撤回。
          </span>
          <span v-else-if="report.status === 'VOIDED'">
            已作废。作废是终态，不能改也不能重新定稿；要出一份新的请回台账新建。
          </span>
          <span v-else>服务端判定这一份现在不可写。</span>
        </div>
      </el-alert>

      <el-alert
        v-if="composeState(report) === 'STALE'"
        type="warning"
        :closable="false"
        show-icon
        class="mb-12px"
      >
        <template #title>请重新成文</template>
        <div>
          成过文，但之后又改过字段值 —— 报告目录下那份 Word 里是<b>改之前</b>的值。
          两份文件在纸面上长得一模一样，只有逐字比对才发现某一格是旧数，
          所以交出去之前必须重新成文一次。
        </div>
      </el-alert>

      <!--
        🔴 灰条（§11.9.2.6 第 4 条）：OFF 档下**常驻**，而且必须写出「谁在什么时候关的」。
           判据里含**档位**这一项，不只是运行状态 —— 一份 OFF 档的 DRAFT 在第一次点定稿之前
           压根没有复核运行头，只按 runStatus 判的话这里什么都不显示，
           而「三个月后没人记得这台机构关过什么」恰好在最该被拦住的那一刻成立
      -->
      <el-alert v-if="reviewBar === 'GREY'" type="info" :closable="false" show-icon class="mb-12px">
        <template #title>这一份的机器复核是关闭的</template>
        <div class="banner-body">
          <template v-if="latestReview?.runStatus === 'SKIPPED'">
            最近一次定稿<b>一条规则都没跑</b>，只落下了一行「跳过」的档案。
          </template>
          <template v-else> 这一份还没有被复核过 —— 档位是关闭的，定稿时也不会跑。 </template>
          <template v-if="offWaiver">
            <br />
            由 <b>{{ offWaiver.waivedByNickname || '（查不到用户）' }}</b>
            <template v-if="offWaiver.waivedByRole">（{{ offWaiver.waivedByRole }}）</template>
            于 {{ formatDate(offWaiver.createTime) }} 决定，理由摘要：
            {{ waiverReasonSummary(offWaiver.reason) }}
          </template>
          <template v-else>
            <br />
            查不到授权这一档的留痕。定稿那一刻会被硬闸拦下（后端那句原文会说明），
            出路是把档位改回来 —— 机构级入口在「系统管理 → 机构内控配置」。
          </template>
          <!--
            🔴 hasAny 为假时这个链接**整个不出现**：点进去是三个空面板，
               而旁边的灰条写着「机器复核是关闭的」，两处对不上的表现是用户以为界面在胡说
          -->
          <el-button
            v-if="waiverChain?.hasAny"
            link
            type="primary"
            size="small"
            @click="chainDrawerRef?.open(chainQuery)"
          >
            查看变更记录
          </el-button>
        </div>
      </el-alert>

      <!--
        🔴 黄条（§11.9.2.6 第 3 条）：**不是关了就看不见**。
           看不见 = 评估师失去了自查工具，那才是真的质量下降。
           条上那个整数读的是后端现算的 blockCountUnwaived，前端不自己数明细 ——
           遇到一条坏豁免（waived=1 而理由是空的）时会差 1，而两处都不报错
      -->
      <el-alert
        v-else-if="reviewBar === 'YELLOW'"
        type="warning"
        :closable="false"
        show-icon
        class="mb-12px"
      >
        <template #title>
          当前报告有 {{ unwaivedBlockCountOf(latestReview) }} 条 BLOCK 未清零
        </template>
        <div class="banner-body">
          <template v-if="report?.reviewModeEffective === 'ADVISORY'">
            本机构已关闭机器复核<b>拦截</b>：规则照跑、结论照存，只是不再挡住定稿。
            签字人将对此承担责任。
          </template>
          <template v-else>
            清零之前定不了稿。逐条豁免由技术负责人在复核工作台上做，
            且<b>豁免之后要再定稿一次才生效</b>。
          </template>
          <el-button
            v-if="showReviewEntry"
            link
            type="primary"
            size="small"
            @click="openReviewWorkbench"
          >
            查看清单
          </el-button>
        </div>
      </el-alert>

      <!--
        🔴 红条：上一次复核**没跑完**（有规则求值失败）。
           2026-11-03 补的 —— 在此之前这种运行落到「一条横条都没有」，
           与「跑完了、也清零了」在报告页上长得一模一样，而定稿弹层那一格还写着「0 条」。
           求值失败的那几条既不算通过也不算命中，所以「没有黄条」在这里**不代表**任何好消息。
           当天那次「全系统一份报告也定不了稿」（装载器少供 2 个事实、48 条全部求值失败）
           在报告页上就是干净的 —— 那正是本条要防的事
      -->
      <el-alert
        v-else-if="reviewBar === 'INCOMPLETE'"
        type="error"
        :closable="false"
        show-icon
        class="mb-12px"
      >
        <template #title>上一次机器复核没跑完，结论未知</template>
        <div class="banner-body">
          有规则在求值时出错了。那几条<b>既不算通过、也不算命中</b>，
          所以这一页上没有黄条<b>不代表</b>「查过了没问题」——
          定稿会被闸 C 拦下，后端那句原文会写出错了几条。
          出路是到复核工作台上展开那几行灰色问号看原因：
          多半是规则的表达式引用了一个这份报告供不上的事实，或者报告里少了一格数据。
          <el-button
            v-if="showReviewEntry"
            link
            type="primary"
            size="small"
            @click="openReviewWorkbench"
          >
            查看清单
          </el-button>
        </div>
      </el-alert>

      <el-row :gutter="12">
        <el-col :span="5">
          <div class="col-box">
            <div class="col-title">章节</div>
            <el-scrollbar height="560px">
              <div
                v-for="node in sectionNodes"
                :key="node.key"
                class="sec-row"
                :class="{ 'sec-active': node.key === currentKey }"
                @click="currentKey = node.key"
              >
                <div class="sec-label">
                  {{ sectionIndent(node.level) }}{{ node.sectionTitle || node.sectionCode }}
                </div>
                <div class="sec-meta">
                  <span v-if="node.clauseRef" class="sec-clause">{{ node.clauseRef }}</span>
                  <span
                    >{{ filledOf(node.id) }}/{{ node.fieldCount ?? filledOf(node.id) }} 格已填</span
                  >
                </div>
              </div>
              <div
                v-if="orphanCount > 0"
                class="sec-row"
                :class="{ 'sec-active': currentKey === ORPHAN_SECTION_KEY }"
                @click="currentKey = ORPHAN_SECTION_KEY"
              >
                <div class="sec-label">页眉与首页（不属于任何一节）</div>
                <div class="sec-meta">
                  <span>{{ filledOf(null) }}/{{ orphanCount }} 格已填</span>
                </div>
              </div>
              <el-empty
                v-if="sectionNodes.length === 0 && orphanCount === 0"
                description="这一份报告还没有章节"
                :image-size="60"
              />
            </el-scrollbar>
          </div>
        </el-col>

        <el-col :span="12">
          <div class="col-box">
            <div class="col-title">
              <span>{{ currentTitle }}</span>
              <el-button
                link
                type="primary"
                :disabled="!editable"
                @click="fillFromTemplate"
                v-hasPermi="['qlzg:report:update']"
              >
                <Icon icon="ep:magic-stick" class="mr-3px" /> 按模板补齐待填格
              </el-button>
              <el-button
                link
                type="primary"
                :disabled="!editable"
                @click="addRow"
                v-hasPermi="['qlzg:report:update']"
              >
                <Icon icon="ep:plus" class="mr-3px" /> 新增一格
              </el-button>
            </div>
            <div v-if="currentSection" class="col-sub">
              <span v-if="currentSection.sectionCode" class="sec-clause">
                章节码 {{ currentSection.sectionCode }}
              </span>
              <span v-if="currentSection.contentMode" class="sec-clause">
                本节内容来源：{{
                  labelOf(SECTION_CONTENT_MODE_OPTIONS, currentSection.contentMode) ||
                  currentSection.contentMode
                }}
              </span>
            </div>

            <el-scrollbar height="520px">
              <el-table :data="tableRows" size="small" stripe>
                <el-table-column label="字段" width="170">
                  <template #default="scope">
                    <div class="field-label">
                      {{
                        scope.row.draft.fieldKey
                          ? fieldLabelOf(scope.row.draft.fieldKey)
                          : '（新增）'
                      }}
                    </div>
                    <div class="field-key">{{ scope.row.draft.fieldKey || '请选一个字段键' }}</div>
                  </template>
                </el-table-column>

                <el-table-column label="值" min-width="220">
                  <template #default="scope">
                    <el-date-picker
                      v-if="scope.row.draft.fieldKind === 'DATE'"
                      v-model="scope.row.draft.date"
                      type="date"
                      value-format="YYYY-MM-DD"
                      placeholder="选择日期"
                      :disabled="!editable"
                      class="!w-full"
                    />
                    <el-input-number
                      v-else-if="isNumericKind(scope.row.draft.fieldKind)"
                      v-model="scope.row.draft.num"
                      :controls="false"
                      :disabled="!editable"
                      class="!w-full"
                    />
                    <el-input
                      v-else
                      v-model="scope.row.draft.text"
                      type="textarea"
                      :autosize="{ minRows: 1, maxRows: 6 }"
                      :disabled="!editable"
                      placeholder="请输入"
                    />
                    <div v-if="scope.row.isNew" class="field-picker">
                      <el-select
                        v-model="scope.row.draft.fieldKey"
                        filterable
                        allow-create
                        default-first-option
                        size="small"
                        placeholder="字段键"
                        class="w-full"
                      >
                        <el-option
                          v-for="opt in fieldKeyOptions"
                          :key="opt.key"
                          :label="`${opt.label}（${opt.key}）`"
                          :value="opt.key"
                        />
                      </el-select>
                      <el-select
                        v-model="scope.row.draft.fieldKind"
                        size="small"
                        placeholder="种类"
                        class="w-full mt-4px"
                      >
                        <el-option
                          v-for="opt in FIELD_KIND_OPTIONS"
                          :key="opt.value"
                          :label="opt.label"
                          :value="opt.value"
                        />
                      </el-select>
                    </div>
                  </template>
                </el-table-column>

                <el-table-column label="成文时印出来的" width="170">
                  <template #default="scope">
                    <!--
                      🔴 rendered 是**服务端格式化后**的显示值，含单位。
                         前端不要自己拼：自己拼的话「万元」「%」「㎡」会与品类
                         param_schema 里配的漂开，而报告纸面上印的是拼出来的那一个
                      🔴 这一格**整个可点**，而且**不按 provenanceId 判能不能点**：
                         那一列是「这一格的主出处」，可空；而一格可以在它之外**另挂**
                         若干行（资料原文依据走 /field/attach-material 追加，压根不碰它）。
                         按主出处判可点，验收 D8 那十次点击里就会有几次弹不出来 ——
                         而那一条的判据写的正是「10 个全部弹出溯源层」
                    -->
                    <el-button
                      v-if="scope.row.row?.id"
                      link
                      type="primary"
                      @click="openProvenance(scope.row.row)"
                    >
                      {{ scope.row.row?.rendered || '（这一格还没有值）' }}
                    </el-button>
                    <span v-else class="form-hint">（还没保存过）</span>
                  </template>
                </el-table-column>

                <el-table-column label="来源" width="90" align="center">
                  <template #default="scope">
                    <el-tag size="small" effect="plain">
                      {{
                        labelOf(FIELD_SOURCE_TYPE_OPTIONS, scope.row.row?.sourceType) ||
                        (scope.row.isNew ? '人工录入' : '—')
                      }}
                    </el-tag>
                  </template>
                </el-table-column>

                <el-table-column label="红标" width="130" align="center">
                  <template #default="scope">
                    <template v-if="scope.row.row?.isMarked">
                      <el-tag v-if="scope.row.row?.isConfirmed" size="small" type="success">
                        已确认
                      </el-tag>
                      <el-button
                        v-else
                        link
                        type="danger"
                        :disabled="!editable"
                        @click="confirmOne(scope.row.row)"
                        v-hasPermi="['qlzg:report:update']"
                      >
                        待确认，点我认
                      </el-button>
                    </template>
                    <span v-else class="form-hint">—</span>
                  </template>
                </el-table-column>

                <el-table-column label="操作" width="200" align="center" fixed="right">
                  <template #default="scope">
                    <el-button
                      link
                      type="primary"
                      :disabled="!editable || !rowChanged(scope.row)"
                      @click="saveOne(scope.row)"
                      v-hasPermi="['qlzg:report:update']"
                    >
                      保存
                    </el-button>
                    <el-button v-if="scope.row.isNew" link @click="dropRow(scope.row.key)">
                      删掉
                    </el-button>
                    <el-button
                      v-else
                      link
                      :disabled="!rowChanged(scope.row)"
                      @click="resetRow(scope.row)"
                    >
                      还原
                    </el-button>
                    <!--
                      🔴 只给**已存在的行**：挂依据的入参是 fieldId，而新增行此刻
                         在库里还没有那一行（后端会回「报告字段不存在」）。
                         「先保存、再挂依据」这个顺序由按钮的缺席自己说明，
                         不靠一句提示
                    -->
                    <el-button
                      v-if="!scope.row.isNew"
                      link
                      type="primary"
                      :disabled="!editable"
                      @click="openParagraphPicker(scope.row)"
                      v-hasPermi="['qlzg:report:update']"
                    >
                      挂资料依据
                    </el-button>
                  </template>
                </el-table-column>

                <template #empty>
                  <el-empty description="这一节还没有字段行" :image-size="60">
                    <div class="form-hint">
                      点右上「新增一格」自己加，或从右栏插一条话术进来。
                    </div>
                  </el-empty>
                </template>
              </el-table>
            </el-scrollbar>

            <div class="col-foot">
              <span>本节 {{ filledOf(currentSectionId) }}/{{ tableRows.length }} 格已填</span>
              <span v-if="markedLeft > 0" class="warn-text">
                全报告还有 {{ markedLeft }} 处红标没确认（定稿的第二道闸要它归零）
              </span>
              <span v-else class="form-hint">全报告的红标都已确认</span>
            </div>
          </div>
        </el-col>

        <el-col :span="7">
          <div class="col-box">
            <PhraseCandidatePanel
              :report-id="reportId"
              :section-id="currentSectionId"
              :section-code="currentSection?.sectionCode ?? null"
              :field-key-options="fieldKeyOptions"
              @inserted="onInserted"
            />
          </div>
        </el-col>
      </el-row>
    </template>
  </ContentWrap>

  <!-- 成文结果：那一段话太长，toast 装不下，而它正是「缺哪一格」的唯一线索 -->
  <Dialog v-model="composeVisible" title="成文结果" width="620">
    <el-alert :type="composeAlertType" :closable="false" show-icon>
      <template #title>{{ composeResultTitle(composeResult) }}</template>
      <div class="dialog-hint">{{ composeResultBody }}</div>
    </el-alert>
    <template #footer>
      <el-button type="primary" @click="download">下载这一份</el-button>
      <el-button @click="composeVisible = false">关 闭</el-button>
    </template>
  </Dialog>

  <Dialog v-model="finalizeVisible" title="定稿" width="620">
    <el-alert type="warning" :closable="false" show-icon class="mb-12px">
      <template #title>定稿之前，后端会依次过几道闸</template>
      <div class="dialog-hint">
        <!--
          🔴 这个顺序是**抄**后端 QlzgReportServiceImpl#finalizeReport 的，
             抄它的理由是「一次只会报一件事」这句话只有在顺序对的时候才有用：
             顺序写歪的产物是他先补完 12 个占位符、再被拦一次说「你还没成文」，
             每拦一次都要重新读一遍报错、重新找一遍按钮。
             🔴 花括号与缺值格子是**两道分开的闸、报两个数**，不合成一个：
             合成之后报错会指着「去搜花括号」，而这份报告一个花括号都没有 ——
             评估师搜不到就会认为平台在胡说，进而要求关掉这道闸
             🔴 「缺值格子」与「数字有没有出处」同样是**两道分开的闸**，
                而且顺序是缺值在前：一格还没填值的时候它必然也没有溯源，
                先报溯源的话他会去「挂依据」，而那一格压根没有值可挂 —— 白跑一个来回
             🔴 下面那段可见文案里**刻意不写条数**（不写「前五道」「后两道」）：
                分组由括号里那串箭头自己界定，加一道闸时只需要往括号里添一项。
                写过条数的版本在 I6-a 加了「数字都有出处」之后就错了整整一个迭代，
                而它是**界面上的字**，编译期、类型检查、单测一个都发现不了
        -->
        顺序是「你当场能改」的先后。 <b>出稿这几道</b>（还没成文 → 成稿是旧的 → 花括号残留 →
        缺值格子 → 数字都有出处）与复核档位无关，三档都拦； <b>复核这几道</b>（红标全部确认 →
        复核 BLOCK 未清零）在「关闭 / 提示」档下不再拦人。 这里不预先替你判断能不能定稿 ——
        前端抄一份判据去禁用按钮，迟早会与后端漂开。
      </div>
    </el-alert>
    <el-descriptions :column="2" border size="small" class="mb-12px">
      <el-descriptions-item label="定稿后是第几版"
        >第 {{ report?.versionNo ?? 1 }} 版</el-descriptions-item
      >
      <el-descriptions-item label="成稿">{{ composeStateText(report) }}</el-descriptions-item>
      <el-descriptions-item label="残留占位符">
        {{ placeholderRemainingText(report) }}
      </el-descriptions-item>
      <el-descriptions-item label="缺值格子">{{ valueMissingText(report) }}</el-descriptions-item>
      <el-descriptions-item label="待确认红标">{{ markedLeft }} 处</el-descriptions-item>
      <el-descriptions-item label="未清零 BLOCK">
        {{ reviewStateText }}
      </el-descriptions-item>
    </el-descriptions>
    <el-form label-width="110px">
      <el-form-item :label="summaryLabel" :required="summaryRequired">
        <el-input
          v-model="changeSummary"
          type="textarea"
          :rows="3"
          maxlength="500"
          show-word-limit
          :placeholder="
            summaryRequired
              ? '必填：这一版改了什么。它进版本行，是 30 年后翻档案时唯一的答案'
              : '第 1 版可以留空'
          "
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button type="primary" :loading="finalizing" @click="submitFinalize">确认定稿</el-button>
      <el-button @click="finalizeVisible = false">取 消</el-button>
    </template>
  </Dialog>

  <Dialog v-model="voidVisible" title="作废这份报告" width="560">
    <el-alert type="error" :closable="false" show-icon class="mb-12px">
      <template #title>作废是终态，而且报告号不会被复用</template>
      <div class="dialog-hint">
        报告号的唯一性查全库、<b>含已作废的</b>，所以这一个号从此就不再出现在任何新报告上。
        已定稿的报告作废后仍然是档案，只是不能再用它出交付物。理由会一直留在这份报告上。
      </div>
    </el-alert>
    <el-form label-width="90px">
      <el-form-item label="作废理由" required>
        <el-input
          v-model="voidReason"
          type="textarea"
          :rows="3"
          maxlength="500"
          show-word-limit
          placeholder="必填。例如：委托方撤项 / 标的信息有误需重新立项 / 模板选错交付物类型"
        />
        <!--
          🔴 这里刻意**不给**默认值，也不给「无」这样的快捷选项：
             一个所有人都填「无」的必填项等于没有这一项，
             而 30 年后翻档案的人要能回答「这一份为什么作废」
        -->
        <div class="form-hint">没有默认值，也不会替你填。</div>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button
        type="danger"
        :loading="voiding"
        :disabled="!voidReason.trim()"
        @click="submitVoid"
      >
        确认作废
      </el-button>
      <el-button @click="voidVisible = false">取 消</el-button>
    </template>
  </Dialog>

  <WaiverChainDrawer ref="chainDrawerRef" />

  <!--
    溯源弹层：验收 D8 的「随机点 10 个数字」全落在这一个组件上。
    🔴 它**不读任何退化形态开关** —— 溯源属于 core 组，四种形态下都在（D8 判据⑤）
  -->
  <ProvenanceDrawer ref="provenanceDrawerRef" />
  <!--
    历史版本与红标（§11.11.3）。
    🔴 它同样**不读任何退化形态开关**：版本行是定稿那一刻写的，
       而定稿在四种形态下都在 —— 关掉工作流不等于关掉法定档案的版本历史
  -->
  <VersionDiffDrawer ref="versionDiffDrawerRef" />
  <MaterialParagraphPicker ref="paragraphPickerRef" @success="onEvidenceAttached" />
</template>
<script lang="ts" setup>
import { formatDate } from '@/utils/formatTime'
import {
  QlzgCategoryApi,
  mergeSectionFieldKeys,
  templateFieldKeyOptionsOf,
  type QlzgCategorySectionVO,
  type QlzgCategoryVO
} from '@/api/qlzg/category'
import { QlzgTemplateApi } from '@/api/qlzg/template'
import {
  QlzgReportApi,
  type QlzgReportComposeVO,
  type QlzgReportFieldPendingVO,
  type QlzgReportFieldVO,
  type QlzgReportSectionVO,
  type QlzgReportVO
} from '@/api/qlzg/report'
import { QlzgReviewRunApi, type QlzgReviewVO } from '@/api/qlzg/reviewRun'
import { QlzgReviewConfigApi, type QlzgReviewWaiverChainVO } from '@/api/qlzg/reviewConfig'
// 🔴 退化形态（REPORT_ONLY / REPORT_SIGN）下 review 模块压根没装，那两个端点的 Controller
//    也不在容器里。这里要的是「没装」这个事实，而它只能问后端 —— 菜单树是过滤后才发下来的，
//    少掉的那几项在前端从来不存在过。走共享快照，与台账上那条横幅共用一次请求
import { isInstalled, loadModuleForm } from '@/views/qlzg/moduleForm'
import {
  FIELD_KIND_OPTIONS,
  FIELD_SOURCE_TYPE_OPTIONS,
  REPORT_STATUS_OPTIONS,
  REVIEW_MODE_OPTIONS,
  SECTION_CONTENT_MODE_OPTIONS,
  WORK_MODE_OPTIONS,
  labelOf,
  reportStatusTagType
} from '@/views/qlzg/constants'
import {
  ORPHAN_SECTION_KEY,
  TEMPLATE_PENDING_PREFIX,
  buildSectionTree,
  composeButtonLabel,
  composeResultText,
  composeResultTitle,
  composeState,
  composeStateTagType,
  composeStateText,
  draftChanged,
  draftOf,
  blankDraft,
  changeSummaryRequired,
  composeHasIssue,
  fieldsOfSection,
  flattenSections,
  groupFieldsBySection,
  hasValue,
  isNumericKind,
  markedUnconfirmedCount,
  mergeTemplatePending,
  payloadOf,
  placeholderRemainingText,
  reportTitleOf,
  sectionIndent,
  templatePendingKey,
  tokenCostText,
  valueMissingText,
  voidedByText,
  type FieldDraft,
  type PendingRow
} from './reportFlow'
import {
  effectiveOffWaiverOf,
  reportReviewBarOf,
  reviewEntryVisibleByMode,
  unwaivedBlockCountOf,
  unwaivedBlockTextOf,
  waiverReasonSummary
} from '../review/reviewFlow'
import PhraseCandidatePanel from './PhraseCandidatePanel.vue'
import WaiverChainDrawer from '../review/WaiverChainDrawer.vue'
import ProvenanceDrawer from '@/views/qlzg/components/ProvenanceDrawer.vue'
import VersionDiffDrawer from '@/views/qlzg/components/VersionDiffDrawer.vue'
import MaterialParagraphPicker from '@/views/qlzg/components/MaterialParagraphPicker.vue'

/**
 * 报告作业台 —— 三栏：章节 / 字段行 / 话术候选
 *
 * <h3>🔴 这一页是 `remaining.ts` 里的静态路由，不是菜单</h3>
 * 它与报告台账是**兄弟**、共用 `qlzg:report` 一个权限族，而塌缩之后整个族只有**一行**
 * `sys_resource`、只有**一个** `menu_id` —— 承载行指向谁，另一个就从非超管的
 * 导航集合里消失（案例台账与案例召回已经栽过一次，全程 200、无一条报错）。
 * 台账带按钮子菜单，所以台账当菜单，这一页走静态路由 + `activeMenu` 回指台账。
 *
 * <h3>🔴 这里**不预先判断能不能定稿**</h3>
 * 那几道闸的**顺序**是产品决定（按「评估师当场能改」的先后排，于是一次报错只指向一件事）。
 * 前端抄一份判据去禁用按钮，顺序迟早会与后端漂开 —— 漂开之后他会先补完 12 个占位符、
 * 再被拦一次说「你还没成文」，每拦一次都要重新读一遍报错、重新找一遍按钮。
 * 所以：把数字**显示**出来（他点之前就知道差几格），但按钮一律可点，报错原文照抄。
 *
 * <h3>🔴 字段行**不给**「改来源」的下拉</h3>
 * 后端 `updateField` 对 `source_type` / `source_ref_id` / `provenance_id` 三列
 * 也是无条件 set。给一个没有「选哪一次测算」配套的下拉，产出的是一批
 * `source_type = CALC` 而 `source_ref_id IS NULL` 的行 —— 溯源那一栏空着，
 * 而复核规则 R36「有依据」照样判它有依据。来源是「谁写的这一格」这个事实，
 * 不该由改值的人重新宣称。新增的一格一律是人工录入。
 *
 * <h3>🔴 也**不给**排序与占位符的编辑</h3>
 * 那两列不动值，所以后端不会因它们复位确认状态；但浏览器里 `valueNum` 的定标
 * 已经丢了（`1200.00` 经 JSON 变成 `1200`，而 `BigDecimal.equals` **比定标**），
 * 一次「只改排序」的保存会被判成「值变了」，把已确认的红标打回未确认。
 * 这不是能修的（前端拿不到原文），只能不发：`draftChanged` 判没变就不调接口，
 * 而界面干脆不提供那两个只改元数据的入口。
 *
 * <h3>🔴 「成文时印出来的」那一格**整个可点**，它就是溯源弹层的入口</h3>
 * 验收 D8 判据①写的是「在报告正文里随机点 10 个数字，10 个**全部**弹出溯源层」。
 * 作业台是评估师唯一逐格看见 `rendered` 的地方，所以这一格必须能点、
 * 且**不按 `provenanceId` 判能不能点**（那一列是「主出处」、可空，
 * 而另挂的资料依据压根不碰它）—— 详见 {@link openProvenance}
 *
 * <h3>⚠️ 成文是重活，按钮必须禁用并显示进行中</h3>
 * 四十页的 docx 渲染 + 上传要几秒。不做禁用的话评估师会连点，
 * 而每一次点击都是一份新的孤儿字节（`FileApi` 没有删除方法，归 I6）。
 */
defineOptions({ name: 'QlzgReportWorkbench' })

const route = useRoute()
const router = useRouter()
const message = useMessage()

// 🔴 形态快照**立刻**开始取，不等 reloadAll：头部那一排按钮在报告还没回来时就已经渲染了，
//    晚一步取的产出是「REPORT_ONLY 下先看见一个『复核工作台』、几十毫秒后它自己消失」。
//    刻意不 await —— 它失败得起（isInstalled 取不到形态一律答 true），
//    而报告那三个请求才是这一页的主体，不该被它拖住
loadModuleForm()

const reportId = computed(() => {
  const raw = route.query.reportId
  const text = Array.isArray(raw) ? raw[0] : raw
  const parsed = Number(text)
  // 🔴 `Number('')` 是 0、`Number(undefined)` 是 NaN，
  //    0 会被当成一个合法的报告编号发出去，后端回「报告不存在」，
  //    用户看到的结论就成了「作业台坏了」
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
})

const loading = ref(false)
const loadError = ref('')
const report = ref<QlzgReportVO | null>(null)
const sections = ref<QlzgReportSectionVO[]>([])
const fields = ref<QlzgReportFieldVO[]>([])
const category = ref<QlzgCategoryVO | null>(null)
const categorySections = ref<QlzgCategorySectionVO[]>([])

/** 可写与否**只**读服务端那一列 */
const editable = computed(() => report.value?.editable === true)

// ==================== 复核：红条 / 黄条 / 灰条 ====================

/**
 * 报告页顶部那条常驻横条的数据
 *
 * <h3>🔴 读的是 {@code /latest}，**不是** {@code /workbench}</h3>
 * 黄条每打开一次报告就读一次，而工作台那个端点要取回全部明细行
 * 连同每一行的 {@code hit_detail}（一段任意 JSON），它要显示的却只是一个整数。
 * 两个端点分开存在的全部理由就是这一句调用频率
 *
 * <h3>🔴 {@code /latest} 返回 **null** 表示「这份报告从来没被复核过」</h3>
 * 此时一条横条都不显示。一条写着「0 条问题」的黄条会被读成
 * 「查过了，没问题」，而真相是一行都没查
 *
 * <h3>🔴 它**失败得起**，与品类那一步同一条纪律</h3>
 * 横条是提示，不是作业台能不能用的前提。拿不到就当「从来没被复核过」处理，
 * 已经读到的报告与字段行一律保留 —— 为了一个旁路请求把整页打回加载失败，
 * 代价是评估师手上正在填的东西。
 * ⚠️ 但那一格「机器复核」**不许**跟着这么说，见 {@link reviewStateText}：
 *    横条的缺席读起来是「没有坏消息」，一句写出来的「还没被复核过」读起来是一个事实
 */
const latestReview = ref<QlzgReviewVO | null>(null)
/**
 * 本部署压根**没装** review 模块（{@code REPORT_ONLY} / {@code REPORT_SIGN} 形态）
 *
 * <p>它与 {@link reviewLoadFailed} 是**三种**不同处境的第二种，界面上必须分开说：
 * 「装了、这次没读到」（刷新有用）、「没装」（刷新永远没用）、
 * 「装了、读到了 null」（这份报告从来没被复核过）。
 * 把「没装」并进「没读到」的产出是一句谎话 ——
 * 格子写着「读不到这一份的复核档案（点刷新重试）」，用户点了刷新，
 * 每次都是一条 404 的报错弹窗，而那份档案永远不会出现。
 * 更要紧的是它还掩盖了一件法律上有意义的事：这个部署没有机器复核
 *
 * <p>判据取自 {@code @/views/qlzg/moduleForm} 那份共享快照，**不在这里自己发请求**，
 * 理由写在那个文件头上（两处各取一次 ⟹ 同一会话里可以有两份不一致的答案）
 *
 * <p>⚠️ 它是 **computed** 而不是一个由 {@link loadReview} 赋值的 ref：
 * 快照是模块级 ref，别的组件（台账上那条横幅）可能比本页先把它取回来，
 * 而头部那个「复核工作台」按钮在 {@code reloadAll} 跑完之前就已经渲染了 ——
 * 写成 ref 的话那一刻它恒为初值 false，按钮会先出现、再消失（REPORT_ONLY 下）。
 * computed 跟着快照自己翻，不需要谁来记得赋值
 */
const reviewNotInstalled = computed(() => !isInstalled('review'))
/** {@code /latest} 这一次**没读到**（与「读到了、值是 null」是两件事，见 {@link reviewStateText}） */
const reviewLoadFailed = ref(false)
/** 只在 OFF 档时才去读，理由见 {@link loadWaiverChain} */
const waiverChain = ref<QlzgReviewWaiverChainVO | null>(null)
const chainDrawerRef = ref<InstanceType<typeof WaiverChainDrawer>>()

const reviewBar = computed(() =>
  reportReviewBarOf(report.value?.reviewModeEffective, latestReview.value)
)

/**
 * 「机器复核」那一格说什么
 *
 * <h3>🔴 它比 {@link unwaivedBlockTextOf} 多认一种情况：这次请求**失败了**</h3>
 * {@link latestReview} 的 catch 把它设成 null，而 null 在 {@code reviewFlow} 里的含义是
 * 「这份报告从来没被复核过」—— 那是横条可以接受的近似（少显示一条提示），
 * 但一句写在格子上的「还没被复核过」是一个**断言**，而它的真假此刻我们不知道。
 * 一份其实跑过复核、并且命中了 3 条 BLOCK 的报告，会因为一次网络抖动
 * 在这一格上写着「还没被复核过」，全程 200 无异常。
 * 所以这一格宁可说「读不到」，也不替后端回答
 */
const reviewStateText = computed(() => {
  // 🔴 「没装」排在最前面：此时那两个 ref 都是初值，
  //    先判 reviewLoadFailed 会走进下面那条「点刷新重试」的谎话里
  if (reviewNotInstalled.value) {
    return '本部署未安装机器复核模块，这一份没有复核档案（不是读不到，是压根没有这个功能）'
  }
  return reviewLoadFailed.value
    ? '读不到这一份的复核档案（点「刷新」重试）'
    : unwaivedBlockTextOf(latestReview.value)
})

/** 灰条上那个人名 / 时间 / 理由摘要取自哪一行；null 时如实说「查不到授权这一档的留痕」 */
const offWaiver = computed(() => effectiveOffWaiverOf(waiverChain.value))

/**
 * 「复核工作台」这个入口**到底出不出现**
 *
 * <p>两个条件都在 {@code reviewFlow#reviewEntryVisibleByMode} 里，理由也写在那儿
 * （档位不是 OFF；本部署装了 review 模块）。这里只负责把第二个条件的实参接上：
 * {@link reviewNotInstalled} 取自 {@code @/views/qlzg/moduleForm} 那份共享快照，
 * **不在本页自己发请求**
 *
 * <p>⚠️ 名字刻意**不叫** {@code reviewEntryVisible}：那是 {@code reviewFlow} 里
 * 另一个纯函数的名字（判据是 {@code /workbench} 那一列 {@code workbenchVisible}，
 * 给复核工作台自己用）。同名会让下一个人在导入清单里找它，而本页没有导入它
 */
const showReviewEntry = computed(() =>
  reviewEntryVisibleByMode(report.value?.reviewModeEffective, !reviewNotInstalled.value)
)

const chainQuery = computed(() => ({
  reportId: report.value?.id ?? undefined,
  projectId: report.value?.projectId ?? undefined
}))

const loadReview = async (id: number) => {
  // 🔴 没装 review 模块时**一次请求都不发**，而不是发了再 catch：
  //    那两个端点的 Controller 在退化形态下压根不存在，请求拿回来的是
  //    一条 code=404「请求地址不存在」的业务错误体（本仓所有错误的 HTTP 状态码都是 200），
  //    而 axios 拦截器会为它弹一条报错 ——
  //    用户每打开一份报告就被弹一次，那条弹窗说的还是一件他无法处置的事。
  //    catch 得住 promise，catch 不住已经弹出去的那个 toast
  // ⚠️ loadModuleForm() 带缓存，同一个会话里只有第一次真发请求；
  //    取回来之后 reviewNotInstalled 这个 computed 自己就翻了，不需要在这里赋值
  await loadModuleForm()
  if (reviewNotInstalled.value) {
    latestReview.value = null
    waiverChain.value = null
    reviewLoadFailed.value = false
    return
  }
  try {
    latestReview.value = await QlzgReviewRunApi.getLatestReview(id)
    // 🔴 「读到了、值是 null」与「没读到」在这里分开：前者是后端如实回答
    //    「这份报告从来没被复核过」，后者才是 {@link reviewLoadFailed}
    reviewLoadFailed.value = false
  } catch {
    latestReview.value = null
    reviewLoadFailed.value = true
  }
  await loadWaiverChain()
}

/**
 * OFF 档下才去读那条变更链
 *
 * 🔴 灰条要说出「谁在什么时候关的」（§11.9.2.6 第 4 条），而那个名字只在留痕表里。
 *    不在其它档位下读它，是因为一份 ENFORCE 报告的页面上根本没有需要它回答的问题 ——
 *    多一次请求就是多一次「旁路失败把页面搞脏」的机会
 * 🔴 读不到时灰条**照显示**，只是把「查不到授权这一档的留痕」如实写出来。
 *    那本身是一条有用的信息：定稿那一刻会撞 {@code REVIEW_OFF_UNTRACED}
 */
const loadWaiverChain = async () => {
  if (report.value?.reviewModeEffective !== 'OFF') {
    waiverChain.value = null
    return
  }
  try {
    waiverChain.value = await QlzgReviewConfigApi.getWaiverChain(chainQuery.value)
  } catch {
    waiverChain.value = null
  }
}

/**
 * 跳到复核工作台
 *
 * 🔴 带上 {@code projectId}：那一页的「变更本报告档位」弹层要解析
 *    「跟随项目配置」会变成哪一档，而后端没有端点给这个解析结果，
 *    只能由前端拿项目那一列自己拼（项目钉了就用项目的，没钉就落到机构的）。
 *    不带的话弹层只能如实说「这次没取到」，而那一句会让用户去刷新——刷不出来的
 * 🔴 路径与 {@code router/modules/remaining.ts} 里那条静态路由**逐字一致**：
 *    改一处的表现是点按钮停在原地（vue-router 只在控制台 warn，界面不动）
 */
const openReviewWorkbench = () => {
  if (!reportId.value) return
  const query: Record<string, string> = { reportId: String(reportId.value) }
  if (report.value?.projectId) query.projectId = String(report.value.projectId)
  router.push({ path: '/qlzg-review/workbench', query })
}

// ==================== 左栏：章节 ====================

/**
 * 左栏那一列
 *
 * 🔴 用**拍平的清单 + 缩进**，不用 el-tree：树只能渲染一个 label，
 *    而评估师在这一栏要同时看见「这一节有几格、填了几格」——
 *    那才是他决定下一步点哪一节的依据。`sectionIndent` 用全角空格，
 *    半角在 HTML 里会被折叠掉，缩进就看不出来了
 */
const sectionNodes = computed(() =>
  flattenSections(buildSectionTree(sections.value)).map((node) => ({
    id: node.id,
    parentId: node.parentId,
    sectionCode: node.sectionCode,
    sectionTitle: node.sectionTitle,
    clauseRef: node.clauseRef,
    level: node.level,
    sort: node.sort,
    contentMode: node.contentMode,
    fieldCount: node.fieldCount,
    key: String(node.id)
  }))
)

const grouped = computed(() => groupFieldsBySection(fields.value))

const orphanCount = computed(() => (grouped.value.get(ORPHAN_SECTION_KEY) ?? []).length)

const currentKey = ref<string>(ORPHAN_SECTION_KEY)

const currentSection = computed<QlzgReportSectionVO | null>(
  () => sectionNodes.value.find((node) => node.key === currentKey.value) ?? null
)

const currentSectionId = computed<number | null>(() => currentSection.value?.id ?? null)

const currentTitle = computed(() => {
  if (currentKey.value === ORPHAN_SECTION_KEY) return '页眉与首页（不属于任何一节）'
  return currentSection.value?.sectionTitle || currentSection.value?.sectionCode || '（未选定章节）'
})

const fieldsOf = (sectionId?: number | null) => fieldsOfSection(grouped.value, sectionId ?? null)

const filledOf = (sectionId?: number | null) =>
  fieldsOf(sectionId).filter((row) => hasValue(row)).length

const markedLeft = computed(() => markedUnconfirmedCount(fields.value))

// ==================== 中栏：字段行 ====================

interface TableRow {
  key: string
  /** 已存在的行；新增行是只带 `sectionId` 的半截，`payloadOf` 要的正是这一列 */
  row: QlzgReportFieldVO | null
  draft: FieldDraft
  isNew: boolean
}

/**
 * 草稿仓库
 *
 * 🔴 必须是**仓库**而不是在 computed 里现算：`draftOf(row)` 每次都造一个新对象，
 *    放进 computed 的话输入框每敲一个字都会重算、对象被换掉、光标跳走。
 *    所以载入时一次性铺开，之后 `v-model` 直接改仓库里那一个对象
 */
const draftStore = ref<Record<string, FieldDraft>>({})
const pendingStore = ref<PendingRow[]>([])
let pendingSeq = 0

/**
 * 「按模板补齐待填格」开没开
 *
 * 🔴 只有点过那一个按钮才为 true：没点过时一份待填清单都不拉，
 *    作业台的行为与此前**逐字相同**。
 * 🔴 开着之后，每次重拉字段行都跟着重拉一次清单。这不是「刷新一下」那么轻：
 *    存掉一格之后那一格必须从表上消失（服务端的判据是「这个键已经有行了」），
 *    留着的话评估师会在同一个键上再存一次 —— 建出同键第二行，
 *    而后端一个键只渲一行（取 sort 最小的那一行），他填的值**静默不渲**
 */
const templateFillOn = ref(false)

/** 被他亲手划掉的待填格。🔴 不记住的话下一次保存之后那一格会自己回来 */
const dismissedTemplateKeys = ref<Set<string>>(new Set())

const syncDrafts = () => {
  const next: Record<string, FieldDraft> = {}
  for (const row of fields.value) {
    if (row?.id === null || row?.id === undefined) continue
    next[String(row.id)] = draftOf(row)
  }
  draftStore.value = next
}

const tableRows = computed<TableRow[]>(() => {
  const out: TableRow[] = []
  for (const row of fieldsOf(currentSectionId.value)) {
    const key = String(row.id)
    const draft = draftStore.value[key]
    if (!draft) continue
    out.push({ key, row, draft, isNew: false })
  }
  for (const pending of pendingStore.value) {
    if ((pending.sectionId ?? null) !== currentSectionId.value) continue
    out.push({
      key: pending.key,
      row: { sectionId: pending.sectionId } as QlzgReportFieldVO,
      draft: pending.draft,
      isNew: true
    })
  }
  return out
})

const rowChanged = (r: TableRow) => (r.isNew ? true : draftChanged(r.row, r.draft))

const addRow = () => {
  pendingSeq += 1
  pendingStore.value.push({
    key: `pending-${pendingSeq}`,
    sectionId: currentSectionId.value,
    draft: blankDraft('', 'TEXT')
  })
}

/**
 * 「按模板补齐待填格」
 *
 * <h3>🔴 清单由**服务端**派生，前端不自己算</h3>
 * 前端手上那份候选（{@link fieldKeyOptions}）读的是**品类当前**的章节树，
 * 而报告绑的是模板**版本**、版本行不可变。两者是同一件事的两份口径，
 * 品类改一个字就会多/少一格；更要紧的是那份候选给不出「这一格属于哪一节」，
 * 评估师只能一格一格地猜 —— 猜错了服务端会按快照把它归到别的节去，
 * 于是他刚填的那一格从当前这一页上消失了（那是正确处置，但看起来像存失败）。
 *
 * <h3>🔴 它**不建空行**，只是把待填的格子铺进草稿仓库</h3>
 * 后端 {@code qlzg_report_field.source_type} 是 NOT NULL 且无默认值，
 * 那一列刻意把字段行的诞生点钉在「值被确定下来的那一刻」。
 * 所以这里铺出来的行与手工「新增一格」走**同一条**保存路径，
 * 填了值才落库；一格都不填就切走的话库里一行都不会多。
 */
const fillFromTemplate = async () => {
  if (!reportId.value) return
  try {
    const cells = (await QlzgReportApi.getPendingFieldList(reportId.value)) ?? []
    templateFillOn.value = true
    // 🔴 重新点一次 = 「再给我看一遍全清单」，此前划掉的要放回来。
    //    不放回来的话划掉一格就再也叫不回来，只能刷新整页
    dismissedTemplateKeys.value = new Set()
    pendingStore.value = mergeTemplatePending(pendingStore.value, cells)
    if (cells.length === 0) {
      message.info('模板声明的格子在这一份报告里都有行了，没有要补的')
      return
    }
    // 🔴 跳到第一个有待填格的那一节：清单是**整份报告**的，
    //    而中栏只显示最新选定那一节的行 —— 不跳的话他点了按钮、
    //    而当前这一节恰好是满的，看上去就是「什么都没发生」
    const first = cells[0]
    const node = sectionNodes.value.find((item) => item.id === first.sectionId)
    if (node) {
      currentKey.value = node.key
    }
    message.success(
      `按模板补出 ${cells.length} 格待填，已跳到「${
        node?.sectionTitle || first.sectionCode
      }」。填过值的键不再列出；不想填的那一格点「删掉」`
    )
  } catch {
    // 报错原文已由 axios 拦截器弹出
  }
}

const dropRow = (key: string) => {
  pendingStore.value = pendingStore.value.filter((item) => item.key !== key)
  // 🔴 待填格被划掉要**记住**：存任何一格都会重拉清单，
  //    不记住的话他刚划掉的那一格会在下一次保存之后自己回来。
  //    手工「新增一格」那一批（pending-N）不记 —— 它们的 key 每次都是新的，
  //    记下来只会在集合里攒垃圾
  if (key.startsWith(TEMPLATE_PENDING_PREFIX)) {
    dismissedTemplateKeys.value.add(key)
  }
}

const resetRow = (r: TableRow) => {
  if (r.row) draftStore.value[r.key] = draftOf(r.row)
}

/**
 * 字段键的中文名
 *
 * 🔴 回落顺序是「品类 param_schema 的标签 → 后端给的 label → 字段键本身」。
 *    后端 `QlzgReportFieldRespVO.label` 已经做过一次同样的回落，
 *    这里再查一次品类是为了**新增行**（它还没有 label）
 */
const fieldLabelOf = (key: string): string => {
  const hit = fieldKeyOptions.value.find((item) => item.key === key)
  return hit?.label || key
}

const fieldKeyOptions = computed(() =>
  mergeSectionFieldKeys(templateFieldKeyOptionsOf(category.value), categorySections.value)
)

// ==================== 载入 ====================

const reloadFields = async () => {
  if (!reportId.value) return
  fields.value = (await QlzgReportApi.getFieldList(reportId.value)) ?? []
  syncDrafts()
  await refreshTemplatePending()
  ensureCurrentTabStillExists()
}

/**
 * 点过「按模板补齐」之后，每次重拉字段行都跟着重拉一次待填清单
 *
 * <p>🔴 **失败得起**：待填清单是一份建议，拉不到就沿用手上那一批，
 *    填值、成文、定稿一条都不受影响 —— 与 {@link loadCategory} /
 *    {@link loadReview} 同一条纪律，整个包在自己的 try 里
 */
const refreshTemplatePending = async () => {
  if (!templateFillOn.value || !reportId.value) return
  try {
    const cells = (await QlzgReportApi.getPendingFieldList(reportId.value)) ?? []
    pendingStore.value = mergeTemplatePending(pendingStore.value, wantedTemplateCells(cells))
  } catch {
    // 报错原文已由 axios 拦截器弹出
  }
}

/** 把他划掉过的那几格滤掉，理由写在 {@link dismissedTemplateKeys} 上 */
const wantedTemplateCells = (cells: QlzgReportFieldPendingVO[]) =>
  cells.filter(
    (cell) => !dismissedTemplateKeys.value.has(templatePendingKey(cell.sectionId, cell.fieldKey))
  )

/**
 * 🔴 存完值之后，当前这一页可能**已经不是那一格的家**了
 *
 * 服务端会按模板冻结的章节树反查 `section_id`
 * （`QlzgReportFieldServiceImpl#deriveSection`）：在「页眉与首页」页上新增一格
 * `basis_law`，存完它归到「评估依据」下 —— 那是**正确**的处置
 * （不绑章节的值渲得进 Word 而复核看不见它，一整排 BLOCK 规则会判红），
 * 但页眉页会少一行；少到 0 行时侧栏那个入口整个消失（`v-if="orphanCount > 0"`），
 * 而 `currentKey` 还指着它 ⟹ 评估师看到的是一片空白加一个已经不存在的标题，
 * 他会理解成「刚存的那一格丢了」。
 *
 * 🔴 放在 `reloadFields` 里而不是各个存值回调里：能改变 `orphanCount` 的时机
 * 就是「字段行重新拉回来」这一刻，三个存值入口共用它，写三遍迟早漏一遍
 */
const ensureCurrentTabStillExists = () => {
  if (currentKey.value !== ORPHAN_SECTION_KEY || orphanCount.value > 0) return
  const firstFilled = sectionNodes.value.find((node) => fieldsOf(node.id).length > 0)
  currentKey.value = firstFilled?.key ?? sectionNodes.value[0]?.key ?? ORPHAN_SECTION_KEY
}

const reloadAll = async () => {
  const id = reportId.value
  if (!id) return
  loading.value = true
  // 🔴 换一份报告要把**还没落库的行**整个清掉：那些行的 key 与 sectionId 都属于
  //    上一份报告，而同一个 sectionId 在另一份报告里指向的是**另一节**。
  //    此前这里不清（已有行由 syncDrafts 重建，未落库的那一批没人管），
  //    于是从台账点进第二份报告时，上一份里新加还没存的那一行会跟过来，
  //    点保存就撞上「章节不属于这份报告」—— 不是脏数据，
  //    但一行凭空出现在另一份报告上、报错又指不着它，足够让人以为工具坏了
  pendingStore.value = []
  dismissedTemplateKeys.value = new Set()
  templateFillOn.value = false
  try {
    const [reportResult, sectionResult, fieldResult] = await Promise.allSettled([
      QlzgReportApi.getReport(id),
      QlzgReportApi.getSectionList(id),
      QlzgReportApi.getFieldList(id)
    ])
    if (reportResult.status === 'fulfilled') {
      report.value = reportResult.value
      loadError.value = ''
    } else {
      report.value = null
      loadError.value = reportResult.reason?.message || '报告加载失败'
      return
    }
    sections.value = sectionResult.status === 'fulfilled' ? (sectionResult.value ?? []) : []
    fields.value = fieldResult.status === 'fulfilled' ? (fieldResult.value ?? []) : []
    syncDrafts()

    // 默认落在**第一个有字段行**的节上：评估师进来是要接着填的，
    // 落在一节空白的章节上，他会以为这份报告什么都没有
    if (!sectionNodes.value.some((node) => node.key === currentKey.value)) {
      const firstFilled = sectionNodes.value.find((node) => fieldsOf(node.id).length > 0)
      currentKey.value =
        firstFilled?.key ??
        (orphanCount.value > 0
          ? ORPHAN_SECTION_KEY
          : (sectionNodes.value[0]?.key ?? ORPHAN_SECTION_KEY))
    }

    // 🔴 品类与章节树都**失败得起**：它们只喂字段键下拉与中文名，
    //    挂了不该把已经拿到的报告与字段行一起丢掉。所以那一步整个包在自己的 try 里
    await loadCategory(report.value?.templateId)
    // 🔴 复核横条同样**失败得起**，理由与上面那一步逐字相同
    await loadReview(id)
  } finally {
    loading.value = false
  }
}

/**
 * 品类码从哪儿来 —— 报告行上**没有**这一列
 *
 * 🔴 `QlzgReportVO` 只记 projectId / subjectId / templateId / templateVersionId，
 *    所以品类码要经模板再问一次。而 `/qlzg/template/get` 挂的是
 *    `qlzg:template:query` —— **没有那个权限点的人照样要能写作业台**，
 *    所以这里三层各自 try：拿不到就什么都不给，后果只是字段键下拉里少了中文名，
 *    填值、成文、定稿一条都不受影响。宁可少一个标签，也不要让作业台因为
 *    一个旁路请求失败而整页报错
 */
const loadCategory = async (templateId?: number | null) => {
  if (!templateId) {
    category.value = null
    categorySections.value = []
    return
  }
  let code = ''
  try {
    code = (await QlzgTemplateApi.getTemplate(templateId))?.categoryCode ?? ''
  } catch {
    code = ''
  }
  if (!code) {
    category.value = null
    categorySections.value = []
    return
  }
  try {
    category.value = await QlzgCategoryApi.getCategory(code)
  } catch {
    category.value = null
  }
  try {
    categorySections.value = (await QlzgCategoryApi.getSectionList(code)) ?? []
  } catch {
    categorySections.value = []
  }
}

// ==================== 写 ====================

const saveOne = async (r: TableRow) => {
  if (!reportId.value) return
  if (!r.isNew && !draftChanged(r.row, r.draft)) {
    message.info('这一格没有改动，不发请求')
    return
  }
  if (!r.draft.fieldKey.trim()) {
    message.error('请先给这一格选一个字段键')
    return
  }
  try {
    await QlzgReportApi.saveFieldValue(
      payloadOf(reportId.value, r.row, { ...r.draft, fieldKey: r.draft.fieldKey.trim() })
    )
    message.success(savedMessage(r.isNew))
    if (r.isNew) dropRow(r.key)
    await Promise.all([reloadFields(), reloadReportOnly()])
  } catch {
    // 报错原文已由 axios 拦截器弹出，这里不重复
  }
}

/**
 * 🔴 在页眉页上新增一格时，「已加进这一节」是一句**假话**：
 * 服务端可能把它归到章节树里的某一节去（见 `ensureCurrentTabStillExists`），
 * 归了之后这一格就不在页眉页上了。宁可把这件事说出来，
 * 也不要让评估师看着少了一行的列表以为存失败了
 */
const savedMessage = (isNew: boolean) => {
  if (!isNew) return '已保存。改过值会把红标打回未确认，成过的稿也变成「需重新成文」'
  if (currentKey.value === ORPHAN_SECTION_KEY) {
    return '已保存。这一格若属于模板章节树里的某一节，服务端会把它归到那一节去，本页上就不再有它'
  }
  return '已加进这一节。改过值会把红标打回未确认，成过的稿也变成「需重新成文」'
}

const confirmOne = async (row: QlzgReportFieldVO | null) => {
  if (!row?.id) return
  try {
    await QlzgReportApi.confirmField(row.id)
    // 🔴 确认**不会**把 composeStale 置 1（它不动值），所以这里**不提示重新成文**：
    //    一次多余的成文就多一份孤儿字节，而那份 Word 与库里本来就是同一份值
    message.success('已确认这一处红标')
    await reloadFields()
  } catch {
    // 报错原文已由 axios 拦截器弹出
  }
}

const onInserted = async () => {
  await Promise.all([reloadFields(), reloadReportOnly()])
}

const reloadReportOnly = async () => {
  if (!reportId.value) return
  try {
    report.value = await QlzgReportApi.getReport(reportId.value)
  } catch {
    // 拿不到就沿用手上那一份：界面上其余部分照常能用
  }
}

// ==================== 溯源（I6-b） ====================

const provenanceDrawerRef = ref<InstanceType<typeof ProvenanceDrawer>>()
const paragraphPickerRef = ref<InstanceType<typeof MaterialParagraphPicker>>()
/** 挂依据之前先记下那一格的 fieldId：挂完立刻把弹层打开给他看挂对了没 */
const pickingFieldId = ref<number | null>(null)

/**
 * 打开这一格的溯源弹层
 *
 * <h3>🔴 **不按 `provenanceId` 判能不能点**</h3>
 * 那一列是「这一格的主出处」，可空；而一格可以在它之外**另挂**若干行
 * （资料原文依据走 `/field/attach-material` 追加，压根不碰那一列）。
 * 按主出处判可点，验收 D8 那十次点击里就会有几次弹不出来 ——
 * 而那一条的判据写的正是「10 个**全部**弹出溯源层」
 *
 * <h3>🔴 一行依据都没有时**照样打开**，让弹层自己说空态</h3>
 * 「点了没反应」与「点开写着还没有依据」是两件事：
 * 前者会让评估师以为这个功能坏了，后者是一条事实
 */
const openProvenance = (row: QlzgReportFieldVO | null) => {
  if (!row?.id) return
  provenanceDrawerRef.value?.open({ fieldId: row.id })
}

/**
 * 挑一段资料原文挂到这一格上
 *
 * 🔴 没有 `projectId` 就**不开弹层**：那一屏左栏要按项目列资料，
 *    不带它发出去的是「全租户的资料」，挑出来的依据会指向别的项目的权证
 */
const openParagraphPicker = (r: TableRow) => {
  const fieldId = r.row?.id
  const projectId = report.value?.projectId
  if (!fieldId || !projectId) return
  pickingFieldId.value = fieldId
  paragraphPickerRef.value?.open({
    fieldId,
    projectId,
    fieldLabel: r.row?.fieldKey ? fieldLabelOf(r.row.fieldKey) : undefined
  })
}

/**
 * 挂完一条资料依据之后**直接把弹层打开**，不重读字段行
 *
 * 🔴 后端那一步刻意不动 `qlzg_report_field` 的任何一列，所以重读字段行是白读一次；
 *    真正值得看的是刚挂上的那一行对不对 —— 指错位置的溯源比没有溯源更坏，
 *    而那一步只有人能判
 * 🔴 也不提示重新成文：挂依据不动值，那份 Word 仍然是库里的值。
 *    一次多余的成文就多一份孤儿字节（`FileApi` 没有删除方法），
 *    与 {@link confirmOne} 同一条纪律
 */
const onEvidenceAttached = () => {
  const fieldId = pickingFieldId.value
  pickingFieldId.value = null
  if (fieldId == null) return
  provenanceDrawerRef.value?.open({ fieldId })
}

// ==================== 历史版本与红标（I6-b） ====================

const versionDiffDrawerRef = ref<InstanceType<typeof VersionDiffDrawer>>()

/**
 * 打开版本清单
 *
 * 🔴 一份还没定稿过的报告**照样打开**，让弹层自己说「还没有版本」：
 *    版本行只在定稿那一刻写，所以草稿报告在这里是空的，那是事实不是故障。
 *    而「点了没反应」会被读成这个按钮坏了 —— 与 {@link openProvenance} 同一条处置
 */
const openVersions = () => {
  versionDiffDrawerRef.value?.open(reportId.value)
}

// ==================== 成文 ====================

const composing = ref(false)
const composeVisible = ref(false)
const composeResult = ref<QlzgReportComposeVO | null>(null)

const composeResultBody = computed(() => composeResultText(composeResult.value))

const composeAlertType = computed<'success' | 'warning'>(() =>
  composeHasIssue(composeResult.value) ? 'warning' : 'success'
)

/**
 * 成文
 *
 * <h3>🔴 上传位于每一道闸之后 —— 所以失败**不留产物**，前端不需要清理</h3>
 * 任何一条可达的失败路径（已定稿 / 已作废 / 模板字节取不回来 / 渲染抛异常）
 * 都还没写过任何字节。所以这里**不准备**「删除刚才那份文件」的按钮 —— 没有那份文件。
 *
 * <h3>🔴 `placeholderRemaining > 0` 或 `valueMissingCount > 0` 时成文**仍然是成功的**</h3>
 * 那份 Word 已经生成好了，评估师要下载它才看得出是哪一格：未闭合的占位符在纸上就是
 * `{{xxx}}` 原样，取不到值的格子在纸上是【缺值】或【未映射】—— 两者长得不一样、
 * 出路也相反（前者去改模板并发一个新版本，后者就在这一页填值）。
 * 说成「成文失败」他会去重试，而重试一百次也是同一处。
 * 弹窗正文由 {@link composeResultText} 拼，那里把两个计数器刻意分成两句、各带各的出路。
 *
 * <h3>⚠️ 重新成文会替换掉旧的那一份，而旧的**不会被删**</h3>
 * `replacedFileId` 就是它的编号。所以界面上**不提它**：
 * 提了只会引出「那怎么清掉」这个当前答不了的问题（欠账记在 I6）。
 */
const compose = async () => {
  if (!reportId.value || composing.value) return
  composing.value = true
  try {
    composeResult.value = await QlzgReportApi.composeReport(reportId.value)
    composeVisible.value = true
    await reloadReportOnly()
  } catch {
    // 报错原文已由 axios 拦截器弹出。成文失败**没有**产物，所以这里不做任何清理
  } finally {
    composing.value = false
  }
}

/**
 * 下载成稿
 *
 * 🔴 只在**点击那一刻**调 `/word-url`：计量发生在取地址那一刻，不是在成文那一刻。
 *    成文了但从来没人下载的报告流量是 0，所以「取地址」这个动作**就是**一次计量事件 ——
 *    为了「刷新一下界面」而反复调它，会在客户的账单上出现一排他从来没做过的下载
 */
const download = async () => {
  if (!reportId.value) return
  try {
    const info = await QlzgReportApi.getWordFileUrl(reportId.value)
    if (!info?.url) {
      message.warning('取不到下载地址，请重新成文一次')
      return
    }
    if (info.finalized !== true) {
      message.warning(`下载到的是${info.reportNo}的草稿，还没定稿，不要交付`)
    }
    window.open(info.url, '_blank')
  } catch {
    message.error('还没成过文，请先点一次「成文」')
  }
}

// ==================== 定稿 / 退回修订 / 作废 ====================

const finalizeVisible = ref(false)
const finalizing = ref(false)
const changeSummary = ref('')

const summaryRequired = computed(() => changeSummaryRequired(report.value))
const summaryLabel = computed(() => (summaryRequired.value ? '本版说明' : '本版说明（可空）'))

const openFinalize = async () => {
  changeSummary.value = ''
  finalizeVisible.value = true
  // 🔴 打开弹层时**重读一次**复核档案：弹层里那一格「未清零 BLOCK」是当场的事实，
  //    而 latestReview 是页面加载那一刻读到的。中间那段时间里技术负责人可能已经
  //    在复核工作台上豁免完了 3 条 —— 此时弹层写着 3 条、后端已经放行，
  //    用户读到的是「界面在胡说」（与 §11.9.2.6 第 6 条同一个理由：不预校验、但要说实话）。
  //    刻意不 await 完再显示弹层：弹层先出来，那一格自己更新
  if (reportId.value) await loadReview(reportId.value)
}

const submitFinalize = async () => {
  if (!reportId.value) return
  if (summaryRequired.value && !changeSummary.value.trim()) {
    message.error('第 2 版及以后必须写一句本版说明')
    return
  }
  finalizing.value = true
  try {
    await QlzgReportApi.finalizeReport({
      reportId: reportId.value,
      changeSummary: changeSummary.value.trim() || null
    })
    finalizeVisible.value = false
    message.success('已定稿。这一版已经冻结进档案，要改请点「退回修订」')
    await reloadAll()
  } catch {
    // 🔴 几道闸的报错原文**必须**显示出来，不要吞掉它自己去猜原因。
    //    尤其是 REVIEW_OFF_UNTRACED —— 它跟报告上的字段一个关系都没有，
    //    出路是把档位改回来（入口在「系统管理 → 机构内控配置」），
    //    界面上自己编一句「请检查字段」会把人导向完全错误的方向
    // 🔴 被复核那两道闸拦下时**照样要重读一次档案**：闸 C 是先落运行头再抛异常的
    //    （QlzgReviewGateServiceImpl），所以这一刻库里已经有了一次运行的结果。
    //    不重读的表现是：toast 说「有 3 条 BLOCK 未清零」，而报告页上
    //    黄条不出现、「机器复核」那一格还写着「还没被复核过」——
    //    两处对同一件事说不同的话，而用户下一次点开弹层读到的仍是旧的那一份
    await loadReview(reportId.value)
  } finally {
    finalizing.value = false
  }
}

const reopen = async () => {
  if (!reportId.value) return
  try {
    await message.confirm(
      '退回修订会让当前草稿重新可写。已定稿的那一版不会被撤回：它不再写新的版本快照、定稿时间与版本行都留着，仍是法定档案。确定要退回修订吗？'
    )
  } catch {
    return
  }
  try {
    await QlzgReportApi.reopenForRevision(reportId.value)
    message.success('已退回修订，当前草稿可以改了。本报告版本号已加一，下次定稿要写本版说明')
    await reloadAll()
  } catch {
    // 报错原文已由 axios 拦截器弹出
  }
}

const voidVisible = ref(false)
const voiding = ref(false)
const voidReason = ref('')

const openVoid = () => {
  voidReason.value = ''
  voidVisible.value = true
}

const submitVoid = async () => {
  if (!reportId.value) return
  const reason = voidReason.value.trim()
  if (!reason) {
    message.error('作废理由必填')
    return
  }
  voiding.value = true
  try {
    await QlzgReportApi.voidReport({ reportId: reportId.value, voidReason: reason })
    voidVisible.value = false
    message.success('已作废。这一个报告号从此不会再被复用')
    await reloadAll()
  } catch {
    // 报错原文已由 axios 拦截器弹出
  } finally {
    voiding.value = false
  }
}

// ==================== 导航 ====================

const goBack = () => {
  // 🔴 带上 projectId，否则台账回来是一张空表 + 一句「请先选一个项目」，
  //    而他是从那个项目进来的
  const id = report.value?.projectId
  router.push({ path: '/qlzg/report', query: id ? { projectId: id } : {} })
}

watch(
  reportId,
  (id) => {
    if (id) {
      reloadAll()
    } else {
      report.value = null
      sections.value = []
      fields.value = []
      loadError.value = ''
    }
  },
  { immediate: true }
)
</script>
<style lang="scss" scoped>
.form-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.dialog-hint {
  font-size: 12px;
  line-height: 1.7;
}

.warn-text {
  font-size: 12px;
  color: var(--el-color-warning);
}

.mono {
  font-family: var(--el-font-family-mono, monospace);
  font-size: 12px;
}

.col-box {
  padding: 8px 10px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
}

.col-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
  font-size: 14px;
  font-weight: 600;
}

.col-sub {
  display: flex;
  gap: 12px;
  margin-bottom: 6px;
}

.col-foot {
  display: flex;
  gap: 16px;
  align-items: center;
  padding-top: 6px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.sec-clause {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.sec-row {
  padding: 6px 8px;
  margin-bottom: 4px;
  cursor: pointer;
  border-radius: 4px;

  &:hover {
    background: var(--el-fill-color-light);
  }
}

.sec-active {
  background: var(--el-color-primary-light-9);
}

.sec-label {
  font-size: 13px;
  line-height: 1.5;
}

.sec-meta {
  display: flex;
  gap: 8px;
  justify-content: space-between;
  font-size: 11px;
  color: var(--el-text-color-secondary);
}

.field-label {
  font-size: 12px;
  line-height: 1.4;
}

.field-key {
  font-family: var(--el-font-family-mono, monospace);
  font-size: 11px;
  color: var(--el-text-color-secondary);
}

.field-picker {
  margin-top: 4px;
}
</style>
