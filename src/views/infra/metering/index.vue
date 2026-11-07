<!--
  计量对账（三合一账单）—— 方案 §1.9 第五步那张页面

  ## 🔴 这一页的全部价值是「客户不必相信我们」
  所以每一个数都跟着三件事一起显示：它出自哪张表（`source`）、它按哪个单价算的
  （`priceSnapshots`，展开可见）、它有没有对过账（`reconciled`）。
  少了任何一样，客户拿自己的 OSS 账单来对的时候，我们能给的只有一句「系统统计的」。

  ## 🔴 界面上【没有】任何一个写操作的按钮
  没有「生成账单」「确认账单」「调整金额」。账单是每次按流水与快照**重算**出来的，
  存一份就有两个真相，而允许「调整」等于允许任何人改一份收费依据。
  真要改，改的是配额表里的单价（`infra_resource_quota`），且只影响**之后**写下的流水。
  这不是「功能还没做」，做了才是 BUG。

  ## 🔴 `amount` 为 null 与为 0 在界面上必须长得不一样
  null → 「未定价」标签 + 金额留空，0 → 「¥0.00」。
  把 null 显示成 ¥0.00 的后果是：运维以为自己配好了价、客户以为自己白用了一个月，
  两边都拿着一个错数做决定，而没有任何一处报错。

  ## ⚠️ `note` 一律用 pre-wrap 原样显示，不得当 markdown 渲染
  后端给的是一整段中文说明，里面没有任何 markdown 记号；
  用 `v-html` 或 markdown 渲染器去处理它，等于把后端文案变成前端的注入面。
