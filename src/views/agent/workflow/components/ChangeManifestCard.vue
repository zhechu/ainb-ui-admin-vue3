<template>
  <!--
    变更清单卡片（重构 S3 / Req 3 的落点）：把后端 ChangeManifest 渲染成审批人看得懂的样子。
    四处宿主复用：聊天 HITL 确认卡、AI 助手草稿卡、BPM 审批详情 + 通过弹层、设计器「影响面」面板。

    🔴 三条渲染纪律（写在 props.manifest 的类型注释里，这里再钉一遍，因为踩了就是让人放心点同意）：
    1. manifest 为 null → 「清单不可用」，绝不是「本次不产生任何写操作」
    2. dryRun.outcome === 'NOT_PROBED' → 黄色「本次没校验」，不是红色「不通过」
    3. scope 非 null 时 hidden* 五个计数一个都不能少显示（裁剪不许静默）
  -->
  <div class="change-manifest-card">
    <!-- ==================== 不可用态（null / 加载失败） ==================== -->
    <el-alert
      v-if="!manifest && !loading"
      data-testid="manifest-unavailable"
      type="warning"
      :closable="false"
      show-icon
    >
      <template #title>
        <span class="font-medium">变更清单不可用</span>
      </template>
      <!-- 🔴 这里的措辞是刻意的：说「拿不到」，不说「没有变更」。
           后者是一句会让人放心点同意的假话 —— 清单生成失败与「这流程什么都不改」
           在界面上必须是两句话，否则附带版返回 null 的设计就白做了。 -->
      <div class="text-12px mt-2px">
        没能生成「将会做什么」的预览，{{ error || '原因未知' }}。
        <span class="text-[var(--el-color-danger)]">
          这不代表本次操作没有影响 —— 请在看不清影响面的情况下谨慎决定。
        </span>
      </div>
    </el-alert>

    <div v-else-if="loading" class="py-16px text-center text-13px text-[var(--el-text-color-secondary)]">
      <el-icon class="animate-spin align-middle"><Loading /></el-icon>
      <span class="ml-6px align-middle">正在预演本次变更…</span>
    </div>

    <template v-else-if="manifest">
      <!-- ==================== 头部：风险色条 + headline ==================== -->
      <div
        data-testid="manifest-headline"
        class="px-12px py-10px border-l-4px border-l-solid"
        :class="riskBarClass"
      >
        <div class="flex items-start justify-between gap-8px">
          <div class="min-w-0 flex-1">
            <div class="text-14px font-medium break-words">{{ manifest.headline }}</div>
            <div v-if="manifest.riskNote" class="text-12px mt-4px break-words opacity-80">
              {{ manifest.riskNote }}
            </div>
            <div class="text-12px mt-4px opacity-70">
              {{ workflowLabel }}
              <!-- 🔴 裁定⑩：不可信输入条数**不进** headline / riskNote（会稀释「说不清」那个更强的信号，
                   且条数天然偏多，进了顶部用户很快学会忽略整句话）。改在这里给独立计数。
                   🔴 措辞是「节点入参」而不是「写操作」：后端 sinkKindOf 对**任何** tool 节点都给
                   TOOL_ARG，只读工具（form_list 之类）一样进这个列表。写成「流进写操作」是一句
                   能被当场证伪的话 —— 而清单上有一句假话，用户就会开始整块跳过它。 -->
              <span
                v-if="manifest.untrustedInputs?.length"
                data-testid="manifest-untrusted-count"
                class="ml-8px text-[var(--el-color-danger)]"
              >
                另有 {{ manifest.untrustedInputs.length }} 处外部输入会流进后续节点入参
              </span>
            </div>
            <!-- 触发器与唤醒方式（方案 §L1162 的 S3 那一半）。
                 wait(event) 的 externalWakeup 声明原文在 S6 进 waits[]，画在下面单独一行行。 -->
            <div
              v-if="triggerNote"
              data-testid="manifest-trigger-note"
              class="text-12px mt-4px opacity-70"
            >
              {{ triggerNote }}
            </div>
            <!-- S6 / 裁定⑬：外部事件等待点的唤醒声明。审批人有权知道「我不在的时候谁会来唤醒它」，
                 尤其无头流程 —— 没声明就是永久卡死，必须显式说出来，不能安静地留一行空白。 -->
            <div
              v-for="(w, i) in manifest.waits || []"
              :key="`wait-${i}`"
              data-testid="manifest-wait"
              class="text-12px mt-4px opacity-70"
            >
              {{ waitLine(w) }}
            </div>
          </div>
          <div class="flex-shrink-0 flex items-center gap-6px">
            <el-tag :type="riskTagType" size="small" effect="dark">
              {{ manifest.riskDescription || riskLevelLabel }}
            </el-tag>
            <el-tooltip content="复制变更清单（Markdown）" placement="top">
              <el-button
                data-testid="manifest-copy"
                size="small"
                text
                :icon="CopyDocument"
                @click="copyMarkdown"
              />
            </el-tooltip>
          </div>
        </div>
      </div>

      <div class="px-12px py-10px">
        <!-- ==================== 冲突与预演失败：红色置顶，一条都不藏 ==================== -->
        <el-alert
          v-for="(c, i) in blockers"
          :key="`blocker-${i}`"
          data-testid="manifest-conflict"
          type="error"
          :closable="false"
          show-icon
          class="!py-6px mb-6px"
        >
          <template #title>
            <span class="text-13px">{{ c }}</span>
          </template>
        </el-alert>

        <!-- ==================== 裁剪记账（scope） ==================== -->
        <el-alert
          v-if="manifest.scope"
          data-testid="manifest-scope-note"
          type="info"
          :closable="false"
          show-icon
          class="!py-6px mb-8px"
        >
          <template #title>
            <span class="text-13px">{{ manifest.scope.note || scopeFallbackNote }}</span>
          </template>
        </el-alert>

        <!-- ==================== 摘要计数（compact 模式到此为止） ==================== -->
        <div data-testid="manifest-stats" class="flex flex-wrap gap-x-12px gap-y-4px text-12px">
          <span
            v-for="s in statChips"
            :key="s.label"
            :class="
              s.danger ? 'text-[var(--el-color-danger)]' : 'text-[var(--el-text-color-regular)]'
            "
          >
            {{ s.label }} <b>{{ s.value }}</b>
          </span>
          <!-- 🔴 全零也是一句要说的话：走到这里说明清单**生成成功了**且确实没有写操作，
               与上面那个「清单不可用」是两回事，不能都渲染成空白让人自己猜。
               🔴 但 degraded 时必须咽回去：降级清单的计数全零只说明「没算出来」，
               此时印一句「本次不产生任何写操作」等于给盲批的审批人发一张安心符 ——
               它与同一张卡片顶部的「变更清单生成失败」直接自相矛盾。 -->
          <span v-if="!statChips.length && !manifest.degraded" class="text-[var(--el-text-color-secondary)]">
            本次不产生任何写操作（只读工具与模型调用不在清单内）
          </span>
        </div>

        <template v-if="!compact">
          <!-- 聊天确认卡 / 设计器影响面里明细可能几十行，把宿主要给人看的东西顶到很远；给一个折叠开关。
               🔴 强制展开的口径见下面 mustShowDetail：blocker、不可逆、高风险三种 -->
          <div v-if="collapsible" class="mt-8px">
            <el-button
              data-testid="manifest-detail-toggle"
              text
              size="small"
              :icon="detailOpen ? ArrowUp : ArrowDown"
              @click="detailOpen = !detailOpen"
            >
              {{ detailOpen ? '收起字段级明细' : '查看字段级明细（表列 / 表单字段 / 查询条件 / 权限）' }}
            </el-button>
          </div>
          <div v-show="!collapsible || detailOpen">
          <!-- ==================== 表 ==================== -->
          <section v-if="tableGroups.length" data-testid="manifest-tables" class="mt-12px">
            <div class="section-title">数据表</div>
            <div v-for="g in tableGroups" :key="g.key" class="mb-10px">
              <div class="text-13px font-medium mb-4px">
                {{ g.title }}
                <DryRunTag :dry-run="g.item.dryRun" />
              </div>
              <div v-if="g.warnings.length" class="text-12px text-[var(--el-color-warning)] mb-4px">
                <div v-for="(w, i) in g.warnings" :key="i">· {{ w }}</div>
              </div>
              <el-table v-if="g.columns.length" :data="g.columns" size="small" border>
                <!-- 🔴 改表时三类列并进同一张表，「操作」必须打头且删除标红：
                     删列会连数据一起没，混在新增列中间等于把不可逆动作伪装成例行变更 -->
                <el-table-column v-if="g.hasOp" label="操作" width="72" align="center">
                  <template #default="{ row }">
                    <span :class="row.__op === '删除' ? 'text-[var(--el-color-danger)] font-medium' : ''">
                      {{ row.__op || '—' }}
                    </span>
                  </template>
                </el-table-column>
                <el-table-column prop="columnName" label="列名" min-width="130" show-overflow-tooltip />
                <el-table-column prop="columnComment" label="中文名" min-width="110" show-overflow-tooltip>
                  <template #default="{ row }">{{ row.columnComment || '—' }}</template>
                </el-table-column>
                <el-table-column label="类型" min-width="110">
                  <template #default="{ row }">{{ columnTypeOf(row) }}</template>
                </el-table-column>
                <!-- 🔴 「对应控件」这一列只在清单里同时有表单时才出现：
                     控件信息在 FORM_CREATE.fields[] 上，不在表列上，靠列名 ↔ 字段名对出来。
                     没有表单就没有可对的，硬画一列全是「—」只会让人以为平台没读到。 -->
                <el-table-column v-if="widgetByColumn.size" label="对应控件" min-width="100">
                  <template #default="{ row }">
                    {{ widgetByColumn.get(row.columnName) || '—' }}
                  </template>
                </el-table-column>
                <el-table-column label="可空" width="70" align="center">
                  <template #default="{ row }">{{ yesNo(row.nullable) }}</template>
                </el-table-column>
                <el-table-column v-if="g.hasSystem" label="" width="110">
                  <template #default="{ row }">
                    <el-tag v-if="isSystemColumn(row.columnName)" size="small" type="info" effect="plain">
                      平台自动维护
                    </el-tag>
                  </template>
                </el-table-column>
              </el-table>
              <!-- 索引 -->
              <div v-if="g.indexes.length" class="mt-6px">
                <el-collapse>
                  <el-collapse-item :title="`索引 ${g.indexes.length} 个`" name="idx">
                    <el-table :data="g.indexes" size="small" border>
                      <el-table-column prop="indexName" label="索引名" min-width="140" show-overflow-tooltip />
                      <el-table-column prop="indexType" label="类型" width="100" />
                      <el-table-column label="列" min-width="160">
                        <template #default="{ row }">{{ (row.columnNames || []).join('、') }}</template>
                      </el-table-column>
                    </el-table>
                  </el-collapse-item>
                </el-collapse>
              </div>
            </div>
          </section>

          <!-- ==================== 表单字段 ==================== -->
          <section v-if="formGroups.length" data-testid="manifest-form-fields" class="mt-12px">
            <div class="section-title">表单</div>
            <div v-for="g in formGroups" :key="g.key" class="mb-10px">
              <div class="text-13px font-medium mb-4px">
                {{ g.title }}
                <DryRunTag :dry-run="g.item.dryRun" />
              </div>
              <div v-if="g.warnings.length" class="text-12px text-[var(--el-color-warning)] mb-4px">
                <div v-for="(w, i) in g.warnings" :key="i">· {{ w }}</div>
              </div>
              <el-table v-if="g.fields.length" :data="g.fields" size="small" border>
                <el-table-column prop="field" label="字段" min-width="120" show-overflow-tooltip />
                <el-table-column label="标题" min-width="110" show-overflow-tooltip>
                  <template #default="{ row }">{{ row.title || '—' }}</template>
                </el-table-column>
                <el-table-column label="控件" min-width="100">
                  <template #default="{ row }">{{ row.widgetLabel || row.widget || '—' }}</template>
                </el-table-column>
                <el-table-column prop="jdbcType" label="绑定列类型" width="110">
                  <template #default="{ row }">{{ row.jdbcType || '—' }}</template>
                </el-table-column>
                <el-table-column label="必填" width="70" align="center">
                  <template #default="{ row }">{{ yesNo(row.required) }}</template>
                </el-table-column>
                <el-table-column label="可查询" width="80" align="center">
                  <template #default="{ row }">{{ yesNo(row.searchable) }}</template>
                </el-table-column>
              </el-table>
            </div>
          </section>

          <!-- ==================== 列表查询条件（Req 3 明确点名要这一块） ==================== -->
          <section v-if="searchConditions.length" data-testid="manifest-search-conditions" class="mt-12px">
            <div class="section-title">列表查询条件</div>
            <el-table :data="searchConditions" size="small" border>
              <el-table-column label="条件名" min-width="120" show-overflow-tooltip>
                <template #default="{ row }">{{ row.f.title || row.f.field || '—' }}</template>
              </el-table-column>
              <el-table-column label="控件" min-width="100">
                <template #default="{ row }">{{ row.f.widgetLabel || row.f.widget || '—' }}</template>
              </el-table-column>
              <el-table-column label="匹配方式" min-width="100">
                <template #default="{ row }">{{ row.f.operatorLabel || row.f.operator || '—' }}</template>
              </el-table-column>
              <el-table-column label="字典" min-width="120" show-overflow-tooltip>
                <template #default="{ row }">{{ row.f.dictType || '—' }}</template>
              </el-table-column>
            </el-table>
          </section>

          <!-- ==================== 菜单与权限 ==================== -->
          <section v-if="publishGroups.length" data-testid="manifest-permissions" class="mt-12px">
            <div class="section-title">菜单与权限</div>
            <div v-for="g in publishGroups" :key="g.key" class="mb-10px">
              <div class="text-13px font-medium mb-4px">
                {{ g.title }}
                <DryRunTag :dry-run="g.item.dryRun" />
              </div>
              <div v-if="g.warnings.length" class="text-12px text-[var(--el-color-warning)] mb-4px">
                <div v-for="(w, i) in g.warnings" :key="i">· {{ w }}</div>
              </div>
              <!-- 🔴 detail.menu 是联合类型：已绑过菜单是一句字符串，会新建菜单才是对象 -->
              <div v-if="typeof g.menu === 'string'" class="text-12px mb-4px">{{ g.menu }}</div>
              <div v-else-if="g.menu" class="text-12px mb-4px">
                新建菜单「{{ g.menu.name || '未命名' }}」，路径
                <code class="px-4px py-1px bg-[var(--el-fill-color)] rounded">{{ g.menu.path || '—' }}</code>
              </div>
              <!-- 🔴 用户最常踩的一条：没指定角色 ⟹ 只有超管看得见，业务用户登录后菜单是空的 -->
              <el-alert
                v-if="g.roleNote"
                :type="g.roleIds?.length ? 'info' : 'warning'"
                :closable="false"
                :title="g.roleNote"
                class="!py-4px mb-6px text-12px"
              />
              <div v-if="g.permissions?.length" class="text-12px">
                <div class="mb-4px text-[var(--el-text-color-secondary)]">
                  本次会创建 {{ g.permissions.length }} 个按钮权限：
                </div>
                <div class="flex flex-wrap gap-4px">
                  <code
                    v-for="p in g.permissions"
                    :key="p"
                    class="px-6px py-2px bg-[var(--el-fill-color)] rounded text-12px"
                  >
                    {{ p }}
                  </code>
                </div>
              </div>
            </div>
          </section>

          <!-- ==================== 审批流 ==================== -->
          <section v-if="processItems.length" class="mt-12px">
            <div class="section-title">审批流</div>
            <div v-for="(it, i) in processItems" :key="it.nodeId || it.summary || i" class="mb-8px">
              <div class="text-13px font-medium mb-2px">
                {{ it.summary }}
                <DryRunTag :dry-run="it.dryRun" />
              </div>
              <div v-for="(w, i) in it.dryRun?.warnings || []" :key="i" class="text-12px text-[var(--el-color-warning)]">
                · {{ w }}
              </div>
            </div>
          </section>

          <!-- ==================== 业务数据 / 数据接口 ==================== -->
          <section v-if="dataItems.length" class="mt-12px">
            <div class="section-title">业务数据</div>
            <ul class="text-13px pl-18px list-disc">
              <li v-for="(it, i) in dataItems" :key="i" class="mb-4px">
                {{ it.summary }}
                <DryRunTag :dry-run="it.dryRun" />
                <div v-for="(w, j) in it.dryRun?.warnings || []" :key="j" class="text-12px text-[var(--el-color-warning)]">
                  · {{ w }}
                </div>
              </li>
            </ul>
          </section>

          <!-- ==================== 没有专用解读的工具（兜底路径） ==================== -->
          <section v-if="genericItems.length" data-testid="manifest-generic-tools" class="mt-12px">
            <div class="section-title">其他工具调用</div>
            <!-- 🔴 stats.genericTools != 0 本身就是一条信号：有写工具没配专用抽取器，
                 平台只能说清「调了它」，说不清「它具体会改什么」 -->
            <el-alert
              type="info"
              :closable="false"
              class="!py-4px mb-6px"
              title="以下工具没有专用的影响面解读，只能列出调用与入参预览"
            />
            <div v-for="(it, i) in genericItems" :key="i" class="mb-8px">
              <div class="text-13px font-medium mb-2px">
                {{ it.summary }}
                <DryRunTag :dry-run="it.dryRun" />
              </div>
              <pre
                v-if="it.detail?.argsPreview"
                class="text-12px bg-[var(--el-fill-color-light)] rounded p-8px overflow-auto max-h-160px m-0"
                >{{ JSON.stringify(it.detail.argsPreview, null, 2) }}</pre
              >
            </div>
          </section>

          <!-- ==================== 说不清的部分（unresolved） ==================== -->
          <section v-if="manifest.unresolved?.length" data-testid="manifest-unresolved" class="mt-12px">
            <div class="section-title text-[var(--el-color-warning)]">
              说不清的部分（{{ manifest.unresolved.length }}）
            </div>
            <el-alert
              v-for="(u, i) in manifest.unresolved"
              :key="i"
              type="warning"
              :closable="false"
              show-icon
              class="!py-6px mb-6px"
            >
              <template #title>
                <span class="text-13px">
                  {{ u.nodeName || u.nodeId || '未知节点' }}：{{ u.reason }}
                </span>
              </template>
            </el-alert>
          </section>

          <!-- ==================== 不可信输入流向（标红） ==================== -->
          <section
            v-if="manifest.untrustedInputs?.length"
            data-testid="manifest-untrusted"
            class="mt-12px"
          >
            <div class="section-title text-[var(--el-color-danger)]">
              外部输入会流进后续节点入参（{{ manifest.untrustedInputs.length }}）
            </div>
            <div class="text-12px text-[var(--el-text-color-secondary)] mb-6px">
              这些值来自平台外部或检索结果，内容不由你控制。若下游是写操作，等于让外部输入决定改什么。
            </div>
            <el-table :data="manifest.untrustedInputs" size="small" border>
              <el-table-column label="流向" min-width="280">
                <template #default="{ row }">
                  <span class="text-[var(--el-color-danger)]">{{ row.summary }}</span>
                </template>
              </el-table-column>
              <el-table-column label="来源" width="130">
                <template #default="{ row }">
                  <el-tag :type="isExternalSource(row.sourceKind) ? 'danger' : 'info'" size="small" effect="plain">
                    {{ sourceLabel(row) }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="sinkArg" label="落到哪个入参" min-width="130" show-overflow-tooltip />
            </el-table>
          </section>

          <!-- ==================== 人工闸口（approvals） ==================== -->
          <section v-if="manifest.approvals?.length" data-testid="manifest-approvals" class="mt-12px">
            <div class="section-title">人工闸口</div>
            <el-table :data="manifest.approvals" size="small" border>
              <el-table-column label="闸口" min-width="140" show-overflow-tooltip>
                <template #default="{ row }">{{ row.nodeName || row.nodeId }}</template>
              </el-table-column>
              <el-table-column label="形式" width="130">
                <template #default="{ row }">{{ approvalTypeLabel(row.type) }}</template>
              </el-table-column>
              <el-table-column label="之后会发生" min-width="180">
                <template #default="{ row }">
                  {{ (row.downstreamKinds || []).map(kindLabel).join('、') || '（无写操作）' }}
                </template>
              </el-table-column>
              <el-table-column label="看得到本清单吗" width="130" align="center">
                <template #default="{ row }">
                  <el-tag :type="row.willSee ? 'success' : 'warning'" size="small" effect="plain">
                    {{ row.willSee ? '看得到' : '看不到' }}
                  </el-tag>
                </template>
              </el-table-column>
            </el-table>
          </section>
          </div>
        </template>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ArrowDown, ArrowUp, CopyDocument, Loading } from '@element-plus/icons-vue'
