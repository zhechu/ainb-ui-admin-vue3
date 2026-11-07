<template>
  <Dialog v-model="visible" :title="`导出${ledgerName}`" width="560px">
    <el-form label-width="96px" label-position="left">
      <el-form-item label="导出范围">
        <el-radio-group v-model="scope">
          <el-radio value="CURRENT_PAGE">
            当前页
            <span class="le-hint">（第 {{ pageNo }} 页，最多 {{ pageSize }} 条）</span>
          </el-radio>
          <el-radio value="ALL">
            全部
            <span class="le-hint">（按当前查询条件，共 {{ total }} 条）</span>
          </el-radio>
        </el-radio-group>
      </el-form-item>

      <el-form-item v-if="contentHints.length" label="导出内容">
        <div class="le-block">
          <div v-for="hint in contentHints" :key="hint" class="le-hint">{{ hint }}</div>
        </div>
      </el-form-item>

      <!--
        扩展字段这一段是四个宿主**共有**的事实，所以写死在组件里、不让调用方各自传：
        它描述的是 QlzgExtColumnExporter 的行为，四个宿主的导出走的是同一个方法。
        各宿主自己那份说明（哪些列不导、哪一列是脱敏的）走 contentHints
      -->
      <el-form-item label="扩展字段">
        <div class="le-block">
          <div class="le-hint">
            机构自定义的字段按「字段管理」里的顺序追加在最后；勾了「不导出」的不追加。
          </div>
          <div class="le-hint">
            <b>已停用的字段仍然导出</b> —— 停用只是不再让新数据填，历史值要能在台账里看到。
          </div>
        </div>
      </el-form-item>

      <!--
        上限常驻显示，不是只在超限时才提。
        用户要在【点导出之前】就知道自己这次查询能不能一次导完 ——
        等他导完才发现少了一半，那份不完整的文件多半已经发出去了
      -->
      <el-form-item label="导出上限">
        <div class="le-hint le-block">
          一次最多导出 <b class="le-max">{{ maxRows }}</b> 条。
          超出请用上方的查询条件缩小范围后分次导出。
        </div>
      </el-form-item>

      <el-alert v-if="willTruncate" type="warning" :closable="false" show-icon class="le-alert">
        当前查询共 {{ total }} 条，超过导出上限 {{ maxRows }} 条，只会导出前 {{ maxRows }} 条。
      </el-alert>
    </el-form>

    <template #footer>
      <el-button @click="visible = false">取 消</el-button>
      <el-button type="primary" :loading="loading" @click="handleExport">导 出</el-button>
    </template>
  </Dialog>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue'
import download from '@/utils/download'
import { buildExportFilename, type ExportResult } from '@/utils/exportExcel'
import { getExportConfig } from '@/api/qlzg/fieldDef'

/**
 * 启凌智估台账导出弹窗（项目 / 标的 / 委托方 / 资料 共用）
 *
 * ## 为什么是弹窗而不是直接一个「导出」按钮
 *
 * 与 `UserExportForm` 同一条理由：按钮只能触发动作，放不下**前提** ——
 * 上限是多少、这次查询有多少条、会不会被截断，这三件事必须出现在点「导出」**之前**。
 * 尤其是截断：等文件下完才发现少了一半，那份不完整的台账多半已经发给委托方了。
 *
 * ## 🔴 为什么四个宿主要共用一个组件，而不是各写一个
 *
 * 后端四个 `/export-excel` 走的是同一个 `QlzgExtColumnExporter#write`，
 * 所以「扩展字段怎么排、停用字段导不导、上限是多少、截断怎么标」这四件事**必然相同**。
 * 各写一份的话，将来改上限提示只会改到一个页面上，另外三个继续说旧数字 ——
 * 而那种不一致没有任何测试能发现，因为四个页面看起来都是对的。
 *
 * ## 这里刻意不放「选列」
 *
 * 导出的原则是「列表怎么显示就怎么导」，选列是「字段管理」页里 `exportable` 那一列的职责，
 * 是机构级的配置，不是每次导出都要重做一遍的决定。
 * 给用户一个「这次要不要带身份证号」的勾选，等于把一件该由权限与脱敏决定的事
 * 变成一次手滑的机会。
 */
defineOptions({ name: 'QlzgLedgerExportForm' })

