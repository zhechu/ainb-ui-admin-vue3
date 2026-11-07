<template>
  <el-drawer v-model="visible" title="这一格的依据" size="720">
    <div v-loading="loading">
      <!--
        🔴 这句是给验收 D8 判据②用的：它印在弹层上，评估师签字那一刻看得见。
           而它之所以能这么写，靠的是后端那个端点只 select qlzg_provenance 一张表、
           一个 join 都没有 —— 不是靠「我们承诺不接模型」。
           ⚠️ 文案里刻意不出现表名：那是给开发看的，评估师读到只会以为那是某个编号
      -->
      <div class="lede">
        本页每一个字都取自留存的溯源记录，<b>没有一句由模型生成</b>。
        原文快照是取证那一刻写下来的，此后不会随资料改动而变。
      </div>

      <div v-if="loaded && rows.length === 0" class="empty-box">
        这一格还没有依据。定稿那道闸会拦住「有数值却没有出处」的格，
        所以在定稿之前要么补上依据，要么把这一格清空。
      </div>

      <!--
        🔴 渲染**全部**行，不是只渲染第一条。一格可以有多行
           （比较法的一个单价同时来自测算与三条案例），
           而写错一条要更正时也是【再加一行】—— 那张表没有 update。
           只渲染第一条的话「更正行」永远显示不出来，而两行都在才是诚实的档案
      -->
      <div v-for="(row, idx) in rows" :key="row.id" class="prov-row">
        <div class="prov-head">
          <el-tag :type="provenanceSourceTagType(row.sourceType)" size="small">
            <Icon :icon="provenanceSourceIcon(row.sourceType)" class="prov-icon" />
            {{ provenanceSourceLabel(row) }}
          </el-tag>
          <span v-if="rows.length > 1" class="prov-seq"
            >第 {{ idx + 1 }} / {{ rows.length }} 条</span
          >
          <span class="prov-id mono">溯源编号 #{{ row.id }}</span>
        </div>

        <div class="prov-item">
          <div class="prov-label">定位</div>
          <!--
            🔴 原样显示，不解析、不重新格式化。它是写下来那一刻的一份快照，
               前端另拼一份的话，弹层与 Excel 批注会对同一个事实给出两种写法，
               质询现场会被当成两份不同的证据
          -->
          <div class="prov-locator">{{ row.locator }}</div>
        </div>

        <div class="prov-item">
          <div class="prov-label">原文快照</div>
          <!--
            🔴 pre-wrap 的纯文本。**不得** v-html、**不得** trim、**不得**美化。
               不用 v-html 不是风格问题：原文里可能有 <script>（资料是从外部上传的），
               那是存储型 XSS，而这一列恰好是全模块唯一一个
               「把用户文件里的字节直接下发给浏览器」的口。
               不美化也不是洁癖：三年后质询现场比对的是这一段字节与那份纸质资料，
               动过之后就对不上了，而对不上的那一份是平台改的
          -->
          <div class="prov-snapshot">{{ row.snapshotText }}</div>
        </div>

        <div v-if="row.formulaText" class="prov-item">
          <!--
            🔴 标题按类型切：CALC 装可读算式，TEMPLATE 装准则条款号（同一列，两种东西）。
               写死成「算式」的话模板类那行会显示成「算式：《…准则》第 12 条」，
               读的人会去找那个乘法在哪里
          -->
          <div class="prov-label">{{ provenanceFormulaLabel(row.sourceType) }}</div>
          <div class="prov-formula mono">{{ row.formulaText }}</div>
        </div>

        <div v-if="confidenceTextOf(row) !== null" class="prov-item">
          <!--
            🔴 只有 AI 类有这一栏，其余各类**整栏不显示**（不是显示成「—」）：
               给一份政府发布文件挂一个空的置信度栏，会让人以为「这一项本该有、只是没填」，
               而事实是它不该有 —— 其余各类的依据是确定的
          -->
          <div class="prov-label">本依据置信度</div>
          <div class="prov-confidence">{{ confidenceTextOf(row) }}</div>
        </div>

        <div v-if="row.attribution" class="prov-item">
          <!--
            🔴 这是【合同义务】不是客套话（闸 G-10 / R47）。它不在渲染时 join 数据源 ——
               署名要求后来改了，已出报告的署名不能跟着改
          -->
          <div class="prov-label">署名要求</div>
          <div class="prov-attribution">{{ row.attribution }}</div>
        </div>

        <div v-if="row.originUrl" class="prov-item">
          <div class="prov-label">原网页</div>
          <div class="prov-origin">
            <el-link type="primary" :href="row.originUrl" target="_blank" rel="noopener">
              去看看原网页
            </el-link>
            <!--
              🔴 提示**不是**报错：链接会失效（案例来源网站三年后下线是常态），
                 而它失效不影响这一行的证据力 —— 证据力在原文快照上。
                 弹一个红色错误框会让人以为「这条溯源坏了」，进而怀疑报告上那个数
            -->
            <span class="prov-origin-hint">{{ PROVENANCE_ORIGIN_URL_DEAD_HINT }}</span>
          </div>
        </div>

        <div v-if="row.snapshotFileId" class="prov-item">
          <div class="prov-label">原件文件</div>
          <div class="prov-file">
            <span class="mono">文件编号 #{{ row.snapshotFileId }}</span>
            <el-button
              link
              type="primary"
              :loading="openingFileId === row.snapshotFileId"
              @click="openSnapshotFile(row)"
            >
              查看原件
            </el-button>
          </div>
          <div class="prov-file-hint">
            点开原件核一眼：抽取抽错（乱码、只抽到页眉页脚）不会报错，
            状态照样是「成功」，只有对着原件看才发现。
          </div>
        </div>

        <div class="prov-meta">
          <div>
            <span class="prov-label">取证时刻</span>
            <span class="mono">{{ formatDate(row.snapshotAt) || '（未记录）' }}</span>
          </div>
          <div>
            <span class="prov-label">入库时刻</span>
            <span class="mono">{{ formatDate(row.createTime) || '（未记录）' }}</span>
          </div>
          <div>
            <span class="prov-label">谁写下的</span>
            <span>{{ row.creatorNickname || '（查不到用户）' }}</span>
            <!--
              🔴 编号与人名一起给：人名会被改，编号不会。
                 「这一行是谁写的」在档案意义上认的是编号，人名只是当下好读
            -->
            <span v-if="row.creator" class="mono prov-creator">（编号 {{ row.creator }}）</span>
          </div>
        </div>
      </div>
    </div>
  </el-drawer>