import { useClipboard } from '@vueuse/core'
import type {
  ChangeManifestVO,
  ManifestChangeItemVO,
  ManifestColumnVO,
  ManifestFormFieldVO,
  ManifestPublishDetailVO,
  ManifestTableAlterDetailVO,
  ManifestTableDetailVO,
  ManifestFormDetailVO,
  ManifestFormUpdateDetailVO,
  ManifestUntrustedInputVO,
  ManifestWaitVO
} from '@/api/agent/workflow'
import DryRunTag from './ManifestDryRunTag.vue'

defineOptions({ name: 'ChangeManifestCard' })

const props = defineProps<{
  /**
   * 🔴 null / undefined = 清单**不可用**（附带版生成失败、或宿主拿不到）。
   * 这不是「没有变更」—— 两者必须渲染成两句话，否则等于让人放心点同意。
   */
  manifest?: ChangeManifestVO | null
  /** 宿主正在取清单（设计器面板按需拉取时用） */
  loading?: boolean
  /** 取清单失败的原因，显示在「不可用」态里 */
  error?: string
  /** 只渲染头部 + 冲突 + 计数（BPM「通过」弹层用：弹层里塞不下字段级明细） */
  compact?: boolean
  /**
   * 把字段级明细收进一个折叠开关（聊天 HITL 确认卡用）。
   * 🔴 有 blocker 时强制展开：都写着「照这么改跑不通」了还默认收起来，等于藏结论。
   */
  collapsible?: boolean
}>()

