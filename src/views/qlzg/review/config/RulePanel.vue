<template>
  <div v-loading="loading">
    <!--
      🔴 §11.9.2.7 第 1 条：**没有**规则级开关。
         48 条规则的开关组合是 2⁴⁸ 种状态，出事后无法举证「当时生效的规则集是什么」。
         所以本面板上那一列「启用」是**只读的事实**，不是一个能拨的开关；
         要放行单条误报，走复核工作台的**逐条豁免**（带理由、只有技术负责人能操作）。
         这一段必须写出来：技术负责人看到一条灰色的「停用」行，第一反应就是去找开关
    -->
    <el-alert type="info" :closable="false" show-icon class="mb-12px">
      <div class="alert-text">本页<b>没有</b>规则的启用 / 停用开关，这是刻意的。</div>
      <div class="alert-sub">
        48 条规则的开关组合是 2<sup>48</sup> 种状态，出事后无法举证「当时生效的规则集是什么」。
        某一条规则误报，请在<b>复核工作台</b>上对那一次命中做<b>逐条豁免</b>
        （要写理由、只有技术负责人能操作）—— 那一条豁免本身也是一行档案。
        下面那一列「启用」是只读的事实：停用的行来自平台预置，
        原因是它们引用的事实在这一版还算不出来（点「可用事实词表」能看到具体是哪些）。
      </div>
    </el-alert>

    <div class="toolbar">
      <div class="toolbar-left">
        <el-button size="small" @click="loadAll">刷新</el-button>
        <el-button
          size="small"
          type="primary"
          @click="openForm('create')"
          v-hasPermi="['qlzg:review:config']"
        >
          新建规则
        </el-button>
        <el-button size="small" @click="openFactDrawer">可用事实词表</el-button>
      </div>
      <!--
        🔴 只显示**当前**这一个指纹，不与任何一份报告里的指纹并排印出来：
           32 位十六进制的差集肉眼读不出任何东西，要显示就显示「变了 / 没变」。
           那个比较发生在报告页（ruleSetVersionChanged），不在这里
      -->
      <div class="toolbar-right">
        <span class="form-hint">当前规则集指纹</span>
        <span class="mono fingerprint">{{ ruleSetVersion || '（没取到）' }}</span>
      </div>
    </div>
    <div class="hint-line mb-8px">
      这一串由「平台 + 本机构、启用中」的规则集算出来。
      改任何一条规则（<b>包括把某一条的启用状态翻一次</b>）都会让它变，
      而报告页会拿它与自己档案里存的那一份比 —— 不等就亮一个红点，
      意思是「这一份报告是按另一批规则判的」。红点只是提示，<b>不拦任何操作</b>。
    </div>

    <el-table :data="rules" class="xpy-list-table" stripe size="small">
      <el-table-column type="expand">
        <template #default="scope">
          <div class="expand-box">
            <div class="expand-row">
              <span class="field-label">规则说明</span>
              <span class="expand-text">{{ scope.row.description || '（没有说明）' }}</span>
            </div>
            <div class="expand-row">
              <span class="field-label">判定表达式</span>
              <span class="mono expand-text expand-code">{{
                scope.row.expr || '（没有表达式）'
              }}</span>
            </div>
            <div v-if="scope.row.exprParams" class="expand-row">
              <span class="field-label">阈值参数</span>
              <!--
                🔴 原文字符串直接印，**不 parse 再 stringify**：
                   键序一变，读的人就会以为库里存的是另一份 JSON
              -->
              <span class="mono expand-text expand-code">{{ scope.row.exprParams }}</span>
            </div>
            <div v-if="scope.row.messageTemplate" class="expand-row">
              <span class="field-label">命中信息模板</span>
              <span class="expand-text">{{ scope.row.messageTemplate }}</span>
            </div>
            <div v-if="scope.row.suggestionTemplate" class="expand-row">
              <span class="field-label">修改建议模板</span>
              <span class="expand-text">{{ scope.row.suggestionTemplate }}</span>
            </div>
            <div class="expand-row">
              <span class="field-label">引用的事实</span>
              <span class="expand-text">
                <!--
                  🔴 这一份是**后端扫出来的**（扫描面是 expr 与两个模板列共三列），
                     前端不要自己再扫一遍：自己写一份正则的结果是
                     「界面上说这条规则用了 3 个事实、引擎实际读了 5 个」，而两者都不报错
                -->
                <template v-if="scope.row.referencedFacts?.length">
                  <el-tag
                    v-for="fact in scope.row.referencedFacts"
                    :key="fact"
                    size="small"
                    type="info"
                    class="fact-tag mono"
                  >
                    {{ fact }}
                  </el-tag>
                </template>
                <span v-else class="form-hint">（后端没扫出任何事实名）</span>
              </span>
            </div>
            <div v-if="scope.row.clauseRef" class="expand-row">
              <span class="field-label">条款依据</span>
              <span class="expand-text">{{ scope.row.clauseRef }}</span>
            </div>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="顺序" prop="sort" width="70" align="center" />
      <el-table-column label="规则码" width="150">
        <template #default="scope">
          <span class="mono">{{ scope.row.ruleCode }}</span>
          <el-tag v-if="scope.row.platform === true" size="small" type="warning" class="ml-4px">
            平台
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="规则名称" prop="ruleName" min-width="200" show-overflow-tooltip />
      <el-table-column label="法域" width="120">
        <template #default="scope">
          {{ scope.row.lawDomainName || labelOf(LAW_DOMAIN_OPTIONS, scope.row.lawDomain) || '—' }}
        </template>
      </el-table-column>
      <el-table-column label="严重度" width="130" align="center">
        <template #default="scope">
          <el-tag :type="ruleSeverityTagType(scope.row.severity)" size="small">
            {{ scope.row.severityName || labelOf(RULE_SEVERITY_OPTIONS, scope.row.severity) }}
          </el-tag>
          <!--
            🔴 天花板低于拦截时把它印出来：一条「专家指引」的规则配了 WARN，
               不印天花板的话读者会以为「这条本来可以配拦截、是配的人手软」，
               而真相是「建议性文件不能产生强制性拦截，配不了」
          -->
          <div v-if="ceilingBelowBlockOf(scope.row)" class="form-hint">
            天花板 {{ labelOf(RULE_SEVERITY_OPTIONS, scope.row.severityCeiling) }}
          </div>
        </template>
      </el-table-column>
      <el-table-column label="判定目标" width="110" align="center">
        <template #default="scope">
          {{
            scope.row.targetKindName ||
            labelOf(RULE_TARGET_KIND_OPTIONS, scope.row.targetKind) ||
            '—'
          }}
        </template>
      </el-table-column>
      <el-table-column label="启用" width="90" align="center">
        <template #default="scope">
          <el-tag :type="scope.row.enabled === 1 ? 'success' : 'info'" size="small">
            {{ scope.row.enabled === 1 ? '启用' : '停用' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="180" align="center" fixed="right">
        <template #default="scope">
          <!--
            🔴 平台行给的是「查看」+「照它新建一条」，**不给**「修改」：
               /get 照样返回平台行（配置页要能把 expr 原文展示出来给人参考），
               而写端点一律拒（REVIEW_RULE_PLATFORM_IMMUTABLE）。
               给一个点了必然被拒的按钮，产出的是「这个功能坏了」这个印象
          -->
          <el-button
            v-if="scope.row.platform === true"
            link
            type="primary"
            @click="openForm('view', scope.row)"
          >
            查看
          </el-button>
          <el-button
            v-if="scope.row.platform === true"
            link
            type="primary"
            @click="openForm('copy', scope.row)"
            v-hasPermi="['qlzg:review:config']"
          >
            照它新建一条
          </el-button>
          <el-button
            v-if="scope.row.platform !== true"
            link
            type="primary"
            @click="openForm('update', scope.row)"
            v-hasPermi="['qlzg:review:config']"
          >
            修改
          </el-button>
          <el-button
            v-if="scope.row.platform !== true"
            link
            type="danger"
            @click="handleDelete(scope.row)"
            v-hasPermi="['qlzg:review:config']"
          >
            删除
          </el-button>
        </template>
      </el-table-column>
      <template #empty>
        <el-empty description="本机构可见的规则清单是空的" />
      </template>
    </el-table>

    <!--
      🔴 **不排序、不分页**：后端下发的是 (sort, id) 升序，
         而 sort 相同的平台行之间靠 id 定序。前端按名称重排一次，
         「顺序」这一列就与复核工作台上的实际排列对不上，而用户看不出差别在哪
    -->
    <div class="hint-line mt-8px">
      共 <b>{{ rules.length }}</b> 条（平台预置 <b>{{ platformCount }}</b> 条、本机构自建
      <b>{{ rules.length - platformCount }}</b> 条），按执行顺序排列。
      点开行首的箭头可以看表达式原文与后端扫出来的事实清单。
    </div>

    <RuleForm ref="formRef" @success="loadAll" />
    <FactListDrawer ref="factDrawerRef" />
  </div>
</template>
<script lang="ts" setup>
import { QlzgReviewRuleApi, type QlzgReviewRuleVO } from '@/api/qlzg/reviewRule'
import {
  LAW_DOMAIN_OPTIONS,
  RULE_SEVERITY_OPTIONS,
  RULE_TARGET_KIND_OPTIONS,
  labelOf,
  ruleSeverityTagType
} from '@/views/qlzg/constants'
import FactListDrawer from './FactListDrawer.vue'
import RuleForm from './RuleForm.vue'
import { severityWithinCeiling } from '../reviewFlow'

/**
 * 机构内控配置页的**规则**页签
 *
 * <h3>🔴 这一屏上**没有**启用 / 停用开关，也不会有</h3>
 * §11.9.2.7 第 1 条。开关组合是 2⁴⁸ 种状态，出事后无法举证当时的规则集是什么；
 * 要放行单条误报，走复核工作台的逐条豁免。
 * 所以后端 {@code QlzgReviewRuleSaveReqVO} **压根不收** {@code enabled} 这一列 ——
 * 前端造一个开关出来，它的表现是「拨得动、存不下、也不报错」
 *
 * <h3>🔴 全量清单，不排序、不分页</h3>
 * 后端下发的是 {@code (sort, id)} 升序，而 sort 相同的平台行之间靠 id 定序。
 * 前端重排一次，「顺序」这一列就与复核工作台上的实际排列对不上，
 * 而用户看不出差别在哪。几十条的量一屏读完，分页只会把这条纪律切碎
 *
 * <h3>🔴 指纹只显示**当前这一个**，比较发生在报告页</h3>
 * 把两个 32 位十六进制并排印出来给人比对，肉眼读不出任何东西；
 * 要显示就显示「变了 / 没变」，那是 {@code reviewFlow#ruleSetVersionChanged} 的事。
 * 而且红点**只是提示**，不是「不一样就拦住」的开关 ——
 * 30 年后调档的人要能看出「这一份的口径与今天不同」，如此而已
 *
 * @author 走进新时代
 */
defineOptions({ name: 'QlzgReviewRulePanel' })

const message = useMessage()

const loading = ref(false)
const rules = ref<QlzgReviewRuleVO[]>([])
const ruleSetVersion = ref('')
const formRef = ref()
const factDrawerRef = ref()

const platformCount = computed(() => rules.value.filter((r) => r.platform === true).length)

/** 这一行的法域天花板是不是低于「拦截」（判据见 reviewFlow 的 severityWithinCeiling） */
const ceilingBelowBlockOf = (row: QlzgReviewRuleVO): boolean =>
  !severityWithinCeiling('BLOCK', row.severityCeiling)

const loadAll = async () => {
  loading.value = true
  try {
    // 🔴 两个请求并发：指纹与清单不必同刻（指纹只是给人看的一串，
    //    真正参与比较的那一份存在每份报告自己的档案里）
    const [list, version] = await Promise.all([
      QlzgReviewRuleApi.getRuleList(),
      QlzgReviewRuleApi.getRuleSetVersion()
    ])
    rules.value = list
    ruleSetVersion.value = version ?? ''
  } finally {
    loading.value = false
  }
}

const openForm = (mode: 'create' | 'update' | 'view' | 'copy', row?: QlzgReviewRuleVO) => {
  formRef.value?.open(mode, row)
}

const openFactDrawer = () => factDrawerRef.value?.open()

/**
 * 删一条机构自建规则
 *
 * 🔴 确认文案**不是一句「确定删除吗」**：删掉一条正在跑的规则，
 *    会让此后每一次复核少查一项，而档案里**看不出**少查了什么 ——
 *    只有规则集指纹会变。所以这里要把「指纹会变、老报告页会亮红点」说出来，
 *    并且**先把删除前的指纹读回来印在确认框里**，让这一次变更可对账
 * 🔴 软删之后那个规则码**仍然被占着**（唯一索引不含 deleted）：
 *    「删掉再建一条同码的」会报 REVIEW_RULE_CODE_DUPLICATE。
 *    这句也写进确认框，别等撞了再报错 —— 那句报错读起来像系统出错，
 *    而真相是「这个编号永久退休了」
 */
const handleDelete = async (row: QlzgReviewRuleVO) => {
  let before = ruleSetVersion.value
  try {
    before = await QlzgReviewRuleApi.getRuleSetVersion()
  } catch {
    // 取不到就用页面上那一份：确认框里少一串指纹不影响这次删除的安全性，
    // 而为它多拦一次反而会让「删不掉」看起来像功能坏了
  }
  try {
    // 🔴 写成**一段话**，不写多行：ElMessageBox 的正文渲染在一个 <p> 里，
    //    \n 不会产生换行，多行文本会变成一坨没有断句的墙。
    //    而「把正文改成 HTML」这条路是关着的（dangerouslyUseHTMLString），
    //    它本来也不该开 —— 规则名是机构自己填的数据
    await message.delConfirm(
      `确定删除规则「${row.ruleName}」（${row.ruleCode}）吗？` +
        `删除之后本机构的规则集会少查这一项，规则集指纹会从 ${before || '（没取到）'} 变成另一个值；` +
        `已定稿报告的档案里存的是旧指纹，所以它们的报告页会亮一个红点，` +
        `意思是「这一份是按另一批规则判的」——红点只是提示，不拦任何操作。` +
        `另外，规则码 ${row.ruleCode} 删除之后仍然被占着，不能拿它再建一条新的。`,
      '删除复核规则'
    )
  } catch {
    return
  }
  await QlzgReviewRuleApi.deleteRule(row.id)
  message.success('规则已删除')
  await loadAll()
}

onMounted(loadAll)
</script>
<style lang="scss" scoped>
.alert-text {
  font-size: 13px;
  line-height: 1.7;
}

.alert-sub {
  margin-top: 2px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.toolbar-left {
  display: flex;
  gap: 8px;
  align-items: center;
}

.toolbar-right {
  display: flex;
  gap: 8px;
  align-items: center;
}

.fingerprint {
  font-size: 12px;
  color: var(--el-text-color-regular);
  user-select: all;
}

.field-label {
  display: inline-block;
  min-width: 108px;
  font-size: 13px;
  font-weight: bold;
  color: var(--el-text-color-secondary);
}

.expand-box {
  padding: 8px 16px 8px 48px;
}

.expand-row {
  display: flex;
  gap: 8px;
  align-items: baseline;
  margin-bottom: 6px;
  font-size: 13px;
  line-height: 1.8;
}

.expand-text {
  flex: 1;
}

.expand-code {
  padding: 6px 8px;
  white-space: pre-wrap;
  background: var(--el-fill-color-lighter);
  border-radius: 4px;
}

.fact-tag {
  margin: 0 4px 4px 0;
}

.hint-line {
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}

.form-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.mono {
  font-family: var(--el-font-family-mono, monospace);
}

.ml-4px {
  margin-left: 4px;
}
</style>