</template>
<script lang="ts" setup>
import { QlzgFileApi } from '@/api/qlzg/file'
import { QlzgProvenanceApi, type QlzgProvenanceVO } from '@/api/qlzg/provenance'
import { formatDate } from '@/utils/formatTime'
import {
  PROVENANCE_ORIGIN_URL_DEAD_HINT,
  provenanceConfidenceText,
  provenanceFormulaLabel,
  provenanceSourceIcon,
  provenanceSourceLabel,
  provenanceSourceTagType
} from '@/views/qlzg/constants'

/**
 * 溯源弹层（§11.8.3 / 验收 D8）
 *
 * <h3>🔴 验收 D8 的四条判据里有三条落在本组件上</h3>
 * <ul>
 * <li><b>①「随机点 10 个数字，10 个全部弹出溯源层」</b>——
 *     「全部」是判据，所以调用方**不要**按「这一格有没有 `provenanceId`」决定能不能点：
 *     那一列是「主出处」，可空；而一格可以在它之外**另挂**若干行
 *     （资料原文依据就是走 `/field/attach-material` 追加的，压根不碰那一列）。
 *     按主出处判可点，D8 的十次点击里就会有几次弹不出来。
 *     本组件对**任何** fieldId 都发一次请求，空结果由那句提示兜住。</li>
 * <li><b>②「内容 100% 来自 `qlzg_provenance`，无一句 LLM 生成」</b>——
 *     后端那个端点只 select 那一张表、一个 join 都没有，所以这条不是靠承诺保证的，
 *     是靠**取数口只有这一张表**保证的。本组件不补任何一个字：
 *     🔴 尤其**不要**拿 `sourceId` 去查案例名 / 参数名 / 模板名再拼进来 ——
 *     那会让「三年后还能读」变成假的（那些名字只存在于活表，活表会被改）。</li>
 * <li><b>③「显示快照本身而不是一个链接」</b>——「本身」就是 {@code snapshotText}。
 *     🔴 「查看原件」那个按钮是**加在快照之外**的，不是它的替代品：
 *     判据要的是「不点开也能读到那句话的出处」，原件是「怀疑抽取抽错了」才去核的第二手。
 *     把 {@code snapshotText} 换成一个按钮，判据③ 就废了 ——
 *     而原件文件是**弱引用**（文件被删、或属于直下受理范围之外的类别都会打不开），
 *     三年后翻档案时可能只剩弹层里这一段字节还能读。</li>
 * </ul>
 *
 * <h3>🔴 {@code REPORT_ONLY} 形态下溯源照常写、弹层照常弹（D8 判据⑤）</h3>
 * 退化形态开关（I6-f）关掉的是**工作流**与**归档**，
 * 而溯源属于 {@code core} 组、任何形态下都在 ——
 * 所以本组件**不**读任何形态开关。挂一个 {@code v-if} 在这里，
 * 就等于让「关掉工作流」顺手关掉了法定报告的举证能力
 *
 * <h3>⚠️ 两种打开方式，取数口不同</h3>
 * {@code open({ fieldId })} 走 {@code list-by-field}（返回数组，一格可以有多行）；
 * {@code open({ provenanceId })} 走 {@code get}（返回一行）。
 * 🔴 后者**先判空再调**：那几列都是可空的，拿一个 null 或一个悬空的编号打过来
 * 会得到一个报错弹框，而「这一格还没有依据」应当显示成一句提示，不是一个错误
 *
 * @author 走进新时代
 */