const message = useMessage()
const { copy } = useClipboard({ legacy: true })

/** 平台自动维护的列：DSL 里若显式写了它们，要在清单上标出来（否则用户以为是自己的业务列） */
const SYSTEM_COLUMNS = new Set([
  'id',
  'creator',
  'create_time',
  'updater',
  'update_time',
  'deleted',
  'tenant_id'
])

const isSystemColumn = (name?: string | null) => !!name && SYSTEM_COLUMNS.has(name)

/**
 * 🔴 后端对 nullable / required / searchable / needsRepublish 用的是 raw 透传
 * （{@code ManifestArgs.raw}），DSL 里写的是什么就是什么 —— 可能是 boolean，也可能是字符串
 * "true"/"1"。渲染前必须自己归一，否则 "false" 这个字符串会被当成真值显示成「是」。
 */
const truthy = (v: unknown): boolean => v === true || v === 'true' || v === 1 || v === '1'
const yesNo = (v: unknown): string => (v == null || v === '' ? '—' : truthy(v) ? '是' : '否')

const asList = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
const asMap = (v: unknown): Record<string, any> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {}

const ofKind = (...kinds: string[]) =>
  (props.manifest?.changes || []).filter((c) => kinds.includes(c.kind))

const tableCreates = computed(() => ofKind('TABLE_CREATE'))
const tableAlters = computed(() => ofKind('TABLE_ALTER'))
const tableRegisters = computed(() => ofKind('TABLE_REGISTER'))
const formCreates = computed(() => ofKind('FORM_CREATE'))
const formUpdates = computed(() => ofKind('FORM_UPDATE'))
const publishItems = computed(() => ofKind('FORM_PUBLISH'))
const processItems = computed(() => ofKind('PROCESS_DEPLOY'))
const dataItems = computed(() => ofKind('DATA_WRITE', 'DATA_INTERFACE'))
const genericItems = computed(() => ofKind('GENERIC_TOOL'))

