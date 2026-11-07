<template>
  <el-drawer v-model="visible" title="历史版本与红标" size="80%">
    <div v-loading="loading">
      <!--
        🔴 这一句是给复核人看的口径声明：红标比的是「改了什么」，不是「对不对」。
           它不是一句客套话 —— 一个把红标当成质量保证的复核人会只扫红标就签字，
           而红标压根不覆盖「这个数算得对不对」（那是闸 C 的事）
      -->
      <div class="lede">
        版本行只在<b>定稿</b>那一刻写。红标列出的是这一版与上一版之间<b>变了的地方</b>，
        不变的行一条都不列 —— 它替你分配注意力，<b>不</b>替你判断这些变化对不对。
      </div>

      <!-- ==================== 版本清单 ==================== -->
      <template v-if="!picked">
        <div v-if="loaded && versions.length === 0" class="empty-box">
          这份报告还没有定稿过，所以还没有版本。草稿报告在这里就是空的，不是功能坏了。
        </div>

        <el-table v-else :data="versions" size="small" border>
          <el-table-column label="版本" width="130" align="center">
            <template #default="scope">
              <span class="vd-ver">第 {{ scope.row.versionNo ?? '—' }} 版</span>
              <el-tag v-if="scope.row.current" type="success" size="small" class="vd-cur">
                当前
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="本版说明" min-width="260">
            <template #default="scope">
              <div class="vd-summary">{{ versionSummaryText(scope.row) }}</div>
            </template>
          </el-table-column>
          <el-table-column label="定稿时刻" width="170">
            <template #default="scope">
              <span class="mono">{{ formatDate(scope.row.createTime) || '（未记录）' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="定稿人" width="170">
            <template #default="scope">
              {{ versionCreatorText(scope.row.creator, scope.row.creatorNickname) }}
              <!--
                🔴 编号与人名一起给：人名会被改，编号不会。
                   「这一版是谁定的」在档案意义上认的是编号（《资产评估法》第二十六条的
                   责任锚点），人名只是当下好读。与溯源弹层同一条处置
              -->
              <span v-if="scope.row.creator" class="mono vd-creator">
                （编号 {{ scope.row.creator }}）
              </span>
            </template>
          </el-table-column>
          <el-table-column label="交付物" width="120" align="center">
            <template #default="scope">
              <!--
                🔴 只显示「有没有」，不给下载按钮：下载主路径正在改成 S3 预签名直链
                   （I6-c），现在挂一个走过堆中转的按钮，等 I6-c 落地就要连口径一起换一次。
                🔴 PDF 那一格在 MVP 恒为空（Word→PDF 归 I7），空着读起来是
                   「那一版没有 PDF」，那是一个真事实，不是缺功能
              -->
              <span class="vd-files">
                Word {{ scope.row.wordFileId ? '有' : '无' }} · Excel
                {{ scope.row.excelFileId ? '有' : '无' }} · PDF
                {{ scope.row.pdfFileId ? '有' : '无' }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="红标" width="190" align="center">
            <template #default="scope">
              <el-button
                v-if="scope.row.diffable"
                link
                type="primary"
                :loading="diffing === scope.row.versionNo"
                @click="loadDiff(scope.row)"
              >
                看这一版改了什么
              </el-button>
              <!--
                🔴 这句话**不能**写成「本版没有变更」：两句话在复核人眼里是完全不同的结论，
                   而后者会让他签一份压根没比对过的字。后端在清单这一侧只给了
                   diffable 一个布尔（理由在 diff 那一侧才有），所以这一句由前端出
              -->
              <span v-else class="vd-nodiff">{{ VERSION_NOT_DIFFABLE_LABEL }}</span>
            </template>
          </el-table-column>
        </el-table>
      </template>

      <!-- ==================== 某一版的红标 ==================== -->
      <template v-else>
        <div class="vd-bar">
          <el-button link @click="backToList">
            <Icon icon="ep:back" class="mr-5px" /> 回版本清单
          </el-button>
          <span class="vd-bar-title">
            第 {{ diff?.toVersionNo ?? picked.versionNo }} 版
            <template v-if="diff?.fromVersionNo">与 第 {{ diff.fromVersionNo }} 版</template>
            之间
          </span>
        </div>

        <div v-if="diff" class="vd-block">
          <div class="vd-label">本版说明</div>
          <div class="vd-summary">{{ diff.toChangeSummary || '（这一版没写说明）' }}</div>
        </div>

        <!--
          🔴 三态，null 不是 false：版式换了会让**每一段**正文都可能变，
             而字段级红标比不出这件事（它比的是值）。把 null 当 false 显示，
             等于对着一份可能整篇重排过的报告说「版式没变」。
             文案一律走 versionDiffTemplateText —— 它刻意不印那两个编号，
             因为后端给的是 qlzg_template_version 的**行编号**，不是「第几版」
        -->
        <el-alert
          v-if="templateBanner"
          :type="templateBanner.type"
          :closable="false"
          show-icon
          class="mb-12px"
        >
          <template #title>
            <span class="vd-alert-text">{{ templateBanner.text }}</span>
          </template>
        </el-alert>

        <div v-loading="diffLoading">
          <!-- ========== 字段级 ========== -->
          <div class="vd-section">
            <div class="vd-section-head">
              <b>字段级红标</b>
              <el-tag v-if="fieldPanel.comparable" :type="fieldPanel.alertType" size="small">
                {{ fieldPanel.headline }}
              </el-tag>
            </div>

            <!--
              🔴 不可比时**只**印那句 reason，一张表都不渲染。
                 理由是「空表 + 一句没法比」会被扫成「没有变化」，
                 而 reason 是后端按「哪一版的快照读不出来 / 哪一版没冻章节」现拼的，
                 措辞本身就是产品的一部分 —— 不改写、不截断、不换成「加载失败」。
                 其中「快照读不出来」那一句还带着「档案可能已被改坏」这个事实
            -->
            <el-alert
              v-if="!fieldPanel.comparable"
              type="warning"
              :closable="false"
              show-icon
              class="mb-12px"
            >
              <template #title>
                <span class="vd-alert-text">{{ fieldPanel.headline }}</span>
              </template>
            </el-alert>
            <div v-else-if="fieldPanel.rows === 0" class="empty-box">{{ fieldPanel.headline }}</div>
            <el-table v-else :data="diff!.fieldDiff" size="small" border>
              <el-table-column label="变化种类" width="180">
                <template #default="scope">
                  <!--
                    🔴 changeKinds 是**数组**，一行可以同时带几种，全部渲染出来。
                       拆成多行的话复核人会在清单里看见同一个字段键出现两次，
                       于是他会去报告里找第二处改动 —— 而它不存在
                  -->
                  <el-tag
                    v-for="kind in scope.row.changeKinds ?? []"
                    :key="kind"
                    :type="versionDiffFieldKindTagType(kind)"
                    size="small"
                    class="vd-kind"
                  >
                    {{ versionDiffFieldKindLabel(kind) }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="哪一格" min-width="200">
                <template #default="scope">
                  <div>{{ versionFieldSubject(scope.row) }}</div>
                  <!--
                    🔴 说不出是哪一节时整行不渲染：section_id 可空是设计
                       （报告编号、评估基准日、机构名住在页眉或首页表格里），
                       而库里现在**每一格**的 section_id 都是空的 ——
                       给每行挂同一句回落文案等于教复核人跳过这一行，
                       连带跳过它将来真的给出节标题的那一次
                  -->
                  <div v-if="versionFieldSectionText(scope.row)" class="vd-sub">
                    {{ versionFieldSectionText(scope.row) }}
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="上一版" min-width="180">
                <template #default="scope">
                  <!--
                    🔴 pre-wrap 的原样字串：不 trim、不 toFixed、不补千分位、不换算单位。
                       格式化要读品类的 param_schema，而那份 schema 是**活的** ——
                       三年后单位改了，同一份 diff 就会显示成另一个数，
                       红标就不再是「当年看见的那一条」。单位写在列标签上，不拼进值里
                  -->
                  <div class="vd-value vd-old">{{ versionOldValueText(scope.row) }}</div>
                </template>
              </el-table-column>
              <el-table-column label="本版" min-width="180">
                <template #default="scope">
                  <div class="vd-value vd-new">{{ versionNewValueText(scope.row) }}</div>
                </template>
              </el-table-column>
              <el-table-column label="来源变化" min-width="170">
                <template #default="scope">
                  <span v-if="versionSourceFlipText(scope.row)" class="vd-value">
                    {{ versionSourceFlipText(scope.row) }}
                  </span>
                  <span v-else class="vd-none">（来源没变）</span>
                </template>
              </el-table-column>
              <el-table-column label="红标 / 确认" min-width="160">
                <template #default="scope">
                  <span v-if="versionMarkFlipText(scope.row)" class="vd-value">
                    {{ versionMarkFlipText(scope.row) }}
                  </span>
                  <span v-else class="vd-none">（没变）</span>
                </template>
              </el-table-column>
            </el-table>
          </div>

          <!-- ========== 章节级 ========== -->
          <div class="vd-section">
            <div class="vd-section-head">
              <b>章节级红标</b>
              <el-tag v-if="sectionPanel.comparable" :type="sectionPanel.alertType" size="small">
                {{ sectionPanel.headline }}
              </el-tag>
            </div>

            <el-alert
              v-if="!sectionPanel.comparable"
              type="warning"
              :closable="false"
              show-icon
              class="mb-12px"
            >
              <template #title>
                <span class="vd-alert-text">{{ sectionPanel.headline }}</span>
              </template>
            </el-alert>
            <div v-else-if="sectionPanel.rows === 0" class="empty-box">
              {{ sectionPanel.headline }}
            </div>
            <el-table v-else :data="diff!.sectionDiff" size="small" border>
              <el-table-column label="变化种类" width="180">
                <template #default="scope">
                  <el-tag
                    v-for="kind in scope.row.changeKinds ?? []"
                    :key="kind"
                    :type="versionDiffSectionKindTagType(kind)"
                    size="small"
                    class="vd-kind"
                  >
                    {{ versionDiffSectionKindLabel(kind) }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="哪一节" min-width="200">
                <template #default="scope">
                  <div>{{ versionSectionSubject(scope.row) }}</div>
                  <div v-if="scope.row.sectionCode" class="vd-sub mono">
                    {{ scope.row.sectionCode }}
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="变了什么" min-width="360">
                <template #default="scope">
                  <!--
                    🔴 pre-wrap 的纯文本，**不用 v-html**：章节标题来自模板解析，
                       而模板是机构上传的 docx —— 那是外部字节，v-html 就是存储型 XSS
                  -->
                  <div class="vd-value">{{ versionSectionFlipText(scope.row) }}</div>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </div>
      </template>
    </div>
  </el-drawer>
</template>
<script lang="ts" setup>
import {
  QlzgReportApi,
  type QlzgReportVersionDiffVO,
  type QlzgReportVersionVO
} from '@/api/qlzg/report'
import { formatDate } from '@/utils/formatTime'
import {
  VERSION_NOT_DIFFABLE_LABEL,
  versionCreatorText,
  versionDiffFieldKindLabel,
  versionDiffFieldKindTagType,
  versionDiffSectionKindLabel,
  versionDiffSectionKindTagType,
  versionDiffTemplateText
} from '@/views/qlzg/constants'
import {
  versionFieldPanel,
  versionFieldSectionText,
  versionFieldSubject,
  versionMarkFlipText,
  versionNewValueText,
  versionOldValueText,
  versionSectionFlipText,
  versionSectionPanel,
  versionSectionSubject,
  versionSourceFlipText,
  versionSummaryText
} from '@/views/qlzg/report/reportFlow'

/**
 * 历史版本与红标弹层（§11.11.3）
 *
 * <h3>🔴 它的价值不在「好看」，在**复核人的注意力分配**</h3>
 * 40 页报告逐字读要 40 分钟，看红标只要 3 分钟。所以本组件**只**渲染后端给的行
 * （后端只给变了的），一个「显示全部字段」的开关都不要加 ——
 * 全给就等于没给，而红标一旦变成一份要翻的长清单，复核人就会退回去逐字读。
 *
 * <h3>🔴 两张表**各判各的**可比性，不合成一句话</h3>
 * 「字段可比、段落不可比」是一种真实存在的状态：I6-b 之前定稿的版本，
 * 快照里读得出字段、而**没有**冻章节。合并成一句「没法比」就读不出是哪一半，
 * 而合并成一句「没有变化」更坏 —— 那是**假绿**，复核人看完会签字，
 * 签的是一份没有比对过的东西。判据全在 {@link versionFieldPanel} /
 * {@link versionSectionPanel} 里，本组件只负责「不可比就不渲染那张表」。
 *
 * <h3>🔴 红标是**现算**的，库里那一列 `diff_from_prev` 恒为 null</h3>
 * 定稿那条写路径刻意不算 diff：存下来的 diff 是**冻死**的，
 * 而现算可以让三年前的两版在规则改了之后重新比一次。
 * 所以本组件**不要**去读版本行上的任何 diff 字段 —— 它压根不存在。
 *
 * <h3>⚠️ 缺号会报错，而那句报错要原样显示</h3>
 * 要看第 5 版、库里没有第 4 版 ⟹ 后端报 {@code REPORT_VERSION_NOT_EXISTS}，
 * 文案里写着「缺号意味着档案被动过」。那是**要报出来的事实**，
 * 不是要兜住的意外，所以这里 `catch {}` 之后停在清单页、让 request 那层把原文弹出来。
 *
 * @author 走进新时代
 */
defineOptions({ name: 'QlzgVersionDiffDrawer' })

const visible = ref(false)
const loading = ref(false)
const loaded = ref(false)
const diffLoading = ref(false)
/** 正在看红标的那一版；为 null 时显示版本清单 */
const picked = ref<QlzgReportVersionVO | null>(null)
const versions = ref<QlzgReportVersionVO[]>([])
const diff = ref<QlzgReportVersionDiffVO | null>(null)
/** 只为了「看这一版改了什么」那一个按钮的 loading，不做整表 loading */
const diffing = ref<number | null>(null)

const fieldPanel = computed(() => versionFieldPanel(diff.value))
const sectionPanel = computed(() => versionSectionPanel(diff.value))
const templateBanner = computed(() => versionDiffTemplateText(diff.value?.templateVersionChanged))

const reportId = ref<number>()

const open = async (id?: number | null) => {
  visible.value = true
  picked.value = null
  diff.value = null
  versions.value = []
  reportId.value = id ?? undefined
  if (id == null) {
    loaded.value = true
    return
  }
  loading.value = true
  loaded.value = false
  try {
    versions.value = await QlzgReportApi.getVersionList(id)
  } catch {
    // 🔴 吞掉：request 那层已经弹过一次错误提示了，这里再弹一次就是两个框。
    //    抽屉保持打开、显示空清单，比「点一下闪一下就没了」要好排查
  } finally {
    loading.value = false
    loaded.value = true
  }
}

const loadDiff = async (row: QlzgReportVersionVO) => {
  if (reportId.value == null || row.versionNo == null) return
  diffing.value = row.versionNo
  diffLoading.value = true
  try {
    diff.value = await QlzgReportApi.getVersionDiff(reportId.value, row.versionNo)
    // 🔴 先拿到 diff 再切视图：切早了会先渲染一屏「（这一版没写说明）」加两张空表，
    //    而空表在这个组件里恰好是最坏的一种显示（它长得像「没有变化」）
    picked.value = row
  } catch {
    // 🔴 停在清单页。缺号那一句报错由 request 那层原样弹出，见类注释
  } finally {
    diffing.value = null
    diffLoading.value = false
  }
}

const backToList = () => {
  picked.value = null
  diff.value = null
}

defineExpose({ open })
</script>
<style lang="scss" scoped>
.lede {
  padding: 8px 12px;
  margin-bottom: 12px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--el-text-color-regular);
  background: var(--el-fill-color-light);
  border-radius: 4px;
}

.empty-box {
  padding: 16px 12px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-lighter);
  border-radius: 4px;
}

.vd-ver {
  font-weight: 600;
}

.vd-cur {
  margin-left: 6px;
}

.vd-summary {
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}

.vd-creator {
  margin-left: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.vd-files {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.vd-nodiff {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.vd-bar {
  display: flex;
  gap: 12px;
  align-items: baseline;
  margin-bottom: 12px;
}

.vd-bar-title {
  font-size: 14px;
  font-weight: 600;
}

.vd-block {
  margin-bottom: 12px;
}

.vd-label {
  margin-bottom: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.vd-alert-text {
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
}

.vd-section {
  margin-bottom: 20px;
}

.vd-section-head {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 8px;
  font-size: 14px;
}

.vd-kind {
  margin: 2px 4px 2px 0;
}

.vd-sub {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

/* 🔴 white-space: pre-wrap 是这一栏的全部要求：快照里的换行与多余空格都要照原样保留 */
.vd-value {
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}

.vd-old {
  color: var(--el-text-color-secondary);
  text-decoration: line-through;
}

.vd-new {
  font-weight: 600;
  color: var(--el-color-danger);
}

.vd-none {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}

.mono {
  font-family: var(--el-font-family-mono, monospace);
}
</style>
