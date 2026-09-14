<template>
  <Dialog v-model="visible" title="导出数据" width="520px" :append-to-body="true">
    <el-form label-width="96px" label-position="left">
      <el-form-item label="导出范围">
        <el-radio-group v-model="scope">
          <el-radio value="CURRENT_PAGE">
            当前页
            <span class="ie-hint">（第 {{ pageNo }} 页，最多 {{ pageSize }} 条）</span>
          </el-radio>
          <el-radio value="ALL">
            全部
            <span class="ie-hint">（按当前查询条件，共 {{ total }} 条）</span>
          </el-radio>
        </el-radio-group>
      </el-form-item>

      <el-form-item v-if="hasSummary" label="合计行">
        <el-checkbox v-model="includeSummary">导出合计行</el-checkbox>
        <div class="ie-hint ie-block">
          要拿去做透视表时建议去掉 —— 多出来的那一行会碍事
        </div>
      </el-form-item>

      <el-form-item label="导出内容">
        <div class="ie-hint ie-block">
          按列表当前显示的样子导出：{{ columnCount }} 列、
          字典与布尔导中文、金额与日期保留可计算的真值。
          <template v-if="hiddenCount > 0">
            你隐藏的 {{ hiddenCount }} 列不会导出。
          </template>
        </div>
      </el-form-item>

      <el-alert v-if="willTruncate" type="warning" :closable="false" show-icon class="ie-alert">
        当前查询共 {{ total }} 条，超过导出上限 {{ maxRows }} 条，
        只会导出前 {{ maxRows }} 条。请用查询条件缩小范围后分次导出。
      </el-alert>
    </el-form>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="loading" @click="handleExport">导出</el-button>
    </template>
  </Dialog>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import * as RuntimeApi from '@/api/infra/formDesign/runtime'

/**
 * 导出设置弹窗
 *
 * ## 这里只放三件事，不放格式相关的任何选项
 *
 * 导出的原则是「列表怎么显示就怎么导」，所以列、顺序、格式都不该在这里选 ——
 * 它们由列表配置与用户的列设置决定。给用户一个「要编码还是要中文」的选项，
 * 等于把一件本该由「列表长什么样」决定的事，变成每次导出都要做一次的决定。
 *
 * 留在这里的是「同一张列表、同一次导出也可能不同」的：
 * 范围（当前页 / 全部）与合计行要不要。
 */
defineOptions({ name: 'FormExportDialog' })

const visible = ref(false)
const loading = ref(false)

const scope = ref<'CURRENT_PAGE' | 'ALL'>('ALL')
const includeSummary = ref(true)

const formCode = ref('')
const formName = ref('')
const pageNo = ref(1)
const pageSize = ref(20)
const total = ref(0)
const maxRows = ref(20000)
const columnCount = ref(0)
const hiddenCount = ref(0)
const hasSummary = ref(false)

/** 调用方提供的「拿当前查询条件」的回调 —— 条件在列表页那边 */
let buildRequest: (() => RuntimeApi.RuntimeExportReqVO) | null = null

const willTruncate = computed(
  () => scope.value === 'ALL' && total.value > maxRows.value
)

interface OpenOptions {
  code: string
  name: string
  pageNo: number
  pageSize: number
  total: number
  maxRows: number
  columnCount: number
  hiddenCount: number
  hasSummary: boolean
  buildRequest: () => RuntimeApi.RuntimeExportReqVO
}

function open(options: OpenOptions) {
  formCode.value = options.code
  formName.value = options.name
  pageNo.value = options.pageNo
  pageSize.value = options.pageSize
  total.value = options.total
  maxRows.value = options.maxRows
  columnCount.value = options.columnCount
  hiddenCount.value = options.hiddenCount
  hasSummary.value = options.hasSummary
  buildRequest = options.buildRequest

  // 每次打开都回到默认：全部 + 跟随列表的合计行。
  // 记住上次的选择听起来体贴，但导出是个有后果的动作 ——
  // 上次选了「当前页」这次没注意，会得到一个比预期少很多的文件
  scope.value = 'ALL'
  includeSummary.value = options.hasSummary
  visible.value = true
}

async function handleExport() {
  if (!buildRequest) return
  loading.value = true
  try {
    const base = buildRequest()
    const result = await RuntimeApi.exportData(
      formCode.value,
      {
        ...base,
        scope: scope.value,
        pageNo: scope.value === 'CURRENT_PAGE' ? pageNo.value : undefined,
        pageSize: scope.value === 'CURRENT_PAGE' ? pageSize.value : undefined,
        // 列表上没有合计行时不传 —— 让后端按「跟随列表」处理，
        // 而不是传一个 false 把「跟随」这层语义盖掉
        includeSummary: hasSummary.value ? includeSummary.value : undefined
      },
      formName.value || formCode.value,
      // 文件名带上范围 —— 两个文件混在下载目录里要能分出谁是谁
      scope.value === 'CURRENT_PAGE' ? `第${pageNo.value}页` : undefined
    )

    if (result.truncated) {
      // ⚠️ 截断必须说出来。不说的话用户以为导全了，
      // 而少掉的那部分他永远不会去找
      ElMessage.warning(
        `数据超过导出上限，只导出了前 ${result.maxRows} 条。` +
          `请用查询条件缩小范围后分次导出`
      )
    } else {
      ElMessage.success('导出成功')
    }
    visible.value = false
  } catch (e: any) {
    // 原先这里是静默的：后端报错时界面上什么也不发生，
    // 用户只会以为「点了没反应」，而浏览器根本没下载任何文件
    console.error('[FormExportDialog] 导出失败', e)
    ElMessage.error(e?.msg || e?.message || '导出失败，请稍后重试')
  } finally {
    loading.value = false
  }
}

defineExpose({ open })
</script>

<style lang="scss" scoped>
.ie-hint {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.ie-block {
  display: block;
  line-height: 1.7;
}

.ie-alert {
  margin-top: 8px;
}
</style>
