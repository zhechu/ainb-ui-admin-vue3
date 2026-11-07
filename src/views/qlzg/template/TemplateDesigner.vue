<template>
  <!--
    🔴 `title` 必须给：ContentWrap 的 `<template v-if="title" #header>` 把整个头部
       连同 #header 插槽一起 gate 在 title 上。不给 title 的后果不是「少了个标题」，
       而是下面那排按钮全部消失、且不报错 —— 设计器会变成一页只能看的东西
  -->
  <ContentWrap title="模板设计器">
    <template #header>
      <div class="flex items-center justify-end w-full">
        <el-button v-if="templateId" :loading="downloading" @click="downloadDraft">
          <Icon icon="ep:download" class="mr-5px" /> 下载 docx
        </el-button>
        <el-button
          v-if="templateId"
          type="primary"
          plain
          :disabled="readonly"
          :loading="parsing"
          @click="pickFile"
        >
          <Icon icon="ep:upload" class="mr-5px" /> 上传并解析
        </el-button>
        <el-button
          v-if="templateId"
          type="primary"
          plain
          :disabled="readonly || saving || dirty === 0"
          :loading="saving"
          @click="saveMapping"
          v-hasPermi="['qlzg:template:update']"
        >
          <Icon icon="ep:check" class="mr-5px" />
          保存映射{{ dirty > 0 ? `（${dirty} 处改动）` : '' }}
        </el-button>
        <el-button
          v-if="templateId"
          :disabled="!template?.fileId"
          :loading="previewing"
          @click="doPreview"
          v-hasPermi="['qlzg:template:update']"
        >
          <Icon icon="ep:view" class="mr-5px" /> 预览（真渲染）
        </el-button>
        <el-button
          v-if="templateId"
          type="success"
          plain
          :disabled="readonly"
          @click="openPublish"
          v-hasPermi="['qlzg:template:publish']"
        >
          <Icon icon="ep:promotion" class="mr-5px" /> 发布
        </el-button>
        <el-button v-if="templateId" @click="openVersions">
          <Icon icon="ep:files" class="mr-5px" /> 版本清单
        </el-button>
        <el-button @click="goBack">
          <Icon icon="ep:back" class="mr-5px" /> 回模板台账
        </el-button>
      </div>
    </template>

    <!--
      🔴 隐藏 input 而不是 el-upload：上传要走 QlzgTemplateApi.parseDocx（multipart +
         自己解信封），el-upload 自带的 action/headers 那一套在这里只会多一层要维护的配置。
         而且 16 MB 那道上限要在**发请求之前**拦住：超了是 Spring 的
         MaxUploadSizeExceededException，没有 qlzg 错误码，
         让请求真发出去的话前端拿到的是一句框架级的话，评估师看不懂
    -->
    <input
      ref="fileInputRef"
      type="file"
      accept=".docx"
      class="hidden-file-input"
      @change="onFilePicked"
    />

    <el-alert v-if="!templateId" type="warning" :closable="false" show-icon class="mb-12px">
      <template #title>这一页要从模板台账进来</template>
      <div>
        设计器操作的是<b>一份已存在的模板</b>：占位符能绑到哪些字段键取决于模板的品类，
        闸 B ② 要求哪些必填字段有位置取决于模板的交付物类型。
        这两项都建好之后改不了，所以不能在设计器里现建。请回到「报告模板」台账，
        新建一份、或点某一行的「设计」。
      </div>
    </el-alert>

    <template v-if="templateId">
      <el-alert
        v-if="loadError"
        type="error"
        :closable="false"
        show-icon
        :title="loadError"
        class="mb-12px"
      />

      <el-descriptions v-if="template" :column="4" border size="small" class="mb-12px">
        <el-descriptions-item label="模板">
          {{ template.templateName }}
          <el-tag v-if="template.platform" type="info" size="small" class="ml-6px">平台公共</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="品类">{{ categoryName }}</el-descriptions-item>
        <el-descriptions-item label="交付物">
          {{ template.reportTypeDescription || labelOf(REPORT_TYPE_OPTIONS, template.reportType) }}
        </el-descriptions-item>
        <el-descriptions-item label="docx">
          <span v-if="template.fileId">{{ parseFileName || '已上传' }}</span>
          <span v-else class="form-hint">未上传，先上传一份才能解析</span>
        </el-descriptions-item>
        <el-descriptions-item label="闸 B">
          <el-tag :type="closureTagType(closure)" size="small">
            {{
              template.placeholderClosureStatusDescription ||
              labelOf(CLOSURE_STATUS_OPTIONS, template.placeholderClosureStatus)
            }}
          </el-tag>
        </el-descriptions-item>
        <!--
          🔴 §11.17.3 第 ① 条要的那个数。后端给的是百分比整数，
             前端**不做任何运算**（不除、不四舍五入、不 toFixed）：
             算两次的后果是界面上的数与 autoMappedRatePercent 对不上，
             而 D15 第 ⑤ 条验收时评估师数的就是「我到底还要点几下」
        -->
        <el-descriptions-item label="自动映射率">
          {{ autoMappedRateText(autoMappedRatePercent) }}
        </el-descriptions-item>
        <el-descriptions-item label="发布状态">
          <el-tag v-if="template.isPublished" type="success" size="small">已发布</el-tag>
          <span v-else class="form-hint">未发布（创建报告时选不到它）</span>
        </el-descriptions-item>
        <el-descriptions-item label="章节 schema 版本">
          {{ template.sectionSchemaVersion || '—' }}
        </el-descriptions-item>
      </el-descriptions>

      <!--
        🔴 平台公共模板是一堵墙，而这面墙必须自己说清楚为什么。
           后端对公共模板的上传抛 TEMPLATE_PLATFORM_NOT_EDITABLE（改它会影响所有机构），
           只把按钮 disable 掉的话，评估师会以为是自己权限不够，转去翻授权页
      -->
      <el-alert v-if="template?.platform" type="warning" :closable="false" show-icon class="mb-12px">
        <template #title>这是平台公共模板，只能看不能改</template>
        <div>
          改它会影响所有机构，所以上传、保存映射与发布在这里都是禁用的。
          要用它请回台账点「复制为机构模板」—— 复制会把 docx、占位符映射
          与已发布的版本行一起带过来，那份就是本机构自己的了。
          预览是<b>可以</b>点的：先看看它渲出来长什么样，再决定要不要复制。
        </div>
      </el-alert>

      <!-- ==================== 闸 B 面板 ==================== -->
      <el-card shadow="never" class="mb-12px">
        <template #header>
          <div class="flex items-center justify-between">
            <b>闸 B：占位符闭合</b>
            <span class="form-hint">
              ① 正向（每个占位符都能落到字段上）· ② 反向（品类必填字段都有位置）·
              ③ 渲染预演（真渲一次看有没有残留）
            </span>
          </div>
        </template>
        <el-alert
          :type="closure?.status === 'PASSED' ? 'success' : closure?.status === 'FAILED' ? 'error' : 'info'"
          :closable="false"
          show-icon
          :title="closureHeadline(closure)"
          class="mb-12px"
        />
        <el-table
          v-if="blockers.length > 0"
          class="xpy-list-table"
          :data="blockers"
          size="small"
          stripe
        >
          <el-table-column label="阻断项" width="200">
            <template #default="scope">
              <el-tag type="danger" size="small">{{ findingTypeLabel(scope.row) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="涉及占位符" width="180">
            <template #default="scope">
              <code v-if="scope.row.placeholder" class="placeholder-src">
                {{ scope.row.placeholder }}
              </code>
              <span v-else class="form-hint">—</span>
            </template>
          </el-table-column>
          <el-table-column label="后端怎么说" min-width="260">
            <template #default="scope">{{ scope.row.message }}</template>
          </el-table-column>
          <el-table-column label="去哪里改" min-width="300">
            <template #default="scope">
              <span class="fix-hint">{{ findingFixHint(scope.row) }}</span>
            </template>
          </el-table-column>
        </el-table>
        <el-table
          v-if="notes.length > 0"
          class="xpy-list-table mt-12px"
          :data="notes"
          size="small"
          stripe
        >
          <el-table-column label="不阻断的发现" width="200">
            <template #default="scope">
              <el-tag type="info" size="small">{{ findingTypeLabel(scope.row) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="涉及占位符" width="180">
            <template #default="scope">
              <code v-if="scope.row.placeholder" class="placeholder-src">
                {{ scope.row.placeholder }}
              </code>
              <span v-else class="form-hint">—</span>
            </template>
          </el-table-column>
          <el-table-column label="后端怎么说" min-width="260">
            <template #default="scope">{{ scope.row.message }}</template>
          </el-table-column>
          <el-table-column label="要不要处置" min-width="300">
            <template #default="scope">
              <span class="fix-hint">{{ findingFixHint(scope.row) }}</span>
            </template>
          </el-table-column>
        </el-table>
        <div v-if="!closure || closure.status === 'PENDING'" class="form-hint">
          还没有结论不是坏事：刚建出来、还没上传过 docx 的模板本来就是这一态。
          上传一次、或点一次「预览」，这里就会出现①②③三道的判定。
          回滚产生的新版本也是这一态（那一版当年三道全过，回滚不重跑闸 B）。
        </div>
      </el-card>

      <!-- ==================== 映射面板 ==================== -->
      <el-card shadow="never">
        <template #header>
          <div class="flex items-center justify-between">
            <b>占位符映射面板（{{ rows.length }} 处）</b>
            <span class="form-hint">
              待人工确认 {{ pendingConfirm }} 处 · 未映射且没写原因 {{ unmappedNoReason }} 处
              <template v-if="dirty > 0"> · 未保存 {{ dirty }} 处</template>
            </span>
          </div>
        </template>
        <el-alert v-if="rows.length === 0 && template?.fileId" type="info" :closable="false" show-icon>
          <template #title>
            {{ scanned ? '这份 docx 里一处占位符都没有' : '映射面板没取到：这一份还没扫成' }}
          </template>
          <div v-if="scanned">
            打开时已经重扫过库里那一份字节，扫出来是 0 处。这样的模板渲染出来是一份纯静态文档，
            出报告时所有字段都不会自动填。要出数就在 Word 里把要出数的地方写成双花括号包住字段键
            （例如建筑面积那一处写成 building_area），再点上面「上传并解析」。
          </div>
          <div v-else>
            占位符清单只能从字节里来，而打开时那一次重扫没成（还没上传过 docx，或者字节读不出来）。
            上面「下载 docx」能拿到就说明字节是好的，再点一次「上传并解析」重扫即可 ——
            已有的映射优先于本次自动判定，所以重扫<b>不会</b>把你改过的绑定冲掉。
          </div>
        </el-alert>
        <div v-else-if="rows.length > 0" class="mb-8px form-hint">
          下拉允许手输：品类的 section_schema 键与平台结构件也在后端的允许词表里，
          而前端拿不到那两份清单。打错一个字母不会静默通过 ——
          点「保存映射」后端会当场重跑闸 B ①，上面那块面板立刻告诉你是哪一处。
        </div>
        <MappingPanel
          :rows="rows"
          :baseline="baseline"
          :field-key-options="fieldKeyOptions"
          :readonly="readonly"
        />
      </el-card>

      <!-- ==================== 预览结果 ==================== -->
      <el-card v-if="preview" shadow="never" class="mt-12px">
        <template #header><b>最近一次预览（真渲染）</b></template>
        <el-alert
          v-if="preview.rendered"
          type="success"
          :closable="false"
          show-icon
          class="mb-12px"
        >
          <template #title>渲染成功</template>
          <div>
            产物用的是<b>合成样例数据</b>，只用来验版式与占位符闭合，不是任何一份真报告。
            <el-link type="primary" :underline="false" @click="openUrl(preview.url)">
              下载渲染产物（{{ preview.fileName }}）
            </el-link>
            <!--
              🔴 判「要不要提示过期」的条件是 expireSeconds 有值，**不是** presigned：
                 两种形态都会过期。presigned=false 时 url 是那条中转路由，
                 后端给它铸了一枚一次性短时效令牌，TTL 照样在 60–300 秒内
            -->
            <span v-if="preview.expireSeconds" class="form-hint">
              这个地址 {{ preview.expireSeconds }} 秒后过期，过期了就再点一次「预览」
            </span>
          </div>
        </el-alert>
        <!--
          🔴 `rendered = false` 时**不弹红条**：后端刻意不抛异常，
             因为「哪一处残留了」是要显示给他看的东西。
             弹红条他只会去重试，而重试一百次也是同一个残留
        -->
        <el-alert v-else type="warning" :closable="false" show-icon class="mb-12px">
          <template #title>渲染没成功，原因在下面</template>
          <div>不要重复点预览：同一个模板渲染一百次也是同一个原因。</div>
        </el-alert>
        <el-table
          v-if="(previewClosureNotes.blockers.length + previewClosureNotes.notes.length) > 0"
          class="xpy-list-table"
          :data="[...previewClosureNotes.blockers, ...previewClosureNotes.notes]"
          size="small"
          stripe
        >
          <el-table-column label="类型" width="200">
            <template #default="scope">
              <el-tag :type="scope.row.blocking ? 'danger' : 'info'" size="small">
                {{ findingTypeLabel(scope.row) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="后端怎么说" min-width="300">
            <template #default="scope">{{ scope.row.message }}</template>
          </el-table-column>
          <el-table-column label="去哪里改" min-width="300">
            <template #default="scope">
              <span class="fix-hint">{{ findingFixHint(scope.row) }}</span>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </template>
  </ContentWrap>

  <!-- 发布对话框 -->
  <Dialog v-model="publishVisible" title="发布这一版" width="620">
    <el-alert type="info" :closable="false" show-icon class="mb-12px">
      <template #title>发布会做三件事</template>
      <div>
        ① 从存储读回当前草稿的字节，<b>重跑闸 B 三道</b>（被校验的那一份字节就是被发布的那一份）；
        ② 把同一份字节复制成一个新文件挂到版本行上，连同映射、章节 schema 版本与闸 B 明细一起冻结；
        ③ 把新版本切成当前版。已发布的报告记的是版本行编号，所以<b>不会影响任何一份已出的报告</b>。
      </div>
    </el-alert>
    <el-form label-width="120px">
      <el-form-item :label="noteRequired ? '本版改了什么' : '本版改了什么（可空）'">
        <el-input
          v-model="publishNote"
          type="textarea"
          :rows="3"
          maxlength="500"
          show-word-limit
          :placeholder="
            noteRequired
              ? '必填。30 年后翻档案的人要能回答「这一版为什么和上一版不一样」'
              : '第 1 版留空即可，不必编一句「初始版本」'
          "
        />
      </el-form-item>
      <el-form-item label="闸 B 现状">
        <el-tag :type="closureTagType(closure)" size="small">
          {{ closureHeadline(closure) }}
        </el-tag>
        <div class="form-hint">
          这是<b>上一次解析或预览</b>时的结论。发布时会用当前草稿重跑一次，
          所以以发布返回的结果为准 —— 这里显示「通过」也不代表一定能发出去。
        </div>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button :loading="publishing" type="primary" @click="doPublish">确 定</el-button>
      <el-button @click="publishVisible = false">取 消</el-button>
    </template>
  </Dialog>

  <!-- 版本清单抽屉 -->
  <el-drawer v-model="versionsVisible" title="版本清单" size="60%">
    <div v-loading="versionsLoading">
      <el-alert type="info" :closable="false" show-icon class="mb-12px">
        <template #title>版本行是不可变的</template>
        <div>
          每一版冻结了 docx 原件、占位符映射、章节 schema 版本与当年闸 B 的<b>全部</b>明细
          （含非阻断项），随归档活 30 年。已发布的报告记的是版本行编号，
          所以回滚不会影响任何一份已出的报告。
        </div>
      </el-alert>
      <el-table class="xpy-list-table" stripe size="small" :data="versions">
        <el-table-column label="版本" width="90" align="center">
          <template #default="scope">
            第 {{ scope.row.versionNo }} 版
            <el-tag v-if="scope.row.isCurrent" type="success" size="small" class="ml-4px">
              当前
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="本版改了什么" min-width="200">
          <template #default="scope">{{ scope.row.changeNote || '—' }}</template>
        </el-table-column>
        <el-table-column label="闸 B" width="100" align="center">
          <template #default="scope">
            <el-tag
              :type="closureTagType({ status: scope.row.placeholderClosureStatus })"
              size="small"
            >
              {{
                scope.row.placeholderClosureStatusDescription ||
                labelOf(CLOSURE_STATUS_OPTIONS, scope.row.placeholderClosureStatus)
              }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="样例渲染件" width="110" align="center">
          <template #default="scope">
            <span v-if="scope.row.sampleRenderFileId">有</span>
            <!--
              🔴 回滚产生的版本这里**是空的**（回滚不重跑渲染）。
                 显示成「无」会让人以为这一版发布时渲染失败了，
                 而它其实压根没渲染过
            -->
            <span v-else class="form-hint">未渲染</span>
          </template>
        </el-table-column>
        <el-table-column
          label="发布时间"
          align="center"
          prop="publishedAt"
          width="170"
          :formatter="dateFormatter"
        />
        <el-table-column label="操作" width="180" align="center" fixed="right">
          <template #default="scope">
            <el-button link type="primary" @click="downloadVersion(scope.row)">下载原件</el-button>
            <el-button
              link
              type="warning"
              :disabled="scope.row.isCurrent"
              @click="openRollback(scope.row)"
              v-hasPermi="['qlzg:template:publish']"
            >
              回到这一版
            </el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="还没有发布过任何一版" />
        </template>
      </el-table>
    </div>
  </el-drawer>

  <!-- 回滚对话框 -->
  <Dialog v-model="rollbackVisible" title="回到某一版" width="620">
    <el-alert type="warning" :closable="false" show-icon class="mb-12px">
      <template #title>回滚不是把版本号改回去</template>
      <div>
        它会以那一版的内容<b>新发布一版</b>，版本号<b>继续递增</b>。
        把号设回去会让「谁在什么时候把这个模板退回了哪一版」这件事不留痕迹，而那正是审计对象。
        回滚<b>不重跑</b>闸 B（那一版当年三道全过，而闸 B 的输入在版本行上是冻结的），
        所以返回的闸 B 状态是「还没有结论」，不要把它读成「未通过」。
      </div>
    </el-alert>
    <el-form label-width="120px">
      <el-form-item label="回到哪一版">
        <el-select v-model="rollbackTarget" placeholder="请选择" class="w-full">
          <el-option
            v-for="item in rollbackOptionList"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="为什么退回">
        <el-input
          v-model="rollbackNote"
          type="textarea"
          :rows="3"
          maxlength="500"
          show-word-limit
          placeholder="必填。它要回答的是「谁在什么时候把这个模板退回了哪一版」"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button :loading="rollingBack" type="primary" @click="doRollback">确 定</el-button>
      <el-button @click="rollbackVisible = false">取 消</el-button>
    </template>
  </Dialog>
</template>
<script lang="ts" setup>
import { dateFormatter } from '@/utils/formatTime'
import {
  QlzgCategoryApi,
  mergeSectionFieldKeys,
  templateFieldKeyOptionsOf,
  type QlzgCategorySectionVO,
  type QlzgCategoryVO
} from '@/api/qlzg/category'
import {
  QlzgTemplateApi,
  type QlzgTemplateClosureVO,
  type QlzgTemplatePreviewVO,
  type QlzgTemplateSuggestionVO,
  type QlzgTemplateVO,
  type QlzgTemplateVersionVO
} from '@/api/qlzg/template'
import { CLOSURE_STATUS_OPTIONS, REPORT_TYPE_OPTIONS, labelOf } from '@/views/qlzg/constants'
import MappingPanel from './MappingPanel.vue'
import {
  autoMappedRateText,
  baselineOf,
  buildEdits,
  closureHeadline,
  closureTagType,
  dirtyCount,
  findingFixHint,
  findingTypeLabel,
  nextVersionNo,
  panelRows,
  pendingConfirmCount,
  rollbackNoteDraft,
  rollbackOptions,
  splitFindings,
  unmappedNoReasonCount,
  type MappingBaseline
} from './templateFlow'

/**
 * 模板设计器 —— 上传 docx → 映射面板 → 闸 B → 预览 → 发布 → 版本 / 回滚
 *
 * <h3>🔴 这一页是**静态路由**，不是菜单</h3>
 * 它只能从模板台账某一行的「设计」进来（入参只有一个模板编号），
 * 自己不持任何权限点。按本仓那条纪律 ——「页面自己带权限点（或有按钮子菜单）⟹ 建菜单；
 * 一个都不带 ⟹ 写在 remaining.ts」—— 它写在 `remaining.ts` 里。
 * 建成菜单的后果是：不持权限点的页面菜单进不了非超管的导航集合
 * （`GrantDecisionService#listAllowedMenuIdsInternal` 跳过 `menu_id IS NULL` 的行），
 * 前端路由压根不注册，敲 URL 落到 404 —— 而本仓 404 的 HTTP 状态码是 200，
 * 控制台与后端日志都干净。I2-g 的案例召回页就是这么坏掉的。
 *
 * <h3>🔴 闸 B 的结论**只读不判**</h3>
 * `closure.passed` / `blockingCount` / 每条 finding 的 `blocking` 全是后端给的，
 * 这一页一次都没有自己数过 findings。数两次的后果是两份真相：
 * 后端的允许词表随品类 schema 变、且 `MISSING_REQUIRED_FIELD` 的必填集合
 * 还按交付物类型分派过一次（技术报告 16 个 / 结果报告 6 个），
 * 前端复刻不了那份分派 —— 复刻的表现是界面显示「可以发布」、点了报错。
 * 所以「发布」按钮**不按闸 B 状态 disable**，让人点了看后端怎么说。
 *
 * <h3>⚠️ 预览与成文都会往 `infra_file` 写一份产物，而它们没有保留期策略</h3>
 * 那条欠账在 I6。所以预览按钮是**人手点**的，绝不放进 `watch`：
 * 一个漏了条件的 watch 会在几分钟里攒出几百份没人看的产物，
 * 而它们都算客户的存储账单。后端也加了 60 次/分钟/人的限流兜底。
 */
defineOptions({ name: 'QlzgTemplateDesigner' })

const message = useMessage()
const route = useRoute()
const router = useRouter()

const MAX_DOCX_BYTES = 16 * 1024 * 1024

const templateId = computed(() => {
  const raw = route.query.templateId
  const text = Array.isArray(raw) ? raw[0] : raw
  const parsed = Number(text)
  // 🔴 `Number('')` 与 `Number(undefined)` 分别是 0 与 NaN，
  //    0 会被当成一个合法的模板编号发出去，后端回一句「模板不存在」，
  //    用户看到的结论就成了「设计器坏了」
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
})

const loading = ref(false)
const loadError = ref('')
const template = ref<QlzgTemplateVO | null>(null)
const category = ref<QlzgCategoryVO | null>(null)
const sections = ref<QlzgCategorySectionVO[]>([])
const rows = ref<QlzgTemplateSuggestionVO[]>([])
const baseline = ref<MappingBaseline>({})
const closure = ref<QlzgTemplateClosureVO | null>(null)
const autoMappedRatePercent = ref<number | null>(null)
const parseFileName = ref('')
const preview = ref<QlzgTemplatePreviewVO | null>(null)
/**
 * 打开设计器时那一次「只扫不写」成没成
 *
 * 🔴 它决定空面板那一句提示说的是什么，而两种空是**两件事**：
 *    扫过了、真的 0 处占位符 ⟹ 这份 Word 是纯静态的；
 *    没扫成（还没上传 docx / 没有查看权 / 存储读不出字节）⟹ 面板空是**没查到**，
 *    不是「没有」。把后者说成前者，评估师会去重做一份模板
 */
const scanned = ref(false)

const parsing = ref(false)
const saving = ref(false)
const previewing = ref(false)
const downloading = ref(false)

/** 🔴 平台公共模板只能看：上传 / 保存映射 / 发布全部禁用，预览可以点 */
const readonly = computed(() => template.value?.platform === true)

const dirty = computed(() => dirtyCount(rows.value, baseline.value))
const pendingConfirm = computed(() => pendingConfirmCount(rows.value))
const unmappedNoReason = computed(() => unmappedNoReasonCount(rows.value))
const categoryName = computed(() => category.value?.categoryName ?? template.value?.categoryCode ?? '—')
const fieldKeyOptions = computed(() =>
  mergeSectionFieldKeys(templateFieldKeyOptionsOf(category.value), sections.value)
)

/**
 * 闸 B 的两组发现
 *
 * 🔴 写成两个 `computed` 而不是 `const { blockers, notes } = computed(...).value`：
 *    后者在 setup 那一刻就把值取出来了，之后 `closure` 再怎么变这两个数组都不动 ——
 *    而设计器的整个交互就是「改一次绑定 → 面板跟着变」。
 *    它不报错，只是面板永远停在刚进页面时那一份结论上
 */
const closureSplit = computed(() => splitFindings(closure.value))
const blockers = computed(() => closureSplit.value.blockers)
const notes = computed(() => closureSplit.value.notes)
const previewClosureNotes = computed(() => splitFindings(preview.value?.closure))

const load = async (withScan = true) => {
  const id = templateId.value
  if (!id) return
  loading.value = true
  loadError.value = ''
  try {
    template.value = await QlzgTemplateApi.getTemplate(id)
    // 🔴 品类详情与章节树都**失败得起**：它们只是映射面板下拉里的候选清单，
    //    下拉仍然允许手输（allow-create），所以拿不到清单不影响改绑定。
    //    两个请求各自 try：章节树挂了不该把已经拿到的 param_schema 一起丢掉
    const code = template.value?.categoryCode
    try {
      category.value = code ? await QlzgCategoryApi.getCategory(code) : null
    } catch {
      category.value = null
    }
    try {
      sections.value = code ? ((await QlzgCategoryApi.getSectionList(code)) ?? []) : []
    } catch {
      sections.value = []
    }
    // 🔴 台账列表**不带** suggestions：一份四十页的 docx 能解析出上百行，
    //    把它塞进列表接口会让台账打开一次拉几 MB。面板那一份由下面的 /scan 单独取
    closure.value = {
      status: template.value?.placeholderClosureStatus ?? 'PENDING',
      statusDescription: template.value?.placeholderClosureStatusDescription ?? '',
      passed: null,
      blockingCount: null,
      findings: (template.value?.placeholderClosureDetail ?? []) as any[]
    }
    await scanIntoPanel(id, withScan)
  } catch (e: any) {
    template.value = null
    loadError.value = e?.message || '模板加载失败'
  } finally {
    loading.value = false
  }
}

/**
 * 打开设计器时把映射面板填出来 —— **只取 suggestions，不动闸 B 那一块**
 *
 * 🔴 刻意不复用 `applyParseResult`：那个会把 `closure` 一起换成**本次**扫描的结论，
 *    而 `/scan` 只跑闸 B ①②，模板行上冻结的是发布那一次的 ①②③。
 *    换掉之后同一份模板在面板上与在台账上会给出两个不同的闸 B 结论，
 *    而发布时「渲染预演」那一条发现会从面板上直接消失
 *
 * 🔴 失败得起：还没上传 docx（`TEMPLATE_NO_DOCX`）、只有查看权、存储读不出字节，
 *    都不该把已经拿到的模板行一起丢掉 —— 那会让整页退化成一句「模板加载失败」，
 *    而模板行本身是好的
 *
 * 🔴 `withScan = false` 由调用方在**解析之后**与**保存绑定之后**那两处传进来：
 *    那两个接口返回的就是与 `/scan` 同形的结果，面板已经由 `applyParseResult` 填过了，
 *    再扫一遍等于「改一次绑定就多读一次几十兆的 docx」，而那份字节刚被同一个接口读过。
 *    发布之后仍然扫（闸 B ③ 会重写 `placeholder_closure_detail`），回滚之后更要扫
 *    （**回滚把 `field_mapping` 换成了旧版本的快照**，面板上的行跟着变）。
 *    跳过时 `scanned` 保持原值不动：面板没被清空，说「没取到」就是假话。
 */
const scanIntoPanel = async (id: number, withScan = true) => {
  if (!withScan) return
  scanned.value = false
  if (!template.value?.fileId) return
  try {
    const result = await QlzgTemplateApi.scanTemplate(id)
    rows.value = panelRows(result?.suggestions)
    baseline.value = baselineOf(result?.suggestions)
    parseFileName.value = result?.fileName ?? parseFileName.value
    scanned.value = true
  } catch {
    rows.value = []
    baseline.value = {}
  }
}

/**
 * 用一次解析 / 保存映射的返回整体替换面板
 *
 * 🔴 **必须**同时替换 `rows` 与 `baseline`：基线过期之后
 *    `buildEdits` 会把上一次已经存进去的改动再发一遍，
 *    而重发一次绑定会把 `boundBy` 从 STRUCTURAL / AUTO_* 一律改写成 MANUAL
 *    —— 「平台自动认出来的」悄悄变成「人工指定的」，
 *    §11.17.3 第 ① 条的自动映射率从此对不上账
 */
const applyParseResult = (result: any) => {
  if (!result) return
  rows.value = panelRows(result.suggestions)
  baseline.value = baselineOf(result.suggestions)
  closure.value = result.closure ?? null
  autoMappedRatePercent.value = result.autoMappedRatePercent ?? null
  parseFileName.value = result.fileName ?? parseFileName.value
}

const fileInputRef = ref<HTMLInputElement>()
const pickFile = () => fileInputRef.value?.click()

const onFilePicked = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  // 🔴 立刻清空 value：不清的话同一个文件改完再选一次不会触发 change，
  //    而「我明明重新选了」和「按钮没反应」在界面上长得一样
  input.value = ''
  if (!file || !templateId.value) return
  if (!file.name.toLowerCase().endsWith('.docx')) {
    message.error('只接受 .docx。老版 .doc 要先在 Word 里另存为 .docx')
    return
  }
  if (file.size > MAX_DOCX_BYTES) {
    message.error(
      `这份 docx 有 ${(file.size / 1024 / 1024).toFixed(1)} MB，超过服务端 16 MB 的单文件上限。` +
        '超限是框架层拦的、没有业务错误码，所以这里先自己拦一道'
    )
    return
  }
  parsing.value = true
  try {
    applyParseResult(await QlzgTemplateApi.parseDocx(templateId.value, file))
    message.success('解析完成，闸 B ①② 已重跑')
    await load(false)
  } finally {
    parsing.value = false
  }
}

const saveMapping = async () => {
  const id = templateId.value
  if (!id) return
  // 🔴 增量：只发动过的那几个键。把整张面板发上去会把 `confirmed = null`
  //    （不动这个标记）的语义变成「撤销确认」，评估师点过的确认会全没
  const edits = buildEdits(rows.value, baseline.value)
  if (edits.length === 0) return
  saving.value = true
  try {
    applyParseResult(await QlzgTemplateApi.saveMapping({ templateId: id, edits }))
    message.success(`已保存 ${edits.length} 处改动，闸 B ①② 已重跑`)
    await load(false)
  } finally {
    saving.value = false
  }
}

const doPreview = async () => {
  const id = templateId.value
  if (!id) return
  if (dirty.value > 0) {
    try {
      await message.confirm(
        `映射面板上还有 ${dirty.value} 处改动没保存。预览渲染用的是已保存的那一份映射，` +
          '现在预览看不到你刚改的东西。要先保存吗？'
      )
      await saveMapping()
    } catch {
      return
    }
  }
  previewing.value = true
  try {
    preview.value = await QlzgTemplateApi.previewRender(id)
    if (preview.value?.rendered) {
      message.success('渲染成功，可以下载产物看版式')
    }
    // 🔴 rendered = false 时**不弹红条**：原因就在下面那块面板里，
    //    弹红条他只会去重试，而重试一百次也是同一个残留
  } finally {
    previewing.value = false
  }
}

/**
 * 打开一个地址
 *
 * 🔴 `presigned = false` 时 url 是 `/infra/file/{configId}/get/**` 那条中转路由，
 *    它在 infra 的 SecurityConfiguration 里挂着 **permitAll**（`window.open` 带不上
 *    `Authorization` 头），所以不需要带**登录态**。
 *    🔴 但地址必须**原样**交出去：非 S3 介质下它带着 `?relay_token=…`，
 *    那是放行判据的一半，而且是**单程票**（后端核销时是一条 Redis DEL）。
 *    自己拼地址或剪掉 query 的表现是 403「该文件不允许通过此通道下载」，看着像权限没配。
 *    与 MaterialPanel / MaterialTextDialog 用的是同一条路
 */
const openUrl = (url?: string | null) => {
  if (!url) {
    message.error('没有拿到下载地址')
    return
  }
  window.open(url, '_blank')
}

const downloadDraft = async () => {
  const id = templateId.value
  if (!id) return
  downloading.value = true
  try {
    // 🔴 每次点都重新取一次地址，不复用解析返回里那个：
    //    直链会过期，而设计器是评估师一开就是一整天的页面
    const result = await QlzgTemplateApi.downloadUrl(id)
    openUrl(result?.url)
  } finally {
    downloading.value = false
  }
}

const downloadVersion = async (version: QlzgTemplateVersionVO) => {
  const id = templateId.value
  if (!id) return
  const result = await QlzgTemplateApi.downloadUrl(id, version.id)
  if (result?.frozen) {
    message.info('这是版本行上冻结的原件，下载下来改不会生效（版本不可变）')
  }
  openUrl(result?.url)
}

// ==================== 发布 ====================

const publishVisible = ref(false)
const publishing = ref(false)
const publishNote = ref('')
const versions = ref<QlzgTemplateVersionVO[]>([])
const noteRequired = computed(() => versions.value.length > 0)

const openPublish = async () => {
  if (dirty.value > 0) {
    message.warning(`映射面板上还有 ${dirty.value} 处改动没保存。先保存再发布`)
    return
  }
  publishNote.value = ''
  await loadVersions()
  publishVisible.value = true
}

const loadVersions = async () => {
  const id = templateId.value
  if (!id) return
  try {
    versions.value = (await QlzgTemplateApi.getVersionList(id)) ?? []
  } catch {
    versions.value = []
  }
}

const doPublish = async () => {
  const id = templateId.value
  if (!id) return
  if (noteRequired.value && !publishNote.value.trim()) {
    message.error('这不是第 1 版，必须写一句本版改了什么')
    return
  }
  publishing.value = true
  try {
    const result = await QlzgTemplateApi.publish(id, publishNote.value.trim() || null)
    publishVisible.value = false
    // 🔴 D15 第 ⑥ 条：reserved 非空时必须明示「公章位已预留，签章功能在 I30」，
    //    否则评估师会以为平台把他的公章位弄丢了
    const reserved = result?.reserved ?? []
    message.success(
      `第 ${result?.versionNo ?? nextVersionNo(versions.value)} 版已发布` +
        (reserved.length > 0
          ? `。公章位已预留（${reserved.join('、')}），签章功能在 I30，导出时该位留空`
          : '')
    )
    await load()
    await loadVersions()
  } finally {
    publishing.value = false
  }
}

// ==================== 版本清单 / 回滚 ====================

const versionsVisible = ref(false)
const versionsLoading = ref(false)
const rollbackVisible = ref(false)
const rollingBack = ref(false)
const rollbackTarget = ref<number | null>(null)
const rollbackNote = ref('')
const rollbackOptionList = computed(() => rollbackOptions(versions.value))

const openVersions = async () => {
  versionsVisible.value = true
  versionsLoading.value = true
  try {
    await loadVersions()
  } finally {
    versionsLoading.value = false
  }
}

const openRollback = (version: QlzgTemplateVersionVO) => {
  rollbackTarget.value = version.versionNo ?? null
  // 🔴 预填而不留空：回滚说明是必填的，而它要回答的是「退回了哪一版」。
  //    留空的话评估师会写「回滚」两个字，那两个字回答不了这个问题
  rollbackNote.value = rollbackNoteDraft(version.versionNo)
  rollbackVisible.value = true
}

const doRollback = async () => {
  const id = templateId.value
  if (!id || rollbackTarget.value == null) return
  if (!rollbackNote.value.trim()) {
    message.error('必须写一句为什么退回')
    return
  }
  rollingBack.value = true
  try {
    await QlzgTemplateApi.rollback(id, rollbackTarget.value, rollbackNote.value.trim())
    rollbackVisible.value = false
    message.success('已按那一版的内容新发布了一版（版本号继续递增）')
    await load()
    await loadVersions()
  } finally {
    rollingBack.value = false
  }
}

const goBack = () => {
  // 🔴 走 path 不走 name：菜单的 component_name 一旦没填，push({ name }) 就是一次
  //    静默失败（vue-router 只在控制台 warn，界面停在原地），而 path 是建菜单时必填的
  router.push({ path: '/qlzg/template' })
}

/**
 * 带着未保存的改动离开要拦一道
 *
 * 🔴 拦的是**路由离开**，不是浏览器关闭（那要 beforeunload，而现代浏览器
 *    只能显示一句自己写的话，写什么都一样）。
 *    路由这一道值得拦：设计器的典型走法是「改一半 → 想起来要去看一眼台账 → 点回去」，
 *    而不拦的话他回来时面板是刚解析出来的样子，改过的那几处一个都不剩，
 *    且没有任何提示 —— 他会以为自己没改过
 */
onBeforeRouteLeave(async () => {
  if (dirty.value === 0) return true
  try {
    await message.confirm(
      `映射面板上还有 ${dirty.value} 处改动没保存，离开就没了。要现在保存吗？`
    )
    await saveMapping()
    return true
  } catch {
    return false
  }
})

watch(
  templateId,
  (id) => {
    if (id) {
      load()
    } else {
      template.value = null
      rows.value = []
      baseline.value = {}
      closure.value = null
      preview.value = null
      loadError.value = ''
    }
  },
  { immediate: true }
)
</script>
<style lang="scss" scoped>
.hidden-file-input {
  display: none;
}

.form-hint {
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}

.fix-hint {
  font-size: 12px;
  line-height: 1.6;
}

.placeholder-src {
  padding: 1px 4px;
  font-family: var(--el-font-family-mono, monospace);
  font-size: 12px;
  background: var(--el-fill-color-light);
  border-radius: 2px;
}
</style>