const message = useMessage()

const visible = ref(false)
const loading = ref(false)

const scope = ref<'CURRENT_PAGE' | 'ALL'>('ALL')
const ledgerName = ref('台账')
const contentHints = ref<string[]>([])
const pageNo = ref(1)
const pageSize = ref(10)
const total = ref(0)

/**
 * 服务端生效的导出上限
 *
 * 默认值与后端 `QlzgExtColumnExporter.MAX_EXPORT_ROWS` 对齐，但真正显示的是接口回来的那个数 ——
 * 写死的话后端调整之后，界面上这个数就成了假的，而用户会照着它规划分批
 */
const DEFAULT_MAX_ROWS = 20000
const maxRows = ref(DEFAULT_MAX_ROWS)

/** 调用方提供的「拿当前查询条件」的回调 —— 条件在列表页那边 */
let buildParams: (() => Record<string, any>) | null = null

/**
 * 调用方提供的「真正发请求」的函数 —— 接口地址留在 `@/api/qlzg/*` 里，
 * 不让 URL 字面量散到视图层
 */
let fetcher: ((params: Record<string, any>, currentPage: boolean) => Promise<ExportResult>) | null =
  null

const willTruncate = computed(() => scope.value === 'ALL' && total.value > maxRows.value)

interface OpenOptions {
  /** 台账名，同时是弹窗标题与下载文件名前缀，与后端 write() 收到的那个字符串一致 */
  ledgerName: string
  /** 发导出请求的函数，例 `ProjectApi.exportProject` */
  fetcher: (params: Record<string, any>, currentPage: boolean) => Promise<ExportResult>
  pageNo: number
  pageSize: number
  total: number
  buildParams: () => Record<string, any>
  /** 本宿主特有的说明（哪些列不导、哪一列是脱敏的），一条一行 */
  contentHints?: string[]
}

const open = async (options: OpenOptions) => {
  ledgerName.value = options.ledgerName
  fetcher = options.fetcher
  pageNo.value = options.pageNo
  pageSize.value = options.pageSize
  total.value = options.total
  contentHints.value = options.contentHints || []
  buildParams = options.buildParams

  // 每次打开都回到「全部」。记住上次的选择听起来体贴，但导出是个有后果的动作 ——
  // 上次选了「当前页」这次没注意，会得到一个比预期少很多的文件
  scope.value = 'ALL'
  visible.value = true

  // 上限后取，取不到就用默认值。为了一个提示文案让弹窗打不开是本末倒置
  try {
    const config = await getExportConfig()
    maxRows.value = config?.maxExportRows || DEFAULT_MAX_ROWS
  } catch (e) {
    console.warn('[QlzgLedgerExportForm] 取导出上限失败，用默认值', e)
    maxRows.value = DEFAULT_MAX_ROWS
  }
}

const handleExport = async () => {
  if (!buildParams || !fetcher) return
  loading.value = true
  try {
    const currentPage = scope.value === 'CURRENT_PAGE'
    const result = await fetcher(buildParams(), currentPage)
    download.excel(
      result.blob,
      buildExportFilename(
        ledgerName.value,
        currentPage,
        pageNo.value,
        result.truncated,
        result.maxRows
      )
    )

    if (result.truncated) {
      // ⚠️ 截断必须说出来。不说的话用户以为导全了，
      // 而少掉的那部分他永远不会去找
      message.warning(
        `共 ${result.total} 条，超过导出上限 ${result.maxRows} 条，` +
          `只导出了前 ${result.maxRows} 条。请用查询条件缩小范围后分次导出`
      )
    } else {
      message.success('导出成功')
    }
    visible.value = false
  } catch (e: any) {
    // 🔴 不能写成 `catch {}`：服务端报错时界面上什么也不发生，
    //    用户只会以为「点了没反应」，而浏览器根本没下载任何文件
    console.error('[QlzgLedgerExportForm] 导出失败', e)
    message.error(e?.msg || e?.message || '导出失败，请稍后重试')
  } finally {
    loading.value = false
  }
}

defineExpose({ open })
</script>

<style lang="scss" scoped>
.le-hint {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.le-block {
  display: block;
  line-height: 1.7;
}

.le-max {
  color: var(--el-text-color-primary);
}

.le-alert {
  margin-top: 8px;
}
</style>