const targetStr = (it: ManifestChangeItemVO, key: string) => String(it.target?.[key] ?? '')

/** 列名 → 控件中文名：控件信息在表单字段上，不在表列上，靠名字对 */
const widgetByColumn = computed(() => {
  const map = new Map<string, string>()
  for (const it of formCreates.value) {
    for (const f of fieldsOf(it)) {
      if (f.field && (f.widgetLabel || f.widget)) {
        map.set(f.field, f.widgetLabel || f.widget!)
      }
    }
  }
  return map
})

const fieldsOf = (it: ManifestChangeItemVO): ManifestFormFieldVO[] =>
  asList<ManifestFormFieldVO>((asMap(it.detail) as ManifestFormDetailVO).fields)

const columnsOf = (it: ManifestChangeItemVO): ManifestColumnVO[] =>
  asList<ManifestColumnVO>(asMap(it.detail).columns)

const columnTypeOf = (row: ManifestColumnVO) => {
  const t = row.columnType || '—'
  // 🔴 length 与 scale 是一对：只报 length 的话 DECIMAL(10,2) 会显示成「精度 10」，
  //    而金额列的小数位恰恰是审批人最需要确认的那个数字
  if (row.length != null && row.scale != null) return `${t}(${row.length},${row.scale})`
  if (row.length != null) return `${t}(${row.length})`
  return t
}