defineOptions({ name: 'QlzgProvenanceDrawer' })

const visible = ref(false)
const loading = ref(false)
const loaded = ref(false)
const rows = ref<QlzgProvenanceVO[]>([])
/** 正在签发原件地址的那一行的 `snapshotFileId`；null = 没有请求在飞 */
const openingFileId = ref<number | null>(null)

const confidenceTextOf = (row: QlzgProvenanceVO): string | null =>
  provenanceConfidenceText(row.confidence)

const open = async (query: { fieldId?: number; provenanceId?: number }) => {
  visible.value = true
  loading.value = true
  loaded.value = false
  rows.value = []
  try {
    if (query.provenanceId != null) {
      rows.value = [await QlzgProvenanceApi.get(query.provenanceId)]
    } else if (query.fieldId != null) {
      rows.value = await QlzgProvenanceApi.getListByField(query.fieldId)
    }
  } catch {
    // 🔴 吞掉：request 那层已经弹过一次错误提示了，这里再弹一次就是两个框。
    //    抽屉保持打开、显示空态，比「点一下弹层闪一下就没了」要好排查
  } finally {
    loading.value = false
    loaded.value = true
  }
}

/**
 * 打开这一行的原件（V5 §11.14.1 采集点表里「溯源弹层打开 snapshot_file_id」那一行）
 *
 * <h3>🔴 用途一律填 `DOWNLOAD`，不按 `sourceType` 分流</h3>
 * 两个理由，第一条就够：采集点表把这一格记的就是 `DOWNLOAD` / `OUT`；
 * 而它同时**也是**后端受理的三类文件（资料 / 报告 / 案例佐证）唯一都允许的用途 ——
 * 案例佐证**只有** `DOWNLOAD`（佐证是截图与合同扫描件，界面上从来没有「在线看佐证」这个动作，
 * 而「下载」与「预览」在账单上是两行、两个价）。
 *
 * <p>⚠️ 于是**不要**「优化」成按 `row.sourceType` 决定填 `PREVIEW` 还是 `DOWNLOAD`：
 * 那等于把后端 `biz_type → 允许的用途` 那张表在前端再抄一份，
 * 而 `sourceType` 与 `biz_type` 本来就不是一一对应（同一类溯源可以指向不同类的文件）。
 * 两份映射漂开的表现是「某一类行点原件恒报用途不允许」，而报错里列的允许用途
 * 与前端填的那个都看着挺合理，查起来像是后端在乱拒。
 *
 * <h3>🔴 点击那一刻才签发，弹层加载时**不预取**</h3>
 * 每次成功签发都会在 `infra_file_usage_log` 落一行 `INTENT`，那是**只追加的收费依据**。
 * 一格可以挂多行溯源（比较法的一个单价同时来自测算与三条案例），
 * 渲染时逐行预取 = 用户只看一眼就凭空多出三四条下行计费，
 * 而账上看不出它与「用户真的看了三四次」有什么区别。
 * `openingFileId` 那一道互斥也是为此：连点两下就是两条计量行、两笔钱。
 *
 * <p>⚠️ 中转那一支（`presigned = false`）落的是 `RELAY` 而不是 `INTENT`（字节真的出去之后才记），
 * 但「点击那一刻才调」这条纪律**一字不改**：每调一次就铸一枚新的有效令牌，
 * 而 TTL 之内谁捡到都能用一次。理由见 `src/api/qlzg/file/index.ts`。
 *
 * <h3>⚠️ `presigned = false` 不是错误，一个字都不提示</h3>
 * 私有化部署（LOCAL / FTP / SFTP）物理上签不出直链，后端在 `FileServiceImpl#presignGetUrl`
 * 内部就接住了，回一条**带一次性令牌**的中转路由地址（`?relay_token=…`），
 * `window.open` 直接能开。把它渲染成警告，
 * 等于告诉私有化客户「你的部署坏了」—— 而它是这类部署的**常态**。
 *
 * <p>⚠️ 失败一律吞掉：`snapshot_file_id` 是**弱引用**，文件被删了、
 * 或者它属于受理范围之外的类别（模板、公章图），后端都会拒。
 * 那一次拒绝由 axios 那层弹**一次**错误提示就够了，这里再弹就是两个框。
 */