-->
<template>
  <ContentWrap title="计量对账">
    <template #header>
      <el-button type="primary" plain :loading="exporting" @click="onExportDiff">
        <Icon icon="ep:download" class="mr-5px" /> 导出对账差异明细
      </el-button>
      <!--
        🔴 两个分摊按钮点不动时，理由必须【看得见】，不能只是一个灰色的按钮。
        el-tooltip 挂在 disabled 的 el-button 上不触发（禁用元素不发鼠标事件），
        所以外面套一层 span 承接 hover；同时这两段理由也原样列在页面底部的
        「口径与不可用项」里 —— 一个只靠 hover 才出现的解释，等于没有解释
      -->
      <el-tooltip
        :disabled="!projectBlockReason"
        :content="projectBlockTip"
        placement="bottom"
        :show-after="120"
      >
        <span class="ml-8px">
          <el-button :disabled="!!projectBlockReason">按项目分摊</el-button>
        </span>
      </el-tooltip>
      <el-tooltip
        :disabled="!deptBlockReason"
        :content="deptBlockTip"
        placement="bottom"
        :show-after="120"
      >
        <span class="ml-8px">
          <el-button :disabled="!!deptBlockReason">按部门分摊</el-button>
        </span>
      </el-tooltip>
    </template>

    <el-form :inline="true" class="-mb-15px">
      <el-form-item label="账期">
        <el-date-picker
          v-model="period"
          type="month"
          value-format="YYYY-MM"
          format="YYYY-MM"
          placeholder="选择账期"
          :clearable="false"
          :disabled-date="disableFutureMonth"
          class="!w-160px"
          @change="loadBill"
        />
        <!--
          🔴 上面那个 @change 不是「顺手加个自动刷新」，少了它是一处账实不符：
          选完新账期 `period` 已经变了，而表格里还是【上一个账期】的数 ——
          此时点「导出对账差异明细」拿到的是新账期的文件，屏幕上的合计却是旧账期的，
          两者都标着自己的账期、彼此对不上，而这正是对账页唯一不能出的错。
          （走查实测：picker 选了 2026-10，页面仍显示 2026-11 的六行，
          导出文件名却是「对账差异明细_2026-10.xlsx」）
        -->
        <span class="hint-text ml-8px">当前账期 {{ period || '—' }}</span>
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :loading="loading" @click="loadBill">
          <Icon icon="ep:search" class="mr-5px" /> 查询
        </el-button>
        <el-button @click="shiftMonth(-1)">上一个账期</el-button>
        <el-button @click="shiftMonth(1)">下一个账期</el-button>
      </el-form-item>
    </el-form>
  </ContentWrap>

  <ContentWrap v-if="bill" title="本期合计">
    <el-descriptions :column="3" border>
      <el-descriptions-item label="账期">
        {{ bill.period }}（{{ periodRangeText }}）
      </el-descriptions-item>
      <el-descriptions-item label="合计金额">
        <span class="text-20px font-bold">¥{{ formatAmount(bill.totalAmount) }}</span>
      </el-descriptions-item>
      <el-descriptions-item label="合计是否完整">
        <!--
          🔴 MVP 阶段这个标记【恒为 false】：TOKEN 那一行的数在 agent_usage_log 里，
          而 infra 不能反向依赖 agent。一个恒为 false 的标记不是噪音，
          它正是「这个合计不是全部」的常驻提醒
        -->
        <el-tag v-if="bill.totalComplete" type="success">完整</el-tag>
        <el-tag v-else type="warning">不完整</el-tag>
      </el-descriptions-item>
    </el-descriptions>

    <el-alert
      v-if="!bill.totalComplete"
      type="warning"
      :closable="false"
      show-icon
      class="mt-10px"
      title="下面的合计只加到了「算得出金额」的那些行，不是本期全部费用"
    >
      <ul class="mb-0 pl-18px">
        <li v-for="(item, index) in bill.incompleteLines" :key="index">{{ item }}</li>
      </ul>
    </el-alert>

    <el-alert
      :type="(bill.orphanCount ?? 0) > 0 ? 'error' : 'success'"
      :closable="false"
      show-icon
      class="mt-10px"
      :title="`关联不回计量流水的对象存储访问：${bill.orphanCount ?? 0} 条`"
    >
      <div class="note-text">{{ bill.orphanNote }}</div>
    </el-alert>
  </ContentWrap>

  <ContentWrap v-if="bill" title="账单明细（六行）">
    <el-table v-loading="loading" :data="bill.lines" stripe class="xpy-list-table" row-key="resourceType">
      <el-table-column type="expand">
        <template #default="{ row }">
          <div class="px-40px py-10px">
            <!--
              🔴 一个维度在一个账期内出现【多行】分组是正常的：月中改过价、
              或一部分已对账一部分还是暂估。两者都不该被折叠成一行 ——
              折叠就等于把两个口径加成一个数，而 D10 ③ 的手工核算需要看到每一项乘数
            -->
            <div class="font-bold mb-8px">单价快照（{{ row.priceSnapshots?.length ?? 0 }} 个分组）</div>
            <el-table
              v-if="row.priceSnapshots?.length"
              :data="row.priceSnapshots"
              size="small"
              border
              class="mb-10px"
            >
              <el-table-column label="计量方式" min-width="120">
                <template #default="{ row: group }">
                  {{ group.meterKindName || '—' }}
                  <span v-if="group.meterKind" class="hint-text">({{ group.meterKind }})</span>
                </template>
              </el-table-column>
              <el-table-column label="行数" prop="rowCount" width="90" align="right" />
              <el-table-column label="计入金额的用量" width="150" align="right">
                <template #default="{ row: group }">
                  {{ formatQuantity(group.quantity) }} {{ row.unit }}
                </template>
              </el-table-column>
              <el-table-column label="单价" min-width="150" align="right">
                <template #default="{ row: group }">
                  <template v-if="group.pricePerUnit != null">
                    {{ group.pricePerUnit }} {{ group.priceUnit }}
                    <span v-if="group.quotaId != null" class="hint-text">
                      （配额行 #{{ group.quotaId }}）
                    </span>
                  </template>
                  <el-tag v-else type="warning" size="small">未定价</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="金额" width="120" align="right">
                <template #default="{ row: group }">
                  <span v-if="group.amount != null">¥{{ formatAmount(group.amount) }}</span>
                  <span v-else class="hint-text">—</span>
                </template>
              </el-table-column>
            </el-table>
            <div v-else class="hint-text mb-10px">
              本行没有分组：数值不由本模块掌握，请用「自助查询」到 source 那一侧取数。
            </div>
            <div class="font-bold mb-4px">本项说明</div>
            <div class="note-text">{{ row.note }}</div>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="计费维度" min-width="130">
        <template #default="{ row }">
          <div class="font-bold">{{ row.name }}</div>
          <div class="hint-text">{{ row.resourceType }}</div>
        </template>
      </el-table-column>
      <el-table-column label="采集点" min-width="180">
        <template #default="{ row }">
          <!-- 🔴 这一栏不是装饰：答案必须是一张【具体的表】，不能是「系统统计」 -->
          <code class="source-code">{{ row.source }}</code>
        </template>
      </el-table-column>
      <el-table-column label="记到的用量" width="140" align="right">
        <template #default="{ row }">
          <template v-if="row.quantity != null">
            {{ formatQuantity(row.quantity) }} <span class="hint-text">{{ row.unit }}</span>
          </template>
          <span v-else class="hint-text">本模块量不到</span>
        </template>
      </el-table-column>
      <el-table-column label="出账用量" width="140" align="right">
        <template #default="{ row }">
          <template v-if="row.billedQuantity != null">
            {{ formatQuantity(row.billedQuantity) }} <span class="hint-text">{{ row.unit }}</span>
          </template>
          <span v-else class="hint-text">—</span>
        </template>
      </el-table-column>
      <el-table-column label="对账状态" width="150">
        <template #default="{ row }">
          <!--
            🔴 reconciledRatio 为 null 时【不能】印「已对账」：那等于断言发生过一次对账，
            而这一项压根没有对账这回事 —— 存储量是每日 Job 自己采的、Token 是厂商回传的、
            零用量的行没有待对账的东西。方案 §1.9 第五步那张 mockup 在这两项上
            也【没有】[已对账] 这个括号，只有流量两行有。
            后端把它们的 reconciled 置为 true 表达的是「这个数不是暂估」，
            与「对过账」是两句话，前端不能把前一句翻译成后一句
          -->
          <el-tooltip
            v-if="row.reconciledRatio == null"
            content="这一项没有「对账前 / 对账后」之分：数就是权威值，不存在暂估的部分"
            placement="top"
          >
            <span class="hint-text">无需对账</span>
          </el-tooltip>
          <!--
            🔴 「暂估」不是错误，是如实：T+1 对账意味着今天的行必然是暂估的。
            所以用 info 而不是 danger —— 渲染成红色告警客户会以为账错了；
            但也【不能不渲染】，一个没有标记的暂估数与一个已对账数长得一模一样
          -->
          <el-tag v-else-if="row.reconciled" type="success" size="small">
            已对账 {{ percent(row.reconciledRatio) }}
          </el-tag>
          <el-tag v-else type="info" size="small">暂估 {{ percent(row.reconciledRatio) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="单价" width="160">
        <template #default="{ row }">
          <template v-if="row.priced === true">
            <template v-if="row.pricePerUnit != null">
              {{ row.pricePerUnit }}
              <div class="hint-text">元 / {{ row.unit }}</div>
            </template>
            <!--
              🔴 priced=true 而 pricePerUnit=null 只有一种来路：本期一个分组都没有。
              此时**不能**显示 ¥0.00 —— 那等于断言「这一项定价为免费」，
              而实际上我们压根没查到过单价。这一页存在的意义就是不作没有依据的断言
            -->
            <el-tooltip content="本期没有用量，因此没有分组，也就无从取到单价" placement="top">
              <span class="hint-text">—</span>
            </el-tooltip>
          </template>
          <!-- 🔴 priced === null 是第三种状态（仅 TOKEN 行）：定价不由本模块掌握。
               渲染成「未定价」会让运维去配额表里找一个压根不由那张表决定的价 -->
          <el-tag v-else-if="row.priced == null" type="info" size="small">他方定价</el-tag>
          <el-tag v-else type="warning" size="small">未定价</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="金额" width="120" align="right">
        <template #default="{ row }">
          <span v-if="row.amount != null" class="font-bold">¥{{ formatAmount(row.amount) }}</span>
          <!-- 🔴 未定价 → 留空 + 说明，绝不显示 ¥0.00 -->
          <el-tooltip
            v-else
            :content="row.priced == null ? '数值不在本模块，需自助查询后并入合计' : '没有可用的单价快照，算不出钱来'"
            placement="top"
          >
            <span class="hint-text">—</span>
          </el-tooltip>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="130" fixed="right">
        <template #default="{ row }">
          <el-button v-if="row.queryPath" link type="primary" @click="openTokenQuery(row)">
            自助查询
          </el-button>
        </template>
      </el-table-column>
    </el-table>
  </ContentWrap>

  <ContentWrap v-if="bill" title="存储量采样自检">
    <!--
      🔴 这一段【必须】渲染，哪怕一切正常：sampled_days < 当月天数 意味着
      StorageSnapshotJob 漏跑了，而漏跑与「这个月真的没存东西」在数据上无法区分 ——
      后者几乎不会发生，前者一定会发生
    -->
    <el-alert
      v-if="!bill.storage.exists"
      type="error"
      :closable="false"
      show-icon
      class="mb-10px"
      title="本月在 infra_storage_snapshot 里没有快照行 —— 存储费算不出来，不能按 0 出账"
    >
      <div class="note-text">
        StorageSnapshotJob 从未跑过（在「基础设施 → 定时任务」里插一行不会让它跑起来，
        要靠 JobSchedulerSyncRunner 建触发器），或本租户本月一次都没采到。
      </div>
    </el-alert>
    <el-alert
      v-else-if="missingDays > 0"
      type="warning"
      :closable="false"
      show-icon
      class="mb-10px"
      :title="`已采样 ${bill.storage.sampledDays}/${bill.storage.daysInMonth} 天，缺 ${missingDays} 天`"
    >
      <div class="note-text">
        GB·月 是「SUM(每日 GB) ÷ 当月天数」逐日累加出来的，缺的那些天在分子里是空的，
        本项因此偏低。出账前必须补跑或按比例折算，不能当成 0 存储。
      </div>
    </el-alert>
    <el-descriptions :column="4" border>
      <el-descriptions-item label="快照行存在">
        <el-tag :type="bill.storage.exists ? 'success' : 'danger'" size="small">
          {{ bill.storage.exists ? '有' : '无' }}
        </el-tag>
      </el-descriptions-item>
      <el-descriptions-item label="已采样天数">
        {{ bill.storage.sampledDays ?? '—' }} / {{ bill.storage.daysInMonth ?? '—' }}
      </el-descriptions-item>
      <el-descriptions-item label="最后采样日">
        {{ bill.storage.lastSampledDate ?? '—' }}
      </el-descriptions-item>
      <el-descriptions-item label="GB·月（计费口径）">
        {{ formatQuantity(bill.storage.totalGbMonth) }}
      </el-descriptions-item>
      <el-descriptions-item label="最后采样时总字节">
        {{ formatBytes(bill.storage.totalBytes) }}
      </el-descriptions-item>
      <el-descriptions-item label="最后采样时文件数">
        {{ bill.storage.fileCount ?? '—' }}
      </el-descriptions-item>
      <el-descriptions-item label="口径" :span="2">
        <span class="hint-text">
          最后两列不参与计费，仅供趋势对比 —— 拿它计费的话，1 号传 1 TB、30 号删掉就一分钱不收了。
        </span>
      </el-descriptions-item>
    </el-descriptions>
  </ContentWrap>

  <ContentWrap v-if="bill" title="口径与不可用项">
    <div class="font-bold mb-8px">刻意不作为账单行的维度</div>
    <ul class="mb-15px pl-18px">
      <li v-for="(item, index) in bill.excludedNotes" :key="index" class="note-text">{{ item }}</li>
    </ul>
    <div class="font-bold mb-8px">本期不可用的动作及原因</div>
    <ul class="mb-0 pl-18px">
      <li v-if="projectBlockReason" class="note-text">按项目分摊：{{ projectBlockReason }}</li>
      <li v-if="deptBlockReason" class="note-text">按部门分摊：{{ deptBlockReason }}</li>
      <li v-if="!projectBlockReason && !deptBlockReason" class="hint-text">无</li>
    </ul>
  </ContentWrap>

  <!--
    🔴 配额与单价 —— 上面那张账单里每一个金额的【唯一】来源

    这一段是后补的，补的原因是实测到的一个缺陷：`infra_resource_quota` 全表 0 行、
    全仓没有任何配额端点，于是 `MeteringPriceResolver#capture` 恒命中「没有模板行 → null」，
    账单六行的金额全是 null、合计 0.00，而界面上没有任何一处能看出「七个维度一个都没配过价」。
    上面那张账单页自己的文案还写着「真要改，改的是配额表里的单价」—— 指向一个没有入口的表。

    ⚠️ 七个维度【永远显示七行】，没配过的显示「未配置」：
    一个消失的行读起来像「这项不收费」，而它真正的含义是「这项没人定过价」。
    这与账单六行「不会因为本期没用量而消失」是同一条纪律。

    🔴 这一段的按钮【刻意不加 v-hasPermi】，别照着别的页面顺手补上。
    `infra:metering:query` 与 `infra:metering:update` 被后端塌缩成了同一条
    sys_resource 身份行，而 get-permission-info 返回的 permissions 数组是【菜单驱动】的
    —— `infra:metering:update` 没有按钮菜单，所以它不在数组里（实测：某个被授予了
    action='*' 的非超管角色，permissions 里只有 :query，写接口却照样返回业务错误码而不是 403）。
    于是 v-hasPermi="['infra:metering:update']" 会把按钮对【每一个】非超管藏掉，
    包括真有权限的那个。补按钮菜单也不是一条出路：那会给原始串造出一条存活的资源行，
    按 R11 整族不再塌缩，判定转去查原始串、授权却还挂在身份行上，重启后权限静默清零。
    写权限由后端 @PreAuthorize 兜着，这里不加前端闸是有意的取舍。
  -->
  <ContentWrap title="配额与单价">
    <template #header>
      <el-button type="primary" plain @click="openQuotaForm(null)">
        <Icon icon="ep:plus" class="mr-5px" /> 新建配额行
      </el-button>
    </template>

    <el-alert type="info" :closable="false" show-icon class="mb-10px">
      <template #title>
        单价改完只影响【之后】写下的流水，已经落库的账单不会跟着变
      </template>
      <div class="note-text">
        每一条流水在写入那一刻就把当时的单价复制进了 price_snapshot（含单价来自哪一行配额），
        所以「上个月按什么价算的」永远有答案。同理，TOTAL 那一行是开期模板：
        新开一个账期时把上限、单价、超额动作【复制】过去，之后改模板不影响已经开出来的账期。
      </div>
    </el-alert>

    <el-form :inline="true" class="-mb-15px">
      <el-form-item label="周期类型">
        <el-select v-model="quotaPeriodType" class="!w-160px" @change="onQuotaPeriodTypeChange">
          <el-option
            v-for="item in QUOTA_PERIOD_TYPE_OPTIONS"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="周期">
        <el-input
          v-model="quotaPeriodKey"
          class="!w-160px"
          :disabled="quotaPeriodType === 'TOTAL'"
          :placeholder="quotaPeriodKeyPlaceholder"
        />
        <span class="hint-text ml-8px">{{ quotaPeriodHint }}</span>
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :loading="quotaLoading" @click="loadQuotas">
          <Icon icon="ep:search" class="mr-5px" /> 查询
        </el-button>
      </el-form-item>
    </el-form>

    <el-table
      v-loading="quotaLoading"
      :data="quotaRows"
      border
      size="small"
      class="mt-10px xpy-list-table"
    >
      <el-table-column label="计费维度" min-width="150">
        <template #default="{ row }">
          <div>{{ row.name }}</div>
          <div class="hint-text">{{ row.resourceType }}</div>
        </template>
      </el-table-column>
      <el-table-column label="周期" min-width="130">
        <template #default="{ row }">
          <template v-if="row.quota">
            {{ row.quota.periodTypeName }}（{{ row.quota.periodKey }}）
          </template>
          <span v-else class="hint-text">未配置</span>
        </template>
      </el-table-column>
      <el-table-column label="上限" min-width="120" align="right">
        <template #default="{ row }">
          <template v-if="row.quota">
            <!-- 0 在上限这一列的含义是「不限量」，不是「一点不许用」，所以必须写出来 -->
            <span v-if="!row.quota.quotaLimit || Number(row.quota.quotaLimit) <= 0">不限量</span>
            <span v-else>{{ formatQuantity(row.quota.quotaLimit) }} {{ row.quota.unit }}</span>
          </template>
          <span v-else class="hint-text">—</span>
        </template>
      </el-table-column>
      <el-table-column label="已用（闸）" min-width="130" align="right">
        <template #default="{ row }">
          <template v-if="row.quota">
            <span :class="{ 'text-red-500': row.quota.exceeded }">
              {{ formatQuantity(row.quota.quotaUsed) }} {{ row.quota.unit }}
            </span>
            <el-tag v-if="row.quota.exceeded" type="danger" size="small" class="ml-5px">已超额</el-tag>
            <el-tag v-else-if="row.quota.warnReached" type="warning" size="small" class="ml-5px">
              近上限
            </el-tag>
          </template>
          <span v-else class="hint-text">—</span>
        </template>
      </el-table-column>
      <el-table-column label="单价" min-width="140" align="right">
        <template #default="{ row }">
          <template v-if="row.quota">
            <!--
              🔴 null 与 0 必须长得不一样：null 是「没人定过价」（账单金额留空），
              0 是「有人明确决定不收这一项的钱」（账单金额 ¥0.00）。
              把 null 显示成 ¥0.000000 会让运维以为自己配好了价
            -->
            <el-tag v-if="row.quota.pricePerUnit == null" type="info" size="small">未定价</el-tag>
            <span v-else>
              ¥{{ Number(row.quota.pricePerUnit).toFixed(6) }} / {{ row.quota.unit }}
            </span>
          </template>
          <el-tag v-else type="info" size="small">未定价</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="超额动作" width="100">
        <template #default="{ row }">
          <span v-if="row.quota">{{ row.quota.actionName }}</span>
          <span v-else class="hint-text">—</span>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <template v-if="row.quota">
            <el-tag v-if="row.quota.status === 0" type="success" size="small">开启</el-tag>
            <el-tooltip
              v-else
              content="关闭表示这一项不限量、也不出价，不是「不许用」"
              placement="top"
            >
              <el-tag type="info" size="small">关闭</el-tag>
            </el-tooltip>
          </template>
          <span v-else class="hint-text">—</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="110" fixed="right">
        <template #default="{ row }">
          <el-button
            v-if="!row.quota"
            link
            type="primary"
            @click="openQuotaForm(row)"
          >
            配置
          </el-button>
          <template v-else>
            <!--
              🔴 历史账期的行禁用而不只是「点了报错」：界面让改、后端拒收，
              用户读到的是一次莫名其妙的失败。禁用时把理由挂在 tooltip 上
            -->
            <el-tooltip
              :disabled="row.quota.editable"
              content="这一行的账期已经过去，它的单价与上限是当时出账的依据，只读"
              placement="top"
            >
              <span>
                <el-button
                  link
                  type="primary"
                  :disabled="!row.quota.editable"
                  @click="openQuotaForm(row)"
                >
                  修改
                </el-button>
              </span>
            </el-tooltip>
          </template>
        </template>
      </el-table-column>
    </el-table>
    <div v-if="unconfiguredCount > 0" class="note-text mt-8px">
      <template v-if="quotaPeriodType === 'TOTAL'">
        有 {{ unconfiguredCount }} 个维度还没有 TOTAL 模板行 —— 它们开不出期，
        账单上那几项的金额必然留空（用量照列）。
      </template>
      <template v-else>
        有 {{ unconfiguredCount }} 个维度在「{{ quotaPeriodKey || '本周期' }}」还没有配额行 ——
        开期靠 TOTAL 模板【复制】过来，模板那一行没配价，这里就不会有价。
      </template>
    </div>
  </ContentWrap>

  <!--
    🔴 BZ-04：客户怀疑「token 那一行为什么是 0」时，必须能自己走一趟那条链路看到 0。
    一个看不到证据的 0，与「根本没统计」在客户眼里是同一件事。
    所以这里【真的去调】/agent/usage/summary，并把调用记录数原样显示出来，
    而不是显示一句我们写好的「MVP 仅 M0，预期是 0」
  -->
  <Dialog v-model="tokenDialog" title="AI Token 自助查询" width="720">
    <el-alert type="info" :closable="false" show-icon class="mb-10px">
      <template #title>
        正在按账期 {{ bill?.period }} 直查 <code class="source-code">agent_usage_log</code>
        （{{ tokenQueryPath }}）。这一项的数不在 infra，本模块读不到那张表。
      </template>
    </el-alert>
    <div v-loading="tokenLoading">
      <el-alert
        v-if="tokenError"
        type="error"
        :closable="false"
        show-icon
        :title="tokenError"
        class="mb-10px"
      >
        <div class="note-text">
          最常见的原因是当前账号没有 agent:usage:query 权限 —— 那是看板权限，与本页面用的
          infra:metering:query 是两个独立的点。请让租户管理员授予后重试。
        </div>
      </el-alert>
      <template v-else-if="tokenQueried">
        <el-descriptions :column="2" border class="mb-10px">
          <el-descriptions-item label="调用记录数">
            <span class="text-18px font-bold">{{ tokenTotal.callCount }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="合计 token">
            <span class="text-18px font-bold">{{ tokenTotal.totalTokens }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="输入 token">{{ tokenTotal.promptTokens }}</el-descriptions-item>
          <el-descriptions-item label="输出 token">
            {{ tokenTotal.completionTokens }}
          </el-descriptions-item>
          <el-descriptions-item label="合计费用" :span="2">
            ¥{{ formatAmount(tokenTotal.totalCost) }}
          </el-descriptions-item>
        </el-descriptions>
        <el-alert
          v-if="tokenTotal.callCount === 0"
          type="success"
          :closable="false"
          show-icon
          title="本期 agent_usage_log 记录数为 0 —— 这个 0 是查出来的，不是填出来的"
        >
          <div class="note-text">
            MVP 阶段只用 M0（零 AI 成稿），成文全程不调模型，所以 token 预期就是 0。
            把这一项并入合计后，账单才是完整的。
          </div>
        </el-alert>
        <el-table
          v-else
          :data="tokenRows"
          size="small"
          border
          max-height="260"
          class="xpy-list-table"
        >
          <el-table-column label="分组" prop="groupLabel" min-width="160" />
          <el-table-column label="调用次数" prop="callCount" width="100" align="right" />
          <el-table-column label="合计 token" prop="totalTokens" width="120" align="right" />
          <el-table-column label="费用（元）" width="120" align="right">
            <template #default="{ row }">{{ formatAmount(row.totalCost) }}</template>
          </el-table-column>
        </el-table>
      </template>
    </div>
    <template #footer>
      <el-button @click="tokenDialog = false">关闭</el-button>
      <el-button type="primary" :loading="tokenLoading" @click="runTokenQuery">重新查询</el-button>
    </template>
  </Dialog>

  <!--
    配额行的表单（新建与修改共用一个 Dialog）

    🔴 修改时唯一键那三列（维度 / 周期类型 / 周期）锁死，而不是「让改、提交后报错」：
    后端会拒收（`METERING_QUOTA_KEY_IMMUTABLE`），界面上却让改，用户读到的是一次莫名其妙的失败。
    要换维度或换周期就新建一行 —— 已经开出来的周期行是当时出账的依据，本来就不该被覆盖
  -->
  <Dialog v-model="quotaDialog" :title="quotaDialogTitle" width="660">
    <el-form
      ref="quotaFormRef"
      v-loading="quotaSubmitLoading"
      :model="quotaForm"
      :rules="quotaFormRules"
      label-width="100px"
    >
      <el-form-item label="计费维度" prop="resourceType">
        <el-select
          v-model="quotaForm.resourceType"
          class="!w-full"
          :disabled="quotaKeyLocked"
          placeholder="请选择"
        >
          <el-option
            v-for="item in quotaDimensions"
            :key="item.resourceType"
            :label="quotaOptionLabel(item)"
            :value="item.resourceType"
            :disabled="quotaOptionDisabled(item)"
          />
        </el-select>
        <div v-if="quotaDimensionHint" class="hint-text">{{ quotaDimensionHint }}</div>
      </el-form-item>
      <el-form-item label="周期类型" prop="periodType">
        <el-select
          v-model="quotaForm.periodType"
          class="!w-full"
          :disabled="quotaKeyLocked"
          @change="onQuotaFormPeriodTypeChange"
        >
          <el-option
            v-for="item in QUOTA_PERIOD_TYPE_OPTIONS"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="周期" prop="periodKey">
        <el-input
          v-model="quotaForm.periodKey"
          :disabled="quotaPeriodLocked"
          :placeholder="quotaFormKeyPlaceholder"
        />
        <div class="hint-text">{{ quotaFormPeriodHint }}</div>
      </el-form-item>
      <el-form-item label="上限" prop="quotaLimit">
        <el-input-number
          v-model="quotaForm.quotaLimit"
          :min="0"
          :precision="4"
          :step="1"
          class="!w-220px"
        />
        <span class="hint-text ml-8px">{{ quotaFormUnitText }}；0 = 不限量</span>
      </el-form-item>
      <el-form-item label="单位">
        <el-input
          v-model="quotaForm.unit"
          class="!w-220px"
          :placeholder="quotaDefaultUnit || '按维度默认'"
        />
        <span class="hint-text ml-8px">留空按该维度的默认单位</span>
      </el-form-item>
      <el-form-item label="告警阈值">
        <el-input-number
          v-model="quotaForm.warnRatio"
          :min="0.001"
          :max="1"
          :precision="3"
          :step="0.05"
          class="!w-220px"
        />
        <span class="hint-text ml-8px">用量达到「上限 × 该比例」时告警一次</span>
      </el-form-item>
      <el-form-item label="单价">
        <el-input-number
          v-model="quotaForm.pricePerUnit"
          :min="0"
          :precision="6"
          :step="0.1"
          :value-on-clear="null"
          class="!w-220px"
          placeholder="留空 = 未定价"
        />
        <span class="hint-text ml-8px">元 / {{ quotaFormUnitText }}</span>
        <!--
          🔴 这一格旁边必须把 null 与 0 的区别写出来：两者在账单上长得完全不一样，
          而界面上只是一个数字框。不写，运维就会用 0 代替「还没定价」，
          于是账单上出现一行 ¥0.00 —— 客户以为自己白用了一个月
        -->
        <div class="note-text mt-4px">
          留空 = 未定价：账单上这一项的金额留空（用量照列），并在「本期不可用项」里写明原因。
          填 0 = 明确免费：账单金额是 ¥0.00。别用 0 代替「还没定价」。
        </div>
      </el-form-item>
      <el-form-item label="超额动作">
        <el-select v-model="quotaForm.actionOnExceed" class="!w-full">
          <el-option
            v-for="item in QUOTA_ACTION_OPTIONS"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
        <div class="hint-text">SaaS 与私有化的分叉就在这一列的配置值上，不是代码分支</div>
      </el-form-item>
      <el-form-item label="状态">
        <el-radio-group v-model="quotaForm.status">
          <el-radio :value="0">开启</el-radio>
          <el-radio :value="1">关闭</el-radio>
        </el-radio-group>
        <div class="hint-text">
          关闭 = 这一项不限量、也不出价（闸直接放行、单价快照取不到值），不是「不许用」
        </div>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="quotaDialog = false">取消</el-button>
      <el-button type="primary" :loading="quotaSubmitLoading" @click="submitQuotaForm">
        确定
      </el-button>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { buildExportFilename } from '@/utils/exportExcel'
import { formatDate } from '@/utils/formatTime'
import * as MeteringApi from '@/api/infra/metering'
import type { MeteringBillLineVO } from '@/api/infra/metering'
import * as UsageApi from '@/api/agent/usage'
import download from '@/utils/download'

defineOptions({ name: 'InfraMeteringBill' })

const message = useMessage()

const loading = ref(false)
const exporting = ref(false)
const bill = ref<MeteringApi.MeteringBillRespVO | null>(null)
/** 默认当月：它一定是个合法账期（后端拒绝晚于当月的账期），且运维最先想看的就是「到现在为止多少」 */
const period = ref(formatDate(new Date(), 'YYYY-MM'))

const projectBlockReason = computed(() => bill.value?.projectAllocationBlockReason ?? null)
const deptBlockReason = computed(() => bill.value?.deptAllocationBlockReason ?? null)
/** el-tooltip 的 `content` 收 `string | undefined`，不收 null，所以另给一份 */
const projectBlockTip = computed(() => projectBlockReason.value ?? undefined)
const deptBlockTip = computed(() => deptBlockReason.value ?? undefined)

const missingDays = computed(() => {
  const storage = bill.value?.storage
  if (!storage?.exists) return 0
  return Math.max(0, (storage.daysInMonth ?? 0) - (storage.sampledDays ?? 0))
})

/**
 * 账期区间的人类可读形态
 *
 * 🔴 后端给的 periodTo 是【不含】的那一端（次月 1 日 00:00），所以要减一天才是月末。
 * 但那个值本身**不能改**：原样传回后端才是对的过滤上界
 */
const periodRangeText = computed(() => {
  if (!bill.value) return ''
  const from = formatDate(bill.value.periodFrom, 'YYYY-MM-DD')
  const to = formatDate(new Date(bill.value.periodTo - 1), 'YYYY-MM-DD')
  return `${from} ~ ${to}`
})

/** 后端已经按左闭右开拒绝了未来账期，选择器上也一并挡掉，省一次往返 */
const disableFutureMonth = (date: Date) => date.getTime() > Date.now()

const shiftMonth = (delta: number) => {
  const [year, month] = period.value.split('-').map(Number)
  const next = new Date(year, month - 1 + delta, 1)
  if (next.getTime() > Date.now()) {
    message.warning('那个账期还没开始')
    return
  }
  period.value = formatDate(next, 'YYYY-MM')
  loadBill()
}

const loadBill = async () => {
  if (!period.value) {
    message.warning('请先选择账期')
    return
  }
  loading.value = true
  try {
    bill.value = await MeteringApi.getMeteringBill(period.value)
  } finally {
    loading.value = false
  }
}

const onExportDiff = async () => {
  exporting.value = true
  try {
    const result = await MeteringApi.exportBillDiff(period.value)
    download.excel(
      result.blob,
      buildExportFilename(`对账差异明细_${period.value}`, false, 1, result.truncated, result.maxRows)
    )
    if (result.truncated) {
      // ⚠️ 截断必须说出来。不说的话用户以为导全了，而少掉的那部分他永远不会去找 ——
      //    他手上是一份加起来对不上账单的明细，而「少半截」与「你们算错了」在纸面上是同一件事
      message.warning(
        `共 ${result.total} 条，超过导出上限 ${result.maxRows} 条，只导出了前 ${result.maxRows} 条。` +
          `请缩小账期范围后分次导出`
      )
    } else {
      message.success('导出成功')
    }
  } catch (e: any) {
    // 🔴 不能写成 catch {}：服务端报错时界面上什么也不发生，用户只会以为「点了没反应」
    console.error('[InfraMeteringBill] 导出对账差异失败', e)
    message.error(e?.msg || e?.message || '导出失败，请稍后重试')
  } finally {
    exporting.value = false
  }
}

// ==================== AI Token 自助查询 ====================

const tokenDialog = ref(false)
const tokenLoading = ref(false)
const tokenQueried = ref(false)
const tokenError = ref('')
const tokenQueryPath = ref('')
const tokenRows = ref<UsageApi.AgentUsageGroupVO[]>([])

const tokenTotal = computed(() =>
  tokenRows.value.reduce(
    (acc, row) => ({
      callCount: acc.callCount + (row.callCount ?? 0),
      promptTokens: acc.promptTokens + (row.promptTokens ?? 0),
      completionTokens: acc.completionTokens + (row.completionTokens ?? 0),
      totalTokens: acc.totalTokens + (row.totalTokens ?? 0),
      totalCost: acc.totalCost + Number(row.totalCost ?? 0)
    }),
    { callCount: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, totalCost: 0 }
  )
)

const openTokenQuery = (row: MeteringBillLineVO) => {
  tokenQueryPath.value = row.queryPath ?? ''
  tokenRows.value = []
  tokenQueried.value = false
  tokenError.value = ''
  tokenDialog.value = true
  runTokenQuery()
}

const runTokenQuery = async () => {
  if (!bill.value) return
  tokenLoading.value = true
  tokenError.value = ''
  try {
    tokenRows.value = await UsageApi.getUsageSummary({
      dimension: 'SCENE',
      beginTime: formatDate(bill.value.periodFrom, 'YYYY-MM-DD HH:mm:ss'),
      endTime: formatDate(bill.value.periodTo, 'YYYY-MM-DD HH:mm:ss')
    })
    tokenQueried.value = true
  } catch (e: any) {
    // 🔴 不静默：拿不到证据的 0 与「没统计」在客户眼里是同一件事，
    //    而这个按钮存在的全部理由就是给出证据。失败了就要说清楚为什么失败
    console.error('[InfraMeteringBill] AI Token 自助查询失败', e)
    tokenQueried.value = false
    tokenError.value = e?.msg || e?.message || '查询失败，请稍后重试'
  } finally {
    tokenLoading.value = false
  }
}

// ==================== 配额与单价 ====================

const QUOTA_TOTAL_KEY = 'TOTAL'

/**
 * 周期类型清单
 *
 * ⚠️ 与后端 `QuotaPeriodTypeEnum` 是同一份事实的两份拷贝，加一个类型要改两边。
 * 🔴 但**维度**清单不这么办 —— 那个走 `/dimensions` 端点，因为它带 `configured`
 * 这种只有服务端知道的状态；周期类型是四个死字符串，为它单开一个端点不值当
 */
const QUOTA_PERIOD_TYPE_OPTIONS = [
  { value: 'TOTAL', label: '不限周期（开期模板）' },
  { value: 'MONTH', label: '按月' },
  { value: 'DAY', label: '按天' },
  { value: 'YEAR', label: '按年' }
]

/** 超额动作。同上；后端对认不出的脏值一律兜成 WARN */
const QUOTA_ACTION_OPTIONS = [
  { value: 'WARN', label: '告警（照常放行，告警一次）' },
  { value: 'THROTTLE', label: '降速（本期尚无执行者，等同告警）' },
  { value: 'BLOCK', label: '阻断（超额后直接拒绝写入）' }
]

/** 表格的一行 = 一个维度，`quota` 为 null 表示这个周期还没配 */
type QuotaRow = MeteringApi.ResourceQuotaDimensionVO & {
  quota: MeteringApi.ResourceQuotaRespVO | null
}

const quotaLoading = ref(false)
/** 默认看 TOTAL：它是开期模板，也是「一个都没配过」这件事最先暴露的地方 */
const quotaPeriodType = ref('TOTAL')
const quotaPeriodKey = ref(QUOTA_TOTAL_KEY)
const quotaDimensions = ref<MeteringApi.ResourceQuotaDimensionVO[]>([])
const quotaList = ref<MeteringApi.ResourceQuotaRespVO[]>([])

/**
 * 🔴 永远七行，一行都不会因为「没配过」而消失
 *
 * 一个消失的行读起来像「这一项不收费」，而它真正的含义是「这一项没人定过价」——
 * 两者在纸面上是同一件事，正是这个缺陷能一直活着的原因
 */
const quotaRows = computed<QuotaRow[]>(() =>
  quotaDimensions.value.map((dim) => ({
    ...dim,
    quota: quotaList.value.find((item) => item.resourceType === dim.resourceType) ?? null
  }))
)

const unconfiguredCount = computed(() => quotaRows.value.filter((row) => !row.quota).length)

/** 某个周期类型下「此刻」所属的 period_key。🔴 与后端 formatter 是同一份口径 */
const currentPeriodKey = (type: string) => {
  const now = new Date()
  if (type === 'DAY') return formatDate(now, 'YYYY-MM-DD')
  if (type === 'YEAR') return formatDate(now, 'YYYY')
  if (type === 'MONTH') return formatDate(now, 'YYYY-MM')
  return QUOTA_TOTAL_KEY
}

/** 示例值一律用【今天】算：运维照抄就不会写出一个格式不对的 key */
const quotaPeriodKeyPlaceholder = computed(() => currentPeriodKey(quotaPeriodType.value))

const quotaPeriodHint = computed(() =>
  quotaPeriodType.value === 'TOTAL'
    ? '开期模板：上限与单价从这里复制到新开的账期'
    : `形如 ${quotaPeriodKeyPlaceholder.value}；填一个过去的账期可以核对当时的配置（那些行只读）`
)

const onQuotaPeriodTypeChange = () => {
  quotaPeriodKey.value = currentPeriodKey(quotaPeriodType.value)
  loadQuotas()
}

const loadQuotas = async () => {
  // 🔴 非 TOTAL 时周期不能留空：后端对空值一律兜到 TOTAL_KEY，于是「MONTH + 空」查的是
  //    period_key='TOTAL' 的行，必然 0 行，而界面读起来像「这个月一行都没开出来」。
  //    这里补成当前周期并写回 ref，输入框显示的就是真正查的那个值
  if (quotaPeriodType.value !== 'TOTAL' && !quotaPeriodKey.value.trim()) {
    quotaPeriodKey.value = quotaPeriodKeyPlaceholder.value
  }
  quotaLoading.value = true
  try {
    const [dimensions, list] = await Promise.all([
      MeteringApi.getQuotaDimensions(),
      MeteringApi.getQuotaList(quotaPeriodType.value, quotaPeriodKey.value.trim())
    ])
    quotaDimensions.value = dimensions ?? []
    quotaList.value = list ?? []
  } finally {
    quotaLoading.value = false
  }
}

// -------------------- 表单 --------------------

const quotaDialog = ref(false)
const quotaSubmitLoading = ref(false)
const quotaFormRef = ref()

const emptyQuotaForm = (): MeteringApi.ResourceQuotaSaveReqVO => ({
  id: null,
  resourceType: '',
  periodType: 'TOTAL',
  periodKey: QUOTA_TOTAL_KEY,
  unit: '',
  quotaLimit: 0,
  warnRatio: 0.8,
  pricePerUnit: null,
  actionOnExceed: 'WARN',
  status: 0
})

const quotaForm = ref<MeteringApi.ResourceQuotaSaveReqVO>(emptyQuotaForm())

const quotaFormRules = {
  resourceType: [{ required: true, message: '请选择计费维度', trigger: 'change' }],
  periodType: [{ required: true, message: '请选择周期类型', trigger: 'change' }],
  periodKey: [{ required: true, message: '请填写周期', trigger: 'blur' }],
  quotaLimit: [{ required: true, message: '请填写上限（0 表示不限量）', trigger: 'blur' }]
}

const quotaDialogTitle = computed(() => (quotaForm.value.id ? '修改配额行' : '新建配额行'))
/** 唯一键那三列在修改时锁死，理由写在 Dialog 上方那段注释里 */
const quotaKeyLocked = computed(() => !!quotaForm.value.id)
const quotaPeriodLocked = computed(
  () => quotaKeyLocked.value || quotaForm.value.periodType === 'TOTAL'
)

const quotaSelectedDimension = computed(
  () =>
    quotaDimensions.value.find((item) => item.resourceType === quotaForm.value.resourceType) ?? null
)
const quotaDefaultUnit = computed(() => quotaSelectedDimension.value?.unit ?? '')
const quotaFormUnitText = computed(
  () => quotaForm.value.unit?.trim() || quotaDefaultUnit.value || '单位'
)
const quotaFormKeyPlaceholder = computed(() => currentPeriodKey(quotaForm.value.periodType))

const quotaFormPeriodHint = computed(() =>
  quotaForm.value.periodType === 'TOTAL'
    ? '固定为 TOTAL，这一行是开期模板。开期时把上限与单价复制给当期行，之后改这里' +
      '不会影响已经开出来的周期——要改当月的单价，就把周期类型切到「按月」改那一行'
    : `形如 ${quotaFormKeyPlaceholder.value}；后端按「解析后再格式化逐字符相同」校验，` +
      `所以 2026-02-30 这种会被拒，而不是被悄悄调成 2 月 28 日`
)

const quotaDimensionHint = computed(() => {
  const dim = quotaSelectedDimension.value
  if (!dim) return ''
  return dim.stock
    ? '存量维度：用量由采样写绝对值（不累加），永远不会因超额被阻断'
    : '流量维度：用量按次累加，超额动作对它生效'
})

/** 已经配过 TOTAL 模板的维度在下拉里标出来，免得建重复行去撞唯一键 */
const quotaOptionLabel = (item: MeteringApi.ResourceQuotaDimensionVO) =>
  quotaOptionDisabled(item)
    ? `${item.name}（${item.resourceType}）· 已有模板行`
    : `${item.name}（${item.resourceType}）`

const quotaOptionDisabled = (item: MeteringApi.ResourceQuotaDimensionVO) =>
  !quotaForm.value.id && quotaForm.value.periodType === 'TOTAL' && !!item.configured

const onQuotaFormPeriodTypeChange = () => {
  quotaForm.value.periodKey = currentPeriodKey(quotaForm.value.periodType)
}

/**
 * @param row null = 从「新建配额行」按钮进来（维度自己选）；
 *            `row.quota` 为 null = 从表格某一行的「配置」进来（维度与周期已经定了）
 */
const openQuotaForm = (row: QuotaRow | null) => {
  quotaForm.value = emptyQuotaForm()
  quotaForm.value.periodType = quotaPeriodType.value
  quotaForm.value.periodKey = quotaPeriodKey.value.trim() || currentPeriodKey(quotaPeriodType.value)
  if (row) {
    quotaForm.value.resourceType = row.resourceType
    if (row.quota) {
      const quota = row.quota
      quotaForm.value.id = quota.id
      quotaForm.value.periodType = quota.periodType
      quotaForm.value.periodKey = quota.periodKey
      quotaForm.value.unit = quota.unit ?? ''
      quotaForm.value.quotaLimit = Number(quota.quotaLimit ?? 0)
      quotaForm.value.warnRatio = Number(quota.warnRatio ?? 0.8)
      // 🔴 null 原样带进来，不兜成 0：兜了就等于把「未定价」显示成「明确免费」
      quotaForm.value.pricePerUnit = quota.pricePerUnit == null ? null : Number(quota.pricePerUnit)
      quotaForm.value.actionOnExceed = quota.actionOnExceed ?? 'WARN'
      quotaForm.value.status = quota.status ?? 0
    } else {
      quotaForm.value.unit = row.unit ?? ''
    }
  }
  quotaDialog.value = true
  nextTick(() => quotaFormRef.value?.clearValidate())
}

const submitQuotaForm = async () => {
  if (!quotaFormRef.value) return
  const valid = await quotaFormRef.value.validate().catch(() => false)
  if (!valid) return
  quotaSubmitLoading.value = true
  try {
    const data: MeteringApi.ResourceQuotaSaveReqVO = {
      ...quotaForm.value,
      periodKey: quotaForm.value.periodKey.trim(),
      // 空串按「用默认单位」发，而不是把空串写进 unit 那一列（它 NOT NULL，但空串是脏值）
      unit: quotaForm.value.unit?.trim() || null
    }
    if (data.id) {
      await MeteringApi.updateQuota(data)
      message.success('修改成功')
    } else {
      await MeteringApi.createQuota(data)
      message.success('新建成功')
    }
    quotaDialog.value = false
    // 🔴 只重查配额，不重查账单：单价改完只影响【之后】写下的流水，
    //    已经落库的账单金额来自每条流水自己的 price_snapshot，重查也是同一个数
    await loadQuotas()
  } finally {
    quotaSubmitLoading.value = false
  }
}

// ==================== 展示口径 ====================

/**
 * 🔴 null 与 0 在这里彻底分开：null 返回「—」，0 返回「0.00」。
 * 任何一处把 null 兜成 0，账单上就会多出一行「明确定价为免费」的假象
 */
const formatAmount = (value?: number | null) =>
  value == null ? '—' : Number(value).toFixed(2)

const formatQuantity = (value?: number | null) => (value == null ? '—' : String(Number(value)))

/** 0.9820 → 「98.2%」。🔴 先 toFixed 再转 Number：0.982 * 100 在浮点下是 98.19999999999999 */
const percent = (ratio?: number | null) => {
  if (ratio == null) {
    return ''
  }
  return `${Number((Number(ratio) * 100).toFixed(2))}%`
}

const formatBytes = (value?: number | null) => {
  if (value == null) return '—'
  const gb = Number(value) / 1024 / 1024 / 1024
  return `${gb.toFixed(3)} GB（${value.toLocaleString('zh-CN')} 字节）`
}

onMounted(() => {
  loadBill()
  loadQuotas()
})
</script>

<style lang="scss" scoped>
/* 🔴 pre-wrap 而不是 markdown：note 是后端给的一整段中文说明，
   里面没有任何 markdown 记号，用 v-html 或渲染器去处理它等于把后端文案变成前端的注入面 */
.note-text {
  white-space: pre-wrap;
  font-size: 13px;
  line-height: 1.7;
}

.hint-text {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.source-code {
  padding: 1px 5px;
  border-radius: 3px;
  background-color: var(--el-fill-color-light);
  font-family: var(--el-font-family-mono, monospace);
  font-size: 12px;
}
</style>