interface TableGroup {
  key: string
  title: string
  item: ManifestChangeItemVO
  columns: ManifestColumnRow[]
  indexes: any[]
  hasSystem: boolean
  /** 🔴 只有 TABLE_ALTER 为真：新增/修改/删除三种列被并进同一张表，
   *  不标出「操作」的话，删一列和加一列在清单上长得一模一样 —— 而删列是不可逆的 */
  hasOp: boolean
  warnings: string[]
}

/** 表列的一行；__op 仅 TABLE_ALTER 有（后端把三类列分开给，前端合并展示时补的标记） */
type ManifestColumnRow = ManifestColumnVO & { __op?: string }

const tableGroups = computed<TableGroup[]>(() => {
  const groups: TableGroup[] = []
  for (const it of tableCreates.value) {
    const d = asMap(it.detail) as ManifestTableDetailVO
    const cols = columnsOf(it)
    groups.push({
      key: `c-${it.nodeId}-${targetStr(it, 'tableName')}`,
      title: `新建表 ${targetStr(it, 'tableName') || '（表名未填）'}${
        targetStr(it, 'tableComment') ? `（${targetStr(it, 'tableComment')}）` : ''
      }`,
      item: it,
      columns: cols,
      indexes: asList(d.indexes),
      hasSystem: cols.some((c) => isSystemColumn(c.columnName)),
      hasOp: false,
      warnings: it.dryRun?.warnings || []
    })
  }
  for (const it of tableAlters.value) {
    const d = asMap(it.detail) as ManifestTableAlterDetailVO
    const cols: ManifestColumnRow[] = [
      ...asList<ManifestColumnVO>(d.addColumns).map((c) => ({ ...c, __op: '新增' })),
      ...asList<ManifestColumnVO>(d.modifyColumns).map((c) => ({ ...c, __op: '修改' })),
      ...asList<ManifestColumnVO>(d.dropColumns).map((c) => ({ ...c, __op: '删除' }))
    ]
    groups.push({
      key: `a-${it.nodeId}-${targetStr(it, 'tableName')}`,
      title: `修改表 ${targetStr(it, 'tableName') || '（表名未填）'}`,
      item: it,
      columns: cols,
      indexes: [],
      hasSystem: cols.some((c) => isSystemColumn(c.columnName)),
      hasOp: true,
      warnings: it.dryRun?.warnings || []
    })
  }
  for (const it of tableRegisters.value) {
    const names = asList<string>(it.target?.tableNames)
    groups.push({
      key: `r-${it.nodeId}`,
      title: `登记已有表 ${names.join('、') || '（未给出表名）'}`,
      item: it,
      columns: [],
      indexes: [],
      hasSystem: false,
      hasOp: false,
      warnings: it.dryRun?.warnings || []
    })
  }
  return groups
})