const openSnapshotFile = async (row: QlzgProvenanceVO) => {
  const fileId = row.snapshotFileId
  if (fileId == null || openingFileId.value !== null) {
    return
  }
  openingFileId.value = fileId
  try {
    const result = await QlzgFileApi.presignGet({ fileId, action: 'DOWNLOAD' })
    // 🔴 拿到就立刻用，不存进任何 ref，也【原样】交给 window.open —— 两种形态都会过期：
    //    直链是对象存储的签名（无状态 HMAC，服务端无法吊销，短 TTL 是唯一的收口手段），
    //    中转是 query 上那枚 relay_token，而它是【单程票】：后端核销时是一条 Redis DEL。
    //    ⚠️ 自己拼地址或剪掉 query 的表现是 403「该文件不允许通过此通道下载」，看着像权限没配
    window.open(result.url, '_blank')
  } catch {
    // 见方法注释：错误提示由 axios 那层负责，这里不重复弹
  } finally {
    openingFileId.value = null
  }
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

.prov-row {
  padding: 12px;
  margin-bottom: 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
}

.prov-head {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 10px;
}

.prov-icon {
  margin-right: 2px;
}

.prov-seq {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.prov-id {
  margin-left: auto;
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}

.prov-item {
  margin-bottom: 10px;
}

.prov-label {
  margin-right: 6px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.prov-locator {
  font-size: 13px;
  line-height: 1.6;
}

/* 🔴 white-space: pre-wrap 是这一栏的全部要求：换行与多余空格都要照原样保留 */
.prov-snapshot {
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.8;
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--el-fill-color-lighter);
  border-left: 3px solid var(--el-color-primary-light-5);
  border-radius: 2px;
}

.prov-formula {
  font-size: 13px;
  line-height: 1.7;
  word-break: break-all;
}

.prov-confidence {
  font-size: 13px;
  font-weight: 600;
}

.prov-attribution {
  font-size: 13px;
  line-height: 1.7;
}

.prov-origin {
  display: flex;
  gap: 8px;
  align-items: baseline;
  flex-wrap: wrap;
}

.prov-origin-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.prov-file {
  display: flex;
  gap: 10px;
  align-items: baseline;
  font-size: 12px;
  color: var(--el-text-color-regular);
}

.prov-file-hint {
  margin-top: 2px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}

.prov-meta {
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
  padding-top: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  border-top: 1px dashed var(--el-border-color-lighter);
}

.prov-creator {
  margin-left: 4px;
}

.mono {
  font-family: var(--el-font-family-mono, monospace);
}
</style>
