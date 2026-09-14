<template>
  <Dialog v-model="visible" title="导出用户" width="520px">
    <el-form label-width="96px" label-position="left">
      <el-form-item label="导出范围">
        <el-radio-group v-model="scope">
          <el-radio value="CURRENT_PAGE">
            当前页
            <span class="ue-hint">（第 {{ pageNo }} 页，最多 {{ pageSize }} 条）</span>
          </el-radio>
          <el-radio value="ALL">
            全部
            <span class="ue-hint">（按当前查询条件，共 {{ total }} 条）</span>
          </el-radio>
        </el-radio-group>
      </el-form-item>

      <el-form-item label="导出内容">
        <div class="ue-hint ue-block">
          按列表当前显示的列导出：性别与账号状态导中文，部门导名称， 创建时间保留可计算的真值。
        </div>
      </el-form-item>

      <!--
        上限常驻显示，不是只在超限时才提。
        用户要在【点导出之前】就知道自己这次查询能不能一次导完 ——
        等他导完才发现少了一半，那份不完整的文件多半已经发出去了
      -->
      <el-form-item label="导出上限">
        <div class="ue-hint ue-block">
          一次最多导出 <b class="ue-max">{{ maxRows }}</b> 条。
          超出请用上方的查询条件缩小范围后分次导出。
        </div>
      </el-form-item>

      <el-alert v-if="willTruncate" type="warning" :closable="false" show-icon class="ue-alert">
        当前查询共 {{ total }} 条，超过导出上限 {{ maxRows }} 条， 只会导出前 {{ maxRows }} 条。
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
import * as UserApi from '@/api/system/user'
import download from '@/utils/download'

/**
 * 用户导出设置弹窗
 *
 * ## 为什么是弹窗而不是下拉菜单
 *
 * 改造前这里是个「导出当前页 / 导出全部」的下拉。下拉的问题不在于选项少，
 * 而在于它**只能放选项，放不下前提** —— 上限是多少、这次查询有多少条、
 * 会不会被截断，这三件事在下拉里没有位置，于是只能塞一句「最多 2 万条」的小字，
 * 而那句小字既不知道用户这次查了多少条，也不会在超限时变色。
 *
 * ## 这里只放「同一张列表、同一次导出也可能不同」的事
 *
 * 列、顺序、格式都不在这里选 —— 导出的原则是「列表怎么显示就怎么导」。
 * 给用户一个「要编码还是要中文」的选项，等于把一件本该由列表决定的事，
 * 变成每次导出都要做一次的决定。
 */
defineOptions({ name: 'SystemUserExportForm' })

const message = useMessage()

const visible = ref(false)
const loading = ref(false)

const scope = ref<'CURRENT_PAGE' | 'ALL'>('ALL')
const pageNo = ref(1)
const pageSize = ref(10)
const total = ref(0)

/**
 * 服务端生效的导出上限
 *
 * 默认值与后端的 `UserController.MAX_EXPORT_ROWS` 对齐，但真正显示的是
 * 接口回来的那个数 —— 写死的话后端调整之后，界面上这个数就成了假的
 */
const DEFAULT_MAX_ROWS = 20000
const maxRows = ref(DEFAULT_MAX_ROWS)

/** 调用方提供的「拿当前查询条件」的回调 —— 条件在列表页那边 */
let buildParams: (() => Record<string, any>) | null = null

const willTruncate = computed(() => scope.value === 'ALL' && total.value > maxRows.value)

interface OpenOptions {
  pageNo: number
  pageSize: number
  total: number
  buildParams: () => Record<string, any>
}

const open = async (options: OpenOptions) => {
  pageNo.value = options.pageNo
  pageSize.value = options.pageSize
  total.value = options.total
  buildParams = options.buildParams

  // 每次打开都回到「全部」。记住上次的选择听起来体贴，但导出是个有后果的动作 ——
  // 上次选了「当前页」这次没注意，会得到一个比预期少很多的文件
  scope.value = 'ALL'
  visible.value = true

  // 上限后取，取不到就用默认值。为了一个提示文案让弹窗打不开是本末倒置
  try {
    const config = await UserApi.getImportExportConfig()
    maxRows.value = config?.maxExportRows || DEFAULT_MAX_ROWS
  } catch (e) {
    console.warn('[UserExportForm] 取导出上限失败，用默认值', e)
    maxRows.value = DEFAULT_MAX_ROWS
  }
}

const handleExport = async () => {
  if (!buildParams) return
  loading.value = true
  try {
    const result = await UserApi.exportUser(buildParams(), scope.value)
    // 文件名带上范围与截断标记 —— 几个文件混在下载目录里要能分出谁是谁
    const suffix = [
      scope.value === 'CURRENT_PAGE' ? `第${pageNo.value}页` : '',
      result.truncated && result.maxRows ? `前${result.maxRows}条` : ''
    ]
      .filter(Boolean)
      .map((part) => `(${part})`)
      .join('')
    download.excel(result.blob, `用户数据${suffix}.xlsx`)

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
    // 原先这里是 `catch {}`：服务端报错时界面上什么也不发生，
    // 用户只会以为「点了没反应」，而浏览器根本没下载任何文件
    console.error('[UserExportForm] 导出失败', e)
    message.error(e?.msg || e?.message || '导出失败，请稍后重试')
  } finally {
    loading.value = false
  }
}

defineExpose({ open })
</script>

<style lang="scss" scoped>
.ue-hint {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.ue-block {
  display: block;
  line-height: 1.7;
}

.ue-max {
  color: var(--el-text-color-primary);
}

.ue-alert {
  margin-top: 8px;
}
</style>