interface FormGroup {
  key: string
  title: string
  item: ManifestChangeItemVO
  fields: ManifestFormFieldVO[]
  warnings: string[]
}

const formGroups = computed<FormGroup[]>(() => {
  const groups: FormGroup[] = []
  for (const it of formCreates.value) {
    const t = it.target || {}
    groups.push({
      key: `fc-${it.nodeId}-${t.code}`,
      title: `新建表单「${t.name || '（名称未填）'}」${t.code ? `（${t.code}）` : ''}${
        t.mainTable ? `，绑定表 ${t.mainTable}` : ''
      }`,
      item: it,
      fields: fieldsOf(it),
      warnings: it.dryRun?.warnings || []
    })
  }
  for (const it of formUpdates.value) {
    const d = asMap(it.detail) as ManifestFormUpdateDetailVO
    groups.push({
      key: `fu-${it.nodeId}-${it.target?.formId}`,
      title: `修改表单 #${it.target?.formId ?? '（未指定）'}${
        truthy(d.needsRepublish) ? '，改完需要重新发布才生效' : ''
      }`,
      item: it,
      // 🔴 不再写死成 []：「列表查询条件」那张表就是从这些行里挑 searchable 的，
      //    写死空数组等于改表永远加不了查询条件（缺陷 D4-20）
      fields: fieldsOf(it),
      warnings: [
        ...(it.dryRun?.warnings || []),
        // patch 整个由前置节点算出时后端认不出里面改了哪些字段，
        // 那句话由后端给（它同时进 summary），前端不另写一份措辞
        ...(d.patchPendingNote ? [d.patchPendingNote] : [])
      ]
    })
  }
  return groups
})

/**
 * 列表查询条件：从所有「新建表单」与「改表单」里挑出 searchable 的字段
 *
 * 🔴 两种 kind 都要走。只认 FORM_CREATE 时，「表单字段」那张表认 FORM_UPDATE、
 * 这张表不认 ⟹ 同一份清单上改表那一项在一处有行、在另一处什么都没有，
 * 审批人会以为这次改动不涉及查询区（缺陷 D4-20，裁定 R-02「让改表也能新增查询条件」）。
 * 两张表的数据同源（都是 detail.fields[]），所以「字段表里可查询的那些」与
 * 「这张表的行」两个集合必然恰好相等 —— e2e 里有双向断言钉住这件事。
 */
const searchConditions = computed(() => {
  const out: { form: string; f: ManifestFormFieldVO }[] = []
  for (const it of [...formCreates.value, ...formUpdates.value]) {
    const t = it.target || {}
    // 改表这一项没有 name/code，只有编号；空着会让同一张表里的行看起来「不属于任何表单」
    const formName = String(
      t.name || t.code || (t.formId != null && t.formId !== '' ? `#${t.formId}` : '')
    )
    for (const f of fieldsOf(it)) {
      if (truthy(f.searchable)) out.push({ form: formName, f })
    }
  }
  return out
})

interface PublishGroup {
  key: string
  title: string
  item: ManifestChangeItemVO
  menu?: ManifestPublishDetailVO['menu']
  permissions?: string[]
  roleIds?: number[]
  roleNote?: string | null
  warnings: string[]
}

const publishGroups = computed<PublishGroup[]>(() =>
  publishItems.value.map((it) => {
    const d = asMap(it.detail) as ManifestPublishDetailVO
    return {
      key: `p-${it.nodeId}-${it.target?.formId}`,
      title: it.summary || `发布表单 #${it.target?.formId ?? '（未指定）'}`,
      item: it,
      menu: d.menu,
      permissions: asList<string>(d.permissions),
      roleIds: asList<number>(d.roleIds),
      roleNote: d.roleNote,
      warnings: it.dryRun?.warnings || []
    }
  })
)

/** 冲突 + 预演被拒：这两类是「照这么改跑不通」的**结论**，红色置顶，一条都不藏 */
const blockers = computed<string[]>(() => {
  const out: string[] = []
  for (const it of props.manifest?.changes || []) {
    if (it.conflict?.message) out.push(it.conflict.message)
    // 🔴 NOT_PROBED 不进这里：那是「本次没校验」，不是「校验不通过」，
    //    混进红色 alert 等于把「没核实」说成「核实过且不行」
    if (it.dryRun?.outcome === 'REJECTED') {
      out.push(`${it.summary || it.nodeName || it.nodeId}：${it.dryRun.reason || '预演被拒'}`)
    }
  }
  return out
})

const statChips = computed(() => {
  const s = props.manifest?.stats
  if (!s) return []
  const chips: { label: string; value: number; danger?: boolean }[] = []
  const push = (label: string, value: number, danger = false) => {
    if (value) chips.push({ label, value, danger })
  }
  push('新建表', s.tables)
  push('改表', s.alteredTables)
  push('登记已有表', s.registeredTables)
  push('新建表单', s.forms)
  push('改表单', s.updatedForms)
  push('菜单', s.menus)
  push('权限', s.permissions)
  push('审批流', s.processes)
  push('写业务数据', s.dataWrites)
  push('数据接口', s.dataInterfaces)
  push('说不清的工具', s.genericTools, true)
  push('不可逆', s.irreversibleCount, true)
  push('预演被拒', s.dryRunRejected, true)
  push('本次没校验', s.dryRunNotProbed)
  // 🔴 只读工具**刻意不进** changes（后端 WorkflowChangeManifestBuilder#build 的纪律），
  //    但「扫过了几个」必须能被看见：少了这一格，「changes 里没有只读工具」就有两种读法 ——
  //    「扫过了，确实不写」和「压根没扫到」。这两种在界面上长得一模一样，
  //    而前者是清单可信的全部依据。标签里点明「不计入」，免得被读成一项写操作。
  push('只读工具（不计入变更）', s.readToolCount)
  return chips
})

const scopeFallbackNote = computed(() => {
  const sc = props.manifest?.scope
  if (!sc) return ''
  const parts: string[] = []
  if (sc.hiddenChanges) parts.push(`${sc.hiddenChanges} 项变更`)
  if (sc.hiddenApprovals) parts.push(`${sc.hiddenApprovals} 个其他确认点`)
  if (sc.hiddenReadTools) parts.push(`${sc.hiddenReadTools} 个只读工具`)
  if (sc.hiddenUntrusted) parts.push(`${sc.hiddenUntrusted} 处外部输入的流向`)
  if (sc.hiddenUnresolved) parts.push(`${sc.hiddenUnresolved} 处说不清的部分`)
  return `本清单只覆盖「${sc.fromNodeName || sc.fromNodeId}」及之后的动作${
    parts.length ? `；此前已发生的 ${parts.join('、')} 没有列出` : ''
  }`
})

const workflowLabel = computed(() => {
  const w = props.manifest?.workflow
  if (!w) return ''
  const name = w.name || w.code || '未命名流程'
  // 🔴 version 为 null 是「未落库的草稿」，不是「版本 null」
  const ver = w.version == null ? '草稿' : `版本 ${w.version}`
  return `${name}（${ver}）`
})

/**
 * 触发器与唤醒方式（方案 §L1162 的 S3 那一半：触发类型 + 人工介入形式）。
 * 🔴 `wait(event)` 的 `externalWakeup` 声明原文不在这里 —— 裁定⑬把它顺延到 S6。
 */
/**
 * 触发器类型 → 中文。
 * 🔴 键必须是**带 `trigger.` 前缀的全名**：`workflow.triggerType` 直接取自 DSL 的 `trigger.type`，
 *    后端认的就是 `trigger.chat` / `trigger.form_event` / `trigger.schedule` / `trigger.webhook` 四个
 *    （见 `WorkflowTriggerExtractor`）。写成裸 `webhook` 的话这张表一条都命中不了，
 *    而 `|| w.triggerType` 的回落会把它**静默**兜住 —— 界面上显示「trigger.webhook」，
 *    测试不写死中文就发现不了。这正是本模块的头号缺陷形态：配了、但不生效、且无提示。
 */
const TRIGGER_LABELS: Record<string, string> = {
  'trigger.schedule': '定时',
  'trigger.form_event': '表单事件',
  'trigger.webhook': 'Webhook',
  'trigger.chat': '对话'
}
const triggerNote = computed(() => {
  const w = props.manifest?.workflow
  if (!w?.triggerType) return ''
  const by = TRIGGER_LABELS[w.triggerType] || w.triggerType
  const approvals = props.manifest?.approvals || []
  const hidden = props.manifest?.scope?.hiddenApprovals || 0
  let wakeup: string
  if (approvals.some((a) => a.type === 'hitl.bpm_approval')) {
    wakeup = '无头执行，人工介入走 BPM 待办'
  } else if (approvals.some((a) => a.type === 'hitl.confirm')) {
    wakeup = '人工介入在对话中确认'
  } else if (hidden) {
    // 🔴 清单被裁剪过（只看某个闸口之后），此时 approvals 为空**不能**推出「全程无人工闸口」
    wakeup = `清单已按当前节点裁剪，上游另有 ${hidden} 个人工闸口未列出`
  } else {
    wakeup = '全程无人工闸口，触发后一路跑到底'
  }
  return `本流程由「${by}」触发，${wakeup}`
})

/**
 * 一个 wait(event) 等待点的一句话（S6 / 裁定⑬）。
 * 声明了 externalWakeup → 原样报「谁、调哪个端点、备注」；没声明 → 显式说「没声明」，
 * 因为无头流程里没声明 = 永久卡死，必须让审批人一眼看出来，而不是安静地显示一行空白。
 */
const waitLine = (w: ManifestWaitVO) => {
  const name = w.nodeName || w.nodeId || '等待节点'
  if (!w.declared) {
    return `节点「${name}」在等外部事件，但没有声明谁来唤醒 —— 无头流程里这会永久卡死`
  }
  const parts: string[] = []
  if (w.owner) parts.push(`由 ${w.owner} 唤醒`)
  if (w.endpoint) parts.push(`调 ${w.endpoint}`)
  if (w.note) parts.push(`备注：${w.note}`)
  const detail = parts.length ? `，${parts.join('，')}` : ''
  return `节点「${name}」在等外部事件${detail}`
}

const detailOpen = ref(true)
/**
 * 🔴 这几种情况不许默认收起：都写着「照这么改跑不通」或「建表不可逆」了还折起来，等于藏结论。
 *    反过来，一份只读流程默认摊开几十行明细，会把宿主真正要给人看的东西顶出视野，
 *    用户很快学会整块跳过 —— 那比不给清单更坏。
 */
const mustShowDetail = computed(
  () =>
    blockers.value.length > 0 ||
    props.manifest?.riskLevel === 'IRREVERSIBLE' ||
    props.manifest?.riskLevel === 'HIGH'
)
// 清单可能是异步到的（宿主先给 loading），所以不能在 setup 时一次性判断
watch(
  mustShowDetail,
  (v) => {
    if (v) detailOpen.value = true
  },
  { immediate: true }
)

const riskLevelLabel = computed(() => {
  switch (props.manifest?.riskLevel) {
    case 'IRREVERSIBLE':
      return '不可逆'
    case 'HIGH':
      return '高风险'
    case 'MEDIUM':
      return '中风险'
    case 'LOW':
      return '低风险'
    default:
      return '无写操作'
  }
})

/** 风险色条：IRREVERSIBLE 红 / HIGH 橙 / 其余蓝（方案 §3-L2 渲染要点） */
const riskBarClass = computed(() => {
  switch (props.manifest?.riskLevel) {
    case 'IRREVERSIBLE':
      return 'bg-[var(--el-color-danger-light-9)] border-l-[var(--el-color-danger)]'
    case 'HIGH':
      return 'bg-[var(--el-color-warning-light-9)] border-l-[var(--el-color-warning)]'
    default:
      return 'bg-[var(--el-color-primary-light-9)] border-l-[var(--el-color-primary)]'
  }
})

const riskTagType = computed(() => {
  switch (props.manifest?.riskLevel) {
    case 'IRREVERSIBLE':
      return 'danger'
    case 'HIGH':
      return 'warning'
    default:
      return 'primary'
  }
})

const KIND_LABELS: Record<string, string> = {
  TABLE_CREATE: '新建数据表',
  TABLE_ALTER: '修改表结构',
  TABLE_REGISTER: '登记已有表',
  FORM_CREATE: '新建表单',
  FORM_UPDATE: '修改表单',
  FORM_PUBLISH: '发布表单',
  PROCESS_DEPLOY: '部署审批流',
  DATA_WRITE: '写业务数据',
  DATA_INTERFACE: '调用数据接口',
  GENERIC_TOOL: '调用工具'
}
const kindLabel = (k?: string | null) => (k && KIND_LABELS[k]) || k || '未知'

const APPROVAL_LABELS: Record<string, string> = {
  'hitl.confirm': '在对话中确认',
  'hitl.bpm_approval': '走 BPM 待办'
}
const approvalTypeLabel = (t?: string | null) => (t && APPROVAL_LABELS[t]) || t || '—'

/**
 * 🔴 前三种来源是**平台外**的人能直接投喂的（聊天输入 / webhook 请求体 / 表单提交值），
 * 后两种是平台内部产物（知识库检索片段 / 上游工具返回值）。标红只标前者 ——
 * 全部标红等于没标（后端 SourceKind.fromTrigger() 就是这个分界）。
 */
const isExternalSource = (k?: string | null) =>
  k === 'TRIGGER_CHAT' || k === 'TRIGGER_WEBHOOK' || k === 'TRIGGER_FORM_EVENT'

const sourceLabel = (row: ManifestUntrustedInputVO) =>
  row.sourceLabel || row.sourceKind || '未知来源'

/** 一键复制为 Markdown：审批人常要把这份清单转发给同事 */
const copyMarkdown = async () => {
  const m = props.manifest
  if (!m) return
  const L: string[] = []
  L.push(`# 变更清单：${m.workflow?.name || m.workflow?.code || '未命名流程'}`)
  L.push('')
  L.push(`**${m.headline}**`)
  if (m.riskNote) L.push(`> ${m.riskNote}`)
  if (triggerNote.value) L.push(`> ${triggerNote.value}`)
  L.push('')
  if (m.scope?.note) {
    L.push(`> ${m.scope.note}`)
    L.push('')
  }
  if (blockers.value.length) {
    L.push('## ⚠️ 冲突与变更预演失败')
    blockers.value.forEach((b) => L.push(`- ${b}`))
    L.push('')
  }
  if (m.changes?.length) {
    L.push('## 将会发生的变更')
    m.changes.forEach((c) => {
      L.push(`- **[${kindLabel(c.kind)}]** ${c.summary || ''}`)
      if (c.dryRun && c.dryRun.outcome !== 'PASSED') {
        L.push(`  - 变更预演：${c.dryRun.outcome === 'REJECTED' ? '被拒' : '本次没校验'} — ${c.dryRun.reason || ''}`)
      }
      ;(c.dryRun?.warnings || []).forEach((w) => L.push(`  - ⚠️ ${w}`))
    })
    L.push('')
  }
  if (m.unresolved?.length) {
    L.push('## 说不清的部分')
    m.unresolved.forEach((u) => L.push(`- ${u.nodeName || u.nodeId || '未知节点'}：${u.reason}`))
    L.push('')
  }
  if (m.untrustedInputs?.length) {
    L.push('## 外部输入会流进后续节点入参')
    m.untrustedInputs.forEach((u) => L.push(`- ${u.summary}`))
    L.push('')
  }
  if (m.approvals?.length) {
    L.push('## 人工闸口')
    m.approvals.forEach((a) =>
      L.push(
        `- ${a.nodeName || a.nodeId}（${approvalTypeLabel(a.type)}）：之后会发生 ${
          (a.downstreamKinds || []).map(kindLabel).join('、') || '（无写操作）'
        }；${a.willSee ? '看得到本清单' : '看不到本清单'}`
      )
    )
    L.push('')
  }
  try {
    await copy(L.join('\n'))
    message.success('变更清单已复制到剪贴板')
  } catch {
    message.error('复制失败，请手动选择文本复制')
  }
}
</script>

<style scoped>
.section-title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 6px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
</style>
